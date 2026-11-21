import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {AgentAdapterHub, McpStationServer} from '../adapters/index.ts';
import {
  CompletionCertifier,
  ContinuityEngine,
  DreamingEngine,
  InfraStewardEngine,
  MissionOrchestrator,
  OutboxWorker,
  RequirementClosureEngine,
} from '../engines/index.ts';
import {HindsightEngine} from '../memory/hindsight-engine.ts';
import {HamaEngine} from '../requirements/hama-engine.ts';
import {GitWorktreeManager, SandboxProcessRunner} from '../sandbox/index.ts';
import type {ForgeSseEvent} from '../shared/api.ts';
import {ForgeStore} from '../store/database.ts';
import {ForgeHttpServer} from './http-router.ts';
import {EngineeringRoomsService} from './rooms-service.ts';
import {HostSecretVault} from './secret-vault.ts';

export interface ForgeRuntimeOptions {
  readonly dataDir: string;
  readonly seedDemoOnEmpty?: boolean;
  readonly sessionToken?: string;
  readonly maxConcurrentSlots?: number;
}

export class ForgeRuntime {
  readonly dataDir: string;
  readonly worktreesRoot: string;
  readonly rootAbortController = new AbortController();
  readonly store: ForgeStore;
  readonly vault: HostSecretVault;
  readonly runner: SandboxProcessRunner;
  readonly worktrees: GitWorktreeManager;
  readonly mcpStation: McpStationServer;
  readonly adapters: AgentAdapterHub;
  readonly hindsight: HindsightEngine;
  readonly hama: HamaEngine;
  readonly closure: RequirementClosureEngine;
  readonly certifier: CompletionCertifier;
  readonly steward: InfraStewardEngine;
  readonly dreaming: DreamingEngine;
  readonly continuity: ContinuityEngine;
  readonly outboxWorker: OutboxWorker;
  readonly missions: MissionOrchestrator;
  readonly rooms: EngineeringRoomsService;
  readonly httpServer: ForgeHttpServer;

  private readonly daemonTimers: NodeJS.Timeout[] = [];
  private readonly activeDaemonPromises = new Set<Promise<unknown>>();
  private readonly seedDemoOnEmpty: boolean;
  private shuttingDown = false;

  constructor(options: ForgeRuntimeOptions) {
    this.dataDir = options.dataDir;
    this.seedDemoOnEmpty = options.seedDemoOnEmpty ?? true;
    this.worktreesRoot = join(this.dataDir, 'worktrees');
    mkdirSync(this.worktreesRoot, {recursive: true});

    this.store = new ForgeStore(join(this.dataDir, 'forgeops.sqlite'));
    this.vault = new HostSecretVault(join(this.dataDir, 'secrets.vault.json'));
    this.runner = new SandboxProcessRunner();
    this.worktrees = new GitWorktreeManager(this.runner);
    this.mcpStation = new McpStationServer(this.store, this.worktrees);
    const maxSlots = Math.max(
      1,
      Math.min(32, Math.trunc(options.maxConcurrentSlots ?? 3)),
    );
    this.adapters = new AgentAdapterHub(
      this.store,
      this.runner,
      this.worktrees,
      this.mcpStation,
      model => this.vault.resolveProviderForModel(this.store, model),
      maxSlots,
    );

    const publish = (ev: ForgeSseEvent): void => {
      this.httpServer.broadcast(ev);
    };

    this.hindsight = new HindsightEngine(this.store, {
      synthesizeText: (prompt: string, systemPrompt: string) =>
        this.synthesizeMemoryText(prompt, systemPrompt),
      embedRemote: (text: string) => this.embedMemoryRemote(text),
    });
    this.closure = new RequirementClosureEngine(
      this.store,
      this.worktrees,
      this.adapters,
    );
    this.certifier = new CompletionCertifier(
      this.store,
      this.runner,
      this.worktrees,
      this.adapters,
    );
    this.steward = new InfraStewardEngine(
      this.store,
      this.runner,
      this.worktrees,
      this.adapters,
      this.closure,
    );
    this.dreaming = new DreamingEngine(
      this.store,
      this.worktrees,
      this.hindsight,
    );
    this.continuity = new ContinuityEngine({
      store: this.store,
      worktrees: this.worktrees,
      adapters: this.adapters,
      mcpStation: this.mcpStation,
      certifier: this.certifier,
      steward: this.steward,
      publish,
      hindsight: this.hindsight,
      rootSignal: this.rootAbortController.signal,
    });
    this.hama = new HamaEngine({
      store: this.store,
      adapters: this.adapters,
      memory: {
        recall: q => this.hindsight.recall(q),
        retain: inp => this.hindsight.retain(inp),
      },
      publish,
    });
    this.outboxWorker = new OutboxWorker({
      store: this.store,
      hindsight: this.hindsight,
      steward: this.steward,
      publish,
      signal: this.rootAbortController.signal,
    });
    this.missions = new MissionOrchestrator({
      store: this.store,
      worktrees: this.worktrees,
      adapters: this.adapters,
      hindsight: this.hindsight,
      hama: this.hama,
      closure: this.closure,
      continuity: this.continuity,
      steward: this.steward,
      lookupProvider: model =>
        this.vault.resolveProviderForModel(this.store, model),
      worktreesRoot: this.worktreesRoot,
      publish,
      rootSignal: this.rootAbortController.signal,
    });
    this.rooms = new EngineeringRoomsService({
      store: this.store,
      adapters: this.adapters,
      closure: this.closure,
      publish,
      worktreesRoot: this.worktreesRoot,
      hindsight: this.hindsight,
      hama: this.hama,
    });
    this.httpServer = new ForgeHttpServer({
      store: this.store,
      vault: this.vault,
      worktrees: this.worktrees,
      adapters: this.adapters,
      closure: this.closure,
      continuity: this.continuity,
      steward: this.steward,
      dreaming: this.dreaming,
      rooms: this.rooms,
      hindsight: this.hindsight,
      hama: this.hama,
      missions: this.missions,
      worktreesRoot: this.worktreesRoot,
      sessionToken: options.sessionToken,
    });
  }

  async start(): Promise<void> {
    await this.mcpStation.start();
    await this.httpServer.start();
    this.continuity.recoverInterruptedState();
    this.outboxWorker.start();

    if (this.seedDemoOnEmpty && this.store.listHubs(true).length === 0) {
      await this.seedEnterpriseWorkspace();
    }

    const watchdogTimer = setInterval(() => {
      if (this.shuttingDown) {
        return;
      }
      const d = this.store
        .getDaemons()
        .find(x => x.id === 'continuity_watchdog');
      if (d?.enabled) {
        const p = this.continuity.tickWatchdog().finally(() => {
          this.activeDaemonPromises.delete(p);
        });
        this.activeDaemonPromises.add(p);
      }
    }, 30_000);
    watchdogTimer.unref();

    const dreamTimer = setInterval(() => {
      if (this.shuttingDown) {
        return;
      }
      const d = this.store
        .getDaemons()
        .find(x => x.id === 'dreaming_consolidator');
      if (d?.enabled) {
        const p = this.dreaming.runSleepConsolidation().finally(() => {
          this.activeDaemonPromises.delete(p);
        });
        this.activeDaemonPromises.add(p);
      }
    }, 180_000);
    dreamTimer.unref();

    this.daemonTimers.push(watchdogTimer, dreamTimer);
  }

  async stop(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    for (const timer of this.daemonTimers) {
      clearInterval(timer);
    }
    this.daemonTimers.length = 0;

    await this.httpServer.stop();

    if (!this.rootAbortController.signal.aborted) {
      this.rootAbortController.abort('shutdown');
    }
    await Promise.race([
      Promise.allSettled([
        this.continuity.abortAll(),
        this.outboxWorker.stop(),
        ...this.activeDaemonPromises,
      ]),
      new Promise<void>(resolve => setTimeout(resolve, 3_000)),
    ]);

    if (this.store.isOpen) {
      this.store.db
        .prepare(
          "UPDATE sessions SET status = 'interrupted', ended_at = ? WHERE status = 'running'",
        )
        .run(new Date().toISOString());
    }

    await this.mcpStation.stop();
    this.store.close();
  }

  private async synthesizeMemoryText(
    prompt: string,
    systemPrompt: string,
  ): Promise<string | null> {
    if (
      this.shuttingDown ||
      this.rootAbortController.signal.aborted ||
      process.env['FORGEOPS_OFFLINE_VERIFY'] === '1'
    ) {
      return null;
    }
    const providers = this.store.listModelProviders(id =>
      this.vault.getKeyStatus(id),
    );
    const chosen = ['opencode-go', 'deepseek', 'openai', 'anthropic']
      .map(id => providers.find(p => p.id === id))
      .find(p => p && p.hasApiKey);
    if (!chosen) {
      return null;
    }
    const apiKey = this.vault.getRawApiKey(chosen.id);
    if (!apiKey) {
      return null;
    }
    const model = chosen.models[0]?.id;
    if (!model) {
      return null;
    }
    const signal = AbortSignal.any([
      this.rootAbortController.signal,
      AbortSignal.timeout(20_000),
    ]);
    try {
      const base = chosen.baseUrl.replace(/\/+$/, '');
      if (chosen.protocol === 'anthropic-messages') {
        const endpoint = base.endsWith('/messages')
          ? base
          : base.endsWith('/v1')
            ? `${base}/messages`
            : `${base}/v1/messages`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{role: 'user', content: prompt}],
          }),
          signal,
        });
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          return null;
        }
        const data = (await res.json()) as {
          content?: Array<{type?: string; text?: string}>;
        };
        const text = (data.content ?? [])
          .filter(b => b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text!)
          .join('\n')
          .trim();
        return text || null;
      }

      const endpoint = base.endsWith('/chat/completions')
        ? base
        : `${base}/chat/completions`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: prompt},
          ],
        }),
        signal,
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const data = (await res.json()) as {
        choices?: Array<{message?: {content?: string}}>;
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch {
      return null;
    }
  }

  private async embedMemoryRemote(text: string): Promise<{
    readonly embeddingSpace: string;
    readonly dims: number;
    readonly vector: Float32Array;
  } | null> {
    if (
      this.shuttingDown ||
      this.rootAbortController.signal.aborted ||
      process.env['FORGEOPS_OFFLINE_VERIFY'] === '1'
    ) {
      return null;
    }
    const apiKey = this.vault.getRawApiKey('openai');
    if (!apiKey) {
      return null;
    }
    const openai = this.store
      .listModelProviders(id => this.vault.getKeyStatus(id))
      .find(p => p.id === 'openai');
    if (!openai) {
      return null;
    }
    const base = openai.baseUrl.replace(/\/+$/, '');
    const endpoint = base.endsWith('/embeddings') ? base : `${base}/embeddings`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text.slice(0, 8_000),
        }),
        signal: AbortSignal.any([
          this.rootAbortController.signal,
          AbortSignal.timeout(15_000),
        ]),
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const data = (await res.json()) as {
        data?: Array<{embedding?: number[]}>;
      };
      const vec = data.data?.[0]?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) {
        return null;
      }
      return {
        embeddingSpace: 'openai:text-embedding-3-small',
        dims: vec.length,
        vector: new Float32Array(vec),
      };
    } catch {
      return null;
    }
  }

  private async seedEnterpriseWorkspace(): Promise<void> {
    const fedRoot = join(this.dataDir, 'federation-hub');
    const infraPath = join(fedRoot, 'platform-harness-infra');
    const settlementPath = join(fedRoot, 'settlement-ledger-svc');
    const orderPath = join(fedRoot, 'order-orchestrator-svc');

    for (const [dir, readme] of [
      [
        infraPath,
        '# Platform Harness Infra\nOwns shared CI gates, agent skills, and deployment policies.\n',
      ],
      [
        settlementPath,
        '# Settlement Ledger Service\nProcesses canonical SettlementVoucher entries.\n',
      ],
      [
        orderPath,
        '# Order Orchestrator Service\nCoordinates FulfillmentMandate lifecycles across warehouses.\n',
      ],
    ] as const) {
      mkdirSync(dir, {recursive: true});
      writeFileSync(join(dir, 'README.md'), readme, 'utf8');
      await this.worktrees.ensureGitRepoInitialized(dir, 'main');
    }

    const hub = this.store.createHub({
      name: 'Commerce & Settlement Federation',
      rootPath: fedRoot,
      description:
        'Enterprise multi-repository control hub unifying Settlement, Order Fulfillment, and Platform Infra governance.',
      permissionTier: 'turbo',
    });

    this.store.registerRepository({
      hubId: hub.id,
      name: 'platform-harness-infra',
      tier: 'infra',
      localPath: infraPath,
      verifyCommand: 'node --version',
      boundedContext: 'PlatformGovernance',
      contractSummary:
        'Shared Skills Bank, Soul Constitution baselines, and cross-service verification scripts.',
    });

    const settlementRepo = this.store.registerRepository({
      hubId: hub.id,
      name: 'settlement-ledger-svc',
      tier: 'service',
      localPath: settlementPath,
      verifyCommand: 'node --version',
      boundedContext: 'Settlement',
      contractSummary:
        'Idempotent double-entry ledger recording SettlementVoucher postings and reconciliation.',
    });

    const orderRepo = this.store.registerRepository({
      hubId: hub.id,
      name: 'order-orchestrator-svc',
      tier: 'service',
      localPath: orderPath,
      verifyCommand: 'node --version',
      boundedContext: 'OrderFulfillment',
      contractSummary:
        'Issues FulfillmentMandate events and listens for SettlementVoucher clearance.',
    });

    this.store.upsertDomainTerm({
      hubId: hub.id,
      boundedContext: 'Settlement',
      owningRepoIds: [settlementRepo.id],
      canonicalTerm: 'SettlementVoucher',
      localLabel: '结算凭证',
      definition:
        'Immutable double-entry ledger voucher representing verified monetary settlement.',
      forbiddenAliases: ['BillItem', 'PaySlip', 'RawInvoice'],
      schemaAnchors: ['settlement_vouchers'],
    });

    this.store.upsertDomainTerm({
      hubId: hub.id,
      boundedContext: 'OrderFulfillment',
      owningRepoIds: [orderRepo.id],
      canonicalTerm: 'FulfillmentMandate',
      localLabel: '履约指令',
      definition:
        'Authoritative warehouse dispatch instruction emitted only after SettlementVoucher lock.',
      forbiddenAliases: ['ShipTicket', 'RawDispatch'],
      schemaAnchors: ['fulfillment_mandates'],
    });

    const chg = await this.closure.createAndPlanChange({
      hubId: hub.id,
      repoId: settlementRepo.id,
      executionMode: 'simulation',
      title: 'Enforce Idempotent SettlementVoucher Reconciliation',
      summary:
        'Ensure duplicate settlement callbacks resolve deterministically against canonical SettlementVoucher keys without double-posting.',
      permissionTier: 'turbo',
      worktreesRoot: this.worktreesRoot,
    });

    this.steward.runRetroOptimization(chg.id);
  }
}

/**
 * ForgeOps Host Composition Root (`ForgeRuntime`):
 * Wires SQLite+FTS5 Store, Secret Vault, Sandbox Runner, Git Worktree Manager,
 * Scoped `forge_station` MCP Server, Universal Adapter Hub, Continuity/Dreaming/
 * Steward Engines, Engineering Rooms, and Loopback HTTP+SSE Server.
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {AgentAdapterHub, McpStationServer} from '../adapters/index.ts';
import {
  CompletionCertifier,
  ContinuityEngine,
  DreamingEngine,
  InfraStewardEngine,
  RequirementClosureEngine,
} from '../engines/index.ts';
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
}

export class ForgeRuntime {
  readonly dataDir: string;
  readonly worktreesRoot: string;
  readonly store: ForgeStore;
  readonly vault: HostSecretVault;
  readonly runner: SandboxProcessRunner;
  readonly worktrees: GitWorktreeManager;
  readonly mcpStation: McpStationServer;
  readonly adapters: AgentAdapterHub;
  readonly closure: RequirementClosureEngine;
  readonly certifier: CompletionCertifier;
  readonly steward: InfraStewardEngine;
  readonly dreaming: DreamingEngine;
  readonly continuity: ContinuityEngine;
  readonly rooms: EngineeringRoomsService;
  readonly httpServer: ForgeHttpServer;

  private readonly daemonTimers: NodeJS.Timeout[] = [];
  private readonly seedDemoOnEmpty: boolean;

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
    this.adapters = new AgentAdapterHub(
      this.store,
      this.runner,
      this.worktrees,
      this.mcpStation,
      model => this.vault.resolveProviderForModel(this.store, model),
      3,
    );

    const publish = (ev: ForgeSseEvent): void => {
      this.httpServer.broadcast(ev);
    };

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
    this.dreaming = new DreamingEngine(this.store, this.worktrees);
    this.continuity = new ContinuityEngine({
      store: this.store,
      worktrees: this.worktrees,
      adapters: this.adapters,
      mcpStation: this.mcpStation,
      certifier: this.certifier,
      steward: this.steward,
      publish,
    });
    this.rooms = new EngineeringRoomsService({
      store: this.store,
      adapters: this.adapters,
      closure: this.closure,
      publish,
      worktreesRoot: this.worktreesRoot,
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
      worktreesRoot: this.worktreesRoot,
      sessionToken: options.sessionToken,
    });
  }

  async start(): Promise<void> {
    await this.mcpStation.start();
    await this.httpServer.start();
    this.continuity.recoverInterruptedState();

    if (this.seedDemoOnEmpty && this.store.listHubs(true).length === 0) {
      await this.seedEnterpriseWorkspace();
    }

    // Background non-blocking daemon loops
    const watchdogTimer = setInterval(() => {
      const d = this.store
        .getDaemons()
        .find(x => x.id === 'continuity_watchdog');
      if (d?.enabled) {
        void this.continuity.tickWatchdog();
      }
    }, 30_000);
    watchdogTimer.unref();

    const dreamTimer = setInterval(() => {
      const d = this.store
        .getDaemons()
        .find(x => x.id === 'dreaming_consolidator');
      if (d?.enabled) {
        void this.dreaming.runSleepConsolidation();
      }
    }, 180_000);
    dreamTimer.unref();

    this.daemonTimers.push(watchdogTimer, dreamTimer);
  }

  async stop(): Promise<void> {
    for (const timer of this.daemonTimers) {
      clearInterval(timer);
    }
    this.daemonTimers.length = 0;
    await this.httpServer.stop();
    await this.mcpStation.stop();
    this.store.close();
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
      title: 'Enforce Idempotent SettlementVoucher Reconciliation',
      summary:
        'Ensure duplicate settlement callbacks resolve deterministically against canonical SettlementVoucher keys without double-posting.',
      permissionTier: 'turbo',
      worktreesRoot: this.worktreesRoot,
    });

    this.steward.runRetroOptimization(chg.id);
  }
}

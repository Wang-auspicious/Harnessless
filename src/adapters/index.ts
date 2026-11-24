/**
 * Universal Multi-Agent Adapter Hub (`acp-stdio`, `cli-stream`, `native-api`),
 * Environment Doctor Probe, and Resource Slot Broker integration.
 */

import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import {assertNever} from '../shared/errors.ts';
import type {
  AdapterOperationalProfile,
  AgentAdapterManifest,
  SlotLoadSnapshot,
} from '../shared/types.ts';
import type {ForgeStore} from '../store/database.ts';
import {runAcpSession} from './acp-client.ts';
import {runCliStreamSession} from './cli-stream.ts';
import type {
  AgentInvocationRequest,
  AgentInvocationResult,
  IAgentAdapterHub,
  IMcpStationServer,
  ProviderSecretLookup,
} from './contracts.ts';
import {runNativeApiSession} from './native-api.ts';
import {ProviderRateLimiter} from './rate-limiter.ts';
import {ResourceSlotBroker} from './resource-broker.ts';

export * from './contracts.ts';
export * from './collab-bus.ts';
export * from './native-kernels.ts';
export * from './mcp-station.ts';
export * from './resource-broker.ts';
export * from './rate-limiter.ts';
export * from './acp-client.ts';
export * from './cli-stream.ts';
export * from './native-api.ts';

export class AgentAdapterHub implements IAgentAdapterHub {
  private readonly store: ForgeStore;
  private readonly runner: ISandboxProcessRunner;
  private readonly worktrees: IGitWorktreeManager;
  private readonly mcpStation: IMcpStationServer;
  private readonly lookupProvider: ProviderSecretLookup;
  private readonly broker: ResourceSlotBroker;
  readonly rateLimiter = new ProviderRateLimiter();

  constructor(
    store: ForgeStore,
    runner: ISandboxProcessRunner,
    worktrees: IGitWorktreeManager,
    mcpStation: IMcpStationServer,
    lookupProvider: ProviderSecretLookup,
    maxWorkerSlots = 3,
  ) {
    this.store = store;
    this.runner = runner;
    this.worktrees = worktrees;
    this.mcpStation = mcpStation;
    this.lookupProvider = lookupProvider;
    this.broker = new ResourceSlotBroker(maxWorkerSlots);
  }

  async probeAdapter(
    manifest: AgentAdapterManifest,
  ): Promise<{readonly ok: boolean; readonly message: string}> {
    if (manifest.transport === 'native-api') {
      const message = 'Built-in API runner ready';
      this.store.updateAdapterProbe(manifest.id, true, message);
      return {ok: true, message};
    }

    const resolved = this.runner.resolveExecutable(manifest.command);
    if (!resolved) {
      const message = `Binary "${manifest.command}" not found on PATH`;
      this.store.updateAdapterProbe(manifest.id, false, message);
      return {ok: false, message};
    }

    const probeArgs =
      manifest.healthProbeArgs.length > 0
        ? manifest.healthProbeArgs
        : ['--version'];
    const res = await this.runner.run({
      executable: manifest.command,
      args: probeArgs,
      cwd: process.cwd(),
      envAllowlist: manifest.envAllowlist,
      timeoutMs: 8_000,
    });

    const ok = res.exitCode === 0 && !res.timedOut;
    const rawOut = (res.stdout || res.stderr).trim().split(/\r?\n/)[0] ?? '';
    const message = ok
      ? `${resolved}${rawOut ? ` (${rawOut.slice(0, 80)})` : ''}`
      : `Probe failed (exit ${res.exitCode}): ${rawOut.slice(0, 120) || 'no output'}`;

    this.store.updateAdapterProbe(manifest.id, ok, message);
    return {ok, message};
  }

  async probeAllAdapters(): Promise<readonly AdapterOperationalProfile[]> {
    const profiles = this.store.listAdapterProfiles();
    for (const profile of profiles) {
      await this.probeAdapter(profile.manifest);
    }
    return this.store.listAdapterProfiles();
  }

  async invoke(req: AgentInvocationRequest): Promise<AgentInvocationResult> {
    const effectiveProviderId =
      req.providerId ??
      this.lookupProvider(req.model)?.providerId ??
      req.adapter.id;
    await this.rateLimiter.waitIfCooling(effectiveProviderId, req.signal);

    const releaseSlot = req.prioritySlot
      ? await this.broker.acquireHumanPrioritySlot(req.signal)
      : await this.broker.acquireWorkerSlot(req.signal);

    try {
      let result: AgentInvocationResult;
      switch (req.adapter.transport) {
        case 'acp-stdio':
          result = await runAcpSession(req, this.runner);
          break;
        case 'cli-stream':
          result = await runCliStreamSession(req, this.runner);
          break;
        case 'native-api':
          result = await runNativeApiSession(
            req,
            this.worktrees,
            this.lookupProvider,
          );
          break;
        default:
          return assertNever(req.adapter.transport, 'Unsupported transport');
      }

      if (result.outcome === 'rate_limited') {
        this.rateLimiter.markRateLimited(
          effectiveProviderId,
          result.retryAfterSeconds ?? 30,
        );
      }

      if (!result.mcpSubmission && req.mcpAttemptToken) {
        const stationSubmission = this.mcpStation.getSubmission(
          req.mcpAttemptToken,
        );
        if (stationSubmission) {
          return {
            ...result,
            mcpSubmission: stationSubmission,
          };
        }
      }

      return result;
    } finally {
      releaseSlot();
    }
  }

  getSlotLoad(): SlotLoadSnapshot {
    return this.broker.getSnapshot();
  }
}

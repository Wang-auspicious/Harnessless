import {ForgeError} from '../shared/errors.ts';
import type {ForgeSseEvent} from '../shared/api.ts';
import type {ExecutionMode} from '../shared/v3-types.ts';
import type {ForgeStore} from '../store/database.ts';
import type {HindsightEngine} from '../memory/hindsight-engine.ts';
import type {InfraStewardEngine} from './infra-steward.ts';

export interface OutboxWorkerDeps {
  readonly store: ForgeStore;
  readonly hindsight: HindsightEngine;
  readonly steward: InfraStewardEngine;
  readonly publish: (event: ForgeSseEvent) => void;
  readonly signal?: AbortSignal;
  readonly pollIntervalMs?: number;
}

export class OutboxWorker {
  private readonly store: ForgeStore;
  private readonly hindsight: HindsightEngine;
  private readonly steward: InfraStewardEngine;
  private readonly publish: (event: ForgeSseEvent) => void;
  private readonly signal?: AbortSignal;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private pendingWake = false;
  private stopped = false;

  constructor(deps: OutboxWorkerDeps) {
    this.store = deps.store;
    this.hindsight = deps.hindsight;
    this.steward = deps.steward;
    this.publish = deps.publish;
    this.signal = deps.signal;
    this.pollIntervalMs = deps.pollIntervalMs ?? 5_000;
  }

  start(): void {
    if (this.timer || this.stopped) {
      return;
    }
    this.store.registerOutboxWakeup(() => this.wake());
    this.timer = setInterval(() => {
      this.wake();
    }, this.pollIntervalMs);
    this.timer.unref?.();
    this.wake();
  }

  wake(): void {
    if (this.stopped || this.signal?.aborted) {
      return;
    }
    if (this.inFlight) {
      this.pendingWake = true;
      return;
    }
    this.inFlight = this.drainOnce()
      .then(() => undefined)
      .finally(() => {
        this.inFlight = null;
        if (this.pendingWake && !this.stopped && !this.signal?.aborted) {
          this.pendingWake = false;
          queueMicrotask(() => this.wake());
        }
      });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.pendingWake = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      await Promise.race([
        this.inFlight,
        new Promise<void>(resolve => setTimeout(resolve, 2_000)),
      ]);
    }
  }

  async drainOnce(): Promise<number> {
    if (this.stopped || this.signal?.aborted) {
      return 0;
    }
    const effects = this.store.claimDueEffects(
      new Date().toISOString(),
      10,
      60_000,
    );
    let processed = 0;

    for (const eff of effects) {
      if (this.stopped || this.signal?.aborted) {
        this.store.rescheduleEffect(
          eff.id,
          eff.attempts,
          1_000,
          'Worker shutting down',
          eff.leaseToken ?? undefined,
        );
        continue;
      }

      try {
        const payload = JSON.parse(eff.payloadJson) as Record<string, unknown>;
        this.dispatchEffect(eff.kind, payload);
        this.store.completeEffect(
          eff.id,
          eff.leaseToken ?? undefined,
          eff.payloadVersion,
        );
        processed += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const backoffMs = Math.min(300_000, 2_000 * 2 ** eff.attempts);
        this.store.rescheduleEffect(
          eff.id,
          eff.attempts + 1,
          backoffMs,
          msg,
          eff.leaseToken ?? undefined,
        );
      }
    }

    return processed;
  }

  private dispatchEffect(kind: string, payload: Record<string, unknown>): void {
    const hubId = typeof payload['hubId'] === 'string' ? payload['hubId'] : '';
    const executionMode: ExecutionMode =
      payload['executionMode'] === 'simulation' ? 'simulation' : 'live';

    switch (kind) {
      case 'memory.consolidate': {
        if (!hubId) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'memory.consolidate requires hubId',
          );
        }
        this.hindsight.consolidatePendingFacts(hubId, executionMode);
        this.publish({
          type: 'memory.consolidated',
          hubId,
          executionMode,
          at: new Date().toISOString(),
        });
        return;
      }
      case 'memory.refresh_docs': {
        if (!hubId) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'memory.refresh_docs requires hubId',
          );
        }
        this.hindsight.refreshStaleLivingDocs(hubId, executionMode);
        return;
      }
      case 'memory.git_drift': {
        const changeId =
          typeof payload['changeId'] === 'string' ? payload['changeId'] : '';
        const changedFiles = Array.isArray(payload['changedFiles'])
          ? payload['changedFiles'].filter(
              (x): x is string => typeof x === 'string',
            )
          : [];
        if (!hubId || !changeId) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'memory.git_drift requires hubId and changeId',
          );
        }
        this.hindsight.detectGitDrift(
          hubId,
          executionMode,
          changeId,
          changedFiles,
        );
        return;
      }
      case 'infra.retro': {
        const changeId =
          typeof payload['changeId'] === 'string' ? payload['changeId'] : '';
        if (changeId) {
          this.steward.runRetroOptimization(changeId);
        }
        return;
      }
      default:
        throw new ForgeError(
          'VALIDATION_ERROR',
          `Unknown outbox effect kind "${kind}"`,
        );
    }
  }
}

import {ForgeError} from '../shared/errors.ts';

export function parseRetryAfterSeconds(raw: string | null): number {
  if (!raw) {
    return 30;
  }
  const num = Number.parseFloat(raw.trim());
  if (Number.isFinite(num) && num > 0) {
    return Math.min(180, Math.max(1, Math.ceil(num)));
  }
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
    return Math.min(180, Math.max(1, diffSec));
  }
  return 30;
}

export class ProviderRateLimiter {
  private readonly cooldownUntilByProvider = new Map<string, number>();

  markRateLimited(providerId: string, retryAfterSec = 30): number {
    const jitterMs = Math.floor(Math.random() * 1500);
    const waitMs = Math.min(180, Math.max(1, retryAfterSec)) * 1000 + jitterMs;
    const targetUntil = Date.now() + waitMs;
    const existing = this.cooldownUntilByProvider.get(providerId) ?? 0;
    const nextUntil = Math.max(existing, targetUntil);
    this.cooldownUntilByProvider.set(providerId, nextUntil);
    return Math.ceil((nextUntil - Date.now()) / 1000);
  }

  getRemainingCooldownMs(providerId: string): number {
    const until = this.cooldownUntilByProvider.get(providerId);
    if (!until) {
      return 0;
    }
    const rem = until - Date.now();
    if (rem <= 0) {
      this.cooldownUntilByProvider.delete(providerId);
      return 0;
    }
    return rem;
  }

  async waitIfCooling(providerId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new ForgeError(
        'ABORTED',
        'Invocation aborted while cooling down',
        499,
      );
    }
    const rem = this.getRemainingCooldownMs(providerId);
    if (rem <= 0) {
      return;
    }
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolvePromise();
      }, rem);
      const onAbort = (): void => {
        clearTimeout(timer);
        rejectPromise(
          new ForgeError(
            'ABORTED',
            'Invocation aborted during rate-limit cooldown',
            499,
          ),
        );
      };
      signal?.addEventListener('abort', onAbort, {once: true});
    });
  }
}

/**
 * Lightweight Live Operational Feedback & Health Circuit-Breaker.
 * Separates `env_fault` from `task_failure` and guides Strong-Commands-Weak
 * adapter selection without offline benchmark bloat.
 */

import type {
  AdapterHealthState,
  AdapterOperationalProfile,
  AgentAdapterManifest,
  AgentRole,
  ExecutionTelemetryRecord,
} from '../shared/types.ts';

export interface ProbeSnapshot {
  readonly ok: boolean | null;
  readonly message: string;
  readonly probedAt: string | null;
}

export function computeAdapterOperationalProfile(
  manifest: AgentAdapterManifest,
  records: readonly ExecutionTelemetryRecord[],
  probe: ProbeSnapshot,
): AdapterOperationalProfile {
  // Sort newest first for consecutive fault detection.
  const ordered = [...records].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const window = ordered.slice(0, 30);

  let consecutiveEnvFaults = 0;
  for (const r of ordered) {
    if (r.outcome === 'env_fault') {
      consecutiveEnvFaults += 1;
    } else {
      break;
    }
  }

  const scored = window.filter(r => r.outcome !== 'env_fault');
  const certified = scored.filter(r => r.outcome === 'certified');
  const firstPass = certified.filter(r => r.firstPassCertified);
  const prematureStops = window.filter(r => r.prematureStopTriggered).length;

  const totalCostUsd = window.reduce((sum, r) => sum + r.costUsd, 0);
  const totalInput = certified.reduce((sum, r) => sum + r.inputTokens, 0);
  const effectiveCached = certified.reduce(
    (sum, r) => sum + Math.max(0, r.cachedTokens - r.firstTurnCachedTokens),
    0,
  );

  let health: AdapterHealthState = 'unprobed';
  if (consecutiveEnvFaults >= 3 || probe.ok === false) {
    health = consecutiveEnvFaults >= 3 ? 'circuit_open' : 'degraded';
  } else if (probe.ok === true || scored.length > 0) {
    health = consecutiveEnvFaults > 0 ? 'degraded' : 'healthy';
  }

  return {
    manifest,
    health,
    lastProbeMessage: probe.message,
    lastProbedAt: probe.probedAt,
    rollingScoredSlices: scored.length,
    firstPassRate:
      scored.length > 0
        ? Number((firstPass.length / scored.length).toFixed(3))
        : 1,
    effectiveCostPerCertifiedUsd:
      certified.length > 0
        ? Number((totalCostUsd / certified.length).toFixed(4))
        : 0,
    cacheHitRatio:
      totalInput > 0 ? Number((effectiveCached / totalInput).toFixed(3)) : 0,
    prematureStopRate:
      window.length > 0
        ? Number((prematureStops / window.length).toFixed(3))
        : 0,
    consecutiveEnvFaults,
  };
}

/**
 * Selects the optimal healthy adapter for a role, honoring a preferred ID if
 * healthy, or falling back cleanly when `circuit_open` / `degraded`.
 */
export function selectHealthyAdapterForRole(
  profiles: readonly AdapterOperationalProfile[],
  role: AgentRole,
  preferredAdapterId?: string | null,
): AdapterOperationalProfile | null {
  const eligible = profiles.filter(
    p =>
      p.manifest.supportedRoles.includes(role) && p.health !== 'circuit_open',
  );
  if (eligible.length === 0) {
    return null;
  }

  if (preferredAdapterId) {
    const preferred = eligible.find(
      p => p.manifest.id === preferredAdapterId && p.health !== 'degraded',
    );
    if (preferred) {
      return preferred;
    }
  }

  const fitness = (p: AdapterOperationalProfile): number => {
    const healthBonus =
      p.health === 'healthy' ? 0.25 : p.health === 'unprobed' ? 0.1 : -0.25;
    const discipline = 1 - p.prematureStopRate;
    const costTerm =
      role === 'worker'
        ? 1 / (1 + p.effectiveCostPerCertifiedUsd)
        : 1 / (1 + p.effectiveCostPerCertifiedUsd / 4);
    return (
      0.5 * p.firstPassRate + 0.25 * discipline + 0.25 * costTerm + healthBonus
    );
  };

  return [...eligible].sort((a, b) => fitness(b) - fitness(a))[0] ?? null;
}

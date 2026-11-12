/**
 * Dual Human x Agent Ebbinghaus Cognitive Memory & Attention Priority Engine.
 * Zero I/O dependencies.
 */

import type {
  AttentionItem,
  RehydrationCapsule,
  RehydrationTier,
} from '../shared/types.ts';

const BASE_HUMAN_STABILITY_HOURS = 8.0;

export interface HumanEntropyInputs {
  readonly tasksCertifiedSinceAnchor: number;
  readonly ghostAmendmentsSinceAnchor: number;
  readonly adrUpdatesSinceAnchor: number;
  readonly linesChangedSinceAnchor: number;
}

/**
 * Unseen autonomous mutation entropy accelerating mental-model staleness.
 */
export function computeMutationEntropy(inputs: HumanEntropyInputs): number {
  const tasks = Math.max(0, inputs.tasksCertifiedSinceAnchor);
  const ghosts = Math.max(0, inputs.ghostAmendmentsSinceAnchor);
  const adrs = Math.max(0, inputs.adrUpdatesSinceAnchor);
  const loc = Math.max(0, inputs.linesChangedSinceAnchor);
  return 0.15 * tasks + 0.35 * ghosts + 0.5 * adrs + 0.1 * Math.log(1 + loc);
}

/**
 * Effective human memory stability S_human (hours), boosted by spaced reviews
 * and compressed by unseen autonomous mutation velocity.
 */
export function computeHumanStabilityHours(
  spacedReviewCount: number,
  mutationEntropy: number,
): number {
  const reviews = Math.max(0, spacedReviewCount);
  const numerator =
    BASE_HUMAN_STABILITY_HOURS * Math.pow(1 + 0.6 * reviews, 0.8);
  const denominator = 1 + 0.25 * Math.max(0, mutationEntropy);
  return Math.max(0.5, numerator / denominator);
}

/**
 * Ebbinghaus retention R(t) = exp(-elapsedHours / stabilityHours) in (0, 1].
 */
export function computeRetentionScore(
  elapsedHours: number,
  stabilityHours: number,
): number {
  if (elapsedHours <= 0) {
    return 1;
  }
  const safeS = Math.max(0.25, stabilityHours);
  return Math.max(0.01, Math.min(1, Math.exp(-elapsedHours / safeS)));
}

export function classifyRehydrationTier(
  retentionScore: number,
): RehydrationTier {
  if (retentionScore >= 0.75) {
    return 'warm';
  }
  if (retentionScore >= 0.35) {
    return 'delta_30s';
  }
  return 'deep_reanchor';
}

export interface CapsuleBuildInput {
  readonly hubId: string;
  readonly hubName: string;
  readonly northStarGoal: string;
  readonly lastHumanInteractionAt: string;
  readonly spacedReviewCount: number;
  readonly lastHumanAnchorSummary: string;
  readonly entropyInputs: HumanEntropyInputs;
  readonly deltaHighlights: readonly string[];
  readonly lockedDecisions: readonly string[];
  readonly topAttentionQuestion: string | null;
  readonly nowMs: number;
}

export function buildRehydrationCapsule(
  input: CapsuleBuildInput,
): RehydrationCapsule {
  const lastMs = Date.parse(input.lastHumanInteractionAt);
  const elapsedHours = Number.isFinite(lastMs)
    ? Math.max(0, (input.nowMs - lastMs) / 3_600_000)
    : 24;
  const entropy = computeMutationEntropy(input.entropyInputs);
  const stabilityHours = computeHumanStabilityHours(
    input.spacedReviewCount,
    entropy,
  );
  const retention = computeRetentionScore(elapsedHours, stabilityHours);
  const tier = classifyRehydrationTier(retention);

  return {
    hubId: input.hubId,
    hubName: input.hubName,
    retentionScore: Number(retention.toFixed(3)),
    stabilityHours: Number(stabilityHours.toFixed(2)),
    elapsedHours: Number(elapsedHours.toFixed(2)),
    mutationEntropy: Number(entropy.toFixed(2)),
    tier,
    northStarGoal: input.northStarGoal,
    lastHumanAnchor: input.lastHumanAnchorSummary,
    autonomousDeltaBullets:
      tier === 'warm' ? [] : input.deltaHighlights.slice(0, 5),
    lockedDecisions:
      tier === 'deep_reanchor' ? input.lockedDecisions.slice(0, 6) : [],
    nextDecisionPrompt: input.topAttentionQuestion,
    generatedAt: new Date(input.nowMs).toISOString(),
  };
}

/**
 * Ranks pending Attention items across multiple concurrent hubs/projects so
 * fast, high-unblocking decisions on warm projects surface first.
 */
export function rankAttentionQueue(
  items: readonly AttentionItem[],
  hubRetentionById: ReadonlyMap<string, number>,
): AttentionItem[] {
  const scoreOf = (item: AttentionItem): number => {
    const isCritical = item.kind === 'gate_approval' ? 2 : 0;
    const readSec = Math.max(10, item.estimatedReadSeconds);
    const retention = hubRetentionById.get(item.hubId) ?? 0.5;
    return (
      ((item.downstreamBlockedCount + 1 + isCritical) / readSec) *
      (1 + 0.5 * retention)
    );
  };
  return [...items]
    .filter(i => i.status === 'open')
    .sort(
      (a, b) =>
        scoreOf(b) - scoreOf(a) || a.createdAt.localeCompare(b.createdAt),
    );
}

/**
 * Agent semantic memory spaced reinforcement when recalled before a 1st-pass
 * certified slice.
 */
export function reinforceAgentMemoryStability(
  previousStabilityHours: number,
): number {
  return Math.min(2160, Math.max(12, previousStabilityHours * 1.45 + 12));
}

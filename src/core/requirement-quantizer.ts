/**
 * Pure deterministic Requirement Quantization Engine:
 * 1. Kano 2-question classifier + Better-Worse (SI / DSI) indices
 * 2. BWS / Semantic Differential fuzzy-term-to-engineering-metric translator
 * 3. AHP pairwise comparison eigenvector solver + Saaty CR < 0.10 gate
 */

import {ForgeError} from '../shared/errors.ts';
import type {
  BwsParameterMapping,
  KanoAhpInputItem,
  KanoAhpScoreItem,
  KanoCategory,
  KanoResponseLevel,
  KanoVoteSample,
  QuantizationResult,
} from '../shared/v4-types.ts';

const KANO_LEVEL_INDEX: Readonly<Record<KanoResponseLevel, number>> = {
  like: 0,
  expect: 1,
  neutral: 2,
  tolerate: 3,
  dislike: 4,
};

const KANO_MATRIX: readonly (readonly KanoCategory[])[] = [
  ['Q', 'A', 'A', 'A', 'O'],
  ['R', 'I', 'I', 'I', 'M'],
  ['R', 'I', 'I', 'I', 'M'],
  ['R', 'I', 'I', 'I', 'M'],
  ['R', 'R', 'R', 'R', 'Q'],
];

const KANO_PRIORITY_ORDER: readonly KanoCategory[] = [
  'M',
  'O',
  'A',
  'I',
  'R',
  'Q',
];

/**
 * Standard Saaty Random Consistency Index (RI) for n = 1..15.
 * First 9 entries are exact Saaty [0, 0, 0.58, 0.90, 1.12, 1.24, 1.32, 1.41, 1.45].
 */
export const SAATY_RI_TABLE: readonly number[] = [
  0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49, 1.51, 1.48, 1.56, 1.57,
  1.59,
];

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function classifyKanoPair(
  functional: KanoResponseLevel,
  dysfunctional: KanoResponseLevel,
): KanoCategory {
  const rowIdx = KANO_LEVEL_INDEX[functional];
  const colIdx = KANO_LEVEL_INDEX[dysfunctional];
  const row = KANO_MATRIX[rowIdx];
  const cell = row?.[colIdx];
  return cell ?? 'I';
}

export interface KanoBetterWorseResult {
  readonly category: KanoCategory;
  readonly betterSI: number;
  readonly worseDSI: number;
  readonly counts: Readonly<Record<KanoCategory, number>>;
}

export function computeKanoBetterWorse(
  samples: readonly KanoVoteSample[],
): KanoBetterWorseResult {
  const counts: Record<KanoCategory, number> = {
    M: 0,
    O: 0,
    A: 0,
    I: 0,
    R: 0,
    Q: 0,
  };

  for (const sample of samples) {
    const cat = classifyKanoPair(sample.functional, sample.dysfunctional);
    counts[cat] += 1;
  }

  let bestCategory: KanoCategory = 'I';
  let bestCount = -1;
  for (const cat of KANO_PRIORITY_ORDER) {
    if (counts[cat] > bestCount) {
      bestCount = counts[cat];
      bestCategory = cat;
    }
  }

  const denom = counts.A + counts.O + counts.M + counts.I;
  const betterSI = denom > 0 ? round4((counts.A + counts.O) / denom) : 0;
  const worseDSI = denom > 0 ? round4(-((counts.O + counts.M) / denom)) : 0;

  return {
    category: bestCategory,
    betterSI,
    worseDSI,
    counts,
  };
}

export interface AhpComputationResult {
  readonly weights: readonly number[];
  readonly lambdaMax: number;
  readonly ci: number;
  readonly cr: number;
  readonly passed: boolean;
  readonly maxConflictPair?: readonly [number, number];
}

export function computeAhpWeights(
  matrix: readonly (readonly number[])[],
): AhpComputationResult {
  const n = matrix.length;
  if (n === 0) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      'AHP pairwise matrix must not be empty',
      400,
    );
  }

  for (let i = 0; i < n; i++) {
    const row = matrix[i];
    if (!row || row.length !== n) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        `AHP matrix must be square (${n}x${n})`,
        400,
      );
    }
    for (let j = 0; j < n; j++) {
      const val = row[j];
      if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
        throw new ForgeError(
          'VALIDATION_ERROR',
          `AHP matrix entry (${i}, ${j}) must be a positive finite number`,
          400,
        );
      }
    }
  }

  if (n === 1) {
    return {
      weights: [1],
      lambdaMax: 1,
      ci: 0,
      cr: 0,
      passed: true,
    };
  }

  // Initial vector from normalized geometric row means
  let weights = new Array<number>(n).fill(1 / n);
  let geomSum = 0;
  for (let i = 0; i < n; i++) {
    let logSum = 0;
    const row = matrix[i]!;
    for (let j = 0; j < n; j++) {
      logSum += Math.log(row[j]!);
    }
    const g = Math.exp(logSum / n);
    weights[i] = g;
    geomSum += g;
  }
  if (geomSum > 0) {
    weights = weights.map(w => w / geomSum);
  }

  // Power iteration for exact principal eigenvector
  for (let iter = 0; iter < 150; iter++) {
    const next = new Array<number>(n).fill(0);
    let nextSum = 0;
    for (let i = 0; i < n; i++) {
      const row = matrix[i]!;
      let acc = 0;
      for (let j = 0; j < n; j++) {
        acc += row[j]! * weights[j]!;
      }
      next[i] = acc;
      nextSum += acc;
    }
    if (nextSum <= 0) {
      break;
    }
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      const normalized = next[i]! / nextSum;
      const delta = Math.abs(normalized - weights[i]!);
      if (delta > maxDelta) {
        maxDelta = delta;
      }
      next[i] = normalized;
    }
    weights = next;
    if (maxDelta < 1e-12) {
      break;
    }
  }

  // Compute lambdaMax = (1 / n) * sum_i ((A * w)_i / w_i)
  let ratioSum = 0;
  for (let i = 0; i < n; i++) {
    const row = matrix[i]!;
    let aw = 0;
    for (let j = 0; j < n; j++) {
      aw += row[j]! * weights[j]!;
    }
    const wi = weights[i]!;
    ratioSum += wi > 0 ? aw / wi : n;
  }
  const lambdaMax = ratioSum / n;
  const ci = n > 1 ? Math.max(0, (lambdaMax - n) / (n - 1)) : 0;
  const ri = SAATY_RI_TABLE[n - 1] ?? 1.59;
  const cr = ri > 0 ? ci / ri : 0;
  const passed = cr < 0.1;

  let maxConflictPair: readonly [number, number] | undefined;
  if (n >= 3) {
    let worstResidual = -1;
    let worstI = 0;
    let worstJ = 1;
    for (let i = 0; i < n; i++) {
      const row = matrix[i]!;
      const wi = weights[i]!;
      for (let j = i + 1; j < n; j++) {
        const wj = weights[j]!;
        const idealRatio = wj > 0 ? wi / wj : 1;
        const observed = row[j]!;
        const residual = Math.abs(Math.log(observed) - Math.log(idealRatio));
        if (residual > worstResidual) {
          worstResidual = residual;
          worstI = i;
          worstJ = j;
        }
      }
    }
    if (!passed || worstResidual > 1e-4) {
      maxConflictPair = [worstI, worstJ];
    }
  }

  return {
    weights: weights.map(round4),
    lambdaMax: round4(lambdaMax),
    ci: round4(ci),
    cr: round4(cr),
    passed,
    maxConflictPair,
  };
}

interface FuzzyMappingRule {
  readonly pattern: RegExp;
  readonly mapping: BwsParameterMapping;
}

const FUZZY_BWS_RULES: readonly FuzzyMappingRule[] = [
  {
    pattern: /fast|instant|秒出|极速|低延迟|性能|响应快/i,
    mapping: {
      fuzzyTerm: 'fast / low-latency',
      engineeringMetric: 'p95_api_latency_ms <= 250',
      assertion: 'All synchronous local API actions respond in under 250ms p95',
      bestWorstScore: 0.85,
    },
  },
  {
    pattern: /clean|minimal|克制|极简|专业|清晰/i,
    mapping: {
      fuzzyTerm: 'clean & restrained UI',
      engineeringMetric: 'claude_light_surface_tokens_only',
      assertion:
        'Single main reading column <= 768px with collapsible trace pills and zero neon clutter',
      bestWorstScore: 0.78,
    },
  },
  {
    pattern: /quiet|silent|不打扰|静默|降噪/i,
    mapping: {
      fuzzyTerm: 'non-intrusive collaboration',
      engineeringMetric: 'zero_unsolicited_notifications',
      assertion:
        'Only blocking approval gates or failures interrupt the main conversation stream',
      bestWorstScore: 0.72,
    },
  },
  {
    pattern: /secure|safe|权限|安全|隔离|防自批|auth|rbac/i,
    mapping: {
      fuzzyTerm: 'strict security & separation of duties',
      engineeringMetric: 'anti_self_approval_and_audience_intersection',
      assertion:
        'Writer kernel is hard-blocked from reviewing/approving its own plan; private collab items obey audience intersection',
      bestWorstScore: 0.94,
    },
  },
  {
    pattern: /reliable|resume|断点|稳定|高可用|容错/i,
    mapping: {
      fuzzyTerm: 'fault-tolerant resumability',
      engineeringMetric: 'checkpoint_resume_without_rework',
      assertion:
        'Failed wave tasks preserve worktree checkpoints and resume cleanly without redoing completed waves',
      bestWorstScore: 0.88,
    },
  },
];

export function translateFuzzyTermsToBws(text: string): BwsParameterMapping[] {
  const out: BwsParameterMapping[] = [];
  for (const rule of FUZZY_BWS_RULES) {
    if (rule.pattern.test(text)) {
      out.push(rule.mapping);
    }
  }
  return out;
}

function kanoPriorityBucket(
  category: KanoCategory,
): KanoAhpScoreItem['priorityBucket'] {
  if (category === 'M') return 'p0_must';
  if (category === 'O' || category === 'A') return 'p1_compete';
  if (category === 'R') return 'rejected';
  return 'backlog';
}

function kanoBaselineWeight(category: KanoCategory): number {
  switch (category) {
    case 'M':
      return 5;
    case 'O':
      return 3.5;
    case 'A':
      return 2.2;
    case 'I':
      return 1;
    case 'Q':
      return 1;
    case 'R':
      return 0.5;
  }
}

export function buildConsistentMatrixFromScores(
  scores: readonly number[],
): number[][] {
  const n = scores.length;
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    const si = Math.max(0.1, scores[i] ?? 1);
    for (let j = 0; j < n; j++) {
      const sj = Math.max(0.1, scores[j] ?? 1);
      const rawRatio = si / sj;
      const clamped = Math.max(1 / 9, Math.min(9, rawRatio));
      row.push(round4(clamped));
    }
    matrix.push(row);
  }
  return matrix;
}

export function quantizeRequirements(
  inputItems: readonly KanoAhpInputItem[],
  pairwiseMatrix?: readonly (readonly number[])[],
): QuantizationResult {
  if (inputItems.length === 0) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      'At least one requirement item is required for Kano/AHP quantization',
      400,
    );
  }

  const kanoComputed = inputItems.map(item => {
    const samples: KanoVoteSample[] =
      item.samples && item.samples.length > 0
        ? [...item.samples]
        : [
            {
              functional: item.functional ?? 'like',
              dysfunctional: item.dysfunctional ?? 'dislike',
            },
          ];
    const kano = computeKanoBetterWorse(samples);
    const inferredBws = translateFuzzyTermsToBws(item.title);
    const bwsMappings =
      item.bwsMappings && item.bwsMappings.length > 0
        ? [...item.bwsMappings]
        : inferredBws;

    return {
      item,
      kano,
      bwsMappings,
    };
  });

  const matrix =
    pairwiseMatrix ??
    buildConsistentMatrixFromScores(
      kanoComputed.map(entry => kanoBaselineWeight(entry.kano.category)),
    );

  if (matrix.length !== inputItems.length) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `AHP pairwise matrix dimension (${matrix.length}) must match item count (${inputItems.length})`,
      400,
    );
  }

  const ahp = computeAhpWeights(matrix);

  const scoredItems: KanoAhpScoreItem[] = kanoComputed.map((entry, idx) => ({
    reqId: entry.item.reqId,
    title: entry.item.title,
    kanoCategory: entry.kano.category,
    betterSI: entry.kano.betterSI,
    worseDSI: entry.kano.worseDSI,
    priorityBucket: kanoPriorityBucket(entry.kano.category),
    ahpWeight: ahp.weights[idx] ?? 0,
    bwsMappings: entry.bwsMappings,
  }));

  const conflictPair = ahp.maxConflictPair;
  let diagnostic: string;
  if (ahp.passed) {
    diagnostic = `AHP consistency passed (CR=${ahp.cr.toFixed(4)} < 0.10, lambdaMax=${ahp.lambdaMax.toFixed(4)}).`;
  } else if (conflictPair) {
    const [i, j] = conflictPair;
    const nameI = scoredItems[i]?.title ?? `#${i}`;
    const nameJ = scoredItems[j]?.title ?? `#${j}`;
    diagnostic = `AHP consistency failed (CR=${ahp.cr.toFixed(4)} >= 0.10). Largest contradiction between "${nameI}" (${i}) and "${nameJ}" (${j}).`;
  } else {
    diagnostic = `AHP consistency failed (CR=${ahp.cr.toFixed(4)} >= 0.10).`;
  }

  return {
    items: scoredItems,
    ahpWeights: ahp.weights,
    lambdaMax: ahp.lambdaMax,
    ci: ahp.ci,
    cr: ahp.cr,
    passed: ahp.passed,
    maxConflictPair: conflictPair,
    diagnostic,
  };
}

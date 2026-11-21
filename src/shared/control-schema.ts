import type {IntentPresetId, TriageTrack} from './v3-types.ts';
import type {PermissionTier} from './types.ts';

export interface ResolvedPresetPolicy {
  readonly preset: IntentPresetId;
  readonly permissionTier: PermissionTier;
  readonly defaultTriageTrack: TriageTrack;
  readonly autoAdvanceTriage: boolean;
  readonly autoAdvancePlan: boolean;
  readonly autoAdvanceDelivery: boolean;
  readonly autoApproveNonCommandGhost: boolean;
  readonly maxAutoGhosts: number;
  readonly maxParallelSlots: number;
  readonly requireDualAudit: boolean;
  readonly maxRetryLoops: number;
  readonly maxDiscussionRounds: number;
  readonly maxProposalRevisions: number;
  readonly maxLocalPrdEdits: number;
  readonly budgetUsdLimit: number;
  readonly maxOvernightHours: number;
}

export const INTENT_PRESETS: Readonly<
  Record<IntentPresetId, ResolvedPresetPolicy>
> = {
  autopilot: {
    preset: 'autopilot',
    permissionTier: 'turbo',
    defaultTriageTrack: 'standard',
    autoAdvanceTriage: true,
    autoAdvancePlan: true,
    autoAdvanceDelivery: true,
    autoApproveNonCommandGhost: true,
    maxAutoGhosts: 6,
    maxParallelSlots: 3,
    requireDualAudit: true,
    maxRetryLoops: 3,
    maxDiscussionRounds: 3,
    maxProposalRevisions: 2,
    maxLocalPrdEdits: 5,
    budgetUsdLimit: 25,
    maxOvernightHours: 8,
  },
  guided: {
    preset: 'guided',
    permissionTier: 'supervised',
    defaultTriageTrack: 'standard',
    autoAdvanceTriage: false,
    autoAdvancePlan: false,
    autoAdvanceDelivery: false,
    autoApproveNonCommandGhost: false,
    maxAutoGhosts: 0,
    maxParallelSlots: 3,
    requireDualAudit: true,
    maxRetryLoops: 3,
    maxDiscussionRounds: 3,
    maxProposalRevisions: 3,
    maxLocalPrdEdits: 5,
    budgetUsdLimit: 25,
    maxOvernightHours: 8,
  },
  strict_audit: {
    preset: 'strict_audit',
    permissionTier: 'strict',
    defaultTriageTrack: 'full_hama',
    autoAdvanceTriage: false,
    autoAdvancePlan: false,
    autoAdvanceDelivery: false,
    autoApproveNonCommandGhost: false,
    maxAutoGhosts: 0,
    maxParallelSlots: 2,
    requireDualAudit: true,
    maxRetryLoops: 3,
    maxDiscussionRounds: 4,
    maxProposalRevisions: 3,
    maxLocalPrdEdits: 5,
    budgetUsdLimit: 40,
    maxOvernightHours: 12,
  },
};

export interface ControlSettingDescriptor {
  readonly key: string;
  readonly group: 'autonomy' | 'requirements' | 'execution' | 'safety';
  readonly label: string;
  readonly plainExplanation: string;
  readonly runtimeEffect: string;
  readonly riskLevel: 'low' | 'medium' | 'high';
  readonly defaultByPreset: Readonly<
    Record<IntentPresetId, string | number | boolean>
  >;
  readonly editableWhileRunning: boolean;
}

export const CONTROL_SCHEMA_REGISTRY: readonly ControlSettingDescriptor[] = [
  {
    key: 'preset',
    group: 'autonomy',
    label: 'Autonomy Preset',
    plainExplanation:
      'Controls how often ForgeOps pauses for human sign-off versus progressing autonomously through verified gates.',
    runtimeEffect:
      'Switching mid-run affects future gates and parallel waves only; open human gates are never auto-approved.',
    riskLevel: 'medium',
    defaultByPreset: {
      autopilot: 'autopilot',
      guided: 'guided',
      strict_audit: 'strict_audit',
    },
    editableWhileRunning: true,
  },
  {
    key: 'executionMode',
    group: 'safety',
    label: 'Execution Mode',
    plainExplanation:
      'live executes real models/CLIs and fails closed on missing keys; simulation uses deterministic offline responders.',
    runtimeEffect:
      'Immutable once a Mission starts; live and simulation memory namespaces are strictly isolated.',
    riskLevel: 'high',
    defaultByPreset: {
      autopilot: 'live',
      guided: 'live',
      strict_audit: 'live',
    },
    editableWhileRunning: false,
  },
  {
    key: 'triageTrack',
    group: 'requirements',
    label: 'Requirements Triage Track',
    plainExplanation:
      'express handles clear single-repo changes quickly; standard runs multi-role review; full_hama runs the 7-stage HAMA-Loop.',
    runtimeEffect:
      'Auto-escalates pre-baseline on cross-repo or sensitive domains; frozen baselines evolve via v1->v2 only.',
    riskLevel: 'medium',
    defaultByPreset: {
      autopilot: 'standard',
      guided: 'standard',
      strict_audit: 'full_hama',
    },
    editableWhileRunning: false,
  },
  {
    key: 'budgetUsdLimit',
    group: 'execution',
    label: 'USD Budget Ceiling',
    plainExplanation:
      'Maximum cumulative spend allowed across all HAMA and build model calls in this Mission.',
    runtimeEffect:
      'Pre-flight circuit breaker pauses the Mission cleanly before dispatching waves that exceed this ceiling.',
    riskLevel: 'medium',
    defaultByPreset: {
      autopilot: 25,
      guided: 25,
      strict_audit: 40,
    },
    editableWhileRunning: true,
  },
  {
    key: 'maxOvernightHours',
    group: 'execution',
    label: 'Max Overnight Window (Hours)',
    plainExplanation:
      'Maximum wall-clock runtime per continuous execution session before pausing for human review.',
    runtimeEffect:
      'Prevents runaway unattended loops; Mission state and checkpoints remain preserved on pause.',
    riskLevel: 'low',
    defaultByPreset: {
      autopilot: 8,
      guided: 8,
      strict_audit: 12,
    },
    editableWhileRunning: true,
  },
  {
    key: 'maxParallelSlots',
    group: 'execution',
    label: 'Parallel Worker Concurrency',
    plainExplanation:
      'Maximum concurrent non-overlapping task slices or independent HAMA issue discussions.',
    runtimeEffect:
      'Capped by ResourceSlotBroker while always reserving 1 dedicated high-priority slot for human interactions.',
    riskLevel: 'low',
    defaultByPreset: {
      autopilot: 3,
      guided: 3,
      strict_audit: 2,
    },
    editableWhileRunning: true,
  },
  {
    key: 'maxRetryLoops',
    group: 'safety',
    label: 'Bounded Phase Rewind Budget',
    plainExplanation:
      'Maximum automated Restore -> Checkpoint rewinds allowed per phase gate before escalating to a human.',
    runtimeEffect:
      'Stops infinite failing agent loops and preserves every failed state under refs/forgeops-backup.',
    riskLevel: 'low',
    defaultByPreset: {
      autopilot: 3,
      guided: 3,
      strict_audit: 3,
    },
    editableWhileRunning: true,
  },
  {
    key: 'maxProposalRevisions',
    group: 'requirements',
    label: 'Proposal Rework Budget (Loop B/Approval)',
    plainExplanation:
      'Maximum major proposal-level rework cycles allowed before escalating blocked requirements to humans.',
    runtimeEffect:
      'Counted separately from local PRD text/AC polish edits so minor edits never exhaust architecture budget.',
    riskLevel: 'low',
    defaultByPreset: {
      autopilot: 2,
      guided: 3,
      strict_audit: 3,
    },
    editableWhileRunning: true,
  },
];

export function resolvePresetPolicy(
  preset: IntentPresetId,
  overrides?: {
    readonly budgetUsdLimit?: number;
    readonly maxOvernightHours?: number;
    readonly maxParallelSlots?: number;
    readonly maxDiscussionRounds?: number;
    readonly maxRevisions?: number;
    readonly maxLocalPrdEdits?: number;
  },
): ResolvedPresetPolicy {
  const base = INTENT_PRESETS[preset];
  return {
    ...base,
    budgetUsdLimit: overrides?.budgetUsdLimit ?? base.budgetUsdLimit,
    maxOvernightHours: overrides?.maxOvernightHours ?? base.maxOvernightHours,
    maxParallelSlots: overrides?.maxParallelSlots ?? base.maxParallelSlots,
    maxDiscussionRounds:
      overrides?.maxDiscussionRounds ?? base.maxDiscussionRounds,
    maxProposalRevisions: overrides?.maxRevisions ?? base.maxProposalRevisions,
    maxLocalPrdEdits: overrides?.maxLocalPrdEdits ?? base.maxLocalPrdEdits,
  };
}

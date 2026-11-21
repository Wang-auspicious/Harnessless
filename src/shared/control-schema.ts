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
    label: '自治把关档位',
    plainExplanation:
      '控制工厂何时自动推进、何时停下来等你拍板。选择「关键把关」仅在定方案和最终交付前请你确认；「自动推进」尽可能少打扰。',
    runtimeEffect:
      '运行中随时可切档，但只会影响后续节点，绝不会把已经卡住等你确认的问题偷偷放行。',
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
    label: '执行模式（在线 / 离线演练）',
    plainExplanation:
      '「在线真实跑 (live)」会调用真实的模型和本地命令行验证；「离线演练 (simulation)」不花预算、不改真实代码记忆，用于流程试跑。',
    runtimeEffect:
      '任务创建后锁定不可切换；在线记忆与演练记忆彻底分库隔离，互不污染。',
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
    label: '需求梳理深度（按改动影响自动分流）',
    plainExplanation:
      '系统先探路再分流：单仓小修走「快速直通」，常规需求走「标准核对」，跨仓或涉及鉴权/账务/表结构走「严格多角色评审」。',
    runtimeEffect:
      '发现风险升高时会自动升级流程；需求定稿后如需大改会升版 v1 -> v2，保留修改前后影响清单。',
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
    label: '单任务预算上限（美元）',
    plainExplanation:
      '这次需求从方案沟通到编码、复核允许花掉的总费用封顶，防止异常长循环烧超费用。',
    runtimeEffect:
      '并发启动下一波任务前预先核扣，一旦将超预算立刻暂停并保存全部断点，等你确认后再决定是否追加。',
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
    label: '最长连续无人值守时长（小时）',
    plainExplanation:
      '允许工厂连续自动跑多久；超时会自动停在当前安全断点，等你第二天看一眼再接着跑。',
    runtimeEffect: '防止通宵跑偏失控，暂停时保留所有 Git 检查点和任务上下文。',
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
    label: '同时并行任务数',
    plainExplanation:
      '改动互不冲突的子任务可以同时开几个一起写，始终保留 1 个高优通道留给你随时插话。',
    runtimeEffect:
      '系统会自动把会互相引用的文件改动错开波次，避免改完各自绿灯、合到一起报错。',
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
    label: '单步卡死最多自动重试几次',
    plainExplanation:
      '某一步校验失败后最多自动回退重写几次；如果连续两次报完全一样的错或来回反复改，会提前暂停叫你接管。',
    runtimeEffect:
      '每次回退前都会把失败现场备份到 Git 安全分支，不会丢代码；达到上限或识别到死循环就请你用 IDE 接手。',
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
    label: '方案大改返工次数上限',
    plainExplanation:
      '允许围绕整个技术方案推翻重来几次；如果是微调几句需求文字（小修），不会消耗这个次数。',
    runtimeEffect:
      '避免方案本身有根本分歧时在文档阶段无限打转，超限后直接让你拍板定方向。',
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

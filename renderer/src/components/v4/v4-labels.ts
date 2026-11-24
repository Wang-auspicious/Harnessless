import type {KernelId, SessionStage, TaskNodeRole} from '../../api/v4-types.ts';

export const KERNEL_LABELS: Record<KernelId, string> = {
  master: 'Master Agent',
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode',
  pi: 'Pi Agent',
  'native-api': 'Native API',
};

export const ALL_KERNELS: readonly KernelId[] = [
  'codex',
  'claude-code',
  'gemini-cli',
  'opencode',
  'pi',
  'native-api',
];

export const ROLE_LABELS: Record<TaskNodeRole, string> = {
  architect: '架构 Architect',
  coder: '编码 Coder',
  tester: '测试 Tester',
  reviewer: '审校 Reviewer',
  steward: '管家 Steward',
};

export const STAGE_META: Record<
  SessionStage,
  {
    readonly label: string;
    readonly tone: 'clay' | 'success' | 'warning' | 'neutral';
  }
> = {
  intent: {label: '需求构思', tone: 'neutral'},
  spec: {label: 'Spec 共识', tone: 'warning'},
  tasks: {label: '任务拆解', tone: 'clay'},
  executing: {label: '并行执行中', tone: 'clay'},
  review: {label: 'Ship 审校', tone: 'warning'},
  delivered: {label: '已交付', tone: 'success'},
};

export function kernelLabel(id: KernelId): string {
  return KERNEL_LABELS[id] ?? id;
}

export function sessionStatusDot(
  stage: SessionStage,
  hasFailedTask?: boolean,
): 'active' | 'done' | 'awaiting' | 'failed' {
  if (hasFailedTask) {
    return 'failed';
  }
  if (stage === 'delivered') {
    return 'done';
  }
  if (stage === 'spec' || stage === 'review') {
    return 'awaiting';
  }
  return 'active';
}

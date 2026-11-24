import type {KernelId, SessionStage, TaskNodeRole} from '../../api/v4-types.ts';

export const KERNEL_LABELS: Record<KernelId, string> = {
  master: '统筹协调官',
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode',
  pi: 'Pi CLI',
  'native-api': '直连模型引擎',
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
  architect: '系统架构师',
  coder: '开发工程师',
  tester: '质量验证官',
  reviewer: '独立审校官',
  steward: '工程保障官',
};

export const STAGE_META: Record<
  SessionStage,
  {
    readonly label: string;
    readonly tone: 'clay' | 'success' | 'warning' | 'neutral';
  }
> = {
  intent: {label: '需求协同', tone: 'neutral'},
  spec: {label: 'Spec 共识', tone: 'neutral'},
  tasks: {label: '任务拆解', tone: 'neutral'},
  executing: {label: '并行开发中', tone: 'neutral'},
  review: {label: '交叉审校中', tone: 'warning'},
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

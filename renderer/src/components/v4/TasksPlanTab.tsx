import {useState, type ReactElement} from 'react';
import type {
  DecomposedTaskNode,
  KernelId,
  TaskDecompositionPlan,
  TaskMutation,
  TaskNodeRole,
} from '../../api/v4-types.ts';
import {ALL_KERNELS, ROLE_LABELS, kernelLabel} from './v4-labels.ts';

export interface TasksPlanTabProps {
  readonly plan: TaskDecompositionPlan | null;
  readonly busy: boolean;
  readonly onDecompose: (force?: boolean) => Promise<void>;
  readonly onMutate: (mutation: TaskMutation) => Promise<void>;
  readonly onExecute: (opts?: {
    readonly resumeOnly?: boolean;
    readonly taskIds?: readonly string[];
  }) => Promise<void>;
}

const ROLES: readonly TaskNodeRole[] = [
  'architect',
  'coder',
  'tester',
  'reviewer',
  'steward',
];

export function TasksPlanTab({
  plan,
  busy,
  onDecompose,
  onMutate,
  onExecute,
}: TasksPlanTabProps): ReactElement {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newRole, setNewRole] = useState<TaskNodeRole>('coder');
  const [newKernel, setNewKernel] = useState<KernelId>('codex');
  const [newScope, setNewScope] = useState('src/feature.ts');

  const handleAddTask = async (): Promise<void> => {
    const title = newTitle.trim();
    if (!title) {
      return;
    }
    const scopes = newScope
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    await onMutate({
      op: 'add_task',
      title,
      description: newDesc.trim() || title,
      role: newRole,
      assignedKernel: newKernel,
      dependsOn: [],
      fileScope: scopes.length > 0 ? scopes : ['src/index.ts'],
      acceptanceChecks: ['npm test'],
    });
    setNewTitle('');
    setNewDesc('');
    setShowAddForm(false);
  };

  const handleSplitTask = async (task: DecomposedTaskNode): Promise<void> => {
    const baseScope = task.fileScope[0] ?? 'src/module.ts';
    const secondScope =
      task.fileScope[1] ?? baseScope.replace(/(\.[^.]+)$/, '.part2$1');
    await onMutate({
      op: 'split',
      taskId: task.id,
      parts: [
        {
          title: `${task.title} · Part A (核心逻辑)`,
          description: `${task.description} — 核心接口与实现`,
          role: task.role,
          assignedKernel: task.assignedKernel,
          fileScope: [baseScope],
          acceptanceChecks: task.acceptanceChecks,
        },
        {
          title: `${task.title} · Part B (边界与测试)`,
          description: `${task.description} — 边界校验与单元测试`,
          role: 'tester',
          assignedKernel:
            task.assignedKernel === 'codex' ? 'claude-code' : 'codex',
          fileScope: [secondScope],
          acceptanceChecks: task.acceptanceChecks,
        },
      ],
    });
  };

  const tasks = plan?.tasks ?? [];
  const waves = Array.from(new Set(tasks.map(t => t.waveIndex))).sort(
    (a, b) => a - b,
  );
  const hasPausedOrFailed = tasks.some(
    t => t.status === 'failed' || t.status === 'paused',
  );

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
      <div className="cds-toolbar">
        <div>
          <h3 className="cds-card-title">任务拆解与多内核编排</h3>
          <p className="cds-card-sub">
            为每个子任务指定文件域 Scope 与原生 Agent 内核，按依赖波次在独立 Git
            Worktree 中并行执行。
          </p>
        </div>
        <div className="cds-toolbar-group">
          <button
            type="button"
            className="cds-btn is-sm"
            disabled={busy}
            onClick={() => void onDecompose(Boolean(plan))}
          >
            {plan ? '重新拆解' : '智能拆解任务'}
          </button>
          <button
            type="button"
            className="cds-btn is-sm"
            disabled={busy || !plan}
            onClick={() => setShowAddForm(prev => !prev)}
          >
            + 新增子任务
          </button>
          {hasPausedOrFailed ? (
            <button
              type="button"
              className="cds-btn is-sm"
              disabled={busy}
              onClick={() => void onExecute({resumeOnly: true})}
            >
              断点续跑
            </button>
          ) : null}
          <button
            type="button"
            className="cds-btn is-sm is-clay"
            disabled={busy || tasks.length === 0}
            onClick={() => void onExecute({resumeOnly: false})}
          >
            并行启动全部波次
          </button>
        </div>
      </div>

      {showAddForm ? (
        <div className="cds-card is-subtle">
          <div className="cds-card-head">
            <strong style={{fontSize: 12.5}}>新增子任务</strong>
            <button
              type="button"
              className="cds-btn is-sm"
              onClick={() => setShowAddForm(false)}
            >
              取消
            </button>
          </div>
          <div
            style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}
          >
            <input
              type="text"
              className="cds-input"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="子任务标题"
            />
            <input
              type="text"
              className="cds-input"
              value={newScope}
              onChange={e => setNewScope(e.target.value)}
              placeholder="文件域 Scope (逗号分隔)"
            />
            <select
              className="cds-select"
              value={newRole}
              onChange={e => setNewRole(e.target.value as TaskNodeRole)}
            >
              {ROLES.map(r => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <select
              className="cds-select"
              value={newKernel}
              onChange={e => setNewKernel(e.target.value as KernelId)}
            >
              {ALL_KERNELS.map(k => (
                <option key={k} value={k}>
                  {kernelLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <input
            type="text"
            className="cds-input"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="任务描述与验收边界..."
          />
          <div style={{display: 'flex', justifyContent: 'flex-end'}}>
            <button
              type="button"
              className="cds-btn is-sm is-primary"
              disabled={busy || !newTitle.trim()}
              onClick={() => void handleAddTask()}
            >
              加入计划
            </button>
          </div>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <div className="cds-empty">
          尚未生成任务计划。请点击「智能拆解任务」或先在对话区冻结 Spec IR。
        </div>
      ) : (
        waves.map(wave => (
          <div
            key={wave}
            style={{display: 'flex', flexDirection: 'column', gap: 8}}
          >
            <div className="cds-section-label" style={{padding: '2px 2px 0'}}>
              <span>Wave {wave + 1} · 并行波次</span>
              <span>
                {tasks.filter(t => t.waveIndex === wave).length} 个任务
              </span>
            </div>

            {tasks
              .filter(t => t.waveIndex === wave)
              .map(task => {
                const statusTone =
                  task.status === 'completed'
                    ? 'is-success'
                    : task.status === 'running'
                      ? 'is-clay'
                      : task.status === 'failed'
                        ? 'is-danger'
                        : '';
                return (
                  <div
                    key={task.id}
                    className={`cds-task-card ${task.status === 'running' ? 'is-running' : ''} ${task.status === 'failed' ? 'is-failed' : ''}`}
                  >
                    <div className="cds-card-head">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 7,
                          minWidth: 0,
                        }}
                      >
                        <strong style={{fontSize: 13}}>{task.title}</strong>
                        <span className={`cds-stage-pill ${statusTone}`}>
                          {task.status}
                        </span>
                        <span className="cds-stage-pill">
                          {ROLE_LABELS[task.role]}
                        </span>
                      </div>

                      <div className="cds-toolbar-group">
                        <select
                          aria-label={`选择 ${task.title} 的原生内核`}
                          className="cds-select"
                          disabled={busy}
                          value={task.assignedKernel}
                          onChange={e =>
                            void onMutate({
                              op: 'reassign_kernel',
                              taskId: task.id,
                              assignedKernel: e.target.value as KernelId,
                            })
                          }
                        >
                          {ALL_KERNELS.map(k => (
                            <option key={k} value={k}>
                              {kernelLabel(k)}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          className="cds-btn is-sm"
                          disabled={busy}
                          onClick={() => void handleSplitTask(task)}
                        >
                          拆分任务
                        </button>

                        <button
                          type="button"
                          className="cds-btn is-sm"
                          disabled={busy}
                          onClick={() =>
                            void onMutate({op: 'remove_task', taskId: task.id})
                          }
                        >
                          移除
                        </button>
                      </div>
                    </div>

                    <div
                      style={{fontSize: 12, color: 'var(--cds-text-secondary)'}}
                    >
                      {task.description}
                    </div>

                    <div className="cds-task-meta-row">
                      <span>文件域:</span>
                      {task.fileScope.map(f => (
                        <span key={f} className="cds-mono-chip">
                          {f}
                        </span>
                      ))}
                      {task.dependsOn.length > 0 ? (
                        <span>依赖前置: {task.dependsOn.join(', ')}</span>
                      ) : (
                        <span>无前置依赖</span>
                      )}
                    </div>

                    <div className="cds-task-meta-row">
                      {task.worktreeBranch ? (
                        <span className="cds-mono-chip">
                          branch: {task.worktreeBranch}
                        </span>
                      ) : null}
                      {task.diffStats.added > 0 ||
                      task.diffStats.removed > 0 ||
                      task.diffStats.filesChanged > 0 ? (
                        <span className="cds-diff-stat">
                          <span className="cds-diff-add">
                            +{task.diffStats.added}
                          </span>
                          <span className="cds-diff-del">
                            {'\u2212'}
                            {task.diffStats.removed}
                          </span>
                          <span style={{color: 'var(--cds-text-muted)'}}>
                            ({task.diffStats.filesChanged} files)
                          </span>
                        </span>
                      ) : null}
                      {task.outputSummary ? (
                        <span style={{color: 'var(--cds-text-secondary)'}}>
                          · {task.outputSummary}
                        </span>
                      ) : null}
                      {task.error ? (
                        <span style={{color: 'var(--cds-danger)'}}>
                          错误: {task.error}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
          </div>
        ))
      )}
    </div>
  );
}

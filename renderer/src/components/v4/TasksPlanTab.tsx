import {useState, type ReactElement} from 'react';
import type {
  DecomposedTaskNode,
  KernelId,
  TaskDecompositionPlan,
  TaskMutation,
  TaskNodeRole,
} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';
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
    <div className="sd-pane">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>任务拆解与多内核编排</h3>
          <p>
            为每个子任务指派文件域 Scope 与原生 Agent 内核，在独立 Git Worktree
            按波次并行执行。
          </p>
        </div>

        <div className="sd-toolbar-row">
          <button
            type="button"
            className="sd-btn"
            disabled={busy}
            onClick={() => void onDecompose(Boolean(plan))}
          >
            <CdsIcon name="ArrowClockwise" size="xs" />
            <span>{plan ? '重新拆解' : '智能拆解'}</span>
          </button>
          <button
            type="button"
            className="sd-btn"
            disabled={busy || !plan}
            onClick={() => setShowAddForm(prev => !prev)}
          >
            <CdsIcon name="Add" size="xs" />
            <span>新增子任务</span>
          </button>
          {hasPausedOrFailed ? (
            <button
              type="button"
              className="sd-btn"
              disabled={busy}
              onClick={() => void onExecute({resumeOnly: true})}
            >
              <CdsIcon name="Play" size="xs" />
              <span>断点续跑</span>
            </button>
          ) : null}
          <button
            type="button"
            className="sd-btn is-primary"
            disabled={busy || tasks.length === 0}
            onClick={() => void onExecute({resumeOnly: false})}
          >
            <CdsIcon name="Play" size="xs" />
            <span>并行启动全部波次</span>
          </button>
        </div>
      </div>

      {showAddForm ? (
        <div className="sd-card">
          <div className="sd-card-head">
            <span>新增 WBS 子任务</span>
            <button
              type="button"
              className="sd-btn"
              onClick={() => setShowAddForm(false)}
            >
              取消
            </button>
          </div>
          <div
            className="sd-card-body"
            style={{display: 'flex', flexDirection: 'column', gap: 8}}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 8,
              }}
            >
              <input
                type="text"
                className="sd-input"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="子任务标题"
              />
              <input
                type="text"
                className="sd-input"
                value={newScope}
                onChange={e => setNewScope(e.target.value)}
                placeholder="文件域 Scope (逗号分隔)"
              />
              <select
                className="sd-select"
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
                className="sd-select"
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
              className="sd-input"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="任务描述与验收边界…"
            />
            <div style={{display: 'flex', justifyContent: 'flex-end'}}>
              <button
                type="button"
                className="sd-btn is-ink"
                disabled={busy || !newTitle.trim()}
                onClick={() => void handleAddTask()}
              >
                加入计划
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <p className="mp-inspector-empty">
          尚未生成任务计划。请点击「智能拆解」或在聊天中执行 `/decompose`。
        </p>
      ) : (
        waves.map(wave => {
          const waveTasks = tasks.filter(t => t.waveIndex === wave);
          return (
            <div key={wave} className="sd-card">
              <div className="sd-card-head">
                <span>Wave {wave + 1} · 并行波次</span>
                <span className="sd-pill">{waveTasks.length} tasks</span>
              </div>

              <div>
                {waveTasks.map(task => {
                  const tone =
                    task.status === 'completed'
                      ? 'is-success'
                      : task.status === 'running'
                        ? 'is-clay'
                        : task.status === 'failed'
                          ? 'is-danger'
                          : '';
                  return (
                    <div key={task.id} className="sd-wbs-row">
                      <div className="sd-wbs-top">
                        <div className="sd-wbs-title">
                          <span
                            className="status-dot"
                            data-status={
                              task.status === 'completed'
                                ? 'ready'
                                : task.status === 'running'
                                  ? 'running'
                                  : task.status === 'failed'
                                    ? 'error'
                                    : 'awaiting'
                            }
                          />
                          <span>{task.title}</span>
                          <span className={`sd-pill ${tone}`}>
                            {task.status}
                          </span>
                          <span className="sd-pill">
                            {ROLE_LABELS[task.role]}
                          </span>
                        </div>

                        <div className="sd-toolbar-row">
                          <select
                            aria-label={`选择 ${task.title} 的原生内核`}
                            className="sd-select"
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
                            className="sd-btn"
                            disabled={busy}
                            onClick={() => void handleSplitTask(task)}
                          >
                            拆分
                          </button>
                          <button
                            type="button"
                            className="sd-btn"
                            disabled={busy}
                            onClick={() =>
                              void onMutate({
                                op: 'remove_task',
                                taskId: task.id,
                              })
                            }
                          >
                            移除
                          </button>
                        </div>
                      </div>

                      <p className="sd-wbs-desc">{task.description}</p>

                      <div className="sd-wbs-meta">
                        <div className="sd-toolbar-row">
                          {task.fileScope.map(f => (
                            <span
                              key={f}
                              className="sd-pill"
                              style={{fontFamily: 'var(--mp-font-mono)'}}
                            >
                              {f}
                            </span>
                          ))}
                          {task.worktreeBranch ? (
                            <span
                              className="sd-pill"
                              style={{fontFamily: 'var(--mp-font-mono)'}}
                            >
                              <CdsIcon name="GitBranch" size="xs" />
                              <span>{task.worktreeBranch}</span>
                            </span>
                          ) : null}
                        </div>

                        <div className="sd-toolbar-row">
                          {task.diffStats.added > 0 ||
                          task.diffStats.removed > 0 ? (
                            <span
                              style={{
                                fontSize: 11.5,
                                fontFamily: 'var(--mp-font-mono)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              <span style={{color: 'var(--mp-git-added)'}}>
                                +{task.diffStats.added}
                              </span>{' '}
                              <span style={{color: 'var(--mp-git-removed)'}}>
                                {'\u2212'}
                                {task.diffStats.removed}
                              </span>
                            </span>
                          ) : null}
                          {task.error ? (
                            <span
                              style={{
                                fontSize: 11.5,
                                color: 'var(--mp-danger)',
                              }}
                            >
                              {task.error}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

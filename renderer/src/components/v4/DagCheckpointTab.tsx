import type {ReactElement} from 'react';
import type {TaskDecompositionPlan} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';
import {kernelLabel} from './v4-labels.ts';

export interface DagCheckpointTabProps {
  readonly plan: TaskDecompositionPlan | null;
  readonly busy: boolean;
  readonly onRetryTask: (taskId: string) => Promise<void>;
}

export function DagCheckpointTab({
  plan,
  busy,
  onRetryTask,
}: DagCheckpointTabProps): ReactElement {
  const tasks = plan?.tasks ?? [];
  const waves = Array.from(new Set(tasks.map(t => t.waveIndex))).sort(
    (a, b) => a - b,
  );

  return (
    <div className="sd-pane">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>断点检查点与执行槽位 (Checkpoint DAG)</h3>
          <p>仅用于异常回溯、Git Tree SHA 校验与失败任务单点续跑。</p>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="mp-inspector-empty">
          暂无活跃执行检查点。拆解并运行任务后，各波次 Checkpoint 将记录于此。
        </p>
      ) : (
        waves.map(wave => {
          const waveTasks = tasks.filter(t => t.waveIndex === wave);
          const doneCount = waveTasks.filter(
            t => t.status === 'completed',
          ).length;
          return (
            <div key={wave} className="sd-card">
              <div className="sd-card-head">
                <span>Wave {wave + 1} 检查点层</span>
                <span className="sd-pill">
                  {doneCount}/{waveTasks.length} completed
                </span>
              </div>

              <div
                className="sd-card-body"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: 10,
                }}
              >
                {waveTasks.map(task => {
                  const tone =
                    task.status === 'completed'
                      ? 'is-success'
                      : task.status === 'failed'
                        ? 'is-danger'
                        : task.status === 'running'
                          ? 'is-clay'
                          : '';
                  return (
                    <div key={task.id} className="sd-card">
                      <div className="sd-card-head">
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {task.title}
                        </span>
                        <span className={`sd-pill ${tone}`}>{task.status}</span>
                      </div>
                      <div
                        className="sd-card-body"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          fontSize: 12,
                        }}
                      >
                        <div className="sd-toolbar-row">
                          <span className="sd-pill">
                            {kernelLabel(task.assignedKernel)}
                          </span>
                          {task.checkpointId ? (
                            <span
                              className="sd-pill"
                              style={{fontFamily: 'var(--mp-font-mono)'}}
                            >
                              {task.checkpointId.slice(0, 10)}
                            </span>
                          ) : null}
                        </div>

                        {task.beforeTreeSha || task.afterTreeSha ? (
                          <div
                            style={{
                              fontFamily: 'var(--mp-font-mono)',
                              fontSize: 11,
                              color: 'var(--mp-text-muted)',
                            }}
                          >
                            tree:{' '}
                            {(task.beforeTreeSha ?? '--------').slice(0, 7)} →{' '}
                            {(task.afterTreeSha ?? '--------').slice(0, 7)}
                          </div>
                        ) : null}

                        {task.dependsOn.length > 0 ? (
                          <div
                            style={{
                              fontSize: 11.5,
                              color: 'var(--mp-text-muted)',
                            }}
                          >
                            上游依赖: {task.dependsOn.join(', ')}
                          </div>
                        ) : null}

                        {task.status === 'failed' ||
                        task.status === 'paused' ? (
                          <button
                            type="button"
                            className="sd-btn is-primary"
                            disabled={busy}
                            onClick={() => void onRetryTask(task.id)}
                          >
                            <CdsIcon name="ArrowClockwise" size="xs" />
                            <span>从此断点单点重跑</span>
                          </button>
                        ) : null}
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

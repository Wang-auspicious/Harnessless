import type {ReactElement} from 'react';
import type {TaskDecompositionPlan} from '../../api/v4-types.ts';
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
    <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
      <div>
        <h3 className="cds-card-title">
          断点检查点与执行槽位 (Checkpoint DAG)
        </h3>
        <p className="cds-card-sub">
          仅用于异常回溯、Git Tree SHA 校验与失败任务单点续跑。
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="cds-empty">
          暂无活跃执行检查点。拆解并运行任务后，每个波次槽位的 Checkpoint
          将记录在此。
        </div>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          {waves.map(wave => (
            <div key={wave} className="cds-card is-subtle">
              <div className="cds-card-head">
                <strong style={{fontSize: 12}}>Wave {wave + 1} 检查点层</strong>
                <span className="cds-stage-pill">
                  {
                    tasks.filter(
                      t => t.waveIndex === wave && t.status === 'completed',
                    ).length
                  }
                  /{tasks.filter(t => t.waveIndex === wave).length} 完成
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 8,
                }}
              >
                {tasks
                  .filter(t => t.waveIndex === wave)
                  .map(task => (
                    <div key={task.id} className="cds-task-card">
                      <div className="cds-card-head">
                        <strong style={{fontSize: 12}}>{task.title}</strong>
                        <span
                          className={`cds-stage-pill ${task.status === 'completed' ? 'is-success' : task.status === 'failed' ? 'is-danger' : task.status === 'running' ? 'is-clay' : ''}`}
                        >
                          {task.status}
                        </span>
                      </div>
                      <div className="cds-task-meta-row">
                        <span className="cds-agent-pill">
                          {kernelLabel(task.assignedKernel)}
                        </span>
                        {task.checkpointId ? (
                          <span className="cds-mono-chip">
                            ckpt: {task.checkpointId.slice(0, 10)}
                          </span>
                        ) : null}
                      </div>
                      {task.beforeTreeSha || task.afterTreeSha ? (
                        <div className="cds-mono-chip">
                          tree: {(task.beforeTreeSha ?? '--------').slice(0, 7)}{' '}
                          → {(task.afterTreeSha ?? '--------').slice(0, 7)}
                        </div>
                      ) : null}
                      {task.dependsOn.length > 0 ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--cds-text-muted)',
                          }}
                        >
                          上游依赖: {task.dependsOn.join(', ')}
                        </div>
                      ) : null}
                      {task.status === 'failed' || task.status === 'paused' ? (
                        <button
                          type="button"
                          className="cds-btn is-sm is-clay"
                          disabled={busy}
                          onClick={() => void onRetryTask(task.id)}
                        >
                          从此断点单点重跑
                        </button>
                      ) : null}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

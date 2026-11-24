import type {ReactElement} from 'react';
import type {
  BoardSceneDoc,
  KernelId,
  NativeKernelCard,
  TaskMutation,
  TaskNodeRole,
  V4SessionDetail,
  WorkspaceTabId,
} from '../../api/v4-types.ts';
import {BoardSpecTab} from './BoardSpecTab.tsx';
import {CodeDiffTab} from './CodeDiffTab.tsx';
import {DagCheckpointTab} from './DagCheckpointTab.tsx';
import {MountedKernelsTab} from './MountedKernelsTab.tsx';
import {TasksPlanTab} from './TasksPlanTab.tsx';
import {VerifyHtmlTab} from './VerifyHtmlTab.tsx';

export interface RightWorkspacePaneProps {
  readonly widthPx: number;
  readonly activeTab: WorkspaceTabId;
  readonly onSelectTab: (tab: WorkspaceTabId) => void;
  readonly detail: V4SessionDetail | null;
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly selfApprovalBlockedMsg: string | null;
  readonly busy: boolean;
  readonly onDecompose: (force?: boolean) => Promise<void>;
  readonly onMutateTasks: (mutation: TaskMutation) => Promise<void>;
  readonly onExecuteTasks: (opts?: {
    readonly resumeOnly?: boolean;
    readonly taskIds?: readonly string[];
  }) => Promise<void>;
  readonly onSaveBoard: (nextBoard: BoardSceneDoc) => Promise<void>;
  readonly onCreatePin: (input: {
    readonly surfaceType: 'board' | 'spec_ir' | 'code_diff' | 'html_verify';
    readonly anchorJson: string;
    readonly specNodeId?: string;
    readonly promptText: string;
  }) => Promise<void>;
  readonly onResolvePin: (pinId: string, askAgent: boolean) => Promise<void>;
  readonly onRunQuantize: () => Promise<void>;
  readonly onRunShip: (opts: {
    readonly reviewDepth: 'fast' | 'standard' | 'deep';
    readonly reviewerKernel: KernelId;
    readonly policyMode: 'shadow' | 'enforced';
  }) => Promise<void>;
  readonly onApproveAndDeliver: (reviewId: string) => Promise<void>;
  readonly onRejectAndPin: (reviewId: string, comment: string) => Promise<void>;
  readonly onProbeKernels: () => Promise<void>;
  readonly onUpdateRouting: (
    patch: Partial<Record<TaskNodeRole, KernelId>>,
  ) => Promise<void>;
  readonly onPostCollab: (input: {
    readonly fromKernel: KernelId;
    readonly toKernel: KernelId;
    readonly kind: string;
    readonly audienceScope: string;
    readonly content: string;
  }) => Promise<void>;
}

const EMPTY_BOARD: BoardSceneDoc = {nodes: [], edges: [], revision: 0};

export function RightWorkspacePane({
  widthPx,
  activeTab,
  onSelectTab,
  detail,
  kernels,
  roleRouting,
  selfApprovalBlockedMsg,
  busy,
  onDecompose,
  onMutateTasks,
  onExecuteTasks,
  onSaveBoard,
  onCreatePin,
  onResolvePin,
  onRunQuantize,
  onRunShip,
  onApproveAndDeliver,
  onRejectAndPin,
  onProbeKernels,
  onUpdateRouting,
  onPostCollab,
}: RightWorkspacePaneProps): ReactElement {
  const taskCount = detail?.activePlan?.tasks.length ?? 0;
  const diffCount = detail?.diffs.length ?? 0;
  const pinCount =
    detail?.pins.filter(p => p.status !== 'resolved').length ?? 0;
  const readyKernelCount = kernels.filter(
    k => k.status === 'ready' || k.status === 'builtin',
  ).length;

  const tabs: readonly {
    readonly id: WorkspaceTabId;
    readonly label: string;
    readonly badge?: number;
  }[] = [
    {id: 'tasks', label: '任务拆解', badge: taskCount || undefined},
    {id: 'board', label: '白板 × Spec', badge: pinCount || undefined},
    {id: 'code', label: '代码 & Diff', badge: diffCount || undefined},
    {id: 'verify', label: '验收 HTML'},
    {id: 'kernels', label: '原生内核', badge: readyKernelCount || undefined},
    {id: 'dag', label: '断点 DAG'},
  ];

  return (
    <aside
      className="cds-right-pane"
      style={{width: `${widthPx}px`}}
      data-testid="v4-right-workspace"
    >
      <nav className="cds-tabbar" role="tablist" aria-label="右侧协同工作区">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`cds-tab ${activeTab === t.id ? 'is-active' : ''}`}
            onClick={() => onSelectTab(t.id)}
          >
            <span>{t.label}</span>
            {t.badge !== undefined ? (
              <span className="cds-tab-count">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="cds-tab-body">
        {activeTab === 'tasks' ? (
          <TasksPlanTab
            plan={detail?.activePlan ?? null}
            busy={busy}
            onDecompose={onDecompose}
            onMutate={onMutateTasks}
            onExecute={onExecuteTasks}
          />
        ) : null}

        {activeTab === 'board' ? (
          detail ? (
            <BoardSpecTab
              board={detail.board ?? EMPTY_BOARD}
              specIR={detail.specIR}
              quantization={detail.quantization}
              pins={detail.pins}
              busy={busy}
              onSaveBoard={onSaveBoard}
              onCreatePin={input => onCreatePin(input)}
              onResolvePin={onResolvePin}
              onRunQuantize={onRunQuantize}
            />
          ) : (
            <div className="cds-empty">
              打开本地目录或一键跑通示例项目后，即可在此联动编辑架构白板与 Spec
              IR。
            </div>
          )
        ) : null}

        {activeTab === 'code' ? (
          <CodeDiffTab
            sessionId={detail?.session.id ?? null}
            diffs={detail?.diffs ?? []}
            pins={detail?.pins ?? []}
            busy={busy}
            onCreateCodePin={input =>
              onCreatePin({
                surfaceType: 'code_diff',
                anchorJson: JSON.stringify({
                  filePath: input.filePath,
                  line: input.line,
                }),
                promptText: input.promptText,
              })
            }
          />
        ) : null}

        {activeTab === 'verify' ? (
          <VerifyHtmlTab
            latestShip={detail?.latestShip ?? null}
            selfApprovalBlockedMsg={selfApprovalBlockedMsg}
            busy={busy}
            onRunShip={onRunShip}
            onApproveAndDeliver={onApproveAndDeliver}
            onRejectAndPin={onRejectAndPin}
          />
        ) : null}

        {activeTab === 'kernels' ? (
          <MountedKernelsTab
            sessionId={detail?.session.id ?? null}
            kernels={kernels}
            roleRouting={roleRouting}
            collabFeed={detail?.collabFeed ?? []}
            busy={busy}
            onProbeKernels={onProbeKernels}
            onUpdateRouting={onUpdateRouting}
            onPostCollab={onPostCollab}
          />
        ) : null}

        {activeTab === 'dag' ? (
          <DagCheckpointTab
            plan={detail?.activePlan ?? null}
            busy={busy}
            onRetryTask={taskId => onExecuteTasks({taskIds: [taskId]})}
          />
        ) : null}
      </div>
    </aside>
  );
}

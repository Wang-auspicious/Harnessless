import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react';
import type {
  BoardSceneDoc,
  KernelId,
  NativeKernelCard,
  ShipReviewFinding,
  TaskMutation,
  TaskNodeRole,
  V4SessionDetail,
  WorkspaceTabId,
} from '../../api/v4-types.ts';
import {BoardSpecTab} from './BoardSpecTab.tsx';
import {CdsIcon} from './CdsIcon.tsx';
import {CodeDiffTab} from './CodeDiffTab.tsx';
import {DagCheckpointTab} from './DagCheckpointTab.tsx';
import {MountedKernelsTab} from './MountedKernelsTab.tsx';
import {TasksPlanTab} from './TasksPlanTab.tsx';
import {VerifyHtmlTab} from './VerifyHtmlTab.tsx';

export interface RightWorkspacePaneProps {
  readonly isOpen: boolean;
  readonly widthPx: number;
  readonly isDragging: boolean;
  readonly onStartResize: (e: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onClose: () => void;
  readonly activeTab: WorkspaceTabId;
  readonly onSelectTab: (tab: WorkspaceTabId) => void;
  readonly detail: V4SessionDetail | null;
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly theme: 'light' | 'dark';
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
  readonly onSendFindingToTriage?: (finding: ShipReviewFinding) => void;
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
  isOpen,
  widthPx,
  isDragging,
  onStartResize,
  onClose,
  activeTab,
  onSelectTab,
  detail,
  kernels,
  roleRouting,
  theme,
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
  onSendFindingToTriage,
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
  const primaryCoderKernel =
    detail?.activePlan?.tasks.find(t => t.role === 'coder')?.assignedKernel ??
    roleRouting.coder;

  const tabs: readonly {
    readonly id: WorkspaceTabId;
    readonly label: string;
    readonly badge?: number;
  }[] = [
    {id: 'tasks', label: 'Tasks', badge: taskCount || undefined},
    {id: 'board', label: 'Board · Spec', badge: pinCount || undefined},
    {id: 'code', label: 'Diff', badge: diffCount || undefined},
    {id: 'verify', label: 'Verify'},
    {id: 'kernels', label: 'Kernels', badge: readyKernelCount || undefined},
    {id: 'dag', label: 'DAG'},
  ];

  return (
    <aside
      className="mp-inspector"
      id="workspace-inspector"
      hidden={!isOpen}
      style={{'--mp-inspector-width': `${widthPx}px`} as CSSProperties}
      data-testid="v4-right-workspace"
    >
      <div
        className="mp-inspector-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整右侧工作区宽度"
        data-dragging={isDragging ? 'true' : undefined}
        onMouseDown={onStartResize}
      />

      <header className="mp-inspector-header">
        <div
          className="mpw-workspace-tabs"
          role="tablist"
          aria-label="右侧协同工作区"
        >
          {tabs.map(t => (
            <div
              key={t.id}
              className={`mpw-workspace-tab ${activeTab === t.id ? 'is-active' : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className="mpw-workspace-tab-select"
                onClick={() => onSelectTab(t.id)}
              >
                <span>{t.label}</span>
                {t.badge !== undefined ? (
                  <span
                    className="sd-pill"
                    style={{marginLeft: 5, height: 16, fontSize: 10}}
                  >
                    {t.badge}
                  </span>
                ) : null}
              </button>
            </div>
          ))}
        </div>

        <div className="mp-inspector-actions">
          <button
            type="button"
            className="mp-toolbar-button"
            aria-label="Close workspace panel"
            title="关闭右侧面板"
            onClick={onClose}
          >
            <CdsIcon name="X" size="small" />
          </button>
        </div>
      </header>

      <section className="mp-inspector-panel">
        {activeTab === 'tasks' ? (
          <TasksPlanTab
            plan={detail?.activePlan ?? null}
            theme={theme}
            busy={busy}
            onDecompose={onDecompose}
            onMutate={onMutateTasks}
            onExecute={onExecuteTasks}
          />
        ) : null}

        {activeTab === 'board' ? (
          detail ? (
            <BoardSpecTab
              sessionId={detail.session.id}
              board={detail.board ?? EMPTY_BOARD}
              specIR={detail.specIR}
              quantization={detail.quantization}
              pins={detail.pins}
              theme={theme}
              busy={busy}
              onSaveBoard={onSaveBoard}
              onCreatePin={input => onCreatePin(input)}
              onResolvePin={onResolvePin}
              onRunQuantize={onRunQuantize}
            />
          ) : (
            <p className="mp-inspector-empty">
              打开本地目录或运行示例项目后，可在此联动编辑 Excalidraw 白板与
              Spec IR。
            </p>
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
            coderKernel={primaryCoderKernel}
            theme={theme}
            selfApprovalBlockedMsg={selfApprovalBlockedMsg}
            busy={busy}
            onRunShip={onRunShip}
            onApproveAndDeliver={onApproveAndDeliver}
            onRejectAndPin={onRejectAndPin}
            onSendFindingToTriage={onSendFindingToTriage}
          />
        ) : null}

        {activeTab === 'kernels' ? (
          <MountedKernelsTab
            sessionId={detail?.session.id ?? null}
            kernels={kernels}
            roleRouting={roleRouting}
            collabFeed={detail?.collabFeed ?? []}
            theme={theme}
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
      </section>
    </aside>
  );
}

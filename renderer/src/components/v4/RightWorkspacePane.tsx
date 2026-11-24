import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react';
import type {
  AgentPersonaRecord,
  BoardSceneDoc,
  CollabPostRecord,
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
import {CollabDocPane} from './CollabDocPane.tsx';
import {DagCheckpointTab} from './DagCheckpointTab.tsx';
import {MediaPreviewTab} from './MediaPreviewTab.tsx';
import {MountedKernelsTab} from './MountedKernelsTab.tsx';
import {TasksPlanTab} from './TasksPlanTab.tsx';
import {ThreadDrawerTab} from './ThreadDrawerTab.tsx';
import {VerifyHtmlTab} from './VerifyHtmlTab.tsx';

export interface RightWorkspacePaneProps {
  readonly isOpen: boolean;
  readonly widthPx: number;
  readonly isDragging: boolean;
  readonly onStartResize: (e: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onClose: () => void;
  readonly activeTab: WorkspaceTabId;
  readonly onSelectTab: (
    tab: WorkspaceTabId,
    extra?: {readonly blockId?: string; readonly threadId?: string},
  ) => void;
  readonly detail: V4SessionDetail | null;
  readonly agents: readonly AgentPersonaRecord[];
  readonly activeThreadRootId: string | null;
  readonly focusedDocBlockId: string | null;
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly theme: 'light' | 'dark';
  readonly selfApprovalBlockedMsg: string | null;
  readonly busy: boolean;
  readonly onSaveDocBlock: (blockId: string, markdown: string) => Promise<void>;
  readonly onAddDocComment: (blockId: string, text: string) => Promise<void>;
  readonly onCompilePrdToSpec: () => Promise<void>;
  readonly onReplyThread: (parentPostId: string, text: string) => Promise<void>;
  readonly onToggleResolveThread: (
    postId: string,
    nextStatus: 'open' | 'resolved',
  ) => Promise<void>;
  readonly onReactPost: (postId: string, emoji: string) => Promise<void>;
  readonly onSaveMockupHtml: (
    postId: string,
    attachmentId: string,
    htmlContent: string,
  ) => Promise<void>;
  readonly onSelectPollOption: (
    postId: string,
    attachmentId: string,
    optionId: string,
  ) => Promise<void>;
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
  agents,
  activeThreadRootId,
  focusedDocBlockId,
  kernels,
  roleRouting,
  theme,
  selfApprovalBlockedMsg,
  busy,
  onSaveDocBlock,
  onAddDocComment,
  onCompilePrdToSpec,
  onReplyThread,
  onToggleResolveThread,
  onReactPost,
  onSaveMockupHtml,
  onSelectPollOption,
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
  const posts = detail?.posts ?? [];
  const docRev = detail?.collabDoc?.revision;
  const diffCount = detail?.diffs.length ?? 0;
  const taskCount = detail?.activePlan?.tasks.length ?? 0;
  const pinCount =
    detail?.pins.filter(p => p.status !== 'resolved').length ?? 0;
  const mediaCount = posts.reduce(
    (sum, p) =>
      sum +
      p.attachments.filter(
        a =>
          a.kind === 'html_mockup' ||
          a.kind === 'image' ||
          a.kind === 'video' ||
          a.kind === 'markdown_doc',
      ).length,
    0,
  );
  const primaryCoderKernel =
    detail?.activePlan?.tasks.find(t => t.role === 'coder')?.assignedKernel ??
    roleRouting.coder;

  // Locate selected thread root or first post that has replies
  const topPosts = posts.filter(p => !p.parentPostId);
  const rootPost: CollabPostRecord | null =
    (activeThreadRootId
      ? topPosts.find(p => p.id === activeThreadRootId)
      : null) ??
    topPosts.find(p => (p.replyCount ?? 0) > 0) ??
    topPosts[topPosts.length - 1] ??
    null;
  const threadReplies = rootPost
    ? posts.filter(p => p.parentPostId === rootPost.id)
    : [];

  const tabs: readonly {
    readonly id: WorkspaceTabId;
    readonly label: string;
    readonly badge?: number;
  }[] = [
    {id: 'doc', label: '文档 PRD·Spec', badge: docRev},
    {
      id: 'thread',
      label: '线程',
      badge: threadReplies.length || undefined,
    },
    {id: 'board', label: '白板', badge: pinCount || undefined},
    {id: 'preview', label: '预览', badge: mediaCount || undefined},
    {id: 'code', label: '文件', badge: diffCount || undefined},
    {id: 'tasks', label: '任务', badge: taskCount || undefined},
    {id: 'verify', label: '审校'},
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
        {activeTab === 'doc' ? (
          detail ? (
            <CollabDocPane
              doc={detail.collabDoc}
              specIR={detail.specIR}
              agents={agents}
              focusedBlockId={focusedDocBlockId}
              busy={busy}
              onSaveBlock={onSaveDocBlock}
              onAddComment={onAddDocComment}
              onCompileSpec={onCompilePrdToSpec}
              onOpenBoard={() => onSelectTab('board')}
            />
          ) : (
            <p className="mp-inspector-empty">
              新建或打开会话后，可在此进行实时多人 / 多智能体 PRD
              共编并生成结构化 Spec。
            </p>
          )
        ) : null}

        {activeTab === 'thread' ? (
          <ThreadDrawerTab
            rootPost={rootPost}
            replies={threadReplies}
            agents={agents}
            theme={theme}
            busy={busy}
            onReplyThread={onReplyThread}
            onToggleResolve={onToggleResolveThread}
            onReact={onReactPost}
            onOpenTab={onSelectTab}
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
              打开项目后可在此编辑架构拓扑白板并与 Spec 契约联动。
            </p>
          )
        ) : null}

        {activeTab === 'preview' ? (
          <MediaPreviewTab
            posts={posts}
            busy={busy}
            onOpenTab={onSelectTab}
            onSaveMockupHtml={onSaveMockupHtml}
            onSelectPollOption={onSelectPollOption}
          />
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

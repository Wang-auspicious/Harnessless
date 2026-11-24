import {useState, type ReactElement} from 'react';
import type {
  HostedAppCard,
  KernelId,
  MasterSession,
  NativeKernelCard,
  ShipReviewFinding,
  TaskNodeRole,
  V4SessionDetail,
  WorkspaceTabId,
} from '../../api/v4-types.ts';
import {AgentBrandIcon, AppBrandIcon} from './AgentAvatar.tsx';
import {CdsIcon} from './CdsIcon.tsx';
import {DagCheckpointTab} from './DagCheckpointTab.tsx';
import {MountedKernelsTab} from './MountedKernelsTab.tsx';
import type {SettingsPageId} from './SettingsModal.tsx';
import type {SidebarNavView} from './StudioSidebar.tsx';
import {STAGE_META, kernelLabel} from './v4-labels.ts';

export interface LibraryViewsProps {
  readonly view: Exclude<SidebarNavView, 'chat' | 'triage' | 'dashboard'>;
  readonly detail: V4SessionDetail | null;
  readonly sessions: readonly MasterSession[];
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly hostedApps: readonly HostedAppCard[];
  readonly theme: 'light' | 'dark';
  readonly busy: boolean;
  readonly onBackToChat: (openInspectorTab?: WorkspaceTabId) => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onOnboardFolder: (folderPath: string) => Promise<void>;
  readonly onDemoRun: () => Promise<void>;
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
  readonly onControlApp: (
    appId: string,
    action: 'start' | 'stop' | 'restart' | 'fork_v2',
  ) => Promise<void>;
  readonly onRetryTask: (taskId: string) => Promise<void>;
  readonly onOpenSettings: (page?: SettingsPageId) => void;
  readonly onSwitchToLegacy: () => void;
  readonly onReportFinding?: (finding: ShipReviewFinding) => void;
}

export function LibraryViews({
  view,
  detail,
  sessions,
  kernels,
  roleRouting,
  hostedApps,
  theme,
  busy,
  onBackToChat,
  onSelectSession,
  onOnboardFolder,
  onDemoRun,
  onProbeKernels,
  onUpdateRouting,
  onPostCollab,
  onControlApp,
  onRetryTask,
  onOpenSettings,
}: LibraryViewsProps): ReactElement {
  const [folderPath, setFolderPath] = useState('');

  const pickNative = async (): Promise<void> => {
    if (window.forgeops?.pickDirectory) {
      const picked = await window.forgeops.pickDirectory();
      if (picked) {
        await onOnboardFolder(picked);
        onBackToChat('board');
      }
    }
  };

  if (view === 'projects') {
    return (
      <section className="sd-library-page" data-testid="v4-view-projects">
        <div className="sd-library-inner">
          <header className="sd-library-header">
            <div>
              <h1>Projects</h1>
              <p className="sd-triage-subtitle">
                多仓代码工程接入、Git Worktree 上下文与协同会话目录
              </p>
            </div>
            <div className="sd-toolbar-row">
              <button
                type="button"
                className="sd-btn"
                disabled={busy}
                onClick={() => void pickNative()}
              >
                <CdsIcon name="FolderOpen" size="small" />
                <span>选择本地目录…</span>
              </button>
              <button
                type="button"
                className="sd-btn is-primary"
                disabled={busy}
                onClick={() => {
                  void onDemoRun().then(() => onBackToChat('board'));
                }}
              >
                一键运行示例项目
              </button>
            </div>
          </header>

          <div className="sd-card">
            <div className="sd-card-head">
              <span>接入本地代码工程</span>
              <div className="sd-toolbar-row">
                <AppBrandIcon app="vscode" theme={theme} size={14} />
                <AppBrandIcon app="cursor" theme={theme} size={14} />
                <AppBrandIcon app="github" theme={theme} size={14} />
              </div>
            </div>
            <div className="sd-card-body">
              <div className="sd-toolbar-row">
                <input
                  type="text"
                  className="sd-input"
                  style={{flex: 1}}
                  value={folderPath}
                  onChange={e => setFolderPath(e.target.value)}
                  placeholder="例如 D:\Projects\my-app (若无 .git 将自动初始化)"
                />
                <button
                  type="button"
                  className="sd-btn is-ink"
                  disabled={busy || !folderPath.trim()}
                  onClick={() => {
                    const target = folderPath.trim();
                    if (!target) return;
                    setFolderPath('');
                    void onOnboardFolder(target).then(() =>
                      onBackToChat('board'),
                    );
                  }}
                >
                  打开并接入
                </button>
              </div>
            </div>
          </div>

          <div className="sd-card">
            <div className="sd-card-head">
              <span>全部项目与协同会话 ({sessions.length})</span>
            </div>
            {sessions.length === 0 ? (
              <div className="mp-inspector-empty">暂无历史项目会话</div>
            ) : (
              sessions.map(s => (
                <div key={s.id} className="sd-wbs-row">
                  <div className="sd-wbs-top">
                    <div className="sd-wbs-title">
                      <CdsIcon name="Folder" size="small" />
                      <span>{s.title}</span>
                      <span className="sd-pill">
                        {STAGE_META[s.stage]?.label ?? s.stage}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="sd-btn"
                      onClick={() => {
                        onSelectSession(s.id);
                        onBackToChat();
                      }}
                    >
                      打开对话
                    </button>
                  </div>
                  <p className="sd-wbs-desc">{s.workspacePath}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    );
  }

  if (view === 'tasks') {
    return (
      <section className="sd-library-page" data-testid="v4-view-tasks">
        <div className="sd-library-inner">
          <header className="sd-library-header">
            <div>
              <h1>Tasks &amp; Checkpoints</h1>
              <p className="sd-triage-subtitle">
                WBS 任务依赖 DAG 与断点恢复状态视图
              </p>
            </div>
            <button
              type="button"
              className="sd-btn"
              onClick={() => onBackToChat('tasks')}
            >
              在聊天分屏中查看
            </button>
          </header>
          <DagCheckpointTab
            plan={detail?.activePlan ?? null}
            busy={busy}
            onRetryTask={onRetryTask}
          />
        </div>
      </section>
    );
  }

  if (view === 'artifacts') {
    return (
      <section className="sd-library-page" data-testid="v4-view-artifacts">
        <div className="sd-library-inner">
          <header className="sd-library-header">
            <div>
              <h1>产物与已交付应用</h1>
              <p className="sd-triage-subtitle">
                架构白板、结构化 Spec 契约、交互验收报告与本地托管服务
              </p>
            </div>
            <div className="sd-toolbar-row">
              <button
                type="button"
                className="sd-btn"
                onClick={() => onBackToChat('board')}
              >
                Excalidraw 白板
              </button>
              <button
                type="button"
                className="sd-btn"
                onClick={() => onBackToChat('verify')}
              >
                验收 HTML
              </button>
            </div>
          </header>

          <div className="sd-artifact-template-grid">
            <button
              type="button"
              className="sd-template-card"
              onClick={() => onBackToChat('board')}
            >
              <div className="sd-template-preview">
                <CdsIcon name="Palette" size="large" />
              </div>
              <div className="sd-template-copy">
                <strong>Architecture Whiteboard</strong>
                <small>手绘风节点连线 · Pin 批注联动 Spec IR</small>
              </div>
            </button>

            <button
              type="button"
              className="sd-template-card"
              onClick={() => onBackToChat('verify')}
            >
              <div className="sd-template-preview">
                <CdsIcon name="Verified" size="large" />
              </div>
              <div className="sd-template-copy">
                <strong>交互式验收报告</strong>
                <small>独立交叉审校结果与沙箱验收预览</small>
              </div>
            </button>

            <button
              type="button"
              className="sd-template-card"
              onClick={() => onBackToChat('code')}
            >
              <div className="sd-template-preview">
                <CdsIcon name="ChangesPlusMinus" size="large" />
              </div>
              <div className="sd-template-copy">
                <strong>Worktree Diff Snapshot</strong>
                <small>行级增量 Diff 与 Tree SHA 审计</small>
              </div>
            </button>
          </div>

          <div className="sd-card">
            <div className="sd-card-head">
              <span>已交付与托管应用 ({hostedApps.length})</span>
            </div>
            {hostedApps.length === 0 ? (
              <div className="mp-inspector-empty">
                完成 Ship 独立审校并合并交付后，交付产出的应用会显示在这里。
              </div>
            ) : (
              hostedApps.map(app => (
                <div key={app.id} className="sd-wbs-row">
                  <div className="sd-wbs-top">
                    <div className="sd-wbs-title">
                      <AppBrandIcon app="antigravity" theme={theme} size={18} />
                      <span>
                        {app.name} · {app.versionTag}
                      </span>
                      <span
                        className={`sd-pill ${app.status === 'running' ? 'is-success' : ''}`}
                      >
                        {app.status}
                      </span>
                    </div>
                    <div className="sd-toolbar-row">
                      <button
                        type="button"
                        className="sd-btn"
                        disabled={busy}
                        onClick={() =>
                          void onControlApp(
                            app.id,
                            app.status === 'running' ? 'stop' : 'start',
                          )
                        }
                      >
                        {app.status === 'running' ? '停止' : '启动'}
                      </button>
                      <button
                        type="button"
                        className="sd-btn"
                        disabled={busy}
                        onClick={() => {
                          void onControlApp(app.id, 'fork_v2').then(() =>
                            onBackToChat(),
                          );
                        }}
                      >
                        Fork vNext
                      </button>
                    </div>
                  </div>
                  <p className="sd-wbs-desc">
                    Commit {app.commitSha.slice(0, 8)} · Updated{' '}
                    {new Date(app.updatedAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="sd-library-page" data-testid={`v4-view-${view}`}>
      <div className="sd-library-inner">
        <header className="sd-library-header">
          <div>
            <h1>{view === 'kernels' ? '本地引擎探测' : '能力与外部连接器'}</h1>
            <p className="sd-triage-subtitle">
              管理本地编码助手引擎、模型供应商路由及外部平台同步通道
            </p>
          </div>
          <div className="sd-toolbar-row">
            <button
              type="button"
              className="sd-btn"
              onClick={() => onOpenSettings('models')}
            >
              在浮层设置中编辑
            </button>
            <button
              type="button"
              className="sd-btn is-primary"
              onClick={() => onBackToChat('kernels')}
            >
              在分屏中查看
            </button>
          </div>
        </header>

        {view === 'customize' ? (
          <div className="sd-connector-strip">
            <div className="sd-connector-card">
              <AppBrandIcon app="slack" theme={theme} size={20} />
              <div>
                <strong>团队频道与外部同步</strong>
                <small>#需求讨论 · #架构与原型 · Slack Webhook</small>
              </div>
              <span className="sd-pill is-success">内建实时</span>
            </div>
            <div className="sd-connector-card">
              <AppBrandIcon app="linear" theme={theme} size={20} />
              <div>
                <strong>议题追踪与独立审校</strong>
                <small>画布批注 + 代码评审风险联动</small>
              </div>
              <span className="sd-pill is-success">已启用</span>
            </div>
            <div className="sd-connector-card">
              <AppBrandIcon app="figma" theme={theme} size={20} />
              <div>
                <strong>协同白板与 PRD·Spec 联动</strong>
                <small>双向绑定架构图 ↔ 结构化 Spec</small>
              </div>
              <span className="sd-pill is-success">已就绪</span>
            </div>
            <div className="sd-connector-card">
              <AgentBrandIcon
                kernelId={roleRouting.reviewer}
                theme={theme}
                size={20}
              />
              <div>
                <strong>{kernelLabel(roleRouting.reviewer)}</strong>
                <small>强制与编码角色模型物理隔离</small>
              </div>
              <span className="sd-pill">独立审校</span>
            </div>
          </div>
        ) : null}

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
      </div>
    </section>
  );
}

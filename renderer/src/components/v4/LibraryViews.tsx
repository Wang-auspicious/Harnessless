import {useState, type ReactElement} from 'react';
import type {
  HostedAppCard,
  KernelId,
  MasterSession,
  NativeKernelCard,
  TaskNodeRole,
  V4SessionDetail,
  WorkspaceTabId,
} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';
import {DagCheckpointTab} from './DagCheckpointTab.tsx';
import {MountedKernelsTab} from './MountedKernelsTab.tsx';
import type {SidebarNavView} from './StudioSidebar.tsx';
import {STAGE_META} from './v4-labels.ts';

export interface LibraryViewsProps {
  readonly view: Exclude<SidebarNavView, 'chat'>;
  readonly detail: V4SessionDetail | null;
  readonly sessions: readonly MasterSession[];
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly hostedApps: readonly HostedAppCard[];
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
}

export function LibraryViews({
  view,
  detail,
  sessions,
  kernels,
  roleRouting,
  hostedApps,
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
            <h1>Projects</h1>
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
              <span>直接输入本地工程目录</span>
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
            <h1>Tasks &amp; Checkpoints</h1>
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
            <h1>Artifacts &amp; Shipped Apps</h1>
            <div className="sd-toolbar-row">
              <button
                type="button"
                className="sd-btn"
                onClick={() => onBackToChat('board')}
              >
                白板与 Spec IR
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
                      <CdsIcon name="Artifacts" size="small" />
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
          <h1>
            {view === 'kernels'
              ? 'Native Agent Kernels (Orca)'
              : 'Customize & Role Routing'}
          </h1>
          <button
            type="button"
            className="sd-btn"
            onClick={() => onBackToChat('kernels')}
          >
            在分屏中查看
          </button>
        </header>

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
      </div>
    </section>
  );
}

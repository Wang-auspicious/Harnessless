import {useEffect, useRef, useState, type ReactElement} from 'react';
import type {
  HostedAppCard,
  MasterSession,
  NativeKernelCard,
  SessionMode,
} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';
import {sessionStatusDot} from './v4-labels.ts';

export type SidebarNavView =
  'chat' | 'projects' | 'tasks' | 'artifacts' | 'kernels' | 'customize';

export interface StudioSidebarProps {
  readonly mode: SessionMode;
  readonly onChangeMode: (mode: SessionMode) => void;
  readonly activeNav: SidebarNavView;
  readonly onSelectNav: (nav: SidebarNavView) => void;
  readonly sessions: readonly MasterSession[];
  readonly activeSessionId: string | null;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onNewSession: () => void;
  readonly onOnboardFolder: (folderPath: string) => Promise<void>;
  readonly catchupOnly: boolean;
  readonly onToggleCatchup: () => void;
  readonly pendingApprovalsCount: number;
  readonly kernels: readonly NativeKernelCard[];
  readonly hostedApps: readonly HostedAppCard[];
  readonly searchQuery: string;
  readonly theme: 'light' | 'dark';
  readonly onToggleTheme: () => void;
  readonly onSwitchToLegacy: () => void;
  readonly onDemoRun: () => Promise<void>;
  readonly busy: boolean;
}

function repoBaseName(pathStr: string): string {
  const parts = pathStr.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'Workspace';
}

function mapSessionStatus(
  dot: 'active' | 'done' | 'awaiting' | 'failed',
): 'running' | 'ready' | 'awaiting' | 'error' {
  if (dot === 'active') return 'running';
  if (dot === 'awaiting') return 'awaiting';
  if (dot === 'failed') return 'error';
  return 'ready';
}

export function StudioSidebar({
  mode,
  onChangeMode,
  activeNav,
  onSelectNav,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onOnboardFolder,
  catchupOnly,
  onToggleCatchup,
  pendingApprovalsCount,
  kernels,
  hostedApps,
  searchQuery,
  theme,
  onToggleTheme,
  onSwitchToLegacy,
  onDemoRun,
  busy,
}: StudioSidebarProps): ReactElement {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [folderNote, setFolderNote] = useState<string | null>(null);
  const footRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocDown = (e: MouseEvent): void => {
      if (footRef.current && !footRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, []);

  const handleOpenFolder = async (): Promise<void> => {
    setFolderNote(null);
    if (window.forgeops?.pickDirectory) {
      const picked = await window.forgeops.pickDirectory();
      if (picked) {
        await onOnboardFolder(picked);
        return;
      }
      return;
    }
    onSelectNav('projects');
    setFolderNote('当前浏览器模式请在右侧/Projects 面板输入本地路径。');
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleSessions = sessions.filter(s => {
    if (catchupOnly && s.stage !== 'spec' && s.stage !== 'review') {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return (
      s.title.toLowerCase().includes(normalizedQuery) ||
      s.workspacePath.toLowerCase().includes(normalizedQuery) ||
      s.stage.toLowerCase().includes(normalizedQuery)
    );
  });

  // Group sessions by repository folder name (matching MP .mpw-project groups)
  const grouped = new Map<string, MasterSession[]>();
  for (const s of visibleSessions) {
    const groupName = repoBaseName(s.workspacePath);
    const list = grouped.get(groupName) ?? [];
    list.push(s);
    grouped.set(groupName, list);
  }

  const readyKernels = kernels.filter(
    k => k.status === 'ready' || k.status === 'builtin',
  ).length;

  return (
    <aside
      className="mpw-sidebar-col"
      id="studio-sidebar"
      aria-label="Sidebar"
      data-testid="v4-sidebar"
    >
      <div className="mpw-sidebar">
        <div className="mpw-logo-row">
          <div
            className="mp-mode-segment"
            id="mode-switch"
            role="tablist"
            aria-label="Collaboration Mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'solo'}
              className={mode === 'solo' ? 'is-on' : ''}
              onClick={() => onChangeMode('solo')}
            >
              <CdsIcon name="Code" size="small" />
              <span>Solo</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'team'}
              className={mode === 'team' ? 'is-on' : ''}
              onClick={() => onChangeMode('team')}
            >
              <CdsIcon name="Team" size="small" />
              <span>Team</span>
            </button>
          </div>
        </div>

        <nav className="mp-main-navigation" aria-label="Main navigation">
          <button
            type="button"
            className={`mpw-new-session ${activeNav === 'chat' && !activeSessionId ? 'is-on' : ''}`}
            disabled={busy}
            onClick={() => {
              onSelectNav('chat');
              onNewSession();
            }}
          >
            <span className="mp-nav-leading">
              <span className="mp-new-circle">
                <CdsIcon name="Add" size="small" />
              </span>
            </span>
            <span className="mp-nav-label mpw-new-session-label">New</span>
          </button>

          <button
            type="button"
            className={`mpw-customize ${activeNav === 'projects' ? 'is-on' : ''}`}
            onClick={() => onSelectNav('projects')}
          >
            <span className="mp-nav-leading">
              <CdsIcon name="Projects" size="small" anim="ANIM" />
            </span>
            <span className="mp-nav-label">Projects</span>
          </button>

          <button
            type="button"
            className={`mpw-customize ${activeNav === 'tasks' ? 'is-on' : ''}`}
            onClick={() => onSelectNav('tasks')}
          >
            <span className="mp-nav-leading">
              <CdsIcon name="Tasks" size="small" anim="ANIM" />
            </span>
            <span className="mp-nav-label">Tasks</span>
          </button>

          <div className="mp-nav-row">
            <button
              type="button"
              className={`mpw-customize ${activeNav === 'artifacts' ? 'is-on' : ''}`}
              onClick={() => onSelectNav('artifacts')}
            >
              <span className="mp-nav-leading">
                <CdsIcon name="Artifacts" size="small" anim="ANIM" />
              </span>
              <span className="mp-nav-label">Artifacts</span>
            </button>
            <button
              type="button"
              className="mp-nav-create"
              aria-label="Run Demo Pipeline"
              title="一键生成示例交付与 Spec"
              disabled={busy}
              onClick={() => void onDemoRun()}
            >
              <CdsIcon name="Add" size="small" />
            </button>
          </div>

          <button
            type="button"
            className={`mpw-customize ${activeNav === 'kernels' ? 'is-on' : ''}`}
            onClick={() => onSelectNav('kernels')}
          >
            <span className="mp-nav-leading">
              <CdsIcon name="Clock" size="small" anim="ANIM" />
            </span>
            <span className="mp-nav-label">
              Kernels ({readyKernels}/{kernels.length})
            </span>
          </button>

          <button
            type="button"
            className={`mpw-customize ${activeNav === 'customize' ? 'is-on' : ''}`}
            onClick={() => onSelectNav('customize')}
          >
            <span className="mp-nav-leading">
              <CdsIcon name="Customize" size="small" anim="ANIM" />
            </span>
            <span className="mp-nav-label">Customize</span>
          </button>

          <div ref={moreRef} style={{position: 'relative'}}>
            <button
              type="button"
              className={`mpw-customize ${moreMenuOpen ? 'is-on' : ''}`}
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              onClick={() => setMoreMenuOpen(prev => !prev)}
            >
              <span className="mp-nav-leading">
                <CdsIcon name="CaretDown" size="small" />
              </span>
              <span className="mp-nav-label">
                More
                {pendingApprovalsCount > 0 ? ` (${pendingApprovalsCount})` : ''}
              </span>
            </button>
            {moreMenuOpen ? (
              <div
                className="mp-account-menu"
                role="menu"
                style={{top: 30, left: 0}}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onToggleCatchup();
                    setMoreMenuOpen(false);
                  }}
                >
                  <CdsIcon name="Filter" size="small" />
                  <span>
                    {catchupOnly
                      ? '显示全部会话'
                      : `仅看审批待办 (${pendingApprovalsCount})`}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    void handleOpenFolder();
                  }}
                >
                  <CdsIcon name="FolderPlus" size="small" />
                  <span>打开本地项目…</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onSelectNav('artifacts');
                  }}
                >
                  <CdsIcon name="Box" size="small" />
                  <span>已交付应用 ({hostedApps.length})</span>
                </button>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onSwitchToLegacy();
                  }}
                >
                  <CdsIcon name="Wrench" size="small" />
                  <span>ForgeOps 专家视图</span>
                </button>
              </div>
            ) : null}
          </div>
        </nav>

        <section
          className="mpw-workspace-browser"
          aria-label="Conversation browser"
        >
          {folderNote ? (
            <p className="mpw-workspace-note" role="status">
              {folderNote}
            </p>
          ) : null}

          <div className="mpw-session-list-seat">
            <div id="side-convos">
              {grouped.size === 0 ? (
                <div className="side-empty">No matching sessions</div>
              ) : (
                Array.from(grouped.entries()).map(([groupName, items]) => {
                  const isOpen = !collapsedGroups[groupName];
                  return (
                    <div
                      key={groupName}
                      className={`mpw-project ${items.some(s => s.id === activeSessionId) ? 'is-active' : ''}`}
                      data-open={isOpen ? 'true' : 'false'}
                    >
                      <div className="mpw-project-row">
                        <button
                          type="button"
                          className="mpw-project-toggle"
                          onClick={() =>
                            setCollapsedGroups(prev => ({
                              ...prev,
                              [groupName]: !prev[groupName],
                            }))
                          }
                        >
                          <span className="mpw-project-chevron">
                            <CdsIcon name="CaretRight" size="xs" />
                          </span>
                          <span className="mpw-project-name">{groupName}</span>
                        </button>
                        <div className="mpw-project-actions">
                          <button
                            type="button"
                            aria-label="New session in project"
                            title="新建会话"
                            onClick={() => {
                              onSelectNav('chat');
                              onNewSession();
                            }}
                          >
                            <CdsIcon name="Add" size="small" />
                          </button>
                        </div>
                      </div>

                      <div className="mpw-project-sessions">
                        {items.map(s => {
                          const dot = sessionStatusDot(s.stage);
                          const status = mapSessionStatus(dot);
                          const isSelected = s.id === activeSessionId;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={`side-item ${isSelected ? 'is-on' : ''}`}
                              data-status={status}
                              onClick={() => {
                                onSelectNav('chat');
                                onSelectSession(s.id);
                              }}
                              title={s.title}
                            >
                              <span className="side-title">{s.title}</span>
                              <span className="side-actions">
                                <span
                                  className="status-dot"
                                  data-status={status}
                                />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <div className="mpw-foot" ref={footRef}>
          <button
            type="button"
            className="mp-account-footer"
            id="account-footer"
            aria-label="SDLC-Studio Gateway"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen(prev => !prev)}
          >
            <span className="mp-account-mark" aria-hidden="true">
              S
            </span>
            <span>
              <strong>SDLC-Studio</strong>
              <small>Gateway</small>
            </span>
            <CdsIcon name="CaretDown" size="micro" />
          </button>

          {accountMenuOpen ? (
            <div
              className="mp-account-menu"
              id="account-menu"
              role="menu"
              aria-label="SDLC-Studio menu"
              style={{bottom: 48, left: 8}}
            >
              <p className="mp-account-menu-header">
                SDLC-Studio · Gateway ({readyKernels} kernels ready)
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onSelectNav('customize');
                }}
              >
                <CdsIcon name="Settings" size="small" />
                <span>模型与角色路由</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onSelectNav('kernels');
                }}
              >
                <CdsIcon name="Wrench" size="small" />
                <span>原生 Agent 探测</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onSelectNav('projects');
                }}
              >
                <CdsIcon name="FolderOpen" size="small" />
                <span>项目工作区</span>
              </button>
              <hr />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onSwitchToLegacy();
                }}
              >
                <CdsIcon name="Code" size="small" />
                <span>切换 v3.1 专家路由</span>
              </button>
            </div>
          ) : null}

          <button
            type="button"
            className="mp-theme-toggle"
            id="theme-toggle"
            aria-label={
              theme === 'light'
                ? 'Switch to dark theme'
                : 'Switch to light theme'
            }
            title={theme === 'light' ? '切换深色主题' : '切换浅色主题'}
            onClick={onToggleTheme}
          >
            <CdsIcon
              name={theme === 'light' ? 'MoonStars' : 'Sun'}
              size="small"
            />
          </button>
        </div>
      </div>
    </aside>
  );
}

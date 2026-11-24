import {useEffect, useRef, useState, type ReactElement} from 'react';
import type {
  HostedAppCard,
  KernelId,
  MasterSession,
  NativeKernelCard,
  SessionMode,
} from '../../api/v4-types.ts';
import {AgentBrandIcon} from './AgentAvatar.tsx';
import {CdsIcon} from './CdsIcon.tsx';
import type {SettingsPageId} from './SettingsModal.tsx';
import {sessionStatusDot} from './v4-labels.ts';

export type SidebarNavView =
  | 'chat'
  | 'projects'
  | 'tasks'
  | 'artifacts'
  | 'triage'
  | 'kernels'
  | 'customize';

export type ChannelId =
  'general' | 'architecture' | 'code-review' | 'ship-triage';

export const CHANNELS: readonly {
  readonly id: ChannelId;
  readonly name: string;
  readonly subtitle: string;
  readonly defaultTab?: 'board' | 'code' | 'verify' | 'tasks';
}[] = [
  {id: 'general', name: 'general', subtitle: '主控协同'},
  {
    id: 'architecture',
    name: 'architecture',
    subtitle: '白板与 Spec',
    defaultTab: 'board',
  },
  {
    id: 'code-review',
    name: 'code-review',
    subtitle: 'Diff 评审',
    defaultTab: 'code',
  },
  {
    id: 'ship-triage',
    name: 'ship-triage',
    subtitle: 'Ship 验收',
    defaultTab: 'verify',
  },
];

export interface StudioSidebarProps {
  readonly mode: SessionMode;
  readonly onChangeMode: (mode: SessionMode) => void;
  readonly activeNav: SidebarNavView;
  readonly onSelectNav: (nav: SidebarNavView) => void;
  readonly activeChannel: ChannelId;
  readonly onSelectChannel: (channel: ChannelId) => void;
  readonly onMentionAgent: (kernelId: KernelId) => void;
  readonly sessions: readonly MasterSession[];
  readonly activeSessionId: string | null;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onNewSession: () => void;
  readonly onOnboardFolder: (folderPath: string) => Promise<void>;
  readonly catchupOnly: boolean;
  readonly onToggleCatchup: () => void;
  readonly pendingApprovalsCount: number;
  readonly openTriageCount: number;
  readonly kernels: readonly NativeKernelCard[];
  readonly hostedApps: readonly HostedAppCard[];
  readonly searchQuery: string;
  readonly theme: 'light' | 'dark';
  readonly onToggleTheme: () => void;
  readonly onOpenSettings: (page?: SettingsPageId) => void;
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
  activeChannel,
  onSelectChannel,
  onMentionAgent,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onOnboardFolder,
  catchupOnly,
  onToggleCatchup,
  pendingApprovalsCount,
  openTriageCount,
  kernels,
  hostedApps,
  searchQuery,
  theme,
  onToggleTheme,
  onOpenSettings,
  onSwitchToLegacy,
  onDemoRun,
  busy,
}: StudioSidebarProps): ReactElement {
  const [accountMenuOpen, setAccountMenuOpen] = useState(
    () => window.location.hash === '#smoke-home',
  );
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [localSearch, setLocalSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
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
    setFolderNote('请在 Projects 面板输入本地工程目录路径。');
  };

  const normalizedQuery = (localSearch || searchQuery).trim().toLowerCase();
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

  const toggleGroup = (key: string): void => {
    setCollapsedGroups(prev => ({...prev, [key]: !prev[key]}));
  };

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
              title="一键生成示例交付与白板"
              disabled={busy}
              onClick={() => void onDemoRun()}
            >
              <CdsIcon name="Add" size="small" />
            </button>
          </div>

          <button
            type="button"
            className={`mpw-customize ${activeNav === 'triage' ? 'is-on' : ''}`}
            onClick={() => onSelectNav('triage')}
          >
            <span className="mp-nav-leading">
              <CdsIcon name="Inbox" size="small" />
            </span>
            <span className="mp-nav-label">Triage</span>
            {openTriageCount > 0 ? (
              <span className="sd-nav-count">{openTriageCount}</span>
            ) : null}
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
                    setMoreMenuOpen(false);
                    onSelectNav('kernels');
                  }}
                >
                  <CdsIcon name="CommandLinePrompt" size="small" />
                  <span>
                    Kernels &amp; Bus ({readyKernels}/{kernels.length})
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onSelectNav('tasks');
                  }}
                >
                  <CdsIcon name="Tasks" size="small" />
                  <span>Tasks &amp; Checkpoints</span>
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
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onOpenSettings('general');
                  }}
                >
                  <CdsIcon name="Settings" size="small" />
                  <span>Settings</span>
                  <kbd>Ctrl+,</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onSwitchToLegacy();
                  }}
                >
                  <CdsIcon name="Code" size="small" />
                  <span>ForgeOps v3.1 专家模式</span>
                </button>
              </div>
            ) : null}
          </div>
        </nav>

        <section
          className={`mpw-workspace-browser ${searchFocused || localSearch ? 'is-searching' : ''}`}
          aria-label="Workspace, Channels and Agents"
        >
          <div className="mpw-workspace-header">
            <span className="mp-projects-label">Workspace</span>
            <div className="mpw-workspace-search">
              <button
                type="button"
                className="mpw-workspace-search-button"
                id="side-search-toggle"
                aria-label="Search sessions"
                title="搜索会话或项目"
                onClick={() => setSearchFocused(prev => !prev)}
              >
                <CdsIcon name="Search" size="small" />
              </button>
              <input
                id="side-search"
                type="search"
                value={localSearch}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(Boolean(localSearch))}
                onChange={e => setLocalSearch(e.target.value)}
                placeholder="Filter…"
                aria-label="Filter sessions"
              />
            </div>
            <button
              type="button"
              className="mpw-workspace-action"
              id="workspace-add"
              aria-label="Open project"
              title="打开本地项目文件夹"
              onClick={() => void handleOpenFolder()}
            >
              <CdsIcon name="FolderPlus" size="small" />
            </button>
          </div>

          {folderNote ? (
            <p className="mpw-workspace-note" role="status">
              {folderNote}
            </p>
          ) : null}

          <div className="mpw-session-list-seat">
            <div id="side-convos">
              {/* Slack/Raft Channels group */}
              {mode === 'team' ? (
                <div
                  className="mpw-project"
                  data-open={!collapsedGroups['__channels'] ? 'true' : 'false'}
                >
                  <div className="mpw-project-row">
                    <button
                      type="button"
                      className="mpw-project-toggle"
                      onClick={() => toggleGroup('__channels')}
                    >
                      <span className="mpw-project-chevron">
                        <CdsIcon name="CaretRight" size="xs" />
                      </span>
                      <span className="mpw-project-name">Channels</span>
                    </button>
                  </div>
                  <div className="mpw-project-sessions">
                    {CHANNELS.map(ch => {
                      const isSel =
                        activeNav === 'chat' && activeChannel === ch.id;
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          className={`side-item sd-channel-row ${isSel ? 'is-on' : ''}`}
                          onClick={() => {
                            onSelectNav('chat');
                            onSelectChannel(ch.id);
                          }}
                          title={`${ch.name} — ${ch.subtitle}`}
                        >
                          <span className="sd-channel-hash">#</span>
                          <span className="side-title">{ch.name}</span>
                          <span className="sd-channel-hint">{ch.subtitle}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Multi-Agent Direct Messages group with authentic SVG brand icons */}
              <div
                className="mpw-project"
                data-open={!collapsedGroups['__agents'] ? 'true' : 'false'}
              >
                <div className="mpw-project-row">
                  <button
                    type="button"
                    className="mpw-project-toggle"
                    onClick={() => toggleGroup('__agents')}
                  >
                    <span className="mpw-project-chevron">
                      <CdsIcon name="CaretRight" size="xs" />
                    </span>
                    <span className="mpw-project-name">Agents</span>
                  </button>
                  <div className="mpw-project-actions">
                    <button
                      type="button"
                      aria-label="Configure kernels"
                      title="配置模型与原生内核"
                      onClick={() => onOpenSettings('models')}
                    >
                      <CdsIcon name="Settings" size="small" />
                    </button>
                  </div>
                </div>
                <div className="mpw-project-sessions">
                  {kernels.slice(0, 6).map(k => (
                    <button
                      key={k.kernelId}
                      type="button"
                      className="side-item sd-agent-dm-row"
                      onClick={() => {
                        onSelectNav('chat');
                        onMentionAgent(k.kernelId);
                      }}
                      title={`在对话中 @${k.displayName} (${k.status})`}
                    >
                      <AgentBrandIcon
                        kernelId={k.kernelId}
                        theme={theme}
                        size={15}
                        status={k.status}
                      />
                      <span className="side-title">{k.displayName}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Project Folders & Sessions tree */}
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
                          onClick={() => toggleGroup(groupName)}
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
                          const isSelected =
                            activeNav === 'chat' && s.id === activeSessionId;
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
              F
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
                SDLC-Studio · {readyKernels}/{kernels.length} Kernels
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onOpenSettings('general');
                }}
              >
                <CdsIcon name="Settings" size="small" />
                <span>Settings</span>
                <kbd>Ctrl+,</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onOpenSettings('models');
                }}
              >
                <CdsIcon name="Agent" size="small" />
                <span>Models &amp; Kernels</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onOpenSettings('permissions');
                }}
              >
                <CdsIcon name="LockShield" size="small" />
                <span>Permissions &amp; Ship</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onOpenSettings('usage');
                }}
              >
                <CdsIcon name="BarChart" size="small" />
                <span>Usage &amp; Activity</span>
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
                <span>v3.1 专家控制台</span>
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

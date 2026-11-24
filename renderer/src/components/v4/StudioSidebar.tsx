import {useState, type ReactElement} from 'react';
import type {
  CatchupSummaryItem,
  HostedAppCard,
  MasterSession,
  NativeKernelCard,
  SessionMode,
} from '../../api/v4-types.ts';
import {STAGE_META, sessionStatusDot} from './v4-labels.ts';

export interface StudioSidebarProps {
  readonly mode: SessionMode;
  readonly onChangeMode: (mode: SessionMode) => void;
  readonly sessions: readonly MasterSession[];
  readonly activeSessionId: string | null;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onNewSession: () => void;
  readonly onOnboardFolder: (folderPath: string) => Promise<void>;
  readonly catchupOnly: boolean;
  readonly onToggleCatchup: () => void;
  readonly pendingApprovalsCount: number;
  readonly catchupItems: readonly CatchupSummaryItem[];
  readonly kernels: readonly NativeKernelCard[];
  readonly onOpenKernelsTab: () => void;
  readonly hostedApps: readonly HostedAppCard[];
  readonly onControlApp: (
    appId: string,
    action: 'start' | 'stop' | 'restart' | 'fork_v2',
  ) => Promise<void>;
  readonly searchQuery: string;
  readonly busy: boolean;
}

export function StudioSidebar({
  mode,
  onChangeMode,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onOnboardFolder,
  catchupOnly,
  onToggleCatchup,
  pendingApprovalsCount,
  catchupItems,
  kernels,
  onOpenKernelsTab,
  hostedApps,
  onControlApp,
  searchQuery,
  busy,
}: StudioSidebarProps): ReactElement {
  const [showPathInput, setShowPathInput] = useState(false);
  const [folderInput, setFolderInput] = useState('');

  const handleOpenFolder = async (): Promise<void> => {
    if (window.forgeops?.pickDirectory) {
      const picked = await window.forgeops.pickDirectory();
      if (picked) {
        await onOnboardFolder(picked);
        setShowPathInput(false);
        return;
      }
    }
    setShowPathInput(prev => !prev);
  };

  const handleSubmitPath = async (): Promise<void> => {
    const trimmed = folderInput.trim();
    if (!trimmed) {
      return;
    }
    await onOnboardFolder(trimmed);
    setFolderInput('');
    setShowPathInput(false);
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const catchupSessionIds = new Set(catchupItems.map(item => item.sessionId));

  const visibleSessions = sessions.filter(s => {
    if (catchupOnly) {
      const needsAttention =
        catchupSessionIds.has(s.id) ||
        s.stage === 'spec' ||
        s.stage === 'review';
      if (!needsAttention) {
        return false;
      }
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

  const featuredKernels: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: 'ok' | 'warn' | 'off';
    readonly tag: string;
  }[] = [
    {id: 'master', name: 'Master Agent', status: 'ok', tag: '编排器'},
    ...kernels
      .filter(k =>
        ['claude-code', 'codex', 'gemini-cli', 'native-api'].includes(
          k.kernelId,
        ),
      )
      .map(k => ({
        id: k.kernelId,
        name: k.displayName,
        status:
          k.status === 'ready' || k.status === 'builtin'
            ? ('ok' as const)
            : k.status === 'degraded'
              ? ('warn' as const)
              : ('off' as const),
        tag: k.version ? `v${k.version.replace(/^v/i, '')}` : k.status,
      })),
  ];

  return (
    <aside className="cds-sidebar-col" data-testid="v4-sidebar">
      <div className="cds-sidebar">
        <div
          className="cds-mode-segment"
          role="tablist"
          aria-label="Solo or Team Mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'solo'}
            className={mode === 'solo' ? 'is-on' : ''}
            onClick={() => onChangeMode('solo')}
          >
            Solo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'team'}
            className={mode === 'team' ? 'is-on' : ''}
            onClick={() => onChangeMode('team')}
          >
            Team
          </button>
        </div>

        <div className="cds-sidebar-actions">
          <button
            type="button"
            className="cds-nav-action"
            onClick={onNewSession}
            disabled={busy}
          >
            <span className="cds-new-dot">+</span>
            <span>新建协同任务</span>
          </button>

          <button
            type="button"
            className="cds-nav-action"
            onClick={() => void handleOpenFolder()}
            disabled={busy}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
            <span>打开本地目录</span>
          </button>

          <button
            type="button"
            className={`cds-nav-action ${catchupOnly ? 'is-active' : ''}`}
            onClick={onToggleCatchup}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span>Catch-up &amp; 审批待办</span>
            {pendingApprovalsCount > 0 ? (
              <span className="cds-badge-count">{pendingApprovalsCount}</span>
            ) : null}
          </button>
        </div>

        {showPathInput ? (
          <div className="cds-folder-inline">
            <input
              type="text"
              value={folderInput}
              onChange={e => setFolderInput(e.target.value)}
              placeholder="输入本地目录路径 (自动 git init)"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  void handleSubmitPath();
                }
              }}
            />
            <div className="cds-toolbar">
              <button
                type="button"
                className="cds-btn is-sm"
                onClick={() => setShowPathInput(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="cds-btn is-sm is-clay"
                disabled={busy || !folderInput.trim()}
                onClick={() => void handleSubmitPath()}
              >
                打开并接入
              </button>
            </div>
          </div>
        ) : null}

        <div className="cds-section-label">
          <span>{catchupOnly ? '待处理会话' : '协同会话'}</span>
          <span>{visibleSessions.length}</span>
        </div>

        <div className="cds-session-list">
          {visibleSessions.length === 0 ? (
            <div className="cds-empty" style={{padding: '14px 10px'}}>
              {catchupOnly
                ? '暂无待审批或待追赶会话'
                : '打开本地目录或一键运行示例项目'}
            </div>
          ) : (
            visibleSessions.map(s => {
              const dot = sessionStatusDot(s.stage);
              const stageLabel = STAGE_META[s.stage]?.label ?? s.stage;
              const selected = s.id === activeSessionId;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`cds-session-row ${selected ? 'is-selected' : ''}`}
                  onClick={() => onSelectSession(s.id)}
                >
                  <span className={`cds-status-dot is-${dot}`} />
                  <div className="cds-session-meta">
                    <div className="cds-session-name">{s.title}</div>
                    <div className="cds-session-sub">
                      <span>{stageLabel}</span>
                      <span>·</span>
                      <span>{s.mode === 'team' ? 'Team' : 'Solo'}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="cds-sidebar-footer">
          <div className="cds-section-label" style={{padding: '0 4px'}}>
            <span>已挂载原生内核 &amp; 协作成员</span>
            <button
              type="button"
              className="mmeta"
              onClick={onOpenKernelsTab}
              title="打开原生内核管理面板"
            >
              管理
            </button>
          </div>
          <div className="cds-kernel-mini-list">
            {featuredKernels.map(k => (
              <button
                key={k.id}
                type="button"
                className="cds-kernel-mini"
                onClick={onOpenKernelsTab}
              >
                <span className="cds-kernel-mini-left">
                  <span className={`cds-kernel-dot is-${k.status}`} />
                  <span>{k.name}</span>
                </span>
                <span className="cds-kernel-tag">{k.tag}</span>
              </button>
            ))}
          </div>

          {hostedApps.length > 0 ? (
            <>
              <div className="cds-section-label" style={{padding: '4px 4px 0'}}>
                <span>已交付托管应用</span>
                <span>{hostedApps.length}</span>
              </div>
              {hostedApps.slice(0, 3).map(app => (
                <div key={app.id} className="cds-hosted-card">
                  <div style={{minWidth: 0, flex: 1}}>
                    <div
                      style={{
                        fontWeight: 550,
                        color: 'var(--cds-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {app.name} {app.versionTag}
                    </div>
                    <div
                      style={{
                        fontSize: '10.5px',
                        color: 'var(--cds-text-muted)',
                      }}
                    >
                      {app.status} · {app.commitSha.slice(0, 7)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="cds-btn is-sm"
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
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

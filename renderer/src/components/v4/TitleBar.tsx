import type {ReactElement} from 'react';
import type {MasterSession} from '../../api/v4-types.ts';
import {STAGE_META} from './v4-labels.ts';

export interface TitleBarProps {
  readonly sidebarCollapsed: boolean;
  readonly onToggleSidebar: () => void;
  readonly searchQuery: string;
  readonly onSearchChange: (value: string) => void;
  readonly activeSession: MasterSession | null;
  readonly theme: 'light' | 'dark';
  readonly onToggleTheme: () => void;
  readonly onSwitchToLegacy: () => void;
  readonly hasNativeOverlay: boolean;
}

export function TitleBar({
  sidebarCollapsed,
  onToggleSidebar,
  searchQuery,
  onSearchChange,
  activeSession,
  theme,
  onToggleTheme,
  onSwitchToLegacy,
  hasNativeOverlay,
}: TitleBarProps): ReactElement {
  const stageInfo = activeSession ? STAGE_META[activeSession.stage] : null;
  const stageClass =
    stageInfo?.tone === 'clay'
      ? 'is-clay'
      : stageInfo?.tone === 'success'
        ? 'is-success'
        : stageInfo?.tone === 'warning'
          ? 'is-warning'
          : '';

  return (
    <header className="cds-titlebar" data-testid="v4-titlebar">
      <div className="cds-titlebar-group">
        <button
          type="button"
          className="cds-icon-btn"
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label="Toggle Sidebar"
          onClick={onToggleSidebar}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="9" y1="4" x2="9" y2="20" />
          </svg>
        </button>

        <span className="cds-titlebar-brand">
          <span className="cds-brand-mark">S</span>
          <span>SDLC-Studio</span>
        </span>

        <label className="cds-top-search" aria-label="搜索任务与会话">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="搜索会话 / 路径..."
          />
        </label>
      </div>

      <div className="cds-titlebar-center">
        {activeSession ? (
          <>
            <span className="cds-session-title" title={activeSession.title}>
              {activeSession.title}
            </span>
            {stageInfo ? (
              <span className={`cds-stage-pill ${stageClass}`}>
                {stageInfo.label} · Term {activeSession.term}
              </span>
            ) : null}
            {activeSession.crPassed ? (
              <span className="cds-stage-pill is-success">CR &lt; 0.10</span>
            ) : null}
          </>
        ) : (
          <span className="cds-session-title">ForgeOps Collaborative IDE</span>
        )}
      </div>

      <div className="cds-titlebar-group">
        <button
          type="button"
          className="cds-icon-btn"
          title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
          aria-label="Toggle Theme"
          onClick={onToggleTheme}
        >
          {theme === 'light' ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="cds-ghost-pill"
          onClick={onSwitchToLegacy}
          title="切换回 ForgeOps v3.1 专家路由视图"
        >
          专家模式
        </button>

        {hasNativeOverlay ? <div className="cds-caption-safe" /> : null}
      </div>
    </header>
  );
}

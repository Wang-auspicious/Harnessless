import {useEffect, useRef, useState, type ReactElement} from 'react';
import {CdsIcon} from './CdsIcon.tsx';

export interface TitleBarProps {
  readonly sidebarCollapsed: boolean;
  readonly onToggleSidebar: () => void;
  readonly onOpenSearch: () => void;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onGoBack: () => void;
  readonly onGoForward: () => void;
  readonly onNewSession: () => void;
  readonly onOpenFolderPrompt: () => Promise<void>;
  readonly onDemoRun: () => Promise<void>;
  readonly inspectorOpen: boolean;
  readonly onToggleInspector: () => void;
  readonly theme: 'light' | 'dark';
  readonly onToggleTheme: () => void;
  readonly onOpenSettings: () => void;
  readonly onSwitchToLegacy: () => void;
  readonly hasNativeOverlay: boolean;
}

export function TitleBar({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSearch,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onNewSession,
  onOpenFolderPrompt,
  onDemoRun,
  inspectorOpen,
  onToggleInspector,
  theme,
  onToggleTheme,
  onOpenSettings,
  onSwitchToLegacy,
  hasNativeOverlay,
}: TitleBarProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDocDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, [menuOpen]);

  return (
    <header
      className="mp-window-titlebar mp-window-bar"
      id="window-titlebar"
      data-testid="v4-titlebar"
    >
      <div className="mp-window-titlebar-leading" ref={menuRef}>
        <button
          type="button"
          className="mp-toolbar-button"
          id="app-menu"
          aria-label="App menu"
          title="应用菜单"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(prev => !prev)}
        >
          <CdsIcon name="Menu" size="small" />
        </button>

        <button
          type="button"
          className="mp-toolbar-button"
          id="sidebar-toggle"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={
            sidebarCollapsed ? '展开侧边栏 (Ctrl+B)' : '收起侧边栏 (Ctrl+B)'
          }
          aria-expanded={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <CdsIcon name="Sidebar" size="small" />
        </button>

        <button
          type="button"
          className="mp-toolbar-button"
          id="global-search-toggle"
          aria-label="Global search"
          title="全局搜索会话、任务与文件 (Ctrl+K)"
          onClick={onOpenSearch}
        >
          <CdsIcon name="Search" size="small" />
        </button>

        <button
          type="button"
          className="mp-toolbar-button"
          id="window-back"
          aria-label="Back"
          title="后退"
          disabled={!canGoBack}
          onClick={onGoBack}
        >
          <CdsIcon name="ArrowLeft" size="small" />
        </button>

        <button
          type="button"
          className="mp-toolbar-button"
          id="window-forward"
          aria-label="Forward"
          title="前进"
          disabled={!canGoForward}
          onClick={onGoForward}
        >
          <CdsIcon name="ArrowRight" size="small" />
        </button>

        {menuOpen ? (
          <div className="mp-window-menu-popover" role="menu">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onNewSession();
              }}
            >
              <span>新建协同会话</span>
              <kbd>Ctrl+N</kbd>
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void onOpenFolderPrompt();
              }}
            >
              <span>打开本地项目…</span>
              <kbd>Ctrl+O</kbd>
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void onDemoRun();
              }}
            >
              <span>一键跑通示例全流程</span>
              <kbd />
            </button>
            <hr />
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onToggleSidebar();
              }}
            >
              <span>{sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}</span>
              <kbd>Ctrl+B</kbd>
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onToggleInspector();
              }}
            >
              <span>{inspectorOpen ? '关闭右侧工作区' : '打开右侧工作区'}</span>
              <kbd>Ctrl+Shift+B</kbd>
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onToggleTheme();
              }}
            >
              <span>{theme === 'light' ? '切换深色外观' : '切换浅色外观'}</span>
              <kbd />
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenSettings();
              }}
            >
              <span>打开设置 (Settings)</span>
              <kbd>Ctrl+,</kbd>
            </button>
            <hr />
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onSwitchToLegacy();
              }}
            >
              <span>切换至 ForgeOps v3.1 专家模式</span>
              <kbd />
            </button>
          </div>
        ) : null}
      </div>

      {hasNativeOverlay ? (
        <div className="mp-window-caption-safe" aria-hidden="true" />
      ) : null}
    </header>
  );
}

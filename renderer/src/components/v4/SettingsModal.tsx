import {useEffect, useMemo, useState, type ReactElement} from 'react';
import type {
  HostedAppCard,
  KernelId,
  MasterSession,
  NativeKernelCard,
  SessionMode,
  TaskNodeRole,
} from '../../api/v4-types.ts';
import {AgentBrandIcon} from './AgentAvatar.tsx';
import {CdsIcon} from './CdsIcon.tsx';
import {ALL_KERNELS, ROLE_LABELS, kernelLabel} from './v4-labels.ts';

export type SettingsPageId =
  'general' | 'models' | 'permissions' | 'usage' | 'workspaces' | 'shortcuts';

export interface StudioPreferences {
  readonly language: 'zh-CN' | 'en';
  readonly defaultMode: SessionMode;
  readonly autoOpenInspector: boolean;
  readonly defaultShipDepth: 'fast' | 'standard' | 'deep';
  readonly defaultPolicyMode: 'enforced' | 'shadow';
  readonly worktreeIsolation: boolean;
  readonly autoGrillingFreeze: boolean;
  readonly autoGitInit: boolean;
}

export const DEFAULT_PREFERENCES: StudioPreferences = {
  language: 'zh-CN',
  defaultMode: 'team',
  autoOpenInspector: true,
  defaultShipDepth: 'standard',
  defaultPolicyMode: 'enforced',
  worktreeIsolation: true,
  autoGrillingFreeze: false,
  autoGitInit: true,
};

export interface SettingsModalProps {
  readonly open: boolean;
  readonly activePage: SettingsPageId;
  readonly onChangePage: (page: SettingsPageId) => void;
  readonly onClose: () => void;
  readonly theme: 'light' | 'dark';
  readonly onChangeTheme: (theme: 'light' | 'dark') => void;
  readonly preferences: StudioPreferences;
  readonly onUpdatePreferences: (patch: Partial<StudioPreferences>) => void;
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly onUpdateRouting: (
    patch: Partial<Record<TaskNodeRole, KernelId>>,
  ) => Promise<void>;
  readonly onProbeKernels: () => Promise<void>;
  readonly sessions: readonly MasterSession[];
  readonly hostedApps: readonly HostedAppCard[];
  readonly onOpenFolder: () => Promise<void>;
  readonly onSwitchToLegacy: () => void;
  readonly busy: boolean;
}

const ROLES: readonly TaskNodeRole[] = [
  'architect',
  'coder',
  'tester',
  'reviewer',
  'steward',
];

interface NavItemMeta {
  readonly id: SettingsPageId;
  readonly group: 'Customize' | 'This computer';
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly keywords: string;
}

const NAV_ITEMS: readonly NavItemMeta[] = [
  {
    id: 'general',
    group: 'Customize',
    title: 'General',
    description: '外观主题、界面语言、默认人机协作模式与布局行为。',
    icon: 'Laptop',
    keywords:
      'theme light dark language solo team inspector general 主题 语言 模式',
  },
  {
    id: 'models',
    group: 'Customize',
    title: 'Models & Kernels',
    description:
      '本机原生 Agent CLI (Claude Code / Codex / Gemini / OpenCode) 探测与按角色路由矩阵。',
    icon: 'Agent',
    keywords:
      'claude codex gemini opencode pi kernel routing architect coder reviewer 模型 内核 路由',
  },
  {
    id: 'permissions',
    group: 'Customize',
    title: 'Permissions & Ship',
    description:
      '三权分立防自批护栏、Git Worktree 物理隔离与 Claude Ship 独立审校策略。',
    icon: 'LockShield',
    keywords:
      'ship policy enforced shadow anti self approval worktree grilling 权限 审校 隔离',
  },
  {
    id: 'usage',
    group: 'Customize',
    title: 'Usage & Activity',
    description: '协同会话、多仓交付应用与本机内核实时用量统计。',
    icon: 'BarChart',
    keywords: 'usage stats telemetry sessions apps 用量 统计 记忆',
  },
  {
    id: 'workspaces',
    group: 'This computer',
    title: 'Workspaces & Git',
    description: '本地代码仓库托管、自动 Git 初始化与运行时环境目录。',
    icon: 'Folder',
    keywords: 'workspace folder git repo directory 工作区 目录 仓库',
  },
  {
    id: 'shortcuts',
    group: 'This computer',
    title: 'Shortcuts & Expert',
    description: '键盘快捷键清单与 v3.1 ForgeOps 专家视图切换。',
    icon: 'CommandLine',
    keywords: 'shortcuts hotkey expert v3.1 快捷键 专家模式',
  },
];

function SettingSwitch({
  checked,
  label,
  onToggle,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={`settings-switch ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
    >
      <span />
    </button>
  );
}

export function SettingsModal({
  open,
  activePage,
  onChangePage,
  onClose,
  theme,
  onChangeTheme,
  preferences,
  onUpdatePreferences,
  kernels,
  roleRouting,
  onUpdateRouting,
  onProbeKernels,
  sessions,
  hostedApps,
  onOpenFolder,
  onSwitchToLegacy,
  busy,
}: SettingsModalProps): ReactElement {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const filteredNav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return NAV_ITEMS;
    }
    return NAV_ITEMS.filter(
      item =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q),
    );
  }, [query]);

  const currentMeta = NAV_ITEMS.find(item => item.id === activePage) ?? {
    id: 'general' as const,
    group: 'Customize' as const,
    title: 'General',
    description: '外观主题、界面语言、默认人机协作模式与布局行为。',
    icon: 'Laptop',
    keywords: '',
  };
  const readyCount = kernels.filter(
    k => k.status === 'ready' || k.status === 'builtin',
  ).length;

  return (
    <section id="view-settings" hidden={!open} data-testid="v4-settings-modal">
      <div
        className="mpw-settings-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="mpw-settings-mask" onClick={onClose} />
        <div className="mpw-settings-panel">
          <aside className="mpw-settings-nav" aria-label="Settings navigation">
            <span className="mpw-settings-nav-title">Settings</span>
            <label className="mpw-settings-search">
              <CdsIcon name="Search" size="small" />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search settings"
                aria-label="Search settings"
              />
            </label>

            <nav className="mpw-settings-nav-list">
              {(['Customize', 'This computer'] as const).map(group => {
                const items = filteredNav.filter(item => item.group === group);
                if (items.length === 0) {
                  return null;
                }
                return (
                  <div key={group} className="settings-nav-group">
                    <h2>{group}</h2>
                    {items.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={`settings-nav-item ${activePage === item.id ? 'is-on' : ''}`}
                        onClick={() => onChangePage(item.id)}
                      >
                        <CdsIcon name={item.icon} size="small" />
                        <span>{item.title}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </nav>

            <button
              type="button"
              className="mp-customize-directory"
              onClick={() => {
                onClose();
                onSwitchToLegacy();
              }}
            >
              <CdsIcon name="Code" size="small" />
              <span>切换 v3.1 专家控制台</span>
            </button>
          </aside>

          <div className="mpw-settings-content">
            <header className="mpw-settings-header">
              <button
                type="button"
                className="mpw-settings-close"
                aria-label="Close settings"
                title="Close (Esc)"
                onClick={onClose}
              >
                <CdsIcon name="X" size="small" />
              </button>
            </header>

            <div className="mpw-settings-options">
              <div className="mp-settings-page">
                <header className="mp-settings-page-head">
                  <h2>{currentMeta.title}</h2>
                  <p>{currentMeta.description}</p>
                </header>

                {activePage === 'general' ? (
                  <>
                    <section className="mp-settings-section">
                      <h3>Appearance &amp; Typography</h3>
                      <div className="mp-settings-list settings-group-dividers">
                        <div className="mp-settings-row">
                          <div className="mp-settings-copy">
                            <b>界面主题 (Theme)</b>
                            <small>
                              切换 Claude Desktop 高拟真日间浅色 /
                              夜间深色工作台
                            </small>
                          </div>
                          <div className="mp-settings-control">
                            <label className="settings-select">
                              <select
                                aria-label="Theme"
                                value={theme}
                                onChange={e =>
                                  onChangeTheme(
                                    e.target.value as 'light' | 'dark',
                                  )
                                }
                              >
                                <option value="light">Light (浅色桌面)</option>
                                <option value="dark">Dark (深色桌面)</option>
                              </select>
                              <CdsIcon name="CaretDownSmall" size="xs" />
                            </label>
                          </div>
                        </div>

                        <div className="mp-settings-row">
                          <div className="mp-settings-copy">
                            <b>界面语言 (Language)</b>
                            <small>协同提示词与 UI 导航拷贝语言偏好</small>
                          </div>
                          <div className="mp-settings-control">
                            <label className="settings-select">
                              <select
                                aria-label="Language"
                                value={preferences.language}
                                onChange={e =>
                                  onUpdatePreferences({
                                    language: e.target.value as 'zh-CN' | 'en',
                                  })
                                }
                              >
                                <option value="zh-CN">简体中文</option>
                                <option value="en">English (US)</option>
                              </select>
                              <CdsIcon name="CaretDownSmall" size="xs" />
                            </label>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="mp-settings-section">
                      <h3>Collaboration defaults</h3>
                      <div className="mp-settings-list settings-group-dividers">
                        <div className="mp-settings-row">
                          <div className="mp-settings-copy">
                            <b>默认协作模式 (Default Mode)</b>
                            <small>
                              Solo 聚焦主控对话，Team 启用多频道与多 Agent
                              协同视图
                            </small>
                          </div>
                          <div className="mp-settings-control">
                            <label className="settings-select">
                              <select
                                aria-label="Default collaboration mode"
                                value={preferences.defaultMode}
                                onChange={e =>
                                  onUpdatePreferences({
                                    defaultMode: e.target.value as SessionMode,
                                  })
                                }
                              >
                                <option value="solo">Solo</option>
                                <option value="team">Team</option>
                              </select>
                              <CdsIcon name="CaretDownSmall" size="xs" />
                            </label>
                          </div>
                        </div>

                        <div className="mp-settings-row">
                          <div className="mp-settings-copy">
                            <b>启动会话时自动展开右侧工作区</b>
                            <small>
                              包含 Excalidraw 白板、Spec IR、WBS、Diff 与 Ship
                              验收分屏
                            </small>
                          </div>
                          <div className="mp-settings-control">
                            <SettingSwitch
                              checked={preferences.autoOpenInspector}
                              label="Auto open inspector"
                              onToggle={() =>
                                onUpdatePreferences({
                                  autoOpenInspector:
                                    !preferences.autoOpenInspector,
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </section>
                  </>
                ) : null}

                {activePage === 'models' ? (
                  <>
                    <div className="model-connections">
                      <div className="model-connections-heading">
                        <h3>
                          Connected Native Agent Runtimes ({readyCount}/
                          {kernels.length})
                        </h3>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onProbeKernels()}
                        >
                          重新探测 CLI
                        </button>
                      </div>

                      {kernels.map(k => (
                        <div key={k.kernelId} className="model-connection-row">
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              minWidth: 0,
                            }}
                          >
                            <AgentBrandIcon
                              kernelId={k.kernelId}
                              theme={theme}
                              size={28}
                              framed
                              status={k.status}
                            />
                            <div style={{minWidth: 0}}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                }}
                              >
                                <strong>{k.displayName}</strong>
                                <span
                                  className={`sd-pill ${k.status === 'ready' || k.status === 'builtin' ? 'is-success' : k.status === 'degraded' ? 'is-clay' : ''}`}
                                >
                                  {k.status}
                                </span>
                                {k.version ? (
                                  <span
                                    className="sd-pill"
                                    style={{fontFamily: 'var(--mp-font-mono)'}}
                                  >
                                    {k.version}
                                  </span>
                                ) : null}
                              </div>
                              <small
                                style={{fontFamily: 'var(--mp-font-mono)'}}
                              >
                                {k.binaryPath ?? k.command} · Roles:{' '}
                                {k.defaultRoles.join(', ')}
                              </small>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <section className="mp-settings-section">
                      <h3>Role-to-Kernel Routing (Orca Dispatch Matrix)</h3>
                      <div className="mp-settings-list settings-group-dividers">
                        {ROLES.map(role => {
                          const assigned = roleRouting[role] ?? 'claude-code';
                          return (
                            <div key={role} className="mp-settings-row">
                              <div className="mp-settings-copy">
                                <b>{ROLE_LABELS[role]}</b>
                                <small>
                                  当前委派给 {kernelLabel(assigned)} 内核执行
                                </small>
                              </div>
                              <div
                                className="mp-settings-control"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                }}
                              >
                                <AgentBrandIcon
                                  kernelId={assigned}
                                  theme={theme}
                                  size={18}
                                />
                                <label className="settings-select">
                                  <select
                                    aria-label={ROLE_LABELS[role]}
                                    disabled={busy}
                                    value={assigned}
                                    onChange={e =>
                                      void onUpdateRouting({
                                        [role]: e.target.value as KernelId,
                                      })
                                    }
                                  >
                                    {ALL_KERNELS.map(k => (
                                      <option key={k} value={k}>
                                        {kernelLabel(k)}
                                      </option>
                                    ))}
                                  </select>
                                  <CdsIcon name="CaretDownSmall" size="xs" />
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </>
                ) : null}

                {activePage === 'permissions' ? (
                  <section className="mp-settings-section">
                    <h3>Three-Power Separation &amp; Isolation</h3>
                    <div className="mp-settings-list settings-group-dividers">
                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>默认审校策略 (Ship Policy Mode)</b>
                          <small>
                            Enforced 物理拦截同内核自写自批 (HTTP 409)
                          </small>
                        </div>
                        <div className="mp-settings-control">
                          <label className="settings-select">
                            <select
                              aria-label="Ship policy mode"
                              value={preferences.defaultPolicyMode}
                              onChange={e =>
                                onUpdatePreferences({
                                  defaultPolicyMode: e.target.value as
                                    'enforced' | 'shadow',
                                })
                              }
                            >
                              <option value="enforced">
                                Enforced (强隔离)
                              </option>
                              <option value="shadow">Shadow (仅记录)</option>
                            </select>
                            <CdsIcon name="CaretDownSmall" size="xs" />
                          </label>
                        </div>
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>默认 Ship 审校深度</b>
                          <small>
                            控制跨文件静态扫描与 Answer-in-HTML 生成粒度
                          </small>
                        </div>
                        <div className="mp-settings-control">
                          <label className="settings-select">
                            <select
                              aria-label="Default review depth"
                              value={preferences.defaultShipDepth}
                              onChange={e =>
                                onUpdatePreferences({
                                  defaultShipDepth: e.target.value as
                                    'fast' | 'standard' | 'deep',
                                })
                              }
                            >
                              <option value="fast">Fast</option>
                              <option value="standard">Standard</option>
                              <option value="deep">Deep</option>
                            </select>
                            <CdsIcon name="CaretDownSmall" size="xs" />
                          </label>
                        </div>
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>独立 Git Worktree 隔离编码</b>
                          <small>
                            每个并发 Coder/Tester 任务拥有独立工作树与 Tree SHA
                            检查点
                          </small>
                        </div>
                        <div className="mp-settings-control">
                          <SettingSwitch
                            checked={preferences.worktreeIsolation}
                            label="Git worktree isolation"
                            onToggle={() =>
                              onUpdatePreferences({
                                worktreeIsolation:
                                  !preferences.worktreeIsolation,
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>Grilling 确认后自动触发 Kano-AHP 量化</b>
                          <small>
                            采纳需求拷问默认项时自动重算 CR 一致性指标
                          </small>
                        </div>
                        <div className="mp-settings-control">
                          <SettingSwitch
                            checked={preferences.autoGrillingFreeze}
                            label="Auto freeze after grilling"
                            onToggle={() =>
                              onUpdatePreferences({
                                autoGrillingFreeze:
                                  !preferences.autoGrillingFreeze,
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {activePage === 'usage' ? (
                  <section className="mp-settings-section">
                    <h3>Workspace Telemetry &amp; Memory</h3>
                    <div className="mp-settings-list settings-group-dividers">
                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>活跃协同会话 (Sessions)</b>
                          <small>
                            包含 Raft Spec 共识日志、WBS 计划与 Diff 快照
                          </small>
                        </div>
                        <div className="mp-settings-control">
                          <span className="settings-info-value">
                            {sessions.length} active
                          </span>
                        </div>
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>已挂载可用内核 (Online Kernels)</b>
                          <small>
                            本机可调度原生 Agent CLI 与 Builtin 引擎
                          </small>
                        </div>
                        <div className="mp-settings-control">
                          <span className="settings-info-value">
                            {readyCount} / {kernels.length} ready
                          </span>
                        </div>
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>已交付托管应用 (Shipped Apps)</b>
                          <small>通过三权审校并完成合入的应用版本数</small>
                        </div>
                        <div className="mp-settings-control">
                          <span className="settings-info-value">
                            {hostedApps.length} shipped
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {activePage === 'workspaces' ? (
                  <section className="mp-settings-section">
                    <h3>Repositories &amp; Hosting</h3>
                    <div className="mp-settings-list settings-group-dividers">
                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>打开并接入本地代码仓库</b>
                          <small>自动识别 Git 分支、工作树及工程文件结构</small>
                        </div>
                        <div className="mp-settings-control">
                          <button
                            type="button"
                            className="sd-btn is-primary"
                            disabled={busy}
                            onClick={() => {
                              onClose();
                              void onOpenFolder();
                            }}
                          >
                            选择本地目录…
                          </button>
                        </div>
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>缺失仓库时自动执行 git init</b>
                          <small>为空目录自动建立主分支与初始基线检查点</small>
                        </div>
                        <div className="mp-settings-control">
                          <SettingSwitch
                            checked={preferences.autoGitInit}
                            label="Auto git init"
                            onToggle={() =>
                              onUpdatePreferences({
                                autoGitInit: !preferences.autoGitInit,
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {activePage === 'shortcuts' ? (
                  <section className="mp-settings-section">
                    <h3>Keyboard Shortcuts</h3>
                    <div className="mp-settings-list settings-group-dividers">
                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>打开设置浮层</b>
                        </div>
                        <div className="mp-settings-control">
                          <span className="sd-pill">Ctrl + ,</span>
                        </div>
                      </div>
                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>切换右栏工作区</b>
                        </div>
                        <div className="mp-settings-control">
                          <span className="sd-pill">Ctrl + \</span>
                        </div>
                      </div>
                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>在消息输入框召唤 @Agent 成员</b>
                        </div>
                        <div className="mp-settings-control">
                          <span className="sd-pill">@</span>
                        </div>
                      </div>
                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>在消息输入框触发工程指令</b>
                        </div>
                        <div className="mp-settings-control">
                          <span className="sd-pill">
                            /spec · /decompose · /ship
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

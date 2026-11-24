import {useEffect, useMemo, useState, type ReactElement} from 'react';
import type {
  AgentBindingKind,
  GatewaySnapshot,
  HostedAppCard,
  KernelId,
  MasterSession,
  NativeKernelCard,
  ProviderPresetKind,
  RoutingStrategy,
  SessionMode,
  TaskNodeRole,
} from '../../api/v4-types.ts';
import {
  AgentBrandIcon,
  AppBrandIcon,
  resolveBrandForAgent,
} from './AgentAvatar.tsx';
import {CdsIcon} from './CdsIcon.tsx';

export type SettingsPageId =
  'general' | 'models' | 'routing' | 'clis' | 'connectors' | 'permissions';

export interface StudioPreferences {
  readonly language: 'zh-CN' | 'en';
  readonly defaultMode: SessionMode;
  readonly autoOpenInspector: boolean;
  readonly defaultShipDepth: 'fast' | 'standard' | 'deep';
  readonly defaultPolicyMode: 'enforced' | 'shadow';
  readonly worktreeIsolation: boolean;
  readonly autoGitInit: boolean;
}

export const DEFAULT_PREFERENCES: StudioPreferences = {
  language: 'zh-CN',
  defaultMode: 'team',
  autoOpenInspector: true,
  defaultShipDepth: 'standard',
  defaultPolicyMode: 'enforced',
  worktreeIsolation: true,
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
  readonly gateway: GatewaySnapshot | null;
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly onUpsertProvider: (input: {
    readonly id?: string;
    readonly name: string;
    readonly kind: ProviderPresetKind;
    readonly baseUrl: string;
    readonly newApiKey?: string;
    readonly newKeyLabel?: string;
    readonly enabled?: boolean;
  }) => Promise<void>;
  readonly onTestProvider: (providerId: string) => Promise<void>;
  readonly onDeleteProvider: (providerId: string) => Promise<void>;
  readonly onActivateProfile: (profileId: string) => Promise<void>;
  readonly onUpsertRoutingGroup: (input: {
    readonly id?: string;
    readonly name: string;
    readonly strategy: RoutingStrategy;
    readonly targets: readonly {
      readonly id: string;
      readonly providerId: string;
      readonly modelId: string;
      readonly maxContextK?: number;
    }[];
  }) => Promise<void>;
  readonly onUpdateAgentBinding: (
    agentId: string,
    patch: {
      readonly bindingKind?: AgentBindingKind;
      readonly providerId?: string | null;
      readonly modelId?: string | null;
      readonly routingGroupId?: string | null;
      readonly harnessId?: KernelId | null;
    },
  ) => Promise<void>;
  readonly onUpdateConnector: (
    connectorId: string,
    patch: {
      readonly enabled?: boolean;
      readonly config?: Readonly<Record<string, string>>;
    },
  ) => Promise<void>;
  readonly onUpdatePrivacyMasking: (patch: {
    readonly enabled?: boolean;
    readonly maskSecrets?: boolean;
    readonly maskEmails?: boolean;
  }) => Promise<void>;
  readonly onProbeKernels: () => Promise<void>;
  readonly sessions: readonly MasterSession[];
  readonly hostedApps: readonly HostedAppCard[];
  readonly onOpenFolder: () => Promise<void>;
  readonly onSwitchToLegacy: () => void;
  readonly busy: boolean;
}

interface NavItemMeta {
  readonly id: SettingsPageId;
  readonly group: '通用与模型' | '调度与接入';
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly keywords: string;
}

const NAV_ITEMS: readonly NavItemMeta[] = [
  {
    id: 'general',
    group: '通用与模型',
    title: '外观与通用',
    description: '界面主题、语言偏好、默认协同工作区设置。',
    icon: 'Laptop',
    keywords: 'theme light dark language solo team general 主题 语言 模式',
  },
  {
    id: 'models',
    group: '通用与模型',
    title: '模型与角色绑定',
    description:
      '独立管理各家 API 供应商、密钥池，以及每位协同智能体实际绑定的模型或 CLI。',
    icon: 'Agent',
    keywords:
      'provider anthropic openai gemini deepseek kimi ollama model agent 模型 供应商 密钥 角色',
  },
  {
    id: 'routing',
    group: '通用与模型',
    title: '路由组与隐私脱敏',
    description:
      '设置按优先级 / 轮询 / 上下文长度自动切换的多供应商路由，以及请求本地脱敏保护。',
    icon: 'GitBranch',
    keywords: 'routing failover profile privacy mask 路由 方案 脱敏',
  },
  {
    id: 'clis',
    group: '调度与接入',
    title: '本地 CLI 引擎',
    description:
      '探测本机已安装的命令行编码助手（Claude Code / Codex / Gemini / OpenCode / Pi）。',
    icon: 'CommandLine',
    keywords: 'cli claude codex gemini opencode pi probe 本地 引擎',
  },
  {
    id: 'connectors',
    group: '调度与接入',
    title: '外部连接器',
    description:
      '可选绑定 Slack、GitHub、Notion、Google Docs；不开启时内部频道与协作文档可独立运行。',
    icon: 'Plug',
    keywords: 'slack github notion google docs sync 连接器 同步',
  },
  {
    id: 'permissions',
    group: '调度与接入',
    title: '研发护栏与工作区',
    description: '独立审校防自批策略、Git Worktree 隔离开关与本地目录管理。',
    icon: 'LockShield',
    keywords: 'review policy worktree git workspace 审校 权限 隔离',
  },
];

const PROVIDER_PRESETS: readonly {
  readonly kind: ProviderPresetKind;
  readonly label: string;
  readonly defaultUrl: string;
}[] = [
  {
    kind: 'anthropic',
    label: 'Anthropic',
    defaultUrl: 'https://api.anthropic.com',
  },
  {kind: 'openai', label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1'},
  {
    kind: 'gemini',
    label: 'Google Gemini',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    kind: 'deepseek',
    label: 'DeepSeek',
    defaultUrl: 'https://api.deepseek.com/v1',
  },
  {
    kind: 'moonshot',
    label: 'Kimi (Moonshot)',
    defaultUrl: 'https://api.moonshot.cn/v1',
  },
  {
    kind: 'ollama',
    label: 'Ollama (本地)',
    defaultUrl: 'http://127.0.0.1:11434/v1',
  },
  {kind: 'openai-compatible', label: '自定义 OpenAI 兼容接口', defaultUrl: ''},
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
  gateway,
  kernels,
  onUpsertProvider,
  onTestProvider,
  onDeleteProvider,
  onActivateProfile,
  onUpsertRoutingGroup,
  onUpdateAgentBinding,
  onUpdateConnector,
  onUpdatePrivacyMasking,
  onProbeKernels,
  sessions,
  hostedApps,
  onOpenFolder,
  onSwitchToLegacy,
  busy,
}: SettingsModalProps): ReactElement {
  const [query, setQuery] = useState('');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvKind, setNewProvKind] =
    useState<ProviderPresetKind>('openai-compatible');
  const [newProvName, setNewProvName] = useState('');
  const [newProvUrl, setNewProvUrl] = useState('');
  const [newProvKey, setNewProvKey] = useState('');
  const [keyAddTargetId, setKeyAddTargetId] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');

  useEffect(() => {
    if (!open) return;
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
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter(
      item =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q),
    );
  }, [query]);

  const currentMeta =
    NAV_ITEMS.find(item => item.id === activePage) ?? NAV_ITEMS[0]!;
  const providers = gateway?.providers ?? [];
  const routingGroups = gateway?.routingGroups ?? [];
  const profiles = gateway?.profiles ?? [];
  const agents = gateway?.agents ?? [];
  const connectors = gateway?.connectors ?? [];
  const privacy = gateway?.privacyMasking ?? {
    enabled: false,
    maskSecrets: true,
    maskEmails: true,
    allowDomains: [],
  };
  const cliKernels = kernels.filter(
    k => k.kernelId !== 'master' && k.kernelId !== 'native-api',
  );

  return (
    <section id="view-settings" hidden={!open} data-testid="v4-settings-modal">
      <div
        className="mpw-settings-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="设置与模型中心"
      >
        <div className="mpw-settings-mask" onClick={onClose} />
        <div className="mpw-settings-panel">
          <aside className="mpw-settings-nav" aria-label="设置导航">
            <span className="mpw-settings-nav-title">Settings</span>
            <label className="mpw-settings-search">
              <CdsIcon name="Search" size="small" />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索配置项、供应商或模型…"
                aria-label="Search settings"
              />
            </label>

            <nav className="mpw-settings-nav-list">
              {(['通用与模型', '调度与接入'] as const).map(group => {
                const items = filteredNav.filter(item => item.group === group);
                if (items.length === 0) return null;
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
              <span>切换专家控制面板</span>
            </button>
          </aside>

          <div className="mpw-settings-content">
            <header className="mpw-settings-header">
              <button
                type="button"
                className="mpw-settings-close"
                aria-label="Close settings"
                title="关闭设置 (Esc)"
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
                  <section className="mp-settings-section">
                    <h3>外观与偏好</h3>
                    <div className="mp-settings-list settings-group-dividers">
                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>界面主题 (Theme)</b>
                          <small>切换日间柔和米白或夜间深色工作台</small>
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
                              <option value="light">浅色日间 (Light)</option>
                              <option value="dark">深色夜间 (Dark)</option>
                            </select>
                            <CdsIcon name="CaretDownSmall" size="xs" />
                          </label>
                        </div>
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>默认协作方式</b>
                          <small>
                            多人协同模式自动开启频道、实时 PRD 共编与讨论线程
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
                              <option value="team">
                                多人多角色协同 (Team)
                              </option>
                              <option value="solo">个人专注对话 (Solo)</option>
                            </select>
                            <CdsIcon name="CaretDownSmall" size="xs" />
                          </label>
                        </div>
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>打开会话时自动展开右侧文档分屏</b>
                          <small>方便边在讨论流构思边查看 PRD 与白板改动</small>
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
                ) : null}

                {activePage === 'models' ? (
                  <>
                    {/* Agent Role Bindings — Transparently bind each specialist role to real model / routing group / CLI */}
                    <div className="model-connections">
                      <div className="model-connections-heading">
                        <h3>团队角色模型绑定 ({agents.length} 个角色)</h3>
                        <button
                          type="button"
                          onClick={() => onChangePage('routing')}
                        >
                          管理方案与路由组 →
                        </button>
                      </div>
                      <p className="model-connection-hint">
                        每个专业角色独立选择模型或本地引擎，杜绝黑盒伪装。未配置
                        API 密钥或 CLI 时会如实标注「本地规则回退」。
                      </p>

                      {agents.map(ag => (
                        <div key={ag.id} className="model-connection-row">
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                            }}
                          >
                            <AgentBrandIcon
                              kernelId={resolveBrandForAgent({
                                avatarKey: ag.avatarKey,
                                bindingKind: ag.bindingKind,
                                providerId: ag.providerId,
                                harnessId: ag.harnessId,
                              })}
                              theme={theme}
                              size={20}
                              framed
                            />
                            <div>
                              <strong>{ag.displayName}</strong>{' '}
                              <span
                                style={{
                                  fontSize: 11.5,
                                  color: 'var(--mp-text-muted)',
                                }}
                              >
                                @{ag.handle}
                              </span>
                              <small>当前生效：{ag.resolvedModelLabel}</small>
                            </div>
                          </div>

                          <div className="model-connection-actions">
                            <label className="settings-select sd-compact-select">
                              <select
                                aria-label={`${ag.displayName} 绑定方式`}
                                value={ag.bindingKind}
                                disabled={busy}
                                onChange={e => {
                                  const bk = e.target.value as AgentBindingKind;
                                  if (bk === 'routing_group') {
                                    void onUpdateAgentBinding(ag.id, {
                                      bindingKind: bk,
                                      routingGroupId:
                                        ag.routingGroupId ??
                                        routingGroups[0]?.id ??
                                        'grp-reasoning',
                                    });
                                  } else if (bk === 'cli_harness') {
                                    void onUpdateAgentBinding(ag.id, {
                                      bindingKind: bk,
                                      harnessId: ag.harnessId ?? 'claude-code',
                                    });
                                  } else {
                                    const firstProv = providers[0];
                                    void onUpdateAgentBinding(ag.id, {
                                      bindingKind: bk,
                                      providerId:
                                        ag.providerId ?? firstProv?.id ?? null,
                                      modelId:
                                        ag.modelId ??
                                        firstProv?.models[0]?.id ??
                                        null,
                                    });
                                  }
                                }}
                              >
                                <option value="provider_model">指定模型</option>
                                <option value="routing_group">
                                  路由组自动切
                                </option>
                                <option value="cli_harness">
                                  本机 CLI 引擎
                                </option>
                              </select>
                              <CdsIcon name="CaretDownSmall" size="xs" />
                            </label>

                            {ag.bindingKind === 'provider_model' ? (
                              <label className="settings-select sd-compact-select">
                                <select
                                  aria-label={`${ag.displayName} 选择模型`}
                                  value={`${ag.providerId ?? ''}::${ag.modelId ?? ''}`}
                                  disabled={busy}
                                  onChange={e => {
                                    const [pid, mid] =
                                      e.target.value.split('::');
                                    void onUpdateAgentBinding(ag.id, {
                                      bindingKind: 'provider_model',
                                      providerId: pid || null,
                                      modelId: mid || null,
                                    });
                                  }}
                                >
                                  {providers.flatMap(p =>
                                    p.models.map(m => (
                                      <option
                                        key={`${p.id}::${m.id}`}
                                        value={`${p.id}::${m.id}`}
                                      >
                                        {p.name} / {m.label}
                                      </option>
                                    )),
                                  )}
                                </select>
                                <CdsIcon name="CaretDownSmall" size="xs" />
                              </label>
                            ) : null}

                            {ag.bindingKind === 'routing_group' ? (
                              <label className="settings-select sd-compact-select">
                                <select
                                  aria-label={`${ag.displayName} 选择路由组`}
                                  value={ag.routingGroupId ?? ''}
                                  disabled={busy}
                                  onChange={e =>
                                    void onUpdateAgentBinding(ag.id, {
                                      bindingKind: 'routing_group',
                                      routingGroupId: e.target.value,
                                    })
                                  }
                                >
                                  {routingGroups.map(g => (
                                    <option key={g.id} value={g.id}>
                                      {g.name}
                                    </option>
                                  ))}
                                </select>
                                <CdsIcon name="CaretDownSmall" size="xs" />
                              </label>
                            ) : null}

                            {ag.bindingKind === 'cli_harness' ? (
                              <label className="settings-select sd-compact-select">
                                <select
                                  aria-label={`${ag.displayName} 选择 CLI`}
                                  value={ag.harnessId ?? 'claude-code'}
                                  disabled={busy}
                                  onChange={e =>
                                    void onUpdateAgentBinding(ag.id, {
                                      bindingKind: 'cli_harness',
                                      harnessId: e.target.value as KernelId,
                                    })
                                  }
                                >
                                  {cliKernels.map(k => (
                                    <option key={k.kernelId} value={k.kernelId}>
                                      {k.displayName} (
                                      {k.installed ? '已就绪' : '未安装'})
                                    </option>
                                  ))}
                                </select>
                                <CdsIcon name="CaretDownSmall" size="xs" />
                              </label>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Providers & Multi-Key Pool */}
                    <div className="model-connections">
                      <div className="model-connections-heading">
                        <h3>模型供应商与密钥池 ({providers.length})</h3>
                        <button
                          type="button"
                          onClick={() => setShowAddProvider(prev => !prev)}
                        >
                          {showAddProvider ? '取消添加' : '+ 添加供应商'}
                        </button>
                      </div>

                      {showAddProvider ? (
                        <form
                          className="model-connection-form"
                          onSubmit={e => {
                            e.preventDefault();
                            if (!newProvName.trim() || !newProvUrl.trim()) {
                              return;
                            }
                            void onUpsertProvider({
                              name: newProvName.trim(),
                              kind: newProvKind,
                              baseUrl: newProvUrl.trim(),
                              newApiKey: newProvKey.trim() || undefined,
                              newKeyLabel: '默认 Key',
                            }).then(() => {
                              setShowAddProvider(false);
                              setNewProvName('');
                              setNewProvKey('');
                            });
                          }}
                        >
                          <fieldset>
                            <label>
                              供应商预设类型
                              <select
                                value={newProvKind}
                                onChange={e => {
                                  const kind = e.target
                                    .value as ProviderPresetKind;
                                  setNewProvKind(kind);
                                  const preset = PROVIDER_PRESETS.find(
                                    p => p.kind === kind,
                                  );
                                  if (preset) {
                                    if (!newProvName)
                                      setNewProvName(preset.label);
                                    if (preset.defaultUrl) {
                                      setNewProvUrl(preset.defaultUrl);
                                    }
                                  }
                                }}
                              >
                                {PROVIDER_PRESETS.map(p => (
                                  <option key={p.kind} value={p.kind}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              显示名称
                              <input
                                type="text"
                                required
                                value={newProvName}
                                onChange={e => setNewProvName(e.target.value)}
                                placeholder="例如 公司内部大模型网关"
                              />
                            </label>
                            <label>
                              Base URL
                              <input
                                type="url"
                                required
                                value={newProvUrl}
                                onChange={e => setNewProvUrl(e.target.value)}
                                placeholder="https://api.example.com/v1"
                              />
                            </label>
                            <label>
                              API Key (可选，安全存入本地库，列表页脱敏展示)
                              <input
                                type="password"
                                value={newProvKey}
                                onChange={e => setNewProvKey(e.target.value)}
                                placeholder="sk-..."
                              />
                            </label>
                            <div className="model-connection-actions">
                              <button type="submit" disabled={busy}>
                                保存供应商
                              </button>
                            </div>
                          </fieldset>
                        </form>
                      ) : null}

                      {providers.map(p => (
                        <div key={p.id} className="model-connection-row">
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                            }}
                          >
                            <AgentBrandIcon
                              kernelId={p.kind}
                              theme={theme}
                              size={18}
                              framed
                            />
                            <div>
                              <strong>{p.name}</strong>{' '}
                              <span
                                className={`sd-pill ${p.healthStatus === 'ok' ? 'is-success' : ''}`}
                              >
                                {p.apiKeys.length > 0
                                  ? `${p.apiKeys.length} Key · ${p.apiKeys[0]?.keyPreview}`
                                  : p.kind === 'ollama'
                                    ? '本地免密'
                                    : '未配置 Key'}
                              </span>
                              <small>
                                {p.baseUrl} · {p.models.length} 个模型
                                {p.lastError ? ` · ${p.lastError}` : ''}
                              </small>
                            </div>
                          </div>

                          <div className="model-connection-actions">
                            {keyAddTargetId === p.id ? (
                              <>
                                <input
                                  type="password"
                                  className="sd-input"
                                  style={{width: 150}}
                                  value={keyDraft}
                                  onChange={e => setKeyDraft(e.target.value)}
                                  placeholder="粘贴 sk-..."
                                />
                                <button
                                  type="button"
                                  disabled={busy || !keyDraft.trim()}
                                  onClick={() => {
                                    void onUpsertProvider({
                                      id: p.id,
                                      name: p.name,
                                      kind: p.kind,
                                      baseUrl: p.baseUrl,
                                      newApiKey: keyDraft.trim(),
                                    }).then(() => {
                                      setKeyDraft('');
                                      setKeyAddTargetId(null);
                                    });
                                  }}
                                >
                                  保存
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setKeyAddTargetId(p.id)}
                                >
                                  添加密钥
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void onTestProvider(p.id)}
                                >
                                  测活
                                </button>
                                {!p.id.startsWith('prov-') ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void onDeleteProvider(p.id)}
                                  >
                                    移除
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}

                {activePage === 'routing' ? (
                  <>
                    <section className="mp-settings-section">
                      <h3>一键切换配置方案 (Profiles)</h3>
                      <div className="mp-settings-list settings-group-dividers">
                        {profiles.map(prof => (
                          <div key={prof.id} className="mp-settings-row">
                            <div className="mp-settings-copy">
                              <b>{prof.name}</b>
                              <small>{prof.description}</small>
                            </div>
                            <button
                              type="button"
                              className={`sd-btn ${prof.active ? 'is-primary' : ''}`}
                              disabled={busy}
                              onClick={() => void onActivateProfile(prof.id)}
                            >
                              {prof.active ? '当前方案 ✓' : '启用此方案'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="mp-settings-section">
                      <h3>多供应商故障转移路由组</h3>
                      <div className="mp-settings-list settings-group-dividers">
                        {routingGroups.map(grp => (
                          <div key={grp.id} className="mp-settings-row">
                            <div className="mp-settings-copy">
                              <b>{grp.name}</b>
                              <small>
                                策略：{grp.strategy} · 链路：
                                {grp.targets.map(t => t.modelId).join(' → ')}
                              </small>
                            </div>
                            <label className="settings-select sd-compact-select">
                              <select
                                aria-label={`${grp.name} 路由策略`}
                                value={grp.strategy}
                                onChange={e =>
                                  void onUpsertRoutingGroup({
                                    id: grp.id,
                                    name: grp.name,
                                    strategy: e.target.value as RoutingStrategy,
                                    targets: grp.targets,
                                  })
                                }
                              >
                                <option value="order">
                                  按优先级顺序 (Failover)
                                </option>
                                <option value="rotate">
                                  轮询均衡 (Rotate)
                                </option>
                                <option value="context-tiered">
                                  按上下文长度分层
                                </option>
                              </select>
                              <CdsIcon name="CaretDownSmall" size="xs" />
                            </label>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="mp-settings-section">
                      <h3>请求离开本机前的隐私脱敏保护</h3>
                      <div className="mp-settings-list settings-group-dividers">
                        <div className="mp-settings-row">
                          <div className="mp-settings-copy">
                            <b>启用本地敏感信息自动脱敏</b>
                            <small>
                              发送外部模型前自动把 API
                              Key、密钥、私密邮箱替换为占位符，模型回复后在本机自动还原
                            </small>
                          </div>
                          <SettingSwitch
                            checked={privacy.enabled}
                            label="Enable privacy masking"
                            onToggle={() =>
                              void onUpdatePrivacyMasking({
                                enabled: !privacy.enabled,
                              })
                            }
                          />
                        </div>
                      </div>
                    </section>
                  </>
                ) : null}

                {activePage === 'clis' ? (
                  <div className="model-connections">
                    <div className="model-connections-heading">
                      <h3>本机已探测 CLI 引擎 ({cliKernels.length})</h3>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onProbeKernels()}
                      >
                        重新探测 CLI
                      </button>
                    </div>
                    <p className="model-connection-hint">
                      当你的团队角色（如开发工程师或独立审校官）选择「本机 CLI
                      引擎」时，将直接调用此处探测到的命令行工具在隔离 Git
                      Worktree 中工作。
                    </p>
                    {cliKernels.map(k => (
                      <div key={k.kernelId} className="model-connection-row">
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <AgentBrandIcon
                            kernelId={k.kernelId}
                            theme={theme}
                            size={18}
                            status={k.status}
                            framed
                          />
                          <div>
                            <strong>{k.displayName}</strong>{' '}
                            <span
                              className={`sd-pill ${k.installed ? 'is-success' : ''}`}
                            >
                              {k.installed ? '已安装可用' : '未探测到'}
                            </span>
                            <small>
                              {k.version ?? '需确认 PATH'} ·{' '}
                              {k.binaryPath ?? `cmd: ${k.command}`}
                            </small>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {activePage === 'connectors' ? (
                  <section className="mp-settings-section">
                    <h3>外部工具同步通道（可选）</h3>
                    <p className="model-connection-hint">
                      不接入任何外部工具时，本应用内置的多人多角色频道讨论、X/Slack
                      流、实时文档共编与白板已完全自包含可用；若团队已在使用
                      Slack / GitHub / Notion / Google
                      Docs，可在此绑定双向同步。
                    </p>
                    <div className="mp-settings-list settings-group-dividers">
                      {connectors.map(conn => {
                        const firstCfgKey =
                          Object.keys(conn.config)[0] ?? 'target';
                        return (
                          <div key={conn.id} className="mp-settings-row">
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                flex: 1,
                              }}
                            >
                              <AppBrandIcon
                                app={
                                  conn.kind === 'slack'
                                    ? 'slack'
                                    : conn.kind === 'github'
                                      ? 'github'
                                      : 'figma'
                                }
                                theme={theme}
                                size={18}
                              />
                              <div className="mp-settings-copy">
                                <b>{conn.displayName}</b>
                                <small>
                                  状态：
                                  {conn.enabled
                                    ? conn.status
                                    : '未启用（内部协同独立运行）'}
                                </small>
                              </div>
                            </div>
                            <div className="sd-toolbar-row">
                              <input
                                type="text"
                                className="sd-input"
                                style={{width: 150}}
                                value={conn.config[firstCfgKey] ?? ''}
                                placeholder={`${firstCfgKey}…`}
                                onChange={e =>
                                  void onUpdateConnector(conn.id, {
                                    config: {[firstCfgKey]: e.target.value},
                                  })
                                }
                              />
                              <SettingSwitch
                                checked={conn.enabled}
                                label={conn.displayName}
                                onToggle={() =>
                                  void onUpdateConnector(conn.id, {
                                    enabled: !conn.enabled,
                                  })
                                }
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {activePage === 'permissions' ? (
                  <section className="mp-settings-section">
                    <h3>研发安全护栏与本地工程</h3>
                    <div className="mp-settings-list settings-group-dividers">
                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>强制独立交叉审校（禁止自写自批）</b>
                          <small>
                            编写代码的引擎与审校代码/Spec
                            的引擎必须分离，冲突时自动拦截
                          </small>
                        </div>
                        <SettingSwitch
                          checked={preferences.defaultPolicyMode === 'enforced'}
                          label="Independent review separation"
                          onToggle={() =>
                            onUpdatePreferences({
                              defaultPolicyMode:
                                preferences.defaultPolicyMode === 'enforced'
                                  ? 'shadow'
                                  : 'enforced',
                            })
                          }
                        />
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>并行任务强制 Git Worktree 物理隔离</b>
                          <small>
                            共 {sessions.length} 个协作会话 ·{' '}
                            {hostedApps.length} 个已交付应用
                          </small>
                        </div>
                        <SettingSwitch
                          checked={preferences.worktreeIsolation}
                          label="Git worktree isolation"
                          onToggle={() =>
                            onUpdatePreferences({
                              worktreeIsolation: !preferences.worktreeIsolation,
                            })
                          }
                        />
                      </div>

                      <div className="mp-settings-row">
                        <div className="mp-settings-copy">
                          <b>接入新的本地项目目录</b>
                          <small>自动探测项目技术栈与 Git 状态</small>
                        </div>
                        <button
                          type="button"
                          className="sd-btn is-primary"
                          onClick={() => {
                            onClose();
                            void onOpenFolder();
                          }}
                        >
                          选择本地目录…
                        </button>
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

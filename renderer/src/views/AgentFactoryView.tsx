import {useState, type ReactElement} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {
  AdapterTransport,
  ModelProviderConfig,
  SkillEntry,
} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';
import {
  ArrowLeftIcon,
  GridIcon,
  InfoIcon,
  PlugIcon,
  PlusIcon,
  RobotAvatar,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  TrashIcon,
  ZapIcon,
} from '../components/Icons.tsx';
import {tr, type UiLang} from '../i18n.ts';

export type AgentFactorySection = 'market' | 'models' | 'skills' | 'mcp';

function formatRoleBadge(lang: UiLang, rawRole: string | undefined): string {
  const role = (rawRole ?? 'DEV').toUpperCase();
  if (lang === 'EN') return role;
  switch (role) {
    case 'LEAD':
    case 'ARCHITECT':
      return '架构主控';
    case 'EVALUATOR':
    case 'QA':
      return '独立审计';
    case 'STEWARD':
      return '基建管家';
    case 'WORKER':
    case 'DEV':
      return '研发切片';
    default:
      return role;
  }
}

export function AgentFactoryView(props: {
  readonly lang: UiLang;
  readonly section: AgentFactorySection;
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly onRefresh: () => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {lang, section, snapshot, activeHubId, onRefresh, onError} = props;

  // --- Agents Market & Profile State ---
  const [profileAdapterId, setProfileAdapterId] = useState<string | null>(null);
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [agId, setAgId] = useState('');
  const [agLabel, setAgLabel] = useState('');
  const [agSpec, setAgSpec] = useState('');
  const [agSoul, setAgSoul] = useState('');
  const [agTransport, setAgTransport] =
    useState<AdapterTransport>('cli-stream');
  const [agCommand, setAgCommand] = useState('');
  const [agModel, setAgModel] = useState('deepseek-chat');

  // --- Models Pool State ---
  const [activeProviderId, setActiveProviderId] = useState<string>(
    snapshot.providers.find(p => p.hasApiKey)?.id ??
      snapshot.providers[0]?.id ??
      '',
  );
  const [editingProvider, setEditingProvider] =
    useState<ModelProviderConfig | null>(null);
  const [viewingModelsProvider, setViewingModelsProvider] =
    useState<ModelProviderConfig | null>(null);
  const [provBaseUrl, setProvBaseUrl] = useState('');
  const [provApiKey, setProvApiKey] = useState('');

  // --- Skills & DDD State ---
  const [skillsSubTab, setSkillsSubTab] = useState<'skills' | 'ddd'>('ddd');
  const [skillSlug, setSkillSlug] = useState('');
  const [skillTitle, setSkillTitle] = useState('');
  const [skillCat, setSkillCat] = useState<SkillEntry['category']>('qa');
  const [skillBody, setSkillBody] = useState('');
  const [termCtx, setTermCtx] = useState('Settlement');
  const [termCanonical, setTermCanonical] = useState('');
  const [termLocal, setTermLocal] = useState('');
  const [termDef, setTermDef] = useState('');
  const [termForbidden, setTermForbidden] = useState('');
  const [busy, setBusy] = useState(false);

  // =========================================================================
  // 1. AGENTS MARKET & AGENT PROFILE (1:1 Reference Match + Bilingual)
  // =========================================================================
  if (section === 'market') {
    const profileAdapter = snapshot.adapters.find(
      a => a.manifest.id === profileAdapterId,
    );
    const totalSlices = snapshot.adapters.reduce(
      (acc, a) => acc + a.rollingScoredSlices,
      0,
    );
    const avgSuccess =
      snapshot.adapters.length > 0
        ? (
            (snapshot.adapters.reduce((acc, a) => acc + a.firstPassRate, 0) /
              snapshot.adapters.length) *
            100
          ).toFixed(1)
        : '0.0';

    const handleCreateAgent = async (): Promise<void> => {
      if (!agId.trim() || !agLabel.trim() || !agCommand.trim()) return;
      setBusy(true);
      try {
        await forgeApi.registerAdapter({
          id: agId
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-'),
          label: agLabel.trim(),
          specialty:
            agSpec.trim() ||
            tr(
              lang,
              '自治软件工程切片专家',
              'Autonomous Engineering Specialist',
            ),
          sovereignSoul:
            agSoul.trim() ||
            `You are ${agLabel.trim()}, a specialized software engineering agent at ForgeOps.`,
          transport: agTransport,
          command: agCommand.trim(),
          baseArgs: [],
          healthProbeArgs: ['--version'],
          mcpInjection: 'env-url',
          jsonlParser: 'generic-jsonl',
          permissionFlags: {turbo: [], supervised: [], strict: []},
          envAllowlist: [],
          defaultModel: agModel.trim() || 'deepseek-chat',
          supportedRoles: ['worker', 'specialist'],
          maxConcurrentSlots: 2,
        });
        setAgId('');
        setAgLabel('');
        setAgSpec('');
        setAgSoul('');
        setAgCommand('');
        setShowNewAgentModal(false);
        onRefresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    if (profileAdapter) {
      const m = profileAdapter.manifest;
      return (
        <div className="page-scroll">
          <div className="market-shell" style={{paddingTop: 18}}>
            <div style={{marginBottom: 16}}>
              <button
                type="button"
                className="topbar-util-btn"
                style={{color: '#ffffff', fontWeight: 600}}
                onClick={() => setProfileAdapterId(null)}
              >
                <ArrowLeftIcon size={15} />{' '}
                {tr(lang, '返回智能体市场', 'Back to Market')}
              </button>
            </div>

            <div className="market-white-tray">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '320px 1fr',
                  gap: 20,
                  alignItems: 'start',
                }}
              >
                {/* Left Sovereign Card */}
                <div
                  className="surface-card"
                  style={{padding: 24, textAlign: 'center'}}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      marginBottom: 12,
                    }}
                  >
                    <RobotAvatar seed={m.id} size={92} />
                  </div>
                  <div
                    style={{fontSize: 17, fontWeight: 800, marginBottom: 10}}
                  >
                    {m.label}
                  </div>
                  <div className="field-label" style={{textAlign: 'center'}}>
                    {tr(lang, '专长领域', 'SPECIALTY')}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                      marginBottom: 18,
                    }}
                  >
                    <span className="tag tag-blue">
                      {formatRoleBadge(lang, m.supportedRoles[0])}
                    </span>
                    <span className="tag tag-blue">
                      {m.specialty
                        .split(/[,/&]+/)[0]
                        ?.trim()
                        .split(/\s+/)
                        .slice(0, 3)
                        .join(' ')}
                    </span>
                  </div>

                  <div
                    style={{
                      borderTop: '1px solid #f1f5f9',
                      borderBottom: '1px solid #f1f5f9',
                      padding: '14px 0',
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      rowGap: 14,
                    }}
                  >
                    <div>
                      <div className="field-label">
                        {tr(lang, '一次通过率', 'SUCCESS')}
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: '#d97706',
                        }}
                      >
                        {Math.round(profileAdapter.firstPassRate * 100)}%
                      </div>
                    </div>
                    <div>
                      <div className="field-label">
                        {tr(lang, '认证切片数', 'SLICES')}
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: '#2563eb',
                        }}
                      >
                        {profileAdapter.rollingScoredSlices}
                      </div>
                    </div>
                    <div>
                      <div className="field-label">
                        {tr(lang, '缓存命中率', 'EFFICIENCY')}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#4f46e5',
                        }}
                      >
                        {profileAdapter.rollingScoredSlices > 0
                          ? `${Math.round(profileAdapter.cacheHitRatio * 100)}% cache`
                          : tr(lang, '待采样', 'N/A')}
                      </div>
                    </div>
                    <div>
                      <div className="field-label">
                        {tr(lang, '默认模型', 'MODEL')}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#b45309',
                        }}
                      >
                        {m.defaultModel}
                      </div>
                    </div>
                  </div>

                  <div style={{textAlign: 'left', marginTop: 14}}>
                    <div className="field-label">
                      {tr(lang, '宪法契约版本', 'SOUL VERSION')}
                    </div>
                    <span className="tag tag-green">2.2.0</span>
                  </div>
                </div>

                {/* Right Identity + DNA Prompt + Capabilities */}
                <div
                  style={{display: 'flex', flexDirection: 'column', gap: 16}}
                >
                  <div className="surface-card">
                    <div className="surface-card-header">
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 7,
                        }}
                      >
                        <ShieldIcon size={14} />{' '}
                        {tr(lang, '主权角色身份', 'Sovereign Identity')}
                      </span>
                    </div>
                    <div className="surface-card-body">
                      {m.label} — {m.specialty}
                    </div>
                  </div>

                  <div className="surface-card">
                    <div className="surface-card-header">
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 7,
                        }}
                      >
                        <ZapIcon size={14} />{' '}
                        {tr(
                          lang,
                          'DNA 系统逻辑提示词（支持精确选中复制）',
                          'DNA Prompt (System Logic)',
                        )}
                      </span>
                    </div>
                    <div className="surface-card-body">
                      <div className="dna-prompt-box selectable">
                        {m.sovereignSoul}
                      </div>
                    </div>
                  </div>

                  <div className="surface-card">
                    <div className="surface-card-header">
                      <span>
                        {tr(
                          lang,
                          '运行时能力与单次鉴权绑定',
                          'Capabilities & Runtime Bindings',
                        )}
                      </span>
                    </div>
                    <div
                      className="surface-card-body"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div className="field-label">
                          {tr(lang, '自动装载工程契约', 'SPECIALIZED SKILLS')}
                        </div>
                        <div style={{color: '#64748b', fontSize: 12.5}}>
                          {tr(
                            lang,
                            '自动前置注入最高工程宪法 + 仓库所属限界上下文 DDD 通用语言词典',
                            'Auto-loads Hub Constitution + DDD Ubiquitous Language',
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="field-label">
                          {tr(lang, '授权 MCP 工具链', 'MCP TOOLS')}
                        </div>
                        <div
                          style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}
                        >
                          <span className="tag tag-green">
                            forge_get_contract
                          </span>
                          <span className="tag tag-green">
                            forge_report_progress
                          </span>
                          <span className="tag tag-green">forge_ask_human</span>
                          <span className="tag tag-green">forge_submit</span>
                        </div>
                      </div>
                      <div>
                        <div className="field-label">
                          {tr(
                            lang,
                            '接入协议与可执行程序',
                            'TRANSPORT & BINARY',
                          )}
                        </div>
                        <span className="tag selectable">
                          {m.transport} · {m.command}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="page-scroll">
        <div className="market-shell">
          <div className="market-hero">
            <div className="market-hero-pill">
              <SparklesIcon size={13} />{' '}
              {tr(lang, '智能体工厂市场', 'Agent Factory Market')}
            </div>
            <h1>
              {tr(lang, '发现专家级工程智能体', 'Discover Expert Agents')}
            </h1>
            <p>
              {tr(
                lang,
                '为多仓项目编排具备独立主权灵魂（Sovereign Soul）、统一 MCP 工具契约与真实历史一次通过率遥测的编码与审计专家。',
                'Hire specialized AI agents for your projects. Each agent possesses its own Sovereign Soul, unique capabilities, and proven track record of success.',
              )}
            </p>
            <button
              type="button"
              className="btn"
              style={{
                background: '#ffffff',
                color: '#4f46e5',
                borderColor: '#ffffff',
                fontWeight: 700,
                height: 36,
                padding: '0 18px',
              }}
              onClick={() => setShowNewAgentModal(true)}
            >
              <PlusIcon size={14} /> {tr(lang, '添加新智能体', 'Add New Agent')}
            </button>

            <div className="market-stats-row">
              <div>
                <div style={{fontSize: 11.5, opacity: 0.88}}>
                  {tr(lang, '已接入智能体', 'Total Agents')}
                </div>
                <div className="market-stat-val">
                  {snapshot.adapters.length}
                </div>
              </div>
              <div>
                <div style={{fontSize: 11.5, opacity: 0.88}}>
                  {tr(lang, '平均一次通过率', 'Avg Success Rate')}
                </div>
                <div className="market-stat-val">{avgSuccess}%</div>
              </div>
              <div>
                <div style={{fontSize: 11.5, opacity: 0.88}}>
                  {tr(lang, '累计认证切片', 'Slices Certified')}
                </div>
                <div className="market-stat-val">{totalSlices}</div>
              </div>
            </div>
          </div>

          <div className="market-white-tray">
            <div className="agent-cards-grid">
              {snapshot.adapters.map(a => {
                const m = a.manifest;
                const roleTag = formatRoleBadge(lang, m.supportedRoles[0]);
                const cleanSpecTag =
                  m.specialty
                    .split(/[,/&]+/)[0]
                    ?.trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .join(' ') || 'Autonomous';
                return (
                  <div key={m.id} className="agent-card">
                    <button
                      type="button"
                      disabled={m.builtIn}
                      title={
                        m.builtIn
                          ? tr(
                              lang,
                              '系统内置核心适配器不可删除',
                              'Built-in core agent',
                            )
                          : tr(lang, '删除自定义智能体', 'Delete custom agent')
                      }
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        border: 'none',
                        background: 'transparent',
                        color: m.builtIn ? '#e2e8f0' : '#fca5a5',
                        cursor: m.builtIn ? 'default' : 'pointer',
                        padding: 4,
                      }}
                      onClick={() => {
                        if (m.builtIn) return;
                        void forgeApi
                          .deleteAdapter(m.id)
                          .then(() => onRefresh())
                          .catch(err =>
                            onError(
                              err instanceof Error ? err.message : String(err),
                            ),
                          );
                      }}
                    >
                      <TrashIcon size={12} />
                    </button>
                    <RobotAvatar seed={m.id} size={68} />
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: '#0f172a',
                        marginTop: 8,
                      }}
                    >
                      {m.label}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                        padding: '6px 14px 4px',
                      }}
                    >
                      <span className="tag tag-blue">{roleTag}</span>
                      <span className="tag tag-blue">{cleanSpecTag}</span>
                    </div>

                    <div className="agent-card-metrics">
                      <div>
                        <div style={{fontSize: 10.5, color: '#94a3b8'}}>
                          {tr(lang, '通过率', 'Success')}
                        </div>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 800,
                            color: '#d97706',
                          }}
                        >
                          {Math.round(a.firstPassRate * 100)}%
                        </div>
                      </div>
                      <div>
                        <div style={{fontSize: 10.5, color: '#94a3b8'}}>
                          {tr(lang, '切片数', 'Slices')}
                        </div>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 800,
                            color: '#2563eb',
                          }}
                        >
                          {a.rollingScoredSlices}
                        </div>
                      </div>
                      <div>
                        <div style={{fontSize: 10.5, color: '#94a3b8'}}>
                          {tr(lang, '并发槽', 'Slots')}
                        </div>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 800,
                            color: '#4f46e5',
                          }}
                        >
                          {m.maxConcurrentSlots}
                        </div>
                      </div>
                    </div>

                    <div className="agent-card-footer">
                      <button
                        type="button"
                        className="agent-footer-action"
                        onClick={() => setProfileAdapterId(m.id)}
                      >
                        <InfoIcon size={13} />{' '}
                        {tr(lang, '查看档案', 'View Profile')}
                      </button>
                      <button
                        type="button"
                        className="agent-footer-action"
                        disabled={m.builtIn}
                        title={
                          m.builtIn
                            ? tr(
                                lang,
                                '系统内置核心智能体受保护',
                                'Built-in core agent cannot be deleted',
                              )
                            : tr(lang, '删除智能体', 'Delete custom agent')
                        }
                        onClick={() => {
                          void forgeApi
                            .deleteAdapter(m.id)
                            .then(() => onRefresh())
                            .catch(err =>
                              onError(
                                err instanceof Error
                                  ? err.message
                                  : String(err),
                              ),
                            );
                        }}
                      >
                        <TrashIcon size={13} /> {tr(lang, '删除', 'Delete')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {showNewAgentModal && (
          <div
            className="modal-backdrop"
            onClick={() => setShowNewAgentModal(false)}
          >
            <div className="modal-card" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span>
                  {tr(
                    lang,
                    '注册自定义专家智能体适配器',
                    'Add New Expert Agent Adapter',
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowNewAgentModal(false)}
                >
                  ✕
                </button>
              </div>
              <div
                className="modal-body"
                style={{display: 'flex', flexDirection: 'column', gap: 12}}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  <div>
                    <label className="field-label">
                      {tr(lang, '智能体唯一标识 ID', 'Agent ID')}
                    </label>
                    <input
                      placeholder="e.g. aider-architect"
                      value={agId}
                      onChange={e => setAgId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">
                      {tr(lang, '显示名称', 'Display Name')}
                    </label>
                    <input
                      placeholder={tr(
                        lang,
                        '如：Aider 重构架构师',
                        'e.g. Aider Architect',
                      )}
                      value={agLabel}
                      onChange={e => setAgLabel(e.target.value)}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  <div>
                    <label className="field-label">
                      {tr(lang, '通信接入标准', 'Transport Protocol')}
                    </label>
                    <select
                      value={agTransport}
                      onChange={e =>
                        setAgTransport(e.target.value as AdapterTransport)
                      }
                    >
                      <option value="cli-stream">
                        {tr(lang, 'CLI JSONL 命令行流', 'CLI JSONL Stream')}
                      </option>
                      <option value="acp-stdio">
                        {tr(
                          lang,
                          'ACP JSON-RPC 标准协议',
                          'ACP Stdio Protocol',
                        )}
                      </option>
                      <option value="native-api">
                        {tr(
                          lang,
                          '原生 HTTP 大模型 API',
                          'Native HTTP LLM API',
                        )}
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">
                      {tr(lang, '可执行程序命令', 'Executable Command')}
                    </label>
                    <input
                      placeholder="e.g. aider"
                      value={agCommand}
                      onChange={e => setAgCommand(e.target.value)}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  <div>
                    <label className="field-label">
                      {tr(lang, '工程专长标签', 'Specialty')}
                    </label>
                    <input
                      placeholder={tr(
                        lang,
                        '如：领域建模与跨仓重构',
                        'e.g. Domain Refactoring',
                      )}
                      value={agSpec}
                      onChange={e => setAgSpec(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">
                      {tr(lang, '默认推理模型', 'Default Model')}
                    </label>
                    <input
                      value={agModel}
                      onChange={e => setAgModel(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="field-label">
                    {tr(lang, '主权 DNA 系统提示词', 'Sovereign DNA Prompt')}
                  </label>
                  <textarea
                    rows={3}
                    placeholder={tr(
                      lang,
                      '定义该智能体的角色边界、质量红线与契约遵守准则...',
                      'System persona and engineering invariants...',
                    )}
                    value={agSoul}
                    onChange={e => setAgSoul(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowNewAgentModal(false)}
                >
                  {tr(lang, '取消', 'Cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    busy || !agId.trim() || !agLabel.trim() || !agCommand.trim()
                  }
                  onClick={() => void handleCreateAgent()}
                >
                  {tr(lang, '确认注册', 'Register Agent')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // 2. MODELS POOL (1:1 Reference Match + Bilingual)
  // =========================================================================
  if (section === 'models') {
    const selectedProvider = snapshot.providers.find(
      p => p.id === activeProviderId,
    );

    const handleSaveProvider = async (): Promise<void> => {
      if (!editingProvider) return;
      setBusy(true);
      try {
        await forgeApi.updateProviderSecret({
          providerId: editingProvider.id,
          baseUrl: provBaseUrl.trim() || undefined,
          apiKey: provApiKey.trim() || undefined,
        });
        setEditingProvider(null);
        setProvApiKey('');
        onRefresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="page-scroll">
        <div className="page-header">
          <h1 className="page-h1">
            {tr(lang, '大模型路由池 (Models Pool)', 'LLM')}
          </h1>
          <p className="page-subtitle">
            {tr(
              lang,
              '选择默认编排与审计大模型；所有商业 API 密钥仅单向写入宿主机加密保险箱，前端零明文暴露。',
              'Choose the active LLM model from an authorized provider.',
            )}
          </p>
        </div>

        <div className="surface-card" style={{marginBottom: 28}}>
          <div className="surface-card-header">
            <span>{tr(lang, '活跃大模型路由配置', 'LLM Configuration')}</span>
          </div>
          <div
            className="surface-card-body"
            style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}
          >
            <div>
              <label className="field-label">
                {tr(lang, '模型服务商 (Provider)', 'Provider')}
              </label>
              <select
                value={activeProviderId}
                onChange={e => setActiveProviderId(e.target.value)}
              >
                {snapshot.providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} (
                    {p.hasApiKey
                      ? tr(lang, '已授权密钥', 'Authorized')
                      : tr(lang, '待配置密钥', 'Configure API Key')}
                    )
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">
                {tr(lang, '候选模型规格 (Model)', 'Model')}
              </label>
              <select disabled={!selectedProvider}>
                {(selectedProvider?.models ?? []).map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="page-header" style={{marginBottom: 14}}>
          <h2 style={{margin: 0, fontSize: 18, fontWeight: 700}}>
            {tr(lang, '服务商授权矩阵', 'Providers')}
          </h2>
          <p className="page-subtitle">
            {tr(
              lang,
              '支持 OpenAI / Anthropic / DeepSeek / 通义千问 / 智谱 GLM / Kimi 等主流通道，兼容企业内网自建网关 Base URL。',
              'Configure API keys and endpoints for each provider. Keys are stored exclusively in the Host Secret Vault.',
            )}
          </p>
        </div>

        <div className="providers-grid">
          {snapshot.providers.map(p => (
            <div key={p.id} className="provider-card">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                  <span
                    style={{fontSize: 14.5, fontWeight: 700, color: '#0f172a'}}
                  >
                    {p.name}
                  </span>
                  <span className="tag tag-green">
                    {tr(lang, '内置通道', 'Built-in')}
                  </span>
                  <span
                    className={`tag ${p.hasApiKey ? 'tag-green' : 'tag-red'}`}
                  >
                    {p.hasApiKey
                      ? tr(lang, '已授权', 'Authorized')
                      : tr(lang, '未配密钥', 'Unauthorized')}
                  </span>
                </div>
                <span style={{fontSize: 11, color: '#94a3b8'}}>
                  ●{' '}
                  {p.hasApiKey
                    ? tr(lang, '通道就绪', 'Ready')
                    : tr(lang, '待配置凭证', 'Not Ready (not configured)')}
                </span>
              </div>

              <div className="provider-kv-grid">
                <span style={{color: '#64748b'}}>
                  {tr(lang, '接口地址:', 'Base URL:')}
                </span>
                <span
                  className="selectable"
                  style={{
                    color: '#1e293b',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {p.baseUrl}
                </span>

                <span style={{color: '#64748b'}}>
                  {tr(lang, '密钥状态:', 'API Key:')}
                </span>
                <span
                  style={{
                    color: p.hasApiKey ? '#16a34a' : '#94a3b8',
                    fontStyle: p.hasApiKey ? 'normal' : 'italic',
                  }}
                >
                  {p.hasApiKey
                    ? p.maskedKeyHint
                    : tr(lang, '未设置', 'Not set')}
                </span>

                <span style={{color: '#64748b'}}>
                  {tr(lang, '支持模型:', 'Model:')}
                </span>
                <span style={{fontWeight: 600, color: '#1e293b'}}>
                  {tr(
                    lang,
                    `${p.models.length} 款预置模型`,
                    `${p.models.length} models`,
                  )}
                </span>
              </div>

              <div
                style={{
                  marginTop: 'auto',
                  paddingTop: 8,
                  borderTop: '1px solid #f8fafc',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 14,
                }}
              >
                <button
                  type="button"
                  className="topbar-util-btn"
                  style={{color: '#3b82f6', fontWeight: 600}}
                  onClick={() => setViewingModelsProvider(p)}
                >
                  <GridIcon size={13} /> {tr(lang, '模型清单', 'Models')}
                </button>
                <button
                  type="button"
                  className="topbar-util-btn"
                  style={{color: '#3b82f6', fontWeight: 600}}
                  onClick={() => {
                    setEditingProvider(p);
                    setProvBaseUrl(p.baseUrl);
                    setProvApiKey('');
                  }}
                >
                  <SettingsIcon size={13} /> {tr(lang, '配置密钥', 'Settings')}
                </button>
              </div>
            </div>
          ))}
        </div>

        {editingProvider && (
          <div
            className="modal-backdrop"
            onClick={() => setEditingProvider(null)}
          >
            <div className="modal-card" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span>
                  {tr(
                    lang,
                    `配置 ${editingProvider.name} 接入凭证`,
                    `Configure ${editingProvider.name}`,
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setEditingProvider(null)}
                >
                  ✕
                </button>
              </div>
              <div
                className="modal-body"
                style={{display: 'flex', flexDirection: 'column', gap: 12}}
              >
                <div>
                  <label className="field-label">
                    {tr(
                      lang,
                      '网关接口地址 (Base Endpoint URL)',
                      'Base Endpoint URL',
                    )}
                  </label>
                  <input
                    value={provBaseUrl}
                    onChange={e => setProvBaseUrl(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">
                    {tr(
                      lang,
                      'API Key（单向存入宿主隔离保险箱，前端永不回显明文）',
                      'API Key (Stored in Host Vault — Never Returned to Renderer)',
                    )}
                  </label>
                  <input
                    type="password"
                    placeholder={
                      editingProvider.hasApiKey
                        ? tr(
                            lang,
                            `当前已保存掩码：${editingProvider.maskedKeyHint}`,
                            `Current: ${editingProvider.maskedKeyHint}`,
                          )
                        : 'sk-...'
                    }
                    value={provApiKey}
                    onChange={e => setProvApiKey(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditingProvider(null)}
                >
                  {tr(lang, '取消', 'Cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void handleSaveProvider()}
                >
                  {tr(lang, '安全保存凭证', 'Save Credentials')}
                </button>
              </div>
            </div>
          </div>
        )}

        {viewingModelsProvider && (
          <div
            className="modal-backdrop"
            onClick={() => setViewingModelsProvider(null)}
          >
            <div className="modal-card" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span>
                  {viewingModelsProvider.name} —{' '}
                  {tr(lang, '预置模型规格表', 'Model Catalog')}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setViewingModelsProvider(null)}
                >
                  ✕
                </button>
              </div>
              <div className="modal-body">
                {viewingModelsProvider.models.map(m => (
                  <div
                    key={m.id}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #f1f5f9',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{fontWeight: 700}}>{m.label}</div>
                      <div
                        className="selectable"
                        style={{
                          fontSize: 11.5,
                          color: '#64748b',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {m.id}
                      </div>
                    </div>
                    <div style={{display: 'flex', gap: 6}}>
                      <span className="tag tag-indigo">{m.tier}</span>
                      <span className="tag">
                        {Math.round(m.contextWindowTokens / 1000)}k ctx
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // 3. SKILLS BANK & DDD UBIQUITOUS LANGUAGE STUDIO
  // =========================================================================
  if (section === 'skills') {
    const hubTerms = snapshot.domainTerms.filter(t => t.hubId === activeHubId);

    return (
      <div className="page-scroll">
        <div className="page-header">
          <h1 className="page-h1">
            <ZapIcon size={20} />{' '}
            {tr(
              lang,
              '技能银行与 DDD 领域通用语言工坊',
              'Skills Bank & Ubiquitous Language',
            )}
          </h1>
          <p className="page-subtitle">
            {tr(
              lang,
              '沉淀跨项目复用的软件工程提示词技能包，并锁定限界上下文（Bounded Context）标准代码命名与禁用同义词黑名单。',
              'Reusable engineering prompt skills and DDD Bounded Context canonical terminology guards.',
            )}
          </p>
        </div>

        <div className="underline-tabs" style={{marginBottom: 20}}>
          <button
            type="button"
            className={`underline-tab ${skillsSubTab === 'ddd' ? 'active' : ''}`}
            onClick={() => setSkillsSubTab('ddd')}
          >
            {tr(
              lang,
              `DDD 领域通用语言词典 (${hubTerms.length})`,
              `DDD Ubiquitous Language (${hubTerms.length})`,
            )}
          </button>
          <button
            type="button"
            className={`underline-tab ${skillsSubTab === 'skills' ? 'active' : ''}`}
            onClick={() => setSkillsSubTab('skills')}
          >
            {tr(
              lang,
              `工程提示词技能银行 (${snapshot.skills.length})`,
              `Prompt Skills Bank (${snapshot.skills.length})`,
            )}
          </button>
        </div>

        {skillsSubTab === 'skills' ? (
          <div
            style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18}}
          >
            <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
              {snapshot.skills.map(s => (
                <div key={s.id} className="surface-card">
                  <div className="surface-card-header">
                    <span>{s.title}</span>
                    <div style={{display: 'flex', gap: 6}}>
                      <span className="tag tag-indigo">{s.category}</span>
                      <span className="tag">v{s.version}</span>
                    </div>
                  </div>
                  <div className="surface-card-body">
                    <div
                      className="selectable"
                      style={{
                        fontSize: 12.5,
                        color: '#334155',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {s.promptBody}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="surface-card">
              <div className="surface-card-header">
                <span>
                  {tr(lang, '发布 / 更新技能词条', 'Publish / Update Skill')}
                </span>
              </div>
              <div
                className="surface-card-body"
                style={{display: 'flex', flexDirection: 'column', gap: 10}}
              >
                <input
                  placeholder={tr(
                    lang,
                    '唯一标识 Slug（如 ddd-boundary-guard）',
                    'Slug (e.g. ddd-boundary-guard)',
                  )}
                  value={skillSlug}
                  onChange={e => setSkillSlug(e.target.value)}
                />
                <input
                  placeholder={tr(lang, '技能标题', 'Skill Title')}
                  value={skillTitle}
                  onChange={e => setSkillTitle(e.target.value)}
                />
                <select
                  value={skillCat}
                  onChange={e =>
                    setSkillCat(e.target.value as SkillEntry['category'])
                  }
                >
                  <option value="grill">
                    {tr(lang, '需求拷问 (grill)', 'grill')}
                  </option>
                  <option value="ddd">
                    {tr(lang, '领域驱动建模 (ddd)', 'ddd')}
                  </option>
                  <option value="architecture">
                    {tr(lang, '架构设计 (architecture)', 'architecture')}
                  </option>
                  <option value="qa">{tr(lang, '质量审计 (qa)', 'qa')}</option>
                  <option value="retro">
                    {tr(lang, '交付复盘 (retro)', 'retro')}
                  </option>
                  <option value="infra">
                    {tr(lang, '基建治理 (infra)', 'infra')}
                  </option>
                </select>
                <textarea
                  rows={5}
                  placeholder={tr(
                    lang,
                    '编写可跨仓库注入的标准化工程技能指令...',
                    'Reusable skill instructions...',
                  )}
                  value={skillBody}
                  onChange={e => setSkillBody(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    !skillSlug.trim() || !skillTitle.trim() || !skillBody.trim()
                  }
                  onClick={() => {
                    void forgeApi
                      .upsertSkill({
                        slug: skillSlug.trim(),
                        title: skillTitle.trim(),
                        category: skillCat,
                        version: '1.1.0',
                        promptBody: skillBody.trim(),
                      })
                      .then(() => {
                        setSkillSlug('');
                        setSkillTitle('');
                        setSkillBody('');
                        onRefresh();
                      });
                  }}
                >
                  {tr(lang, '保存至技能银行', 'Save Skill to Bank')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18}}
          >
            <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
              {hubTerms.map(t => (
                <div key={t.id} className="surface-card">
                  <div className="surface-card-header">
                    <span className="selectable">
                      {t.canonicalTerm}{' '}
                      {t.localLabel ? `(${t.localLabel})` : ''}
                    </span>
                    <span className="tag tag-indigo">{t.boundedContext}</span>
                  </div>
                  <div className="surface-card-body">
                    <div className="selectable" style={{marginBottom: 8}}>
                      {t.definition}
                    </div>
                    {t.forbiddenAliases.length > 0 && (
                      <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                        {t.forbiddenAliases.map(alias => (
                          <span key={alias} className="tag tag-red">
                            {tr(
                              lang,
                              `禁用同义词: ${alias}`,
                              `Forbidden: ${alias}`,
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="surface-card">
              <div className="surface-card-header">
                <span>
                  {tr(lang, '锁定 DDD 标准领域术语', 'Lock DDD Canonical Term')}
                </span>
              </div>
              <div
                className="surface-card-body"
                style={{display: 'flex', flexDirection: 'column', gap: 10}}
              >
                <input
                  placeholder={tr(
                    lang,
                    '所属限界上下文（如 Settlement）',
                    'Bounded Context (e.g. Settlement)',
                  )}
                  value={termCtx}
                  onChange={e => setTermCtx(e.target.value)}
                />
                <input
                  placeholder={tr(
                    lang,
                    '标准代码标识符（如 ReconciliationBatch）',
                    'Canonical Identifier (e.g. ReconciliationBatch)',
                  )}
                  value={termCanonical}
                  onChange={e => setTermCanonical(e.target.value)}
                />
                <input
                  placeholder={tr(
                    lang,
                    '中文业务标准名（如 对账批次）',
                    'Local Business Label (e.g. 对账批次)',
                  )}
                  value={termLocal}
                  onChange={e => setTermLocal(e.target.value)}
                />
                <textarea
                  rows={3}
                  placeholder={tr(
                    lang,
                    '精确定义该领域概念的不变量、生命周期与跨服务边界...',
                    'Exact domain invariant definition...',
                  )}
                  value={termDef}
                  onChange={e => setTermDef(e.target.value)}
                />
                <input
                  placeholder={tr(
                    lang,
                    '严禁混用的同义词黑名单（逗号分隔，SQA 将据此拦截漂移）',
                    'Forbidden synonyms (comma-separated)',
                  )}
                  value={termForbidden}
                  onChange={e => setTermForbidden(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!termCanonical.trim() || !termDef.trim()}
                  onClick={() => {
                    void forgeApi
                      .upsertDomainTerm({
                        hubId: activeHubId,
                        boundedContext: termCtx.trim() || 'Core',
                        owningRepoIds: [],
                        canonicalTerm: termCanonical.trim(),
                        localLabel: termLocal.trim(),
                        definition: termDef.trim(),
                        forbiddenAliases: termForbidden
                          .split(',')
                          .map(s => s.trim())
                          .filter(Boolean),
                        schemaAnchors: [],
                      })
                      .then(() => {
                        setTermCanonical('');
                        setTermLocal('');
                        setTermDef('');
                        setTermForbidden('');
                        onRefresh();
                      });
                  }}
                >
                  {tr(lang, '写入通用语言词典', 'Lock Canonical Term')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // 4. MCP PROTOCOL (Scoped Loopback Station)
  // =========================================================================
  const mcpTools = [
    {
      name: 'forge_get_contract',
      descZh:
        '拉取当前锁定开发切片的职责边界、允许改动文件白名单、DDD 通用语言术语表及四段式认知移交状态。',
      descEn:
        'Fetches locked slice mandate, allowed file scope, DDD Ubiquitous Language terms, and Epistemic Rollover state.',
    },
    {
      name: 'forge_report_progress',
      descZh:
        '通过多路复用 SSE 将智能体实时执行进度帧推回工作台双生图与监控面板。',
      descEn:
        'Streams live execution progress frames back to the Workstation Twin Graph over multiplexed SSE.',
    },
    {
      name: 'forge_ask_human',
      descZh:
        '遭遇模糊领域边界或权限红线时，向人类决策队列推送「一卡一决策（推荐项置顶）」请求。',
      descEn:
        'Raises a prioritized 1-Card-1-Decision human attention item when ambiguous domain boundaries arise.',
    },
    {
      name: 'forge_propose_amendment',
      descZh:
        '在发现缺失前置代码契约时，申请在当前节点前动态无环插入虚线 GhostNode 修订任务。',
      descEn:
        'Proposes an acyclic GhostNode runtime DAG amendment immediately upstream of the active slice.',
    },
    {
      name: 'forge_submit',
      descZh:
        '提交切片总结、已证实规格事实（specConfirmedFacts）与智能体假设，随后移交外部宿主机硬门禁与双级 TQLA 审计。',
      descEn:
        'Submits final slice summary, specConfirmedFacts, and agentHypotheses before external Hard Gates & TQLA.',
    },
  ];

  return (
    <div className="page-scroll">
      <div className="page-header">
        <h1 className="page-h1">
          <PlugIcon size={20} />{' '}
          {tr(
            lang,
            'MCP 协议本地回环总站 (forge_station)',
            'MCP Protocol Station',
          )}
        </h1>
        <p className="page-subtitle">
          {tr(
            lang,
            '仅绑定本机 127.0.0.1 的 JSON-RPC 2.0 MCP 服务，每次切片尝试签发独立高熵 CSPRNG Bearer 令牌，结束后立即吊销。',
            'Loopback-bound JSON-RPC 2.0 MCP server (forge_station) with per-slice ephemeral CSPRNG Bearer token isolation.',
          )}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 16,
        }}
      >
        {mcpTools.map(tool => (
          <div key={tool.name} className="surface-card">
            <div className="surface-card-header">
              <span
                className="selectable"
                style={{fontFamily: 'var(--font-mono)', color: '#4f46e5'}}
              >
                {tool.name}
              </span>
              <span className="tag tag-green">
                {tr(lang, '单次令牌隔离', 'Bearer Scoped')}
              </span>
            </div>
            <div className="surface-card-body" style={{color: '#475569'}}>
              {tr(lang, tool.descZh, tool.descEn)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

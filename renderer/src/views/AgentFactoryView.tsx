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

export type AgentFactorySection = 'market' | 'models' | 'skills' | 'mcp';

export function AgentFactoryView(props: {
  readonly section: AgentFactorySection;
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly onRefresh: () => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {section, snapshot, activeHubId, onRefresh, onError} = props;

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
  const [skillsSubTab, setSkillsSubTab] = useState<'skills' | 'ddd'>('skills');
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
  // 1. AGENTS MARKET & AGENT PROFILE (1:1 Reference Match)
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
          specialty: agSpec.trim() || 'Autonomous Engineering Specialist',
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
                <ArrowLeftIcon size={15} /> Back to Market
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
                    SPECIALTY
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
                      {m.supportedRoles[0]?.toUpperCase() ?? 'DEV'}
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
                      <div className="field-label">SUCCESS</div>
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
                      <div className="field-label">SLICES</div>
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
                      <div className="field-label">EFFICIENCY</div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#4f46e5',
                        }}
                      >
                        {profileAdapter.rollingScoredSlices > 0
                          ? `${Math.round(profileAdapter.cacheHitRatio * 100)}% cache`
                          : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="field-label">MODEL</div>
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
                    <div className="field-label">SOUL VERSION</div>
                    <span className="tag tag-green">2.1.0</span>
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
                        <ShieldIcon size={14} /> Sovereign Identity
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
                        <ZapIcon size={14} /> DNA Prompt (System Logic)
                      </span>
                    </div>
                    <div className="surface-card-body">
                      <div className="dna-prompt-box">{m.sovereignSoul}</div>
                    </div>
                  </div>

                  <div className="surface-card">
                    <div className="surface-card-header">
                      <span>Capabilities & Runtime Bindings</span>
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
                        <div className="field-label">SPECIALIZED SKILLS</div>
                        <div style={{color: '#64748b', fontSize: 12.5}}>
                          Auto-loads Hub Constitution + DDD Ubiquitous Language
                        </div>
                      </div>
                      <div>
                        <div className="field-label">MCP TOOLS</div>
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
                        <div className="field-label">TRANSPORT & BINARY</div>
                        <span className="tag">
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
              <SparklesIcon size={13} /> Agent Factory Market
            </div>
            <h1>Discover Expert Agents</h1>
            <p>
              Hire specialized AI agents for your projects. Each agent possesses
              its own Sovereign Soul, unique capabilities, and proven track
              record of success.
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
              <PlusIcon size={14} /> Add New Agent
            </button>

            <div className="market-stats-row">
              <div>
                <div style={{fontSize: 11.5, opacity: 0.88}}>Total Agents</div>
                <div className="market-stat-val">
                  {snapshot.adapters.length}
                </div>
              </div>
              <div>
                <div style={{fontSize: 11.5, opacity: 0.88}}>
                  Avg Success Rate
                </div>
                <div className="market-stat-val">{avgSuccess}%</div>
              </div>
              <div>
                <div style={{fontSize: 11.5, opacity: 0.88}}>
                  Slices Certified
                </div>
                <div className="market-stat-val">{totalSlices}</div>
              </div>
            </div>
          </div>

          <div className="market-white-tray">
            <div className="agent-cards-grid">
              {snapshot.adapters.map(a => {
                const m = a.manifest;
                const roleTag = (m.supportedRoles[0] ?? 'DEV').toUpperCase();
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
                          ? 'Built-in core agent'
                          : 'Delete custom agent'
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
                          Success
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
                          Slices
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
                          Slots
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
                        <InfoIcon size={13} /> View Profile
                      </button>
                      <button
                        type="button"
                        className="agent-footer-action"
                        disabled={m.builtIn}
                        title={
                          m.builtIn
                            ? 'Built-in core agent cannot be deleted'
                            : 'Delete custom agent'
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
                        <TrashIcon size={13} /> Delete
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
                <span>Add New Expert Agent Adapter</span>
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
                    <label className="field-label">Agent ID</label>
                    <input
                      placeholder="e.g. aider-architect"
                      value={agId}
                      onChange={e => setAgId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">Display Name</label>
                    <input
                      placeholder="e.g. Aider Architect"
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
                    <label className="field-label">Transport Protocol</label>
                    <select
                      value={agTransport}
                      onChange={e =>
                        setAgTransport(e.target.value as AdapterTransport)
                      }
                    >
                      <option value="cli-stream">CLI JSONL Stream</option>
                      <option value="acp-stdio">ACP Stdio Protocol</option>
                      <option value="native-api">Native HTTP LLM API</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Executable Command</label>
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
                    <label className="field-label">Specialty</label>
                    <input
                      placeholder="e.g. Domain Refactoring"
                      value={agSpec}
                      onChange={e => setAgSpec(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">Default Model</label>
                    <input
                      value={agModel}
                      onChange={e => setAgModel(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="field-label">Sovereign DNA Prompt</label>
                  <textarea
                    rows={3}
                    placeholder="System persona and engineering invariants..."
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
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    busy || !agId.trim() || !agLabel.trim() || !agCommand.trim()
                  }
                  onClick={() => void handleCreateAgent()}
                >
                  Register Agent
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // 2. MODELS POOL (1:1 Reference Match)
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
          <h1 className="page-h1">LLM</h1>
          <p className="page-subtitle">
            Choose the active LLM model from an authorized provider.
          </p>
        </div>

        <div className="surface-card" style={{marginBottom: 28}}>
          <div className="surface-card-header">
            <span>LLM Configuration</span>
          </div>
          <div
            className="surface-card-body"
            style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}
          >
            <div>
              <label className="field-label">Provider</label>
              <select
                value={activeProviderId}
                onChange={e => setActiveProviderId(e.target.value)}
              >
                {snapshot.providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.hasApiKey ? 'Authorized' : 'Configure API Key'}
                    )
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Model</label>
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
          <h2 style={{margin: 0, fontSize: 18, fontWeight: 700}}>Providers</h2>
          <p className="page-subtitle">
            Configure API keys and endpoints for each provider. Keys are stored
            exclusively in the Host Secret Vault.
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
                  <span className="tag tag-green">Built-in</span>
                  <span
                    className={`tag ${p.hasApiKey ? 'tag-green' : 'tag-red'}`}
                  >
                    {p.hasApiKey ? 'Authorized' : 'Unauthorized'}
                  </span>
                </div>
                <span style={{fontSize: 11, color: '#94a3b8'}}>
                  ● {p.hasApiKey ? 'Ready' : 'Not Ready (not configured)'}
                </span>
              </div>

              <div className="provider-kv-grid">
                <span style={{color: '#64748b'}}>Base URL:</span>
                <span
                  style={{
                    color: '#1e293b',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {p.baseUrl}
                </span>

                <span style={{color: '#64748b'}}>API Key:</span>
                <span
                  style={{
                    color: p.hasApiKey ? '#16a34a' : '#94a3b8',
                    fontStyle: p.hasApiKey ? 'normal' : 'italic',
                  }}
                >
                  {p.hasApiKey ? p.maskedKeyHint : 'Not set'}
                </span>

                <span style={{color: '#64748b'}}>Model:</span>
                <span style={{fontWeight: 600, color: '#1e293b'}}>
                  {p.models.length} models
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
                  <GridIcon size={13} /> Models
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
                  <SettingsIcon size={13} /> Settings
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
                <span>Configure {editingProvider.name}</span>
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
                  <label className="field-label">Base Endpoint URL</label>
                  <input
                    value={provBaseUrl}
                    onChange={e => setProvBaseUrl(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">
                    API Key (Stored in Host Vault — Never Returned to Renderer)
                  </label>
                  <input
                    type="password"
                    placeholder={
                      editingProvider.hasApiKey
                        ? `Current: ${editingProvider.maskedKeyHint}`
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
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void handleSaveProvider()}
                >
                  Save Credentials
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
                <span>{viewingModelsProvider.name} — Model Catalog</span>
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
            <ZapIcon size={20} /> Skills Bank & Ubiquitous Language
          </h1>
          <p className="page-subtitle">
            Reusable engineering prompt skills and DDD Bounded Context canonical
            terminology guards.
          </p>
        </div>

        <div className="underline-tabs" style={{marginBottom: 20}}>
          <button
            type="button"
            className={`underline-tab ${skillsSubTab === 'skills' ? 'active' : ''}`}
            onClick={() => setSkillsSubTab('skills')}
          >
            Prompt Skills Bank ({snapshot.skills.length})
          </button>
          <button
            type="button"
            className={`underline-tab ${skillsSubTab === 'ddd' ? 'active' : ''}`}
            onClick={() => setSkillsSubTab('ddd')}
          >
            DDD Ubiquitous Language ({hubTerms.length})
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
                <span>Publish / Update Skill</span>
              </div>
              <div
                className="surface-card-body"
                style={{display: 'flex', flexDirection: 'column', gap: 10}}
              >
                <input
                  placeholder="Slug (e.g. ddd-boundary-guard)"
                  value={skillSlug}
                  onChange={e => setSkillSlug(e.target.value)}
                />
                <input
                  placeholder="Skill Title"
                  value={skillTitle}
                  onChange={e => setSkillTitle(e.target.value)}
                />
                <select
                  value={skillCat}
                  onChange={e =>
                    setSkillCat(e.target.value as SkillEntry['category'])
                  }
                >
                  <option value="grill">grill</option>
                  <option value="ddd">ddd</option>
                  <option value="architecture">architecture</option>
                  <option value="qa">qa</option>
                  <option value="retro">retro</option>
                  <option value="infra">infra</option>
                </select>
                <textarea
                  rows={5}
                  placeholder="Reusable skill instructions..."
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
                  Save Skill to Bank
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
                    <span>
                      {t.canonicalTerm}{' '}
                      {t.localLabel ? `(${t.localLabel})` : ''}
                    </span>
                    <span className="tag tag-indigo">{t.boundedContext}</span>
                  </div>
                  <div className="surface-card-body">
                    <div style={{marginBottom: 8}}>{t.definition}</div>
                    {t.forbiddenAliases.length > 0 && (
                      <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                        {t.forbiddenAliases.map(alias => (
                          <span key={alias} className="tag tag-red">
                            Forbidden: {alias}
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
                <span>Lock DDD Canonical Term</span>
              </div>
              <div
                className="surface-card-body"
                style={{display: 'flex', flexDirection: 'column', gap: 10}}
              >
                <input
                  placeholder="Bounded Context (e.g. Settlement)"
                  value={termCtx}
                  onChange={e => setTermCtx(e.target.value)}
                />
                <input
                  placeholder="Canonical Identifier (e.g. ReconciliationBatch)"
                  value={termCanonical}
                  onChange={e => setTermCanonical(e.target.value)}
                />
                <input
                  placeholder="Local Business Label (e.g. 对账批次)"
                  value={termLocal}
                  onChange={e => setTermLocal(e.target.value)}
                />
                <textarea
                  rows={3}
                  placeholder="Exact domain invariant definition..."
                  value={termDef}
                  onChange={e => setTermDef(e.target.value)}
                />
                <input
                  placeholder="Forbidden synonyms (comma-separated)"
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
                  Lock Canonical Term
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
      desc: 'Fetches locked slice mandate, allowed file scope, DDD Ubiquitous Language terms, and Epistemic Rollover state.',
    },
    {
      name: 'forge_report_progress',
      desc: 'Streams live execution progress frames back to the Workstation Twin Graph over multiplexed SSE.',
    },
    {
      name: 'forge_ask_human',
      desc: 'Raises a prioritized 1-Card-1-Decision human attention item when ambiguous domain boundaries arise.',
    },
    {
      name: 'forge_propose_amendment',
      desc: 'Proposes an acyclic GhostNode runtime DAG amendment immediately upstream of the active slice.',
    },
    {
      name: 'forge_submit',
      desc: 'Submits final slice summary, specConfirmedFacts, and agentHypotheses before external Hard Gates & TQLA.',
    },
  ];

  return (
    <div className="page-scroll">
      <div className="page-header">
        <h1 className="page-h1">
          <PlugIcon size={20} /> MCP Protocol Station
        </h1>
        <p className="page-subtitle">
          Loopback-bound JSON-RPC 2.0 MCP server (`forge_station`) with
          per-slice ephemeral CSPRNG Bearer token isolation.
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
              <span style={{fontFamily: 'var(--font-mono)', color: '#4f46e5'}}>
                {tool.name}
              </span>
              <span className="tag tag-green">Bearer Scoped</span>
            </div>
            <div className="surface-card-body" style={{color: '#475569'}}>
              {tool.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

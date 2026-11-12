import React, {useState} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {
  AdapterHealthState,
  AdapterTransport,
  AgentAdapterManifest,
  PermissionTier,
  SkillEntry,
} from '../../../src/shared/types.ts';
import {type DoctorReportDto, forgeApi} from '../api/client.ts';

export interface InfraFactoryViewProps {
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onRefreshBootstrap: () => Promise<void>;
}

type InfraSubTab =
  'steward' | 'adapters' | 'providers' | 'constitution' | 'daemons';

function healthBadgeClass(health: AdapterHealthState): string {
  switch (health) {
    case 'healthy':
      return 'badge badge-emerald';
    case 'degraded':
      return 'badge badge-amber';
    case 'circuit_open':
      return 'badge badge-rose';
    case 'unprobed':
      return 'badge badge-slate';
  }
}

export function InfraFactoryView(
  props: InfraFactoryViewProps,
): React.ReactElement {
  const {snapshot, activeHubId, onOpenWorkstation, onRefreshBootstrap} = props;
  const effectiveHubId = activeHubId || snapshot.hubs[0]?.id || '';
  const infraRepos = snapshot.repositories.filter(r => r.tier === 'infra');

  const [subTab, setSubTab] = useState<InfraSubTab>('steward');
  const [doctorReport, setDoctorReport] = useState<DoctorReportDto | null>(
    null,
  );

  // Governed INFRA Evolution form state
  const [infraRepoId, setInfraRepoId] = useState('');
  const [evolveTitle, setEvolveTitle] = useState('');
  const [evolveRationale, setEvolveRationale] = useState('');
  const [evolveTier, setEvolveTier] = useState<PermissionTier>('turbo');

  // Register Custom Adapter Manifest form state
  const [adapterId, setAdapterId] = useState('');
  const [adapterLabel, setAdapterLabel] = useState('');
  const [adapterSpecialty, setAdapterSpecialty] = useState('');
  const [adapterSoul, setAdapterSoul] = useState('');
  const [adapterTransport, setAdapterTransport] =
    useState<AdapterTransport>('cli-stream');
  const [adapterCommand, setAdapterCommand] = useState('');
  const [adapterBaseArgs, setAdapterBaseArgs] = useState('run --json');
  const [adapterDefaultModel, setAdapterDefaultModel] = useState('default');

  // Provider Vault form state
  const [providerBaseUrls, setProviderBaseUrls] = useState<
    Record<string, string>
  >({});
  const [providerApiKeys, setProviderApiKeys] = useState<
    Record<string, string>
  >({});

  // Soul Constitution & Skills form state
  const [constitutionMd, setConstitutionMd] = useState(
    snapshot.constitution.markdown,
  );
  const [blockedCmdsText, setBlockedCmdsText] = useState(
    snapshot.constitution.blockedCommands.join('\n'),
  );
  const [skillSlug, setSkillSlug] = useState('');
  const [skillTitle, setSkillTitle] = useState('');
  const [skillCategory, setSkillCategory] =
    useState<SkillEntry['category']>('architecture');
  const [skillVersion, setSkillVersion] = useState('2.1.0');
  const [skillPrompt, setSkillPrompt] = useState('');

  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const handleRunDoctor = async (): Promise<void> => {
    setBusy(true);
    setStatusNote(null);
    try {
      const report = await forgeApi.runEnvironmentDoctor();
      setDoctorReport(report);
      await onRefreshBootstrap();
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleProposeInfraEvolution = async (
    e: React.FormEvent,
  ): Promise<void> => {
    e.preventDefault();
    const targetRepoId =
      infraRepoId || infraRepos[0]?.id || snapshot.repositories[0]?.id || '';
    if (!effectiveHubId || !targetRepoId || !evolveTitle.trim()) {
      return;
    }
    setBusy(true);
    setStatusNote(null);
    try {
      const created = await forgeApi.proposeInfraEvolution({
        hubId: effectiveHubId,
        infraRepoId: targetRepoId,
        title: evolveTitle.trim(),
        rationale: evolveRationale.trim(),
        permissionTier: evolveTier,
      });
      setEvolveTitle('');
      setEvolveRationale('');
      await onRefreshBootstrap();
      onOpenWorkstation(created.id);
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterAdapter = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!adapterId.trim() || !adapterCommand.trim()) {
      return;
    }
    setBusy(true);
    setStatusNote(null);
    try {
      const mcpInjection: AgentAdapterManifest['mcpInjection'] =
        adapterTransport === 'acp-stdio' ? 'acp-session' : 'env-url';
      const jsonlParser: AgentAdapterManifest['jsonlParser'] =
        adapterTransport === 'cli-stream' ? 'generic-jsonl' : 'none';

      await forgeApi.registerAdapter({
        id: adapterId.trim(),
        label: adapterLabel.trim() || adapterId.trim(),
        specialty: adapterSpecialty.trim() || 'Custom Engineering Harness',
        sovereignSoul:
          adapterSoul.trim() ||
          'Follow slice contracts, Ubiquitous Language, and deterministic hard gates.',
        transport: adapterTransport,
        command: adapterCommand.trim(),
        baseArgs: adapterBaseArgs
          .split(/\s+/)
          .map(s => s.trim())
          .filter(Boolean),
        healthProbeArgs: ['--version'],
        mcpInjection,
        jsonlParser,
        permissionFlags: {turbo: [], supervised: [], strict: []},
        envAllowlist: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
        defaultModel: adapterDefaultModel.trim() || 'default',
        supportedRoles: ['worker', 'specialist', 'lead'],
        maxConcurrentSlots: 3,
      });
      setAdapterId('');
      setAdapterLabel('');
      setAdapterCommand('');
      await onRefreshBootstrap();
      setStatusNote('Custom adapter registered and probed.');
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProvider = async (providerId: string): Promise<void> => {
    setBusy(true);
    setStatusNote(null);
    try {
      const baseUrl = providerBaseUrls[providerId];
      const apiKey = providerApiKeys[providerId];
      await forgeApi.updateProviderSecret({
        providerId,
        baseUrl: baseUrl && baseUrl.trim() ? baseUrl.trim() : undefined,
        apiKey: apiKey !== undefined ? apiKey.trim() : undefined,
      });
      setProviderApiKeys(prev => ({...prev, [providerId]: ''}));
      await onRefreshBootstrap();
      setStatusNote(`Updated provider "${providerId}" in Secret Vault.`);
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConstitution = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setStatusNote(null);
    try {
      const blocked = blockedCmdsText
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
      await forgeApi.saveConstitution(constitutionMd, blocked);
      await onRefreshBootstrap();
      setStatusNote('Soul Constitution upgraded and logged to Audit Ledger.');
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUpsertSkill = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!skillSlug.trim() || !skillPrompt.trim()) {
      return;
    }
    setBusy(true);
    setStatusNote(null);
    try {
      await forgeApi.upsertSkill({
        slug: skillSlug.trim(),
        title: skillTitle.trim() || skillSlug.trim(),
        category: skillCategory,
        version: skillVersion.trim() || '2.1.0',
        promptBody: skillPrompt.trim(),
      });
      setSkillSlug('');
      setSkillTitle('');
      setSkillPrompt('');
      await onRefreshBootstrap();
      setStatusNote('Skill saved to Shared Skills Bank.');
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-grid">
      {/* Sub-navigation bar */}
      <div
        className="card"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
        }}
      >
        <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
          <button
            type="button"
            className={
              subTab === 'steward' ? 'btn btn-primary btn-sm' : 'btn btn-sm'
            }
            onClick={() => setSubTab('steward')}
          >
            Infra Steward & Doctor
          </button>
          <button
            type="button"
            className={
              subTab === 'adapters' ? 'btn btn-primary btn-sm' : 'btn btn-sm'
            }
            onClick={() => setSubTab('adapters')}
          >
            Agents Market ({snapshot.adapters.length})
          </button>
          <button
            type="button"
            className={
              subTab === 'providers' ? 'btn btn-primary btn-sm' : 'btn btn-sm'
            }
            onClick={() => setSubTab('providers')}
          >
            Models Pool & Secret Vault
          </button>
          <button
            type="button"
            className={
              subTab === 'constitution'
                ? 'btn btn-primary btn-sm'
                : 'btn btn-sm'
            }
            onClick={() => setSubTab('constitution')}
          >
            Soul Constitution & Skills Bank
          </button>
          <button
            type="button"
            className={
              subTab === 'daemons' ? 'btn btn-primary btn-sm' : 'btn btn-sm'
            }
            onClick={() => setSubTab('daemons')}
          >
            Daemons & Audit Ledger
          </button>
        </div>
        {statusNote && <span className="badge badge-cyan">{statusNote}</span>}
      </div>

      {/* Sub-Tab 1: Infra Steward & Doctor */}
      {subTab === 'steward' && (
        <div className="panel-grid grid-2">
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  Environment Doctor & Worktree Patrol
                </h3>
                <p className="card-subtitle">
                  Probes Git, Node, and all registered CLI/ACP harnesses on PATH
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => void handleRunDoctor()}
              >
                Run Environment Doctor
              </button>
            </div>

            {doctorReport ? (
              <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                <div className="panel-grid grid-2">
                  <div className="card" style={{background: 'var(--bg-card)'}}>
                    <div className="form-label">Git Toolchain</div>
                    <div className="mono">{doctorReport.gitVersion}</div>
                  </div>
                  <div className="card" style={{background: 'var(--bg-card)'}}>
                    <div className="form-label">Node Runtime</div>
                    <div className="mono">{doctorReport.nodeVersion}</div>
                  </div>
                </div>

                <div>
                  <div className="form-label" style={{marginBottom: 6}}>
                    Adapter Probe Statuses
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Adapter</th>
                        <th>Transport</th>
                        <th>Health</th>
                        <th>Probe Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doctorReport.adapters.map(a => (
                        <tr key={a.manifest.id}>
                          <td>
                            <strong>{a.manifest.label}</strong>
                          </td>
                          <td className="mono">{a.manifest.transport}</td>
                          <td>
                            <span className={healthBadgeClass(a.health)}>
                              {a.health}
                            </span>
                          </td>
                          <td className="mono muted" style={{fontSize: 11}}>
                            {a.lastProbeMessage}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="muted mono" style={{fontSize: 11}}>
                  Pruned Worktrees:{' '}
                  {doctorReport.prunedWorktreeEntries.length === 0
                    ? '0 orphan worktrees found'
                    : doctorReport.prunedWorktreeEntries.join('; ')}
                </div>
              </div>
            ) : (
              <div className="muted">
                Click &ldquo;Run Environment Doctor&rdquo; to inspect host git,
                node, CLI binaries, and worktree hygiene.
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  Governed `INFRA` Repository Evolution
                </h3>
                <p className="card-subtitle">
                  Modify shared skills, templates, and Agent-Wiki topology maps
                  through an audited Twin-Graph Change
                </p>
              </div>
              <span className="badge badge-amber">Infra Steward</span>
            </div>

            <form onSubmit={e => void handleProposeInfraEvolution(e)}>
              <div className="form-row">
                <label className="form-label">Target INFRA Repository</label>
                <select
                  className="select"
                  value={infraRepoId || infraRepos[0]?.id || ''}
                  onChange={e => setInfraRepoId(e.target.value)}
                >
                  {(infraRepos.length > 0
                    ? infraRepos
                    : snapshot.repositories
                  ).map(r => (
                    <option key={r.id} value={r.id}>
                      [{r.tier.toUpperCase()}] {r.name} ({r.localPath})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <label className="form-label">Evolution Title</label>
                <input
                  className="input"
                  required
                  placeholder="Prune redundant explorer prompts in cross-repo grill skill"
                  value={evolveTitle}
                  onChange={e => setEvolveTitle(e.target.value)}
                />
              </div>

              <div className="form-row">
                <label className="form-label">
                  Architectural Rationale & Retro Findings
                </label>
                <textarea
                  className="textarea"
                  rows={3}
                  required
                  placeholder="Specify which skills, constitution rules, or Agent-Wiki sections should be evolved..."
                  value={evolveRationale}
                  onChange={e => setEvolveRationale(e.target.value)}
                />
              </div>

              <div className="form-row">
                <label className="form-label">Governance Tier</label>
                <select
                  className="select"
                  value={evolveTier}
                  onChange={e =>
                    setEvolveTier(e.target.value as PermissionTier)
                  }
                >
                  <option value="turbo">Turbo</option>
                  <option value="supervised">Supervised</option>
                  <option value="strict">Strict</option>
                </select>
              </div>

              <button type="submit" className="btn btn-primary" disabled={busy}>
                Launch Governed INFRA Change
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Sub-Tab 2: Agents Market */}
      {subTab === 'adapters' && (
        <div className="panel-grid">
          <div className="panel-grid grid-3">
            {snapshot.adapters.map(profile => (
              <div key={profile.manifest.id} className="card">
                <div className="card-header">
                  <div>
                    <h4 className="card-title">{profile.manifest.label}</h4>
                    <div className="card-subtitle mono">
                      id: {profile.manifest.id} · {profile.manifest.transport}
                    </div>
                  </div>
                  <span className={healthBadgeClass(profile.health)}>
                    {profile.health}
                  </span>
                </div>

                <div style={{fontSize: 12, marginBottom: 6}}>
                  <strong>Specialty:</strong> {profile.manifest.specialty}
                </div>
                <div
                  className="muted"
                  style={{fontSize: 11.5, marginBottom: 10}}
                >
                  {profile.manifest.sovereignSoul}
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    marginBottom: 8,
                  }}
                >
                  <span className="badge badge-indigo">
                    First-Pass: {(profile.firstPassRate * 100).toFixed(0)}%
                  </span>
                  <span className="badge badge-cyan">
                    Cost/Cert: $
                    {profile.effectiveCostPerCertifiedUsd.toFixed(3)}
                  </span>
                  <span className="badge badge-emerald">
                    Cache Hit: {(profile.cacheHitRatio * 100).toFixed(0)}%
                  </span>
                  <span className="badge badge-amber">
                    Premature Stop:{' '}
                    {(profile.prematureStopRate * 100).toFixed(0)}%
                  </span>
                  <span className="badge badge-slate">
                    Env Faults: {profile.consecutiveEnvFaults}
                  </span>
                </div>

                <div className="muted mono" style={{fontSize: 11}}>
                  Probe: {profile.lastProbeMessage}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  Register Custom Agent Adapter Manifest
                </h3>
                <p className="card-subtitle">
                  Plug any ACP stdio or JSONL CLI coding harness into the
                  Strong-Commands-Weak pool
                </p>
              </div>
            </div>

            <form
              onSubmit={e => void handleRegisterAdapter(e)}
              className="panel-grid grid-3"
            >
              <div className="form-row">
                <label className="form-label">Adapter ID</label>
                <input
                  className="input mono"
                  required
                  placeholder="aider-cli"
                  value={adapterId}
                  onChange={e => setAdapterId(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Display Label</label>
                <input
                  className="input"
                  required
                  placeholder="Aider Architect CLI"
                  value={adapterLabel}
                  onChange={e => setAdapterLabel(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Transport Protocol</label>
                <select
                  className="select"
                  value={adapterTransport}
                  onChange={e =>
                    setAdapterTransport(e.target.value as AdapterTransport)
                  }
                >
                  <option value="cli-stream">cli-stream (JSONL Stdio)</option>
                  <option value="acp-stdio">acp-stdio (JSON-RPC 2.0)</option>
                  <option value="native-api">
                    native-api (HTTP Tool Loop)
                  </option>
                </select>
              </div>
              <div className="form-row">
                <label className="form-label">Executable Command</label>
                <input
                  className="input mono"
                  required
                  placeholder="aider"
                  value={adapterCommand}
                  onChange={e => setAdapterCommand(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Base Arguments</label>
                <input
                  className="input mono"
                  value={adapterBaseArgs}
                  onChange={e => setAdapterBaseArgs(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Default Model</label>
                <input
                  className="input mono"
                  value={adapterDefaultModel}
                  onChange={e => setAdapterDefaultModel(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Specialty</label>
                <input
                  className="input"
                  placeholder="Fast multi-file diff application"
                  value={adapterSpecialty}
                  onChange={e => setAdapterSpecialty(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Sovereign Persona</label>
                <input
                  className="input"
                  placeholder="Focused slice implementer"
                  value={adapterSoul}
                  onChange={e => setAdapterSoul(e.target.value)}
                />
              </div>
              <div className="form-row" style={{justifyContent: 'flex-end'}}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                >
                  + Register & Probe Adapter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-Tab 3: Models Pool & Secret Vault */}
      {subTab === 'providers' && (
        <div className="panel-grid grid-3">
          {snapshot.providers.map(provider => (
            <div key={provider.id} className="card">
              <div className="card-header">
                <div>
                  <h4 className="card-title">{provider.name}</h4>
                  <div className="card-subtitle mono">
                    {provider.id} · {provider.protocol}
                  </div>
                </div>
                <span
                  className={
                    provider.hasApiKey
                      ? 'badge badge-emerald'
                      : 'badge badge-amber'
                  }
                >
                  {provider.hasApiKey ? provider.maskedKeyHint : 'No Key Set'}
                </span>
              </div>

              <div className="form-row">
                <label className="form-label">Gateway Base URL</label>
                <input
                  className="input mono"
                  value={providerBaseUrls[provider.id] ?? provider.baseUrl}
                  onChange={e =>
                    setProviderBaseUrls(prev => ({
                      ...prev,
                      [provider.id]: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="form-row">
                <label className="form-label">
                  Write-Only API Key (OS SafeStorage Vault)
                </label>
                <input
                  type="password"
                  className="input mono"
                  placeholder="sk-... (never echoed back in plaintext)"
                  value={providerApiKeys[provider.id] ?? ''}
                  onChange={e =>
                    setProviderApiKeys(prev => ({
                      ...prev,
                      [provider.id]: e.target.value,
                    }))
                  }
                />
              </div>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => void handleSaveProvider(provider.id)}
              >
                Save Endpoint & Vault Key
              </button>

              <div style={{marginTop: 12}}>
                <div className="form-label" style={{marginBottom: 4}}>
                  Catalog Models
                </div>
                {provider.models.map(m => (
                  <div
                    key={m.id}
                    className="mono muted"
                    style={{fontSize: 11, marginBottom: 4}}
                  >
                    <strong>{m.id}</strong> ({m.tier}) · in $
                    {m.inputUsdPerMillion}
                    /M · cache ${m.cachedInputUsdPerMillion}/M
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sub-Tab 4: Soul Constitution & Skills Bank */}
      {subTab === 'constitution' && (
        <div className="panel-grid grid-2">
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  Soul Constitution (v{snapshot.constitution.version})
                </h3>
                <p className="card-subtitle">
                  Global architectural redlines and blocked shell commands
                </p>
              </div>
            </div>

            <form onSubmit={e => void handleSaveConstitution(e)}>
              <div className="form-row">
                <label className="form-label">Constitutional Mandates</label>
                <textarea
                  className="textarea"
                  rows={8}
                  value={constitutionMd}
                  onChange={e => setConstitutionMd(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">
                  Blocked Command Patterns (1 per line)
                </label>
                <textarea
                  className="textarea"
                  rows={4}
                  value={blockedCmdsText}
                  onChange={e => setBlockedCmdsText(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Save Soul Constitution
              </button>
            </form>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  Shared Skills Bank ({snapshot.skills.length})
                </h3>
                <p className="card-subtitle">
                  Versioned Grill, DDD, Architecture, QA, and Retro skills
                </p>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 240,
                overflowY: 'auto',
                marginBottom: 12,
              }}
            >
              {snapshot.skills.map(sk => (
                <div
                  key={sk.id}
                  className="card"
                  style={{background: 'var(--bg-card)', padding: '8px 10px'}}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}
                  >
                    <strong className="mono">
                      /{sk.slug} ({sk.version})
                    </strong>
                    <span className="badge badge-indigo">{sk.category}</span>
                  </div>
                  <div className="muted" style={{fontSize: 11.5}}>
                    {sk.promptBody}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={e => void handleUpsertSkill(e)}>
              <div className="form-label" style={{marginBottom: 6}}>
                Upsert Shared Skill
              </div>
              <div className="panel-grid grid-3">
                <input
                  className="input mono"
                  required
                  placeholder="slug (e.g. grill-with-docs)"
                  value={skillSlug}
                  onChange={e => setSkillSlug(e.target.value)}
                />
                <input
                  className="input"
                  required
                  placeholder="Skill Title"
                  value={skillTitle}
                  onChange={e => setSkillTitle(e.target.value)}
                />
                <select
                  className="select"
                  value={skillCategory}
                  onChange={e =>
                    setSkillCategory(e.target.value as SkillEntry['category'])
                  }
                >
                  <option value="grill">grill</option>
                  <option value="ddd">ddd</option>
                  <option value="architecture">architecture</option>
                  <option value="qa">qa</option>
                  <option value="retro">retro</option>
                  <option value="infra">infra</option>
                </select>
              </div>
              <div style={{display: 'flex', gap: 6, marginTop: 6}}>
                <input
                  className="input mono"
                  style={{width: 110}}
                  value={skillVersion}
                  onChange={e => setSkillVersion(e.target.value)}
                />
                <input
                  className="input"
                  required
                  placeholder="Skill prompt template body..."
                  value={skillPrompt}
                  onChange={e => setSkillPrompt(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                >
                  Save Skill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-Tab 5: Daemons & Audit Ledger */}
      {subTab === 'daemons' && (
        <div className="panel-grid grid-2">
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Autonomous Background Daemons</h3>
                <p className="card-subtitle">
                  Non-overlapping background passes with SQLite durable outbox
                </p>
              </div>
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
              {snapshot.daemons.map(d => (
                <div
                  key={d.id}
                  className="card"
                  style={{background: 'var(--bg-card)'}}
                >
                  <div className="card-header">
                    <div>
                      <h4 className="card-title">{d.label}</h4>
                      <div className="card-subtitle mono">
                        id: {d.id} · interval: {d.intervalSeconds}s
                      </div>
                    </div>
                    <button
                      type="button"
                      className={
                        d.enabled ? 'btn btn-emerald btn-sm' : 'btn btn-sm'
                      }
                      disabled={busy}
                      onClick={async () => {
                        await forgeApi.setDaemonEnabled(d.id, !d.enabled);
                        await onRefreshBootstrap();
                      }}
                    >
                      {d.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                  <div className="muted" style={{fontSize: 11.5}}>
                    {d.lastSummary}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  Immutable Governance Audit Ledger
                </h3>
                <p className="card-subtitle">
                  Records every checkpoint, rewind, GhostNode amendment, and
                  constitution update
                </p>
              </div>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Actor</th>
                  <th>Event</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recentAuditLogs.map(entry => (
                  <tr key={entry.id}>
                    <td>
                      <span className="badge badge-slate">
                        {entry.category}
                      </span>
                    </td>
                    <td className="mono">{entry.actor}</td>
                    <td>
                      <strong>{entry.title}</strong>
                      <div className="muted" style={{fontSize: 11}}>
                        {entry.detail}
                      </div>
                    </td>
                    <td className="mono muted" style={{fontSize: 11}}>
                      {new Date(entry.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

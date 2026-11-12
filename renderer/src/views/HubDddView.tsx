import React, {useState} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {PermissionTier, RepoTier} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';

export interface HubDddViewProps {
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly onSelectHub: (hubId: string) => void;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onRefresh: () => Promise<void>;
}

export function HubDddView(props: HubDddViewProps): React.ReactElement {
  const {snapshot, activeHubId, onSelectHub, onOpenWorkstation, onRefresh} =
    props;
  const activeHub =
    snapshot.hubs.find(h => h.id === activeHubId) ?? snapshot.hubs[0];
  const hubRepos = snapshot.repositories.filter(r => r.hubId === activeHub?.id);
  const hubTerms = snapshot.domainTerms.filter(t => t.hubId === activeHub?.id);
  const hubChanges = snapshot.changes.filter(c => c.hubId === activeHub?.id);

  // New Hub state
  const [showNewHub, setShowNewHub] = useState(false);
  const [hubName, setHubName] = useState('');
  const [hubRoot, setHubRoot] = useState('');
  const [hubDesc, setHubDesc] = useState('');
  const [hubTier, setHubTier] = useState<PermissionTier>('turbo');

  // New Repository state
  const [repoName, setRepoName] = useState('');
  const [repoTier, setRepoTier] = useState<RepoTier>('service');
  const [repoPath, setRepoPath] = useState('');
  const [repoVerify, setRepoVerify] = useState('');
  const [repoContext, setRepoContext] = useState('');
  const [repoContract, setRepoContract] = useState('');

  // DDD Ubiquitous Language form state
  const [dddContext, setDddContext] = useState('');
  const [dddCanonical, setDddCanonical] = useState('');
  const [dddLabel, setDddLabel] = useState('');
  const [dddDef, setDddDef] = useState('');
  const [dddForbidden, setDddForbidden] = useState('');

  // New Change / Epic form state
  const [chgRepoId, setChgRepoId] = useState('');
  const [chgTitle, setChgTitle] = useState('');
  const [chgSummary, setChgSummary] = useState('');
  const [chgTier, setChgTier] = useState<PermissionTier>('turbo');
  const [leadAdapter, setLeadAdapter] = useState('native-api');
  const [workerAdapter, setWorkerAdapter] = useState('native-api');
  const [epicMode, setEpicMode] = useState(false);
  const [selectedEpicRepos, setSelectedEpicRepos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreateHub = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    try {
      const created = await forgeApi.createHub({
        name: hubName,
        rootPath: hubRoot,
        description: hubDesc,
        permissionTier: hubTier,
      });
      setHubName('');
      setHubRoot('');
      setHubDesc('');
      setShowNewHub(false);
      await onRefresh();
      onSelectHub(created.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterRepo = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!activeHub) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await forgeApi.registerRepo({
        hubId: activeHub.id,
        name: repoName,
        tier: repoTier,
        localPath: repoPath,
        verifyCommand: repoVerify,
        boundedContext: repoContext,
        contractSummary: repoContract,
      });
      setRepoName('');
      setRepoPath('');
      setRepoVerify('');
      setRepoContext('');
      setRepoContract('');
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUpsertDddTerm = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!activeHub) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await forgeApi.upsertDomainTerm({
        hubId: activeHub.id,
        boundedContext: dddContext,
        owningRepoIds: hubRepos
          .filter(r => r.boundedContext === dddContext)
          .map(r => r.id),
        canonicalTerm: dddCanonical,
        localLabel: dddLabel,
        definition: dddDef,
        forbiddenAliases: dddForbidden
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        schemaAnchors: [],
      });
      setDddCanonical('');
      setDddLabel('');
      setDddDef('');
      setDddForbidden('');
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateChange = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!activeHub) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      if (epicMode) {
        const targets =
          selectedEpicRepos.length > 0
            ? selectedEpicRepos
            : hubRepos.map(r => r.id);
        const created = await forgeApi.createEpicChanges({
          hubId: activeHub.id,
          repoIds: targets,
          epicTitle: chgTitle,
          summary: chgSummary,
          permissionTier: chgTier,
        });
        await onRefresh();
        if (created[0]) {
          onOpenWorkstation(created[0].id);
        }
      } else {
        const targetRepoId = chgRepoId || hubRepos[0]?.id;
        if (!targetRepoId) {
          throw new Error(
            'Register at least one repository in this Hub first.',
          );
        }
        const created = await forgeApi.createChange({
          hubId: activeHub.id,
          repoId: targetRepoId,
          title: chgTitle,
          summary: chgSummary,
          permissionTier: chgTier,
          leadAdapterId: leadAdapter,
          workerAdapterId: workerAdapter,
        });
        await onRefresh();
        onOpenWorkstation(created.id);
      }
      setChgTitle('');
      setChgSummary('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-grid">
      {errorMsg && (
        <div
          className="card"
          style={{borderColor: 'var(--accent-rose)', color: '#fda4af'}}
        >
          {errorMsg}
        </div>
      )}

      {/* Hub Header & Agent-Wiki Topology Card */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              Federation Hub (Master Repo): {activeHub?.name ?? 'None'}
            </h3>
            <p className="card-subtitle">
              Centralizes cross-repo topology, shared skills, and DDD Ubiquitous
              Language so agents skip blind explorer turns
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowNewHub(v => !v)}
          >
            {showNewHub ? 'Close New Hub Form' : '+ Create Federation Hub'}
          </button>
        </div>

        {showNewHub && (
          <form
            onSubmit={e => void handleCreateHub(e)}
            className="card"
            style={{background: 'var(--bg-card)', marginBottom: 12}}
          >
            <div className="panel-grid grid-3">
              <div className="form-row">
                <label className="form-label">Hub Name</label>
                <input
                  className="input"
                  required
                  value={hubName}
                  onChange={e => setHubName(e.target.value)}
                  placeholder="Commerce Platform Federation"
                />
              </div>
              <div className="form-row">
                <label className="form-label">Master Hub Root Path</label>
                <div style={{display: 'flex', gap: 6}}>
                  <input
                    className="input mono"
                    required
                    value={hubRoot}
                    onChange={e => setHubRoot(e.target.value)}
                    placeholder="D:/Workspaces/commerce-hub"
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      const picked = await forgeApi.pickDirectory();
                      if (picked) setHubRoot(picked);
                    }}
                  >
                    Browse
                  </button>
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">Default Governance Tier</label>
                <select
                  className="select"
                  value={hubTier}
                  onChange={e => setHubTier(e.target.value as PermissionTier)}
                >
                  <option value="turbo">Turbo (Unattended Auto-Advance)</option>
                  <option value="supervised">Supervised</option>
                  <option value="strict">Strict (Approve All Gates)</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <label className="form-label">
                Mission & Architecture North Star
              </label>
              <input
                className="input"
                required
                value={hubDesc}
                onChange={e => setHubDesc(e.target.value)}
                placeholder="Unified multi-service settlement, order orchestration, and platform harness governance."
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Create Federation Hub
            </button>
          </form>
        )}

        {activeHub && (
          <div className="panel-grid grid-2">
            <div>
              <div className="form-label">Hub Metadata</div>
              <div className="mono muted" style={{fontSize: 11.5}}>
                Root: {activeHub.rootPath}
              </div>
              <div style={{marginTop: 6}}>{activeHub.description}</div>
            </div>
            <div>
              <div className="form-label">
                Agent-Wiki Topology Digest (Maintained by Retro Skill)
              </div>
              <pre
                className="mono"
                style={{
                  margin: 0,
                  padding: 10,
                  borderRadius: 6,
                  background: '#090d15',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 11,
                  maxHeight: 130,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {activeHub.agentWikiSummary ||
                  'Run a Change or trigger Retro to prune Hub topology into an agent-first digest.'}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Member Repositories (INFRA vs Service) + DDD Ubiquitous Language Studio */}
      <div className="panel-grid grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                Member Repositories (`INFRA` vs `SERVICE`)
              </h3>
              <p className="card-subtitle">
                Each Change provisions an isolated Git worktree inside its
                target repository
              </p>
            </div>
            <span className="badge badge-cyan">{hubRepos.length} Repos</span>
          </div>

          <table className="table" style={{marginBottom: 12}}>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Repository</th>
                <th>Bounded Context</th>
                <th>Verify Gate</th>
              </tr>
            </thead>
            <tbody>
              {hubRepos.map(r => (
                <tr key={r.id}>
                  <td>
                    <span
                      className={
                        r.tier === 'infra'
                          ? 'badge badge-amber'
                          : 'badge badge-indigo'
                      }
                    >
                      {r.tier}
                    </span>
                  </td>
                  <td>
                    <strong>{r.name}</strong>
                    <div className="muted mono" style={{fontSize: 10.5}}>
                      {r.localPath}
                    </div>
                  </td>
                  <td>{r.boundedContext}</td>
                  <td className="mono" style={{fontSize: 11}}>
                    {r.verifyCommand || '(ddd-only)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form onSubmit={e => void handleRegisterRepo(e)}>
            <div className="form-label" style={{marginBottom: 6}}>
              Register Member Repository
            </div>
            <div className="panel-grid grid-2">
              <input
                className="input"
                required
                placeholder="Repo Name (e.g. billing-ledger)"
                value={repoName}
                onChange={e => setRepoName(e.target.value)}
              />
              <select
                className="select"
                value={repoTier}
                onChange={e => setRepoTier(e.target.value as RepoTier)}
              >
                <option value="service">SERVICE Repository</option>
                <option value="infra">INFRA Control Repository</option>
              </select>
            </div>
            <div style={{display: 'flex', gap: 6, marginTop: 6}}>
              <input
                className="input mono"
                required
                placeholder="Local Repository Path"
                value={repoPath}
                onChange={e => setRepoPath(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  const picked = await forgeApi.pickDirectory();
                  if (picked) setRepoPath(picked);
                }}
              >
                Browse
              </button>
            </div>
            <div className="panel-grid grid-2" style={{marginTop: 6}}>
              <input
                className="input"
                required
                placeholder="Bounded Context (e.g. Settlement)"
                value={repoContext}
                onChange={e => setRepoContext(e.target.value)}
              />
              <input
                className="input mono"
                placeholder="Verify Command (e.g. npm test)"
                value={repoVerify}
                onChange={e => setRepoVerify(e.target.value)}
              />
            </div>
            <input
              className="input"
              style={{marginTop: 6}}
              placeholder="Concise Contract Summary for Agent-Wiki"
              value={repoContract}
              onChange={e => setRepoContract(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              style={{marginTop: 8}}
              disabled={busy}
            >
              + Register Repository
            </button>
          </form>
        </div>

        {/* DDD Ubiquitous Language Studio */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">DDD Ubiquitous Language Studio</h3>
              <p className="card-subtitle">
                Canonical domain identifiers injected into prompts & enforced by
                Hard Gates
              </p>
            </div>
            <span className="badge badge-emerald">
              {hubTerms.length} Canonical Terms
            </span>
          </div>

          <table className="table" style={{marginBottom: 12}}>
            <thead>
              <tr>
                <th>Context</th>
                <th>Canonical Identifier</th>
                <th>Definition</th>
                <th>Forbidden Synonyms</th>
              </tr>
            </thead>
            <tbody>
              {hubTerms.map(t => (
                <tr key={t.id}>
                  <td>
                    <span className="badge badge-slate">
                      {t.boundedContext}
                    </span>
                  </td>
                  <td className="mono">
                    <strong>{t.canonicalTerm}</strong>
                    {t.localLabel && (
                      <div className="muted" style={{fontSize: 10.5}}>
                        {t.localLabel}
                      </div>
                    )}
                  </td>
                  <td>{t.definition}</td>
                  <td className="mono" style={{color: '#fda4af', fontSize: 11}}>
                    {t.forbiddenAliases.join(', ') || '(none)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form onSubmit={e => void handleUpsertDddTerm(e)}>
            <div className="form-label" style={{marginBottom: 6}}>
              Lock Domain Term & Prohibited Aliases
            </div>
            <div className="panel-grid grid-3">
              <input
                className="input"
                required
                placeholder="Bounded Context"
                value={dddContext}
                onChange={e => setDddContext(e.target.value)}
              />
              <input
                className="input mono"
                required
                placeholder="CanonicalIdentifier"
                value={dddCanonical}
                onChange={e => setDddCanonical(e.target.value)}
              />
              <input
                className="input"
                placeholder="Business Label (中文/EN)"
                value={dddLabel}
                onChange={e => setDddLabel(e.target.value)}
              />
            </div>
            <input
              className="input"
              style={{marginTop: 6}}
              required
              placeholder="Strict domain definition"
              value={dddDef}
              onChange={e => setDddDef(e.target.value)}
            />
            <input
              className="input mono"
              style={{marginTop: 6}}
              placeholder="Forbidden synonyms (comma-separated, e.g. BillItem, UserOrder)"
              value={dddForbidden}
              onChange={e => setDddForbidden(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              style={{marginTop: 8}}
              disabled={busy}
            >
              + Lock Ubiquitous Term
            </button>
          </form>
        </div>
      </div>

      {/* Change & Coordinated Multi-Repo Epic Launcher + Scoped Archive */}
      <div className="panel-grid grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                Launch Change / Multi-Repo Coordinated Epic
              </h3>
              <p className="card-subtitle">
                Strong Lead plans WBS & Twin-Graph; Fast Worker executes slices
              </p>
            </div>
            <label style={{display: 'flex', alignItems: 'center', gap: 6}}>
              <input
                type="checkbox"
                checked={epicMode}
                onChange={e => setEpicMode(e.target.checked)}
              />
              <span style={{fontSize: 11.5}}>Cross-Repo Epic</span>
            </label>
          </div>

          <form onSubmit={e => void handleCreateChange(e)}>
            {!epicMode ? (
              <div className="form-row">
                <label className="form-label">Target Repository</label>
                <select
                  className="select"
                  value={chgRepoId || hubRepos[0]?.id || ''}
                  onChange={e => setChgRepoId(e.target.value)}
                >
                  {hubRepos.map(r => (
                    <option key={r.id} value={r.id}>
                      [{r.tier.toUpperCase()}] {r.name} ({r.boundedContext})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="form-row">
                <label className="form-label">
                  Affected Repositories in Epic
                </label>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
                  {hubRepos.map(r => {
                    const checked = selectedEpicRepos.includes(r.id);
                    return (
                      <label
                        key={r.id}
                        className="badge badge-slate"
                        style={{cursor: 'pointer', padding: '4px 8px'}}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            setSelectedEpicRepos(prev =>
                              e.target.checked
                                ? [...prev, r.id]
                                : prev.filter(id => id !== r.id),
                            );
                          }}
                        />{' '}
                        {r.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="form-row">
              <label className="form-label">Change Mandate Title</label>
              <input
                className="input"
                required
                placeholder="Implement idempotent SettlementVoucher reconciliation"
                value={chgTitle}
                onChange={e => setChgTitle(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label className="form-label">
                Engineering Requirements & Constraints
              </label>
              <textarea
                className="textarea"
                rows={3}
                required
                placeholder="Describe desired behavior, invariants, and cross-service contract expectations..."
                value={chgSummary}
                onChange={e => setChgSummary(e.target.value)}
              />
            </div>

            <div className="panel-grid grid-3">
              <div className="form-row">
                <label className="form-label">Permission Tier</label>
                <select
                  className="select"
                  value={chgTier}
                  onChange={e => setChgTier(e.target.value as PermissionTier)}
                >
                  <option value="turbo">Turbo (Unattended)</option>
                  <option value="supervised">Supervised</option>
                  <option value="strict">Strict</option>
                </select>
              </div>
              <div className="form-row">
                <label className="form-label">Strong Lead Adapter</label>
                <select
                  className="select"
                  value={leadAdapter}
                  onChange={e => setLeadAdapter(e.target.value)}
                >
                  {snapshot.adapters.map(a => (
                    <option key={a.manifest.id} value={a.manifest.id}>
                      {a.manifest.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label className="form-label">Fast Worker Adapter</label>
                <select
                  className="select"
                  value={workerAdapter}
                  onChange={e => setWorkerAdapter(e.target.value)}
                >
                  {snapshot.adapters.map(a => (
                    <option key={a.manifest.id} value={a.manifest.id}>
                      {a.manifest.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={busy}>
              Compile Spec & Twin-Graph
            </button>
          </form>
        </div>

        {/* Hub Change Registry with Scoped Archive & Retro */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Hub Change Dashboard</h3>
              <p className="card-subtitle">
                Archiving a Change never archives the parent Hub or Repository
              </p>
            </div>
          </div>

          <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            {hubChanges.map(c => (
              <div
                key={c.id}
                className="card"
                style={{background: 'var(--bg-card)', padding: '10px 12px'}}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <div>
                    <span className="mono" style={{fontWeight: 700}}>
                      {c.code}
                    </span>{' '}
                    · <strong>{c.title}</strong>
                  </div>
                  <span className="badge badge-indigo">{c.status}</span>
                </div>
                <div
                  className="muted mono"
                  style={{fontSize: 11, marginBottom: 8}}
                >
                  Branch: {c.gitBranch} · Tier: {c.permissionTier} · Quality:{' '}
                  {(c.qualityScore * 100).toFixed(0)}%
                </div>
                <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => onOpenWorkstation(c.id)}
                  >
                    Workstation
                  </button>
                  <button
                    type="button"
                    className="btn btn-emerald btn-sm"
                    onClick={async () => {
                      await forgeApi.executeChange(c.id);
                      await onRefresh();
                    }}
                  >
                    Execute
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      await forgeApi.runRetroOptimization(c.id);
                      await onRefresh();
                    }}
                  >
                    Run Retro Pruner
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      await forgeApi.archiveChange(c.id);
                      await onRefresh();
                    }}
                  >
                    Archive Change
                  </button>
                </div>
              </div>
            ))}
            {hubChanges.length === 0 && (
              <div className="muted">No active Changes in this Hub yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

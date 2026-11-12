import {useState, type ReactElement} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {
  PermissionTier,
  RepoTier,
  RepositoryEntry,
} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';
import {BriefcaseIcon, PlusIcon, ShieldIcon} from '../components/Icons.tsx';

export function RegistryView(props: {
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onOpenChangeDashboard: (changeId: string) => void;
  readonly onOpenCreateChangeModal: (repoId?: string) => void;
  readonly onRefresh: () => Promise<void> | void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {
    snapshot,
    activeHubId,
    onOpenWorkstation,
    onOpenChangeDashboard,
    onOpenCreateChangeModal,
    onRefresh,
    onError,
  } = props;

  const hubRepos = snapshot.repositories.filter(r => r.hubId === activeHubId);
  const infraRepos = hubRepos.filter(r => r.tier === 'infra');
  const regularRepos = hubRepos.filter(r => r.tier !== 'infra');
  const hubChanges = snapshot.changes.filter(c => c.hubId === activeHubId);

  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [repoTier, setRepoTier] = useState<RepoTier>('service');
  const [repoPath, setRepoPath] = useState('');
  const [boundedContext, setBoundedContext] = useState('');
  const [verifyCmd, setVerifyCmd] = useState('');
  const [contractSummary, setContractSummary] = useState('');
  const [permissionTier, setPermissionTier] = useState<PermissionTier>('turbo');
  const [busy, setBusy] = useState(false);

  const ensureChangeForRepo = async (
    repo: RepositoryEntry,
  ): Promise<string> => {
    const existing = hubChanges.find(c => c.repoId === repo.id);
    if (existing) {
      return existing.id;
    }
    const created = await forgeApi.createChange({
      hubId: activeHubId,
      repoId: repo.id,
      title: `Initialize ${repo.boundedContext} baseline workflow`,
      summary:
        repo.contractSummary ||
        `Establish specification and baseline QA gates for ${repo.name}.`,
      permissionTier,
    });
    await Promise.resolve(onRefresh());
    return created.id;
  };

  const handleConfigureTeam = async (repo: RepositoryEntry): Promise<void> => {
    try {
      const changeId = await ensureChangeForRepo(repo);
      onOpenChangeDashboard(changeId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLiveView = async (repo: RepositoryEntry): Promise<void> => {
    try {
      const changeId = await ensureChangeForRepo(repo);
      onOpenWorkstation(changeId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRegisterSubmit = async (): Promise<void> => {
    if (!repoName.trim() || !repoPath.trim() || !boundedContext.trim()) {
      return;
    }
    setBusy(true);
    try {
      await forgeApi.registerRepo({
        hubId: activeHubId,
        name: repoName.trim(),
        tier: repoTier,
        localPath: repoPath.trim(),
        verifyCommand: verifyCmd.trim(),
        boundedContext: boundedContext.trim(),
        contractSummary: contractSummary.trim(),
      });
      setRepoName('');
      setRepoPath('');
      setBoundedContext('');
      setVerifyCmd('');
      setContractSummary('');
      setShowRegisterModal(false);
      await Promise.resolve(onRefresh());
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 14,
        }}
      >
        <div>
          <h1 className="page-h1">Project Registry</h1>
          <p className="page-subtitle">
            Manage and monitor your autonomous agent teams.
          </p>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowRegisterModal(true)}
          >
            <PlusIcon size={14} /> Register Project
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onOpenCreateChangeModal(hubRepos[0]?.id)}
          >
            <PlusIcon size={14} /> New Change / Epic
          </button>
        </div>
      </div>

      <div className="registry-summary-row">
        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <span>
            Showing {hubRepos.length} of {snapshot.repositories.length} projects
          </span>
          <span className="tag tag-indigo">{infraRepos.length} INFRA</span>
          <span className="tag">{regularRepos.length} Regular</span>
          <span style={{color: '#94a3b8'}}>
            ({hubChanges.length} active change
            {hubChanges.length === 1 ? '' : 's'} in Hub)
          </span>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <span style={{fontSize: 12}}>Default Autonomy:</span>
          <select
            style={{width: 128, height: 28, padding: '0 8px', fontSize: 12}}
            value={permissionTier}
            onChange={e => setPermissionTier(e.target.value as PermissionTier)}
          >
            <option value="turbo">Turbo (T5/P5)</option>
            <option value="supervised">Supervised</option>
            <option value="strict">Strict Gate</option>
          </select>
        </div>
      </div>

      {/* INFRA Projects Section (T5) */}
      <div className="registry-section-title">
        <ShieldIcon size={16} />
        <span>INFRA Projects (T5) ({infraRepos.length})</span>
      </div>

      <div className="registry-grid">
        {infraRepos.map(repo => {
          const activeChg = hubChanges.find(c => c.repoId === repo.id);
          return (
            <div key={repo.id} className="project-card infra-card">
              <div className="project-card-main">
                <div className="project-icon-box">
                  <ShieldIcon size={19} />
                </div>
                <div style={{minWidth: 0, flex: 1}}>
                  <div className="project-title-row">
                    <span className="project-name">{repo.name}</span>
                    <span className="tag tag-indigo">T5</span>
                  </div>
                  <div className="project-badges">
                    <span className="tag">infra</span>
                    <span className="tag">C6</span>
                    <span className="tag">L5</span>
                    <span className="tag tag-indigo">
                      {repo.boundedContext}
                    </span>
                    {activeChg && (
                      <span className="tag tag-green">{activeChg.code}</span>
                    )}
                  </div>
                  <div className="project-path">
                    Path: {repo.localPath.replace(/\\/g, '/')}
                  </div>
                </div>
              </div>
              <div className="project-card-footer">
                <button
                  type="button"
                  className="project-footer-btn"
                  onClick={() => void handleConfigureTeam(repo)}
                >
                  Configure Team
                </button>
                <button
                  type="button"
                  className="project-footer-btn"
                  onClick={() => void handleLiveView(repo)}
                >
                  Live View →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Regular Service Projects Section */}
      <div className="registry-section-title regular" style={{marginTop: 28}}>
        <BriefcaseIcon size={16} />
        <span>Regular Projects ({regularRepos.length})</span>
      </div>

      <div className="registry-grid">
        {regularRepos.map((repo, idx) => {
          const activeChg = hubChanges.find(c => c.repoId === repo.id);
          return (
            <div key={repo.id} className="project-card">
              <div className="project-card-main">
                <div className="project-icon-box">
                  <BriefcaseIcon size={18} />
                </div>
                <div style={{minWidth: 0, flex: 1}}>
                  <div className="project-title-row">
                    <span className="project-name">{repo.name}</span>
                  </div>
                  <div className="project-badges">
                    <span className="tag tag-blue">{repo.boundedContext}</span>
                    <span className="tag">L{Math.max(3, 4 - (idx % 2))}</span>
                    {activeChg && (
                      <span
                        className={`tag ${
                          activeChg.status === 'certified'
                            ? 'tag-green'
                            : 'tag-indigo'
                        }`}
                      >
                        {activeChg.code} · {activeChg.status}
                      </span>
                    )}
                  </div>
                  <div className="project-path">
                    Path: {repo.localPath.replace(/\\/g, '/')}
                  </div>
                </div>
              </div>
              <div className="project-card-footer">
                <button
                  type="button"
                  className="project-footer-btn"
                  onClick={() => void handleConfigureTeam(repo)}
                >
                  Configure Team
                </button>
                <button
                  type="button"
                  className="project-footer-btn"
                  onClick={() => void handleLiveView(repo)}
                >
                  Live View →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showRegisterModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowRegisterModal(false)}
        >
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Register Repository Project</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowRegisterModal(false)}
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
                  gridTemplateColumns: '1.4fr 1fr',
                  gap: 12,
                }}
              >
                <div>
                  <label className="field-label">
                    Project / Repository Name
                  </label>
                  <input
                    placeholder="e.g. billing-ledger-service"
                    value={repoName}
                    onChange={e => setRepoName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Project Tier</label>
                  <select
                    value={repoTier}
                    onChange={e => setRepoTier(e.target.value as RepoTier)}
                  >
                    <option value="service">Regular Project (Service)</option>
                    <option value="infra">INFRA Project (T5)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label">Local Git Repository Path</label>
                <div style={{display: 'flex', gap: 8}}>
                  <input
                    placeholder="D:/repos/billing-ledger-service"
                    value={repoPath}
                    onChange={e => setRepoPath(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void forgeApi.pickDirectory().then(picked => {
                        if (picked) setRepoPath(picked);
                      });
                    }}
                  >
                    Browse...
                  </button>
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
                  <label className="field-label">DDD Bounded Context</label>
                  <input
                    placeholder="e.g. Settlement"
                    value={boundedContext}
                    onChange={e => setBoundedContext(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Verify Gate Command</label>
                  <input
                    placeholder="e.g. npm test"
                    value={verifyCmd}
                    onChange={e => setVerifyCmd(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="field-label">Contract Summary</label>
                <textarea
                  rows={2}
                  placeholder="Core API boundaries and domain responsibilities..."
                  value={contractSummary}
                  onChange={e => setContractSummary(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setShowRegisterModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy ||
                  !repoName.trim() ||
                  !repoPath.trim() ||
                  !boundedContext.trim()
                }
                onClick={() => void handleRegisterSubmit()}
              >
                Register Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

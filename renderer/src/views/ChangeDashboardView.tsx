import {useEffect, useState, type ReactElement} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {PermissionTier} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CpuIcon,
  FileTextIcon,
  GitBranchIcon,
  PlayIcon,
  SettingsIcon,
  SlidersIcon,
  UsersIcon,
  ZapIcon,
} from '../components/Icons.tsx';

type DashTab = 'team' | 'docs' | 'actions';

export function ChangeDashboardView(props: {
  readonly snapshot: BootstrapSnapshot;
  readonly changeId: string;
  readonly onBack: () => void;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onRefresh: () => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {snapshot, changeId, onBack, onOpenWorkstation, onRefresh, onError} =
    props;

  const change =
    snapshot.changes.find(c => c.id === changeId) ??
    snapshot.changes[0] ??
    null;
  const repo = snapshot.repositories.find(r => r.id === change?.repoId) ?? null;

  const [tab, setTab] = useState<DashTab>('team');
  const [editingRole, setEditingRole] = useState<'dev' | 'jqa' | 'sqa' | null>(
    null,
  );
  const [workerAdapterId, setWorkerAdapterId] = useState(
    change?.team.workerAdapterId ?? 'native-api',
  );
  const [workerModel, setWorkerModel] = useState(
    change?.team.workerModel ?? 'deepseek-chat',
  );
  const [jqaModel, setJqaModel] = useState(
    change?.team.juniorAuditModel ?? 'deepseek-chat',
  );
  const [sqaModel, setSqaModel] = useState(
    change?.team.seniorAuditModel ?? 'deepseek-reasoner',
  );
  const [maxLoops, setMaxLoops] = useState(
    String(change?.team.maxRetryLoops ?? 3),
  );
  const [sqaLoops, setSqaLoops] = useState('3');
  const [permissionTier, setPermissionTier] = useState<PermissionTier>(
    change?.permissionTier ?? 'turbo',
  );
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!change) return;
    setWorkerAdapterId(change.team.workerAdapterId);
    setWorkerModel(change.team.workerModel);
    setJqaModel(change.team.juniorAuditModel);
    setSqaModel(change.team.seniorAuditModel);
    setMaxLoops(String(change.team.maxRetryLoops));
    setPermissionTier(change.permissionTier);
  }, [change]);

  if (!change) {
    return (
      <div className="page-scroll">
        <button type="button" className="btn" onClick={onBack}>
          <ArrowLeftIcon size={14} /> Back to Registry
        </button>
        <p style={{marginTop: 16, color: '#64748b'}}>Change not found.</p>
      </div>
    );
  }

  const slugWords = change.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  const slug = `${change.code.toLowerCase()}-${slugWords.join('-')}`;

  const handleSaveTeam = async (): Promise<void> => {
    setSaving(true);
    setSavedNotice(false);
    try {
      await forgeApi.updateChangeTeam(change.id, {
        permissionTier,
        team: {
          workerAdapterId,
          workerModel,
          juniorAuditModel: jqaModel,
          seniorAuditModel: sqaModel,
          maxRetryLoops: Math.max(1, Number(maxLoops) || 3),
        },
      });
      setEditingRole(null);
      setSavedNotice(true);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (): Promise<void> => {
    try {
      await forgeApi.archiveChange(change.id);
      onRefresh();
      onBack();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const devAdapterLabel =
    snapshot.adapters.find(a => a.manifest.id === workerAdapterId)?.manifest
      .label ?? workerAdapterId;

  return (
    <div className="page-scroll">
      {/* Top Change Header Row (1:1 Reference Match) */}
      <div className="change-dash-header">
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <button type="button" className="btn btn-sm" onClick={onBack}>
            <ArrowLeftIcon size={13} /> Back
          </button>
          <div className="change-dash-title">
            <span style={{color: '#475569', display: 'flex'}}>
              <GitBranchIcon size={18} />
            </span>
            <span>{slug}</span>
            <span className="tag tag-green">
              {change.status === 'certified' ? 'CERTIFIED' : 'ACTIVE'}
            </span>
            <span className="tag tag-green">◎ Synced</span>
          </div>
        </div>

        <div style={{display: 'flex', gap: 8}}>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => onOpenWorkstation(change.id)}
          >
            Live View →
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void handleArchive()}
          >
            <ArchiveIcon size={13} /> Archive
          </button>
        </div>
      </div>

      {/* Underline Tabs: Team | Docs | Actions */}
      <div className="underline-tabs">
        <button
          type="button"
          className={`underline-tab ${tab === 'team' ? 'active' : ''}`}
          onClick={() => setTab('team')}
        >
          <UsersIcon size={14} /> Team
        </button>
        <button
          type="button"
          className={`underline-tab ${tab === 'docs' ? 'active' : ''}`}
          onClick={() => setTab('docs')}
        >
          <FileTextIcon size={14} /> Docs
        </button>
        <button
          type="button"
          className={`underline-tab ${tab === 'actions' ? 'active' : ''}`}
          onClick={() => setTab('actions')}
        >
          <ZapIcon size={14} /> Actions
        </button>
      </div>

      {tab === 'team' && (
        <div className="change-dash-grid">
          {/* Left Card: Change Team Configuration */}
          <div className="surface-card">
            <div className="surface-card-header">
              <span
                style={{display: 'inline-flex', alignItems: 'center', gap: 8}}
              >
                <UsersIcon size={15} />
                <span>Change Team Configuration</span>
              </span>
              <span className="tag tag-indigo">
                {repo?.tier === 'infra' ? 'T5 / P5' : 'T3 / P5'}
              </span>
            </div>

            <div className="surface-card-body">
              <div className="team-selects-grid">
                <div>
                  <label className="field-label">TEAM (T)</label>
                  <select
                    value={repo?.tier === 'infra' ? 'T5' : 'T3'}
                    onChange={() => {}}
                  >
                    <option value="T5">T5: Infra Core (DEV + Ju...)</option>
                    <option value="T3">T3: Service Delivery</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">PROCESS (P)</label>
                  <select
                    value={permissionTier}
                    onChange={e =>
                      setPermissionTier(e.target.value as PermissionTier)
                    }
                  >
                    <option value="turbo">P5: Dual TQLA Auto</option>
                    <option value="supervised">P3: Supervised Gate</option>
                    <option value="strict">P1: Strict Human Gate</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">LEVEL</label>
                  <select defaultValue="L3">
                    <option value="L3">L3: Composite Component</option>
                    <option value="L4">L4: Domain Subsystem</option>
                    <option value="L5">L5: Core Platform</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">CATEGORY</label>
                  <select defaultValue={repo?.tier === 'infra' ? 'C6' : 'C2'}>
                    <option value="C6">C6: INFRA (IA)</option>
                    <option value="C2">C2: Business Domain</option>
                  </select>
                </div>
              </div>

              {/* Member Row 1: DEV */}
              <div className="team-member-row">
                <div className="team-role-badge">
                  <span style={{color: '#4f46e5'}}>
                    <CpuIcon size={16} />
                  </span>
                  <span>DEV</span>
                </div>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{fontWeight: 700, color: '#0f172a'}}>
                      {devAdapterLabel}
                    </span>
                    <span className="tag tag-green">Clone</span>
                    <span className="tag tag-blue">{workerModel}</span>
                  </div>
                  <button
                    type="button"
                    className="topbar-util-btn"
                    style={{padding: '4px 0', marginTop: 4, fontSize: 12}}
                    onClick={() =>
                      setEditingRole(editingRole === 'dev' ? null : 'dev')
                    }
                  >
                    <SlidersIcon size={12} /> Modify
                  </button>
                  {editingRole === 'dev' && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 10,
                        marginTop: 8,
                      }}
                    >
                      <select
                        value={workerAdapterId}
                        onChange={e => setWorkerAdapterId(e.target.value)}
                      >
                        {snapshot.adapters.map(a => (
                          <option key={a.manifest.id} value={a.manifest.id}>
                            {a.manifest.label} ({a.manifest.id})
                          </option>
                        ))}
                      </select>
                      <input
                        value={workerModel}
                        onChange={e => setWorkerModel(e.target.value)}
                        placeholder="Worker model ID"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Member Row 2: Junior-QA */}
              <div className="team-member-row">
                <div className="team-role-badge">
                  <span style={{color: '#475569'}}>
                    <ZapIcon size={16} />
                  </span>
                  <span>Junior-QA</span>
                </div>
                <div>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <span className="tag tag-green">Clone</span>
                    <span className="tag tag-blue">{jqaModel}</span>
                  </div>
                  <button
                    type="button"
                    className="topbar-util-btn"
                    style={{padding: '4px 0', marginTop: 4, fontSize: 12}}
                    onClick={() =>
                      setEditingRole(editingRole === 'jqa' ? null : 'jqa')
                    }
                  >
                    <SlidersIcon size={12} /> Modify
                  </button>
                  {editingRole === 'jqa' && (
                    <div style={{marginTop: 8}}>
                      <input
                        value={jqaModel}
                        onChange={e => setJqaModel(e.target.value)}
                        placeholder="Junior-QA model ID"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Member Row 3: Senior-QA */}
              <div className="team-member-row" style={{marginBottom: 0}}>
                <div className="team-role-badge">
                  <span style={{color: '#475569'}}>
                    <ZapIcon size={16} />
                  </span>
                  <span>Senior-QA</span>
                </div>
                <div>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <span className="tag tag-green">Clone</span>
                    <span className="tag tag-blue">{sqaModel}</span>
                  </div>
                  <button
                    type="button"
                    className="topbar-util-btn"
                    style={{padding: '4px 0', marginTop: 4, fontSize: 12}}
                    onClick={() =>
                      setEditingRole(editingRole === 'sqa' ? null : 'sqa')
                    }
                  >
                    <SlidersIcon size={12} /> Modify
                  </button>
                  {editingRole === 'sqa' && (
                    <div style={{marginTop: 8}}>
                      <input
                        value={sqaModel}
                        onChange={e => setSqaModel(e.target.value)}
                        placeholder="Senior-QA model ID"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Card: TQLA Configuration (1:1 Reference Match) */}
          <div className="tqla-card">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 700,
                color: '#1e293b',
              }}
            >
              <SettingsIcon size={15} />
              <span>TQLA Configuration</span>
            </div>

            <div className="tqla-banner">
              <CheckCircleIcon size={14} />
              <span>P5 模式：双级质量门禁已启用</span>
            </div>

            <div className="tqla-level-box">
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#475569',
                  marginBottom: 10,
                }}
              >
                LEVEL 1: JUNIOR QA (CONSISTENCY)
              </div>
              <div style={{marginBottom: 10}}>
                <label className="field-label">Audit Model</label>
                <input
                  value={jqaModel}
                  onChange={e => setJqaModel(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Max Loops (Retry Limit)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxLoops}
                  onChange={e => setMaxLoops(e.target.value)}
                />
              </div>
            </div>

            <div className="tqla-level-box">
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#475569',
                  marginBottom: 10,
                }}
              >
                LEVEL 2: SENIOR QA (LOGIC)
              </div>
              <div style={{marginBottom: 10}}>
                <label className="field-label">Audit Model</label>
                <input
                  value={sqaModel}
                  onChange={e => setSqaModel(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Max Loops (Final Audit)</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={sqaLoops}
                  onChange={e => setSqaLoops(e.target.value)}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 14,
              }}
            >
              <span style={{fontSize: 12, color: '#16a34a', fontWeight: 600}}>
                {savedNotice ? '✓ Configuration saved' : ''}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void handleSaveTeam()}
              >
                Save TQLA & Team
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'docs' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr',
            gap: 18,
            marginTop: 18,
          }}
        >
          <div className="surface-card">
            <div className="surface-card-header">
              <span>Change Specification (SPEC / DESIGN)</span>
              <span className="tag tag-indigo">{change.code}</span>
            </div>
            <div className="surface-card-body">
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  lineHeight: 1.65,
                  color: '#1e293b',
                }}
              >
                {change.specMarkdown}
              </pre>
            </div>
          </div>

          <div className="surface-card">
            <div className="surface-card-header">
              <span>Acceptance Criteria & Ubiquitous Language</span>
            </div>
            <div className="surface-card-body">
              <div className="field-label">Acceptance Criteria</div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginBottom: 18,
                }}
              >
                {change.acceptanceCriteria.map(ac => (
                  <div
                    key={ac.id}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 7,
                      border: '1px solid #e2e8f0',
                      background: ac.certified ? '#f0fdf4' : '#f8fafc',
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <span style={{color: ac.certified ? '#16a34a' : '#94a3b8'}}>
                      {ac.certified ? '✓' : '○'}
                    </span>
                    <span>{ac.statement}</span>
                  </div>
                ))}
              </div>

              <div className="field-label">Bound DDD Terms</div>
              <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                {snapshot.domainTerms
                  .filter(t => t.hubId === change.hubId)
                  .map(t => (
                    <div
                      key={t.id}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 7,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <div style={{fontWeight: 700}}>
                        {t.canonicalTerm}{' '}
                        <span className="tag tag-indigo">
                          {t.boundedContext}
                        </span>
                      </div>
                      <div
                        style={{fontSize: 12, color: '#64748b', marginTop: 3}}
                      >
                        Forbidden aliases:{' '}
                        {t.forbiddenAliases.join(', ') || 'none'}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'actions' && (
        <div className="surface-card" style={{marginTop: 18}}>
          <div className="surface-card-header">
            <span>Lifecycle & Worktree Operations</span>
          </div>
          <div
            className="surface-card-body"
            style={{display: 'flex', gap: 12, flexWrap: 'wrap'}}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void forgeApi.executeChange(change.id).then(() => {
                  onRefresh();
                  onOpenWorkstation(change.id);
                });
              }}
            >
              <PlayIcon size={13} /> Execute & Open Twin Graph
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void forgeApi
                  .runRetroOptimization(change.id)
                  .then(() => onRefresh());
              }}
            >
              Compress Retro Summary into Hub Wiki
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handleArchive()}
            >
              <ArchiveIcon size={13} /> Archive This Change Only
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

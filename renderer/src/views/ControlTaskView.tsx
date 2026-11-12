import {useEffect, useState, type ReactElement} from 'react';
import type {
  BootstrapSnapshot,
  EvidenceSearchHit,
  MemoryObservatorySnapshot,
} from '../../../src/shared/api.ts';
import type {
  PermissionTier,
  RehydrationCapsule,
  TranscriptMessage,
} from '../../../src/shared/types.ts';
import {
  forgeApi,
  type DoctorReportDto,
  type DreamConsolidationDto,
} from '../api/client.ts';
import {
  ActivityIcon,
  CalendarIcon,
  GlobeIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
} from '../components/Icons.tsx';

export type ControlSection = 'sessions' | 'cron' | 'heartbeat' | 'environments';

function RetentionCurveSvg({
  capsule,
}: {
  readonly capsule: RehydrationCapsule;
}): ReactElement {
  const w = 340;
  const h = 92;
  const pad = 12;
  const maxT = 72;
  const s = Math.max(1, capsule.stabilityHours);
  const pts: string[] = [];

  for (let t = 0; t <= maxT; t += 2) {
    const r = Math.exp(-t / s);
    const x = pad + (t / maxT) * (w - pad * 2);
    const y = h - pad - r * (h - pad * 2);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  const curT = Math.min(maxT, capsule.elapsedHours);
  const curX = pad + (curT / maxT) * (w - pad * 2);
  const curY = h - pad - capsule.retentionScore * (h - pad * 2);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{
        background: '#f8fafc',
        borderRadius: 8,
        border: '1px solid #e2e8f0',
      }}
    >
      <line
        x1={pad}
        y1={h - pad - 0.55 * (h - pad * 2)}
        x2={w - pad}
        y2={h - pad - 0.55 * (h - pad * 2)}
        stroke="#cbd5e1"
        strokeDasharray="3 3"
      />
      <polyline
        fill="none"
        stroke="#6366f1"
        strokeWidth="2.2"
        points={pts.join(' ')}
      />
      <circle
        cx={curX}
        cy={curY}
        r="4.5"
        fill="#16a34a"
        stroke="#ffffff"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function ControlTaskView(props: {
  readonly section: ControlSection;
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly onSelectHub: (hubId: string) => void;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly refreshTick: number;
  readonly onRefresh: () => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {
    section,
    snapshot,
    activeHubId,
    onSelectHub,
    onOpenWorkstation,
    refreshTick,
    onRefresh,
    onError,
  } = props;

  // --- Sessions & Memory State ---
  const [memSnap, setMemSnap] = useState<MemoryObservatorySnapshot | null>(
    null,
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [sessionMsgs, setSessionMsgs] = useState<readonly TranscriptMessage[]>(
    [],
  );
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly EvidenceSearchHit[]>([]);
  const [dreamReport, setDreamReport] = useState<DreamConsolidationDto | null>(
    null,
  );

  // --- Environments State ---
  const [hubName, setHubName] = useState('');
  const [hubRoot, setHubRoot] = useState('');
  const [hubDesc, setHubDesc] = useState('');
  const [hubTier, setHubTier] = useState<PermissionTier>('turbo');
  const [doctor, setDoctor] = useState<DoctorReportDto | null>(null);

  useEffect(() => {
    if (section !== 'sessions' && section !== 'cron') return;
    void forgeApi.getMemoryObservatory(activeHubId).then(s => {
      setMemSnap(s);
      if (!selectedSessionId && s.recentSessions[0]) {
        setSelectedSessionId(s.recentSessions[0].id);
      }
    });
  }, [section, activeHubId, refreshTick, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || section !== 'sessions') return;
    void forgeApi
      .getSessionMessages(selectedSessionId)
      .then(m => setSessionMsgs(m));
  }, [selectedSessionId, section, refreshTick]);

  // =========================================================================
  // 1. SESSIONS (Transcripts + FTS5 Evidence + Bi-Temporal Semantic Memory)
  // =========================================================================
  if (section === 'sessions') {
    return (
      <div className="page-scroll">
        <div className="page-header">
          <h1 className="page-h1">
            <UsersIcon size={20} /> Sessions & Cognitive Evidence
          </h1>
          <p className="page-subtitle">
            Append-only execution transcripts, SQLite FTS5 keyword evidence
            search, and bi-temporal semantic memories.
          </p>
        </div>

        <div className="surface-card" style={{marginBottom: 18}}>
          <div className="surface-card-header">
            <span>SQLite FTS5 Transcript Evidence Search</span>
          </div>
          <div className="surface-card-body">
            <div style={{display: 'flex', gap: 8}}>
              <input
                placeholder="Search exact domain identifiers across sessions (e.g. SettlementVoucher)..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && query.trim()) {
                    void forgeApi
                      .searchEvidence(query.trim(), activeHubId)
                      .then(r => setHits(r));
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!query.trim()) return;
                  void forgeApi
                    .searchEvidence(query.trim(), activeHubId)
                    .then(r => setHits(r));
                }}
              >
                <SearchIcon size={14} /> Search
              </button>
            </div>

            {hits.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {hits.map(h => (
                  <div
                    key={h.messageId}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 7,
                      border: '1px solid #e2e8f0',
                      background: '#f8fafc',
                    }}
                  >
                    <div
                      style={{fontSize: 11, fontWeight: 700, color: '#4f46e5'}}
                    >
                      {h.adapterId} · {h.role} ·{' '}
                      {new Date(h.createdAt).toLocaleTimeString()}
                    </div>
                    <div style={{fontSize: 12.5, marginTop: 2}}>
                      {h.snippet}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          style={{display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18}}
        >
          <div className="surface-card">
            <div className="surface-card-header">
              <span>
                Recorded Sessions ({memSnap?.recentSessions.length ?? 0})
              </span>
            </div>
            <div
              className="surface-card-body"
              style={{
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {(memSnap?.recentSessions ?? []).length === 0 ? (
                <div style={{padding: 10, color: '#94a3b8'}}>
                  Run a Change in Workstation to record execution sessions.
                </div>
              ) : (
                memSnap?.recentSessions.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`nav-item ${
                      selectedSessionId === s.id ? 'active' : ''
                    }`}
                    onClick={() => setSelectedSessionId(s.id)}
                  >
                    <div>
                      <div style={{fontWeight: 600}}>
                        {s.adapterId} · {s.role}
                      </div>
                      <div style={{fontSize: 11, color: '#64748b'}}>
                        {s.model}
                      </div>
                    </div>
                    <span
                      className={`tag ${
                        s.status === 'completed' ? 'tag-green' : ''
                      }`}
                    >
                      {s.status}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="surface-card">
            <div className="surface-card-header">
              <span>Session Transcript & Active Semantic Memories</span>
              <span className="tag tag-indigo">
                {memSnap?.activeMemories.length ?? 0} Active Memories
              </span>
            </div>
            <div
              className="surface-card-body"
              style={{display: 'flex', flexDirection: 'column', gap: 10}}
            >
              {sessionMsgs.map(m => (
                <div
                  key={m.id}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                    background: m.role === 'assistant' ? '#f8fafc' : '#ffffff',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#4f46e5',
                      marginBottom: 4,
                    }}
                  >
                    {m.role.toUpperCase()}
                    {m.toolName ? ` · ${m.toolName}` : ''}
                  </div>
                  <div style={{whiteSpace: 'pre-wrap'}}>{m.content}</div>
                </div>
              ))}

              {(memSnap?.activeMemories ?? []).length > 0 && (
                <div style={{marginTop: 10}}>
                  <div className="field-label">
                    Bi-Temporal Active Semantic Memories (`valid_until = NULL`)
                  </div>
                  {memSnap?.activeMemories.map(mem => (
                    <div
                      key={mem.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        marginBottom: 8,
                      }}
                    >
                      <div style={{fontWeight: 700}}>
                        {mem.title}{' '}
                        <span className="tag tag-indigo">{mem.kind}</span>
                      </div>
                      <div style={{color: '#475569', marginTop: 3}}>
                        {mem.summary}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. CRON JOBS (Continuity Watchdog, Sleep Consolidation, Steward Patrol)
  // =========================================================================
  if (section === 'cron') {
    return (
      <div className="page-scroll">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 20,
          }}
        >
          <div>
            <h1 className="page-h1">
              <CalendarIcon size={20} /> Cron Jobs & Autonomous Schedules
            </h1>
            <p className="page-subtitle">
              Scheduled background engines for 8h continuity recovery,
              sleep-time cognitive consolidation, and worktree hygiene.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void forgeApi.runSleepConsolidation().then(rep => {
                setDreamReport(rep);
                onRefresh();
              });
            }}
          >
            Trigger Sleep Consolidation Pass
          </button>
        </div>

        {dreamReport && (
          <div
            className="surface-card"
            style={{
              marginBottom: 18,
              borderColor: '#bbf7d0',
              background: '#f0fdf4',
            }}
          >
            <div className="surface-card-body">
              <strong>Sleep Consolidation Complete:</strong> Extracted{' '}
              {dreamReport.extractedPitfalls} pitfall lessons · Superseded{' '}
              {dreamReport.supersededDriftedMemories} drifted memories ·
              Refreshed {dreamReport.capsulesRefreshed} Hub capsules.
            </div>
          </div>
        )}

        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          {snapshot.daemons.map(d => (
            <div key={d.id} className="surface-card">
              <div className="surface-card-header">
                <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                  <span>{d.label}</span>
                  <span className="tag tag-blue">
                    Every {d.intervalSeconds}s
                  </span>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                  <span className={`tag ${d.enabled ? 'tag-green' : ''}`}>
                    {d.enabled ? 'ACTIVE' : 'PAUSED'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      void forgeApi
                        .setDaemonEnabled(d.id, !d.enabled)
                        .then(() => onRefresh());
                    }}
                  >
                    {d.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
              <div className="surface-card-body" style={{color: '#475569'}}>
                {d.lastSummary || 'Awaiting next scheduled execution window.'}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. HEARTBEAT (Attention Triage + Dual Ebbinghaus Retention + Slot Broker)
  // =========================================================================
  if (section === 'heartbeat') {
    return (
      <div className="page-scroll">
        <div className="page-header">
          <h1 className="page-h1">
            <ActivityIcon size={20} /> Heartbeat & Cognitive Attention
          </h1>
          <p className="page-subtitle">
            1-Card-1-Decision human attention triage, Dual Ebbinghaus context
            retention curves, and worker slot saturation.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div className="surface-card">
            <div className="surface-card-body">
              <div className="field-label">Active Worker Slots</div>
              <div style={{fontSize: 22, fontWeight: 800, color: '#4f46e5'}}>
                {snapshot.slotLoad.activeWorkerSlots} /{' '}
                {snapshot.slotLoad.maxWorkerSlots}
              </div>
            </div>
          </div>
          <div className="surface-card">
            <div className="surface-card-body">
              <div className="field-label">Open Attention Decisions</div>
              <div style={{fontSize: 22, fontWeight: 800, color: '#d97706'}}>
                {snapshot.attentionQueue.length}
              </div>
            </div>
          </div>
          <div className="surface-card">
            <div className="surface-card-body">
              <div className="field-label">Active Changes</div>
              <div style={{fontSize: 22, fontWeight: 800, color: '#16a34a'}}>
                {snapshot.changes.length}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 18}}
        >
          <div className="surface-card">
            <div className="surface-card-header">
              <span>1-Card-1-Decision Attention Queue</span>
            </div>
            <div
              className="surface-card-body"
              style={{display: 'flex', flexDirection: 'column', gap: 12}}
            >
              {snapshot.attentionQueue.length === 0 ? (
                <div style={{color: '#16a34a', fontWeight: 600}}>
                  ✓ Zero human blockers — autonomous pipelines are clear.
                </div>
              ) : (
                snapshot.attentionQueue.map(item => (
                  <div
                    key={item.id}
                    style={{
                      padding: 14,
                      borderRadius: 9,
                      border: '1px solid #e2e8f0',
                      background: '#fafbfc',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                      }}
                    >
                      <span className="tag tag-amber">{item.kind}</span>
                      <span style={{fontSize: 11.5, color: '#64748b'}}>
                        ~{item.estimatedReadSeconds}s read
                      </span>
                    </div>
                    <div style={{fontWeight: 700, marginBottom: 6}}>
                      {item.question}
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: '#475569',
                        marginBottom: 12,
                      }}
                    >
                      {item.contextSnippet}
                    </div>
                    <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                      {item.options.map((opt, idx) => (
                        <button
                          key={opt}
                          type="button"
                          className={`btn btn-sm ${
                            idx === item.recommendedIndex ? 'btn-primary' : ''
                          }`}
                          onClick={() => {
                            void forgeApi
                              .resolveAttention(item.id, opt)
                              .then(() => {
                                onRefresh();
                                if (item.changeId) {
                                  onOpenWorkstation(item.changeId);
                                }
                              });
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="surface-card">
            <div className="surface-card-header">
              <span>Human Context Retention Curves</span>
            </div>
            <div
              className="surface-card-body"
              style={{display: 'flex', flexDirection: 'column', gap: 14}}
            >
              {snapshot.capsules.map(cap => (
                <div key={cap.hubId}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <strong>{cap.hubName}</strong>
                    <span className="tag tag-green">
                      R = {Math.round(cap.retentionScore * 100)}% ({cap.tier})
                    </span>
                  </div>
                  <RetentionCurveSvg capsule={cap} />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: 6,
                    }}
                  >
                    <span style={{fontSize: 11.5, color: '#64748b'}}>
                      Stability S = {cap.stabilityHours.toFixed(1)}h
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        void forgeApi
                          .anchorHubReview(cap.hubId)
                          .then(() => onRefresh());
                      }}
                    >
                      Re-Anchor Context
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 4. ENVIRONMENTS (Federation Hubs & Sandbox Configuration)
  // =========================================================================
  return (
    <div className="page-scroll">
      <div className="page-header">
        <h1 className="page-h1">
          <GlobeIcon size={20} /> Environments & Federation Hubs
        </h1>
        <p className="page-subtitle">
          Manage Multi-Repo Federation Hubs, local Git worktree sandboxes, and
          host toolchain readiness.
        </p>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18}}>
        <div className="surface-card">
          <div className="surface-card-header">
            <span>Registered Federation Hubs ({snapshot.hubs.length})</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void forgeApi.runEnvironmentDoctor().then(d => setDoctor(d));
              }}
            >
              Verify Host Toolchain
            </button>
          </div>
          <div
            className="surface-card-body"
            style={{display: 'flex', flexDirection: 'column', gap: 12}}
          >
            {doctor && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  fontSize: 12.5,
                }}
              >
                ✓ {doctor.gitVersion} · Node {doctor.nodeVersion}
              </div>
            )}

            {snapshot.hubs.map(h => (
              <div
                key={h.id}
                style={{
                  padding: 14,
                  borderRadius: 9,
                  border:
                    h.id === activeHubId
                      ? '1.5px solid #6366f1'
                      : '1px solid #e2e8f0',
                  background: h.id === activeHubId ? '#f5f7ff' : '#ffffff',
                  cursor: 'pointer',
                }}
                onClick={() => onSelectHub(h.id)}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <strong>{h.name}</strong>
                  <span className="tag tag-indigo">{h.permissionTier}</span>
                </div>
                <div style={{fontSize: 12, color: '#64748b', marginTop: 4}}>
                  {h.description}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: '#94a3b8',
                    marginTop: 6,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  Root: {h.rootPath}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="surface-card">
          <div className="surface-card-header">
            <span>Create New Federation Hub</span>
          </div>
          <div
            className="surface-card-body"
            style={{display: 'flex', flexDirection: 'column', gap: 12}}
          >
            <div>
              <label className="field-label">Federation Hub Name</label>
              <input
                placeholder="e.g. Risk & Clearing Platform"
                value={hubName}
                onChange={e => setHubName(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Workspace Root Directory</label>
              <div style={{display: 'flex', gap: 8}}>
                <input
                  placeholder="D:/workspaces/risk-clearing"
                  value={hubRoot}
                  onChange={e => setHubRoot(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void forgeApi.pickDirectory().then(p => {
                      if (p) setHubRoot(p);
                    });
                  }}
                >
                  Browse
                </button>
              </div>
            </div>
            <div>
              <label className="field-label">Default Permission Tier</label>
              <select
                value={hubTier}
                onChange={e => setHubTier(e.target.value as PermissionTier)}
              >
                <option value="turbo">Turbo Auto</option>
                <option value="supervised">Supervised</option>
                <option value="strict">Strict Human Gate</option>
              </select>
            </div>
            <div>
              <label className="field-label">North-Star Charter</label>
              <textarea
                rows={3}
                placeholder="Domain boundaries and architectural objectives..."
                value={hubDesc}
                onChange={e => setHubDesc(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!hubName.trim() || !hubRoot.trim()}
              onClick={() => {
                void forgeApi
                  .createHub({
                    name: hubName.trim(),
                    rootPath: hubRoot.trim(),
                    description: hubDesc.trim(),
                    permissionTier: hubTier,
                  })
                  .then(created => {
                    setHubName('');
                    setHubRoot('');
                    setHubDesc('');
                    onSelectHub(created.id);
                    onRefresh();
                  })
                  .catch(err =>
                    onError(err instanceof Error ? err.message : String(err)),
                  );
              }}
            >
              <PlusIcon size={14} /> Create Federation Hub
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

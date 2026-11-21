import {useEffect, useState, type ReactElement} from 'react';
import type {
  BootstrapSnapshot,
  EvidenceSearchHit,
  GitReconcileResult,
  MemoryLivingDocRecord,
  MemoryObservatorySnapshot,
  MemoryObservationRecord,
  MemoryRecallResult,
  MemoryReflectResult,
} from '../../../src/shared/api.ts';
import type {
  PermissionTier,
  RehydrationCapsule,
  TranscriptMessage,
} from '../../../src/shared/types.ts';
import type {ExecutionMode} from '../../../src/shared/v3-types.ts';
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
  RefreshIcon,
  SearchIcon,
  UsersIcon,
} from '../components/Icons.tsx';
import {
  formatDaemonLabel,
  formatPermissionTier,
  formatStatusLabel,
  tr,
  type UiLang,
} from '../i18n.ts';

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
  readonly lang: UiLang;
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
    lang,
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

  // --- Hindsight Memory & Git Reconciliation State ---
  const [memMode, setMemMode] = useState<ExecutionMode>('live');
  const [memTab, setMemTab] = useState<'recall' | 'docs' | 'observations'>(
    'observations',
  );
  const [memQuery, setMemQuery] = useState('');
  const [recallResult, setRecallResult] = useState<MemoryRecallResult | null>(
    null,
  );
  const [reflectResult, setReflectResult] =
    useState<MemoryReflectResult | null>(null);
  const [livingDocs, setLivingDocs] = useState<
    readonly MemoryLivingDocRecord[]
  >([]);
  const [expandedDocIds, setExpandedDocIds] = useState<Record<string, boolean>>(
    {},
  );
  const [observations, setObservations] = useState<
    readonly MemoryObservationRecord[]
  >([]);
  const [reconcileResult, setReconcileResult] =
    useState<GitReconcileResult | null>(null);
  const [statementEdits, setStatementEdits] = useState<Record<string, string>>(
    {},
  );
  const [memBusy, setMemBusy] = useState(false);

  const loadHindsightData = async (): Promise<void> => {
    if (!activeHubId) return;
    try {
      const [docs, obs] = await Promise.all([
        forgeApi.listLivingDocs(activeHubId, memMode),
        forgeApi.listObservations(activeHubId, memMode, false),
      ]);
      setLivingDocs(docs);
      setObservations(obs);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (section !== 'heartbeat' || !activeHubId) return;
    void Promise.all([
      forgeApi.listLivingDocs(activeHubId, memMode),
      forgeApi.listObservations(activeHubId, memMode, false),
    ])
      .then(([docs, obs]) => {
        setLivingDocs(docs);
        setObservations(obs);
      })
      .catch(err => onError(err instanceof Error ? err.message : String(err)));
  }, [section, activeHubId, memMode, refreshTick, onError]);

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
            <UsersIcon size={20} />{' '}
            {tr(
              lang,
              '会话轨迹与认知证据库 (Sessions & Evidence)',
              'Sessions & Cognitive Evidence',
            )}
          </h1>
          <p className="page-subtitle">
            {tr(
              lang,
              '追加式不可变会话日志、SQLite FTS5 全文精确取证检索，以及支持 valid_from / valid_until 的双时态语义经验库。',
              'Append-only execution transcripts, SQLite FTS5 keyword evidence search, and bi-temporal semantic memories.',
            )}
          </p>
        </div>

        <div className="surface-card" style={{marginBottom: 18}}>
          <div className="surface-card-header">
            <span>
              {tr(
                lang,
                'SQLite FTS5 跨会话全文证据检索',
                'SQLite FTS5 Transcript Evidence Search',
              )}
            </span>
          </div>
          <div className="surface-card-body">
            <div style={{display: 'flex', gap: 8}}>
              <input
                placeholder={tr(
                  lang,
                  '搜索跨会话精确领域标识符或报错特征（如 SettlementVoucher）...',
                  'Search exact domain identifiers across sessions (e.g. SettlementVoucher)...',
                )}
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
                <SearchIcon size={14} /> {tr(lang, '全文检索', 'Search')}
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
                    <div
                      className="selectable"
                      style={{fontSize: 12.5, marginTop: 2}}
                    >
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
                {tr(
                  lang,
                  `已归档执行会话 (${memSnap?.recentSessions.length ?? 0})`,
                  `Recorded Sessions (${memSnap?.recentSessions.length ?? 0})`,
                )}
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
                  {tr(
                    lang,
                    '在「双生图工作台」启动变更单后，全部 DEV / JQA / SQA 会话将自动归档于此。',
                    'Run a Change in Workstation to record execution sessions.',
                  )}
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
                      {formatStatusLabel(lang, s.status)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="surface-card">
            <div className="surface-card-header">
              <span>
                {tr(
                  lang,
                  '会话完整轨迹与活跃双时态语义记忆',
                  'Session Transcript & Active Semantic Memories',
                )}
              </span>
              <span className="tag tag-indigo">
                {tr(
                  lang,
                  `${memSnap?.activeMemories.length ?? 0} 条有效记忆`,
                  `${memSnap?.activeMemories.length ?? 0} Active Memories`,
                )}
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
                  <div className="selectable" style={{whiteSpace: 'pre-wrap'}}>
                    {m.content}
                  </div>
                </div>
              ))}

              {(memSnap?.activeMemories ?? []).length > 0 && (
                <div style={{marginTop: 10}}>
                  <div className="field-label">
                    {tr(
                      lang,
                      '双时态有效语义经验记忆 (valid_until = NULL)',
                      'Bi-Temporal Active Semantic Memories (valid_until = NULL)',
                    )}
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
                      <div
                        className="selectable"
                        style={{color: '#475569', marginTop: 3}}
                      >
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
              <CalendarIcon size={20} />{' '}
              {tr(
                lang,
                '自治定时任务与睡眠整合 (Cron & DreamingDaemon)',
                'Cron Jobs & Autonomous Schedules',
              )}
            </h1>
            <p className="page-subtitle">
              {tr(
                lang,
                '管理 8 小时无人值守连续性恢复、夜间限流自动续跑、睡眠期认知整合与残留 Worktree 清理。',
                'Scheduled background engines for 8h continuity recovery, sleep-time cognitive consolidation, and worktree hygiene.',
              )}
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
            {tr(
              lang,
              '立即触发睡眠期认知整合',
              'Trigger Sleep Consolidation Pass',
            )}
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
              <strong>
                {tr(
                  lang,
                  '睡眠期认知整合已完成：',
                  'Sleep Consolidation Complete:',
                )}
              </strong>{' '}
              {tr(
                lang,
                `提炼避坑经验卡 ${dreamReport.extractedPitfalls} 条 · 淘汰过期漂移记忆 ${dreamReport.supersededDriftedMemories} 条 · 刷新中枢重锚胶囊 ${dreamReport.capsulesRefreshed} 份。`,
                `Extracted ${dreamReport.extractedPitfalls} pitfall lessons · Superseded ${dreamReport.supersededDriftedMemories} drifted memories · Refreshed ${dreamReport.capsulesRefreshed} Hub capsules.`,
              )}
            </div>
          </div>
        )}

        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          {snapshot.daemons.map(d => (
            <div key={d.id} className="surface-card">
              <div className="surface-card-header">
                <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                  <span>{formatDaemonLabel(lang, d.id, d.label)}</span>
                  <span className="tag tag-blue">
                    {tr(
                      lang,
                      `每 ${d.intervalSeconds} 秒执行`,
                      `Every ${d.intervalSeconds}s`,
                    )}
                  </span>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                  <span className={`tag ${d.enabled ? 'tag-green' : ''}`}>
                    {d.enabled
                      ? tr(lang, '运行就绪', 'ACTIVE')
                      : tr(lang, '已暂停', 'PAUSED')}
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
                    {d.enabled
                      ? tr(lang, '停用', 'Disable')
                      : tr(lang, '启用', 'Enable')}
                  </button>
                </div>
              </div>
              <div className="surface-card-body" style={{color: '#475569'}}>
                {d.lastSummary ||
                  tr(
                    lang,
                    '等待下一轮定时调度窗口触发。',
                    'Awaiting next scheduled execution window.',
                  )}
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
            <ActivityIcon size={20} />{' '}
            {tr(
              lang,
              '心跳监控与双向艾宾浩斯注意力中枢',
              'Heartbeat & Cognitive Attention',
            )}
          </h1>
          <p className="page-subtitle">
            {tr(
              lang,
              '践行 SDD「一卡一决策（推荐项置顶）」人类注意力守恒公理，实时绘制项目心智遗忘衰减曲线与并发槽位负载。',
              '1-Card-1-Decision human attention triage, Dual Ebbinghaus context retention curves, and worker slot saturation.',
            )}
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
              <div className="field-label">
                {tr(lang, '活跃并发执行槽位', 'Active Worker Slots')}
              </div>
              <div style={{fontSize: 22, fontWeight: 800, color: '#4f46e5'}}>
                {snapshot.slotLoad.activeWorkerSlots} /{' '}
                {snapshot.slotLoad.maxWorkerSlots}
              </div>
            </div>
          </div>
          <div className="surface-card">
            <div className="surface-card-body">
              <div className="field-label">
                {tr(lang, '待人类拍板决策项', 'Open Attention Decisions')}
              </div>
              <div style={{fontSize: 22, fontWeight: 800, color: '#d97706'}}>
                {snapshot.attentionQueue.length}
              </div>
            </div>
          </div>
          <div className="surface-card">
            <div className="surface-card-body">
              <div className="field-label">
                {tr(lang, '受控推进变更单总数', 'Active Changes')}
              </div>
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
              <span>
                {tr(
                  lang,
                  '一卡一决策人类注意力队列 (1-Card-1-Decision)',
                  '1-Card-1-Decision Attention Queue',
                )}
              </span>
            </div>
            <div
              className="surface-card-body"
              style={{display: 'flex', flexDirection: 'column', gap: 12}}
            >
              {snapshot.attentionQueue.length === 0 ? (
                <div style={{color: '#16a34a', fontWeight: 600}}>
                  {tr(
                    lang,
                    '✓ 当前零人工阻塞项 — 各仓库自治流水线健康推进中。',
                    '✓ Zero human blockers — autonomous pipelines are clear.',
                  )}
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
                        {tr(
                          lang,
                          `预计阅读 ~${item.estimatedReadSeconds} 秒`,
                          `~${item.estimatedReadSeconds}s read`,
                        )}
                      </span>
                    </div>
                    <div style={{fontWeight: 700, marginBottom: 6}}>
                      {item.question}
                    </div>
                    <div
                      className="selectable"
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
              <span>
                {tr(
                  lang,
                  '人脑项目心智艾宾浩斯保持曲线 (R_human)',
                  'Human Context Retention Curves',
                )}
              </span>
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
                      {tr(
                        lang,
                        `记忆稳定度 S = ${cap.stabilityHours.toFixed(1)}h`,
                        `Stability S = ${cap.stabilityHours.toFixed(1)}h`,
                      )}
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
                      {tr(lang, '确认检阅并重锚记忆', 'Re-Anchor Context')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Hindsight Memory & Git Hotfix Reconciliation */}
        <div className="surface-card" style={{marginTop: 18}}>
          <div className="surface-card-header">
            <span>
              {tr(
                lang,
                '长期记忆演进与 Git 热修复同步 (Hindsight Memory & Git Reconciliation)',
                'Hindsight Memory & Git Hotfix Reconciliation',
              )}
            </span>
            <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
              <select
                style={{width: 'auto', padding: '4px 8px', fontSize: 12}}
                value={memMode}
                onChange={e => setMemMode(e.target.value as ExecutionMode)}
              >
                <option value="live">
                  {tr(lang, '在线记忆 (live)', 'Live Memory')}
                </option>
                <option value="simulation">
                  {tr(lang, '演练记忆 (simulation)', 'Simulation Memory')}
                </option>
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={memBusy || !activeHubId}
                onClick={() => {
                  setMemBusy(true);
                  void forgeApi
                    .reconcileGitMemory({
                      hubId: activeHubId,
                      executionMode: memMode,
                    })
                    .then(res => {
                      setReconcileResult(res);
                      return loadHindsightData();
                    })
                    .catch(err =>
                      onError(err instanceof Error ? err.message : String(err)),
                    )
                    .finally(() => setMemBusy(false));
                }}
              >
                <RefreshIcon size={12} />{' '}
                {tr(
                  lang,
                  '扫描外部 Git 提交与热修复',
                  'Scan External Git Hotfixes',
                )}
              </button>
            </div>
          </div>

          <div className="surface-card-body">
            {reconcileResult && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 6,
                  border: '1px solid #c7d2fe',
                  background: '#eef2ff',
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                <strong>
                  {tr(lang, 'Git 同步扫描完成：', 'Git Reconcile Summary: ')}
                </strong>
                {reconcileResult.checkedRepos} {tr(lang, '仓', 'repos')} ·{' '}
                {reconcileResult.contestedObservationIds.length}{' '}
                {tr(lang, '条规范待核对', 'contested')} ·{' '}
                {reconcileResult.detectedReverts.length}{' '}
                {tr(lang, '次 Revert 回滚', 'reverts')} ·{' '}
                {reconcileResult.retainedPitfalls}{' '}
                {tr(lang, '条新教训', 'pitfalls retained')}
              </div>
            )}

            <div className="underline-tabs" style={{marginBottom: 14}}>
              <button
                type="button"
                className={`underline-tab ${
                  memTab === 'observations' ? 'active' : ''
                }`}
                onClick={() => setMemTab('observations')}
              >
                {tr(
                  lang,
                  `冲突与规则核对 (${observations.length})`,
                  `Observations & Conflicts (${observations.length})`,
                )}
              </button>
              <button
                type="button"
                className={`underline-tab ${memTab === 'docs' ? 'active' : ''}`}
                onClick={() => setMemTab('docs')}
              >
                {tr(
                  lang,
                  `知识库文档 (${livingDocs.length})`,
                  `Living Docs (${livingDocs.length})`,
                )}
              </button>
              <button
                type="button"
                className={`underline-tab ${
                  memTab === 'recall' ? 'active' : ''
                }`}
                onClick={() => setMemTab('recall')}
              >
                {tr(lang, '检索与问答 (Recall & Reflect)', 'Recall & Reflect')}
              </button>
            </div>

            {memTab === 'recall' && (
              <div>
                <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
                  <input
                    value={memQuery}
                    onChange={e => setMemQuery(e.target.value)}
                    placeholder={tr(
                      lang,
                      '输入技术问题或文件路径以检索多通道证据与综合问答…',
                      'Ask a memory question or enter keywords to recall & reflect...',
                    )}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={memBusy || !memQuery.trim() || !activeHubId}
                    onClick={() => {
                      setMemBusy(true);
                      void forgeApi
                        .recallMemory({
                          hubId: activeHubId,
                          executionMode: memMode,
                          query: memQuery.trim(),
                          limit: 10,
                          includeRejected: true,
                        })
                        .then(setRecallResult)
                        .catch(err =>
                          onError(
                            err instanceof Error ? err.message : String(err),
                          ),
                        )
                        .finally(() => setMemBusy(false));
                    }}
                  >
                    <SearchIcon size={12} /> {tr(lang, '检索证据', 'Recall')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={memBusy || !memQuery.trim() || !activeHubId}
                    onClick={() => {
                      setMemBusy(true);
                      void forgeApi
                        .reflectMemory({
                          hubId: activeHubId,
                          executionMode: memMode,
                          question: memQuery.trim(),
                          limit: 8,
                        })
                        .then(setReflectResult)
                        .catch(err =>
                          onError(
                            err instanceof Error ? err.message : String(err),
                          ),
                        )
                        .finally(() => setMemBusy(false));
                    }}
                  >
                    {tr(lang, '综合问答', 'Reflect')}
                  </button>
                </div>

                {reflectResult && (
                  <div
                    style={{
                      padding: 12,
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      background: '#fafbfc',
                      marginBottom: 12,
                    }}
                  >
                    <div style={{fontWeight: 700, marginBottom: 6}}>
                      {reflectResult.question}
                    </div>
                    <pre
                      className="selectable"
                      style={{
                        margin: '0 0 8px',
                        whiteSpace: 'pre-wrap',
                        fontSize: 12,
                        fontFamily: 'inherit',
                      }}
                    >
                      {reflectResult.answerMarkdown}
                    </pre>
                    {reflectResult.confirmedFacts.length > 0 && (
                      <div style={{fontSize: 11.5, color: '#166534'}}>
                        <strong>Confirmed:</strong>{' '}
                        {reflectResult.confirmedFacts.join(' | ')}
                      </div>
                    )}
                    {reflectResult.contradictions.length > 0 && (
                      <div
                        style={{fontSize: 11.5, color: '#b91c1c', marginTop: 4}}
                      >
                        <strong>Contradictions:</strong>{' '}
                        {reflectResult.contradictions.join(' | ')}
                      </div>
                    )}
                  </div>
                )}

                {recallResult && (
                  <div
                    style={{display: 'flex', flexDirection: 'column', gap: 8}}
                  >
                    {recallResult.hits.map(hit => (
                      <div
                        key={hit.targetId}
                        style={{
                          padding: 10,
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          background: '#ffffff',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: 4,
                          }}
                        >
                          <div style={{display: 'flex', gap: 6}}>
                            <span className="tag tag-indigo">
                              {hit.authorityTier}
                            </span>
                            <span className="tag">
                              score {hit.score.toFixed(2)}
                            </span>
                            {hit.rejectedWarning && (
                              <span className="tag tag-red">
                                {hit.rejectedWarning}
                              </span>
                            )}
                          </div>
                          <span style={{fontSize: 11, color: '#64748b'}}>
                            {hit.pathAnchors.join(', ')}
                          </span>
                        </div>
                        <div style={{fontWeight: 600, fontSize: 12.5}}>
                          {hit.title}
                        </div>
                        <div
                          className="selectable"
                          style={{fontSize: 12, color: '#475569', marginTop: 2}}
                        >
                          {hit.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {memTab === 'docs' && (
              <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                {livingDocs.length === 0 ? (
                  <div style={{color: '#64748b', fontSize: 12}}>
                    {tr(
                      lang,
                      '当前模式暂无自动生成的知识库文档。',
                      'No living documents yet.',
                    )}
                  </div>
                ) : (
                  livingDocs.map(doc => {
                    const expanded = Boolean(expandedDocIds[doc.id]);
                    return (
                      <div
                        key={doc.id}
                        style={{
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          overflow: 'hidden',
                        }}
                      >
                        <button
                          type="button"
                          className="causal-group-header"
                          onClick={() =>
                            setExpandedDocIds(prev => ({
                              ...prev,
                              [doc.id]: !prev[doc.id],
                            }))
                          }
                        >
                          <span>{doc.title}</span>
                          <div style={{display: 'flex', gap: 6}}>
                            <span className="tag">{doc.docKind}</span>
                            <span className="tag">v{doc.version}</span>
                            {doc.stale && (
                              <span className="tag tag-amber">STALE</span>
                            )}
                          </div>
                        </button>
                        {expanded && (
                          <pre
                            className="selectable"
                            style={{
                              margin: 0,
                              padding: 12,
                              background: '#ffffff',
                              fontSize: 12,
                              whiteSpace: 'pre-wrap',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {doc.contentMarkdown}
                          </pre>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {memTab === 'observations' && (
              <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                {observations.length === 0 ? (
                  <div style={{color: '#64748b', fontSize: 12}}>
                    {tr(
                      lang,
                      '当前模式暂无沉淀的行为规范或观察条目。',
                      'No observations recorded yet.',
                    )}
                  </div>
                ) : (
                  [...observations]
                    .sort((a, b) => {
                      const rank = (o: MemoryObservationRecord): number =>
                        o.beliefStatus === 'contested' || o.staleSuspect
                          ? 0
                          : 1;
                      return rank(a) - rank(b);
                    })
                    .map(obs => {
                      const needsReconcile =
                        obs.beliefStatus === 'contested' || obs.staleSuspect;
                      return (
                        <div
                          key={obs.id}
                          style={{
                            padding: 12,
                            border: needsReconcile
                              ? '1px solid #eab308'
                              : '1px solid #e2e8f0',
                            borderRadius: 6,
                            background: needsReconcile ? '#fffbeb' : '#fafbfc',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: 6,
                              gap: 8,
                            }}
                          >
                            <div style={{fontWeight: 700}}>{obs.title}</div>
                            <div style={{display: 'flex', gap: 5}}>
                              <span className="tag tag-indigo">
                                {obs.authorityTier}
                              </span>
                              <span
                                className={`tag ${
                                  obs.beliefStatus === 'contested'
                                    ? 'tag-red'
                                    : 'tag-green'
                                }`}
                              >
                                {obs.beliefStatus}
                              </span>
                              {obs.staleSuspect && (
                                <span className="tag tag-amber">
                                  staleSuspect
                                </span>
                              )}
                            </div>
                          </div>
                          <div
                            className="selectable"
                            style={{
                              fontSize: 12.5,
                              color: '#334155',
                              marginBottom: 6,
                            }}
                          >
                            {obs.statement}
                          </div>
                          {obs.pathAnchors.length > 0 && (
                            <div
                              className="selectable"
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 11,
                                color: '#64748b',
                                marginBottom: needsReconcile ? 8 : 0,
                              }}
                            >
                              {obs.pathAnchors.join(' · ')}
                            </div>
                          )}

                          {needsReconcile && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                marginTop: 6,
                              }}
                            >
                              <input
                                value={statementEdits[obs.id] ?? ''}
                                onChange={e =>
                                  setStatementEdits(prev => ({
                                    ...prev,
                                    [obs.id]: e.target.value,
                                  }))
                                }
                                placeholder={tr(
                                  lang,
                                  '可选：填写更新后的规范正文（留空则按最新热修复语义确认）…',
                                  'Optional updated rule statement...',
                                )}
                              />
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 6,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={memBusy}
                                  onClick={() => {
                                    setMemBusy(true);
                                    void forgeApi
                                      .reconcileObservation(obs.id, {
                                        resolution: 'adopt_code',
                                        newStatement:
                                          statementEdits[obs.id]?.trim() ||
                                          undefined,
                                      })
                                      .then(() => loadHindsightData())
                                      .catch(err =>
                                        onError(
                                          err instanceof Error
                                            ? err.message
                                            : String(err),
                                        ),
                                      )
                                      .finally(() => setMemBusy(false));
                                  }}
                                >
                                  {tr(
                                    lang,
                                    '跟随最新代码更新规范',
                                    'Follow New Code (adopt_code)',
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={memBusy}
                                  onClick={() => {
                                    setMemBusy(true);
                                    void forgeApi
                                      .reconcileObservation(obs.id, {
                                        resolution: 'keep_rule',
                                      })
                                      .then(() => loadHindsightData())
                                      .catch(err =>
                                        onError(
                                          err instanceof Error
                                            ? err.message
                                            : String(err),
                                        ),
                                      )
                                      .finally(() => setMemBusy(false));
                                  }}
                                >
                                  {tr(lang, '保留原规范', 'Keep Rule')}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={memBusy}
                                  onClick={() => {
                                    setMemBusy(true);
                                    void forgeApi
                                      .reconcileObservation(obs.id, {
                                        resolution: 'retire',
                                      })
                                      .then(() => loadHindsightData())
                                      .catch(err =>
                                        onError(
                                          err instanceof Error
                                            ? err.message
                                            : String(err),
                                        ),
                                      )
                                      .finally(() => setMemBusy(false));
                                  }}
                                >
                                  {tr(lang, '归档退役', 'Retire')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                )}
              </div>
            )}
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
          <GlobeIcon size={20} />{' '}
          {tr(
            lang,
            '运行环境与多仓联邦中枢 (Environments & Hubs)',
            'Environments & Federation Hubs',
          )}
        </h1>
        <p className="page-subtitle">
          {tr(
            lang,
            '统一纳管多仓库联邦主控中枢（Federation Hub）、本机 Git Worktree 隔离沙箱目录与宿主工具链健康度。',
            'Manage Multi-Repo Federation Hubs, local Git worktree sandboxes, and host toolchain readiness.',
          )}
        </p>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18}}>
        <div className="surface-card">
          <div className="surface-card-header">
            <span>
              {tr(
                lang,
                `已注册联邦中枢 (${snapshot.hubs.length})`,
                `Registered Federation Hubs (${snapshot.hubs.length})`,
              )}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void forgeApi.runEnvironmentDoctor().then(d => setDoctor(d));
              }}
            >
              {tr(lang, '校验宿主机工具链', 'Verify Host Toolchain')}
            </button>
          </div>
          <div
            className="surface-card-body"
            style={{display: 'flex', flexDirection: 'column', gap: 12}}
          >
            {doctor && (
              <div
                className="selectable"
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
                  <span className="tag tag-indigo">
                    {formatPermissionTier(lang, h.permissionTier)}
                  </span>
                </div>
                <div style={{fontSize: 12, color: '#64748b', marginTop: 4}}>
                  {h.description}
                </div>
                <div
                  className="selectable"
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
            <span>
              {tr(lang, '创建新多仓联邦中枢', 'Create New Federation Hub')}
            </span>
          </div>
          <div
            className="surface-card-body"
            style={{display: 'flex', flexDirection: 'column', gap: 12}}
          >
            <div>
              <label className="field-label">
                {tr(lang, '联邦中枢名称', 'Federation Hub Name')}
              </label>
              <input
                placeholder={tr(
                  lang,
                  '例如：清结算与风控核心平台',
                  'e.g. Risk & Clearing Platform',
                )}
                value={hubName}
                onChange={e => setHubName(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">
                {tr(lang, '工作空间根目录路径', 'Workspace Root Directory')}
              </label>
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
                  {tr(lang, '浏览目录', 'Browse')}
                </button>
              </div>
            </div>
            <div>
              <label className="field-label">
                {tr(lang, '默认自治权限档位', 'Default Permission Tier')}
              </label>
              <select
                value={hubTier}
                onChange={e => setHubTier(e.target.value as PermissionTier)}
              >
                <option value="turbo">
                  {tr(lang, '极速自治档 (Turbo Auto)', 'Turbo Auto')}
                </option>
                <option value="supervised">
                  {tr(lang, '受控监督档 (Supervised)', 'Supervised')}
                </option>
                <option value="strict">
                  {tr(lang, '严格人工门禁档 (Strict)', 'Strict Human Gate')}
                </option>
              </select>
            </div>
            <div>
              <label className="field-label">
                {tr(lang, '北极星架构宪章', 'North-Star Charter')}
              </label>
              <textarea
                rows={3}
                placeholder={tr(
                  lang,
                  '描述该联邦中枢覆盖的业务边界、跨仓契约原则与核心架构目标...',
                  'Domain boundaries and architectural objectives...',
                )}
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
              <PlusIcon size={14} />{' '}
              {tr(lang, '创建联邦中枢', 'Create Federation Hub')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

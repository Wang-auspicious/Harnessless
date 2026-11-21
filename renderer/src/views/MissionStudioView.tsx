import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import type {
  BootstrapSnapshot,
  CodebaseProbeReport,
  ControlSchemaResponse,
  HamaDetailSnapshot,
  MissionDetailSnapshot,
  MissionEvidenceResponse,
  MissionTraceabilityResponse,
} from '../../../src/shared/api.ts';
import type {
  CommentDisposition,
  ControlAction,
  DecisionAction,
  ExecutionMode,
  IntentPresetId,
  MergeReadinessReport,
  MissionHealth,
  MissionRecord,
  MissionStage,
  TriageTrack,
} from '../../../src/shared/v3-types.ts';
import {forgeApi} from '../api/client.ts';
import {
  ActivityIcon,
  AlertTriangleIcon,
  BookOpenIcon,
  CheckCircleIcon,
  FileTextIcon,
  GitBranchIcon,
  HelpCircleIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
} from '../components/Icons.tsx';
import {tr, type UiLang} from '../i18n.ts';

type StudioTab = 'overview' | 'hama' | 'execution' | 'delivery';

function formatTrackLabel(lang: UiLang, track: TriageTrack): string {
  switch (track) {
    case 'express':
      return tr(lang, '快速直通', 'Express');
    case 'standard':
      return tr(lang, '标准核对', 'Standard');
    case 'full_hama':
      return tr(lang, '严格评审', 'Full HAMA');
  }
}

function formatPresetLabel(lang: UiLang, preset: IntentPresetId): string {
  switch (preset) {
    case 'autopilot':
      return tr(lang, '自动推进 (Autopilot)', 'Autopilot');
    case 'guided':
      return tr(lang, '关键把关 (Guided)', 'Guided');
    case 'strict_audit':
      return tr(lang, '严格评审 (Strict Audit)', 'Strict Audit');
  }
}

function formatBlastRadiusLabel(
  lang: UiLang,
  blast: CodebaseProbeReport['blastRadius'],
): string {
  switch (blast) {
    case 'low':
      return tr(lang, '低影响范围', 'Low Blast');
    case 'medium':
      return tr(lang, '中等影响范围', 'Medium Blast');
    case 'high':
      return tr(lang, '高影响范围', 'High Blast');
  }
}

function formatStageLabel(
  lang: UiLang,
  stage: MissionStage,
  fallback: string,
): string {
  if (lang === 'EN') {
    return fallback;
  }
  switch (stage) {
    case 'understand':
      return '1. 意图探路与分流';
    case 'converge_spec':
      return '2. 方案收敛与定稿';
    case 'plan_validate':
      return '3. 编排校验与排演';
    case 'build_verify':
      return '4. 分片编码与自证';
    case 'certify_deliver':
      return '5. 证据核验与交付';
  }
}

function formatControlLabel(
  lang: UiLang,
  action: ControlAction,
  fallback: string,
): string {
  if (lang === 'EN') {
    return fallback;
  }
  switch (action) {
    case 'start':
      return '启动 / 继续流水线';
    case 'pause':
      return '暂停执行';
    case 'resume':
      return '恢复执行';
    case 'abort':
      return '终止任务';
    default:
      return fallback;
  }
}

function renderHealthIcon(health: MissionHealth): ReactElement {
  switch (health) {
    case 'completed':
      return (
        <span style={{color: '#16a34a', display: 'inline-flex'}}>
          <CheckCircleIcon size={13} />
        </span>
      );
    case 'needs_you':
      return (
        <span style={{color: '#d97706', display: 'inline-flex'}}>
          <AlertTriangleIcon size={13} />
        </span>
      );
    case 'failed':
    case 'aborted':
      return (
        <span style={{color: '#dc2626', display: 'inline-flex'}}>
          <AlertTriangleIcon size={13} />
        </span>
      );
    case 'flowing':
    case 'recovering':
      return (
        <span style={{color: '#4f46e5', display: 'inline-flex'}}>
          <ActivityIcon size={13} />
        </span>
      );
  }
}

function ProbeReportPanel({
  lang,
  probe,
}: {
  readonly lang: UiLang;
  readonly probe: CodebaseProbeReport;
}): ReactElement {
  const rationale =
    lang === 'ZH' ? probe.plainRationaleZh : probe.plainRationaleEn;

  return (
    <div className="surface-card" style={{marginBottom: 14}}>
      <div className="surface-card-header">
        <span>
          <SearchIcon size={13} />{' '}
          {tr(
            lang,
            '代码现状探测与现实约束分析',
            'Codebase Reality Probe & Blast-Radius Triage',
          )}
        </span>
        <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
          <span
            className={`tag ${
              probe.blastRadius === 'high'
                ? 'tag-red'
                : probe.blastRadius === 'medium'
                  ? 'tag-amber'
                  : 'tag-green'
            }`}
          >
            {formatBlastRadiusLabel(lang, probe.blastRadius)}
          </span>
          <span className="tag tag-indigo">
            {tr(lang, '建议分流：', 'Recommended: ')}
            {formatTrackLabel(lang, probe.recommendedTrack)}
          </span>
          <span className="tag">
            ${probe.estimatedCostRangeUsd[0].toFixed(2)} – $
            {probe.estimatedCostRangeUsd[1].toFixed(2)}
          </span>
        </div>
      </div>
      <div className="surface-card-body">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{color: '#1e293b', fontWeight: 600, lineHeight: 1.6}}>
            {rationale}
          </div>
          <span className="tag" style={{flexShrink: 0}}>
            {probe.repoCount} {tr(lang, '仓', 'repos')} ·{' '}
            {probe.scannedFilesCount} {tr(lang, '文件扫描', 'scanned')}
          </span>
        </div>

        {probe.realityNotes.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginBottom: 12,
            }}
          >
            {probe.realityNotes.map((note, idx) => (
              <div
                key={idx}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border:
                    note.level === 'challenge'
                      ? '1px solid #f87171'
                      : note.level === 'warning'
                        ? '1px solid #eab308'
                        : '1px solid #c7d2fe',
                  background:
                    note.level === 'challenge'
                      ? '#fee2e2'
                      : note.level === 'warning'
                        ? '#fef3c7'
                        : '#eef2ff',
                }}
              >
                <div style={{fontWeight: 700, fontSize: 12.5, marginBottom: 2}}>
                  {lang === 'ZH' ? note.titleZh : note.titleEn}
                </div>
                <div style={{fontSize: 12, color: '#334155', lineHeight: 1.55}}>
                  {lang === 'ZH' ? note.detailZh : note.detailEn}
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
          }}
        >
          <div>
            <div className="field-label">
              {tr(
                lang,
                `命中关键源码与调用扇入 (${probe.matchedFiles.length})`,
                `Matched Files & Importer Fan-In (${probe.matchedFiles.length})`,
              )}
            </div>
            {probe.matchedFiles.length === 0 ? (
              <div style={{fontSize: 12, color: '#64748b'}}>
                {tr(lang, '未命中关键词文件', 'No direct file matches')}
              </div>
            ) : (
              <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                {probe.matchedFiles.slice(0, 6).map(hit => (
                  <div
                    key={`${hit.repoId}:${hit.filePath}`}
                    style={{
                      padding: '6px 9px',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      background: '#f8fafc',
                      fontSize: 12,
                    }}
                  >
                    <div
                      className="selectable"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        wordBreak: 'break-all',
                      }}
                    >
                      [{hit.repoName}] {hit.filePath}
                    </div>
                    <div style={{color: '#64748b', fontSize: 11, marginTop: 2}}>
                      {tr(lang, '扇入引用', 'importers')}:{' '}
                      {hit.importers.length} · {tr(lang, '导出符号', 'exports')}
                      : {hit.exports.length} · {hit.lineCount}L
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
            <div>
              <div className="field-label">
                {tr(lang, '自动识别的验证命令', 'Detected Verify Commands')}
              </div>
              {probe.detectedVerifyCommands.length === 0 ? (
                <div style={{fontSize: 12, color: '#64748b'}}>
                  {tr(lang, '未检测到自动测试脚本', 'None detected')}
                </div>
              ) : (
                <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                  {probe.detectedVerifyCommands.map(cmd => (
                    <div
                      key={cmd.repoId}
                      className="selectable"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11.5,
                        padding: '4px 8px',
                        border: '1px solid #e2e8f0',
                        borderRadius: 5,
                        background: '#ffffff',
                      }}
                    >
                      {cmd.repoName}: {cmd.command}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {probe.recentHotspots.length > 0 && (
              <div>
                <div className="field-label">
                  {tr(lang, '近期高频变更热点', 'Recent Git Hotspots')}
                </div>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 5}}>
                  {probe.recentHotspots.slice(0, 5).map(hs => (
                    <span
                      key={`${hs.repoId}:${hs.filePath}`}
                      className="tag selectable"
                      style={{fontFamily: 'var(--font-mono)'}}
                      title={hs.lastSubject}
                    >
                      {hs.filePath} ({hs.commitCount})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {probe.recentReverts.length > 0 && (
              <div>
                <div className="field-label" style={{color: '#dc2626'}}>
                  {tr(lang, '近期回退/Revert 记录', 'Recent Git Reverts')}
                </div>
                {probe.recentReverts.slice(0, 3).map(rv => (
                  <div
                    key={rv.sha}
                    style={{fontSize: 11.5, color: '#991b1b', marginBottom: 3}}
                  >
                    {rv.sha.slice(0, 7)} · {rv.subject}
                  </div>
                ))}
              </div>
            )}

            {probe.recalledMemories.length > 0 && (
              <div>
                <div className="field-label">
                  {tr(lang, '命中长期记忆约束', 'Recalled Memory Constraints')}
                </div>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 5}}>
                  {probe.recalledMemories.slice(0, 4).map(mem => (
                    <span
                      key={mem.id}
                      className={`tag ${
                        mem.rejectedWarning ? 'tag-red' : 'tag-indigo'
                      }`}
                    >
                      [{mem.authorityTier}] {mem.title}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MissionStudioView(props: {
  readonly lang: UiLang;
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly refreshTick: number;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onRefresh: () => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {
    lang,
    snapshot,
    activeHubId,
    refreshTick,
    onOpenWorkstation,
    onRefresh,
    onError,
  } = props;

  const hubRepos = useMemo(
    () => snapshot.repositories.filter(r => r.hubId === activeHubId),
    [snapshot.repositories, activeHubId],
  );

  const [missions, setMissions] = useState<readonly MissionRecord[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(
    null,
  );
  const [detail, setDetail] = useState<MissionDetailSnapshot | null>(null);
  const [hamaDetail, setHamaDetail] = useState<HamaDetailSnapshot | null>(null);
  const [traceability, setTraceability] =
    useState<MissionTraceabilityResponse | null>(null);
  const [readiness, setReadiness] = useState<MergeReadinessReport | null>(null);
  const [evidenceRes, setEvidenceRes] =
    useState<MissionEvidenceResponse | null>(null);
  const [controlSchema, setControlSchema] =
    useState<ControlSchemaResponse | null>(null);
  const [showSchemaDrawer, setShowSchemaDrawer] = useState(false);

  const [activeTab, setActiveTab] = useState<StudioTab>('overview');
  const [showComposer, setShowComposer] = useState(false);
  const [busy, setBusy] = useState(false);

  // --- Composer Workbench State ---
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  const [preset, setPreset] = useState<IntentPresetId>('guided');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('live');
  const [titleInput, setTitleInput] = useState('');
  const [rawIntent, setRawIntent] = useState('');
  const [draftProbe, setDraftProbe] = useState<CodebaseProbeReport | null>(
    null,
  );

  // --- Decision & Comment State ---
  const [decisionFeedback, setDecisionFeedback] = useState('');
  const [commentScopeKey, setCommentScopeKey] = useState('proposal.overview');
  const [commentSeverity, setCommentSeverity] = useState<
    'blocking' | 'advisory'
  >('advisory');
  const [commentBody, setCommentBody] = useState('');

  useEffect(() => {
    setSelectedRepoIds(hubRepos.map(r => r.id));
  }, [activeHubId, hubRepos]);

  const loadMissions = useCallback(async () => {
    if (!activeHubId) return;
    try {
      const list = await forgeApi.listMissions(activeHubId);
      setMissions(list);
      setSelectedMissionId(prev => {
        if (prev && list.some(m => m.id === prev)) {
          return prev;
        }
        return list[0]?.id ?? null;
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [activeHubId, onError]);

  useEffect(() => {
    void loadMissions();
  }, [loadMissions, refreshTick]);

  const loadSelectedMissionDetail = useCallback(
    async (missionId: string) => {
      try {
        const snap = await forgeApi.getMissionDetail(missionId);
        setDetail(snap);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    },
    [onError],
  );

  useEffect(() => {
    if (!selectedMissionId) {
      setDetail(null);
      setHamaDetail(null);
      setTraceability(null);
      setReadiness(null);
      setEvidenceRes(null);
      return;
    }
    void loadSelectedMissionDetail(selectedMissionId);
  }, [selectedMissionId, refreshTick, loadSelectedMissionDetail]);

  useEffect(() => {
    if (!selectedMissionId) return;
    if (activeTab === 'hama') {
      void forgeApi
        .getMissionHama(selectedMissionId)
        .then(setHamaDetail)
        .catch(err =>
          onError(err instanceof Error ? err.message : String(err)),
        );
    } else if (activeTab === 'delivery') {
      void Promise.all([
        forgeApi.getMissionTraceability(selectedMissionId),
        forgeApi.getMissionReadiness(selectedMissionId),
        forgeApi.getMissionEvidence(selectedMissionId),
      ])
        .then(([trRes, rdRes, evRes]) => {
          setTraceability(trRes);
          setReadiness(rdRes);
          setEvidenceRes(evRes);
        })
        .catch(err =>
          onError(err instanceof Error ? err.message : String(err)),
        );
    }
  }, [selectedMissionId, activeTab, refreshTick, onError]);

  const handleToggleSchema = async (): Promise<void> => {
    if (!controlSchema) {
      try {
        const s = await forgeApi.getControlSchema();
        setControlSchema(s);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setShowSchemaDrawer(prev => !prev);
  };

  const handleProbeIntent = async (): Promise<void> => {
    if (!rawIntent.trim() || !activeHubId) return;
    setBusy(true);
    try {
      const report = await forgeApi.probeMission({
        hubId: activeHubId,
        repoIds: selectedRepoIds,
        rawIntent: rawIntent.trim(),
        executionMode,
      });
      setDraftProbe(report);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateMission = async (): Promise<void> => {
    if (!rawIntent.trim() || !activeHubId) return;
    setBusy(true);
    try {
      const res = await forgeApi.createMission({
        hubId: activeHubId,
        repoIds: selectedRepoIds,
        title: titleInput.trim() || undefined,
        rawIntent: rawIntent.trim(),
        preset,
        executionMode,
      });
      setTitleInput('');
      setRawIntent('');
      setDraftProbe(null);
      setShowComposer(false);
      await loadMissions();
      setSelectedMissionId(res.mission.id);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshMissionProbe = async (): Promise<void> => {
    if (!detail) return;
    setBusy(true);
    try {
      const nextProbe = await forgeApi.getMissionProbe(detail.mission.id);
      setDetail(prev => (prev ? {...prev, probe: nextProbe} : prev));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResolveDecision = async (
    action: DecisionAction,
  ): Promise<void> => {
    if (!detail?.focus.primaryAction) return;
    const gate = detail.focus.primaryAction;
    setBusy(true);
    try {
      await forgeApi.resolveMissionDecision(detail.mission.id, {
        gateId: gate.id,
        targetId: gate.targetId,
        targetHash: gate.targetHash,
        idempotencyKey: `ui-${gate.id}-${Date.now()}`,
        actor: 'human_operator',
        action,
        feedback: decisionFeedback.trim() || action,
        scope: 'proposal',
        issueIds: [],
      });
      setDecisionFeedback('');
      await loadSelectedMissionDetail(detail.mission.id);
      await loadMissions();
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExecuteControl = async (
    action: MissionDetailSnapshot['focus']['availableControls'][number]['action'],
  ): Promise<void> => {
    if (!detail) return;
    setBusy(true);
    try {
      await forgeApi.executeMissionControl(detail.mission.id, {
        action,
        expectedVersion: detail.mission.version,
        actor: 'human_operator',
      });
      await loadSelectedMissionDetail(detail.mission.id);
      await loadMissions();
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddComment = async (): Promise<void> => {
    if (!detail || !commentBody.trim()) return;
    setBusy(true);
    try {
      await forgeApi.addHamaComment(detail.mission.id, {
        scopeKey: commentScopeKey.trim() || 'proposal.overview',
        authorKind: 'human',
        authorLabel: 'human_operator',
        severity: commentSeverity,
        body: commentBody.trim(),
      });
      setCommentBody('');
      const updated = await forgeApi.getMissionHama(detail.mission.id);
      setHamaDetail(updated);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDisposeComment = async (
    commentId: string,
    disposition: CommentDisposition,
  ): Promise<void> => {
    if (!detail) return;
    setBusy(true);
    try {
      await forgeApi.resolveHamaComment(detail.mission.id, commentId, {
        disposition,
        resolutionNote: `Resolved as ${disposition} via Mission Studio`,
        resolvedBy: 'human_operator',
        actorKind: 'human',
      });
      const updated = await forgeApi.getMissionHama(detail.mission.id);
      setHamaDetail(updated);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const composerOpen = showComposer || missions.length === 0;

  return (
    <div className="workstation-root">
      {/* Top Mission Studio Control Strip */}
      <div className="workstation-strip">
        <div className="workstation-strip-left">
          <span className="workstation-brand">
            <span style={{color: '#4f46e5', display: 'flex'}}>
              <GitBranchIcon size={15} />
            </span>
            {tr(lang, 'SDLC 任务工作台', 'Mission Studio')}
          </span>
          {detail && (
            <>
              <span className="tag tag-indigo">
                {detail.mission.code} ·{' '}
                {formatPresetLabel(lang, detail.mission.preset)}
              </span>
              <span className="tag">
                {formatTrackLabel(lang, detail.mission.triageTrack)}
              </span>
              <span
                className={`tag ${
                  detail.mission.executionMode === 'live'
                    ? 'tag-green'
                    : 'tag-amber'
                }`}
              >
                {detail.mission.executionMode === 'live'
                  ? tr(lang, '在线真实跑', 'Live')
                  : tr(lang, '离线演练', 'Simulation')}
              </span>
              <span className="tag">
                ${detail.mission.spentUsd.toFixed(2)} / $
                {detail.mission.budgetUsdLimit.toFixed(2)}
              </span>
            </>
          )}
        </div>

        <div className="workstation-strip-right">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void handleToggleSchema()}
          >
            <HelpCircleIcon size={13} />{' '}
            {tr(lang, '参数说明', 'Parameter Guide')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowComposer(prev => !prev)}
          >
            <PlusIcon size={13} /> {tr(lang, '新建任务', 'New Mission')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              void loadMissions();
              if (selectedMissionId) {
                void loadSelectedMissionDetail(selectedMissionId);
              }
              onRefresh();
            }}
          >
            <RefreshIcon size={13} /> {tr(lang, '刷新', 'Refresh')}
          </button>
        </div>
      </div>

      {/* 2-Column Body */}
      <div className="workstation-body">
        {/* Left Sidebar: Mission Cards */}
        <aside className="wbs-sidebar">
          <div className="wbs-progress-box">
            <div className="wbs-progress-header">
              <span>{tr(lang, '任务队列', 'Missions')}</span>
              <span className="wbs-progress-pct">{missions.length}</span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{width: '100%', justifyContent: 'center'}}
              onClick={() => setShowComposer(true)}
            >
              <PlusIcon size={13} />{' '}
              {tr(lang, '新建任务（先探代码）', 'New Mission')}
            </button>
          </div>

          <div className="wbs-phase-list">
            <div className="wbs-task-stack">
              {missions.map(m => {
                const isSelected = !composerOpen && selectedMissionId === m.id;
                const health: MissionHealth =
                  m.status === 'delivered'
                    ? 'completed'
                    : m.status === 'paused_human'
                      ? 'needs_you'
                      : m.status === 'failed' || m.status === 'aborted'
                        ? m.status
                        : 'flowing';
                return (
                  <div
                    key={m.id}
                    className={`wbs-task-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setShowComposer(false);
                      setSelectedMissionId(m.id);
                    }}
                  >
                    {renderHealthIcon(health)}
                    <div style={{minWidth: 0, flex: 1}}>
                      <div className="wbs-task-title">{m.title}</div>
                      <div
                        className="wbs-task-code"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 4,
                        }}
                      >
                        <span>{m.code}</span>
                        <span className="tag" style={{fontSize: 10}}>
                          {formatTrackLabel(lang, m.triageTrack)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {missions.length === 0 && (
                <div style={{padding: 12, fontSize: 12, color: '#64748b'}}>
                  {tr(
                    lang,
                    '当前中枢暂无任务，请在右侧填写需求并先探代码。',
                    'No missions yet. Start with the grounded workbench.',
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Right Main Panel */}
        <section className="workstation-main" style={{overflowY: 'auto'}}>
          <div style={{padding: '18px 22px'}}>
            {showSchemaDrawer && controlSchema && (
              <div className="surface-card" style={{marginBottom: 16}}>
                <div className="surface-card-header">
                  <span>
                    <BookOpenIcon size={13} />{' '}
                    {tr(
                      lang,
                      '人话参数说明书 (Schema Control Registry)',
                      'Plain-Language Parameter Explainer',
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setShowSchemaDrawer(false)}
                  >
                    ✕
                  </button>
                </div>
                <div
                  className="surface-card-body"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 10,
                  }}
                >
                  {controlSchema.controls.map(ctrl => (
                    <div
                      key={ctrl.key}
                      style={{
                        padding: 10,
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        background: '#f8fafc',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                        }}
                      >
                        <strong>{ctrl.label}</strong>
                        <span className="tag">{ctrl.key}</span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#334155',
                          lineHeight: 1.55,
                          marginBottom: 4,
                        }}
                      >
                        {ctrl.plainExplanation}
                      </div>
                      <div style={{fontSize: 11.5, color: '#64748b'}}>
                        {ctrl.runtimeEffect}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {composerOpen ? (
              <div>
                <div className="surface-card" style={{marginBottom: 16}}>
                  <div className="surface-card-header">
                    <span>
                      {tr(
                        lang,
                        '代码实探与方案立项工作台（先探代码，再定方案）',
                        'Code-Grounded Idea to Proposal Workbench',
                      )}
                    </span>
                    {missions.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setShowComposer(false)}
                      >
                        {tr(lang, '返回任务详情', 'Back to Mission')}
                      </button>
                    )}
                  </div>
                  <div
                    className="surface-card-body"
                    style={{display: 'flex', flexDirection: 'column', gap: 12}}
                  >
                    <div>
                      <div className="field-label">
                        {tr(lang, '目标联动仓库', 'Target Repositories')}
                      </div>
                      <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                        {hubRepos.map(r => {
                          const checked = selectedRepoIds.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              className={`btn btn-sm ${
                                checked ? 'btn-soft' : ''
                              }`}
                              onClick={() =>
                                setSelectedRepoIds(prev =>
                                  checked
                                    ? prev.filter(x => x !== r.id)
                                    : [...prev, r.id],
                                )
                              }
                            >
                              {checked ? '✓' : '+'} {r.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: 12,
                      }}
                    >
                      <div>
                        <label className="field-label">
                          {tr(lang, '自治把关档位', 'Autonomy Preset')}
                        </label>
                        <select
                          value={preset}
                          onChange={e =>
                            setPreset(e.target.value as IntentPresetId)
                          }
                        >
                          <option value="guided">
                            {tr(lang, '关键把关 (Guided)', 'Guided')}
                          </option>
                          <option value="autopilot">
                            {tr(lang, '自动推进 (Autopilot)', 'Autopilot')}
                          </option>
                          <option value="strict_audit">
                            {tr(
                              lang,
                              '严格评审 (Strict Audit)',
                              'Strict Audit',
                            )}
                          </option>
                        </select>
                      </div>
                      <div>
                        <label className="field-label">
                          {tr(lang, '执行模式', 'Execution Mode')}
                        </label>
                        <select
                          value={executionMode}
                          onChange={e =>
                            setExecutionMode(e.target.value as ExecutionMode)
                          }
                        >
                          <option value="live">
                            {tr(lang, '在线真实跑 (Live)', 'Live Execution')}
                          </option>
                          <option value="simulation">
                            {tr(
                              lang,
                              '离线演练 (Simulation)',
                              'Offline Simulation',
                            )}
                          </option>
                        </select>
                      </div>
                      <div>
                        <label className="field-label">
                          {tr(lang, '任务标题（可选）', 'Title (Optional)')}
                        </label>
                        <input
                          value={titleInput}
                          onChange={e => setTitleInput(e.target.value)}
                          placeholder={tr(
                            lang,
                            '留空则自动提炼标题…',
                            'Leave blank to auto-derive...',
                          )}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="field-label">
                        {tr(
                          lang,
                          '研发需求与约束意图 (Raw Intent)',
                          'Engineering Intent & Boundaries',
                        )}
                      </label>
                      <textarea
                        rows={4}
                        value={rawIntent}
                        onChange={e => setRawIntent(e.target.value)}
                        placeholder={tr(
                          lang,
                          '描述想改什么功能、涉及哪些接口或表结构，先点击「先探代码」让系统核实真实源码与回归风险…',
                          'Describe your feature or fix, then click Probe Codebase before locking a proposal...',
                        )}
                      />
                    </div>

                    <div style={{display: 'flex', gap: 10}}>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !rawIntent.trim()}
                        onClick={() => void handleProbeIntent()}
                      >
                        <SearchIcon size={13} />{' '}
                        {tr(
                          lang,
                          '先探代码 (Probe Codebase)',
                          'Probe Codebase',
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy || !rawIntent.trim()}
                        onClick={() => void handleCreateMission()}
                      >
                        <PlayIcon size={13} />{' '}
                        {tr(lang, '创建任务并启动', 'Create Mission & Start')}
                      </button>
                    </div>
                  </div>
                </div>

                {draftProbe && (
                  <ProbeReportPanel lang={lang} probe={draftProbe} />
                )}
              </div>
            ) : detail ? (
              <div>
                {/* 5-Stage Mission Progress Bar */}
                <div className="stage-stepper">
                  {detail.focus.stageSteps.map(step => (
                    <div
                      key={step.stage}
                      className={`stage-step ${step.status}`}
                    >
                      <span>
                        {formatStageLabel(lang, step.stage, step.label)}
                      </span>
                      <span style={{fontSize: 11}}>
                        {step.status === 'completed'
                          ? '✓'
                          : step.status === 'blocked'
                            ? '!'
                            : step.status === 'active'
                              ? '●'
                              : '○'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Single-Decision Focus Gate Card */}
                {detail.focus.primaryAction && (
                  <div
                    className="surface-card"
                    style={{
                      marginBottom: 14,
                      borderColor: '#6366f1',
                    }}
                  >
                    <div className="surface-card-header">
                      <span>
                        <span
                          style={{color: '#d97706', display: 'inline-flex'}}
                        >
                          <AlertTriangleIcon size={14} />
                        </span>{' '}
                        {tr(lang, '当前待你拍板：', 'Decision Required: ')}
                        {detail.focus.primaryAction.question}
                      </span>
                      <span className="tag tag-amber">
                        {detail.focus.primaryAction.kind}
                      </span>
                    </div>
                    <div className="surface-card-body">
                      <p
                        className="selectable"
                        style={{
                          margin: '0 0 10px',
                          color: '#334155',
                          lineHeight: 1.6,
                        }}
                      >
                        {detail.focus.primaryAction.contextSnippet}
                      </p>
                      <div style={{marginBottom: 10}}>
                        <input
                          value={decisionFeedback}
                          onChange={e => setDecisionFeedback(e.target.value)}
                          placeholder={tr(
                            lang,
                            '附带批注或指示（可选，如打回或补充澄清要求则填写理由）…',
                            'Optional decision note or clarification feedback...',
                          )}
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        {detail.focus.primaryAction.options.map(opt => (
                          <button
                            key={opt.action}
                            type="button"
                            disabled={busy}
                            className={`btn btn-sm ${
                              opt.recommended ? 'btn-primary' : ''
                            }`}
                            title={opt.consequencePreview}
                            onClick={() =>
                              void handleResolveDecision(opt.action)
                            }
                          >
                            {opt.recommended ? `★ ${opt.label}` : opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 4 Sub-tabs */}
                <div
                  className="workstation-tabs-bar"
                  style={{marginBottom: 14, borderRadius: 6}}
                >
                  <div
                    className="underline-tabs"
                    style={{borderBottom: 'none'}}
                  >
                    {(
                      [
                        [
                          'overview',
                          tr(lang, '代码依据与总览', 'Codebase & Overview'),
                        ],
                        [
                          'hama',
                          tr(lang, '方案与评审批注', 'Proposal & Review'),
                        ],
                        [
                          'execution',
                          tr(lang, '关联变更与执行', 'Changes & Execution'),
                        ],
                        [
                          'delivery',
                          tr(lang, '追溯与交付', 'Traceability & Delivery'),
                        ],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`underline-tab ${
                          activeTab === key ? 'active' : ''
                        }`}
                        onClick={() => setActiveTab(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {activeTab === 'overview' && (
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 12,
                      }}
                    >
                      <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                        {detail.focus.availableControls
                          .filter(c =>
                            ['start', 'pause', 'resume', 'abort'].includes(
                              c.action,
                            ),
                          )
                          .map(ctrl => (
                            <button
                              key={ctrl.action}
                              type="button"
                              className="btn btn-sm"
                              disabled={busy || !ctrl.enabled}
                              title={ctrl.disabledReason ?? ctrl.impactSummary}
                              onClick={() =>
                                void handleExecuteControl(ctrl.action)
                              }
                            >
                              {formatControlLabel(
                                lang,
                                ctrl.action,
                                ctrl.label,
                              )}
                            </button>
                          ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => void handleRefreshMissionProbe()}
                      >
                        <RefreshIcon size={12} />{' '}
                        {tr(lang, '刷新代码探测', 'Refresh Codebase Probe')}
                      </button>
                    </div>

                    {detail.probe && (
                      <ProbeReportPanel lang={lang} probe={detail.probe} />
                    )}

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 14,
                      }}
                    >
                      <div className="surface-card">
                        <div className="surface-card-header">
                          <span>
                            {tr(lang, '运行解释 (Why Here)', 'Explainability')}
                          </span>
                        </div>
                        <div className="surface-card-body">
                          <div style={{fontWeight: 600, marginBottom: 8}}>
                            {detail.focus.explainability.whyHere}
                          </div>
                          {detail.focus.explainability.waitingReason && (
                            <div style={{fontSize: 12, color: '#64748b'}}>
                              {detail.focus.explainability.waitingReason}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="surface-card">
                        <div className="surface-card-header">
                          <span>
                            {tr(
                              lang,
                              '关联 DDD 术语与记忆条款',
                              'DDD Terms & Recalled Memories',
                            )}
                          </span>
                        </div>
                        <div className="surface-card-body">
                          <div
                            style={{
                              display: 'flex',
                              gap: 6,
                              flexWrap: 'wrap',
                              marginBottom: 8,
                            }}
                          >
                            {detail.focus.explainability.activeDddTerms.map(
                              t => (
                                <span
                                  key={t.canonicalTerm}
                                  className="tag tag-indigo"
                                >
                                  {t.canonicalTerm} ({t.boundedContext})
                                </span>
                              ),
                            )}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              gap: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            {detail.focus.explainability.recalledMemories.map(
                              m => (
                                <span key={m.id} className="tag">
                                  [{m.authorityTier}] {m.title}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'hama' && (
                  <div
                    style={{display: 'flex', flexDirection: 'column', gap: 14}}
                  >
                    <div className="surface-card">
                      <div className="surface-card-header">
                        <span>
                          <FileTextIcon size={13} />{' '}
                          {tr(
                            lang,
                            '方案与 PRD 规格正文',
                            'Proposal & PRD Spec',
                          )}
                        </span>
                        <span className="tag">
                          {hamaDetail?.stage ?? detail.mission.status}
                        </span>
                      </div>
                      <div className="surface-card-body">
                        <pre
                          className="selectable"
                          style={{
                            margin: 0,
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            maxHeight: 300,
                            overflow: 'auto',
                            background: '#f8fafc',
                            padding: 12,
                            borderRadius: 6,
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          {hamaDetail?.prdMarkdown ??
                            tr(
                              lang,
                              '尚未生成正式 PRD 正文（当前处于需求探索/分流阶段）。',
                              'PRD Markdown not yet generated at current stage.',
                            )}
                        </pre>
                      </div>
                    </div>

                    <div className="surface-card">
                      <div className="surface-card-header">
                        <span>
                          {tr(
                            lang,
                            `评审批注 (${hamaDetail?.comments.length ?? 0})`,
                            `Review Comments (${hamaDetail?.comments.length ?? 0})`,
                          )}
                        </span>
                      </div>
                      <div className="surface-card-body">
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 140px auto',
                            gap: 8,
                            marginBottom: 12,
                          }}
                        >
                          <input
                            value={commentBody}
                            onChange={e => setCommentBody(e.target.value)}
                            placeholder={tr(
                              lang,
                              '输入评审意见或阻塞点…',
                              'Add a review comment or blocking feedback...',
                            )}
                          />
                          <select
                            value={commentSeverity}
                            onChange={e =>
                              setCommentSeverity(
                                e.target.value as 'blocking' | 'advisory',
                              )
                            }
                          >
                            <option value="advisory">
                              {tr(lang, '建议 (Advisory)', 'Advisory')}
                            </option>
                            <option value="blocking">
                              {tr(lang, '阻塞 (Blocking)', 'Blocking')}
                            </option>
                          </select>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy || !commentBody.trim()}
                            onClick={() => void handleAddComment()}
                          >
                            {tr(lang, '提交批注', 'Add Comment')}
                          </button>
                        </div>

                        <div style={{marginBottom: 10}}>
                          <input
                            value={commentScopeKey}
                            onChange={e => setCommentScopeKey(e.target.value)}
                            placeholder="scopeKey (e.g. proposal.overview)"
                          />
                        </div>

                        {(hamaDetail?.comments ?? []).map(c => (
                          <div
                            key={c.id}
                            style={{
                              padding: 10,
                              border: '1px solid #e2e8f0',
                              borderRadius: 6,
                              marginBottom: 8,
                              background: '#fafbfc',
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
                                <span
                                  className={`tag ${
                                    c.severity === 'blocking'
                                      ? 'tag-red'
                                      : 'tag-indigo'
                                  }`}
                                >
                                  {c.severity}
                                </span>
                                <span className="tag">{c.scopeKey}</span>
                                <span className="tag">{c.disposition}</span>
                              </div>
                              <span style={{fontSize: 11, color: '#64748b'}}>
                                {c.authorLabel}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: 12.5,
                                color: '#1e293b',
                                marginBottom: 6,
                              }}
                            >
                              {c.body}
                            </div>
                            {c.disposition === 'open' && (
                              <div style={{display: 'flex', gap: 6}}>
                                {(
                                  [
                                    'accepted',
                                    'changed',
                                    'rejected',
                                    'deferred',
                                  ] as const
                                ).map(disp => (
                                  <button
                                    key={disp}
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={busy}
                                    onClick={() =>
                                      void handleDisposeComment(c.id, disp)
                                    }
                                  >
                                    {disp}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'execution' && (
                  <div
                    style={{display: 'flex', flexDirection: 'column', gap: 14}}
                  >
                    <div className="surface-card">
                      <div className="surface-card-header">
                        <span>
                          {tr(
                            lang,
                            `关联代码变更单 (${detail.changes.length})`,
                            `Linked Changes (${detail.changes.length})`,
                          )}
                        </span>
                      </div>
                      <div className="surface-card-body">
                        {detail.changes.length === 0 ? (
                          <div style={{color: '#64748b'}}>
                            {tr(
                              lang,
                              '需求定稿后将自动生成各受影响仓库的双生图变更单。',
                              'Twin-Graph changes are generated after specification approval.',
                            )}
                          </div>
                        ) : (
                          detail.changes.map(c => (
                            <div
                              key={c.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '9px 12px',
                                border: '1px solid #e2e8f0',
                                borderRadius: 6,
                                marginBottom: 8,
                              }}
                            >
                              <div>
                                <div style={{fontWeight: 700}}>
                                  {c.code} · {c.title}
                                </div>
                                <div style={{fontSize: 12, color: '#64748b'}}>
                                  {c.gitBranch} · {c.status}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => onOpenWorkstation(c.id)}
                              >
                                {tr(
                                  lang,
                                  '进入双生图工作台',
                                  'Open Workstation',
                                )}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {detail.validation && (
                      <div className="surface-card">
                        <div className="surface-card-header">
                          <span>
                            {tr(lang, '前置合法性检查', 'Plan Validation')}
                          </span>
                          <span
                            className={`tag ${
                              detail.validation.valid ? 'tag-green' : 'tag-red'
                            }`}
                          >
                            {detail.validation.valid ? 'VALID' : 'ISSUES'} (
                            {detail.validation.errorCount}E /{' '}
                            {detail.validation.warningCount}W)
                          </span>
                        </div>
                        <div className="surface-card-body">
                          {detail.validation.issues.length === 0 ? (
                            <div style={{color: '#16a34a'}}>
                              ✓{' '}
                              {tr(
                                lang,
                                '未发现冲突问题。',
                                'No validation issues.',
                              )}
                            </div>
                          ) : (
                            detail.validation.issues.map(iss => (
                              <div
                                key={iss.id}
                                style={{fontSize: 12, marginBottom: 6}}
                              >
                                <span
                                  className={`tag ${
                                    iss.level === 'error'
                                      ? 'tag-red'
                                      : 'tag-amber'
                                  }`}
                                >
                                  {iss.level}
                                </span>{' '}
                                {iss.message} — {iss.suggestion}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}

                    {detail.trial && (
                      <div className="surface-card">
                        <div className="surface-card-header">
                          <span>
                            {tr(
                              lang,
                              '并发波次与读写依赖排演',
                              'Trial Waves & Read/Write Serialization',
                            )}
                          </span>
                          <span className="tag">
                            {detail.trial.estimatedWaves.length} waves ·{' '}
                            {detail.trial.contendedNodePairs.length} contended
                          </span>
                        </div>
                        <div className="surface-card-body">
                          {detail.trial.estimatedWaves.map(w => (
                            <div
                              key={w.waveIndex}
                              style={{fontSize: 12, marginBottom: 4}}
                            >
                              <strong>Wave {w.waveIndex}:</strong>{' '}
                              {w.nodeCodes.join(', ')}
                            </div>
                          ))}
                          {detail.trial.contendedNodePairs.map((pair, idx) => (
                            <div
                              key={idx}
                              style={{
                                fontSize: 11.5,
                                color: '#b45309',
                                marginTop: 4,
                              }}
                            >
                              {pair.nodeA} ↔ {pair.nodeB}: {pair.reason}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'delivery' && (
                  <div
                    style={{display: 'flex', flexDirection: 'column', gap: 14}}
                  >
                    <div className="surface-card">
                      <div className="surface-card-header">
                        <span>
                          <ShieldIcon size={13} />{' '}
                          {tr(
                            lang,
                            '证据包签名核验',
                            'Evidence Bundle & Hash Chain',
                          )}
                        </span>
                        {evidenceRes && (
                          <span
                            className={`tag ${
                              evidenceRes.verification.valid
                                ? 'tag-green'
                                : 'tag-red'
                            }`}
                          >
                            {evidenceRes.verification.valid
                              ? `SHA-256 Verified (${evidenceRes.verification.checkedEvents})`
                              : 'Verification Failed'}
                          </span>
                        )}
                      </div>
                      <div className="surface-card-body">
                        {evidenceRes ? (
                          <div
                            className="selectable"
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 11.5,
                            }}
                          >
                            Bundle SHA-256: {evidenceRes.bundle.bundleSha256}
                          </div>
                        ) : (
                          <div style={{color: '#64748b'}}>Loading...</div>
                        )}
                      </div>
                    </div>

                    {readiness && (
                      <div className="surface-card">
                        <div className="surface-card-header">
                          <span>
                            {tr(lang, '多仓合入就绪度', 'Merge Readiness')}
                          </span>
                          <span
                            className={`tag ${
                              readiness.ready ? 'tag-green' : 'tag-amber'
                            }`}
                          >
                            {readiness.ready ? 'READY' : 'NOT READY'}
                          </span>
                        </div>
                        <div className="surface-card-body">
                          {readiness.repositories.map(repo => (
                            <div
                              key={repo.changeId}
                              style={{
                                padding: '6px 10px',
                                border: '1px solid #e2e8f0',
                                borderRadius: 6,
                                marginBottom: 6,
                                fontSize: 12,
                              }}
                            >
                              <strong>{repo.repoName}</strong> (
                              {repo.changeBranch} → {repo.targetBranch}) ·{' '}
                              {repo.clean ? 'CLEAN' : repo.diagnostic}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {traceability && (
                      <div className="surface-card">
                        <div className="surface-card-header">
                          <span>
                            {tr(
                              lang,
                              '需求 → 变更追溯矩阵',
                              'Requirement Traceability Matrix',
                            )}
                          </span>
                        </div>
                        <div className="surface-card-body">
                          {(traceability.baseline?.prd.trace ?? []).length ===
                          0 ? (
                            <div style={{color: '#64748b'}}>
                              {tr(
                                lang,
                                '暂无定稿基线追溯条目',
                                'No baseline trace links yet',
                              )}
                            </div>
                          ) : (
                            (traceability.baseline?.prd.trace ?? []).map(t => (
                              <div
                                key={t.requirementId}
                                style={{fontSize: 12, marginBottom: 4}}
                              >
                                <span className="tag">{t.scopeKey}</span>{' '}
                                {t.requirementId} (AC: {t.acceptanceIds.length})
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

import {useCallback, useEffect, useState, type ReactElement} from 'react';
import type {
  ChangeDetailSnapshot,
  ControlSchemaResponse,
  FocusProjection,
  HamaDetailSnapshot,
  MissionDetailSnapshot,
  MissionEvidenceResponse,
  MissionTraceabilityResponse,
} from '../../../src/shared/api.ts';
import type {
  CommentDisposition,
  ControlAction,
  DecisionAction,
  DecisionOptionPreview,
  IntentPresetId,
  MissionEventRecord,
  MissionGateRecord,
} from '../../../src/shared/v3-types.ts';
import {forgeApi} from '../api/client.ts';
import type {UiLang} from '../i18n.ts';

function text(lang: UiLang, zh: string, en: string): string {
  return lang === 'ZH' ? zh : en;
}

function makeUuid(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function healthPillClass(health: FocusProjection['health']): string {
  switch (health) {
    case 'needs_you':
      return 'v3-pill v3-pill-accent';
    case 'completed':
      return 'v3-pill v3-pill-green';
    case 'recovering':
      return 'v3-pill v3-pill-amber';
    case 'failed':
    case 'aborted':
      return 'v3-pill v3-pill-red';
    case 'flowing':
      return 'v3-pill v3-pill-indigo';
    default:
      return 'v3-pill';
  }
}

export function FocusWorkspace(props: {
  readonly lang: UiLang;
  readonly detail: MissionDetailSnapshot;
  readonly focus: FocusProjection;
  readonly controlSchema: ControlSchemaResponse | null;
  readonly expertMode: boolean;
  readonly onRefreshMission: (missionId: string) => Promise<void>;
  readonly onSpawnedMission: (missionId: string) => Promise<void>;
  readonly onRefreshBootstrap: () => Promise<void> | void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {
    lang,
    detail,
    focus,
    controlSchema,
    expertMode,
    onRefreshMission,
    onSpawnedMission,
    onRefreshBootstrap,
    onError,
  } = props;
  const {mission} = focus;

  const [selectedGateId, setSelectedGateId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<DecisionAction | null>(
    null,
  );
  const [decisionFeedback, setDecisionFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<
    'spec' | 'build' | 'explain' | 'evidence'
  >('spec');
  const [showControlDrawer, setShowControlDrawer] = useState(false);

  const [hamaDetail, setHamaDetail] = useState<HamaDetailSnapshot | null>(null);
  const [traceability, setTraceability] =
    useState<MissionTraceabilityResponse | null>(null);
  const [evidenceRes, setEvidenceRes] =
    useState<MissionEvidenceResponse | null>(null);
  const [events, setEvents] = useState<readonly MissionEventRecord[]>([]);

  const [expandedChangeId, setExpandedChangeId] = useState<string | null>(null);
  const [changeDetails, setChangeDetails] = useState<
    Readonly<Record<string, ChangeDetailSnapshot>>
  >({});
  const [diffPreview, setDiffPreview] = useState<{
    readonly changeId: string;
    readonly summary: string;
    readonly patch: string;
  } | null>(null);

  const [commentScope, setCommentScope] = useState('proposal');
  const [commentSeverity, setCommentSeverity] = useState<
    'blocking' | 'advisory'
  >('advisory');
  const [commentBody, setCommentBody] = useState('');
  const [evolveFeedback, setEvolveFeedback] = useState('');
  const [showEvolveBox, setShowEvolveBox] = useState(false);

  const activeGate: MissionGateRecord | null =
    (selectedGateId
      ? (detail.gates.find(
          g => g.id === selectedGateId && g.status === 'open',
        ) ?? null)
      : null) ?? focus.primaryAction;

  // Reset selected option smoothly when the active gate changes.
  useEffect(() => {
    if (!activeGate) {
      setSelectedAction(null);
      setDecisionFeedback('');
      return;
    }
    const recommended =
      activeGate.options.find(o => o.recommended) ?? activeGate.options[0];
    setSelectedAction(recommended ? recommended.action : null);
    setDecisionFeedback('');
  }, [activeGate?.id]);

  const loadTabData = useCallback(async (): Promise<void> => {
    try {
      if (activeTab === 'spec') {
        setHamaDetail(await forgeApi.getMissionHama(mission.id));
      } else if (activeTab === 'build') {
        setTraceability(await forgeApi.getMissionTraceability(mission.id));
      } else if (activeTab === 'evidence') {
        const [ev, evList] = await Promise.all([
          forgeApi.getMissionEvidence(mission.id),
          forgeApi.getMissionEvents(mission.id, 300),
        ]);
        setEvidenceRes(ev);
        setEvents(evList);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [activeTab, mission.id, onError]);

  useEffect(() => {
    void loadTabData();
  }, [loadTabData, mission.version, mission.status]);

  const chosenOption: DecisionOptionPreview | undefined =
    activeGate?.options.find(o => o.action === selectedAction);

  const handleSubmitDecision = async (): Promise<void> => {
    if (!activeGate || !selectedAction) {
      return;
    }
    if (chosenOption?.requiresFeedback && !decisionFeedback.trim()) {
      onError(
        text(
          lang,
          '当前选择的操作需要填写说明（例如澄清答案、条件或修改意见）。',
          'This option requires non-empty feedback before submitting.',
        ),
      );
      return;
    }
    setSubmitting(true);
    setActionMessage(null);
    try {
      await forgeApi.resolveMissionDecision(mission.id, {
        gateId: activeGate.id,
        targetId: activeGate.targetId,
        targetHash: activeGate.targetHash,
        idempotencyKey: makeUuid(),
        actor: 'human_operator',
        action: selectedAction,
        feedback: decisionFeedback.trim(),
        scope: 'proposal',
        issueIds: [],
      });
      setDecisionFeedback('');
      setActionMessage(
        text(
          lang,
          '决策已提交并通过幂等校验，工厂正在推进下一阶段。',
          'Decision recorded and verified; advancing workflow.',
        ),
      );
      await onRefreshMission(mission.id);
      await loadTabData();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleControl = async (
    action: ControlAction,
    extra?: {
      readonly preset?: IntentPresetId;
      readonly nodeId?: string;
      readonly changeId?: string;
      readonly checkpointId?: string;
      readonly feedback?: string;
    },
  ): Promise<void> => {
    setSubmitting(true);
    setActionMessage(null);
    try {
      const res = await forgeApi.executeMissionControl(mission.id, {
        action,
        expectedVersion: mission.version,
        actor: 'human_operator',
        preset: extra?.preset,
        nodeId: extra?.nodeId,
        changeId: extra?.changeId,
        checkpointId: extra?.checkpointId,
        feedback: extra?.feedback,
      });
      if (res.spawnedMission) {
        setActionMessage(
          text(
            lang,
            `已派生基线演进任务 ${res.spawnedMission.code}！`,
            `Spawned successor mission ${res.spawnedMission.code}!`,
          ),
        );
        await onSpawnedMission(res.spawnedMission.id);
        return;
      }
      await onRefreshMission(mission.id);
      await loadTabData();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleExpandChange = async (changeId: string): Promise<void> => {
    if (expandedChangeId === changeId) {
      setExpandedChangeId(null);
      return;
    }
    setExpandedChangeId(changeId);
    try {
      const chDetail = await forgeApi.getChangeDetail(changeId);
      setChangeDetails(prev => ({...prev, [changeId]: chDetail}));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInspectDiff = async (changeId: string): Promise<void> => {
    try {
      const diff = await forgeApi.getChangeDiff(changeId);
      setDiffPreview({
        changeId,
        summary: diff.summary,
        patch: diff.patch || '(No uncommitted working-tree diff)',
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddComment = async (): Promise<void> => {
    if (!commentBody.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      await forgeApi.addHamaComment(mission.id, {
        scopeKey: commentScope.trim() || 'proposal',
        severity: commentSeverity,
        body: commentBody.trim(),
        authorKind: 'human',
        authorLabel: 'human_operator',
      });
      setCommentBody('');
      await loadTabData();
      await onRefreshMission(mission.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCommentDisposition = async (
    commentId: string,
    disposition: CommentDisposition,
  ): Promise<void> => {
    setSubmitting(true);
    try {
      await forgeApi.resolveHamaComment(mission.id, commentId, {
        disposition,
        resolutionNote: `Marked ${disposition} via ForgeOps v3.0 UI`,
        resolvedBy: 'human_operator',
        actorKind: 'human',
      });
      await loadTabData();
      await onRefreshMission(mission.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const pct = focus.stageProgress?.percentComplete ?? 0;

  return (
    <div className="v3-canvas">
      {/* Header Summary Card */}
      <section
        className="v3-card"
        style={{display: 'flex', flexDirection: 'column', gap: 14}}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{flex: 1, minWidth: 260}}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 6,
              }}
            >
              <span className="v3-mono v3-pill" style={{fontWeight: 700}}>
                {mission.code}
              </span>
              <span className={healthPillClass(focus.health)}>
                {focus.health} · {mission.status}
              </span>
              <span
                className={`v3-pill ${
                  mission.executionMode === 'simulation'
                    ? 'v3-pill-accent'
                    : 'v3-pill-indigo'
                }`}
              >
                {mission.executionMode}
              </span>
              <span className="v3-pill">{mission.triageTrack}</span>
              <span className="v3-pill v3-mono">
                ${mission.spentUsd.toFixed(2)} / $
                {mission.budgetUsdLimit.toFixed(0)}
              </span>
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 750,
                letterSpacing: '-0.02em',
              }}
            >
              {mission.title}
            </h1>
            <div style={{fontSize: 13, color: 'var(--v3-sub)', marginTop: 4}}>
              {focus.explainability.whyHere}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
              }}
            >
              <span style={{color: 'var(--v3-sub)', fontWeight: 700}}>
                {text(lang, '模式预设:', 'Preset:')}
              </span>
              <select
                className="v3-select"
                value={mission.preset}
                disabled={
                  submitting ||
                  mission.status === 'delivered' ||
                  mission.status === 'aborted'
                }
                onChange={e => {
                  void handleControl('switch_preset', {
                    preset: e.target.value as IntentPresetId,
                  });
                }}
              >
                <option value="guided">
                  {text(lang, 'guided (推荐)', 'guided')}
                </option>
                <option value="autopilot">
                  {text(lang, 'autopilot (自动)', 'autopilot')}
                </option>
                <option value="strict_audit">
                  {text(lang, 'strict_audit (严格)', 'strict_audit')}
                </option>
              </select>
            </label>

            <button
              type="button"
              className="v3-btn"
              onClick={() => setShowControlDrawer(true)}
            >
              {text(lang, '参数与按钮说明', 'Control Guide')}
            </button>
          </div>
        </div>

        {/* 5-Stage Narrative Stepper */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11.5,
              color: 'var(--v3-muted)',
              marginBottom: 6,
            }}
          >
            <span>
              {text(lang, '5 段式软件交付主线', '5-Stage Delivery Pipeline')}
            </span>
            <span className="v3-mono">{pct}%</span>
          </div>
          <div className="v3-stepper">
            {focus.stageSteps.map((step, idx) => (
              <div key={step.stage} className={`v3-step ${step.status}`}>
                <div className="v3-step-num">
                  0{idx + 1} · {step.status}
                </div>
                <div className="v3-step-label">{step.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Contextual Controls Row */}
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4}}>
          {focus.availableControls
            .filter(c => c.action !== 'switch_preset')
            .filter(c => expertMode || c.enabled)
            .map(ctrl => (
              <button
                key={ctrl.action}
                type="button"
                className={`v3-btn ${ctrl.action === 'abort' ? 'v3-btn-danger' : ''}`}
                disabled={!ctrl.enabled || submitting}
                title={ctrl.disabledReason ?? ctrl.impactSummary}
                onClick={() => {
                  if (ctrl.action === 'evolve_baseline') {
                    setShowEvolveBox(v => !v);
                    return;
                  }
                  void handleControl(ctrl.action);
                }}
              >
                {ctrl.label}
              </button>
            ))}
        </div>
      </section>

      {actionMessage && <div className="v3-banner-ok">{actionMessage}</div>}

      {/* 30s Ebbinghaus Rehydration Capsule */}
      {focus.rehydration && (
        <section
          className="v3-card-warm"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{flex: 1, minWidth: 260}}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 4,
              }}
            >
              <span className="v3-pill v3-pill-indigo">
                {text(
                  lang,
                  '30秒遗忘曲线记忆唤醒胶囊',
                  '30s Rehydration Capsule',
                )}
              </span>
              <span
                className="v3-mono"
                style={{fontSize: 11.5, color: 'var(--v3-sub)'}}
              >
                Retention {Math.round(focus.rehydration.retentionScore * 100)}%
                · {focus.rehydration.tier} ·{' '}
                {focus.rehydration.elapsedHours.toFixed(1)}h elapsed
              </span>
            </div>
            <div style={{fontSize: 13, fontWeight: 600}}>
              {focus.rehydration.northStarGoal}
            </div>
            {focus.rehydration.autonomousDeltaBullets.length > 0 && (
              <div style={{fontSize: 12, color: 'var(--v3-sub)', marginTop: 4}}>
                {focus.rehydration.autonomousDeltaBullets
                  .slice(0, 3)
                  .join(' · ')}
              </div>
            )}
          </div>
          <button
            type="button"
            className="v3-btn"
            disabled={submitting}
            onClick={() => {
              void (async () => {
                try {
                  await forgeApi.anchorHubReview(mission.hubId);
                  await onRefreshBootstrap();
                  await onRefreshMission(mission.id);
                } catch (err) {
                  onError(err instanceof Error ? err.message : String(err));
                }
              })();
            }}
          >
            {text(lang, '标记我已对齐上下文', 'Mark Context Reviewed')}
          </button>
        </section>
      )}

      {/* Evolve Baseline v1 -> v2 Prompt Box */}
      {showEvolveBox && (
        <section className="v3-card" style={{borderColor: 'var(--v3-indigo)'}}>
          <div style={{fontWeight: 750, fontSize: 14.5, marginBottom: 6}}>
            {text(
              lang,
              '基于已冻结基线演进下一版本（v1 → v2 影响面分析）',
              'Evolve Next Baseline (v1 → v2 Impact Analysis)',
            )}
          </div>
          <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
            <input
              className="v3-input"
              style={{flex: 1, minWidth: 240}}
              value={evolveFeedback}
              onChange={e => setEvolveFeedback(e.target.value)}
              placeholder={text(
                lang,
                '描述相对于上一版的增量需求调整或新约束…',
                'Describe the incremental requirement change for the next baseline…',
              )}
            />
            <button
              type="button"
              className="v3-btn v3-btn-indigo"
              disabled={submitting}
              onClick={() => {
                void handleControl('evolve_baseline', {
                  feedback: evolveFeedback.trim() || 'Baseline v2 increment',
                });
                setShowEvolveBox(false);
                setEvolveFeedback('');
              }}
            >
              {text(lang, '派生新基线任务 →', 'Spawn Successor Mission →')}
            </button>
          </div>
        </section>
      )}

      {/* HERO SECTION: ONE Actionable Decision Card OR Status Summary */}
      {activeGate ? (
        <section className="v3-decision-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
              <span className="v3-pill v3-pill-accent" style={{fontSize: 12}}>
                {text(lang, '需要你拍板', 'Action Required')} ·{' '}
                {activeGate.kind}
              </span>
              {focus.pendingActionCount > 1 && (
                <span className="v3-pill">
                  {focus.pendingActionCount}{' '}
                  {text(lang, '个待办门控', 'pending gates')}
                </span>
              )}
            </div>
            <span
              className="v3-mono"
              style={{fontSize: 11.5, color: 'var(--v3-muted)'}}
            >
              gate={activeGate.id.slice(0, 12)} · rev{' '}
              {activeGate.targetRevision}
            </span>
          </div>

          {focus.secondaryActions.length > 1 && (
            <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
              {focus.secondaryActions.map(pkt => (
                <button
                  key={pkt.gateId}
                  type="button"
                  className={`v3-btn ${pkt.gateId === activeGate.id ? 'v3-btn-primary' : ''}`}
                  onClick={() => setSelectedGateId(pkt.gateId)}
                >
                  {pkt.kind}: {pkt.title.slice(0, 36)}
                </button>
              ))}
            </div>
          )}

          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 750,
                lineHeight: 1.4,
              }}
            >
              {activeGate.question}
            </h2>
            {activeGate.contextSnippet && (
              <pre className="v3-pre" style={{marginTop: 10}}>
                {activeGate.contextSnippet}
              </pre>
            )}
          </div>

          {/* Decision Options */}
          <div className="v3-decision-options">
            {activeGate.options.map(opt => {
              const selected = selectedAction === opt.action;
              return (
                <button
                  key={opt.action}
                  type="button"
                  className={`v3-option-card ${selected ? 'selected' : ''}`}
                  onClick={() => setSelectedAction(opt.action)}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                    }}
                  >
                    <span style={{fontWeight: 750, fontSize: 13.5}}>
                      {opt.label}
                    </span>
                    {opt.recommended && (
                      <span className="v3-pill v3-pill-accent">
                        {text(lang, '推荐', 'Recommended')}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--v3-sub)',
                      lineHeight: 1.5,
                    }}
                  >
                    {opt.consequencePreview}
                  </div>
                  {opt.requiresFeedback && (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--v3-amber)',
                      }}
                    >
                      *{' '}
                      {text(
                        lang,
                        '此操作需附带文字说明',
                        'Requires written explanation',
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            <textarea
              className="v3-textarea"
              rows={2}
              value={decisionFeedback}
              onChange={e => setDecisionFeedback(e.target.value)}
              placeholder={
                chosenOption?.requiresFeedback
                  ? text(
                      lang,
                      '请在此填写澄清回复、修改要求或拒绝原因（必填）…',
                      'Required: enter your clarification answer, revision note, or rationale…',
                    )
                  : text(
                      lang,
                      '附注说明（可选）…',
                      'Optional decision note or guidance…',
                    )
              }
            />
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: 10}}>
              <button
                type="button"
                className="v3-btn v3-btn-primary"
                disabled={submitting || !selectedAction}
                style={{padding: '9px 20px', fontSize: 13.5}}
                onClick={() => {
                  void handleSubmitDecision();
                }}
              >
                {submitting
                  ? text(lang, '正在提交并执行…', 'Applying Decision…')
                  : `${text(lang, '确认执行：', 'Confirm: ')}${chosenOption?.label ?? selectedAction ?? ''}`}
              </button>
            </div>
          </div>
        </section>
      ) : mission.status === 'delivered' ? (
        <section
          className="v3-card"
          style={{
            borderColor: 'var(--v3-green-border)',
            background: 'var(--v3-green-soft)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <span className="v3-pill v3-pill-green" style={{marginBottom: 6}}>
              {text(
                lang,
                '已交付 · 双独立 QA 与交付门控通过',
                'Delivered · Verified & Certified',
              )}
            </span>
            <h2 style={{margin: 0, fontSize: 17.5, fontWeight: 750}}>
              {text(
                lang,
                `所有 ${focus.progressivePanels.l2Work.certifiedNodes}/${focus.progressivePanels.l2Work.totalNodes} 个构筑节点已认证并完成交付签名`,
                `All ${focus.progressivePanels.l2Work.certifiedNodes}/${focus.progressivePanels.l2Work.totalNodes} nodes certified & delivered`,
              )}
            </h2>
            <div
              className="v3-mono"
              style={{fontSize: 12, color: 'var(--v3-sub)', marginTop: 4}}
            >
              baseline={mission.activeBaselineId ?? 'none'} · epoch=
              {focus.progressivePanels.l3Internals.executionEpoch}
            </div>
          </div>
          <div style={{display: 'flex', gap: 8}}>
            <button
              type="button"
              className="v3-btn"
              onClick={() => setActiveTab('evidence')}
            >
              {text(lang, '查看审计证据包', 'Inspect Evidence Bundle')}
            </button>
            <button
              type="button"
              className="v3-btn v3-btn-indigo"
              onClick={() => setShowEvolveBox(true)}
            >
              {text(lang, '演进需求至 v2 →', 'Evolve Baseline v2 →')}
            </button>
          </div>
        </section>
      ) : (
        <section className="v3-card-warm">
          <div style={{fontWeight: 700, fontSize: 14}}>
            {focus.explainability.waitingReason ?? focus.explainability.whyHere}
          </div>
          <div style={{fontSize: 12.5, color: 'var(--v3-sub)', marginTop: 4}}>
            {text(lang, '节点进度：', 'Nodes: ')}
            {focus.progressivePanels.l2Work.certifiedNodes}/
            {focus.progressivePanels.l2Work.totalNodes} certified ·{' '}
            {focus.progressivePanels.l2Work.runningNodes} running ·{' '}
            {focus.progressivePanels.l2Work.failedNodes} failed
          </div>
        </section>
      )}

      {/* 4 Progressive-Disclosure Inspection Tabs */}
      <div className="v3-subtabs">
        {(
          [
            ['spec', text(lang, '需求与基线 (Spec & PRD)', 'Spec & PRD')],
            [
              'build',
              text(lang, '执行与追溯 (Build & Diff)', 'Build & Traceability'),
            ],
            [
              'explain',
              text(lang, '为何在此 (Explainability)', 'Explainability'),
            ],
            [
              'evidence',
              text(lang, '审计证据与底层 (Evidence & L3)', 'Evidence & L3'),
            ],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`v3-subtab ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: Spec & PRD */}
      {activeTab === 'spec' && (
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="v3-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 10,
              }}
            >
              <div style={{fontWeight: 750, fontSize: 15}}>
                {text(
                  lang,
                  'HAMA 需求收敛产物与冻结 PRD',
                  'HAMA Artifacts & Frozen PRD',
                )}
              </div>
              {hamaDetail && (
                <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                  <span className="v3-pill">stage={hamaDetail.stage}</span>
                  <span className="v3-pill">
                    rework={hamaDetail.proposalReworkCount}
                  </span>
                  <span className="v3-pill">
                    localEdits={hamaDetail.prdLocalEditCount}
                  </span>
                  {hamaDetail.baseline && (
                    <span className="v3-pill v3-pill-green v3-mono">
                      Baseline v{hamaDetail.baseline.revision} ·{' '}
                      {hamaDetail.baseline.sha256.slice(0, 10)}
                    </span>
                  )}
                </div>
              )}
            </div>
            {hamaDetail?.prdMarkdown ? (
              <pre className="v3-pre">{hamaDetail.prdMarkdown}</pre>
            ) : (
              <div style={{fontSize: 13, color: 'var(--v3-sub)'}}>
                {text(
                  lang,
                  '完整 PRD 将在提案批准后渲染；当前已产出阶段产物：',
                  'Full PRD renders once the Proposal is integrated. Produced artifacts:',
                )}{' '}
                {(hamaDetail?.artifacts ?? [])
                  .map(a => `${a.kind}(r${a.revision})`)
                  .join(', ') || 'initializing'}
              </div>
            )}
          </div>

          {/* Inline HAMA Review Comments */}
          <div
            className="v3-card"
            style={{display: 'flex', flexDirection: 'column', gap: 10}}
          >
            <div style={{fontWeight: 750, fontSize: 14}}>
              {text(
                lang,
                `行内审阅批注（不浪费重大方案返工预算） (${hamaDetail?.comments.length ?? 0})`,
                `Inline Spec Review Comments (${hamaDetail?.comments.length ?? 0})`,
              )}
            </div>
            <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
              <input
                className="v3-input"
                style={{width: 150}}
                value={commentScope}
                onChange={e => setCommentScope(e.target.value)}
                placeholder="scopeKey"
              />
              <select
                className="v3-select"
                value={commentSeverity}
                onChange={e =>
                  setCommentSeverity(e.target.value as 'blocking' | 'advisory')
                }
              >
                <option value="advisory">advisory</option>
                <option value="blocking">blocking</option>
              </select>
              <input
                className="v3-input"
                style={{flex: 1, minWidth: 220}}
                value={commentBody}
                onChange={e => setCommentBody(e.target.value)}
                placeholder={text(
                  lang,
                  '添加针对某个 scope 或段落的审阅批注…',
                  'Add a targeted review comment…',
                )}
              />
              <button
                type="button"
                className="v3-btn"
                disabled={submitting || !commentBody.trim()}
                onClick={() => {
                  void handleAddComment();
                }}
              >
                {text(lang, '添加批注', 'Post Comment')}
              </button>
            </div>
            {(hamaDetail?.comments ?? []).map(cm => (
              <div key={cm.id} className="v3-card-warm">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{fontWeight: 700, fontSize: 12.5}}>
                    [{cm.scopeKey}] {cm.authorLabel} ({cm.severity})
                  </span>
                  <span
                    className={`v3-pill ${
                      cm.disposition === 'open'
                        ? 'v3-pill-amber'
                        : 'v3-pill-green'
                    }`}
                  >
                    {cm.disposition}
                  </span>
                </div>
                <div style={{fontSize: 13, marginTop: 4}}>{cm.body}</div>
                {cm.disposition === 'open' && (
                  <div style={{display: 'flex', gap: 6, marginTop: 8}}>
                    {(
                      ['accepted', 'changed', 'rejected', 'deferred'] as const
                    ).map(disp => (
                      <button
                        key={disp}
                        type="button"
                        className="v3-btn"
                        style={{padding: '3px 9px', fontSize: 11.5}}
                        disabled={submitting}
                        onClick={() => {
                          void handleCommentDisposition(cm.id, disp);
                        }}
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
      )}

      {/* Tab 2: Build & Traceability */}
      {activeTab === 'build' && (
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          {/* Plan Validation & Trial Simulation */}
          {(detail.validation || detail.trial) && (
            <div className="v3-grid-2">
              {detail.validation && (
                <div className="v3-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <strong>
                      {text(lang, '规划静检 (Validator)', 'Plan Validator')}
                    </strong>
                    <span
                      className={`v3-pill ${
                        detail.validation.valid
                          ? 'v3-pill-green'
                          : 'v3-pill-red'
                      }`}
                    >
                      {detail.validation.valid ? 'VALID' : 'INVALID'} ·{' '}
                      {detail.validation.errorCount} err /{' '}
                      {detail.validation.warningCount} warn
                    </span>
                  </div>
                  {detail.validation.issues.length === 0 ? (
                    <div style={{fontSize: 12.5, color: 'var(--v3-sub)'}}>
                      0 structural or contract issues.
                    </div>
                  ) : (
                    detail.validation.issues.slice(0, 6).map(iss => (
                      <div key={iss.id} style={{fontSize: 12, marginTop: 4}}>
                        [{iss.level}] {iss.message}
                      </div>
                    ))
                  )}
                </div>
              )}
              {detail.trial && (
                <div className="v3-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <strong>
                      {text(
                        lang,
                        '沙盘并发推演 (Trial Simulator)',
                        'Trial Simulator',
                      )}
                    </strong>
                    <span
                      className={`v3-pill ${
                        detail.trial.feasible ? 'v3-pill-green' : 'v3-pill-red'
                      }`}
                    >
                      {detail.trial.feasible ? 'FEASIBLE' : 'BLOCKED'} ·{' '}
                      {detail.trial.estimatedWaves.length} waves
                    </span>
                  </div>
                  <div
                    className="v3-mono"
                    style={{fontSize: 12, color: 'var(--v3-sub)'}}
                  >
                    executableNodes={detail.trial.totalExecutableNodes} ·
                    criticalPath={detail.trial.criticalPathLength} · contended=
                    {detail.trial.contendedNodePairs.length}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Baseline v1 -> v2 Impact Report */}
          {traceability?.impact && (
            <div className="v3-card">
              <div style={{fontWeight: 750, fontSize: 14, marginBottom: 6}}>
                {text(lang, '基线差异影响分析报告', 'Baseline Impact Report')}
              </div>
              <div
                className="v3-mono"
                style={{fontSize: 12, color: 'var(--v3-sub)'}}
              >
                added={traceability.impact.addedScopeKeys.length} · modified=
                {traceability.impact.modifiedScopeKeys.length} · removed=
                {traceability.impact.removedScopeKeys.length} · unchanged=
                {traceability.impact.unchangedScopeKeys.length}
              </div>
            </div>
          )}

          {/* Changes & Expandable Nodes / Checkpoints */}
          <div
            className="v3-card"
            style={{display: 'flex', flexDirection: 'column', gap: 10}}
          >
            <div style={{fontWeight: 750, fontSize: 14.5}}>
              {text(
                lang,
                `关联代码变更与 Twin-Graph 检查点 (${detail.changes.length})`,
                `Changes & Twin-Graph Checkpoints (${detail.changes.length})`,
              )}
            </div>
            {detail.changes.length === 0 ? (
              <div style={{fontSize: 13, color: 'var(--v3-sub)'}}>
                {text(
                  lang,
                  '需求基线批准并进入规划阶段后，系统会在此编译各代码仓的 Twin-Graph 变更节点。',
                  'Compiled repository Changes and checkpoints appear here after Plan compilation.',
                )}
              </div>
            ) : (
              detail.changes.map(chg => {
                const expanded = expandedChangeId === chg.id;
                const chDetail = changeDetails[chg.id];
                return (
                  <div key={chg.id} className="v3-card-warm">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <span
                          className="v3-mono"
                          style={{fontWeight: 700, marginRight: 8}}
                        >
                          {chg.code}
                        </span>
                        <span style={{fontWeight: 650}}>{chg.title}</span>
                        <span className="v3-pill" style={{marginLeft: 8}}>
                          {chg.status} · epoch {chg.executionEpoch ?? 1}
                        </span>
                      </div>
                      <div style={{display: 'flex', gap: 6}}>
                        <button
                          type="button"
                          className="v3-btn"
                          onClick={() => {
                            void handleInspectDiff(chg.id);
                          }}
                        >
                          Git Diff
                        </button>
                        <button
                          type="button"
                          className="v3-btn"
                          onClick={() => {
                            void toggleExpandChange(chg.id);
                          }}
                        >
                          {expanded
                            ? text(lang, '收起节点', 'Collapse')
                            : text(
                                lang,
                                '展开节点与检查点',
                                'Nodes & Checkpoints',
                              )}
                        </button>
                      </div>
                    </div>

                    {expanded && chDetail && (
                      <div
                        style={{
                          marginTop: 10,
                          paddingTop: 10,
                          borderTop: '1px solid var(--v3-border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div style={{fontWeight: 700, fontSize: 12.5}}>
                          Task Nodes ({chDetail.nodes.length})
                        </div>
                        {chDetail.nodes.map(node => (
                          <div
                            key={node.id}
                            className="v3-card"
                            style={{padding: '10px 12px'}}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                                flexWrap: 'wrap',
                              }}
                            >
                              <div>
                                <span
                                  className="v3-mono"
                                  style={{fontWeight: 700}}
                                >
                                  {node.code}
                                </span>{' '}
                                <span>{node.title}</span>{' '}
                                <span className="v3-pill">{node.status}</span>{' '}
                                <span
                                  className="v3-mono"
                                  style={{fontSize: 11.5}}
                                >
                                  {node.attemptCount}/{node.maxAttempts}
                                </span>
                              </div>
                              {node.status === 'failed' && (
                                <button
                                  type="button"
                                  className="v3-btn v3-btn-primary"
                                  disabled={submitting}
                                  onClick={() => {
                                    void handleControl('retry_node', {
                                      changeId: chg.id,
                                      nodeId: node.id,
                                    });
                                  }}
                                >
                                  {text(lang, '重跑节点', 'Retry Node')}
                                </button>
                              )}
                            </div>
                            {node.forensics && (
                              <div
                                className="v3-banner-error"
                                style={{marginTop: 6}}
                              >
                                [{node.forensics.reasonCode}]{' '}
                                {node.forensics.summary}
                              </div>
                            )}
                          </div>
                        ))}

                        {chDetail.checkpoints.length > 0 && (
                          <div style={{marginTop: 4}}>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 12.5,
                                marginBottom: 4,
                              }}
                            >
                              Git Checkpoints ({chDetail.checkpoints.length})
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 6,
                              }}
                            >
                              {chDetail.checkpoints.map(cp => (
                                <button
                                  key={cp.id}
                                  type="button"
                                  className="v3-btn"
                                  disabled={submitting}
                                  onClick={() => {
                                    void handleControl('rewind_checkpoint', {
                                      changeId: chg.id,
                                      checkpointId: cp.id,
                                    });
                                  }}
                                >
                                  ⏪ Rewind {cp.label} (
                                  {cp.gitCommitSha.slice(0, 7)})
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {diffPreview && (
              <div style={{marginTop: 8}}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <strong>Git Diff: {diffPreview.summary}</strong>
                  <button
                    type="button"
                    className="v3-btn v3-btn-ghost"
                    onClick={() => setDiffPreview(null)}
                  >
                    ✕
                  </button>
                </div>
                <pre className="v3-pre">{diffPreview.patch}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Explainability */}
      {activeTab === 'explain' && (
        <div
          className="v3-card"
          style={{display: 'flex', flexDirection: 'column', gap: 14}}
        >
          <div>
            <div style={{fontWeight: 750, fontSize: 14, marginBottom: 4}}>
              {text(lang, '当前状态与阻断归因', 'Why ForgeOps Is Here')}
            </div>
            <div style={{fontSize: 13}}>{focus.explainability.whyHere}</div>
            {focus.explainability.waitingReason && (
              <div
                style={{fontSize: 12.5, color: 'var(--v3-sub)', marginTop: 4}}
              >
                {focus.explainability.waitingReason}
              </div>
            )}
          </div>

          {focus.explainability.recentForensics &&
            focus.explainability.recentForensics.length > 0 && (
              <div>
                <div style={{fontWeight: 750, fontSize: 14, marginBottom: 6}}>
                  {text(
                    lang,
                    '最近失败法医诊断卡片',
                    'Recent Failure Forensics',
                  )}
                </div>
                {focus.explainability.recentForensics.map(f => (
                  <div
                    key={f.failedNodeId}
                    className="v3-banner-error"
                    style={{marginBottom: 6}}
                  >
                    <span>
                      <strong>{f.failedNodeCode}</strong> [{f.reasonCode}]:{' '}
                      {f.summary}
                    </span>
                    <span className="v3-mono">{f.targetCheckpointLabel}</span>
                  </div>
                ))}
              </div>
            )}

          <div>
            <div style={{fontWeight: 750, fontSize: 14, marginBottom: 6}}>
              {text(
                lang,
                `生效中的 DDD 统一语言词汇表 (${focus.explainability.activeDddTerms.length})`,
                `Active DDD Ubiquitous Language (${focus.explainability.activeDddTerms.length})`,
              )}
            </div>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
              {focus.explainability.activeDddTerms.map(term => (
                <div key={term.canonicalTerm} className="v3-card-warm">
                  <strong>{term.canonicalTerm}</strong>{' '}
                  <span className="v3-pill">{term.boundedContext}</span>
                  <div
                    style={{fontSize: 12, color: 'var(--v3-red)', marginTop: 4}}
                  >
                    Avoid: {term.forbiddenAliases.join(', ') || 'none'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{fontWeight: 750, fontSize: 14, marginBottom: 6}}>
              {text(
                lang,
                `自动召回注入的历史记忆 (${focus.explainability.recalledMemories.length})`,
                `Auto-Injected Recalled Memories (${focus.explainability.recalledMemories.length})`,
              )}
            </div>
            {focus.explainability.recalledMemories.map(mem => (
              <div
                key={mem.id}
                className="v3-card-warm"
                style={{marginBottom: 6}}
              >
                <strong>{mem.title}</strong> ·{' '}
                <span className="v3-pill v3-pill-indigo">
                  {mem.authorityTier}
                </span>{' '}
                <span className="v3-mono">score={mem.score.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Evidence & L3 */}
      {activeTab === 'evidence' && (
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="v3-card">
            <div style={{fontWeight: 750, fontSize: 14, marginBottom: 8}}>
              {text(
                lang,
                'L3 引擎内部遥测与事务队列',
                'L3 Engine Internals & Outbox',
              )}
            </div>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
              <span className="v3-pill v3-mono">
                epoch={focus.progressivePanels.l3Internals.executionEpoch}
              </span>
              <span className="v3-pill v3-mono">
                version={focus.progressivePanels.l3Internals.missionVersion}
              </span>
              <span className="v3-pill v3-mono">
                events={focus.progressivePanels.l3Internals.recentEventCount}
              </span>
              <span className="v3-pill v3-mono">
                outbox_pending=
                {focus.progressivePanels.l3Internals.pendingOutboxCount}
              </span>
              <span
                className={`v3-pill v3-mono ${
                  focus.progressivePanels.l3Internals.deadLetterOutboxCount > 0
                    ? 'v3-pill-red'
                    : 'v3-pill-green'
                }`}
              >
                dead_letter=
                {focus.progressivePanels.l3Internals.deadLetterOutboxCount}
              </span>
            </div>
          </div>

          {evidenceRes && (
            <div className="v3-card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <strong>
                  {text(
                    lang,
                    '哈希链审计证据包',
                    'Cryptographic Evidence Bundle',
                  )}
                </strong>
                <span
                  className={`v3-pill ${
                    evidenceRes.verification.valid
                      ? 'v3-pill-green'
                      : 'v3-pill-red'
                  }`}
                >
                  {evidenceRes.verification.valid ? 'CHAIN VALID' : 'BROKEN'} ·{' '}
                  {evidenceRes.verification.checkedEvents} events
                </span>
              </div>
              <div
                className="v3-mono"
                style={{fontSize: 12, color: 'var(--v3-sub)', marginBottom: 8}}
              >
                bundleSha256={evidenceRes.bundle.bundleSha256}
              </div>
              {evidenceRes.bundle.traceabilityMatrix.map(row => (
                <div
                  key={`${row.requirementId}-${row.scopeKey}`}
                  className="v3-card-warm v3-mono"
                  style={{fontSize: 12, marginBottom: 6}}
                >
                  [{row.certified ? 'CERTIFIED' : 'OPEN'}] {row.requirementId} (
                  {row.scopeKey}) → {row.changeIds.length} changes ·{' '}
                  {row.nodeIds.length} nodes
                </div>
              ))}
            </div>
          )}

          <div className="v3-card">
            <div style={{fontWeight: 750, fontSize: 14, marginBottom: 8}}>
              {text(
                lang,
                `哈希链事件日志 (${events.length})`,
                `Hash-Chained Event Ledger (${events.length})`,
              )}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 340,
                overflowY: 'auto',
              }}
            >
              {events.map(ev => (
                <div
                  key={ev.id}
                  className="v3-card-warm v3-mono"
                  style={{fontSize: 11.5}}
                >
                  #{ev.seq} [{ev.eventType}] by {ev.actor} ·{' '}
                  {ev.eventHash.slice(0, 12)} · {ev.createdAt}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Slide-over Control Explanation Drawer */}
      {showControlDrawer && (
        <div
          className="v3-drawer-backdrop"
          onClick={() => setShowControlDrawer(false)}
        >
          <aside className="v3-drawer" onClick={e => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h2 style={{margin: 0, fontSize: 16.5, fontWeight: 750}}>
                {text(
                  lang,
                  '控制按钮与参数说明（用人话解释一切）',
                  'Plain-Language Control & Parameter Guide',
                )}
              </h2>
              <button
                type="button"
                className="v3-btn"
                onClick={() => setShowControlDrawer(false)}
              >
                {text(lang, '关闭', 'Close')}
              </button>
            </div>

            <div style={{fontWeight: 700, fontSize: 13}}>
              {text(
                lang,
                '当前任务可用操作：',
                'Contextual Actions for Current Mission:',
              )}
            </div>
            {focus.availableControls.map(ctrl => (
              <div key={ctrl.action} className="v3-card-warm">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <strong>{ctrl.label}</strong>
                  <span
                    className={`v3-pill ${ctrl.enabled ? 'v3-pill-green' : ''}`}
                  >
                    {ctrl.enabled ? 'Enabled' : 'Locked'}
                  </span>
                </div>
                <div style={{fontSize: 12.5, marginTop: 4}}>
                  {ctrl.impactSummary}
                </div>
                {ctrl.disabledReason && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--v3-amber)',
                      marginTop: 3,
                    }}
                  >
                    {ctrl.disabledReason}
                  </div>
                )}
              </div>
            ))}

            <div style={{fontWeight: 700, fontSize: 13, marginTop: 6}}>
              {text(lang, '全局治理参数辞典：', 'Control Schema Dictionary:')}
            </div>
            {(controlSchema?.controls ?? []).map(item => (
              <div key={item.key} className="v3-card-warm">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <strong>{item.label}</strong>
                  <span className="v3-pill">{item.riskLevel}</span>
                </div>
                <div style={{fontSize: 12.5, marginTop: 4}}>
                  {item.plainExplanation}
                </div>
                <div
                  style={{fontSize: 12, color: 'var(--v3-sub)', marginTop: 3}}
                >
                  {item.runtimeEffect}
                </div>
              </div>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}

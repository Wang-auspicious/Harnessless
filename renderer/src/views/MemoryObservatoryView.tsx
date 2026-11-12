import React, {useCallback, useEffect, useState} from 'react';
import type {
  BootstrapSnapshot,
  EvidenceSearchHit,
  MemoryObservatorySnapshot,
} from '../../../src/shared/api.ts';
import type {SemanticMemory} from '../../../src/shared/types.ts';
import {type DreamConsolidationDto, forgeApi} from '../api/client.ts';

export interface MemoryObservatoryViewProps {
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly sseTick: number;
  readonly onRefreshBootstrap: () => Promise<void>;
}

function buildRetentionSvgPath(
  stabilityHours: number,
  width: number,
  height: number,
  maxHours = 72,
): string {
  const s = Math.max(4, stabilityHours);
  const points: string[] = [];
  for (let h = 0; h <= maxHours; h += 2) {
    const retention = Math.exp(-h / s);
    const x = (h / maxHours) * width;
    const y = (1 - retention) * height;
    points.push(`${h === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return points.join(' ');
}

function memoryKindBadge(kind: SemanticMemory['kind']): string {
  switch (kind) {
    case 'pitfall_lesson':
      return 'badge badge-amber';
    case 'adr':
      return 'badge badge-indigo';
    case 'architecture':
      return 'badge badge-cyan';
    case 'convention':
      return 'badge badge-emerald';
  }
}

export function MemoryObservatoryView(
  props: MemoryObservatoryViewProps,
): React.ReactElement {
  const {snapshot, activeHubId, sseTick, onRefreshBootstrap} = props;
  const effectiveHubId = activeHubId || snapshot.hubs[0]?.id || '';

  const [observatory, setObservatory] =
    useState<MemoryObservatorySnapshot | null>(null);
  const [memoryTab, setMemoryTab] = useState<'active' | 'superseded'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<readonly EvidenceSearchHit[]>(
    [],
  );
  const [dreamResult, setDreamResult] = useState<DreamConsolidationDto | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const loadObservatory = useCallback(async () => {
    try {
      const res = await forgeApi.getMemoryObservatory(
        effectiveHubId || undefined,
      );
      setObservatory(res);
    } catch {
      // Ignore background refresh error.
    }
  }, [effectiveHubId]);

  useEffect(() => {
    void loadObservatory();
  }, [loadObservatory, sseTick]);

  const activeCapsule =
    observatory?.capsules.find(c => c.hubId === effectiveHubId) ??
    snapshot.capsules.find(c => c.hubId === effectiveHubId) ??
    snapshot.capsules[0];

  const activeMemories = observatory?.activeMemories ?? [];
  const supersededMemories = observatory?.supersededMemories ?? [];

  const humanStability = activeCapsule?.stabilityHours ?? 24;
  const avgAgentStability =
    activeMemories.length > 0
      ? activeMemories.reduce((acc, m) => acc + m.stabilityHours, 0) /
        activeMemories.length
      : 48;

  const svgWidth = 640;
  const svgHeight = 170;
  const humanCurvePath = buildRetentionSvgPath(
    humanStability,
    svgWidth,
    svgHeight,
  );
  const agentCurvePath = buildRetentionSvgPath(
    avgAgentStability,
    svgWidth,
    svgHeight,
  );
  const warmThresholdY = (1 - 0.75) * svgHeight;
  const deltaThresholdY = (1 - 0.35) * svgHeight;
  const currentElapsedX = Math.min(
    svgWidth,
    ((activeCapsule?.elapsedHours ?? 0) / 72) * svgWidth,
  );
  const currentRetentionY =
    (1 - (activeCapsule?.retentionScore ?? 1)) * svgHeight;

  const handleAnchor = async (): Promise<void> => {
    if (!effectiveHubId) return;
    setBusy(true);
    try {
      await forgeApi.anchorHubReview(effectiveHubId);
      await loadObservatory();
      await onRefreshBootstrap();
    } finally {
      setBusy(false);
    }
  };

  const handleSleepConsolidation = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await forgeApi.runSleepConsolidation();
      setDreamResult(res);
      await loadObservatory();
      await onRefreshBootstrap();
    } finally {
      setBusy(false);
    }
  };

  const handleSearchEvidence = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchHits([]);
      return;
    }
    setBusy(true);
    try {
      const hits = await forgeApi.searchEvidence(
        searchQuery.trim(),
        effectiveHubId || undefined,
      );
      setSearchHits(hits);
    } finally {
      setBusy(false);
    }
  };

  const displayedMemories =
    memoryTab === 'active' ? activeMemories : supersededMemories;

  return (
    <div className="panel-grid">
      {/* Dual-Track Ebbinghaus Decay & Sleep-Time Consolidation Card */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              Dual-Track Ebbinghaus Retention & Bi-Temporal Memory Observatory
            </h3>
            <p className="card-subtitle">
              Track A: Human Context Retention R(t) = exp(-t / S) · Track B:
              Agent Semantic Memory Stability & Sleep Consolidation
            </p>
          </div>
          <div style={{display: 'flex', gap: 8}}>
            <button
              type="button"
              className="btn btn-emerald btn-sm"
              disabled={busy || !effectiveHubId}
              onClick={() => void handleAnchor()}
            >
              Acknowledge & Anchor
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void handleSleepConsolidation()}
            >
              Run Sleep Consolidation
            </button>
          </div>
        </div>

        {dreamResult && (
          <div
            className="card"
            style={{
              background: 'rgba(16, 185, 129, 0.1)',
              borderColor: 'var(--accent-emerald)',
              marginBottom: 12,
              padding: '8px 12px',
            }}
          >
            <strong>Sleep Consolidation Complete:</strong> Extracted{' '}
            {dreamResult.extractedPitfalls} pitfall lesson(s), superseded{' '}
            {dreamResult.supersededDriftedMemories} drifted memory entry(s),
            archived {dreamResult.coldArchivedMemories} cold entry(s), and
            refreshed {dreamResult.capsulesRefreshed} Hub re-hydration
            capsule(s).
          </div>
        )}

        <div className="panel-grid grid-2">
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
                fontSize: 11.5,
              }}
            >
              <span>
                <strong style={{color: '#6366f1'}}>
                  ● Human Retention Curve
                </strong>{' '}
                (S = {humanStability}h)
              </span>
              <span>
                <strong style={{color: '#06b6d4'}}>
                  ● Agent Semantic Stability
                </strong>{' '}
                (Avg S = {avgAgentStability.toFixed(1)}h)
              </span>
            </div>

            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              style={{
                width: '100%',
                height: 185,
                background: '#080c14',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
              }}
            >
              {/* Threshold 0.75 Warm Line */}
              <line
                x1={0}
                y1={warmThresholdY}
                x2={svgWidth}
                y2={warmThresholdY}
                stroke="rgba(16, 185, 129, 0.45)"
                strokeDasharray="4 4"
              />
              <text x={8} y={warmThresholdY - 4} fill="#34d399" fontSize="10">
                0.75 Warm Threshold
              </text>

              {/* Threshold 0.35 30s-Delta Line */}
              <line
                x1={0}
                y1={deltaThresholdY}
                x2={svgWidth}
                y2={deltaThresholdY}
                stroke="rgba(245, 158, 11, 0.5)"
                strokeDasharray="4 4"
              />
              <text x={8} y={deltaThresholdY - 4} fill="#fbbf24" fontSize="10">
                0.35 30s-Delta / Deep Re-Anchor Threshold
              </text>

              {/* Agent Semantic Stability Curve */}
              <path
                d={agentCurvePath}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2"
              />

              {/* Human Retention Curve */}
              <path
                d={humanCurvePath}
                fill="none"
                stroke="#6366f1"
                strokeWidth="2.5"
              />

              {/* Current Operator Position Marker */}
              <circle
                cx={currentElapsedX}
                cy={currentRetentionY}
                r={5}
                fill="#10b981"
                stroke="#fff"
                strokeWidth="1.5"
              />
              <text
                x={svgWidth - 95}
                y={svgHeight - 8}
                fill="#94a3b8"
                fontSize="10"
              >
                Horizon: 0h → 72h
              </text>
            </svg>
          </div>

          <div
            className="card"
            style={{
              background: 'var(--bg-card)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div className="card-header">
                <h4 className="card-title">
                  Active Hub Re-hydration Capsule:{' '}
                  {activeCapsule?.hubName ?? 'Federation Hub'}
                </h4>
                <span className="badge badge-indigo">
                  Tier: {activeCapsule?.tier ?? 'warm'}
                </span>
              </div>
              <div className="muted" style={{fontSize: 12, marginBottom: 8}}>
                Retention Score:{' '}
                <strong>
                  {((activeCapsule?.retentionScore ?? 1) * 100).toFixed(0)}%
                </strong>{' '}
                · Elapsed: {activeCapsule?.elapsedHours ?? 0}h · Entropy:{' '}
                {activeCapsule?.mutationEntropy ?? 0}
              </div>
              <div style={{fontSize: 12, marginBottom: 6}}>
                <strong>North Star:</strong>{' '}
                {activeCapsule?.northStarGoal ?? 'N/A'}
              </div>
              <div className="muted" style={{fontSize: 11.5}}>
                <strong>Last Human Anchor:</strong>{' '}
                {activeCapsule?.lastHumanAnchor ?? 'N/A'}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 14,
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <span style={{fontSize: 18, fontWeight: 700}}>
                  {activeMemories.length}
                </span>{' '}
                <span className="muted">Active Semantic Memories</span>
              </div>
              <div>
                <span style={{fontSize: 18, fontWeight: 700}}>
                  {supersededMemories.length}
                </span>{' '}
                <span className="muted">Superseded History</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FTS5 Cross-Harness Evidence Search */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              FTS5 Cross-Harness Episodic Evidence Search (`messages_fts`)
            </h3>
            <p className="card-subtitle">
              Full-text search across normalized Codex, Claude Code, ACP, and
              Native API execution transcripts
            </p>
          </div>
        </div>

        <form
          onSubmit={e => void handleSearchEvidence(e)}
          style={{display: 'flex', gap: 8, marginBottom: 12}}
        >
          <input
            className="input mono"
            placeholder="Search execution transcripts, gate forensics, or DDD identifiers (e.g. SettlementVoucher, checkpoint)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Search FTS5
          </button>
        </form>

        {searchHits.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Adapter</th>
                <th>Role</th>
                <th>Matched Transcript Snippet</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {searchHits.map(hit => (
                <tr key={hit.messageId}>
                  <td className="mono">{hit.sessionId}</td>
                  <td>
                    <span className="badge badge-indigo">{hit.adapterId}</span>
                  </td>
                  <td className="mono">{hit.role}</td>
                  <td className="mono" style={{fontSize: 11.5}}>
                    {hit.snippet}
                  </td>
                  <td className="muted mono" style={{fontSize: 11}}>
                    {new Date(hit.createdAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tabbed Bi-Temporal Semantic Memory Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              Bi-Temporal Semantic Memory Ledger (`validFrom` → `validUntil`)
            </h3>
            <p className="card-subtitle">
              Path-anchored architectural invariants and pitfall lessons; stale
              rules are cleanly superseded rather than deleted
            </p>
          </div>
          <div style={{display: 'flex', gap: 6}}>
            <button
              type="button"
              className={
                memoryTab === 'active' ? 'btn btn-primary btn-sm' : 'btn btn-sm'
              }
              onClick={() => setMemoryTab('active')}
            >
              Active Memories ({activeMemories.length})
            </button>
            <button
              type="button"
              className={
                memoryTab === 'superseded'
                  ? 'btn btn-primary btn-sm'
                  : 'btn btn-sm'
              }
              onClick={() => setMemoryTab('superseded')}
            >
              Superseded History ({supersededMemories.length})
            </button>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Title & Summary</th>
              <th>Path Anchors</th>
              <th>Stability (S)</th>
              <th>Recalls</th>
              <th>Valid From</th>
              <th>Valid Until</th>
            </tr>
          </thead>
          <tbody>
            {displayedMemories.map(mem => (
              <tr key={mem.id}>
                <td>
                  <span className={memoryKindBadge(mem.kind)}>{mem.kind}</span>
                </td>
                <td>
                  <strong>{mem.title}</strong>
                  <div className="muted" style={{fontSize: 11.5, marginTop: 2}}>
                    {mem.summary}
                  </div>
                </td>
                <td className="mono" style={{fontSize: 11}}>
                  {mem.pathAnchors.length > 0
                    ? mem.pathAnchors.join(', ')
                    : '(hub-wide)'}
                </td>
                <td className="mono">{mem.stabilityHours}h</td>
                <td className="mono">{mem.recallCount}</td>
                <td className="mono muted" style={{fontSize: 11}}>
                  {mem.validFrom.slice(0, 19).replace('T', ' ')}
                </td>
                <td className="mono" style={{fontSize: 11}}>
                  {mem.validUntil ? (
                    <span className="badge badge-rose">
                      {mem.validUntil.slice(0, 19).replace('T', ' ')}
                    </span>
                  ) : (
                    <span className="badge badge-emerald">ACTIVE</span>
                  )}
                </td>
              </tr>
            ))}
            {displayedMemories.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No {memoryTab} semantic memories recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

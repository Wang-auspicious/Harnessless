import React, {useState} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {
  AttentionItem,
  ChangeRecord,
  RehydrationCapsule,
} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';

export interface OverviewViewProps {
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly onSelectHub: (hubId: string) => void;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onRefresh: () => Promise<void>;
}

function tierBadgeClass(tier: RehydrationCapsule['tier']): string {
  if (tier === 'warm') return 'badge badge-emerald';
  if (tier === 'delta_30s') return 'badge badge-amber';
  return 'badge badge-rose';
}

function tierLabel(tier: RehydrationCapsule['tier']): string {
  if (tier === 'warm') return 'Warm Memory (>=75%)';
  if (tier === 'delta_30s') return '30s Delta Brief';
  return 'Deep Re-Anchor (<35%)';
}

function statusBadge(status: ChangeRecord['status']): string {
  switch (status) {
    case 'certified':
      return 'badge badge-emerald';
    case 'running':
      return 'badge badge-cyan';
    case 'paused_human':
    case 'cooldown_hold':
      return 'badge badge-amber';
    case 'failed':
      return 'badge badge-rose';
    default:
      return 'badge badge-indigo';
  }
}

export function OverviewView(props: OverviewViewProps): React.ReactElement {
  const {snapshot, onSelectHub, onOpenWorkstation, onRefresh} = props;
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>(
    {},
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleResolve = async (
    item: AttentionItem,
    resolution: string,
  ): Promise<void> => {
    setBusyId(item.id);
    try {
      await forgeApi.resolveAttention(item.id, resolution);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleAnchor = async (hubId: string): Promise<void> => {
    setBusyId(hubId);
    try {
      await forgeApi.anchorHubReview(hubId);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const totalPrematureBlocked = snapshot.changes.reduce(
    (acc, c) => acc + c.prematureStopCount,
    0,
  );

  return (
    <div className="panel-grid">
      {/* Top Executive KPI Strip */}
      <div className="panel-grid grid-3">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Cross-Hub Attention Queue</h3>
              <p className="card-subtitle">
                Ranked by unblocking impact / read-seconds × human retention
              </p>
            </div>
            <span
              className={
                snapshot.attentionQueue.length > 0
                  ? 'badge badge-amber'
                  : 'badge badge-emerald'
              }
            >
              {snapshot.attentionQueue.length} Open
            </span>
          </div>
          <div style={{fontSize: 22, fontWeight: 700}}>
            {snapshot.attentionQueue.length === 0
              ? 'Zero Blockers — Autonomous Flow Clear'
              : `${snapshot.attentionQueue.length} Decision(s) Awaiting Operator`}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">8h Continuity & Anti-Stop Guard</h3>
              <p className="card-subtitle">
                External CompletionCertifier + CooldownHolding
              </p>
            </div>
            <span className="badge badge-cyan">
              {snapshot.changes.filter(c => c.status === 'running').length}{' '}
              Running
            </span>
          </div>
          <div style={{display: 'flex', gap: 18, alignItems: 'baseline'}}>
            <div>
              <span style={{fontSize: 22, fontWeight: 700}}>
                {snapshot.changes.filter(c => c.status === 'certified').length}
              </span>{' '}
              <span className="muted">Certified</span>
            </div>
            <div>
              <span style={{fontSize: 22, fontWeight: 700}}>
                {totalPrematureBlocked}
              </span>{' '}
              <span className="muted">Premature Stops Intercepted</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Concurrency & Priority Broker</h3>
              <p className="card-subtitle">
                Dedicated Human Slot prevents interactive starvation
              </p>
            </div>
            <span
              className={
                snapshot.slotLoad.humanPrioritySlotBusy
                  ? 'badge badge-amber'
                  : 'badge badge-emerald'
              }
            >
              Human Slot:{' '}
              {snapshot.slotLoad.humanPrioritySlotBusy ? 'Busy' : 'Ready'}
            </span>
          </div>
          <div style={{display: 'flex', gap: 18, alignItems: 'baseline'}}>
            <div>
              <span style={{fontSize: 22, fontWeight: 700}}>
                {snapshot.slotLoad.activeWorkerSlots}/
                {snapshot.slotLoad.maxWorkerSlots}
              </span>{' '}
              <span className="muted">Worker Slots</span>
            </div>
            <div>
              <span style={{fontSize: 22, fontWeight: 700}}>
                {snapshot.slotLoad.queuedWorkerTasks}
              </span>{' '}
              <span className="muted">Queued</span>
            </div>
          </div>
        </div>
      </div>

      {/* Attention Inbox (1-Question Structured Cards) */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              Structured Human Attention Inbox (1-Card-1-Decision)
            </h3>
            <p className="card-subtitle">
              Agents compress context into bounded options instead of dumping
              raw transcripts
            </p>
          </div>
        </div>

        {snapshot.attentionQueue.length === 0 ? (
          <div className="muted" style={{padding: '8px 0'}}>
            No human interventions pending across any Federation Hub.
          </div>
        ) : (
          <div className="panel-grid grid-2">
            {snapshot.attentionQueue.map(item => {
              const hub = snapshot.hubs.find(h => h.id === item.hubId);
              return (
                <div
                  key={item.id}
                  className="card"
                  style={{background: 'var(--bg-card)'}}
                >
                  <div className="card-header">
                    <span className="badge badge-amber">{item.kind}</span>
                    <span className="muted" style={{fontSize: 11}}>
                      {hub?.name ?? item.hubId} · ~{item.estimatedReadSeconds}s
                      read · unblocks {item.downstreamBlockedCount} node(s)
                    </span>
                  </div>
                  <div style={{fontWeight: 600, marginBottom: 6}}>
                    {item.question}
                  </div>
                  <div
                    className="muted mono"
                    style={{fontSize: 11.5, marginBottom: 10}}
                  >
                    {item.contextSnippet}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginBottom: 8,
                    }}
                  >
                    {item.options.map((opt, idx) => (
                      <button
                        key={opt}
                        type="button"
                        disabled={busyId === item.id}
                        className={
                          idx === item.recommendedIndex
                            ? 'btn btn-primary btn-sm'
                            : 'btn btn-sm'
                        }
                        onClick={() => void handleResolve(item, opt)}
                      >
                        {idx === item.recommendedIndex ? `★ ${opt}` : opt}
                      </button>
                    ))}
                  </div>
                  <div style={{display: 'flex', gap: 6}}>
                    <input
                      className="input"
                      placeholder="Or enter custom directive..."
                      value={customAnswers[item.id] ?? ''}
                      onChange={e =>
                        setCustomAnswers(prev => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={
                        busyId === item.id ||
                        !(customAnswers[item.id] ?? '').trim()
                      }
                      onClick={() =>
                        void handleResolve(
                          item,
                          (customAnswers[item.id] ?? '').trim(),
                        )
                      }
                    >
                      Send
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ebbinghaus Re-hydration Capsules across Concurrent Projects */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              Human Ebbinghaus Re-hydration Capsules (Multi-Hub Context
              Compression)
            </h3>
            <p className="card-subtitle">
              Adapts briefing depth automatically based on elapsed absence and
              autonomous mutation entropy
            </p>
          </div>
        </div>

        <div className="panel-grid grid-2">
          {snapshot.capsules.map(cap => (
            <div
              key={cap.hubId}
              className="card"
              style={{
                background:
                  cap.hubId === props.activeHubId
                    ? 'rgba(99, 102, 241, 0.09)'
                    : 'var(--bg-card)',
                borderColor:
                  cap.hubId === props.activeHubId
                    ? 'var(--accent-indigo)'
                    : undefined,
              }}
            >
              <div className="card-header">
                <div>
                  <h4 className="card-title">{cap.hubName}</h4>
                  <div className="card-subtitle">
                    Retention R = {(cap.retentionScore * 100).toFixed(0)}% · S ={' '}
                    {cap.stabilityHours}h · ΔEntropy = {cap.mutationEntropy}
                  </div>
                </div>
                <span className={tierBadgeClass(cap.tier)}>
                  {tierLabel(cap.tier)}
                </span>
              </div>

              <div style={{fontSize: 12, marginBottom: 8}}>
                <strong>North Star:</strong> {cap.northStarGoal}
              </div>
              <div className="muted" style={{fontSize: 11.5, marginBottom: 8}}>
                <strong>Last Anchor:</strong> {cap.lastHumanAnchor}
              </div>

              {cap.autonomousDeltaBullets.length > 0 && (
                <div style={{marginBottom: 8}}>
                  <div className="form-label">Autonomous Delta Summary</div>
                  <ul style={{margin: '4px 0', paddingLeft: 18, fontSize: 12}}>
                    {cap.autonomousDeltaBullets.map(b => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {cap.lockedDecisions.length > 0 && (
                <div style={{marginBottom: 8}}>
                  <div className="form-label">
                    Deep Re-Anchor Locked Decisions & DDD Terms
                  </div>
                  <ul
                    style={{margin: '4px 0', paddingLeft: 18, fontSize: 11.5}}
                  >
                    {cap.lockedDecisions.map(d => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{display: 'flex', gap: 8, marginTop: 10}}>
                <button
                  type="button"
                  className="btn btn-emerald btn-sm"
                  disabled={busyId === cap.hubId}
                  onClick={() => void handleAnchor(cap.hubId)}
                >
                  Acknowledge & Anchor (+Spaced Stability)
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onSelectHub(cap.hubId)}
                >
                  Focus Hub
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Multi-Repo Changes Continuity Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Active Engineering Changes</h3>
            <p className="card-subtitle">
              Click any Change to open its synchronized WBS & Living Twin-Graph
              Workstation
            </p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Title</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Team (Lead → Worker)</th>
              <th>Budget</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.changes.map(chg => (
              <tr key={chg.id}>
                <td className="mono">{chg.code}</td>
                <td>
                  <strong>{chg.title}</strong>
                  {chg.crossRepoEpicId && (
                    <span className="badge badge-cyan" style={{marginLeft: 6}}>
                      {chg.crossRepoEpicId}
                    </span>
                  )}
                </td>
                <td>
                  <span className="badge badge-slate">
                    {chg.permissionTier}
                  </span>
                </td>
                <td>
                  <span className={statusBadge(chg.status)}>{chg.status}</span>
                </td>
                <td className="mono" style={{fontSize: 11.5}}>
                  {chg.team.leadAdapterId} → {chg.team.workerAdapterId}
                </td>
                <td className="mono">
                  ${chg.spentUsd.toFixed(2)} / ${chg.budgetUsdLimit.toFixed(0)}
                </td>
                <td style={{display: 'flex', gap: 6}}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => onOpenWorkstation(chg.id)}
                  >
                    Open Twin-Graph
                  </button>
                  {(chg.status === 'planned' || chg.status === 'failed') && (
                    <button
                      type="button"
                      className="btn btn-emerald btn-sm"
                      onClick={async () => {
                        await forgeApi.executeChange(chg.id);
                        await onRefresh();
                      }}
                    >
                      Run 8h Loop
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

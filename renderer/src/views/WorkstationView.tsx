import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  BootstrapSnapshot,
  ChangeDetailSnapshot,
} from '../../../src/shared/api.ts';
import type {GraphNode, TranscriptMessage} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';

export interface WorkstationViewProps {
  readonly snapshot: BootstrapSnapshot;
  readonly selectedChangeId: string | null;
  readonly onSelectChange: (changeId: string) => void;
  readonly sseTick: number;
  readonly onRefreshBootstrap: () => Promise<void>;
}

interface PhaseContainerData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly childCount: number;
  readonly certifiedCount: number;
  readonly onToggleCollapse: (nodeId: string, next: boolean) => void;
}

interface FlowCardData extends Record<string, unknown> {
  readonly node: GraphNode;
}

function PhaseContainerNodeComponent(
  props: NodeProps<Node<PhaseContainerData>>,
): React.ReactElement {
  const {node, childCount, certifiedCount, onToggleCollapse} = props.data;
  return (
    <div className="tg-phase-container">
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div>
          <span className="badge badge-indigo">{node.code}</span>{' '}
          <strong style={{fontSize: 12.5}}>{node.title}</strong>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
          <span className="badge badge-emerald">
            {certifiedCount}/{childCount} Tasks
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={e => {
              e.stopPropagation();
              onToggleCollapse(node.id, !node.collapsed);
            }}
          >
            {node.collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>
      {node.collapsed && (
        <div className="muted" style={{fontSize: 11, marginTop: 4}}>
          {node.description}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function FlowCardNodeComponent(
  props: NodeProps<Node<FlowCardData>>,
): React.ReactElement {
  const {node} = props.data;
  return (
    <div className={`tg-node-card status-${node.status} kind-${node.kind}`}>
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
          marginBottom: 3,
        }}
      >
        <span className="mono" style={{fontWeight: 700, fontSize: 10.5}}>
          {node.code}
        </span>
        <span className="badge badge-slate" style={{fontSize: 9.5}}>
          {node.status}
        </span>
      </div>
      <div style={{fontWeight: 600, lineHeight: 1.25}}>{node.title}</div>
      {node.assignedModel && (
        <div className="muted mono" style={{fontSize: 10, marginTop: 3}}>
          {node.assignedRole}: {node.assignedModel}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES = {
  phaseContainer: PhaseContainerNodeComponent,
  flowCard: FlowCardNodeComponent,
};

export function WorkstationView(
  props: WorkstationViewProps,
): React.ReactElement {
  const {snapshot, selectedChangeId, onSelectChange, sseTick} = props;
  const effectiveChangeId = selectedChangeId ?? snapshot.changes[0]?.id ?? null;

  const [detail, setDetail] = useState<ChangeDetailSnapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly TranscriptMessage[]>([]);
  const [diffModal, setDiffModal] = useState<string | null>(null);
  const [showGhostForm, setShowGhostForm] = useState(false);
  const [ghostTitle, setGhostTitle] = useState('');
  const [ghostDesc, setGhostDesc] = useState('');
  const [ghostBeforeId, setGhostBeforeId] = useState('');

  const loadDetail = useCallback(async () => {
    if (!effectiveChangeId) {
      setDetail(null);
      return;
    }
    const snap = await forgeApi.getChangeDetail(effectiveChangeId);
    setDetail(snap);
    const latestSession = snap.sessions[0];
    if (latestSession) {
      const msgs = await forgeApi.getSessionMessages(latestSession.id);
      setMessages(msgs);
    } else {
      setMessages([]);
    }
  }, [effectiveChangeId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, sseTick]);

  const handleToggleCollapse = useCallback(
    async (nodeId: string, collapsed: boolean): Promise<void> => {
      await forgeApi.setNodeCollapsed(nodeId, collapsed);
      await loadDetail();
    },
    [loadDetail],
  );

  const rfNodesAndEdges = useMemo((): {
    readonly nodes: Node[];
    readonly edges: Edge[];
  } => {
    if (!detail) {
      return {nodes: [], edges: []};
    }
    const collapsedContainerIds = new Set(
      detail.nodes
        .filter(n => n.kind === 'phase_container' && n.collapsed)
        .map(n => n.id),
    );

    const nodes: Node[] = [];
    for (const n of detail.nodes) {
      if (n.containerNodeId && collapsedContainerIds.has(n.containerNodeId)) {
        continue;
      }
      if (n.kind === 'phase_container') {
        const children = detail.nodes.filter(c => c.containerNodeId === n.id);
        const certifiedCount = children.filter(
          c => c.status === 'certified',
        ).length;
        nodes.push({
          id: n.id,
          type: 'phaseContainer',
          position: {x: n.positionX, y: n.positionY},
          style: {
            width: n.width,
            height: n.collapsed ? 86 : n.height,
          },
          data: {
            node: n,
            childCount: children.length,
            certifiedCount,
            onToggleCollapse: (id: string, next: boolean) => {
              void handleToggleCollapse(id, next);
            },
          },
        });
      } else {
        nodes.push({
          id: n.id,
          type: 'flowCard',
          parentId: n.containerNodeId ?? undefined,
          extent: n.containerNodeId ? 'parent' : undefined,
          position: {x: n.positionX, y: n.positionY},
          style: {width: n.width},
          selected: n.id === selectedNodeId,
          data: {node: n},
        });
      }
    }

    const visibleIds = new Set(nodes.map(n => n.id));
    const edges: Edge[] = detail.edges
      .filter(
        e => visibleIds.has(e.sourceNodeId) && visibleIds.has(e.targetNodeId),
      )
      .map(e => {
        const stroke =
          e.kind === 'pass'
            ? '#10b981'
            : e.kind === 'fail'
              ? '#f43f5e'
              : e.kind === 'dep'
                ? '#06b6d4'
                : '#64748b';
        return {
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          label: e.label || undefined,
          animated: e.kind === 'pass' || e.kind === 'fail',
          style: {
            stroke,
            strokeWidth: e.kind === 'fail' ? 1.8 : 2,
            strokeDasharray: e.kind === 'fail' ? '5 4' : undefined,
          },
          markerEnd: {type: MarkerType.ArrowClosed, color: stroke},
        };
      });

    return {nodes, edges};
  }, [detail, selectedNodeId, handleToggleCollapse]);

  const selectedNode = useMemo(
    () =>
      detail?.nodes.find(n => n.id === selectedNodeId) ??
      detail?.nodes[1] ??
      null,
    [detail, selectedNodeId],
  );

  if (!detail) {
    return (
      <div style={{padding: 24}}>
        <div className="card">
          <h3 className="card-title">No Active Change Selected</h3>
          <p className="card-subtitle">
            Create or select a Change in Federation Hub & DDD Studio to inspect
            its synchronized WBS and Twin-Graph canvas.
          </p>
        </div>
      </div>
    );
  }

  const rootWbsNodes = detail.nodes.filter(n => n.containerNodeId === null);

  return (
    <div className="workstation-layout">
      {/* Left Pane: Synchronized Hierarchical WBS Tree */}
      <aside className="ws-wbs-pane">
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div className="form-label">Active Change</div>
          <select
            className="select"
            value={detail.change.id}
            onChange={e => onSelectChange(e.target.value)}
          >
            {snapshot.changes.map(c => (
              <option key={c.id} value={c.id}>
                {c.code}: {c.title} ({c.status})
              </option>
            ))}
          </select>
        </div>

        <div className="pane-scroll">
          <div className="form-label" style={{marginBottom: 8}}>
            Synchronized WBS Hierarchy
          </div>
          {rootWbsNodes.map(item => {
            const nested = detail.nodes.filter(
              c => c.containerNodeId === item.id,
            );
            return (
              <div key={item.id} style={{marginBottom: 6}}>
                <div
                  onClick={() => setSelectedNodeId(item.id)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background:
                      selectedNode?.id === item.id
                        ? 'rgba(99, 102, 241, 0.2)'
                        : 'rgba(255,255,255,0.02)',
                    border:
                      item.kind === 'ghost'
                        ? '1px dashed var(--accent-violet)'
                        : '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{fontSize: 11.5}}>
                    <strong className="mono">{item.code}</strong> · {item.title}
                  </span>
                  <span className="badge badge-slate">{item.status}</span>
                </div>

                {nested.length > 0 && !item.collapsed && (
                  <div
                    style={{
                      paddingLeft: 14,
                      marginTop: 4,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    {nested.map(sub => (
                      <div
                        key={sub.id}
                        onClick={() => setSelectedNodeId(sub.id)}
                        style={{
                          padding: '5px 8px',
                          borderRadius: 5,
                          cursor: 'pointer',
                          fontSize: 11,
                          background:
                            selectedNode?.id === sub.id
                              ? 'rgba(6, 182, 212, 0.18)'
                              : 'transparent',
                          borderLeft: '2px solid var(--accent-indigo)',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>
                          <strong className="mono">{sub.code}</strong>{' '}
                          {sub.title}
                        </span>
                        <span className="muted">{sub.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Center Pane: Interactive @xyflow/react Living Twin-Graph Canvas */}
      <section className="ws-canvas-pane">
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 12,
            right: 12,
            zIndex: 10,
            display: 'flex',
            justifyContent: 'space-between',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              gap: 8,
              background: 'rgba(11, 15, 23, 0.88)',
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              className="btn btn-emerald btn-sm"
              onClick={async () => {
                await forgeApi.executeChange(detail.change.id);
                await loadDetail();
              }}
            >
              ▶ Run / Resume Continuity Loop
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setGhostBeforeId(selectedNode?.id ?? detail.nodes[2]?.id ?? '');
                setShowGhostForm(v => !v);
              }}
            >
              + Propose GhostNode Amendment
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                const d = await forgeApi.getChangeDiff(detail.change.id);
                setDiffModal(d.patch || d.summary || '(Worktree clean)');
              }}
            >
              Inspect Worktree Diff
            </button>
          </div>

          <div
            style={{
              pointerEvents: 'auto',
              background: 'rgba(11, 15, 23, 0.88)',
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              fontSize: 11.5,
            }}
          >
            <span className="mono">{detail.change.gitBranch}</span> ·{' '}
            <span className="badge badge-indigo">{detail.change.status}</span>
          </div>
        </div>

        {showGhostForm && (
          <div
            className="card"
            style={{
              position: 'absolute',
              top: 54,
              left: 12,
              zIndex: 20,
              width: 360,
              background: 'var(--bg-panel)',
            }}
          >
            <h4 className="card-title" style={{marginBottom: 8}}>
              Splice Runtime GhostNode Amendment
            </h4>
            <div className="form-row">
              <label className="form-label">Insert Before Node</label>
              <select
                className="select"
                value={ghostBeforeId}
                onChange={e => setGhostBeforeId(e.target.value)}
              >
                {detail.nodes
                  .filter(n => n.kind !== 'start')
                  .map(n => (
                    <option key={n.id} value={n.id}>
                      {n.code}: {n.title}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">Amendment Title</label>
              <input
                className="input"
                value={ghostTitle}
                onChange={e => setGhostTitle(e.target.value)}
                placeholder="Migrate schema index before P2 gate"
              />
            </div>
            <div className="form-row">
              <label className="form-label">Rationale & Deliverable</label>
              <textarea
                className="textarea"
                rows={2}
                value={ghostDesc}
                onChange={e => setGhostDesc(e.target.value)}
              />
            </div>
            <div style={{display: 'flex', gap: 6}}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  if (!ghostTitle.trim() || !ghostBeforeId) return;
                  await forgeApi.proposeGhostNode({
                    changeId: detail.change.id,
                    title: ghostTitle,
                    description: ghostDesc || ghostTitle,
                    insertBeforeNodeId: ghostBeforeId,
                  });
                  setGhostTitle('');
                  setGhostDesc('');
                  setShowGhostForm(false);
                  await loadDetail();
                }}
              >
                Splice into DAG
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowGhostForm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {diffModal !== null && (
          <div
            className="card"
            style={{
              position: 'absolute',
              inset: 48,
              zIndex: 30,
              display: 'flex',
              flexDirection: 'column',
              background: '#0b0f17',
            }}
          >
            <div className="card-header">
              <h4 className="card-title">
                Isolated Git Worktree Diff ({detail.change.worktreePath})
              </h4>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDiffModal(null)}
              >
                Close
              </button>
            </div>
            <pre
              className="mono"
              style={{
                flex: 1,
                overflow: 'auto',
                background: '#06090f',
                padding: 12,
                borderRadius: 6,
                fontSize: 11.5,
              }}
            >
              {diffModal}
            </pre>
          </div>
        )}

        <ReactFlow
          nodes={rfNodesAndEdges.nodes}
          edges={rfNodesAndEdges.edges}
          nodeTypes={NODE_TYPES}
          fitView
          onNodeClick={(_, n) => setSelectedNodeId(n.id)}
          colorMode="dark"
        >
          <Background color="#1e293b" gap={20} />
          <Controls />
          <MiniMap
            style={{background: '#0b0f17'}}
            nodeColor="#6366f1"
            maskColor="rgba(0,0,0,0.55)"
          />
        </ReactFlow>
      </section>

      {/* Bottom Bar: Physical Git SHA Checkpoints & Scoped Restore */}
      <footer className="ws-checkpoints-bar">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span className="form-label">
            Physical Git SHA Checkpoints (`refs/forgeops-backup`
            Rescue-Protected Rollback)
          </span>
          <span className="muted" style={{fontSize: 11}}>
            {detail.checkpoints.length} Checkpoint(s) Anchored
          </span>
        </div>

        <div style={{display: 'flex', gap: 10, overflowX: 'auto'}}>
          {detail.checkpoints.map(cp => (
            <div
              key={cp.id}
              style={{
                minWidth: 255,
                padding: '7px 10px',
                borderRadius: 7,
                background: 'var(--bg-card)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div>
                <div style={{fontWeight: 600, fontSize: 11.5}}>{cp.label}</div>
                <div className="mono muted" style={{fontSize: 10.5}}>
                  SHA {cp.gitCommitSha.slice(0, 8)} · {cp.certifiedTaskCount}/
                  {cp.totalTaskCount} tasks
                </div>
                {cp.rescueRef && (
                  <div
                    className="mono"
                    style={{fontSize: 10, color: '#fbbf24'}}
                  >
                    Backup: {cp.rescueRef}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  await forgeApi.restoreToCheckpoint(detail.change.id, cp.id);
                  await loadDetail();
                  await props.onRefreshBootstrap();
                }}
              >
                Restore
              </button>
            </div>
          ))}
          {detail.checkpoints.length === 0 && (
            <div className="muted" style={{fontSize: 11.5}}>
              Start execution to anchor baseline `CP-0` and phase QA Git
              checkpoints.
            </div>
          )}
        </div>
      </footer>

      {/* Right Pane: Node Inspector & Streaming Flow Monitor */}
      <aside className="ws-monitor-pane">
        <div
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div className="form-label">Selected Twin-Graph Node</div>
          {selectedNode ? (
            <>
              <div style={{fontWeight: 700, fontSize: 13, marginTop: 4}}>
                {selectedNode.code}: {selectedNode.title}
              </div>
              <div className="muted" style={{fontSize: 11.5, marginTop: 4}}>
                {selectedNode.description}
              </div>
              <div className="mono muted" style={{fontSize: 11, marginTop: 6}}>
                Kind: {selectedNode.kind} · Attempts:{' '}
                {selectedNode.attemptCount}/{selectedNode.maxAttempts}
              </div>
              {selectedNode.outputSummary && (
                <div
                  className="mono"
                  style={{
                    marginTop: 8,
                    padding: 8,
                    borderRadius: 6,
                    background: '#0a0f18',
                    fontSize: 11,
                    color: '#6ee7b7',
                  }}
                >
                  {selectedNode.outputSummary}
                </div>
              )}
            </>
          ) : (
            <div className="muted">Click a node to inspect.</div>
          )}
        </div>

        <div className="pane-scroll">
          <div className="form-label" style={{marginBottom: 8}}>
            Live Execution Flow Monitor ({detail.sessions.length} Sessions)
          </div>
          {messages.map(m => (
            <div
              key={m.id}
              style={{
                marginBottom: 8,
                padding: '7px 9px',
                borderRadius: 6,
                background: 'var(--bg-card)',
                borderLeft: m.isError
                  ? '3px solid var(--accent-rose)'
                  : m.role === 'assistant'
                    ? '3px solid var(--accent-emerald)'
                    : '3px solid var(--accent-indigo)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10.5,
                  marginBottom: 3,
                }}
              >
                <strong className="mono">{m.role.toUpperCase()}</strong>
                <span className="muted mono">
                  in:{m.inputTokens} cached:{m.cachedTokens} out:
                  {m.outputTokens}
                </span>
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {m.content.slice(0, 600)}
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <div className="muted" style={{fontSize: 11.5}}>
              Session transcripts stream here in real time over SSE.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

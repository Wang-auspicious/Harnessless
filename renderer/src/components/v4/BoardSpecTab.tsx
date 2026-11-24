import {useRef, useState, type MouseEvent, type ReactElement} from 'react';
import type {
  ArtifactPin,
  BoardNodeDoc,
  BoardSceneDoc,
  QuantizationResult,
  SpecIRContract,
} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';

export interface BoardSpecTabProps {
  readonly board: BoardSceneDoc;
  readonly specIR: SpecIRContract;
  readonly quantization: QuantizationResult | null;
  readonly pins: readonly ArtifactPin[];
  readonly busy: boolean;
  readonly onSaveBoard: (nextBoard: BoardSceneDoc) => Promise<void>;
  readonly onCreatePin: (input: {
    readonly surfaceType: 'board' | 'spec_ir';
    readonly anchorJson: string;
    readonly specNodeId?: string;
    readonly promptText: string;
  }) => Promise<void>;
  readonly onResolvePin: (pinId: string, askAgent: boolean) => Promise<void>;
  readonly onRunQuantize: () => Promise<void>;
}

export function BoardSpecTab({
  board,
  specIR,
  quantization,
  pins,
  busy,
  onSaveBoard,
  onCreatePin,
  onResolvePin,
  onRunQuantize,
}: BoardSpecTabProps): ReactElement {
  const [subView, setSubView] = useState<'split' | 'board' | 'spec'>('split');
  const [pinMode, setPinMode] = useState(false);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    readonly nodeId: string;
    readonly offsetX: number;
    readonly offsetY: number;
  } | null>(null);
  const [localNodes, setLocalNodes] = useState<readonly BoardNodeDoc[] | null>(
    null,
  );
  const [pendingPinCoord, setPendingPinCoord] = useState<{
    readonly x: number;
    readonly y: number;
    readonly nodeId?: string;
  } | null>(null);
  const [pinPrompt, setPinPrompt] = useState('');
  const svgRef = useRef<SVGSVGElement | null>(null);

  const nodes = localNodes ?? board.nodes;
  const boardPins = pins.filter(
    p => p.surfaceType === 'board' || p.surfaceType === 'spec_ir',
  );

  const handleAddNode = async (): Promise<void> => {
    const idx = nodes.length + 1;
    const newNode: BoardNodeDoc = {
      id: `node-mod-${Date.now()}`,
      label: `模块 ${idx}`,
      kind: 'module',
      x: 40 + ((idx * 55) % 340),
      y: 35 + ((idx * 45) % 160),
      width: 148,
      height: 58,
      specModuleId: `mod-${idx}`,
      status: 'draft',
      summary: '在白板新增的架构模块边界',
    };
    await onSaveBoard({
      ...board,
      nodes: [...nodes, newNode],
    });
  };

  const getSvgCoords = (
    e: MouseEvent<SVGSVGElement>,
  ): {x: number; y: number} => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {x: 80, y: 80};
    }
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * 580),
      y: Math.round(((e.clientY - rect.top) / rect.height) * 260),
    };
  };

  const handleSvgMouseMove = (e: MouseEvent<SVGSVGElement>): void => {
    if (!dragging) {
      return;
    }
    const pt = getSvgCoords(e);
    setLocalNodes(
      nodes.map(n =>
        n.id === dragging.nodeId
          ? {
              ...n,
              x: Math.max(8, pt.x - dragging.offsetX),
              y: Math.max(8, pt.y - dragging.offsetY),
            }
          : n,
      ),
    );
  };

  const handleSvgMouseUp = async (): Promise<void> => {
    if (!dragging) {
      return;
    }
    const updated = localNodes;
    setDragging(null);
    setLocalNodes(null);
    if (updated) {
      await onSaveBoard({...board, nodes: updated});
    }
  };

  const handleSvgClick = (e: MouseEvent<SVGSVGElement>): void => {
    if (!pinMode) {
      return;
    }
    const pt = getSvgCoords(e);
    setPendingPinCoord(pt);
  };

  const handleNodeClick = async (node: BoardNodeDoc): Promise<void> => {
    if (pinMode) {
      setPendingPinCoord({
        x: node.x + node.width / 2,
        y: node.y + 12,
        nodeId: node.specModuleId,
      });
      return;
    }
    if (connectFromId) {
      if (connectFromId !== node.id) {
        const edge = {
          id: `edge-${Date.now()}`,
          fromNodeId: connectFromId,
          toNodeId: node.id,
          label: 'calls',
        };
        await onSaveBoard({...board, edges: [...board.edges, edge]});
      }
      setConnectFromId(null);
    }
  };

  const handleSubmitPin = async (): Promise<void> => {
    if (!pendingPinCoord || !pinPrompt.trim()) {
      return;
    }
    await onCreatePin({
      surfaceType: 'board',
      anchorJson: JSON.stringify({
        x: pendingPinCoord.x,
        y: pendingPinCoord.y,
      }),
      specNodeId: pendingPinCoord.nodeId,
      promptText: pinPrompt.trim(),
    });
    setPendingPinCoord(null);
    setPinPrompt('');
    setPinMode(false);
  };

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  return (
    <div className="sd-pane">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>白板 × Spec IR 双向共识</h3>
          <p>
            Board Rev {board.revision} · Spec Rev {specIR.revision} · Term{' '}
            {specIR.term}
          </p>
        </div>

        <div className="sd-subtabs">
          <button
            type="button"
            className={subView === 'split' ? 'is-on' : ''}
            onClick={() => setSubView('split')}
          >
            Split
          </button>
          <button
            type="button"
            className={subView === 'board' ? 'is-on' : ''}
            onClick={() => setSubView('board')}
          >
            Board
          </button>
          <button
            type="button"
            className={subView === 'spec' ? 'is-on' : ''}
            onClick={() => setSubView('spec')}
          >
            Spec IR
          </button>
        </div>
      </div>

      {subView !== 'spec' ? (
        <div className="sd-card">
          <div className="sd-card-head">
            <div className="sd-toolbar-row">
              <button
                type="button"
                className="sd-btn"
                disabled={busy}
                onClick={() => void handleAddNode()}
              >
                <CdsIcon name="Add" size="xs" />
                <span>新增模块</span>
              </button>
              <button
                type="button"
                className={`sd-btn ${connectFromId ? 'is-primary' : ''}`}
                disabled={busy || nodes.length < 2}
                onClick={() =>
                  setConnectFromId(prev =>
                    prev ? null : (nodes[0]?.id ?? null),
                  )
                }
              >
                <CdsIcon name="Link" size="xs" />
                <span>{connectFromId ? '点击目标节点连线…' : '连线'}</span>
              </button>
              <button
                type="button"
                className={`sd-btn ${pinMode ? 'is-primary' : ''}`}
                onClick={() => setPinMode(prev => !prev)}
              >
                <CdsIcon name="Pin" size="xs" />
                <span>{pinMode ? '点击画布落点…' : '插评论 Pin'}</span>
              </button>
            </div>
            <span style={{fontSize: 11, color: 'var(--mp-text-muted)'}}>
              拖拽同步 Spec IR
            </span>
          </div>

          <div
            style={{
              background:
                'radial-gradient(color-mix(in srgb, var(--mp-rule-strong) 45%, transparent) 1px, transparent 1px) 0 0 / 16px 16px, var(--mp-page)',
            }}
          >
            <svg
              ref={svgRef}
              className="sd-board-svg"
              viewBox="0 0 580 260"
              preserveAspectRatio="xMinYMin meet"
              style={{display: 'block', width: '100%', height: 250}}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={() => void handleSvgMouseUp()}
              onClick={handleSvgClick}
            >
              <defs>
                <marker
                  id="sd-board-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--mp-text-muted)" />
                </marker>
              </defs>

              {board.edges.map(edge => {
                const from = nodeMap.get(edge.fromNodeId);
                const to = nodeMap.get(edge.toNodeId);
                if (!from || !to) {
                  return null;
                }
                const x1 = from.x + from.width;
                const y1 = from.y + from.height / 2;
                const x2 = to.x;
                const y2 = to.y + to.height / 2;
                return (
                  <g key={edge.id}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="var(--mp-text-muted)"
                      strokeWidth="1.4"
                      markerEnd="url(#sd-board-arrow)"
                    />
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 5}
                      fontSize="10"
                      fill="var(--mp-text-muted)"
                      textAnchor="middle"
                    >
                      {edge.label}
                    </text>
                  </g>
                );
              })}

              {nodes.map(node => (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  style={{cursor: pinMode ? 'crosshair' : 'grab'}}
                  onMouseDown={e => {
                    if (pinMode || connectFromId) {
                      return;
                    }
                    e.stopPropagation();
                    const pt = getSvgCoords(
                      e as unknown as MouseEvent<SVGSVGElement>,
                    );
                    setDragging({
                      nodeId: node.id,
                      offsetX: pt.x - node.x,
                      offsetY: pt.y - node.y,
                    });
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    void handleNodeClick(node);
                  }}
                >
                  <rect
                    width={node.width}
                    height={node.height}
                    rx="8"
                    fill="var(--mp-panel)"
                    stroke={
                      connectFromId === node.id
                        ? 'var(--mp-clay)'
                        : 'var(--mp-rule-strong)'
                    }
                    strokeWidth={connectFromId === node.id ? '2' : '1'}
                  />
                  <text
                    x="10"
                    y="22"
                    fontSize="12"
                    fontWeight="600"
                    fill="var(--mp-text)"
                    stroke="none"
                  >
                    {node.label.slice(0, 18)}
                  </text>
                  <text
                    x="10"
                    y="40"
                    fontSize="10"
                    fill="var(--mp-text-muted)"
                    stroke="none"
                  >
                    {node.kind} · {node.status}
                  </text>
                </g>
              ))}

              {boardPins.map(pin => {
                let cx = 26 + pin.pinNumber * 28;
                let cy = 24;
                try {
                  const parsed = JSON.parse(pin.anchorJson) as {
                    x?: number;
                    y?: number;
                  };
                  if (typeof parsed.x === 'number') cx = parsed.x;
                  if (typeof parsed.y === 'number') cy = parsed.y;
                } catch {
                  // Ignore malformed coordinates.
                }
                const fill =
                  pin.status === 'resolved'
                    ? 'var(--mp-git-added)'
                    : 'var(--mp-clay)';
                return (
                  <g key={pin.id}>
                    <circle cx={cx} cy={cy} r="10" fill={fill} stroke="none" />
                    <text
                      x={cx}
                      y={cy + 3.5}
                      fontSize="10"
                      fontWeight="700"
                      fill="#ffffff"
                      stroke="none"
                      textAnchor="middle"
                    >
                      {pin.pinNumber}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {pendingPinCoord ? (
            <div
              className="sd-card-body"
              style={{borderTop: '1px solid var(--mp-rule)'}}
            >
              <div className="sd-toolbar-row">
                <input
                  type="text"
                  className="sd-input"
                  style={{flex: 1}}
                  value={pinPrompt}
                  onChange={e => setPinPrompt(e.target.value)}
                  placeholder="输入针对该位置的修改建议，发给 Master Agent…"
                />
                <button
                  type="button"
                  className="sd-btn is-primary"
                  disabled={busy || !pinPrompt.trim()}
                  onClick={() => void handleSubmitPin()}
                >
                  发送 Pin
                </button>
                <button
                  type="button"
                  className="sd-btn"
                  onClick={() => setPendingPinCoord(null)}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {boardPins.length > 0 ? (
            <div style={{borderTop: '1px solid var(--mp-rule)'}}>
              {boardPins.map(pin => (
                <div key={pin.id} className="sd-wbs-row">
                  <div className="sd-wbs-top">
                    <div className="sd-wbs-title">
                      <CdsIcon name="Pin" size="xs" />
                      <span>#{pin.pinNumber}</span>
                      <span className="sd-pill">{pin.status}</span>
                      <span style={{fontWeight: 400}}>{pin.promptText}</span>
                    </div>
                    {pin.status !== 'resolved' ? (
                      <div className="sd-toolbar-row">
                        <button
                          type="button"
                          className="sd-btn"
                          disabled={busy}
                          onClick={() => void onResolvePin(pin.id, true)}
                        >
                          Ask Master
                        </button>
                        <button
                          type="button"
                          className="sd-btn is-ink"
                          disabled={busy}
                          onClick={() => void onResolvePin(pin.id, false)}
                        >
                          Resolve
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {pin.replyText ? (
                    <p className="sd-wbs-desc">Agent 回复: {pin.replyText}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {subView !== 'board' ? (
        <>
          <div className="sd-card">
            <div className="sd-card-head">
              <span>Kano Better-Worse × AHP 量化权重表</span>
              <div className="sd-toolbar-row">
                {quantization ? (
                  <span
                    className={`sd-pill ${quantization.passed ? 'is-success' : 'is-danger'}`}
                  >
                    CR = {quantization.cr.toFixed(4)}{' '}
                    {quantization.passed ? '< 0.10' : '>= 0.10'}
                  </span>
                ) : (
                  <span className="sd-pill">未校验</span>
                )}
                <button
                  type="button"
                  className="sd-btn"
                  disabled={busy}
                  onClick={() => void onRunQuantize()}
                >
                  执行量化校验
                </button>
              </div>
            </div>

            {quantization && quantization.items.length > 0 ? (
              <div>
                <p
                  style={{
                    margin: 0,
                    padding: '8px 12px',
                    fontSize: 12,
                    color: 'var(--mp-text-muted)',
                  }}
                >
                  {quantization.diagnostic}
                </p>
                <table className="sd-table">
                  <thead>
                    <tr>
                      <th>需求项</th>
                      <th>Kano</th>
                      <th>Better / Worse</th>
                      <th>AHP 权重</th>
                      <th>优先级</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quantization.items.map(item => (
                      <tr key={item.reqId}>
                        <td>{item.title}</td>
                        <td>
                          <span
                            className="sd-pill"
                            style={{fontFamily: 'var(--mp-font-mono)'}}
                          >
                            {item.kanoCategory}
                          </span>
                        </td>
                        <td style={{fontFamily: 'var(--mp-font-mono)'}}>
                          +{item.betterSI.toFixed(2)} /{' '}
                          {item.worseDSI.toFixed(2)}
                        </td>
                        <td>{(item.ahpWeight * 100).toFixed(1)}%</td>
                        <td>{item.priorityBucket}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mp-inspector-empty">
                点击「执行量化校验」计算 Kano Better-Worse 系数与 AHP CR。
              </p>
            )}
          </div>

          <div className="sd-card">
            <div className="sd-card-head">
              <span>Spec IR 理解回放与模块 I/O 边界契约</span>
              <span className="sd-pill">{specIR.status}</span>
            </div>

            <div
              className="sd-card-body sd-spec-doc"
              style={{display: 'flex', flexDirection: 'column', gap: 12}}
            >
              {specIR.goals.length > 0 ? (
                <div>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: 'var(--mp-text-muted)',
                      marginBottom: 4,
                    }}
                  >
                    目标 (Goals)
                  </div>
                  <ul style={{margin: 0, paddingLeft: 18}}>
                    {specIR.goals.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {specIR.settledDecisions.length > 0 ? (
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                  {specIR.settledDecisions.map(d => (
                    <span key={d.decisionId} className="sd-pill is-success">
                      <CdsIcon name="Check" size="xs" />
                      <span>
                        #{d.logSeq} {d.summary}
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}

              {specIR.modules.map(mod => (
                <div key={mod.moduleId} className="sd-card">
                  <div className="sd-card-head">
                    <span>{mod.title}</span>
                    <div className="sd-toolbar-row">
                      {mod.allowedPaths.map(p => (
                        <span
                          key={p}
                          className="sd-pill"
                          style={{fontFamily: 'var(--mp-font-mono)'}}
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="sd-card-body">
                    <pre
                      style={{
                        fontFamily: 'var(--mp-font-mono)',
                        fontSize: 12,
                        lineHeight: '18px',
                      }}
                    >
                      {mod.boundaryPseudocode}
                    </pre>
                    {mod.verificationChecks.length > 0 ? (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 11.5,
                          color: 'var(--mp-text-muted)',
                        }}
                      >
                        验收校验: {mod.verificationChecks.join(' | ')}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

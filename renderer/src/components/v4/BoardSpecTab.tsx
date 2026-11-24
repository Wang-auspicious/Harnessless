import {useRef, useState, type MouseEvent, type ReactElement} from 'react';
import type {
  ArtifactPin,
  BoardNodeDoc,
  BoardSceneDoc,
  QuantizationResult,
  SpecIRContract,
} from '../../api/v4-types.ts';

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
      width: 146,
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
    if (!rect) {
      return {x: 80, y: 80};
    }
    return {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
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
    <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
      <div className="cds-toolbar">
        <div>
          <h3 className="cds-card-title">白板 × Spec IR 双向共识</h3>
          <p className="cds-card-sub">
            Board Rev {board.revision} · Spec Rev {specIR.revision} · Term{' '}
            {specIR.term}
          </p>
        </div>
        <div className="cds-toolbar-group">
          <button
            type="button"
            className={`cds-btn is-sm ${subView === 'split' ? 'is-primary' : ''}`}
            onClick={() => setSubView('split')}
          >
            上下联动
          </button>
          <button
            type="button"
            className={`cds-btn is-sm ${subView === 'board' ? 'is-primary' : ''}`}
            onClick={() => setSubView('board')}
          >
            仅白板
          </button>
          <button
            type="button"
            className={`cds-btn is-sm ${subView === 'spec' ? 'is-primary' : ''}`}
            onClick={() => setSubView('spec')}
          >
            仅 Spec IR
          </button>
        </div>
      </div>

      {subView !== 'spec' ? (
        <div className="cds-card">
          <div className="cds-toolbar">
            <div className="cds-toolbar-group">
              <button
                type="button"
                className="cds-btn is-sm"
                disabled={busy}
                onClick={() => void handleAddNode()}
              >
                + 添加模块节点
              </button>
              <button
                type="button"
                className={`cds-btn is-sm ${connectFromId ? 'is-clay' : ''}`}
                disabled={busy || nodes.length < 2}
                onClick={() =>
                  setConnectFromId(prev =>
                    prev ? null : (nodes[0]?.id ?? null),
                  )
                }
              >
                {connectFromId ? '点击目标节点连线...' : '连接模块箭头'}
              </button>
              <button
                type="button"
                className={`cds-btn is-sm ${pinMode ? 'is-clay' : ''}`}
                onClick={() => setPinMode(prev => !prev)}
              >
                {pinMode ? '点击画布落点插 Pin' : '插评论 Pin → Master'}
              </button>
            </div>
            <span style={{fontSize: 11, color: 'var(--cds-text-muted)'}}>
              拖拽节点即时同步 Spec IR
            </span>
          </div>

          <div className="cds-board-canvas-wrap">
            <svg
              ref={svgRef}
              className="cds-board-svg"
              onMouseMove={handleSvgMouseMove}
              onMouseUp={() => void handleSvgMouseUp()}
              onClick={handleSvgClick}
            >
              <defs>
                <marker
                  id="cds-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--cds-text-muted)" />
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
                      stroke="var(--cds-text-muted)"
                      strokeWidth="1.4"
                      markerEnd="url(#cds-arrow)"
                    />
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 5}
                      fontSize="10"
                      fill="var(--cds-text-muted)"
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
                    fill="var(--cds-panel)"
                    stroke={
                      connectFromId === node.id
                        ? 'var(--cds-clay)'
                        : 'var(--cds-rule-strong)'
                    }
                    strokeWidth={connectFromId === node.id ? '2' : '1'}
                  />
                  <text
                    x="10"
                    y="22"
                    fontSize="12"
                    fontWeight="600"
                    fill="var(--cds-text)"
                  >
                    {node.label.slice(0, 18)}
                  </text>
                  <text
                    x="10"
                    y="40"
                    fontSize="10"
                    fill="var(--cds-text-muted)"
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
                  // Use fallback coordinates.
                }
                const fill =
                  pin.status === 'resolved'
                    ? 'var(--cds-success)'
                    : 'var(--cds-clay)';
                return (
                  <g key={pin.id} className="cds-pin-dot">
                    <circle cx={cx} cy={cy} r="10" fill={fill} />
                    <text
                      x={cx}
                      y={cy + 3.5}
                      fontSize="10"
                      fontWeight="700"
                      fill="#ffffff"
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
            <div className="cds-toolbar">
              <input
                type="text"
                className="cds-input"
                style={{flex: 1}}
                value={pinPrompt}
                onChange={e => setPinPrompt(e.target.value)}
                placeholder="输入针对该位置的质疑或修改要求，发给 Master Agent..."
              />
              <button
                type="button"
                className="cds-btn is-sm is-clay"
                disabled={busy || !pinPrompt.trim()}
                onClick={() => void handleSubmitPin()}
              >
                发送 Pin
              </button>
              <button
                type="button"
                className="cds-btn is-sm"
                onClick={() => setPendingPinCoord(null)}
              >
                取消
              </button>
            </div>
          ) : null}

          {boardPins.length > 0 ? (
            <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
              {boardPins.map(pin => (
                <div key={pin.id} className="cds-collab-strip">
                  <div style={{minWidth: 0, flex: 1}}>
                    <strong>#{pin.pinNumber}</strong>{' '}
                    <span className="cds-stage-pill">{pin.status}</span>{' '}
                    <span>{pin.promptText}</span>
                    {pin.replyText ? (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'var(--cds-text-muted)',
                          marginTop: 3,
                        }}
                      >
                        Agent 回复: {pin.replyText}
                      </div>
                    ) : null}
                  </div>
                  {pin.status !== 'resolved' ? (
                    <div className="cds-toolbar-group">
                      <button
                        type="button"
                        className="cds-btn is-sm"
                        disabled={busy}
                        onClick={() => void onResolvePin(pin.id, true)}
                      >
                        Ask Master
                      </button>
                      <button
                        type="button"
                        className="cds-btn is-sm is-primary"
                        disabled={busy}
                        onClick={() => void onResolvePin(pin.id, false)}
                      >
                        Resolve
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {subView !== 'board' ? (
        <>
          <div className="cds-card">
            <div className="cds-card-head">
              <h4 className="cds-card-title">
                Kano Better-Worse × AHP 量化权重表
              </h4>
              <div className="cds-toolbar-group">
                {quantization ? (
                  <span
                    className={`cds-stage-pill ${quantization.passed ? 'is-success' : 'is-danger'}`}
                  >
                    CR = {quantization.cr.toFixed(4)}{' '}
                    {quantization.passed ? '< 0.10 通过' : '>= 0.10 冲突'}
                  </span>
                ) : (
                  <span className="cds-stage-pill">未校验</span>
                )}
                <button
                  type="button"
                  className="cds-btn is-sm"
                  disabled={busy}
                  onClick={() => void onRunQuantize()}
                >
                  执行量化校验
                </button>
              </div>
            </div>

            {quantization && quantization.items.length > 0 ? (
              <>
                <p className="cds-card-sub">{quantization.diagnostic}</p>
                <table className="cds-table">
                  <thead>
                    <tr>
                      <th>需求项</th>
                      <th>Kano</th>
                      <th>Better / Worse</th>
                      <th>AHP 权重</th>
                      <th>优先级桶</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quantization.items.map(item => (
                      <tr key={item.reqId}>
                        <td>{item.title}</td>
                        <td>
                          <span className="cds-mono-chip">
                            {item.kanoCategory}
                          </span>
                        </td>
                        <td>
                          +{item.betterSI.toFixed(2)} /{' '}
                          {item.worseDSI.toFixed(2)}
                        </td>
                        <td>{(item.ahpWeight * 100).toFixed(1)}%</td>
                        <td>{item.priorityBucket}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="cds-card-sub">
                点击「执行量化校验」计算 Kano Better-Worse 系数与 AHP 一致性比率
                CR。
              </p>
            )}
          </div>

          <div className="cds-card">
            <div className="cds-card-head">
              <h4 className="cds-card-title">
                Spec IR 理解回放与模块伪代码 I/O 边界契约
              </h4>
              <span className="cds-stage-pill">{specIR.status}</span>
            </div>

            {specIR.goals.length > 0 ? (
              <div>
                <div className="cds-buzz-k" style={{marginBottom: 4}}>
                  目标 (Goals)
                </div>
                <ul style={{margin: 0, paddingLeft: 18, fontSize: 12.5}}>
                  {specIR.goals.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {specIR.settledDecisions.length > 0 ? (
              <div>
                <div className="cds-buzz-k" style={{marginBottom: 4}}>
                  Settled 共识决策
                </div>
                <div className="mp-decision-settled">
                  {specIR.settledDecisions.map(d => (
                    <span key={d.decisionId} className="mp-settled-chip">
                      #{d.logSeq} {d.summary}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {specIR.modules.map(mod => (
              <div key={mod.moduleId} className="cds-card is-subtle">
                <div className="cds-card-head">
                  <strong style={{fontSize: 12.5}}>{mod.title}</strong>
                  <div className="cds-toolbar-group">
                    {mod.allowedPaths.map(p => (
                      <span key={p} className="cds-mono-chip">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                <pre className="cds-pre">{mod.boundaryPseudocode}</pre>
                {mod.verificationChecks.length > 0 ? (
                  <div style={{fontSize: 11.5, color: 'var(--cds-text-muted)'}}>
                    验收校验: {mod.verificationChecks.join(' | ')}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

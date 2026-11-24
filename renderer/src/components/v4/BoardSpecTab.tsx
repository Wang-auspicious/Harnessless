import {useState, type ReactElement} from 'react';
import type {
  ArtifactPin,
  BoardSceneDoc,
  QuantizationResult,
  SpecIRContract,
} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';
import {ExcalidrawBoard} from './ExcalidrawBoard.tsx';

export interface BoardSpecTabProps {
  readonly sessionId: string;
  readonly board: BoardSceneDoc;
  readonly specIR: SpecIRContract;
  readonly quantization: QuantizationResult | null;
  readonly pins: readonly ArtifactPin[];
  readonly theme: 'light' | 'dark';
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
  sessionId,
  board,
  specIR,
  quantization,
  pins,
  theme,
  busy,
  onSaveBoard,
  onCreatePin,
  onResolvePin,
  onRunQuantize,
}: BoardSpecTabProps): ReactElement {
  const [subView, setSubView] = useState<'board' | 'split' | 'spec'>('board');

  const openPins = pins.filter(
    p =>
      (p.surfaceType === 'board' || p.surfaceType === 'spec_ir') &&
      p.status !== 'resolved',
  );

  return (
    <div
      className={`sd-pane ${subView === 'board' ? 'sd-pane-fullboard' : ''}`}
    >
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>架构白板 × Spec 实时共识</h3>
          <p>
            Board Rev {board.revision} · Spec Rev {specIR.revision} · Term{' '}
            {specIR.term}
            {openPins.length > 0 ? ` · ${openPins.length} open pin(s)` : ''}
          </p>
        </div>

        <div className="sd-toolbar-row">
          <div className="sd-subtabs">
            <button
              type="button"
              className={subView === 'board' ? 'is-on' : ''}
              onClick={() => setSubView('board')}
            >
              Board 画板
            </button>
            <button
              type="button"
              className={subView === 'split' ? 'is-on' : ''}
              onClick={() => setSubView('split')}
            >
              分屏 Spec
            </button>
            <button
              type="button"
              className={subView === 'spec' ? 'is-on' : ''}
              onClick={() => setSubView('spec')}
            >
              Spec IR &amp; Kano
            </button>
          </div>
        </div>
      </div>

      {subView !== 'spec' ? (
        <ExcalidrawBoard
          sessionId={sessionId}
          board={board}
          pins={pins}
          theme={theme}
          busy={busy}
          onSaveBoard={onSaveBoard}
          onCreatePin={input => onCreatePin(input)}
          onResolvePin={onResolvePin}
        />
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

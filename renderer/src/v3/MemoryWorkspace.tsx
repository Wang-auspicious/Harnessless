import {useCallback, useEffect, useState, type ReactElement} from 'react';
import type {FederationHub} from '../../../src/shared/types.ts';
import type {
  ExecutionMode,
  MemoryEntityRecord,
  MemoryEdgeRecord,
  MemoryLivingDocRecord,
  MemoryObservationRecord,
  MemoryRecallHit,
  MemoryReflectResult,
} from '../../../src/shared/v3-types.ts';
import {forgeApi} from '../api/client.ts';
import type {UiLang} from '../i18n.ts';

function label(lang: UiLang, zh: string, en: string): string {
  return lang === 'ZH' ? zh : en;
}

export function MemoryWorkspace(props: {
  readonly lang: UiLang;
  readonly activeHub: FederationHub | null;
  readonly onRefreshBootstrap: () => Promise<void> | void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {lang, activeHub, onRefreshBootstrap, onError} = props;
  const hubId = activeHub?.id ?? '';

  const [mode, setMode] = useState<ExecutionMode>('simulation');
  const [subTab, setSubTab] = useState<
    'recall' | 'reflect' | 'docs' | 'observations' | 'graph'
  >('recall');
  const [query, setQuery] = useState('SettlementVoucher 幂等 校验');
  const [includeRejected, setIncludeRejected] = useState(true);
  const [hits, setHits] = useState<readonly MemoryRecallHit[]>([]);
  const [embeddingSpace, setEmbeddingSpace] = useState('');
  const [question, setQuestion] = useState(
    '为什么之前有些设计方案被否决？当前架构有哪些必须遵守的约定？',
  );
  const [reflectResult, setReflectResult] =
    useState<MemoryReflectResult | null>(null);
  const [livingDocs, setLivingDocs] = useState<
    readonly MemoryLivingDocRecord[]
  >([]);
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [observations, setObservations] = useState<
    readonly MemoryObservationRecord[]
  >([]);
  const [entities, setEntities] = useState<readonly MemoryEntityRecord[]>([]);
  const [edges, setEdges] = useState<readonly MemoryEdgeRecord[]>([]);
  const [retainText, setRetainText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSnapshotData = useCallback(async (): Promise<void> => {
    if (!hubId) {
      return;
    }
    try {
      const [docs, obs, graph] = await Promise.all([
        forgeApi.listLivingDocs(hubId, mode),
        forgeApi.listMemoryObservations(hubId, mode, true),
        forgeApi.getMemoryGraph(hubId, mode),
      ]);
      setLivingDocs(docs);
      if (docs.length > 0 && !docs.some(d => d.id === selectedDocId)) {
        setSelectedDocId(docs[0]!.id);
      }
      setObservations(obs);
      setEntities(graph.entities);
      setEdges(graph.edges);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [hubId, mode, onError, selectedDocId]);

  useEffect(() => {
    void loadSnapshotData();
  }, [loadSnapshotData]);

  const runRecall = async (): Promise<void> => {
    if (!hubId || !query.trim()) {
      return;
    }
    setBusy(true);
    try {
      const res = await forgeApi.recallMemory({
        hubId,
        executionMode: mode,
        query: query.trim(),
        limit: 12,
        includeRejected,
      });
      setHits(res.hits);
      setEmbeddingSpace(res.embeddingSpace);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runReflect = async (): Promise<void> => {
    if (!hubId || !question.trim()) {
      return;
    }
    setBusy(true);
    try {
      const res = await forgeApi.reflectMemory({
        hubId,
        executionMode: mode,
        question: question.trim(),
        limit: 10,
      });
      setReflectResult(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runRetain = async (): Promise<void> => {
    if (!hubId || !retainText.trim()) {
      return;
    }
    setBusy(true);
    try {
      await forgeApi.retainMemory({
        hubId,
        executionMode: mode,
        sourceType: 'human_note',
        rawText: retainText.trim(),
        authorityTier: 'L2_verified',
      });
      setRetainText('');
      setNotice(
        label(
          lang,
          '已写入 Hindsight 记忆账本并触发事实提取。',
          'Retained into Hindsight ledger cleanly.',
        ),
      );
      await loadSnapshotData();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runDream = async (): Promise<void> => {
    setBusy(true);
    try {
      const report = await forgeApi.runSleepConsolidation();
      setNotice(
        label(
          lang,
          `睡眠整合完成：提取教训 ${report.extractedPitfalls} 条，替代漂移记忆 ${report.supersededDriftedMemories} 条，刷新唤醒胶囊 ${report.capsulesRefreshed} 份。`,
          `Dream consolidation done: +${report.extractedPitfalls} pitfalls, ${report.supersededDriftedMemories} superseded, ${report.capsulesRefreshed} capsules refreshed.`,
        ),
      );
      await loadSnapshotData();
      await onRefreshBootstrap();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const activeDoc =
    livingDocs.find(d => d.id === selectedDocId) ?? livingDocs[0] ?? null;

  return (
    <div className="v3-canvas">
      <div
        className="v3-card"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{margin: 0, fontSize: 19, fontWeight: 750}}>
            {label(lang, 'Hindsight 结构化工程记忆库', 'Hindsight Memory Bank')}
          </h1>
          <div style={{fontSize: 12.5, color: 'var(--v3-sub)', marginTop: 4}}>
            {label(
              lang,
              '四通道 RRF 检索（FTS + Vector + Entity Graph + Temporal）· 严格隔离 Live 与 Simulation 记忆命名空间。',
              '4-channel RRF recall & reflect with strict Live vs Simulation namespace isolation.',
            )}
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
          <button
            type="button"
            className={`v3-btn ${mode === 'simulation' ? 'v3-btn-primary' : ''}`}
            onClick={() => setMode('simulation')}
          >
            Simulation ({observations.length})
          </button>
          <button
            type="button"
            className={`v3-btn ${mode === 'live' ? 'v3-btn-indigo' : ''}`}
            onClick={() => setMode('live')}
          >
            Live
          </button>
          <button
            type="button"
            className="v3-btn"
            disabled={busy}
            onClick={() => {
              void runDream();
            }}
          >
            {label(lang, '执行睡眠记忆整合', 'Run Sleep Consolidation')}
          </button>
        </div>
      </div>

      {notice && <div className="v3-banner-ok">{notice}</div>}

      <div className="v3-subtabs">
        {(
          [
            ['recall', label(lang, '四通道检索 Recall', 'Recall (4-Channel)')],
            [
              'reflect',
              label(lang, '有据推演 Reflect', 'Reflect (Grounded Q&A)'),
            ],
            [
              'docs',
              `${label(lang, '活文档 Living Docs', 'Living Docs')} (${livingDocs.length})`,
            ],
            [
              'observations',
              `${label(lang, '认知观察 Observations', 'Observations')} (${observations.length})`,
            ],
            [
              'graph',
              `${label(lang, '实体图谱 Graph', 'Entity Graph')} (${entities.length}/${edges.length})`,
            ],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            className={`v3-subtab ${subTab === id ? 'active' : ''}`}
            onClick={() => setSubTab(id)}
          >
            {text}
          </button>
        ))}
      </div>

      {subTab === 'recall' && (
        <div
          className="v3-card"
          style={{display: 'flex', flexDirection: 'column', gap: 14}}
        >
          <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
            <input
              className="v3-input"
              style={{flex: 1, minWidth: 260}}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  void runRecall();
                }
              }}
              placeholder={label(
                lang,
                '输入中英文关键词或问题…',
                'Search engineering memories…',
              )}
            />
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12.5,
              }}
            >
              <input
                type="checkbox"
                checked={includeRejected}
                onChange={e => setIncludeRejected(e.target.checked)}
              />
              {label(lang, '含已否决方案警告', 'Include Rejected Options')}
            </label>
            <button
              type="button"
              className="v3-btn v3-btn-primary"
              disabled={busy}
              onClick={() => {
                void runRecall();
              }}
            >
              {label(lang, '立即检索', 'Search Memory')}
            </button>
          </div>

          {embeddingSpace && (
            <div
              className="v3-mono"
              style={{fontSize: 11.5, color: 'var(--v3-muted)'}}
            >
              embeddingSpace={embeddingSpace} · hits={hits.length}
            </div>
          )}

          {hits.length === 0 ? (
            <div
              className="v3-card-warm"
              style={{color: 'var(--v3-sub)', fontSize: 13}}
            >
              {label(
                lang,
                '点击“立即检索”查看命中结果；或切换到不同运行模式 / 先运行一次 Demo 任务沉淀记忆。',
                'Click "Search Memory" to query recalled facts, observations, and source excerpts.',
              )}
            </div>
          ) : (
            <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
              {hits.map(hit => (
                <div
                  key={`${hit.targetKind}:${hit.targetId}`}
                  className="v3-card-warm"
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginBottom: 6,
                    }}
                  >
                    <div style={{fontWeight: 700, fontSize: 13.5}}>
                      {hit.title}
                    </div>
                    <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                      <span className="v3-pill v3-pill-indigo">
                        {hit.authorityTier}
                      </span>
                      <span className="v3-pill">{hit.kind}</span>
                      {hit.channelsMatched.map(ch => (
                        <span key={ch} className="v3-pill v3-pill-accent">
                          {ch}
                        </span>
                      ))}
                      <span className="v3-pill v3-mono">
                        score={hit.score.toFixed(3)}
                      </span>
                    </div>
                  </div>
                  {hit.rejectedWarning && (
                    <div className="v3-banner-error" style={{marginBottom: 8}}>
                      <strong>REJECTED WARNING:</strong> {hit.rejectedWarning}
                    </div>
                  )}
                  <div style={{fontSize: 13, lineHeight: 1.55}}>
                    {hit.content}
                  </div>
                  {hit.sourceChunkExcerpt && (
                    <div
                      className="v3-pre"
                      style={{marginTop: 8, fontSize: 11.5}}
                    >
                      Source Chunk: {hit.sourceChunkExcerpt}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Quick Retain Note */}
          <div
            style={{borderTop: '1px solid var(--v3-border)', paddingTop: 12}}
          >
            <div style={{fontSize: 12.5, fontWeight: 700, marginBottom: 6}}>
              {label(
                lang,
                '手工沉淀一条 L2 验证记忆（遵守无环记忆法则）',
                'Retain Verified Note (L2_verified)',
              )}
            </div>
            <div style={{display: 'flex', gap: 8}}>
              <input
                className="v3-input"
                style={{flex: 1}}
                value={retainText}
                onChange={e => setRetainText(e.target.value)}
                placeholder={label(
                  lang,
                  '例如：结算服务禁止直接修改核心账本分录表，须通过 SettlementVoucher。',
                  'e.g. Never mutate ledger_entries directly; emit SettlementVoucher events instead.',
                )}
              />
              <button
                type="button"
                className="v3-btn"
                disabled={busy || !retainText.trim()}
                onClick={() => {
                  void runRetain();
                }}
              >
                {label(lang, '写入记忆', 'Retain')}
              </button>
            </div>
          </div>
        </div>
      )}

      {subTab === 'reflect' && (
        <div
          className="v3-card"
          style={{display: 'flex', flexDirection: 'column', gap: 12}}
        >
          <div style={{display: 'flex', gap: 8}}>
            <input
              className="v3-input"
              style={{flex: 1}}
              value={question}
              onChange={e => setQuestion(e.target.value)}
            />
            <button
              type="button"
              className="v3-btn v3-btn-primary"
              disabled={busy}
              onClick={() => {
                void runReflect();
              }}
            >
              {label(lang, '基于证据链推演', 'Reflect with Citations')}
            </button>
          </div>
          {reflectResult && (
            <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
              <pre className="v3-pre">{reflectResult.answerMarkdown}</pre>
              <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                <span className="v3-pill v3-pill-green">
                  Confirmed: {reflectResult.confirmedFacts.length}
                </span>
                <span className="v3-pill v3-pill-indigo">
                  Inferences: {reflectResult.inferences.length}
                </span>
                <span className="v3-pill v3-pill-amber">
                  Contradictions: {reflectResult.contradictions.length}
                </span>
                <span className="v3-pill">
                  Obs Citations: {reflectResult.citedObservationIds.length}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'docs' && (
        <div className="v3-grid-2">
          <div
            className="v3-card"
            style={{display: 'flex', flexDirection: 'column', gap: 8}}
          >
            <div style={{fontWeight: 700, fontSize: 13.5}}>
              {label(lang, '5 类全自动维基活文档', 'Standing Living Documents')}
            </div>
            {livingDocs.length === 0 ? (
              <div style={{color: 'var(--v3-muted)', fontSize: 12.5}}>
                {label(
                  lang,
                  '暂无活文档，可执行睡眠巩固生成。',
                  'No living docs yet — run sleep consolidation.',
                )}
              </div>
            ) : (
              livingDocs.map(doc => (
                <button
                  key={doc.id}
                  type="button"
                  className={`v3-mission-item ${activeDoc?.id === doc.id ? 'active' : ''}`}
                  onClick={() => setSelectedDocId(doc.id)}
                >
                  <div className="v3-mission-item-top">
                    <span
                      className="v3-mono"
                      style={{fontSize: 11.5, fontWeight: 700}}
                    >
                      {doc.docKind}
                    </span>
                    <span
                      className={`v3-pill ${doc.stale ? 'v3-pill-amber' : 'v3-pill-green'}`}
                    >
                      v{doc.version} {doc.stale ? '· stale' : '· fresh'}
                    </span>
                  </div>
                  <div style={{fontWeight: 650, fontSize: 13}}>{doc.title}</div>
                </button>
              ))
            )}
          </div>
          <div className="v3-card">
            {activeDoc ? (
              <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                <div style={{fontWeight: 750, fontSize: 15}}>
                  {activeDoc.title}
                </div>
                <div style={{fontSize: 12.5, color: 'var(--v3-sub)'}}>
                  {activeDoc.standingQuestion}
                </div>
                <pre className="v3-pre">{activeDoc.contentMarkdown}</pre>
              </div>
            ) : (
              <div style={{color: 'var(--v3-muted)', fontSize: 13}}>
                {label(lang, '请选择左侧文档。', 'Select a living document.')}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'observations' && (
        <div
          className="v3-card"
          style={{display: 'flex', flexDirection: 'column', gap: 10}}
        >
          {observations.length === 0 ? (
            <div style={{color: 'var(--v3-muted)', fontSize: 13}}>
              {label(
                lang,
                '当前模式下尚无整合后的观察信念。',
                'No consolidated observations in this mode yet.',
              )}
            </div>
          ) : (
            observations.map(obs => (
              <div key={obs.id} className="v3-card-warm">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{fontWeight: 700}}>{obs.title}</span>
                  <div style={{display: 'flex', gap: 6}}>
                    <span className="v3-pill v3-pill-indigo">
                      {obs.authorityTier}
                    </span>
                    <span className="v3-pill">{obs.beliefStatus}</span>
                    {obs.kind && <span className="v3-pill">{obs.kind}</span>}
                    {obs.staleSuspect && (
                      <span className="v3-pill v3-pill-amber">
                        stale_suspect
                      </span>
                    )}
                  </div>
                </div>
                <div style={{fontSize: 13, marginTop: 6}}>{obs.statement}</div>
                <div
                  className="v3-mono"
                  style={{
                    fontSize: 11.5,
                    color: 'var(--v3-muted)',
                    marginTop: 6,
                  }}
                >
                  subjectKey={obs.subjectKey} · history={obs.history.length} ·
                  facts=
                  {obs.supportingFactIds.length}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'graph' && (
        <div className="v3-grid-2">
          <div className="v3-card">
            <h3 style={{margin: '0 0 10px', fontSize: 14}}>
              Entities ({entities.length})
            </h3>
            <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
              {entities.slice(0, 60).map(ent => (
                <div
                  key={ent.id}
                  className="v3-card-warm"
                  style={{padding: '8px 10px', fontSize: 12.5}}
                >
                  <strong>{ent.displayName}</strong>{' '}
                  <span className="v3-mono" style={{color: 'var(--v3-muted)'}}>
                    ({ent.entityType} · {ent.canonicalKey})
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="v3-card">
            <h3 style={{margin: '0 0 10px', fontSize: 14}}>
              Edges ({edges.length})
            </h3>
            <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
              {edges.slice(0, 60).map(edge => (
                <div
                  key={edge.id}
                  className="v3-card-warm v3-mono"
                  style={{padding: '8px 10px', fontSize: 11.5}}
                >
                  {edge.sourceEntityId} --[{edge.relation}]--&gt;{' '}
                  {edge.targetEntityId} (w={edge.weight.toFixed(2)})
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

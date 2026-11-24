import {useEffect, useMemo, useState, type ReactElement} from 'react';
import type {
  AgentPersonaRecord,
  CollabDocSnapshot,
  SpecIRContract,
} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';

export interface CollabDocPaneProps {
  readonly doc: CollabDocSnapshot | undefined;
  readonly specIR: SpecIRContract;
  readonly agents: readonly AgentPersonaRecord[];
  readonly focusedBlockId?: string | null;
  readonly busy: boolean;
  readonly onSaveBlock: (blockId: string, markdown: string) => Promise<void>;
  readonly onAddComment: (blockId: string, text: string) => Promise<void>;
  readonly onCompileSpec: () => Promise<void>;
  readonly onOpenBoard: () => void;
}

export function CollabDocPane({
  doc,
  specIR,
  agents,
  focusedBlockId,
  busy,
  onSaveBlock,
  onAddComment,
  onCompileSpec,
  onOpenBoard,
}: CollabDocPaneProps): ReactElement {
  const [subView, setSubView] = useState<'prd' | 'spec' | 'history'>('prd');
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState('');
  const [expandedDiffBlock, setExpandedDiffBlock] = useState<string | null>(
    null,
  );
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    if (focusedBlockId) {
      setSubView('prd');
      setExpandedDiffBlock(focusedBlockId);
    }
  }, [focusedBlockId]);

  const contributors = useMemo(() => {
    const map = new Map<
      string,
      {readonly name: string; readonly color: string; readonly count: number}
    >();
    if (!doc) return [];
    for (const blk of doc.blocks) {
      const prev = map.get(blk.lastAuthorId);
      map.set(blk.lastAuthorId, {
        name: blk.lastAuthorName,
        color: blk.lastAuthorColor,
        count: (prev?.count ?? 0) + 1,
      });
    }
    return Array.from(map.entries()).map(([id, v]) => ({id, ...v}));
  }, [doc]);

  if (!doc) {
    return (
      <div className="sd-pane">
        <p className="mp-inspector-empty">
          创建或打开会话后，可在此与多角色智能体实时共编 PRD 并一键转换为 Spec。
        </p>
      </div>
    );
  }

  return (
    <div className="sd-pane" data-testid="v4-collab-doc-pane">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>{doc.title}</h3>
          <p>
            PRD Rev {doc.revision} · Spec Rev {specIR.revision} · 实时多人/多
            Agent 共编追踪
          </p>
        </div>

        <div className="sd-toolbar-row">
          <div className="sd-subtabs">
            <button
              type="button"
              className={subView === 'prd' ? 'is-on' : ''}
              onClick={() => setSubView('prd')}
            >
              PRD 共编文档
            </button>
            <button
              type="button"
              className={subView === 'spec' ? 'is-on' : ''}
              onClick={() => setSubView('spec')}
            >
              结构化 Spec ({specIR.modules.length})
            </button>
            <button
              type="button"
              className={subView === 'history' ? 'is-on' : ''}
              onClick={() => setSubView('history')}
            >
              改动追踪 ({doc.revisions.length})
            </button>
          </div>
        </div>
      </div>

      {/* Collaborator presence & PRD -> Spec action bar */}
      <div className="sd-doc-collab-bar">
        <div className="sd-toolbar-row">
          <span style={{fontSize: 11.5, color: 'var(--mp-text-muted)'}}>
            共编者:
          </span>
          {contributors.map(c => (
            <span key={c.id} className="sd-pill">
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: c.color,
                }}
              />
              <span>{c.name}</span>
            </span>
          ))}
        </div>
        <button
          type="button"
          className="sd-btn is-primary"
          disabled={busy}
          onClick={() => void onCompileSpec().then(() => setSubView('spec'))}
        >
          <CdsIcon name="ArrowRight" size="xs" />
          <span>从 PRD 生成 / 同步 Spec</span>
        </button>
      </div>

      {subView === 'prd' ? (
        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          {doc.blocks.map(block => {
            const isEditing = editingBlockId === block.id;
            const latestRev = doc.revisions.find(r => r.blockId === block.id);
            const showDiff = expandedDiffBlock === block.id && latestRev;

            return (
              <div
                key={block.id}
                className="sd-doc-block"
                style={{borderLeftColor: block.lastAuthorColor}}
              >
                <div className="sd-doc-block-head">
                  <strong style={{fontSize: 13}}>{block.title}</strong>
                  <div className="sd-toolbar-row">
                    <span className="sd-pill" title={block.lastModelLabel}>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: block.lastAuthorColor,
                        }}
                      />
                      <span>
                        {block.lastAuthorName} · Rev {block.revision}
                      </span>
                    </span>
                    {latestRev ? (
                      <button
                        type="button"
                        className="sd-btn"
                        style={{height: 22, fontSize: 11, padding: '0 7px'}}
                        onClick={() =>
                          setExpandedDiffBlock(prev =>
                            prev === block.id ? null : block.id,
                          )
                        }
                      >
                        {showDiff
                          ? '隐藏 Diff'
                          : `对比 (${latestRev.diffSummary})`}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="sd-btn"
                      style={{height: 22, fontSize: 11, padding: '0 7px'}}
                      onClick={() => {
                        if (isEditing) {
                          setEditingBlockId(null);
                        } else {
                          setDraftMarkdown(block.markdown);
                          setEditingBlockId(block.id);
                        }
                      }}
                    >
                      {isEditing ? '取消' : '编辑'}
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <div
                    style={{display: 'flex', flexDirection: 'column', gap: 6}}
                  >
                    <textarea
                      className="sd-doc-editor"
                      value={draftMarkdown}
                      onChange={e => setDraftMarkdown(e.target.value)}
                    />
                    <div
                      className="sd-toolbar-row"
                      style={{justifyContent: 'flex-end'}}
                    >
                      <button
                        type="button"
                        className="sd-btn is-primary"
                        disabled={busy}
                        onClick={() => {
                          void onSaveBlock(block.id, draftMarkdown).then(() =>
                            setEditingBlockId(null),
                          );
                        }}
                      >
                        保存修订并记录作者
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="sd-spec-doc"
                    style={{whiteSpace: 'pre-wrap', fontSize: 12.5}}
                  >
                    {block.markdown}
                  </div>
                )}

                {showDiff && latestRev ? (
                  <div className="sd-doc-diff">
                    <div
                      style={{
                        padding: '4px 8px',
                        borderBottom: '1px solid var(--mp-rule)',
                        fontSize: 11,
                        color: 'var(--mp-text-muted)',
                        fontFamily: 'var(--mp-font-ui)',
                      }}
                    >
                      由 {latestRev.authorName} ({latestRev.modelLabel}) 修改 ·{' '}
                      {latestRev.diffSummary}
                    </div>
                    {latestRev.diffHunks
                      .filter(h => h.kind !== 'context')
                      .slice(0, 12)
                      .map((h, i) => (
                        <div
                          key={i}
                          className={`sd-doc-diff-row ${h.kind === 'add' ? 'is-add' : 'is-del'}`}
                        >
                          <span>{h.kind === 'add' ? '+' : '-'}</span>
                          <span>{h.text}</span>
                        </div>
                      ))}
                  </div>
                ) : null}

                {/* Block inline comments + @agent wake */}
                {block.comments.length > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      paddingTop: 4,
                      borderTop: '1px dashed var(--mp-rule)',
                    }}
                  >
                    {block.comments.map(c => (
                      <div key={c.id} style={{fontSize: 11.5}}>
                        <strong style={{color: c.authorColor}}>
                          {c.authorName}:
                        </strong>{' '}
                        <span style={{color: 'var(--mp-text-secondary)'}}>
                          {c.text}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="sd-toolbar-row" style={{marginTop: 2}}>
                  <input
                    type="text"
                    className="sd-input"
                    style={{flex: 1, height: 25, fontSize: 11.5}}
                    value={commentDrafts[block.id] ?? ''}
                    onChange={e =>
                      setCommentDrafts(prev => ({
                        ...prev,
                        [block.id]: e.target.value,
                      }))
                    }
                    placeholder={`批注本段，可 @${agents[1]?.handle ?? 'pm'} 或 @architect 直接让智能体修改…`}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const txt = (commentDrafts[block.id] ?? '').trim();
                        if (!txt || busy) return;
                        setCommentDrafts(prev => ({...prev, [block.id]: ''}));
                        void onAddComment(block.id, txt);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="sd-btn"
                    style={{height: 25, fontSize: 11.5}}
                    disabled={busy || !(commentDrafts[block.id] ?? '').trim()}
                    onClick={() => {
                      const txt = (commentDrafts[block.id] ?? '').trim();
                      if (!txt) return;
                      setCommentDrafts(prev => ({...prev, [block.id]: ''}));
                      void onAddComment(block.id, txt);
                    }}
                  >
                    发送批注
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {subView === 'spec' ? (
        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          <div className="sd-card">
            <div className="sd-card-head">
              <span>已编译 Spec 目标与边界</span>
              <button type="button" className="sd-btn" onClick={onOpenBoard}>
                打开对应架构白板 →
              </button>
            </div>
            <div className="sd-card-body">
              <strong style={{fontSize: 12, display: 'block', marginBottom: 4}}>
                目标 Goals ({specIR.goals.length})
              </strong>
              <ul style={{margin: '0 0 8px 18px', fontSize: 12.5}}>
                {specIR.goals.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
              <strong style={{fontSize: 12, display: 'block', marginBottom: 4}}>
                模块契约 Modules ({specIR.modules.length})
              </strong>
              {specIR.modules.map(m => (
                <div
                  key={m.moduleId}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--mp-rule)',
                    marginBottom: 6,
                    background: 'var(--mp-panel-subtle)',
                  }}
                >
                  <div className="sd-toolbar-row">
                    <strong style={{fontSize: 12.5}}>{m.title}</strong>
                    <span className="sd-pill">
                      {m.ownerPrincipalIds.join(', ')}
                    </span>
                  </div>
                  <pre
                    style={{
                      margin: '5px 0 0',
                      fontSize: 11.5,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'var(--mp-font-mono)',
                      color: 'var(--mp-text-secondary)',
                    }}
                  >
                    {m.boundaryPseudocode}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {subView === 'history' ? (
        <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
          {doc.revisions.length === 0 ? (
            <p className="mp-inspector-empty">
              暂无变更记录。你或任一智能体修改 PRD
              任意段落后，此处会按时间线记录谁改了什么。
            </p>
          ) : (
            doc.revisions.map(rev => (
              <div key={rev.id} className="sd-card">
                <div className="sd-card-head">
                  <div className="sd-toolbar-row">
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: rev.authorColor,
                      }}
                    />
                    <strong>
                      Rev {rev.revision} · {rev.authorName}
                    </strong>
                    <span className="sd-pill">{rev.blockTitle}</span>
                  </div>
                  <span className="sd-pill">{rev.diffSummary}</span>
                </div>
                <div
                  className="sd-doc-diff"
                  style={{border: 0, borderRadius: 0}}
                >
                  {rev.diffHunks
                    .filter(h => h.kind !== 'context')
                    .slice(0, 8)
                    .map((h, i) => (
                      <div
                        key={i}
                        className={`sd-doc-diff-row ${h.kind === 'add' ? 'is-add' : 'is-del'}`}
                      >
                        <span>{h.kind === 'add' ? '+' : '-'}</span>
                        <span>{h.text}</span>
                      </div>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

import {useEffect, useRef, useState, type ReactElement} from 'react';
import type {
  GrillingCardPayload,
  KernelId,
  MasterChatMessage,
  MasterSession,
  SessionExecutionMode,
  TraceProgressItem,
  WorkspaceTabId,
} from '../../api/v4-types.ts';
import {kernelLabel} from './v4-labels.ts';

export interface MasterChatPaneProps {
  readonly session: MasterSession | null;
  readonly messages: readonly MasterChatMessage[];
  readonly busy: boolean;
  readonly errorText: string | null;
  readonly onDismissError: () => void;
  readonly onDemoRun: () => Promise<void>;
  readonly onOpenFolderPrompt: () => Promise<void>;
  readonly onOpenTab: (tab: WorkspaceTabId) => void;
  readonly onSendTurn: (
    text: string,
    opts?: {
      readonly targetKernel?: KernelId;
      readonly action?:
        'chat' | 'freeze_spec' | 'decompose' | 'execute' | 'ship';
    },
  ) => Promise<void>;
  readonly onSubmitGrilling: (
    messageId: string,
    answers: Readonly<Record<string, string>>,
    acceptRecommended: boolean,
    freezeSpec: boolean,
  ) => Promise<void>;
  readonly onRerunQuantize: () => Promise<void>;
  readonly onToggleExecutionMode: (mode: SessionExecutionMode) => Promise<void>;
}

const MENTION_KERNELS: readonly {
  readonly id: KernelId;
  readonly tag: string;
}[] = [
  {id: 'master', tag: '@master'},
  {id: 'codex', tag: '@codex'},
  {id: 'claude-code', tag: '@claude'},
  {id: 'gemini-cli', tag: '@gemini'},
];

function TracePill({
  items,
  summary,
}: {
  readonly items: readonly TraceProgressItem[];
  readonly summary: string;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const doneCount = items.filter(i => i.status === 'done').length;
  const headline =
    items[items.length - 1] !== undefined
      ? `${items[items.length - 1]!.verb} — ${items[items.length - 1]!.object} — ${items[items.length - 1]!.outcome}`
      : summary;

  return (
    <div className="cds-trace-pill">
      <button
        type="button"
        className="cds-trace-toggle"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span>
          <strong style={{color: 'var(--cds-clay)', marginRight: 6}}>●</strong>
          {headline} ({doneCount}/{items.length})
        </span>
        <span style={{fontSize: 11, color: 'var(--cds-text-muted)'}}>
          {expanded ? '收起轨迹 ▴' : '展开轨迹 ▾'}
        </span>
      </button>
      {expanded ? (
        <div className="cds-trace-body">
          {items.map((item, idx) => (
            <div key={`${item.verb}-${idx}`}>
              [{item.status.toUpperCase()}] {item.verb} · {item.object} →{' '}
              {item.outcome}
              {item.kernelId ? ` (${kernelLabel(item.kernelId)})` : ''}
              {item.detail ? ` — ${item.detail}` : ''}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GrillingCard({
  messageId,
  grilling,
  busy,
  onSubmit,
  onRerunQuantize,
}: {
  readonly messageId: string;
  readonly grilling: GrillingCardPayload;
  readonly busy: boolean;
  readonly onSubmit: (
    messageId: string,
    answers: Readonly<Record<string, string>>,
    acceptRecommended: boolean,
    freezeSpec: boolean,
  ) => Promise<void>;
  readonly onRerunQuantize: () => Promise<void>;
}): ReactElement {
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const q of grilling.questions) {
      initial[q.id] = q.selectedOptionId ?? q.defaultOptionId;
    }
    return initial;
  });
  const [customNotes, setCustomNotes] = useState<Record<string, string>>({});

  const buildAnswers = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const q of grilling.questions) {
      const note = customNotes[q.id]?.trim();
      out[q.id] = note ? note : (selected[q.id] ?? q.defaultOptionId);
    }
    return out;
  };

  return (
    <section className="mp-decision-card" data-testid="v4-grilling-card">
      <div className="mp-decision-heading">
        <span className="mp-decision-eyebrow">
          <span>●</span>
          <span>Round {grilling.round} · 需求澄清与共识拷问</span>
        </span>
        <span className="cds-stage-pill">
          {grilling.resolved
            ? '已采纳冻结'
            : `${grilling.questions.length} 项待确认`}
        </span>
      </div>

      <h3 className="mp-decision-title">{grilling.title}</h3>
      {grilling.summary ? (
        <div className="cds-prose" style={{fontSize: 12.5}}>
          {grilling.summary}
        </div>
      ) : null}

      {grilling.settled.length > 0 ? (
        <div className="mp-decision-settled">
          {grilling.settled.map((item, idx) => (
            <span key={idx} className="mp-settled-chip">
              ✓ {item}
            </span>
          ))}
        </div>
      ) : null}

      {grilling.questions.map((q, idx) => {
        const cur = selected[q.id] ?? q.defaultOptionId;
        return (
          <div key={q.id} className="mp-decision-qblock">
            <p className="mp-decision-question">
              Q{idx + 1}. {q.label}
              {q.isForkQuestion ? (
                <span className="mp-rec-tag" style={{marginLeft: 6}}>
                  关键分叉
                </span>
              ) : null}
            </p>
            <div className="mp-decision-options">
              {q.options.map(opt => {
                const isSel = cur === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={busy || grilling.resolved}
                    className={`mp-decision-option ${isSel ? 'is-selected' : ''}`}
                    onClick={() =>
                      setSelected(prev => ({...prev, [q.id]: opt.id}))
                    }
                  >
                    <span>
                      <strong>{opt.label}</strong>
                      {opt.rationale ? (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 11.5,
                            color: 'var(--cds-text-muted)',
                          }}
                        >
                          {opt.rationale}
                        </span>
                      ) : null}
                    </span>
                    {opt.recommended ? (
                      <span className="mp-rec-tag">Recommended</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              className="mp-decision-custom"
              disabled={busy || grilling.resolved}
              value={customNotes[q.id] ?? ''}
              onChange={e =>
                setCustomNotes(prev => ({...prev, [q.id]: e.target.value}))
              }
              placeholder="或输入你的自定义约束回答..."
            />
          </div>
        );
      })}

      <div className="mp-decision-actions">
        <button
          type="button"
          className="cds-btn is-sm"
          disabled={busy}
          onClick={() => void onRerunQuantize()}
        >
          重跑量化校验 (Kano+AHP)
        </button>
        <div className="cds-toolbar-group">
          <button
            type="button"
            className="cds-btn is-sm"
            disabled={busy || grilling.resolved}
            onClick={() =>
              void onSubmit(messageId, buildAnswers(), false, false)
            }
          >
            提交当前选择
          </button>
          <button
            type="button"
            className="cds-btn is-sm is-primary"
            disabled={busy || grilling.resolved}
            onClick={() => void onSubmit(messageId, buildAnswers(), true, true)}
          >
            按推荐采纳并冻结
          </button>
        </div>
      </div>
    </section>
  );
}

export function MasterChatPane({
  session,
  messages,
  busy,
  errorText,
  onDismissError,
  onDemoRun,
  onOpenFolderPrompt,
  onOpenTab,
  onSendTurn,
  onSubmitGrilling,
  onRerunQuantize,
  onToggleExecutionMode,
}: MasterChatPaneProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [targetKernel, setTargetKernel] = useState<KernelId>('master');
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
  }, [messages.length]);

  const handleSubmit = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (!trimmed || busy) {
      return;
    }
    setDraft('');
    await onSendTurn(trimmed, {targetKernel, action: 'chat'});
  };

  const resolveTab = (raw?: string): WorkspaceTabId => {
    if (
      raw === 'tasks' ||
      raw === 'board' ||
      raw === 'code' ||
      raw === 'verify' ||
      raw === 'kernels' ||
      raw === 'dag'
    ) {
      return raw;
    }
    return 'code';
  };

  const executionMode = session?.executionMode ?? 'auto';

  return (
    <section className="cds-chat-pane" data-testid="v4-master-chat">
      <div className="cds-chat-scroll">
        <div className="cds-chat-measure">
          {errorText ? (
            <div className="cds-banner-error" role="alert">
              <span>{errorText}</span>
              <button
                type="button"
                className="cds-btn is-sm"
                onClick={onDismissError}
              >
                关闭
              </button>
            </div>
          ) : null}

          {!session || messages.length === 0 ? (
            <div className="cds-hero" data-testid="v4-empty-hero">
              <div className="cds-hero-eyebrow">
                <span>●</span>
                <span>SDLC-Studio v4 · Master Agent 协同研发工作台</span>
              </div>
              <h1 className="cds-hero-title">
                把自然语言想法，变成可审计、可并行的真实交付。
              </h1>
              <p className="cds-hero-sub">
                由 Master Agent 统筹需求量化（Kano + AHP）、白板 × Spec IR
                双向共识、独立 Git Worktree 多内核并行执行（Codex / Claude Code
                / Gemini CLI）与三权分立 Ship 独立审校。
              </p>

              <div className="cds-hero-grid">
                <button
                  type="button"
                  className="cds-hero-card is-featured"
                  disabled={busy}
                  onClick={() => void onDemoRun()}
                >
                  <span className="cds-hero-card-title">
                    一键跑通示例项目全流程
                  </span>
                  <span className="cds-hero-card-desc">
                    自动初始化沙箱项目、生成 Spec IR、拆解任务并准备并行交付。
                  </span>
                </button>

                <button
                  type="button"
                  className="cds-hero-card"
                  disabled={busy}
                  onClick={() => void onOpenFolderPrompt()}
                >
                  <span className="cds-hero-card-title">
                    打开项目开始需求构思
                  </span>
                  <span className="cds-hero-card-desc">
                    选择任意本地目录，自动探测代码库并在缺失时执行 git init。
                  </span>
                </button>

                <button
                  type="button"
                  className="cds-hero-card"
                  onClick={() => onOpenTab('kernels')}
                >
                  <span className="cds-hero-card-title">
                    查看已挂载原生 Agent 内核
                  </span>
                  <span className="cds-hero-card-desc">
                    探测本机 Claude Code / Codex / Gemini CLI 并配置角色路由。
                  </span>
                </button>
              </div>
            </div>
          ) : (
            messages.map(msg => {
              if (msg.role === 'human') {
                return (
                  <div key={msg.id} className="cds-msg-human">
                    {msg.content}
                  </div>
                );
              }

              return (
                <article key={msg.id} className="cds-msg-assistant">
                  <div className="cds-msg-header">
                    <span
                      className={`cds-agent-pill ${msg.agentKernel === 'master' ? 'is-master' : ''}`}
                    >
                      {kernelLabel(msg.agentKernel)}
                    </span>
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {msg.kind === 'decision_card' && msg.decisionCard ? (
                    <div className="cds-buzz-card">
                      <div className="cds-buzz-head">
                        <span>Master 决策卡 · 6 维结构化摘要</span>
                        <span className="cds-stage-pill is-clay">
                          Decision Card
                        </span>
                      </div>
                      <div className="cds-buzz-grid">
                        <div className="cds-buzz-cell is-full">
                          <span className="cds-buzz-k">Conclusion · 结论</span>
                          <span className="cds-buzz-v">
                            {msg.decisionCard.conclusion}
                          </span>
                        </div>
                        <div className="cds-buzz-cell">
                          <span className="cds-buzz-k">Evidence · 依据</span>
                          <span className="cds-buzz-v">
                            {msg.decisionCard.evidence.join('；')}
                          </span>
                        </div>
                        <div className="cds-buzz-cell">
                          <span className="cds-buzz-k">
                            Recommendation · 建议
                          </span>
                          <span className="cds-buzz-v">
                            {msg.decisionCard.recommendation}
                          </span>
                        </div>
                        <div className="cds-buzz-cell">
                          <span className="cds-buzz-k">Risk · 风险</span>
                          <span className="cds-buzz-v">
                            {msg.decisionCard.risk}
                          </span>
                        </div>
                        <div className="cds-buzz-cell">
                          <span className="cds-buzz-k">
                            Decision Needed · 待决策
                          </span>
                          <span className="cds-buzz-v">
                            {msg.decisionCard.decisionNeeded}
                          </span>
                        </div>
                        <div className="cds-buzz-cell is-full">
                          <span className="cds-buzz-k">
                            Action Needed · 下一步动作
                          </span>
                          <span className="cds-buzz-v">
                            {msg.decisionCard.actionNeeded}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {msg.kind === 'grilling' && msg.grilling ? (
                    <GrillingCard
                      messageId={msg.id}
                      grilling={msg.grilling}
                      busy={busy}
                      onSubmit={onSubmitGrilling}
                      onRerunQuantize={onRerunQuantize}
                    />
                  ) : null}

                  {msg.kind === 'collab_event' && msg.collabMeta ? (
                    <div className="cds-collab-strip">
                      <div className="cds-collab-route">
                        <span className="cds-agent-pill is-master">
                          {kernelLabel(msg.collabMeta.fromKernel)}
                        </span>
                        <span>→</span>
                        <span className="cds-agent-pill">
                          {kernelLabel(msg.collabMeta.toKernel)}
                        </span>
                        <span>{msg.content}</span>
                      </div>
                      <button
                        type="button"
                        className="cds-btn is-sm"
                        onClick={() =>
                          onOpenTab(resolveTab(msg.collabMeta?.targetTab))
                        }
                      >
                        查看产物
                      </button>
                    </div>
                  ) : null}

                  {msg.kind === 'trace_summary' &&
                  msg.traceItems &&
                  msg.traceItems.length > 0 ? (
                    <TracePill items={msg.traceItems} summary={msg.content} />
                  ) : null}

                  {msg.kind === 'text' || msg.kind === 'ship_card' ? (
                    <div className="cds-prose">{msg.content}</div>
                  ) : null}

                  {msg.kind === 'ship_card' ? (
                    <div className="cds-toolbar-group">
                      <button
                        type="button"
                        className="cds-btn is-sm is-clay"
                        onClick={() => onOpenTab('verify')}
                      >
                        打开验收 HTML &amp; Ship 审校
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
          <div ref={scrollEndRef} />
        </div>
      </div>

      <div className="cds-composer-dock">
        <div className="cds-composer-wrap">
          {session ? (
            <div className="cds-stage-chips">
              <button
                type="button"
                className="cds-chip-btn"
                disabled={busy}
                onClick={() =>
                  void onSendTurn('根据当前共识生成并更新 Spec IR 契约', {
                    action: 'freeze_spec',
                  })
                }
              >
                生成/更新Spec
              </button>
              <button
                type="button"
                className="cds-chip-btn"
                disabled={busy}
                onClick={() =>
                  void onSendTurn('基于冻结 Spec 智能拆解并行任务波次', {
                    action: 'decompose',
                  })
                }
              >
                智能拆解任务
              </button>
              <button
                type="button"
                className="cds-chip-btn"
                disabled={busy}
                onClick={() =>
                  void onSendTurn('启动独立 Worktree 多内核并行执行', {
                    action: 'execute',
                  })
                }
              >
                并行执行
              </button>
              <button
                type="button"
                className="cds-chip-btn"
                disabled={busy}
                onClick={() =>
                  void onSendTurn('发起三权分立 Ship 独立审校与验收报告', {
                    action: 'ship',
                  })
                }
              >
                Ship独立审校
              </button>
            </div>
          ) : null}

          <div className="mcomp" data-state={busy ? 'running' : 'idle'}>
            <div className="mcomp-line">
              <textarea
                className="mcomp-input"
                rows={2}
                value={draft}
                disabled={busy}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder={
                  session
                    ? '向 Master Agent 描述需求、约束或 @指定内核协作... (Enter 发送，Shift+Enter 换行)'
                    : '输入你的产品想法，或点击上方「一键跑通示例项目全流程」开始...'
                }
              />
              <button
                type="button"
                className="mcomp-go"
                aria-label={busy ? '处理中' : '发送消息'}
                disabled={busy || !draft.trim()}
                onClick={() => void handleSubmit()}
              >
                {busy ? (
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: '#ffffff',
                    }}
                  />
                ) : (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.1"
                  >
                    <path d="M12 19V5" />
                    <path d="m6 11 6-6 6 6" />
                  </svg>
                )}
              </button>
            </div>

            <div className="mcomp-meta">
              <div className="mcomp-mentions">
                {MENTION_KERNELS.map(k => (
                  <button
                    key={k.id}
                    type="button"
                    className={`mmeta ${targetKernel === k.id ? 'is-on' : ''}`}
                    onClick={() => setTargetKernel(k.id)}
                  >
                    {k.tag}
                  </button>
                ))}
              </div>

              <div className="mcomp-mentions">
                <button
                  type="button"
                  className={`mmeta ${executionMode !== 'live' ? 'is-on' : ''}`}
                  disabled={busy || !session}
                  onClick={() => void onToggleExecutionMode('auto')}
                  title="优先本地确定性快速沙箱演示，离线亦零报错"
                >
                  自动演示(Fast)
                </button>
                <button
                  type="button"
                  className={`mmeta ${executionMode === 'live' ? 'is-on' : ''}`}
                  disabled={busy || !session}
                  onClick={() => void onToggleExecutionMode('live')}
                  title="真实调用本机挂载的 Claude Code / Codex / Gemini CLI"
                >
                  真实CLI(Live)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

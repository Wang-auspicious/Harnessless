import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  ArtifactPin,
  CollabFeedItem,
  GrillingCardPayload,
  KernelId,
  MasterChatMessage,
  MasterSession,
  NativeKernelCard,
  SessionExecutionMode,
  TraceProgressItem,
  TurnDiffSnapshot,
  WorkspaceTabId,
} from '../../api/v4-types.ts';
import {AgentBrandIcon} from './AgentAvatar.tsx';
import {CdsIcon, StarburstMark} from './CdsIcon.tsx';
import type {SettingsPageId} from './SettingsModal.tsx';
import {CHANNELS, type ChannelId} from './StudioSidebar.tsx';
import {kernelLabel} from './v4-labels.ts';

export interface MasterChatPaneProps {
  readonly session: MasterSession | null;
  readonly messages: readonly MasterChatMessage[];
  readonly collabFeed: readonly CollabFeedItem[];
  readonly pins: readonly ArtifactPin[];
  readonly diffs: readonly TurnDiffSnapshot[];
  readonly kernels: readonly NativeKernelCard[];
  readonly sessionCount: number;
  readonly taskCount: number;
  readonly completedTaskCount: number;
  readonly pendingApprovalsCount: number;
  readonly inspectorOpen: boolean;
  readonly activeTab: WorkspaceTabId;
  readonly activeChannel: ChannelId;
  readonly theme: 'light' | 'dark';
  readonly prefillMention: {
    readonly kernelId: KernelId;
    readonly nonce: number;
  } | null;
  readonly busy: boolean;
  readonly errorText: string | null;
  readonly onDismissError: () => void;
  readonly onDemoRun: () => Promise<void>;
  readonly onOpenFolderPrompt: () => Promise<void>;
  readonly onToggleTab: (tab: WorkspaceTabId) => void;
  readonly onOpenTab: (tab: WorkspaceTabId) => void;
  readonly onOpenSettings: (page?: SettingsPageId) => void;
  readonly onFileInTriage: (title: string, kernel: KernelId) => void;
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

const KERNEL_OPTIONS: readonly {
  readonly id: KernelId;
  readonly label: string;
  readonly key: string;
}[] = [
  {id: 'master', label: 'Master Agent', key: '@master'},
  {id: 'claude-code', label: 'Claude Code', key: '@claude'},
  {id: 'codex', label: 'Codex CLI', key: '@codex'},
  {id: 'gemini-cli', label: 'Gemini CLI', key: '@gemini'},
  {id: 'opencode', label: 'OpenCode', key: '@opencode'},
];

const SLASH_COMMANDS: readonly {
  readonly cmd: string;
  readonly desc: string;
  readonly action: 'freeze_spec' | 'decompose' | 'execute' | 'ship' | 'demo';
  readonly prompt: string;
}[] = [
  {
    cmd: '/spec',
    desc: '根据当前讨论共识生成或冻结 Spec IR 契约',
    action: 'freeze_spec',
    prompt: '根据当前共识生成并更新 Spec IR 契约',
  },
  {
    cmd: '/decompose',
    desc: '基于 Spec IR 智能拆解并行 WBS 子任务',
    action: 'decompose',
    prompt: '基于冻结 Spec 智能拆解并行任务波次',
  },
  {
    cmd: '/execute',
    desc: '在独立 Git Worktree 启动多内核并行编码',
    action: 'execute',
    prompt: '启动独立 Worktree 多内核并行执行',
  },
  {
    cmd: '/ship',
    desc: '发起三权分立独立审校并生成 Answer-in-HTML',
    action: 'ship',
    prompt: '发起三权分立 Ship 独立审校与验收报告',
  },
  {
    cmd: '/demo',
    desc: '一键初始化示例工程并跑通协同全流程',
    action: 'demo',
    prompt: '一键跑通示例项目全流程',
  },
];

function repoShortName(pathStr?: string): string {
  if (!pathStr) {
    return 'Local';
  }
  const parts = pathStr.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'Local';
}

function renderWithMentions(text: string): ReactNode {
  const parts = text.split(
    /(@(?:master|claude|codex|gemini|opencode|channel|[A-Za-z0-9_-]+))/gi,
  );
  return parts.map((part, idx) =>
    part.startsWith('@') ? (
      <span key={idx} className="sd-mention-chip">
        {part}
      </span>
    ) : (
      <Fragment key={idx}>{part}</Fragment>
    ),
  );
}

function renderMessageText(text: string): ReactElement {
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
  return (
    <div className="mp-chat-markdown sd-msg-prose">
      {paragraphs.map((p, idx) => (
        <p key={idx} style={{whiteSpace: 'pre-wrap'}}>
          {renderWithMentions(p)}
        </p>
      ))}
    </div>
  );
}

function TraceDisclosure({
  items,
  summary,
}: {
  readonly items: readonly TraceProgressItem[];
  readonly summary: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const doneCount = items.filter(i => i.status === 'done').length;
  const last = items[items.length - 1];
  const headline = last
    ? `${last.verb} · ${last.object} — ${last.outcome}`
    : summary;

  return (
    <div className="mp-chat-tool">
      <details
        className="mp-chat-disclosure"
        open={open}
        data-open={open ? 'true' : 'false'}
        onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="mp-chat-row" data-expandable="true">
          <span className="mp-chat-row-caret">
            <CdsIcon name="CaretRight" size="xs" />
          </span>
          <span className="mp-chat-disclosure-title">
            <span className="mp-chat-title">Thought process</span>
            <span className="mp-chat-summary">
              {headline} ({doneCount}/{items.length})
            </span>
          </span>
        </summary>
        <div className="mp-chat-body-wrap">
          <div className="mp-chat-disclosure-body" style={{paddingLeft: 18}}>
            {items.map((item, idx) => (
              <div
                key={`${item.verb}-${idx}`}
                style={{
                  fontSize: 12,
                  lineHeight: '19px',
                  color: 'var(--mp-text-secondary)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--mp-font-mono)',
                    fontSize: 11,
                    color: 'var(--mp-text-muted)',
                    marginRight: 6,
                  }}
                >
                  [{item.status.toUpperCase()}]
                </span>
                <strong>{item.verb}</strong> · {item.object} → {item.outcome}
                {item.kernelId ? ` (${kernelLabel(item.kernelId)})` : ''}
                {item.detail ? ` — ${item.detail}` : ''}
              </div>
            ))}
          </div>
        </div>
      </details>
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
    <section
      className="mp-decision-card"
      data-kind="question"
      data-testid="v4-grilling-card"
    >
      <div className="mp-decision-heading">
        <span className="mp-decision-eyebrow">
          <CdsIcon name="Checklist" size="xs" />
          <span>Round {grilling.round} · 需求拷问与架构决策</span>
        </span>
        <span className="mp-decision-caption">
          {grilling.resolved
            ? '已采纳并冻结'
            : `${grilling.questions.length} 项待确认`}
        </span>
      </div>

      <div className="mp-decision-body">
        <p className="mp-decision-question">{grilling.title}</p>
        {grilling.summary ? (
          <p className="mp-decision-hint">{grilling.summary}</p>
        ) : null}

        {grilling.settled.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginBottom: 10,
            }}
          >
            {grilling.settled.map((item, idx) => (
              <span key={idx} className="sd-pill is-success">
                <CdsIcon name="Check" size="xs" />
                <span>{item}</span>
              </span>
            ))}
          </div>
        ) : null}

        {grilling.questions.map((q, idx) => {
          const cur = selected[q.id] ?? q.defaultOptionId;
          const questionTitle = /^Q\d+/i.test(q.label)
            ? q.label
            : `Q${idx + 1}. ${q.label}`;
          return (
            <div key={q.id} style={{marginBottom: 12}}>
              <p className="mp-decision-question" style={{fontSize: 13}}>
                {questionTitle}
                {q.isForkQuestion ? (
                  <span className="sd-pill is-clay" style={{marginLeft: 8}}>
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
                      className={`mp-decision-button mp-decision-option ${isSel ? 'is-selected' : ''}`}
                      onClick={() =>
                        setSelected(prev => ({...prev, [q.id]: opt.id}))
                      }
                    >
                      <span className="mp-decision-choice-mark">
                        {isSel ? <CdsIcon name="Check" size="xs" /> : null}
                      </span>
                      <span className="mp-decision-option-copy">
                        <span className="mp-decision-option-label">
                          {opt.label}
                          {opt.recommended ? (
                            <span
                              className="sd-pill is-clay"
                              style={{marginLeft: 6}}
                            >
                              Recommended
                            </span>
                          ) : null}
                        </span>
                        {opt.rationale ? (
                          <span className="mp-decision-option-description">
                            {opt.rationale}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mp-decision-other">
                <input
                  type="text"
                  className="mp-decision-custom"
                  style={{minHeight: 32, padding: '5px 10px'}}
                  disabled={busy || grilling.resolved}
                  value={customNotes[q.id] ?? ''}
                  onChange={e =>
                    setCustomNotes(prev => ({...prev, [q.id]: e.target.value}))
                  }
                  placeholder="补充自定义约束或反驳意见…"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mp-decision-actions">
        <button
          type="button"
          className="mp-decision-button"
          disabled={busy}
          onClick={() => void onRerunQuantize()}
        >
          Kano+AHP 校验
        </button>
        <div className="mp-decision-allow">
          <button
            type="button"
            className="mp-decision-button"
            disabled={busy || grilling.resolved}
            onClick={() =>
              void onSubmit(messageId, buildAnswers(), false, false)
            }
          >
            提交选择
          </button>
          <button
            type="button"
            className="mp-decision-button is-primary"
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
  collabFeed,
  pins,
  diffs,
  kernels,
  sessionCount,
  taskCount,
  completedTaskCount,
  pendingApprovalsCount,
  inspectorOpen,
  activeTab,
  activeChannel,
  theme,
  prefillMention,
  busy,
  errorText,
  onDismissError,
  onDemoRun,
  onOpenFolderPrompt,
  onToggleTab,
  onOpenTab,
  onOpenSettings,
  onFileInTriage,
  onSendTurn,
  onSubmitGrilling,
  onRerunQuantize,
  onToggleExecutionMode,
}: MasterChatPaneProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [targetKernel, setTargetKernel] = useState<KernelId>('master');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [permMenuOpen, setPermMenuOpen] = useState(false);
  const [permPreset, setPermPreset] = useState<'Auto' | 'Plan' | 'Strict'>(
    'Auto',
  );
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [prMenuOpen, setPrMenuOpen] = useState(false);
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);
  const [worktreeEnabled, setWorktreeEnabled] = useState(true);
  const [expandedThreads, setExpandedThreads] = useState<
    Record<string, boolean>
  >({});
  const [threadReplies, setThreadReplies] = useState<Record<string, string>>(
    {},
  );

  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!prefillMention) {
      return;
    }
    const opt = KERNEL_OPTIONS.find(k => k.id === prefillMention.kernelId);
    const mentionTag = opt?.key ?? `@${prefillMention.kernelId}`;
    setTargetKernel(prefillMention.kernelId);
    setDraft(prev => {
      if (prev.includes(mentionTag)) {
        return prev;
      }
      return prev.trim() ? `${mentionTag} ${prev}` : `${mentionTag} `;
    });
    inputRef.current?.focus();
  }, [prefillMention]);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
  }, [messages.length, busy]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent): void => {
      if (
        composerRef.current &&
        !composerRef.current.contains(e.target as Node)
      ) {
        setSlashOpen(false);
        setMentionOpen(false);
        setPermMenuOpen(false);
        setModelMenuOpen(false);
        setPrMenuOpen(false);
      }
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setThreadMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, []);

  const handleSubmit = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (!trimmed || busy) {
      return;
    }
    setDraft('');
    setSlashOpen(false);
    setMentionOpen(false);
    const matchedCmd = SLASH_COMMANDS.find(c => trimmed === c.cmd);
    if (matchedCmd) {
      if (matchedCmd.action === 'demo') {
        await onDemoRun();
      } else {
        await onSendTurn(matchedCmd.prompt, {
          targetKernel,
          action: matchedCmd.action,
        });
      }
      return;
    }
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

  const hasMessages = Boolean(session && messages.length > 0);
  const executionMode = session?.executionMode ?? 'auto';
  const repoName = repoShortName(session?.workspacePath);
  const openPinsCount = pins.filter(p => p.status !== 'resolved').length;
  const channelMeta = CHANNELS.find(c => c.id === activeChannel) ?? {
    id: 'general' as const,
    name: 'general',
    subtitle: '主控协同',
  };

  const diffAdded = diffs.reduce(
    (sum, d) => sum + d.files.reduce((fs, f) => fs + f.added, 0),
    0,
  );
  const diffRemoved = diffs.reduce(
    (sum, d) => sum + d.files.reduce((fs, f) => fs + f.removed, 0),
    0,
  );

  const readyKernelsCount = kernels.filter(
    k => k.status === 'ready' || k.status === 'builtin',
  ).length;
  const ringPercent =
    taskCount > 0
      ? Math.round((completedTaskCount / taskCount) * 100)
      : session
        ? Math.min(90, Math.max(18, session.term * 20))
        : 0;

  const filteredSlash = SLASH_COMMANDS.filter(item => {
    const q = slashFilter.trim().toLowerCase();
    return (
      !q ||
      item.cmd.toLowerCase().includes(q) ||
      item.desc.toLowerCase().includes(q)
    );
  });

  const headerToggles: readonly {
    readonly tab: WorkspaceTabId;
    readonly icon: string;
    readonly label: string;
  }[] = [
    {tab: 'tasks', icon: 'Tasks', label: 'Tasks · 任务拆解'},
    {tab: 'board', icon: 'Palette', label: 'Board & Spec · 白板共识'},
    {tab: 'code', icon: 'ChangesPlusMinus', label: 'Changes · 代码与 Diff'},
    {tab: 'verify', icon: 'Globe', label: 'Verify · Answer-in-HTML'},
    {tab: 'kernels', icon: 'CommandLinePrompt', label: 'Kernels · 原生内核'},
    {tab: 'dag', icon: 'GitBranch', label: 'DAG · 断点执行图'},
  ];

  const insertMention = (kernelId: KernelId, tag: string): void => {
    setTargetKernel(kernelId);
    setMentionOpen(false);
    setDraft(prev => {
      const cleaned = prev.endsWith('@') ? prev.slice(0, -1) : prev;
      return cleaned.trim() ? `${cleaned.trim()} ${tag} ` : `${tag} `;
    });
    inputRef.current?.focus();
  };

  return (
    <section
      className="mpw-conversation"
      id="view-chat"
      data-home={!hasMessages ? 'true' : 'false'}
      data-has-messages={hasMessages ? 'true' : 'false'}
      data-testid="v4-master-chat"
    >
      <header className="mpw-header" ref={headerRef}>
        <div className="mpw-title-row">
          <div className="mpw-title-cluster">
            {session?.mode === 'team' ? (
              <span className="sd-header-channel-pill">
                #{channelMeta.name}
              </span>
            ) : (
              <CdsIcon name="Laptop" size="small" />
            )}
            <b className="mpw-title" id="chat-title">
              {session?.title ?? 'New chat'}
            </b>
            <span className="mp-chat-project">
              <span>{repoName}</span>
            </span>

            {session ? (
              <button
                type="button"
                className={`sd-pinned-canvas-btn ${inspectorOpen && activeTab === 'board' ? 'is-on' : ''}`}
                title="打开置顶频道白板 (Excalidraw Canvas × Spec IR)"
                onClick={() => onOpenTab('board')}
              >
                <CdsIcon name="Pin" size="xs" />
                <span>Canvas</span>
                {openPinsCount > 0 ? (
                  <span className="sd-canvas-count">{openPinsCount}</span>
                ) : null}
              </button>
            ) : null}
          </div>

          <div className="mpw-header-actions">
            {headerToggles.map(item => {
              const pressed = inspectorOpen && activeTab === item.tab;
              return (
                <button
                  key={item.tab}
                  type="button"
                  className={`mp-thread-action mp-workspace-toggle ${pressed ? 'is-on' : ''}`}
                  aria-label={item.label}
                  title={item.label}
                  aria-pressed={pressed}
                  onClick={() => onToggleTab(item.tab)}
                >
                  <CdsIcon name={item.icon} size="small" />
                </button>
              );
            })}

            <button
              type="button"
              className={`mp-thread-action ${threadMenuOpen ? 'is-on' : ''}`}
              id="thread-more"
              aria-label="More options"
              title="会话操作"
              aria-haspopup="menu"
              aria-expanded={threadMenuOpen}
              onClick={() => setThreadMenuOpen(prev => !prev)}
            >
              <CdsIcon name="DotsVertical" size="small" />
            </button>
          </div>
        </div>

        {threadMenuOpen ? (
          <div
            className="mp-thread-menu"
            role="menu"
            style={{
              top: 80,
              right: inspectorOpen ? 'auto' : 16,
              left: inspectorOpen ? 'auto' : undefined,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setThreadMenuOpen(false);
                void onDemoRun();
              }}
            >
              <span>一键运行示例全流程</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setThreadMenuOpen(false);
                void onOpenFolderPrompt();
              }}
            >
              <span>打开并接入本地目录</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setThreadMenuOpen(false);
                onOpenSettings('models');
              }}
            >
              <span>配置原生内核与角色路由…</span>
            </button>
            {session ? (
              <>
                <hr />
                <button
                  type="button"
                  onClick={() => {
                    setThreadMenuOpen(false);
                    void onSendTurn('根据当前共识生成并更新 Spec IR 契约', {
                      action: 'freeze_spec',
                    });
                  }}
                >
                  <span>冻结 Spec IR</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setThreadMenuOpen(false);
                    void onSendTurn('基于冻结 Spec 智能拆解并行任务波次', {
                      action: 'decompose',
                    });
                  }}
                >
                  <span>智能拆解 WBS</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setThreadMenuOpen(false);
                    void onSendTurn('发起三权分立 Ship 独立审校与验收报告', {
                      action: 'ship',
                    });
                  }}
                >
                  <span>Ship 独立审校</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="mpw-scrollbody">
        {errorText ? (
          <div
            style={{
              width: 'min(768px, calc(100% - 32px))',
              margin: '8px auto 0',
              padding: '8px 12px',
              borderRadius: 8,
              border:
                '1px solid color-mix(in srgb, var(--mp-danger) 30%, var(--mp-rule))',
              background:
                'color-mix(in srgb, var(--mp-danger) 7%, var(--mp-panel))',
              color: 'var(--mp-danger)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 12.5,
            }}
            role="alert"
          >
            <span>{errorText}</span>
            <button type="button" className="sd-btn" onClick={onDismissError}>
              关闭
            </button>
          </div>
        ) : null}

        {!hasMessages ? (
          <section
            className="mp-studio-home"
            id="studio-home"
            aria-label="Studio home"
            data-testid="v4-empty-hero"
          >
            <header className="mp-home-heading">
              <StarburstMark size={24} />
              <h1 id="studio-home-title">
                {session ? session.title : '接下来构思什么？'}
              </h1>
            </header>

            <div className="mp-home-attention" id="studio-home-attention">
              <div className="mp-home-section">
                <header>
                  <h2>协同起步</h2>
                </header>
                <div className="mp-home-section-list">
                  <button
                    type="button"
                    className="mp-home-attention-row"
                    data-state="awaiting"
                    data-testid="v4-demo-run-btn"
                    disabled={busy}
                    onClick={() => void onDemoRun()}
                  >
                    <span className="mp-home-state-dot" aria-hidden="true" />
                    <strong>一键跑通示例项目全流程</strong>
                    <span>
                      Excalidraw 白板 → Spec IR → Worktree Diff → Ship HTML
                    </span>
                    <span className="mp-home-row-arrow" aria-hidden="true">
                      <CdsIcon name="ArrowRight" size="small" />
                    </span>
                  </button>

                  <button
                    type="button"
                    className="mp-home-attention-row"
                    data-testid="v4-open-folder-btn"
                    disabled={busy}
                    onClick={() => void onOpenFolderPrompt()}
                  >
                    <CdsIcon name="FolderOpen" size="small" />
                    <strong>打开本地代码目录并接入协同队列</strong>
                    <span>自动检测 Git 仓库或执行 git init</span>
                    <span className="mp-home-row-arrow" aria-hidden="true">
                      <CdsIcon name="ArrowRight" size="small" />
                    </span>
                  </button>

                  <button
                    type="button"
                    className="mp-home-attention-row"
                    onClick={() => onOpenSettings('models')}
                  >
                    <CdsIcon name="Agent" size="small" />
                    <strong>配置多内核原生 Agent 路由 (Orca 架构)</strong>
                    <span>
                      {readyKernelsCount} 个可用内核 · Claude / Codex / Gemini /
                      OpenCode
                    </span>
                    <span className="mp-home-row-arrow" aria-hidden="true">
                      <CdsIcon name="ArrowRight" size="small" />
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <section
              className="mp-home-stats"
              id="studio-home-stats"
              aria-label="Workspace telemetry"
            >
              <div className="mp-home-stat-grid">
                <div className="mp-home-stat">
                  <small>Native Kernels</small>
                  <strong>{readyKernelsCount} online</strong>
                </div>
                <div className="mp-home-stat">
                  <small>Sessions</small>
                  <strong>{sessionCount} active</strong>
                </div>
                <div className="mp-home-stat">
                  <small>WBS Tasks</small>
                  <strong>
                    {completedTaskCount}/{taskCount}
                  </strong>
                </div>
                <div className="mp-home-stat">
                  <small>Pending Gates</small>
                  <strong>{pendingApprovalsCount}</strong>
                </div>
              </div>
            </section>
          </section>
        ) : null}

        <div className="mpw-stream" id="stream">
          <div className="mpw-blank" aria-hidden="true" />
          <div className="mp-chat-flow">
            {messages.map(msg => {
              const msgTime = new Date(msg.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              if (msg.role === 'human') {
                return (
                  <div key={msg.id} className="mp-chat-user">
                    <div className="mp-chat-user-stack">
                      <div className="mp-chat-bubble">
                        {renderWithMentions(msg.content)}
                      </div>
                    </div>
                  </div>
                );
              }

              const relatedReplies = collabFeed.filter(
                c =>
                  c.fromKernel === msg.agentKernel ||
                  c.toKernel === msg.agentKernel,
              );
              const isThreadOpen = Boolean(expandedThreads[msg.id]);

              return (
                <article
                  key={msg.id}
                  className="mp-chat-assistant sd-slack-msg"
                >
                  <div className="sd-slack-msg-head">
                    <AgentBrandIcon
                      kernelId={msg.agentKernel}
                      theme={theme}
                      size={20}
                      framed
                    />
                    <strong className="sd-slack-author">
                      {kernelLabel(msg.agentKernel)}
                    </strong>
                    <span className="sd-pill">
                      {msg.agentKernel === 'master' ? 'ORCHESTRATOR' : 'AGENT'}
                    </span>
                    <span className="sd-slack-time">{msgTime}</span>
                    {session?.mode === 'team' ? (
                      <span className="sd-slack-time">#{channelMeta.name}</span>
                    ) : null}
                  </div>

                  <div className="mp-chat-assistant-body">
                    {msg.kind === 'trace_summary' &&
                    msg.traceItems &&
                    msg.traceItems.length > 0 ? (
                      <TraceDisclosure
                        items={msg.traceItems}
                        summary={msg.content}
                      />
                    ) : msg.kind === 'trace_summary' && msg.content ? (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: 'var(--mp-text-secondary)',
                        }}
                      >
                        {msg.content}
                      </div>
                    ) : null}

                    {msg.kind === 'decision_card' && msg.decisionCard ? (
                      <div className="sd-decision-box">
                        <div className="sd-decision-box-head">
                          <span>结构化决策摘要 · Consensus Brief</span>
                          <span className="sd-pill is-clay">Decision</span>
                        </div>
                        <div className="sd-decision-grid">
                          <div className="sd-decision-cell is-wide">
                            <span className="sd-decision-k">Conclusion</span>
                            <span className="sd-decision-v is-strong">
                              {msg.decisionCard.conclusion}
                            </span>
                          </div>
                          <div className="sd-decision-cell">
                            <span className="sd-decision-k">Evidence</span>
                            <span className="sd-decision-v">
                              {msg.decisionCard.evidence.join('；')}
                            </span>
                          </div>
                          <div className="sd-decision-cell">
                            <span className="sd-decision-k">
                              Recommendation
                            </span>
                            <span className="sd-decision-v">
                              {msg.decisionCard.recommendation}
                            </span>
                          </div>
                          <div className="sd-decision-cell">
                            <span className="sd-decision-k">Risk</span>
                            <span className="sd-decision-v">
                              {msg.decisionCard.risk}
                            </span>
                          </div>
                          <div className="sd-decision-cell">
                            <span className="sd-decision-k">
                              Decision needed
                            </span>
                            <span className="sd-decision-v">
                              {msg.decisionCard.decisionNeeded}
                            </span>
                          </div>
                          <div className="sd-decision-cell is-wide">
                            <span className="sd-decision-k">Action needed</span>
                            <span className="sd-decision-v">
                              {msg.decisionCard.actionNeeded || 'None.'}
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
                      <button
                        type="button"
                        className="sd-handoff-row"
                        onClick={() =>
                          onOpenTab(resolveTab(msg.collabMeta?.targetTab))
                        }
                      >
                        <AgentBrandIcon
                          kernelId={msg.collabMeta.fromKernel}
                          theme={theme}
                          size={15}
                        />
                        <span>
                          <strong>
                            {kernelLabel(msg.collabMeta.fromKernel)}
                          </strong>{' '}
                          → {kernelLabel(msg.collabMeta.toKernel)}
                        </span>
                        <span
                          style={{
                            color: 'var(--mp-text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {msg.content}
                        </span>
                        <span className="sd-handoff-link">查看产物 →</span>
                      </button>
                    ) : null}

                    {msg.kind === 'text' ||
                    msg.kind === 'ship_card' ||
                    (msg.kind !== 'grilling' &&
                      msg.kind !== 'decision_card' &&
                      msg.kind !== 'collab_event' &&
                      msg.kind !== 'trace_summary' &&
                      Boolean(msg.content))
                      ? renderMessageText(msg.content)
                      : null}

                    {msg.kind === 'ship_card' ? (
                      <div>
                        <button
                          type="button"
                          className="sd-btn is-primary"
                          onClick={() => onOpenTab('verify')}
                        >
                          <CdsIcon name="Globe" size="xs" />
                          <span>打开验收 HTML 与 Ship 审校</span>
                        </button>
                      </div>
                    ) : null}

                    {/* Slack-style thread summary & quick collaboration actions */}
                    <div className="sd-thread-bar">
                      <button
                        type="button"
                        className="sd-thread-trigger"
                        onClick={() =>
                          setExpandedThreads(prev => ({
                            ...prev,
                            [msg.id]: !prev[msg.id],
                          }))
                        }
                      >
                        <CdsIcon name="MessageSquare" size="xs" />
                        <span>
                          {relatedReplies.length > 0
                            ? `${relatedReplies.length} 条内核线程回复`
                            : '展开线程讨论'}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="sd-thread-action-link"
                        onClick={() => onOpenTab('board')}
                      >
                        关联白板
                      </button>

                      <button
                        type="button"
                        className="sd-thread-action-link"
                        onClick={() =>
                          onFileInTriage(
                            msg.decisionCard?.conclusion ??
                              msg.content.slice(0, 90),
                            msg.agentKernel,
                          )
                        }
                      >
                        转入 Triage 追踪
                      </button>
                    </div>

                    {isThreadOpen ? (
                      <div className="sd-thread-drawer">
                        {relatedReplies.slice(0, 4).map(item => (
                          <div key={item.id} className="sd-thread-item">
                            <AgentBrandIcon
                              kernelId={item.fromKernel}
                              theme={theme}
                              size={14}
                            />
                            <strong>{kernelLabel(item.fromKernel)}</strong>
                            <span>→ @{kernelLabel(item.toKernel)}:</span>
                            <span style={{color: 'var(--mp-text-secondary)'}}>
                              {item.content}
                            </span>
                          </div>
                        ))}
                        <div className="sd-toolbar-row" style={{marginTop: 6}}>
                          <input
                            type="text"
                            className="sd-input"
                            style={{flex: 1}}
                            value={threadReplies[msg.id] ?? ''}
                            onChange={e =>
                              setThreadReplies(prev => ({
                                ...prev,
                                [msg.id]: e.target.value,
                              }))
                            }
                            placeholder={`在线程中回复 @${kernelLabel(msg.agentKernel)}…`}
                          />
                          <button
                            type="button"
                            className="sd-btn is-primary"
                            disabled={
                              busy || !(threadReplies[msg.id] ?? '').trim()
                            }
                            onClick={() => {
                              const reply = (
                                threadReplies[msg.id] ?? ''
                              ).trim();
                              if (!reply) return;
                              setThreadReplies(prev => ({
                                ...prev,
                                [msg.id]: '',
                              }));
                              void onSendTurn(reply, {
                                targetKernel: msg.agentKernel,
                                action: 'chat',
                              });
                            }}
                          >
                            回复线程
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}

            {busy ? (
              <div className="mp-chat-turn-status">
                <span className="mp-chat-thinking-mark">
                  <StarburstMark size={16} spinning />
                </span>
                <span className="mp-chat-turn-status-copy">
                  <span className="mp-chat-turn-status-label">Thinking...</span>
                </span>
              </div>
            ) : null}

            <div ref={streamEndRef} />
          </div>
        </div>

        <div className="mpw-composer-seat" ref={composerRef}>
          <div className="mpw-composer-stack">
            {session ? (
              <div
                className="mp-repository-context"
                id="composer-repository-context"
                aria-label="Repository status"
              >
                <div className="mp-repository-identity">
                  <button
                    type="button"
                    className="mp-repository-location"
                    title="查看变更文件与 Git Diff"
                    onClick={() => onOpenTab('code')}
                  >
                    <span id="composer-repository-name">{repoName}</span>
                    <span id="composer-branch-name">main</span>
                  </button>
                </div>

                <div className="mp-repository-actions">
                  <button
                    type="button"
                    className="mp-repository-diff"
                    title="View diff"
                    onClick={() => onOpenTab('code')}
                  >
                    <span className="is-added">+{diffAdded}</span>
                    <span className="is-deleted">
                      {'\u2212'}
                      {diffRemoved}
                    </span>
                  </button>

                  <span
                    className="mp-repository-pr-split"
                    style={{position: 'relative'}}
                  >
                    <button
                      type="button"
                      id="composer-create-pr"
                      disabled={busy}
                      onClick={() => onOpenTab('verify')}
                    >
                      Ship 验收
                    </button>
                    <button
                      type="button"
                      id="composer-pr-menu"
                      aria-label="More workflow actions"
                      title="工作流快捷步骤"
                      onClick={() => setPrMenuOpen(prev => !prev)}
                    >
                      <CdsIcon name="CaretDownSmall" size="xs" />
                    </button>
                  </span>
                </div>

                {prMenuOpen ? (
                  <div
                    className="mpw-perm-menu"
                    style={{bottom: 98, right: 16}}
                    role="menu"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setPrMenuOpen(false);
                        void onSendTurn('根据当前共识生成并更新 Spec IR 契约', {
                          action: 'freeze_spec',
                        });
                      }}
                    >
                      <span>1. 生成 / 冻结 Spec IR</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPrMenuOpen(false);
                        void onSendTurn('基于冻结 Spec 智能拆解并行任务波次', {
                          action: 'decompose',
                        });
                      }}
                    >
                      <span>2. 智能拆解 WBS 任务</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPrMenuOpen(false);
                        void onSendTurn('启动独立 Worktree 多内核并行执行', {
                          action: 'execute',
                        });
                      }}
                    >
                      <span>3. 多内核并行执行</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPrMenuOpen(false);
                        void onSendTurn(
                          '发起三权分立 Ship 独立审校与验收报告',
                          {
                            action: 'ship',
                          },
                        );
                      }}
                    >
                      <span>4. Ship 独立审校与交付</span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div
              className="mp-composer-context-row"
              aria-label="Runtime environment"
            >
              <button
                type="button"
                className="mp-composer-environment"
                onClick={() => onOpenSettings('models')}
              >
                <CdsIcon name="Laptop" size="small" />
                <span>Local</span>
              </button>

              <button
                type="button"
                className="mp-composer-workspace"
                title="选择工作区文件夹"
                onClick={() => void onOpenFolderPrompt()}
              >
                <CdsIcon name="Folder" size="small" />
                <span>{session ? repoName : 'Select folder…'}</span>
              </button>

              {session ? (
                <div className="mp-composer-git-context">
                  <button
                    type="button"
                    className="mp-composer-branch"
                    onClick={() => onOpenTab('code')}
                  >
                    <CdsIcon name="GitBranch" size="small" />
                    <span>main</span>
                  </button>
                  <span
                    className="mp-composer-git-divider"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="mp-composer-worktree"
                    role="checkbox"
                    aria-checked={worktreeEnabled}
                    onClick={() => setWorktreeEnabled(prev => !prev)}
                  >
                    <span className="mp-worktree-box" aria-hidden="true">
                      <CdsIcon name="Check" size="xs" />
                    </span>
                    <span>worktree</span>
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                className="mp-composer-folder-add"
                aria-label="Open local folder"
                title="打开或绑定本地目录"
                onClick={() => void onOpenFolderPrompt()}
              >
                <CdsIcon name="FolderPlus" size="small" />
              </button>
            </div>

            <form
              className="mpw-input-form mp-compact-composer"
              id="composer-form"
              onSubmit={e => {
                e.preventDefault();
                void handleSubmit();
              }}
            >
              <div className="mpw-input-root">
                <div className="mpw-card">
                  <div className="mpw-scroll">
                    <div className="mpw-input-line">
                      <div className="mpw-grow">
                        <textarea
                          ref={inputRef}
                          className="mpw-input"
                          rows={1}
                          maxLength={12000}
                          value={draft}
                          disabled={busy}
                          onChange={e => {
                            const val = e.target.value;
                            setDraft(val);
                            if (val.startsWith('/')) {
                              setSlashOpen(true);
                              setSlashFilter(val);
                              setMentionOpen(false);
                            } else if (val.endsWith('@')) {
                              setMentionOpen(true);
                              setSlashOpen(false);
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              void handleSubmit();
                            }
                          }}
                          placeholder="输入需求、@ 召唤 Agent 协同或 / 执行指令…"
                          aria-label="Continue conversation"
                        />
                      </div>

                      <button
                        type="submit"
                        className={`mpw-primary ${busy ? 'is-stop' : ''}`}
                        title={busy ? 'Running…' : 'Send'}
                        aria-label={busy ? 'Running' : 'Send'}
                        disabled={busy || !draft.trim()}
                      >
                        <CdsIcon
                          name={busy ? 'Stop' : 'ArrowReturn'}
                          size="small"
                          strong={!busy}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="mpw-row" style={{position: 'relative'}}>
                    <div className="mpw-tools">
                      <button
                        type="button"
                        className="mpw-add"
                        id="composer-add"
                        aria-label="Commands and workflow shortcuts"
                        title="工作流快捷指令 (/spec, /decompose, /execute, /ship)"
                        aria-expanded={slashOpen}
                        onClick={() => {
                          setMentionOpen(false);
                          setSlashOpen(prev => !prev);
                        }}
                      >
                        <CdsIcon name="Add" size="small" />
                      </button>

                      <button
                        type="button"
                        className="mpw-add mp-composer-secondary"
                        id="composer-mention"
                        aria-label="Mention agent"
                        title="@ 指定协同 Agent 内核"
                        aria-expanded={mentionOpen}
                        onClick={() => {
                          setSlashOpen(false);
                          setMentionOpen(prev => !prev);
                        }}
                      >
                        <CdsIcon name="At" size="small" />
                      </button>

                      {mentionOpen ? (
                        <div
                          className="mpw-model-menu"
                          role="listbox"
                          aria-label="Mention agent"
                          style={{bottom: 36, left: 28}}
                        >
                          {KERNEL_OPTIONS.map(k => (
                            <button
                              key={k.id}
                              type="button"
                              className="mpw-model-row"
                              onClick={() => insertMention(k.id, k.key)}
                            >
                              <AgentBrandIcon
                                kernelId={k.id}
                                theme={theme}
                                size={16}
                              />
                              <span className="mpw-model-name">{k.label}</span>
                              <span className="mpw-model-key">{k.key}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {slashOpen ? (
                        <div
                          className="mpw-add-menu mpw-slash-menu"
                          role="menu"
                        >
                          <input
                            type="search"
                            value={slashFilter}
                            onChange={e => setSlashFilter(e.target.value)}
                            placeholder="Search commands (/spec, /decompose, /ship…)"
                          />
                          <div className="mpw-slash-rows">
                            {filteredSlash.map(item => (
                              <button
                                key={item.cmd}
                                type="button"
                                className="mpw-slash-row"
                                onClick={() => {
                                  setSlashOpen(false);
                                  setSlashFilter('');
                                  setDraft('');
                                  if (item.action === 'demo') {
                                    void onDemoRun();
                                  } else {
                                    void onSendTurn(item.prompt, {
                                      targetKernel,
                                      action: item.action,
                                    });
                                  }
                                }}
                              >
                                <span className="mpw-slash-text">
                                  <span className="mpw-slash-name">
                                    {item.cmd}
                                  </span>
                                  <small>{item.desc}</small>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <button
                        type="button"
                        className="mpw-perm mp-permission-seat"
                        id="composer-permission"
                        aria-haspopup="listbox"
                        aria-expanded={permMenuOpen}
                        title="协同策略模式"
                        onClick={() => setPermMenuOpen(prev => !prev)}
                      >
                        <CdsIcon
                          name="CaretDownSmall"
                          size="xs"
                          className="mpw-perm-chev"
                        />
                        <span className="mpw-perm-label">{permPreset}</span>
                      </button>

                      {permMenuOpen ? (
                        <div
                          className="mpw-perm-menu"
                          role="listbox"
                          style={{bottom: 36, left: 68}}
                        >
                          {(['Auto', 'Plan', 'Strict'] as const).map(p => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                setPermPreset(p);
                                setPermMenuOpen(false);
                              }}
                            >
                              <span>{p}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="mpw-trailing">
                      <button
                        type="button"
                        className="mpw-perm mpw-model"
                        id="composer-model"
                        aria-haspopup="listbox"
                        aria-expanded={modelMenuOpen}
                        title="选择当前主对话 / @指定执行内核"
                        onClick={() => setModelMenuOpen(prev => !prev)}
                      >
                        <AgentBrandIcon
                          kernelId={targetKernel}
                          theme={theme}
                          size={14}
                        />
                        <span className="mpw-perm-label">
                          {kernelLabel(targetKernel)}
                        </span>
                        <CdsIcon
                          name="CaretDownSmall"
                          size="xs"
                          className="mpw-perm-chev"
                        />
                      </button>

                      {modelMenuOpen ? (
                        <div
                          className="mpw-model-menu"
                          role="listbox"
                          style={{bottom: 36, right: 64}}
                        >
                          {KERNEL_OPTIONS.map(k => (
                            <button
                              key={k.id}
                              type="button"
                              className={`mpw-model-row ${targetKernel === k.id ? 'is-active' : ''}`}
                              onClick={() => {
                                setTargetKernel(k.id);
                                setModelMenuOpen(false);
                              }}
                            >
                              <AgentBrandIcon
                                kernelId={k.id}
                                theme={theme}
                                size={15}
                              />
                              <span className="mpw-model-name">{k.label}</span>
                              <span className="mpw-model-key">{k.key}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <button
                        type="button"
                        className="mpw-add mp-composer-secondary"
                        id="composer-effort"
                        disabled={busy || !session}
                        title={
                          executionMode === 'live'
                            ? 'Live CLI 真实调用模式 (点击切换 Fast 沙箱)'
                            : 'Fast 本地确定性沙箱演示 (点击切换 Live CLI)'
                        }
                        onClick={() =>
                          void onToggleExecutionMode(
                            executionMode === 'live' ? 'auto' : 'live',
                          )
                        }
                      >
                        <span>
                          {executionMode === 'live' ? 'Live' : 'Fast'}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="mpw-ring"
                        id="composer-context"
                        aria-label={`Progress ${ringPercent}%`}
                        title={`任务进度 ${completedTaskCount}/${taskCount || 0} (${ringPercent}%)`}
                        data-empty={ringPercent === 0 ? 'true' : undefined}
                        onClick={() => onOpenTab('tasks')}
                      >
                        <svg
                          viewBox="0 0 20 20"
                          width="15"
                          height="15"
                          aria-hidden="true"
                        >
                          <circle
                            className="mp-context-track"
                            cx="10"
                            cy="10"
                            r="6.75"
                            pathLength="100"
                          />
                          <circle
                            className="mp-context-value"
                            cx="10"
                            cy="10"
                            r="6.75"
                            pathLength="100"
                            style={{
                              strokeDasharray: `${ringPercent} 100`,
                            }}
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  AgentPersonaRecord,
  ArtifactPin,
  CollabChannelRecord,
  CollabDocSnapshot,
  CollabFeedItem,
  CollabPostRecord,
  GrillingCardPayload,
  KernelId,
  MasterChatMessage,
  MasterSession,
  NativeKernelCard,
  PostAttachment,
  SessionExecutionMode,
  TraceProgressItem,
  TurnDiffSnapshot,
  UnreadQueueItem,
  WorkspaceTabId,
} from '../../api/v4-types.ts';
import {AgentBrandIcon, resolveBrandForAgent} from './AgentAvatar.tsx';
import {CdsIcon, StarburstMark} from './CdsIcon.tsx';
import {RichMediaAttachment} from './RichMediaAttachment.tsx';
import type {SettingsPageId} from './SettingsModal.tsx';
import {CHANNELS} from './StudioSidebar.tsx';
import {kernelLabel} from './v4-labels.ts';

export interface MasterChatPaneProps {
  readonly session: MasterSession | null;
  readonly specRevision?: number;
  readonly messages: readonly MasterChatMessage[];
  readonly posts: readonly CollabPostRecord[];
  readonly channels: readonly CollabChannelRecord[];
  readonly agents: readonly AgentPersonaRecord[];
  readonly collabDoc?: CollabDocSnapshot;
  readonly collabFeed: readonly CollabFeedItem[];
  readonly pins: readonly ArtifactPin[];
  readonly diffs: readonly TurnDiffSnapshot[];
  readonly kernels: readonly NativeKernelCard[];
  readonly unreadQueue: readonly UnreadQueueItem[];
  readonly sessionCount: number;
  readonly taskCount: number;
  readonly completedTaskCount: number;
  readonly pendingApprovalsCount: number;
  readonly inspectorOpen: boolean;
  readonly activeTab: WorkspaceTabId;
  readonly activeChannel: string;
  readonly theme: 'light' | 'dark';
  readonly prefillMention: {
    readonly handle: string;
    readonly nonce: number;
  } | null;
  readonly busy: boolean;
  readonly errorText: string | null;
  readonly onDismissError: () => void;
  readonly onDemoRun: () => Promise<void>;
  readonly onOpenFolderPrompt: () => Promise<void>;
  readonly onSelectChannel: (channelId: string) => void;
  readonly onToggleTab: (tab: WorkspaceTabId) => void;
  readonly onOpenTab: (
    tab: WorkspaceTabId,
    extra?: {readonly blockId?: string; readonly threadId?: string},
  ) => void;
  readonly onOpenSettings: (page?: SettingsPageId) => void;
  readonly onSendTurn: (
    text: string,
    opts?: {
      readonly targetKernel?: KernelId;
      readonly action?:
        'chat' | 'freeze_spec' | 'decompose' | 'execute' | 'ship';
    },
  ) => Promise<void>;
  readonly onPostMessage: (input: {
    readonly channelId: string;
    readonly content: string;
    readonly attachments?: readonly PostAttachment[];
  }) => Promise<void>;
  readonly onReactPost: (postId: string, emoji: string) => Promise<void>;
  readonly onToggleResolveThread: (
    postId: string,
    nextStatus: 'open' | 'resolved',
  ) => Promise<void>;
  readonly onSelectPollOption: (
    postId: string,
    attachmentId: string,
    optionId: string,
  ) => Promise<void>;
  readonly onSaveMockupHtml: (
    postId: string,
    attachmentId: string,
    htmlContent: string,
  ) => Promise<void>;
  readonly onSubmitGrilling: (
    messageId: string,
    answers: Readonly<Record<string, string>>,
    acceptRecommended: boolean,
    freezeSpec: boolean,
  ) => Promise<void>;
  readonly onRerunQuantize: () => Promise<void>;
  readonly onToggleExecutionMode: (mode: SessionExecutionMode) => Promise<void>;
  readonly onDrainUnreadQueue: () => Promise<void>;
}

const SLASH_COMMANDS: readonly {
  readonly cmd: string;
  readonly desc: string;
  readonly route: 'collab' | 'turn' | 'demo';
  readonly turnAction?: 'decompose' | 'execute' | 'ship';
  readonly openTab?: WorkspaceTabId;
  readonly template: string;
}[] = [
  {
    cmd: '/prd',
    desc: '唤醒产品分析官与协调人补充并修订 PRD 共编文档',
    route: 'collab',
    openTab: 'doc',
    template: '/prd ',
  },
  {
    cmd: '/spec',
    desc: '从当前 PRD 实时编译生成结构化 Spec 契约并同步白板',
    route: 'collab',
    openTab: 'doc',
    template: '/spec 从当前 PRD 同步结构化 Spec',
  },
  {
    cmd: '/whiteboard',
    desc: '召唤系统架构师在右侧白板绘制系统边界与模块拓扑',
    route: 'collab',
    openTab: 'board',
    template: '/whiteboard ',
  },
  {
    cmd: '/mockup',
    desc: '召唤 UI 原型师生成可直接预览与编辑源码的 HTML 交互界面',
    route: 'collab',
    openTab: 'preview',
    template: '/mockup ',
  },
  {
    cmd: '/review',
    desc: '召集独立审校官评审当前需求歧义与架构边界风险',
    route: 'collab',
    openTab: 'doc',
    template: '/review 请核对当前 PRD 与架构风险',
  },
  {
    cmd: '/schedule',
    desc: '创建周期巡检任务，定时追踪未关闭讨论与文档变更',
    route: 'collab',
    template: '/schedule 每2小时 巡检未决评论与文档一致性',
  },
  {
    cmd: '/decompose',
    desc: '基于已确认 Spec 拆解多内核并行研发任务树',
    route: 'turn',
    turnAction: 'decompose',
    openTab: 'tasks',
    template: '/decompose',
  },
  {
    cmd: '/execute',
    desc: '为各并行任务分配独立工作树并触发多智能体编码',
    route: 'turn',
    turnAction: 'execute',
    openTab: 'code',
    template: '/execute',
  },
  {
    cmd: '/ship',
    desc: '触发编码与审校分离的交叉验收并生成交互报告',
    route: 'turn',
    turnAction: 'ship',
    openTab: 'verify',
    template: '/ship',
  },
];

function repoShortName(pathStr?: string): string {
  if (!pathStr || pathStr === '.') {
    return '本地工作区';
  }
  const parts = pathStr.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '本地工作区';
}

function renderWithMentions(text: string): ReactNode {
  const parts = text.split(
    /(@[A-Za-z0-9_-]+|\/(?:prd|spec|whiteboard|mockup|review|schedule|decompose|execute|ship))/gi,
  );
  return parts.map((part, idx) =>
    part.startsWith('@') || part.startsWith('/') ? (
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
    <div className="sd-post-body">
      {paragraphs.map((p, idx) => (
        <p
          key={idx}
          style={{
            margin: idx === 0 ? 0 : '6px 0 0',
            whiteSpace: 'pre-wrap',
          }}
        >
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
            <span className="mp-chat-title">协同执行轨迹</span>
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

function LegacyDecisionCard({
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

  const buildAnswers = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const q of grilling.questions) {
      out[q.id] = selected[q.id] ?? q.defaultOptionId;
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
          <span>需求关键分叉投票 · 第 {grilling.round} 轮</span>
        </span>
        <span className="mp-decision-caption">
          {grilling.resolved ? '已确认' : `${grilling.questions.length} 项决策`}
        </span>
      </div>

      <div className="mp-decision-body">
        <p className="mp-decision-question">{grilling.title}</p>
        {grilling.summary ? (
          <p className="mp-decision-hint">{grilling.summary}</p>
        ) : null}

        {grilling.questions.map((q, idx) => {
          const cur = selected[q.id] ?? q.defaultOptionId;
          return (
            <div key={q.id} style={{marginBottom: 10}}>
              <p className="mp-decision-question" style={{fontSize: 13}}>
                {/^Q\d+/i.test(q.label) ? q.label : `Q${idx + 1}. ${q.label}`}
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
                            <span className="sd-pill" style={{marginLeft: 6}}>
                              推荐方案
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
          重算权重评估
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
            仅提交意见
          </button>
          <button
            type="button"
            className="mp-decision-button is-primary"
            disabled={busy || grilling.resolved}
            onClick={() => void onSubmit(messageId, buildAnswers(), true, true)}
          >
            采纳推荐并同步 Spec
          </button>
        </div>
      </div>
    </section>
  );
}

export function MasterChatPane({
  session,
  specRevision = 0,
  messages,
  posts,
  channels,
  agents,
  collabDoc,
  pins,
  diffs,
  unreadQueue,
  taskCount,
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
  onSelectChannel,
  onToggleTab,
  onOpenTab,
  onOpenSettings,
  onSendTurn,
  onPostMessage,
  onReactPost,
  onToggleResolveThread,
  onSelectPollOption,
  onSaveMockupHtml,
  onSubmitGrilling,
  onRerunQuantize,
  onToggleExecutionMode,
  onDrainUnreadQueue,
}: MasterChatPaneProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);
  const [worktreeEnabled, setWorktreeEnabled] = useState(true);
  const [mockupInputOpen, setMockupInputOpen] = useState(false);
  const [mockupTitleDraft, setMockupTitleDraft] = useState('交互原型草稿.html');
  const [mockupHtmlDraft, setMockupHtmlDraft] = useState(
    '<div style="font-family:sans-serif;padding:16px"><h3>交互原型草稿</h3><p>在这里粘贴 HTML 片段，发送后团队成员与智能体可直接在聊天与预览面板查看。</p><button style="padding:8px 14px;border-radius:8px;border:0;background:#141413;color:#fff">主要操作</button></div>',
  );
  const [pendingAttachments, setPendingAttachments] = useState<
    PostAttachment[]
  >([]);

  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!prefillMention) {
      return;
    }
    const handle = prefillMention.handle.startsWith('@')
      ? prefillMention.handle
      : `@${prefillMention.handle}`;
    setDraft(prev => {
      if (prev.includes(handle)) {
        return prev;
      }
      return prev.trim() ? `${handle} ${prev}` : `${handle} `;
    });
    inputRef.current?.focus();
  }, [prefillMention]);

  const displayChannels = useMemo(() => {
    if (channels.length > 0) {
      return channels.map(ch => ({
        id: ch.id,
        slug: ch.slug,
        title: ch.title,
        subtitle: ch.description,
      }));
    }
    return CHANNELS.map(ch => ({
      id: ch.id,
      slug: ch.id,
      title: ch.name,
      subtitle: ch.subtitle,
    }));
  }, [channels]);

  const currentChannel =
    displayChannels.find(
      c => c.id === activeChannel || c.slug === activeChannel,
    ) ?? displayChannels[0];

  const channelTopPosts = useMemo(() => {
    const channelIdsMatch = new Set(
      [currentChannel?.id, currentChannel?.slug].filter(Boolean),
    );
    const matching = posts.filter(
      p => !p.parentPostId && channelIdsMatch.has(p.channelId),
    );
    if (matching.length > 0) return matching;
    return posts.filter(p => !p.parentPostId);
  }, [posts, currentChannel]);

  const replyCountByRoot = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of posts) {
      if (p.parentPostId) {
        counts.set(p.parentPostId, (counts.get(p.parentPostId) ?? 0) + 1);
      }
    }
    return counts;
  }, [posts]);

  const hasContent =
    Boolean(session) && (channelTopPosts.length > 0 || messages.length > 0);

  useEffect(() => {
    if (hasContent) {
      streamEndRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
    }
  }, [channelTopPosts.length, messages.length, busy, hasContent]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent): void => {
      if (
        composerRef.current &&
        !composerRef.current.contains(e.target as Node)
      ) {
        setSlashOpen(false);
        setMentionOpen(false);
        setPlusMenuOpen(false);
        setModeMenuOpen(false);
      }
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setThreadMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, []);

  const coordinator =
    agents.find(a => a.roleKey === 'coordinator') ?? agents[0];

  // Context token gauge computation mapped to native circular ring (0..100%)
  const estimatedTokensK = useMemo(() => {
    const postChars = posts.reduce((sum, p) => sum + p.content.length, 0);
    const docChars =
      collabDoc?.blocks.reduce((sum, b) => sum + b.markdown.length, 0) ?? 0;
    const msgChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (postChars + docChars + msgChars === 0) return 0;
    return Math.max(4, Math.round((postChars + docChars + msgChars) / 280));
  }, [posts, collabDoc, messages]);

  const ringPercent =
    estimatedTokensK === 0
      ? 0
      : Math.min(98, Math.max(4, Math.round((estimatedTokensK / 200) * 100)));

  const queuedUnreadCount = unreadQueue.filter(
    q => q.status === 'queued',
  ).length;

  const handleFileAttach = (
    e: ChangeEvent<HTMLInputElement>,
    kind: 'image' | 'video',
  ): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (!url) return;
      setPendingAttachments(prev => [
        ...prev,
        {
          id: `att-${Date.now()}`,
          kind,
          title: file.name,
          subtitle: kind === 'image' ? '设计图 / 界面截图' : '功能演示视频',
          url,
        },
      ]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
    setPlusMenuOpen(false);
  };

  const attachDraftMockup = (): void => {
    setPendingAttachments(prev => [
      ...prev,
      {
        id: `att-html-${Date.now()}`,
        kind: 'html_mockup',
        title: mockupTitleDraft.trim() || '交互原型草稿.html',
        subtitle: '富交互 HTML 草稿 · 发送后可预览编辑源码',
        htmlContent: mockupHtmlDraft,
      },
    ]);
    setMockupInputOpen(false);
    setPlusMenuOpen(false);
  };

  const handleSubmit = async (): Promise<void> => {
    const trimmed = draft.trim();
    if ((!trimmed && pendingAttachments.length === 0) || busy) {
      return;
    }
    const attachmentsToSend = [...pendingAttachments];
    setDraft('');
    setPendingAttachments([]);
    setSlashOpen(false);
    setMentionOpen(false);

    const lower = trimmed.toLowerCase();
    const matchedSlash = SLASH_COMMANDS.find(
      c => lower === c.cmd || lower.startsWith(`${c.cmd} `),
    );
    if (matchedSlash?.route === 'turn' && matchedSlash.turnAction) {
      if (matchedSlash.openTab) {
        onOpenTab(matchedSlash.openTab);
      }
      await onSendTurn(trimmed, {action: matchedSlash.turnAction});
      return;
    }

    if (matchedSlash?.openTab) {
      onOpenTab(matchedSlash.openTab);
    }

    await onPostMessage({
      channelId: currentChannel?.id ?? activeChannel,
      content:
        trimmed ||
        (attachmentsToSend.length > 0
          ? '请大家查看并评审以下附带的媒体素材与原型。'
          : ''),
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
    });
  };

  const handleDraftChange = (val: string): void => {
    setDraft(val);
    if (val.startsWith('/')) {
      setSlashOpen(true);
      setSlashFilter(val.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '');
      setMentionOpen(false);
    } else {
      setSlashOpen(false);
    }
    const lastWord = val.split(/\s+/).pop() ?? '';
    if (lastWord.startsWith('@') && !val.startsWith('/')) {
      setMentionOpen(true);
    } else if (!val.endsWith('@')) {
      setMentionOpen(false);
    }
  };

  const filteredSlash = SLASH_COMMANDS.filter(
    c => !slashFilter || c.cmd.slice(1).includes(slashFilter),
  );

  // Stage progression indicators
  const hasDiscussion = channelTopPosts.length > 0;
  const hasPrdEdits = (collabDoc?.revision ?? 0) > 1;
  const hasSpecSynced = specRevision > 0;
  const hasExecution = taskCount > 0 || diffs.length > 0;

  const executionMode: SessionExecutionMode = session?.executionMode ?? 'auto';
  const executionLabel =
    executionMode === 'live'
      ? '实时 CLI'
      : executionMode === 'local'
        ? '仅本地规则'
        : '自动协同';
  const repoName = repoShortName(session?.workspacePath);

  const headerToggles: readonly {
    readonly tab: WorkspaceTabId;
    readonly icon: string;
    readonly label: string;
  }[] = [
    {tab: 'doc', icon: 'BookText', label: 'PRD 与 Spec 实时共编'},
    {tab: 'thread', icon: 'Chat', label: '聚焦讨论线程'},
    {tab: 'board', icon: 'Palette', label: '交互式白板画布'},
    {tab: 'preview', icon: 'Globe', label: '交互原型与富媒体预览'},
    {tab: 'code', icon: 'ChangesPlusMinus', label: '代码变更与目录'},
    {tab: 'verify', icon: 'CheckCircle', label: '交叉审校与验收报告'},
  ];

  const composerSeat = (
    <div className="mpw-composer-seat" ref={composerRef}>
      <div className="mpw-composer-stack">
        {/* Pending Attachments Preview */}
        {pendingAttachments.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginBottom: 4,
            }}
          >
            {pendingAttachments.map(att => (
              <span key={att.id} className="sd-pill">
                <span>
                  {att.kind === 'html_mockup'
                    ? 'HTML 原型'
                    : att.kind === 'image'
                      ? '图片'
                      : '视频'}
                  ：{att.title}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingAttachments(prev =>
                      prev.filter(x => x.id !== att.id),
                    )
                  }
                  style={{
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'inherit',
                    padding: '0 2px',
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {/* Optional inline HTML Mockup composer card */}
        {mockupInputOpen ? (
          <div
            className="sd-card"
            style={{
              marginBottom: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              className="sd-toolbar-row"
              style={{justifyContent: 'space-between'}}
            >
              <strong style={{fontSize: 12}}>
                附加可直接预览与编辑的 HTML 原型
              </strong>
              <button
                type="button"
                className="sd-btn"
                onClick={() => setMockupInputOpen(false)}
              >
                关闭
              </button>
            </div>
            <input
              className="sd-input"
              value={mockupTitleDraft}
              onChange={e => setMockupTitleDraft(e.target.value)}
              placeholder="原型标题，例如：审批控制台.html"
            />
            <textarea
              className="sd-textarea"
              rows={3}
              style={{fontFamily: 'var(--mp-font-mono)', fontSize: 11}}
              value={mockupHtmlDraft}
              onChange={e => setMockupHtmlDraft(e.target.value)}
            />
            <div
              className="sd-toolbar-row"
              style={{justifyContent: 'flex-end'}}
            >
              <button
                type="button"
                className="sd-btn is-primary"
                onClick={attachDraftMockup}
              >
                挂载到消息
              </button>
            </div>
          </div>
        ) : null}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{display: 'none'}}
          onChange={e => handleFileAttach(e, 'image')}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          style={{display: 'none'}}
          onChange={e => handleFileAttach(e, 'video')}
        />

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
            <span>{session ? repoName : '选择项目目录…'}</span>
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
              <span className="mp-composer-git-divider" aria-hidden="true" />
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
            title="打开本地目录"
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
                  <div
                    className="mpw-grow"
                    style={{minWidth: 0, flex: '1 1 0%', overflow: 'hidden'}}
                  >
                    <textarea
                      ref={inputRef}
                      data-testid="v4-composer-input"
                      className="mpw-input"
                      style={{paddingRight: 50}}
                      rows={1}
                      maxLength={12000}
                      value={draft}
                      disabled={busy}
                      onChange={e => handleDraftChange(e.target.value)}
                      onKeyDown={e => {
                        if (
                          e.key === 'Enter' &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          void handleSubmit();
                        }
                      }}
                      placeholder={
                        hasContent
                          ? `在 #${currentChannel?.title ?? '需求讨论'} 讨论，@ 成员或 /prd /mockup …`
                          : '描述你的软件构想或业务需求，输入 /prd /mockup 或直接开始多人共创…'
                      }
                      aria-label="Message input"
                    />
                  </div>

                  <button
                    type="submit"
                    data-testid="v4-send-btn"
                    className={`mpw-primary ${busy ? 'is-stop' : ''}`}
                    title={busy ? '处理中…' : '发送消息'}
                    aria-label={busy ? '处理中' : '发送消息'}
                    disabled={
                      busy || (!draft.trim() && pendingAttachments.length === 0)
                    }
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
                    aria-label="Attach media or command"
                    title="附加截图、视频、HTML 原型或工程目录"
                    aria-expanded={plusMenuOpen}
                    onClick={() => {
                      setMentionOpen(false);
                      setSlashOpen(false);
                      setPlusMenuOpen(prev => !prev);
                    }}
                  >
                    <CdsIcon name="Add" size="small" />
                  </button>

                  <button
                    type="button"
                    className="mpw-add"
                    id="composer-at-trigger"
                    aria-label="Mention teammate"
                    title="@ 召唤团队角色"
                    aria-expanded={mentionOpen}
                    onClick={() => {
                      setSlashOpen(false);
                      setPlusMenuOpen(false);
                      setMentionOpen(prev => !prev);
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        lineHeight: 1,
                      }}
                    >
                      @
                    </span>
                  </button>

                  <button
                    type="button"
                    className="mpw-add"
                    id="composer-slash"
                    aria-label="Workflow commands"
                    title="工作流快捷指令 (/prd /spec /whiteboard /mockup /ship)"
                    aria-expanded={slashOpen}
                    onClick={() => {
                      setSlashOpen(false);
                      setPlusMenuOpen(false);
                      setSlashOpen(prev => !prev);
                      setSlashFilter('');
                    }}
                  >
                    <CdsIcon name="CommandLinePrompt" size="small" />
                  </button>

                  {plusMenuOpen ? (
                    <div
                      className="mpw-perm-menu"
                      role="menu"
                      style={{bottom: 36, left: 0, width: 220}}
                    >
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                      >
                        <span>附加设计截图 / 图片…</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => videoInputRef.current?.click()}
                      >
                        <span>附加功能演示视频…</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMockupInputOpen(true);
                          setPlusMenuOpen(false);
                        }}
                      >
                        <span>附带实时交互 HTML 原型</span>
                      </button>
                      <hr />
                      <button
                        type="button"
                        onClick={() => {
                          setPlusMenuOpen(false);
                          void onOpenFolderPrompt();
                        }}
                      >
                        <span>接入本地代码目录…</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlusMenuOpen(false);
                          void onDemoRun();
                        }}
                      >
                        <span>一键初始化协同示例</span>
                      </button>
                    </div>
                  ) : null}

                  {mentionOpen ? (
                    <div
                      className="mpw-model-menu"
                      role="listbox"
                      aria-label="Mention team member"
                      style={{bottom: 36, left: 32, minWidth: 260}}
                    >
                      {agents.map(agent => (
                        <button
                          key={agent.id}
                          type="button"
                          className="mpw-model-row"
                          onClick={() => {
                            setMentionOpen(false);
                            setDraft(prev => {
                              const cleaned = prev.endsWith('@')
                                ? prev.slice(0, -1)
                                : prev;
                              return cleaned.trim()
                                ? `${cleaned.trim()} ${agent.handle} `
                                : `${agent.handle} `;
                            });
                            inputRef.current?.focus();
                          }}
                        >
                          <AgentBrandIcon
                            kernelId={resolveBrandForAgent({
                              avatarKey: agent.avatarKey,
                              bindingKind: agent.bindingKind,
                              providerId: agent.providerId,
                              harnessId: agent.harnessId,
                            })}
                            theme={theme}
                            size={16}
                          />
                          <span className="mpw-model-name">
                            {agent.displayName} ({agent.handle})
                          </span>
                          <span className="mpw-model-key">
                            {agent.resolvedModelLabel}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {slashOpen ? (
                    <div className="mpw-add-menu mpw-slash-menu" role="menu">
                      <input
                        type="search"
                        value={slashFilter}
                        onChange={e => setSlashFilter(e.target.value)}
                        placeholder="筛选指令 (/prd /spec /whiteboard /mockup /ship…)"
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
                              setDraft(item.template);
                              inputRef.current?.focus();
                            }}
                          >
                            <span className="mpw-slash-text">
                              <span className="mpw-slash-name">{item.cmd}</span>
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
                    aria-expanded={modeMenuOpen}
                    title="切换执行模式"
                    onClick={() => setModeMenuOpen(prev => !prev)}
                  >
                    <CdsIcon
                      name="CaretDownSmall"
                      size="xs"
                      className="mpw-perm-chev"
                    />
                    <span className="mpw-perm-label">{executionLabel}</span>
                  </button>

                  {modeMenuOpen ? (
                    <div
                      className="mpw-perm-menu"
                      role="listbox"
                      style={{bottom: 36, left: 96}}
                    >
                      {(
                        [
                          {id: 'auto', label: '自动协同 (Auto)'},
                          {id: 'live', label: '实时 CLI (Live)'},
                          {id: 'local', label: '仅本地沙箱 (Local)'},
                        ] as const
                      ).map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setModeMenuOpen(false);
                            void onToggleExecutionMode(opt.id);
                          }}
                        >
                          <span>{opt.label}</span>
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
                    title="点击配置协调人及团队各角色的模型供应商与路由策略"
                    onClick={() => onOpenSettings('models')}
                  >
                    {coordinator ? (
                      <AgentBrandIcon
                        kernelId={resolveBrandForAgent({
                          avatarKey: coordinator.avatarKey,
                          bindingKind: coordinator.bindingKind,
                          providerId: coordinator.providerId,
                          harnessId: coordinator.harnessId,
                        })}
                        theme={theme}
                        size={14}
                      />
                    ) : null}
                    <span
                      className="mpw-perm-label"
                      style={{
                        maxWidth: 148,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {coordinator?.resolvedModelLabel ?? '模型绑定'}
                    </span>
                    <CdsIcon
                      name="CaretDownSmall"
                      size="xs"
                      className="mpw-perm-chev"
                    />
                  </button>

                  <button
                    type="button"
                    className="mpw-ring"
                    id="composer-context"
                    aria-label={`上下文容量 ${ringPercent}%`}
                    title={`当前对话与共编 PRD 上下文约 ${estimatedTokensK}k / 200k tokens (${ringPercent}%)`}
                    data-empty={ringPercent === 0 ? 'true' : undefined}
                    onClick={() => onOpenTab('doc')}
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
  );

  return (
    <section
      className="mpw-conversation"
      id="view-chat"
      data-home={!hasContent ? 'true' : 'false'}
      data-has-messages={hasContent ? 'true' : 'false'}
      data-testid="v4-master-chat"
    >
      <header className="mpw-header" ref={headerRef}>
        <div className="mpw-title-row">
          <div className="mpw-title-cluster">
            {session?.mode === 'team' ? (
              <span className="sd-header-channel-pill">
                #{currentChannel?.title ?? '需求讨论'}
              </span>
            ) : (
              <CdsIcon name="Laptop" size="small" />
            )}
            <b className="mpw-title" id="chat-title">
              {session?.title ?? '新建协同会话'}
            </b>
            {session ? (
              <span className="mp-chat-project">
                <span>{repoName}</span>
              </span>
            ) : null}
          </div>

          <div className="mpw-header-actions">
            {queuedUnreadCount > 0 ? (
              <button
                type="button"
                className="sd-btn"
                disabled={busy}
                onClick={() => void onDrainUnreadQueue()}
                title="唤醒并处理待响应的 @提及 队列"
              >
                <span>待唤醒 {queuedUnreadCount}</span>
              </button>
            ) : null}

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
            style={{top: 44, right: 16}}
          >
            <button
              type="button"
              onClick={() => {
                setThreadMenuOpen(false);
                void onDemoRun();
              }}
            >
              <span>一键初始化协同示例</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setThreadMenuOpen(false);
                void onOpenFolderPrompt();
              }}
            >
              <span>关联本地代码目录</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setThreadMenuOpen(false);
                onOpenSettings('models');
              }}
            >
              <span>配置模型供应商与角色绑定…</span>
            </button>
          </div>
        ) : null}
      </header>

      {/* Channel switcher + Clear Collaboration Flow Indicator */}
      {hasContent ? (
        <div className="sd-collab-flow">
          <div className="sd-channel-pills">
            {displayChannels.map(ch => {
              const isOn = currentChannel?.id === ch.id;
              const count = posts.filter(
                p => !p.parentPostId && p.channelId === ch.id,
              ).length;
              return (
                <button
                  key={ch.id}
                  type="button"
                  className={`sd-channel-tab ${isOn ? 'is-active' : ''}`}
                  onClick={() => onSelectChannel(ch.id)}
                >
                  <span># {ch.title}</span>
                  {count > 0 ? (
                    <span style={{opacity: 0.65}}>{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="sd-flow-steps">
            <span
              className={`sd-flow-step ${hasDiscussion ? 'is-done' : 'is-current'}`}
            >
              <span className="sd-flow-dot" />
              <span>1. 群组讨论</span>
            </span>
            <button
              type="button"
              className={`sd-flow-step ${hasPrdEdits ? 'is-done' : hasDiscussion ? 'is-current' : ''}`}
              onClick={() => onOpenTab('doc')}
            >
              <span className="sd-flow-dot" />
              <span>2. 共编 PRD (Rev {collabDoc?.revision ?? 1})</span>
            </button>
            <button
              type="button"
              className={`sd-flow-step ${hasSpecSynced ? 'is-done' : ''}`}
              onClick={() => onOpenTab('board')}
            >
              <span className="sd-flow-dot" />
              <span>3. Spec ({specRevision}) · 白板</span>
            </button>
            <button
              type="button"
              className={`sd-flow-step ${hasExecution ? 'is-done' : ''}`}
              onClick={() => onOpenTab('tasks')}
            >
              <span className="sd-flow-dot" />
              <span>
                4. 研发验收 ({pins.filter(p => p.status !== 'resolved').length}{' '}
                批注)
              </span>
            </button>
          </div>
        </div>
      ) : null}

      <div className="mpw-scrollbody">
        {errorText ? (
          <div
            style={{
              width: 'min(768px, calc(100% - 32px))',
              margin: '8px auto 0',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--mp-rule-strong)',
              background: 'var(--mp-sidebar)',
              color: 'var(--mp-text)',
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

        {!hasContent ? (
          /* Serene Magic-Pointer Home: heading + composer + quiet 1-line hint centered */
          <>
            <section
              className="mp-studio-home"
              id="studio-home"
              aria-label="Studio home"
              data-testid="v4-home-empty"
            >
              <header className="mp-home-heading">
                <StarburstMark size={26} spinning={busy} />
                <h1 id="studio-home-title">今天团队要一起推进什么软件？</h1>
              </header>
            </section>
            {composerSeat}
            <div className="sd-home-quiet-hint">
              <button
                type="button"
                data-testid="v4-demo-run-btn"
                disabled={busy}
                onClick={() => void onDemoRun()}
              >
                一键开启多人协同示例
              </button>
              {' · '}
              <button
                type="button"
                data-testid="v4-open-folder-btn"
                disabled={busy}
                onClick={() => void onOpenFolderPrompt()}
              >
                接入本地项目目录
              </button>
              {' · '}
              <button type="button" onClick={() => onOpenSettings('models')}>
                配置模型与团队角色 ({agents.length || 6})
              </button>
            </div>
          </>
        ) : (
          /* Slack/X-style Multi-Human + Multi-Agent Channel Stream */
          <div className="mpw-stream" id="stream">
            <div className="mpw-blank" aria-hidden="true" />
            <div className="mp-chat-flow" data-testid="v4-chat-stream">
              {channelTopPosts.map(post => {
                const count =
                  replyCountByRoot.get(post.id) ?? post.replyCount ?? 0;
                return (
                  <article
                    key={post.id}
                    className="sd-post-card"
                    data-testid={`collab-post-${post.id}`}
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: post.authorColor,
                    }}
                  >
                    <div className="sd-post-head">
                      <AgentBrandIcon
                        kernelId={
                          post.authorKind === 'human'
                            ? 'human'
                            : resolveBrandForAgent({
                                avatarKey: post.authorAvatar,
                              })
                        }
                        theme={theme}
                        size={20}
                        framed
                      />
                      <strong className="sd-post-author">
                        {post.authorName}
                      </strong>
                      <span className="sd-post-model">{post.modelLabel}</span>
                      {post.threadStatus === 'resolved' ? (
                        <span className="sd-pill is-success">已解决</span>
                      ) : null}
                      <span className="sd-post-time">
                        {new Date(post.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {renderMessageText(post.content)}

                    {post.attachments.map(att => (
                      <RichMediaAttachment
                        key={att.id}
                        postId={post.id}
                        attachment={att}
                        busy={busy}
                        onOpenTab={onOpenTab}
                        onSelectPollOption={onSelectPollOption}
                        onSaveMockupHtml={onSaveMockupHtml}
                      />
                    ))}

                    <div className="sd-post-footer">
                      {(['👍', '👀', '✅'] as const).map(emoji => {
                        const existing = post.reactions.find(
                          r => r.emoji === emoji,
                        );
                        return (
                          <button
                            key={emoji}
                            type="button"
                            className={`sd-reaction-chip ${existing?.byViewer ? 'is-on' : ''}`}
                            onClick={() => void onReactPost(post.id, emoji)}
                          >
                            <span>{emoji}</span>
                            {existing && existing.count > 0 ? (
                              <span>{existing.count}</span>
                            ) : null}
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        className="sd-thread-btn"
                        data-testid={`open-thread-${post.id}`}
                        onClick={() => onOpenTab('thread', {threadId: post.id})}
                      >
                        <CdsIcon name="Chat" size="xs" />
                        <span>
                          {count > 0
                            ? `${count} 条回复 · 在右侧展开线程`
                            : '展开线程讨论'}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="sd-btn"
                        style={{height: 24, padding: '0 8px', fontSize: 11}}
                        onClick={() =>
                          void onToggleResolveThread(
                            post.id,
                            post.threadStatus === 'resolved'
                              ? 'open'
                              : 'resolved',
                          )
                        }
                      >
                        {post.threadStatus === 'resolved'
                          ? '重新打开'
                          : '标记解决'}
                      </button>
                    </div>
                  </article>
                );
              })}

              {/* Kernel Execution Traces & Voting (when triggered by /decompose /execute /ship) */}
              {messages
                .filter(
                  m =>
                    Boolean(m.grilling) ||
                    (m.traceItems && m.traceItems.length > 0),
                )
                .map(msg => (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {msg.traceItems && msg.traceItems.length > 0 ? (
                      <TraceDisclosure
                        items={msg.traceItems}
                        summary={msg.content.slice(0, 72)}
                      />
                    ) : null}
                    {msg.grilling ? (
                      <LegacyDecisionCard
                        messageId={msg.id}
                        grilling={msg.grilling}
                        busy={busy}
                        onSubmit={onSubmitGrilling}
                        onRerunQuantize={onRerunQuantize}
                      />
                    ) : null}
                  </div>
                ))}

              {busy ? (
                <div className="mp-chat-turn-status">
                  <span className="mp-chat-thinking-mark">
                    <StarburstMark size={16} spinning />
                  </span>
                  <span className="mp-chat-turn-status-copy">
                    <span className="mp-chat-turn-status-label">
                      正在协调团队智能体回复与实时更新共编文档…
                    </span>
                  </span>
                </div>
              ) : null}

              <div ref={streamEndRef} />
            </div>
          </div>
        )}
      </div>

      {hasContent ? composerSeat : null}
    </section>
  );
}

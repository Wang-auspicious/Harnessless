import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import {v4Api} from '../api/v4-client.ts';
import type {
  BoardSceneDoc,
  HostedAppCard,
  KanoAhpInputItem,
  KernelId,
  MasterSession,
  NativeKernelCard,
  SessionExecutionMode,
  SessionMode,
  ShipReviewFinding,
  TaskMutation,
  TaskNodeRole,
  V4SessionDetail,
  WorkspaceTabId,
} from '../api/v4-types.ts';
import {CdsIcon} from '../components/v4/CdsIcon.tsx';
import {
  FeedbackTriageView,
  type TriageTopic,
} from '../components/v4/FeedbackTriageView.tsx';
import {LibraryViews} from '../components/v4/LibraryViews.tsx';
import {MasterChatPane} from '../components/v4/MasterChatPane.tsx';
import {RightWorkspacePane} from '../components/v4/RightWorkspacePane.tsx';
import {
  DEFAULT_PREFERENCES,
  SettingsModal,
  type SettingsPageId,
  type StudioPreferences,
} from '../components/v4/SettingsModal.tsx';
import {
  CHANNELS,
  StudioSidebar,
  type ChannelId,
  type SidebarNavView,
} from '../components/v4/StudioSidebar.tsx';
import {TitleBar} from '../components/v4/TitleBar.tsx';
import {kernelLabel} from '../components/v4/v4-labels.ts';
import '../styles/mp/index.ts';

export interface ForgeStudioAppProps {
  readonly onSwitchToLegacy: () => void;
}

const DEFAULT_ROUTING: Record<TaskNodeRole, KernelId> = {
  architect: 'claude-code',
  coder: 'codex',
  tester: 'gemini-cli',
  reviewer: 'claude-code',
  steward: 'native-api',
};

const SEED_TRIAGE_TOPICS: readonly TriageTopic[] = [
  {
    id: 'triage-seed-1',
    title: 'Worktree 并行执行完成前禁止 Reviewer 使用相同内核触发 Ship 自批',
    category: 'verification',
    status: 'open',
    severity: 'critical',
    author: 'claude-code',
    participants: ['claude-code', 'codex', 'master'],
    votes: 6,
    tags: ['ship', 'anti-self-approval', 'http-409'],
    body: '当编码内核为 Codex 时，Ship 审校门禁须自动锁定独立内核（Claude Code / Gemini CLI）执行跨内核复核，避免自写自审。',
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    replies: [
      {
        id: 'seed-r1',
        author: 'master',
        body: 'Enforced 模式已在后端 /api/v4/sessions/:id/ship 返回 HTTP 409 并前端提示三权隔离盾牌。',
        createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    id: 'triage-seed-2',
    title: 'Excalidraw 白板模块拖拽后双向同步更新 Spec IR boundaryPseudocode',
    category: 'architecture',
    status: 'open',
    severity: 'medium',
    author: 'master',
    participants: ['human', 'master'],
    votes: 4,
    tags: ['excalidraw', 'spec-ir', 'pin'],
    body: '白板节点移动或插入评论 Pin 时，保持坐标锚点随缩放视图自动重算，并直接注入 Master Agent 决策队列。',
    createdAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    replies: [],
  },
];

function readInitialTheme(): 'light' | 'dark' {
  try {
    const saved = window.localStorage.getItem('forgeops.v4.theme');
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch {
    // Ignore storage read errors.
  }
  return 'light';
}

function readPreferences(): StudioPreferences {
  try {
    const raw = window.localStorage.getItem('forgeops.v4.prefs');
    if (raw) {
      return {...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as object)};
    }
  } catch {
    // Ignore storage errors.
  }
  return DEFAULT_PREFERENCES;
}

function readTriageTopics(): readonly TriageTopic[] {
  try {
    const raw = window.localStorage.getItem('forgeops.v4.triage.topics');
    if (raw) {
      const parsed = JSON.parse(raw) as TriageTopic[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage errors.
  }
  return SEED_TRIAGE_TOPICS;
}

interface NavHistoryEntry {
  readonly nav: SidebarNavView;
  readonly sessionId: string | null;
}

export function ForgeStudioApp({
  onSwitchToLegacy,
}: ForgeStudioAppProps): ReactElement {
  const [theme, setTheme] = useState<'light' | 'dark'>(readInitialTheme);
  const [preferences, setPreferences] =
    useState<StudioPreferences>(readPreferences);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeNav, setActiveNav] = useState<SidebarNavView>('chat');
  const [activeChannel, setActiveChannel] = useState<ChannelId>('general');
  const [prefillMention, setPrefillMention] = useState<{
    readonly kernelId: KernelId;
    readonly nonce: number;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPageId>('general');
  const [preferredMode, setPreferredMode] = useState<SessionMode>(
    preferences.defaultMode,
  );
  const [catchupOnly, setCatchupOnly] = useState(false);

  const [sessions, setSessions] = useState<readonly MasterSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<V4SessionDetail | null>(null);
  const [kernels, setKernels] = useState<readonly NativeKernelCard[]>([]);
  const [roleRouting, setRoleRouting] =
    useState<Record<TaskNodeRole, KernelId>>(DEFAULT_ROUTING);
  const [hostedApps, setHostedApps] = useState<readonly HostedAppCard[]>([]);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [triageTopics, setTriageTopics] =
    useState<readonly TriageTopic[]>(readTriageTopics);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('board');
  const [rightWidthPx, setRightWidthPx] = useState(560);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  const [navHistory, setNavHistory] = useState<readonly NavHistoryEntry[]>([
    {nav: 'chat', sessionId: null},
  ]);
  const [navCursor, setNavCursor] = useState(0);

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selfApprovalBlockedMsg, setSelfApprovalBlockedMsg] = useState<
    string | null
  >(null);

  const dragStartRef = useRef<{
    readonly x: number;
    readonly width: number;
  } | null>(null);
  const smokeHandledRef = useRef(false);

  useEffect(() => {
    document.body.classList.add('studio');
    return () => {
      document.body.classList.remove('studio');
      document.body.removeAttribute('data-ds-dark-theme');
      delete document.documentElement.dataset['theme'];
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
    void window.forgeops?.setWindowTheme?.(theme);
  }, [theme]);

  const persistTopics = (next: readonly TriageTopic[]): void => {
    setTriageTopics(next);
    try {
      window.localStorage.setItem(
        'forgeops.v4.triage.topics',
        JSON.stringify(next),
      );
    } catch {
      // Ignore quota errors.
    }
  };

  const pushHistory = useCallback(
    (entry: NavHistoryEntry) => {
      setNavHistory(prev => {
        const sliced = prev.slice(0, navCursor + 1);
        const last = sliced[sliced.length - 1];
        if (
          last &&
          last.nav === entry.nav &&
          last.sessionId === entry.sessionId
        ) {
          return prev;
        }
        const next = [...sliced, entry];
        setNavCursor(next.length - 1);
        return next;
      });
    },
    [navCursor],
  );

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    try {
      const next = await v4Api.getSession(sessionId);
      setDetail(next);
      setPreferredMode(next.session.mode);
      setErrorText(null);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const boot = await v4Api.getBootstrap();
      setSessions(boot.sessions);
      setKernels(boot.kernels);
      setRoleRouting({...DEFAULT_ROUTING, ...boot.roleRouting});
      setHostedApps(boot.hostedApps);
      setPendingApprovalsCount(boot.pendingApprovalsCount);
      setActiveSessionId(prev => {
        if (window.location.hash === '#smoke-home') {
          return null;
        }
        if (prev && boot.sessions.some(s => s.id === prev)) {
          return prev;
        }
        return boot.activeSessionId ?? boot.sessions[0]?.id ?? null;
      });
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  // Smoke verification hashes for clean Electron multi-screen visual audit
  useEffect(() => {
    if (smokeHandledRef.current) {
      return;
    }
    const hash = window.location.hash;
    if (!hash.startsWith('#smoke-')) {
      return;
    }
    smokeHandledRef.current = true;
    setPreferredMode('team');

    if (hash === '#smoke-home') {
      setActiveNav('chat');
      setActiveSessionId(null);
      setDetail(null);
      setInspectorOpen(false);
    } else if (hash === '#smoke-settings') {
      setActiveNav('chat');
      setSettingsPage('models');
      setSettingsOpen(true);
    } else if (hash === '#smoke-triage') {
      setActiveNav('triage');
      setInspectorOpen(false);
      void v4Api
        .demoRun({mode: 'team'})
        .then(next => {
          setDetail(next);
          setActiveSessionId(next.session.id);
          void loadBootstrap();
        })
        .catch(() => {});
    } else if (hash === '#smoke-verify') {
      setActiveNav('chat');
      setInspectorOpen(true);
      setActiveTab('verify');
      setRightWidthPx(640);
      void v4Api
        .demoRun({mode: 'team'})
        .then(next => {
          setDetail(next);
          setActiveSessionId(next.session.id);
          void loadBootstrap();
        })
        .catch(() => {});
    } else if (hash === '#smoke-board' || hash === '#smoke-workspace') {
      setActiveNav('chat');
      setActiveChannel('architecture');
      setInspectorOpen(true);
      setActiveTab('board');
      setRightWidthPx(660);
      void v4Api
        .demoRun({mode: 'team'})
        .then(next => {
          setDetail(next);
          setActiveSessionId(next.session.id);
          void loadBootstrap();
        })
        .catch(() => {});
    }
  }, [loadBootstrap]);

  useEffect(() => {
    if (activeSessionId) {
      void loadSessionDetail(activeSessionId);
    } else {
      setDetail(null);
    }
  }, [activeSessionId, loadSessionDetail]);

  useEffect(() => {
    const unsubscribe = v4Api.subscribeEvents(ev => {
      if (!ev.type.startsWith('v4.')) {
        return;
      }
      void loadBootstrap();
      if (
        activeSessionId &&
        (!ev.sessionId || ev.sessionId === activeSessionId)
      ) {
        void loadSessionDetail(activeSessionId);
      }
    });
    return unsubscribe;
  }, [activeSessionId, loadBootstrap, loadSessionDetail]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(prev => !prev);
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        setInspectorOpen(prev => !prev);
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setInspectorOpen(prev => !prev);
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed(prev => !prev);
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setActiveNav('chat');
        setActiveSessionId(null);
        setDetail(null);
        setInspectorOpen(false);
      } else if (e.key === 'Escape') {
        if (searchOpen) setSearchOpen(false);
        if (settingsOpen) setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen, settingsOpen]);

  useEffect(() => {
    if (!isDraggingSplitter) {
      return;
    }
    const onMove = (e: MouseEvent): void => {
      const start = dragStartRef.current;
      if (!start) {
        return;
      }
      const delta = start.x - e.clientX;
      const maxW = Math.max(360, Math.round(window.innerWidth * 0.72));
      const clamped = Math.min(maxW, Math.max(320, start.width + delta));
      setRightWidthPx(clamped);
    };
    const onUp = (): void => {
      setIsDraggingSplitter(false);
      dragStartRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDraggingSplitter]);

  const changeTheme = (next: 'light' | 'dark'): void => {
    setTheme(next);
    try {
      window.localStorage.setItem('forgeops.v4.theme', next);
    } catch {
      // Ignore storage errors.
    }
  };

  const toggleTheme = (): void => {
    changeTheme(theme === 'light' ? 'dark' : 'light');
  };

  const updatePreferences = (patch: Partial<StudioPreferences>): void => {
    setPreferences(prev => {
      const next = {...prev, ...patch};
      try {
        window.localStorage.setItem('forgeops.v4.prefs', JSON.stringify(next));
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
  };

  const openSettings = (page: SettingsPageId = 'general'): void => {
    setSettingsPage(page);
    setSettingsOpen(true);
  };

  const withBusy = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErrorText(null);
    try {
      await fn();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const applySessionDetail = (next: V4SessionDetail): void => {
    setDetail(next);
    setActiveSessionId(next.session.id);
    setPreferredMode(next.session.mode);
    setHostedApps(prev =>
      next.hostedApps.length > 0 ? next.hostedApps : prev,
    );
    void loadBootstrap();
  };

  const openInspectorTab = (tab: WorkspaceTabId): void => {
    setActiveNav('chat');
    setActiveTab(tab);
    setInspectorOpen(true);
  };

  const toggleInspectorTab = (tab: WorkspaceTabId): void => {
    setActiveNav('chat');
    if (inspectorOpen && activeTab === tab) {
      setInspectorOpen(false);
    } else {
      setActiveTab(tab);
      setInspectorOpen(true);
    }
  };

  const handleSelectChannel = (ch: ChannelId): void => {
    setActiveChannel(ch);
    setActiveNav('chat');
    const meta = CHANNELS.find(c => c.id === ch);
    if (meta?.defaultTab && detail) {
      setActiveTab(meta.defaultTab);
      setInspectorOpen(true);
    }
  };

  const handleMentionAgent = (kernelId: KernelId): void => {
    setActiveNav('chat');
    setPrefillMention({kernelId, nonce: Date.now()});
  };

  const handleFileInTriage = (title: string, kernel: KernelId): void => {
    const newTopic: TriageTopic = {
      id: `triage-${Date.now()}`,
      title: title.slice(0, 96),
      category: 'architecture',
      status: 'open',
      severity: 'medium',
      author: kernel,
      participants: ['human', kernel],
      votes: 1,
      tags: ['from-chat', kernel],
      body: title,
      createdAt: new Date().toISOString(),
      replies: [],
    };
    persistTopics([newTopic, ...triageTopics]);
    setActiveNav('triage');
  };

  const handleSendFindingToTriage = (finding: ShipReviewFinding): void => {
    const newTopic: TriageTopic = {
      id: `triage-finding-${finding.id}-${Date.now()}`,
      title: `[Ship ${finding.severity.toUpperCase()}] ${finding.filePath} — ${finding.summary}`,
      category: finding.category === 'security' ? 'bug' : 'verification',
      status: finding.fixedBySteward ? 'resolved' : 'open',
      severity:
        finding.severity === 'blocker'
          ? 'critical'
          : finding.severity === 'warn'
            ? 'high'
            : 'medium',
      author: 'claude-code',
      participants: ['claude-code', 'master'],
      votes: finding.severity === 'blocker' ? 4 : 2,
      tags: ['ship-finding', finding.category],
      body: `来源：Claude Ship 独立审校\n文件：${finding.filePath}\n摘要：${finding.summary}`,
      createdAt: new Date().toISOString(),
      replies: [],
    };
    persistTopics([newTopic, ...triageTopics]);
    setActiveNav('triage');
  };

  const handleDemoRun = async (): Promise<void> => {
    await withBusy(async () => {
      const next = await v4Api.demoRun({mode: preferredMode});
      applySessionDetail(next);
      setActiveNav('chat');
      setActiveTab('board');
      setInspectorOpen(true);
      pushHistory({nav: 'chat', sessionId: next.session.id});
    });
  };

  const handleOnboardFolder = async (folderPath: string): Promise<void> => {
    await withBusy(async () => {
      const next = await v4Api.onboardFolder({
        folderPath,
        mode: preferredMode,
        executionMode: 'auto',
      });
      applySessionDetail(next);
      setActiveNav('chat');
      setActiveTab('board');
      setInspectorOpen(true);
      pushHistory({nav: 'chat', sessionId: next.session.id});
    });
  };

  const handleOpenFolderPrompt = async (): Promise<void> => {
    if (window.forgeops?.pickDirectory) {
      const picked = await window.forgeops.pickDirectory();
      if (picked) {
        await handleOnboardFolder(picked);
        return;
      }
      return;
    }
    setActiveNav('projects');
  };

  const handleModeChange = async (nextMode: SessionMode): Promise<void> => {
    setPreferredMode(nextMode);
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      if (detail.session.mode === 'solo' && nextMode === 'team') {
        await v4Api.convertToTeam(detail.session.id, {disclosureScope: 'team'});
      } else {
        await v4Api.patchSession(detail.session.id, {mode: nextMode});
      }
      await loadSessionDetail(detail.session.id);
      await loadBootstrap();
    });
  };

  const handleSendTurn = async (
    text: string,
    opts?: {
      readonly targetKernel?: KernelId;
      readonly action?:
        'chat' | 'freeze_spec' | 'decompose' | 'execute' | 'ship';
    },
  ): Promise<void> => {
    await withBusy(async () => {
      let sid = detail?.session.id ?? activeSessionId;
      if (!sid) {
        const demo = await v4Api.demoRun({mode: preferredMode});
        applySessionDetail(demo);
        sid = demo.session.id;
      }
      const next = await v4Api.sendTurn(sid, {
        text,
        targetKernel: opts?.targetKernel,
        action: opts?.action,
      });
      applySessionDetail(next);
      if (opts?.action === 'decompose' || opts?.action === 'execute') {
        openInspectorTab('tasks');
      } else if (opts?.action === 'ship') {
        openInspectorTab('verify');
      } else if (opts?.action === 'freeze_spec') {
        openInspectorTab('board');
      }
    });
  };

  const handleSubmitGrilling = async (
    messageId: string,
    answers: Readonly<Record<string, string>>,
    acceptRecommended: boolean,
    freezeSpec: boolean,
  ): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      const next = await v4Api.submitGrilling(detail.session.id, {
        messageId,
        answers,
        acceptRecommended,
        freezeSpec,
      });
      applySessionDetail(next);
      if (freezeSpec) {
        openInspectorTab('board');
      }
    });
  };

  const handleRunQuantize = async (): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      const goals =
        detail.specIR.goals.length >= 3
          ? detail.specIR.goals.slice(0, 3)
          : [
              detail.specIR.goals[0] ?? '核心业务闭环与稳定性',
              detail.specIR.goals[1] ?? '多内核并发隔离执行与 Diff 审计',
              detail.specIR.goals[2] ?? '独立 Ship 审校与 HTML 验收报告',
            ];
      const items: readonly KanoAhpInputItem[] = goals.map((title, idx) => ({
        reqId: `req-${idx + 1}`,
        title,
        functional: idx === 0 ? 'expect' : 'like',
        dysfunctional: idx === 0 ? 'dislike' : 'tolerate',
      }));
      const pairwiseMatrix = [
        [1, 3, 5],
        [1 / 3, 1, 2],
        [1 / 5, 1 / 2, 1],
      ];
      const res = await v4Api.quantize(detail.session.id, {
        items,
        pairwiseMatrix,
      });
      if (!res.ok) {
        setErrorText(
          res.errorMessage ??
            `AHP 一致性比率 CR=${res.result.cr.toFixed(3)} >= 0.10，请调整权重矩阵。`,
        );
      }
      await loadSessionDetail(detail.session.id);
    });
  };

  const handleToggleExecutionMode = async (
    executionMode: SessionExecutionMode,
  ): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      await v4Api.patchSession(detail.session.id, {executionMode});
      await loadSessionDetail(detail.session.id);
    });
  };

  const handleDecompose = async (force?: boolean): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      const res = await v4Api.decomposeTasks(detail.session.id, {force});
      applySessionDetail(res.detail);
    });
  };

  const handleMutateTasks = async (mutation: TaskMutation): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      await v4Api.mutateTasks(detail.session.id, mutation);
      await loadSessionDetail(detail.session.id);
    });
  };

  const handleExecuteTasks = async (opts?: {
    readonly resumeOnly?: boolean;
    readonly taskIds?: readonly string[];
  }): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      const res = await v4Api.executeTasks(detail.session.id, opts);
      applySessionDetail(res.detail);
      if (res.diffs.length > 0) {
        openInspectorTab('code');
      }
    });
  };

  const handleSaveBoard = async (nextBoard: BoardSceneDoc): Promise<void> => {
    if (!detail) {
      return;
    }
    try {
      await v4Api.saveBoard(detail.session.id, {
        board: nextBoard,
        expectedRevision: detail.board.revision,
      });
      await loadSessionDetail(detail.session.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('revision mismatch')) {
        await loadSessionDetail(detail.session.id);
        return;
      }
      setErrorText(msg);
    }
  };

  const handleCreatePin = async (input: {
    readonly surfaceType: 'board' | 'spec_ir' | 'code_diff' | 'html_verify';
    readonly anchorJson: string;
    readonly specNodeId?: string;
    readonly promptText: string;
  }): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      await v4Api.createPin(detail.session.id, input);
      await loadSessionDetail(detail.session.id);
    });
  };

  const handleResolvePin = async (
    pinId: string,
    askAgent: boolean,
  ): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      const res = await v4Api.updatePin(detail.session.id, pinId, {
        status: askAgent ? 'waiting_on_agent' : 'resolved',
        askAgent,
      });
      if (res.detail) {
        applySessionDetail(res.detail);
      } else {
        await loadSessionDetail(detail.session.id);
      }
    });
  };

  const handleRunShip = async (opts: {
    readonly reviewDepth: 'fast' | 'standard' | 'deep';
    readonly reviewerKernel: KernelId;
    readonly policyMode: 'shadow' | 'enforced';
  }): Promise<void> => {
    if (!detail) {
      return;
    }
    setSelfApprovalBlockedMsg(null);
    await withBusy(async () => {
      const res = await v4Api.runShipReview(detail.session.id, opts);
      if (res.blocked) {
        setSelfApprovalBlockedMsg(
          res.errorMessage ??
            '审校内核与代码编写内核相同，三权分立物理防自批规则已拦截。',
        );
        return;
      }
      if (res.detail) {
        applySessionDetail(res.detail);
      } else {
        await loadSessionDetail(detail.session.id);
      }
    });
  };

  const handleApproveAndDeliver = async (reviewId: string): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      await v4Api.submitShipVerdict(detail.session.id, reviewId, {
        verdict: 'passed',
        comment: '验收通过，执行合并交付',
      });
      const delivered = await v4Api.deliverSession(detail.session.id, {
        appName: detail.session.title,
        versionTag: `v${detail.session.term}.0.0`,
      });
      applySessionDetail(delivered.detail);
    });
  };

  const handleRejectAndPin = async (
    reviewId: string,
    comment: string,
  ): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      await v4Api.submitShipVerdict(detail.session.id, reviewId, {
        verdict: 'rejected',
        comment,
      });
      await v4Api.createPin(detail.session.id, {
        surfaceType: 'html_verify',
        anchorJson: JSON.stringify({reviewId}),
        promptText: comment,
      });
      await loadSessionDetail(detail.session.id);
    });
  };

  const handleProbeKernels = async (): Promise<void> => {
    await withBusy(async () => {
      const res = await v4Api.probeKernels();
      setKernels(res.kernels);
      setRoleRouting({...DEFAULT_ROUTING, ...res.roleRouting});
    });
  };

  const handleUpdateRouting = async (
    patch: Partial<Record<TaskNodeRole, KernelId>>,
  ): Promise<void> => {
    await withBusy(async () => {
      const res = await v4Api.updateKernelRouting(patch);
      setRoleRouting({...DEFAULT_ROUTING, ...res.roleRouting});
    });
  };

  const handlePostCollab = async (input: {
    readonly fromKernel: KernelId;
    readonly toKernel: KernelId;
    readonly kind: string;
    readonly audienceScope: string;
    readonly content: string;
  }): Promise<void> => {
    if (!detail) {
      return;
    }
    await withBusy(async () => {
      await v4Api.postCollab({
        sessionId: detail.session.id,
        ...input,
      });
      await loadSessionDetail(detail.session.id);
    });
  };

  const handleControlApp = async (
    appId: string,
    action: 'start' | 'stop' | 'restart' | 'fork_v2',
  ): Promise<void> => {
    await withBusy(async () => {
      const res = await v4Api.controlApp(appId, action);
      if (res.forkedSession) {
        setActiveSessionId(res.forkedSession.id);
      }
      await loadBootstrap();
    });
  };

  const handleSplitterMouseDown = (
    e: ReactMouseEvent<HTMLDivElement>,
  ): void => {
    e.preventDefault();
    dragStartRef.current = {x: e.clientX, width: rightWidthPx};
    setIsDraggingSplitter(true);
  };

  const handleSelectNav = (nav: SidebarNavView): void => {
    setActiveNav(nav);
    pushHistory({nav, sessionId: activeSessionId});
  };

  const handleSelectSession = (sessionId: string): void => {
    setActiveNav('chat');
    setActiveSessionId(sessionId);
    pushHistory({nav: 'chat', sessionId});
  };

  const handleNewSession = (): void => {
    setActiveNav('chat');
    setActiveSessionId(null);
    setDetail(null);
    setInspectorOpen(false);
    pushHistory({nav: 'chat', sessionId: null});
  };

  const handleGoBack = (): void => {
    if (navCursor <= 0) return;
    const nextIdx = navCursor - 1;
    const entry = navHistory[nextIdx];
    if (entry) {
      setNavCursor(nextIdx);
      setActiveNav(entry.nav);
      setActiveSessionId(entry.sessionId);
    }
  };

  const handleGoForward = (): void => {
    if (navCursor >= navHistory.length - 1) return;
    const nextIdx = navCursor + 1;
    const entry = navHistory[nextIdx];
    if (entry) {
      setNavCursor(nextIdx);
      setActiveNav(entry.nav);
      setActiveSessionId(entry.sessionId);
    }
  };

  const tasks = detail?.activePlan?.tasks ?? [];
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const openTriageCount =
    triageTopics.filter(t => t.status !== 'resolved').length +
    (detail?.pins.filter(p => p.status !== 'resolved').length ?? 0);

  const qLower = searchQuery.trim().toLowerCase();
  const matchedSessions = sessions.filter(
    s =>
      !qLower ||
      s.title.toLowerCase().includes(qLower) ||
      s.workspacePath.toLowerCase().includes(qLower),
  );
  const matchedKernels = kernels.filter(
    k =>
      !qLower ||
      k.displayName.toLowerCase().includes(qLower) ||
      k.kernelId.toLowerCase().includes(qLower),
  );

  return (
    <div
      className="mpw-frame mp-shell"
      id="shell"
      data-view={activeNav === 'chat' ? 'chat' : 'projects'}
      data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      data-inspector={inspectorOpen ? 'open' : 'closed'}
      data-pane-dragging={isDraggingSplitter ? 'true' : undefined}
      data-theme={theme}
      data-testid="sdlc-studio-v4-root"
    >
      <TitleBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(prev => !prev)}
        onOpenSearch={() => setSearchOpen(prev => !prev)}
        canGoBack={navCursor > 0}
        canGoForward={navCursor < navHistory.length - 1}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onNewSession={handleNewSession}
        onOpenFolderPrompt={handleOpenFolderPrompt}
        onDemoRun={handleDemoRun}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen(prev => !prev)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => openSettings('general')}
        onSwitchToLegacy={onSwitchToLegacy}
        hasNativeOverlay={Boolean(window.forgeops?.hasNativeTitlebarOverlay)}
      />

      <StudioSidebar
        mode={detail?.session.mode ?? preferredMode}
        onChangeMode={m => void handleModeChange(m)}
        activeNav={activeNav}
        onSelectNav={handleSelectNav}
        activeChannel={activeChannel}
        onSelectChannel={handleSelectChannel}
        onMentionAgent={handleMentionAgent}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onOnboardFolder={handleOnboardFolder}
        catchupOnly={catchupOnly}
        onToggleCatchup={() => setCatchupOnly(prev => !prev)}
        pendingApprovalsCount={pendingApprovalsCount}
        openTriageCount={openTriageCount}
        kernels={kernels}
        hostedApps={hostedApps}
        searchQuery={searchQuery}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={openSettings}
        onSwitchToLegacy={onSwitchToLegacy}
        onDemoRun={handleDemoRun}
        busy={busy}
      />

      <main className="mpw-center-col">
        {activeNav === 'chat' ? (
          <MasterChatPane
            session={detail?.session ?? null}
            messages={detail?.messages ?? []}
            collabFeed={detail?.collabFeed ?? []}
            pins={detail?.pins ?? []}
            diffs={detail?.diffs ?? []}
            kernels={kernels}
            sessionCount={sessions.length}
            taskCount={tasks.length}
            completedTaskCount={completedTasks}
            pendingApprovalsCount={pendingApprovalsCount}
            inspectorOpen={inspectorOpen}
            activeTab={activeTab}
            activeChannel={activeChannel}
            theme={theme}
            prefillMention={prefillMention}
            busy={busy}
            errorText={errorText}
            onDismissError={() => setErrorText(null)}
            onDemoRun={handleDemoRun}
            onOpenFolderPrompt={handleOpenFolderPrompt}
            onToggleTab={toggleInspectorTab}
            onOpenTab={openInspectorTab}
            onOpenSettings={openSettings}
            onFileInTriage={handleFileInTriage}
            onSendTurn={handleSendTurn}
            onSubmitGrilling={handleSubmitGrilling}
            onRerunQuantize={handleRunQuantize}
            onToggleExecutionMode={handleToggleExecutionMode}
          />
        ) : activeNav === 'triage' ? (
          <FeedbackTriageView
            theme={theme}
            customTopics={triageTopics}
            onCreateTopic={input => {
              const created: TriageTopic = {
                id: `triage-${Date.now()}`,
                title: input.title,
                category: input.category,
                status: 'open',
                severity: input.severity,
                author: 'human',
                participants: ['human', 'master'],
                votes: 1,
                tags: input.tags,
                body: input.body,
                createdAt: new Date().toISOString(),
                replies: [],
              };
              persistTopics([created, ...triageTopics]);
            }}
            onVoteTopic={id => {
              persistTopics(
                triageTopics.map(t =>
                  t.id === id ? {...t, votes: t.votes + 1} : t,
                ),
              );
            }}
            onToggleResolved={id => {
              persistTopics(
                triageTopics.map(t =>
                  t.id === id
                    ? {
                        ...t,
                        status: t.status === 'resolved' ? 'open' : 'resolved',
                      }
                    : t,
                ),
              );
            }}
            onReplyTopic={(id, body) => {
              persistTopics(
                triageTopics.map(t =>
                  t.id === id
                    ? {
                        ...t,
                        replies: [
                          ...t.replies,
                          {
                            id: `rep-${Date.now()}`,
                            author: 'human',
                            body,
                            createdAt: new Date().toISOString(),
                          },
                        ],
                      }
                    : t,
                ),
              );
            }}
            onDispatchToMaster={topic => {
              setActiveNav('chat');
              void handleSendTurn(
                `请排查 Triage 议题「${topic.title}」：\n${topic.body}`,
                {targetKernel: 'master', action: 'chat'},
              );
            }}
            pins={detail?.pins ?? []}
            findings={detail?.latestShip?.findings ?? []}
            collabFeed={detail?.collabFeed ?? []}
          />
        ) : (
          <LibraryViews
            view={activeNav}
            detail={detail}
            sessions={sessions}
            kernels={kernels}
            roleRouting={roleRouting}
            hostedApps={hostedApps}
            theme={theme}
            busy={busy}
            onBackToChat={tab => {
              setActiveNav('chat');
              if (tab) {
                setActiveTab(tab);
                setInspectorOpen(true);
              }
            }}
            onSelectSession={handleSelectSession}
            onOnboardFolder={handleOnboardFolder}
            onDemoRun={handleDemoRun}
            onProbeKernels={handleProbeKernels}
            onUpdateRouting={handleUpdateRouting}
            onPostCollab={handlePostCollab}
            onControlApp={handleControlApp}
            onRetryTask={taskId => handleExecuteTasks({taskIds: [taskId]})}
            onOpenSettings={openSettings}
            onSwitchToLegacy={onSwitchToLegacy}
            onReportFinding={handleSendFindingToTriage}
          />
        )}
      </main>

      <RightWorkspacePane
        isOpen={inspectorOpen}
        widthPx={rightWidthPx}
        isDragging={isDraggingSplitter}
        onStartResize={handleSplitterMouseDown}
        onClose={() => setInspectorOpen(false)}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        detail={detail}
        kernels={kernels}
        roleRouting={roleRouting}
        theme={theme}
        selfApprovalBlockedMsg={selfApprovalBlockedMsg}
        busy={busy}
        onDecompose={handleDecompose}
        onMutateTasks={handleMutateTasks}
        onExecuteTasks={handleExecuteTasks}
        onSaveBoard={handleSaveBoard}
        onCreatePin={handleCreatePin}
        onResolvePin={handleResolvePin}
        onRunQuantize={handleRunQuantize}
        onRunShip={handleRunShip}
        onApproveAndDeliver={handleApproveAndDeliver}
        onRejectAndPin={handleRejectAndPin}
        onSendFindingToTriage={handleSendFindingToTriage}
        onProbeKernels={handleProbeKernels}
        onUpdateRouting={handleUpdateRouting}
        onPostCollab={handlePostCollab}
      />

      <SettingsModal
        open={settingsOpen}
        activePage={settingsPage}
        onChangePage={setSettingsPage}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onChangeTheme={changeTheme}
        preferences={preferences}
        onUpdatePreferences={updatePreferences}
        kernels={kernels}
        roleRouting={roleRouting}
        onUpdateRouting={handleUpdateRouting}
        onProbeKernels={handleProbeKernels}
        sessions={sessions}
        hostedApps={hostedApps}
        onOpenFolder={handleOpenFolderPrompt}
        onSwitchToLegacy={onSwitchToLegacy}
        busy={busy}
      />

      {searchOpen ? (
        <section
          className="mp-global-search"
          id="global-search"
          aria-label="Global search"
        >
          <button
            type="button"
            className="mp-global-search-mask"
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
          />
          <div
            className="mp-global-search-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="global-search-label"
          >
            <label className="mp-global-search-field" id="global-search-label">
              <CdsIcon name="Search" size="small" />
              <input
                autoFocus
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search sessions, kernels, or projects…"
                aria-label="Global search"
              />
              <kbd>Esc</kbd>
            </label>

            <div className="mp-global-search-results" role="listbox">
              {matchedSessions.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className="mp-global-search-row"
                  onClick={() => {
                    setSearchOpen(false);
                    handleSelectSession(s.id);
                  }}
                >
                  <span className="mp-global-search-kind">SES</span>
                  <span className="mp-global-search-copy">
                    <strong>{s.title}</strong>
                    <small>{s.workspacePath}</small>
                  </span>
                </button>
              ))}

              {matchedKernels.map(k => (
                <button
                  key={k.kernelId}
                  type="button"
                  className="mp-global-search-row"
                  onClick={() => {
                    setSearchOpen(false);
                    openSettings('models');
                  }}
                >
                  <span className="mp-global-search-kind">KRN</span>
                  <span className="mp-global-search-copy">
                    <strong>{kernelLabel(k.kernelId)}</strong>
                    <small>{k.binaryPath ?? k.command}</small>
                  </span>
                </button>
              ))}

              {matchedSessions.length === 0 && matchedKernels.length === 0 ? (
                <div className="mp-global-search-empty">
                  No matching sessions or kernels
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

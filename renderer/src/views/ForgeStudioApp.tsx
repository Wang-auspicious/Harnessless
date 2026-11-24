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
  TaskMutation,
  TaskNodeRole,
  V4SessionDetail,
  WorkspaceTabId,
} from '../api/v4-types.ts';
import {CdsIcon} from '../components/v4/CdsIcon.tsx';
import {LibraryViews} from '../components/v4/LibraryViews.tsx';
import {MasterChatPane} from '../components/v4/MasterChatPane.tsx';
import {RightWorkspacePane} from '../components/v4/RightWorkspacePane.tsx';
import {
  StudioSidebar,
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

interface NavHistoryEntry {
  readonly nav: SidebarNavView;
  readonly sessionId: string | null;
}

export function ForgeStudioApp({
  onSwitchToLegacy,
}: ForgeStudioAppProps): ReactElement {
  const [theme, setTheme] = useState<'light' | 'dark'>(readInitialTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeNav, setActiveNav] = useState<SidebarNavView>('chat');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [preferredMode, setPreferredMode] = useState<SessionMode>('solo');
  const [catchupOnly, setCatchupOnly] = useState(false);

  const [sessions, setSessions] = useState<readonly MasterSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<V4SessionDetail | null>(null);
  const [kernels, setKernels] = useState<readonly NativeKernelCard[]>([]);
  const [roleRouting, setRoleRouting] =
    useState<Record<TaskNodeRole, KernelId>>(DEFAULT_ROUTING);
  const [hostedApps, setHostedApps] = useState<readonly HostedAppCard[]>([]);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('tasks');
  const [rightWidthPx, setRightWidthPx] = useState(520);
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

  // Ensure body.studio and theme tokens stay synchronized cleanly
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

  // Smoke verification hashes for clean Electron Home & Split Workspace screenshots
  useEffect(() => {
    if (smokeHandledRef.current) {
      return;
    }
    const hash = window.location.hash;
    if (hash === '#smoke-home') {
      smokeHandledRef.current = true;
      setActiveNav('chat');
      setActiveSessionId(null);
      setDetail(null);
      setInspectorOpen(false);
    } else if (hash === '#smoke-workspace') {
      smokeHandledRef.current = true;
      setActiveNav('chat');
      setInspectorOpen(true);
      setActiveTab('board');
      void v4Api
        .demoRun({mode: 'solo'})
        .then(next => {
          setDetail(next);
          setActiveSessionId(next.session.id);
          void loadBootstrap();
        })
        .catch(() => {
          // Non-fatal fallback if already initialized
        });
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
      if (mod && e.key.toLowerCase() === 'k') {
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
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);

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
      const clamped = Math.min(maxW, Math.max(300, start.width + delta));
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

  const toggleTheme = (): void => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      try {
        window.localStorage.setItem('forgeops.v4.theme', next);
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
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
    await withBusy(async () => {
      await v4Api.saveBoard(detail.session.id, {
        board: nextBoard,
        expectedRevision: detail.board.revision,
      });
      await loadSessionDetail(detail.session.id);
    });
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
        onSwitchToLegacy={onSwitchToLegacy}
        hasNativeOverlay={Boolean(window.forgeops?.hasNativeTitlebarOverlay)}
      />

      <StudioSidebar
        mode={detail?.session.mode ?? preferredMode}
        onChangeMode={m => void handleModeChange(m)}
        activeNav={activeNav}
        onSelectNav={handleSelectNav}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onOnboardFolder={handleOnboardFolder}
        catchupOnly={catchupOnly}
        onToggleCatchup={() => setCatchupOnly(prev => !prev)}
        pendingApprovalsCount={pendingApprovalsCount}
        kernels={kernels}
        hostedApps={hostedApps}
        searchQuery={searchQuery}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSwitchToLegacy={onSwitchToLegacy}
        onDemoRun={handleDemoRun}
        busy={busy}
      />

      <main className="mpw-center-col">
        {activeNav === 'chat' ? (
          <MasterChatPane
            session={detail?.session ?? null}
            messages={detail?.messages ?? []}
            diffs={detail?.diffs ?? []}
            kernels={kernels}
            sessionCount={sessions.length}
            taskCount={tasks.length}
            completedTaskCount={completedTasks}
            pendingApprovalsCount={pendingApprovalsCount}
            inspectorOpen={inspectorOpen}
            activeTab={activeTab}
            busy={busy}
            errorText={errorText}
            onDismissError={() => setErrorText(null)}
            onDemoRun={handleDemoRun}
            onOpenFolderPrompt={handleOpenFolderPrompt}
            onToggleTab={toggleInspectorTab}
            onOpenTab={openInspectorTab}
            onSendTurn={handleSendTurn}
            onSubmitGrilling={handleSubmitGrilling}
            onRerunQuantize={handleRunQuantize}
            onToggleExecutionMode={handleToggleExecutionMode}
          />
        ) : (
          <LibraryViews
            view={activeNav}
            detail={detail}
            sessions={sessions}
            kernels={kernels}
            roleRouting={roleRouting}
            hostedApps={hostedApps}
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
        onProbeKernels={handleProbeKernels}
        onUpdateRouting={handleUpdateRouting}
        onPostCollab={handlePostCollab}
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
                    openInspectorTab('kernels');
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

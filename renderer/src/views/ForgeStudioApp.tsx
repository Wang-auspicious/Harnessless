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
  CatchupSummaryItem,
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
import {MasterChatPane} from '../components/v4/MasterChatPane.tsx';
import {RightWorkspacePane} from '../components/v4/RightWorkspacePane.tsx';
import {StudioSidebar} from '../components/v4/StudioSidebar.tsx';
import {TitleBar} from '../components/v4/TitleBar.tsx';
import '../styles/cds-claude.css';

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

export function ForgeStudioApp({
  onSwitchToLegacy,
}: ForgeStudioAppProps): ReactElement {
  const [theme, setTheme] = useState<'light' | 'dark'>(readInitialTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [catchupItems, setCatchupItems] = useState<
    readonly CatchupSummaryItem[]
  >([]);

  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('tasks');
  const [rightWidthPx, setRightWidthPx] = useState(500);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selfApprovalBlockedMsg, setSelfApprovalBlockedMsg] = useState<
    string | null
  >(null);

  const dragStartRef = useRef<{
    readonly x: number;
    readonly width: number;
  } | null>(null);

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
      const [boot, catchup] = await Promise.all([
        v4Api.getBootstrap(),
        v4Api.getCatchup().catch(() => ({items: []})),
      ]);
      setSessions(boot.sessions);
      setKernels(boot.kernels);
      setRoleRouting({...DEFAULT_ROUTING, ...boot.roleRouting});
      setHostedApps(boot.hostedApps);
      setPendingApprovalsCount(boot.pendingApprovalsCount);
      setCatchupItems(catchup.items);
      setActiveSessionId(prev => {
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
    if (!isDraggingSplitter) {
      return;
    }
    const onMove = (e: MouseEvent): void => {
      const start = dragStartRef.current;
      if (!start) {
        return;
      }
      const delta = start.x - e.clientX;
      const maxW = Math.max(360, Math.round(window.innerWidth * 0.68));
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

  const handleDemoRun = async (): Promise<void> => {
    await withBusy(async () => {
      const next = await v4Api.demoRun({mode: preferredMode});
      applySessionDetail(next);
      setActiveTab('board');
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
      setActiveTab('board');
    });
  };

  const handleOpenFolderPrompt = async (): Promise<void> => {
    if (window.forgeops?.pickDirectory) {
      const picked = await window.forgeops.pickDirectory();
      if (picked) {
        await handleOnboardFolder(picked);
        return;
      }
    }
    setSidebarCollapsed(false);
    setErrorText('请在左侧边栏点击「打开本地目录」并输入项目文件夹路径。');
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
        setActiveTab('tasks');
      } else if (opts?.action === 'ship') {
        setActiveTab('verify');
      } else if (opts?.action === 'freeze_spec') {
        setActiveTab('board');
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
        setActiveTab('board');
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
        setActiveTab('code');
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

  return (
    <div
      className={`cds-studio-root ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}
      data-theme={theme}
      data-testid="sdlc-studio-v4-root"
    >
      <TitleBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(prev => !prev)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeSession={detail?.session ?? null}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSwitchToLegacy={onSwitchToLegacy}
        hasNativeOverlay={Boolean(window.forgeops?.hasNativeTitlebarOverlay)}
      />

      <StudioSidebar
        mode={detail?.session.mode ?? preferredMode}
        onChangeMode={m => void handleModeChange(m)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={id => setActiveSessionId(id)}
        onNewSession={() => {
          setActiveSessionId(null);
          setDetail(null);
        }}
        onOnboardFolder={handleOnboardFolder}
        catchupOnly={catchupOnly}
        onToggleCatchup={() => setCatchupOnly(prev => !prev)}
        pendingApprovalsCount={pendingApprovalsCount}
        catchupItems={catchupItems}
        kernels={kernels}
        onOpenKernelsTab={() => setActiveTab('kernels')}
        hostedApps={hostedApps}
        onControlApp={handleControlApp}
        searchQuery={searchQuery}
        busy={busy}
      />

      <main className="cds-main-split">
        <MasterChatPane
          session={detail?.session ?? null}
          messages={detail?.messages ?? []}
          busy={busy}
          errorText={errorText}
          onDismissError={() => setErrorText(null)}
          onDemoRun={handleDemoRun}
          onOpenFolderPrompt={handleOpenFolderPrompt}
          onOpenTab={tab => setActiveTab(tab)}
          onSendTurn={handleSendTurn}
          onSubmitGrilling={handleSubmitGrilling}
          onRerunQuantize={handleRunQuantize}
          onToggleExecutionMode={handleToggleExecutionMode}
        />

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整工作区宽度"
          className={`cds-splitter ${isDraggingSplitter ? 'is-dragging' : ''}`}
          onMouseDown={handleSplitterMouseDown}
        />

        <RightWorkspacePane
          widthPx={rightWidthPx}
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
      </main>
    </div>
  );
}

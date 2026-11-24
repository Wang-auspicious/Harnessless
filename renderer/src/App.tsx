import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import type {BootstrapSnapshot, ForgeSseEvent} from '../../src/shared/api.ts';
import type {
  PermissionTier,
  TranscriptMessage,
} from '../../src/shared/types.ts';
import {forgeApi} from './api/client.ts';
import {
  ActivityIcon,
  BookOpenIcon,
  BoxIcon,
  BriefcaseIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CpuIcon,
  FileTextIcon,
  GitBranchIcon,
  GithubIcon,
  GlobeIcon,
  GridIcon,
  HelpCircleIcon,
  PanelLeftCloseIcon,
  PlugIcon,
  RadioIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
  WifiIcon,
  ZapIcon,
} from './components/Icons.tsx';
import {
  CHANGELOG_DOCS,
  FAQ_DOCS,
  SDD_SPEC_DOCS,
  tr,
  type UiLang,
} from './i18n.ts';
import {AgentFactoryView} from './views/AgentFactoryView.tsx';
import {ChangeDashboardView} from './views/ChangeDashboardView.tsx';
import {ControlTaskView} from './views/ControlTaskView.tsx';
import {ForgeStudioApp} from './views/ForgeStudioApp.tsx';
import {InfraCenterView} from './views/InfraCenterView.tsx';
import {MissionStudioView} from './views/MissionStudioView.tsx';
import {RegistryView} from './views/RegistryView.tsx';
import {RoomsView} from './views/RoomsView.tsx';
import {WorkstationView} from './views/WorkstationView.tsx';
import './styles/theme.css';

type NavRoute =
  | 'missions'
  | 'infra-center'
  | 'registry'
  | 'change-dashboard'
  | 'workstation'
  | 'agents-market'
  | 'models-pool'
  | 'skills-bank'
  | 'mcp-protocol'
  | 'channels-gear'
  | 'sessions'
  | 'cron-jobs'
  | 'heartbeat'
  | 'environments';

type TopDrawerKind =
  'retention' | 'changelog' | 'doc' | 'faq' | 'github' | null;

function readInitialLang(): UiLang {
  try {
    const saved = window.localStorage.getItem('forgeops.lang');
    if (saved === 'EN' || saved === 'ZH') {
      return saved;
    }
  } catch {
    // Ignore storage read errors.
  }
  return 'ZH';
}

export function App(): ReactElement {
  const [expertMode, setExpertMode] = useState(false);

  if (!expertMode) {
    return <ForgeStudioApp onSwitchToLegacy={() => setExpertMode(true)} />;
  }

  return (
    <div
      className="legacy-forgeops-shell"
      style={{position: 'relative', width: '100vw', height: '100vh'}}
    >
      <button
        type="button"
        onClick={() => setExpertMode(false)}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 9999,
          padding: '6px 12px',
          borderRadius: 999,
          border: '1px solid rgba(217, 119, 87, 0.45)',
          background: '#D97757',
          color: '#FFFFFF',
          fontSize: 12,
          fontWeight: 600,
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.16)',
          cursor: 'pointer',
        }}
      >
        返回 SDLC-Studio v4
      </button>
      <LegacyForgeOpsApp />
    </div>
  );
}

function LegacyForgeOpsApp(): ReactElement {
  const [snapshot, setSnapshot] = useState<BootstrapSnapshot | null>(null);
  const [route, setRoute] = useState<NavRoute>('missions');
  const [prevRouteBeforeDash, setPrevRouteBeforeDash] =
    useState<NavRoute>('registry');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    project: true,
    factory: true,
    control: true,
    settings: true,
  });

  const [activeHubId, setActiveHubId] = useState<string>('');
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);
  const [liveChunks, setLiveChunks] = useState<TranscriptMessage[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [lang, setLang] = useState<UiLang>(readInitialLang);
  const [drawer, setDrawer] = useState<TopDrawerKind>(null);
  const [docSectionId, setDocSectionId] = useState<string>('axioms');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Command Palette (Ctrl+K / Cmd+K)
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');

  // Create Change / Epic Modal State
  const [showCreateChange, setShowCreateChange] = useState(false);
  const [isEpicMode, setIsEpicMode] = useState(false);
  const [chgRepoId, setChgRepoId] = useState('');
  const [epicRepoIds, setEpicRepoIds] = useState<string[]>([]);
  const [chgTitle, setChgTitle] = useState('');
  const [chgSummary, setChgSummary] = useState('');
  const [chgTier, setChgTier] = useState<PermissionTier>('turbo');
  const [creatingChg, setCreatingChg] = useState(false);

  const toggleLang = useCallback(() => {
    setLang(prev => {
      const next: UiLang = prev === 'ZH' ? 'EN' : 'ZH';
      try {
        window.localStorage.setItem('forgeops.lang', next);
      } catch {
        // Ignore storage write errors.
      }
      return next;
    });
  }, []);

  const reloadBootstrap = useCallback(async () => {
    try {
      const boot = await forgeApi.getBootstrap();
      setSnapshot(boot);
      setActiveHubId(prev => prev || boot.hubs[0]?.id || '');
      setActiveChangeId(prev => prev ?? boot.changes[0]?.id ?? null);
      setErrorBanner(null);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reloadBootstrap();
  }, [reloadBootstrap]);

  useEffect(() => {
    const unsubscribe = forgeApi.subscribeEvents((ev: ForgeSseEvent) => {
      if (ev.type === 'transcript.chunk') {
        setLiveChunks(prev => [...prev.slice(-30), ev.message]);
      } else {
        void reloadBootstrap();
        setRefreshTick(t => t + 1);
      }
    });
    return unsubscribe;
  }, [reloadBootstrap]);

  // Global Keyboard Shortcuts: Ctrl+K / Cmd+K Command Palette & Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(prev => !prev);
        setCmdQuery('');
        return;
      }
      if (e.key === 'Escape') {
        setCmdOpen(false);
        setDrawer(null);
        setShowCreateChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleGroup = (key: string): void => {
    setOpenGroups(prev => ({...prev, [key]: !prev[key]}));
  };

  const openChangeDashboard = (changeId: string): void => {
    setPrevRouteBeforeDash(route === 'change-dashboard' ? 'registry' : route);
    setActiveChangeId(changeId);
    setRoute('change-dashboard');
  };

  const openWorkstationForChange = (changeId: string): void => {
    setActiveChangeId(changeId);
    setRoute('workstation');
  };

  const openCreateChangeModal = (defaultRepoId?: string): void => {
    const hubRepos = (snapshot?.repositories ?? []).filter(
      r => r.hubId === activeHubId,
    );
    setChgRepoId(defaultRepoId ?? hubRepos[0]?.id ?? '');
    setEpicRepoIds(hubRepos.map(r => r.id));
    setIsEpicMode(false);
    setShowCreateChange(true);
  };

  const handleSubmitCreateChange = async (): Promise<void> => {
    if (!chgTitle.trim() || !activeHubId) return;
    setCreatingChg(true);
    try {
      if (isEpicMode) {
        const created = await forgeApi.createEpicChanges({
          hubId: activeHubId,
          repoIds: epicRepoIds,
          epicTitle: chgTitle.trim(),
          summary:
            chgSummary.trim() ||
            tr(
              lang,
              '跨仓库协同规格分解与验证切片。',
              'Coordinated cross-repository specification & verification slice.',
            ),
          permissionTier: chgTier,
        });
        await reloadBootstrap();
        if (created[0]) {
          setActiveChangeId(created[0].id);
          setRoute('workstation');
        }
      } else {
        const created = await forgeApi.createChange({
          hubId: activeHubId,
          repoId: chgRepoId,
          title: chgTitle.trim(),
          summary:
            chgSummary.trim() ||
            tr(
              lang,
              '规格驱动（SDD）WBS 与双生图执行切片。',
              'Specification-driven WBS & Twin-Graph execution slice.',
            ),
          permissionTier: chgTier,
        });
        await reloadBootstrap();
        setActiveChangeId(created.id);
        setRoute('workstation');
      }
      setChgTitle('');
      setChgSummary('');
      setShowCreateChange(false);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingChg(false);
    }
  };

  const routeTitle = useMemo((): string => {
    switch (route) {
      case 'missions':
        return tr(lang, 'SDLC 任务工作台', 'Mission Studio');
      case 'infra-center':
        return tr(lang, '基础设施中心', 'Infra Center');
      case 'registry':
        return tr(lang, '项目注册表', 'Registry');
      case 'change-dashboard':
        return tr(lang, '变更治理台', 'Change Dashboard');
      case 'workstation':
        return tr(lang, '双生图工作台', 'Workstation');
      case 'agents-market':
        return tr(lang, '智能体市场', 'Agents Market');
      case 'models-pool':
        return tr(lang, '模型池管理', 'Models');
      case 'skills-bank':
        return tr(lang, '技能银行与 DDD 词典', 'Skills Bank');
      case 'mcp-protocol':
        return tr(lang, 'MCP 协议中枢', 'MCP Protocol');
      case 'channels-gear':
        return tr(lang, '工程协作室', 'Channels Gear');
      case 'sessions':
        return tr(lang, '会话与证据检索', 'Sessions');
      case 'cron-jobs':
        return tr(lang, '定时巡检任务', 'Cron Jobs');
      case 'heartbeat':
        return tr(lang, '艾宾浩斯记忆与心跳', 'Heartbeat');
      case 'environments':
        return tr(lang, '运行环境与工作区', 'Environments');
    }
  }, [route, lang]);

  const commandItems = useMemo(() => {
    if (!snapshot) return [];
    const baseActions: Array<{
      readonly id: string;
      readonly title: string;
      readonly category: string;
      readonly run: () => void;
    }> = [
      {
        id: 'act-lang',
        title: tr(
          lang,
          '切换界面语言：简体中文 ↔ English',
          'Switch Language: English ↔ 简体中文',
        ),
        category: tr(lang, '快捷操作', 'Action'),
        run: () => toggleLang(),
      },
      {
        id: 'act-new-chg',
        title: tr(
          lang,
          '新建受控变更单 / 跨仓协同 Epic',
          'Create Governed Change / Cross-Repo Epic',
        ),
        category: tr(lang, '快捷操作', 'Action'),
        run: () => openCreateChangeModal(),
      },
      {
        id: 'act-anchor',
        title: tr(
          lang,
          '打开艾宾浩斯心智重锚胶囊与待拍板队列',
          'Open Ebbinghaus Re-hydration Capsule & Attention Queue',
        ),
        category: tr(lang, '认知记忆', 'Cognitive'),
        run: () => setDrawer('retention'),
      },
      {
        id: 'act-sdd',
        title: tr(
          lang,
          '阅读 SDD 架构规范说明书',
          'Open SDD Architecture Specification',
        ),
        category: tr(lang, '文档', 'Docs'),
        run: () => setDrawer('doc'),
      },
      {
        id: 'nav-missions',
        title: tr(
          lang,
          '前往：SDLC 任务工作台 (Mission Studio)',
          'Go to: Mission Studio',
        ),
        category: tr(lang, '导航', 'Navigate'),
        run: () => setRoute('missions'),
      },
      {
        id: 'nav-ws',
        title: tr(
          lang,
          '前往：双生图工作台 (Workstation)',
          'Go to: Workstation',
        ),
        category: tr(lang, '导航', 'Navigate'),
        run: () => setRoute('workstation'),
      },
      {
        id: 'nav-reg',
        title: tr(
          lang,
          '前往：项目注册表 (Registry)',
          'Go to: Project Registry',
        ),
        category: tr(lang, '导航', 'Navigate'),
        run: () => setRoute('registry'),
      },
      {
        id: 'nav-infra',
        title: tr(
          lang,
          '前往：基础设施中心 (Infra Center)',
          'Go to: Infra Center',
        ),
        category: tr(lang, '导航', 'Navigate'),
        run: () => setRoute('infra-center'),
      },
      {
        id: 'nav-market',
        title: tr(
          lang,
          '前往：智能体市场 (Agents Market)',
          'Go to: Agents Market',
        ),
        category: tr(lang, '导航', 'Navigate'),
        run: () => setRoute('agents-market'),
      },
      {
        id: 'nav-skills',
        title: tr(
          lang,
          '前往：技能银行与 DDD 统一语言词典',
          'Go to: Skills Bank & DDD Ubiquitous Language',
        ),
        category: tr(lang, '导航', 'Navigate'),
        run: () => setRoute('skills-bank'),
      },
      {
        id: 'nav-rooms',
        title: tr(
          lang,
          '前往：工程协作室 (Channels Gear)',
          'Go to: Engineering Rooms',
        ),
        category: tr(lang, '导航', 'Navigate'),
        run: () => setRoute('channels-gear'),
      },
    ];

    for (const c of snapshot.changes) {
      baseActions.push({
        id: `chg-${c.id}`,
        title: `${c.code} · ${c.title}`,
        category: tr(lang, '变更单', 'Change'),
        run: () => openWorkstationForChange(c.id),
      });
    }

    const q = cmdQuery.trim().toLowerCase();
    if (!q) return baseActions;
    return baseActions.filter(
      item =>
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [snapshot, lang, cmdQuery, toggleLang]);

  if (!snapshot) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          color: '#475569',
          fontWeight: 500,
        }}
      >
        {tr(
          lang,
          '正在初始化 ForgeOps 元编排控制平面…',
          'Initializing ForgeOps Control Plane...',
        )}
      </div>
    );
  }

  const hubRepos = snapshot.repositories.filter(r => r.hubId === activeHubId);
  const activeCapsule =
    snapshot.capsules.find(c => c.hubId === activeHubId) ??
    snapshot.capsules[0] ??
    null;
  const unresolvedAttention = snapshot.attentionQueue.filter(
    a => !a.resolvedAt,
  );
  const retentionPct = activeCapsule
    ? Math.round(activeCapsule.retentionScore * 100)
    : 100;

  const inProjectGroup =
    route === 'missions' ||
    route === 'registry' ||
    route === 'workstation' ||
    route === 'change-dashboard';
  const inFactoryGroup =
    route === 'agents-market' ||
    route === 'models-pool' ||
    route === 'skills-bank' ||
    route === 'mcp-protocol' ||
    route === 'channels-gear';
  const inControlGroup =
    route === 'sessions' || route === 'cron-jobs' || route === 'heartbeat';
  const inSettingsGroup = route === 'environments';

  const hasWinOverlay = Boolean(window.forgeops?.hasNativeTitlebarOverlay);

  const copyText = (txt: string): void => {
    void navigator.clipboard?.writeText(txt);
    setCopiedPath(txt);
    setTimeout(() => setCopiedPath(null), 1600);
  };

  return (
    <div className="app-shell">
      {/* === 1:1 Collapsible Left Sidebar === */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand-row">
          {!sidebarCollapsed && (
            <div className="brand-lockup">
              <span className="brand-wordmark">
                ForgeOps
                <span className="brand-spark-dot" />
              </span>
              <span className="brand-version">v3.1.0</span>
            </div>
          )}
          <button
            type="button"
            className="sidebar-collapse-btn"
            title={
              sidebarCollapsed
                ? tr(lang, '展开导航栏', 'Expand sidebar')
                : tr(lang, '收起导航栏', 'Collapse sidebar')
            }
            onClick={() => setSidebarCollapsed(c => !c)}
          >
            <PanelLeftCloseIcon size={14} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {/* Standalone Item: Infra Center */}
          <button
            type="button"
            className={`nav-item ${route === 'infra-center' ? 'active' : ''}`}
            onClick={() => setRoute('infra-center')}
            title={tr(lang, '基础设施中心', 'Infra Center')}
          >
            <span className="nav-item-left">
              <CpuIcon size={15} />
              {!sidebarCollapsed && (
                <span>{tr(lang, '基础设施中心', 'Infra Center')}</span>
              )}
            </span>
          </button>

          {/* Group 1: Project Center */}
          <div className="nav-group">
            {!sidebarCollapsed && (
              <button
                type="button"
                className={`nav-group-header ${
                  inProjectGroup ? 'active-group' : ''
                }`}
                onClick={() => toggleGroup('project')}
              >
                <span className="nav-group-left">
                  <BriefcaseIcon size={15} />
                  <span>{tr(lang, '项目中心', 'Project Center')}</span>
                </span>
                {openGroups['project'] ? (
                  <ChevronUpIcon size={13} />
                ) : (
                  <ChevronDownIcon size={13} />
                )}
              </button>
            )}
            {(sidebarCollapsed || openGroups['project']) && (
              <div className="nav-group-items">
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'missions' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('missions')}
                  title={tr(lang, '任务工作台', 'Mission Studio')}
                >
                  <span className="nav-item-left">
                    <GitBranchIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '任务工作台', 'Mission Studio')}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'registry' || route === 'change-dashboard'
                      ? 'active'
                      : ''
                  }`}
                  onClick={() => setRoute('registry')}
                  title={tr(lang, '项目注册表', 'Registry')}
                >
                  <span className="nav-item-left">
                    <BriefcaseIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '项目注册表', 'Registry')}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'workstation' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('workstation')}
                  title={tr(lang, '双生图工作台', 'Workstation')}
                >
                  <span className="nav-item-left">
                    <GridIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '双生图工作台', 'Workstation')}</span>
                    )}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Group 2: Agent Factory */}
          <div className="nav-group">
            {!sidebarCollapsed && (
              <button
                type="button"
                className={`nav-group-header ${
                  inFactoryGroup ? 'active-group' : ''
                }`}
                onClick={() => toggleGroup('factory')}
              >
                <span className="nav-group-left">
                  <ZapIcon size={15} />
                  <span>{tr(lang, '智能体工厂', 'Agent Factory')}</span>
                </span>
                {openGroups['factory'] ? (
                  <ChevronUpIcon size={13} />
                ) : (
                  <ChevronDownIcon size={13} />
                )}
              </button>
            )}
            {(sidebarCollapsed || openGroups['factory']) && (
              <div className="nav-group-items">
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'agents-market' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('agents-market')}
                  title={tr(lang, '智能体市场', 'Agents Market')}
                >
                  <span className="nav-item-left">
                    <SparklesIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '智能体市场', 'Agents Market')}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'models-pool' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('models-pool')}
                  title={tr(lang, '模型池', 'Models Pool')}
                >
                  <span className="nav-item-left">
                    <BoxIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '模型池', 'Models Pool')}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'skills-bank' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('skills-bank')}
                  title={tr(lang, '技能银行与 DDD', 'Skills Bank')}
                >
                  <span className="nav-item-left">
                    <ZapIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '技能银行', 'Skills Bank')}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'mcp-protocol' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('mcp-protocol')}
                  title={tr(lang, 'MCP 协议', 'MCP Protocol')}
                >
                  <span className="nav-item-left">
                    <PlugIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, 'MCP 协议', 'MCP Protocol')}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'channels-gear' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('channels-gear')}
                  title={tr(lang, '工程协作室', 'Channels Gear')}
                >
                  <span className="nav-item-left">
                    <WifiIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '工程协作室', 'Channels Gear')}</span>
                    )}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Group 3: Control & Task */}
          <div className="nav-group">
            {!sidebarCollapsed && (
              <button
                type="button"
                className={`nav-group-header ${
                  inControlGroup ? 'active-group' : ''
                }`}
                onClick={() => toggleGroup('control')}
              >
                <span className="nav-group-left">
                  <RadioIcon size={15} />
                  <span>{tr(lang, '控制与记忆', 'Control & Task')}</span>
                </span>
                {openGroups['control'] ? (
                  <ChevronUpIcon size={13} />
                ) : (
                  <ChevronDownIcon size={13} />
                )}
              </button>
            )}
            {(sidebarCollapsed || openGroups['control']) && (
              <div className="nav-group-items">
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'sessions' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('sessions')}
                  title={tr(lang, '会话与轨迹', 'Sessions')}
                >
                  <span className="nav-item-left">
                    <UsersIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '会话与轨迹', 'Sessions')}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'cron-jobs' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('cron-jobs')}
                  title={tr(lang, '定时巡检', 'Cron Jobs')}
                >
                  <span className="nav-item-left">
                    <CalendarIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '定时巡检', 'Cron Jobs')}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'heartbeat' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('heartbeat')}
                  title={tr(lang, '记忆曲线与心跳', 'Heartbeat')}
                >
                  <span className="nav-item-left">
                    <ActivityIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '记忆与心跳', 'Heartbeat')}</span>
                    )}
                  </span>
                  {!sidebarCollapsed && unresolvedAttention.length > 0 && (
                    <span className="nav-badge-count">
                      {unresolvedAttention.length}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Group 4: Settings */}
          <div className="nav-group">
            {!sidebarCollapsed && (
              <button
                type="button"
                className={`nav-group-header ${
                  inSettingsGroup ? 'active-group' : ''
                }`}
                onClick={() => toggleGroup('settings')}
              >
                <span className="nav-group-left">
                  <SettingsIcon size={15} />
                  <span>{tr(lang, '系统设置', 'Settings')}</span>
                </span>
                {openGroups['settings'] ? (
                  <ChevronUpIcon size={13} />
                ) : (
                  <ChevronDownIcon size={13} />
                )}
              </button>
            )}
            {(sidebarCollapsed || openGroups['settings']) && (
              <div className="nav-group-items">
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'environments' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('environments')}
                  title={tr(lang, '环境与中枢', 'Environments')}
                >
                  <span className="nav-item-left">
                    <GlobeIcon size={15} />
                    {!sidebarCollapsed && (
                      <span>{tr(lang, '环境与中枢', 'Environments')}</span>
                    )}
                  </span>
                </button>
              </div>
            )}
          </div>
        </nav>
      </aside>

      {/* === Main Content Column === */}
      <div className="main-column">
        {/* Top Utility, SDD Retention Capsule & Bilingual Control Bar */}
        <header className={`topbar ${hasWinOverlay ? 'win-overlay' : ''}`}>
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div className="topbar-title">{routeTitle}</div>

            <button
              type="button"
              className="cmdk-pill"
              title={tr(
                lang,
                '全局跳转与动作命令面板 (Ctrl+K)',
                'Global Command Palette (Ctrl+K)',
              )}
              onClick={() => {
                setCmdQuery('');
                setCmdOpen(true);
              }}
            >
              <SearchIcon size={12} />
              <span>{tr(lang, '命令与搜索', 'Search')}</span>
              <span className="cmdk-kbd">Ctrl+K</span>
            </button>
          </div>

          <div className="topbar-utilities">
            {/* SDD §9.1 Live Ebbinghaus R_human Retention & Attention Capsule Pill */}
            <button
              type="button"
              className="retention-pill"
              title={tr(
                lang,
                '点击展开 SDD 艾宾浩斯心智重锚胶囊与人类待拍板决策队列',
                'Open Ebbinghaus Human Retention Capsule & Attention Queue',
              )}
              onClick={() => setDrawer('retention')}
            >
              <ActivityIcon size={12} />
              <span>
                {tr(lang, `记忆保持 ${retentionPct}%`, `R: ${retentionPct}%`)}
              </span>
              {unresolvedAttention.length > 0 && (
                <span
                  style={{
                    background: '#dc2626',
                    color: '#ffffff',
                    borderRadius: 999,
                    padding: '0 6px',
                    fontSize: 10.5,
                  }}
                >
                  {unresolvedAttention.length}
                </span>
              )}
            </button>

            {snapshot.hubs.length > 0 && (
              <select
                className="hub-switcher-select"
                title={tr(
                  lang,
                  '切换当前多仓联邦主控中枢 (Federation Hub)',
                  'Active Multi-Repo Federation Hub',
                )}
                value={activeHubId}
                onChange={e => {
                  const nextHub = e.target.value;
                  setActiveHubId(nextHub);
                  const firstChg = snapshot.changes.find(
                    c => c.hubId === nextHub,
                  );
                  setActiveChangeId(firstChg?.id ?? null);
                }}
              >
                {snapshot.hubs.map(h => (
                  <option key={h.id} value={h.id}>
                    {tr(lang, '中枢', 'Hub')}: {h.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              className="topbar-util-btn"
              onClick={() => setDrawer('changelog')}
            >
              <FileTextIcon size={14} /> {tr(lang, '更新日志', 'Changelog')}
            </button>
            <button
              type="button"
              className="topbar-util-btn"
              onClick={() => setDrawer('doc')}
            >
              <BookOpenIcon size={14} /> {tr(lang, '架构规范', 'Doc')}
            </button>
            <button
              type="button"
              className="topbar-util-btn"
              onClick={() => setDrawer('faq')}
            >
              <HelpCircleIcon size={14} /> {tr(lang, '常见问题', 'FAQ')}
            </button>
            <button
              type="button"
              className="topbar-util-btn"
              onClick={() => setDrawer('github')}
            >
              <GithubIcon size={14} /> {tr(lang, '代码仓库', 'GitHub')}
            </button>
            <button
              type="button"
              className="btn btn-soft btn-sm"
              style={{height: 27, padding: '0 10px'}}
              title={tr(
                lang,
                '点击切换为英文界面 (Switch to English)',
                '点击切换为简体中文界面 (Switch to Simplified Chinese)',
              )}
              onClick={toggleLang}
            >
              <GlobeIcon size={13} />{' '}
              {lang === 'ZH' ? '简体中文 · EN' : 'English · 简中'}
            </button>
          </div>
        </header>

        {errorBanner && (
          <div className="error-banner">
            <span>{errorBanner}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setErrorBanner(null)}
            >
              {tr(lang, '关闭', 'Dismiss')}
            </button>
          </div>
        )}

        {/* Active View Body */}
        {route === 'missions' && (
          <MissionStudioView
            lang={lang}
            snapshot={snapshot}
            activeHubId={activeHubId}
            refreshTick={refreshTick}
            onOpenWorkstation={openWorkstationForChange}
            onRefresh={() => {
              void reloadBootstrap();
              setRefreshTick(t => t + 1);
            }}
            onError={msg => setErrorBanner(msg)}
          />
        )}

        {route === 'workstation' && (
          <WorkstationView
            lang={lang}
            snapshot={snapshot}
            activeHubId={activeHubId}
            activeChangeId={activeChangeId}
            onSelectChange={id => setActiveChangeId(id)}
            onOpenChangeDashboard={openChangeDashboard}
            onOpenCreateChangeModal={openCreateChangeModal}
            liveChunks={liveChunks}
            refreshTick={refreshTick}
            onRefresh={() => {
              void reloadBootstrap();
              setRefreshTick(t => t + 1);
            }}
          />
        )}

        {route === 'registry' && (
          <RegistryView
            lang={lang}
            snapshot={snapshot}
            activeHubId={activeHubId}
            onOpenWorkstation={openWorkstationForChange}
            onOpenChangeDashboard={openChangeDashboard}
            onOpenCreateChangeModal={openCreateChangeModal}
            onOpenDddStudio={() => setRoute('skills-bank')}
            onRefresh={reloadBootstrap}
            onError={msg => setErrorBanner(msg)}
          />
        )}

        {route === 'change-dashboard' && activeChangeId && (
          <ChangeDashboardView
            lang={lang}
            snapshot={snapshot}
            changeId={activeChangeId}
            onBack={() => setRoute(prevRouteBeforeDash)}
            onOpenWorkstation={openWorkstationForChange}
            onRefresh={() => void reloadBootstrap()}
            onError={msg => setErrorBanner(msg)}
          />
        )}

        {route === 'infra-center' && (
          <InfraCenterView
            lang={lang}
            snapshot={snapshot}
            activeHubId={activeHubId}
            onOpenWorkstation={openWorkstationForChange}
            onRefresh={() => void reloadBootstrap()}
            onError={msg => setErrorBanner(msg)}
          />
        )}

        {(route === 'agents-market' ||
          route === 'models-pool' ||
          route === 'skills-bank' ||
          route === 'mcp-protocol') && (
          <AgentFactoryView
            lang={lang}
            section={
              route === 'agents-market'
                ? 'market'
                : route === 'models-pool'
                  ? 'models'
                  : route === 'skills-bank'
                    ? 'skills'
                    : 'mcp'
            }
            snapshot={snapshot}
            activeHubId={activeHubId}
            onRefresh={() => void reloadBootstrap()}
            onError={msg => setErrorBanner(msg)}
          />
        )}

        {route === 'channels-gear' && (
          <RoomsView
            lang={lang}
            snapshot={snapshot}
            activeHubId={activeHubId}
            refreshTick={refreshTick}
            onPromotedChange={changeId => {
              void reloadBootstrap();
              openWorkstationForChange(changeId);
            }}
            onError={msg => setErrorBanner(msg)}
          />
        )}

        {(route === 'sessions' ||
          route === 'cron-jobs' ||
          route === 'heartbeat' ||
          route === 'environments') && (
          <ControlTaskView
            lang={lang}
            section={
              route === 'sessions'
                ? 'sessions'
                : route === 'cron-jobs'
                  ? 'cron'
                  : route === 'heartbeat'
                    ? 'heartbeat'
                    : 'environments'
            }
            snapshot={snapshot}
            activeHubId={activeHubId}
            onSelectHub={id => setActiveHubId(id)}
            onOpenWorkstation={openWorkstationForChange}
            refreshTick={refreshTick}
            onRefresh={() => void reloadBootstrap()}
            onError={msg => setErrorBanner(msg)}
          />
        )}
      </div>

      {/* === Global Command Palette (Ctrl+K / Cmd+K) === */}
      {cmdOpen && (
        <div className="modal-backdrop" onClick={() => setCmdOpen(false)}>
          <div className="cmd-palette-card" onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              className="cmd-palette-input"
              placeholder={tr(
                lang,
                '输入视图、变更单、智能体或操作名称快速跳转…',
                'Type a view, change, agent, or action to jump...',
              )}
              value={cmdQuery}
              onChange={e => setCmdQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && commandItems[0]) {
                  commandItems[0].run();
                  setCmdOpen(false);
                }
              }}
            />
            <div className="cmd-palette-list">
              {commandItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="cmd-palette-item"
                  onClick={() => {
                    item.run();
                    setCmdOpen(false);
                  }}
                >
                  <span style={{fontWeight: 600}}>{item.title}</span>
                  <span className="tag">{item.category}</span>
                </button>
              ))}
              {commandItems.length === 0 && (
                <div
                  style={{padding: 18, textAlign: 'center', color: '#94a3b8'}}
                >
                  {tr(lang, '未匹配到相关命令', 'No matching commands')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === Global Create Change / Cross-Repo Epic Modal === */}
      {showCreateChange && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCreateChange(false)}
        >
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>
                {tr(
                  lang,
                  '新建受控变更单 / 跨仓协同 Epic',
                  'Create Governed Change / Cross-Repo Epic',
                )}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowCreateChange(false)}
              >
                ✕
              </button>
            </div>
            <div
              className="modal-body"
              style={{display: 'flex', flexDirection: 'column', gap: 12}}
            >
              <div style={{display: 'flex', gap: 8}}>
                <button
                  type="button"
                  className={`btn btn-sm ${!isEpicMode ? 'btn-primary' : ''}`}
                  onClick={() => setIsEpicMode(false)}
                >
                  {tr(lang, '单仓库受控变更', 'Single Repository Change')}
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${isEpicMode ? 'btn-primary' : ''}`}
                  onClick={() => setIsEpicMode(true)}
                >
                  {tr(lang, '多仓库协同 Epic', 'Cross-Repo Coordinated Epic')}
                </button>
              </div>

              {!isEpicMode ? (
                <div>
                  <label className="field-label">
                    {tr(lang, '目标成员仓库', 'Target Repository')}
                  </label>
                  <select
                    value={chgRepoId}
                    onChange={e => setChgRepoId(e.target.value)}
                  >
                    {hubRepos.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.boundedContext})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="field-label">
                    {tr(
                      lang,
                      `协同参与仓库（已选 ${epicRepoIds.length} 个）`,
                      `Participating Repositories (${epicRepoIds.length} selected)`,
                    )}
                  </label>
                  <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                    {hubRepos.map(r => {
                      const checked = epicRepoIds.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          className={`btn btn-sm ${checked ? 'btn-soft' : ''}`}
                          onClick={() =>
                            setEpicRepoIds(prev =>
                              checked
                                ? prev.filter(x => x !== r.id)
                                : [...prev, r.id],
                            )
                          }
                        >
                          {checked ? '✓' : '+'} {r.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="field-label">
                  {tr(lang, '变更标题', 'Change / Epic Title')}
                </label>
                <input
                  placeholder={tr(
                    lang,
                    '例如：强制 SettlementVoucher 结算对账幂等性约束',
                    'e.g. Enforce Idempotent SettlementVoucher Reconciliation',
                  )}
                  value={chgTitle}
                  onChange={e => setChgTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">
                  {tr(lang, 'SDD 规格与验收边界摘要', 'Specification Summary')}
                </label>
                <textarea
                  rows={3}
                  placeholder={tr(
                    lang,
                    '描述变更范围、DDD 限界上下文约束与硬门禁预期…',
                    'Describe scope, DDD boundaries, and verification expectations...',
                  )}
                  value={chgSummary}
                  onChange={e => setChgSummary(e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">
                  {tr(lang, '自治权限档位', 'Permission Tier')}
                </label>
                <select
                  value={chgTier}
                  onChange={e => setChgTier(e.target.value as PermissionTier)}
                >
                  <option value="turbo">
                    {tr(
                      lang,
                      'Turbo 全速自治（P5 双级 TQLA 独立门禁）',
                      'Turbo Auto (P5 Dual TQLA)',
                    )}
                  </option>
                  <option value="supervised">
                    {tr(lang, 'Supervised 关键门禁签批', 'Supervised')}
                  </option>
                  <option value="strict">
                    {tr(lang, 'Strict 严格人工门禁', 'Strict Human Gate')}
                  </option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setShowCreateChange(false)}
              >
                {tr(lang, '取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creatingChg || !chgTitle.trim()}
                onClick={() => void handleSubmitCreateChange()}
              >
                {tr(lang, '编译规格与双生图', 'Compile Spec & Twin Graph')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Interactive Right Slide-Over Drawers for Topbar Utilities === */}
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <aside className="drawer-panel" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div style={{fontSize: 16, fontWeight: 700}}>
                {drawer === 'retention' &&
                  tr(
                    lang,
                    '艾宾浩斯心智重锚胶囊与待拍板中心',
                    'Ebbinghaus Re-hydration & Attention Inbox',
                  )}
                {drawer === 'changelog' &&
                  tr(
                    lang,
                    'ForgeOps 版本演进与架构更新日志',
                    'ForgeOps Release & Architecture Changelog',
                  )}
                {drawer === 'doc' &&
                  tr(
                    lang,
                    'ForgeOps SDD 核心架构规范说明书',
                    'ForgeOps SDD Master Architecture Specification',
                  )}
                {drawer === 'faq' &&
                  tr(
                    lang,
                    '工程治理常见问题与排障指南',
                    'Engineering Governance & Troubleshooting FAQ',
                  )}
                {drawer === 'github' &&
                  tr(
                    lang,
                    '多仓联邦工作树与代码仓库连接',
                    'Federation Repositories & Git Worktree Links',
                  )}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDrawer(null)}
              >
                ✕
              </button>
            </div>

            <div className="drawer-body">
              {drawer === 'retention' && (
                <div
                  style={{display: 'flex', flexDirection: 'column', gap: 16}}
                >
                  {activeCapsule && (
                    <div className="surface-card">
                      <div className="surface-card-header">
                        <span>
                          {tr(
                            lang,
                            '当前中枢心智保持度胶囊',
                            'Active Hub Cognitive Capsule',
                          )}
                        </span>
                        <span className="tag tag-indigo">
                          {activeCapsule.tier.toUpperCase()} · {retentionPct}%
                        </span>
                      </div>
                      <div className="surface-card-body">
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            marginBottom: 6,
                          }}
                        >
                          {activeCapsule.northStarGoal}
                        </div>
                        <p style={{color: '#475569', margin: '0 0 10px'}}>
                          {activeCapsule.lastHumanAnchor}
                        </p>
                        <ul
                          style={{
                            margin: '0 0 12px',
                            paddingLeft: 18,
                            color: '#334155',
                          }}
                        >
                          {activeCapsule.autonomousDeltaBullets.map(
                            (b, idx) => (
                              <li key={idx} style={{marginBottom: 4}}>
                                {b}
                              </li>
                            ),
                          )}
                        </ul>
                        <div
                          style={{
                            padding: '9px 12px',
                            borderRadius: 8,
                            background: '#eef2ff',
                            color: '#3730a3',
                            fontSize: 12.5,
                            marginBottom: 12,
                          }}
                        >
                          <strong>
                            {tr(lang, '下一步聚焦：', 'Next Action: ')}
                          </strong>
                          {activeCapsule.nextDecisionPrompt}
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            void forgeApi
                              .anchorHubReview(activeCapsule.hubId)
                              .then(() => reloadBootstrap());
                          }}
                        >
                          <CheckCircleIcon size={13} />{' '}
                          {tr(
                            lang,
                            '已掌握并重锚记忆（重置遗忘曲线 Δt）',
                            'Acknowledge & Anchor Memory (Reset Δt)',
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="surface-card">
                    <div className="surface-card-header">
                      <span>
                        {tr(
                          lang,
                          '人类注意力待拍板队列（单问题原则）',
                          'Human Attention Queue (Single-Question Principle)',
                        )}
                      </span>
                      <span className="tag">
                        {unresolvedAttention.length}{' '}
                        {tr(lang, '项待处理', 'open')}
                      </span>
                    </div>
                    <div className="surface-card-body">
                      {unresolvedAttention.length === 0 ? (
                        <div style={{color: '#64748b'}}>
                          {tr(
                            lang,
                            '当前零人工阻塞项，所有自治流水线运行健康。',
                            'Zero pending human blockers. Autonomous pipelines are healthy.',
                          )}
                        </div>
                      ) : (
                        unresolvedAttention.map(item => (
                          <div
                            key={item.id}
                            style={{
                              paddingBottom: 12,
                              marginBottom: 12,
                              borderBottom: '1px solid #f1f5f9',
                            }}
                          >
                            <div style={{fontWeight: 700, marginBottom: 4}}>
                              {item.question}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: '#64748b',
                                marginBottom: 8,
                              }}
                            >
                              {item.contextSnippet}
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                gap: 6,
                                flexWrap: 'wrap',
                              }}
                            >
                              {item.options.map((opt, idx) => (
                                <button
                                  key={opt}
                                  type="button"
                                  className={`btn btn-sm ${
                                    idx === item.recommendedIndex
                                      ? 'btn-primary'
                                      : ''
                                  }`}
                                  onClick={() => {
                                    void forgeApi
                                      .resolveAttention(item.id, opt)
                                      .then(() => reloadBootstrap());
                                  }}
                                >
                                  {idx === item.recommendedIndex
                                    ? `★ ${opt}`
                                    : opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {drawer === 'changelog' && (
                <div
                  style={{display: 'flex', flexDirection: 'column', gap: 16}}
                >
                  {CHANGELOG_DOCS.map(entry => (
                    <div key={entry.version} className="surface-card">
                      <div className="surface-card-header">
                        <span style={{fontWeight: 700}}>
                          {entry.version} —{' '}
                          {lang === 'ZH' ? entry.titleZh : entry.titleEn}
                        </span>
                        <span className="tag tag-indigo">{entry.date}</span>
                      </div>
                      <div className="surface-card-body">
                        <ul
                          style={{margin: 0, paddingLeft: 18, lineHeight: 1.65}}
                        >
                          {(lang === 'ZH'
                            ? entry.highlightsZh
                            : entry.highlightsEn
                          ).map((line, i) => (
                            <li key={i} style={{marginBottom: 6}}>
                              {line}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {drawer === 'doc' && (
                <div
                  style={{display: 'flex', flexDirection: 'column', gap: 14}}
                >
                  <div className="underline-tabs">
                    {SDD_SPEC_DOCS.map(sec => (
                      <button
                        key={sec.id}
                        type="button"
                        className={`underline-tab ${
                          docSectionId === sec.id ? 'active' : ''
                        }`}
                        onClick={() => setDocSectionId(sec.id)}
                      >
                        {lang === 'ZH' ? sec.tabZh : sec.tabEn}
                      </button>
                    ))}
                  </div>

                  {SDD_SPEC_DOCS.filter(s => s.id === docSectionId).map(sec => (
                    <div key={sec.id} className="surface-card">
                      <div className="surface-card-header">
                        <span>
                          {lang === 'ZH' ? sec.headingZh : sec.headingEn}
                        </span>
                        <span className="tag tag-blue">SDD v2.2</span>
                      </div>
                      <div className="surface-card-body">
                        <p
                          style={{
                            margin: '0 0 12px',
                            color: '#334155',
                            fontWeight: 600,
                          }}
                        >
                          {lang === 'ZH' ? sec.summaryZh : sec.summaryEn}
                        </p>
                        <ul
                          style={{margin: 0, paddingLeft: 18, lineHeight: 1.7}}
                        >
                          {(lang === 'ZH' ? sec.bulletsZh : sec.bulletsEn).map(
                            (b, idx) => (
                              <li key={idx} style={{marginBottom: 8}}>
                                {b}
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    </div>
                  ))}

                  <div className="surface-card">
                    <div className="surface-card-header">
                      <span>
                        {tr(
                          lang,
                          '当前工作区实时治理指标',
                          'Live Workspace Governance Metrics',
                        )}
                      </span>
                    </div>
                    <div
                      className="surface-card-body"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 10,
                      }}
                    >
                      <div>
                        <div className="field-label">
                          {tr(lang, '宪法版本', 'Constitution')}
                        </div>
                        <div style={{fontWeight: 700}}>
                          v{snapshot.constitution.version}
                        </div>
                      </div>
                      <div>
                        <div className="field-label">
                          {tr(lang, 'DDD 标准词条', 'DDD Terms')}
                        </div>
                        <div style={{fontWeight: 700}}>
                          {snapshot.domainTerms.length}
                        </div>
                      </div>
                      <div>
                        <div className="field-label">
                          {tr(lang, '共享技能包', 'Skills Bank')}
                        </div>
                        <div style={{fontWeight: 700}}>
                          {snapshot.skills.length}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {drawer === 'faq' && (
                <div
                  style={{display: 'flex', flexDirection: 'column', gap: 14}}
                >
                  {FAQ_DOCS.map((item, idx) => (
                    <div key={idx} className="surface-card">
                      <div className="surface-card-header">
                        <span>{lang === 'ZH' ? item.qZh : item.qEn}</span>
                      </div>
                      <div
                        className="surface-card-body"
                        style={{color: '#334155', lineHeight: 1.68}}
                      >
                        {lang === 'ZH' ? item.aZh : item.aEn}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {drawer === 'github' && (
                <div
                  style={{display: 'flex', flexDirection: 'column', gap: 14}}
                >
                  <div className="surface-card">
                    <div className="surface-card-header">
                      <span>
                        {tr(
                          lang,
                          'ForgeOps 宿主工程仓库与外部链接',
                          'ForgeOps Host Repository & External Portal',
                        )}
                      </span>
                    </div>
                    <div className="surface-card-body">
                      <p style={{margin: '0 0 12px', color: '#475569'}}>
                        {tr(
                          lang,
                          '所有外部链接均通过 Electron 安全隔离桥（shell.openExternal）在系统默认浏览器打开，严禁渲染进程直接跳转外部网页。',
                          'External links open safely in your OS default browser via quarantined Electron IPC without navigating the desktop console.',
                        )}
                      </p>
                      <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            void forgeApi.openExternal(
                              'https://github.com/Wang-auspicious/SDLC-studio',
                            );
                          }}
                        >
                          <GithubIcon size={13} />{' '}
                          {tr(
                            lang,
                            '在系统浏览器打开 GitHub',
                            'Open GitHub in System Browser',
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            setDrawer(null);
                            setRoute('registry');
                          }}
                        >
                          {tr(lang, '管理成员仓库', 'Manage Member Repos')}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="surface-card">
                    <div className="surface-card-header">
                      <span>
                        {tr(
                          lang,
                          '当前联邦纳管 Git 仓库本地路径',
                          'Registered Local Git Repositories',
                        )}
                      </span>
                      <span className="tag">{hubRepos.length}</span>
                    </div>
                    <div className="surface-card-body">
                      {hubRepos.map(r => (
                        <div
                          key={r.id}
                          style={{
                            paddingBottom: 10,
                            marginBottom: 10,
                            borderBottom: '1px solid #f1f5f9',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: 4,
                            }}
                          >
                            <span style={{fontWeight: 700}}>
                              <GitBranchIcon size={13} /> {r.name}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => copyText(r.localPath)}
                            >
                              {copiedPath === r.localPath
                                ? tr(lang, '✓ 已复制', '✓ Copied')
                                : tr(lang, '复制路径', 'Copy Path')}
                            </button>
                          </div>
                          <div
                            className="selectable"
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 11.5,
                              color: '#64748b',
                              wordBreak: 'break-all',
                            }}
                          >
                            {r.localPath}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

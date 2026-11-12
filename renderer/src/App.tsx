import {useCallback, useEffect, useState, type ReactElement} from 'react';
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
  ChevronDownIcon,
  ChevronUpIcon,
  CpuIcon,
  FileTextIcon,
  GithubIcon,
  GlobeIcon,
  GridIcon,
  HelpCircleIcon,
  PanelLeftCloseIcon,
  PlugIcon,
  RadioIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
  WifiIcon,
  ZapIcon,
} from './components/Icons.tsx';
import {AgentFactoryView} from './views/AgentFactoryView.tsx';
import {ChangeDashboardView} from './views/ChangeDashboardView.tsx';
import {ControlTaskView} from './views/ControlTaskView.tsx';
import {InfraCenterView} from './views/InfraCenterView.tsx';
import {RegistryView} from './views/RegistryView.tsx';
import {RoomsView} from './views/RoomsView.tsx';
import {WorkstationView} from './views/WorkstationView.tsx';

type NavRoute =
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

const ROUTE_TITLES: Record<NavRoute, string> = {
  'infra-center': 'Infra Center',
  registry: 'Registry',
  'change-dashboard': 'Change Dashboard',
  workstation: 'Workstation',
  'agents-market': 'Agents Market',
  'models-pool': 'Models',
  'skills-bank': 'Skills Bank',
  'mcp-protocol': 'MCP Protocol',
  'channels-gear': 'Channels Gear',
  sessions: 'Sessions',
  'cron-jobs': 'Cron Jobs',
  heartbeat: 'Heartbeat',
  environments: 'Environments',
};

export function App(): ReactElement {
  const [snapshot, setSnapshot] = useState<BootstrapSnapshot | null>(null);
  const [route, setRoute] = useState<NavRoute>('workstation');
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
  const [lang, setLang] = useState<'EN' | 'ZH'>('EN');
  const [infoModal, setInfoModal] = useState<
    'changelog' | 'doc' | 'faq' | null
  >(null);

  // Create Change / Epic Modal State
  const [showCreateChange, setShowCreateChange] = useState(false);
  const [isEpicMode, setIsEpicMode] = useState(false);
  const [chgRepoId, setChgRepoId] = useState('');
  const [epicRepoIds, setEpicRepoIds] = useState<string[]>([]);
  const [chgTitle, setChgTitle] = useState('');
  const [chgSummary, setChgSummary] = useState('');
  const [chgTier, setChgTier] = useState<PermissionTier>('turbo');
  const [creatingChg, setCreatingChg] = useState(false);

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
            'Coordinated cross-repository specification & verification slice.',
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
            'Specification-driven WBS & Twin-Graph execution slice.',
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
        Initializing ForgeOps Control Plane...
      </div>
    );
  }

  const hubRepos = snapshot.repositories.filter(r => r.hubId === activeHubId);
  const inProjectGroup =
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
              <span className="brand-version">v2.1.0</span>
            </div>
          )}
          <button
            type="button"
            className="sidebar-collapse-btn"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
            title="Infra Center"
          >
            <span className="nav-item-left">
              <CpuIcon size={15} />
              {!sidebarCollapsed && <span>Infra Center</span>}
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
                  <span>Project Center</span>
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
                    route === 'registry' || route === 'change-dashboard'
                      ? 'active'
                      : ''
                  }`}
                  onClick={() => setRoute('registry')}
                  title="Registry"
                >
                  <span className="nav-item-left">
                    <BriefcaseIcon size={15} />
                    {!sidebarCollapsed && <span>Registry</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'workstation' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('workstation')}
                  title="Workstation"
                >
                  <span className="nav-item-left">
                    <GridIcon size={15} />
                    {!sidebarCollapsed && <span>Workstation</span>}
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
                  <span>Agent Factory</span>
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
                  title="Agents Market"
                >
                  <span className="nav-item-left">
                    <SparklesIcon size={15} />
                    {!sidebarCollapsed && <span>Agents Market</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'models-pool' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('models-pool')}
                  title="Models Pool"
                >
                  <span className="nav-item-left">
                    <BoxIcon size={15} />
                    {!sidebarCollapsed && <span>Models Pool</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'skills-bank' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('skills-bank')}
                  title="Skills Bank"
                >
                  <span className="nav-item-left">
                    <ZapIcon size={15} />
                    {!sidebarCollapsed && <span>Skills Bank</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'mcp-protocol' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('mcp-protocol')}
                  title="MCP Protocol"
                >
                  <span className="nav-item-left">
                    <PlugIcon size={15} />
                    {!sidebarCollapsed && <span>MCP Protocol</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'channels-gear' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('channels-gear')}
                  title="Channels Gear"
                >
                  <span className="nav-item-left">
                    <WifiIcon size={15} />
                    {!sidebarCollapsed && <span>Channels Gear</span>}
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
                  <span>Control &amp; Task</span>
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
                  title="Sessions"
                >
                  <span className="nav-item-left">
                    <UsersIcon size={15} />
                    {!sidebarCollapsed && <span>Sessions</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'cron-jobs' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('cron-jobs')}
                  title="Cron Jobs"
                >
                  <span className="nav-item-left">
                    <CalendarIcon size={15} />
                    {!sidebarCollapsed && <span>Cron Jobs</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className={`nav-item ${!sidebarCollapsed ? 'indented' : ''} ${
                    route === 'heartbeat' ? 'active' : ''
                  }`}
                  onClick={() => setRoute('heartbeat')}
                  title="Heartbeat"
                >
                  <span className="nav-item-left">
                    <ActivityIcon size={15} />
                    {!sidebarCollapsed && <span>Heartbeat</span>}
                  </span>
                  {!sidebarCollapsed && snapshot.attentionQueue.length > 0 && (
                    <span className="nav-badge-count">
                      {snapshot.attentionQueue.length}
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
                  <span>Settings</span>
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
                  title="Environments"
                >
                  <span className="nav-item-left">
                    <GlobeIcon size={15} />
                    {!sidebarCollapsed && <span>Environments</span>}
                  </span>
                </button>
              </div>
            )}
          </div>
        </nav>
      </aside>

      {/* === Main Content Column === */}
      <div className="main-column">
        {/* Top Utility & Breadcrumb Bar (1:1 Reference Match) */}
        <header className="topbar">
          <div className="topbar-title">{ROUTE_TITLES[route]}</div>

          <div className="topbar-utilities">
            {snapshot.hubs.length > 0 && (
              <select
                className="hub-switcher-select"
                title="Active Multi-Repo Federation Hub"
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
                    Hub: {h.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              className="topbar-util-btn"
              onClick={() => setInfoModal('changelog')}
            >
              <FileTextIcon size={13} /> Changelog
            </button>
            <button
              type="button"
              className="topbar-util-btn muted"
              onClick={() => setInfoModal('doc')}
            >
              <BookOpenIcon size={13} /> Doc
            </button>
            <button
              type="button"
              className="topbar-util-btn muted"
              onClick={() => setInfoModal('faq')}
            >
              <HelpCircleIcon size={13} /> FAQ
            </button>
            <button
              type="button"
              className="topbar-util-btn"
              onClick={() => setRoute('environments')}
            >
              <GithubIcon size={13} /> GitHub
            </button>
            <button
              type="button"
              className="topbar-util-btn"
              onClick={() => setLang(l => (l === 'EN' ? 'ZH' : 'EN'))}
            >
              <GlobeIcon size={13} /> {lang === 'EN' ? 'English' : '中文'}
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
              Dismiss
            </button>
          </div>
        )}

        {/* Active View Body */}
        {route === 'workstation' && (
          <WorkstationView
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
            snapshot={snapshot}
            activeHubId={activeHubId}
            onOpenWorkstation={openWorkstationForChange}
            onOpenChangeDashboard={openChangeDashboard}
            onOpenCreateChangeModal={openCreateChangeModal}
            onRefresh={reloadBootstrap}
            onError={msg => setErrorBanner(msg)}
          />
        )}

        {route === 'change-dashboard' && activeChangeId && (
          <ChangeDashboardView
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

      {/* Global Create Change / Cross-Repo Epic Modal */}
      {showCreateChange && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCreateChange(false)}
        >
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Create Governed Change / Cross-Repo Epic</span>
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
                  Single Repository Change
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${isEpicMode ? 'btn-primary' : ''}`}
                  onClick={() => setIsEpicMode(true)}
                >
                  Cross-Repo Coordinated Epic
                </button>
              </div>

              {!isEpicMode ? (
                <div>
                  <label className="field-label">Target Repository</label>
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
                    Participating Repositories ({epicRepoIds.length} selected)
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
                <label className="field-label">Change / Epic Title</label>
                <input
                  placeholder="e.g. Enforce Idempotent SettlementVoucher Reconciliation"
                  value={chgTitle}
                  onChange={e => setChgTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Specification Summary</label>
                <textarea
                  rows={3}
                  placeholder="Describe scope, DDD boundaries, and verification expectations..."
                  value={chgSummary}
                  onChange={e => setChgSummary(e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Permission Tier</label>
                <select
                  value={chgTier}
                  onChange={e => setChgTier(e.target.value as PermissionTier)}
                >
                  <option value="turbo">Turbo Auto (P5 Dual TQLA)</option>
                  <option value="supervised">Supervised</option>
                  <option value="strict">Strict Human Gate</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setShowCreateChange(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creatingChg || !chgTitle.trim()}
                onClick={() => void handleSubmitCreateChange()}
              >
                Compile Spec &amp; Twin Graph
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clean Info Modal for Changelog / Doc / FAQ */}
      {infoModal && (
        <div className="modal-backdrop" onClick={() => setInfoModal(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>
                {infoModal === 'changelog'
                  ? 'ForgeOps Release Changelog'
                  : infoModal === 'doc'
                    ? 'ForgeOps Architecture Guide'
                    : 'Frequently Asked Questions'}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setInfoModal(null)}
              >
                ✕
              </button>
            </div>
            <div
              className="modal-body"
              style={{display: 'flex', flexDirection: 'column', gap: 10}}
            >
              {infoModal === 'changelog' && (
                <>
                  <div>
                    <strong>
                      v2.1.0 — Clean Light Console &amp; Stepped Twin Graph
                    </strong>
                    <div style={{color: '#475569', marginTop: 4}}>
                      Crisp light-mode enterprise console, 2-column Workstation,
                      collapsible Phase containers with nested Task grids,
                      horizontal non-overlapping TQLA QA pipeline, Change Team
                      Dashboard, and Agents Market Sovereign Profiles.
                    </div>
                  </div>
                  <div>
                    <strong>
                      v2.0.0 — Multi-Repo Federation &amp; 8h Continuity
                    </strong>
                    <div style={{color: '#475569', marginTop: 4}}>
                      SQLite WAL + FTS5 single-writer control plane, isolated
                      Git worktree checkpoints with rescue refs, DDD Ubiquitous
                      Language drift guard, and Dual Ebbinghaus memory.
                    </div>
                  </div>
                </>
              )}
              {infoModal === 'doc' && (
                <div style={{color: '#334155', lineHeight: 1.6}}>
                  <strong>Core Workflow:</strong> Register repositories in{' '}
                  <em>Project Registry</em>, configure DEV + Junior-QA +
                  Senior-QA models in <em>Change Dashboard</em>, and monitor or
                  amend live execution in <em>Workstation → Twin Graph</em>.
                  Every checkpoint anchors a physical Git commit with
                  non-destructive rescue refs before any rollback.
                </div>
              )}
              {infoModal === 'faq' && (
                <div style={{color: '#334155', lineHeight: 1.6}}>
                  <strong>
                    Q: Does archiving a Change delete my Hub or Repo?
                  </strong>
                  <br />
                  No — <em>Archive</em> is strictly scoped to the individual
                  Change record and never archives the parent Federation Hub or
                  Repository.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

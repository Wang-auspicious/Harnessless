import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type {
  BootstrapSnapshot,
  ControlSchemaResponse,
  MissionDetailSnapshot,
} from '../../src/shared/api.ts';
import type {MissionRecord} from '../../src/shared/v3-types.ts';
import {forgeApi} from './api/client.ts';
import type {UiLang} from './i18n.ts';
import {FactorySettingsView} from './v3/FactorySettingsView.tsx';
import {FocusWorkspace} from './v3/FocusWorkspace.tsx';
import {IntentComposer} from './v3/IntentComposer.tsx';
import {MemoryWorkspace} from './v3/MemoryWorkspace.tsx';
import {InfraCenterView} from './views/InfraCenterView.tsx';
import {RegistryView} from './views/RegistryView.tsx';
import {RoomsView} from './views/RoomsView.tsx';
import {WorkstationView} from './views/WorkstationView.tsx';

type ModeTab = 'focus' | 'memory' | 'factory';
type RailFilter = 'all' | 'needs_you' | 'completed';
type LegacySubTab = 'workstation' | 'registry' | 'infra' | 'rooms';

function label(lang: UiLang, zh: string, en: string): string {
  return lang === 'ZH' ? zh : en;
}

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

function missionBadgeTone(status: MissionRecord['status']): string {
  if (status === 'paused_human') {
    return 'v3-pill v3-pill-accent';
  }
  if (status === 'delivered') {
    return 'v3-pill v3-pill-green';
  }
  if (status === 'failed' || status === 'aborted') {
    return 'v3-pill v3-pill-red';
  }
  if (status === 'cooldown_hold') {
    return 'v3-pill v3-pill-amber';
  }
  return 'v3-pill v3-pill-indigo';
}

export function App(): ReactElement {
  const [lang, setLang] = useState<UiLang>(readInitialLang);
  const [snapshot, setSnapshot] = useState<BootstrapSnapshot | null>(null);
  const [controlSchema, setControlSchema] =
    useState<ControlSchemaResponse | null>(null);
  const [missions, setMissions] = useState<readonly MissionRecord[]>([]);
  const [activeHubId, setActiveHubId] = useState<string>('');
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] =
    useState<MissionDetailSnapshot | null>(null);

  const [modeTab, setModeTab] = useState<ModeTab>('focus');
  const [composingNew, setComposingNew] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railFilter, setRailFilter] = useState<RailFilter>('all');
  const [expertMode, setExpertMode] = useState(false);

  const [legacyMode, setLegacyMode] = useState(false);
  const [legacyTab, setLegacyTab] = useState<LegacySubTab>('workstation');
  const [legacyChangeId, setLegacyChangeId] = useState<string | null>(null);

  const [sseConnected, setSseConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const activeMissionIdRef = useRef<string | null>(activeMissionId);
  activeMissionIdRef.current = activeMissionId;

  const toggleLang = (): void => {
    const next: UiLang = lang === 'ZH' ? 'EN' : 'ZH';
    setLang(next);
    try {
      window.localStorage.setItem('forgeops.lang', next);
    } catch {
      // Ignore storage write failure.
    }
  };

  const loadMissionDetail = useCallback(
    async (missionId: string): Promise<void> => {
      try {
        const d = await forgeApi.getMissionDetail(missionId);
        setActiveDetail(d);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const loadWorkspace = useCallback(
    async (preferHubId?: string): Promise<void> => {
      try {
        const [boot, schema] = await Promise.all([
          forgeApi.getBootstrap(),
          forgeApi.getControlSchema(),
        ]);
        setSnapshot(boot);
        setControlSchema(schema);
        const hubId = preferHubId || activeHubId || boot.hubs[0]?.id || '';
        if (hubId && hubId !== activeHubId) {
          setActiveHubId(hubId);
        }
        const missionList = await forgeApi.listMissions(hubId || undefined);
        setMissions(missionList);

        const curId = activeMissionIdRef.current;
        if (curId && missionList.some(m => m.id === curId)) {
          await loadMissionDetail(curId);
        } else if (missionList.length > 0 && !composingNew) {
          const priority =
            missionList.find(m => m.status === 'paused_human') ??
            missionList[0]!;
          setActiveMissionId(priority.id);
          await loadMissionDetail(priority.id);
        } else if (missionList.length === 0) {
          setActiveMissionId(null);
          setActiveDetail(null);
        }
        setBootError(null);
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeHubId, composingNew, loadMissionDetail],
  );

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  // Multiplexed SSE subscription for live mission & hub state sync.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = forgeApi.subscribeEvents(() => {
      setSseConnected(true);
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void loadWorkspace();
      }, 200);
    });
    setSseConnected(true);
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      unsub();
    };
  }, [loadWorkspace]);

  const activeHub = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    return (
      snapshot.hubs.find(h => h.id === activeHubId) ?? snapshot.hubs[0] ?? null
    );
  }, [snapshot, activeHubId]);

  const hubRepos = useMemo(() => {
    if (!snapshot || !activeHub) {
      return [];
    }
    return snapshot.repositories.filter(r => r.hubId === activeHub.id);
  }, [snapshot, activeHub]);

  const needsYouCount = useMemo(
    () => missions.filter(m => m.status === 'paused_human').length,
    [missions],
  );

  const filteredMissions = useMemo(() => {
    if (railFilter === 'needs_you') {
      return missions.filter(m => m.status === 'paused_human');
    }
    if (railFilter === 'completed') {
      return missions.filter(
        m =>
          m.status === 'delivered' ||
          m.status === 'aborted' ||
          m.status === 'failed',
      );
    }
    return missions;
  }, [missions, railFilter]);

  if (!snapshot) {
    return (
      <div
        className="v3-root"
        style={{alignItems: 'center', justifyContent: 'center', padding: 32}}
      >
        <div className="v3-card" style={{maxWidth: 460, textAlign: 'center'}}>
          <div className="v3-brand-mark" style={{margin: '0 auto 12px'}}>
            F
          </div>
          <h2 style={{margin: '0 0 8px', fontSize: 18}}>ForgeOps v3.0</h2>
          {bootError ? (
            <div className="v3-banner-error">
              <span>{bootError}</span>
              <button
                type="button"
                className="v3-btn"
                onClick={() => {
                  void loadWorkspace();
                }}
              >
                {label(lang, '重试', 'Retry')}
              </button>
            </div>
          ) : (
            <div style={{color: 'var(--v3-sub)', fontSize: 13}}>
              {label(
                lang,
                '正在连接本地控制平面与 SQLite Hindsight 记忆引擎…',
                'Connecting to ForgeOps v3.0 Control Plane & Hindsight Engine…',
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Optional escape hatch to legacy v2.2 views when explicitly requested.
  if (legacyMode) {
    return (
      <div className="v3-root">
        <header className="v3-topbar">
          <div className="v3-brand v3-nodrag">
            <span className="v3-brand-mark">F</span>
            <span className="v3-brand-title">
              ForgeOps v2.2 Legacy Expert Shell
            </span>
            <button
              type="button"
              className="v3-btn v3-btn-primary"
              onClick={() => setLegacyMode(false)}
            >
              ←{' '}
              {label(
                lang,
                '返回 ForgeOps v3.0 焦点界面',
                'Back to ForgeOps v3.0',
              )}
            </button>
          </div>
          <div className="v3-mode-tabs v3-nodrag">
            {(
              [
                ['workstation', 'Workstation'],
                ['registry', 'Registry & DDD'],
                ['rooms', 'Rooms'],
                ['infra', 'Infra Center'],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                type="button"
                className={`v3-mode-tab ${legacyTab === id ? 'active' : ''}`}
                onClick={() => setLegacyTab(id)}
              >
                {text}
              </button>
            ))}
          </div>
        </header>
        <div className="v3-scroll">
          {legacyTab === 'workstation' && (
            <WorkstationView
              lang={lang}
              snapshot={snapshot}
              activeHubId={activeHub?.id ?? ''}
              activeChangeId={legacyChangeId ?? snapshot.changes[0]?.id ?? null}
              onSelectChange={id => setLegacyChangeId(id)}
              onOpenChangeDashboard={() => setLegacyTab('registry')}
              onOpenCreateChangeModal={() => setLegacyMode(false)}
              liveChunks={[]}
              refreshTick={0}
              onRefresh={() => {
                void loadWorkspace();
              }}
            />
          )}
          {legacyTab === 'registry' && (
            <RegistryView
              lang={lang}
              snapshot={snapshot}
              activeHubId={activeHub?.id ?? ''}
              onOpenWorkstation={id => {
                setLegacyChangeId(id);
                setLegacyTab('workstation');
              }}
              onOpenChangeDashboard={id => {
                setLegacyChangeId(id);
                setLegacyTab('workstation');
              }}
              onOpenCreateChangeModal={() => setLegacyMode(false)}
              onOpenDddStudio={() => {}}
              onRefresh={() => loadWorkspace()}
              onError={m => setErrorMsg(m)}
            />
          )}
          {legacyTab === 'rooms' && (
            <RoomsView
              lang={lang}
              snapshot={snapshot}
              activeHubId={activeHub?.id ?? ''}
              refreshTick={0}
              onPromotedChange={id => {
                setLegacyChangeId(id);
                setLegacyTab('workstation');
              }}
              onError={m => setErrorMsg(m)}
            />
          )}
          {legacyTab === 'infra' && (
            <InfraCenterView
              lang={lang}
              snapshot={snapshot}
              activeHubId={activeHub?.id ?? ''}
              onOpenWorkstation={id => {
                setLegacyChangeId(id);
                setLegacyTab('workstation');
              }}
              onRefresh={() => {
                void loadWorkspace();
              }}
              onError={m => setErrorMsg(m)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="v3-root">
      {/* 48px Frameless Command Topbar */}
      <header className="v3-topbar">
        <div className="v3-brand v3-nodrag">
          <span className="v3-brand-mark">F</span>
          <span className="v3-brand-title">ForgeOps</span>
          <span className="v3-version-badge">v3.0 Focus</span>
          {snapshot.hubs.length > 0 && (
            <select
              className="v3-select"
              style={{padding: '4px 8px', fontSize: 12}}
              value={activeHub?.id ?? ''}
              onChange={e => {
                const nextHub = e.target.value;
                setActiveHubId(nextHub);
                setActiveMissionId(null);
                setActiveDetail(null);
                void loadWorkspace(nextHub);
              }}
            >
              {snapshot.hubs.map(h => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Strictly 3 Top-Level Mode Tabs */}
        <nav className="v3-mode-tabs v3-nodrag" aria-label="Primary Modes">
          <button
            type="button"
            className={`v3-mode-tab ${modeTab === 'focus' ? 'active' : ''}`}
            onClick={() => setModeTab('focus')}
          >
            {label(lang, '焦点任务 Focus', 'Focus Mission')}
            {needsYouCount > 0 && (
              <span className="v3-tab-badge">{needsYouCount}</span>
            )}
          </button>
          <button
            type="button"
            className={`v3-mode-tab ${modeTab === 'memory' ? 'active' : ''}`}
            onClick={() => setModeTab('memory')}
          >
            {label(lang, '记忆库 Memory', 'Memory Bank')}
          </button>
          <button
            type="button"
            className={`v3-mode-tab ${modeTab === 'factory' ? 'active' : ''}`}
            onClick={() => setModeTab('factory')}
          >
            {label(lang, '工厂配置 Factory', 'Factory Config')}
          </button>
        </nav>

        <div className="v3-topbar-right v3-nodrag">
          <span className="v3-pill" title="Loopback SSE Stream">
            <span className={`v3-dot ${sseConnected ? 'live' : ''}`} />
            SSE
          </span>
          <button
            type="button"
            className={`v3-btn ${expertMode ? 'v3-btn-indigo' : ''}`}
            style={{padding: '5px 10px', fontSize: 12}}
            onClick={() => setExpertMode(v => !v)}
          >
            {expertMode
              ? label(lang, '专家透视: 开', 'Expert: ON')
              : label(lang, '标准视图', 'Standard')}
          </button>
          <button
            type="button"
            className="v3-btn"
            style={{padding: '5px 10px', fontSize: 12}}
            onClick={toggleLang}
          >
            {lang === 'ZH' ? '中 / EN' : 'EN / 中'}
          </button>
          <button
            type="button"
            className="v3-btn v3-btn-primary"
            style={{padding: '5px 11px', fontSize: 12.5}}
            onClick={() => {
              setModeTab('focus');
              setComposingNew(true);
            }}
          >
            + {label(lang, '新建任务', 'New Mission')}
          </button>
        </div>
      </header>

      <div className="v3-body">
        {/* Left Collapsible Mission Rail (Focus Mode Only) */}
        {modeTab === 'focus' && (
          <aside className={`v3-rail ${railCollapsed ? 'collapsed' : ''}`}>
            {railCollapsed ? (
              <button
                type="button"
                className="v3-btn v3-btn-ghost"
                title={label(lang, '展开任务列表', 'Expand Mission Rail')}
                onClick={() => setRailCollapsed(false)}
              >
                »
              </button>
            ) : (
              <>
                <div className="v3-rail-head">
                  <div className="v3-rail-title-row">
                    <span>
                      {label(lang, '交付任务队列', 'Missions')} (
                      {missions.length})
                    </span>
                    <button
                      type="button"
                      className="v3-btn v3-btn-ghost"
                      style={{padding: '2px 6px'}}
                      onClick={() => setRailCollapsed(true)}
                    >
                      «
                    </button>
                  </div>
                  <div className="v3-filter-row">
                    <button
                      type="button"
                      className={`v3-filter-chip ${railFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setRailFilter('all')}
                    >
                      {label(lang, '全部', 'All')}
                    </button>
                    <button
                      type="button"
                      className={`v3-filter-chip ${railFilter === 'needs_you' ? 'active' : ''}`}
                      onClick={() => setRailFilter('needs_you')}
                    >
                      {label(lang, '待拍板', 'Action')} ({needsYouCount})
                    </button>
                    <button
                      type="button"
                      className={`v3-filter-chip ${railFilter === 'completed' ? 'active' : ''}`}
                      onClick={() => setRailFilter('completed')}
                    >
                      {label(lang, '已完结', 'Done')}
                    </button>
                  </div>
                </div>

                <div className="v3-rail-list">
                  {filteredMissions.length === 0 ? (
                    <div
                      style={{
                        padding: 14,
                        fontSize: 12.5,
                        color: 'var(--v3-muted)',
                        textAlign: 'center',
                      }}
                    >
                      {label(
                        lang,
                        '当前筛选下暂无任务，点击右侧启动一个一句话需求。',
                        'No missions match this filter yet.',
                      )}
                    </div>
                  ) : (
                    filteredMissions.map(m => {
                      const active = !composingNew && m.id === activeMissionId;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`v3-mission-item ${active ? 'active' : ''}`}
                          onClick={() => {
                            setComposingNew(false);
                            setActiveMissionId(m.id);
                            void loadMissionDetail(m.id);
                          }}
                        >
                          <div className="v3-mission-item-top">
                            <span
                              className="v3-mono"
                              style={{fontSize: 11.5, fontWeight: 700}}
                            >
                              {m.code}
                            </span>
                            <span className={missionBadgeTone(m.status)}>
                              {m.status}
                            </span>
                          </div>
                          <div className="v3-mission-title">{m.title}</div>
                          <div
                            className="v3-mono"
                            style={{fontSize: 11, color: 'var(--v3-muted)'}}
                          >
                            {m.stage} · {m.preset} · {m.executionMode}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </aside>
        )}

        {/* Primary Canvas */}
        <main className="v3-scroll">
          {errorMsg && (
            <div className="v3-canvas" style={{marginBottom: 14}}>
              <div className="v3-banner-error">
                <span>{errorMsg}</span>
                <button
                  type="button"
                  className="v3-btn"
                  onClick={() => setErrorMsg(null)}
                >
                  {label(lang, '知道了', 'Dismiss')}
                </button>
              </div>
            </div>
          )}

          {modeTab === 'focus' && (composingNew || !activeDetail) && (
            <IntentComposer
              lang={lang}
              activeHub={activeHub}
              hubRepos={hubRepos}
              controlSchema={controlSchema}
              onCreated={async mission => {
                setComposingNew(false);
                setActiveMissionId(mission.id);
                await loadWorkspace(activeHub?.id);
                await loadMissionDetail(mission.id);
              }}
              onError={msg => setErrorMsg(msg)}
            />
          )}

          {modeTab === 'focus' && !composingNew && activeDetail && (
            <FocusWorkspace
              lang={lang}
              detail={activeDetail}
              focus={activeDetail.focus}
              controlSchema={controlSchema}
              expertMode={expertMode}
              onRefreshMission={async missionId => {
                await loadWorkspace(activeHub?.id);
                await loadMissionDetail(missionId);
              }}
              onSpawnedMission={async missionId => {
                setActiveMissionId(missionId);
                await loadWorkspace(activeHub?.id);
                await loadMissionDetail(missionId);
              }}
              onRefreshBootstrap={() => loadWorkspace(activeHub?.id)}
              onError={msg => setErrorMsg(msg)}
            />
          )}

          {modeTab === 'memory' && (
            <MemoryWorkspace
              lang={lang}
              activeHub={activeHub}
              onRefreshBootstrap={() => loadWorkspace(activeHub?.id)}
              onError={msg => setErrorMsg(msg)}
            />
          )}

          {modeTab === 'factory' && (
            <FactorySettingsView
              lang={lang}
              snapshot={snapshot}
              activeHub={activeHub}
              onRefresh={() => loadWorkspace(activeHub?.id)}
              onOpenLegacy={() => setLegacyMode(true)}
              onError={msg => setErrorMsg(msg)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

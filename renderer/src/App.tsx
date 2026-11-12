import React, {useCallback, useEffect, useState} from 'react';
import type {BootstrapSnapshot} from '../../src/shared/api.ts';
import {forgeApi} from './api/client.ts';
import {HubDddView} from './views/HubDddView.tsx';
import {InfraFactoryView} from './views/InfraFactoryView.tsx';
import {MemoryObservatoryView} from './views/MemoryObservatoryView.tsx';
import {OverviewView} from './views/OverviewView.tsx';
import {RoomsView} from './views/RoomsView.tsx';
import {WorkstationView} from './views/WorkstationView.tsx';

type NavTab =
  'overview' | 'hub_ddd' | 'workstation' | 'rooms' | 'memory' | 'infra';

export function App(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<BootstrapSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [activeHubId, setActiveHubId] = useState<string>('');
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [sseTick, setSseTick] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);

  const refreshBootstrap = useCallback(async () => {
    try {
      const data = await forgeApi.getBootstrap();
      setSnapshot(data);
      setBootError(null);
      setActiveHubId(prev => prev || data.hubs[0]?.id || '');
      setSelectedChangeId(prev => prev || data.changes[0]?.id || null);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshBootstrap();
    const unsubscribe = forgeApi.subscribeEvents(() => {
      setSseTick(t => t + 1);
      void refreshBootstrap();
    });
    return unsubscribe;
  }, [refreshBootstrap]);

  const handleOpenWorkstation = useCallback((changeId: string) => {
    setSelectedChangeId(changeId);
    setActiveTab('workstation');
  }, []);

  if (bootError) {
    return (
      <div style={{padding: 36}}>
        <div className="card" style={{borderColor: 'var(--accent-rose)'}}>
          <h3 className="card-title">ForgeOps Host Connection Error</h3>
          <p className="mono muted">{bootError}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void refreshBootstrap()}
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        Initializing ForgeOps Control Plane...
      </div>
    );
  }

  const effectiveHubId = activeHubId || snapshot.hubs[0]?.id || '';
  const capsuleByHub = new Map(snapshot.capsules.map(c => [c.hubId, c]));

  return (
    <div className="forge-shell">
      {/* Top Global Federation Hub & Cognitive Retention Bar */}
      <header className="forge-topbar">
        <div className="forge-brand">
          <div className="forge-brand-badge">FO</div>
          <div>
            <div>ForgeOps</div>
            <div
              className="muted"
              style={{fontSize: 10, fontWeight: 500, letterSpacing: '0.04em'}}
            >
              META-HARNESS v2.1
            </div>
          </div>
        </div>

        <div className="forge-hub-switcher">
          {snapshot.hubs.map(hub => {
            const cap = capsuleByHub.get(hub.id);
            const retPct = cap ? Math.round(cap.retentionScore * 100) : 100;
            const hubAttn = snapshot.attentionQueue.filter(
              a => a.hubId === hub.id,
            ).length;
            const badgeCls =
              retPct >= 75
                ? 'badge badge-emerald'
                : retPct >= 35
                  ? 'badge badge-amber'
                  : 'badge badge-rose';

            return (
              <button
                key={hub.id}
                type="button"
                className={`hub-pill ${hub.id === effectiveHubId ? 'active' : ''}`}
                onClick={() => setActiveHubId(hub.id)}
              >
                <span>{hub.name}</span>
                <span className={badgeCls}>R:{retPct}%</span>
                {hubAttn > 0 && (
                  <span className="badge badge-amber">{hubAttn} Needs You</span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <span className="badge badge-cyan">
            Workers {snapshot.slotLoad.activeWorkerSlots}/
            {snapshot.slotLoad.maxWorkerSlots}
          </span>
          <span className="badge badge-indigo">
            Constitution v{snapshot.constitution.version}
          </span>
        </div>
      </header>

      {/* Main Navigation Rail + Active Workspace View */}
      <div className="forge-body">
        <nav className="forge-sidebar">
          <div className="nav-list">
            <button
              type="button"
              className={`nav-btn ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <span>1. Overview & Attention</span>
              {snapshot.attentionQueue.length > 0 && (
                <span className="badge badge-amber">
                  {snapshot.attentionQueue.length}
                </span>
              )}
            </button>

            <button
              type="button"
              className={`nav-btn ${activeTab === 'hub_ddd' ? 'active' : ''}`}
              onClick={() => setActiveTab('hub_ddd')}
            >
              <span>2. Federation Hub & DDD</span>
              <span className="badge badge-slate">
                {snapshot.repositories.length}
              </span>
            </button>

            <button
              type="button"
              className={`nav-btn ${activeTab === 'workstation' ? 'active' : ''}`}
              onClick={() => setActiveTab('workstation')}
            >
              <span>3. Twin-Graph Workstation</span>
              <span className="badge badge-indigo">DAG</span>
            </button>

            <button
              type="button"
              className={`nav-btn ${activeTab === 'rooms' ? 'active' : ''}`}
              onClick={() => setActiveTab('rooms')}
            >
              <span>4. Engineering Rooms</span>
              <span className="badge badge-cyan">5</span>
            </button>

            <button
              type="button"
              className={`nav-btn ${activeTab === 'memory' ? 'active' : ''}`}
              onClick={() => setActiveTab('memory')}
            >
              <span>5. Memory Observatory</span>
            </button>

            <button
              type="button"
              className={`nav-btn ${activeTab === 'infra' ? 'active' : ''}`}
              onClick={() => setActiveTab('infra')}
            >
              <span>6. Infra & Agent Factory</span>
              <span className="badge badge-emerald">
                {snapshot.adapters.filter(a => a.health === 'healthy').length}/
                {snapshot.adapters.length}
              </span>
            </button>
          </div>

          <div
            className="card"
            style={{padding: '10px 11px', background: 'var(--bg-card)'}}
          >
            <div className="form-label">Infra Daemons</div>
            {snapshot.daemons.map(d => (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  marginTop: 5,
                }}
              >
                <span className="muted">{d.label}</span>
                <span
                  style={{
                    color: d.enabled ? '#34d399' : '#64748b',
                    fontWeight: 600,
                  }}
                >
                  {d.runningPass ? 'RUN' : d.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
            ))}
          </div>
        </nav>

        <main
          className={`forge-main ${activeTab === 'workstation' ? 'full-bleed' : ''}`}
        >
          {activeTab === 'overview' && (
            <OverviewView
              snapshot={snapshot}
              activeHubId={effectiveHubId}
              onSelectHub={setActiveHubId}
              onOpenWorkstation={handleOpenWorkstation}
              onRefresh={refreshBootstrap}
            />
          )}

          {activeTab === 'hub_ddd' && (
            <HubDddView
              snapshot={snapshot}
              activeHubId={effectiveHubId}
              onSelectHub={setActiveHubId}
              onOpenWorkstation={handleOpenWorkstation}
              onRefresh={refreshBootstrap}
            />
          )}

          {activeTab === 'workstation' && (
            <WorkstationView
              snapshot={snapshot}
              selectedChangeId={selectedChangeId}
              onSelectChange={setSelectedChangeId}
              sseTick={sseTick}
              onRefreshBootstrap={refreshBootstrap}
            />
          )}

          {activeTab === 'rooms' && (
            <RoomsView
              snapshot={snapshot}
              activeHubId={effectiveHubId}
              sseTick={sseTick}
              onOpenWorkstation={handleOpenWorkstation}
              onRefreshBootstrap={refreshBootstrap}
            />
          )}

          {activeTab === 'memory' && (
            <MemoryObservatoryView
              snapshot={snapshot}
              activeHubId={effectiveHubId}
              sseTick={sseTick}
              onRefreshBootstrap={refreshBootstrap}
            />
          )}

          {activeTab === 'infra' && (
            <InfraFactoryView
              snapshot={snapshot}
              activeHubId={effectiveHubId}
              onOpenWorkstation={handleOpenWorkstation}
              onRefreshBootstrap={refreshBootstrap}
            />
          )}
        </main>
      </div>
    </div>
  );
}

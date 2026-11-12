import React, {useCallback, useEffect, useState} from 'react';
import type {
  BootstrapSnapshot,
  RoomDetailSnapshot,
} from '../../../src/shared/api.ts';
import type {
  PermissionTier,
  RoomScenario,
  RoomThread,
} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';

export interface RoomsViewProps {
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly sseTick: number;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onRefreshBootstrap: () => Promise<void>;
}

function scenarioBadgeClass(scenario: RoomScenario): string {
  switch (scenario) {
    case 'req-grill':
      return 'badge badge-amber';
    case 'arch-council':
      return 'badge badge-indigo';
    case 'triage-ops':
      return 'badge badge-rose';
    case 'direct-ops':
      return 'badge badge-cyan';
    case 'exec-briefing':
      return 'badge badge-emerald';
  }
}

function threadStatusBadge(status: RoomThread['status']): string {
  if (status === 'promoted') return 'badge badge-emerald';
  if (status === 'resolved') return 'badge badge-slate';
  return 'badge badge-cyan';
}

export function RoomsView(props: RoomsViewProps): React.ReactElement {
  const {
    snapshot,
    activeHubId,
    sseTick,
    onOpenWorkstation,
    onRefreshBootstrap,
  } = props;
  const effectiveHubId = activeHubId || snapshot.hubs[0]?.id || '';
  const hubRepos = snapshot.repositories.filter(
    r => r.hubId === effectiveHubId,
  );

  const [roomData, setRoomData] = useState<RoomDetailSnapshot | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [messageBody, setMessageBody] = useState('');

  // New Room form state
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomScenario, setRoomScenario] = useState<RoomScenario>('direct-ops');
  const [roomTopic, setRoomTopic] = useState('');

  // Promote Thread to Change form state
  const [promotingThreadId, setPromotingThreadId] = useState<string>('');
  const [promoteRepoId, setPromoteRepoId] = useState<string>('');
  const [promoteTitle, setPromoteTitle] = useState<string>('');
  const [promoteTier, setPromoteTier] = useState<PermissionTier>('turbo');

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    if (!effectiveHubId) {
      return;
    }
    try {
      const data = await forgeApi.getRooms(
        effectiveHubId,
        selectedRoomId || undefined,
      );
      setRoomData(data);
      if (!selectedRoomId && data.rooms[0]) {
        setSelectedRoomId(data.rooms[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [effectiveHubId, selectedRoomId]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms, sseTick]);

  const rooms = roomData?.rooms ?? [];
  const activeRoom =
    rooms.find(r => r.id === selectedRoomId) ?? rooms[0] ?? null;
  const roomThreads = (roomData?.threads ?? []).filter(
    t => !activeRoom || t.roomId === activeRoom.id,
  );
  const visibleMessages = (roomData?.messages ?? []).filter(m => {
    if (activeRoom && m.roomId !== activeRoom.id) {
      return false;
    }
    if (selectedThreadId && m.threadId !== selectedThreadId) {
      return false;
    }
    return true;
  });

  const mentionChips = [
    '@steward',
    ...snapshot.adapters.map(a => `@${a.manifest.id}`),
  ];

  const handleInsertMention = (tag: string): void => {
    setMessageBody(prev => (prev ? `${prev} ${tag} ` : `${tag} `));
  };

  const handlePostMessage = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!activeRoom || !messageBody.trim()) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const mentions = Array.from(
        messageBody.matchAll(/@([a-zA-Z0-9_-]+)/g),
        m => m[1] ?? '',
      ).filter(Boolean);

      await forgeApi.postRoomMessage({
        roomId: activeRoom.id,
        threadId: selectedThreadId || undefined,
        threadTitle: newThreadTitle.trim() || undefined,
        bodyMarkdown: messageBody.trim(),
        mentions,
      });
      setMessageBody('');
      setNewThreadTitle('');
      await loadRooms();
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!effectiveHubId || !roomName.trim()) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const created = await forgeApi.createRoom({
        hubId: effectiveHubId,
        name: roomName.trim(),
        scenario: roomScenario,
        topic: roomTopic.trim() || 'Collaborative engineering channel',
      });
      setRoomName('');
      setRoomTopic('');
      setShowNewRoom(false);
      setSelectedRoomId(created.id);
      await loadRooms();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePromoteThread = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const targetThreadId = promotingThreadId || selectedThreadId;
    const targetRepoId = promoteRepoId || hubRepos[0]?.id || '';
    if (!targetThreadId || !targetRepoId || !promoteTitle.trim()) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const created = await forgeApi.promoteThreadToChange({
        threadId: targetThreadId,
        repoId: targetRepoId,
        title: promoteTitle.trim(),
        permissionTier: promoteTier,
      });
      setPromoteTitle('');
      setPromotingThreadId('');
      await onRefreshBootstrap();
      onOpenWorkstation(created.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-grid">
      {errorMsg && (
        <div
          className="card"
          style={{borderColor: 'var(--accent-rose)', color: '#fda4af'}}
        >
          {errorMsg}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '250px 1fr 330px',
          gap: 16,
          minHeight: 'calc(100vh - 110px)',
        }}
      >
        {/* Left Channel Rail */}
        <div
          className="card"
          style={{display: 'flex', flexDirection: 'column', gap: 10}}
        >
          <div className="card-header" style={{marginBottom: 4}}>
            <div>
              <h3 className="card-title">Engineering Rooms</h3>
              <p className="card-subtitle">
                5 scenario channels · loop-guarded
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowNewRoom(v => !v)}
            >
              {showNewRoom ? 'Close' : '+ New Room'}
            </button>
          </div>

          {showNewRoom && (
            <form
              onSubmit={e => void handleCreateRoom(e)}
              className="card"
              style={{background: 'var(--bg-card)', padding: 10}}
            >
              <div className="form-row">
                <label className="form-label">Channel Name</label>
                <input
                  className="input mono"
                  required
                  placeholder="settlement-war-room"
                  value={roomName}
                  onChange={e => setRoomName(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Scenario</label>
                <select
                  className="select"
                  value={roomScenario}
                  onChange={e =>
                    setRoomScenario(e.target.value as RoomScenario)
                  }
                >
                  <option value="req-grill">#req-grill (G1 Stress Test)</option>
                  <option value="arch-council">
                    #arch-council (ADR & DDD)
                  </option>
                  <option value="triage-ops">
                    #triage-ops (Gate Forensics)
                  </option>
                  <option value="direct-ops">#direct-ops (@agent Ops)</option>
                  <option value="exec-briefing">
                    #exec-briefing (Overnight Digest)
                  </option>
                </select>
              </div>
              <div className="form-row">
                <label className="form-label">Topic</label>
                <input
                  className="input"
                  placeholder="Cross-service contract alignment"
                  value={roomTopic}
                  onChange={e => setRoomTopic(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={busy}
              >
                Create Channel
              </button>
            </form>
          )}

          <div className="nav-list">
            {rooms.map(room => {
              const isSelected = activeRoom?.id === room.id;
              return (
                <button
                  key={room.id}
                  type="button"
                  className={isSelected ? 'nav-btn active' : 'nav-btn'}
                  onClick={() => {
                    setSelectedRoomId(room.id);
                    setSelectedThreadId('');
                  }}
                >
                  <span className="mono">#{room.name}</span>
                  <span className={scenarioBadgeClass(room.scenario)}>
                    {room.scenario}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center Message Stream + @agent Composer */}
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  {activeRoom ? `#${activeRoom.name}` : 'Select a Room'}
                  {selectedThreadId && (
                    <span className="badge badge-cyan" style={{marginLeft: 8}}>
                      Filtered by Thread
                    </span>
                  )}
                </h3>
                <p className="card-subtitle">{activeRoom?.topic ?? ''}</p>
              </div>
              {selectedThreadId && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setSelectedThreadId('')}
                >
                  Show All Room Messages
                </button>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 'calc(100vh - 340px)',
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {visibleMessages.map(msg => (
                <div
                  key={msg.id}
                  className="card"
                  style={{
                    background:
                      msg.authorKind === 'agent'
                        ? 'rgba(99, 102, 241, 0.09)'
                        : msg.authorKind === 'system'
                          ? 'rgba(16, 185, 129, 0.08)'
                          : 'var(--bg-card)',
                    padding: '9px 12px',
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
                    <div
                      style={{display: 'flex', gap: 6, alignItems: 'center'}}
                    >
                      <strong>{msg.authorLabel}</strong>
                      <span
                        className={
                          msg.authorKind === 'agent'
                            ? 'badge badge-indigo'
                            : msg.authorKind === 'system'
                              ? 'badge badge-emerald'
                              : 'badge badge-slate'
                        }
                      >
                        {msg.authorKind}
                      </span>
                      {msg.mentions.map(m => (
                        <span key={m} className="badge badge-cyan mono">
                          @{m}
                        </span>
                      ))}
                    </div>
                    <span className="muted mono" style={{fontSize: 10.5}}>
                      {new Date(msg.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div
                    style={{
                      whiteSpace: 'pre-wrap',
                      fontSize: 12.5,
                      lineHeight: 1.45,
                    }}
                  >
                    {msg.bodyMarkdown}
                  </div>
                </div>
              ))}
              {visibleMessages.length === 0 && (
                <div className="muted" style={{padding: '12px 0'}}>
                  No messages in this channel yet. Tag an @agent below to start
                  a bounded engineering discussion.
                </div>
              )}
            </div>
          </div>

          <form
            onSubmit={e => void handlePostMessage(e)}
            style={{
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginBottom: 8,
                alignItems: 'center',
              }}
            >
              <span className="form-label" style={{marginRight: 4}}>
                Quick @Mention:
              </span>
              {mentionChips.map(chip => (
                <button
                  key={chip}
                  type="button"
                  className="btn btn-sm mono"
                  onClick={() => handleInsertMention(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>

            {!selectedThreadId && (
              <div className="form-row">
                <input
                  className="input"
                  placeholder="Optional: Start a new Thread Mandate title (e.g. Settlement API Idempotency Spec)"
                  value={newThreadTitle}
                  onChange={e => setNewThreadTitle(e.target.value)}
                />
              </div>
            )}

            <div style={{display: 'flex', gap: 8}}>
              <textarea
                className="textarea"
                rows={2}
                required
                placeholder="Write a directive or @mention an agent (max 2 agent-to-agent hops enforced)..."
                value={messageBody}
                onChange={e => setMessageBody(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !messageBody.trim()}
              >
                Send
              </button>
            </div>
          </form>
        </div>

        {/* Right Thread Mandate Drawer + Promote Thread to Change */}
        <div
          className="card"
          style={{display: 'flex', flexDirection: 'column', gap: 12}}
        >
          <div className="card-header" style={{marginBottom: 0}}>
            <div>
              <h3 className="card-title">Thread Mandates</h3>
              <p className="card-subtitle">
                Promote consensus threads directly into WBS & Twin-Graph Changes
              </p>
            </div>
            <span className="badge badge-indigo">
              {roomThreads.length} Threads
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {roomThreads.map(thd => {
              const isSelected = selectedThreadId === thd.id;
              return (
                <div
                  key={thd.id}
                  className="card"
                  style={{
                    background: isSelected
                      ? 'rgba(99, 102, 241, 0.14)'
                      : 'var(--bg-card)',
                    padding: '9px 11px',
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
                    <strong style={{fontSize: 12}}>{thd.title}</strong>
                    <span className={threadStatusBadge(thd.status)}>
                      {thd.status}
                    </span>
                  </div>
                  <div
                    className="muted"
                    style={{fontSize: 11, marginBottom: 8}}
                  >
                    {thd.mandateScope || 'Scoped collaboration thread'}
                  </div>
                  <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        setSelectedThreadId(isSelected ? '' : thd.id)
                      }
                    >
                      {isSelected ? 'Unfilter' : 'Focus Thread'}
                    </button>
                    {thd.changeId ? (
                      <button
                        type="button"
                        className="btn btn-emerald btn-sm"
                        onClick={() => onOpenWorkstation(thd.changeId!)}
                      >
                        Open Linked Change
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setPromotingThreadId(thd.id);
                          setPromoteTitle(thd.title);
                        }}
                      >
                        Promote to Change
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {roomThreads.length === 0 && (
              <div className="muted" style={{fontSize: 12}}>
                No structured threads in this room yet. Enter a Thread Mandate
                title when posting to create one.
              </div>
            )}
          </div>

          <form
            onSubmit={e => void handlePromoteThread(e)}
            className="card"
            style={{background: 'var(--bg-card)', marginTop: 'auto'}}
          >
            <div className="form-label" style={{marginBottom: 6}}>
              Promote Thread to Change (G1 → G2)
            </div>
            <div className="form-row">
              <label className="form-label">Source Thread</label>
              <select
                className="select"
                value={promotingThreadId || selectedThreadId || ''}
                onChange={e => {
                  const id = e.target.value;
                  setPromotingThreadId(id);
                  const found = roomThreads.find(t => t.id === id);
                  if (found && !promoteTitle) {
                    setPromoteTitle(found.title);
                  }
                }}
              >
                <option value="">-- Select Thread --</option>
                {roomThreads.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label className="form-label">Target Repository</label>
              <select
                className="select"
                value={promoteRepoId || hubRepos[0]?.id || ''}
                onChange={e => setPromoteRepoId(e.target.value)}
              >
                {hubRepos.map(r => (
                  <option key={r.id} value={r.id}>
                    [{r.tier.toUpperCase()}] {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label className="form-label">Change Mandate Title</label>
              <input
                className="input"
                required
                placeholder="Promoted Engineering Change Title"
                value={promoteTitle}
                onChange={e => setPromoteTitle(e.target.value)}
              />
            </div>

            <div className="form-row">
              <label className="form-label">Permission Tier</label>
              <select
                className="select"
                value={promoteTier}
                onChange={e => setPromoteTier(e.target.value as PermissionTier)}
              >
                <option value="turbo">Turbo (Unattended Auto-Advance)</option>
                <option value="supervised">Supervised</option>
                <option value="strict">Strict</option>
              </select>
            </div>

            <button
              type="submit"
              className="btn btn-emerald"
              style={{width: '100%'}}
              disabled={
                busy ||
                !(promotingThreadId || selectedThreadId) ||
                !promoteTitle.trim()
              }
            >
              Promote Thread → Open Twin-Graph
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

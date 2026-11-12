import {useEffect, useState, type ReactElement} from 'react';
import type {
  BootstrapSnapshot,
  RoomDetailSnapshot,
} from '../../../src/shared/api.ts';
import type {PermissionTier} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';
import {PlusIcon, WifiIcon} from '../components/Icons.tsx';

export function RoomsView(props: {
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly refreshTick: number;
  readonly onPromotedChange: (changeId: string) => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {snapshot, activeHubId, refreshTick, onPromotedChange, onError} = props;

  const [roomSnap, setRoomSnap] = useState<RoomDetailSnapshot | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>(
    undefined,
  );
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(
    undefined,
  );
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [promoteRepoId, setPromoteRepoId] = useState('');
  const [promoteTitle, setPromoteTitle] = useState('');
  const [promoteTier, setPromoteTier] = useState<PermissionTier>('turbo');
  const [busy, setBusy] = useState(false);

  const hubRepos = snapshot.repositories.filter(r => r.hubId === activeHubId);

  useEffect(() => {
    if (!activeHubId) return;
    void forgeApi.getRooms(activeHubId, selectedRoomId).then(s => {
      setRoomSnap(s);
      if (!selectedRoomId && s.rooms[0]) {
        setSelectedRoomId(s.rooms[0].id);
      }
    });
  }, [activeHubId, selectedRoomId, refreshTick]);

  const activeRoom =
    roomSnap?.rooms.find(r => r.id === selectedRoomId) ?? roomSnap?.rooms[0];
  const threads = roomSnap?.threads ?? [];
  const visibleMessages = (roomSnap?.messages ?? []).filter(m =>
    selectedThreadId ? m.threadId === selectedThreadId : true,
  );

  const handleSend = async (): Promise<void> => {
    if (!activeRoom || !msgBody.trim()) return;
    setBusy(true);
    try {
      await forgeApi.postRoomMessage({
        roomId: activeRoom.id,
        threadId: selectedThreadId,
        threadTitle:
          !selectedThreadId && newThreadTitle.trim()
            ? newThreadTitle.trim()
            : undefined,
        bodyMarkdown: msgBody.trim(),
      });
      setMsgBody('');
      setNewThreadTitle('');
      const refreshed = await forgeApi.getRooms(activeHubId, activeRoom.id);
      setRoomSnap(refreshed);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePromote = async (): Promise<void> => {
    const repoId = promoteRepoId || hubRepos[0]?.id;
    if (!selectedThreadId || !repoId || !promoteTitle.trim()) return;
    setBusy(true);
    try {
      const chg = await forgeApi.promoteThreadToChange({
        threadId: selectedThreadId,
        repoId,
        title: promoteTitle.trim(),
        permissionTier: promoteTier,
      });
      setPromoteTitle('');
      onPromotedChange(chg.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      <div className="page-header">
        <h1 className="page-h1">
          <WifiIcon size={20} /> Channels Gear — Engineering Rooms
        </h1>
        <p className="page-subtitle">
          Bounded human-agent collaboration channels (`@lead`, `@ddd`, `@qa`,
          `@steward`) with 1-click thread-to-Change promotion.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '250px 1fr',
          gap: 18,
          minHeight: 540,
        }}
      >
        {/* Left Rooms & Threads Column */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="surface-card">
            <div className="surface-card-header">
              <span>Channels</span>
            </div>
            <div
              className="surface-card-body"
              style={{
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {(roomSnap?.rooms ?? []).map(r => (
                <button
                  key={r.id}
                  type="button"
                  className={`nav-item ${activeRoom?.id === r.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedRoomId(r.id);
                    setSelectedThreadId(undefined);
                  }}
                >
                  <span>{r.name}</span>
                  <span className="tag" style={{fontSize: 10}}>
                    {r.scenario}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="surface-card">
            <div className="surface-card-header">
              <span>Threads ({threads.length})</span>
              {selectedThreadId && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setSelectedThreadId(undefined)}
                >
                  All
                </button>
              )}
            </div>
            <div
              className="surface-card-body"
              style={{
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {threads.length === 0 ? (
                <div style={{padding: 8, color: '#94a3b8', fontSize: 12}}>
                  Post with a thread title to open a mandate thread.
                </div>
              ) : (
                threads.map(th => (
                  <button
                    key={th.id}
                    type="button"
                    className={`nav-item ${
                      selectedThreadId === th.id ? 'active' : ''
                    }`}
                    onClick={() => setSelectedThreadId(th.id)}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {th.title}
                    </span>
                    <span
                      className={`tag ${
                        th.status === 'promoted' ? 'tag-green' : ''
                      }`}
                    >
                      {th.status}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Messages Stream & Composer */}
        <div
          className="surface-card"
          style={{display: 'flex', flexDirection: 'column'}}
        >
          <div className="surface-card-header">
            <div>
              <span style={{fontWeight: 700}}>
                {activeRoom?.name ?? '#room'}
              </span>
              <span style={{marginLeft: 10, fontSize: 12, color: '#64748b'}}>
                {activeRoom?.topic}
              </span>
            </div>
            <span className="tag tag-indigo">
              {selectedThreadId ? 'Thread Scoped' : 'Channel Stream'}
            </span>
          </div>

          {selectedThreadId && (
            <div
              style={{
                padding: '10px 18px',
                background: '#f8fafc',
                borderBottom: '1px solid #eef2f6',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <select
                style={{width: 170}}
                value={promoteRepoId || hubRepos[0]?.id || ''}
                onChange={e => setPromoteRepoId(e.target.value)}
              >
                {hubRepos.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Promote thread into governed Change title..."
                value={promoteTitle}
                onChange={e => setPromoteTitle(e.target.value)}
              />
              <select
                style={{width: 120}}
                value={promoteTier}
                onChange={e => setPromoteTier(e.target.value as PermissionTier)}
              >
                <option value="turbo">Turbo</option>
                <option value="supervised">Supervised</option>
                <option value="strict">Strict</option>
              </select>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !promoteTitle.trim()}
                onClick={() => void handlePromote()}
              >
                <PlusIcon size={13} /> Promote
              </button>
            </div>
          )}

          <div
            style={{
              flex: 1,
              padding: 18,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              maxHeight: 380,
            }}
          >
            {visibleMessages.length === 0 ? (
              <div style={{color: '#64748b'}}>
                Mention <code>@lead</code>, <code>@ddd</code>, <code>@qa</code>,
                or <code>@steward</code> to convene an architecture or
                requirement grilling session.
              </div>
            ) : (
              visibleMessages.map(m => (
                <div
                  key={m.id}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                    background:
                      m.authorKind === 'agent' ? '#f5f7ff' : '#ffffff',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                      fontSize: 11.5,
                    }}
                  >
                    <strong style={{color: '#1e293b'}}>
                      {m.authorLabel}{' '}
                      <span
                        className={`tag ${
                          m.authorKind === 'agent' ? 'tag-indigo' : ''
                        }`}
                      >
                        {m.authorKind}
                      </span>
                    </strong>
                    <span style={{color: '#94a3b8'}}>
                      {new Date(m.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{whiteSpace: 'pre-wrap', color: '#334155'}}>
                    {m.bodyMarkdown}
                  </div>
                </div>
              ))
            )}
          </div>

          <div
            style={{
              padding: '14px 18px',
              borderTop: '1px solid #f1f5f9',
              background: '#fafbfc',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {!selectedThreadId && (
              <input
                placeholder="Optional new thread title (e.g. Grill Settlement Retry Spec)"
                value={newThreadTitle}
                onChange={e => setNewThreadTitle(e.target.value)}
              />
            )}
            <div style={{display: 'flex', gap: 8}}>
              <input
                placeholder="Write message... mention @lead, @ddd, @qa, or @steward"
                value={msgBody}
                onChange={e => setMsgBody(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !msgBody.trim()}
                onClick={() => void handleSend()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import {useEffect, useState, type ReactElement} from 'react';
import type {
  BootstrapSnapshot,
  RoomDetailSnapshot,
} from '../../../src/shared/api.ts';
import type {PermissionTier} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';
import {PlusIcon, WifiIcon} from '../components/Icons.tsx';
import {
  formatRoomScenario,
  formatStatusLabel,
  tr,
  type UiLang,
} from '../i18n.ts';

const QUICK_MENTIONS = [
  {tag: '@lead', zh: '@lead 首席架构师', en: '@lead Architect'},
  {tag: '@ddd', zh: '@ddd 领域术语守卫', en: '@ddd Domain Guard'},
  {tag: '@qa', zh: '@qa 独立审计官', en: '@qa Certifier'},
  {tag: '@steward', zh: '@steward 基建管家', en: '@steward Steward'},
] as const;

export function RoomsView(props: {
  readonly lang: UiLang;
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly refreshTick: number;
  readonly onPromotedChange: (changeId: string) => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {lang, snapshot, activeHubId, refreshTick, onPromotedChange, onError} =
    props;

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
          <WifiIcon size={20} />{' '}
          {tr(
            lang,
            '多场景人机工程协作室 (Engineering Rooms)',
            'Channels Gear — Engineering Rooms',
          )}
        </h1>
        <p className="page-subtitle">
          {tr(
            lang,
            '支持需求拷问、架构与 DDD 评审、阻塞升级与联合作战，讨论共识可一键升格为受控双生图变更单。',
            'Bounded human-agent collaboration channels (@lead, @ddd, @qa, @steward) with 1-click thread-to-Change promotion.',
          )}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '268px 1fr',
          gap: 18,
          minHeight: 540,
        }}
      >
        {/* Left Rooms & Threads Column */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="surface-card">
            <div className="surface-card-header">
              <span>{tr(lang, '场景频道', 'Channels')}</span>
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
                  <span>#{r.name}</span>
                  <span className="tag" style={{fontSize: 10}}>
                    {formatRoomScenario(lang, r.scenario)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="surface-card">
            <div className="surface-card-header">
              <span>
                {tr(
                  lang,
                  `议题线程 (${threads.length})`,
                  `Threads (${threads.length})`,
                )}
              </span>
              {selectedThreadId && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setSelectedThreadId(undefined)}
                >
                  {tr(lang, '全部消息', 'All')}
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
                  {tr(
                    lang,
                    '发送消息时填写议题标题即可开启独立授权线程，并支持一键升格为变更单。',
                    'Post with a thread title to open a mandate thread.',
                  )}
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
                      {formatStatusLabel(lang, th.status)}
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
                #{activeRoom?.name ?? 'room'}
              </span>
              <span style={{marginLeft: 10, fontSize: 12, color: '#64748b'}}>
                {activeRoom?.topic}
              </span>
            </div>
            <span className="tag tag-indigo">
              {selectedThreadId
                ? tr(lang, '已锁定议题线程', 'Thread Scoped')
                : tr(lang, '频道全景流', 'Channel Stream')}
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
                style={{width: 175}}
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
                placeholder={tr(
                  lang,
                  '将该线程共识升格为受控变更单标题...',
                  'Promote thread into governed Change title...',
                )}
                value={promoteTitle}
                onChange={e => setPromoteTitle(e.target.value)}
              />
              <select
                style={{width: 135}}
                value={promoteTier}
                onChange={e => setPromoteTier(e.target.value as PermissionTier)}
              >
                <option value="turbo">
                  {tr(lang, '极速自治 (Turbo)', 'Turbo')}
                </option>
                <option value="supervised">
                  {tr(lang, '受控监督 (Supervised)', 'Supervised')}
                </option>
                <option value="strict">
                  {tr(lang, '严格门禁 (Strict)', 'Strict')}
                </option>
              </select>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !promoteTitle.trim()}
                onClick={() => void handlePromote()}
              >
                <PlusIcon size={13} /> {tr(lang, '升格为变更单', 'Promote')}
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
              <div style={{color: '#64748b', lineHeight: 1.6}}>
                {tr(
                  lang,
                  '点击下方角色标签或输入 @lead、@ddd、@qa、@steward，即可通过人类优先预留槽位（Priority Slot）召唤专家智能体开展需求压力测试或架构评审。',
                  'Mention @lead, @ddd, @qa, or @steward to convene an architecture or requirement grilling session.',
                )}
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
                        {m.authorKind === 'agent'
                          ? tr(lang, '智能体', 'agent')
                          : tr(lang, '人类工程师', 'human')}
                      </span>
                    </strong>
                    <span style={{color: '#94a3b8'}}>
                      {new Date(m.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div
                    className="selectable"
                    style={{whiteSpace: 'pre-wrap', color: '#334155'}}
                  >
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
            <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
              {QUICK_MENTIONS.map(qm => (
                <button
                  key={qm.tag}
                  type="button"
                  className="btn btn-sm"
                  style={{height: 24, fontSize: 11.5, padding: '0 8px'}}
                  onClick={() =>
                    setMsgBody(prev =>
                      prev.includes(qm.tag)
                        ? prev
                        : `${qm.tag} ${prev}`.trimStart(),
                    )
                  }
                >
                  {tr(lang, qm.zh, qm.en)}
                </button>
              ))}
            </div>

            {!selectedThreadId && (
              <input
                placeholder={tr(
                  lang,
                  '可选：新建议题线程标题（如：对账结算重试幂等边界拷问）',
                  'Optional new thread title (e.g. Grill Settlement Retry Spec)',
                )}
                value={newThreadTitle}
                onChange={e => setNewThreadTitle(e.target.value)}
              />
            )}
            <div style={{display: 'flex', gap: 8}}>
              <input
                placeholder={tr(
                  lang,
                  '输入讨论内容，可 @lead / @ddd / @qa / @steward 协同推演...',
                  'Write message... mention @lead, @ddd, @qa, or @steward',
                )}
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
                {tr(lang, '发送', 'Send')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

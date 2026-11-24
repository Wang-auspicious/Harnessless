import {useState, type ReactElement} from 'react';
import type {
  AgentPersonaRecord,
  CollabPostRecord,
  WorkspaceTabId,
} from '../../api/v4-types.ts';
import {AgentBrandIcon, resolveBrandForAgent} from './AgentAvatar.tsx';
import {CdsIcon} from './CdsIcon.tsx';
import {RichMediaAttachment} from './RichMediaAttachment.tsx';

export interface ThreadDrawerTabProps {
  readonly rootPost: CollabPostRecord | null;
  readonly replies: readonly CollabPostRecord[];
  readonly agents: readonly AgentPersonaRecord[];
  readonly theme: 'light' | 'dark';
  readonly busy: boolean;
  readonly onReplyThread: (parentPostId: string, text: string) => Promise<void>;
  readonly onToggleResolve: (
    postId: string,
    nextStatus: 'open' | 'resolved',
  ) => Promise<void>;
  readonly onReact: (postId: string, emoji: string) => Promise<void>;
  readonly onOpenTab: (
    tab: WorkspaceTabId,
    extra?: {readonly blockId?: string},
  ) => void;
}

export function ThreadDrawerTab({
  rootPost,
  replies,
  agents,
  theme,
  busy,
  onReplyThread,
  onToggleResolve,
  onReact,
  onOpenTab,
}: ThreadDrawerTabProps): ReactElement {
  const [replyText, setReplyText] = useState('');

  if (!rootPost) {
    return (
      <div className="sd-pane">
        <p className="mp-inspector-empty">
          点击左侧讨论流中任意消息底部的「展开线程」按钮，在此处与多智能体聚焦探讨具体细节。
        </p>
      </div>
    );
  }

  const sendReply = (): void => {
    const trimmed = replyText.trim();
    if (!trimmed || busy) return;
    setReplyText('');
    void onReplyThread(rootPost.id, trimmed);
  };

  return (
    <div className="sd-pane" data-testid="v4-thread-tab">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>讨论线程 · Thread</h3>
          <p>
            {replies.length} 条回复 ·{' '}
            {rootPost.threadStatus === 'resolved'
              ? `已由 ${rootPost.resolvedBy ?? '成员'} 标记解决`
              : '讨论进行中'}
          </p>
        </div>

        <button
          type="button"
          className={`sd-btn ${rootPost.threadStatus === 'resolved' ? '' : 'is-primary'}`}
          disabled={busy}
          onClick={() =>
            void onToggleResolve(
              rootPost.id,
              rootPost.threadStatus === 'resolved' ? 'open' : 'resolved',
            )
          }
        >
          <CdsIcon name="Check" size="xs" />
          <span>
            {rootPost.threadStatus === 'resolved' ? '重新打开' : '标记已解决'}
          </span>
        </button>
      </div>

      {/* Root Post */}
      <div className="sd-post-card">
        <div className="sd-post-head">
          <AgentBrandIcon
            kernelId={
              rootPost.authorKind === 'human'
                ? 'human'
                : resolveBrandForAgent({avatarKey: rootPost.authorAvatar})
            }
            theme={theme}
            size={20}
            framed
          />
          <strong className="sd-post-author">{rootPost.authorName}</strong>
          <span className="sd-post-model">{rootPost.modelLabel}</span>
          <span className="sd-post-time">
            {new Date(rootPost.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <div className="sd-post-body">{rootPost.content}</div>
        {rootPost.attachments.map(att => (
          <RichMediaAttachment
            key={att.id}
            postId={rootPost.id}
            attachment={att}
            busy={busy}
            onOpenTab={onOpenTab}
          />
        ))}
        <div className="sd-post-footer">
          {(['👍', '👀', '✅'] as const).map(emoji => {
            const existing = rootPost.reactions.find(r => r.emoji === emoji);
            return (
              <button
                key={emoji}
                type="button"
                className={`sd-reaction-chip ${existing?.byViewer ? 'is-on' : ''}`}
                onClick={() => void onReact(rootPost.id, emoji)}
              >
                <span>{emoji}</span>
                {existing && existing.count > 0 ? (
                  <span>{existing.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Thread Replies */}
      <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
        {replies.map(r => (
          <div
            key={r.id}
            className="sd-post-card"
            style={{borderLeftWidth: 3, borderLeftColor: r.authorColor}}
          >
            <div className="sd-post-head">
              <AgentBrandIcon
                kernelId={
                  r.authorKind === 'human'
                    ? 'human'
                    : resolveBrandForAgent({avatarKey: r.authorAvatar})
                }
                theme={theme}
                size={18}
                framed
              />
              <strong className="sd-post-author">{r.authorName}</strong>
              <span className="sd-post-model">{r.modelLabel}</span>
              <span className="sd-post-time">
                {new Date(r.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div className="sd-post-body">{r.content}</div>
            {r.attachments.map(att => (
              <RichMediaAttachment
                key={att.id}
                postId={r.id}
                attachment={att}
                busy={busy}
                onOpenTab={onOpenTab}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Thread Reply Box with Quick @Mentions */}
      <div className="sd-card">
        <div
          className="sd-card-body"
          style={{display: 'flex', flexDirection: 'column', gap: 8}}
        >
          <div className="sd-toolbar-row">
            <span style={{fontSize: 11.5, color: 'var(--mp-text-muted)'}}>
              快捷召唤:
            </span>
            {agents.slice(0, 5).map(ag => (
              <button
                key={ag.id}
                type="button"
                className="sd-btn"
                style={{height: 22, fontSize: 11, padding: '0 7px'}}
                onClick={() =>
                  setReplyText(prev =>
                    prev.trim()
                      ? `${prev.trim()} @${ag.handle} `
                      : `@${ag.handle} `,
                  )
                }
              >
                @{ag.handle}
              </button>
            ))}
          </div>
          <div className="sd-toolbar-row">
            <input
              type="text"
              className="sd-input"
              style={{flex: 1}}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') sendReply();
              }}
              placeholder="在此线程补充回复或 @pm / @architect 继续推敲…"
            />
            <button
              type="button"
              className="sd-btn is-primary"
              disabled={busy || !replyText.trim()}
              onClick={sendReply}
            >
              发送回复
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import {useMemo, useState, type ReactElement} from 'react';
import type {
  ArtifactPin,
  CollabFeedItem,
  KernelId,
  ShipReviewFinding,
} from '../../api/v4-types.ts';
import {AgentBrandIcon, type AgentBrandId} from './AgentAvatar.tsx';
import {CdsIcon} from './CdsIcon.tsx';
import {kernelLabel} from './v4-labels.ts';

export type TriageCategory =
  'bug' | 'spec-gap' | 'architecture' | 'verification' | 'ux';

export interface TriageTopic {
  readonly id: string;
  readonly title: string;
  readonly category: TriageCategory;
  readonly status: 'open' | 'in_review' | 'resolved';
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly author: AgentBrandId;
  readonly participants: readonly AgentBrandId[];
  readonly votes: number;
  readonly tags: readonly string[];
  readonly body: string;
  readonly createdAt: string;
  readonly replies: readonly {
    readonly id: string;
    readonly author: AgentBrandId;
    readonly body: string;
    readonly createdAt: string;
  }[];
  readonly readonlySource?: boolean;
}

export interface FeedbackTriageViewProps {
  readonly theme: 'light' | 'dark';
  readonly customTopics: readonly TriageTopic[];
  readonly onCreateTopic: (input: {
    readonly title: string;
    readonly category: TriageCategory;
    readonly severity: 'critical' | 'high' | 'medium' | 'low';
    readonly body: string;
    readonly tags: readonly string[];
  }) => void;
  readonly onVoteTopic: (id: string) => void;
  readonly onToggleResolved: (id: string) => void;
  readonly onReplyTopic: (id: string, body: string) => void;
  readonly onDispatchToMaster: (topic: TriageTopic) => void;
  readonly pins: readonly ArtifactPin[];
  readonly findings: readonly ShipReviewFinding[];
  readonly collabFeed: readonly CollabFeedItem[];
}

const CATEGORY_META: Record<
  TriageCategory,
  {readonly label: string; readonly color: string}
> = {
  bug: {label: '缺陷反馈', color: '#CD2054'},
  'spec-gap': {label: '需求缺口', color: '#5E5D59'},
  architecture: {label: '架构讨论', color: '#2566D0'},
  verification: {label: '独立审校', color: '#1E9E3C'},
  ux: {label: '交互体验', color: '#7C3AED'},
};

function formatRelative(iso: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function FeedbackTriageView({
  theme,
  customTopics,
  onCreateTopic,
  onVoteTopic,
  onToggleResolved,
  onReplyTopic,
  onDispatchToMaster,
  pins,
  findings,
  collabFeed,
}: FeedbackTriageViewProps): ReactElement {
  const [catFilter, setCatFilter] = useState<'all' | TriageCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>(
    'all',
  );
  const [sortBy, setSortBy] = useState<'latest' | 'top'>('latest');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftCat, setDraftCat] = useState<TriageCategory>('bug');
  const [draftSeverity, setDraftSeverity] = useState<
    'critical' | 'high' | 'medium' | 'low'
  >('medium');
  const [draftTags, setDraftTags] = useState('renderer, workflow');
  const [draftBody, setDraftBody] = useState('');
  const [replyText, setReplyText] = useState('');

  // Merge user-submitted topics + real session pins + Ship findings into unified Discourse table
  const allTopics = useMemo<TriageTopic[]>(() => {
    const derivedFromPins: TriageTopic[] = pins.map(pin => ({
      id: `pin-${pin.id}`,
      title: `画布/代码批注 #${pin.pinNumber}: ${pin.promptText.slice(0, 72)}`,
      category:
        pin.surfaceType === 'board' || pin.surfaceType === 'spec_ir'
          ? 'spec-gap'
          : 'verification',
      status: pin.status === 'resolved' ? 'resolved' : 'open',
      severity: pin.status === 'resolved' ? 'low' : 'high',
      author: 'human',
      participants: ['human', 'master'],
      votes: 1,
      tags: [pin.surfaceType, 'pin'],
      body: pin.promptText,
      createdAt: pin.createdAt,
      replies: pin.replyText
        ? [
            {
              id: `${pin.id}-r`,
              author: 'master',
              body: pin.replyText,
              createdAt: pin.resolvedAt ?? pin.createdAt,
            },
          ]
        : [],
      readonlySource: true,
    }));

    const derivedFindings: TriageTopic[] = findings.map(f => ({
      id: `finding-${f.id}`,
      title: `[Ship ${f.severity.toUpperCase()}] ${f.filePath} — ${f.summary}`,
      category: f.category === 'security' ? 'bug' : 'verification',
      status: f.fixedBySteward ? 'resolved' : 'open',
      severity:
        f.severity === 'blocker'
          ? 'critical'
          : f.severity === 'warn'
            ? 'high'
            : 'low',
      author: 'claude-code',
      participants: f.fixedBySteward
        ? ['claude-code', 'master']
        : ['claude-code', 'codex'],
      votes: f.severity === 'blocker' ? 5 : 2,
      tags: [f.category, f.filePath.split('/').pop() ?? 'ship'],
      body: `Ship 独立审校发现问题于 \`${f.filePath}\`：${f.summary}`,
      createdAt:
        collabFeed[collabFeed.length - 1]?.createdAt ??
        new Date().toISOString(),
      replies: [],
      readonlySource: true,
    }));

    return [...customTopics, ...derivedFindings, ...derivedFromPins];
  }, [customTopics, findings, pins, collabFeed]);

  const visibleTopics = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = allTopics.filter(t => {
      if (catFilter !== 'all' && t.category !== catFilter) return false;
      if (statusFilter === 'open' && t.status === 'resolved') return false;
      if (statusFilter === 'resolved' && t.status !== 'resolved') return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'top') {
        return b.votes - a.votes;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [allTopics, catFilter, statusFilter, search, sortBy]);

  const selectedTopic = allTopics.find(t => t.id === selectedId) ?? null;

  const submitNewTopic = (): void => {
    if (!draftTitle.trim()) return;
    onCreateTopic({
      title: draftTitle.trim(),
      category: draftCat,
      severity: draftSeverity,
      body: draftBody.trim() || draftTitle.trim(),
      tags: draftTags
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    });
    setDraftTitle('');
    setDraftBody('');
    setComposerOpen(false);
  };

  return (
    <section
      className="sd-library-page"
      data-testid="v4-view-triage"
      aria-label="Issue and feedback triage"
    >
      <div className="sd-library-inner">
        <header className="sd-library-header">
          <div>
            <h1>议题与缺陷追踪</h1>
            <p className="sd-triage-subtitle">
              统一汇聚多角色审校发现、画布与文档批注以及研发待办问题
            </p>
          </div>
          <div className="sd-toolbar-row">
            <button
              type="button"
              className="sd-btn is-primary"
              onClick={() => setComposerOpen(prev => !prev)}
            >
              <CdsIcon name="Add" size="xs" />
              <span>新建议题</span>
            </button>
          </div>
        </header>

        {composerOpen ? (
          <div className="sd-card">
            <div className="sd-card-head">
              <span>发布工程议题 / 缺陷报告</span>
              <button
                type="button"
                className="sd-thread-action-link"
                onClick={() => setComposerOpen(false)}
              >
                收起
              </button>
            </div>
            <div
              className="sd-card-body"
              style={{display: 'flex', flexDirection: 'column', gap: 10}}
            >
              <input
                type="text"
                className="sd-input"
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
                placeholder="简要概括问题、Spec 缺口或架构阻塞点…"
              />
              <div className="sd-toolbar-row">
                <label className="settings-select sd-compact-select">
                  <select
                    aria-label="Category"
                    value={draftCat}
                    onChange={e =>
                      setDraftCat(e.target.value as TriageCategory)
                    }
                  >
                    {Object.entries(CATEGORY_META).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                  <CdsIcon name="CaretDownSmall" size="xs" />
                </label>

                <label className="settings-select sd-compact-select">
                  <select
                    aria-label="Severity"
                    value={draftSeverity}
                    onChange={e =>
                      setDraftSeverity(
                        e.target.value as
                          'critical' | 'high' | 'medium' | 'low',
                      )
                    }
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <CdsIcon name="CaretDownSmall" size="xs" />
                </label>

                <input
                  type="text"
                  className="sd-input"
                  style={{flex: 1}}
                  value={draftTags}
                  onChange={e => setDraftTags(e.target.value)}
                  placeholder="标签 (逗号分隔，如: worktree, auth, spec)"
                />
              </div>
              <textarea
                rows={3}
                className="sd-input"
                style={{height: 'auto', padding: '8px 10px'}}
                value={draftBody}
                onChange={e => setDraftBody(e.target.value)}
                placeholder="贴入复现步骤、日志、预期行为或上下文文件…"
              />
              <div
                className="sd-toolbar-row"
                style={{justifyContent: 'flex-end'}}
              >
                <button
                  type="button"
                  className="sd-btn is-primary"
                  disabled={!draftTitle.trim()}
                  onClick={submitNewTopic}
                >
                  提交议题
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Discourse-style Filter & Search Toolbar */}
        <div className="sd-triage-controls">
          <div className="sd-subtabs" role="tablist" aria-label="类别过滤">
            <button
              type="button"
              className={catFilter === 'all' ? 'is-on' : ''}
              onClick={() => setCatFilter('all')}
            >
              All
            </button>
            {(Object.keys(CATEGORY_META) as TriageCategory[]).map(cat => (
              <button
                key={cat}
                type="button"
                className={catFilter === cat ? 'is-on' : ''}
                onClick={() => setCatFilter(cat)}
              >
                {CATEGORY_META[cat].label}
              </button>
            ))}
          </div>

          <div className="sd-toolbar-row" style={{marginLeft: 'auto'}}>
            <label
              className="mpw-settings-search"
              style={{margin: 0, width: 200}}
            >
              <CdsIcon name="Search" size="small" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search issues…"
                aria-label="Search triage topics"
              />
            </label>

            <div className="sd-subtabs">
              {(['all', 'open', 'resolved'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  className={statusFilter === st ? 'is-on' : ''}
                  onClick={() => setStatusFilter(st)}
                >
                  {st === 'all' ? 'All' : st === 'open' ? 'Open' : 'Resolved'}
                </button>
              ))}
            </div>

            <div className="sd-subtabs">
              <button
                type="button"
                className={sortBy === 'latest' ? 'is-on' : ''}
                onClick={() => setSortBy('latest')}
              >
                Latest
              </button>
              <button
                type="button"
                className={sortBy === 'top' ? 'is-on' : ''}
                onClick={() => setSortBy('top')}
              >
                Top
              </button>
            </div>
          </div>
        </div>

        {/* Discourse Topic List + Slide-down Detail Thread */}
        <div className="sd-card">
          <table className="sd-table sd-triage-table">
            <thead>
              <tr>
                <th>Topic / Category &amp; Tags</th>
                <th>Participants</th>
                <th style={{width: 72}}>Votes</th>
                <th style={{width: 68}}>Replies</th>
                <th style={{width: 92}}>Status</th>
                <th style={{width: 76}}>Activity</th>
              </tr>
            </thead>
            <tbody>
              {visibleTopics.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: 'center',
                      padding: 28,
                      color: 'var(--mp-text-muted)',
                    }}
                  >
                    暂无匹配的议题，点击右上角「新建议题 New Topic」或从
                    Chat/Ship 转发问题。
                  </td>
                </tr>
              ) : (
                visibleTopics.map(topic => {
                  const meta = CATEGORY_META[topic.category];
                  const isSelected = selectedTopic?.id === topic.id;
                  return (
                    <tr
                      key={topic.id}
                      className={`sd-triage-row ${isSelected ? 'is-selected' : ''}`}
                      onClick={() =>
                        setSelectedId(prev =>
                          prev === topic.id ? null : topic.id,
                        )
                      }
                    >
                      <td>
                        <div className="sd-triage-title">{topic.title}</div>
                        <div className="sd-triage-meta-row">
                          <span className="sd-triage-cat">
                            <span
                              className="sd-triage-cat-dot"
                              style={{background: meta.color}}
                            />
                            <span>{meta.label}</span>
                          </span>
                          <span
                            className={`sd-pill ${topic.severity === 'critical' ? 'is-danger' : topic.severity === 'high' ? 'is-clay' : ''}`}
                          >
                            {topic.severity}
                          </span>
                          {topic.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="sd-triage-tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="sd-triage-avatars">
                          {topic.participants.map(p => (
                            <AgentBrandIcon
                              key={p}
                              kernelId={p}
                              theme={theme}
                              size={18}
                              framed
                            />
                          ))}
                        </div>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          className="sd-btn"
                          style={{height: 24, padding: '0 8px'}}
                          onClick={() => onVoteTopic(topic.id)}
                          title="投票提升优先级"
                        >
                          ▲ {topic.votes}
                        </button>
                      </td>
                      <td style={{color: 'var(--mp-text-muted)'}}>
                        {topic.replies.length}
                      </td>
                      <td>
                        <span
                          className={`sd-pill ${topic.status === 'resolved' ? 'is-success' : ''}`}
                        >
                          {topic.status === 'resolved' ? '已解决' : '待处理'}
                        </span>
                      </td>
                      <td
                        style={{
                          color: 'var(--mp-text-muted)',
                          fontSize: 11.5,
                        }}
                      >
                        {formatRelative(topic.createdAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {selectedTopic ? (
          <div className="sd-card sd-triage-thread">
            <div className="sd-card-head">
              <div className="sd-toolbar-row">
                <AgentBrandIcon
                  kernelId={selectedTopic.author}
                  theme={theme}
                  size={20}
                  framed
                />
                <strong>{selectedTopic.title}</strong>
              </div>
              <div className="sd-toolbar-row">
                <button
                  type="button"
                  className="sd-btn is-primary"
                  onClick={() => onDispatchToMaster(selectedTopic)}
                >
                  <CdsIcon name="ArrowRight" size="xs" />
                  <span>派发给研发团队处理</span>
                </button>
                {!selectedTopic.readonlySource ? (
                  <button
                    type="button"
                    className="sd-btn"
                    onClick={() => onToggleResolved(selectedTopic.id)}
                  >
                    {selectedTopic.status === 'resolved'
                      ? 'Reopen'
                      : 'Mark Resolved'}
                  </button>
                ) : null}
              </div>
            </div>
            <div
              className="sd-card-body"
              style={{display: 'flex', flexDirection: 'column', gap: 12}}
            >
              <div style={{fontSize: 13, lineHeight: '20px'}}>
                {selectedTopic.body}
              </div>

              {selectedTopic.replies.length > 0 ? (
                <div className="sd-thread-drawer">
                  {selectedTopic.replies.map(r => (
                    <div key={r.id} className="sd-thread-item">
                      <AgentBrandIcon
                        kernelId={r.author}
                        theme={theme}
                        size={16}
                      />
                      <strong>
                        {r.author === 'human'
                          ? 'Human'
                          : kernelLabel(r.author as KernelId)}
                      </strong>
                      <span>{r.body}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {!selectedTopic.readonlySource ? (
                <div className="sd-toolbar-row">
                  <input
                    type="text"
                    className="sd-input"
                    style={{flex: 1}}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="添加讨论回复或排查记录…"
                  />
                  <button
                    type="button"
                    className="sd-btn"
                    disabled={!replyText.trim()}
                    onClick={() => {
                      const txt = replyText.trim();
                      if (!txt) return;
                      onReplyTopic(selectedTopic.id, txt);
                      setReplyText('');
                    }}
                  >
                    回复议题
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

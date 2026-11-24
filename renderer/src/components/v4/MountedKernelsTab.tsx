import {useState, type ReactElement} from 'react';
import type {
  CollabFeedItem,
  KernelId,
  NativeKernelCard,
  TaskNodeRole,
} from '../../api/v4-types.ts';
import {ALL_KERNELS, ROLE_LABELS, kernelLabel} from './v4-labels.ts';

export interface MountedKernelsTabProps {
  readonly sessionId: string | null;
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly collabFeed: readonly CollabFeedItem[];
  readonly busy: boolean;
  readonly onProbeKernels: () => Promise<void>;
  readonly onUpdateRouting: (
    patch: Partial<Record<TaskNodeRole, KernelId>>,
  ) => Promise<void>;
  readonly onPostCollab: (input: {
    readonly fromKernel: KernelId;
    readonly toKernel: KernelId;
    readonly kind: string;
    readonly audienceScope: string;
    readonly content: string;
  }) => Promise<void>;
}

const ROLES: readonly TaskNodeRole[] = [
  'architect',
  'coder',
  'tester',
  'reviewer',
  'steward',
];

export function MountedKernelsTab({
  sessionId,
  kernels,
  roleRouting,
  collabFeed,
  busy,
  onProbeKernels,
  onUpdateRouting,
  onPostCollab,
}: MountedKernelsTabProps): ReactElement {
  const [fromKernel, setFromKernel] = useState<KernelId>('codex');
  const [toKernel, setToKernel] = useState<KernelId>('claude-code');
  const [kind, setKind] = useState('handoff');
  const [audienceScope, setAudienceScope] = useState('team');
  const [content, setContent] = useState('');

  const handleSendCollab = async (): Promise<void> => {
    const trimmed = content.trim();
    if (!trimmed || !sessionId) {
      return;
    }
    await onPostCollab({
      fromKernel,
      toKernel,
      kind,
      audienceScope,
      content: trimmed,
    });
    setContent('');
  };

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
      <div className="cds-toolbar">
        <div>
          <h3 className="cds-card-title">
            原生 Agent 内核挂载与跨 Agent 协作总线
          </h3>
          <p className="cds-card-sub">
            探测本机已安装的 Claude Code / Codex / Gemini CLI / OpenCode
            版本与路径，并监控 CollabBus 消息流。
          </p>
        </div>
        <button
          type="button"
          className="cds-btn is-sm is-clay"
          disabled={busy}
          onClick={() => void onProbeKernels()}
        >
          重新探测本机 CLI
        </button>
      </div>

      <div className="cds-card">
        <strong style={{fontSize: 12.5}}>
          本机原生内核探测表 ({kernels.length})
        </strong>
        <table className="cds-table">
          <thead>
            <tr>
              <th>内核</th>
              <th>状态</th>
              <th>版本</th>
              <th>可执行路径 / 命令</th>
              <th>推荐角色</th>
            </tr>
          </thead>
          <tbody>
            {kernels.map(k => (
              <tr key={k.kernelId}>
                <td>
                  <strong>{k.displayName}</strong>
                </td>
                <td>
                  <span
                    className={`cds-stage-pill ${k.status === 'ready' || k.status === 'builtin' ? 'is-success' : k.status === 'degraded' ? 'is-warning' : ''}`}
                  >
                    {k.status}
                  </span>
                </td>
                <td>
                  <span className="cds-mono-chip">
                    {k.version ?? (k.installed ? 'detected' : '—')}
                  </span>
                </td>
                <td
                  style={{
                    fontFamily: 'var(--cds-font-mono)',
                    fontSize: 11,
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={k.binaryPath ?? k.command}
                >
                  {k.binaryPath ?? k.command}
                </td>
                <td>{k.defaultRoles.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cds-card">
        <strong style={{fontSize: 12.5}}>角色默认路由表</strong>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 8,
          }}
        >
          {ROLES.map(role => (
            <label
              key={role}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: 11.5,
                color: 'var(--cds-text-muted)',
              }}
            >
              <span>{ROLE_LABELS[role]}</span>
              <select
                className="cds-select"
                disabled={busy}
                value={roleRouting[role] ?? 'native-api'}
                onChange={e =>
                  void onUpdateRouting({[role]: e.target.value as KernelId})
                }
              >
                {ALL_KERNELS.map(k => (
                  <option key={k} value={k}>
                    {kernelLabel(k)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="cds-card">
        <div className="cds-card-head">
          <strong style={{fontSize: 12.5}}>
            跨 Agent 协作总线 (CollabBus · {collabFeed.length})
          </strong>
          <span style={{fontSize: 11, color: 'var(--cds-text-muted)'}}>
            受 Audience Scope 权限交集保护
          </span>
        </div>

        <div className="cds-toolbar">
          <div className="cds-toolbar-group">
            <select
              aria-label="发送方内核"
              className="cds-select"
              value={fromKernel}
              onChange={e => setFromKernel(e.target.value as KernelId)}
            >
              <option value="master">Master Agent</option>
              {ALL_KERNELS.map(k => (
                <option key={k} value={k}>
                  {kernelLabel(k)}
                </option>
              ))}
            </select>
            <span>→</span>
            <select
              aria-label="接收方内核"
              className="cds-select"
              value={toKernel}
              onChange={e => setToKernel(e.target.value as KernelId)}
            >
              <option value="master">Master Agent</option>
              {ALL_KERNELS.map(k => (
                <option key={k} value={k}>
                  {kernelLabel(k)}
                </option>
              ))}
            </select>
            <select
              aria-label="消息类型"
              className="cds-select"
              value={kind}
              onChange={e => setKind(e.target.value)}
            >
              <option value="handoff">handoff</option>
              <option value="review">review</option>
              <option value="question">question</option>
              <option value="finding">finding</option>
              <option value="delegate">delegate</option>
            </select>
            <select
              aria-label="可见域"
              className="cds-select"
              value={audienceScope}
              onChange={e => setAudienceScope(e.target.value)}
            >
              <option value="team">team</option>
              <option value="world">world</option>
              <option value="private:master">private:master</option>
            </select>
          </div>
        </div>

        <div className="cds-toolbar">
          <input
            type="text"
            className="cds-input"
            style={{flex: 1}}
            disabled={!sessionId}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={
              sessionId
                ? '输入测试协作消息 (例如: 已完成核心接口，请 Reviewer 校验并发边界)...'
                : '请先打开或创建一个会话以发送协作消息'
            }
          />
          <button
            type="button"
            className="cds-btn is-sm is-primary"
            disabled={busy || !sessionId || !content.trim()}
            onClick={() => void handleSendCollab()}
          >
            发信协作
          </button>
        </div>

        {collabFeed.length === 0 ? (
          <div className="cds-empty" style={{padding: 16}}>
            暂无跨内核协作消息。启动多内核并行执行或手动发信协作后将实时记录在此。
          </div>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
            {collabFeed.map(item => (
              <div key={item.id} className="cds-collab-strip">
                <div className="cds-collab-route">
                  <span className="cds-mono-chip">#{item.seq}</span>
                  <span className="cds-agent-pill is-master">
                    {kernelLabel(item.fromKernel)}
                  </span>
                  <span>→</span>
                  <span className="cds-agent-pill">
                    {kernelLabel(item.toKernel)}
                  </span>
                  <span className="cds-stage-pill">{item.kind}</span>
                  <span className="cds-mono-chip">{item.audienceScope}</span>
                  <span>{item.content}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

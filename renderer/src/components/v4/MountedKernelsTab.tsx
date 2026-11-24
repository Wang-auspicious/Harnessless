import {useState, type ReactElement} from 'react';
import type {
  CollabFeedItem,
  KernelId,
  NativeKernelCard,
  TaskNodeRole,
} from '../../api/v4-types.ts';
import {AgentBrandIcon} from './AgentAvatar.tsx';
import {CdsIcon} from './CdsIcon.tsx';
import {ALL_KERNELS, ROLE_LABELS, kernelLabel} from './v4-labels.ts';

export interface MountedKernelsTabProps {
  readonly sessionId: string | null;
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly collabFeed: readonly CollabFeedItem[];
  readonly theme?: 'light' | 'dark';
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
  theme = 'light',
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
    <div className="sd-pane">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>原生 Agent 内核挂载与跨 Agent 协作总线</h3>
          <p>
            探测本机 Claude Code / Codex / Gemini CLI / OpenCode
            真实内核并路由至 WBS 角色。
          </p>
        </div>

        <button
          type="button"
          className="sd-btn is-primary"
          disabled={busy}
          onClick={() => void onProbeKernels()}
        >
          <CdsIcon name="ArrowClockwise" size="xs" />
          <span>重新探测 CLI</span>
        </button>
      </div>

      <div className="sd-card">
        <div className="sd-card-head">
          <span>本机原生内核探测表 ({kernels.length})</span>
        </div>
        <table className="sd-table">
          <thead>
            <tr>
              <th>内核</th>
              <th>状态</th>
              <th>版本</th>
              <th>可执行路径</th>
              <th>推荐角色</th>
            </tr>
          </thead>
          <tbody>
            {kernels.map(k => (
              <tr key={k.kernelId}>
                <td>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <AgentBrandIcon
                      kernelId={k.kernelId}
                      theme={theme}
                      size={18}
                      status={k.status}
                    />
                    <strong>{k.displayName}</strong>
                  </div>
                </td>
                <td>
                  <span
                    className={`sd-pill ${k.status === 'ready' || k.status === 'builtin' ? 'is-success' : k.status === 'degraded' ? 'is-clay' : ''}`}
                  >
                    {k.status}
                  </span>
                </td>
                <td>
                  <span
                    className="sd-pill"
                    style={{fontFamily: 'var(--mp-font-mono)'}}
                  >
                    {k.version ?? (k.installed ? 'detected' : '—')}
                  </span>
                </td>
                <td
                  style={{
                    fontFamily: 'var(--mp-font-mono)',
                    fontSize: 11,
                    maxWidth: 180,
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

      <div className="sd-card">
        <div className="sd-card-head">
          <span>角色默认路由矩阵</span>
        </div>
        <div
          className="sd-card-body"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
            gap: 10,
          }}
        >
          {ROLES.map(role => {
            const assigned = roleRouting[role] ?? 'native-api';
            return (
              <label
                key={role}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  fontSize: 11.5,
                  color: 'var(--mp-text-muted)',
                }}
              >
                <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                  <AgentBrandIcon kernelId={assigned} theme={theme} size={14} />
                  <span>{ROLE_LABELS[role]}</span>
                </span>
                <span className="settings-select sd-compact-select">
                  <select
                    disabled={busy}
                    value={assigned}
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
                  <CdsIcon name="CaretDownSmall" size="xs" />
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="sd-card">
        <div className="sd-card-head">
          <span>跨 Agent 协作总线 (CollabBus · {collabFeed.length})</span>
          <span style={{fontSize: 11, color: 'var(--mp-text-muted)'}}>
            Audience Scope 权限交集保护
          </span>
        </div>

        <div
          className="sd-card-body"
          style={{display: 'flex', flexDirection: 'column', gap: 10}}
        >
          <div className="sd-toolbar-row">
            <label className="settings-select sd-compact-select">
              <select
                aria-label="发送方内核"
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
              <CdsIcon name="CaretDownSmall" size="xs" />
            </label>
            <CdsIcon name="ArrowRight" size="xs" />
            <label className="settings-select sd-compact-select">
              <select
                aria-label="接收方内核"
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
              <CdsIcon name="CaretDownSmall" size="xs" />
            </label>
            <label className="settings-select sd-compact-select">
              <select
                aria-label="消息类型"
                value={kind}
                onChange={e => setKind(e.target.value)}
              >
                <option value="handoff">handoff</option>
                <option value="review">review</option>
                <option value="question">question</option>
                <option value="finding">finding</option>
                <option value="delegate">delegate</option>
              </select>
              <CdsIcon name="CaretDownSmall" size="xs" />
            </label>
            <label className="settings-select sd-compact-select">
              <select
                aria-label="可见域"
                value={audienceScope}
                onChange={e => setAudienceScope(e.target.value)}
              >
                <option value="team">team</option>
                <option value="world">world</option>
                <option value="private:master">private:master</option>
              </select>
              <CdsIcon name="CaretDownSmall" size="xs" />
            </label>
          </div>

          <div className="sd-toolbar-row">
            <input
              type="text"
              className="sd-input"
              style={{flex: 1}}
              disabled={!sessionId}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={
                sessionId
                  ? '输入跨内核协作消息 (例如: 已完成核心接口，请 Reviewer 校验并发边界)…'
                  : '请先打开或创建一个会话以发送协作消息'
              }
            />
            <button
              type="button"
              className="sd-btn is-ink"
              disabled={busy || !sessionId || !content.trim()}
              onClick={() => void handleSendCollab()}
            >
              发信协作
            </button>
          </div>

          {collabFeed.length === 0 ? (
            <p className="mp-inspector-empty">
              暂无跨内核协作消息。启动多内核并行执行或手动发信协作后将实时记录于此。
            </p>
          ) : (
            <div>
              {collabFeed.map(item => (
                <div key={item.id} className="sd-wbs-row">
                  <div className="sd-wbs-title">
                    <span
                      className="sd-pill"
                      style={{fontFamily: 'var(--mp-font-mono)'}}
                    >
                      #{item.seq}
                    </span>
                    <AgentBrandIcon
                      kernelId={item.fromKernel}
                      theme={theme}
                      size={15}
                    />
                    <span>
                      {kernelLabel(item.fromKernel)} →{' '}
                      {kernelLabel(item.toKernel)}
                    </span>
                    <span className="sd-pill">{item.kind}</span>
                    <span className="sd-pill">{item.audienceScope}</span>
                  </div>
                  <p className="sd-wbs-desc">{item.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

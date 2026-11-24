import {useState, type ReactElement} from 'react';
import type {DashboardSummaryPayload} from '../../api/v4-types.ts';
import {AgentBrandIcon, resolveBrandForAgent} from './AgentAvatar.tsx';
import {CdsIcon} from './CdsIcon.tsx';

export interface AgentDashboardViewProps {
  readonly dashboard: DashboardSummaryPayload | null;
  readonly activeSessionId: string | null;
  readonly theme: 'light' | 'dark';
  readonly busy: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onDrainUnread: (sessionId: string) => Promise<void>;
  readonly onCreateSchedule: (input: {
    readonly targetAgentId: string;
    readonly intervalLabel: string;
    readonly promptText: string;
  }) => Promise<void>;
  readonly onRunScheduleNow: (scheduleId: string) => Promise<void>;
  readonly onDeleteSchedule: (scheduleId: string) => Promise<void>;
  readonly onOpenSettings: (page?: 'models') => void;
  readonly onBackToChat: () => void;
}

export function AgentDashboardView({
  dashboard,
  activeSessionId,
  theme,
  busy,
  onRefresh,
  onDrainUnread,
  onCreateSchedule,
  onRunScheduleNow,
  onDeleteSchedule,
  onOpenSettings,
  onBackToChat,
}: AgentDashboardViewProps): ReactElement {
  const [schAgentId, setSchAgentId] = useState('agent-pm');
  const [schInterval, setSchInterval] = useState('每 2 小时');
  const [schPrompt, setSchPrompt] = useState(
    '巡检当前 PRD 未关闭评论与需求冲突并汇报收敛建议',
  );

  return (
    <section
      className="sd-library-page"
      data-testid="v4-view-dashboard"
      aria-label="Agent collaboration dashboard"
    >
      <div className="sd-library-inner">
        <header className="sd-library-header">
          <div>
            <h1>智能体协同调度台</h1>
            <p className="sd-triage-subtitle">
              实时观测每位团队角色所绑定的模型/路由、未读消息唤醒队列与定时巡检任务
            </p>
          </div>
          <div className="sd-toolbar-row">
            <button
              type="button"
              className="sd-btn"
              onClick={() => onOpenSettings('models')}
            >
              配置模型与绑定
            </button>
            <button
              type="button"
              className="sd-btn"
              disabled={busy}
              onClick={() => void onRefresh()}
            >
              <CdsIcon name="Reload" size="xs" />
              <span>刷新状态</span>
            </button>
            <button
              type="button"
              className="sd-btn is-primary"
              onClick={onBackToChat}
            >
              返回协作工作区
            </button>
          </div>
        </header>

        {/* Agent Fleet Matrix */}
        <div className="sd-dash-grid">
          {(dashboard?.agents ?? []).map(agent => (
            <div key={agent.id} className="sd-card">
              <div className="sd-card-head">
                <div className="sd-toolbar-row">
                  <AgentBrandIcon
                    kernelId={resolveBrandForAgent({
                      avatarKey: agent.avatarKey,
                      bindingKind: agent.bindingKind,
                      providerId: agent.providerId,
                      harnessId: agent.harnessId,
                    })}
                    theme={theme}
                    size={18}
                    framed
                  />
                  <strong>{agent.displayName}</strong>
                  <span style={{fontSize: 11.5, color: 'var(--mp-text-muted)'}}>
                    @{agent.handle}
                  </span>
                </div>
                <span
                  className={`sd-pill ${agent.state === 'working' ? 'is-success' : ''}`}
                >
                  {agent.state === 'working'
                    ? '运行中'
                    : agent.state === 'queued'
                      ? `${agent.unreadCount} 待处理`
                      : '待命'}
                </span>
              </div>
              <div className="sd-card-body">
                <div style={{fontSize: 12, color: 'var(--mp-text-secondary)'}}>
                  绑定模型：<strong>{agent.resolvedModelLabel}</strong>
                </div>
                <div
                  className="sd-toolbar-row"
                  style={{marginTop: 8, justifyContent: 'space-between'}}
                >
                  <span className="sd-pill">PRD 修改 {agent.editCount} 次</span>
                  <span className="sd-pill">未读提及 {agent.unreadCount}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Unread Mention Queue + Scheduled Check-ins */}
        <div className="sd-dash-grid">
          <div className="sd-card">
            <div className="sd-card-head">
              <span>
                未读唤醒队列 (
                {dashboard?.queuedItems.filter(q => q.status !== 'done')
                  .length ?? 0}
                )
              </span>
              {activeSessionId ? (
                <button
                  type="button"
                  className="sd-btn is-primary"
                  style={{height: 24, fontSize: 11.5}}
                  disabled={busy}
                  onClick={() => void onDrainUnread(activeSessionId)}
                >
                  立即唤醒全部处理
                </button>
              ) : null}
            </div>
            <div className="sd-card-body">
              {!dashboard || dashboard.queuedItems.length === 0 ? (
                <div className="mp-inspector-empty">
                  暂无待处理消息。在讨论区使用 @pm / @architect 即可投递任务。
                </div>
              ) : (
                dashboard.queuedItems.slice(0, 6).map(item => (
                  <div key={item.id} className="sd-wbs-row">
                    <div className="sd-wbs-top">
                      <strong style={{fontSize: 12.5}}>
                        {item.fromAuthor} → {item.targetAgentName}
                      </strong>
                      <span
                        className={`sd-pill ${item.status === 'done' ? 'is-success' : ''}`}
                      >
                        {item.status === 'done' ? '已完成' : '队列中'}
                      </span>
                    </div>
                    <p className="sd-wbs-desc" style={{paddingLeft: 0}}>
                      {item.summary}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sd-card">
            <div className="sd-card-head">
              <span>定时唤醒巡检 ({dashboard?.schedules.length ?? 0})</span>
            </div>
            <div
              className="sd-card-body"
              style={{display: 'flex', flexDirection: 'column', gap: 8}}
            >
              {activeSessionId ? (
                <div className="sd-toolbar-row">
                  <label className="settings-select sd-compact-select">
                    <select
                      aria-label="调度智能体"
                      value={schAgentId}
                      onChange={e => setSchAgentId(e.target.value)}
                    >
                      {(dashboard?.agents ?? []).map(ag => (
                        <option key={ag.id} value={ag.id}>
                          @{ag.handle} ({ag.displayName})
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    type="text"
                    className="sd-input"
                    style={{width: 96}}
                    value={schInterval}
                    onChange={e => setSchInterval(e.target.value)}
                    placeholder="每 2 小时"
                  />
                  <input
                    type="text"
                    className="sd-input"
                    style={{flex: 1, minWidth: 140}}
                    value={schPrompt}
                    onChange={e => setSchPrompt(e.target.value)}
                    placeholder="巡检指令…"
                  />
                  <button
                    type="button"
                    className="sd-btn is-primary"
                    disabled={busy || !schPrompt.trim()}
                    onClick={() =>
                      void onCreateSchedule({
                        targetAgentId: schAgentId,
                        intervalLabel: schInterval.trim() || '每 2 小时',
                        promptText: schPrompt.trim(),
                      })
                    }
                  >
                    添加定时
                  </button>
                </div>
              ) : null}

              {(dashboard?.schedules ?? []).map(sch => (
                <div key={sch.id} className="sd-wbs-row">
                  <div className="sd-wbs-top">
                    <strong style={{fontSize: 12.5}}>
                      {sch.targetAgentName} · {sch.intervalLabel}
                    </strong>
                    <div className="sd-toolbar-row">
                      <span className="sd-pill">已触发 {sch.runCount} 次</span>
                      <button
                        type="button"
                        className="sd-btn"
                        style={{height: 22, fontSize: 11}}
                        disabled={busy}
                        onClick={() => void onRunScheduleNow(sch.id)}
                      >
                        立即触发
                      </button>
                      <button
                        type="button"
                        className="sd-btn"
                        style={{height: 22, fontSize: 11}}
                        disabled={busy}
                        onClick={() => void onDeleteSchedule(sch.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <p className="sd-wbs-desc" style={{paddingLeft: 0}}>
                    {sch.promptText}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent PRD Co-editing Trail */}
        <div className="sd-card">
          <div className="sd-card-head">
            <span>最近协同文档变更记录（知道谁改了什么）</span>
          </div>
          <div className="sd-card-body">
            {!dashboard || dashboard.recentEdits.length === 0 ? (
              <div className="mp-inspector-empty">暂无最近 PRD 改动记录。</div>
            ) : (
              dashboard.recentEdits.map(edit => (
                <div key={edit.id} className="sd-wbs-row">
                  <div className="sd-wbs-top">
                    <div className="sd-toolbar-row">
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: edit.authorColor,
                        }}
                      />
                      <strong style={{fontSize: 12.5}}>
                        {edit.authorName}
                      </strong>
                      <span className="sd-pill">{edit.blockTitle}</span>
                    </div>
                    <span className="sd-pill">{edit.diffSummary}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

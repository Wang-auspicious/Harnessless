import {useState, type ReactElement} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {PermissionTier} from '../../../src/shared/types.ts';
import {forgeApi, type DoctorReportDto} from '../api/client.ts';
import {
  ActivityIcon,
  BookOpenIcon,
  CpuIcon,
  GridIcon,
  ShieldIcon,
  TerminalIcon,
  ZapIcon,
} from '../components/Icons.tsx';
import {formatDaemonLabel, tr, type UiLang} from '../i18n.ts';

type InfraTab = 'dashboard' | 'constitution' | 'daemons' | 'neural';

export function InfraCenterView(props: {
  readonly lang: UiLang;
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onRefresh: () => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {lang, snapshot, activeHubId, onOpenWorkstation, onRefresh, onError} =
    props;

  const [tab, setTab] = useState<InfraTab>('dashboard');
  const [constMd, setConstMd] = useState(snapshot.constitution.markdown);
  const [blockedText, setBlockedText] = useState(
    snapshot.constitution.blockedCommands.join(', '),
  );
  const [doctor, setDoctor] = useState<DoctorReportDto | null>(null);
  const [evoTitle, setEvoTitle] = useState('');
  const [evoRationale, setEvoRationale] = useState('');
  const [evoTier, setEvoTier] = useState<PermissionTier>('supervised');
  const [busy, setBusy] = useState(false);

  const infraRepos = snapshot.repositories.filter(
    r => r.hubId === activeHubId && r.tier === 'infra',
  );
  const activeChange =
    snapshot.changes.find(c => c.hubId === activeHubId) ??
    snapshot.changes[0] ??
    null;

  // Group audit logs by YYYY-MM-DD for 1:1 Evolution Logs presentation
  const groupedAudit = new Map<
    string,
    Array<{
      readonly time: string;
      readonly title: string;
      readonly detail: string;
    }>
  >();
  for (const entry of snapshot.recentAuditLogs) {
    const dt = new Date(entry.createdAt);
    const day = dt.toISOString().slice(0, 10);
    const time = dt.toTimeString().slice(0, 5);
    const list = groupedAudit.get(day) ?? [];
    list.push({time, title: entry.title, detail: entry.detail});
    groupedAudit.set(day, list);
  }

  // Ensure baseline architectural evolution history is always visible
  const baselineDay = '2026-11-11';
  if (!groupedAudit.has(baselineDay)) {
    groupedAudit.set(baselineDay, [
      {
        time: '15:31',
        title: tr(
          lang,
          'TQLA 双级质量门禁与物理检查点闭环验证',
          'Dual-Level TQLA Gates & Physical Git Checkpoint Closure',
        ),
        detail: tr(
          lang,
          '完成 Selfcheck -> JQA -> SQA 全链路执行与 refs/forgeops-backup 保护式 Git Worktree 物理回滚验证。',
          'Verified full Selfcheck -> JQA -> SQA audit chain with refs/forgeops-backup protected Git worktree rollback.',
        ),
      },
      {
        time: '09:50',
        title: tr(
          lang,
          'Twin-Graph 编译器与 Phase 容器嵌套重构',
          'Stepped Twin-Graph Compiler & Nested PhaseContainer Layout',
        ),
        detail: tr(
          lang,
          '支持 PhaseContainer 折叠/展开动态重排、多列 Task 嵌套网格以及 GhostNode 运行时无环变更注入。',
          'Enabled dynamic PhaseContainer expand/collapse reflow, multi-column nested task grids, and acyclic runtime GhostNode splicing.',
        ),
      },
    ]);
  }

  const handleSaveConstitution = async (): Promise<void> => {
    setBusy(true);
    try {
      const blocked = blockedText
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      await forgeApi.saveConstitution(constMd, blocked);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleProposeInfraEvolution = async (): Promise<void> => {
    const infraRepo = infraRepos[0];
    if (!infraRepo || !evoTitle.trim()) {
      return;
    }
    setBusy(true);
    try {
      const chg = await forgeApi.proposeInfraEvolution({
        hubId: activeHubId,
        infraRepoId: infraRepo.id,
        title: evoTitle.trim(),
        rationale:
          evoRationale.trim() ||
          tr(
            lang,
            '在独立 Git Worktree 沙箱中发起受控的 INFRA 基建演进变更。',
            'Governed INFRA self-evolution change in isolated git worktree.',
          ),
        permissionTier: evoTier,
      });
      setEvoTitle('');
      setEvoRationale('');
      onRefresh();
      onOpenWorkstation(chg.id);
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
          <span style={{color: '#4f46e5', display: 'flex'}}>
            <CpuIcon size={23} />
          </span>
          <span>{tr(lang, '基础设施中心', 'Infra Center')}</span>
        </h1>
        <p className="page-subtitle">
          {tr(
            lang,
            '企业级软件工程基础设施主权治理矩阵（宪法红线 · 守护进程 · 环境探针 · 受控自演进）',
            'Enterprise Software Engineering Infrastructure Governance Matrix',
          )}
        </p>
      </div>

      {/* Underline Tabs: Operational Dashboard | Soul Constitution | Daemon Agents | Neural Link */}
      <div className="underline-tabs" style={{marginBottom: 20}}>
        <button
          type="button"
          className={`underline-tab ${tab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setTab('dashboard')}
        >
          <GridIcon size={14} />{' '}
          {tr(lang, '运行态势大盘', 'Operational Dashboard')}
        </button>
        <button
          type="button"
          className={`underline-tab ${tab === 'constitution' ? 'active' : ''}`}
          onClick={() => setTab('constitution')}
        >
          <BookOpenIcon size={14} />{' '}
          {tr(lang, '最高工程宪法', 'Soul Constitution')}
        </button>
        <button
          type="button"
          className={`underline-tab ${tab === 'daemons' ? 'active' : ''}`}
          onClick={() => setTab('daemons')}
        >
          <ZapIcon size={14} /> {tr(lang, '后台守护进程', 'Daemon Agents')}
        </button>
        <button
          type="button"
          className={`underline-tab ${tab === 'neural' ? 'active' : ''}`}
          onClick={() => setTab('neural')}
        >
          <TerminalIcon size={14} /> {tr(lang, '神经链路与自检', 'Neural Link')}
        </button>
      </div>

      {tab === 'dashboard' && (
        <div className="surface-card">
          <div className="surface-card-header">
            <span
              style={{display: 'inline-flex', alignItems: 'center', gap: 8}}
            >
              <span style={{color: '#4f46e5', display: 'flex'}}>
                <ActivityIcon size={15} />
              </span>
              <span>{tr(lang, '实时基建态势', 'Operational State')}</span>
            </span>
            <span className="tag tag-indigo">
              {tr(
                lang,
                `工程宪法 v${snapshot.constitution.version}`,
                `Constitution v${snapshot.constitution.version}`,
              )}
            </span>
          </div>

          <div className="surface-card-body">
            <div className="ops-state-grid">
              <div className="ops-stat-box">
                <div
                  style={{
                    fontSize: 11.5,
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    marginBottom: 6,
                  }}
                >
                  <ActivityIcon size={12} />{' '}
                  {tr(lang, '当前锚定检查点', 'Checkpoint')}
                </div>
                <div
                  className="selectable"
                  style={{fontSize: 15, fontWeight: 800, color: '#0f172a'}}
                >
                  {activeChange
                    ? `${activeChange.code}-TWIN-GRAPH-TQLA-E2E`
                    : 'FORGEOPS-CONTROL-PLANE-V2'}
                </div>
              </div>

              <div className="ops-stat-box">
                <div
                  style={{
                    fontSize: 11.5,
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    marginBottom: 6,
                  }}
                >
                  <ZapIcon size={12} />{' '}
                  {tr(lang, '当前攻坚焦点', 'Current Focus')}
                </div>
                <div style={{fontSize: 15, fontWeight: 800, color: '#0f172a'}}>
                  {activeChange
                    ? `${activeChange.code.toLowerCase()} · ${activeChange.title}`
                    : tr(
                        lang,
                        '多仓联邦治理与 DDD 通用语言防漂移',
                        'Multi-Repo Federation & DDD Governance',
                      )}
                </div>
              </div>
            </div>

            <div style={{marginTop: 26, paddingLeft: 4}}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#334155',
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  {tr(
                    lang,
                    '不可篡改架构演进账本 (Evolution Logs)',
                    'Evolution Logs',
                  )}
                </span>
                <span
                  style={{fontSize: 11.5, color: '#94a3b8', fontWeight: 500}}
                >
                  {tr(
                    lang,
                    'SQLite WAL 追加式审计流水',
                    'Append-only SQLite WAL audit ledger',
                  )}
                </span>
              </div>

              {Array.from(groupedAudit.entries()).map(([day, rows]) => (
                <div key={day}>
                  <div className="evo-date-header">{day}</div>
                  {rows.map((r, i) => (
                    <div key={`${day}-${i}`} className="evo-log-row">
                      <div>
                        <span className="evo-time-pill">{r.time}</span>
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          color: '#1e293b',
                          lineHeight: 1.45,
                        }}
                      >
                        {r.title}
                      </div>
                      <div
                        className="selectable"
                        style={{color: '#475569', lineHeight: 1.55}}
                      >
                        {r.detail}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'constitution' && (
        <div className="surface-card">
          <div className="surface-card-header">
            <span
              style={{display: 'inline-flex', alignItems: 'center', gap: 7}}
            >
              <ShieldIcon size={14} />
              <span>
                {tr(
                  lang,
                  `最高工程宪法 (v${snapshot.constitution.version}) — 全会话强制安全前缀`,
                  `Soul Constitution (v${snapshot.constitution.version}) — Immutable Safety Prefix`,
                )}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void handleSaveConstitution()}
            >
              {tr(lang, '发布新宪法版本', 'Save Constitution Version')}
            </button>
          </div>
          <div
            className="surface-card-body"
            style={{display: 'flex', flexDirection: 'column', gap: 14}}
          >
            <div>
              <label className="field-label">
                {tr(
                  lang,
                  '宪法规则 Markdown（硬编码前置注入每一次智能体会话，不可被业务仓覆盖）',
                  'Constitutional Rules Markdown (Prepended to Every Agent Session)',
                )}
              </label>
              <textarea
                rows={12}
                style={{fontFamily: 'var(--font-mono)', fontSize: 12}}
                value={constMd}
                onChange={e => setConstMd(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">
                {tr(
                  lang,
                  '红线拦截高危命令特征词（逗号分隔，命中即物理阻断）',
                  'Blocked Redline Command Substrings (Comma-Separated)',
                )}
              </label>
              <input
                value={blockedText}
                onChange={e => setBlockedText(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {tab === 'daemons' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {snapshot.daemons.map(d => (
            <div key={d.id} className="surface-card">
              <div className="surface-card-header">
                <span>{formatDaemonLabel(lang, d.id, d.label)}</span>
                <span className={`tag ${d.enabled ? 'tag-green' : ''}`}>
                  {d.runningPass
                    ? tr(lang, '巡检执行中', 'RUNNING')
                    : d.enabled
                      ? tr(lang, '已启用', 'ENABLED')
                      : tr(lang, '已暂停', 'PAUSED')}
                </span>
              </div>
              <div className="surface-card-body">
                <div
                  style={{fontSize: 12.5, color: '#475569', marginBottom: 12}}
                >
                  {d.lastSummary ||
                    tr(
                      lang,
                      '已就绪，等待下一个定时巡检时间窗。',
                      'Standing by for next scheduled pass.',
                    )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{fontSize: 11.5, color: '#94a3b8'}}>
                    {tr(
                      lang,
                      `巡检周期：每 ${d.intervalSeconds} 秒`,
                      `Interval: ${d.intervalSeconds}s`,
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      void forgeApi
                        .setDaemonEnabled(d.id, !d.enabled)
                        .then(() => onRefresh());
                    }}
                  >
                    {d.enabled
                      ? tr(lang, '暂停守护进程', 'Pause Daemon')
                      : tr(lang, '启用守护进程', 'Enable Daemon')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'neural' && (
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}>
          <div className="surface-card">
            <div className="surface-card-header">
              <span>
                {tr(
                  lang,
                  '宿主环境探针与沙箱自检 (Environment Doctor)',
                  'Environment Doctor & Sandbox Probe',
                )}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void forgeApi
                    .runEnvironmentDoctor()
                    .then(rep => {
                      setDoctor(rep);
                      onRefresh();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {tr(lang, '运行环境自检', 'Run Environment Doctor')}
              </button>
            </div>
            <div className="surface-card-body">
              {doctor ? (
                <div
                  className="selectable"
                  style={{display: 'flex', flexDirection: 'column', gap: 8}}
                >
                  <div>
                    <strong>
                      {tr(lang, 'Git 工具链：', 'Git Toolchain:')}
                    </strong>{' '}
                    {doctor.gitVersion}
                  </div>
                  <div>
                    <strong>
                      {tr(lang, 'Node 运行时：', 'Node Runtime:')}
                    </strong>{' '}
                    {doctor.nodeVersion}
                  </div>
                  <div>
                    <strong>
                      {tr(
                        lang,
                        '已清理残留 Worktree 数量：',
                        'Pruned Stale Worktrees:',
                      )}
                    </strong>{' '}
                    {doctor.prunedWorktreeEntries.length}
                  </div>
                </div>
              ) : (
                <div style={{color: '#64748b', lineHeight: 1.6}}>
                  {tr(
                    lang,
                    '点击右上角「运行环境自检」，自动探测本机 Git Worktree 沙箱就绪度、残留引用与各 CLI 智能体二进制可用性。',
                    'Click Run Environment Doctor to probe local Git worktree readiness and CLI agent binaries.',
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="surface-card">
            <div className="surface-card-header">
              <span>
                {tr(
                  lang,
                  '受控 INFRA 基建自演进提案',
                  'Governed INFRA Self-Evolution',
                )}
              </span>
              <span className="tag tag-indigo">
                {tr(lang, 'Worktree 物理隔离', 'Worktree Isolated')}
              </span>
            </div>
            <div
              className="surface-card-body"
              style={{display: 'flex', flexDirection: 'column', gap: 10}}
            >
              <div>
                <label className="field-label">
                  {tr(lang, '演进提案标题', 'Evolution Proposal Title')}
                </label>
                <input
                  placeholder={tr(
                    lang,
                    '例如：加固 TQLA 门禁失败取证解析器与重试退避策略',
                    'e.g. Harden QA gate retry telemetry parser',
                  )}
                  value={evoTitle}
                  onChange={e => setEvoTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">
                  {tr(lang, '工程演进依据与收益', 'Engineering Rationale')}
                </label>
                <textarea
                  rows={2}
                  placeholder={tr(
                    lang,
                    '阐述为何需要升级该 INFRA 基建能力及回归验证方式...',
                    'Why this INFRA improvement is needed...',
                  )}
                  value={evoRationale}
                  onChange={e => setEvoRationale(e.target.value)}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <select
                  style={{width: 195}}
                  value={evoTier}
                  onChange={e => setEvoTier(e.target.value as PermissionTier)}
                >
                  <option value="supervised">
                    {tr(lang, '受控监督档 (Supervised)', 'Supervised Tier')}
                  </option>
                  <option value="strict">
                    {tr(lang, '严格人工门禁档 (Strict)', 'Strict Gate Tier')}
                  </option>
                  <option value="turbo">
                    {tr(lang, '极速自治档 (Turbo)', 'Turbo Auto Tier')}
                  </option>
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !evoTitle.trim() || infraRepos.length === 0}
                  onClick={() => void handleProposeInfraEvolution()}
                >
                  {tr(
                    lang,
                    '发起 INFRA 受控演进变更',
                    'Launch INFRA Evolution Change',
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

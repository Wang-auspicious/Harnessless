import {useEffect, useMemo, useState, type ReactElement} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {PermissionTier} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CpuIcon,
  FileTextIcon,
  GitBranchIcon,
  PlayIcon,
  SettingsIcon,
  SlidersIcon,
  UsersIcon,
  ZapIcon,
} from '../components/Icons.tsx';
import {formatStatusLabel, tr, type UiLang} from '../i18n.ts';

type DashTab = 'team' | 'docs' | 'actions';

export function ChangeDashboardView(props: {
  readonly lang: UiLang;
  readonly snapshot: BootstrapSnapshot;
  readonly changeId: string;
  readonly onBack: () => void;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onRefresh: () => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {
    lang,
    snapshot,
    changeId,
    onBack,
    onOpenWorkstation,
    onRefresh,
    onError,
  } = props;

  const change =
    snapshot.changes.find(c => c.id === changeId) ??
    snapshot.changes[0] ??
    null;
  const repo = snapshot.repositories.find(r => r.id === change?.repoId) ?? null;

  const [tab, setTab] = useState<DashTab>('team');
  const [editingRole, setEditingRole] = useState<'dev' | 'jqa' | 'sqa' | null>(
    null,
  );
  const [workerAdapterId, setWorkerAdapterId] = useState(
    change?.team.workerAdapterId ?? 'native-api',
  );
  const [workerModel, setWorkerModel] = useState(
    change?.team.workerModel ?? 'deepseek-chat',
  );
  const [jqaModel, setJqaModel] = useState(
    change?.team.juniorAuditModel ?? 'deepseek-chat',
  );
  const [sqaModel, setSqaModel] = useState(
    change?.team.seniorAuditModel ?? 'deepseek-reasoner',
  );
  const [maxLoops, setMaxLoops] = useState(
    String(change?.team.maxRetryLoops ?? 3),
  );
  const [sqaLoops, setSqaLoops] = useState('3');
  const [permissionTier, setPermissionTier] = useState<PermissionTier>(
    change?.permissionTier ?? 'turbo',
  );
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [driftDraft, setDriftDraft] = useState('');

  useEffect(() => {
    if (!change) return;
    setWorkerAdapterId(change.team.workerAdapterId);
    setWorkerModel(change.team.workerModel);
    setJqaModel(change.team.juniorAuditModel);
    setSqaModel(change.team.seniorAuditModel);
    setMaxLoops(String(change.team.maxRetryLoops));
    setPermissionTier(change.permissionTier);
  }, [change]);

  const boundTerms = useMemo(() => {
    if (!change) return [];
    return snapshot.domainTerms.filter(
      t =>
        t.hubId === change.hubId &&
        (!repo ||
          t.boundedContext === repo.boundedContext ||
          t.owningRepoIds.includes(repo.id)),
    );
  }, [snapshot.domainTerms, change, repo]);

  const driftViolations = useMemo(() => {
    const sample = driftDraft.trim();
    if (!sample) return [];
    const hits: Array<{
      readonly alias: string;
      readonly canonical: string;
      readonly localLabel: string;
    }> = [];
    const lower = sample.toLowerCase();
    for (const term of boundTerms) {
      for (const alias of term.forbiddenAliases) {
        if (alias && lower.includes(alias.toLowerCase())) {
          hits.push({
            alias,
            canonical: term.canonicalTerm,
            localLabel: term.localLabel,
          });
        }
      }
    }
    return hits;
  }, [driftDraft, boundTerms]);

  if (!change) {
    return (
      <div className="page-scroll">
        <button type="button" className="btn" onClick={onBack}>
          <ArrowLeftIcon size={14} />{' '}
          {tr(lang, '返回注册表', 'Back to Registry')}
        </button>
        <p style={{marginTop: 16, color: '#64748b'}}>
          {tr(lang, '未找到对应变更单。', 'Change not found.')}
        </p>
      </div>
    );
  }

  const slugWords = change.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  const slug = `${change.code.toLowerCase()}-${slugWords.join('-')}`;

  const handleSaveTeam = async (): Promise<void> => {
    setSaving(true);
    setSavedNotice(false);
    try {
      await forgeApi.updateChangeTeam(change.id, {
        permissionTier,
        team: {
          workerAdapterId,
          workerModel,
          juniorAuditModel: jqaModel,
          seniorAuditModel: sqaModel,
          maxRetryLoops: Math.max(1, Number(maxLoops) || 3),
        },
      });
      setEditingRole(null);
      setSavedNotice(true);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (): Promise<void> => {
    try {
      await forgeApi.archiveChange(change.id);
      onRefresh();
      onBack();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const devAdapterLabel =
    snapshot.adapters.find(a => a.manifest.id === workerAdapterId)?.manifest
      .label ?? workerAdapterId;

  return (
    <div className="page-scroll">
      {/* Top Change Header Row */}
      <div className="change-dash-header">
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <button type="button" className="btn btn-sm" onClick={onBack}>
            <ArrowLeftIcon size={13} /> {tr(lang, '返回', 'Back')}
          </button>
          <div className="change-dash-title">
            <span style={{color: '#475569', display: 'flex'}}>
              <GitBranchIcon size={18} />
            </span>
            <span className="selectable">{slug}</span>
            <span className="tag tag-green">
              {change.status === 'certified'
                ? tr(lang, '已认证', 'CERTIFIED')
                : tr(lang, '在途活跃', 'ACTIVE')}
            </span>
            <span className="tag tag-green">
              ◎ {tr(lang, '已同步', 'Synced')}
            </span>
          </div>
        </div>

        <div style={{display: 'flex', gap: 8}}>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => onOpenWorkstation(change.id)}
          >
            {tr(lang, '实时工作台 →', 'Live View →')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void handleArchive()}
          >
            <ArchiveIcon size={13} /> {tr(lang, '归档此变更', 'Archive')}
          </button>
        </div>
      </div>

      {/* Sub-tabs: Team | Docs | Actions */}
      <div className="underline-tabs" style={{marginBottom: 20}}>
        <button
          type="button"
          className={`underline-tab ${tab === 'team' ? 'active' : ''}`}
          onClick={() => setTab('team')}
        >
          <UsersIcon size={14} /> {tr(lang, '智能体编组', 'Team')}
        </button>
        <button
          type="button"
          className={`underline-tab ${tab === 'docs' ? 'active' : ''}`}
          onClick={() => setTab('docs')}
        >
          <FileTextIcon size={14} />{' '}
          {tr(lang, 'SDD 规格与 DDD 门禁', 'Docs & SDD')}
        </button>
        <button
          type="button"
          className={`underline-tab ${tab === 'actions' ? 'active' : ''}`}
          onClick={() => setTab('actions')}
        >
          <ZapIcon size={14} /> {tr(lang, '受控动作', 'Actions')}
        </button>
      </div>

      {tab === 'team' && (
        <div className="change-dash-grid">
          {/* Left Card: Change Team Configuration */}
          <div className="surface-card">
            <div className="surface-card-header">
              <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <UsersIcon size={16} />{' '}
                {tr(lang, '变更智能体团队编组', 'Change Team Configuration')}
              </span>
              <span className="tag tag-indigo">
                {repo?.tier === 'infra' ? 'T5 / P5' : 'T3 / P5'}
              </span>
            </div>
            <div className="surface-card-body">
              <div className="team-selects-strip">
                <div>
                  <label className="field-label">
                    {tr(lang, '编组规模 (T)', 'TEAM (T)')}
                  </label>
                  <select
                    value={repo?.tier === 'infra' ? 'T5' : 'T3'}
                    onChange={() => undefined}
                  >
                    <option value="T5">
                      {tr(
                        lang,
                        'T5: 基建核心组 (DEV + JQA + SQA)',
                        'T5: Infra Core (DEV + Junior + Senior)',
                      )}
                    </option>
                    <option value="T3">
                      {tr(lang, 'T3: 标准交付组', 'T3: Service Delivery')}
                    </option>
                  </select>
                </div>
                <div>
                  <label className="field-label">
                    {tr(lang, '流程策略 (P)', 'PROCESS (P)')}
                  </label>
                  <select
                    value={permissionTier}
                    onChange={e =>
                      setPermissionTier(e.target.value as PermissionTier)
                    }
                  >
                    <option value="turbo">
                      {tr(lang, 'P5: 双级 TQLA 全自动', 'P5: Dual TQLA Auto')}
                    </option>
                    <option value="supervised">
                      {tr(lang, 'P2: 关键节点人工签批', 'P2: Supervised')}
                    </option>
                    <option value="strict">
                      {tr(lang, 'P1: 严格人工门禁', 'P1: Strict Gate')}
                    </option>
                  </select>
                </div>
                <div>
                  <label className="field-label">
                    {tr(lang, '复杂度等级', 'LEVEL')}
                  </label>
                  <select defaultValue="L3">
                    <option value="L3">
                      {tr(lang, 'L3: 复合领域组件', 'L3: Composite Component')}
                    </option>
                    <option value="L4">
                      {tr(lang, 'L4: 跨服务分布式契约', 'L4: Cross-Service')}
                    </option>
                  </select>
                </div>
                <div>
                  <label className="field-label">
                    {tr(lang, '领域分类', 'CATEGORY')}
                  </label>
                  <select defaultValue={repo?.tier === 'infra' ? 'C6' : 'C2'}>
                    <option value="C6">C6: INFRA (IA)</option>
                    <option value="C2">
                      {tr(lang, 'C2: 业务核心域', 'C2: Business Domain')}
                    </option>
                  </select>
                </div>
              </div>

              {/* Role Row 1: DEV */}
              <div className="role-slot-card">
                <div className="role-slot-icon">
                  <CpuIcon size={17} />
                  <span>DEV</span>
                </div>
                <div style={{flex: 1}}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{fontWeight: 700, color: '#0f172a'}}>
                      {devAdapterLabel}
                    </span>
                    <span className="tag tag-green">Clone</span>
                    <span className="tag tag-blue">{workerModel}</span>
                  </div>
                  <button
                    type="button"
                    className="topbar-util-btn"
                    style={{padding: '3px 0', marginTop: 3, fontSize: 12}}
                    onClick={() =>
                      setEditingRole(editingRole === 'dev' ? null : 'dev')
                    }
                  >
                    <SlidersIcon size={12} />{' '}
                    {tr(lang, '调整执行器与模型', 'Modify')}
                  </button>
                  {editingRole === 'dev' && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 10,
                        marginTop: 8,
                      }}
                    >
                      <select
                        value={workerAdapterId}
                        onChange={e => setWorkerAdapterId(e.target.value)}
                      >
                        {snapshot.adapters.map(a => (
                          <option key={a.manifest.id} value={a.manifest.id}>
                            {a.manifest.label}
                          </option>
                        ))}
                      </select>
                      <input
                        value={workerModel}
                        onChange={e => setWorkerModel(e.target.value)}
                        placeholder="e.g. deepseek-chat"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Role Row 2: Junior-QA */}
              <div className="role-slot-card">
                <div className="role-slot-icon" style={{color: '#475569'}}>
                  <ZapIcon size={17} />
                  <span>Junior-QA</span>
                </div>
                <div style={{flex: 1}}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="tag tag-green">Clone</span>
                    <span className="tag tag-blue">{jqaModel}</span>
                    <span style={{fontSize: 11.5, color: '#64748b'}}>
                      {tr(lang, '只读一致性初审', 'Read-only Consistency')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="topbar-util-btn"
                    style={{padding: '3px 0', marginTop: 3, fontSize: 12}}
                    onClick={() =>
                      setEditingRole(editingRole === 'jqa' ? null : 'jqa')
                    }
                  >
                    <SlidersIcon size={12} />{' '}
                    {tr(lang, '调整初审模型', 'Modify')}
                  </button>
                  {editingRole === 'jqa' && (
                    <div style={{marginTop: 8}}>
                      <input
                        value={jqaModel}
                        onChange={e => setJqaModel(e.target.value)}
                        placeholder="Junior QA Audit Model"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Role Row 3: Senior-QA */}
              <div className="role-slot-card" style={{marginBottom: 0}}>
                <div className="role-slot-icon" style={{color: '#475569'}}>
                  <ZapIcon size={17} />
                  <span>Senior-QA</span>
                </div>
                <div style={{flex: 1}}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="tag tag-green">Clone</span>
                    <span className="tag tag-blue">{sqaModel}</span>
                    <span style={{fontSize: 11.5, color: '#64748b'}}>
                      {tr(
                        lang,
                        '只读架构与 DDD 终审',
                        'Read-only Architecture & DDD',
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="topbar-util-btn"
                    style={{padding: '3px 0', marginTop: 3, fontSize: 12}}
                    onClick={() =>
                      setEditingRole(editingRole === 'sqa' ? null : 'sqa')
                    }
                  >
                    <SlidersIcon size={12} />{' '}
                    {tr(lang, '调整终审模型', 'Modify')}
                  </button>
                  {editingRole === 'sqa' && (
                    <div style={{marginTop: 8}}>
                      <input
                        value={sqaModel}
                        onChange={e => setSqaModel(e.target.value)}
                        placeholder="Senior QA Audit Model"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Card: TQLA Configuration */}
          <div className="tqla-card">
            <div className="surface-card-header" style={{borderTop: 'none'}}>
              <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <SettingsIcon size={15} />{' '}
                {tr(lang, 'TQLA 双级门禁配置', 'TQLA Configuration')}
              </span>
            </div>
            <div className="surface-card-body">
              <div className="tqla-banner">
                <CheckCircleIcon size={15} />
                <span>
                  {tr(
                    lang,
                    'P5 模式: 双级独立质量门禁已启用',
                    'P5 Mode: Dual-Level Independent QA Gates Enabled',
                  )}
                </span>
              </div>

              <div className="tqla-level-box">
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#334155',
                    letterSpacing: '0.03em',
                    marginBottom: 10,
                  }}
                >
                  {tr(
                    lang,
                    'LEVEL 1: 一级一致性初审 (JUNIOR QA)',
                    'LEVEL 1: JUNIOR QA (CONSISTENCY)',
                  )}
                </div>
                <div style={{marginBottom: 10}}>
                  <label className="field-label">
                    {tr(lang, '初审评估模型', 'Audit Model')}
                  </label>
                  <input
                    value={jqaModel}
                    onChange={e => setJqaModel(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">
                    {tr(lang, '最大回退重跑轮次', 'Max Loops (Retry Limit)')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={maxLoops}
                    onChange={e => setMaxLoops(e.target.value)}
                  />
                </div>
              </div>

              <div className="tqla-level-box">
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#334155',
                    letterSpacing: '0.03em',
                    marginBottom: 10,
                  }}
                >
                  {tr(
                    lang,
                    'LEVEL 2: 二级架构与 DDD 终审 (SENIOR QA)',
                    'LEVEL 2: SENIOR QA (ARCHITECTURE & DDD)',
                  )}
                </div>
                <div style={{marginBottom: 10}}>
                  <label className="field-label">
                    {tr(lang, '终审评估模型', 'Audit Model')}
                  </label>
                  <input
                    value={sqaModel}
                    onChange={e => setSqaModel(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">
                    {tr(lang, '终审最大重试上限', 'Max Loops (Final Audit)')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={sqaLoops}
                    onChange={e => setSqaLoops(e.target.value)}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 14,
                }}
              >
                <span style={{fontSize: 12, color: '#16a34a', fontWeight: 600}}>
                  {savedNotice ? tr(lang, '✓ 编组与门禁已保存', '✓ Saved') : ''}
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => void handleSaveTeam()}
                >
                  {tr(lang, '保存编组与 TQLA', 'Save TQLA & Team')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'docs' && (
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {/* SDD G1 -> G2 -> G3 Closure Ribbon */}
          <div className="sdd-stage-ribbon">
            <div className="sdd-stage-step done">
              <div className="field-label">G1 · SPEC FREEZE</div>
              <div style={{fontWeight: 700}}>
                {tr(lang, '需求压力测试已冻结', 'Requirement Grill Frozen')}
              </div>
            </div>
            <div className="sdd-stage-step done">
              <div className="field-label">DDD · UBIQUITOUS</div>
              <div style={{fontWeight: 700}}>
                {tr(
                  lang,
                  `已挂载 ${boundTerms.length} 条标准术语`,
                  `${boundTerms.length} Canonical Terms Grounded`,
                )}
              </div>
            </div>
            <div className="sdd-stage-step done">
              <div className="field-label">G2 · TWIN GRAPH</div>
              <div style={{fontWeight: 700}}>
                {tr(lang, 'WBS 与双生图已编译同步', 'WBS & DAG Synchronized')}
              </div>
            </div>
            <div
              className={`sdd-stage-step ${
                change.status === 'certified' ? 'done' : ''
              }`}
            >
              <div className="field-label">G3 · CERTIFICATION</div>
              <div style={{fontWeight: 700}}>
                {formatStatusLabel(lang, change.status)}
              </div>
            </div>
          </div>

          <div className="surface-card">
            <div className="surface-card-header">
              <span>
                {tr(
                  lang,
                  'SDD 规格书与物理隔离工作树契约',
                  'SDD Specification & Isolated Git Worktree Mandate',
                )}
              </span>
              <span className="tag tag-blue">{change.gitBranch}</span>
            </div>
            <div className="surface-card-body">
              <div style={{marginBottom: 14}}>
                <div className="field-label">
                  {tr(lang, '变更目标标题', 'Change Title')}
                </div>
                <div
                  className="selectable"
                  style={{fontSize: 15, fontWeight: 700}}
                >
                  {change.title}
                </div>
              </div>
              <div style={{marginBottom: 14}}>
                <div className="field-label">
                  {tr(lang, '规格摘要与边界', 'Specification Summary')}
                </div>
                <div
                  className="selectable"
                  style={{color: '#334155', lineHeight: 1.65}}
                >
                  {change.summary}
                </div>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 16,
                }}
              >
                <div>
                  <div className="field-label">
                    {tr(
                      lang,
                      '隔离 Git Worktree 路径',
                      'Isolated Worktree Path',
                    )}
                  </div>
                  <div
                    className="selectable"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      color: '#475569',
                      wordBreak: 'break-all',
                    }}
                  >
                    {change.worktreePath}
                  </div>
                </div>
                <div>
                  <div className="field-label">
                    {tr(lang, '确定性硬门禁命令', 'Verify Command')}
                  </div>
                  <div
                    className="selectable"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      color: '#475569',
                    }}
                  >
                    {repo?.verifyCommand || 'node --test'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SDD §3.2 Live DDD Terminology Drift Scanner */}
          <div className="surface-card">
            <div className="surface-card-header">
              <span>
                {tr(
                  lang,
                  'DDD 领域通用语言合规预检扫描器（禁用同义词黑名单拦截）',
                  'Live DDD Ubiquitous Language Drift Scanner',
                )}
              </span>
              {boundTerms[0]?.forbiddenAliases[0] && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    setDriftDraft(
                      `export interface ${boundTerms[0]?.forbiddenAliases[0]}Payload { amount: number; }`,
                    )
                  }
                >
                  {tr(lang, '填入违规同义词示例测试', 'Load Drift Sample')}
                </button>
              )}
            </div>
            <div className="surface-card-body">
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  flexWrap: 'wrap',
                  marginBottom: 12,
                }}
              >
                {boundTerms.map(t => (
                  <span key={t.id} className="tag tag-indigo">
                    {t.canonicalTerm} ({t.localLabel}) ·{' '}
                    {tr(lang, '禁用:', 'Forbids:')}{' '}
                    {t.forbiddenAliases.join(', ') || '-'}
                  </span>
                ))}
              </div>
              <textarea
                rows={3}
                placeholder={tr(
                  lang,
                  '在此粘贴待提交代码、接口定义或规格文本，实时检测是否混用了限界上下文禁用的同义词别名…',
                  'Paste code identifiers, API schemas, or spec prose to check against forbidden aliases...',
                )}
                value={driftDraft}
                onChange={e => setDriftDraft(e.target.value)}
              />
              {driftDraft.trim().length > 0 && (
                <div style={{marginTop: 10}}>
                  {driftViolations.length === 0 ? (
                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: 7,
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        color: '#166534',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <CheckCircleIcon size={14} />
                      <span>
                        {tr(
                          lang,
                          'DDD 通用语言校验通过：未发现任何禁用同义词漂移。',
                          'DDD Ubiquitous Language check passed: zero forbidden alias violations.',
                        )}
                      </span>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 7,
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#991b1b',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontWeight: 700,
                          marginBottom: 4,
                        }}
                      >
                        <AlertTriangleIcon size={14} />
                        <span>
                          {tr(
                            lang,
                            `门禁拦截预警：检测到 ${driftViolations.length} 处禁用同义词混用！`,
                            `Gate Violation: ${driftViolations.length} forbidden alias(es) detected!`,
                          )}
                        </span>
                      </div>
                      {driftViolations.map((v, i) => (
                        <div key={i} style={{fontSize: 12.5}}>
                          •{' '}
                          {tr(
                            lang,
                            `禁止使用「${v.alias}」，请统一替换为标准标识符「${v.canonical}」（${v.localLabel}）。`,
                            `Forbidden alias "${v.alias}" — replace with canonical "${v.canonical}" (${v.localLabel}).`,
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'actions' && (
        <div className="surface-card">
          <div className="surface-card-header">
            <span>
              {tr(
                lang,
                '受控执行与 Retro 复盘操作',
                'Governed Change Execution & Retro Actions',
              )}
            </span>
          </div>
          <div
            className="surface-card-body"
            style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void forgeApi.executeChange(change.id).then(() => {
                  onRefresh();
                  onOpenWorkstation(change.id);
                });
              }}
            >
              <PlayIcon size={13} />{' '}
              {tr(
                lang,
                '启动或续跑无人值守流水线',
                'Execute / Resume Autonomous Pipeline',
              )}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void forgeApi
                  .runRetroOptimization(change.id)
                  .then(() => onRefresh());
              }}
            >
              {tr(
                lang,
                '执行交付后 Retro 文档瘦身与技能提炼',
                'Run Post-Change Agent-Wiki Retro Pruning',
              )}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void handleArchive()}
            >
              <ArchiveIcon size={13} />{' '}
              {tr(
                lang,
                '归档当前变更单（保留父中枢与仓库）',
                'Archive Scoped Change',
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

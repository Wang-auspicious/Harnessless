import {useState, type ReactElement} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {
  PermissionTier,
  RepoTier,
  RepositoryEntry,
} from '../../../src/shared/types.ts';
import {forgeApi} from '../api/client.ts';
import {
  BriefcaseIcon,
  PlusIcon,
  ShieldIcon,
  ZapIcon,
} from '../components/Icons.tsx';
import {formatStatusLabel, tr, type UiLang} from '../i18n.ts';

export function RegistryView(props: {
  readonly lang: UiLang;
  readonly snapshot: BootstrapSnapshot;
  readonly activeHubId: string;
  readonly onOpenWorkstation: (changeId: string) => void;
  readonly onOpenChangeDashboard: (changeId: string) => void;
  readonly onOpenCreateChangeModal: (repoId?: string) => void;
  readonly onOpenDddStudio: () => void;
  readonly onRefresh: () => Promise<void> | void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {
    lang,
    snapshot,
    activeHubId,
    onOpenWorkstation,
    onOpenChangeDashboard,
    onOpenCreateChangeModal,
    onOpenDddStudio,
    onRefresh,
    onError,
  } = props;

  const hubRepos = snapshot.repositories.filter(r => r.hubId === activeHubId);
  const infraRepos = hubRepos.filter(r => r.tier === 'infra');
  const regularRepos = hubRepos.filter(r => r.tier !== 'infra');
  const hubChanges = snapshot.changes.filter(c => c.hubId === activeHubId);
  const hubTerms = snapshot.domainTerms.filter(t => t.hubId === activeHubId);

  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [repoTier, setRepoTier] = useState<RepoTier>('service');
  const [repoPath, setRepoPath] = useState('');
  const [boundedContext, setBoundedContext] = useState('');
  const [verifyCmd, setVerifyCmd] = useState('');
  const [contractSummary, setContractSummary] = useState('');
  const [permissionTier, setPermissionTier] = useState<PermissionTier>('turbo');
  const [busy, setBusy] = useState(false);

  const ensureChangeForRepo = async (
    repo: RepositoryEntry,
  ): Promise<string> => {
    const existing = hubChanges.find(c => c.repoId === repo.id);
    if (existing) {
      return existing.id;
    }
    const created = await forgeApi.createChange({
      hubId: activeHubId,
      repoId: repo.id,
      title: `Initialize ${repo.boundedContext} baseline workflow`,
      summary:
        repo.contractSummary ||
        `Establish specification and baseline QA gates for ${repo.name}.`,
      permissionTier,
    });
    await Promise.resolve(onRefresh());
    return created.id;
  };

  const handleConfigureTeam = async (repo: RepositoryEntry): Promise<void> => {
    try {
      const changeId = await ensureChangeForRepo(repo);
      onOpenChangeDashboard(changeId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLiveView = async (repo: RepositoryEntry): Promise<void> => {
    try {
      const changeId = await ensureChangeForRepo(repo);
      onOpenWorkstation(changeId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRegisterSubmit = async (): Promise<void> => {
    if (!repoName.trim() || !repoPath.trim() || !boundedContext.trim()) {
      return;
    }
    setBusy(true);
    try {
      await forgeApi.registerRepo({
        hubId: activeHubId,
        name: repoName.trim(),
        tier: repoTier,
        localPath: repoPath.trim(),
        verifyCommand: verifyCmd.trim(),
        boundedContext: boundedContext.trim(),
        contractSummary: contractSummary.trim(),
      });
      setRepoName('');
      setRepoPath('');
      setBoundedContext('');
      setVerifyCmd('');
      setContractSummary('');
      setShowRegisterModal(false);
      await Promise.resolve(onRefresh());
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 14,
        }}
      >
        <div>
          <h1 className="page-h1">
            {tr(lang, '项目与联邦仓库注册表', 'Project Registry')}
          </h1>
          <p className="page-subtitle">
            {tr(
              lang,
              '统一治理多仓联邦成员仓库、自治智能体编组与隔离工作树流水线。',
              'Manage and monitor your autonomous agent teams across federated repositories.',
            )}
          </p>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button
            type="button"
            className="btn"
            onClick={() => onOpenDddStudio()}
          >
            <ZapIcon size={14} />{' '}
            {tr(
              lang,
              `DDD 通用语言 (${hubTerms.length})`,
              `DDD Glossary (${hubTerms.length})`,
            )}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowRegisterModal(true)}
          >
            <PlusIcon size={14} /> {tr(lang, '注册新项目', 'Register Project')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onOpenCreateChangeModal(hubRepos[0]?.id)}
          >
            <PlusIcon size={14} />{' '}
            {tr(lang, '新建变更 / 跨仓 Epic', 'New Change / Epic')}
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 24,
          fontSize: 12.5,
          color: '#64748b',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <span>
            {tr(
              lang,
              `共纳管 ${hubRepos.length} 个代码仓库`,
              `Showing ${hubRepos.length} of ${hubRepos.length} projects`,
            )}
          </span>
          <span className="tag tag-indigo">{infraRepos.length} INFRA</span>
          <span className="tag">
            {regularRepos.length} {tr(lang, '常规服务', 'Regular')}
          </span>
          <span style={{color: '#94a3b8'}}>
            (
            {tr(
              lang,
              `${hubChanges.length} 个受控变更 · ${hubTerms.length} 条限界上下文标准术语`,
              `${hubChanges.length} active change(s) · ${hubTerms.length} DDD terms`,
            )}
            )
          </span>
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <span style={{fontSize: 12}}>
            {tr(lang, '默认自治档位：', 'Default Autonomy:')}
          </span>
          <select
            style={{width: 158, height: 28, padding: '0 8px', fontSize: 12}}
            value={permissionTier}
            onChange={e => setPermissionTier(e.target.value as PermissionTier)}
          >
            <option value="turbo">Turbo (T5/P5)</option>
            <option value="supervised">Supervised (T3/P2)</option>
            <option value="strict">Strict (Manual)</option>
          </select>
        </div>
      </div>

      {/* Section 1: INFRA Projects (T5) */}
      <div className="registry-section-heading">
        <span className="registry-section-bar" />
        <ShieldIcon size={16} />
        <span>
          {tr(
            lang,
            `INFRA 平台基建项目 (T5) (${infraRepos.length})`,
            `INFRA Projects (T5) (${infraRepos.length})`,
          )}
        </span>
      </div>

      <div className="registry-cards-grid" style={{marginBottom: 28}}>
        {infraRepos.map(repo => (
          <div key={repo.id} className="project-card infra-card">
            <div className="project-card-body">
              <div className="project-icon-box infra">
                <ShieldIcon size={18} />
              </div>
              <div style={{minWidth: 0, flex: 1}}>
                <div className="project-title-row">
                  <span>{repo.name}</span>
                  <span className="tag tag-indigo">T5</span>
                </div>
                <div className="project-tags-row">
                  <span className="tag">infra</span>
                  <span className="tag">C6</span>
                  <span className="tag">L5</span>
                  <span className="tag tag-indigo">{repo.boundedContext}</span>
                </div>
                <div className="project-path selectable">
                  {tr(lang, '路径', 'Path')}:{' '}
                  {repo.localPath.replace(/\\/g, '/')}
                </div>
              </div>
            </div>
            <div className="project-card-footer">
              <button
                type="button"
                className="project-footer-btn"
                onClick={() => void handleConfigureTeam(repo)}
              >
                {tr(lang, '配置团队与门禁', 'Configure Team')}
              </button>
              <button
                type="button"
                className="project-footer-btn"
                onClick={() => void handleLiveView(repo)}
              >
                {tr(lang, '实时工作台 →', 'Live View →')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Section 2: Regular Projects */}
      <div className="registry-section-heading regular">
        <span className="registry-section-bar regular" />
        <BriefcaseIcon size={16} />
        <span>
          {tr(
            lang,
            `常规业务服务项目 (${regularRepos.length})`,
            `Regular Projects (${regularRepos.length})`,
          )}
        </span>
      </div>

      <div className="registry-cards-grid">
        {regularRepos.map((repo, idx) => {
          const repoChg = hubChanges.find(c => c.repoId === repo.id);
          return (
            <div key={repo.id} className="project-card">
              <div className="project-card-body">
                <div className="project-icon-box">
                  <BriefcaseIcon size={18} />
                </div>
                <div style={{minWidth: 0, flex: 1}}>
                  <div className="project-title-row">
                    <span>{repo.name}</span>
                  </div>
                  <div className="project-tags-row">
                    <span className="tag tag-blue">{repo.boundedContext}</span>
                    <span className="tag">{idx === 0 ? 'L4' : 'L3'}</span>
                    {repoChg && (
                      <span
                        className={`tag ${
                          repoChg.status === 'certified'
                            ? 'tag-green'
                            : 'tag-amber'
                        }`}
                      >
                        {repoChg.code} ·{' '}
                        {formatStatusLabel(lang, repoChg.status)}
                      </span>
                    )}
                  </div>
                  <div className="project-path selectable">
                    {tr(lang, '路径', 'Path')}:{' '}
                    {repo.localPath.replace(/\\/g, '/')}
                  </div>
                </div>
              </div>
              <div className="project-card-footer">
                <button
                  type="button"
                  className="project-footer-btn"
                  onClick={() => void handleConfigureTeam(repo)}
                >
                  {tr(lang, '配置团队与门禁', 'Configure Team')}
                </button>
                <button
                  type="button"
                  className="project-footer-btn"
                  onClick={() => void handleLiveView(repo)}
                >
                  {tr(lang, '实时工作台 →', 'Live View →')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Register Project Modal */}
      {showRegisterModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowRegisterModal(false)}
        >
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>
                {tr(
                  lang,
                  '注册纳管成员 Git 仓库',
                  'Register Repository in Federation Hub',
                )}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowRegisterModal(false)}
              >
                ✕
              </button>
            </div>
            <div
              className="modal-body"
              style={{display: 'flex', flexDirection: 'column', gap: 12}}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 150px',
                  gap: 12,
                }}
              >
                <div>
                  <label className="field-label">
                    {tr(lang, '项目名称', 'Project Name')}
                  </label>
                  <input
                    placeholder="e.g. billing-reconciler-svc"
                    value={repoName}
                    onChange={e => setRepoName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">
                    {tr(lang, '仓库层级', 'Project Tier')}
                  </label>
                  <select
                    value={repoTier}
                    onChange={e => setRepoTier(e.target.value as RepoTier)}
                  >
                    <option value="service">
                      {tr(lang, '常规服务 (Regular)', 'Regular (Service)')}
                    </option>
                    <option value="infra">INFRA (T5)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label">
                  {tr(lang, '本地 Git 仓库路径', 'Local Git Directory Path')}
                </label>
                <div style={{display: 'flex', gap: 8}}>
                  <input
                    placeholder="D:/Projects/my-service"
                    value={repoPath}
                    onChange={e => setRepoPath(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    style={{flexShrink: 0}}
                    onClick={() => {
                      void forgeApi.pickDirectory().then(picked => {
                        if (picked) setRepoPath(picked);
                      });
                    }}
                  >
                    {tr(lang, '浏览…', 'Browse')}
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}
              >
                <div>
                  <label className="field-label">
                    {tr(lang, 'DDD 限界上下文', 'DDD Bounded Context')}
                  </label>
                  <input
                    placeholder="e.g. Settlement"
                    value={boundedContext}
                    onChange={e => setBoundedContext(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">
                    {tr(lang, '确定性硬门禁命令', 'Verify Gate Command')}
                  </label>
                  <input
                    placeholder="npm test"
                    value={verifyCmd}
                    onChange={e => setVerifyCmd(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="field-label">
                  {tr(
                    lang,
                    '面向智能体的精炼契约摘要 (Agent-Wiki)',
                    'Agent-Wiki Contract Summary',
                  )}
                </label>
                <textarea
                  rows={2}
                  placeholder={tr(
                    lang,
                    '概述核心对外 RPC/HTTP 接口与领域不变量…',
                    'Public RPC/REST boundaries & domain invariants...',
                  )}
                  value={contractSummary}
                  onChange={e => setContractSummary(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setShowRegisterModal(false)}
              >
                {tr(lang, '取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy ||
                  !repoName.trim() ||
                  !repoPath.trim() ||
                  !boundedContext.trim()
                }
                onClick={() => void handleRegisterSubmit()}
              >
                {tr(lang, '确认注册', 'Register Project')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

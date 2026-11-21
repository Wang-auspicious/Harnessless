import {useCallback, useEffect, useState, type ReactElement} from 'react';
import type {BootstrapSnapshot} from '../../../src/shared/api.ts';
import type {FederationHub, RepoTier} from '../../../src/shared/types.ts';
import {
  forgeApi,
  type DoctorReportDto,
  type OutboxEffectDto,
} from '../api/client.ts';
import type {UiLang} from '../i18n.ts';

function label(lang: UiLang, zh: string, en: string): string {
  return lang === 'ZH' ? zh : en;
}

export function FactorySettingsView(props: {
  readonly lang: UiLang;
  readonly snapshot: BootstrapSnapshot;
  readonly activeHub: FederationHub | null;
  readonly onRefresh: () => Promise<void> | void;
  readonly onOpenLegacy: () => void;
  readonly onError: (msg: string) => void;
}): ReactElement {
  const {lang, snapshot, activeHub, onRefresh, onOpenLegacy, onError} = props;

  const [tab, setTab] = useState<'workspace' | 'providers' | 'infra'>(
    'workspace',
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Repo registration state
  const [repoName, setRepoName] = useState('');
  const [repoTier, setRepoTier] = useState<RepoTier>('service');
  const [repoPath, setRepoPath] = useState('');
  const [repoVerifyCmd, setRepoVerifyCmd] = useState('npm test');
  const [repoContext, setRepoContext] = useState('core-domain');

  // DDD term state
  const [canonicalTerm, setCanonicalTerm] = useState('');
  const [forbiddenAliases, setForbiddenAliases] = useState('');
  const [termDef, setTermDef] = useState('');

  // Provider secret editor state
  const [apiKeys, setApiKeys] = useState<Readonly<Record<string, string>>>({});
  const [baseUrls, setBaseUrls] = useState<Readonly<Record<string, string>>>(
    {},
  );

  // Infra doctor & outbox
  const [doctor, setDoctor] = useState<DoctorReportDto | null>(null);
  const [outbox, setOutbox] = useState<readonly OutboxEffectDto[]>([]);

  const loadOutbox = useCallback(async (): Promise<void> => {
    try {
      setOutbox(await forgeApi.listOutbox(60));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError]);

  useEffect(() => {
    if (tab === 'infra') {
      void loadOutbox();
    }
  }, [tab, loadOutbox]);

  const handleRegisterRepo = async (): Promise<void> => {
    if (!activeHub || !repoName.trim() || !repoPath.trim()) {
      return;
    }
    setBusy(true);
    try {
      await forgeApi.registerRepo({
        hubId: activeHub.id,
        name: repoName.trim(),
        tier: repoTier,
        localPath: repoPath.trim(),
        verifyCommand: repoVerifyCmd.trim() || 'npm test',
        boundedContext: repoContext.trim() || 'core',
        contractSummary: `${repoTier} repository`,
      });
      setRepoName('');
      setRepoPath('');
      setNotice(
        label(lang, '代码仓已纳管到当前工作区。', 'Repository registered.'),
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddTerm = async (): Promise<void> => {
    if (!activeHub || !canonicalTerm.trim()) {
      return;
    }
    setBusy(true);
    try {
      await forgeApi.upsertDomainTerm({
        hubId: activeHub.id,
        boundedContext: 'core-domain',
        owningRepoIds: snapshot.repositories
          .filter(r => r.hubId === activeHub.id)
          .slice(0, 1)
          .map(r => r.id),
        canonicalTerm: canonicalTerm.trim(),
        localLabel: canonicalTerm.trim(),
        definition: termDef.trim() || canonicalTerm.trim(),
        forbiddenAliases: forbiddenAliases
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        schemaAnchors: [],
      });
      setCanonicalTerm('');
      setForbiddenAliases('');
      setTermDef('');
      setNotice(label(lang, '已更新 DDD 统一语言词表。', 'Domain term saved.'));
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProvider = async (providerId: string): Promise<void> => {
    setBusy(true);
    try {
      await forgeApi.updateProviderSecret({
        providerId,
        baseUrl: baseUrls[providerId]?.trim() || undefined,
        apiKey: apiKeys[providerId]?.trim() || undefined,
      });
      setNotice(
        label(
          lang,
          `已加密保存 ${providerId} 凭据至系统密钥库。`,
          `Encrypted & saved credentials for ${providerId}.`,
        ),
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const hubRepos = activeHub
    ? snapshot.repositories.filter(r => r.hubId === activeHub.id)
    : [];
  const hubTerms = activeHub
    ? snapshot.domainTerms.filter(t => t.hubId === activeHub.id)
    : [];

  return (
    <div className="v3-canvas">
      <div
        className="v3-card"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{margin: 0, fontSize: 19, fontWeight: 750}}>
            {label(
              lang,
              '软件工厂环境与治理设置',
              'Factory Environment & Governance',
            )}
          </h1>
          <div style={{fontSize: 12.5, color: 'var(--v3-sub)', marginTop: 4}}>
            {label(
              lang,
              '低频工程基建配置收拢于此；日常需求交付请直接在「焦点任务」中操作。',
              'Low-frequency workspace, secret vault, and daemon settings live here cleanly.',
            )}
          </div>
        </div>
        <button type="button" className="v3-btn" onClick={onOpenLegacy}>
          {label(
            lang,
            '切换到传统 v2.2 专家视图 ↗',
            'Open Legacy v2.2 Views ↗',
          )}
        </button>
      </div>

      {notice && <div className="v3-banner-ok">{notice}</div>}

      <div className="v3-subtabs">
        {(
          [
            [
              'workspace',
              label(lang, '代码仓与 DDD 词表', 'Repos & DDD Glossary'),
            ],
            [
              'providers',
              label(lang, '模型与安全密钥库', 'Model Providers & Vault'),
            ],
            [
              'infra',
              label(
                lang,
                '环境体检、队列与守护线程',
                'Doctor, Outbox & Daemons',
              ),
            ],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            className={`v3-subtab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === 'workspace' && (
        <div className="v3-grid-2">
          <div
            className="v3-card"
            style={{display: 'flex', flexDirection: 'column', gap: 10}}
          >
            <div style={{fontWeight: 750, fontSize: 14.5}}>
              {label(
                lang,
                `纳管代码仓 (${hubRepos.length})`,
                `Repositories (${hubRepos.length})`,
              )}
            </div>
            {hubRepos.map(r => (
              <div key={r.id} className="v3-card-warm">
                <div style={{display: 'flex', justifyContent: 'space-between'}}>
                  <strong>{r.name}</strong>
                  <span className="v3-pill">{r.tier}</span>
                </div>
                <div
                  className="v3-mono"
                  style={{fontSize: 11.5, color: 'var(--v3-sub)', marginTop: 4}}
                >
                  {r.localPath} · cmd: {r.verifyCommand}
                </div>
              </div>
            ))}

            <div
              style={{
                borderTop: '1px solid var(--v3-border)',
                paddingTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <input
                className="v3-input"
                value={repoName}
                onChange={e => setRepoName(e.target.value)}
                placeholder={label(
                  lang,
                  '代码仓名称（如 payment-api）',
                  'Repo name',
                )}
              />
              <div style={{display: 'flex', gap: 6}}>
                <input
                  className="v3-input"
                  style={{flex: 1}}
                  value={repoPath}
                  onChange={e => setRepoPath(e.target.value)}
                  placeholder={label(
                    lang,
                    '本地 Git 根目录路径',
                    'Local repository path',
                  )}
                />
                <button
                  type="button"
                  className="v3-btn"
                  onClick={() => {
                    void (async () => {
                      const picked = await forgeApi.pickDirectory();
                      if (picked) {
                        setRepoPath(picked);
                      }
                    })();
                  }}
                >
                  {label(lang, '浏览…', 'Browse…')}
                </button>
              </div>
              <div style={{display: 'flex', gap: 6}}>
                <select
                  className="v3-select"
                  value={repoTier}
                  onChange={e => setRepoTier(e.target.value as RepoTier)}
                >
                  <option value="service">service</option>
                  <option value="frontend">frontend</option>
                  <option value="shared">shared</option>
                  <option value="infra">infra</option>
                </select>
                <input
                  className="v3-input"
                  style={{flex: 1}}
                  value={repoVerifyCmd}
                  onChange={e => setRepoVerifyCmd(e.target.value)}
                  placeholder="npm test"
                />
                <input
                  className="v3-input"
                  style={{width: 120}}
                  value={repoContext}
                  onChange={e => setRepoContext(e.target.value)}
                  placeholder="boundedContext"
                />
              </div>
              <button
                type="button"
                className="v3-btn v3-btn-primary"
                disabled={busy || !repoName.trim() || !repoPath.trim()}
                onClick={() => {
                  void handleRegisterRepo();
                }}
              >
                {label(lang, '绑定代码仓', 'Register Repo')}
              </button>
            </div>
          </div>

          <div
            className="v3-card"
            style={{display: 'flex', flexDirection: 'column', gap: 10}}
          >
            <div style={{fontWeight: 750, fontSize: 14.5}}>
              {label(
                lang,
                `DDD 统一语言词汇表与禁用同义词 (${hubTerms.length})`,
                `DDD Ubiquitous Language (${hubTerms.length})`,
              )}
            </div>
            {hubTerms.map(t => (
              <div key={t.id} className="v3-card-warm">
                <strong>{t.canonicalTerm}</strong>{' '}
                <span className="v3-pill">{t.boundedContext}</span>
                <div style={{fontSize: 12.5, marginTop: 4}}>{t.definition}</div>
                <div
                  style={{fontSize: 11.5, color: 'var(--v3-red)', marginTop: 2}}
                >
                  Avoid: {t.forbiddenAliases.join(', ') || 'none'}
                </div>
              </div>
            ))}
            <div
              style={{
                borderTop: '1px solid var(--v3-border)',
                paddingTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <input
                className="v3-input"
                value={canonicalTerm}
                onChange={e => setCanonicalTerm(e.target.value)}
                placeholder={label(
                  lang,
                  '规范术语（如 SettlementVoucher）',
                  'Canonical term',
                )}
              />
              <input
                className="v3-input"
                value={forbiddenAliases}
                onChange={e => setForbiddenAliases(e.target.value)}
                placeholder={label(
                  lang,
                  '禁用同义词（逗号分隔，如 receipt, slip）',
                  'Forbidden aliases (comma-separated)',
                )}
              />
              <input
                className="v3-input"
                value={termDef}
                onChange={e => setTermDef(e.target.value)}
                placeholder={label(lang, '领域约束定义', 'Domain definition')}
              />
              <button
                type="button"
                className="v3-btn v3-btn-primary"
                disabled={busy || !canonicalTerm.trim()}
                onClick={() => {
                  void handleAddTerm();
                }}
              >
                {label(lang, '添加规范术语', 'Save DDD Term')}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'providers' && (
        <div className="v3-grid-2">
          {snapshot.providers.map(p => (
            <div
              key={p.id}
              className="v3-card"
              style={{display: 'flex', flexDirection: 'column', gap: 8}}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <strong>{p.name}</strong>
                <span
                  className={`v3-pill ${p.hasApiKey ? 'v3-pill-green' : 'v3-pill-amber'}`}
                >
                  {p.hasApiKey ? 'Key Configured' : 'Not Configured'} ·{' '}
                  {p.protocol}
                </span>
              </div>
              <input
                className="v3-input v3-mono"
                value={baseUrls[p.id] ?? p.baseUrl}
                onChange={e =>
                  setBaseUrls(prev => ({...prev, [p.id]: e.target.value}))
                }
              />
              <div style={{display: 'flex', gap: 6}}>
                <input
                  className="v3-input v3-mono"
                  type="password"
                  style={{flex: 1}}
                  value={apiKeys[p.id] ?? ''}
                  onChange={e =>
                    setApiKeys(prev => ({...prev, [p.id]: e.target.value}))
                  }
                  placeholder={p.maskedKeyHint || 'sk-...'}
                />
                <button
                  type="button"
                  className="v3-btn v3-btn-primary"
                  disabled={busy}
                  onClick={() => {
                    void handleSaveProvider(p.id);
                  }}
                >
                  {label(lang, '保存密钥', 'Save')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'infra' && (
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="v3-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <strong>
                {label(
                  lang,
                  '运行环境与适配器自检 (Environment Doctor)',
                  'Environment Doctor',
                )}
              </strong>
              <button
                type="button"
                className="v3-btn v3-btn-primary"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      setDoctor(await forgeApi.runEnvironmentDoctor());
                    } catch (err) {
                      onError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {label(lang, '立即体检', 'Run Doctor')}
              </button>
            </div>
            {doctor && (
              <div className="v3-card-warm v3-mono" style={{fontSize: 12}}>
                gitReady={String(doctor.gitReady)} ({doctor.gitVersion}) · node=
                {doctor.nodeVersion} · adapters={doctor.adapters.length}
              </div>
            )}
          </div>

          <div className="v3-card">
            <div style={{fontWeight: 750, fontSize: 14, marginBottom: 8}}>
              {label(
                lang,
                `守护线程 (${snapshot.daemons.length})`,
                `Background Daemons (${snapshot.daemons.length})`,
              )}
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
              {snapshot.daemons.map(d => (
                <div
                  key={d.id}
                  className="v3-card-warm"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>{d.label}</strong>{' '}
                    <span className="v3-mono" style={{fontSize: 11.5}}>
                      ({d.id}) · {d.lastSummary || 'idle'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`v3-btn ${d.enabled ? 'v3-btn-primary' : ''}`}
                    onClick={() => {
                      void (async () => {
                        try {
                          await forgeApi.setDaemonEnabled(d.id, !d.enabled);
                          await onRefresh();
                        } catch (err) {
                          onError(
                            err instanceof Error ? err.message : String(err),
                          );
                        }
                      })();
                    }}
                  >
                    {d.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="v3-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <strong>
                {label(
                  lang,
                  `事务性 Outbox 队列 (${outbox.length})`,
                  `Transactional Outbox (${outbox.length})`,
                )}
              </strong>
              <button
                type="button"
                className="v3-btn"
                onClick={() => {
                  void loadOutbox();
                }}
              >
                {label(lang, '刷新', 'Refresh')}
              </button>
            </div>
            {outbox.length === 0 ? (
              <div style={{fontSize: 12.5, color: 'var(--v3-sub)'}}>
                Outbox queue is empty.
              </div>
            ) : (
              outbox.map(row => (
                <div
                  key={row.id}
                  className="v3-card-warm"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <div className="v3-mono" style={{fontSize: 12}}>
                    {row.kind} · status={row.status} · attempts={row.attempts}/
                    {row.maxAttempts}
                    {row.lastError ? ` · err=${row.lastError}` : ''}
                  </div>
                  {row.status === 'dead_letter' && (
                    <button
                      type="button"
                      className="v3-btn"
                      onClick={() => {
                        void (async () => {
                          try {
                            await forgeApi.retryOutboxEffect(row.id);
                            await loadOutbox();
                          } catch (err) {
                            onError(
                              err instanceof Error ? err.message : String(err),
                            );
                          }
                        })();
                      }}
                    >
                      Retry
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

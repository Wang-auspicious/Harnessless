import {useState, type ReactElement} from 'react';
import type {
  ControlSchemaResponse,
  FocusProjection,
} from '../../../src/shared/api.ts';
import type {
  FederationHub,
  RepositoryEntry,
} from '../../../src/shared/types.ts';
import type {
  ExecutionMode,
  IntentPresetId,
  MissionRecord,
} from '../../../src/shared/v3-types.ts';
import {forgeApi} from '../api/client.ts';
import type {UiLang} from '../i18n.ts';

interface DemoScenario {
  readonly id: string;
  readonly tagZh: string;
  readonly tagEn: string;
  readonly titleZh: string;
  readonly titleEn: string;
  readonly descZh: string;
  readonly descEn: string;
  readonly preset: IntentPresetId;
  readonly intent: string;
}

const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'multi-repo-std',
    tagZh: '推荐体验 · 多仓标准闭环',
    tagEn: 'Recommended · Multi-Repo Flow',
    titleZh: '跨仓支付结算流水凭证改造',
    titleEn: 'Cross-Repo Settlement Voucher Rollout',
    descZh:
      '一键启动覆盖 3 个关联仓的标准需求推演：体验从需求冻结、跨仓规划到双独立 QA 审计的焦点流程。',
    descEn:
      'Launch a 3-repo mission through HAMA spec convergence, Twin-Graph build, and dual QA certification.',
    preset: 'guided',
    intent:
      '为结算网关新增幂等凭证校验（SettlementVoucher）：在后端服务校验幂等键，在风控引擎增加阈值规则，并在控制台展示审计详情。',
  },
  {
    id: 'sim-clarify',
    tagZh: '体验 · 需求澄清博弈',
    tagEn: 'Demo · HAMA Clarification',
    titleZh: '[sim:clarify] 模糊需求主动反问人类',
    titleEn: '[sim:clarify] Ambiguity & Structured Clarify Gate',
    descZh:
      '演示 ForgeOps 遇到模糊意图时不瞎猜，而是收敛成一张清晰的焦点问卷等待人类拍板后继续推进。',
    descEn:
      'Demonstrates ForgeOps pausing on ambiguous requirements with a crisp 1-screen clarification packet.',
    preset: 'guided',
    intent:
      '[sim:clarify] 重构计费与风控回调重试策略，需确认失败兜底窗口与跨币种精度规则。',
  },
  {
    id: 'sim-conditional',
    tagZh: '体验 · 严格审计与条件放行',
    tagEn: 'Demo · Strict Audit & Conditions',
    titleZh: '[sim:conditional] 条件放行与高危约束',
    titleEn: '[sim:conditional] Strict Governance & Conditional Pass',
    descZh:
      '体验 strict_audit 模式下的全链路 HAMA 评审：禁止未经条件解除的裸 approve，必须在释放条件后冻结基线。',
    descEn:
      'Exercises full HAMA severity algebra: blocks raw approve on conditional_pass until conditions resolve.',
    preset: 'strict_audit',
    intent:
      '[sim:conditional] 升级核心清分账本合规策略，强制要求双盲审计确认并附带上线前置限制条件。',
  },
];

interface PresetUiMeta {
  readonly id: IntentPresetId;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly badgeZh: string;
  readonly badgeEn: string;
  readonly summaryZh: string;
  readonly summaryEn: string;
}

const PRESET_CARDS: readonly PresetUiMeta[] = [
  {
    id: 'guided',
    nameZh: '关键节点把关',
    nameEn: 'Guided (Recommended)',
    badgeZh: '默认推荐',
    badgeEn: 'Recommended',
    summaryZh:
      'AI 自主完成编码、拆解与测试，仅在需求基线冻结、高风险变更或最终交付时停下来请你一键拍板。',
    summaryEn:
      'Agents handle planning and coding automatically, pausing at key requirement freezes and delivery sign-offs.',
  },
  {
    id: 'autopilot',
    nameZh: '全自动托管',
    nameEn: 'Autopilot',
    badgeZh: '最少打扰',
    badgeEn: 'Hands-off',
    summaryZh:
      '除非触发预算红线、术语漂移或连续失败，否则自动推进需求分析、并行构筑与 Git 检查点认证。',
    summaryEn:
      'Auto-advances verified triage, planning, and delivery gates unless budget caps or failures trip a safety halt.',
  },
  {
    id: 'strict_audit',
    nameZh: '严格合规审计',
    nameEn: 'Strict Audit',
    badgeZh: '企业治理',
    badgeEn: 'Enterprise Audit',
    summaryZh:
      '默认启用完整 7 步 HAMA 需求博弈与双独立 QA 复核，严控文件作用域，适合核心账务与高合规场景。',
    summaryEn:
      'Forces full 7-stage HAMA deliberation, strict permission tier, and lower concurrency with full audit sign-offs.',
  },
];

function formatText(lang: UiLang, zh: string, en: string): string {
  return lang === 'ZH' ? zh : en;
}

export function IntentComposer(props: {
  readonly lang: UiLang;
  readonly activeHub: FederationHub | null;
  readonly hubRepos: readonly RepositoryEntry[];
  readonly controlSchema: ControlSchemaResponse | null;
  readonly onCreated: (
    mission: MissionRecord,
    focus: FocusProjection,
  ) => void | Promise<void>;
  readonly onError: (message: string) => void;
}): ReactElement {
  const {lang, activeHub, hubRepos, controlSchema, onCreated, onError} = props;

  const [title, setTitle] = useState('');
  const [rawIntent, setRawIntent] = useState('');
  const [preset, setPreset] = useState<IntentPresetId>('guided');
  const [executionMode, setExecutionMode] =
    useState<ExecutionMode>('simulation');
  const [selectedRepoIds, setSelectedRepoIds] = useState<readonly string[]>([]);
  const [budgetUsd, setBudgetUsd] = useState('25');
  const [showSchemaHelp, setShowSchemaHelp] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleRepo = (repoId: string): void => {
    setSelectedRepoIds(prev =>
      prev.includes(repoId)
        ? prev.filter(id => id !== repoId)
        : [...prev, repoId],
    );
  };

  const launchMission = async (override?: {
    readonly intent?: string;
    readonly preset?: IntentPresetId;
    readonly mode?: ExecutionMode;
    readonly title?: string;
  }): Promise<void> => {
    const intentText = (override?.intent ?? rawIntent).trim();
    if (!intentText) {
      onError(
        formatText(
          lang,
          '请先用一两句话描述你想交付的软件功能，或直接点击下方演示场景。',
          'Please describe what you want to build, or click one of the ready-made scenarios.',
        ),
      );
      return;
    }
    setSubmitting(true);
    try {
      const parsedBudget = Number.parseFloat(budgetUsd);
      const created = await forgeApi.createMission({
        hubId: activeHub?.id,
        repoIds: selectedRepoIds.length > 0 ? selectedRepoIds : undefined,
        title: (override?.title ?? title).trim() || undefined,
        rawIntent: intentText,
        preset: override?.preset ?? preset,
        executionMode: override?.mode ?? executionMode,
        configOverrides:
          Number.isFinite(parsedBudget) && parsedBudget > 0
            ? {budgetUsdLimit: parsedBudget}
            : undefined,
      });
      await onCreated(created.mission, created.focus);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="v3-canvas">
      {/* Hero Launch Card */}
      <section className="v3-card" style={{padding: '24px 26px'}}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span className="v3-pill v3-pill-accent">
                {formatText(
                  lang,
                  'Step 1 · 用人话下达需求',
                  'Step 1 · Describe Intent',
                )}
              </span>
              {activeHub ? (
                <span className="v3-pill">
                  {formatText(lang, '当前工作区：', 'Workspace: ')}
                  {activeHub.name} · {hubRepos.length}{' '}
                  {formatText(lang, '个代码仓', 'repos')}
                </span>
              ) : null}
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 750,
                letterSpacing: '-0.02em',
              }}
            >
              {formatText(
                lang,
                '用一句话启动软件工厂，无需先懂工作流图与底层参数',
                'Start with plain language — ForgeOps reveals only what needs your call',
              )}
            </h1>
            <p
              style={{
                margin: '6px 0 0',
                color: 'var(--v3-sub)',
                fontSize: 13.5,
              }}
            >
              {formatText(
                lang,
                '系统会自动完成需求分诊、多角色博弈收敛、规范图编译、沙盒编码与独立 QA 审计；关键时刻只把需要你拍板的那一张卡片送到面前。',
                'ForgeOps handles triage, HAMA spec convergence, Twin-Graph compilation, sandbox coding, and dual QA audit automatically.',
              )}
            </p>
          </div>
          <button
            type="button"
            className="v3-btn"
            onClick={() => setShowSchemaHelp(v => !v)}
          >
            {showSchemaHelp
              ? formatText(lang, '收起控制参数百科', 'Hide Control Guide')
              : formatText(
                  lang,
                  '各个参数代表什么？',
                  'What do controls mean?',
                )}
          </button>
        </div>

        <textarea
          className="v3-textarea"
          rows={4}
          style={{width: '100%', resize: 'vertical', lineHeight: 1.6}}
          value={rawIntent}
          onChange={e => setRawIntent(e.target.value)}
          placeholder={formatText(
            lang,
            '例如：在支付结算服务中增加幂等凭证校验，防止重复扣款；在前端交易列表展示凭证编码与审计轨迹。',
            'e.g. Add idempotent SettlementVoucher validation to settlement-service and surface voucher audit status in billing-web.',
          )}
        />

        {/* Execution Mode & Preset Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginTop: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{fontSize: 12.5, fontWeight: 700, color: 'var(--v3-sub)'}}
            >
              {formatText(lang, '运行模式：', 'Mode:')}
            </span>
            <button
              type="button"
              className={`v3-btn ${executionMode === 'simulation' ? 'v3-btn-primary' : ''}`}
              onClick={() => setExecutionMode('simulation')}
            >
              {formatText(
                lang,
                '模拟演练 Simulation（零成本秒级跑通）',
                'Simulation (Deterministic · Zero Cost)',
              )}
            </button>
            <button
              type="button"
              className={`v3-btn ${executionMode === 'live' ? 'v3-btn-indigo' : ''}`}
              onClick={() => setExecutionMode('live')}
            >
              {formatText(
                lang,
                '真实执行 Live（真实模型与本地仓库）',
                'Live (Real Models & CLI Adapters)',
              )}
            </button>
          </div>

          <button
            type="button"
            className="v3-btn v3-btn-ghost"
            onClick={() => setShowAdvanced(v => !v)}
          >
            {showAdvanced
              ? formatText(lang, '隐藏高级范围设置', 'Hide Scope & Budget')
              : formatText(
                  lang,
                  '展开标题 / 代码仓范围 / 预算',
                  'Title, Repo Scope & Budget',
                )}
          </button>
        </div>

        {showAdvanced && (
          <div
            className="v3-card-warm"
            style={{
              marginTop: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="v3-grid-2">
              <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--v3-sub)',
                  }}
                >
                  {formatText(
                    lang,
                    '任务简短标题（可选，留空自动提取）',
                    'Short Title (Optional)',
                  )}
                </span>
                <input
                  className="v3-input"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={formatText(
                    lang,
                    '如：结算凭证幂等升级',
                    'e.g. Settlement Voucher Rollout',
                  )}
                />
              </label>
              <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--v3-sub)',
                  }}
                >
                  {formatText(
                    lang,
                    '单任务预算上限 ($ USD)',
                    'Budget Ceiling ($ USD)',
                  )}
                </span>
                <input
                  className="v3-input v3-mono"
                  type="number"
                  min={1}
                  max={5000}
                  value={budgetUsd}
                  onChange={e => setBudgetUsd(e.target.value)}
                />
              </label>
            </div>

            {hubRepos.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--v3-sub)',
                    marginBottom: 6,
                  }}
                >
                  {formatText(
                    lang,
                    '涉及代码仓（不勾则由工厂自动判断关联仓）：',
                    'Target Repositories (leave unchecked for automatic selection):',
                  )}
                </div>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                  {hubRepos.map(repo => {
                    const checked = selectedRepoIds.includes(repo.id);
                    return (
                      <button
                        key={repo.id}
                        type="button"
                        className={`v3-btn ${checked ? 'v3-btn-primary' : ''}`}
                        onClick={() => toggleRepo(repo.id)}
                      >
                        {checked ? '✓ ' : ''}
                        {repo.name}
                        <span
                          className="v3-mono"
                          style={{fontSize: 11, opacity: 0.78}}
                        >
                          ({repo.tier})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3 Plain-Language Autonomy Presets */}
        <div style={{marginTop: 16}}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: 'var(--v3-sub)',
              marginBottom: 8,
            }}
          >
            {formatText(
              lang,
              '选择你的参与深度：',
              'Choose Human Supervision Preset:',
            )}
          </div>
          <div className="v3-grid-3">
            {PRESET_CARDS.map(item => {
              const selected = preset === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`v3-preset-card ${selected ? 'selected' : ''}`}
                  onClick={() => setPreset(item.id)}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                    }}
                  >
                    <span style={{fontWeight: 750, fontSize: 14}}>
                      {formatText(lang, item.nameZh, item.nameEn)}
                    </span>
                    <span
                      className={`v3-pill ${selected ? 'v3-pill-accent' : ''}`}
                    >
                      {formatText(lang, item.badgeZh, item.badgeEn)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: 'var(--v3-sub)',
                      lineHeight: 1.5,
                    }}
                  >
                    {formatText(lang, item.summaryZh, item.summaryEn)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            type="button"
            className="v3-btn v3-btn-primary"
            disabled={submitting}
            style={{padding: '9px 20px', fontSize: 13.5}}
            onClick={() => {
              void launchMission();
            }}
          >
            {submitting
              ? formatText(lang, '正在启动并分诊需求…', 'Launching Mission…')
              : formatText(lang, '启动此任务 →', 'Launch Mission →')}
          </button>
        </div>
      </section>

      {/* Live Control Schema Guide */}
      {showSchemaHelp && controlSchema && (
        <section className="v3-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 style={{margin: 0, fontSize: 15.5, fontWeight: 750}}>
              {formatText(
                lang,
                '自说明控制词典（来自后端 Schema 实时注册表）',
                'Live Self-Documenting Control Registry',
              )}
            </h2>
            <span className="v3-pill">
              {controlSchema.controls.length} items
            </span>
          </div>
          <div className="v3-grid-2">
            {controlSchema.controls.map(ctrl => (
              <div
                key={ctrl.key}
                className="v3-card-warm"
                style={{display: 'flex', flexDirection: 'column', gap: 5}}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{fontWeight: 700, fontSize: 13.5}}>
                    {ctrl.label}
                  </span>
                  <span
                    className={`v3-pill ${
                      ctrl.riskLevel === 'high'
                        ? 'v3-pill-red'
                        : ctrl.riskLevel === 'medium'
                          ? 'v3-pill-amber'
                          : 'v3-pill-green'
                    }`}
                  >
                    {ctrl.group} · {ctrl.riskLevel}
                  </span>
                </div>
                <div style={{fontSize: 12.5, color: 'var(--v3-ink)'}}>
                  {ctrl.plainExplanation}
                </div>
                <div style={{fontSize: 12, color: 'var(--v3-sub)'}}>
                  <strong>{formatText(lang, '生效范围：', 'Effect: ')}</strong>
                  {ctrl.runtimeEffect}
                </div>
                <div
                  className="v3-mono"
                  style={{fontSize: 11, color: 'var(--v3-muted)'}}
                >
                  autopilot={String(ctrl.defaultByPreset.autopilot)} | guided=
                  {String(ctrl.defaultByPreset.guided)} | strict=
                  {String(ctrl.defaultByPreset.strict_audit)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3 One-Click Demo Scenarios */}
      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <h2 style={{margin: 0, fontSize: 15, fontWeight: 750}}>
            {formatText(
              lang,
              '不知道先试什么？点击下方任意演练场景直接体验完整 v3.0 闭环',
              'One-Click Interactive Scenarios (Simulation Mode)',
            )}
          </h2>
          <span style={{fontSize: 12, color: 'var(--v3-muted)'}}>
            {formatText(
              lang,
              '不消耗真实 API 额度',
              'Offline deterministic simulation',
            )}
          </span>
        </div>
        <div className="v3-grid-3">
          {DEMO_SCENARIOS.map(sc => (
            <div
              key={sc.id}
              className="v3-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <span
                  className="v3-pill v3-pill-indigo"
                  style={{marginBottom: 8}}
                >
                  {formatText(lang, sc.tagZh, sc.tagEn)}
                </span>
                <div style={{fontWeight: 750, fontSize: 14, marginBottom: 6}}>
                  {formatText(lang, sc.titleZh, sc.titleEn)}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--v3-sub)',
                    lineHeight: 1.55,
                  }}
                >
                  {formatText(lang, sc.descZh, sc.descEn)}
                </div>
              </div>
              <div style={{display: 'flex', gap: 8}}>
                <button
                  type="button"
                  className="v3-btn"
                  style={{flex: 1, justifyContent: 'center'}}
                  disabled={submitting}
                  onClick={() => {
                    setTitle(formatText(lang, sc.titleZh, sc.titleEn));
                    setRawIntent(sc.intent);
                    setPreset(sc.preset);
                    setExecutionMode('simulation');
                  }}
                >
                  {formatText(lang, '填入草稿', 'Fill Draft')}
                </button>
                <button
                  type="button"
                  className="v3-btn v3-btn-primary"
                  style={{flex: 1, justifyContent: 'center'}}
                  disabled={submitting}
                  onClick={() => {
                    void launchMission({
                      title: formatText(lang, sc.titleZh, sc.titleEn),
                      intent: sc.intent,
                      preset: sc.preset,
                      mode: 'simulation',
                    });
                  }}
                >
                  {formatText(lang, '一键运行 →', 'Run Now →')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Exhaustive Bilingual (简体中文 / English) UI & SDD Documentation Engine.
 * Zero external dependency, 100% strongly typed.
 */

export type UiLang = 'ZH' | 'EN';

export function tr(lang: UiLang, zh: string, en: string): string {
  return lang === 'ZH' ? zh : en;
}

export function formatStatusLabel(lang: UiLang, rawStatus: string): string {
  switch (rawStatus) {
    case 'certified':
    case 'completed':
      return tr(lang, '已认证完成', 'completed');
    case 'waived':
      return tr(lang, '已豁免放行', 'waived');
    case 'running':
    case 'in_progress':
    case 'active':
      return tr(lang, '执行中', 'in_progress');
    case 'ready':
      return tr(lang, '就绪待跑', 'ready');
    case 'pending':
    case 'planned':
      return tr(lang, '待执行', 'pending');
    case 'failed':
      return tr(lang, '门禁未通过', 'failed');
    case 'rewound':
      return tr(lang, '已物理回退', 'rewound');
    case 'blocked_human':
      return tr(lang, '待人工裁决', 'blocked_human');
    case 'cooldown_holding':
      return tr(lang, '限流保活等待', 'cooldown');
    case 'archived':
      return tr(lang, '已归档', 'archived');
    case 'promoted':
      return tr(lang, '已升格变更单', 'promoted');
    case 'open':
      return tr(lang, '讨论中', 'open');
    default:
      return rawStatus;
  }
}

export function formatDaemonLabel(
  lang: UiLang,
  daemonId: string,
  fallback: string,
): string {
  if (lang === 'EN') return fallback;
  switch (daemonId) {
    case 'continuity_watchdog':
      return '8h 长程连续性与限流保活守护进程';
    case 'dreaming_consolidator':
      return '睡眠期认知整合守护进程 (DreamingDaemon)';
    case 'infra_steward':
    case 'steward_patrol':
      return 'Infra 基建管家与工作树巡检守护进程';
    default:
      return fallback;
  }
}

export function formatRoomScenario(lang: UiLang, scenario: string): string {
  if (lang === 'EN') return scenario;
  switch (scenario) {
    case 'req-grill':
      return '需求拷问';
    case 'arch-council':
      return '架构与DDD评审';
    case 'triage-ops':
      return '阻塞升级';
    case 'direct-ops':
      return '联合作战';
    case 'exec-briefing':
      return '高管简报';
    default:
      return scenario;
  }
}

export function formatPermissionTier(lang: UiLang, tier: string): string {
  if (lang === 'EN') return tier;
  switch (tier) {
    case 'turbo':
      return '极速自治 (Turbo)';
    case 'supervised':
      return '受控监督 (Supervised)';
    case 'strict':
      return '严格门禁 (Strict)';
    default:
      return tier;
  }
}

export interface ChangelogEntryDoc {
  readonly version: string;
  readonly date: string;
  readonly titleZh: string;
  readonly titleEn: string;
  readonly highlightsZh: readonly string[];
  readonly highlightsEn: readonly string[];
}

export const CHANGELOG_DOCS: readonly ChangelogEntryDoc[] = [
  {
    version: 'v2.2.0',
    date: '2026-11-12',
    titleZh:
      'DirectUI 原生桌面壳层 · Anthropic Serif + 思源宋体 · 全量中英双语与 SDD 工坊',
    titleEn:
      'DirectUI Native Shell · Anthropic Serif + Source Han Serif · Full Bilingual & SDD Studio',
    highlightsZh: [
      '全量切换至 Anthropic Serif（西文/数字）+ 思源宋体（Source Han Serif SC / Noto Serif SC）人文出版级衬线排版体系。',
      '桌面端 DirectUI 自绘质感加固：全局防误触蓝底选中（仅代码块/Diff/日志开放精确选中与一键复制）、Windows 原生无边框沉浸标题栏、窗口坐标记忆与单实例锁。',
      '全链路简中 / English 实时无缝互译，覆盖侧边栏、双生图工作台、注册表、TQLA 门禁台、智能体市场、模型池、工程协作室与记忆观星台。',
      '深度融合 SDD 规格闭环能力：顶部 Ctrl+K 全局命令面板、艾宾浩斯心智保持率胶囊抽屉、双生图节点四段式认知移交检视器、以及实时 DDD 禁用同义词漂移扫描器。',
    ],
    highlightsEn: [
      'Unified Anthropic Serif + Source Han Serif SC / Noto Serif SC editorial typography across all desktop surfaces and React Flow nodes.',
      'DirectUI native desktop hardening: zero accidental blue drag-selection on UI chrome, Windows frameless titleBarOverlay integration, persisted window bounds, and single-instance lock.',
      'Complete Simplified Chinese <-> English live switching persisted across launches.',
      'Integrated SDD Spec Studio: Ctrl+K Command Palette, Ebbinghaus R_human Re-hydration Capsule drawer, Twin-Graph 4-section Epistemic Rollover Node Inspector, and live DDD Terminology Drift Scanner.',
    ],
  },
  {
    version: 'v2.1.1',
    date: '2026-11-12',
    titleZh: '1:1 清爽浅色工程控制台与阶梯式零重叠 Twin-Graph 拓扑编译',
    titleEn:
      '1:1 Light Engineering Console & Stepped Zero-Overlap Twin-Graph Compiler',
    highlightsZh: [
      '重构双栏工作台（左侧阶段折叠任务树 + 右侧 Task Details / Flow Monitor / Activity / Twin Graph）与可折叠分组导航栏。',
      '升级双生图编译器：Start -> Spec 完整性守卫 -> 基线检查点 -> 可折叠 Phase 容器（内嵌多列子任务）-> 硬门禁 -> Selfcheck / JQA / SQA 双级独立审计 -> FAIL 恢复环路 -> 物理 Git 检查点。',
      '新增 Change Team & TQLA 双级门禁配置持久化接口与自定义智能体生命周期管理。',
    ],
    highlightsEn: [
      'Rebuilt 2-column Workstation and 4-group collapsible navigation shell in crisp #f8fafc / #ffffff light palette.',
      'Upgraded compileTwinGraph to stepped horizontal QA rows with right-hand Restore -> Checkpoint return bus and zero node overlap.',
      'Added persistent Change Team / TQLA configuration endpoint and custom agent management.',
    ],
  },
  {
    version: 'v2.1.0',
    date: '2026-11-11',
    titleZh:
      '多仓联邦 Hub · DDD 统一语言 · 8 小时连续性引擎与物理 Git 救援回退',
    titleEn:
      'Multi-Repo Federation Hub · DDD Ubiquitous Language · 8h Continuity & Git Rescue Rollback',
    highlightsZh: [
      '落地 node:sqlite WAL 单写者原子存储 + FTS5 全文证据检索 + 双时态语义记忆（valid_from / valid_until）。',
      '实现多仓 git worktree 物理隔离沙箱，回滚前自动锚定 refs/forgeops-backup 救援引用，确保历史代码零丢失。',
      '打通 ACP JSON-RPC 2.0（Kimi / Hermes / OpenCode ACP）、CLI 流协议（Codex / Claude Code / Pi / WorkBuddy）与原生 API 三大接入标准，配合单次鉴权 forge_station MCP 服务。',
    ],
    highlightsEn: [
      'Built node:sqlite WAL single-writer store with FTS5 full-text evidence search and bi-temporal semantic memory.',
      'Implemented symlink-confined multi-repo git worktree sandbox with refs/forgeops-backup rescue refs before rollback.',
      'Delivered acp-stdio, cli-stream, and native-api multi-agent hub with per-attempt Bearer-authenticated forge_station MCP.',
    ],
  },
];

export interface SddSpecSectionDoc {
  readonly id: string;
  readonly tabZh: string;
  readonly tabEn: string;
  readonly headingZh: string;
  readonly headingEn: string;
  readonly summaryZh: string;
  readonly summaryEn: string;
  readonly bulletsZh: readonly string[];
  readonly bulletsEn: readonly string[];
}

export const SDD_SPEC_DOCS: readonly SddSpecSectionDoc[] = [
  {
    id: 'axioms',
    tabZh: '六大工程公理',
    tabEn: 'Six Core Axioms',
    headingZh: 'SDD §1 — 面向 ToB 复杂软件工程的六大核心公理',
    headingEn: 'SDD §1 — Six Core Engineering Axioms for ToB Software Delivery',
    summaryZh:
      'ForgeOps 摒弃玩具级静态提示词连线，围绕跨仓库契约治理、术语零漂移、执行与认证分权以及人类注意力守恒构建工业级工程闭环。',
    summaryEn:
      'ForgeOps replaces brittle static prompt chains with multi-repo governance, Ubiquitous Language enforcement, strict separation of execution vs. certification, and human attention conservation.',
    bulletsZh: [
      '1. 人类注意力守恒：健康自治过程零噪音；仅在交付就绪、触碰权限红线或架构分叉时向人类提出单一结构化决策问题（推荐项置顶）。',
      '2. DDD 领域通用语言先行：限界上下文标准术语与禁用同义词黑名单贯穿需求拷问、切片契约、代码门禁与重构。',
      '3. 中枢集中治理、多仓分布执行（Federation Hub）：Master Hub 统一托管面向智能体精简的 agent-wiki 契约拓扑与共享技能库，向下调度各业务仓独立 git worktree。',
      '4. 执行权与认证权彻底分离：Worker 智能体严禁“自判完成”；必须经宿主机硬门禁（exitCode === 0）+ JQA 一致性初审 + SQA 架构终审独立放行。',
      '5. 强指挥弱与实时运行遥测：强推理模型担任首席架构师拆解契约与兜底攻坚，高性价比模型执行切片，严格剥离环境故障（env_fault）与能力失败（task_failure）。',
      '6. Infra 基建独立自治：专属 Infra Steward Agent 统一审计维护全局宪法、技能银行、环境探针与交付后 Retro 文档瘦身。',
    ],
    bulletsEn: [
      '1. Human Attention Conservation: Zero noise during healthy execution; interrupt only with a single structured choice question (recommended option first).',
      '2. Ubiquitous Language First: Canonical domain identifiers and forbidden alias blacklists enforced from requirement grill to QA gate.',
      '3. Centralized Hub, Distributed Worktrees: Master Hub curates high-signal agent-wiki contracts while isolating per-repo git worktrees.',
      '4. Execution vs. Certification Separation: Workers never self-certify; deterministic host gates + read-only JQA + SQA evaluators decide.',
      '5. Strong-Leads-Fast Telemetry: Rolling pass rate, cost per certified slice, and env_fault circuit-breaking guide assignment.',
      '6. Sovereign Infra Plane: Dedicated Infra Steward Agent governs Soul Constitution, Skills Bank, Neural Link Doctor, and post-change Retro.',
    ],
  },
  {
    id: 'twingraph',
    tabZh: '双生图与 TQLA',
    tabEn: 'Twin-Graph & TQLA',
    headingZh: 'SDD §6 — 动态双生执行图（Twin Graph）与物理级安全回退',
    headingEn:
      'SDD §6 — Living Twin-Graph, Dual-Level TQLA & Rescue-Safe Git Rewind',
    summaryZh:
      '左侧层级化 WBS 任务树与右侧可折叠阶段容器（PhaseContainer）实时双向同步，完整呈现确定性门禁、双级独立审计与精确图论回退集。',
    summaryEn:
      'Left hierarchical WBS tasks stay 1:1 synchronized with collapsible PhaseContainers, deterministic gates, dual-level QA evaluators, and branch-isolated Git rewinds.',
    bulletsZh: [
      'G1 -> G2 -> G3 全闭环：需求压力测试冻结 SPEC（G1）-> 编译阶段容器与任务嵌套双生图（G2）-> 硬门禁 + JQA 初审 + SQA 终审签发交付（G3）。',
      'Fail-Closed 独立评估：JQA 与 SQA 运行于只读沙箱会话（物理禁止写文件），审计 JSON 解析失败一律按未通过拦截。',
      '精确可达集重置：回退仅重置 Descendants(Checkpoint) ∩ AncestorsClosed(FailNode)，绝不误伤无关并行分支成果。',
      '零丢码物理 Git 恢复：每次 git reset --hard 回滚至检查点前，自动写入 refs/forgeops-backup/<change>/<ts>-<sha> 救援引用并生成《失败取证卡》。',
      '运行时 GhostNode 计划修订：发现底层代码前置依赖时动态无环插入虚线 GhostNode，告别推倒重来。',
    ],
    bulletsEn: [
      'G1 -> G2 -> G3 Closure: Freeze spec via multi-perspective grill -> compile nested PhaseContainer DAG -> certify via Gates + JQA + SQA.',
      'Fail-Closed Read-Only Evaluators: JQA and SQA run with write tools physically disabled; malformed JSON verdicts fail closed.',
      'Exact Graph Rewind Set: Resets strictly Descendants(Checkpoint) ∩ AncestorsClosed(FailNode) without collateral branch damage.',
      'Zero-Data-Loss Git Checkpoints: Anchors refs/forgeops-backup rescue refs prior to every physical worktree reset.',
      'Acyclic GhostNode Splicing: Dynamically injects runtime prerequisite tasks without restarting the Change.',
    ],
  },
  {
    id: 'continuity',
    tabZh: '8h 连续性与记忆',
    tabEn: '8h Continuity & Memory',
    headingZh: 'SDD §7 & §9 — 四段式认知移交与双向艾宾浩斯协同记忆',
    headingEn:
      'SDD §7 & §9 — Epistemic Rollover & Dual Ebbinghaus Cognitive Memory',
    summaryZh:
      '根治长程无人值守任务“半途幻觉早停”与人类多项目切换“上下文遗忘”两大核心痛点。',
    summaryEn:
      'Eliminates 4-hour premature-stop hallucinations in unattended runs and human context-switching overload across multiple active repositories.',
    bulletsZh: [
      '新鲜会话切片 + 四段式认知移交：强制拆分「已证实规格事实」「智能体假设（严禁跨轮升格为事实）」「待裁决冲突」「未核验验收项」。',
      '外部早停拦截器（CompletionCertifier）：只要存在未认证节点或门禁非零，即使智能体声称完成也自动驳回并续跑剩余缺口。',
      'CooldownHolding 夜间限流保活：遭遇 429 或窗口限额时自动指数退避等待或切流健康备选通道，绝不误判永久失败。',
      '人脑艾宾浩斯重锚胶囊：依据离开时长 Δt 与未读变异熵 Δentropy 实时计算记忆保持度 R_human，自动分级呈现 30 秒增量胶囊或全景重锚简报。',
      '双时态语义经验库 + DreamingDaemon：通过 valid_from / valid_until 淘汰过时架构记忆，后台自动提炼“先败后胜”避坑卡片。',
    ],
    bulletsEn: [
      'Fresh-Context Slicing + 4-Section Epistemic Rollover: Isolates Spec-Confirmed Facts from Agent Hypotheses, Open Conflicts, and Uncertified Criteria.',
      'External Premature-Stop Blocker: Rejects false completion claims whenever uncertified nodes or non-zero gates remain.',
      'CooldownHolding Resilience: Survives 429 rate-limit windows via exponential backoff without aborting overnight pipelines.',
      'Human Ebbinghaus Capsules: Computes live R_human from Δt and mutation entropy Δentropy to synthesize 30s / 2m / full re-hydration briefings.',
      'Bi-Temporal Semantic Memory & DreamingDaemon: Invalidates drifted code anchors via valid_until and extracts pitfall lessons offline.',
    ],
  },
];

export interface FaqItemDoc {
  readonly qZh: string;
  readonly qEn: string;
  readonly aZh: string;
  readonly aEn: string;
}

export const FAQ_DOCS: readonly FaqItemDoc[] = [
  {
    qZh: '1. 为什么在界面上按住鼠标左键拖动不会出现网页那种蓝色全选高亮？',
    qEn: '1. Why does dragging the mouse no longer highlight UI chrome in blue like a web page?',
    aZh: 'ForgeOps 桌面壳层采用与桌面微信、Linear、Zed 一致的 DirectUI 交互准则：所有导航、按钮、卡片、徽章与双生图节点默认锁定 user-select: none 并禁用浏览器拖拽残影；仅在代码 Diff、终端日志、本地仓库路径与提示词正文区域开放精确文本选择，并配套一键复制按钮。',
    aEn: 'ForgeOps enforces native DirectUI interaction hygiene (matching Desktop WeChat, Linear, and Zed): all chrome, controls, cards, and graph nodes lock user-select: none, while code diffs, logs, file paths, and prompts enable crisp text selection and 1-click copy.',
  },
  {
    qZh: '2. TQLA 双级质量门禁（JQA + SQA）是如何防止大模型“自吹自擂式完成”的？',
    qEn: '2. How does Dual-Level TQLA (JQA + SQA) prevent agents from hallucinating completion?',
    aZh: '开发切片（DEV）提交后，先由宿主机直接运行确定性硬门禁命令（shell: false, exitCode === 0），随后分别启动物理只读的 JQA（规格一致性初审）与 SQA（架构及 DDD 术语边界终审）独立评估会话。任一环节不通过均经 FAIL 红线触发 RestoreNode，将工作树安全回退至上游 CheckpointNode 并注入《失败取证卡》。',
    aEn: 'After DEV slice submission, the host runs deterministic shell-free gates (exitCode === 0) followed by independent read-only JQA (consistency) and SQA (architecture & DDD) evaluator sessions. Any rejection routes through FAIL -> RestoreNode -> CheckpointNode with a structured Failure Forensics Card.',
  },
  {
    qZh: '3. 点击底部 Checkpoints 回滚代码会导致之前写了一半的代码永久丢失吗？',
    qEn: '3. Will clicking a Checkpoint pill to rollback permanently lose uncommitted or experimental code?',
    aZh: '绝不会。GitWorktreeManager 在执行任何物理回退前，都会强制把当前工作树快照保存到受保护的 Git 引用 refs/forgeops-backup/<changeId>/<timestamp>-<sha> 中，并写入不可篡改的演进审计账本，随时可追溯恢复。',
    aEn: 'Never. Before any physical reset, GitWorktreeManager anchors the current worktree state under refs/forgeops-backup/<changeId>/<timestamp>-<sha> and logs the rescue reference in the immutable Audit Ledger.',
  },
  {
    qZh: '4. 如何接入本地已安装的 Claude Code、Codex、Kimi CLI 或商业 API Key？',
    qEn: '4. How do I connect local Claude Code, Codex, Kimi CLI, or commercial LLM API keys?',
    aZh: 'CLI / ACP 智能体可在「智能体工厂 -> 智能体市场」直接添加或使用内置预设，并通过「基础设施中心 -> 神经链路」一键运行 Environment Doctor 探测可执行文件与登录态；商业大模型密钥可在「模型池」点击各服务商卡片的「设置」写入宿主隔离保险箱（前端永不回显明文）。',
    aEn: 'Use Agent Factory -> Agents Market for CLI / ACP harnesses (and Infra Center -> Neural Link to run Environment Doctor), or configure API keys in Models Pool -> Settings, where keys are stored write-only in the Host Secret Vault.',
  },
];

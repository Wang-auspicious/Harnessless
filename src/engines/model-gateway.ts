/**
 * Unified Model Gateway, Provider/Account Pooling, Routing Groups, Named Profiles,
 * Agent Persona Bindings, External Connectors, and Local Privacy Secret Masking.
 */

import {randomUUID} from 'node:crypto';
import type {ISandboxProcessRunner} from '../sandbox/contracts.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  AgentBindingKind,
  AgentPersonaRecord,
  AgentRoleKey,
  ConnectorKind,
  ExternalConnectorRecord,
  GatewaySnapshot,
  KernelId,
  ModelProfileRecord,
  ModelProviderRecord,
  PrivacyMaskingConfig,
  ProviderApiKeyEntry,
  ProviderModelEntry,
  ProviderPresetKind,
  RoutingGroupRecord,
  RoutingStrategy,
  RoutingTarget,
  V4SseEvent,
} from '../shared/v4-types.ts';
import type {ForgeStore} from '../store/database.ts';
import type {DatabaseSync} from 'node:sqlite';

interface InternalKeyEntry {
  readonly id: string;
  readonly label: string;
  readonly rawKey: string;
  readonly enabled: boolean;
  readonly quotaExhausted?: boolean;
}

interface SqlRow {
  [key: string]: unknown;
}

const DEFAULT_PRIVACY_CONFIG: PrivacyMaskingConfig = {
  enabled: false,
  maskSecrets: true,
  maskEmails: true,
  allowDomains: ['example.com', '.test', '.invalid'],
};

const SEED_PROVIDERS: readonly {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderPresetKind;
  readonly baseUrl: string;
  readonly priority: number;
  readonly models: readonly ProviderModelEntry[];
}[] = [
  {
    id: 'prov-anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    priority: 10,
    models: [
      {
        id: 'claude-sonnet-4-5',
        label: 'Claude Sonnet 4.5',
        contextK: 200,
        supportsTools: true,
        supportsReasoning: true,
      },
      {
        id: 'claude-opus-4-5',
        label: 'Claude Opus 4.5',
        contextK: 200,
        supportsTools: true,
        supportsReasoning: true,
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        contextK: 200,
        supportsTools: true,
      },
    ],
  },
  {
    id: 'prov-openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    priority: 20,
    models: [
      {
        id: 'gpt-5.2-codex',
        label: 'GPT-5.2 Codex',
        contextK: 256,
        supportsTools: true,
        supportsReasoning: true,
      },
      {
        id: 'gpt-5.2',
        label: 'GPT-5.2',
        contextK: 256,
        supportsTools: true,
      },
      {
        id: 'o3-mini',
        label: 'o3-mini',
        contextK: 200,
        supportsReasoning: true,
      },
    ],
  },
  {
    id: 'prov-gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    priority: 30,
    models: [
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        contextK: 1000,
        supportsTools: true,
        supportsReasoning: true,
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        contextK: 1000,
        supportsTools: true,
      },
    ],
  },
  {
    id: 'prov-deepseek',
    name: 'DeepSeek',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    priority: 40,
    models: [
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek R1 Reasoner',
        contextK: 128,
        supportsReasoning: true,
      },
      {
        id: 'deepseek-chat',
        label: 'DeepSeek V3 Chat',
        contextK: 128,
        supportsTools: true,
      },
    ],
  },
  {
    id: 'prov-moonshot',
    name: 'Kimi (Moonshot)',
    kind: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    priority: 50,
    models: [
      {
        id: 'kimi-k2.5',
        label: 'Kimi K2.5',
        contextK: 256,
        supportsTools: true,
      },
    ],
  },
  {
    id: 'prov-ollama',
    name: 'Ollama (Local)',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    priority: 90,
    models: [
      {
        id: 'qwen2.5-coder:32b',
        label: 'Qwen 2.5 Coder 32B',
        contextK: 64,
      },
    ],
  },
];

const SEED_ROUTING_GROUPS: readonly {
  readonly id: string;
  readonly name: string;
  readonly strategy: RoutingStrategy;
  readonly targets: readonly RoutingTarget[];
}[] = [
  {
    id: 'grp-reasoning',
    name: '主力深度推理路由',
    strategy: 'order',
    targets: [
      {
        id: 't-1',
        providerId: 'prov-anthropic',
        modelId: 'claude-sonnet-4-5',
        maxContextK: 200,
      },
      {
        id: 't-2',
        providerId: 'prov-openai',
        modelId: 'gpt-5.2-codex',
        maxContextK: 256,
      },
      {
        id: 't-3',
        providerId: 'prov-gemini',
        modelId: 'gemini-2.5-pro',
        maxContextK: 1000,
      },
      {
        id: 't-4',
        providerId: 'prov-deepseek',
        modelId: 'deepseek-reasoner',
        maxContextK: 128,
      },
    ],
  },
  {
    id: 'grp-fast',
    name: '快速起草与摘要路由',
    strategy: 'rotate',
    targets: [
      {
        id: 't-f1',
        providerId: 'prov-gemini',
        modelId: 'gemini-2.5-flash',
        maxContextK: 1000,
      },
      {
        id: 't-f2',
        providerId: 'prov-anthropic',
        modelId: 'claude-haiku-4-5',
        maxContextK: 200,
      },
      {
        id: 't-f3',
        providerId: 'prov-deepseek',
        modelId: 'deepseek-chat',
        maxContextK: 128,
      },
    ],
  },
  {
    id: 'grp-longctx',
    name: '长上下文自动分级路由',
    strategy: 'context-tiered',
    targets: [
      {
        id: 't-l1',
        providerId: 'prov-deepseek',
        modelId: 'deepseek-chat',
        maxContextK: 64,
      },
      {
        id: 't-l2',
        providerId: 'prov-anthropic',
        modelId: 'claude-sonnet-4-5',
        maxContextK: 180,
      },
      {
        id: 't-l3',
        providerId: 'prov-gemini',
        modelId: 'gemini-2.5-pro',
        maxContextK: 1000,
      },
    ],
  },
];

interface SeedAgentSpec {
  readonly id: string;
  readonly displayName: string;
  readonly handle: string;
  readonly roleKey: AgentRoleKey;
  readonly avatarKey: string;
  readonly accentColor: string;
  readonly bindingKind: AgentBindingKind;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly routingGroupId: string | null;
  readonly harnessId: KernelId | null;
  readonly systemPrompt: string;
}

const SEED_AGENTS: readonly SeedAgentSpec[] = [
  {
    id: 'agent-coordinator',
    displayName: '统筹协调官',
    handle: 'coordinator',
    roleKey: 'coordinator',
    avatarKey: 'agy',
    accentColor: '#141413',
    bindingKind: 'routing_group',
    providerId: null,
    modelId: null,
    routingGroupId: 'grp-reasoning',
    harnessId: null,
    systemPrompt:
      '你是团队的软件研发统筹协调官，负责推动需求共识收敛、调度各专业角色协同编写 PRD 与 Spec、把控阶段推进与风险。回答务必清晰、可执行，避免空洞术语。',
  },
  {
    id: 'agent-pm',
    displayName: '需求分析官',
    handle: 'pm',
    roleKey: 'pm_analyst',
    avatarKey: 'gemini-cli',
    accentColor: '#2563EB',
    bindingKind: 'provider_model',
    providerId: 'prov-anthropic',
    modelId: 'claude-sonnet-4-5',
    routingGroupId: null,
    harnessId: null,
    systemPrompt:
      '你是资深产品需求分析官。负责将自然语言想法拆解为结构化目标、用户故事、范围边界与验收标准，提出关键分叉问题并直接更新协作 PRD 文档。',
  },
  {
    id: 'agent-architect',
    displayName: '系统架构师',
    handle: 'architect',
    roleKey: 'architect',
    avatarKey: 'claude-code',
    accentColor: '#0D9488',
    bindingKind: 'provider_model',
    providerId: 'prov-gemini',
    modelId: 'gemini-2.5-pro',
    routingGroupId: null,
    harnessId: null,
    systemPrompt:
      '你是系统架构师。负责评估技术可行性、模块边界、数据流与非功能指标（安全/性能/一致性），将 PRD 转为严谨的结构化 Spec 并维护架构白板。',
  },
  {
    id: 'agent-designer',
    displayName: '交互原型师',
    handle: 'designer',
    roleKey: 'ui_prototyper',
    avatarKey: 'cursor',
    accentColor: '#7C3AED',
    bindingKind: 'provider_model',
    providerId: 'prov-anthropic',
    modelId: 'claude-sonnet-4-5',
    routingGroupId: null,
    harnessId: null,
    systemPrompt:
      '你是资深产品交互原型师。负责产出可对比、可交互的 HTML 页面原型与界面规格，帮助团队在需求阶段直观对齐交互方案。',
  },
  {
    id: 'agent-engineer',
    displayName: '开发工程师',
    handle: 'engineer',
    roleKey: 'engineer',
    avatarKey: 'codex',
    accentColor: '#16A34A',
    bindingKind: 'cli_harness',
    providerId: 'prov-openai',
    modelId: 'gpt-5.2-codex',
    routingGroupId: null,
    harnessId: 'codex',
    systemPrompt:
      '你是高级软件工程师。负责依据冻结后的 Spec 合同，在隔离 Git Worktree 中按波次编写、测试并验证模块化代码实现。',
  },
  {
    id: 'agent-reviewer',
    displayName: '独立审校官',
    handle: 'reviewer',
    roleKey: 'reviewer',
    avatarKey: 'opencode',
    accentColor: '#B45309',
    bindingKind: 'cli_harness',
    providerId: 'prov-deepseek',
    modelId: 'deepseek-reasoner',
    routingGroupId: null,
    harnessId: 'claude-code',
    systemPrompt:
      '你是独立审校官，严格遵循实现与审校分离原则。负责挑出需求漏洞、竞态边界、契约遗漏及安全风险，提供可落地的修订建议。',
  },
];

const SEED_CONNECTORS: readonly {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly displayName: string;
  readonly config: Readonly<Record<string, string>>;
}[] = [
  {
    id: 'conn-slack',
    kind: 'slack',
    displayName: 'Slack 频道双向同步',
    config: {channel: '#product-specs', workspace: ''},
  },
  {
    id: 'conn-github',
    kind: 'github',
    displayName: 'GitHub Issues & PRs',
    config: {repo: '', branch: 'main'},
  },
  {
    id: 'conn-notion',
    kind: 'notion',
    displayName: 'Notion 知识库同步',
    config: {databaseId: ''},
  },
  {
    id: 'conn-gdocs',
    kind: 'google_docs',
    displayName: 'Google Docs 协同文档',
    config: {folderUrl: ''},
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function str(row: SqlRow, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v : '';
}

function nullableStr(row: SqlRow, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(row: SqlRow, key: string, fallback = 0): number {
  const v = row[key];
  return typeof v === 'number' ? v : fallback;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function maskSecretValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****`;
  return `${trimmed.slice(0, 5)}…${trimmed.slice(-4)}`;
}

export function applyPrivacyMask(
  text: string,
  config: PrivacyMaskingConfig,
): {
  readonly maskedText: string;
  readonly tokenMap: Map<string, string>;
} {
  if (!config.enabled || !text) {
    return {maskedText: text, tokenMap: new Map()};
  }
  const tokenMap = new Map<string, string>();
  let out = text;
  let seq = 1;
  const stash = (prefix: string, original: string): string => {
    for (const [placeholder, val] of tokenMap.entries()) {
      if (val === original) return placeholder;
    }
    const placeholder = `{{${prefix}_${seq++}}}`;
    tokenMap.set(placeholder, original);
    return placeholder;
  };

  if (config.maskSecrets) {
    out = out.replace(
      /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|xoxb-[A-Za-z0-9-]{16,})\b/g,
      match => stash('API_KEY', match),
    );
  }
  if (config.maskEmails) {
    out = out.replace(
      /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
      (match, domain: string) => {
        const lower = domain.toLowerCase();
        const allowed = config.allowDomains.some(
          d => lower === d.replace(/^\./, '') || lower.endsWith(d),
        );
        return allowed ? match : stash('EMAIL', match);
      },
    );
  }
  return {maskedText: out, tokenMap};
}

export function restorePrivacyMask(
  text: string,
  tokenMap: ReadonlyMap<string, string>,
): string {
  let out = text;
  for (const [placeholder, original] of tokenMap.entries()) {
    out = out.split(placeholder).join(original);
  }
  return out;
}

export interface ModelInvocationResult {
  readonly mode: 'live-api' | 'live-cli' | 'local-deterministic';
  readonly modelLabel: string;
  readonly providerName: string | null;
  readonly text: string | null;
  readonly error?: string;
}

export class ModelGatewayEngine {
  private readonly store: ForgeStore;
  private readonly runner: ISandboxProcessRunner;
  private readonly publish: (event: V4SseEvent) => void;
  private rotateCursor = 0;

  constructor(options: {
    readonly store: ForgeStore;
    readonly runner: ISandboxProcessRunner;
    readonly publish: (event: V4SseEvent) => void;
  }) {
    this.store = options.store;
    this.runner = options.runner;
    this.publish = options.publish;
    this.ensureDefaults();
  }

  private get db(): DatabaseSync {
    return this.store.db;
  }

  ensureDefaults(): void {
    const now = nowIso();
    const provCount = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM v4_model_providers')
      .get() as SqlRow;
    if (num(provCount, 'cnt', 0) === 0) {
      const insertProv = this.db.prepare(
        `INSERT OR IGNORE INTO v4_model_providers
         (id, name, kind, base_url, api_keys_json, models_json, enabled, priority, health_status, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'untested', NULL, ?)`,
      );
      for (const p of SEED_PROVIDERS) {
        const envKey = this.readEnvFallbackKey(p.kind);
        const seedKeys: InternalKeyEntry[] = envKey
          ? [
              {
                id: `${p.id}-env`,
                label: '环境变量自动探测',
                rawKey: envKey,
                enabled: true,
              },
            ]
          : [];
        insertProv.run(
          p.id,
          p.name,
          p.kind,
          p.baseUrl,
          JSON.stringify(seedKeys),
          JSON.stringify(p.models),
          p.priority,
          now,
        );
      }
    }

    const grpCount = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM v4_routing_groups')
      .get() as SqlRow;
    if (num(grpCount, 'cnt', 0) === 0) {
      const insertGrp = this.db.prepare(
        `INSERT OR IGNORE INTO v4_routing_groups
         (id, name, strategy, targets_json, failover_enabled, updated_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
      );
      for (const g of SEED_ROUTING_GROUPS) {
        insertGrp.run(g.id, g.name, g.strategy, JSON.stringify(g.targets), now);
      }
    }

    const agentCount = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM v4_agent_roster')
      .get() as SqlRow;
    if (num(agentCount, 'cnt', 0) === 0) {
      const insertAgent = this.db.prepare(
        `INSERT OR IGNORE INTO v4_agent_roster
         (id, display_name, handle, role_key, avatar_key, accent_color, binding_kind, provider_id, model_id, routing_group_id, harness_id, system_prompt, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      );
      for (const a of SEED_AGENTS) {
        insertAgent.run(
          a.id,
          a.displayName,
          a.handle,
          a.roleKey,
          a.avatarKey,
          a.accentColor,
          a.bindingKind,
          a.providerId,
          a.modelId,
          a.routingGroupId,
          a.harnessId,
          a.systemPrompt,
          now,
        );
      }
    }

    const profileCount = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM v4_model_profiles')
      .get() as SqlRow;
    if (num(profileCount, 'cnt', 0) === 0) {
      const insertProfile = this.db.prepare(
        `INSERT OR IGNORE INTO v4_model_profiles
         (id, name, description, bindings_json, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      insertProfile.run(
        'prof-balanced',
        '平衡协同方案',
        '需求与架构使用主流推理模型，开发与审校分离绑定',
        JSON.stringify({
          coordinator: {
            bindingKind: 'routing_group',
            routingGroupId: 'grp-reasoning',
          },
          pm: {
            bindingKind: 'provider_model',
            providerId: 'prov-anthropic',
            modelId: 'claude-sonnet-4-5',
          },
          architect: {
            bindingKind: 'provider_model',
            providerId: 'prov-gemini',
            modelId: 'gemini-2.5-pro',
          },
          engineer: {
            bindingKind: 'cli_harness',
            harnessId: 'codex',
          },
          reviewer: {
            bindingKind: 'cli_harness',
            harnessId: 'claude-code',
          },
        }),
        1,
        now,
      );
      insertProfile.run(
        'prof-fast',
        '极速省流方案',
        '优先低延迟与高性价比模型完成多轮需求头脑风暴',
        JSON.stringify({
          coordinator: {
            bindingKind: 'routing_group',
            routingGroupId: 'grp-fast',
          },
          pm: {
            bindingKind: 'provider_model',
            providerId: 'prov-gemini',
            modelId: 'gemini-2.5-flash',
          },
          architect: {
            bindingKind: 'provider_model',
            providerId: 'prov-deepseek',
            modelId: 'deepseek-chat',
          },
        }),
        0,
        now,
      );
      insertProfile.run(
        'prof-local',
        '本地离线方案',
        '仅使用本地 Ollama 模型与本机 CLI 工具',
        JSON.stringify({
          coordinator: {
            bindingKind: 'provider_model',
            providerId: 'prov-ollama',
            modelId: 'qwen2.5-coder:32b',
          },
          pm: {
            bindingKind: 'provider_model',
            providerId: 'prov-ollama',
            modelId: 'qwen2.5-coder:32b',
          },
        }),
        0,
        now,
      );
    }

    const connCount = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM v4_connectors')
      .get() as SqlRow;
    if (num(connCount, 'cnt', 0) === 0) {
      const insertConn = this.db.prepare(
        `INSERT OR IGNORE INTO v4_connectors
         (id, kind, display_name, enabled, config_json, status, last_sync_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 'disconnected', NULL, ?)`,
      );
      for (const c of SEED_CONNECTORS) {
        insertConn.run(
          c.id,
          c.kind,
          c.displayName,
          JSON.stringify(c.config),
          now,
        );
      }
    }

    this.db
      .prepare(
        "UPDATE v4_agent_roster SET avatar_key = 'agy' WHERE id = 'agent-coordinator' AND avatar_key = 'claude-code'",
      )
      .run();
  }

  private readEnvFallbackKey(kind: ProviderPresetKind): string {
    const candidates: Record<ProviderPresetKind, readonly string[]> = {
      anthropic: ['ANTHROPIC_API_KEY'],
      openai: ['OPENAI_API_KEY'],
      gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      deepseek: ['DEEPSEEK_API_KEY'],
      moonshot: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
      zhipu: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
      openrouter: ['OPENROUTER_API_KEY'],
      ollama: [],
      'openai-compatible': [],
    };
    for (const envName of candidates[kind] ?? []) {
      const val = process.env[envName];
      if (typeof val === 'string' && val.trim().length > 0) {
        return val.trim();
      }
    }
    return '';
  }

  private mapProvider(row: SqlRow): {
    readonly publicRecord: ModelProviderRecord;
    readonly internalKeys: readonly InternalKeyEntry[];
  } {
    const rawKeys = parseJson<InternalKeyEntry[]>(
      str(row, 'api_keys_json'),
      [],
    );
    const publicKeys: ProviderApiKeyEntry[] = rawKeys.map(k => ({
      id: k.id,
      label: k.label,
      keyPreview: maskSecretValue(k.rawKey),
      enabled: k.enabled,
      quotaExhausted: k.quotaExhausted,
    }));
    const models = parseJson<ProviderModelEntry[]>(str(row, 'models_json'), []);
    const healthRaw = str(row, 'health_status');
    const healthStatus: ModelProviderRecord['healthStatus'] =
      healthRaw === 'ok' || healthRaw === 'degraded' || healthRaw === 'error'
        ? healthRaw
        : 'untested';
    return {
      publicRecord: {
        id: str(row, 'id'),
        name: str(row, 'name'),
        kind: str(row, 'kind') as ProviderPresetKind,
        baseUrl: str(row, 'base_url'),
        apiKeys: publicKeys,
        models,
        enabled: num(row, 'enabled', 1) === 1,
        priority: num(row, 'priority', 100),
        healthStatus,
        lastError: nullableStr(row, 'last_error'),
        updatedAt: str(row, 'updated_at'),
      },
      internalKeys: rawKeys,
    };
  }

  listProviders(): ModelProviderRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM v4_model_providers ORDER BY priority ASC, name ASC',
      )
      .all() as SqlRow[];
    return rows.map(r => this.mapProvider(r).publicRecord);
  }

  upsertProvider(input: {
    readonly id?: string;
    readonly name: string;
    readonly kind: ProviderPresetKind;
    readonly baseUrl: string;
    readonly apiKeys?: readonly {
      readonly id?: string;
      readonly label: string;
      readonly rawKey?: string;
      readonly enabled?: boolean;
    }[];
    readonly newApiKey?: string;
    readonly newKeyLabel?: string;
    readonly models?: readonly ProviderModelEntry[];
    readonly enabled?: boolean;
    readonly priority?: number;
  }): ModelProviderRecord {
    const id = input.id?.trim() || `prov-${randomUUID().slice(0, 8)}`;
    const now = nowIso();
    const existing = this.db
      .prepare('SELECT * FROM v4_model_providers WHERE id = ?')
      .get(id) as SqlRow | undefined;
    const existingKeys = existing
      ? parseJson<InternalKeyEntry[]>(str(existing, 'api_keys_json'), [])
      : [];
    const existingKeyById = new Map(existingKeys.map(k => [k.id, k]));

    let nextKeys: InternalKeyEntry[] = existingKeys;
    if (input.apiKeys) {
      nextKeys = input.apiKeys.map(k => {
        const kid = k.id?.trim() || `key-${randomUUID().slice(0, 6)}`;
        const prev = existingKeyById.get(kid);
        const rawKey =
          typeof k.rawKey === 'string' && k.rawKey.trim().length > 0
            ? k.rawKey.trim()
            : (prev?.rawKey ?? '');
        return {
          id: kid,
          label: k.label.trim() || 'API Key',
          rawKey,
          enabled: k.enabled ?? true,
        };
      });
    }
    if (input.newApiKey && input.newApiKey.trim().length > 0) {
      nextKeys = [
        ...nextKeys,
        {
          id: `key-${randomUUID().slice(0, 6)}`,
          label: input.newKeyLabel?.trim() || `Key #${nextKeys.length + 1}`,
          rawKey: input.newApiKey.trim(),
          enabled: true,
        },
      ];
    }

    const models =
      input.models ??
      (existing
        ? parseJson<ProviderModelEntry[]>(str(existing, 'models_json'), [])
        : []);
    const enabled = input.enabled ?? true;
    const priority =
      input.priority ?? (existing ? num(existing, 'priority', 60) : 60);

    if (existing) {
      this.db
        .prepare(
          `UPDATE v4_model_providers
           SET name = ?, kind = ?, base_url = ?, api_keys_json = ?, models_json = ?,
               enabled = ?, priority = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name.trim(),
          input.kind,
          input.baseUrl.trim(),
          JSON.stringify(nextKeys),
          JSON.stringify(models),
          enabled ? 1 : 0,
          priority,
          now,
          id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO v4_model_providers
           (id, name, kind, base_url, api_keys_json, models_json, enabled, priority, health_status, last_error, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'untested', NULL, ?)`,
        )
        .run(
          id,
          input.name.trim(),
          input.kind,
          input.baseUrl.trim(),
          JSON.stringify(nextKeys),
          JSON.stringify(models),
          enabled ? 1 : 0,
          priority,
          now,
        );
    }
    this.publish({type: 'v4.gateway.updated', scope: 'providers'});
    const updated = this.db
      .prepare('SELECT * FROM v4_model_providers WHERE id = ?')
      .get(id) as SqlRow;
    return this.mapProvider(updated).publicRecord;
  }

  deleteProvider(providerId: string): void {
    this.db
      .prepare('DELETE FROM v4_model_providers WHERE id = ?')
      .run(providerId);
    this.publish({type: 'v4.gateway.updated', scope: 'providers'});
  }

  async testProviderConnection(
    providerId: string,
  ): Promise<ModelProviderRecord> {
    const row = this.db
      .prepare('SELECT * FROM v4_model_providers WHERE id = ?')
      .get(providerId) as SqlRow | undefined;
    if (!row) {
      throw new ForgeError(
        'NOT_FOUND',
        `Provider "${providerId}" not found`,
        404,
      );
    }
    const mapped = this.mapProvider(row);
    const provider = mapped.publicRecord;
    const activeKey = mapped.internalKeys.find(
      k => k.enabled && k.rawKey.length > 0,
    );
    const now = nowIso();

    let healthStatus: ModelProviderRecord['healthStatus'] = 'untested';
    let lastError: string | null = null;

    if (provider.kind !== 'ollama' && !activeKey) {
      healthStatus = 'degraded';
      lastError = '尚未配置 API Key，将回退到其他可用路由或本地规则。';
    } else {
      try {
        const base = provider.baseUrl.replace(/\/+$/, '');
        if (provider.kind === 'anthropic') {
          const res = await fetch(`${base}/v1/models`, {
            headers: {
              'x-api-key': activeKey?.rawKey ?? '',
              'anthropic-version': '2023-06-01',
            },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            healthStatus = 'ok';
          } else {
            healthStatus = 'error';
            lastError = `HTTP ${res.status} (${res.statusText})`;
          }
        } else if (provider.kind === 'gemini') {
          const res = await fetch(
            `${base}/models?key=${encodeURIComponent(activeKey?.rawKey ?? '')}`,
            {signal: AbortSignal.timeout(5000)},
          );
          if (res.ok) {
            healthStatus = 'ok';
          } else {
            healthStatus = 'error';
            lastError = `HTTP ${res.status} (${res.statusText})`;
          }
        } else {
          const headers: Record<string, string> = {};
          if (activeKey?.rawKey) {
            headers['Authorization'] = `Bearer ${activeKey.rawKey}`;
          }
          const res = await fetch(`${base}/models`, {
            headers,
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            healthStatus = 'ok';
          } else {
            healthStatus = 'error';
            lastError = `HTTP ${res.status} (${res.statusText})`;
          }
        }
      } catch (err) {
        healthStatus = 'error';
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    this.db
      .prepare(
        `UPDATE v4_model_providers
         SET health_status = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(healthStatus, lastError, now, providerId);
    this.publish({type: 'v4.gateway.updated', scope: 'providers'});
    const updated = this.db
      .prepare('SELECT * FROM v4_model_providers WHERE id = ?')
      .get(providerId) as SqlRow;
    return this.mapProvider(updated).publicRecord;
  }

  listRoutingGroups(): RoutingGroupRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM v4_routing_groups ORDER BY name ASC')
      .all() as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      name: str(r, 'name'),
      strategy: str(r, 'strategy') as RoutingStrategy,
      targets: parseJson<RoutingTarget[]>(str(r, 'targets_json'), []),
      failoverEnabled: num(r, 'failover_enabled', 1) === 1,
      updatedAt: str(r, 'updated_at'),
    }));
  }

  upsertRoutingGroup(input: {
    readonly id?: string;
    readonly name: string;
    readonly strategy: RoutingStrategy;
    readonly targets: readonly RoutingTarget[];
    readonly failoverEnabled?: boolean;
  }): RoutingGroupRecord {
    const id = input.id?.trim() || `grp-${randomUUID().slice(0, 8)}`;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO v4_routing_groups (id, name, strategy, targets_json, failover_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           strategy = excluded.strategy,
           targets_json = excluded.targets_json,
           failover_enabled = excluded.failover_enabled,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.name.trim(),
        input.strategy,
        JSON.stringify(input.targets),
        (input.failoverEnabled ?? true) ? 1 : 0,
        now,
      );
    this.publish({type: 'v4.gateway.updated', scope: 'routing'});
    return this.listRoutingGroups().find(g => g.id === id)!;
  }

  deleteRoutingGroup(groupId: string): void {
    this.db.prepare('DELETE FROM v4_routing_groups WHERE id = ?').run(groupId);
    this.publish({type: 'v4.gateway.updated', scope: 'routing'});
  }

  listProfiles(): ModelProfileRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM v4_model_profiles ORDER BY active DESC, name ASC')
      .all() as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      name: str(r, 'name'),
      description: str(r, 'description'),
      bindings: parseJson(str(r, 'bindings_json'), {}),
      active: num(r, 'active', 0) === 1,
      updatedAt: str(r, 'updated_at'),
    }));
  }

  activateProfile(profileId: string): GatewaySnapshot {
    const profile = this.listProfiles().find(p => p.id === profileId);
    if (!profile) {
      throw new ForgeError(
        'NOT_FOUND',
        `Profile "${profileId}" not found`,
        404,
      );
    }
    const now = nowIso();
    this.db.prepare('UPDATE v4_model_profiles SET active = 0').run();
    this.db
      .prepare(
        'UPDATE v4_model_profiles SET active = 1, updated_at = ? WHERE id = ?',
      )
      .run(now, profileId);

    for (const [handle, binding] of Object.entries(profile.bindings)) {
      this.db
        .prepare(
          `UPDATE v4_agent_roster
           SET binding_kind = ?, provider_id = ?, model_id = ?, routing_group_id = ?, harness_id = ?, updated_at = ?
           WHERE handle = ?`,
        )
        .run(
          binding.bindingKind,
          binding.providerId ?? null,
          binding.modelId ?? null,
          binding.routingGroupId ?? null,
          binding.harnessId ?? null,
          now,
          handle,
        );
    }
    this.publish({type: 'v4.gateway.updated', scope: 'profiles'});
    return this.getSnapshot();
  }

  listAgents(): AgentPersonaRecord[] {
    const providers = new Map(this.listProviders().map(p => [p.id, p]));
    const groups = new Map(this.listRoutingGroups().map(g => [g.id, g]));
    const rows = this.db
      .prepare('SELECT * FROM v4_agent_roster ORDER BY id ASC')
      .all() as SqlRow[];

    return rows.map(r => {
      const bindingKind = str(r, 'binding_kind') as AgentBindingKind;
      const providerId = nullableStr(r, 'provider_id');
      const modelId = nullableStr(r, 'model_id');
      const routingGroupId = nullableStr(r, 'routing_group_id');
      const harnessId = nullableStr(r, 'harness_id') as KernelId | null;

      let resolvedModelLabel = '本地规则引擎 (未配置密钥)';
      if (bindingKind === 'cli_harness' && harnessId) {
        resolvedModelLabel = `CLI: ${harnessId}`;
      } else if (bindingKind === 'routing_group' && routingGroupId) {
        const g = groups.get(routingGroupId);
        const firstTarget = g?.targets[0];
        const hasConfiguredKey = g?.targets.some(t => {
          const p = providers.get(t.providerId);
          return p && (p.kind === 'ollama' || p.apiKeys.some(k => k.enabled));
        });
        resolvedModelLabel = g
          ? hasConfiguredKey
            ? `${g.name} (${firstTarget?.modelId ?? g.strategy})`
            : `${g.name} · 本地引擎回退`
          : '未绑定路由组';
      } else if (providerId && modelId) {
        const p = providers.get(providerId);
        const hasKey =
          p && (p.kind === 'ollama' || p.apiKeys.some(k => k.enabled));
        resolvedModelLabel = p
          ? hasKey
            ? `${p.name} / ${modelId}`
            : `${modelId} (未配密钥·本地回退)`
          : modelId;
      }

      return {
        id: str(r, 'id'),
        displayName: str(r, 'display_name'),
        handle: str(r, 'handle'),
        roleKey: str(r, 'role_key') as AgentRoleKey,
        avatarKey: str(r, 'avatar_key'),
        accentColor: str(r, 'accent_color'),
        bindingKind,
        providerId,
        modelId,
        routingGroupId,
        harnessId,
        systemPrompt: str(r, 'system_prompt'),
        resolvedModelLabel,
        enabled: num(r, 'enabled', 1) === 1,
        updatedAt: str(r, 'updated_at'),
      };
    });
  }

  updateAgentBinding(
    agentId: string,
    patch: {
      readonly displayName?: string;
      readonly bindingKind?: AgentBindingKind;
      readonly providerId?: string | null;
      readonly modelId?: string | null;
      readonly routingGroupId?: string | null;
      readonly harnessId?: KernelId | null;
      readonly systemPrompt?: string;
      readonly enabled?: boolean;
    },
  ): AgentPersonaRecord {
    const existing = this.db
      .prepare('SELECT * FROM v4_agent_roster WHERE id = ?')
      .get(agentId) as SqlRow | undefined;
    if (!existing) {
      throw new ForgeError('NOT_FOUND', `Agent "${agentId}" not found`, 404);
    }
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE v4_agent_roster
         SET display_name = ?, binding_kind = ?, provider_id = ?, model_id = ?,
             routing_group_id = ?, harness_id = ?, system_prompt = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.displayName?.trim() || str(existing, 'display_name'),
        patch.bindingKind ?? str(existing, 'binding_kind'),
        patch.providerId !== undefined
          ? patch.providerId
          : nullableStr(existing, 'provider_id'),
        patch.modelId !== undefined
          ? patch.modelId
          : nullableStr(existing, 'model_id'),
        patch.routingGroupId !== undefined
          ? patch.routingGroupId
          : nullableStr(existing, 'routing_group_id'),
        patch.harnessId !== undefined
          ? patch.harnessId
          : nullableStr(existing, 'harness_id'),
        patch.systemPrompt !== undefined
          ? patch.systemPrompt
          : str(existing, 'system_prompt'),
        patch.enabled !== undefined
          ? patch.enabled
            ? 1
            : 0
          : num(existing, 'enabled', 1),
        now,
        agentId,
      );
    this.publish({type: 'v4.gateway.updated', scope: 'agents'});
    return this.listAgents().find(a => a.id === agentId)!;
  }

  listConnectors(): ExternalConnectorRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM v4_connectors ORDER BY id ASC')
      .all() as SqlRow[];
    return rows.map(r => {
      const statusRaw = str(r, 'status');
      const status: ExternalConnectorRecord['status'] =
        statusRaw === 'configured' || statusRaw === 'synced'
          ? statusRaw
          : 'disconnected';
      return {
        id: str(r, 'id'),
        kind: str(r, 'kind') as ConnectorKind,
        displayName: str(r, 'display_name'),
        enabled: num(r, 'enabled', 0) === 1,
        config: parseJson<Record<string, string>>(str(r, 'config_json'), {}),
        status,
        lastSyncAt: nullableStr(r, 'last_sync_at'),
        updatedAt: str(r, 'updated_at'),
      };
    });
  }

  updateConnector(
    connectorId: string,
    patch: {
      readonly enabled?: boolean;
      readonly config?: Readonly<Record<string, string>>;
    },
  ): ExternalConnectorRecord {
    const existing = this.db
      .prepare('SELECT * FROM v4_connectors WHERE id = ?')
      .get(connectorId) as SqlRow | undefined;
    if (!existing) {
      throw new ForgeError(
        'NOT_FOUND',
        `Connector "${connectorId}" not found`,
        404,
      );
    }
    const prevCfg = parseJson<Record<string, string>>(
      str(existing, 'config_json'),
      {},
    );
    const nextCfg = patch.config ? {...prevCfg, ...patch.config} : prevCfg;
    const enabled =
      patch.enabled !== undefined
        ? patch.enabled
        : num(existing, 'enabled', 0) === 1;
    const hasValues = Object.values(nextCfg).some(v => v.trim().length > 0);
    const status = enabled
      ? hasValues
        ? 'configured'
        : 'disconnected'
      : 'disconnected';
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE v4_connectors
         SET enabled = ?, config_json = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, JSON.stringify(nextCfg), status, now, connectorId);
    this.publish({type: 'v4.gateway.updated', scope: 'connectors'});
    return this.listConnectors().find(c => c.id === connectorId)!;
  }

  getPrivacyMasking(): PrivacyMaskingConfig {
    const row = this.db
      .prepare(
        "SELECT value_json FROM v4_settings_kv WHERE key = 'privacy_masking'",
      )
      .get() as SqlRow | undefined;
    if (!row) return DEFAULT_PRIVACY_CONFIG;
    return {
      ...DEFAULT_PRIVACY_CONFIG,
      ...parseJson<Partial<PrivacyMaskingConfig>>(str(row, 'value_json'), {}),
    };
  }

  updatePrivacyMasking(
    patch: Partial<PrivacyMaskingConfig>,
  ): PrivacyMaskingConfig {
    const next = {...this.getPrivacyMasking(), ...patch};
    this.db
      .prepare(
        `INSERT INTO v4_settings_kv (key, value_json, updated_at)
         VALUES ('privacy_masking', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(next), nowIso());
    this.publish({type: 'v4.gateway.updated', scope: 'providers'});
    return next;
  }

  getSnapshot(): GatewaySnapshot {
    return {
      providers: this.listProviders(),
      routingGroups: this.listRoutingGroups(),
      profiles: this.listProfiles(),
      agents: this.listAgents(),
      connectors: this.listConnectors(),
      privacyMasking: this.getPrivacyMasking(),
    };
  }

  private resolveOrderedTargets(
    agent: AgentPersonaRecord,
    contextChars: number,
  ): readonly {
    readonly providerId: string;
    readonly modelId: string;
  }[] {
    if (agent.bindingKind === 'routing_group' && agent.routingGroupId) {
      const group = this.listRoutingGroups().find(
        g => g.id === agent.routingGroupId,
      );
      if (group && group.targets.length > 0) {
        const targets = [...group.targets];
        if (group.strategy === 'rotate') {
          const offset = this.rotateCursor % targets.length;
          this.rotateCursor += 1;
          return [...targets.slice(offset), ...targets.slice(0, offset)];
        }
        if (group.strategy === 'context-tiered') {
          const estimatedK = Math.ceil(contextChars / 3200);
          targets.sort((a, b) => {
            const aFits = (a.maxContextK ?? 128) >= estimatedK ? 0 : 1;
            const bFits = (b.maxContextK ?? 128) >= estimatedK ? 0 : 1;
            if (aFits !== bFits) return aFits - bFits;
            return (a.maxContextK ?? 128) - (b.maxContextK ?? 128);
          });
        }
        return targets;
      }
    }
    if (agent.providerId && agent.modelId) {
      return [{providerId: agent.providerId, modelId: agent.modelId}];
    }
    return [];
  }

  /**
   * Executes a real model invocation using the agent's bound Provider/RoutingGroup
   * or Local CLI harness. Returns `mode: 'local-deterministic'` cleanly without
   * masquerading as a live external model when no key or CLI is configured.
   */
  async invokeAgentModel(input: {
    readonly agentId: string;
    readonly userPrompt: string;
    readonly systemPrompt?: string;
    readonly allowCli?: boolean;
  }): Promise<ModelInvocationResult> {
    const agent =
      this.listAgents().find(
        a => a.id === input.agentId || a.handle === input.agentId,
      ) ?? this.listAgents()[0];
    if (!agent) {
      return {
        mode: 'local-deterministic',
        modelLabel: '本地规则引擎 (未配置角色)',
        providerName: null,
        text: null,
      };
    }

    const privacy = this.getPrivacyMasking();
    const {maskedText, tokenMap} = applyPrivacyMask(input.userPrompt, privacy);
    const systemPrompt = input.systemPrompt || agent.systemPrompt;

    // 1. Try local CLI harness if bound and allowed
    if (
      agent.bindingKind === 'cli_harness' &&
      agent.harnessId &&
      input.allowCli
    ) {
      const cliCmd =
        agent.harnessId === 'claude-code'
          ? 'claude'
          : agent.harnessId === 'gemini-cli'
            ? 'gemini'
            : agent.harnessId;
      const resolved = this.runner.resolveExecutable(cliCmd);
      if (resolved) {
        try {
          const res = await this.runner.run({
            executable: cliCmd,
            args:
              cliCmd === 'codex' ? ['exec', maskedText] : ['-p', maskedText],
            cwd: process.cwd(),
            timeoutMs: 20_000,
          });
          if (!res.timedOut && res.exitCode === 0 && res.stdout.trim()) {
            return {
              mode: 'live-cli',
              modelLabel: `CLI: ${agent.harnessId}`,
              providerName: agent.harnessId,
              text: restorePrivacyMask(res.stdout.trim(), tokenMap),
            };
          }
        } catch {
          // Fall through cleanly to API failover or deterministic fallback.
        }
      }
    }

    // 2. Try HTTP API providers with Magpie-style key/group failover
    const targets = this.resolveOrderedTargets(agent, maskedText.length);
    const allProviderRows = this.db
      .prepare('SELECT * FROM v4_model_providers WHERE enabled = 1')
      .all() as SqlRow[];
    const providerMap = new Map(
      allProviderRows.map(r => {
        const mapped = this.mapProvider(r);
        return [mapped.publicRecord.id, mapped] as const;
      }),
    );

    let lastError: string | undefined;
    for (const target of targets) {
      const pEntry = providerMap.get(target.providerId);
      if (!pEntry) continue;
      const provider = pEntry.publicRecord;
      const candidateKeys =
        provider.kind === 'ollama'
          ? [{id: 'local', label: 'local', rawKey: 'ollama', enabled: true}]
          : pEntry.internalKeys.filter(
              k => k.enabled && !k.quotaExhausted && k.rawKey.length > 0,
            );
      if (candidateKeys.length === 0) continue;

      for (const keyEntry of candidateKeys) {
        try {
          const text = await this.callProviderHttp(
            provider,
            target.modelId,
            keyEntry.rawKey,
            systemPrompt,
            maskedText,
          );
          if (text) {
            return {
              mode: 'live-api',
              modelLabel: `${provider.name} / ${target.modelId}`,
              providerName: provider.name,
              text: restorePrivacyMask(text, tokenMap),
            };
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    return {
      mode: 'local-deterministic',
      modelLabel: '本地规则引擎 (未配置外部密钥)',
      providerName: null,
      text: null,
      error: lastError,
    };
  }

  private async callProviderHttp(
    provider: ModelProviderRecord,
    modelId: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string | null> {
    const base = provider.baseUrl.replace(/\/+$/, '');
    if (provider.kind === 'anthropic') {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1200,
          system: systemPrompt,
          messages: [{role: 'user', content: userPrompt}],
        }),
        signal: AbortSignal.timeout(18_000),
      });
      if (!res.ok) {
        throw new Error(`Anthropic HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        readonly content?: readonly {readonly text?: string}[];
      };
      return data.content?.map(c => c.text ?? '').join('') || null;
    }

    if (provider.kind === 'gemini') {
      const res = await fetch(
        `${base}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            systemInstruction: {parts: [{text: systemPrompt}]},
            contents: [{role: 'user', parts: [{text: userPrompt}]}],
          }),
          signal: AbortSignal.timeout(18_000),
        },
      );
      if (!res.ok) {
        throw new Error(`Gemini HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        readonly candidates?: readonly {
          readonly content?: {
            readonly parts?: readonly {readonly text?: string}[];
          };
        }[];
      };
      return (
        data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ||
        null
      );
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && apiKey !== 'ollama'
          ? {Authorization: `Bearer ${apiKey}`}
          : {}),
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0.3,
        max_tokens: 1200,
        messages: [
          {role: 'system', content: systemPrompt},
          {role: 'user', content: userPrompt},
        ],
      }),
      signal: AbortSignal.timeout(18_000),
    });
    if (!res.ok) {
      throw new Error(`${provider.name} HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      readonly choices?: readonly {
        readonly message?: {readonly content?: string};
      }[];
    };
    return data.choices?.[0]?.message?.content?.trim() || null;
  }
}

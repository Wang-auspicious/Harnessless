/**
 * SQLite WAL schema (SCHEMA_VERSION = 1) with FTS5 full-text indexes and
 * enterprise default seed catalog for ForgeOps.
 */

import type {
  AgentAdapterManifest,
  DaemonStatus,
  ModelProviderConfig,
  SkillEntry,
  SoulConstitution,
} from '../shared/types.ts';

export const SCHEMA_VERSION = 1;

export const INITIAL_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta_kv (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  description TEXT NOT NULL,
  agent_wiki_summary TEXT NOT NULL DEFAULT '',
  permission_tier TEXT NOT NULL DEFAULT 'turbo',
  last_human_interaction_at TEXT NOT NULL,
  spaced_review_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'service',
  local_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  verify_command TEXT NOT NULL,
  contract_summary TEXT NOT NULL DEFAULT '',
  bounded_context TEXT NOT NULL DEFAULT 'Core',
  last_human_interaction_at TEXT NOT NULL,
  spaced_review_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_terms (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  bounded_context TEXT NOT NULL,
  owning_repo_ids_json TEXT NOT NULL DEFAULT '[]',
  canonical_term TEXT NOT NULL,
  local_label TEXT NOT NULL,
  definition TEXT NOT NULL,
  forbidden_aliases_json TEXT NOT NULL DEFAULT '[]',
  schema_anchors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  cross_repo_epic_id TEXT,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  spec_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  permission_tier TEXT NOT NULL DEFAULT 'turbo',
  worktree_path TEXT NOT NULL DEFAULT '',
  git_branch TEXT NOT NULL DEFAULT '',
  base_commit_sha TEXT NOT NULL DEFAULT '',
  verify_command TEXT NOT NULL,
  acceptance_json TEXT NOT NULL DEFAULT '[]',
  team_json TEXT NOT NULL,
  quality_score REAL NOT NULL DEFAULT 0,
  budget_usd_limit REAL NOT NULL DEFAULT 25,
  spent_usd REAL NOT NULL DEFAULT 0,
  max_overnight_hours REAL NOT NULL DEFAULT 8,
  premature_stop_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  parent_wbs_id TEXT,
  container_node_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  file_scope_json TEXT NOT NULL DEFAULT '[]',
  gate_command TEXT,
  assigned_role TEXT NOT NULL,
  assigned_adapter_id TEXT,
  assigned_model TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  collapsed INTEGER NOT NULL DEFAULT 0,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 220,
  height REAL NOT NULL DEFAULT 76,
  output_summary TEXT NOT NULL DEFAULT '',
  restore_target_checkpoint_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_change ON graph_nodes(change_id);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_change ON graph_edges(change_id);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  label TEXT NOT NULL,
  git_commit_sha TEXT NOT NULL,
  git_tag TEXT NOT NULL,
  rescue_ref TEXT,
  certified_task_count INTEGER NOT NULL DEFAULT 0,
  total_task_count INTEGER NOT NULL DEFAULT 0,
  engine_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attention_queue (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  repo_id TEXT,
  change_id TEXT,
  node_id TEXT,
  thread_id TEXT,
  kind TEXT NOT NULL,
  question TEXT NOT NULL,
  context_snippet TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]',
  recommended_index INTEGER NOT NULL DEFAULT 0,
  downstream_blocked_count INTEGER NOT NULL DEFAULT 1,
  estimated_read_seconds INTEGER NOT NULL DEFAULT 25,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scenario TEXT NOT NULL,
  topic TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  change_id TEXT,
  title TEXT NOT NULL,
  mandate_scope TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  subscribed_agents_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  thread_id TEXT,
  author_kind TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_label TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  body_markdown TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_messages_room ON room_messages(room_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  change_id TEXT,
  node_id TEXT,
  adapter_id TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  id UNINDEXED,
  session_id UNINDEXED,
  content,
  content=messages,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, id, session_id, content)
  VALUES (new.rowid, new.id, new.session_id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, id, session_id, content)
  VALUES ('delete', old.rowid, old.id, old.session_id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, id, session_id, content)
  VALUES ('delete', old.rowid, old.id, old.session_id, old.content);
  INSERT INTO messages_fts(rowid, id, session_id, content)
  VALUES (new.rowid, new.id, new.session_id, new.content);
END;

CREATE TABLE IF NOT EXISTS semantic_memories (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  repo_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  path_anchors_json TEXT NOT NULL DEFAULT '[]',
  source_session_id TEXT,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  superseded_by_id TEXT,
  stability_hours REAL NOT NULL DEFAULT 24,
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_at TEXT NOT NULL,
  stale_suspect INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  title,
  summary,
  content=semantic_memories,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON semantic_memories BEGIN
  INSERT INTO memories_fts(rowid, id, title, summary)
  VALUES (new.rowid, new.id, new.title, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON semantic_memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, id, title, summary)
  VALUES ('delete', old.rowid, old.id, old.title, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON semantic_memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, id, title, summary)
  VALUES ('delete', old.rowid, old.id, old.title, old.summary);
  INSERT INTO memories_fts(rowid, id, title, summary)
  VALUES (new.rowid, new.id, new.title, new.summary);
END;

CREATE TABLE IF NOT EXISTS execution_telemetry (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  change_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL,
  outcome TEXT NOT NULL,
  first_pass_certified INTEGER NOT NULL DEFAULT 0,
  premature_stop_triggered INTEGER NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  first_turn_cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  diagnostic TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_adapter ON execution_telemetry(adapter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS adapters (
  id TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  probe_ok INTEGER,
  probe_message TEXT NOT NULL DEFAULT 'Not probed yet',
  probed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  models_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills_bank (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  version TEXT NOT NULL,
  prompt_body TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS effects_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  dedupe_key TEXT UNIQUE NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_due_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_ledger (
  id TEXT PRIMARY KEY,
  hub_id TEXT,
  change_id TEXT,
  category TEXT NOT NULL,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export const DEFAULT_CONSTITUTION: SoulConstitution = {
  version: 1,
  title: 'ForgeOps Enterprise Engineering Soul Constitution',
  markdown: [
    '# ForgeOps Constitutional Mandates',
    '1. **Human Attention Conservation:** Surface only actionable decisions (1 structured question at a time) or review-ready deliverables.',
    '2. **DDD Ubiquitous Language:** Strictly use canonical identifiers registered in the Bounded Context glossary; never introduce forbidden synonyms.',
    '3. **Zero Self-Grading:** Task slices complete only when deterministic Hard Gates (`exitCode === 0`) and independent QA Audits pass.',
    '4. **Worktree Isolation & Safe Checkpoints:** All mutations stay inside the assigned `git worktree`; create rescue refs prior to any checkpoint rewind.',
    '5. **Governed Infra Plane:** Shared skills, wiki topology maps, and global templates are modified exclusively via audited Infra Steward workflows.',
  ].join('\n'),
  blockedCommands: [
    'git push --force',
    'git reset --hard origin',
    'rm -rf /',
    'curl | sh',
  ],
  updatedBy: 'Infra Steward (Bootstrap)',
  updatedAt: '2026-11-11T00:00:00.000Z',
};

export const BUILTIN_ADAPTER_MANIFESTS: readonly AgentAdapterManifest[] = [
  {
    id: 'codex',
    label: 'Codex CLI',
    specialty: 'Architecture Decomposition & High-Precision Implementation',
    sovereignSoul:
      'Methodical staff engineer: enforce type invariants, minimal diff blast radius, and Ubiquitous Language alignment.',
    transport: 'cli-stream',
    command: 'codex',
    baseArgs: ['exec', '--json'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'codex-flag',
    jsonlParser: 'codex-rpc',
    permissionFlags: {
      turbo: ['--full-auto'],
      supervised: ['--full-auto'],
      strict: [],
    },
    envAllowlist: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
    defaultModel: 'gpt-5-codex',
    supportedRoles: ['lead', 'worker', 'evaluator', 'specialist'],
    maxConcurrentSlots: 3,
    builtIn: true,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    specialty: 'Cross-Repo Requirement Grill, DDD Modeling & Senior QA',
    sovereignSoul:
      'Principal software architect: challenge hidden edge cases, preserve domain invariants, and audit strictly against spec.',
    transport: 'cli-stream',
    command: 'claude',
    baseArgs: ['-p', '--output-format', 'stream-json', '--verbose'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'claude-mcp-json',
    jsonlParser: 'claude-stream',
    permissionFlags: {
      turbo: ['--dangerously-skip-permissions'],
      supervised: [],
      strict: [],
    },
    envAllowlist: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
    defaultModel: 'claude-sonnet-4-5',
    supportedRoles: [
      'lead',
      'worker',
      'evaluator',
      'moderator',
      'infra_steward',
    ],
    maxConcurrentSlots: 3,
    builtIn: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode CLI',
    specialty: 'Fast Milestone Execution & Multi-Provider Routing',
    sovereignSoul:
      'Focused milestone builder: implement task slices cleanly and verify every gate before submitting.',
    transport: 'cli-stream',
    command: 'opencode',
    baseArgs: ['run', '--format', 'json'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'env-url',
    jsonlParser: 'opencode-json',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY'],
    defaultModel: 'deepseek-chat',
    supportedRoles: ['worker', 'specialist'],
    maxConcurrentSlots: 4,
    builtIn: true,
  },
  {
    id: 'pi',
    label: 'Pi Coding Harness',
    specialty: 'High-Efficiency Lean Token Slice Execution',
    sovereignSoul:
      'Ultra-lean pragmatic coder: zero boilerplate, minimal token footprint, strict adherence to contract.',
    transport: 'cli-stream',
    command: 'pi',
    baseArgs: ['--mode', 'json', '-p'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'env-url',
    jsonlParser: 'pi-json',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY'],
    defaultModel: 'deepseek-v3',
    supportedRoles: ['worker', 'specialist'],
    maxConcurrentSlots: 4,
    builtIn: true,
  },
  {
    id: 'kimi-acp',
    label: 'Kimi Code (ACP)',
    specialty: 'Long-Context Multi-File Synthesis via Standard ACP',
    sovereignSoul:
      'Cross-module specialist running over JSON-RPC 2.0 ACP stdio with full MCP contract integration.',
    transport: 'acp-stdio',
    command: 'kimi',
    baseArgs: ['acp'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'acp-session',
    jsonlParser: 'none',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    defaultModel: 'kimi-k2',
    supportedRoles: ['worker', 'lead', 'specialist'],
    maxConcurrentSlots: 3,
    builtIn: true,
  },
  {
    id: 'hermes-acp',
    label: 'Hermes Agent (ACP)',
    specialty: 'Autonomous Tool-Rich Engineering & Infra Diagnostics',
    sovereignSoul:
      'Systems & DevOps specialist operating over standard ACP stdio.',
    transport: 'acp-stdio',
    command: 'hermes',
    baseArgs: ['acp'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'acp-session',
    jsonlParser: 'none',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: ['OPENAI_API_KEY', 'OPENROUTER_API_KEY'],
    defaultModel: 'hermes-default',
    supportedRoles: ['worker', 'infra_steward', 'specialist'],
    maxConcurrentSlots: 2,
    builtIn: true,
  },
  {
    id: 'workbuddy',
    label: 'WorkBuddy CLI',
    specialty: 'Collaborative Enterprise Task Delivery',
    sovereignSoul:
      'Enterprise engineering teammate aligned with repository standards and DDD conventions.',
    transport: 'cli-stream',
    command: 'workbuddy',
    baseArgs: ['run', '--json'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'env-url',
    jsonlParser: 'generic-jsonl',
    permissionFlags: {turbo: ['--yes'], supervised: [], strict: []},
    envAllowlist: ['WORKBUDDY_TOKEN', 'OPENAI_API_KEY'],
    defaultModel: 'workbuddy-pro',
    supportedRoles: ['worker', 'specialist'],
    maxConcurrentSlots: 3,
    builtIn: true,
  },
  {
    id: 'native-api',
    label: 'ForgeOps Native API Runner',
    specialty: 'Zero-CLI Direct Commercial API Tool-Loop & Infra Steward',
    sovereignSoul:
      'Built-in deterministic workspace agent with path-confined file/git tools and fail-closed QA evaluation.',
    transport: 'native-api',
    command: 'builtin-api',
    baseArgs: [],
    healthProbeArgs: [],
    mcpInjection: 'none',
    jsonlParser: 'none',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: [],
    defaultModel: 'deepseek-chat',
    supportedRoles: [
      'lead',
      'worker',
      'evaluator',
      'moderator',
      'infra_steward',
      'specialist',
    ],
    maxConcurrentSlots: 6,
    builtIn: true,
  },
];

export const DEFAULT_MODEL_PROVIDERS: readonly Omit<
  ModelProviderConfig,
  'hasApiKey' | 'maskedKeyHint' | 'updatedAt'
>[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek Official',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek R1 / Reasoner (Strong Lead)',
        tier: 'strong',
        inputUsdPerMillion: 0.55,
        cachedInputUsdPerMillion: 0.14,
        outputUsdPerMillion: 2.19,
        contextWindowTokens: 128_000,
      },
      {
        id: 'deepseek-chat',
        label: 'DeepSeek V3 (Fast Worker)',
        tier: 'fast',
        inputUsdPerMillion: 0.27,
        cachedInputUsdPerMillion: 0.07,
        outputUsdPerMillion: 1.1,
        contextWindowTokens: 128_000,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI / Compatible Gateway',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: 'gpt-5',
        label: 'GPT-5 (Strong Lead / Architect)',
        tier: 'strong',
        inputUsdPerMillion: 2.5,
        cachedInputUsdPerMillion: 0.625,
        outputUsdPerMillion: 10,
        contextWindowTokens: 256_000,
      },
      {
        id: 'gpt-5-mini',
        label: 'GPT-5 Mini (Fast Milestone Worker)',
        tier: 'fast',
        inputUsdPerMillion: 0.3,
        cachedInputUsdPerMillion: 0.075,
        outputUsdPerMillion: 1.2,
        contextWindowTokens: 256_000,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Messages',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      {
        id: 'claude-opus-4-6',
        label: 'Claude Opus (Principal Architect / SQA)',
        tier: 'strong',
        inputUsdPerMillion: 5,
        cachedInputUsdPerMillion: 0.5,
        outputUsdPerMillion: 25,
        contextWindowTokens: 200_000,
      },
      {
        id: 'claude-sonnet-4-5',
        label: 'Claude Sonnet (Balanced Lead & Dev)',
        tier: 'strong',
        inputUsdPerMillion: 3,
        cachedInputUsdPerMillion: 0.3,
        outputUsdPerMillion: 15,
        contextWindowTokens: 200_000,
      },
    ],
  },
];

export const DEFAULT_SKILLS_BANK: readonly Omit<SkillEntry, 'updatedAt'>[] = [
  {
    id: 'skill-grill-with-docs',
    slug: 'grill-with-docs',
    title: 'Hub-Level Requirement Grill with Cross-Repo Docs',
    category: 'grill',
    version: '2.1.0',
    promptBody:
      'Stress-test the feature request against the Federation Hub topology map and DDD Ubiquitous Language. Identify missing invariants, cross-service contract impacts, and ask at most ONE concrete multiple-choice question if human intent is ambiguous.',
    updatedBy: 'Infra Steward',
  },
  {
    id: 'skill-ddd-ubiquitous',
    slug: 'ddd-ubiquitous-modeler',
    title: 'DDD Bounded Context & Ubiquitous Language Enforcer',
    category: 'ddd',
    version: '2.1.0',
    promptBody:
      'Map every domain entity, command, and event to its owning Bounded Context. Enforce canonical code identifiers and eliminate forbidden synonyms across API DTOs, DB schemas, and UI labels.',
    updatedBy: 'Infra Steward',
  },
  {
    id: 'skill-cross-repo-plan',
    slug: 'cross-repo-planner',
    title: 'Multi-Repo Twin-Graph & Contract Sequencer',
    category: 'architecture',
    version: '2.1.0',
    promptBody:
      'Order changes upstream-first (shared schemas/contracts -> backend services -> consumer portals). Partition each repository change into 10-25 minute verifiable WBS task slices.',
    updatedBy: 'Infra Steward',
  },
  {
    id: 'skill-retro-pruner',
    slug: 'retro-wiki-pruner',
    title: 'Post-Change Retro & Agent-Wiki Context Optimizer',
    category: 'retro',
    version: '2.1.0',
    promptBody:
      'Inspect completed execution transcripts for redundant explorer turns or repeated gate failures. Prune verbose prose and update concise service entrypoints and pitfalls in docs/agent-wiki.',
    updatedBy: 'Infra Steward',
  },
];

export const DEFAULT_DAEMONS: readonly DaemonStatus[] = [
  {
    id: 'continuity_watchdog',
    label: '8h Continuity & Quota Watchdog',
    enabled: true,
    runningPass: false,
    intervalSeconds: 10,
    lastRunAt: null,
    lastSummary: 'Armed: monitoring active Changes and premature-stop guards.',
  },
  {
    id: 'dreaming_consolidator',
    label: 'Sleep-Time Cognitive Consolidator (DreamingDaemon)',
    enabled: true,
    runningPass: false,
    intervalSeconds: 60,
    lastRunAt: null,
    lastSummary:
      'Idle: ready to distill pitfall memories & Ebbinghaus capsules.',
  },
  {
    id: 'infra_patrol',
    label: 'Infra Steward Environment & Worktree Patrol',
    enabled: true,
    runningPass: false,
    intervalSeconds: 120,
    lastRunAt: null,
    lastSummary: 'Monitoring harness readiness and worktree hygiene.',
  },
];

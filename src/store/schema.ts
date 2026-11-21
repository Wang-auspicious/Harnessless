import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {ForgeError} from '../shared/errors.ts';
import type {
  AgentAdapterManifest,
  DaemonStatus,
  ModelProviderConfig,
  SkillEntry,
  SoulConstitution,
} from '../shared/types.ts';

export const SCHEMA_VERSION = 4;

export const BASE_PRAGMAS_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

const V3_NEW_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS change_epistemic_items (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  node_id TEXT,
  execution_epoch INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  evidence_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_epistemic_change ON change_epistemic_items(change_id, execution_epoch);
CREATE TRIGGER IF NOT EXISTS change_epistemic_items_no_update BEFORE UPDATE ON change_epistemic_items
BEGIN SELECT RAISE(ABORT, 'change_epistemic_items is immutable'); END;
CREATE TRIGGER IF NOT EXISTS change_epistemic_items_no_delete BEFORE DELETE ON change_epistemic_items
BEGIN SELECT RAISE(ABORT, 'change_epistemic_items is immutable'); END;

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  raw_intent TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  triage_track TEXT NOT NULL,
  triage_rationale TEXT NOT NULL DEFAULT '',
  preset TEXT NOT NULL,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  version INTEGER NOT NULL DEFAULT 1,
  execution_epoch INTEGER NOT NULL DEFAULT 1,
  active_baseline_id TEXT,
  parent_baseline_id TEXT,
  budget_usd_limit REAL NOT NULL DEFAULT 25,
  spent_usd REAL NOT NULL DEFAULT 0,
  max_overnight_hours REAL NOT NULL DEFAULT 8,
  config_overrides_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_missions_hub ON missions(hub_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mission_gates (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  change_id TEXT,
  node_id TEXT,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  target_revision INTEGER NOT NULL DEFAULT 1,
  question TEXT NOT NULL,
  context_snippet TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mission_gates_open ON mission_gates(mission_id, status, created_at ASC);

CREATE TABLE IF NOT EXISTS mission_decisions (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL REFERENCES mission_gates(id) ON DELETE RESTRICT,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  feedback TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'proposal',
  issue_ids_json TEXT NOT NULL DEFAULT '[]',
  response_json TEXT NOT NULL DEFAULT '{}',
  decided_at TEXT NOT NULL,
  UNIQUE(mission_id, idempotency_key)
);
CREATE TRIGGER IF NOT EXISTS mission_decisions_no_update BEFORE UPDATE ON mission_decisions
BEGIN SELECT RAISE(ABORT, 'mission_decisions is immutable'); END;
CREATE TRIGGER IF NOT EXISTS mission_decisions_no_delete BEFORE DELETE ON mission_decisions
BEGIN SELECT RAISE(ABORT, 'mission_decisions is immutable'); END;

CREATE TABLE IF NOT EXISTS mission_events (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(mission_id, seq)
);
CREATE TRIGGER IF NOT EXISTS mission_events_no_update BEFORE UPDATE ON mission_events
BEGIN SELECT RAISE(ABORT, 'mission_events is immutable'); END;
CREATE TRIGGER IF NOT EXISTS mission_events_no_delete BEFORE DELETE ON mission_events
BEGIN SELECT RAISE(ABORT, 'mission_events is immutable'); END;

CREATE TABLE IF NOT EXISTS hama_runs (
  mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  input_json TEXT NOT NULL,
  stage TEXT NOT NULL,
  proposal_rework_count INTEGER NOT NULL DEFAULT 0,
  prd_local_edit_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hama_artifacts (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES hama_runs(mission_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL,
  hash TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(mission_id, kind, subject, revision)
);
CREATE TRIGGER IF NOT EXISTS hama_artifacts_no_update BEFORE UPDATE ON hama_artifacts
BEGIN SELECT RAISE(ABORT, 'hama_artifacts is immutable'); END;
CREATE TRIGGER IF NOT EXISTS hama_artifacts_no_delete BEFORE DELETE ON hama_artifacts
BEGIN SELECT RAISE(ABORT, 'hama_artifacts is immutable'); END;

CREATE TABLE IF NOT EXISTS hama_comments (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES hama_runs(mission_id) ON DELETE RESTRICT,
  scope_key TEXT NOT NULL,
  paragraph_ref TEXT NOT NULL DEFAULT '',
  author_kind TEXT NOT NULL,
  author_label TEXT NOT NULL,
  severity TEXT NOT NULL,
  body TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT NOT NULL DEFAULT '',
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hama_comments_mission ON hama_comments(mission_id, disposition, severity);

CREATE TABLE IF NOT EXISTS approved_baselines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  revision INTEGER NOT NULL,
  parent_id TEXT,
  mission_id TEXT UNIQUE NOT NULL REFERENCES hama_runs(mission_id) ON DELETE RESTRICT,
  prd_artifact_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, mode, revision)
);
CREATE TRIGGER IF NOT EXISTS approved_baselines_no_update BEFORE UPDATE ON approved_baselines
BEGIN SELECT RAISE(ABORT, 'approved_baselines is immutable'); END;
CREATE TRIGGER IF NOT EXISTS approved_baselines_no_delete BEFORE DELETE ON approved_baselines
BEGIN SELECT RAISE(ABORT, 'approved_baselines is immutable'); END;

CREATE TABLE IF NOT EXISTS memory_documents (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE RESTRICT,
  repo_id TEXT,
  mission_id TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  source_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(hub_id, execution_mode, content_sha256)
);
CREATE TRIGGER IF NOT EXISTS memory_documents_no_update BEFORE UPDATE ON memory_documents
BEGIN SELECT RAISE(ABORT, 'memory_documents is immutable'); END;
CREATE TRIGGER IF NOT EXISTS memory_documents_no_delete BEFORE DELETE ON memory_documents
BEGIN SELECT RAISE(ABORT, 'memory_documents is immutable'); END;

CREATE TABLE IF NOT EXISTS memory_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES memory_documents(id) ON DELETE RESTRICT,
  hub_id TEXT NOT NULL,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  seq INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  text TEXT NOT NULL,
  fts_tokens TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_doc ON memory_chunks(document_id, seq);
CREATE TRIGGER IF NOT EXISTS memory_chunks_no_update BEFORE UPDATE ON memory_chunks
BEGIN SELECT RAISE(ABORT, 'memory_chunks is immutable'); END;
CREATE TRIGGER IF NOT EXISTS memory_chunks_no_delete BEFORE DELETE ON memory_chunks
BEGIN SELECT RAISE(ABORT, 'memory_chunks is immutable'); END;

CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
  id UNINDEXED,
  fts_tokens,
  content=memory_chunks,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 1'
);
CREATE TRIGGER IF NOT EXISTS memory_chunks_fts_ai AFTER INSERT ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(rowid, id, fts_tokens)
  VALUES (new.rowid, new.id, new.fts_tokens);
END;

CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE RESTRICT,
  repo_id TEXT,
  mission_id TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  kind TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  claim TEXT NOT NULL,
  fts_tokens TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  authority_tier TEXT NOT NULL DEFAULT 'L1_observed',
  event_start_at TEXT NOT NULL,
  event_end_at TEXT,
  ingested_at TEXT NOT NULL,
  valid_until TEXT,
  superseded_by_fact_id TEXT,
  source_document_id TEXT NOT NULL REFERENCES memory_documents(id) ON DELETE RESTRICT,
  source_chunk_id TEXT NOT NULL REFERENCES memory_chunks(id) ON DELETE RESTRICT,
  path_anchors_json TEXT NOT NULL DEFAULT '[]',
  entity_ids_json TEXT NOT NULL DEFAULT '[]',
  stability_hours REAL NOT NULL DEFAULT 36,
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_at TEXT NOT NULL,
  consolidated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memory_facts_temporal ON memory_facts(hub_id, execution_mode, event_start_at DESC, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_facts_unconsolidated ON memory_facts(hub_id, execution_mode, consolidated);
CREATE TRIGGER IF NOT EXISTS memory_facts_no_delete BEFORE DELETE ON memory_facts
BEGIN SELECT RAISE(ABORT, 'memory_facts is append-only'); END;
DROP TRIGGER IF EXISTS memory_facts_claim_immutable;
CREATE TRIGGER memory_facts_claim_immutable BEFORE UPDATE ON memory_facts
WHEN NEW.id IS NOT OLD.id
  OR NEW.hub_id IS NOT OLD.hub_id
  OR NEW.repo_id IS NOT OLD.repo_id
  OR NEW.mission_id IS NOT OLD.mission_id
  OR NEW.execution_mode IS NOT OLD.execution_mode
  OR NEW.kind IS NOT OLD.kind
  OR NEW.subject_key IS NOT OLD.subject_key
  OR NEW.claim IS NOT OLD.claim
  OR NEW.fts_tokens IS NOT OLD.fts_tokens
  OR NEW.confidence IS NOT OLD.confidence
  OR NEW.authority_tier IS NOT OLD.authority_tier
  OR NEW.event_start_at IS NOT OLD.event_start_at
  OR NEW.event_end_at IS NOT OLD.event_end_at
  OR NEW.ingested_at IS NOT OLD.ingested_at
  OR NEW.source_document_id IS NOT OLD.source_document_id
  OR NEW.source_chunk_id IS NOT OLD.source_chunk_id
  OR NEW.path_anchors_json IS NOT OLD.path_anchors_json
  OR NEW.entity_ids_json IS NOT OLD.entity_ids_json
BEGIN
  SELECT RAISE(ABORT, 'memory_facts core claim and provenance are immutable');
END;

CREATE VIRTUAL TABLE IF NOT EXISTS memory_facts_fts USING fts5(
  id UNINDEXED,
  fts_tokens,
  content=memory_facts,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 1'
);
CREATE TRIGGER IF NOT EXISTS memory_facts_fts_ai AFTER INSERT ON memory_facts BEGIN
  INSERT INTO memory_facts_fts(rowid, id, fts_tokens)
  VALUES (new.rowid, new.id, new.fts_tokens);
END;
CREATE TRIGGER IF NOT EXISTS memory_facts_fts_au AFTER UPDATE OF fts_tokens ON memory_facts BEGIN
  INSERT INTO memory_facts_fts(memory_facts_fts, rowid, id, fts_tokens)
  VALUES ('delete', old.rowid, old.id, old.fts_tokens);
  INSERT INTO memory_facts_fts(rowid, id, fts_tokens)
  VALUES (new.rowid, new.id, new.fts_tokens);
END;

CREATE TABLE IF NOT EXISTS memory_observations (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE RESTRICT,
  repo_id TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  kind TEXT NOT NULL DEFAULT 'world',
  subject_key TEXT NOT NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  fts_tokens TEXT NOT NULL,
  belief_status TEXT NOT NULL DEFAULT 'active',
  authority_tier TEXT NOT NULL DEFAULT 'L2_verified',
  history_json TEXT NOT NULL DEFAULT '[]',
  supporting_fact_ids_json TEXT NOT NULL DEFAULT '[]',
  contradicting_fact_ids_json TEXT NOT NULL DEFAULT '[]',
  entity_ids_json TEXT NOT NULL DEFAULT '[]',
  path_anchors_json TEXT NOT NULL DEFAULT '[]',
  stability_hours REAL NOT NULL DEFAULT 48,
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_at TEXT NOT NULL,
  stale_suspect INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_obs_subject ON memory_observations(hub_id, execution_mode, subject_key, belief_status);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_observations_fts USING fts5(
  id UNINDEXED,
  fts_tokens,
  content=memory_observations,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 1'
);
CREATE TRIGGER IF NOT EXISTS memory_obs_fts_ai AFTER INSERT ON memory_observations BEGIN
  INSERT INTO memory_observations_fts(rowid, id, fts_tokens)
  VALUES (new.rowid, new.id, new.fts_tokens);
END;
CREATE TRIGGER IF NOT EXISTS memory_obs_fts_ad AFTER DELETE ON memory_observations BEGIN
  INSERT INTO memory_observations_fts(memory_observations_fts, rowid, id, fts_tokens)
  VALUES ('delete', old.rowid, old.id, old.fts_tokens);
END;
CREATE TRIGGER IF NOT EXISTS memory_obs_fts_au AFTER UPDATE OF title, statement, fts_tokens ON memory_observations BEGIN
  INSERT INTO memory_observations_fts(memory_observations_fts, rowid, id, fts_tokens)
  VALUES ('delete', old.rowid, old.id, old.fts_tokens);
  INSERT INTO memory_observations_fts(rowid, id, fts_tokens)
  VALUES (new.rowid, new.id, new.fts_tokens);
END;

CREATE TABLE IF NOT EXISTS memory_vectors (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  embedding_space TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector_blob BLOB NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_recalled_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(target_kind, target_id, embedding_space, dims)
);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_lookup ON memory_vectors(hub_id, execution_mode, embedding_space, dims, active, last_recalled_at DESC);

CREATE TABLE IF NOT EXISTS memory_entities (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  entity_type TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  UNIQUE(hub_id, execution_mode, entity_type, canonical_key)
);

CREATE TABLE IF NOT EXISTS memory_edges (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  source_fact_id TEXT,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_edges_src ON memory_edges(hub_id, execution_mode, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_memory_edges_dst ON memory_edges(hub_id, execution_mode, target_entity_id);

CREATE TABLE IF NOT EXISTS memory_living_docs (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE RESTRICT,
  repo_id TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  doc_kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  standing_question TEXT NOT NULL,
  scope_entities_json TEXT NOT NULL DEFAULT '[]',
  content_markdown TEXT NOT NULL,
  cited_observation_ids_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  stale INTEGER NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(hub_id, execution_mode, doc_kind, slug)
);

CREATE TABLE IF NOT EXISTS baseline_impacts (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  parent_baseline_id TEXT NOT NULL,
  next_baseline_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_baseline_impacts_mission ON baseline_impacts(mission_id, created_at DESC);
`;

export const FRESH_V3_SCHEMA_SQL = `
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
  mission_id TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'live',
  execution_epoch INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  depends_on_change_ids_json TEXT NOT NULL DEFAULT '[]',
  upstream_contract_shas_json TEXT NOT NULL DEFAULT '{}',
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_mission ON changes(mission_id);

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
  requirement_refs_json TEXT NOT NULL DEFAULT '[]',
  acceptance_refs_json TEXT NOT NULL DEFAULT '[]',
  planning_rationale TEXT NOT NULL DEFAULT '',
  input_contract TEXT NOT NULL DEFAULT '',
  output_contract TEXT NOT NULL DEFAULT '',
  forensics_json TEXT,
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
DROP TRIGGER IF EXISTS memories_fts_au;
CREATE TRIGGER memories_fts_au AFTER UPDATE OF kind, title, summary, path_anchors_json ON semantic_memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, id, title, summary)
  VALUES ('delete', old.rowid, old.id, old.title, old.summary);
  INSERT INTO memories_fts(rowid, id, title, summary)
  VALUES (new.rowid, new.id, new.title, new.summary);
END;

CREATE TABLE IF NOT EXISTS execution_telemetry (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  change_id TEXT,
  node_id TEXT,
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
  status TEXT NOT NULL DEFAULT 'pending',
  lease_token TEXT,
  leased_until TEXT,
  payload_version INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_due_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON effects_outbox(status, next_due_at ASC);

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
CREATE TRIGGER IF NOT EXISTS audit_ledger_no_update BEFORE UPDATE ON audit_ledger
BEGIN SELECT RAISE(ABORT, 'audit_ledger is immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_ledger_no_delete BEFORE DELETE ON audit_ledger
BEGIN SELECT RAISE(ABORT, 'audit_ledger is immutable'); END;

${V3_NEW_TABLES_SQL}
`;

export const INITIAL_SCHEMA_SQL = FRESH_V3_SCHEMA_SQL;

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(tableName) as Record<string, unknown> | undefined;
  return Boolean(row);
}

function hasColumn(
  db: DatabaseSync,
  tableName: string,
  columnName: string,
): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<
    Record<string, unknown>
  >;
  return rows.some(r => String(r['name']) === columnName);
}

function addColumnIfMissing(
  db: DatabaseSync,
  tableName: string,
  columnName: string,
  definitionSql: string,
): void {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`,
    );
  }
}

function sha256TextInline(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function tokenizeBilingualInline(text: string): string[] {
  const cjk = /[\u4e00-\u9fff]/;
  const out: string[] = [];
  const rawSegments = text.match(/[A-Za-z0-9_.-]+|[\u4e00-\u9fff]+/g);
  if (!rawSegments) {
    return out;
  }
  for (const seg of rawSegments) {
    if (cjk.test(seg)) {
      if (seg.length === 1) {
        out.push(seg);
      } else {
        for (let i = 0; i < seg.length - 1; i += 1) {
          out.push(seg.slice(i, i + 2));
        }
      }
      continue;
    }
    const lower = seg.toLowerCase();
    if (lower.length >= 2) {
      out.push(lower);
    }
    const parts = seg
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-./]+/g, ' ')
      .split(/\s+/)
      .map(p => p.trim().toLowerCase())
      .filter(p => p.length > 0);
    for (const part of parts) {
      if (part.length >= 2 && part !== lower) {
        out.push(part);
      }
    }
  }
  return out;
}

function buildFtsTokensInline(text: string): string {
  return tokenizeBilingualInline(text).join(' ');
}

function fnv1a32Inline(str: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function embedTextLocal128Blob(text: string): Uint8Array {
  const dims = 128;
  const vec = new Float32Array(dims);
  const tokens = tokenizeBilingualInline(text);
  for (const tok of tokens) {
    const idx = fnv1a32Inline(tok, 2166136261) % dims;
    const sign = (fnv1a32Inline(tok, 16777619) & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign * 1.5;
    if (tok.length >= 3) {
      for (let i = 0; i <= tok.length - 3; i += 1) {
        const gram = tok.slice(i, i + 3);
        const gIdx = fnv1a32Inline(gram, 374761393) % dims;
        const gSign = (fnv1a32Inline(gram, 668265263) & 1) === 0 ? 1 : -1;
        vec[gIdx] = (vec[gIdx] ?? 0) + gSign * 0.5;
      }
    }
  }
  let normSq = 0;
  for (let i = 0; i < dims; i += 1) {
    const v = vec[i]!;
    normSq += v * v;
  }
  if (normSq > 0) {
    const inv = 1 / Math.sqrt(normSq);
    for (let i = 0; i < dims; i += 1) {
      vec[i] = vec[i]! * inv;
    }
  }
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

function columnIsNotNull(
  db: DatabaseSync,
  tableName: string,
  columnName: string,
): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<
    Record<string, unknown>
  >;
  const col = rows.find(r => String(r['name']) === columnName);
  return col ? Number(col['notnull']) === 1 : false;
}

function sanitizeStringArrayJson(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '[]';
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return '[]';
    }
    return JSON.stringify(
      parsed.filter((item): item is string => typeof item === 'string'),
    );
  } catch {
    return '[]';
  }
}

function missionDecisionsNeedsScopedUniqueRebuild(db: DatabaseSync): boolean {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mission_decisions'",
    )
    .get() as Record<string, unknown> | undefined;
  const sql = row?.['sql'];
  return (
    typeof sql === 'string' && /idempotency_key\s+TEXT\s+UNIQUE/i.test(sql)
  );
}

function ensureMissionDecisionsScopedUnique(db: DatabaseSync): void {
  if (!missionDecisionsNeedsScopedUniqueRebuild(db)) {
    return;
  }
  db.exec(`
    DROP TRIGGER IF EXISTS mission_decisions_no_update;
    DROP TRIGGER IF EXISTS mission_decisions_no_delete;
    CREATE TABLE mission_decisions_v4 (
      id TEXT PRIMARY KEY,
      gate_id TEXT NOT NULL REFERENCES mission_gates(id) ON DELETE RESTRICT,
      mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
      idempotency_key TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_hash TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      feedback TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'proposal',
      issue_ids_json TEXT NOT NULL DEFAULT '[]',
      response_json TEXT NOT NULL DEFAULT '{}',
      decided_at TEXT NOT NULL,
      UNIQUE(mission_id, idempotency_key)
    );
    INSERT INTO mission_decisions_v4 (
      id, gate_id, mission_id, idempotency_key, payload_sha256, target_id, target_hash,
      actor, action, feedback, scope, issue_ids_json, response_json, decided_at
    )
    SELECT
      id, gate_id, mission_id, idempotency_key, payload_sha256, target_id, target_hash,
      actor, action, feedback, scope, issue_ids_json, response_json, decided_at
    FROM mission_decisions;
    DROP TABLE mission_decisions;
    ALTER TABLE mission_decisions_v4 RENAME TO mission_decisions;
    CREATE TRIGGER IF NOT EXISTS mission_decisions_no_update BEFORE UPDATE ON mission_decisions
    BEGIN SELECT RAISE(ABORT, 'mission_decisions is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS mission_decisions_no_delete BEFORE DELETE ON mission_decisions
    BEGIN SELECT RAISE(ABORT, 'mission_decisions is immutable'); END;
  `);
}

export function runSchemaMigrations(db: DatabaseSync): void {
  db.exec(BASE_PRAGMAS_SQL);
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_kv (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const hubsPresent = tableExists(db, 'hubs');
  const verRow = db
    .prepare("SELECT value_json FROM meta_kv WHERE key = 'schema_version'")
    .get() as Record<string, unknown> | undefined;

  let currentVersion = 0;
  if (verRow) {
    if (typeof verRow['value_json'] !== 'string') {
      throw new ForgeError(
        'MIGRATION_ERROR',
        'Invalid schema_version entry in meta_kv',
        500,
      );
    }
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(verRow['value_json']);
    } catch {
      throw new ForgeError(
        'MIGRATION_ERROR',
        `Corrupt schema_version JSON in meta_kv: ${verRow['value_json']}`,
        500,
      );
    }
    const parsed = typeof parsedRaw === 'number' ? parsedRaw : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ForgeError(
        'MIGRATION_ERROR',
        `Invalid schema_version value in meta_kv: ${verRow['value_json']}`,
        500,
      );
    }
    currentVersion = parsed;
  } else if (hubsPresent) {
    currentVersion = 1;
  }

  if (currentVersion > SCHEMA_VERSION) {
    throw new ForgeError(
      'MIGRATION_ERROR',
      `Database schema version ${currentVersion} is newer than supported v${SCHEMA_VERSION}`,
      500,
    );
  }

  if (currentVersion === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(FRESH_V3_SCHEMA_SQL);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO meta_kv (key, value_json, updated_at) VALUES ('schema_version', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      ).run(JSON.stringify(SCHEMA_VERSION), now);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure.
      }
      throw err;
    }
    return;
  }

  if (currentVersion < SCHEMA_VERSION) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (tableExists(db, 'changes')) {
        addColumnIfMissing(db, 'changes', 'mission_id', 'TEXT');
        addColumnIfMissing(
          db,
          'changes',
          'execution_mode',
          "TEXT NOT NULL DEFAULT 'live'",
        );
        addColumnIfMissing(
          db,
          'changes',
          'execution_epoch',
          'INTEGER NOT NULL DEFAULT 1',
        );
        addColumnIfMissing(
          db,
          'changes',
          'version',
          'INTEGER NOT NULL DEFAULT 1',
        );
        addColumnIfMissing(
          db,
          'changes',
          'depends_on_change_ids_json',
          "TEXT NOT NULL DEFAULT '[]'",
        );
        addColumnIfMissing(
          db,
          'changes',
          'upstream_contract_shas_json',
          "TEXT NOT NULL DEFAULT '{}'",
        );
        addColumnIfMissing(
          db,
          'changes',
          'lines_added',
          'INTEGER NOT NULL DEFAULT 0',
        );
        addColumnIfMissing(
          db,
          'changes',
          'lines_deleted',
          'INTEGER NOT NULL DEFAULT 0',
        );
      }

      if (tableExists(db, 'graph_nodes')) {
        addColumnIfMissing(
          db,
          'graph_nodes',
          'requirement_refs_json',
          "TEXT NOT NULL DEFAULT '[]'",
        );
        addColumnIfMissing(
          db,
          'graph_nodes',
          'acceptance_refs_json',
          "TEXT NOT NULL DEFAULT '[]'",
        );
        addColumnIfMissing(
          db,
          'graph_nodes',
          'planning_rationale',
          "TEXT NOT NULL DEFAULT ''",
        );
        addColumnIfMissing(
          db,
          'graph_nodes',
          'input_contract',
          "TEXT NOT NULL DEFAULT ''",
        );
        addColumnIfMissing(
          db,
          'graph_nodes',
          'output_contract',
          "TEXT NOT NULL DEFAULT ''",
        );
        addColumnIfMissing(db, 'graph_nodes', 'forensics_json', 'TEXT');
      }

      if (tableExists(db, 'effects_outbox')) {
        addColumnIfMissing(
          db,
          'effects_outbox',
          'status',
          "TEXT NOT NULL DEFAULT 'pending'",
        );
        addColumnIfMissing(db, 'effects_outbox', 'lease_token', 'TEXT');
        addColumnIfMissing(db, 'effects_outbox', 'leased_until', 'TEXT');
        addColumnIfMissing(
          db,
          'effects_outbox',
          'payload_version',
          'INTEGER NOT NULL DEFAULT 1',
        );
        addColumnIfMissing(
          db,
          'effects_outbox',
          'max_attempts',
          'INTEGER NOT NULL DEFAULT 5',
        );
      }

      if (tableExists(db, 'memory_observations')) {
        addColumnIfMissing(
          db,
          'memory_observations',
          'kind',
          "TEXT NOT NULL DEFAULT 'world'",
        );
      }

      if (
        tableExists(db, 'execution_telemetry') &&
        (columnIsNotNull(db, 'execution_telemetry', 'change_id') ||
          columnIsNotNull(db, 'execution_telemetry', 'node_id'))
      ) {
        db.exec(`
          CREATE TABLE execution_telemetry_v4 (
            id TEXT PRIMARY KEY,
            hub_id TEXT NOT NULL,
            change_id TEXT,
            node_id TEXT,
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
          INSERT INTO execution_telemetry_v4
          SELECT id, hub_id, change_id, node_id, adapter_id, model, role, outcome,
                 first_pass_certified, premature_stop_triggered, duration_sec,
                 input_tokens, cached_tokens, first_turn_cached_tokens, output_tokens,
                 cost_usd, diagnostic, created_at
          FROM execution_telemetry;
          DROP TABLE execution_telemetry;
          ALTER TABLE execution_telemetry_v4 RENAME TO execution_telemetry;
          CREATE INDEX IF NOT EXISTS idx_telemetry_adapter ON execution_telemetry(adapter_id, created_at DESC);
        `);
      }

      if (tableExists(db, 'memory_vectors')) {
        const vecSchemaRow = db
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_vectors'",
          )
          .get() as Record<string, unknown> | undefined;
        const vecSql =
          typeof vecSchemaRow?.['sql'] === 'string' ? vecSchemaRow['sql'] : '';
        if (
          !/UNIQUE\s*\(\s*target_kind\s*,\s*target_id\s*,\s*embedding_space\s*,\s*dims\s*\)/i.test(
            vecSql,
          )
        ) {
          db.exec(`
            DROP INDEX IF EXISTS idx_memory_vectors_lookup;
            CREATE TABLE memory_vectors_v4 (
              id TEXT PRIMARY KEY,
              hub_id TEXT NOT NULL,
              execution_mode TEXT NOT NULL DEFAULT 'live',
              target_kind TEXT NOT NULL,
              target_id TEXT NOT NULL,
              embedding_space TEXT NOT NULL,
              dims INTEGER NOT NULL,
              vector_blob BLOB NOT NULL,
              active INTEGER NOT NULL DEFAULT 1,
              last_recalled_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(target_kind, target_id, embedding_space, dims)
            );
            INSERT OR IGNORE INTO memory_vectors_v4
            SELECT id, hub_id, execution_mode, target_kind, target_id, embedding_space, dims,
                   vector_blob, active, last_recalled_at, updated_at
            FROM memory_vectors;
            DROP TABLE memory_vectors;
            ALTER TABLE memory_vectors_v4 RENAME TO memory_vectors;
            CREATE INDEX IF NOT EXISTS idx_memory_vectors_lookup
              ON memory_vectors(hub_id, execution_mode, embedding_space, dims, active, last_recalled_at DESC);
          `);
        }
      }

      db.exec(FRESH_V3_SCHEMA_SQL);

      if (tableExists(db, 'semantic_memories')) {
        const validHubIds = new Set(
          (
            db.prepare('SELECT id FROM hubs').all() as Array<
              Record<string, unknown>
            >
          ).map(h => String(h['id'])),
        );
        const legacyRows = db
          .prepare('SELECT * FROM semantic_memories')
          .all() as Array<Record<string, unknown>>;
        const insDoc = db.prepare(
          `INSERT INTO memory_documents
           (id, hub_id, repo_id, mission_id, execution_mode, source_type, occurred_at, content_sha256, raw_text, metadata_json, created_at)
           VALUES (?, ?, ?, NULL, 'live', 'legacy_semantic_memory', ?, ?, ?, '{}', ?)
           ON CONFLICT(hub_id, execution_mode, content_sha256) DO NOTHING`,
        );
        const findDocById = db.prepare(
          'SELECT id FROM memory_documents WHERE id = ?',
        );
        const findDocBySha = db.prepare(
          "SELECT id FROM memory_documents WHERE hub_id = ? AND execution_mode = 'live' AND content_sha256 = ?",
        );
        const insChunk = db.prepare(
          `INSERT INTO memory_chunks
           (id, document_id, hub_id, execution_mode, seq, start_offset, end_offset, text, fts_tokens, token_estimate, created_at)
           VALUES (?, ?, ?, 'live', 0, 0, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        );
        const findChunkById = db.prepare(
          'SELECT id FROM memory_chunks WHERE id = ?',
        );
        const findChunkByDoc = db.prepare(
          'SELECT id FROM memory_chunks WHERE document_id = ? ORDER BY seq ASC LIMIT 1',
        );
        const insFact = db.prepare(
          `INSERT INTO memory_facts
           (id, hub_id, repo_id, mission_id, execution_mode, kind, subject_key, claim, fts_tokens, confidence, authority_tier, event_start_at, event_end_at, ingested_at, valid_until, superseded_by_fact_id, source_document_id, source_chunk_id, path_anchors_json, entity_ids_json, stability_hours, recall_count, last_recalled_at, consolidated)
           VALUES (?, ?, ?, NULL, 'live', ?, ?, ?, ?, 0.85, 'L2_verified', ?, NULL, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 1)
           ON CONFLICT(id) DO NOTHING`,
        );
        const insObs = db.prepare(
          `INSERT INTO memory_observations
           (id, hub_id, repo_id, execution_mode, kind, subject_key, title, statement, fts_tokens, belief_status, authority_tier, history_json, supporting_fact_ids_json, contradicting_fact_ids_json, entity_ids_json, path_anchors_json, stability_hours, recall_count, last_recalled_at, stale_suspect, updated_at, created_at)
           VALUES (?, ?, ?, 'live', ?, ?, ?, ?, ?, 'active', 'L2_verified', '[]', ?, '[]', '[]', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        );
        const insVec = db.prepare(
          `INSERT INTO memory_vectors
           (id, hub_id, execution_mode, target_kind, target_id, embedding_space, dims, vector_blob, active, last_recalled_at, updated_at)
           VALUES (?, ?, 'live', ?, ?, 'local-rp-128', 128, ?, 1, ?, ?)
           ON CONFLICT(target_kind, target_id, embedding_space, dims) DO NOTHING`,
        );

        for (const r of legacyRows) {
          const id = String(r['id'] ?? '');
          const hubId = typeof r['hub_id'] === 'string' ? r['hub_id'] : '';
          if (!id || !hubId || !validHubIds.has(hubId)) {
            continue;
          }
          const title = typeof r['title'] === 'string' ? r['title'] : '';
          const summary = typeof r['summary'] === 'string' ? r['summary'] : '';
          const text = `${title}\n${summary}`.trim() || id;
          const createdAt =
            typeof r['created_at'] === 'string' && r['created_at']
              ? r['created_at']
              : new Date().toISOString();
          const lastRecalledAt =
            typeof r['last_recalled_at'] === 'string' && r['last_recalled_at']
              ? r['last_recalled_at']
              : createdAt;
          const repoId =
            typeof r['repo_id'] === 'string' && r['repo_id']
              ? r['repo_id']
              : null;
          const pathAnchorsJson = sanitizeStringArrayJson(
            r['path_anchors_json'],
          );
          const rawStability = Number(r['stability_hours']);
          const stabilityHours =
            Number.isFinite(rawStability) && rawStability > 0
              ? rawStability
              : 36;
          const rawRecall = Number(r['recall_count']);
          const recallCount =
            Number.isFinite(rawRecall) && rawRecall >= 0
              ? Math.trunc(rawRecall)
              : 0;
          const sha = sha256TextInline(text);
          const tokens = buildFtsTokensInline(text);

          const candidateDocId = `doc-mig-${id}`;
          insDoc.run(
            candidateDocId,
            hubId,
            repoId,
            createdAt,
            sha,
            text,
            createdAt,
          );
          const resolvedDoc =
            (findDocById.get(candidateDocId) as
              Record<string, unknown> | undefined) ??
            (findDocBySha.get(hubId, sha) as
              Record<string, unknown> | undefined);
          if (!resolvedDoc) {
            continue;
          }
          const docId = String(resolvedDoc['id']);

          const candidateChunkId = `chk-mig-${id}`;
          insChunk.run(
            candidateChunkId,
            docId,
            hubId,
            text.length,
            text,
            tokens,
            Math.max(1, Math.ceil(text.length / 4)),
            createdAt,
          );
          const resolvedChunk =
            (findChunkById.get(candidateChunkId) as
              Record<string, unknown> | undefined) ??
            (findChunkByDoc.get(docId) as Record<string, unknown> | undefined);
          if (!resolvedChunk) {
            continue;
          }
          const chunkId = String(resolvedChunk['id']);

          const kind =
            r['kind'] === 'pitfall_lesson'
              ? 'pitfall'
              : r['kind'] === 'adr'
                ? 'decision'
                : 'world';
          const factId = `fact-mig-${id}`;
          const validFrom =
            typeof r['valid_from'] === 'string' && r['valid_from']
              ? r['valid_from']
              : createdAt;
          const validUntil =
            typeof r['valid_until'] === 'string' && r['valid_until']
              ? r['valid_until']
              : null;
          const supersededBy =
            typeof r['superseded_by_id'] === 'string' && r['superseded_by_id']
              ? `fact-mig-${r['superseded_by_id']}`
              : null;

          insFact.run(
            factId,
            hubId,
            repoId,
            kind,
            `legacy:${id}`,
            text,
            tokens,
            validFrom,
            createdAt,
            validUntil,
            supersededBy,
            docId,
            chunkId,
            pathAnchorsJson,
            stabilityHours,
            recallCount,
            lastRecalledAt,
          );

          if (validUntil === null) {
            const obsId = `obs-mig-${id}`;
            const obsTitle = title || `Legacy ${kind}`;
            const obsStatement = summary || text;
            const obsTokens = buildFtsTokensInline(
              `${obsTitle} ${obsStatement}`,
            );
            const staleSuspect = Number(r['stale_suspect']) === 1 ? 1 : 0;

            insObs.run(
              obsId,
              hubId,
              repoId,
              kind,
              `legacy:${id}`,
              obsTitle,
              obsStatement,
              obsTokens,
              JSON.stringify([factId]),
              pathAnchorsJson,
              stabilityHours,
              recallCount,
              lastRecalledAt,
              staleSuspect,
              createdAt,
              createdAt,
            );

            const textVec = embedTextLocal128Blob(text);
            const obsVec = embedTextLocal128Blob(obsStatement);
            insVec.run(
              `vec-mig-chk-${id}`,
              hubId,
              'chunk',
              chunkId,
              textVec,
              lastRecalledAt,
              createdAt,
            );
            insVec.run(
              `vec-mig-fact-${id}`,
              hubId,
              'fact',
              factId,
              textVec,
              lastRecalledAt,
              createdAt,
            );
            insVec.run(
              `vec-mig-obs-${id}`,
              hubId,
              'observation',
              obsId,
              obsVec,
              lastRecalledAt,
              createdAt,
            );
          }
        }
      }

      ensureMissionDecisionsScopedUnique(db);

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO meta_kv (key, value_json, updated_at) VALUES ('schema_version', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      ).run(JSON.stringify(SCHEMA_VERSION), now);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure.
      }
      throw err;
    }
  } else if (missionDecisionsNeedsScopedUniqueRebuild(db)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      ensureMissionDecisionsScopedUnique(db);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure.
      }
      throw err;
    }
  }
}

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
    promptTransport: 'stdin',
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
    promptTransport: 'stdin',
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
    envAllowlist: [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'DEEPSEEK_API_KEY',
      'OPENCODE_API_KEY',
    ],
    defaultModel: 'deepseek-chat',
    supportedRoles: ['worker', 'specialist'],
    maxConcurrentSlots: 4,
    builtIn: true,
    promptTransport: 'stdin',
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
    promptTransport: 'stdin',
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
    promptTransport: 'stdin',
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
    id: 'opencode-go',
    name: 'OpenCode Go Gateway',
    protocol: 'openai-compatible',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    models: [
      {
        id: 'deepseek-v4.1-flash',
        label: 'DeepSeek V4.1 Flash (OpenCode Go)',
        tier: 'fast',
        inputUsdPerMillion: 0.25,
        cachedInputUsdPerMillion: 0.06,
        outputUsdPerMillion: 1.0,
        contextWindowTokens: 128_000,
      },
      {
        id: 'glm-5',
        label: 'GLM-5 (Strong Lead)',
        tier: 'strong',
        inputUsdPerMillion: 0.8,
        cachedInputUsdPerMillion: 0.2,
        outputUsdPerMillion: 2.5,
        contextWindowTokens: 128_000,
      },
      {
        id: 'kimi-k2.5',
        label: 'Kimi K2.5 (Long Context)',
        tier: 'strong',
        inputUsdPerMillion: 0.6,
        cachedInputUsdPerMillion: 0.15,
        outputUsdPerMillion: 2.0,
        contextWindowTokens: 200_000,
      },
    ],
  },
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

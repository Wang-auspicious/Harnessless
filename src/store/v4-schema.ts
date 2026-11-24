/**
 * Incremental SQLite schema for SDLC-Studio v4 Master Agent Orchestration,
 * Raft Consensus Log, Board <-> Spec IR Workspace Docs, Artifact Pins,
 * Task Decomposition Plans, Turn-level git write-tree Diff Snapshots,
 * Claude Ship Reviews, Cross-Agent Collab Feed, and Hosted App Cards.
 */

import type {DatabaseSync} from 'node:sqlite';

export function initV4Schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS v4_master_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('solo','team')),
      execution_mode TEXT NOT NULL CHECK(execution_mode IN ('auto','live','local')),
      workspace_path TEXT NOT NULL,
      hub_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      stage TEXT NOT NULL CHECK(stage IN ('intent','spec','tasks','executing','review','delivered')),
      term INTEGER NOT NULL DEFAULT 1,
      cr_passed INTEGER NOT NULL DEFAULT 0,
      active_plan_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v4_sessions_updated
      ON v4_master_sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS v4_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('human','master','agent','system')),
      agent_kernel TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('text','decision_card','grilling','collab_event','trace_summary','ship_card')),
      content TEXT NOT NULL,
      decision_card_json TEXT,
      grilling_json TEXT,
      collab_meta_json TEXT,
      trace_items_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v4_chat_session
      ON v4_chat_messages(session_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS v4_consensus_log_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      term INTEGER NOT NULL,
      log_seq INTEGER NOT NULL,
      author_principal_id TEXT NOT NULL,
      author_kind TEXT NOT NULL CHECK(author_kind IN ('human','master_agent','team_agent','critic_agent')),
      entry_type TEXT NOT NULL CHECK(entry_type IN ('intent','found','asked','advised','kano','ahp','ruling','dissent','commit')),
      spec_anchor_id TEXT,
      payload_json TEXT NOT NULL,
      commit_state TEXT NOT NULL DEFAULT 'proposed' CHECK(commit_state IN ('proposed','committed','superseded')),
      created_at TEXT NOT NULL,
      UNIQUE(session_id, term, log_seq)
    );

    CREATE INDEX IF NOT EXISTS idx_v4_consensus_session
      ON v4_consensus_log_entries(session_id, term ASC, log_seq ASC);

    CREATE TABLE IF NOT EXISTS v4_workspace_docs (
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('board_scene','spec_ir','quantization','rulings_ledger')),
      revision INTEGER NOT NULL DEFAULT 1,
      content_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(session_id, kind)
    );

    CREATE TABLE IF NOT EXISTS v4_artifact_pins (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      surface_type TEXT NOT NULL CHECK(surface_type IN ('board','spec_ir','code_diff','html_verify')),
      anchor_json TEXT NOT NULL,
      spec_node_id TEXT,
      pin_number INTEGER NOT NULL,
      prompt_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting_on_agent' CHECK(status IN ('waiting_on_agent','waiting_on_human','resolved')),
      reply_text TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_v4_pins_session
      ON v4_artifact_pins(session_id, pin_number ASC);

    CREATE TABLE IF NOT EXISTS v4_task_plans (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      spec_revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','approved','running','completed','failed')),
      tasks_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v4_plans_session
      ON v4_task_plans(session_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS v4_turn_diff_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      kernel_id TEXT NOT NULL,
      before_tree_sha TEXT NOT NULL,
      after_tree_sha TEXT NOT NULL,
      files_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v4_diffs_session
      ON v4_turn_diff_snapshots(session_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS v4_ship_reviews (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL,
      review_depth TEXT NOT NULL CHECK(review_depth IN ('fast','standard','deep')),
      reviewer_kernel TEXT NOT NULL,
      coder_kernels_json TEXT NOT NULL,
      anti_self_approval_passed INTEGER NOT NULL,
      findings_json TEXT NOT NULL,
      steward_fixes_json TEXT NOT NULL,
      policy_mode TEXT NOT NULL CHECK(policy_mode IN ('shadow','enforced')),
      would_approve INTEGER NOT NULL,
      answer_html TEXT NOT NULL,
      verdict TEXT NOT NULL DEFAULT 'pending' CHECK(verdict IN ('pending','passed','rejected')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v4_ship_session
      ON v4_ship_reviews(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS v4_collab_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      from_kernel TEXT NOT NULL,
      to_kernel TEXT NOT NULL,
      kind TEXT NOT NULL,
      task_id TEXT,
      audience_scope TEXT NOT NULL DEFAULT 'world',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v4_collab_session
      ON v4_collab_messages(session_id, seq ASC);

    CREATE TABLE IF NOT EXISTS v4_hosted_apps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version_tag TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      entry_command TEXT NOT NULL,
      url_or_port TEXT,
      status TEXT NOT NULL CHECK(status IN ('stopped','starting','running','crashed')),
      commit_sha TEXT,
      nps_score REAL,
      csat_score REAL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v4_settings_kv (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

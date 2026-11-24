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

    CREATE TABLE IF NOT EXISTS v4_model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_keys_json TEXT NOT NULL,
      models_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      health_status TEXT NOT NULL DEFAULT 'untested',
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v4_routing_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      strategy TEXT NOT NULL CHECK(strategy IN ('order','rotate','context-tiered')),
      targets_json TEXT NOT NULL,
      failover_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v4_model_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      bindings_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v4_agent_roster (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      handle TEXT NOT NULL,
      role_key TEXT NOT NULL,
      avatar_key TEXT NOT NULL,
      accent_color TEXT NOT NULL,
      binding_kind TEXT NOT NULL CHECK(binding_kind IN ('provider_model','routing_group','cli_harness')),
      provider_id TEXT,
      model_id TEXT,
      routing_group_id TEXT,
      harness_id TEXT,
      system_prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v4_connectors (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      last_sync_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v4_collab_channels (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, slug)
    );

    CREATE TABLE IF NOT EXISTS v4_collab_posts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      parent_post_id TEXT,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_kind TEXT NOT NULL CHECK(author_kind IN ('human','agent')),
      author_avatar TEXT NOT NULL,
      author_color TEXT NOT NULL,
      model_label TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      mentions_json TEXT NOT NULL,
      reactions_json TEXT NOT NULL,
      thread_status TEXT NOT NULL DEFAULT 'open' CHECK(thread_status IN ('open','resolved')),
      resolved_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v4_collab_posts_session
      ON v4_collab_posts(session_id, channel_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS v4_collab_unread_queue (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      target_agent_name TEXT NOT NULL,
      from_author TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','done')),
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_v4_unread_session
      ON v4_collab_unread_queue(session_id, status, created_at ASC);

    CREATE TABLE IF NOT EXISTS v4_scheduled_triggers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      target_agent_name TEXT NOT NULL,
      interval_label TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      run_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v4_collab_docs (
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      doc_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      blocks_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(session_id, doc_kind)
    );

    CREATE TABLE IF NOT EXISTS v4_collab_doc_revisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES v4_master_sessions(id) ON DELETE CASCADE,
      doc_kind TEXT NOT NULL,
      revision INTEGER NOT NULL,
      block_id TEXT NOT NULL,
      block_title TEXT NOT NULL,
      before_markdown TEXT NOT NULL,
      after_markdown TEXT NOT NULL,
      diff_summary TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_kind TEXT NOT NULL CHECK(author_kind IN ('human','agent')),
      author_color TEXT NOT NULL,
      model_label TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v4_doc_revisions_session
      ON v4_collab_doc_revisions(session_id, revision DESC);
  `);
}

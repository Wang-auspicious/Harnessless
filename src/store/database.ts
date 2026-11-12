/**
 * Single-writer SQLite WAL + FTS5 Store (`node:sqlite`) with nested transaction
 * savepoints and `afterCommit` durable effect hooks.
 */

import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {
  computeAdapterOperationalProfile,
  selectHealthyAdapterForRole,
} from '../core/telemetry.ts';
import type {EvidenceSearchHit} from '../shared/api.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  AcceptanceCriterion,
  AdapterOperationalProfile,
  AgentAdapterManifest,
  AgentRole,
  AttentionItem,
  AuditLedgerEntry,
  ChangeRecord,
  ChangeStatus,
  ChangeTeamConfig,
  CheckpointRecord,
  DaemonStatus,
  DomainTermEntry,
  EngineeringRoom,
  ExecutionTelemetryRecord,
  FederationHub,
  GraphEdge,
  GraphNode,
  GraphNodeStatus,
  ModelCatalogEntry,
  ModelProviderConfig,
  PermissionTier,
  RepoTier,
  RepositoryEntry,
  RoomMessage,
  RoomScenario,
  RoomThread,
  SemanticMemory,
  SkillEntry,
  SoulConstitution,
  TranscriptMessage,
  TranscriptSession,
} from '../shared/types.ts';
import {
  BUILTIN_ADAPTER_MANIFESTS,
  DEFAULT_CONSTITUTION,
  DEFAULT_DAEMONS,
  DEFAULT_MODEL_PROVIDERS,
  DEFAULT_SKILLS_BANK,
  INITIAL_SCHEMA_SQL,
  SCHEMA_VERSION,
} from './schema.ts';

export interface OutboxEffectRow {
  readonly id: string;
  readonly kind: string;
  readonly dedupeKey: string;
  readonly payloadJson: string;
  readonly attempts: number;
  readonly nextDueAt: string;
  readonly lastError: string;
  readonly createdAt: string;
}

type SqlRow = Record<string, unknown>;

function str(row: SqlRow, key: string): string {
  const v = row[key];
  return typeof v === 'string'
    ? v
    : v === null || v === undefined
      ? ''
      : String(v);
}

function nullableStr(row: SqlRow, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' ? v : null;
}

function num(row: SqlRow, key: string): number {
  const v = row[key];
  return typeof v === 'number' ? v : Number(v ?? 0);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class ForgeStore {
  private readonly db: DatabaseSync;
  private txDepth = 0;
  private postCommitQueue: Array<() => void> = [];

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), {recursive: true});
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(INITIAL_SCHEMA_SQL);
    this.seedDefaults();
  }

  close(): void {
    this.db.close();
  }

  /**
   * Executes `fn` inside an atomic SQLite transaction (or nested savepoint).
   * Registered `afterCommit` callbacks fire strictly after outermost commit.
   */
  atomic<T>(fn: () => T): T {
    const depth = this.txDepth;
    const sp = `sp_${depth}`;
    if (depth === 0) {
      this.db.exec('BEGIN IMMEDIATE');
    } else {
      this.db.exec(`SAVEPOINT ${sp}`);
    }
    this.txDepth += 1;
    try {
      const result = fn();
      this.txDepth -= 1;
      if (this.txDepth === 0) {
        this.db.exec('COMMIT');
        const callbacks = this.postCommitQueue;
        this.postCommitQueue = [];
        for (const cb of callbacks) {
          cb();
        }
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${sp}`);
      }
      return result;
    } catch (err) {
      this.txDepth -= 1;
      if (this.txDepth === 0) {
        this.postCommitQueue = [];
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // Ignore rollback secondary error.
        }
      } else {
        try {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
          this.db.exec(`RELEASE SAVEPOINT ${sp}`);
        } catch {
          // Ignore nested savepoint cleanup error.
        }
      }
      throw err;
    }
  }

  afterCommit(cb: () => void): void {
    if (this.txDepth === 0) {
      cb();
    } else {
      this.postCommitQueue.push(cb);
    }
  }

  private seedDefaults(): void {
    const now = new Date().toISOString();
    this.atomic(() => {
      const verRow = this.db
        .prepare('SELECT value_json FROM meta_kv WHERE key = ?')
        .get('schema_version') as SqlRow | undefined;
      if (!verRow) {
        this.setMeta('schema_version', SCHEMA_VERSION, now);
      }
      if (!this.getMeta<SoulConstitution>('soul_constitution')) {
        this.setMeta('soul_constitution', DEFAULT_CONSTITUTION, now);
      }
      if (!this.getMeta<readonly DaemonStatus[]>('daemons')) {
        this.setMeta('daemons', DEFAULT_DAEMONS, now);
      }

      const upsertAdapter = this.db.prepare(`
        INSERT INTO adapters (id, manifest_json, probe_ok, probe_message, probed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `);
      for (const m of BUILTIN_ADAPTER_MANIFESTS) {
        const isNative = m.transport === 'native-api';
        upsertAdapter.run(
          m.id,
          JSON.stringify(m),
          isNative ? 1 : null,
          isNative
            ? 'Built-in API runner ready'
            : 'Awaiting Environment Doctor probe',
          isNative ? now : null,
          now,
        );
      }

      const upsertProvider = this.db.prepare(`
        INSERT INTO model_providers (id, name, protocol, base_url, models_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `);
      for (const p of DEFAULT_MODEL_PROVIDERS) {
        upsertProvider.run(
          p.id,
          p.name,
          p.protocol,
          p.baseUrl,
          JSON.stringify(p.models),
          now,
        );
      }

      const upsertSkill = this.db.prepare(`
        INSERT INTO skills_bank (id, slug, title, category, version, prompt_body, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO NOTHING
      `);
      for (const s of DEFAULT_SKILLS_BANK) {
        upsertSkill.run(
          s.id,
          s.slug,
          s.title,
          s.category,
          s.version,
          s.promptBody,
          s.updatedBy,
          now,
        );
      }
    });
  }

  getMeta<T>(key: string): T | null {
    const row = this.db
      .prepare('SELECT value_json FROM meta_kv WHERE key = ?')
      .get(key) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return parseJson<T | null>(str(row, 'value_json'), null);
  }

  setMeta(
    key: string,
    value: unknown,
    nowIso = new Date().toISOString(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO meta_kv (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), nowIso);
  }

  getConstitution(): SoulConstitution {
    return (
      this.getMeta<SoulConstitution>('soul_constitution') ??
      DEFAULT_CONSTITUTION
    );
  }

  saveConstitution(
    markdown: string,
    blockedCommands: readonly string[],
    actor: string,
  ): SoulConstitution {
    const now = new Date().toISOString();
    const prev = this.getConstitution();
    const next: SoulConstitution = {
      version: prev.version + 1,
      title: prev.title,
      markdown,
      blockedCommands,
      updatedBy: actor,
      updatedAt: now,
    };
    this.atomic(() => {
      this.setMeta('soul_constitution', next, now);
      this.appendAudit({
        hubId: null,
        changeId: null,
        category: 'constitution',
        actor,
        title: `Soul Constitution upgraded to v${next.version}`,
        detail: `Updated constitutional rules (${blockedCommands.length} blocked redlines).`,
      });
    });
    return next;
  }

  getDaemons(): DaemonStatus[] {
    return [
      ...(this.getMeta<readonly DaemonStatus[]>('daemons') ?? DEFAULT_DAEMONS),
    ];
  }

  updateDaemon(
    id: DaemonStatus['id'],
    patch: Partial<
      Pick<
        DaemonStatus,
        'enabled' | 'runningPass' | 'lastRunAt' | 'lastSummary'
      >
    >,
  ): DaemonStatus[] {
    const current = this.getDaemons();
    const next = current.map(d => (d.id === id ? {...d, ...patch} : d));
    this.setMeta('daemons', next);
    return next;
  }

  // --- Federation Hubs & Repositories ---

  createHub(input: {
    id?: string;
    name: string;
    rootPath: string;
    description: string;
    agentWikiSummary?: string;
    permissionTier: PermissionTier;
  }): FederationHub {
    const now = new Date().toISOString();
    const id = input.id ?? `hub-${randomUUID().slice(0, 8)}`;
    return this.atomic(() => {
      this.db
        .prepare(
          `INSERT INTO hubs (id, name, root_path, description, agent_wiki_summary, permission_tier, last_human_interaction_at, spaced_review_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          id,
          input.name,
          input.rootPath,
          input.description,
          input.agentWikiSummary ?? '',
          input.permissionTier,
          now,
          now,
        );

      // Seed the 5 standard enterprise collaboration rooms for this Hub.
      const defaultRooms: Array<{
        name: string;
        scenario: RoomScenario;
        topic: string;
      }> = [
        {
          name: 'req-grill',
          scenario: 'req-grill',
          topic:
            'Cross-repo requirement stress-testing & DDD Ubiquitous Language closure (G1)',
        },
        {
          name: 'arch-council',
          scenario: 'arch-council',
          topic: 'Architecture trade-offs, bounded contexts & ADR locking',
        },
        {
          name: 'triage-ops',
          scenario: 'triage-ops',
          topic: 'Gate failure forensics & dynamic GhostNode plan amendments',
        },
        {
          name: 'direct-ops',
          scenario: 'direct-ops',
          topic: 'Interactive @agent commands & Promote-to-Change consensus',
        },
        {
          name: 'exec-briefing',
          scenario: 'exec-briefing',
          topic: 'Quiet multi-repository overnight progress digests',
        },
      ];
      const insertRoom = this.db.prepare(
        'INSERT INTO rooms (id, hub_id, name, scenario, topic, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const r of defaultRooms) {
        insertRoom.run(
          `room-${id}-${r.name}`,
          id,
          r.name,
          r.scenario,
          r.topic,
          now,
        );
      }

      return this.getHub(id)!;
    });
  }

  getHub(id: string): FederationHub | null {
    const row = this.db.prepare('SELECT * FROM hubs WHERE id = ?').get(id) as
      SqlRow | undefined;
    return row ? this.mapHub(row) : null;
  }

  listHubs(includeArchived = false): FederationHub[] {
    const sql = includeArchived
      ? 'SELECT * FROM hubs ORDER BY created_at ASC'
      : 'SELECT * FROM hubs WHERE archived_at IS NULL ORDER BY created_at ASC';
    const rows = this.db.prepare(sql).all() as SqlRow[];
    return rows.map(r => this.mapHub(r));
  }

  touchHubHumanAnchor(
    hubId: string,
    incrementSpacedReview: boolean,
  ): FederationHub {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE hubs
         SET last_human_interaction_at = ?,
             spaced_review_count = spaced_review_count + ?
         WHERE id = ?`,
      )
      .run(now, incrementSpacedReview ? 1 : 0, hubId);
    const hub = this.getHub(hubId);
    if (!hub) {
      throw new ForgeError('NOT_FOUND', `Hub "${hubId}" not found`, 404);
    }
    return hub;
  }

  updateHubWiki(hubId: string, agentWikiSummary: string): void {
    this.db
      .prepare('UPDATE hubs SET agent_wiki_summary = ? WHERE id = ?')
      .run(agentWikiSummary, hubId);
  }

  private mapHub(row: SqlRow): FederationHub {
    return {
      id: str(row, 'id'),
      name: str(row, 'name'),
      rootPath: str(row, 'root_path'),
      description: str(row, 'description'),
      agentWikiSummary: str(row, 'agent_wiki_summary'),
      permissionTier: str(row, 'permission_tier') as PermissionTier,
      lastHumanInteractionAt: str(row, 'last_human_interaction_at'),
      spacedReviewCount: num(row, 'spaced_review_count'),
      createdAt: str(row, 'created_at'),
      archivedAt: nullableStr(row, 'archived_at'),
    };
  }

  registerRepository(input: {
    id?: string;
    hubId: string;
    name: string;
    tier: RepoTier;
    localPath: string;
    defaultBranch?: string;
    verifyCommand: string;
    contractSummary: string;
    boundedContext: string;
  }): RepositoryEntry {
    const now = new Date().toISOString();
    const id = input.id ?? `repo-${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO repositories
         (id, hub_id, name, tier, local_path, default_branch, verify_command, contract_summary, bounded_context, last_human_interaction_at, spaced_review_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        id,
        input.hubId,
        input.name,
        input.tier,
        input.localPath,
        input.defaultBranch ?? 'main',
        input.verifyCommand,
        input.contractSummary,
        input.boundedContext,
        now,
        now,
      );
    return this.getRepository(id)!;
  }

  getRepository(id: string): RepositoryEntry | null {
    const row = this.db
      .prepare('SELECT * FROM repositories WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row ? this.mapRepository(row) : null;
  }

  listRepositories(hubId?: string): RepositoryEntry[] {
    const rows = (
      hubId
        ? this.db
            .prepare(
              'SELECT * FROM repositories WHERE hub_id = ? ORDER BY tier ASC, created_at ASC',
            )
            .all(hubId)
        : this.db
            .prepare(
              'SELECT * FROM repositories ORDER BY tier ASC, created_at ASC',
            )
            .all()
    ) as SqlRow[];
    return rows.map(r => this.mapRepository(r));
  }

  private mapRepository(row: SqlRow): RepositoryEntry {
    return {
      id: str(row, 'id'),
      hubId: str(row, 'hub_id'),
      name: str(row, 'name'),
      tier: str(row, 'tier') as RepoTier,
      localPath: str(row, 'local_path'),
      defaultBranch: str(row, 'default_branch'),
      verifyCommand: str(row, 'verify_command'),
      contractSummary: str(row, 'contract_summary'),
      boundedContext: str(row, 'bounded_context'),
      lastHumanInteractionAt: str(row, 'last_human_interaction_at'),
      spacedReviewCount: num(row, 'spaced_review_count'),
      createdAt: str(row, 'created_at'),
    };
  }

  // --- DDD Ubiquitous Language Registry ---

  upsertDomainTerm(input: {
    id?: string;
    hubId: string;
    boundedContext: string;
    owningRepoIds: readonly string[];
    canonicalTerm: string;
    localLabel: string;
    definition: string;
    forbiddenAliases: readonly string[];
    schemaAnchors: readonly string[];
  }): DomainTermEntry {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(
        'SELECT id, created_at FROM domain_terms WHERE hub_id = ? AND canonical_term = ?',
      )
      .get(input.hubId, input.canonicalTerm) as SqlRow | undefined;
    const id =
      input.id ??
      (existing ? str(existing, 'id') : `ddd-${randomUUID().slice(0, 8)}`);
    const createdAt = existing ? str(existing, 'created_at') : now;

    this.db
      .prepare(
        `INSERT INTO domain_terms
         (id, hub_id, bounded_context, owning_repo_ids_json, canonical_term, local_label, definition, forbidden_aliases_json, schema_anchors_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           bounded_context = excluded.bounded_context,
           owning_repo_ids_json = excluded.owning_repo_ids_json,
           canonical_term = excluded.canonical_term,
           local_label = excluded.local_label,
           definition = excluded.definition,
           forbidden_aliases_json = excluded.forbidden_aliases_json,
           schema_anchors_json = excluded.schema_anchors_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.hubId,
        input.boundedContext,
        JSON.stringify(input.owningRepoIds),
        input.canonicalTerm,
        input.localLabel,
        input.definition,
        JSON.stringify(input.forbiddenAliases),
        JSON.stringify(input.schemaAnchors),
        createdAt,
        now,
      );
    return this.listDomainTerms(input.hubId).find(t => t.id === id)!;
  }

  listDomainTerms(hubId?: string): DomainTermEntry[] {
    const rows = (
      hubId
        ? this.db
            .prepare(
              'SELECT * FROM domain_terms WHERE hub_id = ? ORDER BY bounded_context ASC, canonical_term ASC',
            )
            .all(hubId)
        : this.db
            .prepare(
              'SELECT * FROM domain_terms ORDER BY bounded_context ASC, canonical_term ASC',
            )
            .all()
    ) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      boundedContext: str(r, 'bounded_context'),
      owningRepoIds: parseJson<string[]>(str(r, 'owning_repo_ids_json'), []),
      canonicalTerm: str(r, 'canonical_term'),
      localLabel: str(r, 'local_label'),
      definition: str(r, 'definition'),
      forbiddenAliases: parseJson<string[]>(
        str(r, 'forbidden_aliases_json'),
        [],
      ),
      schemaAnchors: parseJson<string[]>(str(r, 'schema_anchors_json'), []),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
    }));
  }

  // --- Changes, Twin Graph & Checkpoints ---

  createChange(input: {
    id?: string;
    hubId: string;
    repoId: string;
    crossRepoEpicId?: string | null;
    code: string;
    title: string;
    summary: string;
    specMarkdown: string;
    status: ChangeStatus;
    permissionTier: PermissionTier;
    worktreePath: string;
    gitBranch: string;
    baseCommitSha: string;
    verifyCommand: string;
    acceptanceCriteria: readonly AcceptanceCriterion[];
    team: ChangeTeamConfig;
    budgetUsdLimit?: number;
    maxOvernightHours?: number;
  }): ChangeRecord {
    const now = new Date().toISOString();
    const id = input.id ?? `chg-${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO changes
         (id, hub_id, repo_id, cross_repo_epic_id, code, title, summary, spec_markdown, status, permission_tier, worktree_path, git_branch, base_commit_sha, verify_command, acceptance_json, team_json, quality_score, budget_usd_limit, spent_usd, max_overnight_hours, premature_stop_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, 0, ?, ?)`,
      )
      .run(
        id,
        input.hubId,
        input.repoId,
        input.crossRepoEpicId ?? null,
        input.code,
        input.title,
        input.summary,
        input.specMarkdown,
        input.status,
        input.permissionTier,
        input.worktreePath,
        input.gitBranch,
        input.baseCommitSha,
        input.verifyCommand,
        JSON.stringify(input.acceptanceCriteria),
        JSON.stringify(input.team),
        input.budgetUsdLimit ?? 25,
        input.maxOvernightHours ?? 8,
        now,
        now,
      );
    return this.getChange(id)!;
  }

  getChange(id: string): ChangeRecord | null {
    const row = this.db
      .prepare('SELECT * FROM changes WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row ? this.mapChange(row) : null;
  }

  listChanges(hubId?: string, includeArchived = false): ChangeRecord[] {
    let sql = 'SELECT * FROM changes WHERE 1=1';
    const params: string[] = [];
    if (hubId) {
      sql += ' AND hub_id = ?';
      params.push(hubId);
    }
    if (!includeArchived) {
      sql += " AND status != 'archived'";
    }
    sql += ' ORDER BY updated_at DESC';
    const rows = this.db.prepare(sql).all(...params) as SqlRow[];
    return rows.map(r => this.mapChange(r));
  }

  updateChange(
    changeId: string,
    patch: Partial<{
      status: ChangeStatus;
      specMarkdown: string;
      worktreePath: string;
      gitBranch: string;
      baseCommitSha: string;
      acceptanceCriteria: readonly AcceptanceCriterion[];
      team: ChangeTeamConfig;
      qualityScore: number;
      spentUsd: number;
      prematureStopCount: number;
      cooldownUntil: string | null;
      permissionTier: PermissionTier;
    }>,
  ): ChangeRecord {
    const cur = this.getChange(changeId);
    if (!cur) {
      throw new ForgeError('NOT_FOUND', `Change "${changeId}" not found`, 404);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE changes SET
           status = ?,
           spec_markdown = ?,
           worktree_path = ?,
           git_branch = ?,
           base_commit_sha = ?,
           acceptance_json = ?,
           team_json = ?,
           quality_score = ?,
           spent_usd = ?,
           premature_stop_count = ?,
           cooldown_until = ?,
           permission_tier = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? cur.status,
        patch.specMarkdown ?? cur.specMarkdown,
        patch.worktreePath ?? cur.worktreePath,
        patch.gitBranch ?? cur.gitBranch,
        patch.baseCommitSha ?? cur.baseCommitSha,
        JSON.stringify(patch.acceptanceCriteria ?? cur.acceptanceCriteria),
        JSON.stringify(patch.team ?? cur.team),
        patch.qualityScore ?? cur.qualityScore,
        patch.spentUsd ?? cur.spentUsd,
        patch.prematureStopCount ?? cur.prematureStopCount,
        patch.cooldownUntil !== undefined
          ? patch.cooldownUntil
          : cur.cooldownUntil,
        patch.permissionTier ?? cur.permissionTier,
        now,
        changeId,
      );
    return this.getChange(changeId)!;
  }

  /**
   * Archives ONLY the specified Change — never archiving the parent Hub or Repository.
   */
  archiveChange(changeId: string): ChangeRecord {
    return this.updateChange(changeId, {status: 'archived'});
  }

  private mapChange(row: SqlRow): ChangeRecord {
    return {
      id: str(row, 'id'),
      hubId: str(row, 'hub_id'),
      repoId: str(row, 'repo_id'),
      crossRepoEpicId: nullableStr(row, 'cross_repo_epic_id'),
      code: str(row, 'code'),
      title: str(row, 'title'),
      summary: str(row, 'summary'),
      specMarkdown: str(row, 'spec_markdown'),
      status: str(row, 'status') as ChangeStatus,
      permissionTier: str(row, 'permission_tier') as PermissionTier,
      worktreePath: str(row, 'worktree_path'),
      gitBranch: str(row, 'git_branch'),
      baseCommitSha: str(row, 'base_commit_sha'),
      verifyCommand: str(row, 'verify_command'),
      acceptanceCriteria: parseJson<AcceptanceCriterion[]>(
        str(row, 'acceptance_json'),
        [],
      ),
      team: parseJson<ChangeTeamConfig>(str(row, 'team_json'), {
        leadAdapterId: 'native-api',
        leadModel: 'deepseek-reasoner',
        workerAdapterId: 'native-api',
        workerModel: 'deepseek-chat',
        juniorAuditModel: 'deepseek-chat',
        seniorAuditModel: 'deepseek-reasoner',
        maxRetryLoops: 3,
      }),
      qualityScore: num(row, 'quality_score'),
      budgetUsdLimit: num(row, 'budget_usd_limit'),
      spentUsd: num(row, 'spent_usd'),
      maxOvernightHours: num(row, 'max_overnight_hours'),
      prematureStopCount: num(row, 'premature_stop_count'),
      cooldownUntil: nullableStr(row, 'cooldown_until'),
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at'),
    };
  }

  saveTwinGraph(
    changeId: string,
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
  ): void {
    this.atomic(() => {
      this.db
        .prepare('DELETE FROM graph_edges WHERE change_id = ?')
        .run(changeId);
      this.db
        .prepare('DELETE FROM graph_nodes WHERE change_id = ?')
        .run(changeId);

      const insNode = this.db.prepare(`
        INSERT INTO graph_nodes
        (id, change_id, code, parent_wbs_id, container_node_id, kind, title, description, file_scope_json, gate_command, assigned_role, assigned_adapter_id, assigned_model, status, attempt_count, max_attempts, collapsed, position_x, position_y, width, height, output_summary, restore_target_checkpoint_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const n of nodes) {
        insNode.run(
          n.id,
          changeId,
          n.code,
          n.parentWbsId,
          n.containerNodeId,
          n.kind,
          n.title,
          n.description,
          JSON.stringify(n.fileScope),
          n.gateCommand,
          n.assignedRole,
          n.assignedAdapterId,
          n.assignedModel,
          n.status,
          n.attemptCount,
          n.maxAttempts,
          n.collapsed ? 1 : 0,
          n.positionX,
          n.positionY,
          n.width,
          n.height,
          n.outputSummary,
          n.restoreTargetCheckpointId,
          n.updatedAt,
        );
      }

      const insEdge = this.db.prepare(`
        INSERT INTO graph_edges (id, change_id, source_node_id, target_node_id, kind, label)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const e of edges) {
        insEdge.run(
          e.id,
          changeId,
          e.sourceNodeId,
          e.targetNodeId,
          e.kind,
          e.label,
        );
      }
    });
  }

  listGraphNodes(changeId: string): GraphNode[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM graph_nodes WHERE change_id = ? ORDER BY position_y ASC, position_x ASC',
      )
      .all(changeId) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      changeId: str(r, 'change_id'),
      code: str(r, 'code'),
      parentWbsId: nullableStr(r, 'parent_wbs_id'),
      containerNodeId: nullableStr(r, 'container_node_id'),
      kind: str(r, 'kind') as GraphNode['kind'],
      title: str(r, 'title'),
      description: str(r, 'description'),
      fileScope: parseJson<string[]>(str(r, 'file_scope_json'), []),
      gateCommand: nullableStr(r, 'gate_command'),
      assignedRole: str(r, 'assigned_role') as AgentRole,
      assignedAdapterId: nullableStr(r, 'assigned_adapter_id'),
      assignedModel: nullableStr(r, 'assigned_model'),
      status: str(r, 'status') as GraphNodeStatus,
      attemptCount: num(rowOrEmpty(r), 'attempt_count'),
      maxAttempts: num(rowOrEmpty(r), 'max_attempts'),
      collapsed: num(rowOrEmpty(r), 'collapsed') === 1,
      positionX: num(rowOrEmpty(r), 'position_x'),
      positionY: num(rowOrEmpty(r), 'position_y'),
      width: num(rowOrEmpty(r), 'width'),
      height: num(rowOrEmpty(r), 'height'),
      outputSummary: str(r, 'output_summary'),
      restoreTargetCheckpointId: nullableStr(r, 'restore_target_checkpoint_id'),
      updatedAt: str(r, 'updated_at'),
    }));
  }

  listGraphEdges(changeId: string): GraphEdge[] {
    const rows = this.db
      .prepare('SELECT * FROM graph_edges WHERE change_id = ?')
      .all(changeId) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      changeId: str(r, 'change_id'),
      sourceNodeId: str(r, 'source_node_id'),
      targetNodeId: str(r, 'target_node_id'),
      kind: str(r, 'kind') as GraphEdge['kind'],
      label: str(r, 'label'),
    }));
  }

  updateGraphNode(
    nodeId: string,
    patch: Partial<{
      status: GraphNodeStatus;
      attemptCount: number;
      collapsed: boolean;
      outputSummary: string;
      assignedAdapterId: string | null;
      assignedModel: string | null;
    }>,
  ): void {
    const row = this.db
      .prepare('SELECT * FROM graph_nodes WHERE id = ?')
      .get(nodeId) as SqlRow | undefined;
    if (!row) {
      throw new ForgeError(
        'NOT_FOUND',
        `Graph node "${nodeId}" not found`,
        404,
      );
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE graph_nodes SET
           status = ?,
           attempt_count = ?,
           collapsed = ?,
           output_summary = ?,
           assigned_adapter_id = ?,
           assigned_model = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? str(row, 'status'),
        patch.attemptCount ?? num(row, 'attempt_count'),
        patch.collapsed !== undefined
          ? patch.collapsed
            ? 1
            : 0
          : num(row, 'collapsed'),
        patch.outputSummary ?? str(row, 'output_summary'),
        patch.assignedAdapterId !== undefined
          ? patch.assignedAdapterId
          : nullableStr(row, 'assigned_adapter_id'),
        patch.assignedModel !== undefined
          ? patch.assignedModel
          : nullableStr(row, 'assigned_model'),
        now,
        nodeId,
      );
  }

  recordCheckpoint(input: {
    id?: string;
    changeId: string;
    nodeId: string;
    label: string;
    gitCommitSha: string;
    gitTag: string;
    rescueRef?: string | null;
    certifiedTaskCount: number;
    totalTaskCount: number;
    engineSnapshot?: unknown;
  }): CheckpointRecord {
    const now = new Date().toISOString();
    const id = input.id ?? `cp-${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO checkpoints
         (id, change_id, node_id, label, git_commit_sha, git_tag, rescue_ref, certified_task_count, total_task_count, engine_snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.changeId,
        input.nodeId,
        input.label,
        input.gitCommitSha,
        input.gitTag,
        input.rescueRef ?? null,
        input.certifiedTaskCount,
        input.totalTaskCount,
        JSON.stringify(input.engineSnapshot ?? {}),
        now,
      );
    return this.listCheckpoints(input.changeId).find(c => c.id === id)!;
  }

  listCheckpoints(changeId: string): CheckpointRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM checkpoints WHERE change_id = ? ORDER BY created_at ASC',
      )
      .all(changeId) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      changeId: str(r, 'change_id'),
      nodeId: str(r, 'node_id'),
      label: str(r, 'label'),
      gitCommitSha: str(r, 'git_commit_sha'),
      gitTag: str(r, 'git_tag'),
      rescueRef: nullableStr(r, 'rescue_ref'),
      certifiedTaskCount: num(r, 'certified_task_count'),
      totalTaskCount: num(r, 'total_task_count'),
      createdAt: str(r, 'created_at'),
    }));
  }

  updateCheckpointRescueRef(checkpointId: string, rescueRef: string): void {
    this.db
      .prepare('UPDATE checkpoints SET rescue_ref = ? WHERE id = ?')
      .run(rescueRef, checkpointId);
  }

  // --- Attention Queue ---

  raiseAttention(input: {
    hubId: string;
    repoId?: string | null;
    changeId?: string | null;
    nodeId?: string | null;
    threadId?: string | null;
    kind: AttentionItem['kind'];
    question: string;
    contextSnippet: string;
    options: readonly string[];
    recommendedIndex?: number;
    downstreamBlockedCount?: number;
    estimatedReadSeconds?: number;
  }): AttentionItem {
    const now = new Date().toISOString();
    const id = `attn-${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO attention_queue
         (id, hub_id, repo_id, change_id, node_id, thread_id, kind, question, context_snippet, options_json, recommended_index, downstream_blocked_count, estimated_read_seconds, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        id,
        input.hubId,
        input.repoId ?? null,
        input.changeId ?? null,
        input.nodeId ?? null,
        input.threadId ?? null,
        input.kind,
        input.question,
        input.contextSnippet,
        JSON.stringify(input.options),
        input.recommendedIndex ?? 0,
        input.downstreamBlockedCount ?? 1,
        input.estimatedReadSeconds ?? 25,
        now,
      );
    return this.listAttentionItems(true).find(a => a.id === id)!;
  }

  resolveAttention(
    id: string,
    resolution: string,
    status: 'answered' | 'dismissed' = 'answered',
  ): AttentionItem {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE attention_queue SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?',
      )
      .run(status, resolution, now, id);
    const item = this.listAttentionItems(true).find(a => a.id === id);
    if (!item) {
      throw new ForgeError(
        'NOT_FOUND',
        `Attention item "${id}" not found`,
        404,
      );
    }
    this.touchHubHumanAnchor(item.hubId, false);
    return item;
  }

  listAttentionItems(includeResolved = false): AttentionItem[] {
    const sql = includeResolved
      ? 'SELECT * FROM attention_queue ORDER BY created_at DESC'
      : "SELECT * FROM attention_queue WHERE status = 'open' ORDER BY created_at ASC";
    const rows = this.db.prepare(sql).all() as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      repoId: nullableStr(r, 'repo_id'),
      changeId: nullableStr(r, 'change_id'),
      nodeId: nullableStr(r, 'node_id'),
      threadId: nullableStr(r, 'thread_id'),
      kind: str(r, 'kind') as AttentionItem['kind'],
      question: str(r, 'question'),
      contextSnippet: str(r, 'context_snippet'),
      options: parseJson<string[]>(str(r, 'options_json'), []),
      recommendedIndex: num(r, 'recommended_index'),
      downstreamBlockedCount: num(r, 'downstream_blocked_count'),
      estimatedReadSeconds: num(r, 'estimated_read_seconds'),
      status: str(r, 'status') as AttentionItem['status'],
      resolution: nullableStr(r, 'resolution'),
      createdAt: str(r, 'created_at'),
      resolvedAt: nullableStr(r, 'resolved_at'),
    }));
  }

  // --- Engineering Rooms & Threads ---

  listRooms(hubId?: string): EngineeringRoom[] {
    const rows = (
      hubId
        ? this.db
            .prepare(
              'SELECT * FROM rooms WHERE hub_id = ? ORDER BY created_at ASC',
            )
            .all(hubId)
        : this.db.prepare('SELECT * FROM rooms ORDER BY created_at ASC').all()
    ) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      name: str(r, 'name'),
      scenario: str(r, 'scenario') as RoomScenario,
      topic: str(r, 'topic'),
      createdAt: str(r, 'created_at'),
    }));
  }

  createRoom(input: {
    hubId: string;
    name: string;
    scenario: RoomScenario;
    topic: string;
  }): EngineeringRoom {
    const now = new Date().toISOString();
    const id = `room-${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        'INSERT INTO rooms (id, hub_id, name, scenario, topic, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.hubId, input.name, input.scenario, input.topic, now);
    return this.listRooms(input.hubId).find(r => r.id === id)!;
  }

  createThread(input: {
    roomId: string;
    changeId?: string | null;
    title: string;
    mandateScope: string;
    subscribedAgentIds?: readonly string[];
  }): RoomThread {
    const now = new Date().toISOString();
    const id = `thd-${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO threads (id, room_id, change_id, title, mandate_scope, status, subscribed_agents_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        id,
        input.roomId,
        input.changeId ?? null,
        input.title,
        input.mandateScope,
        JSON.stringify(input.subscribedAgentIds ?? []),
        now,
        now,
      );
    return this.getThread(id)!;
  }

  getThread(id: string): RoomThread | null {
    const r = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as
      SqlRow | undefined;
    if (!r) {
      return null;
    }
    return {
      id: str(r, 'id'),
      roomId: str(r, 'room_id'),
      changeId: nullableStr(r, 'change_id'),
      title: str(r, 'title'),
      mandateScope: str(r, 'mandate_scope'),
      status: str(r, 'status') as RoomThread['status'],
      subscribedAgentIds: parseJson<string[]>(
        str(r, 'subscribed_agents_json'),
        [],
      ),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
    };
  }

  listThreads(roomId?: string): RoomThread[] {
    const rows = (
      roomId
        ? this.db
            .prepare(
              'SELECT * FROM threads WHERE room_id = ? ORDER BY updated_at DESC',
            )
            .all(roomId)
        : this.db
            .prepare('SELECT * FROM threads ORDER BY updated_at DESC')
            .all()
    ) as SqlRow[];
    return rows.map(r => this.getThread(str(r, 'id'))!);
  }

  markThreadPromoted(threadId: string, changeId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE threads SET status = 'promoted', change_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(changeId, now, threadId);
  }

  appendRoomMessage(input: {
    roomId: string;
    threadId?: string | null;
    authorKind: RoomMessage['authorKind'];
    authorId: string;
    authorLabel: string;
    mentions?: readonly string[];
    bodyMarkdown: string;
    metadata?: Record<string, unknown>;
  }): RoomMessage {
    const now = new Date().toISOString();
    const id = `msg-${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO room_messages
         (id, room_id, thread_id, author_kind, author_id, author_label, mentions_json, body_markdown, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.roomId,
        input.threadId ?? null,
        input.authorKind,
        input.authorId,
        input.authorLabel,
        JSON.stringify(input.mentions ?? []),
        input.bodyMarkdown,
        JSON.stringify(input.metadata ?? {}),
        now,
      );
    if (input.threadId) {
      this.db
        .prepare('UPDATE threads SET updated_at = ? WHERE id = ?')
        .run(now, input.threadId);
    }
    return {
      id,
      roomId: input.roomId,
      threadId: input.threadId ?? null,
      authorKind: input.authorKind,
      authorId: input.authorId,
      authorLabel: input.authorLabel,
      mentions: input.mentions ?? [],
      bodyMarkdown: input.bodyMarkdown,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
    };
  }

  listRoomMessages(roomId: string, limit = 200): RoomMessage[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM room_messages WHERE room_id = ? ORDER BY created_at ASC LIMIT ?',
      )
      .all(roomId, limit) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      roomId: str(r, 'room_id'),
      threadId: nullableStr(r, 'thread_id'),
      authorKind: str(r, 'author_kind') as RoomMessage['authorKind'],
      authorId: str(r, 'author_id'),
      authorLabel: str(r, 'author_label'),
      mentions: parseJson<string[]>(str(r, 'mentions_json'), []),
      bodyMarkdown: str(r, 'body_markdown'),
      metadataJson: str(r, 'metadata_json'),
      createdAt: str(r, 'created_at'),
    }));
  }

  // --- Unified FTS5 Transcripts & Bi-Temporal Semantic Memories ---

  startSession(input: {
    id?: string;
    hubId: string;
    changeId?: string | null;
    nodeId?: string | null;
    adapterId: string;
    model: string;
    role: AgentRole;
  }): TranscriptSession {
    const now = new Date().toISOString();
    const id = input.id ?? `sess-${randomUUID().slice(0, 10)}`;
    this.db
      .prepare(
        `INSERT INTO sessions (id, hub_id, change_id, node_id, adapter_id, model, role, started_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')`,
      )
      .run(
        id,
        input.hubId,
        input.changeId ?? null,
        input.nodeId ?? null,
        input.adapterId,
        input.model,
        input.role,
        now,
      );
    return {
      id,
      hubId: input.hubId,
      changeId: input.changeId ?? null,
      nodeId: input.nodeId ?? null,
      adapterId: input.adapterId,
      model: input.model,
      role: input.role,
      startedAt: now,
      endedAt: null,
      status: 'running',
    };
  }

  finishSession(
    sessionId: string,
    status: Exclude<TranscriptSession['status'], 'running'>,
  ): void {
    this.db
      .prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), sessionId);
  }

  appendTranscriptMessage(input: {
    sessionId: string;
    role: TranscriptMessage['role'];
    content: string;
    toolName?: string | null;
    isError?: boolean;
    inputTokens?: number;
    cachedTokens?: number;
    outputTokens?: number;
  }): TranscriptMessage {
    const now = new Date().toISOString();
    const id = `tmsg-${randomUUID().slice(0, 10)}`;
    const seqRow = this.db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM messages WHERE session_id = ?',
      )
      .get(input.sessionId) as SqlRow;
    const seq = num(seqRow, 'next_seq');

    this.db
      .prepare(
        `INSERT INTO messages
         (id, session_id, seq, role, content, tool_name, is_error, input_tokens, cached_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        seq,
        input.role,
        input.content,
        input.toolName ?? null,
        input.isError ? 1 : 0,
        input.inputTokens ?? 0,
        input.cachedTokens ?? 0,
        input.outputTokens ?? 0,
        now,
      );
    return {
      id,
      sessionId: input.sessionId,
      seq,
      role: input.role,
      content: input.content,
      toolName: input.toolName ?? null,
      isError: Boolean(input.isError),
      inputTokens: input.inputTokens ?? 0,
      cachedTokens: input.cachedTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      createdAt: now,
    };
  }

  listSessionMessages(sessionId: string): TranscriptMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      sessionId: str(r, 'session_id'),
      seq: num(r, 'seq'),
      role: str(r, 'role') as TranscriptMessage['role'],
      content: str(r, 'content'),
      toolName: nullableStr(r, 'tool_name'),
      isError: num(r, 'is_error') === 1,
      inputTokens: num(r, 'input_tokens'),
      cachedTokens: num(r, 'cached_tokens'),
      outputTokens: num(r, 'output_tokens'),
      createdAt: str(r, 'created_at'),
    }));
  }

  listSessions(filter?: {
    changeId?: string;
    hubId?: string;
    limit?: number;
  }): TranscriptSession[] {
    let sql = 'SELECT * FROM sessions WHERE 1=1';
    const params: Array<string | number> = [];
    if (filter?.changeId) {
      sql += ' AND change_id = ?';
      params.push(filter.changeId);
    }
    if (filter?.hubId) {
      sql += ' AND hub_id = ?';
      params.push(filter.hubId);
    }
    sql += ' ORDER BY started_at DESC LIMIT ?';
    params.push(filter?.limit ?? 60);
    const rows = this.db.prepare(sql).all(...params) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      changeId: nullableStr(r, 'change_id'),
      nodeId: nullableStr(r, 'node_id'),
      adapterId: str(r, 'adapter_id'),
      model: str(r, 'model'),
      role: str(r, 'role') as AgentRole,
      startedAt: str(r, 'started_at'),
      endedAt: nullableStr(r, 'ended_at'),
      status: str(r, 'status') as TranscriptSession['status'],
    }));
  }

  /**
   * Full-text search across cross-harness execution transcripts using FTS5.
   */
  searchEvidenceFts(
    rawQuery: string,
    hubId?: string,
    limit = 25,
  ): EvidenceSearchHit[] {
    const sanitized = rawQuery
      .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(tok => `"${tok}"`)
      .join(' OR ');
    if (!sanitized) {
      return [];
    }
    const sql = hubId
      ? `SELECT m.id AS message_id, m.session_id, s.adapter_id, m.role,
                snippet(messages_fts, 2, '[', ']', ' ... ', 20) AS snippet,
                m.created_at
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN sessions s ON s.id = m.session_id
         WHERE messages_fts MATCH ? AND s.hub_id = ?
         ORDER BY rank LIMIT ?`
      : `SELECT m.id AS message_id, m.session_id, s.adapter_id, m.role,
                snippet(messages_fts, 2, '[', ']', ' ... ', 20) AS snippet,
                m.created_at
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN sessions s ON s.id = m.session_id
         WHERE messages_fts MATCH ?
         ORDER BY rank LIMIT ?`;
    const rows = (
      hubId
        ? this.db.prepare(sql).all(sanitized, hubId, limit)
        : this.db.prepare(sql).all(sanitized, limit)
    ) as SqlRow[];
    return rows.map(r => ({
      messageId: str(r, 'message_id'),
      sessionId: str(r, 'session_id'),
      adapterId: str(r, 'adapter_id'),
      role: str(r, 'role'),
      snippet: str(r, 'snippet'),
      createdAt: str(r, 'created_at'),
    }));
  }

  recordSemanticMemory(input: {
    hubId: string;
    repoId?: string | null;
    kind: SemanticMemory['kind'];
    title: string;
    summary: string;
    pathAnchors?: readonly string[];
    sourceSessionId?: string | null;
    supersedesMemoryId?: string | null;
    stabilityHours?: number;
  }): SemanticMemory {
    const now = new Date().toISOString();
    const id = `mem-${randomUUID().slice(0, 8)}`;
    return this.atomic(() => {
      if (input.supersedesMemoryId) {
        this.db
          .prepare(
            'UPDATE semantic_memories SET valid_until = ?, superseded_by_id = ? WHERE id = ? AND valid_until IS NULL',
          )
          .run(now, id, input.supersedesMemoryId);
      }
      this.db
        .prepare(
          `INSERT INTO semantic_memories
           (id, hub_id, repo_id, kind, title, summary, path_anchors_json, source_session_id, valid_from, stability_hours, recall_count, last_recalled_at, stale_suspect, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
        )
        .run(
          id,
          input.hubId,
          input.repoId ?? null,
          input.kind,
          input.title,
          input.summary,
          JSON.stringify(input.pathAnchors ?? []),
          input.sourceSessionId ?? null,
          now,
          input.stabilityHours ?? 36,
          now,
          now,
        );
      return this.listSemanticMemories({
        hubId: input.hubId,
        includeSuperseded: true,
      }).find(m => m.id === id)!;
    });
  }

  supersedeMemory(
    oldMemoryId: string,
    replacementId: string | null = null,
  ): void {
    this.db
      .prepare(
        'UPDATE semantic_memories SET valid_until = ?, superseded_by_id = ? WHERE id = ? AND valid_until IS NULL',
      )
      .run(new Date().toISOString(), replacementId, oldMemoryId);
  }

  reinforceMemory(memoryId: string, nextStabilityHours: number): void {
    this.db
      .prepare(
        `UPDATE semantic_memories
         SET recall_count = recall_count + 1,
             stability_hours = ?,
             last_recalled_at = ?,
             stale_suspect = 0
         WHERE id = ?`,
      )
      .run(nextStabilityHours, new Date().toISOString(), memoryId);
  }

  listSemanticMemories(filter?: {
    hubId?: string;
    includeSuperseded?: boolean;
  }): SemanticMemory[] {
    let sql = 'SELECT * FROM semantic_memories WHERE 1=1';
    const params: string[] = [];
    if (filter?.hubId) {
      sql += ' AND hub_id = ?';
      params.push(filter.hubId);
    }
    if (!filter?.includeSuperseded) {
      sql += ' AND valid_until IS NULL';
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as SqlRow[];
    return rows.map(r => this.mapSemanticMemory(r));
  }

  searchActiveSemanticMemories(
    rawQuery: string,
    hubId: string,
    limit = 10,
  ): SemanticMemory[] {
    const sanitized = rawQuery
      .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(tok => `"${tok}"`)
      .join(' OR ');
    if (!sanitized) {
      return this.listSemanticMemories({hubId}).slice(0, limit);
    }
    const rows = this.db
      .prepare(
        `SELECT sm.*
         FROM memories_fts
         JOIN semantic_memories sm ON sm.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ? AND sm.hub_id = ? AND sm.valid_until IS NULL
         ORDER BY rank LIMIT ?`,
      )
      .all(sanitized, hubId, limit) as SqlRow[];
    return rows.map(r => this.mapSemanticMemory(r));
  }

  private mapSemanticMemory(r: SqlRow): SemanticMemory {
    return {
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      repoId: nullableStr(r, 'repo_id'),
      kind: str(r, 'kind') as SemanticMemory['kind'],
      title: str(r, 'title'),
      summary: str(r, 'summary'),
      pathAnchors: parseJson<string[]>(str(r, 'path_anchors_json'), []),
      sourceSessionId: nullableStr(r, 'source_session_id'),
      validFrom: str(r, 'valid_from'),
      validUntil: nullableStr(r, 'valid_until'),
      supersededById: nullableStr(r, 'superseded_by_id'),
      stabilityHours: num(r, 'stability_hours'),
      recallCount: num(r, 'recall_count'),
      lastRecalledAt: str(r, 'last_recalled_at'),
      staleSuspect: num(r, 'stale_suspect') === 1,
      createdAt: str(r, 'created_at'),
    };
  }

  // --- Live Operational Telemetry, Adapters, Providers & Skills ---

  recordTelemetry(
    input: Omit<ExecutionTelemetryRecord, 'id' | 'createdAt'>,
  ): ExecutionTelemetryRecord {
    const now = new Date().toISOString();
    const id = `tel-${randomUUID().slice(0, 10)}`;
    this.db
      .prepare(
        `INSERT INTO execution_telemetry
         (id, hub_id, change_id, node_id, adapter_id, model, role, outcome, first_pass_certified, premature_stop_triggered, duration_sec, input_tokens, cached_tokens, first_turn_cached_tokens, output_tokens, cost_usd, diagnostic, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.hubId,
        input.changeId,
        input.nodeId,
        input.adapterId,
        input.model,
        input.role,
        input.outcome,
        input.firstPassCertified ? 1 : 0,
        input.prematureStopTriggered ? 1 : 0,
        input.durationSec,
        input.inputTokens,
        input.cachedTokens,
        input.firstTurnCachedTokens,
        input.outputTokens,
        input.costUsd,
        input.diagnostic,
        now,
      );
    return {...input, id, createdAt: now};
  }

  listTelemetryForAdapter(
    adapterId: string,
    limit = 40,
  ): ExecutionTelemetryRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM execution_telemetry WHERE adapter_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(adapterId, limit) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      changeId: str(r, 'change_id'),
      nodeId: str(r, 'node_id'),
      adapterId: str(r, 'adapter_id'),
      model: str(r, 'model'),
      role: str(r, 'role') as AgentRole,
      outcome: str(r, 'outcome') as ExecutionTelemetryRecord['outcome'],
      firstPassCertified: num(r, 'first_pass_certified') === 1,
      prematureStopTriggered: num(r, 'premature_stop_triggered') === 1,
      durationSec: num(r, 'duration_sec'),
      inputTokens: num(r, 'input_tokens'),
      cachedTokens: num(r, 'cached_tokens'),
      firstTurnCachedTokens: num(r, 'first_turn_cached_tokens'),
      outputTokens: num(r, 'output_tokens'),
      costUsd: num(r, 'cost_usd'),
      diagnostic: str(r, 'diagnostic'),
      createdAt: str(r, 'created_at'),
    }));
  }

  upsertAdapterManifest(manifest: AgentAdapterManifest): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO adapters (id, manifest_json, probe_ok, probe_message, probed_at, updated_at)
         VALUES (?, ?, NULL, 'Registered; run Environment Doctor to probe', NULL, ?)
         ON CONFLICT(id) DO UPDATE SET manifest_json = excluded.manifest_json, updated_at = excluded.updated_at`,
      )
      .run(manifest.id, JSON.stringify(manifest), now);
  }

  deleteAdapter(adapterId: string): void {
    const row = this.db
      .prepare('SELECT manifest_json FROM adapters WHERE id = ?')
      .get(adapterId) as SqlRow | undefined;
    if (!row) {
      throw new ForgeError(
        'NOT_FOUND',
        `Adapter "${adapterId}" not found`,
        404,
      );
    }
    const manifest = parseJson<AgentAdapterManifest | null>(
      str(row, 'manifest_json'),
      null,
    );
    if (manifest?.builtIn) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        `Built-in adapter "${adapterId}" cannot be deleted`,
      );
    }
    this.db.prepare('DELETE FROM adapters WHERE id = ?').run(adapterId);
  }

  updateAdapterProbe(adapterId: string, ok: boolean, message: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE adapters SET probe_ok = ?, probe_message = ?, probed_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(ok ? 1 : 0, message, now, now, adapterId);
  }

  listAdapterProfiles(): AdapterOperationalProfile[] {
    const rows = this.db
      .prepare('SELECT * FROM adapters ORDER BY updated_at ASC')
      .all() as SqlRow[];
    return rows.map(r => {
      const manifest = JSON.parse(
        str(r, 'manifest_json'),
      ) as AgentAdapterManifest;
      const probeOkRaw = r['probe_ok'];
      const probeOk = typeof probeOkRaw === 'number' ? probeOkRaw === 1 : null;
      const records = this.listTelemetryForAdapter(manifest.id, 30);
      return computeAdapterOperationalProfile(manifest, records, {
        ok: probeOk,
        message: str(r, 'probe_message'),
        probedAt: nullableStr(r, 'probed_at'),
      });
    });
  }

  pickHealthyAdapter(
    role: AgentRole,
    preferredId?: string | null,
  ): AdapterOperationalProfile {
    const chosen = selectHealthyAdapterForRole(
      this.listAdapterProfiles(),
      role,
      preferredId,
    );
    if (!chosen) {
      throw new ForgeError(
        'ADAPTER_UNAVAILABLE',
        `No healthy adapter available for role "${role}"`,
        503,
      );
    }
    return chosen;
  }

  listModelProviders(
    hasKeyResolver: (providerId: string) => {
      hasApiKey: boolean;
      maskedKeyHint: string;
    },
  ): ModelProviderConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM model_providers ORDER BY id ASC')
      .all() as SqlRow[];
    return rows.map(r => {
      const id = str(r, 'id');
      const keyMeta = hasKeyResolver(id);
      return {
        id,
        name: str(r, 'name'),
        protocol: str(r, 'protocol') as ModelProviderConfig['protocol'],
        baseUrl: str(r, 'base_url'),
        hasApiKey: keyMeta.hasApiKey,
        maskedKeyHint: keyMeta.maskedKeyHint,
        models: parseJson<ModelCatalogEntry[]>(str(r, 'models_json'), []),
        updatedAt: str(r, 'updated_at'),
      };
    });
  }

  updateModelProviderEndpoint(providerId: string, baseUrl: string): void {
    this.db
      .prepare(
        'UPDATE model_providers SET base_url = ?, updated_at = ? WHERE id = ?',
      )
      .run(baseUrl, new Date().toISOString(), providerId);
  }

  listSkills(): SkillEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM skills_bank ORDER BY category ASC, slug ASC')
      .all() as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      slug: str(r, 'slug'),
      title: str(r, 'title'),
      category: str(r, 'category') as SkillEntry['category'],
      version: str(r, 'version'),
      promptBody: str(r, 'prompt_body'),
      updatedBy: str(r, 'updated_by'),
      updatedAt: str(r, 'updated_at'),
    }));
  }

  upsertSkill(input: {
    slug: string;
    title: string;
    category: SkillEntry['category'];
    version: string;
    promptBody: string;
    updatedBy: string;
  }): SkillEntry {
    const now = new Date().toISOString();
    const id = `skill-${input.slug}`;
    this.db
      .prepare(
        `INSERT INTO skills_bank (id, slug, title, category, version, prompt_body, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           title = excluded.title,
           category = excluded.category,
           version = excluded.version,
           prompt_body = excluded.prompt_body,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.slug,
        input.title,
        input.category,
        input.version,
        input.promptBody,
        input.updatedBy,
        now,
      );
    return this.listSkills().find(s => s.slug === input.slug)!;
  }

  // --- Durable Effects Outbox & Audit Ledger ---

  enqueueEffect(
    kind: string,
    dedupeKey: string,
    payload: unknown,
    delayMs = 0,
  ): void {
    const nowMs = Date.now();
    const dueIso = new Date(nowMs + Math.max(0, delayMs)).toISOString();
    const nowIso = new Date(nowMs).toISOString();
    this.db
      .prepare(
        `INSERT INTO effects_outbox (id, kind, dedupe_key, payload_json, attempts, next_due_at, last_error, created_at)
         VALUES (?, ?, ?, ?, 0, ?, '', ?)
         ON CONFLICT(dedupe_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           next_due_at = excluded.next_due_at`,
      )
      .run(
        `eff-${randomUUID().slice(0, 10)}`,
        kind,
        dedupeKey,
        JSON.stringify(payload),
        dueIso,
        nowIso,
      );
  }

  claimDueEffects(
    nowIso = new Date().toISOString(),
    limit = 10,
  ): OutboxEffectRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM effects_outbox WHERE next_due_at <= ? ORDER BY next_due_at ASC LIMIT ?',
      )
      .all(nowIso, limit) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      kind: str(r, 'kind'),
      dedupeKey: str(r, 'dedupe_key'),
      payloadJson: str(r, 'payload_json'),
      attempts: num(r, 'attempts'),
      nextDueAt: str(r, 'next_due_at'),
      lastError: str(r, 'last_error'),
      createdAt: str(r, 'created_at'),
    }));
  }

  completeEffect(id: string): void {
    this.db.prepare('DELETE FROM effects_outbox WHERE id = ?').run(id);
  }

  rescheduleEffect(
    id: string,
    attempts: number,
    backoffMs: number,
    errorMsg: string,
  ): void {
    const nextIso = new Date(Date.now() + backoffMs).toISOString();
    this.db
      .prepare(
        'UPDATE effects_outbox SET attempts = ?, next_due_at = ?, last_error = ? WHERE id = ?',
      )
      .run(attempts, nextIso, errorMsg.slice(0, 1024), id);
  }

  appendAudit(input: {
    hubId: string | null;
    changeId: string | null;
    category: AuditLedgerEntry['category'];
    actor: string;
    title: string;
    detail: string;
  }): AuditLedgerEntry {
    const now = new Date().toISOString();
    const id = `aud-${randomUUID().slice(0, 10)}`;
    this.db
      .prepare(
        `INSERT INTO audit_ledger (id, hub_id, change_id, category, author, title, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.hubId,
        input.changeId,
        input.category,
        input.actor,
        input.title,
        input.detail,
        now,
      );
    return {
      id,
      hubId: input.hubId,
      changeId: input.changeId,
      category: input.category,
      actor: input.actor,
      title: input.title,
      detail: input.detail,
      createdAt: now,
    };
  }

  listAuditLedger(limit = 80, hubId?: string): AuditLedgerEntry[] {
    const rows = (
      hubId
        ? this.db
            .prepare(
              'SELECT * FROM audit_ledger WHERE hub_id = ? OR hub_id IS NULL ORDER BY created_at DESC LIMIT ?',
            )
            .all(hubId, limit)
        : this.db
            .prepare(
              'SELECT * FROM audit_ledger ORDER BY created_at DESC LIMIT ?',
            )
            .all(limit)
    ) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      hubId: nullableStr(r, 'hub_id'),
      changeId: nullableStr(r, 'change_id'),
      category: str(r, 'category') as AuditLedgerEntry['category'],
      actor: str(r, 'author'),
      title: str(r, 'title'),
      detail: str(r, 'detail'),
      createdAt: str(r, 'created_at'),
    }));
  }
}

function rowOrEmpty(r: SqlRow): SqlRow {
  return r;
}

import {randomUUID} from 'node:crypto';
import type {
  ExecutionMode,
  LivingDocKind,
  MemoryAuthorityTier,
  MemoryChunkRecord,
  MemoryDocumentRecord,
  MemoryEdgeRecord,
  MemoryEntityRecord,
  MemoryFactKind,
  MemoryFactRecord,
  MemoryLivingDocRecord,
  MemoryObservationRecord,
  ObservationBeliefStatus,
  ObservationHistoryEntry,
} from '../shared/v3-types.ts';
import {
  nullableStr,
  num,
  parseJson,
  str,
  type SqlRow,
  type StoreContext,
} from './repo-helpers.ts';

export interface VectorRow {
  readonly id: string;
  readonly targetKind: 'observation' | 'fact' | 'chunk';
  readonly targetId: string;
  readonly embeddingSpace: string;
  readonly dims: number;
  readonly vectorBlob: Uint8Array;
}

export class MemoryRepository {
  private readonly ctx: StoreContext;

  constructor(ctx: StoreContext) {
    this.ctx = ctx;
  }

  upsertDocument(input: {
    id?: string;
    hubId: string;
    repoId?: string | null;
    missionId?: string | null;
    executionMode: ExecutionMode;
    sourceType: string;
    occurredAt: string;
    contentSha256: string;
    rawText: string;
    metadataJson?: string;
  }): {readonly doc: MemoryDocumentRecord; readonly inserted: boolean} {
    const id = input.id ?? `mdoc-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const res = this.ctx.db
      .prepare(
        `INSERT INTO memory_documents
         (id, hub_id, repo_id, mission_id, execution_mode, source_type, occurred_at, content_sha256, raw_text, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hub_id, execution_mode, content_sha256) DO NOTHING`,
      )
      .run(
        id,
        input.hubId,
        input.repoId ?? null,
        input.missionId ?? null,
        input.executionMode,
        input.sourceType,
        input.occurredAt,
        input.contentSha256,
        input.rawText,
        input.metadataJson ?? '{}',
        now,
      );

    const row = this.ctx.db
      .prepare(
        'SELECT * FROM memory_documents WHERE hub_id = ? AND execution_mode = ? AND content_sha256 = ?',
      )
      .get(input.hubId, input.executionMode, input.contentSha256) as SqlRow;

    return {
      doc: this.mapDocument(row),
      inserted: res.changes === 1,
    };
  }

  insertChunk(input: {
    id?: string;
    documentId: string;
    hubId: string;
    executionMode: ExecutionMode;
    seq: number;
    startOffset: number;
    endOffset: number;
    text: string;
    ftsTokens: string;
    tokenEstimate: number;
  }): MemoryChunkRecord {
    const id = input.id ?? `mchk-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        `INSERT INTO memory_chunks
         (id, document_id, hub_id, execution_mode, seq, start_offset, end_offset, text, fts_tokens, token_estimate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.documentId,
        input.hubId,
        input.executionMode,
        input.seq,
        input.startOffset,
        input.endOffset,
        input.text,
        input.ftsTokens,
        input.tokenEstimate,
        now,
      );
    return {
      id,
      documentId: input.documentId,
      hubId: input.hubId,
      executionMode: input.executionMode,
      seq: input.seq,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      text: input.text,
      tokenEstimate: input.tokenEstimate,
      createdAt: now,
    };
  }

  getChunk(id: string): MemoryChunkRecord | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM memory_chunks WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row ? this.mapChunk(row) : null;
  }

  insertFact(input: {
    id?: string;
    hubId: string;
    repoId?: string | null;
    missionId?: string | null;
    executionMode: ExecutionMode;
    kind: MemoryFactKind;
    subjectKey: string;
    claim: string;
    ftsTokens: string;
    confidence: number;
    authorityTier: MemoryAuthorityTier;
    eventStartAt: string;
    eventEndAt?: string | null;
    sourceDocumentId: string;
    sourceChunkId: string;
    pathAnchors: readonly string[];
    entityIds: readonly string[];
    stabilityHours?: number;
  }): MemoryFactRecord {
    const id = input.id ?? `mfact-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const stabilityHours = input.stabilityHours ?? 36;
    this.ctx.db
      .prepare(
        `INSERT INTO memory_facts
         (id, hub_id, repo_id, mission_id, execution_mode, kind, subject_key, claim, fts_tokens, confidence, authority_tier, event_start_at, event_end_at, ingested_at, valid_until, superseded_by_fact_id, source_document_id, source_chunk_id, path_anchors_json, entity_ids_json, stability_hours, recall_count, last_recalled_at, consolidated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 0, ?, 0)`,
      )
      .run(
        id,
        input.hubId,
        input.repoId ?? null,
        input.missionId ?? null,
        input.executionMode,
        input.kind,
        input.subjectKey,
        input.claim,
        input.ftsTokens,
        input.confidence,
        input.authorityTier,
        input.eventStartAt,
        input.eventEndAt ?? null,
        now,
        input.sourceDocumentId,
        input.sourceChunkId,
        JSON.stringify(input.pathAnchors),
        JSON.stringify(input.entityIds),
        stabilityHours,
        now,
      );
    return this.getFact(id)!;
  }

  getFact(id: string): MemoryFactRecord | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM memory_facts WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row ? this.mapFact(row) : null;
  }

  listUnconsolidatedFacts(
    hubId: string,
    executionMode: ExecutionMode,
    limit = 60,
  ): MemoryFactRecord[] {
    const rows = this.ctx.db
      .prepare(
        `SELECT * FROM memory_facts
         WHERE hub_id = ? AND execution_mode = ? AND consolidated = 0
         ORDER BY ingested_at ASC LIMIT ?`,
      )
      .all(hubId, executionMode, limit) as SqlRow[];
    return rows.map(r => this.mapFact(r));
  }

  listFactsTemporal(
    hubId: string,
    executionMode: ExecutionMode,
    sinceIso?: string,
    untilIso?: string,
    limit = 40,
  ): MemoryFactRecord[] {
    let sql =
      'SELECT * FROM memory_facts WHERE hub_id = ? AND execution_mode = ?';
    const params: Array<string | number> = [hubId, executionMode];
    if (sinceIso) {
      sql += ' AND (event_start_at >= ? OR ingested_at >= ?)';
      params.push(sinceIso, sinceIso);
    }
    if (untilIso) {
      sql += ' AND event_start_at <= ?';
      params.push(untilIso);
    }
    sql += ' ORDER BY event_start_at DESC, ingested_at DESC LIMIT ?';
    params.push(limit);
    const rows = this.ctx.db.prepare(sql).all(...params) as SqlRow[];
    return rows.map(r => this.mapFact(r));
  }

  markFactConsolidated(
    factId: string,
    supersededByFactId?: string | null,
    validUntil?: string | null,
  ): void {
    this.ctx.db
      .prepare(
        `UPDATE memory_facts SET
           consolidated = 1,
           superseded_by_fact_id = COALESCE(?, superseded_by_fact_id),
           valid_until = COALESCE(?, valid_until)
         WHERE id = ?`,
      )
      .run(supersededByFactId ?? null, validUntil ?? null, factId);
  }

  supersedeFact(
    oldFactId: string,
    newFactId: string,
    validUntil: string,
  ): void {
    this.ctx.db
      .prepare(
        'UPDATE memory_facts SET valid_until = ?, superseded_by_fact_id = ? WHERE id = ? AND valid_until IS NULL',
      )
      .run(validUntil, newFactId, oldFactId);
  }

  upsertObservation(input: {
    id?: string;
    hubId: string;
    repoId?: string | null;
    executionMode: ExecutionMode;
    kind?: MemoryFactKind;
    subjectKey: string;
    title: string;
    statement: string;
    ftsTokens: string;
    beliefStatus: ObservationBeliefStatus;
    authorityTier: MemoryAuthorityTier;
    history: readonly ObservationHistoryEntry[];
    supportingFactIds: readonly string[];
    contradictingFactIds: readonly string[];
    entityIds: readonly string[];
    pathAnchors: readonly string[];
    stabilityHours: number;
    staleSuspect?: boolean;
  }): MemoryObservationRecord {
    const id = input.id ?? `mobs-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const kind: MemoryFactKind = input.kind ?? 'world';
    const staleSuspect = input.staleSuspect ? 1 : 0;
    this.ctx.db
      .prepare(
        `INSERT INTO memory_observations
         (id, hub_id, repo_id, execution_mode, kind, subject_key, title, statement, fts_tokens, belief_status, authority_tier, history_json, supporting_fact_ids_json, contradicting_fact_ids_json, entity_ids_json, path_anchors_json, stability_hours, recall_count, last_recalled_at, stale_suspect, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           title = excluded.title,
           statement = excluded.statement,
           fts_tokens = excluded.fts_tokens,
           belief_status = excluded.belief_status,
           authority_tier = excluded.authority_tier,
           history_json = excluded.history_json,
           supporting_fact_ids_json = excluded.supporting_fact_ids_json,
           contradicting_fact_ids_json = excluded.contradicting_fact_ids_json,
           entity_ids_json = excluded.entity_ids_json,
           path_anchors_json = excluded.path_anchors_json,
           stability_hours = excluded.stability_hours,
           stale_suspect = excluded.stale_suspect,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.hubId,
        input.repoId ?? null,
        input.executionMode,
        kind,
        input.subjectKey,
        input.title,
        input.statement,
        input.ftsTokens,
        input.beliefStatus,
        input.authorityTier,
        JSON.stringify(input.history),
        JSON.stringify(input.supportingFactIds),
        JSON.stringify(input.contradictingFactIds),
        JSON.stringify(input.entityIds),
        JSON.stringify(input.pathAnchors),
        input.stabilityHours,
        now,
        staleSuspect,
        now,
        now,
      );
    return this.getObservation(id)!;
  }

  getObservation(id: string): MemoryObservationRecord | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM memory_observations WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row ? this.mapObservation(row) : null;
  }

  findActiveObservationsBySubject(
    hubId: string,
    executionMode: ExecutionMode,
    subjectKey: string,
  ): MemoryObservationRecord[] {
    const rows = this.ctx.db
      .prepare(
        `SELECT * FROM memory_observations
         WHERE hub_id = ? AND execution_mode = ? AND subject_key = ? AND belief_status IN ('active', 'contested')
         ORDER BY
           CASE authority_tier
             WHEN 'L3_locked' THEN 3
             WHEN 'L2_verified' THEN 2
             ELSE 1
           END DESC,
           updated_at DESC`,
      )
      .all(hubId, executionMode, subjectKey) as SqlRow[];
    return rows.map(r => this.mapObservation(r));
  }

  listObservations(
    hubId: string,
    executionMode: ExecutionMode,
    includeRetired = false,
  ): MemoryObservationRecord[] {
    const sql = includeRetired
      ? 'SELECT * FROM memory_observations WHERE hub_id = ? AND execution_mode = ? ORDER BY updated_at DESC'
      : "SELECT * FROM memory_observations WHERE hub_id = ? AND execution_mode = ? AND belief_status IN ('active', 'contested') ORDER BY updated_at DESC";
    const rows = this.ctx.db.prepare(sql).all(hubId, executionMode) as SqlRow[];
    return rows.map(r => this.mapObservation(r));
  }

  markObservationStaleSuspect(obsId: string): void {
    this.ctx.db
      .prepare(
        'UPDATE memory_observations SET stale_suspect = 1, updated_at = ? WHERE id = ?',
      )
      .run(new Date().toISOString(), obsId);
  }

  touchObservationRecall(
    obsId: string,
    nextStabilityHours?: number,
    nowIso = new Date().toISOString(),
  ): void {
    this.ctx.db
      .prepare(
        `UPDATE memory_observations SET
           recall_count = recall_count + 1,
           last_recalled_at = ?,
           stability_hours = COALESCE(?, stability_hours)
         WHERE id = ?`,
      )
      .run(nowIso, nextStabilityHours ?? null, obsId);
  }

  touchFactRecall(factId: string, nowIso = new Date().toISOString()): void {
    this.ctx.db
      .prepare(
        'UPDATE memory_facts SET recall_count = recall_count + 1, last_recalled_at = ? WHERE id = ?',
      )
      .run(nowIso, factId);
  }

  touchVectorRecall(
    targetKind: 'observation' | 'fact' | 'chunk',
    targetId: string,
    nowIso = new Date().toISOString(),
  ): void {
    this.ctx.db
      .prepare(
        'UPDATE memory_vectors SET last_recalled_at = ? WHERE target_kind = ? AND target_id = ?',
      )
      .run(nowIso, targetKind, targetId);
  }

  upsertVector(input: {
    hubId: string;
    executionMode: ExecutionMode;
    targetKind: 'observation' | 'fact' | 'chunk';
    targetId: string;
    embeddingSpace: string;
    dims: number;
    vectorBlob: Uint8Array;
  }): void {
    const id = `mvec-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        `INSERT INTO memory_vectors
         (id, hub_id, execution_mode, target_kind, target_id, embedding_space, dims, vector_blob, active, last_recalled_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(target_kind, target_id, embedding_space, dims) DO UPDATE SET
           vector_blob = excluded.vector_blob,
           active = 1,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.hubId,
        input.executionMode,
        input.targetKind,
        input.targetId,
        input.embeddingSpace,
        input.dims,
        input.vectorBlob,
        now,
        now,
      );
  }

  listActiveVectors(
    hubId: string,
    executionMode: ExecutionMode,
    embeddingSpace: string,
    limit = 2000,
    dims?: number,
  ): VectorRow[] {
    const rows = (
      dims !== undefined
        ? this.ctx.db
            .prepare(
              `SELECT id, target_kind, target_id, embedding_space, dims, vector_blob
               FROM memory_vectors
               WHERE hub_id = ? AND execution_mode = ? AND embedding_space = ? AND dims = ? AND active = 1
               ORDER BY last_recalled_at DESC LIMIT ?`,
            )
            .all(hubId, executionMode, embeddingSpace, dims, limit)
        : this.ctx.db
            .prepare(
              `SELECT id, target_kind, target_id, embedding_space, dims, vector_blob
               FROM memory_vectors
               WHERE hub_id = ? AND execution_mode = ? AND embedding_space = ? AND active = 1
               ORDER BY last_recalled_at DESC LIMIT ?`,
            )
            .all(hubId, executionMode, embeddingSpace, limit)
    ) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      targetKind: str(r, 'target_kind') as VectorRow['targetKind'],
      targetId: str(r, 'target_id'),
      embeddingSpace: str(r, 'embedding_space'),
      dims: num(r, 'dims'),
      vectorBlob: r['vector_blob'] as Uint8Array,
    }));
  }

  upsertEntity(input: {
    hubId: string;
    executionMode: ExecutionMode;
    entityType: string;
    canonicalKey: string;
    displayName: string;
    aliases: readonly string[];
  }): MemoryEntityRecord {
    const id = `ment-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const existing = this.ctx.db
      .prepare(
        `SELECT * FROM memory_entities
         WHERE hub_id = ? AND execution_mode = ? AND entity_type = ? AND canonical_key = ?`,
      )
      .get(
        input.hubId,
        input.executionMode,
        input.entityType,
        input.canonicalKey,
      ) as SqlRow | undefined;

    const mergedAliases = existing
      ? Array.from(
          new Set([
            ...parseJson<string[]>(str(existing, 'aliases_json'), []),
            ...input.aliases,
          ]),
        )
      : Array.from(new Set(input.aliases));

    this.ctx.db
      .prepare(
        `INSERT INTO memory_entities
         (id, hub_id, execution_mode, entity_type, canonical_key, display_name, aliases_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hub_id, execution_mode, entity_type, canonical_key) DO UPDATE SET
           display_name = excluded.display_name,
           aliases_json = excluded.aliases_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.hubId,
        input.executionMode,
        input.entityType,
        input.canonicalKey,
        input.displayName,
        JSON.stringify(mergedAliases),
        now,
      );

    const row = this.ctx.db
      .prepare(
        `SELECT * FROM memory_entities
         WHERE hub_id = ? AND execution_mode = ? AND entity_type = ? AND canonical_key = ?`,
      )
      .get(
        input.hubId,
        input.executionMode,
        input.entityType,
        input.canonicalKey,
      ) as SqlRow;
    return this.mapEntity(row);
  }

  listEntities(
    hubId: string,
    executionMode: ExecutionMode,
  ): MemoryEntityRecord[] {
    const rows = this.ctx.db
      .prepare(
        'SELECT * FROM memory_entities WHERE hub_id = ? AND execution_mode = ? ORDER BY updated_at DESC',
      )
      .all(hubId, executionMode) as SqlRow[];
    return rows.map(r => this.mapEntity(r));
  }

  insertEdge(input: {
    hubId: string;
    executionMode: ExecutionMode;
    sourceEntityId: string;
    targetEntityId: string;
    relation: string;
    weight?: number;
    sourceFactId?: string | null;
  }): MemoryEdgeRecord {
    const id = `medg-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        `INSERT INTO memory_edges
         (id, hub_id, execution_mode, source_entity_id, target_entity_id, relation, weight, source_fact_id, valid_from, valid_until, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        input.hubId,
        input.executionMode,
        input.sourceEntityId,
        input.targetEntityId,
        input.relation,
        input.weight ?? 1,
        input.sourceFactId ?? null,
        now,
        now,
      );
    return {
      id,
      hubId: input.hubId,
      executionMode: input.executionMode,
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      relation: input.relation,
      weight: input.weight ?? 1,
      sourceFactId: input.sourceFactId ?? null,
      validFrom: now,
      validUntil: null,
      createdAt: now,
    };
  }

  listEdges(hubId: string, executionMode: ExecutionMode): MemoryEdgeRecord[] {
    const rows = this.ctx.db
      .prepare(
        'SELECT * FROM memory_edges WHERE hub_id = ? AND execution_mode = ? AND valid_until IS NULL',
      )
      .all(hubId, executionMode) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      executionMode: str(r, 'execution_mode') as ExecutionMode,
      sourceEntityId: str(r, 'source_entity_id'),
      targetEntityId: str(r, 'target_entity_id'),
      relation: str(r, 'relation'),
      weight: num(r, 'weight'),
      sourceFactId: nullableStr(r, 'source_fact_id'),
      validFrom: str(r, 'valid_from'),
      validUntil: nullableStr(r, 'valid_until'),
      createdAt: str(r, 'created_at'),
    }));
  }

  hasActiveEdge(
    hubId: string,
    executionMode: ExecutionMode,
    sourceEntityId: string,
    targetEntityId: string,
    relation: string,
  ): boolean {
    const row = this.ctx.db
      .prepare(
        `SELECT 1 AS present FROM memory_edges
         WHERE hub_id = ? AND execution_mode = ?
           AND source_entity_id = ? AND target_entity_id = ?
           AND relation = ? AND valid_until IS NULL
         LIMIT 1`,
      )
      .get(hubId, executionMode, sourceEntityId, targetEntityId, relation) as
      SqlRow | undefined;
    return Boolean(row);
  }

  listFactsByEntityIds(
    hubId: string,
    executionMode: ExecutionMode,
    entityIds: readonly string[],
    limit = 30,
  ): MemoryFactRecord[] {
    if (entityIds.length === 0) {
      return [];
    }
    const placeholders = entityIds.map(() => '?').join(', ');
    const rows = this.ctx.db
      .prepare(
        `SELECT DISTINCT f.*
         FROM memory_facts f, json_each(f.entity_ids_json) je
         WHERE f.hub_id = ?
           AND f.execution_mode = ?
           AND f.valid_until IS NULL
           AND je.value IN (${placeholders})
         ORDER BY f.ingested_at DESC
         LIMIT ?`,
      )
      .all(hubId, executionMode, ...entityIds, limit) as SqlRow[];
    return rows.map(r => this.mapFact(r));
  }

  searchFtsObservations(
    matchQuery: string,
    hubId: string,
    executionMode: ExecutionMode,
    limit = 20,
  ): MemoryObservationRecord[] {
    if (!matchQuery) {
      return [];
    }
    const rows = this.ctx.db
      .prepare(
        `SELECT o.* FROM memory_observations_fts f
         JOIN memory_observations o ON o.rowid = f.rowid
         WHERE memory_observations_fts MATCH ? AND o.hub_id = ? AND o.execution_mode = ? AND o.belief_status IN ('active', 'contested')
         ORDER BY rank LIMIT ?`,
      )
      .all(matchQuery, hubId, executionMode, limit) as SqlRow[];
    return rows.map(r => this.mapObservation(r));
  }

  searchFtsFacts(
    matchQuery: string,
    hubId: string,
    executionMode: ExecutionMode,
    limit = 20,
  ): MemoryFactRecord[] {
    if (!matchQuery) {
      return [];
    }
    const rows = this.ctx.db
      .prepare(
        `SELECT ft.* FROM memory_facts_fts f
         JOIN memory_facts ft ON ft.rowid = f.rowid
         WHERE memory_facts_fts MATCH ? AND ft.hub_id = ? AND ft.execution_mode = ? AND ft.valid_until IS NULL
         ORDER BY rank LIMIT ?`,
      )
      .all(matchQuery, hubId, executionMode, limit) as SqlRow[];
    return rows.map(r => this.mapFact(r));
  }

  searchFtsChunks(
    matchQuery: string,
    hubId: string,
    executionMode: ExecutionMode,
    limit = 20,
  ): MemoryChunkRecord[] {
    if (!matchQuery) {
      return [];
    }
    const rows = this.ctx.db
      .prepare(
        `SELECT c.* FROM memory_chunks_fts f
         JOIN memory_chunks c ON c.rowid = f.rowid
         WHERE memory_chunks_fts MATCH ? AND c.hub_id = ? AND c.execution_mode = ?
         ORDER BY rank LIMIT ?`,
      )
      .all(matchQuery, hubId, executionMode, limit) as SqlRow[];
    return rows.map(r => this.mapChunk(r));
  }

  upsertLivingDoc(input: {
    hubId: string;
    repoId?: string | null;
    executionMode: ExecutionMode;
    docKind: LivingDocKind;
    slug: string;
    title: string;
    standingQuestion: string;
    scopeEntities: readonly string[];
    contentMarkdown: string;
    citedObservationIds: readonly string[];
    stale?: boolean;
  }): MemoryLivingDocRecord {
    const id = `ldoc-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        `INSERT INTO memory_living_docs
         (id, hub_id, repo_id, execution_mode, doc_kind, slug, title, standing_question, scope_entities_json, content_markdown, cited_observation_ids_json, version, stale, refreshed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(hub_id, execution_mode, doc_kind, slug) DO UPDATE SET
           repo_id = excluded.repo_id,
           title = excluded.title,
           standing_question = excluded.standing_question,
           scope_entities_json = excluded.scope_entities_json,
           content_markdown = excluded.content_markdown,
           cited_observation_ids_json = excluded.cited_observation_ids_json,
           version = version + 1,
           stale = excluded.stale,
           refreshed_at = CASE WHEN excluded.stale = 0 THEN excluded.refreshed_at ELSE memory_living_docs.refreshed_at END,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.hubId,
        input.repoId ?? null,
        input.executionMode,
        input.docKind,
        input.slug,
        input.title,
        input.standingQuestion,
        JSON.stringify(input.scopeEntities),
        input.contentMarkdown,
        JSON.stringify(input.citedObservationIds),
        input.stale ? 1 : 0,
        now,
        now,
      );
    const row = this.ctx.db
      .prepare(
        `SELECT * FROM memory_living_docs
         WHERE hub_id = ? AND execution_mode = ? AND doc_kind = ? AND slug = ?`,
      )
      .get(
        input.hubId,
        input.executionMode,
        input.docKind,
        input.slug,
      ) as SqlRow;
    return this.mapLivingDoc(row);
  }

  getLivingDoc(id: string): MemoryLivingDocRecord | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM memory_living_docs WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row ? this.mapLivingDoc(row) : null;
  }

  listLivingDocs(
    hubId: string,
    executionMode: ExecutionMode,
  ): MemoryLivingDocRecord[] {
    const rows = this.ctx.db
      .prepare(
        'SELECT * FROM memory_living_docs WHERE hub_id = ? AND execution_mode = ? ORDER BY doc_kind ASC, updated_at DESC',
      )
      .all(hubId, executionMode) as SqlRow[];
    return rows.map(r => this.mapLivingDoc(r));
  }

  markLivingDocsStale(hubId: string, executionMode: ExecutionMode): string[] {
    const docs = this.listLivingDocs(hubId, executionMode);
    if (docs.length === 0) {
      return [];
    }
    this.ctx.db
      .prepare(
        'UPDATE memory_living_docs SET stale = 1, updated_at = ? WHERE hub_id = ? AND execution_mode = ?',
      )
      .run(new Date().toISOString(), hubId, executionMode);
    return docs.map(d => d.id);
  }

  markLivingDocsStaleByKinds(
    hubId: string,
    executionMode: ExecutionMode,
    docKinds: readonly LivingDocKind[],
  ): string[] {
    if (docKinds.length === 0) {
      return [];
    }
    const kindSet = new Set(docKinds);
    const docs = this.listLivingDocs(hubId, executionMode).filter(d =>
      kindSet.has(d.docKind),
    );
    if (docs.length === 0) {
      return [];
    }
    const placeholders = docKinds.map(() => '?').join(', ');
    this.ctx.db
      .prepare(
        `UPDATE memory_living_docs SET stale = 1, updated_at = ?
         WHERE hub_id = ? AND execution_mode = ? AND doc_kind IN (${placeholders})`,
      )
      .run(new Date().toISOString(), hubId, executionMode, ...docKinds);
    return docs.map(d => d.id);
  }

  countRevisedObservationsSince(
    hubId: string,
    executionMode: ExecutionMode,
    sinceIso: string,
  ): number {
    const row = this.ctx.db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM memory_observations
         WHERE hub_id = ? AND execution_mode = ? AND updated_at >= ? AND (belief_status = 'contested' OR history_json != '[]')`,
      )
      .get(hubId, executionMode, sinceIso) as SqlRow;
    return num(row, 'cnt');
  }

  private mapDocument(r: SqlRow): MemoryDocumentRecord {
    return {
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      repoId: nullableStr(r, 'repo_id'),
      missionId: nullableStr(r, 'mission_id'),
      executionMode: str(r, 'execution_mode') as ExecutionMode,
      sourceType: str(r, 'source_type'),
      occurredAt: str(r, 'occurred_at'),
      contentSha256: str(r, 'content_sha256'),
      rawText: str(r, 'raw_text'),
      metadataJson: str(r, 'metadata_json'),
      createdAt: str(r, 'created_at'),
    };
  }

  private mapChunk(r: SqlRow): MemoryChunkRecord {
    return {
      id: str(r, 'id'),
      documentId: str(r, 'document_id'),
      hubId: str(r, 'hub_id'),
      executionMode: str(r, 'execution_mode') as ExecutionMode,
      seq: num(r, 'seq'),
      startOffset: num(r, 'start_offset'),
      endOffset: num(r, 'end_offset'),
      text: str(r, 'text'),
      tokenEstimate: num(r, 'token_estimate'),
      createdAt: str(r, 'created_at'),
    };
  }

  private mapFact(r: SqlRow): MemoryFactRecord {
    return {
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      repoId: nullableStr(r, 'repo_id'),
      missionId: nullableStr(r, 'mission_id'),
      executionMode: str(r, 'execution_mode') as ExecutionMode,
      kind: str(r, 'kind') as MemoryFactKind,
      subjectKey: str(r, 'subject_key'),
      claim: str(r, 'claim'),
      confidence: num(r, 'confidence'),
      authorityTier: str(r, 'authority_tier') as MemoryAuthorityTier,
      eventStartAt: str(r, 'event_start_at'),
      eventEndAt: nullableStr(r, 'event_end_at'),
      ingestedAt: str(r, 'ingested_at'),
      validUntil: nullableStr(r, 'valid_until'),
      supersededByFactId: nullableStr(r, 'superseded_by_fact_id'),
      sourceDocumentId: str(r, 'source_document_id'),
      sourceChunkId: str(r, 'source_chunk_id'),
      pathAnchors: parseJson<string[]>(str(r, 'path_anchors_json'), []),
      entityIds: parseJson<string[]>(str(r, 'entity_ids_json'), []),
      stabilityHours: num(r, 'stability_hours'),
      recallCount: num(r, 'recall_count'),
      lastRecalledAt: str(r, 'last_recalled_at'),
      consolidated: num(r, 'consolidated') === 1,
    };
  }

  private mapObservation(r: SqlRow): MemoryObservationRecord {
    return {
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      repoId: nullableStr(r, 'repo_id'),
      executionMode: str(r, 'execution_mode') as ExecutionMode,
      kind: (nullableStr(r, 'kind') ?? 'world') as MemoryFactKind,
      subjectKey: str(r, 'subject_key'),
      title: str(r, 'title'),
      statement: str(r, 'statement'),
      beliefStatus: str(r, 'belief_status') as ObservationBeliefStatus,
      authorityTier: str(r, 'authority_tier') as MemoryAuthorityTier,
      history: parseJson<ObservationHistoryEntry[]>(str(r, 'history_json'), []),
      supportingFactIds: parseJson<string[]>(
        str(r, 'supporting_fact_ids_json'),
        [],
      ),
      contradictingFactIds: parseJson<string[]>(
        str(r, 'contradicting_fact_ids_json'),
        [],
      ),
      entityIds: parseJson<string[]>(str(r, 'entity_ids_json'), []),
      pathAnchors: parseJson<string[]>(str(r, 'path_anchors_json'), []),
      stabilityHours: num(r, 'stability_hours'),
      recallCount: num(r, 'recall_count'),
      lastRecalledAt: str(r, 'last_recalled_at'),
      staleSuspect: num(r, 'stale_suspect') === 1,
      updatedAt: str(r, 'updated_at'),
      createdAt: str(r, 'created_at'),
    };
  }

  private mapEntity(r: SqlRow): MemoryEntityRecord {
    return {
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      executionMode: str(r, 'execution_mode') as ExecutionMode,
      entityType: str(r, 'entity_type'),
      canonicalKey: str(r, 'canonical_key'),
      displayName: str(r, 'display_name'),
      aliases: parseJson<string[]>(str(r, 'aliases_json'), []),
      updatedAt: str(r, 'updated_at'),
    };
  }

  private mapLivingDoc(r: SqlRow): MemoryLivingDocRecord {
    return {
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      repoId: nullableStr(r, 'repo_id'),
      executionMode: str(r, 'execution_mode') as ExecutionMode,
      docKind: str(r, 'doc_kind') as LivingDocKind,
      slug: str(r, 'slug'),
      title: str(r, 'title'),
      standingQuestion: str(r, 'standing_question'),
      scopeEntities: parseJson<string[]>(str(r, 'scope_entities_json'), []),
      contentMarkdown: str(r, 'content_markdown'),
      citedObservationIds: parseJson<string[]>(
        str(r, 'cited_observation_ids_json'),
        [],
      ),
      version: num(r, 'version'),
      stale: num(r, 'stale') === 1,
      refreshedAt: str(r, 'refreshed_at'),
      updatedAt: str(r, 'updated_at'),
    };
  }
}

import {randomUUID} from 'node:crypto';
import {computeEventHash} from '../core/canonical-json.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  DecisionInput,
  DecisionOptionPreview,
  ExecutionMode,
  IntentPresetId,
  MissionConfigOverrides,
  MissionDecisionRecord,
  MissionEventRecord,
  MissionGateKind,
  MissionGateRecord,
  MissionRecord,
  MissionStage,
  MissionStatus,
  TriageTrack,
} from '../shared/v3-types.ts';
import {
  nullableStr,
  num,
  parseJson,
  str,
  type SqlRow,
  type StoreContext,
} from './repo-helpers.ts';

export class MissionRepository {
  private readonly ctx: StoreContext;

  constructor(ctx: StoreContext) {
    this.ctx = ctx;
  }

  createMission(input: {
    id?: string;
    hubId: string;
    projectId: string;
    title: string;
    rawIntent: string;
    status: MissionStatus;
    stage: MissionStage;
    triageTrack: TriageTrack;
    triageRationale: string;
    preset: IntentPresetId;
    executionMode: ExecutionMode;
    parentBaselineId?: string | null;
    budgetUsdLimit: number;
    maxOvernightHours: number;
    configOverrides: MissionConfigOverrides;
  }): MissionRecord {
    return this.ctx.atomic(() => {
      const seq = this.ctx.nextSequence('mission_code_seq');
      const code = `MSN-${String(seq).padStart(3, '0')}`;
      const id = input.id ?? `msn-${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();

      this.ctx.db
        .prepare(
          `INSERT INTO missions
           (id, hub_id, project_id, code, title, raw_intent, status, stage, triage_track, triage_rationale, preset, execution_mode, version, execution_epoch, active_baseline_id, parent_baseline_id, budget_usd_limit, spent_usd, max_overnight_hours, config_overrides_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, ?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.hubId,
          input.projectId,
          code,
          input.title,
          input.rawIntent,
          input.status,
          input.stage,
          input.triageTrack,
          input.triageRationale,
          input.preset,
          input.executionMode,
          input.parentBaselineId ?? null,
          input.budgetUsdLimit,
          input.maxOvernightHours,
          JSON.stringify(input.configOverrides),
          now,
          now,
        );

      return this.getMission(id)!;
    });
  }

  getMission(id: string): MissionRecord | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM missions WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row ? this.mapMission(row) : null;
  }

  listMissions(hubId?: string, includeArchived = false): MissionRecord[] {
    let sql = 'SELECT * FROM missions WHERE 1=1';
    const params: string[] = [];
    if (hubId) {
      sql += ' AND hub_id = ?';
      params.push(hubId);
    }
    if (!includeArchived) {
      sql += ' AND archived_at IS NULL';
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.ctx.db.prepare(sql).all(...params) as SqlRow[];
    return rows.map(r => this.mapMission(r));
  }

  updateMissionCas(
    missionId: string,
    expectedVersion: number | undefined,
    patch: Partial<{
      status: MissionStatus;
      stage: MissionStage;
      triageTrack: TriageTrack;
      triageRationale: string;
      preset: IntentPresetId;
      activeBaselineId: string | null;
      parentBaselineId: string | null;
      budgetUsdLimit: number;
      maxOvernightHours: number;
      configOverrides: MissionConfigOverrides;
      bumpEpoch: boolean;
      archivedAt: string | null;
    }>,
  ): MissionRecord {
    const cur = this.getMission(missionId);
    if (!cur) {
      throw new ForgeError(
        'NOT_FOUND',
        `Mission "${missionId}" not found`,
        404,
      );
    }
    if (expectedVersion !== undefined && cur.version !== expectedVersion) {
      throw new ForgeError(
        'CONFLICT',
        `Mission "${missionId}" version conflict (expected ${expectedVersion}, actual ${cur.version})`,
        409,
      );
    }
    const now = new Date().toISOString();
    const res = this.ctx.db
      .prepare(
        `UPDATE missions SET
           status = ?,
           stage = ?,
           triage_track = ?,
           triage_rationale = ?,
           preset = ?,
           active_baseline_id = ?,
           parent_baseline_id = ?,
           budget_usd_limit = ?,
           max_overnight_hours = ?,
           config_overrides_json = ?,
           archived_at = ?,
           execution_epoch = execution_epoch + ?,
           version = version + 1,
           updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        patch.status ?? cur.status,
        patch.stage ?? cur.stage,
        patch.triageTrack ?? cur.triageTrack,
        patch.triageRationale ?? cur.triageRationale,
        patch.preset ?? cur.preset,
        patch.activeBaselineId !== undefined
          ? patch.activeBaselineId
          : cur.activeBaselineId,
        patch.parentBaselineId !== undefined
          ? patch.parentBaselineId
          : cur.parentBaselineId,
        patch.budgetUsdLimit ?? cur.budgetUsdLimit,
        patch.maxOvernightHours ?? cur.maxOvernightHours,
        JSON.stringify(patch.configOverrides ?? cur.configOverrides),
        patch.archivedAt !== undefined ? patch.archivedAt : cur.archivedAt,
        patch.bumpEpoch ? 1 : 0,
        now,
        missionId,
        cur.version,
      );
    if (res.changes !== 1) {
      throw new ForgeError(
        'CONFLICT',
        `Concurrent modification on Mission "${missionId}"`,
        409,
      );
    }
    return this.getMission(missionId)!;
  }

  switchMissionExecutionModePreStart(
    missionId: string,
    nextMode: ExecutionMode,
  ): MissionRecord {
    return this.ctx.atomic(() => {
      const now = new Date().toISOString();
      const res = this.ctx.db
        .prepare(
          `UPDATE missions
           SET execution_mode = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND active_baseline_id IS NULL`,
        )
        .run(nextMode, now, missionId);
      if (res.changes !== 1) {
        throw new ForgeError(
          'CONFLICT',
          `Cannot switch executionMode on Mission "${missionId}" after baseline freeze`,
          409,
        );
      }
      this.ctx.db
        .prepare(
          'UPDATE hama_runs SET mode = ?, updated_at = ? WHERE mission_id = ?',
        )
        .run(nextMode, now, missionId);
      return this.getMission(missionId)!;
    });
  }

  addMissionCostAtomic(missionId: string, deltaUsd: number): void {
    if (!Number.isFinite(deltaUsd) || deltaUsd <= 0) {
      return;
    }
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        'UPDATE missions SET spent_usd = ROUND(spent_usd + ?, 6), updated_at = ? WHERE id = ?',
      )
      .run(deltaUsd, now, missionId);
  }

  openGate(input: {
    id?: string;
    missionId: string;
    changeId?: string | null;
    nodeId?: string | null;
    kind: MissionGateKind;
    targetId: string;
    targetHash: string;
    targetRevision?: number;
    question: string;
    contextSnippet: string;
    options: readonly DecisionOptionPreview[];
  }): MissionGateRecord {
    const id = input.id ?? `gate-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        `INSERT INTO mission_gates
         (id, mission_id, change_id, node_id, kind, target_id, target_hash, target_revision, question, context_snippet, options_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        id,
        input.missionId,
        input.changeId ?? null,
        input.nodeId ?? null,
        input.kind,
        input.targetId,
        input.targetHash,
        input.targetRevision ?? 1,
        input.question,
        input.contextSnippet,
        JSON.stringify(input.options),
        now,
      );
    return this.getGate(id)!;
  }

  getGate(gateId: string): MissionGateRecord | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM mission_gates WHERE id = ?')
      .get(gateId) as SqlRow | undefined;
    return row ? this.mapGate(row) : null;
  }

  listGates(missionId: string, includeResolved = false): MissionGateRecord[] {
    const sql = includeResolved
      ? 'SELECT * FROM mission_gates WHERE mission_id = ? ORDER BY created_at ASC'
      : "SELECT * FROM mission_gates WHERE mission_id = ? AND status = 'open' ORDER BY created_at ASC";
    const rows = this.ctx.db.prepare(sql).all(missionId) as SqlRow[];
    return rows.map(r => this.mapGate(r));
  }

  resolveGate(
    gateId: string,
    status: 'resolved' | 'dismissed' = 'resolved',
  ): void {
    const now = new Date().toISOString();
    const res = this.ctx.db
      .prepare(
        "UPDATE mission_gates SET status = ?, resolved_at = ? WHERE id = ? AND status = 'open'",
      )
      .run(status, now, gateId);
    if (res.changes !== 1) {
      throw new ForgeError(
        'CONFLICT',
        `Gate "${gateId}" is already resolved or not found`,
        409,
      );
    }
  }

  findDecisionByIdempotencyKey(idempotencyKey: string): {
    readonly payloadSha256: string;
    readonly responseJson: string;
  } | null {
    const row = this.ctx.db
      .prepare(
        'SELECT payload_sha256, response_json FROM mission_decisions WHERE idempotency_key = ?',
      )
      .get(idempotencyKey) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return {
      payloadSha256: str(row, 'payload_sha256'),
      responseJson: str(row, 'response_json'),
    };
  }

  recordDecision(input: {
    gateId: string;
    missionId: string;
    payloadSha256: string;
    decision: DecisionInput;
    responseJson?: string;
  }): MissionDecisionRecord {
    const id = `dec-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const record: MissionDecisionRecord = {
      id,
      gateId: input.gateId,
      missionId: input.missionId,
      idempotencyKey: input.decision.idempotencyKey,
      payloadSha256: input.payloadSha256,
      targetId: input.decision.targetId,
      targetHash: input.decision.targetHash,
      actor: input.decision.actor,
      action: input.decision.action,
      feedback: input.decision.feedback,
      scope: input.decision.scope,
      issueIds: input.decision.issueIds,
      decidedAt: now,
    };
    this.ctx.db
      .prepare(
        `INSERT INTO mission_decisions
         (id, gate_id, mission_id, idempotency_key, payload_sha256, target_id, target_hash, actor, action, feedback, scope, issue_ids_json, response_json, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.gateId,
        input.missionId,
        input.decision.idempotencyKey,
        input.payloadSha256,
        input.decision.targetId,
        input.decision.targetHash,
        input.decision.actor,
        input.decision.action,
        input.decision.feedback,
        input.decision.scope,
        JSON.stringify(input.decision.issueIds),
        input.responseJson ?? JSON.stringify(record),
        now,
      );
    return record;
  }

  listDecisions(missionId: string): MissionDecisionRecord[] {
    const rows = this.ctx.db
      .prepare(
        'SELECT * FROM mission_decisions WHERE mission_id = ? ORDER BY rowid ASC',
      )
      .all(missionId) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      gateId: str(r, 'gate_id'),
      missionId: str(r, 'mission_id'),
      idempotencyKey: str(r, 'idempotency_key'),
      payloadSha256: str(r, 'payload_sha256'),
      targetId: str(r, 'target_id'),
      targetHash: str(r, 'target_hash'),
      actor: str(r, 'actor'),
      action: str(r, 'action') as MissionDecisionRecord['action'],
      feedback: str(r, 'feedback'),
      scope: str(r, 'scope') as 'local' | 'proposal',
      issueIds: parseJson<string[]>(str(r, 'issue_ids_json'), []),
      decidedAt: str(r, 'decided_at'),
    }));
  }

  appendEvent(
    missionId: string,
    eventType: string,
    actor: string,
    payload: unknown,
  ): MissionEventRecord {
    return this.ctx.atomic(() => {
      const last = this.ctx.db
        .prepare(
          'SELECT seq, event_hash FROM mission_events WHERE mission_id = ? ORDER BY seq DESC LIMIT 1',
        )
        .get(missionId) as SqlRow | undefined;
      const seq = last ? num(last, 'seq') + 1 : 1;
      const prevHash = last ? str(last, 'event_hash') : 'GENESIS';
      const payloadJson = JSON.stringify(payload ?? {});
      const eventHash = computeEventHash(
        prevHash,
        eventType,
        actor,
        payloadJson,
      );
      const id = `mev-${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();

      this.ctx.db
        .prepare(
          `INSERT INTO mission_events
           (id, mission_id, seq, event_type, actor, payload_json, prev_hash, event_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          missionId,
          seq,
          eventType,
          actor,
          payloadJson,
          prevHash,
          eventHash,
          now,
        );

      return {
        id,
        missionId,
        seq,
        eventType,
        actor,
        payloadJson,
        prevHash,
        eventHash,
        createdAt: now,
      };
    });
  }

  listEvents(missionId: string, limit = 200): MissionEventRecord[] {
    const rows = this.ctx.db
      .prepare(
        'SELECT * FROM mission_events WHERE mission_id = ? ORDER BY seq ASC LIMIT ?',
      )
      .all(missionId, limit) as SqlRow[];
    return rows.map(r => ({
      id: str(r, 'id'),
      missionId: str(r, 'mission_id'),
      seq: num(r, 'seq'),
      eventType: str(r, 'event_type'),
      actor: str(r, 'actor'),
      payloadJson: str(r, 'payload_json'),
      prevHash: str(r, 'prev_hash'),
      eventHash: str(r, 'event_hash'),
      createdAt: str(r, 'created_at'),
    }));
  }

  private mapMission(r: SqlRow): MissionRecord {
    return {
      id: str(r, 'id'),
      hubId: str(r, 'hub_id'),
      projectId: str(r, 'project_id'),
      code: str(r, 'code'),
      title: str(r, 'title'),
      rawIntent: str(r, 'raw_intent'),
      status: str(r, 'status') as MissionStatus,
      stage: str(r, 'stage') as MissionStage,
      triageTrack: str(r, 'triage_track') as TriageTrack,
      triageRationale: str(r, 'triage_rationale'),
      preset: str(r, 'preset') as IntentPresetId,
      executionMode: str(r, 'execution_mode') as ExecutionMode,
      version: num(r, 'version'),
      executionEpoch: num(r, 'execution_epoch'),
      activeBaselineId: nullableStr(r, 'active_baseline_id'),
      parentBaselineId: nullableStr(r, 'parent_baseline_id'),
      budgetUsdLimit: num(r, 'budget_usd_limit'),
      spentUsd: num(r, 'spent_usd'),
      maxOvernightHours: num(r, 'max_overnight_hours'),
      configOverrides: parseJson<MissionConfigOverrides>(
        str(r, 'config_overrides_json'),
        {},
      ),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
      archivedAt: nullableStr(r, 'archived_at'),
    };
  }

  private mapGate(r: SqlRow): MissionGateRecord {
    return {
      id: str(r, 'id'),
      missionId: str(r, 'mission_id'),
      changeId: nullableStr(r, 'change_id'),
      nodeId: nullableStr(r, 'node_id'),
      kind: str(r, 'kind') as MissionGateKind,
      targetId: str(r, 'target_id'),
      targetHash: str(r, 'target_hash'),
      targetRevision: num(r, 'target_revision'),
      question: str(r, 'question'),
      contextSnippet: str(r, 'context_snippet'),
      options: parseJson<DecisionOptionPreview[]>(str(r, 'options_json'), []),
      status: str(r, 'status') as MissionGateRecord['status'],
      createdAt: str(r, 'created_at'),
      resolvedAt: nullableStr(r, 'resolved_at'),
    };
  }
}

import {randomUUID} from 'node:crypto';
import {sha256Canonical} from '../core/canonical-json.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  ApprovedRequirementsBaseline,
  ArtifactRef,
  CommentDisposition,
  ExecutionMode,
  HamaArtifactRecord,
  HamaCommentRecord,
} from '../shared/v3-types.ts';
import {
  nullableStr,
  num,
  parseJson,
  str,
  type SqlRow,
  type StoreContext,
} from './repo-helpers.ts';

export interface HamaRunRow {
  readonly missionId: string;
  readonly projectId: string;
  readonly mode: ExecutionMode;
  readonly inputJson: string;
  readonly stage: string;
  readonly proposalReworkCount: number;
  readonly prdLocalEditCount: number;
  readonly updatedAt: string;
}

export class HamaRepository {
  private readonly ctx: StoreContext;

  constructor(ctx: StoreContext) {
    this.ctx = ctx;
  }

  initRun(input: {
    missionId: string;
    projectId: string;
    mode: ExecutionMode;
    inputPayload: unknown;
    stage: string;
  }): HamaRunRow {
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        `INSERT INTO hama_runs
         (mission_id, project_id, mode, input_json, stage, proposal_rework_count, prd_local_edit_count, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
      )
      .run(
        input.missionId,
        input.projectId,
        input.mode,
        JSON.stringify(input.inputPayload),
        input.stage,
        now,
      );
    return this.getRun(input.missionId)!;
  }

  getRun(missionId: string): HamaRunRow | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM hama_runs WHERE mission_id = ?')
      .get(missionId) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return {
      missionId: str(row, 'mission_id'),
      projectId: str(row, 'project_id'),
      mode: str(row, 'mode') as ExecutionMode,
      inputJson: str(row, 'input_json'),
      stage: str(row, 'stage'),
      proposalReworkCount: num(row, 'proposal_rework_count'),
      prdLocalEditCount: num(row, 'prd_local_edit_count'),
      updatedAt: str(row, 'updated_at'),
    };
  }

  updateRunStage(
    missionId: string,
    stage: string,
    opts?: {
      readonly incrementProposalRework?: boolean;
      readonly incrementPrdLocalEdit?: boolean;
    },
  ): HamaRunRow {
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        `UPDATE hama_runs SET
           stage = ?,
           proposal_rework_count = proposal_rework_count + ?,
           prd_local_edit_count = prd_local_edit_count + ?,
           updated_at = ?
         WHERE mission_id = ?`,
      )
      .run(
        stage,
        opts?.incrementProposalRework ? 1 : 0,
        opts?.incrementPrdLocalEdit ? 1 : 0,
        now,
        missionId,
      );
    return this.getRun(missionId)!;
  }

  writeArtifact<T, K extends string>(
    missionId: string,
    kind: K,
    data: T,
    subject = '',
  ): HamaArtifactRecord<T, K> {
    return this.ctx.atomic(() => {
      const row = this.ctx.db
        .prepare(
          'SELECT MAX(revision) AS rev FROM hama_artifacts WHERE mission_id = ? AND kind = ? AND subject = ?',
        )
        .get(missionId, kind, subject) as SqlRow | undefined;
      const revision = (row && row['rev'] !== null ? num(row, 'rev') : 0) + 1;
      const id = `${kind}-${randomUUID().slice(0, 10)}`;
      const hash = sha256Canonical(data);
      const now = new Date().toISOString();

      this.ctx.db
        .prepare(
          `INSERT INTO hama_artifacts
           (id, mission_id, kind, subject, revision, hash, data_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          missionId,
          kind,
          subject,
          revision,
          hash,
          JSON.stringify(data),
          now,
        );

      return {
        id,
        missionId,
        kind,
        subject,
        revision,
        hash,
        createdAt: now,
        data,
      };
    });
  }

  latestArtifact<T, K extends string = string>(
    missionId: string,
    kind: K,
    subject = '',
  ): HamaArtifactRecord<T, K> | null {
    const row = this.ctx.db
      .prepare(
        'SELECT * FROM hama_artifacts WHERE mission_id = ? AND kind = ? AND subject = ? ORDER BY revision DESC LIMIT 1',
      )
      .get(missionId, kind, subject) as SqlRow | undefined;
    return row ? this.mapArtifact<T, K>(row) : null;
  }

  readArtifactRef<T, K extends string = string>(
    missionId: string,
    ref: ArtifactRef<K>,
  ): HamaArtifactRecord<T, K> {
    const row = this.ctx.db
      .prepare('SELECT * FROM hama_artifacts WHERE id = ? AND mission_id = ?')
      .get(ref.id, missionId) as SqlRow | undefined;
    if (!row) {
      throw new ForgeError(
        'NOT_FOUND',
        `HAMA artifact "${ref.id}" not found`,
        404,
      );
    }
    const mapped = this.mapArtifact<T, K>(row);
    if (
      mapped.kind !== ref.kind ||
      mapped.revision !== ref.revision ||
      mapped.hash !== ref.hash
    ) {
      throw new ForgeError(
        'CONFLICT',
        `HAMA artifact reference "${ref.id}" failed hash/revision check`,
        409,
      );
    }
    return mapped;
  }

  getArtifactById<T = unknown>(
    missionId: string,
    artifactId: string,
  ): HamaArtifactRecord<T> | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM hama_artifacts WHERE id = ? AND mission_id = ?')
      .get(artifactId, missionId) as SqlRow | undefined;
    return row ? this.mapArtifact<T>(row) : null;
  }

  listArtifacts(missionId: string): HamaArtifactRecord[] {
    const rows = this.ctx.db
      .prepare(
        'SELECT * FROM hama_artifacts WHERE mission_id = ? ORDER BY rowid ASC',
      )
      .all(missionId) as SqlRow[];
    return rows.map(r => this.mapArtifact(r));
  }

  addComment(input: {
    missionId: string;
    scopeKey: string;
    paragraphRef?: string;
    authorKind: 'human' | 'agent';
    authorLabel: string;
    severity: 'blocking' | 'advisory';
    body: string;
  }): HamaCommentRecord {
    const id = `cmt-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        `INSERT INTO hama_comments
         (id, mission_id, scope_key, paragraph_ref, author_kind, author_label, severity, body, disposition, resolution_note, resolved_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', '', NULL, ?, ?)`,
      )
      .run(
        id,
        input.missionId,
        input.scopeKey,
        input.paragraphRef ?? '',
        input.authorKind,
        input.authorLabel,
        input.severity,
        input.body,
        now,
        now,
      );
    return this.getComment(id)!;
  }

  getComment(commentId: string): HamaCommentRecord | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM hama_comments WHERE id = ?')
      .get(commentId) as SqlRow | undefined;
    return row ? this.mapComment(row) : null;
  }

  listComments(missionId: string): HamaCommentRecord[] {
    const rows = this.ctx.db
      .prepare(
        'SELECT * FROM hama_comments WHERE mission_id = ? ORDER BY created_at ASC',
      )
      .all(missionId) as SqlRow[];
    return rows.map(r => this.mapComment(r));
  }

  updateCommentDisposition(input: {
    commentId: string;
    disposition: CommentDisposition;
    resolutionNote: string;
    resolvedBy: string;
    actorKind: 'human' | 'agent';
  }): HamaCommentRecord {
    const existing = this.getComment(input.commentId);
    if (!existing) {
      throw new ForgeError(
        'NOT_FOUND',
        `Comment "${input.commentId}" not found`,
        404,
      );
    }
    if (
      input.actorKind === 'agent' &&
      existing.authorKind === 'human' &&
      existing.severity === 'blocking' &&
      (input.disposition === 'rejected' || input.disposition === 'deferred')
    ) {
      throw new ForgeError(
        'POLICY_DENIED',
        'Agents cannot reject or defer human-authored blocking comments',
        403,
      );
    }
    const now = new Date().toISOString();
    this.ctx.db
      .prepare(
        `UPDATE hama_comments SET
           disposition = ?,
           resolution_note = ?,
           resolved_by = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.disposition,
        input.resolutionNote,
        input.resolvedBy,
        now,
        input.commentId,
      );
    return this.getComment(input.commentId)!;
  }

  countOpenBlockingComments(missionId: string): number {
    const row = this.ctx.db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM hama_comments WHERE mission_id = ? AND severity = 'blocking' AND disposition = 'open'",
      )
      .get(missionId) as SqlRow;
    return num(row, 'cnt');
  }

  publishBaselineAtomic(
    baseline: ApprovedRequirementsBaseline,
  ): ApprovedRequirementsBaseline {
    return this.ctx.atomic(() => {
      const openBlocking = this.countOpenBlockingComments(baseline.missionId);
      if (openBlocking > 0) {
        throw new ForgeError(
          'CONFLICT',
          `Cannot publish baseline: ${openBlocking} open blocking comment(s) remain unresolved`,
          409,
        );
      }

      const head = this.latestBaselineForProject(
        baseline.projectId,
        baseline.mode,
      );
      if ((head?.id ?? null) !== baseline.parentId) {
        throw new ForgeError(
          'CONFLICT',
          'Baseline parent mismatch: a newer baseline has already been published',
          409,
        );
      }

      this.ctx.db
        .prepare(
          `INSERT INTO approved_baselines
           (id, project_id, mode, revision, parent_id, mission_id, prd_artifact_id, sha256, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          baseline.id,
          baseline.projectId,
          baseline.mode,
          baseline.revision,
          baseline.parentId,
          baseline.missionId,
          baseline.approvedPrd.id,
          baseline.sha256,
          JSON.stringify(baseline),
          baseline.createdAt,
        );

      return baseline;
    });
  }

  getBaseline(id: string): ApprovedRequirementsBaseline | null {
    const row = this.ctx.db
      .prepare('SELECT payload_json FROM approved_baselines WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row
      ? parseJson<ApprovedRequirementsBaseline | null>(
          str(row, 'payload_json'),
          null,
        )
      : null;
  }

  getBaselineByMission(missionId: string): ApprovedRequirementsBaseline | null {
    const row = this.ctx.db
      .prepare(
        'SELECT payload_json FROM approved_baselines WHERE mission_id = ?',
      )
      .get(missionId) as SqlRow | undefined;
    return row
      ? parseJson<ApprovedRequirementsBaseline | null>(
          str(row, 'payload_json'),
          null,
        )
      : null;
  }

  latestBaselineForProject(
    projectId: string,
    mode: ExecutionMode,
  ): ApprovedRequirementsBaseline | null {
    const row = this.ctx.db
      .prepare(
        'SELECT payload_json FROM approved_baselines WHERE project_id = ? AND mode = ? ORDER BY revision DESC LIMIT 1',
      )
      .get(projectId, mode) as SqlRow | undefined;
    return row
      ? parseJson<ApprovedRequirementsBaseline | null>(
          str(row, 'payload_json'),
          null,
        )
      : null;
  }

  listBaselines(projectId?: string): ApprovedRequirementsBaseline[] {
    const rows = (
      projectId
        ? this.ctx.db
            .prepare(
              'SELECT payload_json FROM approved_baselines WHERE project_id = ? ORDER BY mode ASC, revision DESC',
            )
            .all(projectId)
        : this.ctx.db
            .prepare(
              'SELECT payload_json FROM approved_baselines ORDER BY created_at DESC',
            )
            .all()
    ) as SqlRow[];
    return rows
      .map(r =>
        parseJson<ApprovedRequirementsBaseline | null>(
          str(r, 'payload_json'),
          null,
        ),
      )
      .filter((b): b is ApprovedRequirementsBaseline => b !== null);
  }

  private mapArtifact<T, K extends string = string>(
    row: SqlRow,
  ): HamaArtifactRecord<T, K> {
    return {
      id: str(row, 'id'),
      missionId: str(row, 'mission_id'),
      kind: str(row, 'kind') as K,
      subject: str(row, 'subject'),
      revision: num(row, 'revision'),
      hash: str(row, 'hash'),
      createdAt: str(row, 'created_at'),
      data: JSON.parse(str(row, 'data_json')) as T,
    };
  }

  private mapComment(row: SqlRow): HamaCommentRecord {
    return {
      id: str(row, 'id'),
      missionId: str(row, 'mission_id'),
      scopeKey: str(row, 'scope_key'),
      paragraphRef: str(row, 'paragraph_ref'),
      authorKind: str(row, 'author_kind') as 'human' | 'agent',
      authorLabel: str(row, 'author_label'),
      severity: str(row, 'severity') as 'blocking' | 'advisory',
      body: str(row, 'body'),
      disposition: str(row, 'disposition') as CommentDisposition,
      resolutionNote: str(row, 'resolution_note'),
      resolvedBy: nullableStr(row, 'resolved_by'),
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at'),
    };
  }
}

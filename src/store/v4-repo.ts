/**
 * SQLite persistence repository for SDLC-Studio v4 Master Agent Orchestration,
 * Raft Consensus Log, Board <-> Spec IR Docs, Artifact Pins, Task WBS Plans,
 * Turn Diff Snapshots, Ship Reviews, Collab Messages, and Hosted Apps.
 */

import {randomUUID} from 'node:crypto';
import {ForgeError} from '../shared/errors.ts';
import type {
  ArtifactPin,
  ArtifactPinStatus,
  ArtifactSurfaceType,
  BoardSceneDoc,
  CollabEventMeta,
  CollabFeedItem,
  ConsensusAuthorKind,
  ConsensusCommitState,
  ConsensusEntryType,
  ConsensusLogEntry,
  DecisionCardPayload,
  DecomposedTaskNode,
  GrillingPayload,
  HostedAppCard,
  KernelId,
  MasterChatKind,
  MasterChatMessage,
  MasterChatRole,
  MasterExecutionMode,
  MasterSession,
  MasterSessionMode,
  MasterStage,
  QuantizationResult,
  ShipReviewBundle,
  ShipReviewDepth,
  ShipReviewFinding,
  ShipStewardFix,
  SpecIRContract,
  TaskDecompositionPlan,
  TaskNodeRole,
  TraceSummaryItem,
  TurnDiffFile,
  TurnDiffSnapshot,
} from '../shared/v4-types.ts';
import {
  nullableStr,
  num,
  parseJson,
  str,
  type SqlRow,
  type StoreContext,
} from './repo-helpers.ts';

function nowIso(): string {
  return new Date().toISOString();
}

function mapSession(row: SqlRow): MasterSession {
  return {
    id: str(row, 'id'),
    title: str(row, 'title'),
    mode: str(row, 'mode') as MasterSessionMode,
    executionMode: str(row, 'execution_mode') as MasterExecutionMode,
    workspacePath: str(row, 'workspace_path'),
    hubId: str(row, 'hub_id'),
    repoId: str(row, 'repo_id'),
    stage: str(row, 'stage') as MasterStage,
    term: num(row, 'term'),
    crPassed: num(row, 'cr_passed') === 1,
    activePlanId: nullableStr(row, 'active_plan_id'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}

function mapChatMessage(row: SqlRow): MasterChatMessage {
  const decisionRaw = nullableStr(row, 'decision_card_json');
  const grillingRaw = nullableStr(row, 'grilling_json');
  const collabRaw = nullableStr(row, 'collab_meta_json');
  const traceRaw = nullableStr(row, 'trace_items_json');
  return {
    id: str(row, 'id'),
    sessionId: str(row, 'session_id'),
    role: str(row, 'role') as MasterChatRole,
    agentKernel: str(row, 'agent_kernel') as KernelId,
    kind: str(row, 'kind') as MasterChatKind,
    content: str(row, 'content'),
    decisionCard: decisionRaw
      ? parseJson<DecisionCardPayload | undefined>(decisionRaw, undefined)
      : undefined,
    grilling: grillingRaw
      ? parseJson<GrillingPayload | undefined>(grillingRaw, undefined)
      : undefined,
    collabMeta: collabRaw
      ? parseJson<CollabEventMeta | undefined>(collabRaw, undefined)
      : undefined,
    traceItems: traceRaw
      ? parseJson<readonly TraceSummaryItem[] | undefined>(traceRaw, undefined)
      : undefined,
    createdAt: str(row, 'created_at'),
  };
}

function mapConsensusEntry(row: SqlRow): ConsensusLogEntry {
  return {
    id: str(row, 'id'),
    sessionId: str(row, 'session_id'),
    term: num(row, 'term'),
    logSeq: num(row, 'log_seq'),
    authorPrincipalId: str(row, 'author_principal_id'),
    authorKind: str(row, 'author_kind') as ConsensusAuthorKind,
    entryType: str(row, 'entry_type') as ConsensusEntryType,
    specAnchorId: nullableStr(row, 'spec_anchor_id'),
    payloadJson: str(row, 'payload_json'),
    commitState: str(row, 'commit_state') as ConsensusCommitState,
    createdAt: str(row, 'created_at'),
  };
}

function mapPin(row: SqlRow): ArtifactPin {
  return {
    id: str(row, 'id'),
    sessionId: str(row, 'session_id'),
    surfaceType: str(row, 'surface_type') as ArtifactSurfaceType,
    anchorJson: str(row, 'anchor_json'),
    specNodeId: nullableStr(row, 'spec_node_id'),
    pinNumber: num(row, 'pin_number'),
    promptText: str(row, 'prompt_text'),
    status: str(row, 'status') as ArtifactPinStatus,
    replyText: nullableStr(row, 'reply_text'),
    createdAt: str(row, 'created_at'),
    resolvedAt: nullableStr(row, 'resolved_at'),
  };
}

function mapPlan(row: SqlRow): TaskDecompositionPlan {
  return {
    id: str(row, 'id'),
    sessionId: str(row, 'session_id'),
    specRevision: num(row, 'spec_revision'),
    status: str(row, 'status') as TaskDecompositionPlan['status'],
    tasks: parseJson<readonly DecomposedTaskNode[]>(str(row, 'tasks_json'), []),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}

function mapDiffSnapshot(row: SqlRow): TurnDiffSnapshot {
  return {
    id: str(row, 'id'),
    sessionId: str(row, 'session_id'),
    taskId: str(row, 'task_id'),
    kernelId: str(row, 'kernel_id') as KernelId,
    beforeTreeSha: str(row, 'before_tree_sha'),
    afterTreeSha: str(row, 'after_tree_sha'),
    files: parseJson<readonly TurnDiffFile[]>(str(row, 'files_json'), []),
    createdAt: str(row, 'created_at'),
  };
}

function mapShipReview(row: SqlRow): ShipReviewBundle {
  return {
    id: str(row, 'id'),
    sessionId: str(row, 'session_id'),
    planId: str(row, 'plan_id'),
    reviewDepth: str(row, 'review_depth') as ShipReviewDepth,
    reviewerKernel: str(row, 'reviewer_kernel') as KernelId,
    coderKernels: parseJson<readonly KernelId[]>(
      str(row, 'coder_kernels_json'),
      [],
    ),
    antiSelfApprovalPassed: num(row, 'anti_self_approval_passed') === 1,
    findings: parseJson<readonly ShipReviewFinding[]>(
      str(row, 'findings_json'),
      [],
    ),
    stewardFixes: parseJson<readonly ShipStewardFix[]>(
      str(row, 'steward_fixes_json'),
      [],
    ),
    policyMode: str(row, 'policy_mode') as 'shadow' | 'enforced',
    wouldApprove: num(row, 'would_approve') === 1,
    answerHtml: str(row, 'answer_html'),
    verdict: str(row, 'verdict') as 'pending' | 'passed' | 'rejected',
    createdAt: str(row, 'created_at'),
  };
}

function mapCollab(row: SqlRow): CollabFeedItem {
  return {
    id: str(row, 'id'),
    sessionId: str(row, 'session_id'),
    seq: num(row, 'seq'),
    fromKernel: str(row, 'from_kernel') as KernelId,
    toKernel: str(row, 'to_kernel') as KernelId | 'all',
    kind: str(row, 'kind') as CollabFeedItem['kind'],
    taskId: nullableStr(row, 'task_id'),
    audienceScope: str(row, 'audience_scope'),
    content: str(row, 'content'),
    createdAt: str(row, 'created_at'),
  };
}

function mapHostedApp(row: SqlRow): HostedAppCard {
  const npsRaw = row['nps_score'];
  const csatRaw = row['csat_score'];
  return {
    id: str(row, 'id'),
    sessionId: str(row, 'session_id'),
    name: str(row, 'name'),
    versionTag: str(row, 'version_tag'),
    workspacePath: str(row, 'workspace_path'),
    entryCommand: str(row, 'entry_command'),
    urlOrPort: nullableStr(row, 'url_or_port'),
    status: str(row, 'status') as HostedAppCard['status'],
    commitSha: nullableStr(row, 'commit_sha'),
    npsScore: typeof npsRaw === 'number' ? npsRaw : null,
    csatScore: typeof csatRaw === 'number' ? csatRaw : null,
    updatedAt: str(row, 'updated_at'),
  };
}

export class V4Repository {
  private readonly ctx: StoreContext;

  constructor(ctx: StoreContext) {
    this.ctx = ctx;
  }

  createSession(input: {
    readonly id?: string;
    readonly title: string;
    readonly mode: MasterSessionMode;
    readonly executionMode: MasterExecutionMode;
    readonly workspacePath: string;
    readonly hubId: string;
    readonly repoId: string;
    readonly stage?: MasterStage;
    readonly term?: number;
  }): MasterSession {
    const id = input.id ?? `v4s-${randomUUID().slice(0, 12)}`;
    const now = nowIso();
    this.ctx.db
      .prepare(
        `INSERT INTO v4_master_sessions (
          id, title, mode, execution_mode, workspace_path, hub_id, repo_id,
          stage, term, cr_passed, active_plan_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.mode,
        input.executionMode,
        input.workspacePath,
        input.hubId,
        input.repoId,
        input.stage ?? 'intent',
        input.term ?? 1,
        now,
        now,
      );
    return this.getSessionOrThrow(id);
  }

  getSession(id: string): MasterSession | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM v4_master_sessions WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row ? mapSession(row) : null;
  }

  getSessionOrThrow(id: string): MasterSession {
    const found = this.getSession(id);
    if (!found) {
      throw new ForgeError(
        'NOT_FOUND',
        `Master session "${id}" not found`,
        404,
      );
    }
    return found;
  }

  listSessions(): MasterSession[] {
    const rows = this.ctx.db
      .prepare('SELECT * FROM v4_master_sessions ORDER BY updated_at DESC')
      .all() as SqlRow[];
    return rows.map(mapSession);
  }

  updateSession(
    id: string,
    patch: {
      readonly title?: string;
      readonly mode?: MasterSessionMode;
      readonly executionMode?: MasterExecutionMode;
      readonly stage?: MasterStage;
      readonly term?: number;
      readonly crPassed?: boolean;
      readonly activePlanId?: string | null;
    },
  ): MasterSession {
    const current = this.getSessionOrThrow(id);
    const now = nowIso();
    this.ctx.db
      .prepare(
        `UPDATE v4_master_sessions
         SET title = ?, mode = ?, execution_mode = ?, stage = ?, term = ?,
             cr_passed = ?, active_plan_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.title ?? current.title,
        patch.mode ?? current.mode,
        patch.executionMode ?? current.executionMode,
        patch.stage ?? current.stage,
        patch.term ?? current.term,
        (patch.crPassed ?? current.crPassed) ? 1 : 0,
        patch.activePlanId !== undefined
          ? patch.activePlanId
          : current.activePlanId,
        now,
        id,
      );
    return this.getSessionOrThrow(id);
  }

  appendMessage(input: {
    readonly sessionId: string;
    readonly role: MasterChatRole;
    readonly agentKernel: KernelId;
    readonly kind: MasterChatKind;
    readonly content: string;
    readonly decisionCard?: DecisionCardPayload;
    readonly grilling?: GrillingPayload;
    readonly collabMeta?: CollabEventMeta;
    readonly traceItems?: readonly TraceSummaryItem[];
  }): MasterChatMessage {
    const id = `v4m-${randomUUID().slice(0, 12)}`;
    const now = nowIso();
    this.ctx.db
      .prepare(
        `INSERT INTO v4_chat_messages (
          id, session_id, role, agent_kernel, kind, content,
          decision_card_json, grilling_json, collab_meta_json, trace_items_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.role,
        input.agentKernel,
        input.kind,
        input.content,
        input.decisionCard ? JSON.stringify(input.decisionCard) : null,
        input.grilling ? JSON.stringify(input.grilling) : null,
        input.collabMeta ? JSON.stringify(input.collabMeta) : null,
        input.traceItems ? JSON.stringify(input.traceItems) : null,
        now,
      );
    this.ctx.db
      .prepare('UPDATE v4_master_sessions SET updated_at = ? WHERE id = ?')
      .run(now, input.sessionId);
    const row = this.ctx.db
      .prepare('SELECT * FROM v4_chat_messages WHERE id = ?')
      .get(id) as SqlRow;
    return mapChatMessage(row);
  }

  updateMessageGrilling(
    messageId: string,
    grilling: GrillingPayload,
  ): MasterChatMessage | null {
    this.ctx.db
      .prepare('UPDATE v4_chat_messages SET grilling_json = ? WHERE id = ?')
      .run(JSON.stringify(grilling), messageId);
    const row = this.ctx.db
      .prepare('SELECT * FROM v4_chat_messages WHERE id = ?')
      .get(messageId) as SqlRow | undefined;
    return row ? mapChatMessage(row) : null;
  }

  listMessages(sessionId: string): MasterChatMessage[] {
    const rows = this.ctx.db
      .prepare(
        'SELECT * FROM v4_chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(sessionId) as SqlRow[];
    return rows.map(mapChatMessage);
  }

  appendConsensusEntry(input: {
    readonly sessionId: string;
    readonly term: number;
    readonly authorPrincipalId: string;
    readonly authorKind: ConsensusAuthorKind;
    readonly entryType: ConsensusEntryType;
    readonly specAnchorId?: string | null;
    readonly payload: unknown;
    readonly commitState?: ConsensusCommitState;
  }): ConsensusLogEntry {
    return this.ctx.atomic(() => {
      const seqRow = this.ctx.db
        .prepare(
          `SELECT COALESCE(MAX(log_seq), 0) AS max_seq
           FROM v4_consensus_log_entries
           WHERE session_id = ? AND term = ?`,
        )
        .get(input.sessionId, input.term) as SqlRow | undefined;
      const nextSeq = num(seqRow ?? {}, 'max_seq') + 1;
      const id = `v4c-${randomUUID().slice(0, 12)}`;
      const now = nowIso();
      this.ctx.db
        .prepare(
          `INSERT INTO v4_consensus_log_entries (
            id, session_id, term, log_seq, author_principal_id, author_kind,
            entry_type, spec_anchor_id, payload_json, commit_state, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.sessionId,
          input.term,
          nextSeq,
          input.authorPrincipalId,
          input.authorKind,
          input.entryType,
          input.specAnchorId ?? null,
          JSON.stringify(input.payload),
          input.commitState ?? 'proposed',
          now,
        );
      const row = this.ctx.db
        .prepare('SELECT * FROM v4_consensus_log_entries WHERE id = ?')
        .get(id) as SqlRow;
      return mapConsensusEntry(row);
    });
  }

  commitConsensusTerm(sessionId: string, term: number): void {
    this.ctx.db
      .prepare(
        `UPDATE v4_consensus_log_entries
         SET commit_state = 'committed'
         WHERE session_id = ? AND term = ? AND commit_state = 'proposed'`,
      )
      .run(sessionId, term);
  }

  supersedeConsensusBeforeTerm(sessionId: string, term: number): void {
    this.ctx.db
      .prepare(
        `UPDATE v4_consensus_log_entries
         SET commit_state = 'superseded'
         WHERE session_id = ? AND term < ? AND commit_state = 'proposed'`,
      )
      .run(sessionId, term);
  }

  listConsensusLog(sessionId: string): ConsensusLogEntry[] {
    const rows = this.ctx.db
      .prepare(
        `SELECT * FROM v4_consensus_log_entries
         WHERE session_id = ?
         ORDER BY term ASC, log_seq ASC`,
      )
      .all(sessionId) as SqlRow[];
    return rows.map(mapConsensusEntry);
  }

  getWorkspaceDoc<T>(
    sessionId: string,
    kind: 'board_scene' | 'spec_ir' | 'quantization' | 'rulings_ledger',
  ): {readonly revision: number; readonly data: T} | null {
    const row = this.ctx.db
      .prepare(
        `SELECT revision, content_json FROM v4_workspace_docs
         WHERE session_id = ? AND kind = ?`,
      )
      .get(sessionId, kind) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    const parsed = parseJson<T | null>(str(row, 'content_json'), null);
    if (parsed === null) {
      return null;
    }
    return {
      revision: num(row, 'revision'),
      data: parsed,
    };
  }

  saveWorkspaceDoc<T>(
    sessionId: string,
    kind: 'board_scene' | 'spec_ir' | 'quantization' | 'rulings_ledger',
    data: T,
    expectedRevision?: number,
  ): {readonly revision: number; readonly data: T} {
    return this.ctx.atomic(() => {
      const existing = this.ctx.db
        .prepare(
          `SELECT revision FROM v4_workspace_docs
           WHERE session_id = ? AND kind = ?`,
        )
        .get(sessionId, kind) as SqlRow | undefined;

      const currentRev = existing ? num(existing, 'revision') : 0;
      if (
        expectedRevision !== undefined &&
        currentRev > 0 &&
        expectedRevision !== currentRev
      ) {
        throw new ForgeError(
          'CONFLICT',
          `Workspace doc "${kind}" revision mismatch (expected ${expectedRevision}, actual ${currentRev})`,
          409,
        );
      }

      const nextRev = currentRev + 1;
      const now = nowIso();
      const normalized =
        typeof data === 'object' && data !== null && 'revision' in data
          ? ({...(data as Record<string, unknown>), revision: nextRev} as T)
          : data;

      if (existing) {
        this.ctx.db
          .prepare(
            `UPDATE v4_workspace_docs
             SET revision = ?, content_json = ?, updated_at = ?
             WHERE session_id = ? AND kind = ?`,
          )
          .run(nextRev, JSON.stringify(normalized), now, sessionId, kind);
      } else {
        this.ctx.db
          .prepare(
            `INSERT INTO v4_workspace_docs (
              session_id, kind, revision, content_json, updated_at
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(sessionId, kind, nextRev, JSON.stringify(normalized), now);
      }
      return {revision: nextRev, data: normalized};
    });
  }

  getBoardDoc(sessionId: string): BoardSceneDoc | null {
    return (
      this.getWorkspaceDoc<BoardSceneDoc>(sessionId, 'board_scene')?.data ??
      null
    );
  }

  getSpecIR(sessionId: string): SpecIRContract | null {
    return (
      this.getWorkspaceDoc<SpecIRContract>(sessionId, 'spec_ir')?.data ?? null
    );
  }

  getQuantization(sessionId: string): QuantizationResult | null {
    return (
      this.getWorkspaceDoc<QuantizationResult>(sessionId, 'quantization')
        ?.data ?? null
    );
  }

  createPin(input: {
    readonly sessionId: string;
    readonly surfaceType: ArtifactSurfaceType;
    readonly anchorJson: string;
    readonly specNodeId?: string | null;
    readonly promptText: string;
  }): ArtifactPin {
    return this.ctx.atomic(() => {
      const maxRow = this.ctx.db
        .prepare(
          `SELECT COALESCE(MAX(pin_number), 0) AS max_pin
           FROM v4_artifact_pins WHERE session_id = ?`,
        )
        .get(input.sessionId) as SqlRow | undefined;
      const pinNumber = num(maxRow ?? {}, 'max_pin') + 1;
      const id = `v4p-${randomUUID().slice(0, 12)}`;
      const now = nowIso();
      this.ctx.db
        .prepare(
          `INSERT INTO v4_artifact_pins (
            id, session_id, surface_type, anchor_json, spec_node_id,
            pin_number, prompt_text, status, reply_text, created_at, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting_on_agent', NULL, ?, NULL)`,
        )
        .run(
          id,
          input.sessionId,
          input.surfaceType,
          input.anchorJson,
          input.specNodeId ?? null,
          pinNumber,
          input.promptText,
          now,
        );
      const row = this.ctx.db
        .prepare('SELECT * FROM v4_artifact_pins WHERE id = ?')
        .get(id) as SqlRow;
      return mapPin(row);
    });
  }

  getPin(pinId: string): ArtifactPin | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM v4_artifact_pins WHERE id = ?')
      .get(pinId) as SqlRow | undefined;
    return row ? mapPin(row) : null;
  }

  updatePin(
    pinId: string,
    patch: {
      readonly status?: ArtifactPinStatus;
      readonly replyText?: string | null;
    },
  ): ArtifactPin {
    const current = this.getPin(pinId);
    if (!current) {
      throw new ForgeError('NOT_FOUND', `Pin "${pinId}" not found`, 404);
    }
    const nextStatus = patch.status ?? current.status;
    const resolvedAt =
      nextStatus === 'resolved' ? (current.resolvedAt ?? nowIso()) : null;
    this.ctx.db
      .prepare(
        `UPDATE v4_artifact_pins
         SET status = ?, reply_text = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(
        nextStatus,
        patch.replyText !== undefined ? patch.replyText : current.replyText,
        resolvedAt,
        pinId,
      );
    return this.getPin(pinId)!;
  }

  listPins(sessionId: string): ArtifactPin[] {
    const rows = this.ctx.db
      .prepare(
        'SELECT * FROM v4_artifact_pins WHERE session_id = ? ORDER BY pin_number ASC',
      )
      .all(sessionId) as SqlRow[];
    return rows.map(mapPin);
  }

  saveTaskPlan(plan: {
    readonly id?: string;
    readonly sessionId: string;
    readonly specRevision: number;
    readonly status: TaskDecompositionPlan['status'];
    readonly tasks: readonly DecomposedTaskNode[];
  }): TaskDecompositionPlan {
    const id = plan.id ?? `v4plan-${randomUUID().slice(0, 10)}`;
    const now = nowIso();
    const existing = this.getTaskPlan(id);
    if (existing) {
      this.ctx.db
        .prepare(
          `UPDATE v4_task_plans
           SET spec_revision = ?, status = ?, tasks_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          plan.specRevision,
          plan.status,
          JSON.stringify(plan.tasks),
          now,
          id,
        );
    } else {
      this.ctx.db
        .prepare(
          `INSERT INTO v4_task_plans (
            id, session_id, spec_revision, status, tasks_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          plan.sessionId,
          plan.specRevision,
          plan.status,
          JSON.stringify(plan.tasks),
          now,
          now,
        );
    }
    return this.getTaskPlan(id)!;
  }

  getTaskPlan(planId: string): TaskDecompositionPlan | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM v4_task_plans WHERE id = ?')
      .get(planId) as SqlRow | undefined;
    return row ? mapPlan(row) : null;
  }

  getLatestTaskPlanForSession(sessionId: string): TaskDecompositionPlan | null {
    const row = this.ctx.db
      .prepare(
        `SELECT * FROM v4_task_plans
         WHERE session_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(sessionId) as SqlRow | undefined;
    return row ? mapPlan(row) : null;
  }

  recordTurnDiffSnapshot(input: {
    readonly sessionId: string;
    readonly taskId: string;
    readonly kernelId: KernelId;
    readonly beforeTreeSha: string;
    readonly afterTreeSha: string;
    readonly files: readonly TurnDiffFile[];
  }): TurnDiffSnapshot {
    const id = `v4diff-${randomUUID().slice(0, 12)}`;
    const now = nowIso();
    this.ctx.db
      .prepare(
        `INSERT INTO v4_turn_diff_snapshots (
          id, session_id, task_id, kernel_id, before_tree_sha,
          after_tree_sha, files_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.taskId,
        input.kernelId,
        input.beforeTreeSha,
        input.afterTreeSha,
        JSON.stringify(input.files),
        now,
      );
    const row = this.ctx.db
      .prepare('SELECT * FROM v4_turn_diff_snapshots WHERE id = ?')
      .get(id) as SqlRow;
    return mapDiffSnapshot(row);
  }

  listTurnDiffSnapshots(sessionId: string): TurnDiffSnapshot[] {
    const rows = this.ctx.db
      .prepare(
        `SELECT * FROM v4_turn_diff_snapshots
         WHERE session_id = ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(sessionId) as SqlRow[];
    return rows.map(mapDiffSnapshot);
  }

  createShipReview(input: {
    readonly sessionId: string;
    readonly planId: string;
    readonly reviewDepth: ShipReviewDepth;
    readonly reviewerKernel: KernelId;
    readonly coderKernels: readonly KernelId[];
    readonly antiSelfApprovalPassed: boolean;
    readonly findings: readonly ShipReviewFinding[];
    readonly stewardFixes: readonly ShipStewardFix[];
    readonly policyMode: 'shadow' | 'enforced';
    readonly wouldApprove: boolean;
    readonly answerHtml: string;
    readonly verdict?: 'pending' | 'passed' | 'rejected';
  }): ShipReviewBundle {
    const id = `v4ship-${randomUUID().slice(0, 12)}`;
    const now = nowIso();
    this.ctx.db
      .prepare(
        `INSERT INTO v4_ship_reviews (
          id, session_id, plan_id, review_depth, reviewer_kernel,
          coder_kernels_json, anti_self_approval_passed, findings_json,
          steward_fixes_json, policy_mode, would_approve, answer_html,
          verdict, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.planId,
        input.reviewDepth,
        input.reviewerKernel,
        JSON.stringify(input.coderKernels),
        input.antiSelfApprovalPassed ? 1 : 0,
        JSON.stringify(input.findings),
        JSON.stringify(input.stewardFixes),
        input.policyMode,
        input.wouldApprove ? 1 : 0,
        input.answerHtml,
        input.verdict ?? 'pending',
        now,
      );
    return this.getShipReview(id)!;
  }

  getShipReview(reviewId: string): ShipReviewBundle | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM v4_ship_reviews WHERE id = ?')
      .get(reviewId) as SqlRow | undefined;
    return row ? mapShipReview(row) : null;
  }

  getLatestShipReview(sessionId: string): ShipReviewBundle | null {
    const row = this.ctx.db
      .prepare(
        `SELECT * FROM v4_ship_reviews
         WHERE session_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(sessionId) as SqlRow | undefined;
    return row ? mapShipReview(row) : null;
  }

  updateShipReviewVerdict(
    reviewId: string,
    verdict: 'pending' | 'passed' | 'rejected',
  ): ShipReviewBundle {
    const existing = this.getShipReview(reviewId);
    if (!existing) {
      throw new ForgeError(
        'NOT_FOUND',
        `Ship review "${reviewId}" not found`,
        404,
      );
    }
    this.ctx.db
      .prepare('UPDATE v4_ship_reviews SET verdict = ? WHERE id = ?')
      .run(verdict, reviewId);
    return this.getShipReview(reviewId)!;
  }

  appendCollabMessage(input: {
    readonly sessionId: string;
    readonly fromKernel: KernelId;
    readonly toKernel: KernelId | 'all';
    readonly kind: CollabFeedItem['kind'];
    readonly taskId?: string | null;
    readonly audienceScope?: string;
    readonly content: string;
  }): CollabFeedItem {
    return this.ctx.atomic(() => {
      const seqRow = this.ctx.db
        .prepare(
          `SELECT COALESCE(MAX(seq), 0) AS max_seq
           FROM v4_collab_messages WHERE session_id = ?`,
        )
        .get(input.sessionId) as SqlRow | undefined;
      const nextSeq = num(seqRow ?? {}, 'max_seq') + 1;
      const id = `v4col-${randomUUID().slice(0, 12)}`;
      const now = nowIso();
      this.ctx.db
        .prepare(
          `INSERT INTO v4_collab_messages (
            id, session_id, seq, from_kernel, to_kernel, kind,
            task_id, audience_scope, content, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.sessionId,
          nextSeq,
          input.fromKernel,
          input.toKernel,
          input.kind,
          input.taskId ?? null,
          input.audienceScope ?? 'world',
          input.content,
          now,
        );
      const row = this.ctx.db
        .prepare('SELECT * FROM v4_collab_messages WHERE id = ?')
        .get(id) as SqlRow;
      return mapCollab(row);
    });
  }

  listCollabMessages(
    sessionId?: string,
    readerPrincipal?: string,
    limit = 100,
  ): CollabFeedItem[] {
    const rows = sessionId
      ? (this.ctx.db
          .prepare(
            `SELECT * FROM v4_collab_messages
             WHERE session_id = ?
             ORDER BY seq ASC LIMIT ?`,
          )
          .all(sessionId, limit) as SqlRow[])
      : (this.ctx.db
          .prepare(
            `SELECT * FROM v4_collab_messages
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(limit) as SqlRow[]);
    const mapped = rows.map(mapCollab);
    if (!readerPrincipal) {
      return mapped;
    }
    return mapped.filter(item => {
      if (item.audienceScope === 'world' || item.audienceScope === 'team') {
        return true;
      }
      if (item.audienceScope.startsWith('private:')) {
        const owner = item.audienceScope.slice('private:'.length);
        return (
          owner === readerPrincipal ||
          item.fromKernel === readerPrincipal ||
          item.toKernel === readerPrincipal
        );
      }
      return true;
    });
  }

  upsertHostedApp(input: {
    readonly id?: string;
    readonly sessionId: string;
    readonly name: string;
    readonly versionTag: string;
    readonly workspacePath: string;
    readonly entryCommand: string;
    readonly urlOrPort?: string | null;
    readonly status: HostedAppCard['status'];
    readonly commitSha?: string | null;
    readonly npsScore?: number | null;
    readonly csatScore?: number | null;
  }): HostedAppCard {
    const id = input.id ?? `v4app-${randomUUID().slice(0, 10)}`;
    const now = nowIso();
    const existing = this.getHostedApp(id);
    if (existing) {
      this.ctx.db
        .prepare(
          `UPDATE v4_hosted_apps
           SET name = ?, version_tag = ?, workspace_path = ?, entry_command = ?,
               url_or_port = ?, status = ?, commit_sha = ?, nps_score = ?,
               csat_score = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name,
          input.versionTag,
          input.workspacePath,
          input.entryCommand,
          input.urlOrPort ?? existing.urlOrPort,
          input.status,
          input.commitSha !== undefined ? input.commitSha : existing.commitSha,
          input.npsScore !== undefined ? input.npsScore : existing.npsScore,
          input.csatScore !== undefined ? input.csatScore : existing.csatScore,
          now,
          id,
        );
    } else {
      this.ctx.db
        .prepare(
          `INSERT INTO v4_hosted_apps (
            id, session_id, name, version_tag, workspace_path, entry_command,
            url_or_port, status, commit_sha, nps_score, csat_score, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.sessionId,
          input.name,
          input.versionTag,
          input.workspacePath,
          input.entryCommand,
          input.urlOrPort ?? null,
          input.status,
          input.commitSha ?? null,
          input.npsScore ?? null,
          input.csatScore ?? null,
          now,
        );
    }
    return this.getHostedApp(id)!;
  }

  getHostedApp(id: string): HostedAppCard | null {
    const row = this.ctx.db
      .prepare('SELECT * FROM v4_hosted_apps WHERE id = ?')
      .get(id) as SqlRow | undefined;
    return row ? mapHostedApp(row) : null;
  }

  listHostedApps(sessionId?: string): HostedAppCard[] {
    const rows = sessionId
      ? (this.ctx.db
          .prepare(
            'SELECT * FROM v4_hosted_apps WHERE session_id = ? ORDER BY updated_at DESC',
          )
          .all(sessionId) as SqlRow[])
      : (this.ctx.db
          .prepare('SELECT * FROM v4_hosted_apps ORDER BY updated_at DESC')
          .all() as SqlRow[]);
    return rows.map(mapHostedApp);
  }

  getRoleRoutingSetting(): Partial<Record<TaskNodeRole, KernelId>> | null {
    const row = this.ctx.db
      .prepare('SELECT value_json FROM v4_settings_kv WHERE key = ?')
      .get('role_routing') as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return parseJson<Partial<Record<TaskNodeRole, KernelId>> | null>(
      str(row, 'value_json'),
      null,
    );
  }

  saveRoleRoutingSetting(
    routing: Readonly<Record<TaskNodeRole, KernelId>>,
  ): void {
    const now = nowIso();
    this.ctx.db
      .prepare(
        `INSERT INTO v4_settings_kv (key, value_json, updated_at)
         VALUES ('role_routing', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(routing), now);
  }
}

import {randomBytes, randomUUID} from 'node:crypto';
import {sha256Canonical, sha256Text} from '../core/canonical-json.ts';
import {
  SchemaError,
  extractJsonPayload,
  type Schema,
} from '../core/schema-dsl.ts';
import {selectHealthyAdapterForRole} from '../core/telemetry.ts';
import type {IAgentAdapterHub} from '../adapters/contracts.ts';
import {resolvePresetPolicy} from '../shared/control-schema.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  AddCommentRequest,
  ForgeSseEvent,
  HamaDetailSnapshot,
  ResolveCommentDispositionRequest,
} from '../shared/api.ts';
import type {
  ApprovedRequirementsBaseline,
  ArtifactRef,
  DecisionOptionPreview,
  MissionDecisionRecord,
  MissionGateKind,
  MissionGateRecord,
  MissionRecord,
  PrdDocument,
  RequirementItem,
  TraceLink,
} from '../shared/v3-types.ts';
import type {ForgeStore} from '../store/database.ts';
import {
  EVAL_DIMENSIONS,
  ROLES_DEFAULT,
  agendaSchema,
  critiqueSchema,
  dependencySchema,
  evaluationSchema,
  intakeSchema,
  localConsensusSchema,
  prdDraftSchema,
  proposalDraftSchema,
  proposalSchema,
  type AgendaArtifactData,
  type CritiqueData,
  type DependencyArtifactData,
  type DependencyEdgeData,
  type DiscussionArtifactData,
  type EvalDimension,
  type EvaluationArtifactData,
  type HamaBoardData,
  type HamaIssueState,
  type HamaMemoryBridge,
  type HamaReportData,
  type HamaReworkData,
  type HamaRole,
  type HamaStageName,
  type HamaStartInput,
  type IntakeArtifactData,
  type LocalConsensusData,
  type PrdDraftData,
  type ProposalArtifactData,
  type ProposalDraftData,
} from './contracts.ts';
import {SimulationHamaResponder} from './demo-responder.ts';
import {renderPrdMarkdown} from './markdown.ts';

export interface HamaEngineDeps {
  readonly store: ForgeStore;
  readonly adapters: IAgentAdapterHub;
  readonly memory: HamaMemoryBridge;
  readonly publish: (event: ForgeSseEvent) => void;
}

export interface HamaStepOutcome {
  readonly stage: HamaStageName;
  readonly openedGate: MissionGateRecord | null;
  readonly baseline: ApprovedRequirementsBaseline | null;
}

function refOf<K extends string>(art: {
  readonly id: string;
  readonly kind: K;
  readonly revision: number;
  readonly hash: string;
}): ArtifactRef<K> {
  return {
    id: art.id,
    kind: art.kind,
    revision: art.revision,
    hash: art.hash,
  };
}

function wrapUntrusted(tag: string, content: string): string {
  const nonce = randomBytes(6).toString('hex');
  return `<${tag} nonce="${nonce}">\n${content}\n</${tag}>`;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ForgeError('ABORTED', 'HAMA invocation aborted', 499));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ForgeError('ABORTED', 'HAMA invocation aborted', 499));
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

function edgeKey(e: DependencyEdgeData): string {
  return `${e.from}|${e.to}|${e.kind}`;
}

export class HamaEngine {
  private readonly store: ForgeStore;
  private readonly adapters: IAgentAdapterHub;
  private readonly memory: HamaMemoryBridge;
  private readonly publish: (event: ForgeSseEvent) => void;
  private readonly sim = new SimulationHamaResponder();

  constructor(deps: HamaEngineDeps) {
    this.store = deps.store;
    this.adapters = deps.adapters;
    this.memory = deps.memory;
    this.publish = deps.publish;
  }

  initRun(mission: MissionRecord, input: HamaStartInput): void {
    const existing = this.store.hama.getRun(mission.id);
    if (existing) {
      return;
    }
    this.store.hama.initRun({
      missionId: mission.id,
      projectId: mission.projectId,
      mode: mission.executionMode,
      inputPayload: input,
      stage: 'intake',
    });
  }

  getDetail(missionId: string): HamaDetailSnapshot {
    const mission = this.mustMission(missionId);
    const run = this.store.hama.getRun(missionId);
    const artifacts = this.store.hama.listArtifacts(missionId);
    const comments = this.store.hama.listComments(missionId);
    const baseline = this.store.hama.getBaselineByMission(missionId);
    const latestPrd = this.store.hama.latestArtifact<PrdDocument>(
      missionId,
      'prd',
    );
    return {
      missionId: mission.id,
      stage: run?.stage ?? 'intake',
      proposalReworkCount: run?.proposalReworkCount ?? 0,
      prdLocalEditCount: run?.prdLocalEditCount ?? 0,
      artifacts,
      comments,
      prdMarkdown: latestPrd
        ? renderPrdMarkdown(latestPrd.data, baseline)
        : null,
      baseline,
    };
  }

  addComment(missionId: string, req: AddCommentRequest) {
    this.mustMission(missionId);
    const comment = this.store.hama.addComment({
      missionId,
      scopeKey: req.scopeKey,
      paragraphRef: req.paragraphRef ?? '',
      authorKind: req.authorKind ?? 'human',
      authorLabel: req.authorLabel ?? 'operator',
      severity: req.severity ?? 'advisory',
      body: req.body,
    });
    this.store.missions.appendEvent(
      missionId,
      'hama.comment_added',
      comment.authorLabel,
      {
        commentId: comment.id,
        scopeKey: comment.scopeKey,
        severity: comment.severity,
      },
    );
    this.publish({
      type: 'state.changed',
      scope: 'missions',
      at: new Date().toISOString(),
    });
    return comment;
  }

  resolveComment(
    missionId: string,
    commentId: string,
    req: ResolveCommentDispositionRequest,
  ) {
    this.mustMission(missionId);
    const existing = this.store.hama.getComment(commentId);
    if (!existing || existing.missionId !== missionId) {
      throw new ForgeError(
        'NOT_FOUND',
        `Comment "${commentId}" not found on Mission "${missionId}"`,
        404,
      );
    }
    const updated = this.store.hama.updateCommentDisposition({
      commentId,
      disposition: req.disposition,
      resolutionNote: req.resolutionNote,
      resolvedBy: req.resolvedBy,
      actorKind: req.actorKind ?? 'human',
    });
    this.store.missions.appendEvent(
      missionId,
      'hama.comment_resolved',
      req.resolvedBy,
      {
        commentId,
        disposition: req.disposition,
      },
    );
    this.publish({
      type: 'state.changed',
      scope: 'missions',
      at: new Date().toISOString(),
    });
    return updated;
  }

  async startOrAdvance(
    missionId: string,
    opts?: {readonly signal?: AbortSignal; readonly feedback?: string},
  ): Promise<HamaStepOutcome> {
    const mission = this.mustMission(missionId);
    let run = this.store.hama.getRun(missionId);
    if (!run) {
      this.initRun(mission, {
        title: mission.title,
        rawIntent: mission.rawIntent,
        documents: [],
        parentPrd: mission.parentBaselineId
          ? (this.store.hama.getBaseline(mission.parentBaselineId)?.prd ?? null)
          : null,
      });
      run = this.store.hama.getRun(missionId)!;
    }

    const input = JSON.parse(run.inputJson) as HamaStartInput;

    if (mission.triageTrack === 'express') {
      return this.runExpressPipeline(mission, input, opts);
    }
    if (mission.triageTrack === 'standard') {
      return this.runStandardOrFullPipeline(mission, input, 'standard', opts);
    }
    return this.runStandardOrFullPipeline(mission, input, 'full_hama', opts);
  }

  async applyDecision(
    missionId: string,
    gate: MissionGateRecord,
    decision: MissionDecisionRecord,
    signal?: AbortSignal,
  ): Promise<HamaStepOutcome> {
    const mission = this.mustMission(missionId);
    const run = this.store.hama.getRun(missionId);
    if (!run) {
      throw new ForgeError(
        'NOT_FOUND',
        `HAMA run missing for "${missionId}"`,
        404,
      );
    }
    const input = JSON.parse(run.inputJson) as HamaStartInput;
    const policy = resolvePresetPolicy(mission.preset, mission.configOverrides);

    if (gate.kind === 'clarification') {
      return this.continueAfterClarification(
        mission,
        input,
        decision.feedback,
        signal,
      );
    }

    if (gate.kind === 'discussion') {
      if (decision.action === 'escalate') {
        this.store.hama.updateRunStage(missionId, 'blocked');
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
        return {stage: 'blocked', openedGate: null, baseline: null};
      }
      const boardArt = this.store.hama.latestArtifact<HamaBoardData>(
        missionId,
        'board',
      );
      if (boardArt) {
        const updatedIssues = boardArt.data.issues.map(iss =>
          decision.issueIds.length === 0 || decision.issueIds.includes(iss.id)
            ? {
                ...iss,
                status: 'resolved' as const,
                resolutionSummary:
                  decision.feedback || 'Resolved via human operator decision.',
                blockingQuestion: undefined,
              }
            : iss,
        );
        this.store.hama.writeArtifact(missionId, 'board', {
          issues: updatedIssues,
          edges: boardArt.data.edges,
        });
      }
      const intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
        missionId,
        'intake',
      )!;
      return this.runIntegrateAndEvaluate(
        mission,
        input,
        intakeArt.data,
        decision.feedback,
        signal,
      );
    }

    if (gate.kind === 'evaluation' || gate.kind === 'limit') {
      if (decision.action === 'reject') {
        this.store.hama.updateRunStage(missionId, 'blocked');
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
        return {stage: 'blocked', openedGate: null, baseline: null};
      }
      if (decision.action === 'approve' || decision.action === 'confirm') {
        const propArt = this.store.hama.latestArtifact<ProposalArtifactData>(
          missionId,
          'proposal',
        )!;
        return this.openApprovalOrPrdGate(mission, propArt, 'approval');
      }
      const intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
        missionId,
        'intake',
      )!;
      this.store.hama.updateRunStage(missionId, 'integrate', {
        incrementProposalRework: true,
      });
      return this.runIntegrateAndEvaluate(
        mission,
        input,
        intakeArt.data,
        decision.feedback,
        signal,
      );
    }

    if (gate.kind === 'approval') {
      if (decision.action === 'reject') {
        this.store.hama.updateRunStage(missionId, 'blocked');
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
        return {stage: 'blocked', openedGate: null, baseline: null};
      }
      if (decision.action === 'request_changes') {
        if (run.proposalReworkCount >= policy.maxProposalRevisions) {
          return this.openLimitGate(
            mission,
            gate.targetId,
            gate.targetHash,
            `Proposal rework limit (${policy.maxProposalRevisions}) reached.`,
          );
        }
        this.store.hama.writeArtifact(missionId, 'rework', {
          source: 'approval',
          scope: 'proposal',
          reason: 'Human requested proposal changes',
          feedback: decision.feedback,
          targetIssueIds: decision.issueIds,
          at: new Date().toISOString(),
        } satisfies HamaReworkData);
        this.store.hama.updateRunStage(missionId, 'integrate', {
          incrementProposalRework: true,
        });
        const intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
          missionId,
          'intake',
        )!;
        return this.runIntegrateAndEvaluate(
          mission,
          input,
          intakeArt.data,
          decision.feedback,
          signal,
        );
      }
      if (decision.action === 'conditional_approve') {
        this.store.hama.updateRunStage(missionId, 'conditions');
        const propArt = this.store.hama.latestArtifact<ProposalArtifactData>(
          missionId,
          'proposal',
        )!;
        const openedGate = this.openGateAndEmit(mission, {
          kind: 'conditions',
          targetId: propArt.id,
          targetHash: propArt.hash,
          targetRevision: propArt.revision,
          question:
            'Confirm all conditional approval constraints have owners and verification rules before generating PRD.',
          contextSnippet:
            decision.feedback ||
            'Conditional approval requires explicit release sign-off.',
          options: [
            {
              action: 'release_conditions',
              label: 'Release Conditions & Generate PRD',
              recommended: true,
              consequencePreview:
                'Confirms conditions are satisfied and compiles the formal PRD.',
              requiresFeedback: false,
            },
            {
              action: 'request_changes',
              label: 'Rework Proposal',
              recommended: false,
              consequencePreview:
                'Sends proposal back through Loop B revision (counts toward proposal rework budget).',
              requiresFeedback: true,
            },
          ],
        });
        return {stage: 'conditions', openedGate, baseline: null};
      }
      return this.generatePrdAndOpenConfirmation(
        mission,
        input,
        decision.id,
        decision.feedback,
        signal,
      );
    }

    if (gate.kind === 'conditions') {
      if (decision.action === 'request_changes') {
        this.store.hama.updateRunStage(missionId, 'integrate', {
          incrementProposalRework: true,
        });
        const intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
          missionId,
          'intake',
        )!;
        return this.runIntegrateAndEvaluate(
          mission,
          input,
          intakeArt.data,
          decision.feedback,
          signal,
        );
      }
      const approvalDec = this.findLastApprovalDecision(missionId) ?? decision;
      return this.generatePrdAndOpenConfirmation(
        mission,
        input,
        approvalDec.id,
        decision.feedback,
        signal,
      );
    }

    if (gate.kind === 'confirmation') {
      if (decision.action === 'request_changes') {
        if (decision.scope === 'proposal') {
          if (run.proposalReworkCount >= policy.maxProposalRevisions) {
            return this.openLimitGate(
              mission,
              gate.targetId,
              gate.targetHash,
              `Proposal rework limit (${policy.maxProposalRevisions}) reached.`,
            );
          }
          this.store.hama.updateRunStage(missionId, 'integrate', {
            incrementProposalRework: true,
          });
          const intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
            missionId,
            'intake',
          )!;
          return this.runIntegrateAndEvaluate(
            mission,
            input,
            intakeArt.data,
            decision.feedback,
            signal,
          );
        }
        if (run.prdLocalEditCount >= policy.maxLocalPrdEdits) {
          return this.openLimitGate(
            mission,
            gate.targetId,
            gate.targetHash,
            `Local PRD polish limit (${policy.maxLocalPrdEdits}) reached.`,
          );
        }
        this.store.hama.updateRunStage(missionId, 'prd', {
          incrementPrdLocalEdit: true,
        });
        const approvalDec =
          this.findLastApprovalDecision(missionId) ?? decision;
        return this.generatePrdAndOpenConfirmation(
          mission,
          input,
          approvalDec.id,
          decision.feedback,
          signal,
        );
      }
      if (decision.action === 'reject') {
        this.store.hama.updateRunStage(missionId, 'blocked');
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
        return {stage: 'blocked', openedGate: null, baseline: null};
      }

      const baseline = this.publishBaselineSync(mission, decision);
      return {stage: 'baselined', openedGate: null, baseline};
    }

    throw new ForgeError(
      'VALIDATION_ERROR',
      `Unsupported HAMA gate kind "${gate.kind}"`,
      400,
    );
  }

  publishBaselineSync(
    mission: MissionRecord,
    confirmationDecision: MissionDecisionRecord,
  ): ApprovedRequirementsBaseline {
    const prdArt = this.store.hama.latestArtifact<PrdDocument>(
      mission.id,
      'prd',
    );
    if (!prdArt) {
      throw new ForgeError(
        'NOT_FOUND',
        `Cannot publish baseline: no PRD artifact found for "${mission.id}"`,
        404,
      );
    }
    const latestHead = this.store.hama.latestBaselineForProject(
      mission.projectId,
      mission.executionMode,
    );
    const parentId = mission.parentBaselineId ?? latestHead?.id ?? null;
    const revision = latestHead ? latestHead.revision + 1 : 1;

    const baselinedPrd: PrdDocument = {
      ...prdArt.data,
      requirements: prdArt.data.requirements.map(r => ({
        ...r,
        state: 'baselined',
      })),
    };
    const sealedPrdArt = this.store.hama.writeArtifact(
      mission.id,
      'prd',
      baselinedPrd,
    );

    const approvalDecision =
      this.findLastApprovalDecision(mission.id) ?? confirmationDecision;
    const condDecision = this.store.missions
      .listDecisions(mission.id)
      .filter(
        d =>
          d.action === 'conditional_approve' ||
          d.action === 'release_conditions',
      )
      .slice(-1)[0];

    const id = `bsl-${randomUUID().slice(0, 8)}`;
    const unsigned = {
      schemaVersion: 1 as const,
      id,
      projectId: mission.projectId,
      missionId: mission.id,
      revision,
      parentId,
      mode: mission.executionMode,
      approvedPrd: refOf(sealedPrdArt),
      approval: approvalDecision,
      ...(condDecision ? {conditionalApproval: condDecision} : {}),
      confirmation: confirmationDecision,
      prd: baselinedPrd,
      createdAt: new Date().toISOString(),
    };
    const baseline: ApprovedRequirementsBaseline = {
      ...unsigned,
      sha256: sha256Canonical(unsigned),
    };

    const published = this.store.hama.publishBaselineAtomic(baseline);
    this.store.hama.updateRunStage(mission.id, 'baselined');
    this.store.missions.updateMissionCas(mission.id, undefined, {
      status: 'baseline_frozen',
      stage: 'converge_spec',
      activeBaselineId: published.id,
    });
    this.store.missions.appendEvent(
      mission.id,
      'baseline.published',
      confirmationDecision.actor,
      {
        baselineId: published.id,
        revision: published.revision,
        sha256: published.sha256,
        requirementCount: published.prd.requirements.length,
      },
    );

    const board = this.store.hama.latestArtifact<HamaBoardData>(
      mission.id,
      'board',
    )?.data;
    const rejectedFacts =
      board?.issues.flatMap(iss =>
        iss.rejectedOptions.map(opt => ({
          kind: 'rejected_option' as const,
          subjectKey: `req:${iss.scopeKey}:rejected`,
          claim: `${iss.title}: rejected option — ${opt}`,
          confidence: 0.96,
          entityNames: [iss.scopeKey, iss.id],
        })),
      ) ?? [];
    const reqFacts = published.prd.requirements.map(req => ({
      kind: 'decision' as const,
      subjectKey: `req:${req.scopeKey}`,
      claim: `[${req.id}] ${req.title}: ${req.description.slice(0, 240)}`,
      confidence: 0.98,
      entityNames: [req.id, req.scopeKey],
    }));

    this.memory.retain({
      hubId: mission.hubId,
      missionId: mission.id,
      executionMode: mission.executionMode,
      sourceType: 'approved_baseline',
      authorityTier: 'L3_locked',
      rawText: renderPrdMarkdown(published.prd, published),
      structuredFacts: [...reqFacts, ...rejectedFacts],
    });

    this.publish({
      type: 'mission.updated',
      missionId: mission.id,
      status: 'baseline_frozen',
      stage: 'converge_spec',
      at: new Date().toISOString(),
    });

    return published;
  }

  private async runExpressPipeline(
    mission: MissionRecord,
    input: HamaStartInput,
    opts?: {readonly signal?: AbortSignal; readonly feedback?: string},
  ): Promise<HamaStepOutcome> {
    const intake = await this.invokeIntake(
      mission,
      input,
      opts?.feedback,
      opts?.signal,
    );
    const intakeArt = this.store.hama.writeArtifact(
      mission.id,
      'intake',
      intake,
    );

    if (intake.blockingQuestions.length > 0 && !opts?.feedback) {
      this.store.hama.updateRunStage(mission.id, 'intake');
      const openedGate = this.openClarificationGate(mission, intakeArt, intake);
      return {stage: 'intake', openedGate, baseline: null};
    }

    const expressIssues: HamaIssueState[] = intake.rawItems.map(
      (item, idx) => ({
        id: `ISS-${String(idx + 1).padStart(3, '0')}`,
        title: item.title,
        scopeKey:
          item.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '.')
            .replace(/^\.+|\.+$/g, '')
            .slice(0, 48) || `scope.${idx + 1}`,
        summary: item.detail,
        priority: item.priority,
        itemIds: [item.id],
        ownerRole: 'product',
        openQuestions: [],
        status: 'resolved',
        resolutionSummary: item.detail,
        round: 0,
        rejectedOptions: [],
      }),
    );
    const board: HamaBoardData = {issues: expressIssues, edges: []};
    this.store.hama.writeArtifact(mission.id, 'board', board);

    this.store.hama.updateRunStage(mission.id, 'integrate');
    const proposal = await this.invokeIntegrate(
      mission,
      input,
      intake,
      board,
      opts?.feedback,
      opts?.signal,
    );
    const propArt = this.store.hama.writeArtifact(
      mission.id,
      'proposal',
      proposal,
    );

    return this.generatePrdAndOpenConfirmation(
      mission,
      input,
      `express-auto-${propArt.id}`,
      opts?.feedback,
      opts?.signal,
    );
  }

  private async runStandardOrFullPipeline(
    mission: MissionRecord,
    input: HamaStartInput,
    track: 'standard' | 'full_hama',
    opts?: {readonly signal?: AbortSignal; readonly feedback?: string},
  ): Promise<HamaStepOutcome> {
    const intake = await this.invokeIntake(
      mission,
      input,
      opts?.feedback,
      opts?.signal,
    );
    const intakeArt = this.store.hama.writeArtifact(
      mission.id,
      'intake',
      intake,
    );

    if (intake.blockingQuestions.length > 0 && !opts?.feedback) {
      this.store.hama.updateRunStage(mission.id, 'intake');
      const openedGate = this.openClarificationGate(mission, intakeArt, intake);
      return {stage: 'intake', openedGate, baseline: null};
    }

    return this.continueAfterClarification(
      mission,
      input,
      opts?.feedback ?? '',
      opts?.signal,
      track,
    );
  }

  private async continueAfterClarification(
    mission: MissionRecord,
    input: HamaStartInput,
    feedback: string,
    signal?: AbortSignal,
    forceTrack?: 'standard' | 'full_hama',
  ): Promise<HamaStepOutcome> {
    const track =
      forceTrack ??
      (mission.triageTrack === 'standard' ? 'standard' : 'full_hama');
    const intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
      mission.id,
      'intake',
    )!;
    const intake = intakeArt.data;

    this.store.hama.updateRunStage(mission.id, 'agenda');
    const depsData =
      track === 'full_hama'
        ? await this.invokeDependencies(mission, intake, signal)
        : {edges: []};
    if (depsData.edges.length > 0) {
      this.store.hama.writeArtifact(mission.id, 'dependencies', depsData);
    }

    const agenda = await this.invokeAgenda(
      mission,
      intake,
      depsData.edges,
      signal,
    );
    this.store.hama.writeArtifact(mission.id, 'agenda', agenda);

    let board: HamaBoardData = {
      issues: agenda.issues.map(iss => ({
        ...iss,
        status: iss.blockingQuestion ? 'blocked' : 'open',
        resolutionSummary: '',
        round: 0,
        rejectedOptions: [],
      })),
      edges: depsData.edges,
    };
    const boardArt = this.store.hama.writeArtifact(mission.id, 'board', board);

    const blockingIssue = board.issues.find(i => i.status === 'blocked');
    if (blockingIssue && !feedback) {
      this.store.hama.updateRunStage(mission.id, 'discuss');
      const openedGate = this.openGateAndEmit(mission, {
        kind: 'discussion',
        targetId: boardArt.id,
        targetHash: boardArt.hash,
        targetRevision: boardArt.revision,
        question:
          blockingIssue.blockingQuestion ??
          `Resolve open requirement question for "${blockingIssue.title}".`,
        contextSnippet: blockingIssue.summary,
        options: [
          {
            action: 'resolve_issue',
            label: 'Resolve Issue & Continue',
            recommended: true,
            consequencePreview:
              'Marks blocked requirement issues resolved using your feedback and integrates the proposal.',
            requiresFeedback: false,
          },
          {
            action: 'escalate',
            label: 'Halt Requirements Stage',
            recommended: false,
            consequencePreview:
              'Marks this Mission failed due to unresolved requirements.',
            requiresFeedback: true,
          },
        ],
      });
      return {stage: 'discuss', openedGate, baseline: null};
    }

    board = await this.runDiscussionWaves(mission, input, board, track, signal);

    const remainingBlocked = board.issues.find(i => i.status === 'blocked');
    if (remainingBlocked) {
      const latestBoard = this.store.hama.latestArtifact<HamaBoardData>(
        mission.id,
        'board',
      )!;
      const openedGate = this.openGateAndEmit(mission, {
        kind: 'discussion',
        targetId: latestBoard.id,
        targetHash: latestBoard.hash,
        targetRevision: latestBoard.revision,
        question:
          remainingBlocked.blockingQuestion ??
          `Issue ${remainingBlocked.id} could not reach consensus autonomously.`,
        contextSnippet: remainingBlocked.summary,
        options: [
          {
            action: 'resolve_issue',
            label: 'Resolve Issue & Synthesize Proposal',
            recommended: true,
            consequencePreview:
              'Locks your resolution into the Board and continues to Proposal integration.',
            requiresFeedback: true,
          },
          {
            action: 'escalate',
            label: 'Fail Mission',
            recommended: false,
            consequencePreview:
              'Stops requirements engineering at failed state.',
            requiresFeedback: true,
          },
        ],
      });
      return {stage: 'discuss', openedGate, baseline: null};
    }

    return this.runIntegrateAndEvaluate(
      mission,
      input,
      intake,
      feedback,
      signal,
    );
  }

  private async runDiscussionWaves(
    mission: MissionRecord,
    input: HamaStartInput,
    initialBoard: HamaBoardData,
    track: 'standard' | 'full_hama',
    signal?: AbortSignal,
  ): Promise<HamaBoardData> {
    this.store.hama.updateRunStage(mission.id, 'discuss');
    const policy = resolvePresetPolicy(mission.preset, mission.configOverrides);
    const maxRounds = track === 'standard' ? 1 : policy.maxDiscussionRounds;
    const roles: readonly HamaRole[] =
      track === 'standard'
        ? ['product', 'architecture', 'quality']
        : ROLES_DEFAULT;

    let board = initialBoard;
    for (let round = 1; round <= maxRounds; round += 1) {
      const unresolved = board.issues.filter(i => i.status === 'open');
      if (unresolved.length === 0) {
        break;
      }

      const resolvedIds = new Set(
        board.issues.filter(i => i.status === 'resolved').map(i => i.id),
      );
      let wave = unresolved.filter(iss => {
        const blockers = board.edges.filter(
          e =>
            e.from === iss.id &&
            (e.kind === 'depends_on' || e.kind === 'conflict'),
        );
        return blockers.every(b => resolvedIds.has(b.to));
      });
      if (wave.length === 0) {
        wave = [unresolved[0]!];
      }
      const batch = wave.slice(0, Math.max(1, policy.maxParallelSlots));

      const outcomes = await Promise.all(
        batch.map(async issue => {
          const draft = await this.invokePropose(mission, input, issue, signal);
          const critiques = await Promise.all(
            roles.map(role =>
              this.invokeCritique(mission, issue, draft, role, signal),
            ),
          );
          const consensus = await this.invokeRefine(
            mission,
            issue,
            draft,
            critiques,
            signal,
          );
          return {issue, draft, critiques, consensus};
        }),
      );

      board = this.store.atomic(() => {
        const latest =
          this.store.hama.latestArtifact<HamaBoardData>(mission.id, 'board')
            ?.data ?? board;
        const issueMap = new Map<string, HamaIssueState>(
          latest.issues.map(i => [i.id, i]),
        );
        const edgeMap = new Map<string, DependencyEdgeData>(
          latest.edges.map(e => [edgeKey(e), e]),
        );
        const touchedPeerIds = new Set<string>();

        for (const out of outcomes) {
          this.store.hama.writeArtifact<DiscussionArtifactData, string>(
            mission.id,
            'discussion',
            {
              issueId: out.issue.id,
              round,
              proposal: out.draft,
              critiques: out.critiques,
              consensus: out.consensus,
            },
            out.issue.id,
          );

          for (const crit of out.critiques) {
            for (const ne of crit.newEdges) {
              const k = edgeKey(ne);
              if (!edgeMap.has(k)) {
                edgeMap.set(k, ne);
                if (ne.kind === 'conflict' || ne.kind === 'depends_on') {
                  if (ne.from !== out.issue.id) {
                    touchedPeerIds.add(ne.from);
                  }
                  if (ne.to !== out.issue.id) {
                    touchedPeerIds.add(ne.to);
                  }
                }
              }
            }
          }

          issueMap.set(out.issue.id, {
            ...out.issue,
            round,
            status: out.consensus.resolved ? 'resolved' : 'blocked',
            resolutionSummary: out.consensus.summary,
            rejectedOptions: out.consensus.rejectedOptions,
            blockingQuestion: out.consensus.unresolvedQuestion,
          });
        }

        for (const peerId of touchedPeerIds) {
          const peer = issueMap.get(peerId);
          if (peer && peer.status === 'resolved' && peer.round < maxRounds) {
            issueMap.set(peerId, {
              ...peer,
              status: 'open',
            });
          }
        }

        const nextBoard: HamaBoardData = {
          issues: [...issueMap.values()],
          edges: [...edgeMap.values()],
        };
        this.store.hama.writeArtifact(mission.id, 'board', nextBoard);
        return nextBoard;
      });
    }

    return board;
  }

  private async runIntegrateAndEvaluate(
    mission: MissionRecord,
    input: HamaStartInput,
    intake: IntakeArtifactData,
    feedback: string,
    signal?: AbortSignal,
  ): Promise<HamaStepOutcome> {
    this.store.hama.updateRunStage(mission.id, 'integrate');
    const board = this.store.hama.latestArtifact<HamaBoardData>(
      mission.id,
      'board',
    )?.data ?? {issues: [], edges: []};

    const proposal = await this.invokeIntegrate(
      mission,
      input,
      intake,
      board,
      feedback,
      signal,
    );
    const propArt = this.store.hama.writeArtifact(
      mission.id,
      'proposal',
      proposal,
    );

    this.store.hama.updateRunStage(mission.id, 'evaluate');
    const dims: readonly EvalDimension[] =
      mission.triageTrack === 'standard'
        ? ['feasibility', 'completeness']
        : EVAL_DIMENSIONS;

    const evalResults = await Promise.all(
      dims.map(async dim => {
        const evalData = await this.invokeEvaluate(
          mission,
          dim,
          proposal,
          false,
          signal,
        );
        const evalArt = this.store.hama.writeArtifact(
          mission.id,
          `eval-${dim}`,
          evalData,
        );
        return {dim, evalData, evalArt};
      }),
    );

    let verdict: HamaReportData['verdict'] = 'pass';
    for (const r of evalResults) {
      if (r.evalData.verdict === 'fail') {
        verdict = 'fail';
        break;
      }
      if (
        r.evalData.verdict === 'condition' ||
        r.evalData.verdict === 'uncertain'
      ) {
        verdict = 'condition';
      }
    }

    const conditions = evalResults.flatMap(r =>
      r.evalData.findings
        .filter(f => f.owner && f.verification)
        .map(f => ({
          dimension: r.dim,
          message: f.message,
          owner: f.owner!,
          verification: f.verification!,
        })),
    );

    const report: HamaReportData = {
      verdict,
      conditions,
      evaluations: evalResults.map(r => refOf(r.evalArt)),
      items: evalResults.map(r => r.evalData),
    };
    const reportArt = this.store.hama.writeArtifact(
      mission.id,
      'report',
      report,
    );

    if (verdict === 'fail') {
      const policy = resolvePresetPolicy(
        mission.preset,
        mission.configOverrides,
      );
      const run = this.store.hama.getRun(mission.id)!;
      if (run.proposalReworkCount < policy.maxProposalRevisions) {
        const failMsg = evalResults
          .filter(r => r.evalData.verdict === 'fail')
          .map(r => `${r.dim}: ${r.evalData.summary}`)
          .join('; ');
        this.store.hama.writeArtifact(mission.id, 'rework', {
          source: 'evaluation',
          scope: 'proposal',
          reason: failMsg,
          feedback: failMsg,
          targetIssueIds: [],
          at: new Date().toISOString(),
        } satisfies HamaReworkData);
        this.store.hama.updateRunStage(mission.id, 'integrate', {
          incrementProposalRework: true,
        });
        return this.runIntegrateAndEvaluate(
          mission,
          input,
          intake,
          failMsg,
          signal,
        );
      }
      return this.openLimitGate(
        mission,
        reportArt.id,
        reportArt.hash,
        `Evaluation failed and proposal rework limit (${policy.maxProposalRevisions}) was reached.`,
      );
    }

    if (verdict === 'condition') {
      const openedGate = this.openGateAndEmit(mission, {
        kind: 'evaluation',
        targetId: reportArt.id,
        targetHash: reportArt.hash,
        targetRevision: reportArt.revision,
        question: `Evaluation returned ${conditions.length} conditional finding(s). Accept conditions or revise proposal?`,
        contextSnippet: conditions
          .map(c => `[${c.dimension}] ${c.message} (Owner: ${c.owner})`)
          .join('\n'),
        options: [
          {
            action: 'approve',
            label: 'Accept Conditions & Continue to Approval',
            recommended: true,
            consequencePreview: 'Proceeds to formal Proposal Approval gate.',
            requiresFeedback: false,
          },
          {
            action: 'request_changes',
            label: 'Revise Proposal',
            recommended: false,
            consequencePreview:
              'Runs Loop B rework using your feedback before advancing.',
            requiresFeedback: true,
          },
          {
            action: 'reject',
            label: 'Reject & Halt',
            recommended: false,
            consequencePreview: 'Marks this Mission failed.',
            requiresFeedback: true,
          },
        ],
      });
      return {stage: 'evaluate', openedGate, baseline: null};
    }

    return this.openApprovalOrPrdGate(mission, propArt, 'approval');
  }

  private openApprovalOrPrdGate(
    mission: MissionRecord,
    propArt: {
      readonly id: string;
      readonly hash: string;
      readonly revision: number;
      readonly data: ProposalArtifactData;
    },
    kind: MissionGateKind,
  ): HamaStepOutcome {
    this.store.hama.updateRunStage(mission.id, 'approval');
    const openedGate = this.openGateAndEmit(mission, {
      kind,
      targetId: propArt.id,
      targetHash: propArt.hash,
      targetRevision: propArt.revision,
      question: `Approve Requirements Proposal rev ${propArt.revision} (${propArt.data.scopeItems.length} requirement scope item(s))?`,
      contextSnippet: propArt.data.summary,
      options: [
        {
          action: 'approve',
          label: 'Approve Proposal',
          recommended: true,
          consequencePreview:
            'Synthesizes the traceable PRD document for final baseline freeze.',
          requiresFeedback: false,
        },
        {
          action: 'conditional_approve',
          label: 'Conditional Approve',
          recommended: false,
          consequencePreview:
            'Requires a dedicated Conditions Release sign-off before PRD generation.',
          requiresFeedback: false,
        },
        {
          action: 'request_changes',
          label: 'Request Proposal Changes',
          recommended: false,
          consequencePreview:
            'Re-runs proposal integration with your targeted feedback.',
          requiresFeedback: true,
        },
        {
          action: 'reject',
          label: 'Reject Proposal',
          recommended: false,
          consequencePreview: 'Stops the Mission in failed state.',
          requiresFeedback: true,
        },
      ],
    });
    return {stage: 'approval', openedGate, baseline: null};
  }

  private async generatePrdAndOpenConfirmation(
    mission: MissionRecord,
    input: HamaStartInput,
    approvalId: string,
    feedback?: string,
    signal?: AbortSignal,
  ): Promise<HamaStepOutcome> {
    this.store.hama.updateRunStage(mission.id, 'prd');
    const propArt = this.store.hama.latestArtifact<
      ProposalArtifactData,
      'proposal'
    >(mission.id, 'proposal')!;
    const intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
      mission.id,
      'intake',
    )!;
    const prevPrd = this.store.hama.latestArtifact<PrdDocument>(
      mission.id,
      'prd',
    );
    const nextRev = prevPrd ? prevPrd.revision + 1 : 1;

    const draft = await this.invokePrd(
      mission,
      propArt.data,
      nextRev,
      feedback,
      signal,
    );

    const requirements: RequirementItem[] = propArt.data.scopeItems.map(
      item => {
        const prefix = item.kind === 'nonfunctional' ? 'NFR' : 'FR';
        const reqId = `${prefix}-${sha256Text(`${mission.projectId}:${item.scopeKey}`).slice(0, 8)}`;
        const acceptance = item.acceptance.map(ac => ({
          id: `AC-${sha256Text(`${reqId}:${ac.key}`).slice(0, 8)}`,
          key: ac.key,
          given: ac.given,
          when: ac.when,
          then: ac.then,
        }));
        return {
          id: reqId,
          scopeKey: item.scopeKey,
          ...(item.supersedesScopeKey
            ? {supersedesScopeKey: item.supersedesScopeKey}
            : {}),
          kind: item.kind,
          title: item.title,
          description: item.description,
          value: item.value,
          priority: item.priority,
          dependencies: item.dependencies,
          constraints: item.constraints,
          acceptance,
          state: 'under_review',
        };
      },
    );

    const sourceIds = [
      ...new Set(intakeArt.data.rawItems.map(i => i.sourceRef)),
    ];
    const propRef = refOf(propArt);
    const trace: TraceLink[] = requirements.map((req, idx) => ({
      ideaAndDocumentIds: sourceIds.length > 0 ? sourceIds : [mission.id],
      issueIds: propArt.data.scopeItems[idx]!.issueIds,
      proposal: propRef,
      scopeKey: req.scopeKey,
      approvalId,
      requirementId: req.id,
      acceptanceIds: req.acceptance.map(a => a.id),
    }));

    const prd: PrdDocument = {
      title: draft.title,
      revision: nextRev,
      proposal: propRef,
      approvalId,
      background: draft.background,
      scenarios: draft.scenarios,
      goals: draft.goals,
      summary: draft.summary,
      approach: draft.approach,
      outOfScope: draft.outOfScope,
      constraints: draft.constraints,
      businessRules: draft.businessRules,
      externalDependencies: draft.externalDependencies,
      tradeoffs: draft.tradeoffs,
      risks: draft.risks,
      unresolved: draft.unresolved,
      requirements,
      trace,
      changes: draft.changes,
    };

    const prdArt = this.store.hama.writeArtifact(mission.id, 'prd', prd);
    this.store.hama.updateRunStage(mission.id, 'confirmation');

    const openBlocking = this.store.hama.countOpenBlockingComments(mission.id);
    const openedGate = this.openGateAndEmit(mission, {
      kind: 'confirmation',
      targetId: prdArt.id,
      targetHash: prdArt.hash,
      targetRevision: prdArt.revision,
      question: `Freeze PRD rev ${prd.revision} (${prd.requirements.length} requirements) as an immutable Requirements Baseline?${openBlocking > 0 ? ` (${openBlocking} blocking comment(s) must be resolved first)` : ''}`,
      contextSnippet: renderPrdMarkdown(prd).slice(0, 1200),
      options: [
        {
          action: 'confirm',
          label: 'Confirm & Freeze Immutable Baseline',
          recommended: openBlocking === 0,
          consequencePreview:
            'Publishes immutable SHA-256 baseline, writes L3 memory facts, and compiles repo Twin-Graphs.',
          requiresFeedback: false,
        },
        {
          action: 'request_changes',
          label: 'Edit PRD Text / Acceptance Criteria',
          recommended: false,
          consequencePreview:
            'Polishes the PRD locally (scope="local") or reopens proposal integration (scope="proposal").',
          requiresFeedback: true,
        },
        {
          action: 'reject',
          label: 'Reject Baseline',
          recommended: false,
          consequencePreview:
            'Aborts baseline freeze and marks Mission failed.',
          requiresFeedback: true,
        },
      ],
    });
    return {stage: 'confirmation', openedGate, baseline: null};
  }

  private openClarificationGate(
    mission: MissionRecord,
    intakeArt: {
      readonly id: string;
      readonly hash: string;
      readonly revision: number;
    },
    intake: IntakeArtifactData,
  ): MissionGateRecord {
    return this.openGateAndEmit(mission, {
      kind: 'clarification',
      targetId: intakeArt.id,
      targetHash: intakeArt.hash,
      targetRevision: intakeArt.revision,
      question: intake.blockingQuestions[0] ?? 'Clarify ambiguous requirement.',
      contextSnippet: intake.ambiguities.join('\n') || intake.summary,
      options: [
        {
          action: 'clarify',
          label: 'Submit Clarification & Continue',
          recommended: true,
          consequencePreview:
            'Applies your clarification to requirements synthesis and resumes HAMA.',
          requiresFeedback: true,
        },
      ],
    });
  }

  private openLimitGate(
    mission: MissionRecord,
    targetId: string,
    targetHash: string,
    reason: string,
  ): HamaStepOutcome {
    const openedGate = this.openGateAndEmit(mission, {
      kind: 'limit',
      targetId,
      targetHash,
      targetRevision: 1,
      question: `${reason} Force approval or halt requirements?`,
      contextSnippet: reason,
      options: [
        {
          action: 'approve',
          label: 'Override & Proceed to Approval',
          recommended: false,
          consequencePreview:
            'Forces proposal forward into PRD synthesis despite rework limit.',
          requiresFeedback: false,
        },
        {
          action: 'reject',
          label: 'Halt Mission',
          recommended: true,
          consequencePreview: 'Marks the Mission failed cleanly.',
          requiresFeedback: false,
        },
      ],
    });
    return {stage: 'evaluate', openedGate, baseline: null};
  }

  private openGateAndEmit(
    mission: MissionRecord,
    input: {
      readonly kind: MissionGateKind;
      readonly targetId: string;
      readonly targetHash: string;
      readonly targetRevision: number;
      readonly question: string;
      readonly contextSnippet: string;
      readonly options: readonly DecisionOptionPreview[];
    },
  ): MissionGateRecord {
    const gate = this.store.missions.openGate({
      missionId: mission.id,
      kind: input.kind,
      targetId: input.targetId,
      targetHash: input.targetHash,
      targetRevision: input.targetRevision,
      question: input.question,
      contextSnippet: input.contextSnippet,
      options: input.options,
    });
    this.store.missions.updateMissionCas(mission.id, undefined, {
      status: 'paused_human',
      stage: 'converge_spec',
    });
    this.publish({
      type: 'gate.opened',
      missionId: mission.id,
      gateId: gate.id,
      kind: gate.kind,
      at: gate.createdAt,
    });
    return gate;
  }

  private findLastApprovalDecision(
    missionId: string,
  ): MissionDecisionRecord | null {
    const decs = this.store.missions.listDecisions(missionId);
    for (let i = decs.length - 1; i >= 0; i -= 1) {
      const d = decs[i]!;
      if (d.action === 'approve' || d.action === 'conditional_approve') {
        return d;
      }
    }
    return null;
  }

  private async invokeIntake(
    mission: MissionRecord,
    input: HamaStartInput,
    feedback?: string,
    signal?: AbortSignal,
  ): Promise<IntakeArtifactData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondIntake({
        title: input.title,
        rawIntent: input.rawIntent,
        documents: input.documents,
        clarification: feedback,
      });
    }
    const recallRes = this.memory.recall({
      hubId: mission.hubId,
      executionMode: mission.executionMode,
      query: `${input.title} ${input.rawIntent.slice(0, 200)}`,
      limit: 5,
    });
    const memContext = recallRes.hits
      .map(h => `[${h.authorityTier}] ${h.title}: ${h.content}`)
      .join('\n');
    const docsText = input.documents
      .map(d => `### ${d.title}\n${d.content}`)
      .join('\n\n');
    const systemPrompt =
      'You are the HAMA Requirements Intake Analyst. Return ONLY a strict JSON object conforming to the schema.';
    const userPrompt = [
      `Mission Title: ${input.title}`,
      wrapUntrusted('untrusted_intent', input.rawIntent),
      docsText ? wrapUntrusted('untrusted_documents', docsText) : '',
      memContext ? wrapUntrusted('untrusted_memory', memContext) : '',
      feedback ? `Clarification Feedback: ${feedback}` : '',
      `JSON Schema: ${JSON.stringify(intakeSchema.json)}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    return this.invokeStructured(
      mission,
      systemPrompt,
      userPrompt,
      intakeSchema,
      signal,
    );
  }

  private async invokeDependencies(
    mission: MissionRecord,
    intake: IntakeArtifactData,
    signal?: AbortSignal,
  ): Promise<DependencyArtifactData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondDependencies(intake);
    }
    return this.invokeStructured(
      mission,
      'You are the HAMA Dependency Analyst. Return ONLY JSON matching the schema.',
      `Intake:\n${JSON.stringify(intake)}\n\nSchema:\n${JSON.stringify(dependencySchema.json)}`,
      dependencySchema,
      signal,
    );
  }

  private async invokeAgenda(
    mission: MissionRecord,
    intake: IntakeArtifactData,
    edges: readonly DependencyEdgeData[],
    signal?: AbortSignal,
  ): Promise<AgendaArtifactData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondAgenda(intake);
    }
    return this.invokeStructured(
      mission,
      'You are the HAMA Agenda Planner. Decompose raw items into crisp trackable issues. Return ONLY JSON.',
      `Intake:\n${JSON.stringify(intake)}\nDependencies:\n${JSON.stringify(edges)}\n\nSchema:\n${JSON.stringify(agendaSchema.json)}`,
      agendaSchema,
      signal,
    );
  }

  private async invokePropose(
    mission: MissionRecord,
    input: HamaStartInput,
    issue: HamaIssueState,
    signal?: AbortSignal,
  ): Promise<ProposalDraftData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondPropose({
        issueId: issue.id,
        title: issue.title,
        scopeKey: issue.scopeKey,
        summary: issue.summary,
      });
    }
    return this.invokeStructured(
      mission,
      `You are the ${issue.ownerRole} lead drafting an issue solution. Return ONLY JSON.`,
      `Mission: ${input.title}\nIssue: ${JSON.stringify(issue)}\n\nSchema:\n${JSON.stringify(proposalDraftSchema.json)}`,
      proposalDraftSchema,
      signal,
    );
  }

  private async invokeCritique(
    mission: MissionRecord,
    issue: HamaIssueState,
    draft: ProposalDraftData,
    role: HamaRole,
    signal?: AbortSignal,
  ): Promise<CritiqueData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondCritique({issueId: issue.id, role});
    }
    return this.invokeStructured(
      mission,
      `You are the HAMA ${role} reviewer. Critically challenge gaps or hidden cross-issue dependencies. Return ONLY JSON.`,
      `Role: ${role}\nIssue: ${JSON.stringify(issue)}\nDraft: ${JSON.stringify(draft)}\n\nSchema:\n${JSON.stringify(critiqueSchema.json)}`,
      critiqueSchema,
      signal,
    );
  }

  private async invokeRefine(
    mission: MissionRecord,
    issue: HamaIssueState,
    draft: ProposalDraftData,
    critiques: readonly CritiqueData[],
    signal?: AbortSignal,
  ): Promise<LocalConsensusData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondRefine({issueId: issue.id, draft});
    }
    return this.invokeStructured(
      mission,
      'You are the HAMA Facilitator consolidating critiques into local consensus and rejectedOptions. Return ONLY JSON.',
      `Issue: ${JSON.stringify(issue)}\nDraft: ${JSON.stringify(draft)}\nCritiques: ${JSON.stringify(critiques)}\n\nSchema:\n${JSON.stringify(localConsensusSchema.json)}`,
      localConsensusSchema,
      signal,
    );
  }

  private async invokeIntegrate(
    mission: MissionRecord,
    input: HamaStartInput,
    intake: IntakeArtifactData,
    board: HamaBoardData,
    feedback?: string,
    signal?: AbortSignal,
  ): Promise<ProposalArtifactData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondIntegrate({
        title: input.title,
        intake,
        issues: board.issues,
        feedback,
      });
    }
    return this.invokeStructured(
      mission,
      'You are the HAMA Chief Architect integrating resolved issues into a unified specification Proposal. Return ONLY JSON.',
      [
        `Mission: ${input.title}`,
        input.parentPrd
          ? `Parent Baseline ScopeKeys: ${input.parentPrd.requirements.map(r => r.scopeKey).join(', ')}`
          : '',
        `Intake: ${JSON.stringify(intake)}`,
        `Board: ${JSON.stringify(board)}`,
        feedback ? `Revision Feedback: ${feedback}` : '',
        `Schema: ${JSON.stringify(proposalSchema.json)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      proposalSchema,
      signal,
    );
  }

  private async invokeEvaluate(
    mission: MissionRecord,
    dimension: EvalDimension,
    proposal: ProposalArtifactData,
    triggerCondition: boolean,
    signal?: AbortSignal,
  ): Promise<EvaluationArtifactData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondEvaluate({dimension, proposal, triggerCondition});
    }
    return this.invokeStructured(
      mission,
      `You are the independent HAMA ${dimension} Evaluator. Every condition/uncertain finding MUST carry non-empty owner and verification. Return ONLY JSON.`,
      `Dimension: ${dimension}\nProposal: ${JSON.stringify(proposal)}\n\nSchema:\n${JSON.stringify(evaluationSchema.json)}`,
      evaluationSchema,
      signal,
    );
  }

  private async invokePrd(
    mission: MissionRecord,
    proposal: ProposalArtifactData,
    revision: number,
    feedback?: string,
    signal?: AbortSignal,
  ): Promise<PrdDraftData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondPrd({proposal, revision, feedback});
    }
    return this.invokeStructured(
      mission,
      'You are the HAMA Technical Writer producing the formal PRD narrative fields from the approved proposal. Return ONLY JSON.',
      `Revision: ${revision}\nProposal: ${JSON.stringify(proposal)}\n${feedback ? `Feedback: ${feedback}\n` : ''}Schema: ${JSON.stringify(prdDraftSchema.json)}`,
      prdDraftSchema,
      signal,
    );
  }

  private async invokeStructured<T>(
    mission: MissionRecord,
    systemPrompt: string,
    userPrompt: string,
    schema: Schema<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const profiles = this.store.listAdapterProfiles();
    const chosen =
      selectHealthyAdapterForRole(
        profiles,
        'lead',
        mission.configOverrides.leadAdapterId,
      ) ??
      profiles.find(p => p.manifest.id === 'native-api') ??
      profiles[0];

    if (!chosen) {
      throw new ForgeError(
        'SETUP_REQUIRED',
        'No healthy Lead adapter available for live HAMA execution',
        412,
      );
    }

    const model =
      mission.configOverrides.leadModel ??
      chosen.manifest.defaultModel ??
      'deepseek-reasoner';

    let promptForAttempt = userPrompt;
    let schemaAttempts = 0;
    let rateRetries = 0;

    while (schemaAttempts < 3) {
      const result = await this.adapters.invoke({
        sessionId: `hama-${mission.id}-${randomUUID().slice(0, 6)}`,
        hubId: mission.hubId,
        changeId: null,
        nodeId: null,
        role: 'lead',
        adapter: chosen.manifest,
        model,
        permissionTier: 'strict',
        cwd: process.cwd(),
        systemPrompt,
        userPrompt: promptForAttempt,
        readOnly: true,
        textOnly: true,
        maxOutputTokens: 2800,
        cacheStablePrefix: true,
        signal,
      });

      if (result.costUsd > 0) {
        this.store.missions.addMissionCostAtomic(mission.id, result.costUsd);
      }

      if (result.outcome === 'rate_limited') {
        rateRetries += 1;
        if (rateRetries > 3) {
          throw new ForgeError(
            'ADAPTER_UNAVAILABLE',
            `HAMA live model rate limited: ${result.diagnostic}`,
            429,
          );
        }
        const waitMs =
          Math.min(Math.max(1, result.retryAfterSeconds ?? 5), 15) * 1000;
        await abortableSleep(waitMs, signal);
        continue;
      }

      if (result.outcome !== 'completed') {
        throw new ForgeError(
          'SETUP_REQUIRED',
          `Live HAMA invocation failed (${result.outcome}): ${result.diagnostic}`,
          412,
        );
      }

      try {
        return extractJsonPayload(result.finalText, schema);
      } catch (err) {
        schemaAttempts += 1;
        if (schemaAttempts >= 3) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new ForgeError(
            'VALIDATION_ERROR',
            `HAMA structured JSON validation failed after 3 attempts: ${msg}`,
            422,
          );
        }
        const errMsg =
          err instanceof SchemaError || err instanceof Error
            ? err.message
            : String(err);
        promptForAttempt = `${userPrompt}\n\nPREVIOUS OUTPUT FAILED VALIDATION:\n${errMsg}\nFix and output ONLY a valid JSON object matching the schema.`;
      }
    }

    throw new ForgeError(
      'INTERNAL_ERROR',
      'Unexpected exit from HAMA structured invocation loop',
      500,
    );
  }

  private mustMission(missionId: string): MissionRecord {
    const m = this.store.missions.getMission(missionId);
    if (!m) {
      throw new ForgeError(
        'NOT_FOUND',
        `Mission "${missionId}" not found`,
        404,
      );
    }
    return m;
  }
}

import {randomBytes, randomUUID} from 'node:crypto';
import {sha256Canonical} from '../core/canonical-json.ts';
import {
  detectTerminologyDrift,
  renderUbiquitousLanguageSection,
} from '../core/ddd.ts';
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
  CodebaseProbeReport,
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

function renderCodebaseRealityBlock(probe?: CodebaseProbeReport): string {
  if (!probe || probe.scannedFilesCount === 0) {
    return '';
  }
  const files = probe.matchedFiles.slice(0, 6).map(f => {
    const exp = f.exports.slice(0, 4).join(', ');
    const imp =
      f.importers.length > 0
        ? ` | importedBy(${f.importers.length}): ${f.importers.slice(0, 3).join(', ')}`
        : '';
    return `- ${f.filePath} (${f.lineCount}L${exp ? ` | exports: ${exp}` : ''}${imp})`;
  });
  const notes = probe.realityNotes
    .slice(0, 4)
    .map(n => `- [${n.level.toUpperCase()}] ${n.titleEn}: ${n.detailEn}`);
  const verifyCmds = probe.detectedVerifyCommands
    .slice(0, 3)
    .map(v => `${v.repoName}: ${v.command}`);

  const raw = [
    `BlastRadius=${probe.blastRadius} (${probe.recommendedTrack}), Scanned=${probe.scannedFilesCount}`,
    verifyCmds.length > 0 ? `Verify: ${verifyCmds.join('; ')}` : '',
    files.length > 0 ? `Matched Files:\n${files.join('\n')}` : '',
    notes.length > 0 ? `Reality Challenges:\n${notes.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return wrapUntrusted('codebase_probe_reality', raw.slice(0, 1800));
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

const HIGH_RISK_DOMAIN_PATTERN =
  /\b(auth|oauth|jwt|rbac|permission|billing|payment|settlement|ledger|encrypt|secret|compliance|migration|schema|security|delete|drop)\b|权限|鉴权|认证|结算|支付|账本|安全|合规|迁移|加密/i;

function detectDependencyCycle(
  issueIds: readonly string[],
  edges: readonly DependencyEdgeData[],
): string[] {
  const idSet = new Set(issueIds);
  const inDegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();
  for (const id of idSet) {
    inDegree.set(id, 0);
    adj.set(id, new Set());
  }
  for (const e of edges) {
    if (
      e.kind !== 'depends_on' &&
      e.kind !== 'prerequisite' &&
      e.kind !== 'conflict'
    ) {
      continue;
    }
    if (!idSet.has(e.from) || !idSet.has(e.to)) {
      continue;
    }
    const neighbors = adj.get(e.to)!;
    if (!neighbors.has(e.from)) {
      neighbors.add(e.from);
      inDegree.set(e.from, (inDegree.get(e.from) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
    }
  }
  const visited = new Set<string>();
  while (queue.length > 0) {
    const u = queue.shift()!;
    visited.add(u);
    for (const v of adj.get(u) ?? []) {
      const nextDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, nextDeg);
      if (nextDeg === 0) {
        queue.push(v);
      }
    }
  }
  return [...idSet].filter(id => !visited.has(id));
}

function renderProposalTextForDrift(proposal: ProposalArtifactData): string {
  const lines: string[] = [
    proposal.title,
    proposal.background,
    ...proposal.scenarios,
    ...proposal.goals,
    proposal.summary,
    ...proposal.approach,
    ...proposal.outOfScope,
    ...proposal.constraints,
    ...proposal.businessRules,
    ...proposal.externalDependencies,
    ...proposal.tradeoffs,
    ...proposal.risks,
    ...proposal.unresolved,
  ];
  for (const item of proposal.scopeItems) {
    lines.push(
      item.title,
      item.description,
      item.value,
      ...item.constraints,
      ...item.acceptance.flatMap(a => [a.given, a.when, a.then]),
    );
  }
  return lines.join('\n');
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
    if (
      input.codebaseProbe &&
      !this.store.hama.latestArtifact(mission.id, 'codebase_probe')
    ) {
      this.store.hama.writeArtifact(
        mission.id,
        'codebase_probe',
        input.codebaseProbe,
      );
    }
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
    let mission = this.mustMission(missionId);
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
    if (
      input.codebaseProbe &&
      !this.store.hama.latestArtifact(mission.id, 'codebase_probe')
    ) {
      this.store.hama.writeArtifact(
        mission.id,
        'codebase_probe',
        input.codebaseProbe,
      );
    }

    let intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
      mission.id,
      'intake',
    );
    if (!intakeArt) {
      const intake = await this.invokeIntake(
        mission,
        input,
        opts?.feedback,
        opts?.signal,
      );
      intakeArt = this.store.hama.writeArtifact(mission.id, 'intake', intake);
      mission = this.maybeEscalatePostIntake(mission, input, intake);
    }

    const hasCriticalQuestions =
      intakeArt.data.questions.some(q => q.critical) ||
      intakeArt.data.blockingQuestions.length > 0;
    const hasClarified = this.store.missions
      .listDecisions(mission.id)
      .some(d => d.action === 'clarify');
    if (hasCriticalQuestions && !opts?.feedback && !hasClarified) {
      this.store.hama.updateRunStage(mission.id, 'intake');
      const openedGate = this.openClarificationGate(
        mission,
        intakeArt,
        intakeArt.data,
      );
      return {stage: 'intake', openedGate, baseline: null};
    }

    if (mission.triageTrack === 'express') {
      return this.finishExpressAfterIntake(
        mission,
        input,
        intakeArt.data,
        opts?.feedback,
        opts?.signal,
      );
    }
    if (mission.triageTrack === 'standard') {
      return this.continueAfterClarification(
        mission,
        input,
        opts?.feedback ?? '',
        opts?.signal,
        'standard',
      );
    }
    return this.continueAfterClarification(
      mission,
      input,
      opts?.feedback ?? '',
      opts?.signal,
      'full_hama',
    );
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
    if (
      input.codebaseProbe &&
      !this.store.hama.latestArtifact(mission.id, 'codebase_probe')
    ) {
      this.store.hama.writeArtifact(
        mission.id,
        'codebase_probe',
        input.codebaseProbe,
      );
    }
    const policy = resolvePresetPolicy(mission.preset, mission.configOverrides);

    switch (gate.kind) {
      case 'clarification': {
        switch (decision.action) {
          case 'clarify':
            return this.continueAfterClarification(
              mission,
              input,
              decision.feedback,
              signal,
            );
          default:
            throw new ForgeError(
              'VALIDATION_ERROR',
              `Invalid action "${decision.action}" for clarification gate`,
              400,
            );
        }
      }

      case 'discussion': {
        switch (decision.action) {
          case 'escalate':
            this.store.hama.updateRunStage(missionId, 'blocked');
            this.store.missions.updateMissionCas(missionId, undefined, {
              status: 'failed',
            });
            return {stage: 'blocked', openedGate: null, baseline: null};
          case 'resolve_issue': {
            const boardArt = this.store.hama.latestArtifact<HamaBoardData>(
              missionId,
              'board',
            );
            let nextBoard: HamaBoardData | null = null;
            if (boardArt) {
              const updatedIssues = boardArt.data.issues.map(iss =>
                decision.issueIds.length === 0 ||
                decision.issueIds.includes(iss.id)
                  ? {
                      ...iss,
                      status: 'resolved' as const,
                      resolutionSummary:
                        decision.feedback ||
                        'Resolved via human operator decision.',
                      blockingQuestion: undefined,
                    }
                  : iss,
              );
              nextBoard = {
                issues: updatedIssues,
                edges: boardArt.data.edges,
              };
              this.store.hama.writeArtifact(missionId, 'board', nextBoard);
            }
            const intakeArt =
              this.store.hama.latestArtifact<IntakeArtifactData>(
                missionId,
                'intake',
              )!;
            if (nextBoard && nextBoard.issues.some(i => i.status === 'open')) {
              const track =
                mission.triageTrack === 'standard' ? 'standard' : 'full_hama';
              const discussed = await this.runDiscussionWaves(
                mission,
                input,
                nextBoard,
                track,
                signal,
              );
              const blockedGate = this.maybeOpenDiscussionBlockedGate(
                mission,
                discussed,
              );
              if (blockedGate) {
                return blockedGate;
              }
            }
            return this.runIntegrateAndEvaluate(
              mission,
              input,
              intakeArt.data,
              decision.feedback,
              signal,
            );
          }
          default:
            throw new ForgeError(
              'VALIDATION_ERROR',
              `Invalid action "${decision.action}" for discussion gate`,
              400,
            );
        }
      }

      case 'evaluation': {
        switch (decision.action) {
          case 'reject':
            this.store.hama.updateRunStage(missionId, 'blocked');
            this.store.missions.updateMissionCas(missionId, undefined, {
              status: 'failed',
            });
            return {stage: 'blocked', openedGate: null, baseline: null};
          case 'approve': {
            const propArt =
              this.store.hama.latestArtifact<ProposalArtifactData>(
                missionId,
                'proposal',
              )!;
            return this.openApprovalOrPrdGate(mission, propArt, 'approval');
          }
          case 'request_changes': {
            if (run.proposalReworkCount >= policy.maxProposalRevisions) {
              return this.openLimitGate(
                mission,
                gate.targetId,
                gate.targetHash,
                `Proposal rework limit (${policy.maxProposalRevisions}) reached.`,
              );
            }
            return this.triggerLoopBRework(
              mission,
              input,
              'evaluation',
              decision.feedback,
              decision.issueIds,
              signal,
            );
          }
          default:
            throw new ForgeError(
              'VALIDATION_ERROR',
              `Invalid action "${decision.action}" for evaluation gate`,
              400,
            );
        }
      }

      case 'limit': {
        switch (decision.action) {
          case 'reject':
            this.store.hama.updateRunStage(missionId, 'blocked');
            this.store.missions.updateMissionCas(missionId, undefined, {
              status: 'failed',
            });
            return {stage: 'blocked', openedGate: null, baseline: null};
          case 'approve': {
            const propArt =
              this.store.hama.latestArtifact<ProposalArtifactData>(
                missionId,
                'proposal',
              )!;
            return this.openApprovalOrPrdGate(mission, propArt, 'approval');
          }
          default:
            throw new ForgeError(
              'VALIDATION_ERROR',
              `Invalid action "${decision.action}" for limit gate`,
              400,
            );
        }
      }

      case 'approval': {
        switch (decision.action) {
          case 'reject':
            this.store.hama.updateRunStage(missionId, 'blocked');
            this.store.missions.updateMissionCas(missionId, undefined, {
              status: 'failed',
            });
            return {stage: 'blocked', openedGate: null, baseline: null};
          case 'request_changes': {
            if (run.proposalReworkCount >= policy.maxProposalRevisions) {
              return this.openLimitGate(
                mission,
                gate.targetId,
                gate.targetHash,
                `Proposal rework limit (${policy.maxProposalRevisions}) reached.`,
              );
            }
            return this.triggerLoopBRework(
              mission,
              input,
              'approval',
              decision.feedback,
              decision.issueIds,
              signal,
            );
          }
          case 'conditional_approve': {
            this.store.hama.updateRunStage(missionId, 'conditions');
            const propArt =
              this.store.hama.latestArtifact<ProposalArtifactData>(
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
          case 'approve': {
            const latestReport = this.store.hama.latestArtifact<HamaReportData>(
              missionId,
              'report',
            );
            if (latestReport?.data.verdict === 'conditional_pass') {
              throw new ForgeError(
                'CONFLICT',
                'Raw approve is forbidden when evaluation report verdict is conditional_pass; use conditional_approve, request_changes, or reject',
                409,
              );
            }
            return this.generatePrdAndOpenConfirmation(
              mission,
              input,
              decision.id,
              decision.feedback,
              signal,
            );
          }
          default:
            throw new ForgeError(
              'VALIDATION_ERROR',
              `Invalid action "${decision.action}" for approval gate`,
              400,
            );
        }
      }

      case 'conditions': {
        switch (decision.action) {
          case 'request_changes': {
            if (run.proposalReworkCount >= policy.maxProposalRevisions) {
              return this.openLimitGate(
                mission,
                gate.targetId,
                gate.targetHash,
                `Proposal rework limit (${policy.maxProposalRevisions}) reached.`,
              );
            }
            return this.triggerLoopBRework(
              mission,
              input,
              'approval',
              decision.feedback,
              decision.issueIds,
              signal,
            );
          }
          case 'release_conditions': {
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
          default:
            throw new ForgeError(
              'VALIDATION_ERROR',
              `Invalid action "${decision.action}" for conditions gate`,
              400,
            );
        }
      }

      case 'confirmation': {
        switch (decision.action) {
          case 'request_changes': {
            if (decision.scope === 'proposal') {
              if (run.proposalReworkCount >= policy.maxProposalRevisions) {
                return this.openLimitGate(
                  mission,
                  gate.targetId,
                  gate.targetHash,
                  `Proposal rework limit (${policy.maxProposalRevisions}) reached.`,
                );
              }
              return this.triggerLoopBRework(
                mission,
                input,
                'confirmation',
                decision.feedback,
                decision.issueIds,
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
            this.store.hama.writeArtifact(missionId, 'rework', {
              source: 'confirmation',
              scope: 'local',
              reason: 'Local PRD text/AC polish requested',
              feedback: decision.feedback,
              targetIssueIds: decision.issueIds,
              at: new Date().toISOString(),
            } satisfies HamaReworkData);
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
          case 'reject':
            this.store.hama.updateRunStage(missionId, 'blocked');
            this.store.missions.updateMissionCas(missionId, undefined, {
              status: 'failed',
            });
            return {stage: 'blocked', openedGate: null, baseline: null};
          case 'confirm': {
            const baseline = this.publishBaselineSync(mission, decision);
            return {stage: 'baselined', openedGate: null, baseline};
          }
          default:
            throw new ForgeError(
              'VALIDATION_ERROR',
              `Invalid action "${decision.action}" for confirmation gate`,
              400,
            );
        }
      }

      default:
        throw new ForgeError(
          'VALIDATION_ERROR',
          `Unsupported HAMA gate kind "${gate.kind}"`,
          400,
        );
    }
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
    const domainTerms = this.store.listDomainTerms(mission.hubId);
    const prdDrift = detectTerminologyDrift(
      renderPrdMarkdown(prdArt.data),
      domainTerms,
    );
    if (prdDrift.length > 0) {
      throw new ForgeError(
        'DDD_DRIFT_DETECTED',
        `Cannot publish baseline: PRD uses forbidden DDD alias "${prdDrift[0]!.forbiddenAlias}" (use "${prdDrift[0]!.canonicalTerm}")`,
        422,
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
        iss.rejectedOptions.map((opt, idx) => ({
          kind: 'rejected_option' as const,
          subjectKey: `req:${iss.scopeKey}:rejected:${idx}`,
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

  private maybeEscalatePostIntake(
    mission: MissionRecord,
    input: HamaStartInput,
    intake: IntakeArtifactData,
  ): MissionRecord {
    if (mission.activeBaselineId || mission.triageTrack === 'full_hama') {
      return mission;
    }

    const docHighRisk = input.documents.some(d =>
      HIGH_RISK_DOMAIN_PATTERN.test(d.content),
    );
    const assumptionCount = intake.evidence.filter(
      e => e.kind === 'assumption',
    ).length;
    const criticalCount = Math.max(
      intake.questions.filter(q => q.critical).length,
      intake.blockingQuestions.length,
    );

    const needsFullHama =
      docHighRisk ||
      intake.rawItems.length >= 5 ||
      (intake.ambiguities.length >= 2 && intake.risks.length >= 2) ||
      assumptionCount >= 3 ||
      criticalCount >= 3;
    const needsStandard =
      intake.rawItems.length >= 3 ||
      intake.ambiguities.length >= 2 ||
      intake.risks.length >= 2 ||
      criticalCount >= 2 ||
      (assumptionCount >= 1 && intake.ambiguities.length >= 1);

    let nextTrack: MissionRecord['triageTrack'] = mission.triageTrack;
    if (needsFullHama) {
      nextTrack = 'full_hama';
    } else if (mission.triageTrack === 'express' && needsStandard) {
      nextTrack = 'standard';
    }

    if (nextTrack === mission.triageTrack) {
      return mission;
    }

    const rationale = `Post-intake deterministic escalation (${mission.triageTrack} -> ${nextTrack}): items=${intake.rawItems.length}, ambiguities=${intake.ambiguities.length}, risks=${intake.risks.length}, assumptions=${assumptionCount}.`;
    const updated = this.store.missions.updateMissionCas(
      mission.id,
      undefined,
      {
        triageTrack: nextTrack,
        triageRationale: rationale,
      },
    );
    this.store.missions.appendEvent(
      mission.id,
      'hama.triage_escalated',
      'hama_engine',
      {from: mission.triageTrack, to: nextTrack, rationale},
    );
    this.publish({
      type: 'mission.updated',
      missionId: updated.id,
      status: updated.status,
      stage: updated.stage,
      at: updated.updatedAt,
    });
    return updated;
  }

  private async finishExpressAfterIntake(
    mission: MissionRecord,
    input: HamaStartInput,
    intake: IntakeArtifactData,
    feedback?: string,
    signal?: AbortSignal,
  ): Promise<HamaStepOutcome> {
    const usedKeys = new Set<string>();
    const expressIssues: HamaIssueState[] = intake.rawItems.map((item, idx) => {
      let scopeKey =
        item.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '.')
          .replace(/^\.+|\.+$/g, '')
          .slice(0, 48) || `scope.${idx + 1}`;
      if (usedKeys.has(scopeKey)) {
        scopeKey = `${scopeKey}.${idx + 1}`;
      }
      usedKeys.add(scopeKey);
      return {
        id: `ISS-${String(idx + 1).padStart(3, '0')}`,
        title: item.title,
        scopeKey,
        summary: item.detail,
        priority: item.priority,
        itemIds: [item.id],
        ownerRole: 'product',
        openQuestions: [],
        status: 'resolved',
        resolutionSummary: item.detail,
        round: 0,
        rejectedOptions: [],
      };
    });
    const board: HamaBoardData = {issues: expressIssues, edges: []};
    this.store.hama.writeArtifact(mission.id, 'board', board);

    this.store.hama.updateRunStage(mission.id, 'integrate');
    const proposal = await this.invokeIntegrate(
      mission,
      input,
      intake,
      board,
      feedback,
      signal,
    );
    const domainTerms = this.store.listDomainTerms(mission.hubId);
    const propDrift = detectTerminologyDrift(
      renderProposalTextForDrift(proposal),
      domainTerms,
    );
    if (propDrift.length > 0) {
      throw new ForgeError(
        'DDD_DRIFT_DETECTED',
        `Express proposal uses forbidden DDD alias "${propDrift[0]!.forbiddenAlias}" (use "${propDrift[0]!.canonicalTerm}")`,
        422,
      );
    }
    const propArt = this.store.hama.writeArtifact(
      mission.id,
      'proposal',
      proposal,
    );

    return this.generatePrdAndOpenConfirmation(
      mission,
      input,
      `express-auto-${propArt.id}`,
      feedback,
      signal,
    );
  }

  private async continueAfterClarification(
    mission: MissionRecord,
    input: HamaStartInput,
    feedback: string,
    signal?: AbortSignal,
    forceTrack?: 'standard' | 'full_hama',
  ): Promise<HamaStepOutcome> {
    const freshMission = this.mustMission(mission.id);
    const intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
      freshMission.id,
      'intake',
    )!;
    const intake = intakeArt.data;

    if (!forceTrack && freshMission.triageTrack === 'express') {
      return this.finishExpressAfterIntake(
        freshMission,
        input,
        intake,
        feedback,
        signal,
      );
    }

    const track =
      forceTrack ??
      (freshMission.triageTrack === 'standard' ? 'standard' : 'full_hama');

    this.store.hama.updateRunStage(freshMission.id, 'agenda');
    let depsArt = this.store.hama.latestArtifact<DependencyArtifactData>(
      freshMission.id,
      'dependencies',
    );
    if (!depsArt && track === 'full_hama') {
      const depsData = await this.invokeDependencies(
        freshMission,
        intake,
        signal,
      );
      depsArt = this.store.hama.writeArtifact(
        freshMission.id,
        'dependencies',
        depsData,
      );
    }
    const depsEdges = depsArt?.data.edges ?? [];

    const agenda = await this.invokeAgenda(
      freshMission,
      intake,
      depsEdges,
      signal,
    );
    this.store.hama.writeArtifact(freshMission.id, 'agenda', agenda);

    const initialCycleIds = new Set(
      detectDependencyCycle(
        agenda.issues.map(i => i.id),
        depsEdges,
      ),
    );
    let board: HamaBoardData = {
      issues: agenda.issues.map(iss => {
        const inCycle = initialCycleIds.has(iss.id);
        return {
          ...iss,
          status: iss.blockingQuestion || inCycle ? 'blocked' : 'open',
          blockingQuestion:
            iss.blockingQuestion ??
            (inCycle
              ? `Dependency cycle detected involving ${iss.id}; resolve blocking edges.`
              : undefined),
          resolutionSummary: '',
          round: 0,
          rejectedOptions: [],
        };
      }),
      edges: depsEdges,
    };
    const boardArt = this.store.hama.writeArtifact(
      freshMission.id,
      'board',
      board,
    );

    const blockingIssue = board.issues.find(i => i.status === 'blocked');
    if (blockingIssue && (!feedback || initialCycleIds.size > 0)) {
      this.store.hama.updateRunStage(freshMission.id, 'discuss');
      const openedGate = this.openGateAndEmit(freshMission, {
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

    board = await this.runDiscussionWaves(
      freshMission,
      input,
      board,
      track,
      signal,
    );

    const blockedOutcome = this.maybeOpenDiscussionBlockedGate(
      freshMission,
      board,
    );
    if (blockedOutcome) {
      return blockedOutcome;
    }

    return this.runIntegrateAndEvaluate(
      freshMission,
      input,
      intake,
      feedback,
      signal,
    );
  }

  private maybeOpenDiscussionBlockedGate(
    mission: MissionRecord,
    board: HamaBoardData,
  ): HamaStepOutcome | null {
    const remainingBlocked = board.issues.find(i => i.status === 'blocked');
    if (!remainingBlocked) {
      return null;
    }
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
          consequencePreview: 'Stops requirements engineering at failed state.',
          requiresFeedback: true,
        },
      ],
    });
    return {stage: 'discuss', openedGate, baseline: null};
  }

  private async triggerLoopBRework(
    mission: MissionRecord,
    input: HamaStartInput,
    source: HamaReworkData['source'],
    feedback: string,
    issueIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<HamaStepOutcome> {
    const targetIssueIds = [...new Set(issueIds)];
    this.store.hama.writeArtifact(mission.id, 'rework', {
      source,
      scope: targetIssueIds.length > 0 ? 'local' : 'proposal',
      reason: feedback || `Loop B rework from ${source}`,
      feedback,
      targetIssueIds,
      at: new Date().toISOString(),
    } satisfies HamaReworkData);

    const intakeArt = this.store.hama.latestArtifact<IntakeArtifactData>(
      mission.id,
      'intake',
    )!;

    if (targetIssueIds.length > 0 && mission.triageTrack !== 'express') {
      this.store.hama.updateRunStage(mission.id, 'discuss', {
        incrementProposalRework: true,
      });
      const boardArt = this.store.hama.latestArtifact<HamaBoardData>(
        mission.id,
        'board',
      );
      if (boardArt) {
        const reopenedBoard: HamaBoardData = {
          issues: boardArt.data.issues.map(iss =>
            targetIssueIds.includes(iss.id)
              ? {
                  ...iss,
                  status: 'open',
                  blockingQuestion: undefined,
                  openQuestions: feedback
                    ? [...iss.openQuestions, feedback]
                    : iss.openQuestions,
                }
              : iss,
          ),
          edges: boardArt.data.edges,
        };
        this.store.hama.writeArtifact(mission.id, 'board', reopenedBoard);
        const track =
          mission.triageTrack === 'standard' ? 'standard' : 'full_hama';
        const discussed = await this.runDiscussionWaves(
          mission,
          input,
          reopenedBoard,
          track,
          signal,
        );
        const blockedOutcome = this.maybeOpenDiscussionBlockedGate(
          mission,
          discussed,
        );
        if (blockedOutcome) {
          return blockedOutcome;
        }
      }
    } else {
      this.store.hama.updateRunStage(mission.id, 'integrate', {
        incrementProposalRework: true,
      });
    }

    return this.runIntegrateAndEvaluate(
      mission,
      input,
      intakeArt.data,
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
            (e.kind === 'depends_on' ||
              e.kind === 'prerequisite' ||
              e.kind === 'conflict'),
        );
        return blockers.every(b => resolvedIds.has(b.to));
      });
      if (wave.length === 0) {
        wave = [unresolved[0]!];
      }
      const batch = wave.slice(0, Math.max(1, policy.maxParallelSlots));

      const waveDrafts = await Promise.all(
        batch.map(async issue => ({
          issue,
          draft: await this.invokePropose(mission, input, issue, signal),
        })),
      );

      const priorSettled = board.issues
        .filter(i => i.status === 'resolved')
        .map(i => ({
          issueId: i.id,
          scopeKey: i.scopeKey,
          summary: i.resolutionSummary || i.summary,
        }));

      const outcomes = await Promise.all(
        waveDrafts.map(async ({issue, draft}) => {
          const peerProposals = [
            ...priorSettled.filter(p => p.issueId !== issue.id),
            ...waveDrafts
              .filter(w => w.issue.id !== issue.id)
              .map(w => ({
                issueId: w.issue.id,
                scopeKey: w.issue.scopeKey,
                summary: w.draft.summary,
              })),
          ];
          const critiques = await Promise.all(
            roles.map(role =>
              this.invokeCritique(
                mission,
                input,
                issue,
                draft,
                role,
                round,
                peerProposals,
                signal,
              ),
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
                if (
                  ne.kind === 'conflict' ||
                  ne.kind === 'depends_on' ||
                  ne.kind === 'prerequisite'
                ) {
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

          const vetoes = out.critiques.filter(c => c.verdict === 'veto');
          const hasVeto = vetoes.length > 0;
          const isResolved = out.consensus.resolved && !hasVeto;
          const nextStatus: HamaIssueState['status'] = isResolved
            ? 'resolved'
            : round < maxRounds
              ? 'open'
              : 'blocked';
          const vetoNote = hasVeto
            ? `Veto by ${vetoes.map(v => v.role).join(', ')}: ${vetoes.flatMap(v => v.concerns).join('; ') || 'Unresolved veto'}`
            : undefined;

          issueMap.set(out.issue.id, {
            ...out.issue,
            round,
            status: nextStatus,
            resolutionSummary: out.consensus.summary,
            rejectedOptions: out.consensus.rejectedOptions,
            blockingQuestion: isResolved
              ? undefined
              : (out.consensus.unresolvedQuestion ??
                vetoNote ??
                (round >= maxRounds
                  ? `Issue ${out.issue.id} did not reach consensus within ${maxRounds} round(s).`
                  : undefined)),
          });
        }

        for (const peerId of touchedPeerIds) {
          const peer = issueMap.get(peerId);
          if (peer && peer.status === 'resolved' && round < maxRounds) {
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

    const remainingCycleIds = detectDependencyCycle(
      board.issues.map(i => i.id),
      board.edges,
    );
    if (remainingCycleIds.length > 0) {
      const cycleSet = new Set(remainingCycleIds);
      const cycleBoard: HamaBoardData = {
        issues: board.issues.map(iss =>
          cycleSet.has(iss.id)
            ? {
                ...iss,
                status: 'blocked',
                blockingQuestion:
                  iss.blockingQuestion ??
                  `Unresolved dependency cycle detected across [${remainingCycleIds.join(', ')}].`,
              }
            : iss,
        ),
        edges: board.edges,
      };
      this.store.hama.writeArtifact(mission.id, 'board', cycleBoard);
      return cycleBoard;
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
    const policy = resolvePresetPolicy(mission.preset, mission.configOverrides);
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
    const domainTerms = this.store.listDomainTerms(mission.hubId);
    const propDrift = detectTerminologyDrift(
      renderProposalTextForDrift(proposal),
      domainTerms,
    );
    if (propDrift.length > 0) {
      const driftMsg = propDrift
        .map(
          d =>
            `Forbidden DDD alias "${d.forbiddenAlias}" -> use canonical "${d.canonicalTerm}" (${d.boundedContext})`,
        )
        .join('; ');
      const run = this.store.hama.getRun(mission.id)!;
      if (
        mission.executionMode === 'live' &&
        run.proposalReworkCount < policy.maxProposalRevisions
      ) {
        this.store.hama.writeArtifact(mission.id, 'rework', {
          source: 'evaluation',
          scope: 'proposal',
          reason: driftMsg,
          feedback: driftMsg,
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
          driftMsg,
          signal,
        );
      }
      throw new ForgeError(
        'DDD_DRIFT_DETECTED',
        `Proposal failed DDD terminology drift check: ${driftMsg}`,
        422,
      );
    }

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
    const reworkCount =
      this.store.hama.getRun(mission.id)?.proposalReworkCount ?? 0;

    const evalResults = await Promise.all(
      dims.map(async dim => {
        const evalData = await this.invokeEvaluate(
          mission,
          input,
          dim,
          proposal,
          false,
          feedback,
          reworkCount,
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

    const allFindings = evalResults.flatMap(r =>
      r.evalData.findings.map(f => ({dim: r.dim, f})),
    );
    const hasVeto = allFindings.some(({f}) => f.severity === 'veto');
    const blockingFindings = allFindings.filter(
      ({f}) => f.severity === 'blocking',
    );
    const hasBlocking =
      blockingFindings.length > 0 ||
      evalResults.some(r => r.evalData.verdict === 'fail');
    const hasConditionOrUncertain =
      allFindings.some(
        ({f}) => f.severity === 'condition' || f.severity === 'uncertain',
      ) ||
      evalResults.some(
        r =>
          r.evalData.verdict === 'condition' ||
          r.evalData.verdict === 'uncertain',
      );

    let verdict: HamaReportData['verdict'] = 'pass';
    if (hasVeto) {
      verdict = 'escalation';
    } else if (hasBlocking) {
      verdict = 'revision_required';
    } else if (hasConditionOrUncertain) {
      verdict = 'conditional_pass';
    }

    const conditions = evalResults.flatMap(r =>
      r.evalData.findings
        .filter(
          f =>
            (f.severity === 'condition' || f.severity === 'uncertain') &&
            f.owner &&
            f.verification,
        )
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

    if (verdict === 'escalation') {
      const vetoMsgs = allFindings
        .filter(({f}) => f.severity === 'veto')
        .map(({dim, f}) => `[${dim}] ${f.message}`)
        .join('\n');
      const openedGate = this.openGateAndEmit(mission, {
        kind: 'evaluation',
        targetId: reportArt.id,
        targetHash: reportArt.hash,
        targetRevision: reportArt.revision,
        question:
          'Evaluator raised a VETO finding. Revise proposal or halt Mission?',
        contextSnippet: vetoMsgs || 'Veto escalation requires human decision.',
        options: [
          {
            action: 'request_changes',
            label: 'Revise Proposal via Loop B',
            recommended: true,
            consequencePreview:
              'Sends proposal back through Loop B revision with your feedback.',
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

    if (verdict === 'revision_required') {
      const run = this.store.hama.getRun(mission.id)!;
      if (run.proposalReworkCount < policy.maxProposalRevisions) {
        const failMsg =
          blockingFindings
            .map(({dim, f}) => `${dim}: ${f.message}`)
            .join('; ') ||
          evalResults
            .filter(r => r.evalData.verdict === 'fail')
            .map(r => `${r.dim}: ${r.evalData.summary}`)
            .join('; ');
        const targetIssueIds = [
          ...new Set(blockingFindings.flatMap(({f}) => f.issueIds ?? [])),
        ];
        return this.triggerLoopBRework(
          mission,
          input,
          'evaluation',
          failMsg,
          targetIssueIds,
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
    const latestReport = this.store.hama.latestArtifact<HamaReportData>(
      mission.id,
      'report',
    );
    const isConditionalPass = latestReport?.data.verdict === 'conditional_pass';
    const conditionLines =
      latestReport?.data.conditions.map(
        c =>
          `- [${c.dimension}] ${c.message} (Owner: ${c.owner}; Verify: ${c.verification})`,
      ) ?? [];
    const contextSnippet =
      isConditionalPass && conditionLines.length > 0
        ? `${propArt.data.summary}\n\nConditions:\n${conditionLines.join('\n')}`
        : propArt.data.summary;

    const options: DecisionOptionPreview[] = [
      ...(isConditionalPass
        ? []
        : [
            {
              action: 'approve' as const,
              label: 'Approve Proposal',
              recommended: true,
              consequencePreview:
                'Synthesizes the traceable PRD document for final baseline freeze.',
              requiresFeedback: false,
            },
          ]),
      {
        action: 'conditional_approve',
        label: 'Conditional Approve',
        recommended: isConditionalPass,
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
    ];

    const openedGate = this.openGateAndEmit(mission, {
      kind,
      targetId: propArt.id,
      targetHash: propArt.hash,
      targetRevision: propArt.revision,
      question: isConditionalPass
        ? `Conditionally Approve Requirements Proposal rev ${propArt.revision} (${latestReport.data.conditions.length} condition(s))?`
        : `Approve Requirements Proposal rev ${propArt.revision} (${propArt.data.scopeItems.length} requirement scope item(s))?`,
      contextSnippet,
      options,
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

    const requirements: RequirementItem[] = propArt.data.scopeItems.map(
      item => {
        const prefix = item.kind === 'nonfunctional' ? 'NFR' : 'FR';
        const reqId = `${prefix}-${sha256Canonical([mission.projectId, item.scopeKey]).slice(0, 20)}`;
        const acceptance = item.acceptance.map(ac => ({
          id: `AC-${sha256Canonical([reqId, ac.key]).slice(0, 20)}`,
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

    const domainTerms = this.store.listDomainTerms(mission.hubId);
    const policy = resolvePresetPolicy(mission.preset, mission.configOverrides);

    let draftFeedback = feedback;
    let prd: PrdDocument | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const draft = await this.invokePrd(
        mission,
        propArt.data,
        nextRev,
        draftFeedback,
        signal,
      );
      const candidate: PrdDocument = {
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
      const prdDrift = detectTerminologyDrift(
        renderPrdMarkdown(candidate),
        domainTerms,
      );
      if (prdDrift.length === 0) {
        prd = candidate;
        break;
      }
      const driftMsg = prdDrift
        .map(
          d =>
            `Forbidden DDD alias "${d.forbiddenAlias}" -> use canonical "${d.canonicalTerm}" (${d.boundedContext})`,
        )
        .join('; ');
      const run = this.store.hama.getRun(mission.id)!;
      if (
        attempt === 0 &&
        mission.executionMode === 'live' &&
        run.prdLocalEditCount < policy.maxLocalPrdEdits
      ) {
        this.store.hama.updateRunStage(mission.id, 'prd', {
          incrementPrdLocalEdit: true,
        });
        draftFeedback = `${feedback ? `${feedback}\n` : ''}Fix DDD drift: ${driftMsg}`;
        continue;
      }
      throw new ForgeError(
        'DDD_DRIFT_DETECTED',
        `PRD failed DDD terminology drift check: ${driftMsg}`,
        422,
      );
    }

    const prdArt = this.store.hama.writeArtifact(mission.id, 'prd', prd!);
    this.store.hama.updateRunStage(mission.id, 'confirmation');

    const openBlocking = this.store.hama.countOpenBlockingComments(mission.id);
    const openedGate = this.openGateAndEmit(mission, {
      kind: 'confirmation',
      targetId: prdArt.id,
      targetHash: prdArt.hash,
      targetRevision: prdArt.revision,
      question: `Freeze PRD rev ${prd!.revision} (${prd!.requirements.length} requirements) as an immutable Requirements Baseline?${openBlocking > 0 ? ` (${openBlocking} blocking comment(s) must be resolved first)` : ''}`,
      contextSnippet: renderPrdMarkdown(prd!).slice(0, 1200),
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
    const firstCritical =
      intake.questions.find(q => q.critical)?.question ??
      intake.blockingQuestions[0] ??
      'Clarify ambiguous requirement.';
    return this.openGateAndEmit(mission, {
      kind: 'clarification',
      targetId: intakeArt.id,
      targetHash: intakeArt.hash,
      targetRevision: intakeArt.revision,
      question: firstCritical,
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

  private buildHamaGroundingContext(
    mission: MissionRecord,
    query: string,
  ): string {
    const parts: string[] = [];
    const hub = this.store.getHub(mission.hubId);
    if (hub?.agentWikiSummary.trim()) {
      parts.push(wrapUntrusted('hub_agent_wiki', hub.agentWikiSummary.trim()));
    }
    const domainTerms = this.store.listDomainTerms(mission.hubId);
    if (domainTerms.length > 0) {
      parts.push(renderUbiquitousLanguageSection(domainTerms));
    }
    const recallRes = this.memory.recall({
      hubId: mission.hubId,
      executionMode: mission.executionMode,
      query,
      limit: 5,
    });
    if (recallRes.hits.length > 0) {
      const memLines = recallRes.hits.map(h => {
        const rejectedBanner = h.rejectedWarning
          ? `REJECTED — DO NOT RE-PROPOSE (${h.rejectedWarning}): `
          : '';
        return `${rejectedBanner}[${h.authorityTier}] ${h.title}: ${h.content}`;
      });
      parts.push(wrapUntrusted('untrusted_memory', memLines.join('\n')));
    }
    return parts.join('\n\n');
  }

  private resolveProviderIdForModel(model: string): string | undefined {
    const providers = this.store.listModelProviders(() => ({
      hasApiKey: false,
      maskedKeyHint: '',
    }));
    const exact = providers.find(
      p => p.id === model || p.models.some(m => m.id === model),
    );
    if (exact) {
      return exact.id;
    }
    const slashIdx = model.indexOf('/');
    if (slashIdx > 0) {
      const prefix = model.slice(0, slashIdx);
      if (providers.some(p => p.id === prefix)) {
        return prefix;
      }
    }
    const lower = model.toLowerCase();
    if (lower.startsWith('claude')) {
      return providers.find(p => p.id === 'anthropic')?.id;
    }
    if (
      lower.startsWith('gpt') ||
      lower.startsWith('o1') ||
      lower.startsWith('o3') ||
      lower.startsWith('o4')
    ) {
      return providers.find(p => p.id === 'openai')?.id;
    }
    if (lower.startsWith('glm') || lower.startsWith('kimi')) {
      return providers.find(p => p.id === 'opencode-go')?.id;
    }
    if (lower.startsWith('deepseek')) {
      return providers.find(p => p.id === 'deepseek')?.id;
    }
    return undefined;
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
    const grounding = this.buildHamaGroundingContext(
      mission,
      `${input.title} ${input.rawIntent.slice(0, 200)}`,
    );
    const probeBlock = renderCodebaseRealityBlock(input.codebaseProbe);
    const docsText = input.documents
      .map(d => `### ${d.title}\n${d.content}`)
      .join('\n\n');
    const systemPrompt =
      'You are the HAMA Requirements Intake Analyst. Ground every item in real files/exports from codebase_probe_reality and explicitly challenge shaky, redundant, or over-engineered user assumptions with concrete file evidence instead of blindly agreeing. Return ONLY a strict JSON object conforming to the schema.';
    const userPrompt = [
      `Mission Title: ${input.title}`,
      wrapUntrusted('untrusted_intent', input.rawIntent),
      docsText ? wrapUntrusted('untrusted_documents', docsText) : '',
      probeBlock,
      grounding,
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
    const grounding = this.buildHamaGroundingContext(
      mission,
      intake.summary.slice(0, 200),
    );
    return this.invokeStructured(
      mission,
      'You are the HAMA Dependency Analyst. Return ONLY JSON matching the schema.',
      [
        grounding,
        `Intake:\n${JSON.stringify(intake)}`,
        `Schema:\n${JSON.stringify(dependencySchema.json)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
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
    const grounding = this.buildHamaGroundingContext(
      mission,
      intake.summary.slice(0, 200),
    );
    return this.invokeStructured(
      mission,
      'You are the HAMA Agenda Planner. Decompose raw items into crisp trackable issues. Return ONLY JSON.',
      [
        grounding,
        `Intake:\n${JSON.stringify(intake)}`,
        `Dependencies:\n${JSON.stringify(edges)}`,
        `Schema:\n${JSON.stringify(agendaSchema.json)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
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
    const grounding = this.buildHamaGroundingContext(
      mission,
      `${issue.title} ${issue.scopeKey} ${issue.summary.slice(0, 140)}`,
    );
    return this.invokeStructured(
      mission,
      `You are the ${issue.ownerRole} lead drafting an issue solution. Return ONLY JSON.`,
      [
        `Mission: ${input.title}`,
        grounding,
        `Issue: ${JSON.stringify(issue)}`,
        `Schema:\n${JSON.stringify(proposalDraftSchema.json)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      proposalDraftSchema,
      signal,
    );
  }

  private async invokeCritique(
    mission: MissionRecord,
    input: HamaStartInput,
    issue: HamaIssueState,
    draft: ProposalDraftData,
    role: HamaRole,
    round: number,
    peerProposals: readonly {
      readonly issueId: string;
      readonly scopeKey: string;
      readonly summary: string;
    }[],
    signal?: AbortSignal,
  ): Promise<CritiqueData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondCritique({
        issueId: issue.id,
        role,
        rawIntent: input.rawIntent,
        round,
        peerIssueIds: peerProposals.map(p => p.issueId),
      });
    }
    const grounding = this.buildHamaGroundingContext(
      mission,
      `${issue.title} ${issue.scopeKey}`,
    );
    return this.invokeStructured(
      mission,
      `You are the HAMA ${role} reviewer. Critically challenge gaps or hidden cross-issue dependencies against peer proposals. Return ONLY JSON.`,
      [
        `Role: ${role} (Round ${round})`,
        grounding,
        `Issue: ${JSON.stringify(issue)}`,
        `Draft: ${JSON.stringify(draft)}`,
        peerProposals.length > 0
          ? `Peer Proposals: ${JSON.stringify(peerProposals)}`
          : '',
        `Schema:\n${JSON.stringify(critiqueSchema.json)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
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
    const grounding = this.buildHamaGroundingContext(
      mission,
      `${issue.title} ${issue.scopeKey}`,
    );
    return this.invokeStructured(
      mission,
      'You are the HAMA Facilitator consolidating critiques into local consensus and rejectedOptions. Return ONLY JSON.',
      [
        grounding,
        `Issue: ${JSON.stringify(issue)}`,
        `Draft: ${JSON.stringify(draft)}`,
        `Critiques: ${JSON.stringify(critiques)}`,
        `Schema:\n${JSON.stringify(localConsensusSchema.json)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
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
        parentPrd: input.parentPrd,
      });
    }
    const grounding = this.buildHamaGroundingContext(
      mission,
      `${input.title} ${intake.summary.slice(0, 160)}`,
    );
    const probeBlock = renderCodebaseRealityBlock(input.codebaseProbe);
    return this.invokeStructured(
      mission,
      'You are the HAMA Chief Architect integrating resolved issues into a unified specification Proposal. Anchor approach/constraints/risks in real codebase_probe_reality paths and challenge risky assumptions rather than blindly endorsing them. Return ONLY JSON.',
      [
        `Mission: ${input.title}`,
        probeBlock,
        grounding,
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
    input: HamaStartInput,
    dimension: EvalDimension,
    proposal: ProposalArtifactData,
    triggerCondition: boolean,
    feedback?: string,
    reworkCount = 0,
    signal?: AbortSignal,
  ): Promise<EvaluationArtifactData> {
    if (mission.executionMode === 'simulation') {
      return this.sim.respondEvaluate({
        dimension,
        proposal,
        triggerCondition,
        rawIntent: input.rawIntent,
        feedback,
        reworkCount,
      });
    }
    const grounding = this.buildHamaGroundingContext(
      mission,
      `${proposal.title} ${dimension}`,
    );
    return this.invokeStructured(
      mission,
      `You are the independent HAMA ${dimension} Evaluator. Every condition/uncertain finding MUST carry non-empty owner and verification. Return ONLY JSON.`,
      [
        `Dimension: ${dimension}`,
        grounding,
        `Proposal: ${JSON.stringify(proposal)}`,
        `Schema:\n${JSON.stringify(evaluationSchema.json)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
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
    const grounding = this.buildHamaGroundingContext(mission, proposal.title);
    return this.invokeStructured(
      mission,
      'You are the HAMA Technical Writer producing the formal PRD narrative fields from the approved proposal. Return ONLY JSON.',
      [
        `Revision: ${revision}`,
        grounding,
        `Proposal: ${JSON.stringify(proposal)}`,
        feedback ? `Feedback: ${feedback}` : '',
        `Schema: ${JSON.stringify(prdDraftSchema.json)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
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
    const preMission = this.mustMission(mission.id);
    if (preMission.spentUsd >= preMission.budgetUsdLimit) {
      throw new ForgeError(
        'BUDGET_EXCEEDED',
        `Mission "${preMission.code}" spent $${preMission.spentUsd.toFixed(4)} reached budget limit $${preMission.budgetUsdLimit.toFixed(2)}`,
        402,
      );
    }

    const profiles = this.store.listAdapterProfiles();
    if (profiles.length === 0) {
      throw new ForgeError(
        'SETUP_REQUIRED',
        'No Lead adapter registered for live HAMA execution',
        412,
      );
    }
    const chosen =
      selectHealthyAdapterForRole(
        profiles,
        'lead',
        mission.configOverrides.leadAdapterId,
      ) ??
      profiles.find(
        p => p.manifest.id === 'native-api' && p.health !== 'circuit_open',
      ) ??
      profiles.find(p => p.health !== 'circuit_open');

    if (!chosen) {
      throw new ForgeError(
        'ADAPTER_UNAVAILABLE',
        'All Lead adapters have open circuit breakers for live HAMA execution',
        503,
      );
    }

    const model =
      mission.configOverrides.leadModel ??
      chosen.manifest.defaultModel ??
      'deepseek-reasoner';
    const providerId = this.resolveProviderIdForModel(model);

    let promptForAttempt = userPrompt;
    let schemaAttempts = 0;
    let rateRetries = 0;

    const sess = this.store.startSession({
      hubId: mission.hubId,
      changeId: null,
      nodeId: null,
      adapterId: chosen.manifest.id,
      model,
      role: 'lead',
    });
    let sessionFinished = false;
    const closeSession = (
      status: 'completed' | 'failed' | 'interrupted',
    ): void => {
      if (!sessionFinished) {
        sessionFinished = true;
        this.store.finishSession(sess.id, status);
      }
    };

    try {
      this.store.appendTranscriptMessage({
        sessionId: sess.id,
        role: 'user',
        content: promptForAttempt,
      });

      while (schemaAttempts < 3) {
        const curMission = this.mustMission(mission.id);
        if (curMission.spentUsd >= curMission.budgetUsdLimit) {
          closeSession('failed');
          throw new ForgeError(
            'BUDGET_EXCEEDED',
            `Mission "${curMission.code}" spent $${curMission.spentUsd.toFixed(4)} reached budget limit $${curMission.budgetUsdLimit.toFixed(2)}`,
            402,
          );
        }

        const result = await this.adapters.invoke({
          sessionId: sess.id,
          hubId: mission.hubId,
          changeId: null,
          nodeId: null,
          role: 'lead',
          adapter: chosen.manifest,
          model,
          ...(providerId ? {providerId} : {}),
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

        this.store.appendTranscriptMessage({
          sessionId: sess.id,
          role: 'assistant',
          content: result.finalText || result.diagnostic,
          isError: result.outcome !== 'completed',
          inputTokens: result.inputTokens,
          cachedTokens: result.cachedTokens,
          outputTokens: result.outputTokens,
        });

        this.store.recordTelemetry({
          hubId: mission.hubId,
          changeId: null,
          nodeId: null,
          adapterId: chosen.manifest.id,
          model,
          role: 'lead',
          outcome:
            result.outcome === 'completed'
              ? 'certified'
              : result.outcome === 'env_fault' ||
                  result.outcome === 'rate_limited'
                ? 'env_fault'
                : 'task_failure',
          firstPassCertified:
            result.outcome === 'completed' && schemaAttempts === 0,
          prematureStopTriggered: false,
          durationSec: result.durationSec,
          inputTokens: result.inputTokens,
          cachedTokens: result.cachedTokens,
          firstTurnCachedTokens: result.firstTurnCachedTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          diagnostic: result.diagnostic,
        });

        if (result.outcome === 'rate_limited') {
          rateRetries += 1;
          if (rateRetries > 3) {
            closeSession('failed');
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
          closeSession('failed');
          throw new ForgeError(
            'SETUP_REQUIRED',
            `Live HAMA invocation failed (${result.outcome}): ${result.diagnostic}`,
            412,
          );
        }

        try {
          const parsed = extractJsonPayload(result.finalText, schema);
          closeSession('completed');
          return parsed;
        } catch (err) {
          schemaAttempts += 1;
          if (schemaAttempts >= 3) {
            const msg = err instanceof Error ? err.message : String(err);
            closeSession('failed');
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
          this.store.appendTranscriptMessage({
            sessionId: sess.id,
            role: 'user',
            content: promptForAttempt,
          });
        }
      }

      closeSession('failed');
      throw new ForgeError(
        'INTERNAL_ERROR',
        'Unexpected exit from HAMA structured invocation loop',
        500,
      );
    } catch (err) {
      if (
        signal?.aborted ||
        (err instanceof ForgeError && err.code === 'ABORTED')
      ) {
        closeSession('interrupted');
      } else {
        closeSession('failed');
      }
      throw err;
    }
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

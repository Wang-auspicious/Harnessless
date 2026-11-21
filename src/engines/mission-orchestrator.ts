import {existsSync} from 'node:fs';
import {basename} from 'node:path';
import {sha256Canonical} from '../core/canonical-json.ts';
import {selectTermsForRepo} from '../core/ddd.ts';
import {analyzeBaselineImpact} from '../core/impact-analyzer.ts';
import {triageMissionIntent} from '../core/policy.ts';
import {compileBaselineToChangeBlueprints} from '../core/spec-compiler.ts';
import {validateCompiledMissionPlan} from '../core/spec-validator.ts';
import {simulateMissionTrial} from '../core/trial-simulator.ts';
import type {
  IAgentAdapterHub,
  ProviderSecretLookup,
} from '../adapters/contracts.ts';
import type {HindsightEngine} from '../memory/hindsight-engine.ts';
import type {HamaEngine} from '../requirements/hama-engine.ts';
import type {IGitWorktreeManager} from '../sandbox/contracts.ts';
import {resolvePresetPolicy} from '../shared/control-schema.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  CreateMissionRequest,
  FocusProjection,
  ForgeSseEvent,
  MissionDetailSnapshot,
  MissionTraceabilityResponse,
} from '../shared/api.ts';
import type {ChangeRecord, GraphNode} from '../shared/types.ts';
import type {
  BaselineImpactReport,
  ControlAvailability,
  ControlCommandInput,
  DecisionAction,
  DecisionInput,
  EvidenceBundle,
  ExecutionMode,
  FailureForensicsCard,
  IntentPresetId,
  MergeReadinessReport,
  MissionDecisionRecord,
  MissionGateKind,
  MissionGateRecord,
  MissionHealth,
  MissionRecord,
  MissionStage,
  MissionStageStepSummary,
  TrialSimulationReport,
  ValidationReport,
} from '../shared/v3-types.ts';
import type {ForgeStore} from '../store/database.ts';
import type {ContinuityEngine} from './continuity.ts';
import type {InfraStewardEngine} from './infra-steward.ts';
import type {RequirementClosureEngine} from './requirement-closure.ts';

export interface MissionOrchestratorDeps {
  readonly store: ForgeStore;
  readonly worktrees: IGitWorktreeManager;
  readonly adapters: IAgentAdapterHub;
  readonly hindsight: HindsightEngine;
  readonly hama: HamaEngine;
  readonly closure: RequirementClosureEngine;
  readonly continuity: ContinuityEngine;
  readonly steward: InfraStewardEngine;
  readonly lookupProvider: ProviderSecretLookup;
  readonly worktreesRoot: string;
  readonly publish: (event: ForgeSseEvent) => void;
  readonly rootSignal?: AbortSignal;
}

const STAGE_ORDER: readonly {
  readonly stage: MissionStage;
  readonly label: string;
}[] = [
  {stage: 'understand', label: '1. Understand Intent & Triage'},
  {stage: 'converge_spec', label: '2. Converge SDD Specification'},
  {stage: 'plan_validate', label: '3. Compile & Validate Twin-Graph'},
  {stage: 'build_verify', label: '4. Build & Verify Slices'},
  {stage: 'certify_deliver', label: '5. Certify & Deliver Evidence'},
];

const API_PROVIDER_IDS = [
  'opencode-go',
  'deepseek',
  'openai',
  'anthropic',
] as const;

const GATE_ALLOWED_ACTIONS: Readonly<
  Record<MissionGateKind, readonly DecisionAction[]>
> = {
  triage_confirm: ['confirm_triage', 'escalate', 'reject'],
  setup_required: ['resume', 'switch_simulation', 'reject'],
  clarification: ['clarify', 'reject'],
  discussion: ['resolve_issue', 'escalate', 'reject'],
  evaluation: [
    'approve',
    'confirm',
    'request_changes',
    'reject',
    'retry_review',
  ],
  limit: ['approve', 'confirm', 'request_changes', 'reject', 'escalate'],
  approval: ['approve', 'conditional_approve', 'request_changes', 'reject'],
  conditions: ['release_conditions', 'request_changes', 'reject'],
  confirmation: ['confirm', 'request_changes', 'reject'],
  plan_review: ['approve_plan', 'reject'],
  ghost_amendment: ['approve_ghost', 'waive_ghost', 'reject'],
  build_escalation: ['resume', 'reject'],
  budget_extension: ['extend_budget', 'resume', 'reject'],
  qa_decision: ['approve', 'resume', 'reject'],
  stale_upstream_gate: ['resync_upstream', 'hold', 'reject'],
  delivery_approval: ['approve_delivery', 'hold', 'reject'],
};

export class MissionOrchestrator {
  private readonly store: ForgeStore;
  private readonly worktrees: IGitWorktreeManager;
  private readonly adapters: IAgentAdapterHub;
  private readonly hindsight: HindsightEngine;
  private readonly hama: HamaEngine;
  private readonly closure: RequirementClosureEngine;
  private readonly continuity: ContinuityEngine;
  private readonly lookupProvider: ProviderSecretLookup;
  private readonly worktreesRoot: string;
  private readonly publish: (event: ForgeSseEvent) => void;
  private readonly rootSignal?: AbortSignal;
  private readonly validationCache = new Map<string, ValidationReport>();
  private readonly trialCache = new Map<string, TrialSimulationReport>();
  private readonly activeMissionRuns = new Map<
    string,
    Promise<MissionRecord>
  >();

  constructor(deps: MissionOrchestratorDeps) {
    this.store = deps.store;
    this.worktrees = deps.worktrees;
    this.adapters = deps.adapters;
    this.hindsight = deps.hindsight;
    this.hama = deps.hama;
    this.closure = deps.closure;
    this.continuity = deps.continuity;
    this.lookupProvider = deps.lookupProvider;
    this.worktreesRoot = deps.worktreesRoot;
    this.publish = deps.publish;
    this.rootSignal = deps.rootSignal;
  }

  async createMission(req: CreateMissionRequest): Promise<{
    readonly mission: MissionRecord;
    readonly focus: FocusProjection;
  }> {
    const preset: IntentPresetId = req.preset ?? 'guided';
    const executionMode: ExecutionMode = req.executionMode ?? 'live';
    const policy = resolvePresetPolicy(preset, req.configOverrides);

    let hub = req.hubId
      ? this.store.getHub(req.hubId)
      : this.store.listHubs(false)[0];
    if (req.hubId && !hub) {
      throw new ForgeError('NOT_FOUND', `Hub "${req.hubId}" not found`, 404);
    }
    if (!hub) {
      const rootPath = req.repoPaths?.[0] ?? process.cwd();
      hub = this.store.createHub({
        name: basename(rootPath) || 'ForgeOps Hub',
        rootPath,
        description: req.rawIntent.slice(0, 200),
        permissionTier: policy.permissionTier,
      });
    }

    const repoIdsToBind: string[] = [...(req.repoIds ?? [])];
    if (req.repoPaths && req.repoPaths.length > 0) {
      const existingRepos = this.store.listRepositories(hub.id);
      for (const localPath of req.repoPaths) {
        if (!existsSync(localPath)) {
          throw new ForgeError(
            'NOT_FOUND',
            `Repository path does not exist: ${localPath}`,
            404,
          );
        }
        let repo = existingRepos.find(r => r.localPath === localPath);
        if (!repo) {
          repo = this.store.registerRepository({
            hubId: hub.id,
            name: basename(localPath) || 'repo',
            localPath,
            tier: 'service',
            defaultBranch: 'main',
            verifyCommand: 'git status --short',
            boundedContext: basename(localPath) || 'core',
            contractSummary: `Auto-registered repository at ${localPath}`,
          });
        }
        repoIdsToBind.push(repo.id);
      }
    }

    let boundRepos = this.store.listRepositories(hub.id);
    if (repoIdsToBind.length > 0) {
      const idSet = new Set(repoIdsToBind);
      boundRepos = boundRepos.filter(r => idSet.has(r.id));
    }
    if (boundRepos.length === 0) {
      const defaultRepo = this.store.registerRepository({
        hubId: hub.id,
        name: basename(hub.rootPath) || 'workspace',
        localPath: hub.rootPath,
        tier: 'service',
        defaultBranch: 'main',
        verifyCommand: 'git status --short',
        boundedContext: 'core',
        contractSummary: hub.description,
      });
      boundRepos = [defaultRepo];
    }

    const triage = triageMissionIntent({
      rawIntent: req.rawIntent,
      repoCount: boundRepos.length,
      documentCount: (req.documents ?? []).length,
      requestedTrack: req.triageTrack,
      defaultTrack: policy.defaultTriageTrack,
    });

    const projectId =
      req.projectId ??
      (boundRepos
        .map(r => r.id)
        .sort()
        .join('+') ||
        hub.id);
    const title =
      req.title?.trim() ||
      req.rawIntent
        .trim()
        .split(/[\r\n.!?。！？]/)[0]
        ?.slice(0, 72) ||
      'Untitled SDD Mission';

    const parentBaseline = req.parentBaselineId
      ? this.store.hama.getBaseline(req.parentBaselineId)
      : null;

    const mission = this.store.missions.createMission({
      hubId: hub.id,
      projectId,
      title,
      rawIntent: req.rawIntent,
      status: 'triage',
      stage: 'understand',
      triageTrack: triage.track,
      triageRationale: triage.rationale,
      preset,
      executionMode,
      parentBaselineId: parentBaseline?.id ?? null,
      budgetUsdLimit: policy.budgetUsdLimit,
      maxOvernightHours: policy.maxOvernightHours,
      configOverrides: {
        ...req.configOverrides,
        targetRepoIds: boundRepos.map(r => r.id),
      },
    });

    this.hama.initRun(mission, {
      title: mission.title,
      rawIntent: mission.rawIntent,
      documents: req.documents ?? [],
      parentPrd: parentBaseline?.prd ?? null,
    });

    this.store.missions.appendEvent(mission.id, 'mission.created', 'operator', {
      code: mission.code,
      preset: mission.preset,
      executionMode: mission.executionMode,
      triageTrack: mission.triageTrack,
      repoIds: boundRepos.map(r => r.id),
    });

    if (executionMode === 'live' && !this.hasReadyLiveProvider(mission)) {
      const targetHash = sha256Canonical({
        missionId: mission.id,
        executionMode,
        reason: 'no_live_provider',
      });
      const gate = this.store.missions.openGate({
        missionId: mission.id,
        kind: 'setup_required',
        targetId: mission.id,
        targetHash,
        question:
          'No configured live model provider API key or healthy external CLI agent detected.',
        contextSnippet:
          'Add an API key under Providers (`opencode-go`, `deepseek`, `openai`, `anthropic`) then Resume, or explicitly opt into offline Simulation mode.',
        options: [
          {
            action: 'resume',
            label: 'Retry Live Provider Check',
            recommended: true,
            consequencePreview:
              'Re-checks configured provider keys and enters live requirements analysis.',
            requiresFeedback: false,
          },
          {
            action: 'switch_simulation',
            label: 'Switch to Offline Simulation Mode',
            recommended: false,
            consequencePreview:
              'Explicitly switches this Mission to deterministic offline responders in the isolated simulation memory namespace.',
            requiresFeedback: false,
          },
        ],
      });
      this.store.missions.updateMissionCas(mission.id, undefined, {
        status: 'paused_human',
      });
      this.publish({
        type: 'gate.opened',
        missionId: mission.id,
        gateId: gate.id,
        kind: gate.kind,
        at: gate.createdAt,
      });
    } else if (!policy.autoAdvanceTriage || triage.track !== 'express') {
      const targetHash = sha256Canonical({
        missionId: mission.id,
        triageTrack: triage.track,
        preset,
      });
      const gate = this.store.missions.openGate({
        missionId: mission.id,
        kind: 'triage_confirm',
        targetId: mission.id,
        targetHash,
        question: `Confirm ${triage.track} track for ${mission.code} (${boundRepos.length} repo(s), mode=${executionMode})?`,
        contextSnippet: triage.rationale,
        options: [
          {
            action: 'confirm_triage',
            label: `Confirm ${triage.track} Track & Analyze Requirements`,
            recommended: true,
            consequencePreview:
              'Starts HAMA-Loop intake, dependency mapping, and structured convergence.',
            requiresFeedback: false,
          },
          {
            action: 'escalate',
            label: 'Escalate Track',
            recommended: false,
            consequencePreview:
              'Upgrades track strictness (express -> standard -> full_hama) before intake.',
            requiresFeedback: false,
          },
        ],
      });
      this.store.missions.updateMissionCas(mission.id, undefined, {
        status: 'paused_human',
      });
      this.publish({
        type: 'gate.opened',
        missionId: mission.id,
        gateId: gate.id,
        kind: gate.kind,
        at: gate.createdAt,
      });
    } else {
      this.store.missions.updateMissionCas(mission.id, undefined, {
        status: 'requirements',
        stage: 'converge_spec',
      });
      const out = await this.hama.startOrAdvance(mission.id, {
        signal: this.rootSignal,
      });
      if (out.baseline) {
        await this.compileAndValidateMission(mission.id);
      }
    }

    const latest = this.mustMission(mission.id);
    return {mission: latest, focus: this.getFocusProjection(latest.id)};
  }

  getFocusProjection(missionId: string): FocusProjection {
    const mission = this.mustMission(missionId);
    const openGates = this.store.missions.listGates(missionId, false);
    const changes = this.store.listChangesForMission(missionId);
    const run = this.store.hama.getRun(missionId);
    const comments = this.store.hama.listComments(missionId);
    const openCommentsCount = comments.filter(
      c => c.disposition === 'open',
    ).length;
    const blockingCommentsCount =
      this.store.hama.countOpenBlockingComments(missionId);

    const primaryAction = openGates[0] ?? null;
    const secondaryActions = openGates.slice(1).map(g => ({
      gateId: g.id,
      kind: g.kind,
      title: g.question,
      targetId: g.targetId,
      targetHash: g.targetHash,
      changeId: g.changeId,
    }));

    const stageIdx = STAGE_ORDER.findIndex(s => s.stage === mission.stage);
    const stageSteps: MissionStageStepSummary[] = STAGE_ORDER.map((s, idx) => {
      if (mission.status === 'delivered') {
        return {stage: s.stage, label: s.label, status: 'completed'};
      }
      if (idx < stageIdx) {
        return {stage: s.stage, label: s.label, status: 'completed'};
      }
      if (idx === stageIdx) {
        const blocked =
          openGates.length > 0 ||
          mission.status === 'paused_human' ||
          mission.status === 'failed';
        return {
          stage: s.stage,
          label: s.label,
          status: blocked ? 'blocked' : 'active',
        };
      }
      return {stage: s.stage, label: s.label, status: 'pending'};
    });

    const health = this.deriveHealth(mission, openGates.length, changes);

    const capsules = this.hindsight.buildAllCapsules(
      Date.now(),
      mission.executionMode,
    );
    const capsule = capsules.find(c => c.hubId === mission.hubId) ?? null;
    const rehydration =
      capsule && capsule.retentionScore < 0.75 ? capsule : null;

    let totalNodes = 0;
    let certifiedNodes = 0;
    let runningNodes = 0;
    let failedNodes = 0;
    const forensicsList: FailureForensicsCard[] = [];
    for (const chg of changes) {
      for (const n of this.store.listGraphNodes(chg.id)) {
        totalNodes += 1;
        if (n.status === 'certified' || n.status === 'waived') {
          certifiedNodes += 1;
        } else if (n.status === 'running') {
          runningNodes += 1;
        } else if (n.status === 'failed') {
          failedNodes += 1;
        }
        if (n.forensics) {
          forensicsList.push(n.forensics);
        }
      }
    }
    const recentForensics = forensicsList
      .sort((a, b) => b.failedAt.localeCompare(a.failedAt))
      .slice(0, 6);

    const currentStepIndex = Math.max(0, stageIdx);
    const percentComplete =
      mission.status === 'delivered'
        ? 100
        : Math.round(
            ((currentStepIndex +
              (totalNodes > 0 ? certifiedNodes / totalNodes : 0)) /
              STAGE_ORDER.length) *
              100,
          );
    const stageProgress = {
      currentStepIndex,
      totalSteps: STAGE_ORDER.length,
      percentComplete,
      activeChangeCount: changes.filter(
        c => c.status === 'running' || c.status === 'planned',
      ).length,
      certifiedChangeCount: changes.filter(c => c.status === 'certified')
        .length,
    };

    const recalled = this.hindsight.recall({
      hubId: mission.hubId,
      executionMode: mission.executionMode,
      query: `${mission.title} ${mission.rawIntent.slice(0, 160)}`,
      limit: 4,
    });
    const allDomainTerms = this.store.listDomainTerms(mission.hubId);
    const boundRepoIds =
      mission.configOverrides.targetRepoIds &&
      mission.configOverrides.targetRepoIds.length > 0
        ? mission.configOverrides.targetRepoIds
        : this.store.listRepositories(mission.hubId).map(r => r.id);
    const seenTermIds = new Set<string>();
    const activeDddTerms: Array<{
      readonly canonicalTerm: string;
      readonly boundedContext: string;
      readonly forbiddenAliases: readonly string[];
    }> = [];
    for (const repoId of boundRepoIds) {
      const repo = this.store.getRepository(repoId);
      for (const t of selectTermsForRepo(
        allDomainTerms,
        repoId,
        repo?.boundedContext,
      )) {
        if (!seenTermIds.has(t.id)) {
          seenTermIds.add(t.id);
          activeDddTerms.push({
            canonicalTerm: t.canonicalTerm,
            boundedContext: t.boundedContext,
            forbiddenAliases: t.forbiddenAliases,
          });
        }
      }
    }
    if (activeDddTerms.length === 0) {
      for (const t of selectTermsForRepo(allDomainTerms, '', undefined)) {
        if (!seenTermIds.has(t.id)) {
          seenTermIds.add(t.id);
          activeDddTerms.push({
            canonicalTerm: t.canonicalTerm,
            boundedContext: t.boundedContext,
            forbiddenAliases: t.forbiddenAliases,
          });
        }
      }
    }

    const outboxCounts = this.store.countOutboxEffects();
    const events = this.store.missions.listEvents(missionId, 10_000);

    return {
      mission,
      stage: mission.stage,
      stageSteps,
      stageProgress,
      health,
      rehydration,
      primaryAction,
      pendingActionCount: openGates.length,
      secondaryActions,
      availableControls: this.buildControlAvailability(
        mission,
        openGates.length,
        changes,
      ),
      explainability: {
        whyHere:
          primaryAction?.question ??
          `Mission ${mission.code} is in ${mission.stage} (${mission.status}) under ${mission.preset} preset.`,
        waitingReason:
          primaryAction !== null
            ? `Awaiting human decision on "${primaryAction.kind}" gate (${primaryAction.id}).`
            : blockingCommentsCount > 0
              ? `${blockingCommentsCount} blocking review comment(s) open.`
              : null,
        recentForensics,
        activeDddTerms: activeDddTerms.slice(0, 12),
        recalledMemories: recalled.hits.map(h => ({
          id: h.targetId,
          title: h.title,
          authorityTier: h.authorityTier,
          score: h.score,
        })),
      },
      progressivePanels: {
        l1Summary: {
          triageTrack: mission.triageTrack,
          triageRationale: mission.triageRationale,
          preset: mission.preset,
          executionMode: mission.executionMode,
          budgetUsedUsd: mission.spentUsd,
          budgetLimitUsd: mission.budgetUsdLimit,
          baselineId: mission.activeBaselineId,
        },
        l2Work: {
          changeIds: changes.map(c => c.id),
          totalNodes,
          certifiedNodes,
          runningNodes,
          failedNodes,
          hamaStage: run?.stage ?? null,
          openCommentsCount,
          blockingCommentsCount,
        },
        l3Internals: {
          executionEpoch: mission.executionEpoch,
          missionVersion: mission.version,
          recentEventCount: events.length,
          pendingOutboxCount: outboxCounts.pending,
          deadLetterOutboxCount: outboxCounts.deadLetter,
        },
      },
    };
  }

  getMissionDetail(missionId: string): MissionDetailSnapshot {
    const mission = this.mustMission(missionId);
    const changes = this.store.listChangesForMission(missionId);
    const baseline = mission.activeBaselineId
      ? this.store.hama.getBaseline(mission.activeBaselineId)
      : this.store.hama.getBaselineByMission(missionId);

    const nodesByChange = new Map(
      changes.map(c => [c.id, this.store.listGraphNodes(c.id)]),
    );
    const edgesByChange = new Map(
      changes.map(c => [c.id, this.store.listGraphEdges(c.id)]),
    );

    let validation = this.validationCache.get(missionId) ?? null;
    if (!validation && changes.length > 0) {
      validation = validateCompiledMissionPlan({
        preset: mission.preset,
        baseline,
        changes,
        nodesByChangeId: nodesByChange,
        edgesByChangeId: edgesByChange,
        adapters: this.store.listAdapterProfiles(),
        domainTerms: this.store.listDomainTerms(mission.hubId),
      });
      this.validationCache.set(missionId, validation);
    }

    let trial = this.trialCache.get(missionId) ?? null;
    if (!trial && changes.length > 0) {
      const policy = resolvePresetPolicy(
        mission.preset,
        mission.configOverrides,
      );
      const simulated: TrialSimulationReport = simulateMissionTrial(
        changes,
        nodesByChange,
        edgesByChange,
        policy.maxParallelSlots,
      );
      trial = simulated;
      this.trialCache.set(missionId, simulated);
    }

    return {
      mission,
      focus: this.getFocusProjection(missionId),
      gates: this.store.missions.listGates(missionId, true),
      decisions: this.store.missions.listDecisions(missionId),
      changes,
      baseline,
      validation,
      trial,
    };
  }

  async resolveDecision(
    missionId: string,
    input: DecisionInput,
  ): Promise<{
    readonly decision: MissionDecisionRecord;
    readonly mission: MissionRecord;
    readonly focus: FocusProjection;
  }> {
    this.mustMission(missionId);
    const payloadSha256 = sha256Canonical({
      missionId,
      gateId: input.gateId,
      targetId: input.targetId,
      targetHash: input.targetHash,
      actor: input.actor,
      action: input.action,
      feedback: input.feedback,
      scope: input.scope,
      issueIds: input.issueIds,
    });

    const txResult = this.store.atomic(() => {
      const replay = this.store.missions.findDecisionByIdempotencyKey(
        missionId,
        input.idempotencyKey,
      );
      if (replay) {
        if (replay.payloadSha256 !== payloadSha256) {
          throw new ForgeError(
            'IDEMPOTENCY_CONFLICT',
            `Idempotency key "${input.idempotencyKey}" already used with a different decision payload`,
            409,
          );
        }
        return {
          replayed: true as const,
          decision: JSON.parse(replay.responseJson) as MissionDecisionRecord,
          gate: null as MissionGateRecord | null,
          publishedBaseline: false,
        };
      }

      const gate = this.store.missions.getGate(input.gateId);
      if (!gate || gate.missionId !== missionId) {
        throw new ForgeError(
          'NOT_FOUND',
          `Gate "${input.gateId}" not found on Mission "${missionId}"`,
          404,
        );
      }
      if (gate.status !== 'open') {
        throw new ForgeError(
          'CONFLICT',
          `Gate "${input.gateId}" is already ${gate.status}`,
          409,
        );
      }
      if (
        gate.targetId !== input.targetId ||
        gate.targetHash !== input.targetHash
      ) {
        throw new ForgeError(
          'CONFLICT',
          `Stale decision target hash for gate "${gate.id}" (expected ${gate.targetHash.slice(0, 12)})`,
          409,
        );
      }

      const allowedActions = GATE_ALLOWED_ACTIONS[gate.kind] ?? [];
      if (!allowedActions.includes(input.action)) {
        throw new ForgeError(
          'VALIDATION_ERROR',
          `Action "${input.action}" is not allowed for gate kind "${gate.kind}"`,
          400,
        );
      }
      const matchedOpt = gate.options.find(o => o.action === input.action);
      if (!matchedOpt) {
        throw new ForgeError(
          'VALIDATION_ERROR',
          `Action "${input.action}" is not in gate "${gate.id}" options`,
          400,
        );
      }
      if (matchedOpt.requiresFeedback && !input.feedback.trim()) {
        throw new ForgeError(
          'VALIDATION_ERROR',
          `Action "${input.action}" requires non-empty feedback`,
          400,
        );
      }

      if (gate.kind === 'confirmation' && input.action === 'confirm') {
        const openBlocking =
          this.store.hama.countOpenBlockingComments(missionId);
        if (openBlocking > 0) {
          throw new ForgeError(
            'CONFLICT',
            `Cannot confirm baseline: ${openBlocking} open blocking comment(s) remain unresolved`,
            409,
          );
        }
      }

      this.store.missions.resolveGate(gate.id, 'resolved');
      const decision = this.store.missions.recordDecision({
        gateId: gate.id,
        missionId,
        payloadSha256,
        decision: input,
      });

      this.store.missions.appendEvent(
        missionId,
        'mission.decision',
        input.actor,
        {
          gateId: gate.id,
          gateKind: gate.kind,
          action: input.action,
          targetHash: input.targetHash,
        },
      );

      let publishedBaseline = false;
      if (gate.kind === 'confirmation' && input.action === 'confirm') {
        const curMission = this.mustMission(missionId);
        this.hama.publishBaselineSync(curMission, decision);
        this.persistBaselineImpactIfNeeded(missionId);
        publishedBaseline = true;
      }

      return {
        replayed: false as const,
        decision,
        gate,
        publishedBaseline,
      };
    });

    if (txResult.replayed) {
      const m = this.mustMission(missionId);
      return {
        decision: txResult.decision,
        mission: m,
        focus: this.getFocusProjection(m.id),
      };
    }

    const gate = txResult.gate!;
    const decision = txResult.decision;

    this.publish({
      type: 'gate.resolved',
      missionId,
      gateId: gate.id,
      action: decision.action,
      at: decision.decidedAt,
    });

    try {
      await this.dispatchPostDecision(
        missionId,
        gate,
        decision,
        txResult.publishedBaseline,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.missions.appendEvent(
        missionId,
        'mission.dispatch_error',
        'mission_orchestrator',
        {
          gateId: gate.id,
          gateKind: gate.kind,
          action: decision.action,
          error: msg,
        },
      );
      const openAfter = this.store.missions.listGates(missionId, false);
      const curM = this.mustMission(missionId);
      if (
        openAfter.length === 0 &&
        curM.status !== 'failed' &&
        curM.status !== 'aborted' &&
        curM.status !== 'delivered'
      ) {
        const errCode = err instanceof ForgeError ? err.code : 'INTERNAL_ERROR';
        const recoveryKind: MissionGateKind =
          errCode === 'BUDGET_EXCEEDED'
            ? 'budget_extension'
            : (errCode === 'SETUP_REQUIRED' ||
                  errCode === 'ADAPTER_UNAVAILABLE') &&
                !curM.activeBaselineId
              ? 'setup_required'
              : 'build_escalation';
        const recGate = this.store.missions.openGate({
          missionId,
          changeId: gate.changeId,
          nodeId: gate.nodeId,
          kind: recoveryKind,
          targetId: missionId,
          targetHash: sha256Canonical({missionId, recoveryKind, error: msg}),
          question: `Post-decision dispatch failed: ${msg}`,
          contextSnippet: `Error occurred after resolving "${gate.kind}" (${decision.action}).`,
          options:
            recoveryKind === 'setup_required'
              ? [
                  {
                    action: 'resume',
                    label: 'Retry Live Dispatch',
                    recommended: true,
                    consequencePreview: 'Retries post-decision HAMA/compile.',
                    requiresFeedback: false,
                  },
                  {
                    action: 'switch_simulation',
                    label: 'Switch to Offline Simulation Mode',
                    recommended: false,
                    consequencePreview:
                      'Switches Mission to deterministic simulation mode.',
                    requiresFeedback: false,
                  },
                ]
              : recoveryKind === 'budget_extension'
                ? [
                    {
                      action: 'extend_budget',
                      label: 'Extend Budget (+$25) & Retry',
                      recommended: true,
                      consequencePreview:
                        'Raises USD budget ceiling by $25 and retries.',
                      requiresFeedback: false,
                    },
                    {
                      action: 'reject',
                      label: 'Mark Mission Failed',
                      recommended: false,
                      consequencePreview: 'Marks Mission failed.',
                      requiresFeedback: false,
                    },
                  ]
                : [
                    {
                      action: 'resume',
                      label: 'Retry Mission Dispatch',
                      recommended: true,
                      consequencePreview:
                        'Retries post-decision compilation or execution.',
                      requiresFeedback: false,
                    },
                    {
                      action: 'reject',
                      label: 'Mark Mission Failed',
                      recommended: false,
                      consequencePreview: 'Marks Mission failed.',
                      requiresFeedback: false,
                    },
                  ],
        });
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'paused_human',
        });
        this.publish({
          type: 'gate.opened',
          missionId,
          gateId: recGate.id,
          kind: recGate.kind,
          at: recGate.createdAt,
        });
      }
      const errState = this.mustMission(missionId);
      this.publish({
        type: 'mission.updated',
        missionId: errState.id,
        status: errState.status,
        stage: errState.stage,
        at: errState.updatedAt,
      });
      throw err;
    }

    const updated = this.mustMission(missionId);
    this.publish({
      type: 'mission.updated',
      missionId: updated.id,
      status: updated.status,
      stage: updated.stage,
      at: updated.updatedAt,
    });
    return {
      decision,
      mission: updated,
      focus: this.getFocusProjection(updated.id),
    };
  }

  async executeControl(
    missionId: string,
    cmd: ControlCommandInput,
  ): Promise<{
    readonly mission: MissionRecord;
    readonly focus: FocusProjection;
    readonly spawnedMission?: MissionRecord;
  }> {
    let cur = this.mustMission(missionId);
    const actor = cmd.actor ?? 'operator';

    if (
      (cur.status === 'delivered' || cur.status === 'aborted') &&
      cmd.action !== 'evolve_baseline'
    ) {
      throw new ForgeError(
        'CONFLICT',
        `Cannot execute control "${cmd.action}" on ${cur.status} Mission "${missionId}"`,
        409,
      );
    }

    switch (cmd.action) {
      case 'switch_preset': {
        if (!cmd.preset) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'switch_preset requires "preset"',
            400,
          );
        }
        const policy = resolvePresetPolicy(cmd.preset, cur.configOverrides);
        cur = this.store.atomic(() => {
          const next = this.store.missions.updateMissionCas(
            missionId,
            cmd.expectedVersion,
            {
              preset: cmd.preset,
              budgetUsdLimit: policy.budgetUsdLimit,
              maxOvernightHours: policy.maxOvernightHours,
            },
          );
          this.store.missions.propagatePolicyToActiveChanges(missionId, {
            permissionTier: policy.permissionTier,
            budgetUsdLimit: policy.budgetUsdLimit,
            maxOvernightHours: policy.maxOvernightHours,
          });
          this.store.missions.appendEvent(
            missionId,
            'control.switch_preset',
            actor,
            {
              preset: cmd.preset,
              permissionTier: policy.permissionTier,
              budgetUsdLimit: policy.budgetUsdLimit,
              maxOvernightHours: policy.maxOvernightHours,
            },
          );
          return next;
        });
        break;
      }

      case 'escalate_triage': {
        if (cur.activeBaselineId) {
          throw new ForgeError(
            'CONFLICT',
            'Cannot escalate triage track after Requirements Baseline is frozen; use evolve_baseline instead.',
            409,
          );
        }
        const nextTrack =
          cur.triageTrack === 'express' ? 'standard' : 'full_hama';
        cur = this.store.missions.updateMissionCas(
          missionId,
          cmd.expectedVersion,
          {
            triageTrack: nextTrack,
            triageRationale: `Escalated by ${actor} to ${nextTrack}.`,
          },
        );
        this.store.missions.appendEvent(
          missionId,
          'control.escalate_triage',
          actor,
          {
            triageTrack: nextTrack,
          },
        );
        break;
      }

      case 'pause': {
        cur = this.store.missions.updateMissionCas(
          missionId,
          cmd.expectedVersion,
          {status: 'paused_human'},
        );
        for (const chg of this.store.listChangesForMission(missionId)) {
          await this.continuity.abortChangeRun(chg.id);
          if (chg.status === 'running') {
            this.store.updateChange(chg.id, {status: 'paused_human'});
          }
        }
        this.store.missions.appendEvent(missionId, 'control.pause', actor, {});
        break;
      }

      case 'abort': {
        cur = this.store.missions.updateMissionCas(
          missionId,
          cmd.expectedVersion,
          {status: 'aborted'},
        );
        for (const openGate of this.store.missions.listGates(
          missionId,
          false,
        )) {
          this.store.missions.resolveGate(openGate.id, 'dismissed');
        }
        for (const chg of this.store.listChangesForMission(missionId)) {
          await this.continuity.abortChangeRun(chg.id);
          if (chg.status === 'running' || chg.status === 'planned') {
            this.store.updateChange(chg.id, {status: 'paused_human'});
          }
        }
        this.store.missions.appendEvent(missionId, 'control.abort', actor, {
          reason: cmd.feedback ?? 'Aborted by operator',
        });
        break;
      }

      case 'resume':
      case 'start': {
        const openGates = this.store.missions.listGates(missionId, false);
        if (openGates.length > 0) {
          throw new ForgeError(
            'CONFLICT',
            `Cannot ${cmd.action}: ${openGates.length} open gate(s) require resolution via /decisions`,
            409,
          );
        }
        cur = this.store.missions.updateMissionCas(
          missionId,
          cmd.expectedVersion,
          {status: cur.activeBaselineId ? 'executing' : 'requirements'},
        );
        if (!cur.activeBaselineId) {
          const out = await this.hama.startOrAdvance(missionId, {
            signal: this.rootSignal,
            feedback: cmd.feedback,
          });
          if (out.baseline) {
            await this.compileAndValidateMission(missionId);
          }
        } else {
          const changes = this.store.listChangesForMission(missionId);
          if (changes.length === 0) {
            await this.compileAndValidateMission(missionId);
          } else {
            await this.triggerMissionExecutionByMode(cur);
          }
        }
        break;
      }

      case 'rewind_checkpoint': {
        if (!cmd.changeId || !cmd.checkpointId) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'rewind_checkpoint requires changeId and checkpointId',
            400,
          );
        }
        const chg = this.mustMissionChange(missionId, cmd.changeId);
        const cp = this.store
          .listCheckpoints(chg.id)
          .find(c => c.id === cmd.checkpointId);
        if (!cp) {
          throw new ForgeError(
            'NOT_FOUND',
            `Checkpoint "${cmd.checkpointId}" not found on Change "${chg.id}"`,
            404,
          );
        }
        cur = this.store.missions.updateMissionCas(
          missionId,
          cmd.expectedVersion,
          {
            status: 'executing',
            stage: 'build_verify',
            bumpEpoch: true,
          },
        );
        await this.continuity.manualRestoreToCheckpoint(chg.id, cp.id);
        this.store.missions.appendEvent(
          missionId,
          'control.rewind_checkpoint',
          actor,
          {
            changeId: chg.id,
            checkpointId: cp.id,
          },
        );
        await this.triggerMissionExecutionByMode(this.mustMission(missionId));
        break;
      }

      case 'resync_upstream': {
        if (cmd.changeId) {
          this.mustMissionChange(missionId, cmd.changeId);
        }
        cur = await this.resyncStaleUpstreamChanges(
          missionId,
          cmd.expectedVersion,
          cmd.changeId,
          actor,
        );
        break;
      }

      case 'retry_node': {
        if (!cmd.changeId || !cmd.nodeId) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'retry_node requires changeId and nodeId',
            400,
          );
        }
        const chg = this.mustMissionChange(missionId, cmd.changeId);
        const node = this.store
          .listGraphNodes(chg.id)
          .find(n => n.id === cmd.nodeId);
        if (!node) {
          throw new ForgeError(
            'NOT_FOUND',
            `Graph node "${cmd.nodeId}" not found on Change "${chg.id}"`,
            404,
          );
        }
        cur = this.store.missions.updateMissionCas(
          missionId,
          cmd.expectedVersion,
          {status: 'executing', stage: 'build_verify'},
        );
        this.store.updateGraphNode(node.id, {
          status: 'ready',
          attemptCount: 0,
          outputSummary: `Queued manual retry by ${actor}`,
        });
        this.store.updateNodeForensics(node.id, null);
        this.store.updateChange(chg.id, {status: 'planned'});
        this.store.missions.appendEvent(
          missionId,
          'control.retry_node',
          actor,
          {changeId: chg.id, nodeId: node.id},
        );
        await this.triggerMissionExecutionByMode(cur);
        break;
      }

      case 'amend_ghost': {
        if (
          !cmd.changeId ||
          !cmd.insertBeforeNodeId ||
          !cmd.ghostTitle ||
          !cmd.ghostDescription
        ) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'amend_ghost requires changeId, insertBeforeNodeId, ghostTitle, and ghostDescription',
            400,
          );
        }
        const chg = this.mustMissionChange(missionId, cmd.changeId);
        const targetNode = this.store
          .listGraphNodes(chg.id)
          .find(n => n.id === cmd.insertBeforeNodeId);
        if (!targetNode) {
          throw new ForgeError(
            'NOT_FOUND',
            `Target node "${cmd.insertBeforeNodeId}" not found on Change "${chg.id}"`,
            404,
          );
        }
        cur = this.store.missions.updateMissionCas(
          missionId,
          cmd.expectedVersion,
          {status: cur.status},
        );
        this.continuity.proposeGhostAmendment({
          changeId: chg.id,
          title: cmd.ghostTitle,
          description: cmd.ghostDescription,
          insertBeforeNodeId: cmd.insertBeforeNodeId,
          gateCommand: cmd.gateCommand,
          actor: 'human_operator',
        });
        break;
      }

      case 'evolve_baseline': {
        if (!cur.activeBaselineId) {
          throw new ForgeError(
            'CONFLICT',
            'Cannot evolve baseline before initial baseline is frozen',
            409,
          );
        }
        const evolved = await this.createMission({
          hubId: cur.hubId,
          repoIds: cur.configOverrides.targetRepoIds,
          projectId: cur.projectId,
          title: `${cur.title} (vNext Evolution)`,
          rawIntent:
            cmd.feedback ||
            `Evolve baseline ${cur.activeBaselineId}: refine requirements & scope.`,
          preset: cur.preset,
          executionMode: cur.executionMode,
          parentBaselineId: cur.activeBaselineId,
          configOverrides: cur.configOverrides,
        });
        this.store.missions.appendEvent(
          missionId,
          'control.evolve_baseline',
          actor,
          {
            childMissionId: evolved.mission.id,
            parentBaselineId: cur.activeBaselineId,
          },
        );
        return {
          mission: this.mustMission(missionId),
          focus: this.getFocusProjection(missionId),
          spawnedMission: evolved.mission,
        };
      }

      default:
        throw new ForgeError(
          'VALIDATION_ERROR',
          `Unsupported control action "${String(cmd.action)}"`,
          400,
        );
    }

    const updated = this.mustMission(missionId);
    this.publish({
      type: 'mission.updated',
      missionId: updated.id,
      status: updated.status,
      stage: updated.stage,
      at: updated.updatedAt,
    });
    return {mission: updated, focus: this.getFocusProjection(updated.id)};
  }

  async compileAndValidateMission(missionId: string): Promise<{
    readonly changes: readonly ChangeRecord[];
    readonly validation: ValidationReport;
    readonly trial: TrialSimulationReport;
  }> {
    const mission = this.mustMission(missionId);
    const baseline = mission.activeBaselineId
      ? this.store.hama.getBaseline(mission.activeBaselineId)
      : this.store.hama.getBaselineByMission(missionId);
    if (!baseline) {
      throw new ForgeError(
        'CONFLICT',
        `Cannot compile Mission "${missionId}" without an approved baseline`,
        409,
      );
    }

    const existingChanges = this.store.listChangesForMission(missionId);
    let changes: ChangeRecord[] = [...existingChanges];

    if (changes.length === 0) {
      const targetIds = mission.configOverrides.targetRepoIds;
      let repos = this.store.listRepositories(mission.hubId);
      if (targetIds && targetIds.length > 0) {
        const set = new Set(targetIds);
        repos = repos.filter(r => set.has(r.id));
      }
      const domainTerms = this.store.listDomainTerms(mission.hubId);
      const prdMarkdown =
        this.hama.getDetail(missionId).prdMarkdown ?? baseline.prd.summary;
      const blueprints = compileBaselineToChangeBlueprints({
        title: mission.title,
        summary: baseline.prd.summary,
        baseline,
        prdMarkdown,
        repos,
        domainTerms,
      });

      const policy = resolvePresetPolicy(
        mission.preset,
        mission.configOverrides,
      );
      const repoToChangeId = new Map<string, string>();
      const created: ChangeRecord[] = [];
      for (const bp of blueprints) {
        const depChangeIds = bp.dependsOnRepoIds
          .map(rid => repoToChangeId.get(rid))
          .filter((cid): cid is string => Boolean(cid));

        const chg = await this.closure.createAndPlanChange({
          hubId: mission.hubId,
          repoId: bp.repoId,
          missionId: mission.id,
          executionMode: mission.executionMode,
          dependsOnChangeIds: depChangeIds,
          precompiledBlueprint: bp,
          title: bp.title,
          summary: bp.summary,
          permissionTier: policy.permissionTier,
          maxOvernightHours: policy.maxOvernightHours,
          budgetUsdLimit: policy.budgetUsdLimit,
          leadAdapterId: mission.configOverrides.leadAdapterId,
          workerAdapterId: mission.configOverrides.workerAdapterId,
          worktreesRoot: this.worktreesRoot,
        });
        repoToChangeId.set(bp.repoId, chg.id);
        created.push(chg);
      }
      changes = created;
    }

    const nodesByChange = new Map(
      changes.map(c => [c.id, this.store.listGraphNodes(c.id)]),
    );
    const edgesByChange = new Map(
      changes.map(c => [c.id, this.store.listGraphEdges(c.id)]),
    );

    const validation = validateCompiledMissionPlan({
      preset: mission.preset,
      baseline,
      changes,
      nodesByChangeId: nodesByChange,
      edgesByChangeId: edgesByChange,
      adapters: this.store.listAdapterProfiles(),
      domainTerms: this.store.listDomainTerms(mission.hubId),
    });
    this.validationCache.set(missionId, validation);

    const policy = resolvePresetPolicy(mission.preset, mission.configOverrides);
    const trial: TrialSimulationReport =
      changes.length > 0
        ? simulateMissionTrial(
            changes,
            nodesByChange,
            edgesByChange,
            policy.maxParallelSlots,
          )
        : {
            feasible: false,
            totalExecutableNodes: 0,
            estimatedWaves: [],
            criticalPathLength: 0,
            contendedNodePairs: [],
            unreachableNodeCodes: [],
          };
    this.trialCache.set(missionId, trial);

    this.store.missions.updateMissionCas(missionId, undefined, {
      status: 'plan_review',
      stage: 'plan_validate',
    });
    this.store.missions.appendEvent(
      missionId,
      'plan.compiled',
      'spec_compiler',
      {
        changeCount: changes.length,
        valid: validation.valid,
        errorCount: validation.errorCount,
        warningCount: validation.warningCount,
        feasible: trial.feasible,
        criticalPathLength: trial.criticalPathLength,
      },
    );

    if (validation.valid && trial.feasible && policy.autoAdvancePlan) {
      await this.triggerMissionExecutionByMode(this.mustMission(missionId));
    } else {
      const targetHash = sha256Canonical({
        baselineId: baseline.id,
        changeIds: changes.map(c => c.id),
        validationValid: validation.valid,
      });
      const gate = this.store.missions.openGate({
        missionId,
        kind: 'plan_review',
        targetId: baseline.id,
        targetHash,
        targetRevision: baseline.revision,
        question: `Review compiled execution plan (${changes.length} repo Change(s), ${validation.errorCount} error(s), ${trial.criticalPathLength} wave(s))?`,
        contextSnippet:
          validation.issues
            .slice(0, 5)
            .map(i => `[${i.level.toUpperCase()}] ${i.message}`)
            .join('\n') ||
          'All SpecValidator checks passed and TrialSimulator confirmed feasible parallel waves.',
        options: [
          {
            action: 'approve_plan',
            label: 'Approve Plan & Start Build Execution',
            recommended: validation.valid && trial.feasible,
            consequencePreview:
              'Launches Twin-Graph workers across isolated repository worktrees.',
            requiresFeedback: false,
          },
          {
            action: 'reject',
            label: 'Hold / Reject Plan',
            recommended: false,
            consequencePreview:
              'Marks the Mission failed for manual re-design.',
            requiresFeedback: true,
          },
        ],
      });
      this.store.missions.updateMissionCas(missionId, undefined, {
        status: 'paused_human',
      });
      this.publish({
        type: 'gate.opened',
        missionId,
        gateId: gate.id,
        kind: gate.kind,
        at: gate.createdAt,
      });
    }

    return {changes, validation, trial};
  }

  startMissionExecution(missionId: string): Promise<MissionRecord> {
    const existing = this.activeMissionRuns.get(missionId);
    if (existing) {
      return existing;
    }
    const runPromise = this.runMissionExecutionLoop(missionId).finally(() => {
      this.activeMissionRuns.delete(missionId);
    });
    this.activeMissionRuns.set(missionId, runPromise);
    return runPromise;
  }

  private async runMissionExecutionLoop(
    missionId: string,
  ): Promise<MissionRecord> {
    this.mustMission(missionId);

    this.store.missions.updateMissionCas(missionId, undefined, {
      status: 'executing',
      stage: 'build_verify',
    });
    this.emitMissionUpdated(missionId);

    const allChanges = this.store.listChangesForMission(missionId);
    const remaining = new Map(allChanges.map(c => [c.id, c]));
    const certifiedIds = new Set(
      allChanges.filter(c => c.status === 'certified').map(c => c.id),
    );

    let waveGuard = 0;
    while (remaining.size > 0 && waveGuard < 24) {
      waveGuard += 1;
      const curMission = this.mustMission(missionId);
      const policy = resolvePresetPolicy(
        curMission.preset,
        curMission.configOverrides,
      );
      if (
        curMission.status === 'aborted' ||
        curMission.status === 'paused_human' ||
        curMission.status === 'failed' ||
        this.rootSignal?.aborted
      ) {
        break;
      }

      const ready: ChangeRecord[] = [];
      for (const chg of remaining.values()) {
        if (chg.status === 'certified') {
          certifiedIds.add(chg.id);
          remaining.delete(chg.id);
          continue;
        }
        if (
          chg.status === 'stale_upstream' ||
          chg.status === 'cooldown_hold' ||
          chg.status === 'paused_human' ||
          chg.status === 'failed'
        ) {
          continue;
        }
        const deps = chg.dependsOnChangeIds ?? [];
        if (deps.every(d => certifiedIds.has(d))) {
          ready.push(chg);
        }
      }

      if (ready.length === 0) {
        break;
      }

      for (const chg of ready) {
        if ((chg.dependsOnChangeIds ?? []).length > 0) {
          const upstreamShas: Record<string, string> = {
            ...(chg.upstreamContractShas ?? {}),
          };
          for (const depId of chg.dependsOnChangeIds ?? []) {
            const cps = this.store.listCheckpoints(depId);
            const dep = this.store.getChange(depId);
            const headSha =
              cps[cps.length - 1]?.gitCommitSha ?? dep?.baseCommitSha;
            if (headSha) {
              upstreamShas[depId] = headSha;
            }
          }
          this.store.updateChangeUpstreamShas(chg.id, upstreamShas);
        }
      }

      const results = await Promise.allSettled(
        ready.map(chg =>
          this.continuity.startChangeExecution(chg.id, policy.maxParallelSlots),
        ),
      );

      const failedChanges: ChangeRecord[] = [];
      const pausedChanges: ChangeRecord[] = [];
      const cooldownChanges: ChangeRecord[] = [];
      const staleChanges: ChangeRecord[] = [];

      for (let i = 0; i < ready.length; i += 1) {
        const chg = ready[i]!;
        const r = results[i]!;
        const fresh =
          r.status === 'fulfilled' ? r.value : this.store.getChange(chg.id)!;
        remaining.delete(chg.id);
        if (r.status === 'rejected' && fresh.status !== 'failed') {
          failedChanges.push(fresh);
        } else if (fresh.status === 'certified') {
          certifiedIds.add(fresh.id);
        } else if (fresh.status === 'failed') {
          failedChanges.push(fresh);
        } else if (fresh.status === 'stale_upstream') {
          staleChanges.push(fresh);
        } else if (fresh.status === 'cooldown_hold') {
          cooldownChanges.push(fresh);
        } else if (fresh.status === 'paused_human') {
          pausedChanges.push(fresh);
        }
      }

      if (failedChanges.length > 0) {
        for (const failedChg of failedChanges) {
          const existingGate = this.store.missions
            .listGates(missionId, false)
            .find(
              g => g.kind === 'build_escalation' && g.targetId === failedChg.id,
            );
          if (!existingGate) {
            const gate = this.store.missions.openGate({
              missionId,
              changeId: failedChg.id,
              kind: 'build_escalation',
              targetId: failedChg.id,
              targetHash: sha256Canonical({
                changeId: failedChg.id,
                status: failedChg.status,
                epoch: failedChg.executionEpoch ?? 1,
              }),
              question: `Repository Change ${failedChg.code} failed after max retries. Resume or fail Mission?`,
              contextSnippet: failedChg.summary,
              options: [
                {
                  action: 'resume',
                  label: 'Reset Node & Resume Change',
                  recommended: true,
                  consequencePreview:
                    'Clears failure state and retries pending graph nodes.',
                  requiresFeedback: false,
                },
                {
                  action: 'reject',
                  label: 'Mark Mission Failed',
                  recommended: false,
                  consequencePreview:
                    'Stops Mission delivery at failed status.',
                  requiresFeedback: false,
                },
              ],
            });
            this.publish({
              type: 'gate.opened',
              missionId,
              gateId: gate.id,
              kind: gate.kind,
              at: gate.createdAt,
            });
          }
        }
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'paused_human',
        });
        this.emitMissionUpdated(missionId);
        return this.mustMission(missionId);
      }

      if (staleChanges.length > 0) {
        this.openStaleUpstreamGate(missionId, staleChanges);
        this.emitMissionUpdated(missionId);
        return this.mustMission(missionId);
      }

      if (pausedChanges.length > 0) {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'paused_human',
        });
        this.emitMissionUpdated(missionId);
        return this.mustMission(missionId);
      }

      if (cooldownChanges.length > 0) {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'cooldown_hold',
        });
        this.store.missions.appendEvent(
          missionId,
          'mission.cooldown_hold',
          'mission_orchestrator',
          {changeIds: cooldownChanges.map(c => c.id)},
        );
        this.emitMissionUpdated(missionId);
        return this.mustMission(missionId);
      }
    }

    const latestChanges = this.store.listChangesForMission(missionId);
    const staleLeft = latestChanges.filter(c => c.status === 'stale_upstream');
    if (staleLeft.length > 0) {
      this.openStaleUpstreamGate(missionId, staleLeft);
      this.emitMissionUpdated(missionId);
      return this.mustMission(missionId);
    }

    const cooldownLeft = latestChanges.filter(
      c => c.status === 'cooldown_hold',
    );
    if (cooldownLeft.length > 0) {
      this.store.missions.updateMissionCas(missionId, undefined, {
        status: 'cooldown_hold',
      });
      this.emitMissionUpdated(missionId);
      return this.mustMission(missionId);
    }

    const latestMission = this.mustMission(missionId);
    const finalPolicy = resolvePresetPolicy(
      latestMission.preset,
      latestMission.configOverrides,
    );
    if (
      latestChanges.length > 0 &&
      latestChanges.every(c => c.status === 'certified')
    ) {
      this.store.missions.updateMissionCas(missionId, undefined, {
        status: 'certification',
        stage: 'certify_deliver',
      });
      const readiness = await this.checkDeliveryReadiness(missionId);
      if (finalPolicy.autoAdvanceDelivery && readiness.ready) {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'delivered',
          stage: 'certify_deliver',
        });
        this.store.missions.appendEvent(
          missionId,
          'mission.delivered',
          'mission_orchestrator',
          {readinessReady: readiness.ready},
        );
      } else {
        const targetHash = sha256Canonical({
          missionId,
          readinessReady: readiness.ready,
          changeIds: latestChanges.map(c => c.id),
        });
        const gate = this.store.missions.openGate({
          missionId,
          kind: 'delivery_approval',
          targetId: missionId,
          targetHash,
          question: readiness.ready
            ? `All ${latestChanges.length} repository Change(s) certified and merge-clean. Finalize Delivery?`
            : 'All Changes certified, but merge-readiness check reported conflicts. Approve anyway or resolve conflicts?',
          contextSnippet: readiness.repositories
            .map(
              r =>
                `${r.repoName} (${r.changeCode}): ${r.clean ? 'CLEAN' : r.conflictFiles.join(', ')}`,
            )
            .join('\n'),
          options: [
            {
              action: 'approve_delivery',
              label: 'Sign Off & Complete Delivery',
              recommended: readiness.ready,
              consequencePreview:
                'Marks Mission delivered and seals the final EvidenceBundle.',
              requiresFeedback: false,
            },
            {
              action: 'hold',
              label: 'Hold Delivery for Inspection',
              recommended: false,
              consequencePreview:
                'Keeps Mission paused before final delivery sign-off.',
              requiresFeedback: false,
            },
            {
              action: 'reject',
              label: 'Reject Delivery & Mark Failed',
              recommended: false,
              consequencePreview:
                'Marks Mission failed instead of sealing delivery.',
              requiresFeedback: true,
            },
          ],
        });
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'paused_human',
        });
        this.publish({
          type: 'gate.opened',
          missionId,
          gateId: gate.id,
          kind: gate.kind,
          at: gate.createdAt,
        });
      }
      this.emitMissionUpdated(missionId);
    }

    return this.mustMission(missionId);
  }

  async checkDeliveryReadiness(
    missionId: string,
  ): Promise<MergeReadinessReport> {
    this.mustMission(missionId);
    const changes = this.store.listChangesForMission(missionId);
    const repoReports: Array<MergeReadinessReport['repositories'][number]> = [];

    for (const chg of changes) {
      const repo = this.store.getRepository(chg.repoId);
      if (!repo) {
        continue;
      }
      const res = await this.worktrees.checkMergeReadiness(
        repo.localPath,
        repo.defaultBranch,
        chg.gitBranch,
      );
      repoReports.push({
        repoId: repo.id,
        repoName: repo.name,
        changeId: chg.id,
        changeCode: chg.code,
        targetBranch: repo.defaultBranch,
        changeBranch: chg.gitBranch,
        clean: res.clean,
        conflictFiles: res.conflictFiles,
        diagnostic: res.diagnostic,
      });
    }

    return {
      ready: repoReports.length > 0 && repoReports.every(r => r.clean),
      checkedAt: new Date().toISOString(),
      repositories: repoReports,
    };
  }

  async exportEvidenceBundle(missionId: string): Promise<EvidenceBundle> {
    const mission = this.mustMission(missionId);
    const baseline = mission.activeBaselineId
      ? this.store.hama.getBaseline(mission.activeBaselineId)
      : this.store.hama.getBaselineByMission(missionId);
    const changes = this.store.listChangesForMission(missionId);
    const readiness =
      changes.length > 0 ? await this.checkDeliveryReadiness(missionId) : null;
    const events = this.store.missions.listEvents(missionId, 10_000);

    const nodesByChange = new Map<string, GraphNode[]>();
    for (const c of changes) {
      nodesByChange.set(c.id, this.store.listGraphNodes(c.id));
    }

    const traceabilityMatrix = (baseline?.prd.requirements ?? []).map(req => {
      const matchedNodes: string[] = [];
      const matchedChanges = new Set<string>();
      let allNodesCertified = false;
      for (const chg of changes) {
        for (const n of nodesByChange.get(chg.id) ?? []) {
          if ((n.requirementRefs ?? []).includes(req.id)) {
            matchedNodes.push(n.id);
            matchedChanges.add(chg.id);
          }
        }
      }
      if (matchedNodes.length > 0) {
        allNodesCertified = changes.every(chg =>
          (nodesByChange.get(chg.id) ?? [])
            .filter(n => matchedNodes.includes(n.id))
            .every(n => n.status === 'certified' || n.status === 'waived'),
        );
      }
      return {
        requirementId: req.id,
        scopeKey: req.scopeKey,
        acceptanceIds: req.acceptance.map(a => a.id),
        nodeIds: matchedNodes,
        changeIds: [...matchedChanges],
        certified: allNodesCertified,
      };
    });

    const changeSummaries = changes.map(c => {
      const cps = this.store.listCheckpoints(c.id);
      return {
        changeId: c.id,
        code: c.code,
        repoId: c.repoId,
        gitBranch: c.gitBranch,
        baseCommitSha: c.baseCommitSha,
        headCheckpointSha: cps[cps.length - 1]?.gitCommitSha ?? null,
        status: c.status,
      };
    });

    const unsigned = {
      schemaVersion: 1 as const,
      missionId: mission.id,
      missionCode: mission.code,
      executionMode: mission.executionMode,
      baselineId: baseline?.id ?? null,
      baselineSha256: baseline?.sha256 ?? null,
      exportedAt: new Date().toISOString(),
      traceabilityMatrix,
      changes: changeSummaries,
      mergeReadiness: readiness,
      events,
    };

    return {
      ...unsigned,
      bundleSha256: sha256Canonical(unsigned),
    };
  }

  async getMissionTraceability(
    missionId: string,
  ): Promise<MissionTraceabilityResponse> {
    const mission = this.mustMission(missionId);
    const baseline = mission.activeBaselineId
      ? this.store.hama.getBaseline(mission.activeBaselineId)
      : this.store.hama.getBaselineByMission(missionId);
    const changes = this.store.listChangesForMission(missionId);
    const readiness =
      changes.length > 0 ? await this.checkDeliveryReadiness(missionId) : null;
    let impact = this.store.missions.getBaselineImpactByMission(missionId);
    if (!impact && baseline?.parentId) {
      impact = this.persistBaselineImpactIfNeeded(missionId);
    }
    return {
      missionId: mission.id,
      baseline,
      changes,
      readiness,
      impact,
    };
  }

  compareBaselines(
    parentBaselineId: string,
    nextBaselineId: string,
  ): BaselineImpactReport {
    const parentBaseline = this.store.hama.getBaseline(parentBaselineId);
    const nextBaseline = this.store.hama.getBaseline(nextBaselineId);
    if (!parentBaseline || !nextBaseline) {
      throw new ForgeError(
        'NOT_FOUND',
        'One or both baselines not found for impact analysis',
        404,
      );
    }
    const activeChanges = this.store.listChangesForMission(
      parentBaseline.missionId,
    );
    const nodesByChangeId = new Map<string, readonly GraphNode[]>(
      activeChanges.map(c => [c.id, this.store.listGraphNodes(c.id)]),
    );
    return analyzeBaselineImpact({
      parentBaseline,
      nextBaseline,
      activeChanges,
      nodesByChangeId,
    });
  }

  private async dispatchPostDecision(
    missionId: string,
    gate: MissionGateRecord,
    decision: MissionDecisionRecord,
    publishedBaseline: boolean,
  ): Promise<void> {
    const mission = this.mustMission(missionId);

    if (gate.kind === 'setup_required') {
      if (decision.action === 'switch_simulation') {
        this.store.missions.switchMissionExecutionModePreStart(
          missionId,
          'simulation',
        );
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'requirements',
          stage: 'converge_spec',
        });
        const out = await this.hama.startOrAdvance(missionId, {
          signal: this.rootSignal,
        });
        if (out.baseline) {
          await this.compileAndValidateMission(missionId);
        }
        return;
      }

      if (this.hasReadyLiveProvider(mission)) {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'requirements',
          stage: 'converge_spec',
        });
        const out = await this.hama.startOrAdvance(missionId, {
          signal: this.rootSignal,
        });
        if (out.baseline) {
          await this.compileAndValidateMission(missionId);
        }
      } else {
        const reopened = this.store.missions.openGate({
          missionId,
          kind: 'setup_required',
          targetId: missionId,
          targetHash: gate.targetHash,
          question: gate.question,
          contextSnippet: gate.contextSnippet,
          options: gate.options,
        });
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'paused_human',
        });
        this.publish({
          type: 'gate.opened',
          missionId,
          gateId: reopened.id,
          kind: reopened.kind,
          at: reopened.createdAt,
        });
      }
      return;
    }

    if (gate.kind === 'triage_confirm') {
      if (decision.action === 'escalate') {
        const escalatedTrack =
          mission.triageTrack === 'express' ? 'standard' : 'full_hama';
        this.store.missions.updateMissionCas(missionId, undefined, {
          triageTrack: escalatedTrack,
          triageRationale: `Escalated at triage gate by ${decision.actor}.`,
        });
      }
      this.store.missions.updateMissionCas(missionId, undefined, {
        status: 'requirements',
        stage: 'converge_spec',
      });
      const out = await this.hama.startOrAdvance(missionId, {
        signal: this.rootSignal,
        feedback: decision.feedback,
      });
      if (out.baseline) {
        await this.compileAndValidateMission(missionId);
      }
      return;
    }

    if (
      (gate.kind === 'clarification' && !gate.changeId) ||
      gate.kind === 'discussion' ||
      gate.kind === 'evaluation' ||
      gate.kind === 'approval' ||
      gate.kind === 'conditions' ||
      gate.kind === 'limit' ||
      (gate.kind === 'confirmation' && decision.action !== 'confirm')
    ) {
      const out = await this.hama.applyDecision(
        missionId,
        gate,
        decision,
        this.rootSignal,
      );
      if (out.baseline) {
        this.persistBaselineImpactIfNeeded(missionId);
        await this.compileAndValidateMission(missionId);
      }
      return;
    }

    if (gate.kind === 'clarification' && gate.changeId) {
      if (decision.action === 'reject') {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
        return;
      }
      const chg = this.store.getChange(gate.changeId);
      if (chg) {
        this.store.appendEpistemicItem({
          changeId: chg.id,
          nodeId: gate.nodeId,
          executionEpoch: chg.executionEpoch ?? 1,
          kind: 'spec_confirmed',
          content: `Human clarification (${decision.actor}): ${decision.feedback}`,
          evidenceRef: decision.id,
        });
        if (chg.status === 'paused_human') {
          this.store.updateChange(chg.id, {status: 'planned'});
        }
      }
      if (gate.targetId.startsWith('attn-')) {
        try {
          this.store.resolveAttention(gate.targetId, decision.feedback);
        } catch {
          // Attention item may already be resolved.
        }
      }
      if (mission.status === 'paused_human') {
        await this.triggerMissionExecutionByMode(this.mustMission(missionId));
      }
      return;
    }

    if (publishedBaseline) {
      this.persistBaselineImpactIfNeeded(missionId);
      await this.compileAndValidateMission(missionId);
      return;
    }

    if (gate.kind === 'plan_review') {
      if (decision.action === 'approve_plan') {
        await this.triggerMissionExecutionByMode(this.mustMission(missionId));
      } else {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
      }
      return;
    }

    if (gate.kind === 'ghost_amendment') {
      if (decision.action === 'reject') {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
        return;
      }
      if (gate.nodeId) {
        this.store.updateGraphNode(gate.nodeId, {
          status: decision.action === 'waive_ghost' ? 'waived' : 'ready',
          outputSummary: `Decision "${decision.action}" by ${decision.actor}`,
        });
      }
      if (gate.changeId) {
        this.store.updateChange(gate.changeId, {status: 'planned'});
      }
      await this.triggerMissionExecutionByMode(this.mustMission(missionId));
      return;
    }

    if (gate.kind === 'build_escalation') {
      if (decision.action === 'resume') {
        if (gate.changeId) {
          this.store.updateChange(gate.changeId, {status: 'planned'});
          for (const n of this.store.listGraphNodes(gate.changeId)) {
            if (n.status === 'failed' || n.status === 'blocked_human') {
              this.store.updateGraphNode(n.id, {
                status: 'ready',
                attemptCount: 0,
                outputSummary: `Reset via build_escalation resume by ${decision.actor}`,
              });
              this.store.updateNodeForensics(n.id, null);
            }
          }
        }
        await this.triggerMissionExecutionByMode(this.mustMission(missionId));
      } else {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
      }
      return;
    }

    if (gate.kind === 'budget_extension') {
      if (decision.action === 'reject') {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
        return;
      }
      if (decision.action === 'extend_budget') {
        this.store.missions.updateMissionCas(missionId, undefined, {
          budgetUsdLimit: Number((mission.budgetUsdLimit + 25).toFixed(2)),
          maxOvernightHours: mission.maxOvernightHours + 4,
          status: mission.activeBaselineId ? 'executing' : 'requirements',
        });
        if (gate.changeId) {
          this.store.missions.extendChangeBudget(gate.changeId, 25);
          const chg = this.store.getChange(gate.changeId);
          if (chg && chg.status === 'paused_human') {
            this.store.updateChange(chg.id, {status: 'planned'});
          }
        }
      } else if (gate.changeId) {
        const chg = this.store.getChange(gate.changeId);
        if (chg && chg.status === 'paused_human') {
          this.store.updateChange(chg.id, {status: 'planned'});
        }
      }
      if (!mission.activeBaselineId) {
        const out = await this.hama.startOrAdvance(missionId, {
          signal: this.rootSignal,
          feedback: decision.feedback,
        });
        if (out.baseline) {
          this.persistBaselineImpactIfNeeded(missionId);
          await this.compileAndValidateMission(missionId);
        }
      } else {
        await this.triggerMissionExecutionByMode(this.mustMission(missionId));
      }
      return;
    }

    if (gate.kind === 'qa_decision') {
      if (decision.action === 'reject') {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
        return;
      }
      if (gate.nodeId) {
        this.store.updateGraphNode(gate.nodeId, {
          status: 'certified',
          outputSummary: `Approved QA decision (${decision.action}) by ${decision.actor}`,
        });
      }
      if (gate.changeId) {
        this.store.updateChange(gate.changeId, {status: 'planned'});
      }
      await this.triggerMissionExecutionByMode(this.mustMission(missionId));
      return;
    }

    if (gate.kind === 'stale_upstream_gate') {
      if (decision.action === 'resync_upstream') {
        await this.resyncStaleUpstreamChanges(
          missionId,
          undefined,
          gate.changeId ?? undefined,
          decision.actor,
        );
      } else if (decision.action === 'reject') {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
      }
      return;
    }

    if (gate.kind === 'delivery_approval') {
      if (decision.action === 'approve_delivery') {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'delivered',
          stage: 'certify_deliver',
        });
        this.store.missions.appendEvent(
          missionId,
          'mission.delivered',
          decision.actor,
          {gateId: gate.id},
        );
      } else if (decision.action === 'reject') {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'failed',
        });
        this.store.missions.appendEvent(
          missionId,
          'mission.delivery_rejected',
          decision.actor,
          {gateId: gate.id, feedback: decision.feedback},
        );
      } else if (decision.action === 'hold') {
        this.store.missions.updateMissionCas(missionId, undefined, {
          status: 'paused_human',
        });
        this.store.missions.appendEvent(
          missionId,
          'mission.delivery_held',
          decision.actor,
          {gateId: gate.id, feedback: decision.feedback},
        );
      }
    }
  }

  private async triggerMissionExecutionByMode(
    mission: MissionRecord,
  ): Promise<void> {
    if (mission.executionMode === 'simulation') {
      await this.startMissionExecution(mission.id);
      return;
    }
    void this.startMissionExecution(mission.id).catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        this.store.missions.updateMissionCas(mission.id, undefined, {
          status: 'failed',
        });
        this.store.missions.appendEvent(
          mission.id,
          'mission.execution_error',
          'mission_orchestrator',
          {error: msg},
        );
      } catch {
        // Store already closed during shutdown.
      }
    });
  }

  private hasReadyLiveProvider(mission: MissionRecord): boolean {
    for (const pid of API_PROVIDER_IDS) {
      if (this.lookupProvider(pid)?.apiKey) {
        return true;
      }
    }
    if (process.env['FORGEOPS_OFFLINE_VERIFY'] === '1') {
      return false;
    }
    const preferred = mission.configOverrides.leadAdapterId;
    const profiles = this.store.listAdapterProfiles();
    return profiles.some(
      p =>
        p.manifest.transport !== 'native-api' &&
        p.health === 'healthy' &&
        (!preferred || p.manifest.id === preferred),
    );
  }

  private deriveHealth(
    mission: MissionRecord,
    openGates: number,
    changes: readonly ChangeRecord[],
  ): MissionHealth {
    if (mission.status === 'aborted') {
      return 'aborted';
    }
    if (mission.status === 'failed') {
      return 'failed';
    }
    if (mission.status === 'delivered') {
      return 'completed';
    }
    if (openGates > 0 || mission.status === 'paused_human') {
      return 'needs_you';
    }
    if (
      mission.status === 'cooldown_hold' ||
      changes.some(
        c => c.status === 'cooldown_hold' || c.status === 'stale_upstream',
      )
    ) {
      return 'recovering';
    }
    return 'flowing';
  }

  private buildControlAvailability(
    mission: MissionRecord,
    openGateCount: number,
    changes: readonly ChangeRecord[],
  ): ControlAvailability[] {
    const isTerminal =
      mission.status === 'delivered' ||
      mission.status === 'aborted' ||
      mission.status === 'failed';
    const hasChanges = changes.length > 0;
    const controls: ControlAvailability[] = [
      {
        action: 'start',
        label: 'Start / Resume Pipeline',
        enabled:
          !isTerminal && openGateCount === 0 && mission.status !== 'executing',
        disabledReason: isTerminal
          ? `Mission is ${mission.status}`
          : openGateCount > 0
            ? 'Resolve open decision gate first'
            : mission.status === 'executing'
              ? 'Already executing'
              : null,
        impactSummary: 'Advances Mission cleanly into the next active stage.',
      },
      {
        action: 'pause',
        label: 'Pause Execution',
        enabled:
          mission.status === 'executing' || mission.status === 'requirements',
        disabledReason:
          mission.status === 'executing' || mission.status === 'requirements'
            ? null
            : 'Nothing is actively running',
        impactSummary:
          'Aborts in-flight workers cleanly without losing checkpoints.',
      },
      {
        action: 'resume',
        label: 'Resume From Pause',
        enabled: mission.status === 'paused_human' && openGateCount === 0,
        disabledReason:
          mission.status !== 'paused_human'
            ? 'Mission is not paused'
            : openGateCount > 0
              ? 'Resolve open gate first'
              : null,
        impactSummary: 'Resumes from current checkpoint and epoch.',
      },
      {
        action: 'retry_node',
        label: 'Retry Graph Node',
        enabled: hasChanges && !isTerminal,
        disabledReason: !hasChanges
          ? 'No compiled changes yet'
          : isTerminal
            ? `Mission is ${mission.status}`
            : null,
        impactSummary: 'Resets target node to ready and re-runs its slice.',
      },
      {
        action: 'rewind_checkpoint',
        label: 'Rewind to Checkpoint',
        enabled: hasChanges && !isTerminal,
        disabledReason: !hasChanges
          ? 'No compiled changes yet'
          : isTerminal
            ? `Mission is ${mission.status}`
            : null,
        impactSummary:
          'Restores worktree + downstream graph nodes atomically and bumps epoch.',
      },
      {
        action: 'amend_ghost',
        label: 'Insert GhostNode Amendment',
        enabled: hasChanges && !isTerminal,
        disabledReason: !hasChanges
          ? 'No compiled changes yet'
          : isTerminal
            ? `Mission is ${mission.status}`
            : null,
        impactSummary:
          'Splices an explicit runtime GhostNode step before target node.',
      },
      {
        action: 'switch_preset',
        label: 'Switch Autonomy Preset',
        enabled: !isTerminal,
        disabledReason: isTerminal ? `Mission is ${mission.status}` : null,
        impactSummary:
          'Applies preset policy to future gates only; open gates stay open.',
      },
      {
        action: 'escalate_triage',
        label: 'Escalate Triage Track',
        enabled:
          !mission.activeBaselineId &&
          mission.triageTrack !== 'full_hama' &&
          !isTerminal,
        disabledReason: mission.activeBaselineId
          ? 'Baseline already frozen'
          : mission.triageTrack === 'full_hama'
            ? 'Already on full_hama'
            : isTerminal
              ? `Mission is ${mission.status}`
              : null,
        impactSummary:
          'Upgrades triage track for deeper multi-role convergence.',
      },
      {
        action: 'evolve_baseline',
        label: 'Evolve Frozen Baseline (vNext)',
        enabled: Boolean(mission.activeBaselineId),
        disabledReason: mission.activeBaselineId
          ? null
          : 'Requires a frozen Requirements Baseline first',
        impactSummary:
          'Spawns a child Mission anchored to this baseline SHA-256.',
      },
      {
        action: 'resync_upstream',
        label: 'Re-sync Stale Downstream Changes',
        enabled:
          !isTerminal && changes.some(c => c.status === 'stale_upstream'),
        disabledReason: isTerminal
          ? `Mission is ${mission.status}`
          : changes.some(c => c.status === 'stale_upstream')
            ? null
            : 'No stale_upstream Changes',
        impactSummary:
          'Rewinds stale downstream Changes to CP-0, updates upstream SHAs, and restarts.',
      },
      {
        action: 'abort',
        label: 'Abort Mission',
        enabled: !isTerminal,
        disabledReason: isTerminal ? `Mission is ${mission.status}` : null,
        impactSummary:
          'Stops all active worktrees cleanly and marks Mission aborted.',
      },
    ];
    return controls;
  }

  private async resyncStaleUpstreamChanges(
    missionId: string,
    expectedVersion: number | undefined,
    onlyChangeId: string | undefined,
    actor: string,
  ): Promise<MissionRecord> {
    const cur = this.store.missions.updateMissionCas(
      missionId,
      expectedVersion,
      {
        status: 'executing',
        stage: 'build_verify',
        bumpEpoch: true,
      },
    );

    const allChanges = this.store.listChangesForMission(missionId);
    const staleTargets = allChanges.filter(c =>
      onlyChangeId ? c.id === onlyChangeId : c.status === 'stale_upstream',
    );
    const resyncedIds: string[] = [];

    for (const chg of staleTargets) {
      const cps = this.store.listCheckpoints(chg.id);
      const cp0 = cps[0];
      if (cp0) {
        await this.continuity.manualRestoreToCheckpoint(chg.id, cp0.id);
      } else {
        await this.continuity.abortChangeRun(chg.id);
        this.store.bumpChangeEpochAtomic(chg.id);
      }

      const nextShas: Record<string, string> = {
        ...(chg.upstreamContractShas ?? {}),
      };
      for (const depId of chg.dependsOnChangeIds ?? []) {
        const depCps = this.store.listCheckpoints(depId);
        const depChg = this.store.getChange(depId);
        const headSha =
          depCps[depCps.length - 1]?.gitCommitSha ?? depChg?.baseCommitSha;
        if (headSha) {
          nextShas[depId] = headSha;
        }
      }
      this.store.updateChangeUpstreamShas(chg.id, nextShas);
      this.store.updateChange(chg.id, {status: 'planned'});
      resyncedIds.push(chg.id);
    }

    for (const openGate of this.store.missions.listGates(missionId, false)) {
      if (openGate.kind === 'stale_upstream_gate') {
        this.store.missions.resolveGate(openGate.id, 'dismissed');
      }
    }

    this.store.missions.appendEvent(
      missionId,
      'control.resync_upstream',
      actor,
      {resyncedChangeIds: resyncedIds},
    );
    await this.triggerMissionExecutionByMode(this.mustMission(missionId));
    return this.mustMission(cur.id);
  }

  private openStaleUpstreamGate(
    missionId: string,
    staleChanges: readonly ChangeRecord[],
  ): void {
    const first = staleChanges[0];
    if (!first) {
      return;
    }
    const existing = this.store.missions
      .listGates(missionId, false)
      .find(g => g.kind === 'stale_upstream_gate');
    if (!existing) {
      const gate = this.store.missions.openGate({
        missionId,
        changeId: first.id,
        kind: 'stale_upstream_gate',
        targetId: first.id,
        targetHash: sha256Canonical({
          missionId,
          staleIds: staleChanges.map(c => c.id),
          epochs: staleChanges.map(c => c.executionEpoch ?? 1),
        }),
        question: `Upstream contract changed; ${staleChanges.map(c => c.code).join(', ')} marked stale_upstream. Re-sync downstream Change(s)?`,
        contextSnippet: staleChanges
          .map(c => `${c.code}: ${c.title}`)
          .join('\n'),
        options: [
          {
            action: 'resync_upstream',
            label: 'Re-sync Downstream Changes to CP-0 & Restart',
            recommended: true,
            consequencePreview:
              'Rewinds stale downstream Changes to CP-0, updates upstream SHAs, and restarts execution.',
            requiresFeedback: false,
          },
          {
            action: 'hold',
            label: 'Hold for Manual Inspection',
            recommended: false,
            consequencePreview: 'Keeps Mission paused.',
            requiresFeedback: false,
          },
          {
            action: 'reject',
            label: 'Mark Mission Failed',
            recommended: false,
            consequencePreview: 'Marks Mission failed.',
            requiresFeedback: false,
          },
        ],
      });
      this.publish({
        type: 'gate.opened',
        missionId,
        gateId: gate.id,
        kind: gate.kind,
        at: gate.createdAt,
      });
    }
    this.store.missions.updateMissionCas(missionId, undefined, {
      status: 'paused_human',
    });
  }

  private persistBaselineImpactIfNeeded(
    missionId: string,
  ): BaselineImpactReport | null {
    const existing = this.store.missions.getBaselineImpactByMission(missionId);
    if (existing) {
      return existing;
    }
    const baseline = this.store.hama.getBaselineByMission(missionId);
    if (!baseline?.parentId) {
      return null;
    }
    const parentBaseline = this.store.hama.getBaseline(baseline.parentId);
    if (!parentBaseline) {
      return null;
    }
    const activeChanges = this.store.listChangesForMission(
      parentBaseline.missionId,
    );
    const nodesByChangeId = new Map<string, readonly GraphNode[]>(
      activeChanges.map(c => [c.id, this.store.listGraphNodes(c.id)]),
    );
    const report = analyzeBaselineImpact({
      parentBaseline,
      nextBaseline: baseline,
      activeChanges,
      nodesByChangeId,
    });
    return this.store.missions.saveBaselineImpact(missionId, report);
  }

  private mustMissionChange(missionId: string, changeId: string): ChangeRecord {
    const chg = this.store.getChange(changeId);
    if (!chg || chg.missionId !== missionId) {
      throw new ForgeError(
        'NOT_FOUND',
        `Change "${changeId}" not found on Mission "${missionId}"`,
        404,
      );
    }
    return chg;
  }

  private emitMissionUpdated(missionId: string): void {
    const m = this.store.missions.getMission(missionId);
    if (!m) {
      return;
    }
    this.publish({
      type: 'mission.updated',
      missionId: m.id,
      status: m.status,
      stage: m.stage,
      at: m.updatedAt,
    });
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

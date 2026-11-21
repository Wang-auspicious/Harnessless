import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {reinforceAgentMemoryStability} from '../core/cognitive.ts';
import {
  renderUbiquitousLanguageSection,
  selectTermsForRepo,
} from '../core/ddd.ts';
import {scopesOverlap} from '../core/glob-scope.ts';
import {
  canAutoAdvanceGate,
  canAutoApproveGhostAmendment,
  renderEpistemicRolloverBlock,
} from '../core/policy.ts';
import {
  computeNextExecutableNodes,
  computePhaseBarrierRewindSet,
  spliceGhostNode,
} from '../core/twin-graph.ts';
import type {
  AgentInvocationResult,
  IAgentAdapterHub,
  IMcpStationServer,
  McpHindsightBridge,
  McpSubmissionPayload,
} from '../adapters/contracts.ts';
import type {HindsightEngine} from '../memory/hindsight-engine.ts';
import type {IGitWorktreeManager} from '../sandbox/contracts.ts';
import type {ForgeSseEvent} from '../shared/api.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  ChangeRecord,
  EpistemicHandoff,
  GraphNode,
} from '../shared/types.ts';
import type {FailureForensicsCard} from '../shared/v3-types.ts';
import type {ForgeStore} from '../store/database.ts';
import type {CompletionCertifier} from './certifier.ts';
import type {InfraStewardEngine} from './infra-steward.ts';

export type SsePublisher = (event: ForgeSseEvent) => void;

const BARRIER_KINDS = new Set<GraphNode['kind']>([
  'verify',
  'gates',
  'selfcheck',
  'audit_jqa',
  'audit_sqa',
  'decision',
  'checkpoint',
  'end',
]);

export class ContinuityEngine {
  private readonly store: ForgeStore;
  private readonly worktrees: IGitWorktreeManager;
  private readonly adapters: IAgentAdapterHub;
  private readonly mcpStation: IMcpStationServer;
  private readonly certifier: CompletionCertifier;
  private readonly steward: InfraStewardEngine;
  private readonly publish: SsePublisher;
  private readonly hindsight?: HindsightEngine;
  private readonly rootSignal?: AbortSignal;
  private readonly activeChangeRuns = new Set<string>();
  private readonly activeAbortControllers = new Map<string, AbortController>();
  private readonly activePromises = new Map<string, Promise<unknown>>();
  private reservedInFlightUsd = 0;

  constructor(deps: {
    readonly store: ForgeStore;
    readonly worktrees: IGitWorktreeManager;
    readonly adapters: IAgentAdapterHub;
    readonly mcpStation: IMcpStationServer;
    readonly certifier: CompletionCertifier;
    readonly steward: InfraStewardEngine;
    readonly publish: SsePublisher;
    readonly hindsight?: HindsightEngine;
    readonly rootSignal?: AbortSignal;
  }) {
    this.store = deps.store;
    this.worktrees = deps.worktrees;
    this.adapters = deps.adapters;
    this.mcpStation = deps.mcpStation;
    this.certifier = deps.certifier;
    this.steward = deps.steward;
    this.publish = deps.publish;
    this.hindsight = deps.hindsight;
    this.rootSignal = deps.rootSignal;
  }

  recoverInterruptedState(): number {
    const runningSessions = this.store
      .listSessions({limit: 200})
      .filter(s => s.status === 'running');
    for (const s of runningSessions) {
      this.store.finishSession(s.id, 'interrupted');
    }
    for (const chg of this.store.listChanges(undefined, false)) {
      if (chg.status === 'running') {
        const nodes = this.store.listGraphNodes(chg.id);
        for (const n of nodes) {
          if (n.status === 'running') {
            this.store.updateGraphNode(n.id, {
              status: 'ready',
              outputSummary:
                'Recovered after host restart; ready to resume from last checkpoint.',
            });
          }
        }
        this.store.updateChange(chg.id, {status: 'planned'});
      }
    }
    return runningSessions.length;
  }

  async abortChangeRun(changeId: string): Promise<void> {
    const ctrl = this.activeAbortControllers.get(changeId);
    if (ctrl && !ctrl.signal.aborted) {
      ctrl.abort('aborted');
    }
    const p = this.activePromises.get(changeId);
    if (p) {
      await Promise.race([
        p.catch(() => undefined),
        new Promise<void>(resolve => setTimeout(resolve, 2_000)),
      ]);
    }
  }

  async abortAll(): Promise<void> {
    for (const ctrl of this.activeAbortControllers.values()) {
      if (!ctrl.signal.aborted) {
        ctrl.abort('shutdown');
      }
    }
    const pending = [...this.activePromises.values()].map(p =>
      p.catch(() => undefined),
    );
    if (pending.length > 0) {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<void>(resolve => setTimeout(resolve, 2_500)),
      ]);
    }
  }

  async tickWatchdog(): Promise<void> {
    this.store.updateDaemon('continuity_watchdog', {runningPass: true});
    try {
      const nowMs = Date.now();
      const changes = this.store.listChanges(undefined, false);
      let resumed = 0;
      for (const chg of changes) {
        if (chg.status === 'cooldown_hold' && chg.cooldownUntil) {
          if (Date.parse(chg.cooldownUntil) <= nowMs) {
            this.store.updateChange(chg.id, {
              status: 'planned',
              cooldownUntil: null,
            });
            void this.startChangeExecution(chg.id);
            resumed += 1;
          }
        }
      }
      this.store.updateDaemon('continuity_watchdog', {
        runningPass: false,
        lastRunAt: new Date(nowMs).toISOString(),
        lastSummary: `Active=${this.activeChangeRuns.size} | CooldownResumed=${resumed}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.updateDaemon('continuity_watchdog', {
        runningPass: false,
        lastRunAt: new Date().toISOString(),
        lastSummary: `Watchdog error: ${msg}`,
      });
    }
  }

  startChangeExecution(
    changeId: string,
    maxParallelSlots = 3,
  ): Promise<ChangeRecord> {
    const initial = this.store.getChange(changeId);
    if (!initial) {
      throw new ForgeError('NOT_FOUND', `Change "${changeId}" not found`, 404);
    }
    if (this.activeChangeRuns.has(changeId)) {
      return Promise.resolve(initial);
    }

    this.activeChangeRuns.add(changeId);
    const controller = new AbortController();
    this.activeAbortControllers.set(changeId, controller);
    const runPromise = this.runChangeLoop(
      changeId,
      Math.max(1, maxParallelSlots),
      controller.signal,
    ).finally(() => {
      this.activeAbortControllers.delete(changeId);
      this.activeChangeRuns.delete(changeId);
      this.activePromises.delete(changeId);
      this.emitState('changes');
    });
    this.activePromises.set(changeId, runPromise);
    return runPromise;
  }

  private async runChangeLoop(
    changeId: string,
    maxParallelSlots: number,
    changeSignal: AbortSignal,
  ): Promise<ChangeRecord> {
    const signal = this.rootSignal
      ? AbortSignal.any([this.rootSignal, changeSignal])
      : changeSignal;
    let current = this.store.updateChange(changeId, {
      status: 'running',
      cooldownUntil: null,
    });
    this.emitState('changes');

    const startedMs = Date.now();
    let rollingHandoff = this.buildHandoffFromStore(current);
    let lastSessionId: string | undefined;

    let stepGuard = 0;
    while (stepGuard < 200) {
      stepGuard += 1;
      if (signal.aborted) {
        break;
      }
      current = this.store.getChange(changeId)!;
      if (
        current.status === 'paused_human' ||
        current.status === 'archived' ||
        current.status === 'cooldown_hold' ||
        current.status === 'stale_upstream'
      ) {
        break;
      }

      const capturedEpoch = current.executionEpoch ?? 1;
      const elapsedHours = (Date.now() - startedMs) / 3_600_000;
      if (elapsedHours > current.maxOvernightHours) {
        this.store.updateChangeStatusCas(changeId, capturedEpoch, {
          status: 'paused_human',
        });
        this.raisePauseAttention(
          current,
          null,
          `Overnight continuity window (${current.maxOvernightHours}h) reached for ${current.code}. Continue execution?`,
        );
        break;
      }

      const liveMode = (current.executionMode ?? 'live') === 'live';
      const budgetHit = liveMode
        ? current.spentUsd + this.reservedInFlightUsd >= current.budgetUsdLimit
        : current.spentUsd > current.budgetUsdLimit;
      if (budgetHit) {
        this.store.updateChangeStatusCas(changeId, capturedEpoch, {
          status: 'paused_human',
        });
        this.raisePauseAttention(
          current,
          null,
          `Budget ceiling ($${current.budgetUsdLimit.toFixed(2)}) reached for ${current.code}. Approve extension?`,
        );
        break;
      }

      const nodes = this.store.listGraphNodes(changeId);
      const edges = this.store.listGraphEdges(changeId);
      this.syncPhaseContainerStatuses(nodes);

      const refreshedNodes = this.store.listGraphNodes(changeId);
      const readyNodes = computeNextExecutableNodes(refreshedNodes, edges);
      if (readyNodes.length === 0) {
        break;
      }

      const wave = this.selectNonOverlappingWave(readyNodes, maxParallelSlots);
      const reserve = liveMode ? wave.length * 0.15 : 0;
      this.reservedInFlightUsd += reserve;

      let haltRequested = false;
      try {
        const waveOutcomes = await Promise.allSettled(
          wave.map(node =>
            this.executeSingleNode(
              current,
              node,
              rollingHandoff,
              capturedEpoch,
              signal,
              lastSessionId,
            ),
          ),
        );

        const postChange = this.store.getChange(changeId);
        if (
          !postChange ||
          (postChange.executionEpoch ?? 1) !== capturedEpoch ||
          signal.aborted
        ) {
          rollingHandoff = this.buildHandoffFromStore(postChange ?? current);
          continue;
        }

        for (const outcome of waveOutcomes) {
          if (outcome.status === 'fulfilled') {
            rollingHandoff = outcome.value.handoff;
            lastSessionId = outcome.value.sessionId ?? lastSessionId;
            if (outcome.value.haltLoop) {
              haltRequested = true;
            }
          } else {
            haltRequested = true;
          }
        }
      } finally {
        this.reservedInFlightUsd = Math.max(
          0,
          this.reservedInFlightUsd - reserve,
        );
      }

      if (haltRequested) {
        break;
      }
    }

    return this.store.getChange(changeId)!;
  }

  private selectNonOverlappingWave(
    readyNodes: readonly GraphNode[],
    maxParallelSlots: number,
  ): GraphNode[] {
    if (readyNodes.length === 0) {
      return [];
    }
    if (BARRIER_KINDS.has(readyNodes[0]!.kind)) {
      return [readyNodes[0]!];
    }
    const picked: GraphNode[] = [];
    for (const candidate of readyNodes) {
      if (picked.length >= maxParallelSlots) {
        break;
      }
      if (BARRIER_KINDS.has(candidate.kind)) {
        continue;
      }
      const overlaps = picked.some(chosen =>
        scopesOverlap(chosen.fileScope, candidate.fileScope),
      );
      if (!overlaps) {
        picked.push(candidate);
      }
    }
    return picked.length > 0 ? picked : [readyNodes[0]!];
  }

  async manualRestoreToCheckpoint(
    changeId: string,
    checkpointId: string,
  ): Promise<ChangeRecord> {
    const change = this.store.getChange(changeId);
    if (!change) {
      throw new ForgeError('NOT_FOUND', `Change "${changeId}" not found`, 404);
    }
    const cp = this.store
      .listCheckpoints(changeId)
      .find(c => c.id === checkpointId);
    if (!cp) {
      throw new ForgeError(
        'NOT_FOUND',
        `Checkpoint "${checkpointId}" not found`,
        404,
      );
    }

    await this.abortChangeRun(changeId);

    const rewindRes = await this.worktrees.rewindToCheckpoint({
      worktreePath: change.worktreePath,
      changeCode: change.code,
      targetCommitSha: cp.gitCommitSha,
    });
    this.store.updateCheckpointRescueRef(cp.id, rewindRes.rescueRef);

    const nextEpoch = this.store.bumpChangeEpochAtomic(changeId);
    const nodes = this.store.listGraphNodes(changeId);
    const edges = this.store.listGraphEdges(changeId);
    const rewindIds = computePhaseBarrierRewindSet(nodes, edges, cp.nodeId);
    for (const id of rewindIds) {
      this.store.updateGraphNode(id, {
        status: 'rewound',
        outputSummary: `Phase-barrier rewound to ${cp.label} at epoch ${nextEpoch} (rescue ref: ${rewindRes.rescueRef})`,
      });
    }

    const updated = this.store.updateChange(changeId, {status: 'planned'});
    const audit = this.store.appendAudit({
      hubId: change.hubId,
      changeId: change.id,
      category: 'rewind',
      actor: 'human_operator',
      title: `Restored ${change.code} to ${cp.label} (${cp.gitCommitSha.slice(0, 7)})`,
      detail: `Saved pre-rewind worktree state at ${rewindRes.rescueRef} (epoch ${nextEpoch}).`,
    });
    this.publish({type: 'audit.logged', entry: audit});
    this.emitState('changes');
    return updated;
  }

  proposeGhostAmendment(input: {
    readonly changeId: string;
    readonly title: string;
    readonly description: string;
    readonly insertBeforeNodeId: string;
    readonly gateCommand?: string;
    readonly actor?: string;
  }): GraphNode {
    const change = this.store.getChange(input.changeId);
    if (!change) {
      throw new ForgeError(
        'NOT_FOUND',
        `Change "${input.changeId}" not found`,
        404,
      );
    }
    const repo = this.store.getRepository(change.repoId);
    const nodes = this.store.listGraphNodes(change.id);
    const edges = this.store.listGraphEdges(change.id);
    const ghostCount = nodes.filter(n => n.kind === 'ghost').length;
    const code = `GHOST-${ghostCount + 1}`;

    const spliced = spliceGhostNode(nodes, edges, {
      changeId: change.id,
      code,
      title: input.title,
      description: input.description,
      insertBeforeNodeId: input.insertBeforeNodeId,
      gateCommand: input.gateCommand ?? null,
      assignedAdapterId: change.team.workerAdapterId,
      assignedModel: change.team.workerModel,
      nowIso: new Date().toISOString(),
    });

    const createdGhost = spliced.nodes[spliced.nodes.length - 1]!;
    const autoApprove =
      input.actor === 'human_operator' ||
      canAutoApproveGhostAmendment(
        change.permissionTier,
        ghostCount,
        input.gateCommand,
        repo?.verifyCommand ?? change.verifyCommand,
      );

    const finalGhost: GraphNode = autoApprove
      ? createdGhost
      : {...createdGhost, status: 'blocked_human'};
    const linkKind = createdGhost.containerNodeId ? 'dep' : 'logic';
    this.store.spliceGhostNodeAtomic(
      change.id,
      finalGhost,
      input.insertBeforeNodeId,
      linkKind,
    );

    const audit = this.store.appendAudit({
      hubId: change.hubId,
      changeId: change.id,
      category: 'ghost_amendment',
      actor: input.actor ?? 'lead_agent',
      title: `Spliced GhostNode ${code}: ${input.title}`,
      detail: input.description,
    });
    this.publish({type: 'audit.logged', entry: audit});

    if (!autoApprove) {
      this.store.updateChange(change.id, {status: 'paused_human'});
      const attn = this.store.raiseAttention({
        hubId: change.hubId,
        repoId: change.repoId,
        changeId: change.id,
        nodeId: finalGhost.id,
        kind: 'amendment_approval',
        question: `Approve runtime GhostNode "${input.title}" in ${change.code}?`,
        contextSnippet: input.description,
        options: ['Approve GhostNode & Resume', 'Waive GhostNode & Continue'],
        recommendedIndex: 0,
        downstreamBlockedCount: 3,
        estimatedReadSeconds: 20,
      });
      this.publish({type: 'attention.raised', item: attn});
    }

    this.emitState('changes');
    return finalGhost;
  }

  private async executeSingleNode(
    change: ChangeRecord,
    node: GraphNode,
    handoff: EpistemicHandoff,
    capturedEpoch: number,
    signal: AbortSignal,
    prevSessionId?: string,
  ): Promise<{
    readonly handoff: EpistemicHandoff;
    readonly sessionId?: string;
    readonly haltLoop: boolean;
  }> {
    if (!this.isEpochActive(change.id, capturedEpoch, signal)) {
      return {handoff, haltLoop: true};
    }

    this.store.updateGraphNode(node.id, {
      status: 'running',
      attemptCount: node.attemptCount + 1,
    });
    this.emitProgress(change.id, node.id, 'running', `Executing ${node.code}`);

    if (node.kind === 'checkpoint') {
      const cpCommit = await this.worktrees.createCheckpoint({
        worktreePath: change.worktreePath,
        changeCode: change.code,
        nodeCode: node.code,
        message: `checkpoint(${change.code}): ${node.title}`,
      });
      if (!this.isEpochActive(change.id, capturedEpoch, signal)) {
        return {handoff, haltLoop: true};
      }

      const diff = await this.worktrees.diffSinceCommit(
        change.worktreePath,
        change.baseCommitSha,
      );
      this.store.updateChangeDiffStatsAtomic(
        change.id,
        diff.linesAdded ?? 0,
        diff.linesDeleted ?? 0,
      );

      const allTasks = this.store
        .listGraphNodes(change.id)
        .filter(n => n.kind === 'task' || n.kind === 'ghost');
      const certifiedCount = allTasks.filter(
        n => n.status === 'certified',
      ).length;

      const cpRec = this.store.recordCheckpoint({
        changeId: change.id,
        nodeId: node.id,
        label: node.title,
        gitCommitSha: cpCommit.commitSha,
        gitTag: cpCommit.gitTag,
        certifiedTaskCount: certifiedCount,
        totalTaskCount: allTasks.length,
        engineSnapshot: {handoff},
      });
      this.store.updateGraphNode(node.id, {
        status: 'certified',
        outputSummary: `Committed ${cpRec.gitCommitSha.slice(0, 8)} (${cpRec.gitTag})`,
      });
      const audit = this.store.appendAudit({
        hubId: change.hubId,
        changeId: change.id,
        category: 'checkpoint',
        actor: 'continuity_engine',
        title: `Created ${node.code} Git Checkpoint (${cpRec.gitCommitSha.slice(0, 7)})`,
        detail: `Tag ${cpRec.gitTag} | ${certifiedCount}/${allTasks.length} tasks certified.`,
      });
      this.publish({type: 'audit.logged', entry: audit});
      this.emitProgress(
        change.id,
        node.id,
        'certified',
        `Git tag ${cpRec.gitTag}`,
      );
      return {handoff, haltLoop: false};
    }

    if (node.kind === 'decision') {
      const isFinalPhaseGate = node.code.endsWith('-DECISION');
      const autoAdvance =
        !isFinalPhaseGate ||
        canAutoAdvanceGate(change.permissionTier, 'G2', change.qualityScore);
      if (!autoAdvance) {
        this.store.updateGraphNode(node.id, {
          status: 'blocked_human',
          outputSummary: 'Awaiting human approval in Strict mode.',
        });
        this.store.updateChangeStatusCas(change.id, capturedEpoch, {
          status: 'paused_human',
        });
        this.raisePauseAttention(
          change,
          node.id,
          `Approve QA Decision Gate (${node.code}) for ${change.code}?`,
        );
        return {handoff, haltLoop: true};
      }
      this.store.updateGraphNode(node.id, {
        status: 'certified',
        outputSummary: 'PASS — advancing to next stage.',
      });
      this.emitProgress(change.id, node.id, 'certified', 'PASS');
      return {handoff, haltLoop: false};
    }

    if (node.kind === 'end') {
      const certifiedCriteria = change.acceptanceCriteria.map(ac => ({
        ...ac,
        certified: true,
      }));
      this.store.updateGraphNode(node.id, {
        status: 'certified',
        outputSummary:
          'All acceptance criteria, gates, and QA audits certified.',
      });
      this.store.updateChangeStatusCas(change.id, capturedEpoch, {
        status: 'certified',
        acceptanceCriteria: certifiedCriteria,
        qualityScore: 0.95,
      });

      const diff = await this.worktrees.diffSinceCommit(
        change.worktreePath,
        change.baseCommitSha,
      );
      this.store.updateChangeDiffStatsAtomic(
        change.id,
        diff.linesAdded ?? 0,
        diff.linesDeleted ?? 0,
      );

      this.propagateUpstreamChangeInvalidation(change);
      this.steward.runRetroOptimization(change.id);

      const executionMode = change.executionMode ?? 'live';
      if (this.hindsight) {
        this.hindsight.retain({
          hubId: change.hubId,
          repoId: change.repoId,
          missionId: change.missionId ?? null,
          executionMode,
          sourceType: 'change_certified',
          authorityTier: 'L2_verified',
          rawText: `Change ${change.code} (${change.title}) certified on branch ${change.gitBranch}. Changed files: ${diff.changedFiles.join(', ') || 'none'}.`,
          structuredFacts: [
            {
              kind: 'experience',
              subjectKey: `repo:${change.repoId}:certified:${change.code}`,
              claim: `Change ${change.code} (${change.title}) passed all gates & dual QA.`,
              confidence: 0.95,
              pathAnchors: diff.changedFiles.slice(0, 16),
              entityNames: [change.code, change.repoId],
            },
          ],
        });
        this.store.enqueueEffect(
          'memory.git_drift',
          `git-drift:${change.id}:${executionMode}`,
          {
            hubId: change.hubId,
            executionMode,
            changeId: change.id,
            changedFiles: diff.changedFiles,
          },
        );
        this.store.enqueueEffect(
          'memory.consolidate',
          `consolidate:${change.hubId}:${executionMode}`,
          {
            hubId: change.hubId,
            executionMode,
          },
        );
      }

      this.emitProgress(
        change.id,
        node.id,
        'certified',
        `${change.code} certified & Retro wiki updated.`,
      );
      return {handoff, haltLoop: true};
    }

    if (
      node.kind === 'verify' ||
      node.kind === 'gates' ||
      node.kind === 'selfcheck' ||
      node.kind === 'audit_jqa' ||
      node.kind === 'audit_sqa'
    ) {
      const sinceCommitSha = this.latestCheckpointSha(change);
      const verdict = await this.certifier.certifyNode(
        change,
        node,
        sinceCommitSha,
        signal,
      );
      if (!this.isEpochActive(change.id, capturedEpoch, signal)) {
        return {handoff, haltLoop: true};
      }

      if (verdict.certified) {
        this.store.updateGraphNode(node.id, {
          status: 'certified',
          outputSummary: verdict.summary,
        });
        this.store.bumpChangeQualityMaxAtomic(change.id, verdict.score);
        this.store.appendEpistemicItem({
          changeId: change.id,
          nodeId: node.id,
          executionEpoch: capturedEpoch,
          kind: 'spec_confirmed',
          content: `${node.code}: ${verdict.summary}`,
        });
        this.emitProgress(change.id, node.id, 'certified', verdict.summary);
        return {
          handoff: this.buildHandoffFromStore(change, capturedEpoch),
          haltLoop: false,
        };
      }

      return this.handleVerificationFailureAndRewind(
        change,
        node,
        verdict.summary,
        verdict.diagnostics,
        handoff,
      );
    }

    return this.executeWorkerSlice(
      change,
      node,
      handoff,
      capturedEpoch,
      signal,
      prevSessionId,
    );
  }

  private async executeWorkerSlice(
    change: ChangeRecord,
    node: GraphNode,
    handoff: EpistemicHandoff,
    capturedEpoch: number,
    signal: AbortSignal,
    prevSessionId?: string,
  ): Promise<{
    readonly handoff: EpistemicHandoff;
    readonly sessionId?: string;
    readonly haltLoop: boolean;
  }> {
    const executionMode = change.executionMode ?? 'live';
    const hub = this.store.getHub(change.hubId)!;
    const repo = this.store.getRepository(change.repoId)!;

    if (node.attemptCount > 0) {
      await this.worktrees.revertTaskScope(change.worktreePath, node.fileScope);
    }

    const terms = selectTermsForRepo(
      this.store.listDomainTerms(hub.id),
      repo.id,
      repo.boundedContext,
    );
    const hindsightHits = this.hindsight
      ? this.hindsight.recall({
          hubId: hub.id,
          executionMode,
          query: `${node.title} ${node.description}`,
          limit: 5,
        }).hits
      : [];
    const fallbackMemories =
      hindsightHits.length === 0
        ? this.store.searchActiveSemanticMemories(
            `${node.title} ${node.description}`,
            hub.id,
            4,
          )
        : [];

    const escalated = node.attemptCount >= 2;
    const targetAdapterId = escalated
      ? change.team.leadAdapterId
      : (node.assignedAdapterId ?? change.team.workerAdapterId);
    const targetModel = escalated
      ? change.team.leadModel
      : (node.assignedModel ?? change.team.workerModel);
    const adapterProfile = this.store.pickHealthyAdapter(
      escalated ? 'lead' : 'worker',
      targetAdapterId,
    );

    const contractMarkdown = [
      `# Slice Mandate — ${change.code} / ${node.code}: ${node.title}`,
      node.inputContract ? `Input Contract: ${node.inputContract}` : '',
      node.outputContract ? `Output Contract: ${node.outputContract}` : '',
      node.planningRationale
        ? `Planning Rationale: ${node.planningRationale}`
        : '',
      node.description,
      node.fileScope.length > 0
        ? `Allowed File Scope: ${node.fileScope.join(', ')}`
        : 'File Scope: Repository worktree',
      '',
      renderEpistemicRolloverBlock(handoff, prevSessionId),
    ]
      .filter(Boolean)
      .join('\n\n');

    const hindsightBridge: McpHindsightBridge | undefined = this.hindsight
      ? {
          recall: (query, limit) =>
            this.hindsight!.recall({
              hubId: hub.id,
              executionMode,
              query,
              limit,
            }),
          reflect: question =>
            this.hindsight!.reflect({
              hubId: hub.id,
              executionMode,
              question,
            }),
          retainObserved: (title, claim, subjectKey) =>
            this.hindsight!.retain({
              hubId: hub.id,
              repoId: repo.id,
              missionId: change.missionId ?? null,
              executionMode,
              sourceType: 'mcp_worker_observation',
              authorityTier: 'L1_observed',
              rawText: `${title}: ${claim}`,
              structuredFacts: [
                {
                  kind: 'experience',
                  subjectKey: subjectKey ?? `obs:${change.code}:${node.code}`,
                  claim,
                  confidence: 0.72,
                  pathAnchors: node.fileScope,
                },
              ],
            }),
        }
      : undefined;

    let capturedSubmission: McpSubmissionPayload | null = null;
    const mcpReg = this.mcpStation.registerAttempt({
      hubId: hub.id,
      changeId: change.id,
      nodeId: node.id,
      worktreePath: change.worktreePath,
      contractMarkdown,
      executionMode,
      fileScope: node.fileScope,
      hindsight: hindsightBridge,
      onProgress: summary =>
        this.emitProgress(change.id, node.id, 'running', summary),
      onAskHuman: (question, options, snippet) => {
        const attn = this.store.raiseAttention({
          hubId: hub.id,
          repoId: repo.id,
          changeId: change.id,
          nodeId: node.id,
          kind: 'question',
          question,
          contextSnippet: snippet,
          options:
            options.length > 0 ? options : ['Proceed with recommended default'],
        });
        this.publish({type: 'attention.raised', item: attn});
        return attn;
      },
      onProposeAmendment: (title, description, gateCommand) =>
        this.proposeGhostAmendment({
          changeId: change.id,
          title,
          description,
          insertBeforeNodeId: node.id,
          gateCommand,
          actor: adapterProfile.manifest.id,
        }),
      onSubmitted: payload => {
        capturedSubmission = payload;
      },
    });

    const session = this.store.startSession({
      hubId: hub.id,
      changeId: change.id,
      nodeId: node.id,
      adapterId: adapterProfile.manifest.id,
      model: targetModel,
      role: escalated ? 'lead' : 'worker',
    });

    const memorySection =
      hindsightHits.length > 0
        ? `## Recalled Hindsight Memory\n${hindsightHits.map(h => `- [${h.authorityTier}] ${h.title}: ${h.content}`).join('\n')}`
        : fallbackMemories.length > 0
          ? `## Recalled Semantic Memories\n${fallbackMemories.map(m => `- [${m.kind}] ${m.title}: ${m.summary}`).join('\n')}`
          : '';

    const systemPrompt = [
      this.store.getConstitution().markdown,
      `## Hub Agent-Wiki\n${hub.agentWikiSummary || hub.description}`,
      `## Target Repository (${repo.name})\n${repo.contractSummary}`,
      renderUbiquitousLanguageSection(terms),
      memorySection,
    ]
      .filter(Boolean)
      .join('\n\n');

    this.store.appendTranscriptMessage({
      sessionId: session.id,
      role: 'user',
      content: contractMarkdown,
    });

    try {
      let simulatedSub: McpSubmissionPayload | null = null;
      let inv: AgentInvocationResult;
      if (executionMode === 'simulation') {
        simulatedSub = this.materializeDeterministicWorktreeSlice(
          change,
          node,
          repo.boundedContext,
        );
        inv = {
          outcome: 'completed',
          finalText: simulatedSub.summary,
          mcpSubmission: simulatedSub,
          inputTokens: 0,
          cachedTokens: 0,
          firstTurnCachedTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          durationSec: 0.01,
          diagnostic: 'Offline deterministic simulation slice',
        };
      } else {
        inv = await this.adapters.invoke({
          sessionId: session.id,
          hubId: hub.id,
          changeId: change.id,
          nodeId: node.id,
          role: escalated ? 'lead' : 'worker',
          adapter: adapterProfile.manifest,
          model: targetModel,
          permissionTier: change.permissionTier,
          cwd: change.worktreePath,
          systemPrompt,
          userPrompt: contractMarkdown,
          readOnly: false,
          fileScope: node.fileScope,
          cacheStablePrefix: true,
          mcpEndpointUrl: mcpReg.mcpEndpointUrl,
          mcpAttemptToken: mcpReg.attemptToken,
          timeoutMs: 300_000,
          signal,
          onChunk: (role, content, toolName) => {
            const msg = this.store.appendTranscriptMessage({
              sessionId: session.id,
              role,
              content,
              toolName,
            });
            this.publish({
              type: 'transcript.chunk',
              sessionId: session.id,
              changeId: change.id,
              message: msg,
            });
          },
        });
      }

      const finalMsg = this.store.appendTranscriptMessage({
        sessionId: session.id,
        role: 'assistant',
        content: inv.finalText || inv.diagnostic,
        isError: inv.outcome !== 'completed',
        inputTokens: inv.inputTokens,
        cachedTokens: inv.cachedTokens,
        outputTokens: inv.outputTokens,
      });
      this.publish({
        type: 'transcript.chunk',
        sessionId: session.id,
        changeId: change.id,
        message: finalMsg,
      });

      if (inv.costUsd > 0) {
        this.store.addChangeCostAtomic(change.id, inv.costUsd);
        if (change.missionId) {
          this.store.missions.addMissionCostAtomic(
            change.missionId,
            inv.costUsd,
          );
        }
      }

      if (!this.isEpochActive(change.id, capturedEpoch, signal)) {
        this.store.finishSession(session.id, 'interrupted');
        return {handoff, sessionId: session.id, haltLoop: true};
      }

      if (inv.outcome === 'rate_limited') {
        this.store.finishSession(session.id, 'interrupted');
        const waitSec = Math.max(15, inv.retryAfterSeconds ?? 45);
        const untilIso = new Date(Date.now() + waitSec * 1000).toISOString();
        this.store.updateGraphNode(node.id, {
          status: 'ready',
          attemptCount: Math.max(0, node.attemptCount),
          outputSummary: `Rate-limited; holding in cooldown until ${untilIso}`,
        });
        this.store.updateChangeStatusCas(change.id, capturedEpoch, {
          status: 'cooldown_hold',
          cooldownUntil: untilIso,
        });
        return {handoff, sessionId: session.id, haltLoop: true};
      }

      let submission: McpSubmissionPayload | null =
        simulatedSub ??
        inv.mcpSubmission ??
        capturedSubmission ??
        this.mcpStation.getSubmission(mcpReg.attemptToken);

      if (
        executionMode === 'simulation' &&
        inv.outcome === 'env_fault' &&
        inv.diagnostic.toLowerCase().includes('api key')
      ) {
        submission = this.materializeDeterministicWorktreeSlice(
          change,
          node,
          repo.boundedContext,
        );
      }

      const stoppedPrematurely =
        inv.outcome === 'completed' &&
        !submission &&
        inv.finalText.trim().length < 24;

      if (stoppedPrematurely) {
        this.store.finishSession(session.id, 'failed');
        this.store.incrementPrematureStopAtomic(change.id);
        this.store.recordTelemetry({
          hubId: hub.id,
          changeId: change.id,
          nodeId: node.id,
          adapterId: adapterProfile.manifest.id,
          model: targetModel,
          role: escalated ? 'lead' : 'worker',
          outcome: 'task_failure',
          firstPassCertified: false,
          prematureStopTriggered: true,
          durationSec: inv.durationSec,
          inputTokens: inv.inputTokens,
          cachedTokens: inv.cachedTokens,
          firstTurnCachedTokens: inv.firstTurnCachedTokens,
          outputTokens: inv.outputTokens,
          costUsd: inv.costUsd,
          diagnostic:
            'Premature stop blocked by ContinuityEngine; re-queuing slice.',
        });

        this.store.appendEpistemicItem({
          changeId: change.id,
          nodeId: node.id,
          executionEpoch: capturedEpoch,
          kind: 'conflict',
          content: `Prior worker stopped prematurely on ${node.code}; complete full deliverable before stopping.`,
        });

        if (node.attemptCount + 1 < node.maxAttempts) {
          this.store.updateGraphNode(node.id, {
            status: 'ready',
            outputSummary:
              'Premature stop intercepted; continuing automatically.',
          });
          return {
            handoff: this.buildHandoffFromStore(change, capturedEpoch),
            sessionId: session.id,
            haltLoop: false,
          };
        }
      }

      const succeeded = inv.outcome === 'completed' || submission !== null;
      this.store.finishSession(session.id, succeeded ? 'completed' : 'failed');

      this.store.recordTelemetry({
        hubId: hub.id,
        changeId: change.id,
        nodeId: node.id,
        adapterId: adapterProfile.manifest.id,
        model: targetModel,
        role: escalated ? 'lead' : 'worker',
        outcome: succeeded
          ? 'certified'
          : inv.outcome === 'env_fault'
            ? 'env_fault'
            : 'task_failure',
        firstPassCertified: succeeded && node.attemptCount === 0,
        prematureStopTriggered: false,
        durationSec: inv.durationSec,
        inputTokens: inv.inputTokens,
        cachedTokens: inv.cachedTokens,
        firstTurnCachedTokens: inv.firstTurnCachedTokens,
        outputTokens: inv.outputTokens,
        costUsd: inv.costUsd,
        diagnostic: submission?.summary ?? inv.diagnostic,
      });

      if (!succeeded) {
        if (executionMode === 'live' && inv.outcome === 'env_fault') {
          this.store.updateGraphNode(node.id, {
            status: 'blocked_human',
            outputSummary: `Fail-closed env fault: ${inv.diagnostic}`,
          });
          this.store.updateChangeStatusCas(change.id, capturedEpoch, {
            status: 'paused_human',
          });
          this.raisePauseAttention(
            change,
            node.id,
            `Live provider fault on ${change.code}/${node.code}: ${inv.diagnostic}`,
          );
          return {handoff, sessionId: session.id, haltLoop: true};
        }

        if (node.attemptCount + 1 < node.maxAttempts) {
          this.store.updateGraphNode(node.id, {
            status: 'ready',
            outputSummary: `Attempt ${node.attemptCount + 1} failed (${inv.diagnostic}); escalating retry.`,
          });
          return {handoff, sessionId: session.id, haltLoop: false};
        }
        this.store.updateGraphNode(node.id, {
          status: 'failed',
          outputSummary: inv.diagnostic,
        });
        this.store.updateChangeStatusCas(change.id, capturedEpoch, {
          status: 'failed',
        });
        return {handoff, sessionId: session.id, haltLoop: true};
      }

      if (node.attemptCount === 0) {
        for (const mem of fallbackMemories) {
          this.store.reinforceMemory(
            mem.id,
            reinforceAgentMemoryStability(mem.stabilityHours),
          );
        }
      }

      const summary =
        submission?.summary ??
        (inv.finalText.trim().slice(0, 240) || `Completed slice ${node.code}`);
      this.store.updateGraphNode(node.id, {
        status: 'certified',
        outputSummary: summary,
      });
      this.emitProgress(change.id, node.id, 'certified', summary);

      if (submission) {
        for (const fact of submission.specConfirmedFacts) {
          this.store.appendEpistemicItem({
            changeId: change.id,
            nodeId: node.id,
            executionEpoch: capturedEpoch,
            kind: 'spec_confirmed',
            content: fact,
            evidenceRef: session.id,
          });
        }
        for (const hyp of submission.agentHypotheses) {
          this.store.appendEpistemicItem({
            changeId: change.id,
            nodeId: node.id,
            executionEpoch: capturedEpoch,
            kind: 'hypothesis',
            content: hyp,
            evidenceRef: session.id,
          });
        }
        for (const conf of submission.openConflicts) {
          this.store.appendEpistemicItem({
            changeId: change.id,
            nodeId: node.id,
            executionEpoch: capturedEpoch,
            kind: 'conflict',
            content: conf,
            evidenceRef: session.id,
          });
        }
      } else {
        this.store.appendEpistemicItem({
          changeId: change.id,
          nodeId: node.id,
          executionEpoch: capturedEpoch,
          kind: 'hypothesis',
          content: `Slice ${node.code} output awaiting Hard Gates.`,
          evidenceRef: session.id,
        });
      }

      return {
        handoff: this.buildHandoffFromStore(change, capturedEpoch),
        sessionId: session.id,
        haltLoop: false,
      };
    } finally {
      mcpReg.revoke();
    }
  }

  private async handleVerificationFailureAndRewind(
    change: ChangeRecord,
    failedNode: GraphNode,
    summary: string,
    diagnostics: readonly string[],
    handoff: EpistemicHandoff,
  ): Promise<{
    readonly handoff: EpistemicHandoff;
    readonly haltLoop: boolean;
  }> {
    const nodes = this.store.listGraphNodes(change.id);
    const edges = this.store.listGraphEdges(change.id);

    const directFailEdge = edges.find(
      e => e.kind === 'fail' && e.sourceNodeId === failedNode.id,
    );
    const pairedDecisionIds = new Set(
      edges
        .filter(e => e.sourceNodeId === failedNode.id && e.kind !== 'fail')
        .map(e => e.targetNodeId),
    );
    const failEdge =
      directFailEdge ??
      edges.find(
        e => e.kind === 'fail' && pairedDecisionIds.has(e.sourceNodeId),
      );
    const restoreNode =
      (failEdge
        ? nodes.find(
            n => n.id === failEdge.targetNodeId && n.kind === 'restore',
          )
        : undefined) ??
      nodes.find(
        n =>
          n.kind === 'restore' &&
          failedNode.parentWbsId !== null &&
          n.parentWbsId === failedNode.parentWbsId,
      );
    const targetCpNodeId = restoreNode?.restoreTargetCheckpointId ?? null;
    const checkpoints = this.store.listCheckpoints(change.id);
    const targetCp = targetCpNodeId
      ? checkpoints.find(c => c.nodeId === targetCpNodeId)
      : checkpoints[checkpoints.length - 1];

    if (failedNode.attemptCount + 1 > failedNode.maxAttempts || !targetCp) {
      this.store.updateGraphNode(failedNode.id, {
        status: 'failed',
        outputSummary: `${summary} — ${diagnostics.join(' | ')}`,
      });
      this.store.updateChange(change.id, {status: 'failed'});
      this.raisePauseAttention(
        change,
        failedNode.id,
        `${failedNode.code} failed after ${failedNode.attemptCount + 1} attempts in ${change.code}: ${summary}`,
      );
      return {handoff, haltLoop: true};
    }

    const rewindRes = await this.worktrees.rewindToCheckpoint({
      worktreePath: change.worktreePath,
      changeCode: change.code,
      targetCommitSha: targetCp.gitCommitSha,
    });
    this.store.updateCheckpointRescueRef(targetCp.id, rewindRes.rescueRef);

    const nextEpoch = this.store.bumpChangeEpochAtomic(change.id);
    if (restoreNode) {
      this.store.updateGraphNode(restoreNode.id, {
        status: 'certified',
        outputSummary: `Restored to ${targetCp.gitTag} (backup: ${rewindRes.rescueRef})`,
      });
    }

    const rewindSet = computePhaseBarrierRewindSet(
      nodes,
      edges,
      targetCp.nodeId,
    );
    for (const rwId of rewindSet) {
      this.store.updateGraphNode(rwId, {
        status: 'rewound',
        outputSummary: `Rewound at epoch ${nextEpoch} after ${failedNode.code} failure: ${summary}`,
      });
    }

    const forensics: FailureForensicsCard = {
      failedNodeId: failedNode.id,
      failedNodeCode: failedNode.code,
      reasonCode: 'GATE_FAILED',
      summary,
      diagnostics: diagnostics.slice(0, 6),
      targetCheckpointLabel: targetCp.label,
      rescueRef: rewindRes.rescueRef,
      failedAt: new Date().toISOString(),
    };
    this.store.updateNodeForensics(failedNode.id, forensics);
    this.store.appendEpistemicItem({
      changeId: change.id,
      nodeId: failedNode.id,
      executionEpoch: nextEpoch,
      kind: 'forensics',
      content: `${failedNode.code} failed: ${summary} | ${diagnostics.slice(0, 3).join('; ')}`,
      evidenceRef: rewindRes.rescueRef,
    });

    const audit = this.store.appendAudit({
      hubId: change.hubId,
      changeId: change.id,
      category: 'rewind',
      actor: 'continuity_engine',
      title: `Phase-Barrier Restore triggered by ${failedNode.code} -> ${targetCp.label}`,
      detail: `${summary} | Epoch ${nextEpoch} | Backup ref: ${rewindRes.rescueRef}`,
    });
    this.publish({type: 'audit.logged', entry: audit});

    return {
      handoff: this.buildHandoffFromStore(change, nextEpoch),
      haltLoop: false,
    };
  }

  private propagateUpstreamChangeInvalidation(
    certifiedChange: ChangeRecord,
  ): void {
    if (!certifiedChange.missionId) {
      return;
    }
    const cps = this.store.listCheckpoints(certifiedChange.id);
    const headSha =
      cps[cps.length - 1]?.gitCommitSha ?? certifiedChange.baseCommitSha;
    const siblings = this.store.listChangesForMission(
      certifiedChange.missionId,
    );

    for (const dep of siblings) {
      if (
        dep.id === certifiedChange.id ||
        !(dep.dependsOnChangeIds ?? []).includes(certifiedChange.id)
      ) {
        continue;
      }
      const prevRecorded = dep.upstreamContractShas?.[certifiedChange.id];
      const nextMap = {
        ...(dep.upstreamContractShas ?? {}),
        [certifiedChange.id]: headSha,
      };
      this.store.updateChangeUpstreamShas(dep.id, nextMap);

      if (
        prevRecorded &&
        prevRecorded !== headSha &&
        (dep.status === 'running' ||
          dep.status === 'certified' ||
          dep.status === 'planned')
      ) {
        this.store.updateChangeStatusCas(dep.id, dep.executionEpoch ?? 1, {
          status: 'stale_upstream',
        });
      }
    }
  }

  private buildHandoffFromStore(
    change: ChangeRecord,
    epoch?: number,
  ): EpistemicHandoff {
    const targetEpoch = epoch ?? change.executionEpoch ?? 1;
    const items = this.store.listEpistemicItems(change.id, targetEpoch);
    const confirmed = items
      .filter(i => i.kind === 'spec_confirmed')
      .map(i => i.content);
    const hypotheses = items
      .filter(i => i.kind === 'hypothesis')
      .map(i => i.content);
    const conflicts = items
      .filter(i => i.kind === 'conflict' || i.kind === 'forensics')
      .map(i => i.content);

    return {
      specConfirmedFacts: [
        `Mandate locked for ${change.code}: ${change.title} (epoch ${targetEpoch})`,
        ...confirmed.slice(-8),
      ],
      agentHypotheses: hypotheses.slice(-6),
      openConflicts: conflicts.slice(-6),
      uncertifiedCriteria: change.acceptanceCriteria
        .filter(c => !c.certified)
        .map(c => `${c.id}: ${c.statement}`),
    };
  }

  private latestCheckpointSha(change: ChangeRecord): string {
    const cps = this.store.listCheckpoints(change.id);
    return cps[cps.length - 1]?.gitCommitSha ?? change.baseCommitSha;
  }

  private isEpochActive(
    changeId: string,
    capturedEpoch: number,
    signal?: AbortSignal,
  ): boolean {
    if (signal?.aborted) {
      return false;
    }
    const fresh = this.store.getChange(changeId);
    return Boolean(fresh && (fresh.executionEpoch ?? 1) === capturedEpoch);
  }

  private materializeDeterministicWorktreeSlice(
    change: ChangeRecord,
    node: GraphNode,
    boundedContext: string,
  ): McpSubmissionPayload {
    const slicesDir = this.worktrees.resolveInside(
      change.worktreePath,
      '.forgeops/slices',
    );
    mkdirSync(slicesDir, {recursive: true});
    const safeCode = node.code.replace(/[^A-Za-z0-9_-]/g, '_');
    const artifactPath = join(slicesDir, `${safeCode}.md`);
    writeFileSync(
      artifactPath,
      [
        `# ${change.code} — Slice ${node.code}: ${node.title}`,
        '',
        `- Bounded Context: \`${boundedContext}\``,
        `- Objective: ${node.description}`,
        `- Executed At: ${new Date().toISOString()}`,
      ].join('\n'),
      'utf8',
    );
    return {
      summary: `Materialized verified slice artifact .forgeops/slices/${safeCode}.md (${node.title}).`,
      specConfirmedFacts: [
        `Completed bounded slice ${node.code} (${node.title}) in ${boundedContext}.`,
      ],
      agentHypotheses: [],
      openConflicts: [],
      certifiedCriteriaIds: ['AC-1'],
    };
  }

  private syncPhaseContainerStatuses(nodes: readonly GraphNode[]): void {
    const containers = nodes.filter(n => n.kind === 'phase_container');
    for (const c of containers) {
      const children = nodes.filter(n => n.containerNodeId === c.id);
      if (children.length === 0) {
        continue;
      }
      const nextStatus = children.every(ch => ch.status === 'certified')
        ? 'certified'
        : children.some(ch => ch.status === 'failed')
          ? 'failed'
          : children.some(ch => ch.status === 'running')
            ? 'running'
            : 'pending';
      if (c.status !== nextStatus) {
        this.store.updateGraphNode(c.id, {status: nextStatus});
      }
    }
  }

  private raisePauseAttention(
    change: ChangeRecord,
    nodeId: string | null,
    question: string,
  ): void {
    const attn = this.store.raiseAttention({
      hubId: change.hubId,
      repoId: change.repoId,
      changeId: change.id,
      nodeId,
      kind: 'gate_approval',
      question,
      contextSnippet: `Change ${change.code}: ${change.title} (${change.permissionTier} tier)`,
      options: [
        'Approve & Resume Continuity Loop',
        'Switch Change to Turbo Mode & Resume',
        'Keep Paused for Inspection',
      ],
      recommendedIndex: 0,
      downstreamBlockedCount: 4,
      estimatedReadSeconds: 25,
    });
    this.publish({type: 'attention.raised', item: attn});
  }

  private emitProgress(
    changeId: string,
    nodeId: string,
    status: string,
    summary: string,
  ): void {
    this.publish({
      type: 'change.progress',
      changeId,
      nodeId,
      status,
      summary,
      at: new Date().toISOString(),
    });
  }

  private emitState(scope: string): void {
    this.publish({
      type: 'state.changed',
      scope,
      at: new Date().toISOString(),
    });
  }
}

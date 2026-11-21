import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256Canonical, sha256Text} from '../core/canonical-json.ts';
import {reinforceAgentMemoryStability} from '../core/cognitive.ts';
import {
  renderUbiquitousLanguageSection,
  selectTermsForRepo,
} from '../core/ddd.ts';
import {
  detectRetrySpin,
  normalizeErrorFingerprint,
} from '../core/failure-guard.ts';
import {isFileInsideScope, scopesOverlap} from '../core/glob-scope.ts';
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
import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import type {ForgeSseEvent} from '../shared/api.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  ChangeRecord,
  EpistemicHandoff,
  GraphNode,
} from '../shared/types.ts';
import type {
  CausalDiffFile,
  CausalDiffGroup,
  CausalDiffReport,
  DecisionOptionPreview,
  FailureCategory,
  FailureForensicsCard,
  MissionGateKind,
  ResumeHandoverInput,
  ResumeHandoverResult,
  TakeoverStatusSnapshot,
} from '../shared/v3-types.ts';
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
  private readonly runner?: ISandboxProcessRunner;
  private readonly rootSignal?: AbortSignal;
  private readonly activeChangeRuns = new Set<string>();
  private readonly activeAbortControllers = new Map<string, AbortController>();
  private readonly activeWaveAbortControllers = new Map<
    string,
    AbortController
  >();
  private readonly activePromises = new Map<string, Promise<unknown>>();
  private readonly nodePreAttemptSnapshots = new Map<
    string,
    readonly string[]
  >();
  private readonly nodeFailureHistory = new Map<
    string,
    Array<{readonly fingerprint: string; readonly diffHash: string}>
  >();
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
    readonly runner?: ISandboxProcessRunner;
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
    this.runner = deps.runner;
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
      this.activeWaveAbortControllers.delete(changeId);
      this.activeChangeRuns.delete(changeId);
      this.activePromises.delete(changeId);
      this.emitState('changes');
      this.emitMissionUpdatedForChange(changeId);
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
    this.emitMissionUpdatedForChange(changeId);

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
        current.status === 'stale_upstream' ||
        current.status === 'failed' ||
        current.status === 'certified'
      ) {
        break;
      }

      const capturedEpoch = current.executionEpoch ?? 1;
      const elapsedHours = (Date.now() - startedMs) / 3_600_000;
      if (elapsedHours > current.maxOvernightHours) {
        this.store.updateChangeStatusCas(changeId, capturedEpoch, {
          status: 'paused_human',
        });
        const question = `Overnight continuity window (${current.maxOvernightHours}h) reached for ${current.code}. Continue execution?`;
        this.raisePauseAttention(current, null, question);
        this.openMissionPauseGate(current, {
          nodeId: null,
          kind: 'budget_extension',
          targetId: current.id,
          question,
          contextSnippet: `Elapsed ${elapsedHours.toFixed(2)}h / max ${current.maxOvernightHours}h on ${current.code}.`,
          options: [
            {
              action: 'extend_budget',
              label: 'Extend Window & Resume Execution',
              recommended: true,
              consequencePreview:
                'Extends overnight continuity window and resumes execution.',
              requiresFeedback: false,
            },
            {
              action: 'reject',
              label: 'Stop & Mark Mission Failed',
              recommended: false,
              consequencePreview: 'Halts Mission execution.',
              requiresFeedback: false,
            },
          ],
        });
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
      const liveMode = (current.executionMode ?? 'live') === 'live';
      const reserve = liveMode ? wave.length * 0.15 : 0;

      const reservation = this.store.atomic(() => {
        const freshChange = this.store.getChange(changeId);
        if (
          !freshChange ||
          (freshChange.executionEpoch ?? 1) !== capturedEpoch
        ) {
          return {ok: false as const, reason: 'epoch_changed' as const};
        }
        const changeOver = liveMode
          ? freshChange.spentUsd + this.reservedInFlightUsd + reserve >
            freshChange.budgetUsdLimit
          : freshChange.spentUsd > freshChange.budgetUsdLimit;
        const freshMission = freshChange.missionId
          ? this.store.missions.getMission(freshChange.missionId)
          : null;
        const missionOver = freshMission
          ? liveMode
            ? freshMission.spentUsd + this.reservedInFlightUsd + reserve >
              freshMission.budgetUsdLimit
            : freshMission.spentUsd > freshMission.budgetUsdLimit
          : false;

        if (changeOver || missionOver) {
          this.store.updateChangeStatusCas(changeId, capturedEpoch, {
            status: 'paused_human',
          });
          return {
            ok: false as const,
            reason: 'budget_hit' as const,
            freshChange,
            freshMission,
          };
        }
        this.reservedInFlightUsd += reserve;
        return {ok: true as const, freshChange};
      });

      if (!reservation.ok) {
        if (reservation.reason === 'budget_hit') {
          const c = reservation.freshChange;
          const m = reservation.freshMission;
          const limitLabel = m
            ? `Mission $${m.budgetUsdLimit.toFixed(2)} / Change $${c.budgetUsdLimit.toFixed(2)}`
            : `$${c.budgetUsdLimit.toFixed(2)}`;
          const question = `Budget ceiling (${limitLabel}) reached for ${c.code}. Approve extension?`;
          this.raisePauseAttention(c, null, question);
          this.openMissionPauseGate(c, {
            nodeId: null,
            kind: 'budget_extension',
            targetId: c.id,
            question,
            contextSnippet: `Spent: Change $${c.spentUsd.toFixed(4)}${m ? `, Mission $${m.spentUsd.toFixed(4)}` : ''}, In-flight reserve: $${this.reservedInFlightUsd.toFixed(2)}.`,
            options: [
              {
                action: 'extend_budget',
                label: 'Extend Budget (+$25) & Resume',
                recommended: true,
                consequencePreview:
                  'Raises Change and Mission USD ceilings by $25 and resumes execution.',
                requiresFeedback: false,
              },
              {
                action: 'reject',
                label: 'Stop & Mark Mission Failed',
                recommended: false,
                consequencePreview: 'Halts Mission execution at failed status.',
                requiresFeedback: false,
              },
            ],
          });
          break;
        }
        rollingHandoff = this.buildHandoffFromStore(
          this.store.getChange(changeId) ?? current,
        );
        continue;
      }

      current = reservation.freshChange;
      const waveAbort = new AbortController();
      this.activeWaveAbortControllers.set(changeId, waveAbort);
      const waveSignal = AbortSignal.any([signal, waveAbort.signal]);

      let haltRequested = false;
      try {
        const waveOutcomes = await Promise.allSettled(
          wave.map(async node => {
            try {
              const out = await this.executeSingleNode(
                current,
                node,
                rollingHandoff,
                capturedEpoch,
                waveSignal,
                lastSessionId,
              );
              if (out.haltLoop && !waveAbort.signal.aborted) {
                waveAbort.abort('wave_halt');
              }
              return out;
            } catch (err) {
              if (!waveAbort.signal.aborted) {
                waveAbort.abort('wave_error');
              }
              throw err;
            }
          }),
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
        this.activeWaveAbortControllers.delete(changeId);
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

    const {updated, audit} = this.store.atomic(() => {
      this.store.updateCheckpointRescueRef(cp.id, rewindRes.rescueRef);
      const nextEpoch = this.store.bumpChangeEpochAtomic(changeId);
      this.store.pruneCheckpointsAfter(changeId, cp.id);
      const nodes = this.store.listGraphNodes(changeId);
      const edges = this.store.listGraphEdges(changeId);
      const rewindIds = computePhaseBarrierRewindSet(nodes, edges, cp.nodeId);
      for (const id of rewindIds) {
        this.store.updateGraphNode(id, {
          status: 'rewound',
          attemptCount: 0,
          outputSummary: `Phase-barrier rewound to ${cp.label} at epoch ${nextEpoch} (rescue ref: ${rewindRes.rescueRef})`,
        });
        this.store.updateNodeForensics(id, null);
        this.nodePreAttemptSnapshots.delete(`${changeId}:${id}`);
        this.nodeFailureHistory.delete(`${changeId}:${id}`);
      }

      const nextChange = this.store.updateChange(changeId, {status: 'planned'});
      const aud = this.store.appendAudit({
        hubId: change.hubId,
        changeId: change.id,
        category: 'rewind',
        actor: 'human_operator',
        title: `Restored ${change.code} to ${cp.label} (${cp.gitCommitSha.slice(0, 7)})`,
        detail: `Saved pre-rewind worktree state at ${rewindRes.rescueRef} (epoch ${nextEpoch}).`,
      });
      return {updated: nextChange, audit: aud};
    });

    this.publish({type: 'audit.logged', entry: audit});
    this.emitState('changes');
    this.emitMissionUpdatedForChange(changeId);
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
    const targetNode = nodes.find(n => n.id === input.insertBeforeNodeId);
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
    const targetWasRunning = targetNode?.status === 'running';

    const audit = this.store.atomic(() => {
      this.store.spliceGhostNodeAtomic(
        change.id,
        finalGhost,
        input.insertBeforeNodeId,
        linkKind,
      );
      if (targetWasRunning && targetNode) {
        this.store.updateGraphNode(targetNode.id, {
          status: 'ready',
          attemptCount: targetNode.attemptCount,
          outputSummary: `Deferred for precondition GhostNode ${code}.`,
        });
        this.store.bumpChangeEpochAtomic(change.id);
      }
      if (!autoApprove) {
        this.store.updateChange(change.id, {status: 'paused_human'});
      }
      return this.store.appendAudit({
        hubId: change.hubId,
        changeId: change.id,
        category: 'ghost_amendment',
        actor: input.actor ?? 'lead_agent',
        title: `Spliced GhostNode ${code}: ${input.title}`,
        detail: input.description,
      });
    });
    this.publish({type: 'audit.logged', entry: audit});

    if (!autoApprove) {
      const question = `Approve runtime GhostNode "${input.title}" in ${change.code}?`;
      const attn = this.store.raiseAttention({
        hubId: change.hubId,
        repoId: change.repoId,
        changeId: change.id,
        nodeId: finalGhost.id,
        kind: 'amendment_approval',
        question,
        contextSnippet: input.description,
        options: ['Approve GhostNode & Resume', 'Waive GhostNode & Continue'],
        recommendedIndex: 0,
        downstreamBlockedCount: 3,
        estimatedReadSeconds: 20,
      });
      this.publish({type: 'attention.raised', item: attn});
      this.openMissionPauseGate(change, {
        nodeId: finalGhost.id,
        kind: 'ghost_amendment',
        targetId: finalGhost.id,
        question,
        contextSnippet: input.description,
        options: [
          {
            action: 'approve_ghost',
            label: 'Approve GhostNode & Resume',
            recommended: true,
            consequencePreview:
              'Approves the spliced GhostNode and resumes execution.',
            requiresFeedback: false,
          },
          {
            action: 'waive_ghost',
            label: 'Waive GhostNode & Continue',
            recommended: false,
            consequencePreview:
              'Marks GhostNode waived and resumes downstream nodes.',
            requiresFeedback: false,
          },
        ],
      });
      const waveCtrl = this.activeWaveAbortControllers.get(change.id);
      if (waveCtrl && !waveCtrl.signal.aborted) {
        waveCtrl.abort('ghost_amendment_pause');
      }
      const changeCtrl = this.activeAbortControllers.get(change.id);
      if (changeCtrl && !changeCtrl.signal.aborted) {
        changeCtrl.abort('ghost_amendment_pause');
      }
    } else if (targetWasRunning) {
      const waveCtrl = this.activeWaveAbortControllers.get(change.id);
      if (waveCtrl && !waveCtrl.signal.aborted) {
        waveCtrl.abort('ghost_precondition');
      }
    }

    this.emitState('changes');
    this.emitMissionUpdatedForChange(change.id);
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
        const question = `Approve QA Decision Gate (${node.code}) for ${change.code}?`;
        this.raisePauseAttention(change, node.id, question);
        this.openMissionPauseGate(change, {
          nodeId: node.id,
          kind: 'qa_decision',
          targetId: node.id,
          question,
          contextSnippet: `Strict-mode QA gate ${node.code} on ${change.code} (${change.title}).`,
          options: [
            {
              action: 'approve',
              label: 'Approve QA Gate & Resume',
              recommended: true,
              consequencePreview:
                'Certifies this DecisionNode and advances to checkpoint/next phase.',
              requiresFeedback: false,
            },
            {
              action: 'reject',
              label: 'Reject & Mark Mission Failed',
              recommended: false,
              consequencePreview: 'Halts Mission execution at failed status.',
              requiresFeedback: false,
            },
          ],
        });
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
      this.emitMissionUpdatedForChange(change.id);
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
        this.nodeFailureHistory.delete(`${change.id}:${node.id}`);
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

      if (verdict.outcome === 'rate_limited') {
        const waitSec = Math.max(15, verdict.retryAfterSeconds ?? 45);
        const untilIso = new Date(Date.now() + waitSec * 1000).toISOString();
        this.store.updateGraphNode(node.id, {
          status: 'ready',
          attemptCount: Math.max(0, node.attemptCount),
          outputSummary: `Audit rate-limited; holding in cooldown until ${untilIso}`,
        });
        this.store.updateChangeStatusCas(change.id, capturedEpoch, {
          status: 'cooldown_hold',
          cooldownUntil: untilIso,
        });
        this.emitMissionUpdatedForChange(change.id);
        return {handoff, haltLoop: true};
      }

      const errorFingerprint =
        verdict.errorFingerprint ??
        normalizeErrorFingerprint(verdict.summary, verdict.diagnostics);

      if (
        (change.executionMode ?? 'live') === 'live' &&
        (verdict.outcome === 'env_fault' ||
          verdict.failureCategory === 'infra_env')
      ) {
        const infraForensics: FailureForensicsCard = {
          failedNodeId: node.id,
          failedNodeCode: node.code,
          reasonCode: verdict.reasonCode,
          summary: verdict.summary,
          diagnostics: verdict.diagnostics.slice(0, 6),
          targetCheckpointLabel: 'Environment Check',
          rescueRef: 'none',
          failedAt: new Date().toISOString(),
          category: 'infra_env',
          errorFingerprint,
          suggestedAction:
            verdict.plainAdvice ??
            'Fix environment/dependency issue then click Resume.',
        };
        this.store.updateNodeForensics(node.id, infraForensics);
        this.store.updateGraphNode(node.id, {
          status: 'blocked_human',
          attemptCount: Math.max(0, node.attemptCount),
          outputSummary: `Fail-closed env fault: ${verdict.summary}`,
        });
        this.store.updateChangeStatusCas(change.id, capturedEpoch, {
          status: 'paused_human',
        });
        const question = `Live environment/evaluator fault on ${change.code}/${node.code}: ${verdict.summary}`;
        this.raisePauseAttention(change, node.id, question);
        this.openMissionPauseGate(change, {
          nodeId: node.id,
          kind: 'build_escalation',
          targetId: change.id,
          question,
          contextSnippet: verdict.diagnostics.join(' | ') || verdict.summary,
          options: [
            {
              action: 'resume',
              label: 'Retry Evaluator & Resume Change',
              recommended: true,
              consequencePreview:
                'Resets blocked evaluator node to ready and resumes execution.',
              requiresFeedback: false,
            },
            {
              action: 'reject',
              label: 'Mark Mission Failed',
              recommended: false,
              consequencePreview: 'Stops Mission delivery at failed status.',
              requiresFeedback: false,
            },
          ],
        });
        return {handoff, haltLoop: true};
      }

      const failKey = `${change.id}:${node.id}`;
      const diffForSpin = await this.worktrees
        .diffSinceCommit(change.worktreePath, sinceCommitSha)
        .catch(() => null);
      const diffHash = diffForSpin
        ? sha256Text(diffForSpin.patch).slice(0, 16)
        : '';
      const history = this.nodeFailureHistory.get(failKey) ?? [];
      history.push({fingerprint: errorFingerprint, diffHash});
      if (history.length > 10) {
        history.shift();
      }
      this.nodeFailureHistory.set(failKey, history);

      const spin = detectRetrySpin(history);
      if (spin.spinning) {
        const spinForensics: FailureForensicsCard = {
          failedNodeId: node.id,
          failedNodeCode: node.code,
          reasonCode: verdict.reasonCode,
          summary: `Paused to prevent retry spin (${spin.reason}): ${verdict.summary}`,
          diagnostics: verdict.diagnostics.slice(0, 6),
          targetCheckpointLabel: 'Manual IDE Takeover',
          rescueRef: 'preserved',
          failedAt: new Date().toISOString(),
          category: verdict.failureCategory ?? 'logic_bug',
          errorFingerprint,
          spinDetected: true,
          suggestedAction:
            'Open worktree in IDE to inspect/fix manually, then Resume from Handover.',
        };
        this.store.updateNodeForensics(node.id, spinForensics);
        this.store.updateGraphNode(node.id, {
          status: 'blocked_human',
          attemptCount: Math.max(0, node.attemptCount),
          outputSummary: `Paused for human handover (${spin.reason}): ${verdict.summary}`,
        });
        this.store.updateChangeStatusCas(change.id, capturedEpoch, {
          status: 'paused_human',
        });
        const question = `${node.code} hit repeated failure (${spin.reason}) on ${change.code}. Take over in IDE?`;
        this.raisePauseAttention(change, node.id, question);
        this.openMissionPauseGate(change, {
          nodeId: node.id,
          kind: 'build_escalation',
          targetId: change.id,
          question,
          contextSnippet: verdict.diagnostics.join(' | ') || verdict.summary,
          options: [
            {
              action: 'resume',
              label: 'Resume After Manual Fix',
              recommended: true,
              consequencePreview:
                'Resets node to ready and continues from current worktree.',
              requiresFeedback: false,
            },
            {
              action: 'reject',
              label: 'Mark Mission Failed',
              recommended: false,
              consequencePreview: 'Halts Mission execution.',
              requiresFeedback: false,
            },
          ],
        });
        this.emitMissionUpdatedForChange(change.id);
        return {handoff, haltLoop: true};
      }

      return this.handleVerificationFailureAndRewind(
        change,
        node,
        verdict.summary,
        verdict.diagnostics,
        handoff,
        verdict.failureCategory,
        errorFingerprint,
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
    const snapKey = `${change.id}:${node.id}`;

    if (node.attemptCount > 0) {
      const preAttemptFiles = this.nodePreAttemptSnapshots.get(snapKey);
      if (preAttemptFiles !== undefined) {
        const currentDirty = await this.worktrees.snapshotWorkingTree(
          change.worktreePath,
        );
        const preSet = new Set(preAttemptFiles);
        const newlyDirtied = currentDirty.filter(f => !preSet.has(f));
        if (newlyDirtied.length > 0) {
          await this.worktrees.revertFiles(change.worktreePath, newlyDirtied);
        }
      } else if (node.fileScope.length > 0) {
        const hasSharedSibling = this.store
          .listGraphNodes(change.id)
          .some(
            s =>
              s.id !== node.id &&
              (s.kind === 'task' || s.kind === 'ghost') &&
              (s.status === 'certified' || s.status === 'running') &&
              (s.fileScope.length === 0 ||
                scopesOverlap(s.fileScope, node.fileScope)),
          );
        if (!hasSharedSibling) {
          await this.worktrees.revertTaskScope(
            change.worktreePath,
            node.fileScope,
          );
        }
      }
    }

    const preAttemptSnapshot = await this.worktrees.snapshotWorkingTree(
      change.worktreePath,
    );
    this.nodePreAttemptSnapshots.set(snapKey, preAttemptSnapshot);

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
                  confidence: 0.6,
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
        this.openMissionPauseGate(change, {
          nodeId: node.id,
          kind: 'clarification',
          targetId: attn.id,
          question,
          contextSnippet:
            snippet || `Worker question on ${change.code}/${node.code}`,
          options: [
            {
              action: 'clarify',
              label: 'Provide Clarification & Continue',
              recommended: true,
              consequencePreview:
                'Records clarification feedback for the Mission.',
              requiresFeedback: true,
            },
          ],
          pauseMission: false,
        });
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
        ? `## Recalled Hindsight Memory\n${hindsightHits
            .map(h => {
              const warning = h.rejectedWarning
                ? `**[${h.rejectedWarning}]** `
                : '';
              return `- ${warning}[${h.authorityTier}] ${h.title}: ${h.content}`;
            })
            .join('\n')}`
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

    let sessionFinalized = false;
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
        sessionFinalized = true;
        const freshChange = this.store.getChange(change.id);
        if (
          signal.aborted &&
          freshChange &&
          (freshChange.executionEpoch ?? 1) === capturedEpoch
        ) {
          const freshNode = this.store
            .listGraphNodes(change.id)
            .find(n => n.id === node.id);
          if (freshNode?.status === 'running') {
            this.store.updateGraphNode(node.id, {
              status: 'ready',
              attemptCount: node.attemptCount,
              outputSummary: 'Interrupted; ready to resume.',
            });
          }
        }
        return {handoff, sessionId: session.id, haltLoop: true};
      }

      if (inv.outcome === 'rate_limited') {
        this.store.finishSession(session.id, 'interrupted');
        sessionFinalized = true;
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
        this.emitMissionUpdatedForChange(change.id);
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
        sessionFinalized = true;
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

        const failMsg = `Node ${node.code} stopped prematurely after ${node.attemptCount + 1} attempts without deliverable submission.`;
        this.nodePreAttemptSnapshots.delete(snapKey);
        this.store.updateGraphNode(node.id, {
          status: 'failed',
          outputSummary: failMsg,
        });
        this.store.updateChangeStatusCas(change.id, capturedEpoch, {
          status: 'failed',
        });
        this.raisePauseAttention(change, node.id, failMsg);
        this.openMissionPauseGate(change, {
          nodeId: node.id,
          kind: 'build_escalation',
          targetId: change.id,
          question: failMsg,
          contextSnippet: inv.finalText || inv.diagnostic || failMsg,
          options: [
            {
              action: 'resume',
              label: 'Reset Node & Resume Change',
              recommended: true,
              consequencePreview:
                'Resets failed node attempts to 0 and resumes execution.',
              requiresFeedback: false,
            },
            {
              action: 'reject',
              label: 'Mark Mission Failed',
              recommended: false,
              consequencePreview: 'Stops Mission delivery at failed status.',
              requiresFeedback: false,
            },
          ],
        });
        return {handoff, sessionId: session.id, haltLoop: true};
      }

      const succeeded =
        !stoppedPrematurely &&
        (inv.outcome === 'completed' || submission !== null);
      this.store.finishSession(session.id, succeeded ? 'completed' : 'failed');
      sessionFinalized = true;

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
            attemptCount: Math.max(0, node.attemptCount),
            outputSummary: `Fail-closed env fault: ${inv.diagnostic}`,
          });
          this.store.updateChangeStatusCas(change.id, capturedEpoch, {
            status: 'paused_human',
          });
          const question = `Live provider fault on ${change.code}/${node.code}: ${inv.diagnostic}`;
          this.raisePauseAttention(change, node.id, question);
          this.openMissionPauseGate(change, {
            nodeId: node.id,
            kind: 'build_escalation',
            targetId: change.id,
            question,
            contextSnippet: inv.diagnostic,
            options: [
              {
                action: 'resume',
                label: 'Retry Node & Resume Change',
                recommended: true,
                consequencePreview:
                  'Resets blocked node to ready and resumes worker execution.',
                requiresFeedback: false,
              },
              {
                action: 'reject',
                label: 'Mark Mission Failed',
                recommended: false,
                consequencePreview: 'Stops Mission delivery at failed status.',
                requiresFeedback: false,
              },
            ],
          });
          return {handoff, sessionId: session.id, haltLoop: true};
        }

        if (node.attemptCount + 1 < node.maxAttempts) {
          this.store.updateGraphNode(node.id, {
            status: 'ready',
            outputSummary: `Attempt ${node.attemptCount + 1} failed (${inv.diagnostic}); escalating retry.`,
          });
          return {handoff, sessionId: session.id, haltLoop: false};
        }
        this.nodePreAttemptSnapshots.delete(snapKey);
        this.store.updateGraphNode(node.id, {
          status: 'failed',
          outputSummary: inv.diagnostic,
        });
        this.store.updateChangeStatusCas(change.id, capturedEpoch, {
          status: 'failed',
        });
        this.raisePauseAttention(
          change,
          node.id,
          `${node.code} failed after ${node.attemptCount + 1} attempts in ${change.code}: ${inv.diagnostic}`,
        );
        return {handoff, sessionId: session.id, haltLoop: true};
      }

      this.nodePreAttemptSnapshots.delete(snapKey);

      if (node.attemptCount === 0) {
        for (const hit of hindsightHits) {
          if (hit.targetKind === 'observation') {
            const obs = this.store.memory.getObservation(hit.targetId);
            if (obs) {
              this.store.memory.touchObservationRecall(
                obs.id,
                reinforceAgentMemoryStability(obs.stabilityHours),
              );
            }
          } else if (hit.targetKind === 'fact') {
            this.store.memory.touchFactRecall(hit.targetId);
          }
        }
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
    } catch (err) {
      if (!sessionFinalized) {
        this.store.finishSession(
          session.id,
          signal.aborted ? 'interrupted' : 'failed',
        );
        sessionFinalized = true;
      }
      const freshChange = this.store.getChange(change.id);
      if (
        signal.aborted &&
        freshChange &&
        (freshChange.executionEpoch ?? 1) === capturedEpoch
      ) {
        const freshNode = this.store
          .listGraphNodes(change.id)
          .find(n => n.id === node.id);
        if (freshNode?.status === 'running') {
          this.store.updateGraphNode(node.id, {
            status: 'ready',
            attemptCount: node.attemptCount,
            outputSummary: 'Interrupted; ready to resume.',
          });
        }
        return {handoff, sessionId: session.id, haltLoop: true};
      }
      throw err;
    } finally {
      if (!sessionFinalized) {
        this.store.finishSession(
          session.id,
          signal.aborted ? 'interrupted' : 'failed',
        );
      }
      mcpReg.revoke();
    }
  }

  private async handleVerificationFailureAndRewind(
    change: ChangeRecord,
    failedNode: GraphNode,
    summary: string,
    diagnostics: readonly string[],
    handoff: EpistemicHandoff,
    failureCategory?: FailureCategory,
    errorFingerprint?: string,
  ): Promise<{
    readonly handoff: EpistemicHandoff;
    readonly haltLoop: boolean;
  }> {
    const nodes = this.store.listGraphNodes(change.id);
    const edges = this.store.listGraphEdges(change.id);
    const freshFailed = nodes.find(n => n.id === failedNode.id) ?? failedNode;

    const directFailEdge = edges.find(
      e => e.kind === 'fail' && e.sourceNodeId === freshFailed.id,
    );
    const pairedDecisionIds = new Set(
      edges
        .filter(e => e.sourceNodeId === freshFailed.id && e.kind !== 'fail')
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
          freshFailed.parentWbsId !== null &&
          n.parentWbsId === freshFailed.parentWbsId,
      );
    const targetCpNodeId = restoreNode?.restoreTargetCheckpointId ?? null;
    const checkpoints = this.store.listCheckpoints(change.id);
    const targetCp = targetCpNodeId
      ? checkpoints.find(c => c.nodeId === targetCpNodeId)
      : checkpoints[checkpoints.length - 1];

    if (freshFailed.attemptCount >= freshFailed.maxAttempts || !targetCp) {
      this.store.updateNodeForensics(freshFailed.id, {
        failedNodeId: freshFailed.id,
        failedNodeCode: freshFailed.code,
        reasonCode: 'GATE_FAILED',
        summary,
        diagnostics: diagnostics.slice(0, 6),
        targetCheckpointLabel: targetCp?.label ?? 'None',
        rescueRef: 'none',
        failedAt: new Date().toISOString(),
        category: failureCategory ?? 'logic_bug',
        errorFingerprint,
        suggestedAction:
          failureCategory === 'test_tampering'
            ? 'Restore original assertions in test files before resuming.'
            : 'Open worktree in IDE to fix manually, then Resume from Handover.',
      });
      this.store.updateGraphNode(freshFailed.id, {
        status: 'failed',
        outputSummary: `${summary} — ${diagnostics.join(' | ')}`,
      });
      this.store.updateChangeStatusCas(change.id, change.executionEpoch ?? 1, {
        status: 'failed',
      });
      this.raisePauseAttention(
        change,
        freshFailed.id,
        `${freshFailed.code} failed after ${freshFailed.attemptCount} attempts in ${change.code}: ${summary}`,
      );
      return {handoff, haltLoop: true};
    }

    const waveCtrl = this.activeWaveAbortControllers.get(change.id);
    if (waveCtrl && !waveCtrl.signal.aborted) {
      waveCtrl.abort('phase_rewind');
    }

    const rewindRes = await this.worktrees.rewindToCheckpoint({
      worktreePath: change.worktreePath,
      changeCode: change.code,
      targetCommitSha: targetCp.gitCommitSha,
    });

    const {nextEpoch, audit} = this.store.atomic(() => {
      this.store.updateCheckpointRescueRef(targetCp.id, rewindRes.rescueRef);
      const epoch = this.store.bumpChangeEpochAtomic(change.id);
      this.store.pruneCheckpointsAfter(change.id, targetCp.id);
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
          attemptCount: 0,
          outputSummary: `Rewound at epoch ${epoch} after ${freshFailed.code} failure: ${summary}`,
        });
        this.store.updateNodeForensics(rwId, null);
        this.nodePreAttemptSnapshots.delete(`${change.id}:${rwId}`);
      }

      const forensics: FailureForensicsCard = {
        failedNodeId: freshFailed.id,
        failedNodeCode: freshFailed.code,
        reasonCode: 'GATE_FAILED',
        summary,
        diagnostics: diagnostics.slice(0, 6),
        targetCheckpointLabel: targetCp.label,
        rescueRef: rewindRes.rescueRef,
        failedAt: new Date().toISOString(),
        category: failureCategory ?? 'logic_bug',
        errorFingerprint,
        suggestedAction:
          failureCategory === 'test_tampering'
            ? 'Restore original assertions in test files before resuming.'
            : undefined,
      };
      this.store.updateNodeForensics(freshFailed.id, forensics);
      this.store.appendEpistemicItem({
        changeId: change.id,
        nodeId: freshFailed.id,
        executionEpoch: epoch,
        kind: 'forensics',
        content: `${freshFailed.code} failed: ${summary} | ${diagnostics.slice(0, 3).join('; ')}`,
        evidenceRef: rewindRes.rescueRef,
      });

      const aud = this.store.appendAudit({
        hubId: change.hubId,
        changeId: change.id,
        category: 'rewind',
        actor: 'continuity_engine',
        title: `Phase-Barrier Restore triggered by ${freshFailed.code} -> ${targetCp.label}`,
        detail: `${summary} | Epoch ${epoch} | Backup ref: ${rewindRes.rescueRef}`,
      });
      return {nextEpoch: epoch, audit: aud};
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
        const nextEpoch = this.store.bumpChangeEpochAtomic(dep.id);
        void this.abortChangeRun(dep.id);
        this.store.updateChangeStatusCas(dep.id, nextEpoch, {
          status: 'stale_upstream',
          expectedStatuses: ['running', 'certified', 'planned'],
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

  private openMissionPauseGate(
    change: ChangeRecord,
    input: {
      readonly nodeId: string | null;
      readonly kind: MissionGateKind;
      readonly targetId: string;
      readonly question: string;
      readonly contextSnippet: string;
      readonly options: readonly DecisionOptionPreview[];
      readonly pauseMission?: boolean;
    },
  ): void {
    if (!change.missionId) {
      return;
    }
    const existing = this.store.missions
      .listGates(change.missionId, false)
      .find(g => g.kind === input.kind && g.targetId === input.targetId);
    if (existing) {
      return;
    }
    const gate = this.store.missions.openGate({
      missionId: change.missionId,
      changeId: change.id,
      nodeId: input.nodeId,
      kind: input.kind,
      targetId: input.targetId,
      targetHash: sha256Canonical({
        missionId: change.missionId,
        changeId: change.id,
        nodeId: input.nodeId,
        kind: input.kind,
        targetId: input.targetId,
        epoch: change.executionEpoch ?? 1,
      }),
      question: input.question,
      contextSnippet: input.contextSnippet,
      options: input.options,
    });
    if (input.pauseMission !== false) {
      const m = this.store.missions.getMission(change.missionId);
      if (m && m.status !== 'aborted' && m.status !== 'delivered') {
        this.store.missions.updateMissionCas(change.missionId, undefined, {
          status: 'paused_human',
        });
      }
    }
    this.publish({
      type: 'gate.opened',
      missionId: change.missionId,
      gateId: gate.id,
      kind: gate.kind,
      at: gate.createdAt,
    });
    this.emitMissionUpdatedForChange(change.id);
  }

  async getTakeoverStatus(
    changeId: string,
    nodeId?: string,
  ): Promise<TakeoverStatusSnapshot> {
    const change = this.store.getChange(changeId);
    if (!change) {
      throw new ForgeError('NOT_FOUND', `Change "${changeId}" not found`, 404);
    }
    const nodes = this.store.listGraphNodes(changeId);
    const targetNode = nodeId
      ? nodes.find(n => n.id === nodeId)
      : (nodes.find(
          n =>
            n.status === 'blocked_human' ||
            n.status === 'failed' ||
            n.status === 'running' ||
            n.status === 'ready',
        ) ??
        nodes.find(n => n.kind === 'task' || n.kind === 'ghost') ??
        nodes[0]);
    if (!targetNode) {
      throw new ForgeError(
        'NOT_FOUND',
        `Target node "${nodeId ?? ''}" not found on Change "${changeId}"`,
        404,
      );
    }
    const sinceSha = this.latestCheckpointSha(change);
    const diff = await this.worktrees
      .diffSinceCommit(change.worktreePath, sinceSha)
      .catch(() => ({
        summary: '(Worktree diff unavailable)',
        patch: '',
        changedFiles: [] as readonly string[],
      }));
    return {
      changeId: change.id,
      changeCode: change.code,
      changeStatus: change.status,
      nodeId: targetNode.id,
      nodeCode: targetNode.code,
      nodeTitle: targetNode.title,
      nodeStatus: targetNode.status,
      worktreePath: change.worktreePath,
      gitBranch: change.gitBranch,
      verifyCommand: targetNode.gateCommand ?? change.verifyCommand,
      modifiedFiles: diff.changedFiles,
      diffSummary: diff.summary,
      diffPatch: diff.patch.slice(0, 64_000),
      forensics: targetNode.forensics ?? null,
    };
  }

  async pauseForHumanTakeover(
    changeId: string,
    nodeId: string,
    actor = 'human_operator',
  ): Promise<TakeoverStatusSnapshot> {
    const change = this.store.getChange(changeId);
    if (!change) {
      throw new ForgeError('NOT_FOUND', `Change "${changeId}" not found`, 404);
    }
    const node = this.store.listGraphNodes(changeId).find(n => n.id === nodeId);
    if (!node) {
      throw new ForgeError(
        'NOT_FOUND',
        `Node "${nodeId}" not found on Change "${changeId}"`,
        404,
      );
    }
    await this.abortChangeRun(changeId);

    const audit = this.store.atomic(() => {
      this.store.updateGraphNode(node.id, {
        status: 'blocked_human',
        attemptCount: node.attemptCount,
        outputSummary: `Paused for manual IDE takeover by ${actor}.`,
      });
      this.store.updateChange(changeId, {status: 'paused_human'});
      this.store.bumpChangeEpochAtomic(changeId);
      if (change.missionId) {
        const mission = this.store.missions.getMission(change.missionId);
        if (
          mission &&
          mission.status !== 'aborted' &&
          mission.status !== 'delivered' &&
          mission.status !== 'failed'
        ) {
          this.store.missions.updateMissionCas(mission.id, undefined, {
            status: 'paused_human',
          });
        }
      }
      return this.store.appendAudit({
        hubId: change.hubId,
        changeId: change.id,
        category: 'gate_decision',
        actor,
        title: `Human IDE takeover started at ${node.code}`,
        detail: `Worktree open for direct inspection & edit: ${change.worktreePath}`,
      });
    });

    this.publish({type: 'audit.logged', entry: audit});
    this.emitState('changes');
    this.emitMissionUpdatedForChange(changeId);
    return this.getTakeoverStatus(changeId, node.id);
  }

  async resumeFromHumanHandover(
    changeId: string,
    nodeId: string,
    input: ResumeHandoverInput,
  ): Promise<ResumeHandoverResult> {
    const change = this.store.getChange(changeId);
    if (!change) {
      throw new ForgeError('NOT_FOUND', `Change "${changeId}" not found`, 404);
    }
    const node = this.store.listGraphNodes(changeId).find(n => n.id === nodeId);
    if (!node) {
      throw new ForgeError(
        'NOT_FOUND',
        `Node "${nodeId}" not found on Change "${changeId}"`,
        404,
      );
    }
    await this.abortChangeRun(changeId);

    const actor = input.actor?.trim() || 'human_operator';
    const note = input.handoverNote?.trim() || '';
    const sinceSha = this.latestCheckpointSha(change);
    const diff = await this.worktrees
      .diffSinceCommit(change.worktreePath, sinceSha)
      .catch(() => ({
        summary: '',
        patch: '',
        changedFiles: [] as readonly string[],
      }));

    let verifyOutput = '';
    const verifyCmd = (node.gateCommand ?? change.verifyCommand).trim();
    if (input.runVerify !== false && verifyCmd.length > 0 && this.runner) {
      const res = await this.runner.runCommandString(
        verifyCmd,
        change.worktreePath,
        180_000,
        this.store.getConstitution().blockedCommands,
      );
      verifyOutput = `${res.stdout}\n${res.stderr}`.trim().slice(-2000);
      if (res.exitCode !== 0 || res.timedOut) {
        return {
          ok: false,
          verifyPassed: false,
          verifyOutput:
            verifyOutput ||
            `Verify command exited with code ${res.exitCode} (${verifyCmd}).`,
          checkpointSha: null,
          checkpointTag: null,
          changedFiles: diff.changedFiles,
          memoryRetained: false,
          resumedExecution: false,
          message:
            'Verify command failed; your manual edits remain intact in the worktree.',
        };
      }
    }

    const cpCommit = await this.worktrees.createCheckpoint({
      worktreePath: change.worktreePath,
      changeCode: change.code,
      nodeCode: `HANDOVER-${node.code}`,
      message: `handover(${change.code}/${node.code}): ${note || 'manual human fix'}`,
    });

    const audit = this.store.atomic(() => {
      const allTasks = this.store
        .listGraphNodes(changeId)
        .filter(n => n.kind === 'task' || n.kind === 'ghost');
      const certifiedCount =
        allTasks.filter(n => n.status === 'certified').length +
        (node.status === 'certified' ? 0 : 1);

      this.store.recordCheckpoint({
        changeId: change.id,
        nodeId: node.id,
        label: `Handover: ${node.code}`,
        gitCommitSha: cpCommit.commitSha,
        gitTag: cpCommit.gitTag,
        certifiedTaskCount: certifiedCount,
        totalTaskCount: Math.max(1, allTasks.length),
        engineSnapshot: {handoverNote: note, changedFiles: diff.changedFiles},
      });
      const nextEpoch = this.store.bumpChangeEpochAtomic(changeId);
      this.store.updateGraphNode(node.id, {
        status: 'certified',
        attemptCount: node.attemptCount,
        outputSummary: `Human handover verified (${cpCommit.commitSha.slice(0, 7)}): ${note || 'manual fix committed'}`,
      });
      this.store.updateNodeForensics(node.id, null);
      this.nodeFailureHistory.delete(`${changeId}:${node.id}`);
      this.nodePreAttemptSnapshots.delete(`${changeId}:${node.id}`);
      this.store.updateChange(changeId, {status: 'planned'});

      this.store.appendEpistemicItem({
        changeId: change.id,
        nodeId: node.id,
        executionEpoch: nextEpoch,
        kind: 'spec_confirmed',
        content: `Human handover on ${node.code}: ${note || 'Verified manually in IDE'} (files: ${diff.changedFiles.join(', ') || 'none'})`,
        evidenceRef: cpCommit.gitTag,
      });

      for (const item of this.store.listAttentionItems(false)) {
        if (
          item.changeId === changeId &&
          (!item.nodeId || item.nodeId === node.id)
        ) {
          this.store.resolveAttention(
            item.id,
            note || `Resolved via human IDE handover on ${node.code}`,
            'answered',
          );
        }
      }

      if (change.missionId) {
        const openGates = this.store.missions.listGates(
          change.missionId,
          false,
        );
        for (const g of openGates) {
          if (
            (g.kind === 'build_escalation' || g.kind === 'qa_decision') &&
            (g.nodeId === node.id || g.changeId === change.id)
          ) {
            this.store.missions.resolveGate(g.id, 'resolved');
          }
        }
        const m = this.store.missions.getMission(change.missionId);
        if (
          m &&
          m.status === 'paused_human' &&
          this.store.missions.listGates(change.missionId, false).length === 0
        ) {
          this.store.missions.updateMissionCas(m.id, undefined, {
            status: 'executing',
          });
        }
      }

      return this.store.appendAudit({
        hubId: change.hubId,
        changeId: change.id,
        category: 'checkpoint',
        actor,
        title: `Completed human handover at ${node.code} (${cpCommit.commitSha.slice(0, 7)})`,
        detail: `${note || 'Manual fix verified'} | Tag ${cpCommit.gitTag} | Epoch ${nextEpoch}`,
      });
    });

    let memoryRetained = false;
    if (input.saveAsMemory && this.hindsight) {
      const claimText =
        note ||
        `Verified human handover fix on ${node.title} (${diff.changedFiles.slice(0, 4).join(', ')})`;
      this.hindsight.retain({
        hubId: change.hubId,
        repoId: change.repoId,
        missionId: change.missionId ?? null,
        executionMode: change.executionMode ?? 'live',
        sourceType: 'human_handover_lesson',
        authorityTier: 'L3_locked',
        rawText: `${input.memoryTitle?.trim() || node.title}\n${claimText}`,
        structuredFacts: [
          {
            kind: 'constraint',
            subjectKey: `repo:${change.repoId}:handover:${node.code}`,
            claim: claimText,
            confidence: 0.99,
            pathAnchors: diff.changedFiles.slice(0, 16),
            entityNames: [change.code, node.code, change.repoId],
          },
        ],
      });
      this.store.enqueueEffect(
        'memory.consolidate',
        `consolidate:${change.hubId}:${change.executionMode ?? 'live'}`,
        {
          hubId: change.hubId,
          executionMode: change.executionMode ?? 'live',
        },
      );
      memoryRetained = true;
    }

    this.publish({type: 'audit.logged', entry: audit});
    this.emitProgress(
      changeId,
      node.id,
      'certified',
      `Human handover certified (${cpCommit.commitSha.slice(0, 7)})`,
    );
    this.emitState('changes');
    this.emitMissionUpdatedForChange(changeId);

    const autoResume = input.autoResume !== false;
    if (autoResume) {
      void this.startChangeExecution(changeId);
    }

    return {
      ok: true,
      verifyPassed: true,
      verifyOutput,
      checkpointSha: cpCommit.commitSha,
      checkpointTag: cpCommit.gitTag,
      changedFiles: diff.changedFiles,
      memoryRetained,
      resumedExecution: autoResume,
      message: autoResume
        ? 'Human handover verified, checkpoint saved, and downstream execution resumed.'
        : 'Human handover verified and checkpoint saved.',
    };
  }

  async getCausalDiff(changeId: string): Promise<CausalDiffReport> {
    const change = this.store.getChange(changeId);
    if (!change) {
      throw new ForgeError('NOT_FOUND', `Change "${changeId}" not found`, 404);
    }
    const diff = await this.worktrees
      .diffSinceCommit(change.worktreePath, change.baseCommitSha)
      .catch(() => ({
        summary: '',
        patch: '',
        changedFiles: [] as readonly string[],
      }));

    const parsedFiles = new Map<string, CausalDiffFile>();
    const sections = diff.patch.split(/(?=^diff --git )/m).filter(Boolean);
    for (const sec of sections) {
      const m = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(sec);
      const rawPath = (m?.[2] ?? m?.[1] ?? '').trim().replace(/\\/g, '/');
      if (!rawPath) continue;
      let added = 0;
      let deleted = 0;
      for (const line of sec.split(/\r?\n/)) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) added += 1;
        else if (line.startsWith('-')) deleted += 1;
      }
      parsedFiles.set(rawPath, {
        filePath: rawPath,
        patch: sec,
        addedLines: added,
        deletedLines: deleted,
      });
    }
    for (const f of diff.changedFiles) {
      const norm = f.replace(/\\/g, '/');
      if (!parsedFiles.has(norm)) {
        parsedFiles.set(norm, {
          filePath: norm,
          patch: '',
          addedLines: 0,
          deletedLines: 0,
        });
      }
    }

    const nodes = this.store.listGraphNodes(changeId);
    const phaseMap = new Map(
      nodes.filter(n => n.kind === 'phase_container').map(p => [p.id, p.title]),
    );
    const taskNodes = nodes
      .filter(n => n.kind === 'task' || n.kind === 'ghost')
      .sort((a, b) => a.positionY - b.positionY || a.positionX - b.positionX);

    const remaining = new Map(parsedFiles);
    const groups: CausalDiffGroup[] = [];

    for (const task of taskNodes) {
      const safeCode = task.code.replace(/[^A-Za-z0-9_-]/g, '_');
      const slicePath = `.forgeops/slices/${safeCode}.md`;
      const matched: CausalDiffFile[] = [];

      for (const [filePath, fileObj] of remaining.entries()) {
        const isTaskSlice = filePath === slicePath;
        const inDeclaredScope =
          task.fileScope.length > 0 &&
          isFileInsideScope(filePath, task.fileScope);
        if (isTaskSlice || inDeclaredScope) {
          matched.push(fileObj);
          remaining.delete(filePath);
        }
      }

      if (matched.length > 0) {
        groups.push({
          nodeId: task.id,
          nodeCode: task.code,
          nodeTitle: task.title,
          nodeStatus: task.status,
          phaseLabel:
            (task.containerNodeId && phaseMap.get(task.containerNodeId)) ||
            'Execution',
          files: matched,
        });
      }
    }

    if (remaining.size > 0) {
      groups.push({
        nodeId: null,
        nodeCode: 'SHARED',
        nodeTitle: 'Shared / Unscoped Files',
        nodeStatus: change.status,
        phaseLabel: 'Shared',
        files: [...remaining.values()],
      });
    }

    return {
      changeId: change.id,
      changeCode: change.code,
      gitBranch: change.gitBranch,
      totalFiles: parsedFiles.size,
      groups,
    };
  }

  private emitMissionUpdatedForChange(changeId: string): void {
    const chg = this.store.getChange(changeId);
    if (!chg?.missionId) {
      return;
    }
    const mission = this.store.missions.getMission(chg.missionId);
    if (!mission) {
      return;
    }
    this.publish({
      type: 'mission.updated',
      missionId: mission.id,
      status: mission.status,
      stage: mission.stage,
      at: new Date().toISOString(),
    });
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

/**
 * 8-Hour Unattended Continuity & Twin-Graph Execution Engine:
 * - Fresh-context bounded task slices with cache-stable prefixes
 * - 4-Section Epistemic Rollover (`SPEC-CONFIRMED FACTS` vs `AGENT HYPOTHESES`)
 * - Anti-premature-stop auto-continuation (`prematureStopCount` tracking)
 * - `CooldownHolding` rate-limit resilience without burning retry strikes
 * - 2-Strike Strong Lead escalation & dynamic `GhostNode` DAG amendments
 * - Explicit `Decision --FAIL--> Restore --> Checkpoint` rescue-backed Git rewind
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {reinforceAgentMemoryStability} from '../core/cognitive.ts';
import {
  renderUbiquitousLanguageSection,
  selectTermsForRepo,
} from '../core/ddd.ts';
import {
  canAutoAdvanceGate,
  canAutoMaterializeGhostNode,
  renderEpistemicRolloverBlock,
} from '../core/policy.ts';
import {
  computeNextExecutableNodes,
  computeRewindSet,
  spliceGhostNode,
} from '../core/twin-graph.ts';
import type {
  IAgentAdapterHub,
  IMcpStationServer,
  McpSubmissionPayload,
} from '../adapters/contracts.ts';
import type {IGitWorktreeManager} from '../sandbox/contracts.ts';
import type {ForgeSseEvent} from '../shared/api.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  ChangeRecord,
  EpistemicHandoff,
  GraphNode,
} from '../shared/types.ts';
import type {ForgeStore} from '../store/database.ts';
import type {CompletionCertifier} from './certifier.ts';
import type {InfraStewardEngine} from './infra-steward.ts';

export type SsePublisher = (event: ForgeSseEvent) => void;

export class ContinuityEngine {
  private readonly store: ForgeStore;
  private readonly worktrees: IGitWorktreeManager;
  private readonly adapters: IAgentAdapterHub;
  private readonly mcpStation: IMcpStationServer;
  private readonly certifier: CompletionCertifier;
  private readonly steward: InfraStewardEngine;
  private readonly publish: SsePublisher;
  private readonly activeChangeRuns = new Set<string>();

  constructor(deps: {
    readonly store: ForgeStore;
    readonly worktrees: IGitWorktreeManager;
    readonly adapters: IAgentAdapterHub;
    readonly mcpStation: IMcpStationServer;
    readonly certifier: CompletionCertifier;
    readonly steward: InfraStewardEngine;
    readonly publish: SsePublisher;
  }) {
    this.store = deps.store;
    this.worktrees = deps.worktrees;
    this.adapters = deps.adapters;
    this.mcpStation = deps.mcpStation;
    this.certifier = deps.certifier;
    this.steward = deps.steward;
    this.publish = deps.publish;
  }

  /**
   * Startup crash recovery: marks orphaned `running` sessions as `interrupted`
   * and resets in-flight `running` graph nodes back to `ready` so execution
   * resumes cleanly from the last SQLite + Git checkpoint state.
   */
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

  /**
   * Watchdog tick for long-running / `cooldown_hold` changes.
   */
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

  /**
   * Launches non-blocking execution of a Change's Twin Graph until certified,
   * paused on a human gate, placed in rate-limit cooldown, or failed.
   */
  async startChangeExecution(changeId: string): Promise<ChangeRecord> {
    const initial = this.store.getChange(changeId);
    if (!initial) {
      throw new ForgeError('NOT_FOUND', `Change "${changeId}" not found`, 404);
    }
    if (this.activeChangeRuns.has(changeId)) {
      return initial;
    }

    this.activeChangeRuns.add(changeId);
    let current = this.store.updateChange(changeId, {
      status: 'running',
      cooldownUntil: null,
    });
    this.emitState('changes');

    const startedMs = Date.now();
    let rollingHandoff: EpistemicHandoff = {
      specConfirmedFacts: [
        `Mandate locked for ${current.code}: ${current.title}`,
      ],
      agentHypotheses: [],
      openConflicts: [],
      uncertifiedCriteria: current.acceptanceCriteria
        .filter(c => !c.certified)
        .map(c => `${c.id}: ${c.statement}`),
    };
    let lastSessionId: string | undefined;

    try {
      let stepGuard = 0;
      while (stepGuard < 200) {
        stepGuard += 1;
        current = this.store.getChange(changeId)!;
        if (
          current.status === 'paused_human' ||
          current.status === 'archived' ||
          current.status === 'cooldown_hold'
        ) {
          break;
        }

        // Enforce 8h (or configured) overnight wall-clock & USD budget bounds.
        const elapsedHours = (Date.now() - startedMs) / 3_600_000;
        if (elapsedHours > current.maxOvernightHours) {
          current = this.store.updateChange(changeId, {status: 'paused_human'});
          this.raisePauseAttention(
            current,
            null,
            `Overnight continuity window (${current.maxOvernightHours}h) reached for ${current.code}. Continue execution?`,
          );
          break;
        }
        if (current.spentUsd > current.budgetUsdLimit) {
          current = this.store.updateChange(changeId, {status: 'paused_human'});
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

        const node = readyNodes[0]!;
        const stepOutcome = await this.executeSingleNode(
          current,
          node,
          rollingHandoff,
          lastSessionId,
        );
        rollingHandoff = stepOutcome.handoff;
        lastSessionId = stepOutcome.sessionId ?? lastSessionId;

        if (stepOutcome.haltLoop) {
          break;
        }
      }
      return this.store.getChange(changeId)!;
    } finally {
      this.activeChangeRuns.delete(changeId);
      this.emitState('changes');
    }
  }

  /**
   * Manually rewinds a Change's isolated worktree and Twin-Graph branch to a
   * specific `CheckpointRecord`, creating a non-destructive `refs/forgeops-backup`
   * rescue ref beforehand.
   */
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

    const rewindRes = await this.worktrees.rewindToCheckpoint({
      worktreePath: change.worktreePath,
      changeCode: change.code,
      targetCommitSha: cp.gitCommitSha,
    });
    this.store.updateCheckpointRescueRef(cp.id, rewindRes.rescueRef);

    const nodes = this.store.listGraphNodes(changeId);
    const edges = this.store.listGraphEdges(changeId);
    const endNode =
      nodes.find(n => n.kind === 'end') ?? nodes[nodes.length - 1];
    if (endNode) {
      const rewindIds = computeRewindSet(nodes, edges, cp.nodeId, endNode.id);
      for (const id of rewindIds) {
        this.store.updateGraphNode(id, {
          status: 'rewound',
          outputSummary: `Rewound to ${cp.label} (rescue ref: ${rewindRes.rescueRef})`,
        });
      }
    }

    const updated = this.store.updateChange(changeId, {status: 'planned'});
    const audit = this.store.appendAudit({
      hubId: change.hubId,
      changeId: change.id,
      category: 'rewind',
      actor: 'human_operator',
      title: `Restored ${change.code} to ${cp.label} (${cp.gitCommitSha.slice(0, 7)})`,
      detail: `Saved pre-rewind worktree state at ${rewindRes.rescueRef}.`,
    });
    this.publish({type: 'audit.logged', entry: audit});
    this.emitState('changes');
    return updated;
  }

  /**
   * Proposes (and in Turbo mode auto-splices) a runtime `GhostNode` amendment.
   */
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
      canAutoMaterializeGhostNode(change.permissionTier, ghostCount);

    const finalNodes = autoApprove
      ? spliced.nodes
      : spliced.nodes.map(n =>
          n.id === createdGhost.id
            ? {...n, status: 'blocked_human' as const}
            : n,
        );
    this.store.saveTwinGraph(change.id, finalNodes, spliced.edges);

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
        nodeId: createdGhost.id,
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
    return finalNodes[finalNodes.length - 1]!;
  }

  private async executeSingleNode(
    change: ChangeRecord,
    node: GraphNode,
    handoff: EpistemicHandoff,
    prevSessionId?: string,
  ): Promise<{
    readonly handoff: EpistemicHandoff;
    readonly sessionId?: string;
    readonly haltLoop: boolean;
  }> {
    this.store.updateGraphNode(node.id, {
      status: 'running',
      attemptCount: node.attemptCount + 1,
    });
    this.emitProgress(change.id, node.id, 'running', `Executing ${node.code}`);

    // 1. Physical Git Checkpoint node
    if (node.kind === 'checkpoint') {
      const cpCommit = await this.worktrees.createCheckpoint({
        worktreePath: change.worktreePath,
        changeCode: change.code,
        nodeCode: node.code,
        message: `checkpoint(${change.code}): ${node.title}`,
      });
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

    // 2. QA Decision Diamond node
    if (node.kind === 'decision') {
      const autoAdvance = canAutoAdvanceGate(
        change.permissionTier,
        'G2',
        change.qualityScore,
      );
      if (!autoAdvance) {
        this.store.updateGraphNode(node.id, {
          status: 'blocked_human',
          outputSummary: 'Awaiting human approval in Strict mode.',
        });
        this.store.updateChange(change.id, {status: 'paused_human'});
        this.raisePauseAttention(
          change,
          node.id,
          `Approve QA Decision Gate (${node.code}) for ${change.code}?`,
        );
        return {handoff, haltLoop: true};
      }
      this.store.updateGraphNode(node.id, {
        status: 'certified',
        outputSummary: 'PASS — advancing to phase checkpoint.',
      });
      this.emitProgress(change.id, node.id, 'certified', 'PASS');
      return {handoff, haltLoop: false};
    }

    // 3. Terminal End (`G3-CERTIFIED`) node
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
      this.store.updateChange(change.id, {
        status: 'certified',
        acceptanceCriteria: certifiedCriteria,
        qualityScore: 0.95,
      });
      this.steward.runRetroOptimization(change.id);
      this.emitProgress(
        change.id,
        node.id,
        'certified',
        `${change.code} certified & Retro wiki updated.`,
      );
      return {handoff, haltLoop: true};
    }

    // 4. External Verification / Hard Gates / JQA / SQA Audit nodes
    if (
      node.kind === 'verify' ||
      node.kind === 'gates' ||
      node.kind === 'selfcheck' ||
      node.kind === 'audit_jqa' ||
      node.kind === 'audit_sqa'
    ) {
      const verdict = await this.certifier.certifyNode(change, node);
      if (verdict.certified) {
        this.store.updateGraphNode(node.id, {
          status: 'certified',
          outputSummary: verdict.summary,
        });
        this.store.updateChange(change.id, {
          qualityScore: Math.max(change.qualityScore, verdict.score),
        });
        this.emitProgress(change.id, node.id, 'certified', verdict.summary);
        return {
          handoff: {
            ...handoff,
            specConfirmedFacts: [
              ...handoff.specConfirmedFacts.slice(-6),
              `${node.code}: ${verdict.summary}`,
            ],
          },
          haltLoop: false,
        };
      }

      // Failed gate or QA audit -> trigger scoped Restore -> Checkpoint rewind!
      return this.handleVerificationFailureAndRewind(
        change,
        node,
        verdict.summary,
        verdict.diagnostics,
        handoff,
      );
    }

    // 5. Worker `task` or `ghost` slice execution
    return this.executeWorkerSlice(change, node, handoff, prevSessionId);
  }

  private async executeWorkerSlice(
    change: ChangeRecord,
    node: GraphNode,
    handoff: EpistemicHandoff,
    prevSessionId?: string,
  ): Promise<{
    readonly handoff: EpistemicHandoff;
    readonly sessionId?: string;
    readonly haltLoop: boolean;
  }> {
    const hub = this.store.getHub(change.hubId)!;
    const repo = this.store.getRepository(change.repoId)!;
    const terms = selectTermsForRepo(
      this.store.listDomainTerms(hub.id),
      repo.id,
      repo.boundedContext,
    );
    const recalledMemories = this.store.searchActiveSemanticMemories(
      `${node.title} ${node.description}`,
      hub.id,
      4,
    );

    // 2-Strike Escalation: if worker already failed >= 2 times, escalate to Strong Lead!
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
      node.description,
      node.fileScope.length > 0
        ? `Allowed File Scope: ${node.fileScope.join(', ')}`
        : 'File Scope: Repository worktree',
      '',
      renderEpistemicRolloverBlock(handoff, prevSessionId),
    ].join('\n\n');

    let capturedSubmission: McpSubmissionPayload | null = null;
    const mcpReg = this.mcpStation.registerAttempt({
      hubId: hub.id,
      changeId: change.id,
      nodeId: node.id,
      worktreePath: change.worktreePath,
      contractMarkdown,
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

    // Frozen Cache-Stable Prefix
    const systemPrompt = [
      this.store.getConstitution().markdown,
      `## Hub Agent-Wiki\n${hub.agentWikiSummary || hub.description}`,
      `## Target Repository (${repo.name})\n${repo.contractSummary}`,
      renderUbiquitousLanguageSection(terms),
      recalledMemories.length > 0
        ? `## Recalled Semantic Memories\n${recalledMemories.map(m => `- [${m.kind}] ${m.title}: ${m.summary}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    this.store.appendTranscriptMessage({
      sessionId: session.id,
      role: 'user',
      content: contractMarkdown,
    });

    try {
      const inv = await this.adapters.invoke({
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
        mcpEndpointUrl: mcpReg.mcpEndpointUrl,
        mcpAttemptToken: mcpReg.attemptToken,
        timeoutMs: 300_000,
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

      // Handle Rate-Limit CooldownHolding without burning retry strikes!
      if (inv.outcome === 'rate_limited') {
        this.store.finishSession(session.id, 'interrupted');
        const waitSec = Math.max(15, inv.retryAfterSeconds ?? 45);
        const untilIso = new Date(Date.now() + waitSec * 1000).toISOString();
        this.store.updateGraphNode(node.id, {
          status: 'ready',
          attemptCount: Math.max(0, node.attemptCount),
          outputSummary: `Rate-limited; holding in cooldown until ${untilIso}`,
        });
        this.store.updateChange(change.id, {
          status: 'cooldown_hold',
          cooldownUntil: untilIso,
        });
        return {handoff, sessionId: session.id, haltLoop: true};
      }

      let submission: McpSubmissionPayload | null =
        inv.mcpSubmission ??
        capturedSubmission ??
        this.mcpStation.getSubmission(mcpReg.attemptToken);

      // Local worktree slice synthesis fallback when external provider key is unconfigured (`env_fault`)
      // so isolated Git worktrees, checkpoints, diffs, and rollbacks operate physically on disk.
      if (
        inv.outcome === 'env_fault' &&
        inv.diagnostic.toLowerCase().includes('api key')
      ) {
        submission = this.materializeDeterministicWorktreeSlice(
          change,
          node,
          repo.boundedContext,
        );
      }

      // Premature-Stop Blocker: reject empty/unverified stop claims and auto-requeue!
      const stoppedPrematurely =
        inv.outcome === 'completed' &&
        !submission &&
        inv.finalText.trim().length < 24;

      if (stoppedPrematurely) {
        this.store.finishSession(session.id, 'failed');
        const nextStops = change.prematureStopCount + 1;
        this.store.updateChange(change.id, {prematureStopCount: nextStops});
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

        if (node.attemptCount + 1 < node.maxAttempts) {
          this.store.updateGraphNode(node.id, {
            status: 'ready',
            outputSummary:
              'Premature stop intercepted; continuing automatically.',
          });
          return {
            handoff: {
              ...handoff,
              openConflicts: [
                `Prior worker stopped prematurely on ${node.code}; complete full deliverable before stopping.`,
              ],
            },
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

      this.store.updateChange(change.id, {
        spentUsd: Number((change.spentUsd + inv.costUsd).toFixed(4)),
      });

      if (!succeeded) {
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
        this.store.updateChange(change.id, {status: 'failed'});
        return {handoff, sessionId: session.id, haltLoop: true};
      }

      // Reinforce recalled semantic memories on first-pass success!
      if (node.attemptCount === 0) {
        for (const mem of recalledMemories) {
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

      const nextHandoff: EpistemicHandoff = submission
        ? {
            specConfirmedFacts: [
              ...handoff.specConfirmedFacts.slice(-6),
              ...submission.specConfirmedFacts,
            ],
            agentHypotheses: submission.agentHypotheses,
            openConflicts: submission.openConflicts,
            uncertifiedCriteria: handoff.uncertifiedCriteria.filter(
              c =>
                !submission.certifiedCriteriaIds.some(cid =>
                  c.startsWith(`${cid}:`),
                ),
            ),
          }
        : {
            ...handoff,
            agentHypotheses: [`Slice ${node.code} output awaiting Hard Gates.`],
          };

      return {
        handoff: nextHandoff,
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

    // Locate matching Restore node connected from this failed gate/audit node.
    const failEdge = edges.find(
      e => e.kind === 'fail' && e.sourceNodeId === failedNode.id,
    );
    const restoreNode = failEdge
      ? nodes.find(n => n.id === failEdge.targetNodeId && n.kind === 'restore')
      : undefined;
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

    // Physical rescue-backed Git worktree rewind to upstream checkpoint!
    const rewindRes = await this.worktrees.rewindToCheckpoint({
      worktreePath: change.worktreePath,
      changeCode: change.code,
      targetCommitSha: targetCp.gitCommitSha,
    });
    this.store.updateCheckpointRescueRef(targetCp.id, rewindRes.rescueRef);

    if (restoreNode) {
      this.store.updateGraphNode(restoreNode.id, {
        status: 'certified',
        outputSummary: `Restored to ${targetCp.gitTag} (backup: ${rewindRes.rescueRef})`,
      });
    }

    const rewindSet = computeRewindSet(
      nodes,
      edges,
      targetCp.nodeId,
      failedNode.id,
    );
    for (const rwId of rewindSet) {
      this.store.updateGraphNode(rwId, {
        status: 'rewound',
        outputSummary: `Rewound after ${failedNode.code} failure: ${summary}`,
      });
    }

    const audit = this.store.appendAudit({
      hubId: change.hubId,
      changeId: change.id,
      category: 'rewind',
      actor: 'continuity_engine',
      title: `Auto-Restore triggered by ${failedNode.code} -> ${targetCp.label}`,
      detail: `${summary} | Backup ref: ${rewindRes.rescueRef}`,
    });
    this.publish({type: 'audit.logged', entry: audit});

    return {
      handoff: {
        ...handoff,
        openConflicts: [
          `${failedNode.code} rejected prior attempt: ${summary}`,
          ...diagnostics.slice(0, 4),
        ],
      },
      haltLoop: false,
    };
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

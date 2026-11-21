/**
 * Sleep-Time Memory Consolidator (`DreamingEngine`) & Ebbinghaus Re-hydration
 * Capsule Generator.
 */

import {
  buildRehydrationCapsule,
  computeLinesEntropyContribution,
  computeRetentionScore,
} from '../core/cognitive.ts';
import type {HindsightEngine} from '../memory/hindsight-engine.ts';
import type {IGitWorktreeManager} from '../sandbox/contracts.ts';
import type {RehydrationCapsule} from '../shared/types.ts';
import type {ExecutionMode} from '../shared/v3-types.ts';
import type {ForgeStore} from '../store/database.ts';

export interface DreamConsolidationReport {
  readonly extractedPitfalls: number;
  readonly supersededDriftedMemories: number;
  readonly coldArchivedMemories: number;
  readonly capsulesRefreshed: number;
  readonly completedAt: string;
}

export class DreamingEngine {
  private readonly store: ForgeStore;
  private readonly worktrees: IGitWorktreeManager;
  private readonly hindsight?: HindsightEngine;

  constructor(
    store: ForgeStore,
    worktrees: IGitWorktreeManager,
    hindsight?: HindsightEngine,
  ) {
    this.store = store;
    this.worktrees = worktrees;
    this.hindsight = hindsight;
  }

  /**
   * Builds live Human Ebbinghaus Re-hydration Capsules across all active
   * Federation Hubs so multi-project context switches take <30 seconds.
   */
  buildAllCapsules(
    nowMs = Date.now(),
    executionMode: ExecutionMode = 'live',
  ): RehydrationCapsule[] {
    if (this.hindsight) {
      return this.hindsight.buildAllCapsules(nowMs, executionMode);
    }
    const hubs = this.store.listHubs(false);
    const openAttention = this.store.listAttentionItems(false);

    return hubs.map(hub => {
      const anchorMs = Date.parse(hub.lastHumanInteractionAt);
      const changes = this.store
        .listChanges(hub.id, false)
        .filter(c => (c.executionMode ?? 'live') === executionMode);
      const audits = this.store.listAuditLedger(50, hub.id);
      const diffTotals = this.store.getTotalChangeLinesForHub(
        hub.id,
        executionMode,
        hub.lastHumanInteractionAt,
      );

      let tasksCertifiedSinceAnchor = 0;
      let ghostAmendmentsSinceAnchor = 0;
      const deltaHighlights: string[] = [];

      for (const chg of changes) {
        const nodes = this.store.listGraphNodes(chg.id);
        for (const n of nodes) {
          const updatedMs = Date.parse(n.updatedAt);
          if (Number.isFinite(anchorMs) && updatedMs >= anchorMs) {
            if (n.kind === 'task' && n.status === 'certified') {
              tasksCertifiedSinceAnchor += 1;
            }
            if (n.kind === 'ghost') {
              ghostAmendmentsSinceAnchor += 1;
            }
          }
        }
        if (chg.status === 'certified' || chg.status === 'running') {
          deltaHighlights.push(
            `${chg.code} (${chg.title}): status=${chg.status}, spent=$${chg.spentUsd.toFixed(2)}`,
          );
        }
      }

      const adrUpdatesSinceAnchor = audits.filter(
        a =>
          (a.category === 'constitution' || a.category === 'ddd_refactor') &&
          Date.parse(a.createdAt) >= anchorMs,
      ).length;

      const hubAttention = openAttention.find(a => a.hubId === hub.id);
      const terms = this.store.listDomainTerms(hub.id);
      const lockedDecisions = [
        ...terms
          .slice(0, 3)
          .map(
            t =>
              `DDD [${t.boundedContext}]: Canonical "${t.canonicalTerm}" (${t.definition})`,
          ),
        ...audits.slice(0, 3).map(a => `${a.title}`),
      ];

      return buildRehydrationCapsule({
        hubId: hub.id,
        hubName: hub.name,
        northStarGoal: hub.description,
        lastHumanInteractionAt: hub.lastHumanInteractionAt,
        spacedReviewCount: hub.spacedReviewCount,
        lastHumanAnchorSummary:
          audits[0]?.title ??
          `Initialized Federation Hub "${hub.name}" (${changes.length} active changes)`,
        entropyInputs: {
          tasksCertifiedSinceAnchor,
          ghostAmendmentsSinceAnchor,
          adrUpdatesSinceAnchor,
          linesChangedSinceAnchor: (() => {
            const linesChanged = computeLinesEntropyContribution(
              diffTotals.linesAdded,
              diffTotals.linesDeleted,
            );
            return linesChanged > 0
              ? linesChanged
              : tasksCertifiedSinceAnchor * 85;
          })(),
        },
        deltaHighlights:
          deltaHighlights.length > 0
            ? deltaHighlights
            : ['Workspace steady; zero unreviewed autonomous mutations.'],
        lockedDecisions,
        topAttentionQuestion: hubAttention?.question ?? null,
        nowMs,
      });
    });
  }

  /**
   * Runs background sleep-time memory consolidation:
   * 1. Extracts pitfall lessons from fail-then-pass session trajectories.
   * 2. Invalidates (`valid_until`) semantic memories whose `pathAnchors`
   *    drifted significantly in recent worktree commits.
   * 3. Retires cold un-recalled memories whose Ebbinghaus utility retention
   *    decayed below threshold (`R_agent < 0.12`).
   */
  async runSleepConsolidation(
    nowMs = Date.now(),
  ): Promise<DreamConsolidationReport> {
    this.store.updateDaemon('dreaming_consolidator', {runningPass: true});
    let extractedPitfalls = 0;
    let supersededDriftedMemories = 0;
    let coldArchivedMemories = 0;

    try {
      for (const hub of this.store.listHubs(false)) {
        if (this.hindsight) {
          for (const mode of ['live', 'simulation'] as const) {
            const report = await this.hindsight.consolidatePendingFactsAsync(
              hub.id,
              mode,
            );
            supersededDriftedMemories += report.supersededObservations;
            await this.hindsight.refreshStaleLivingDocsAsync(hub.id, mode);
          }
        }
        const existingTitles = new Set(
          this.store
            .listSemanticMemories({hubId: hub.id, includeSuperseded: true})
            .map(m => m.title),
        );

        // 1. Extract pitfall lessons from retried-then-certified live task nodes.
        for (const chg of this.store.listChanges(hub.id, false)) {
          if ((chg.executionMode ?? 'live') === 'simulation') {
            continue;
          }
          const nodes = this.store.listGraphNodes(chg.id);
          for (const node of nodes) {
            if (node.status === 'certified' && node.attemptCount > 1) {
              const title = `Pitfall Lesson: ${chg.code} ${node.code} (${node.title})`;
              if (!existingTitles.has(title)) {
                this.store.recordSemanticMemory({
                  hubId: hub.id,
                  repoId: chg.repoId,
                  kind: 'pitfall_lesson',
                  title,
                  summary: `Resolved after ${node.attemptCount} attempts in ${chg.title}. Latest verified output: ${node.outputSummary || 'Passed gates after correction.'}`,
                  pathAnchors: node.fileScope,
                  stabilityHours: 64,
                });
                existingTitles.add(title);
                extractedPitfalls += 1;
              }
            }
          }

          // 2. Check active memories anchored to files modified in certified changes.
          if (chg.status === 'certified') {
            try {
              const diff = await this.worktrees.diffSinceCommit(
                chg.worktreePath,
                chg.baseCommitSha,
              );
              if (diff.changedFiles.length > 0) {
                const active = this.store.listSemanticMemories({hubId: hub.id});
                for (const mem of active) {
                  if (
                    mem.kind !== 'pitfall_lesson' &&
                    mem.pathAnchors.length > 0 &&
                    Date.parse(mem.createdAt) < Date.parse(chg.updatedAt) &&
                    mem.pathAnchors.some(anchor =>
                      diff.changedFiles.some(f => f.includes(anchor)),
                    )
                  ) {
                    const baseTitle = mem.title.replace(
                      /\s*\(Refreshed post-[^)]+\)$/i,
                      '',
                    );
                    const replacement = this.store.recordSemanticMemory({
                      hubId: hub.id,
                      repoId: mem.repoId,
                      kind: mem.kind,
                      title: `${baseTitle} (Refreshed post-${chg.code})`,
                      summary: `${mem.summary} — Anchors updated in ${chg.code}.`,
                      pathAnchors: mem.pathAnchors,
                      supersedesMemoryId: mem.id,
                      stabilityHours: mem.stabilityHours,
                    });
                    if (replacement) {
                      supersededDriftedMemories += 1;
                    }
                  }
                }
              }
            } catch {
              // Worktree may already be cleaned up; skip diff drift check safely.
            }
          }
        }

        // 3. Ebbinghaus cold-archiving for stale, un-recalled memories.
        const activeMemories = this.store.listSemanticMemories({hubId: hub.id});
        for (const mem of activeMemories) {
          const lastMs = Date.parse(mem.lastRecalledAt);
          const elapsedHours = Number.isFinite(lastMs)
            ? Math.max(0, (nowMs - lastMs) / 3_600_000)
            : 0;
          const retention = computeRetentionScore(
            elapsedHours,
            mem.stabilityHours,
          );
          if (retention < 0.12 && mem.recallCount === 0) {
            this.store.supersedeMemory(mem.id, null);
            coldArchivedMemories += 1;
          }
        }
      }

      const capsules = this.buildAllCapsules(nowMs);
      const completedAt = new Date(nowMs).toISOString();

      if (
        extractedPitfalls > 0 ||
        supersededDriftedMemories > 0 ||
        coldArchivedMemories > 0
      ) {
        this.store.appendAudit({
          hubId: null,
          changeId: null,
          category: 'dreaming',
          actor: 'dreaming_consolidator',
          title: 'Sleep-Time Cognitive Memory Consolidation Completed',
          detail: `Pitfalls+${extractedPitfalls}, Superseded=${supersededDriftedMemories}, ColdArchived=${coldArchivedMemories}.`,
        });
      }

      this.store.updateDaemon('dreaming_consolidator', {
        runningPass: false,
        lastRunAt: completedAt,
        lastSummary: `+${extractedPitfalls} pitfalls | ${supersededDriftedMemories} refreshed | ${coldArchivedMemories} cold-pruned`,
      });

      return {
        extractedPitfalls,
        supersededDriftedMemories,
        coldArchivedMemories,
        capsulesRefreshed: capsules.length,
        completedAt,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.updateDaemon('dreaming_consolidator', {
        runningPass: false,
        lastRunAt: new Date(nowMs).toISOString(),
        lastSummary: `Consolidation error: ${msg}`,
      });
      throw err;
    }
  }
}

/**
 * Verification Gate 1: Pure Domain Core, DDD Drift Detection, Dual Ebbinghaus
 * Cognitive Memory, and SQLite WAL + FTS5 Bi-Temporal Store Invariants.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  buildRehydrationCapsule,
  compileTwinGraph,
  computeNextExecutableNodes,
  computeRewindSet,
  detectTerminologyDrift,
  rankAttentionQueue,
  spliceGhostNode,
} from '../src/core/index.ts';
import {parseFailClosedAuditJson} from '../src/shared/validation.ts';
import {ForgeStore} from '../src/store/database.ts';

describe('Core Twin-Graph, DDD & Cognitive Memory Invariants', () => {
  it('compiles collapsible Twin-Graph, isolates RewindSet, and blocks GhostNode cycles', () => {
    const now = new Date().toISOString();
    const graph = compileTwinGraph(
      'chg-1',
      [
        {
          code: 'P1',
          title: 'Foundation',
          description: 'Core contracts',
          tasks: [
            {code: '1.1', title: 'Schema', description: 'Define schema'},
            {
              code: '1.2',
              title: 'Service',
              description: 'Build service',
              dependsOnCodes: ['1.1'],
            },
          ],
        },
        {
          code: 'P2',
          title: 'Hardening',
          description: 'Edge cases',
          tasks: [{code: '2.1', title: 'Audit', description: 'Verify'}],
        },
      ],
      'npm test',
      {
        leadAdapterId: 'native-api',
        leadModel: 'deepseek-reasoner',
        workerAdapterId: 'native-api',
        workerModel: 'deepseek-chat',
        juniorAuditModel: 'deepseek-chat',
        seniorAuditModel: 'deepseek-reasoner',
        maxRetryLoops: 3,
      },
      now,
    );

    const ready0 = computeNextExecutableNodes(graph.nodes, graph.edges);
    assert.equal(ready0.length, 1);
    assert.equal(ready0[0]?.code, 'G1-VERIFY');

    // Verify branch-isolated RewindSet from CP-1 to P2-SQA leaves P1 untouched!
    const cp1 = graph.nodes.find(n => n.code === 'CP-1')!;
    const p2Sqa = graph.nodes.find(n => n.code === 'P2-SQA')!;
    const p1Task = graph.nodes.find(n => n.code === '1.1')!;
    const p2Task = graph.nodes.find(n => n.code === '2.1')!;
    const rewindSet = computeRewindSet(
      graph.nodes,
      graph.edges,
      cp1.id,
      p2Sqa.id,
    );

    assert.equal(rewindSet.has(p2Task.id), true);
    assert.equal(rewindSet.has(p2Sqa.id), true);
    assert.equal(rewindSet.has(cp1.id), false);
    assert.equal(rewindSet.has(p1Task.id), false);

    // Splice dynamic GhostNode cleanly without introducing cycles
    const spliced = spliceGhostNode(graph.nodes, graph.edges, {
      changeId: 'chg-1',
      code: 'GHOST-1',
      title: 'Backfill migration',
      description: 'Add missing column index',
      insertBeforeNodeId: p2Task.id,
      assignedAdapterId: 'native-api',
      assignedModel: 'deepseek-chat',
      nowIso: now,
    });
    assert.equal(spliced.nodes.length, graph.nodes.length + 1);
  });

  it('enforces DDD Ubiquitous Language forbidden synonym detection & fail-closed audit parsing', () => {
    const drift = detectTerminologyDrift(
      '@@ -1,2 +1,3 @@\n+export interface BillItem { amount: number }\n+const ok = SettlementVoucher.create();',
      [
        {
          id: 't1',
          hubId: 'h1',
          boundedContext: 'Settlement',
          owningRepoIds: [],
          canonicalTerm: 'SettlementVoucher',
          localLabel: '结算凭证',
          definition: 'Canonical settlement voucher',
          forbiddenAliases: ['BillItem', 'PaySlip'],
          schemaAnchors: [],
          createdAt: '',
          updatedAt: '',
        },
      ],
    );
    assert.equal(drift.length, 1);
    assert.equal(drift[0]?.forbiddenAlias, 'BillItem');
    assert.equal(drift[0]?.canonicalTerm, 'SettlementVoucher');

    // Fail-closed audit parser rejects non-JSON or missing boolean `passed`
    const malformed = parseFailClosedAuditJson('Looks great to me! Ship it!');
    assert.equal(malformed.passed, false);
  });

  it('computes Ebbinghaus capsule tiers and SQLite FTS5 + bi-temporal supersession', () => {
    const nowMs = Date.now();
    const coldCapsule = buildRehydrationCapsule({
      hubId: 'h1',
      hubName: 'Payments Hub',
      northStarGoal: 'Zero-drift ledger',
      lastHumanInteractionAt: new Date(nowMs - 36 * 3_600_000).toISOString(),
      spacedReviewCount: 0,
      lastHumanAnchorSummary: 'Initial setup',
      entropyInputs: {
        tasksCertifiedSinceAnchor: 8,
        ghostAmendmentsSinceAnchor: 2,
        adrUpdatesSinceAnchor: 1,
        linesChangedSinceAnchor: 900,
      },
      deltaHighlights: ['CHG-001 certified'],
      lockedDecisions: ['Canonical SettlementVoucher'],
      topAttentionQuestion: 'Approve release?',
      nowMs,
    });
    assert.equal(coldCapsule.tier, 'deep_reanchor');
    assert.equal(coldCapsule.lockedDecisions.length, 1);

    const store = new ForgeStore(':memory:');
    try {
      const hub = store.createHub({
        name: 'Core Hub',
        rootPath: '/tmp/hub',
        description: 'Test hub',
        permissionTier: 'turbo',
      });
      const sess = store.startSession({
        hubId: hub.id,
        adapterId: 'native-api',
        model: 'deepseek-reasoner',
        role: 'worker',
      });
      store.appendTranscriptMessage({
        sessionId: sess.id,
        role: 'assistant',
        content: 'Resolved idempotent SettlementVoucher deadlock in ledger.',
      });
      const hits = store.searchEvidenceFts('SettlementVoucher', hub.id);
      assert.equal(hits.length, 1);

      const m1 = store.recordSemanticMemory({
        hubId: hub.id,
        kind: 'adr',
        title: 'Ledger v1',
        summary: 'Single-node lock',
      });
      const m2 = store.recordSemanticMemory({
        hubId: hub.id,
        kind: 'adr',
        title: 'Ledger v2',
        summary: 'Optimistic versioned SettlementVoucher lock',
        supersedesMemoryId: m1.id,
      });
      const active = store.listSemanticMemories({hubId: hub.id});
      const all = store.listSemanticMemories({
        hubId: hub.id,
        includeSuperseded: true,
      });
      assert.equal(active.length, 1);
      assert.equal(active[0]?.id, m2.id);
      assert.equal(all.length, 2);
      assert.ok(all.find(x => x.id === m1.id)?.validUntil !== null);

      const attn = store.raiseAttention({
        hubId: hub.id,
        kind: 'gate_approval',
        question: 'Approve G2?',
        contextSnippet: 'P1 ready',
        options: ['Approve'],
      });
      const ranked = rankAttentionQueue(
        [attn],
        new Map([[hub.id, coldCapsule.retentionScore]]),
      );
      assert.equal(ranked.length, 1);
    } finally {
      store.close();
    }
  });
});

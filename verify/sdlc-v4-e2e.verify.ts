/**
 * Verification Gate 6: End-to-End SDLC-Studio v4 Master Agent Orchestration,
 * Zero-Form Onboarding (auto git init), Raft Consensus + Kano/AHP (CR < 0.10),
 * Bidirectional Board <-> Spec IR + Pins, First-Class Task Decomposition &
 * Multi-Kernel Isolated Git Worktree Execution + Turn `git write-tree` Diffs,
 * CollabBus Audience-Scoped Peer Handoffs, Claude Ship Anti-Self-Approval +
 * Answer-in-HTML + Clean Delivery Commit, and Live Local Native Kernel Probes.
 */

import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {ForgeRuntime} from '../src/server/runtime.ts';
import type {
  ArtifactPin,
  BoardSceneDoc,
  CollabFeedItem,
  ConsensusLogEntry,
  HostedAppCard,
  KernelId,
  NativeKernelCard,
  QuantizationResult,
  ShipReviewBundle,
  SpecIRContract,
  TaskDecompositionPlan,
  TaskNodeRole,
  TurnDiffSnapshot,
  V4BootstrapPayload,
  V4SessionDetail,
  WorkspaceFileContent,
  WorkspaceFileEntry,
} from '../src/shared/v4-types.ts';

interface JsonResponse<T> {
  readonly status: number;
  readonly body: T;
}

async function apiJson<T>(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<JsonResponse<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsed = (await res.json()) as T;
  return {status: res.status, body: parsed};
}

describe('SDLC-Studio v4 End-to-End Collaborative Workflow', () => {
  it('executes full v4 lifecycle across real SQLite, Git worktrees, write-tree diffs, CollabBus, Ship anti-self-approval, delivery, and native CLI probes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'forgeops-v4-e2e-data-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'forgeops-v4-e2e-repo-'));
    const runtime = new ForgeRuntime({dataDir, seedDemoOnEmpty: false});
    const sseAbort = new AbortController();
    const receivedSseTypes = new Set<string>();
    let sseReaderTask: Promise<void> | null = null;

    try {
      await runtime.start();
      const base = runtime.httpServer.apiBaseUrl;
      const token = runtime.httpServer.sessionToken;

      // 0. Unauthenticated v4 request must be rejected with 401
      const unauth = await fetch(`${base}/api/v4/bootstrap`);
      assert.equal(unauth.status, 401);

      // Start live SSE listener on /api/events to verify real-time v4.* events
      const sseRes = await fetch(
        `${base}/api/events?token=${encodeURIComponent(token)}`,
        {signal: sseAbort.signal},
      );
      assert.equal(sseRes.status, 200);
      assert.ok(sseRes.body);
      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();
      sseReaderTask = (async () => {
        let buffer = '';
        try {
          for (;;) {
            const {value, done} = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const raw = line.slice(5).trim();
              if (!raw) continue;
              try {
                const ev = JSON.parse(raw) as {type?: string};
                if (typeof ev.type === 'string') {
                  receivedSseTypes.add(ev.type);
                }
              } catch {
                // Ignore keepalive or partial SSE frames.
              }
            }
          }
        } catch {
          // Expected when AbortController closes SSE stream in finally.
        }
      })();

      // =====================================================================
      // STEP 1: Zero-Form Folder Onboarding on a Brand-New Empty Temp Folder
      // =====================================================================
      assert.equal(existsSync(join(projectDir, '.git')), false);
      const onboard = await apiJson<V4SessionDetail>(
        base,
        token,
        'POST',
        '/api/v4/onboard-folder',
        {
          folderPath: projectDir,
          title: 'Inventory Alert Service',
          mode: 'team',
          executionMode: 'local',
        },
      );
      assert.equal(onboard.status, 201);
      const sessionId = onboard.body.session.id;
      assert.ok(sessionId.length > 0);
      assert.equal(onboard.body.session.mode, 'team');
      assert.equal(onboard.body.session.executionMode, 'local');
      assert.ok(
        onboard.body.messages.length >= 1,
        'Initial welcome playback message must be created on onboard',
      );
      assert.equal(
        existsSync(join(projectDir, '.git')),
        true,
        'onboard-folder must auto-initialize .git on an empty directory',
      );

      const initialHead = await runtime.runner.run({
        executable: 'git',
        args: ['rev-parse', 'HEAD'],
        cwd: projectDir,
        timeoutMs: 10_000,
      });
      assert.equal(initialHead.exitCode, 0);
      const initSha = initialHead.stdout.trim();
      assert.match(initSha, /^[0-9a-f]{40}$/);

      const boot = await apiJson<V4BootstrapPayload>(
        base,
        token,
        'GET',
        '/api/v4/bootstrap',
      );
      assert.equal(boot.status, 200);
      assert.ok(boot.body.sessions.some(s => s.id === sessionId));

      // =====================================================================
      // STEP 2: Chat Turns -> Raft Consensus -> Kano + AHP -> Board/Spec/Pins
      // =====================================================================
      const turn1 = await apiJson<V4SessionDetail>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/turn`,
        {
          text: 'Build a real-time inventory threshold alert engine with rule evaluation, alert deduplication, and audit logging.',
          action: 'chat',
        },
      );
      assert.equal(turn1.status, 200);
      assert.ok(
        turn1.body.messages.length > onboard.body.messages.length,
        'Chat turn must append human and master messages',
      );
      assert.ok(
        turn1.body.consensusLog.length >= 1,
        'Chat turn must record Raft consensus log entries',
      );

      const consensusAppend = await apiJson<{
        entry: ConsensusLogEntry;
        consensusLog: ConsensusLogEntry[];
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/consensus`,
        {
          authorPrincipalId: 'architect-lead',
          authorKind: 'human',
          entryType: 'ruling',
          specAnchorId: 'spec-core',
          payload: {
            decision: 'Use deterministic rule engine with zero external DB.',
          },
          commit: true,
        },
      );
      assert.equal(consensusAppend.status, 201);
      assert.equal(consensusAppend.body.entry.commitState, 'committed');
      assert.ok(consensusAppend.body.consensusLog.length >= 2);

      // Kano + AHP: contradictory matrix (CR >= 0.10) MUST return HTTP 422 with conflict pair
      const kanoItems = [
        {
          reqId: 'REQ-1',
          title: 'Threshold rule evaluator',
          functional: 'expect',
          dysfunctional: 'dislike',
          bwsMappings: [
            {
              fuzzyTerm: 'fast alerts',
              engineeringMetric: 'p99 evaluation latency',
              assertion: '< 25ms per batch',
            },
          ],
        },
        {
          reqId: 'REQ-2',
          title: 'Alert deduplication window',
          functional: 'like',
          dysfunctional: 'dislike',
        },
        {
          reqId: 'REQ-3',
          title: 'Structured audit trail',
          functional: 'like',
          dysfunctional: 'neutral',
        },
      ];
      const inconsistentAhp = await apiJson<{
        code: string;
        error: string;
        result: QuantizationResult;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/quantize`,
        {
          items: kanoItems,
          pairwiseMatrix: [
            [1, 9, 1 / 9],
            [1 / 9, 1, 9],
            [9, 1 / 9, 1],
          ],
        },
      );
      assert.equal(inconsistentAhp.status, 422);
      assert.equal(inconsistentAhp.body.code, 'AHP_INCONSISTENT');
      assert.equal(inconsistentAhp.body.result.passed, false);
      assert.ok(inconsistentAhp.body.result.cr >= 0.1);
      assert.ok(
        Array.isArray(inconsistentAhp.body.result.maxConflictPair) &&
          inconsistentAhp.body.result.maxConflictPair.length === 2,
        'Contradictory AHP matrix must identify maxConflictPair',
      );

      // Kano + AHP: consistent matrix (CR < 0.10) MUST pass with HTTP 200
      const consistentAhp = await apiJson<QuantizationResult>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/quantize`,
        {
          items: kanoItems,
          pairwiseMatrix: [
            [1, 2, 4],
            [0.5, 1, 2],
            [0.25, 0.5, 1],
          ],
        },
      );
      assert.equal(consistentAhp.status, 200);
      assert.equal(consistentAhp.body.passed, true);
      assert.ok(consistentAhp.body.cr < 0.1);
      assert.equal(consistentAhp.body.items.length, 3);
      const weightSum = consistentAhp.body.ahpWeights.reduce(
        (acc, w) => acc + w,
        0,
      );
      assert.ok(Math.abs(weightSum - 1) < 1e-4);

      // Board node addition -> synced to Spec IR + optimistic concurrency check
      const currentDetail = await apiJson<V4SessionDetail>(
        base,
        token,
        'GET',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}`,
      );
      assert.equal(currentDetail.status, 200);
      const prevBoard = currentDetail.body.board;
      const newBoardNodeId = 'node-dedup-engine';
      const updatedBoard: BoardSceneDoc = {
        ...prevBoard,
        nodes: [
          ...prevBoard.nodes,
          {
            id: newBoardNodeId,
            label: 'Alert Deduplicator',
            kind: 'service',
            x: 420,
            y: 160,
            width: 210,
            height: 84,
            specModuleId: 'mod-alert-dedup',
            status: 'confirmed',
            summary: 'Suppresses duplicate threshold triggers inside cooldown.',
          },
        ],
      };

      const boardUpdate = await apiJson<{
        board: BoardSceneDoc;
        specIR: SpecIRContract;
      }>(
        base,
        token,
        'PUT',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/board`,
        {
          board: updatedBoard,
          expectedRevision: prevBoard.revision,
        },
      );
      assert.equal(boardUpdate.status, 200);
      assert.ok(boardUpdate.body.board.revision > prevBoard.revision);
      assert.ok(
        boardUpdate.body.specIR.modules.some(
          m =>
            m.boardNodeId === newBoardNodeId ||
            m.moduleId === 'mod-alert-dedup',
        ),
        'Adding a Board node must sync a corresponding module into Spec IR',
      );

      // Stale board revision must be rejected with HTTP 409
      const staleBoardUpdate = await apiJson<{error?: string}>(
        base,
        token,
        'PUT',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/board`,
        {
          board: updatedBoard,
          expectedRevision: prevBoard.revision,
        },
      );
      assert.equal(staleBoardUpdate.status, 409);

      // Pin creation synced to Spec IR -> Pin resolve triggers update
      const pinCreate = await apiJson<{
        pin: ArtifactPin;
        specIR: SpecIRContract;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/pins`,
        {
          surfaceType: 'board',
          anchorJson: JSON.stringify({nodeId: newBoardNodeId, x: 480, y: 190}),
          specNodeId: 'mod-alert-dedup',
          promptText: 'Ensure dedup cooldown window defaults to 60 seconds.',
        },
      );
      assert.equal(pinCreate.status, 201);
      const pinId = pinCreate.body.pin.id;
      assert.ok(
        pinCreate.body.specIR.openPins.some(p => p.pinId === pinId),
        'Created Pin must appear in Spec IR openPins',
      );

      const pinResolve = await apiJson<{
        pin: ArtifactPin;
        detail?: V4SessionDetail;
      }>(
        base,
        token,
        'PATCH',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/pins/${encodeURIComponent(pinId)}`,
        {
          status: 'resolved',
          askAgent: true,
          replyText: 'Confirmed: 60s default dedup cooldown added to contract.',
        },
      );
      assert.equal(pinResolve.status, 200);
      assert.equal(pinResolve.body.pin.status, 'resolved');
      assert.ok((pinResolve.body.pin.replyText ?? '').length > 0);
      const afterPinDetail = await apiJson<V4SessionDetail>(
        base,
        token,
        'GET',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}`,
      );
      assert.equal(afterPinDetail.status, 200);
      assert.equal(
        afterPinDetail.body.specIR.openPins.some(
          p => p.pinId === pinId && p.status !== 'resolved',
        ),
        false,
        'Resolved Pin must no longer be open in Spec IR',
      );

      // =====================================================================
      // STEP 3: Task Decomposition, Split/Reassign, Multi-Kernel Worktree
      //         Execution, Real Turn `git write-tree` Diffs, & CollabBus
      // =====================================================================
      const decompose = await apiJson<{
        plan: TaskDecompositionPlan;
        detail: V4SessionDetail;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/tasks/decompose`,
        {force: true},
      );
      assert.equal(decompose.status, 200);
      assert.ok(
        decompose.body.plan.tasks.length >= 2,
        'Task decomposition must produce multiple dependent tasks',
      );
      assert.ok(
        decompose.body.plan.tasks.some(t => t.dependsOn.length > 0),
        'Decomposed WBS plan must include task dependencies across waves',
      );

      // Test task reassignment across multiple kernels
      const firstTask = decompose.body.plan.tasks[0]!;
      const secondTask = decompose.body.plan.tasks[1]!;

      const reassign1 = await apiJson<{plan: TaskDecompositionPlan}>(
        base,
        token,
        'PATCH',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/tasks/mutate`,
        {
          op: 'reassign_kernel',
          taskId: firstTask.id,
          assignedKernel: 'claude-code',
        },
      );
      assert.equal(reassign1.status, 200);
      assert.equal(
        reassign1.body.plan.tasks.find(t => t.id === firstTask.id)
          ?.assignedKernel,
        'claude-code',
      );

      // Test task split into distinct scopes assigned to codex & gemini-cli
      const splitRes = await apiJson<{plan: TaskDecompositionPlan}>(
        base,
        token,
        'PATCH',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/tasks/mutate`,
        {
          op: 'split',
          taskId: secondTask.id,
          parts: [
            {
              title: `${secondTask.title} — Rule Engine Core`,
              description:
                'Implement core rule threshold evaluation and state.',
              role: 'coder',
              assignedKernel: 'codex',
              fileScope: ['src/alert-core.mjs'],
              acceptanceChecks: ['node --test'],
            },
            {
              title: `${secondTask.title} — Deduplication & Tests`,
              description:
                'Implement alert cooldown deduplication and unit checks.',
              role: 'tester',
              assignedKernel: 'gemini-cli',
              fileScope: ['src/alert-dedup.mjs'],
              acceptanceChecks: ['node --test'],
            },
          ],
        },
      );
      assert.equal(splitRes.status, 200);
      const kernelsAssigned = new Set(
        splitRes.body.plan.tasks.map(t => t.assignedKernel),
      );
      assert.ok(kernelsAssigned.has('claude-code'));
      assert.ok(kernelsAssigned.has('codex'));
      assert.ok(
        kernelsAssigned.has('gemini-cli') || kernelsAssigned.has('native-api'),
      );

      // Execute waves in real isolated Git worktrees
      const execRes = await apiJson<{
        plan: TaskDecompositionPlan;
        diffs: TurnDiffSnapshot[];
        detail: V4SessionDetail;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/tasks/execute`,
        {},
      );
      assert.equal(execRes.status, 200);
      assert.equal(execRes.body.plan.status, 'completed');
      for (const task of execRes.body.plan.tasks) {
        assert.equal(
          task.status,
          'completed',
          `Task "${task.title}" must complete cleanly`,
        );
        assert.ok(
          task.worktreeBranch && task.worktreeBranch.length > 0,
          `Task "${task.title}" must execute on an isolated worktree branch`,
        );
        assert.match(task.beforeTreeSha ?? '', /^[0-9a-f]{40}$/);
        assert.match(task.afterTreeSha ?? '', /^[0-9a-f]{40}$/);
        assert.notEqual(task.beforeTreeSha, task.afterTreeSha);
      }

      // Assert actual workspace files were written and are readable inside sandbox
      const filesRes = await apiJson<{
        workspacePath: string;
        files: WorkspaceFileEntry[];
      }>(
        base,
        token,
        'GET',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/files`,
      );
      assert.equal(filesRes.status, 200);
      const writtenFiles = filesRes.body.files.filter(
        f => f.kind === 'file' && !f.path.startsWith('.'),
      );
      assert.ok(
        writtenFiles.length >= 2,
        'Execution must produce real files in the target workspace',
      );
      const sampleFile = await apiJson<WorkspaceFileContent>(
        base,
        token,
        'GET',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(writtenFiles[0]!.path)}`,
      );
      assert.equal(sampleFile.status, 200);
      assert.ok(sampleFile.body.content.length > 0);

      // Path escape must be rejected
      const escapeRes = await apiJson<{error?: string}>(
        base,
        token,
        'GET',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent('../../package.json')}`,
      );
      assert.ok(escapeRes.status === 400 || escapeRes.status === 403);

      // Assert real Turn `git write-tree` diffs recorded (+added > 0)
      const diffsRes = await apiJson<{diffs: TurnDiffSnapshot[]}>(
        base,
        token,
        'GET',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/diffs`,
      );
      assert.equal(diffsRes.status, 200);
      assert.ok(diffsRes.body.diffs.length >= execRes.body.plan.tasks.length);
      const totalAdded = diffsRes.body.diffs.reduce(
        (sum, snap) => sum + snap.files.reduce((fSum, f) => fSum + f.added, 0),
        0,
      );
      assert.ok(
        totalAdded > 0,
        `Expected positive added line count across write-tree snapshots, got ${totalAdded}`,
      );
      assert.ok(
        diffsRes.body.diffs.some(snap =>
          snap.files.some(f => f.patch.includes('+') && f.added > 0),
        ),
        'Turn diff snapshots must include real git diff-tree patches',
      );

      // Assert CollabBus peer handoff messages logged between kernels
      const collabFeedRes = await apiJson<{items: CollabFeedItem[]}>(
        base,
        token,
        'GET',
        `/api/v4/collab?sessionId=${encodeURIComponent(sessionId)}`,
      );
      assert.equal(collabFeedRes.status, 200);
      assert.ok(
        collabFeedRes.body.items.some(
          item => item.kind === 'handoff' && item.fromKernel !== item.toKernel,
        ),
        'CollabBus must record cross-kernel peer handoff messages during execution',
      );
      assert.ok(
        runtime.collabBus.listByMission(sessionId).length >= 1,
        'Live ForgeRuntime.collabBus must receive bridged v4 collab messages',
      );

      // Verify audience-intersection isolation over HTTP /api/v4/collab
      const privatePost = await apiJson<{item: CollabFeedItem}>(
        base,
        token,
        'POST',
        '/api/v4/collab',
        {
          sessionId,
          fromKernel: 'master',
          toKernel: 'claude-code',
          kind: 'review',
          audienceScope: 'private:claude-code',
          content: 'TOP-SECRET-REVIEW-NOTE-ONLY-FOR-CLAUDE',
        },
      );
      assert.equal(privatePost.status, 201);
      const codexView = await apiJson<{items: CollabFeedItem[]}>(
        base,
        token,
        'GET',
        `/api/v4/collab?sessionId=${encodeURIComponent(sessionId)}&reader=codex`,
      );
      assert.equal(codexView.status, 200);
      assert.equal(
        codexView.body.items.some(i =>
          i.content.includes('TOP-SECRET-REVIEW-NOTE-ONLY-FOR-CLAUDE'),
        ),
        false,
        'Unauthorized reader (codex) must not see private:claude-code collab note',
      );
      const claudeView = await apiJson<{items: CollabFeedItem[]}>(
        base,
        token,
        'GET',
        `/api/v4/collab?sessionId=${encodeURIComponent(sessionId)}&reader=claude-code`,
      );
      assert.equal(claudeView.status, 200);
      assert.equal(
        claudeView.body.items.some(i =>
          i.content.includes('TOP-SECRET-REVIEW-NOTE-ONLY-FOR-CLAUDE'),
        ),
        true,
        'Authorized reader (claude-code) must see its private:claude-code collab note',
      );

      // =====================================================================
      // STEP 4: Claude Ship Anti-Self-Approval + Answer-in-HTML + Delivery
      // =====================================================================
      const writerTask = execRes.body.plan.tasks.find(
        t => t.role === 'coder' || t.assignedKernel === 'codex',
      );
      assert.ok(writerTask, 'Expected at least one writer task');
      const writerKernel = writerTask.assignedKernel;

      // Attempting to review with the writer kernel MUST be rejected (409)
      const selfApproveRes = await apiJson<{
        code: string;
        error: string;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/ship`,
        {
          reviewDepth: 'standard',
          reviewerKernel: writerKernel,
          policyMode: 'enforced',
        },
      );
      assert.equal(selfApproveRes.status, 409);
      assert.equal(selfApproveRes.body.code, 'SELF_APPROVAL_BLOCKED');

      // Choose an independent reviewer kernel not used by any writer task
      const usedKernels = new Set(
        execRes.body.plan.tasks.map(t => t.assignedKernel),
      );
      const candidateReviewers: readonly KernelId[] = [
        'opencode',
        'pi',
        'native-api',
        'claude-code',
        'gemini-cli',
      ];
      const independentReviewer =
        candidateReviewers.find(k => !usedKernels.has(k)) ?? 'native-api';

      const shipRes = await apiJson<{
        review: ShipReviewBundle;
        detail: V4SessionDetail;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/ship`,
        {
          reviewDepth: 'standard',
          reviewerKernel: independentReviewer,
          policyMode: 'enforced',
        },
      );
      assert.equal(shipRes.status, 200);
      const review = shipRes.body.review;
      assert.equal(review.antiSelfApprovalPassed, true);
      assert.equal(review.reviewerKernel, independentReviewer);
      assert.equal(review.coderKernels.includes(review.reviewerKernel), false);
      assert.ok(
        review.answerHtml.length > 200,
        'Answer-in-HTML verification report must be non-empty',
      );
      assert.match(
        review.answerHtml,
        /<html|<!doctype html/i,
        'Answer-in-HTML must be a valid standalone HTML report',
      );
      assert.ok(
        review.answerHtml.includes(`+${totalAdded}`) ||
          review.answerHtml.includes(String(totalAdded)),
        'Answer-in-HTML must include real diff evidence counts',
      );

      // Pass Ship verdict and deliver cleanly to target Git repo
      const verdictRes = await apiJson<{
        review: ShipReviewBundle;
        detail: V4SessionDetail;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/ship/${encodeURIComponent(review.id)}/verdict`,
        {
          verdict: 'passed',
          comment: 'Independent Ship review verified all checks and diffs.',
        },
      );
      assert.equal(verdictRes.status, 200);
      assert.equal(verdictRes.body.review.verdict, 'passed');

      const deliverRes = await apiJson<{
        deliveredCommitSha: string;
        hostedApp: HostedAppCard;
        detail: V4SessionDetail;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/deliver`,
        {
          appName: 'Inventory Alert Service',
          versionTag: 'v1.0.0',
        },
      );
      assert.equal(deliverRes.status, 200);
      assert.match(deliverRes.body.deliveredCommitSha, /^[0-9a-f]{40}$/);
      assert.notEqual(deliverRes.body.deliveredCommitSha, initSha);
      assert.equal(deliverRes.body.detail.session.stage, 'delivered');
      assert.equal(deliverRes.body.hostedApp.versionTag, 'v1.0.0');

      // Verify target repo HEAD matches deliveredCommitSha and working tree is clean
      const finalHead = await runtime.runner.run({
        executable: 'git',
        args: ['rev-parse', 'HEAD'],
        cwd: projectDir,
        timeoutMs: 10_000,
      });
      assert.equal(finalHead.exitCode, 0);
      assert.equal(finalHead.stdout.trim(), deliverRes.body.deliveredCommitSha);

      const finalStatus = await runtime.runner.run({
        executable: 'git',
        args: ['status', '--porcelain'],
        cwd: projectDir,
        timeoutMs: 10_000,
      });
      assert.equal(finalStatus.exitCode, 0);
      assert.equal(
        finalStatus.stdout.trim(),
        '',
        'Delivered target repository must have a clean working tree',
      );

      // =====================================================================
      // STEP 5: Live Local Native Kernel Probing (GET & POST /api/v4/kernels)
      // =====================================================================
      const kernelsGet = await apiJson<{
        kernels: NativeKernelCard[];
        roleRouting: Record<TaskNodeRole, KernelId>;
      }>(base, token, 'GET', '/api/v4/kernels');
      assert.equal(kernelsGet.status, 200);
      assert.ok(kernelsGet.body.kernels.length >= 4);

      const kernelsProbe = await apiJson<{
        kernels: NativeKernelCard[];
        roleRouting: Record<TaskNodeRole, KernelId>;
      }>(base, token, 'POST', '/api/v4/kernels/probe');
      assert.equal(kernelsProbe.status, 200);

      const byId = new Map(kernelsProbe.body.kernels.map(k => [k.kernelId, k]));
      assert.ok(byId.has('claude-code'));
      assert.ok(byId.has('codex'));
      assert.ok(byId.has('gemini-cli'));
      assert.ok(byId.has('native-api'));

      // Verify real detection of installed local native CLIs on this host
      const detectedClis = (['claude-code', 'codex', 'gemini-cli'] as const)
        .map(id => byId.get(id)!)
        .filter(k => k.installed);
      assert.ok(
        detectedClis.length >= 1,
        'Expected at least one installed local native CLI (claude/codex/gemini) to be probed',
      );
      for (const cli of detectedClis) {
        assert.ok(
          cli.binaryPath && cli.binaryPath.length > 0,
          `${cli.kernelId} must report resolved binaryPath`,
        );
        assert.ok(
          cli.version && cli.version.length > 0,
          `${cli.kernelId} must report real --version output`,
        );
      }
      if (process.platform === 'win32') {
        for (const expectedId of [
          'claude-code',
          'codex',
          'gemini-cli',
        ] as const) {
          const card = byId.get(expectedId);
          assert.ok(card, `Kernel ${expectedId} missing from probe output`);
          assert.equal(
            card.installed,
            true,
            `Expected ${expectedId} to be detected on this Windows host`,
          );
          assert.equal(card.status, 'ready');
        }
      }

      // Role routing update check
      const routeUpdate = await apiJson<{
        roleRouting: Record<TaskNodeRole, KernelId>;
      }>(base, token, 'PUT', '/api/v4/kernels/routing', {
        roleRouting: {
          coder: 'codex',
          reviewer: 'claude-code',
          tester: 'gemini-cli',
        },
      });
      assert.equal(routeUpdate.status, 200);
      assert.equal(routeUpdate.body.roleRouting.coder, 'codex');
      assert.equal(routeUpdate.body.roleRouting.reviewer, 'claude-code');
      assert.equal(routeUpdate.body.roleRouting.tester, 'gemini-cli');

      // Allow any buffered SSE frames to flush and assert v4.* events fired
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(
        receivedSseTypes.has('v4.session.updated') &&
          receivedSseTypes.has('v4.plan.updated') &&
          receivedSseTypes.has('v4.turn.snapshot') &&
          receivedSseTypes.has('v4.collab.message') &&
          receivedSseTypes.has('v4.ship.ready'),
        `Expected core v4 SSE events, saw: ${Array.from(receivedSseTypes).join(', ')}`,
      );
    } finally {
      sseAbort.abort();
      if (sseReaderTask) {
        await sseReaderTask.catch(() => undefined);
      }
      await runtime.stop();
      rmSync(dataDir, {recursive: true, force: true});
      rmSync(projectDir, {recursive: true, force: true});
    }
  });
});

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {
  classifyFailure,
  compileTwinGraph,
  detectDestructiveContractChanges,
  detectRetrySpin,
  simulateTwinGraphTrial,
  triageMissionIntent,
} from '../src/core/index.ts';
import {
  detectRepoVerifyCommand,
  scanRepositoriesForProbe,
} from '../src/sandbox/index.ts';
import {ForgeRuntime} from '../src/server/runtime.ts';
import type {
  CausalDiffReport,
  CodebaseProbeReport,
  CreateMissionResponse,
  GitReconcileResult,
  MemoryObservationRecord,
  ResumeHandoverResult,
  TakeoverStatusSnapshot,
} from '../src/shared/api.ts';
import type {GraphNode} from '../src/shared/types.ts';

function runGitSync(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {...process.env, LC_ALL: 'C'},
  }).trim();
}

function initDemoGitRepo(dir: string): void {
  mkdirSync(join(dir, 'src'), {recursive: true});
  runGitSync(dir, ['init', '-b', 'main']);
  runGitSync(dir, ['config', 'user.name', 'Alice Dev']);
  runGitSync(dir, ['config', 'user.email', 'alice@example.com']);

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'v31-demo-svc',
        version: '1.0.0',
        scripts: {test: 'node check.mjs'},
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    join(dir, 'check.mjs'),
    "import {existsSync} from 'node:fs';\nprocess.exit(existsSync('fixed.txt') ? 0 : 1);\n",
    'utf8',
  );
  writeFileSync(
    join(dir, 'src', 'auth.ts'),
    'export function verifyToken(token: string): boolean {\n  return token.length > 4;\n}\n',
    'utf8',
  );
  writeFileSync(
    join(dir, 'src', 'api.ts'),
    "import {verifyToken} from './auth';\nexport function handleRequest(tok: string): boolean {\n  return verifyToken(tok);\n}\n",
    'utf8',
  );

  runGitSync(dir, ['add', '.']);
  runGitSync(dir, ['commit', '-m', 'chore: initial auth service']);

  writeFileSync(
    join(dir, 'src', 'auth.ts'),
    'export function verifyToken(token: string): boolean {\n  return token.startsWith("tok_") && token.length > 4;\n}\n',
    'utf8',
  );
  runGitSync(dir, ['add', 'src/auth.ts']);
  runGitSync(dir, ['commit', '-m', 'Revert "feat: relax token prefix check"']);
}

async function apiJson<T>(
  baseUrl: string,
  token: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${method} ${path}: ${text}`);
  }
  return JSON.parse(text) as T;
}

describe('SDLC Studio v3.1 End-to-End Capabilities', () => {
  it('probes codebase exports, importer fan-in, verify command, Git reverts, and grounds HAMA missions', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'forge-v31-probe-'));
    const repoDir = join(tmpRoot, 'repo-auth');
    const dataDir = join(tmpRoot, 'data');
    mkdirSync(repoDir, {recursive: true});
    initDemoGitRepo(repoDir);

    const runtime = new ForgeRuntime({
      dataDir,
      seedDemoOnEmpty: false,
    });

    try {
      await runtime.start();
      const hub = runtime.store.createHub({
        name: 'v31-probe-hub',
        rootPath: tmpRoot,
        description: 'Probe test hub',
        permissionTier: 'supervised',
      });
      const repo = runtime.store.registerRepository({
        hubId: hub.id,
        name: 'auth-svc',
        tier: 'service',
        localPath: repoDir,
        defaultBranch: 'main',
        verifyCommand: '',
        contractSummary: 'Token verification service',
        boundedContext: 'Identity',
      });

      assert.equal(detectRepoVerifyCommand(repoDir, ''), 'npm test');

      const scanned = await scanRepositoriesForProbe(
        runtime.worktrees,
        runtime.runner,
        [repo],
        'Harden verifyToken inside auth module',
      );
      assert.ok(scanned.scannedFilesCount >= 4);
      const authHit = scanned.matchedFiles.find(
        m => m.filePath === 'src/auth.ts',
      );
      assert.ok(authHit, 'Expected src/auth.ts in probe matchedFiles');
      assert.ok(authHit.exports.includes('verifyToken'));
      assert.ok(authHit.importers.includes('src/api.ts'));
      assert.ok(scanned.recentReverts.length >= 1);
      assert.ok(scanned.realityNotes.length >= 1);

      const triaged = triageMissionIntent({
        rawIntent: 'Tighten verifyToken length validation',
        repoCount: 1,
        documentCount: 0,
        probe: scanned,
      });
      assert.ok(triaged.track === 'standard' || triaged.track === 'full_hama');

      const baseUrl = runtime.httpServer.apiBaseUrl;
      const token = runtime.httpServer.sessionToken;

      const httpProbe = await apiJson<CodebaseProbeReport>(
        baseUrl,
        token,
        '/api/missions/probe',
        'POST',
        {
          hubId: hub.id,
          repoIds: [repo.id],
          rawIntent: 'Update verifyToken validation rules',
          executionMode: 'simulation',
        },
      );
      assert.ok(httpProbe.scannedFilesCount >= 4);

      const created = await apiJson<CreateMissionResponse>(
        baseUrl,
        token,
        '/api/missions',
        'POST',
        {
          hubId: hub.id,
          repoIds: [repo.id],
          title: 'Token Validation Tightening',
          rawIntent: 'Tighten verifyToken in src/auth.ts',
          preset: 'guided',
          executionMode: 'simulation',
        },
      );
      assert.ok(created.mission.id);
      assert.ok(created.probe && created.probe.scannedFilesCount >= 4);
      const probeArtifact = runtime.store.hama.latestArtifact(
        created.mission.id,
        'codebase_probe',
      );
      assert.ok(probeArtifact, 'Expected codebase_probe HAMA artifact stored');
    } finally {
      await runtime.stop();
      rmSync(tmpRoot, {recursive: true, force: true});
    }
  });

  it('classifies failures deterministically, blocks test tampering & spin loops, and serializes Read/Write contention', () => {
    const infra = classifyFailure({
      summary: 'Test command crashed: connect ECONNREFUSED 127.0.0.1:5432',
      diagnostics: ['ECONNREFUSED'],
    });
    assert.equal(infra.category, 'infra_env');
    assert.equal(infra.shouldRetryCoder, false);

    const tamperDiff = [
      'diff --git a/verify/sample.verify.ts b/verify/sample.verify.ts',
      'index 1111111..2222222 100644',
      '--- a/verify/sample.verify.ts',
      '+++ b/verify/sample.verify.ts',
      '@@ -1,3 +1,3 @@',
      '-it("checks invariant", () => {',
      '+it.skip("checks invariant", () => {',
    ].join('\n');
    const tampered = classifyFailure({
      summary: 'Suite exited 0 after edit',
      diagnostics: [],
      diffPatch: tamperDiff,
    });
    assert.equal(tampered.category, 'test_tampering');
    assert.equal(tampered.shouldRetryCoder, false);

    const spec = classifyFailure({
      summary: 'DDD_DRIFT: forbidden alias InvoiceDoc used instead of Voucher',
      diagnostics: ['DDD_DRIFT'],
    });
    assert.equal(spec.category, 'spec_gap');

    const logic = classifyFailure({
      summary: 'AssertionError: expected 400 to equal 200',
      diagnostics: ['verifyToken returned false'],
    });
    assert.equal(logic.category, 'logic_bug');
    assert.equal(logic.shouldRetryCoder, true);

    const ddlDiff = [
      'diff --git a/src/shared/api.ts b/src/shared/api.ts',
      '--- a/src/shared/api.ts',
      '+++ b/src/shared/api.ts',
      '-export function legacyVerifyToken(x: string): boolean {',
      '+// removed',
      'diff --git a/migrations/002_drop.sql b/migrations/002_drop.sql',
      '+++ b/migrations/002_drop.sql',
      '+ALTER TABLE users DROP COLUMN legacy_token;',
    ].join('\n');
    const contractWarnings = detectDestructiveContractChanges(ddlDiff);
    assert.ok(contractWarnings.length >= 2);

    const sameErrorSpin = detectRetrySpin([
      {fingerprint: 'abc123', diffHash: 'd1'},
      {fingerprint: 'abc123', diffHash: 'd2'},
    ]);
    assert.equal(sameErrorSpin.spinning, true);
    assert.equal(sameErrorSpin.reason, 'consecutive_identical_error');

    const abaSpin = detectRetrySpin([
      {fingerprint: 'f1', diffHash: 'same_hash'},
      {fingerprint: 'f2', diffHash: 'other_hash'},
      {fingerprint: 'f1', diffHash: 'same_hash'},
    ]);
    assert.equal(abaSpin.spinning, true);
    assert.equal(abaSpin.reason, 'oscillating_diff_aba');

    const compiled = compileTwinGraph(
      'chg-rw-test',
      [
        {
          code: 'P1',
          title: 'Implementation',
          description: 'Parallel slices',
          tasks: [
            {
              code: 'T1',
              title: 'Update API callers',
              description: 'Calls auth verifier',
              fileScope: ['src/api.ts'],
              dependsOnCodes: [],
            },
            {
              code: 'T2',
              title: 'Update Auth signature',
              description: 'Changes verifyToken',
              fileScope: ['src/auth.ts'],
              dependsOnCodes: [],
            },
          ],
        },
      ],
      'npm test',
      {
        leadAdapterId: 'a1',
        leadModel: 'm1',
        workerAdapterId: 'a2',
        workerModel: 'm2',
        juniorAuditModel: 'm3',
        seniorAuditModel: 'm4',
        maxRetryLoops: 2,
      },
      new Date().toISOString(),
    );

    const parallelTrial = simulateTwinGraphTrial(
      compiled.nodes,
      compiled.edges,
      3,
    );
    assert.equal(parallelTrial.contendedNodePairs.length, 0);

    const serializedTrial = simulateTwinGraphTrial(
      compiled.nodes,
      compiled.edges,
      3,
      new Map([['src/api.ts', ['src/auth.ts']]]),
    );
    assert.ok(serializedTrial.contendedNodePairs.length >= 1);
  });

  it('supports pause-for-takeover, never reverts manual IDE edits on failed verify, certifies on handover fix, and computes Causal Diff', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'forge-v31-takeover-'));
    const repoDir = join(tmpRoot, 'repo-takeover');
    const dataDir = join(tmpRoot, 'data');
    mkdirSync(repoDir, {recursive: true});
    initDemoGitRepo(repoDir);

    const runtime = new ForgeRuntime({
      dataDir,
      seedDemoOnEmpty: false,
    });

    try {
      await runtime.start();
      const hub = runtime.store.createHub({
        name: 'v31-takeover-hub',
        rootPath: tmpRoot,
        description: 'Takeover test hub',
        permissionTier: 'supervised',
      });
      const repo = runtime.store.registerRepository({
        hubId: hub.id,
        name: 'takeover-svc',
        tier: 'service',
        localPath: repoDir,
        defaultBranch: 'main',
        verifyCommand: 'node check.mjs',
        contractSummary: 'Takeover verification service',
        boundedContext: 'Identity',
      });

      const baseUrl = runtime.httpServer.apiBaseUrl;
      const token = runtime.httpServer.sessionToken;

      const change = await runtime.closure.createAndPlanChange({
        hubId: hub.id,
        repoId: repo.id,
        executionMode: 'simulation',
        title: 'Verify handover preserves manual IDE edits',
        summary: 'Manual IDE breakpoint fix workflow verification',
        permissionTier: 'supervised',
        worktreesRoot: runtime.worktreesRoot,
      });

      const nodes = runtime.store.listGraphNodes(change.id);
      const taskNode = nodes.find((n): n is GraphNode => n.kind === 'task');
      assert.ok(taskNode, 'Expected compiled task node');

      const takeover = await apiJson<TakeoverStatusSnapshot>(
        baseUrl,
        token,
        `/api/changes/${change.id}/nodes/${taskNode.id}/takeover`,
        'POST',
        {actor: 'human_operator'},
      );
      assert.equal(takeover.changeStatus, 'paused_human');

      const manualFile = join(change.worktreePath, 'manual-edit.ts');
      writeFileSync(manualFile, 'export const humanEdit = true;\n', 'utf8');

      const statusWithDirty = await apiJson<TakeoverStatusSnapshot>(
        baseUrl,
        token,
        `/api/changes/${change.id}/takeover-status?nodeId=${encodeURIComponent(taskNode.id)}`,
      );
      assert.ok(statusWithDirty.modifiedFiles.includes('manual-edit.ts'));

      const failedHandover = await apiJson<ResumeHandoverResult>(
        baseUrl,
        token,
        `/api/changes/${change.id}/nodes/${taskNode.id}/resume-handover`,
        'POST',
        {
          runVerify: true,
          handoverNote: 'Attempt before fixed.txt created',
          saveAsMemory: false,
          autoResume: false,
        },
      );
      assert.equal(failedHandover.ok, false);
      assert.equal(failedHandover.verifyPassed, false);
      assert.equal(
        existsSync(manualFile),
        true,
        'Manual IDE edit must never be reverted when handover verify fails',
      );

      writeFileSync(join(change.worktreePath, 'fixed.txt'), 'ok\n', 'utf8');
      const passedHandover = await apiJson<ResumeHandoverResult>(
        baseUrl,
        token,
        `/api/changes/${change.id}/nodes/${taskNode.id}/resume-handover`,
        'POST',
        {
          runVerify: true,
          handoverNote: 'Created fixed.txt after debugging in IDE',
          saveAsMemory: true,
          memoryTitle: 'Require fixed.txt marker in takeover-svc',
          autoResume: false,
        },
      );
      assert.equal(passedHandover.ok, true);
      assert.equal(passedHandover.verifyPassed, true);
      assert.ok(passedHandover.checkpointSha);
      assert.ok(passedHandover.checkpointTag?.includes('HANDOVER-'));
      assert.equal(passedHandover.memoryRetained, true);

      const updatedNode = runtime.store
        .listGraphNodes(change.id)
        .find(n => n.id === taskNode.id);
      assert.equal(updatedNode?.status, 'certified');

      const causal = await apiJson<CausalDiffReport>(
        baseUrl,
        token,
        `/api/changes/${change.id}/causal-diff`,
      );
      assert.ok(causal.totalFiles >= 2);
      assert.ok(causal.groups.length >= 1);
    } finally {
      await runtime.stop();
      rmSync(tmpRoot, {recursive: true, force: true});
    }
  });

  it('reconciles external Git hotfixes & Revert commits against L3_locked memory and resolves contested observations', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'forge-v31-reconcile-'));
    const repoDir = join(tmpRoot, 'repo-reconcile');
    const dataDir = join(tmpRoot, 'data');
    mkdirSync(repoDir, {recursive: true});
    initDemoGitRepo(repoDir);

    const runtime = new ForgeRuntime({
      dataDir,
      seedDemoOnEmpty: false,
    });

    try {
      await runtime.start();
      const hub = runtime.store.createHub({
        name: 'v31-reconcile-hub',
        rootPath: tmpRoot,
        description: 'Reconcile test hub',
        permissionTier: 'supervised',
      });
      const repo = runtime.store.registerRepository({
        hubId: hub.id,
        name: 'reconcile-svc',
        tier: 'service',
        localPath: repoDir,
        defaultBranch: 'main',
        verifyCommand: 'node check.mjs',
        contractSummary: 'Reconcile service',
        boundedContext: 'Identity',
      });

      runtime.hindsight.retain({
        hubId: hub.id,
        repoId: repo.id,
        executionMode: 'live',
        sourceType: 'human_review',
        rawText: 'Tokens verified in src/auth.ts must require prefix tok_.',
        authorityTier: 'L3_locked',
        structuredFacts: [
          {
            kind: 'constraint',
            subjectKey: `repo:${repo.id}:auth:token_prefix`,
            claim: 'Tokens verified in src/auth.ts must start with tok_.',
            pathAnchors: ['src/auth.ts'],
            entityNames: ['verifyToken', 'src/auth.ts'],
          },
        ],
      });
      runtime.hindsight.consolidatePendingFacts(hub.id, 'live');

      const obsBefore = runtime.store.memory
        .listObservations(hub.id, 'live', false)
        .find(o => o.pathAnchors.includes('src/auth.ts'));
      assert.ok(obsBefore, 'Expected L3_locked observation on src/auth.ts');
      assert.equal(obsBefore.authorityTier, 'L3_locked');

      writeFileSync(
        join(repoDir, 'src', 'auth.ts'),
        'export function verifyToken(token: string): boolean {\n  return token.startsWith("live_");\n}\n',
        'utf8',
      );
      runGitSync(repoDir, ['add', 'src/auth.ts']);
      runGitSync(repoDir, ['commit', '-m', 'hotfix: accept live_ tokens']);

      const baseUrl = runtime.httpServer.apiBaseUrl;
      const token = runtime.httpServer.sessionToken;

      const reconcile = await apiJson<GitReconcileResult>(
        baseUrl,
        token,
        '/api/memory/reconcile-git',
        'POST',
        {hubId: hub.id, executionMode: 'live', repoIds: [repo.id]},
      );
      assert.equal(reconcile.checkedRepos, 1);
      assert.ok(reconcile.contestedObservationIds.includes(obsBefore.id));
      assert.ok(reconcile.detectedReverts.length >= 1);
      assert.ok(reconcile.retainedPitfalls >= 1);

      const obsContested = runtime.store.memory.getObservation(obsBefore.id);
      assert.equal(obsContested?.beliefStatus, 'contested');
      assert.equal(obsContested?.staleSuspect, true);

      const resolved = await apiJson<MemoryObservationRecord>(
        baseUrl,
        token,
        `/api/memory/observations/${encodeURIComponent(obsBefore.id)}/reconcile`,
        'POST',
        {
          resolution: 'adopt_code',
          newStatement:
            'Tokens verified in src/auth.ts accept live_ prefix per hotfix.',
        },
      );
      assert.equal(resolved.beliefStatus, 'active');
      assert.equal(resolved.staleSuspect, false);
      assert.equal(
        resolved.statement,
        'Tokens verified in src/auth.ts accept live_ prefix per hotfix.',
      );
      assert.ok(resolved.history.length >= 1);
    } finally {
      await runtime.stop();
      rmSync(tmpRoot, {recursive: true, force: true});
    }
  });
});

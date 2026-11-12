/**
 * Verification Gate 2: Real Git Worktree Isolation, Rescue-Backed Physical
 * Checkpoint Rewind, Scoped `forge_station` MCP Token Auth, and Secret Scrubbing.
 */

import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {McpStationServer} from '../src/adapters/mcp-station.ts';
import {GitWorktreeManager} from '../src/sandbox/git-worktree.ts';
import {SandboxProcessRunner} from '../src/sandbox/process-runner.ts';
import {ForgeStore} from '../src/store/database.ts';

describe('Git Worktree Sandbox, Rescue Rollback & Scoped MCP Station', () => {
  it('provisions isolated worktrees, blocks path traversal, and preserves rescue ref on rewind', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeops-verify-sbx-'));
    const repoPath = join(tempRoot, 'service-repo');
    const wtRoot = join(tempRoot, 'worktrees');
    const runner = new SandboxProcessRunner();
    const worktrees = new GitWorktreeManager(runner);

    try {
      // Verify symlink/traversal confinement rejects ../ escape
      assert.throws(
        () => worktrees.resolveInside(wtRoot, '../../outside-secret.txt'),
        /SANDBOX_ESCAPE/,
      );

      // Verify secret scrubbing strips host API_KEYs unless allowlisted
      process.env['TEST_EPHEMERAL_SECRET_TOKEN'] = 'top-secret-value-123';
      const envCheck = await runner.run({
        executable: process.execPath,
        args: [
          '-e',
          'process.stdout.write(process.env.TEST_EPHEMERAL_SECRET_TOKEN ?? "SCRUBBED")',
        ],
        cwd: tempRoot,
      });
      assert.equal(envCheck.stdout, 'SCRUBBED');
      delete process.env['TEST_EPHEMERAL_SECRET_TOKEN'];

      const baseSha = await worktrees.ensureGitRepoInitialized(
        repoPath,
        'main',
      );
      assert.equal(baseSha.length, 40);

      const handle = await worktrees.provisionWorktree({
        repoPath,
        worktreesRoot: wtRoot,
        repoId: 'repo-settlement',
        changeCode: 'CHG-001',
      });
      assert.equal(existsSync(handle.worktreePath), true);

      // Create CP-1 with clean file
      const goodFile = join(handle.worktreePath, 'voucher.ts');
      writeFileSync(goodFile, 'export const v = 1;\n', 'utf8');
      const cp1 = await worktrees.createCheckpoint({
        worktreePath: handle.worktreePath,
        changeCode: 'CHG-001',
        nodeCode: 'CP-1',
        message: 'feat: add voucher v1',
      });
      assert.ok(cp1.changedFiles.includes('voucher.ts'));

      // Introduce broken file after CP-1, commit it, then rewind to CP-1
      const badFile = join(handle.worktreePath, 'broken.ts');
      writeFileSync(badFile, 'SYNTAX_ERROR!!!\n', 'utf8');
      await worktrees.createCheckpoint({
        worktreePath: handle.worktreePath,
        changeCode: 'CHG-001',
        nodeCode: 'BROKEN',
        message: 'wip: broken attempt',
      });
      assert.equal(existsSync(badFile), true);

      const rewound = await worktrees.rewindToCheckpoint({
        worktreePath: handle.worktreePath,
        changeCode: 'CHG-001',
        targetCommitSha: cp1.commitSha,
      });
      assert.equal(rewound.restoredCommitSha, cp1.commitSha);
      assert.equal(existsSync(badFile), false);
      assert.match(rewound.rescueRef, /^refs\/forgeops-backup\/chg-001\//);

      // Verify rescue ref actually exists in Git so zero work is ever permanently lost!
      const verifyRef = await runner.run({
        executable: 'git',
        args: ['rev-parse', '--verify', rewound.rescueRef],
        cwd: handle.worktreePath,
      });
      assert.equal(verifyRef.exitCode, 0);
    } finally {
      rmSync(tempRoot, {recursive: true, force: true});
    }
  });

  it('authenticates per-attempt MCP bearer tokens and revokes access immediately after slice exit', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeops-verify-mcp-'));
    const store = new ForgeStore(':memory:');
    const runner = new SandboxProcessRunner();
    const worktrees = new GitWorktreeManager(runner);
    const mcp = new McpStationServer(store, worktrees);

    try {
      await mcp.start();
      const hub = store.createHub({
        name: 'MCP Hub',
        rootPath: tempRoot,
        description: 'MCP test',
        permissionTier: 'turbo',
      });

      // Unauthenticated call MUST return HTTP 401
      const unauth = await fetch(`${mcp.baseUrl}/mcp`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'}),
      });
      assert.equal(unauth.status, 401);

      const reg = mcp.registerAttempt({
        hubId: hub.id,
        changeId: 'chg-1',
        nodeId: 'node-1',
        worktreePath: tempRoot,
        contractMarkdown: '# Locked Mandate',
      });

      const submitRes = await fetch(`${mcp.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${reg.attemptToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'forge_submit',
            arguments: {
              summary: 'Implemented SettlementVoucher idempotency',
              specConfirmedFacts: ['Idempotency key verified'],
              agentHypotheses: ['Downstream retry window <= 5m'],
            },
          },
        }),
      });
      assert.equal(submitRes.status, 200);
      assert.equal(
        mcp.getSubmission(reg.attemptToken)?.summary,
        'Implemented SettlementVoucher idempotency',
      );

      // Revoking token immediately blocks subsequent calls with 401
      reg.revoke();
      const afterRevoke = await fetch(`${mcp.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${reg.attemptToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({jsonrpc: '2.0', id: 3, method: 'tools/list'}),
      });
      assert.equal(afterRevoke.status, 401);
    } finally {
      await mcp.stop();
      store.close();
      rmSync(tempRoot, {recursive: true, force: true});
    }
  });
});

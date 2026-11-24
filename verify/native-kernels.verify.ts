/**
 * Verification Suite: Native Multi-Agent Kernel Mounting, Windows CLI Shim
 * Unwrapping, CollabBus Buzz/Ankole Audience Intersection, CLI JSONL Hardening,
 * and Loopback HTTP `forge_station` Cross-Agent Collaboration Tools.
 */

import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {
  buildCliInvocationArgs,
  parseCliJsonlLine,
  runCliStreamSession,
} from '../src/adapters/cli-stream.ts';
import {
  CollabBus,
  narrowAudienceScope,
  type CollabMessage,
} from '../src/adapters/collab-bus.ts';
import {McpStationServer} from '../src/adapters/mcp-station.ts';
import {
  CrossKernelCollaborator,
  GEMINI_CLI_MANIFEST,
  listAllKernelManifests,
  probeNativeKernels,
} from '../src/adapters/native-kernels.ts';
import type {
  ISandboxProcessRunner,
  ProcessRunOptions,
  ProcessRunResult,
} from '../src/sandbox/contracts.ts';
import {GitWorktreeManager} from '../src/sandbox/git-worktree.ts';
import {SandboxProcessRunner} from '../src/sandbox/process-runner.ts';
import {ForgeStore} from '../src/store/database.ts';
import {BUILTIN_ADAPTER_MANIFESTS} from '../src/store/schema.ts';

async function callMcp(
  baseUrl: string,
  token: string,
  id: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<{
  readonly status: number;
  readonly body: Record<string, unknown>;
}> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? {params} : {}),
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return {status: res.status, body};
}

describe('Native Multi-Agent Kernels, CollabBus & MCP Collaboration', () => {
  it('resolves and probes installed native CLIs (claude, codex, gemini) with bounded timeout', async () => {
    const runner = new SandboxProcessRunner();
    const manifests = listAllKernelManifests();

    assert.ok(manifests.some(m => m.id === 'claude-code'));
    assert.ok(manifests.some(m => m.id === 'codex'));
    assert.ok(manifests.some(m => m.id === 'gemini-cli'));
    assert.ok(manifests.some(m => m.id === 'native-api'));
    assert.equal(GEMINI_CLI_MANIFEST.command, 'gemini');
    assert.equal(GEMINI_CLI_MANIFEST.jsonlParser, 'generic-jsonl');

    // Direct runner resolution & --version probe for each locally installed CLI
    for (const cmd of ['claude', 'codex', 'gemini']) {
      const resolved = runner.resolveExecutable(cmd);
      assert.ok(
        resolved,
        `Expected "${cmd}" to resolve on PATH on this Windows host`,
      );
      assert.ok(
        !/\.ps1$/i.test(resolved),
        `Expected "${cmd}" resolution not to select PowerShell .ps1 shim: ${resolved}`,
      );
      const probe = await runner.run({
        executable: cmd,
        args: ['--version'],
        cwd: process.cwd(),
        timeoutMs: 5_000,
      });
      assert.equal(
        probe.timedOut,
        false,
        `Expected "${cmd} --version" not to time out`,
      );
      assert.equal(
        probe.exitCode,
        0,
        `Expected "${cmd} --version" exitCode 0, got ${probe.exitCode} (stderr: ${probe.stderr})`,
      );
      assert.ok(
        `${probe.stdout}${probe.stderr}`.trim().length > 0,
        `Expected non-empty version output for "${cmd}"`,
      );
    }

    const startedAt = Date.now();
    const statuses = await probeNativeKernels(runner, undefined, 5_000);
    const elapsedMs = Date.now() - startedAt;

    assert.ok(
      elapsedMs < 15_000,
      `Expected parallel kernel probe to stay bounded (took ${elapsedMs}ms)`,
    );

    const byId = new Map(statuses.map(s => [s.id, s]));
    for (const id of ['claude-code', 'codex', 'gemini-cli', 'native-api']) {
      const st = byId.get(id);
      assert.ok(st, `Expected kernel status entry for "${id}"`);
      assert.equal(
        st.available,
        true,
        `Expected kernel "${id}" available=true, got detail: ${st.statusDetail}`,
      );
      assert.ok(st.resolvedPath, `Expected resolvedPath for "${id}"`);
      assert.ok(st.version, `Expected version for "${id}"`);
      assert.ok(st.recommendedFor.length > 0);
    }
  });

  it('enforces Buzz/Ankole audience-intersection gates on CollabBus queries and subscriptions', () => {
    const bus = new CollabBus();
    const worldStream: CollabMessage[] = [];
    const aliceStream: CollabMessage[] = [];

    const unsubWorld = bus.subscribe(msg => worldStream.push(msg), {
      missionId: 'mis-sec',
      readerId: 'guest-public',
      readerScope: 'world',
    });
    const unsubAlice = bus.subscribe(msg => aliceStream.push(msg), {
      missionId: 'mis-sec',
      readerId: 'alice',
      readerScope: 'private:alice',
    });

    const mWorld = bus.post({
      missionId: 'mis-sec',
      fromAgent: 'master',
      kind: 'decision',
      summary: 'Public release notes ready',
      audienceScope: 'world',
    });
    const mTeam = bus.post({
      missionId: 'mis-sec',
      fromAgent: 'codex:coder',
      kind: 'handoff',
      summary: 'Internal refactor ready for peer review',
      audienceScope: 'team',
    });
    const mTask1 = bus.post({
      missionId: 'mis-sec',
      taskId: 'task-1',
      fromAgent: 'codex:coder',
      kind: 'finding',
      summary: 'Task-1 isolated schema migration note',
      audienceScope: 'task:task-1',
    });
    const mPrivateAlice = bus.post({
      missionId: 'mis-sec',
      fromAgent: 'alice',
      kind: 'finding',
      summary: 'Confidential security rotation key detail',
      audienceScope: 'private:alice',
    });
    const mRestrictedList = bus.post({
      missionId: 'mis-sec',
      fromAgent: 'master',
      kind: 'review',
      summary: 'Restricted audit note only for alice and auditor',
      audienceScope: 'team',
      allowedReaders: ['alice', 'auditor'],
    });

    unsubWorld();
    unsubAlice();

    // 1. World reader MUST see ONLY the world message (zero leakage)
    const worldView = bus.query({
      missionId: 'mis-sec',
      readerId: 'guest-public',
      readerScope: 'world',
    });
    assert.deepEqual(
      worldView.map(m => m.id),
      [mWorld.id],
    );
    assert.deepEqual(
      worldStream.map(m => m.id),
      [mWorld.id],
    );

    // 2. Unrelated team reader MUST NOT see private:alice, task:task-1, or allowedReaders-restricted msg
    const bobTeamView = bus.query({
      missionId: 'mis-sec',
      readerId: 'bob',
      readerScope: 'team',
    });
    assert.deepEqual(
      bobTeamView.map(m => m.id),
      [mWorld.id, mTeam.id],
    );

    // 3. Task-2 reader MUST NOT see task:task-1 or private:alice
    const task2View = bus.query({
      missionId: 'mis-sec',
      readerId: 'worker-2',
      readerScope: 'task:task-2',
      readerTaskId: 'task-2',
    });
    assert.deepEqual(
      task2View.map(m => m.id),
      [mWorld.id, mTeam.id],
    );

    // 4. Task-1 reader sees world, team, and task:task-1, but NOT private:alice or restricted list
    const task1View = bus.query({
      missionId: 'mis-sec',
      readerId: 'worker-1',
      readerScope: 'task:task-1',
      readerTaskId: 'task-1',
    });
    assert.deepEqual(
      task1View.map(m => m.id),
      [mWorld.id, mTeam.id, mTask1.id],
    );

    // 5. Alice sees world, team, private:alice, and restricted list (NOT unrelated task:task-1)
    const aliceView = bus.query({
      missionId: 'mis-sec',
      readerId: 'alice',
      readerScope: 'private:alice',
    });
    assert.deepEqual(
      aliceView.map(m => m.id),
      [mWorld.id, mTeam.id, mPrivateAlice.id, mRestrictedList.id],
    );
    assert.deepEqual(
      aliceStream.map(m => m.id),
      [mWorld.id, mTeam.id, mPrivateAlice.id, mRestrictedList.id],
    );

    // 6. narrowAudienceScope prevents disclosure widening
    assert.equal(
      narrowAudienceScope('private:alice', 'world'),
      'private:alice',
    );
    assert.equal(narrowAudienceScope('private:alice', 'team'), 'private:alice');
    assert.equal(narrowAudienceScope('task:task-1', 'world'), 'task:task-1');
    assert.equal(narrowAudienceScope('task:task-1', 'team'), 'task:task-1');
    assert.equal(narrowAudienceScope('team', 'world'), 'team');
    assert.equal(narrowAudienceScope('team', 'private:alice'), 'private:alice');
  });

  it('hardens CLI args, JSONL parsing, and rate-limit/auth classification across claude, codex, and gemini', async () => {
    const claudeManifest = BUILTIN_ADAPTER_MANIFESTS.find(
      m => m.id === 'claude-code',
    )!;
    const codexManifest = BUILTIN_ADAPTER_MANIFESTS.find(
      m => m.id === 'codex',
    )!;

    // Gemini CLI `-p` normalization + `--model` + readOnly `--approval-mode plan`
    const geminiBuilt = buildCliInvocationArgs({
      sessionId: 's-1',
      hubId: 'h-1',
      changeId: 'c-1',
      nodeId: 'n-1',
      role: 'evaluator',
      adapter: GEMINI_CLI_MANIFEST,
      model: 'gemini-2.5-pro',
      permissionTier: 'turbo',
      cwd: process.cwd(),
      systemPrompt: 'Review carefully.',
      userPrompt: 'Check diff.',
      readOnly: true,
    });
    const pIdx = geminiBuilt.args.indexOf('-p');
    assert.ok(pIdx >= 0);
    assert.equal(geminiBuilt.args[pIdx + 1], '');
    assert.ok(geminiBuilt.args.includes('--output-format'));
    assert.ok(geminiBuilt.args.includes('--model'));
    assert.ok(geminiBuilt.args.includes('gemini-2.5-pro'));
    assert.ok(geminiBuilt.args.includes('--approval-mode'));
    assert.ok(geminiBuilt.args.includes('plan'));
    assert.ok(!geminiBuilt.args.includes('yolo'));
    assert.ok(geminiBuilt.stdinText?.includes('Check diff.'));

    // Claude readOnly strips --dangerously-skip-permissions and passes --model
    const claudeBuilt = buildCliInvocationArgs({
      sessionId: 's-2',
      hubId: 'h-1',
      changeId: 'c-1',
      nodeId: 'n-1',
      role: 'evaluator',
      adapter: claudeManifest,
      model: 'claude-sonnet-4-5',
      permissionTier: 'turbo',
      cwd: process.cwd(),
      systemPrompt: 'Audit',
      userPrompt: 'Inspect',
      readOnly: true,
    });
    assert.ok(!claudeBuilt.args.includes('--dangerously-skip-permissions'));
    assert.ok(claudeBuilt.args.includes('--model'));

    // JSONL parsing: Gemini CLI message, user echo skip, tool_use, stats
    const geminiMsg = parseCliJsonlLine(
      'generic-jsonl',
      JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: 'Gemini review passed',
      }),
      'gemini-cli',
    );
    assert.equal(geminiMsg?.text, 'Gemini review passed');
    assert.equal(geminiMsg?.role, 'assistant');

    const geminiUserEcho = parseCliJsonlLine(
      'generic-jsonl',
      JSON.stringify({
        type: 'message',
        role: 'user',
        content: 'echoed prompt',
      }),
      'gemini-cli',
    );
    assert.equal(geminiUserEcho?.text, '');

    const geminiResult = parseCliJsonlLine(
      'generic-jsonl',
      JSON.stringify({
        type: 'result',
        status: 'success',
        stats: {input_tokens: 120, output_tokens: 45, cached: 30},
      }),
      'gemini-cli',
    );
    assert.equal(geminiResult?.inputTokens, 120);
    assert.equal(geminiResult?.outputTokens, 45);
    assert.equal(geminiResult?.cachedTokens, 30);

    // JSONL parsing: Claude delta & Codex turn.failed
    const claudeDelta = parseCliJsonlLine(
      'claude-stream',
      JSON.stringify({
        type: 'content_block_delta',
        delta: {type: 'text_delta', text: 'chunk-1'},
      }),
      'claude-code',
    );
    assert.equal(claudeDelta?.text, 'chunk-1');

    const codexFail = parseCliJsonlLine(
      'codex-rpc',
      JSON.stringify({
        type: 'turn.failed',
        error: {message: 'HTTP 429 rate limit exceeded'},
      }),
      'codex',
    );
    assert.equal(codexFail?.isError, true);
    assert.match(codexFail?.text ?? '', /429/);

    // Mock runner verifying rate_limited and AUTH_REQUIRED classification
    const makeMockRunner = (
      stdout: string,
      stderr: string,
      exitCode: number,
    ): ISandboxProcessRunner => ({
      resolveExecutable: () => '/mock/bin',
      run: async (opts: ProcessRunOptions): Promise<ProcessRunResult> => {
        for (const line of stdout.split('\n')) {
          if (line.trim()) {
            opts.onStdoutLine?.(line);
          }
        }
        return {exitCode, stdout, stderr, timedOut: false, durationMs: 12};
      },
      runCommandString: async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        durationMs: 1,
      }),
    });

    const rateRes = await runCliStreamSession(
      {
        sessionId: 's-rate',
        hubId: 'h-1',
        changeId: 'c-1',
        nodeId: 'n-1',
        role: 'worker',
        adapter: codexManifest,
        model: 'gpt-5-codex',
        permissionTier: 'strict',
        cwd: process.cwd(),
        systemPrompt: 'sys',
        userPrompt: 'usr',
        readOnly: true,
      },
      makeMockRunner(
        JSON.stringify({
          type: 'turn.failed',
          error: {message: '429 Too Many Requests'},
        }),
        '',
        1,
      ),
    );
    assert.equal(rateRes.outcome, 'rate_limited');

    const authRes = await runCliStreamSession(
      {
        sessionId: 's-auth',
        hubId: 'h-1',
        changeId: 'c-1',
        nodeId: 'n-1',
        role: 'worker',
        adapter: GEMINI_CLI_MANIFEST,
        model: 'gemini-2.5-pro',
        permissionTier: 'strict',
        cwd: process.cwd(),
        systemPrompt: 'sys',
        userPrompt: 'usr',
        readOnly: true,
      },
      makeMockRunner(
        '',
        'Error 401 Unauthorized: login required for Gemini CLI',
        1,
      ),
    );
    assert.equal(authRes.outcome, 'env_fault');
    assert.match(authRes.diagnostic, /^AUTH_REQUIRED:/);
  });

  it('exposes forge_collab_post, forge_collab_read, and forge_collab_delegate over loopback HTTP MCP with audience enforcement', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeops-verify-collab-mcp-'));
    const store = new ForgeStore(':memory:');
    const runner = new SandboxProcessRunner();
    const worktrees = new GitWorktreeManager(runner);
    const mcp = new McpStationServer(store, worktrees);
    const collabBus = new CollabBus();

    try {
      await mcp.start();
      const hub = store.createHub({
        name: 'Collab MCP Hub',
        rootPath: tempRoot,
        description: 'Loopback MCP collaboration test',
        permissionTier: 'supervised',
      });

      const coderReg = mcp.registerAttempt({
        hubId: hub.id,
        missionId: 'mis-mcp-1',
        changeId: 'chg-mcp-1',
        nodeId: 'node-code',
        worktreePath: tempRoot,
        contractMarkdown: '# Code Slice',
        collabBus,
        agentIdentity: 'codex:coder',
        audienceScope: 'team',
      });

      const privateReg = mcp.registerAttempt({
        hubId: hub.id,
        missionId: 'mis-mcp-1',
        changeId: 'chg-mcp-1',
        nodeId: 'node-sec',
        worktreePath: tempRoot,
        contractMarkdown: '# Private Security Slice',
        collabBus,
        agentIdentity: 'sec-lead',
        audienceScope: 'private:sec-lead',
      });

      const publicReg = mcp.registerAttempt({
        hubId: hub.id,
        missionId: 'mis-mcp-1',
        changeId: 'chg-mcp-1',
        nodeId: 'node-public',
        worktreePath: tempRoot,
        contractMarkdown: '# Public Docs Slice',
        collabBus,
        agentIdentity: 'public-bot',
        audienceScope: 'world',
      });

      // 1. tools/list advertises all 3 new collaboration tools
      const listRes = await callMcp(
        mcp.baseUrl,
        coderReg.attemptToken,
        1,
        'tools/list',
      );
      assert.equal(listRes.status, 200);
      const tools = (
        (listRes.body['result'] as Record<string, unknown>)['tools'] as Array<{
          name: string;
        }>
      ).map(t => t.name);
      assert.ok(tools.includes('forge_collab_post'));
      assert.ok(tools.includes('forge_collab_read'));
      assert.ok(tools.includes('forge_collab_delegate'));

      // 2. Coder posts team handoff
      const postRes = await callMcp(
        mcp.baseUrl,
        coderReg.attemptToken,
        2,
        'tools/call',
        {
          name: 'forge_collab_post',
          arguments: {
            kind: 'handoff',
            toAgent: 'claude-code:reviewer',
            summary: 'Implemented auth middleware in src/auth.ts',
            artifactRef: 'src/auth.ts',
          },
        },
      );
      assert.equal(postRes.status, 200);
      const postStructured = (
        postRes.body['result'] as Record<string, unknown>
      )['structured'] as {ok: boolean; message: CollabMessage};
      assert.equal(postStructured.ok, true);
      assert.equal(postStructured.message.audienceScope, 'team');

      // 3. Private attempt tries to post with audienceScope:'world' -> clamped to private:sec-lead
      const privPostRes = await callMcp(
        mcp.baseUrl,
        privateReg.attemptToken,
        3,
        'tools/call',
        {
          name: 'forge_collab_post',
          arguments: {
            kind: 'finding',
            summary: 'Zero-day secret audit note',
            audienceScope: 'world',
          },
        },
      );
      assert.equal(privPostRes.status, 200);
      const privStructured = (
        privPostRes.body['result'] as Record<string, unknown>
      )['structured'] as {ok: boolean; message: CollabMessage};
      assert.equal(privStructured.message.audienceScope, 'private:sec-lead');

      // 4. Coder delegates review to claude-code
      const delRes = await callMcp(
        mcp.baseUrl,
        coderReg.attemptToken,
        4,
        'tools/call',
        {
          name: 'forge_collab_delegate',
          arguments: {
            targetKernel: 'claude-code',
            role: 'reviewer',
            prompt: 'Audit src/auth.ts against spec invariants',
            fileScope: ['src/auth.ts'],
          },
        },
      );
      assert.equal(delRes.status, 200);
      const delStructured = (delRes.body['result'] as Record<string, unknown>)[
        'structured'
      ] as {accepted: boolean; targetKernel: string; status: string};
      assert.equal(delStructured.accepted, true);
      assert.equal(delStructured.targetKernel, 'claude-code');

      // 5. Public/world reader MUST see 0 messages (team + private are both filtered)
      const publicRead = await callMcp(
        mcp.baseUrl,
        publicReg.attemptToken,
        5,
        'tools/call',
        {
          name: 'forge_collab_read',
          arguments: {sinceSeq: 0, limit: 20},
        },
      );
      const publicStructured = (
        publicRead.body['result'] as Record<string, unknown>
      )['structured'] as {count: number; messages: CollabMessage[]};
      assert.equal(publicStructured.count, 0);

      // 6. Coder (team) sees handoff + delegate (2 msgs), NEVER private:sec-lead
      const coderRead = await callMcp(
        mcp.baseUrl,
        coderReg.attemptToken,
        6,
        'tools/call',
        {
          name: 'forge_collab_read',
          arguments: {sinceSeq: 0, limit: 20},
        },
      );
      const coderStructured = (
        coderRead.body['result'] as Record<string, unknown>
      )['structured'] as {count: number; messages: CollabMessage[]};
      assert.equal(coderStructured.count, 2);
      assert.ok(
        coderStructured.messages.every(
          m => m.audienceScope !== 'private:sec-lead',
        ),
      );

      // 7. Private reader sees all 3 (team + its own private finding)
      const privRead = await callMcp(
        mcp.baseUrl,
        privateReg.attemptToken,
        7,
        'tools/call',
        {
          name: 'forge_collab_read',
          arguments: {sinceSeq: 0, limit: 20},
        },
      );
      const privReadStructured = (
        privRead.body['result'] as Record<string, unknown>
      )['structured'] as {count: number; messages: CollabMessage[]};
      assert.equal(privReadStructured.count, 3);

      coderReg.revoke();
      privateReg.revoke();
      publicReg.revoke();
    } finally {
      await mcp.stop();
      store.close();
      rmSync(tempRoot, {recursive: true, force: true});
    }
  });

  it('executes CrossKernelCollaborator handoff workflow and blocks self-review', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeops-verify-xkernel-'));
    const collabBus = new CollabBus();
    const collaborator = new CrossKernelCollaborator({collabBus});

    try {
      await assert.rejects(
        () =>
          collaborator.runWorkflow({
            missionId: 'mis-xk',
            taskId: 't-self',
            cwd: tempRoot,
            coderKernelId: 'codex',
            reviewerKernelId: 'codex',
            taskPrompt: 'Implement module',
            mode: 'fallback',
          }),
        /Anti-self-approval/,
      );

      const wf = await collaborator.runWorkflow({
        missionId: 'mis-xk',
        taskId: 't-1',
        cwd: tempRoot,
        coderKernelId: 'codex',
        reviewerKernelId: 'claude-code',
        taskPrompt: 'Create deterministic pricing utility',
        artifactRelPath: 'src/pricing.ts',
        fallbackArtifactContent:
          'export function calcTotal(price: number): number { return price * 1.1; }\n',
        mode: 'fallback',
      });

      assert.equal(wf.passed, true);
      assert.equal(wf.modeUsed, 'fallback');
      assert.equal(wf.coderStep.collabMessage.kind, 'handoff');
      assert.equal(wf.reviewerStep.collabMessage.kind, 'review');
      const artifactFull = join(tempRoot, 'src/pricing.ts');
      assert.equal(existsSync(artifactFull), true);
      assert.match(readFileSync(artifactFull, 'utf8'), /calcTotal/);

      const busMessages = collabBus.listByMission('mis-xk', {
        readerId: 'claude-code:reviewer',
        readerScope: 'team',
      });
      assert.equal(busMessages.length, 2);
      assert.equal(busMessages[0]?.kind, 'handoff');
      assert.equal(busMessages[1]?.kind, 'review');
    } finally {
      rmSync(tempRoot, {recursive: true, force: true});
    }
  });
});

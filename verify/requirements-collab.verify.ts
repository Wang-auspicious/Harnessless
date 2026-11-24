/**
 * Verification Gate: Model Gateway (Magpie-inspired), Vercel-Board Multi-Actor
 * Channels/Threads/Queues/Schedules, Rich Media & Decision Polls, and
 * Overleaf-style Live Co-Edited PRD -> Spec IR & Excalidraw Board Compilation.
 */

import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {
  applyPrivacyMask,
  restorePrivacyMask,
} from '../src/engines/model-gateway.ts';
import {ForgeRuntime} from '../src/server/runtime.ts';
import type {
  BoardSceneDoc,
  CollabDocSnapshot,
  CollabPostRecord,
  DashboardSummaryPayload,
  GatewaySnapshot,
  ModelProviderRecord,
  RoutingGroupRecord,
  ScheduledTriggerRecord,
  SpecIRContract,
  V4SessionDetail,
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

describe('Model Gateway, Multi-Actor Channels & Live PRD->Spec Sync', () => {
  it('masks sensitive keys/emails locally and restores them accurately', () => {
    const input =
      'Use sk-secret-abcdef1234567890 and ghp_1234567890abcdef1234 with alice@private-corp.org or qa@example.com.';
    const {maskedText, tokenMap} = applyPrivacyMask(input, {
      enabled: true,
      maskSecrets: true,
      maskEmails: true,
      allowDomains: ['example.com'],
    });
    assert.ok(!maskedText.includes('sk-secret-abcdef1234567890'));
    assert.ok(!maskedText.includes('ghp_1234567890abcdef1234'));
    assert.ok(!maskedText.includes('alice@private-corp.org'));
    assert.ok(maskedText.includes('qa@example.com'));
    const restored = restorePrivacyMask(maskedText, tokenMap);
    assert.equal(restored, input);
  });

  it('exercises Gateway providers, routing strategies, channels, threads, polls, mockups, queues, schedules, and Overleaf PRD->Spec compilation', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'forgeops-req-collab-data-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'forgeops-req-collab-repo-'));
    const runtime = new ForgeRuntime({dataDir, seedDemoOnEmpty: false});

    try {
      await runtime.start();
      const base = runtime.httpServer.apiBaseUrl;
      const token = runtime.httpServer.sessionToken;

      // 1. Gateway baseline + provider CRUD + key masking
      const gw0 = await apiJson<GatewaySnapshot>(
        base,
        token,
        'GET',
        '/api/v4/gateway',
      );
      assert.equal(gw0.status, 200);
      assert.ok(gw0.body.providers.length >= 4);
      assert.ok(gw0.body.routingGroups.length >= 2);
      assert.ok(gw0.body.profiles.length >= 2);
      assert.ok(gw0.body.agents.length >= 6);
      assert.ok(gw0.body.connectors.length >= 4);

      const upsertProv = await apiJson<{
        readonly provider: ModelProviderRecord;
        readonly gateway: GatewaySnapshot;
      }>(base, token, 'PUT', '/api/v4/providers', {
        id: 'prov-custom-test',
        name: 'Custom Compatible Hub',
        kind: 'openai-compatible',
        baseUrl: 'https://llm.local.invalid/v1',
        newApiKey: 'sk-custom-magpie-key-999999999',
        newKeyLabel: 'Primary Key',
        enabled: true,
      });
      assert.equal(upsertProv.status, 200);
      assert.equal(upsertProv.body.provider.id, 'prov-custom-test');
      assert.equal(upsertProv.body.provider.apiKeys.length, 1);
      assert.ok(
        upsertProv.body.provider.apiKeys[0]!.keyPreview.startsWith('sk-c'),
      );
      assert.equal(
        upsertProv.body.provider.apiKeys[0]!.rawKey,
        undefined,
        'rawKey must never leak in API snapshot',
      );

      // 2. Routing group strategies ('context-tiered' / 'rotate') + profiles + agent bindings + connectors + privacy masking
      const upsertGrp = await apiJson<{
        readonly group: RoutingGroupRecord;
        readonly gateway: GatewaySnapshot;
      }>(base, token, 'PUT', '/api/v4/routing-groups', {
        id: 'grp-custom-ctx',
        name: 'Tiered Context Pool',
        strategy: 'context-tiered',
        targets: [
          {
            id: 'tc-1',
            providerId: 'prov-anthropic',
            modelId: 'claude-sonnet-4-5',
            maxContextK: 200,
          },
          {
            id: 'tc-2',
            providerId: 'prov-gemini',
            modelId: 'gemini-2.5-pro',
            maxContextK: 1000,
          },
        ],
        failoverEnabled: true,
      });
      assert.equal(upsertGrp.status, 200);
      assert.equal(upsertGrp.body.group.strategy, 'context-tiered');

      const activateProf = await apiJson<{readonly gateway: GatewaySnapshot}>(
        base,
        token,
        'POST',
        '/api/v4/profiles/prof-balanced/activate',
        {},
      );
      assert.equal(activateProf.status, 200);
      assert.ok(
        activateProf.body.gateway.profiles.some(
          p => p.id === 'prof-balanced' && p.active,
        ),
      );

      const bindAgent = await apiJson<{readonly gateway: GatewaySnapshot}>(
        base,
        token,
        'PATCH',
        '/api/v4/agents/agent-pm',
        {
          bindingKind: 'routing_group',
          routingGroupId: 'grp-custom-ctx',
        },
      );
      assert.equal(bindAgent.status, 200);
      const boundPm = bindAgent.body.gateway.agents.find(
        a => a.id === 'agent-pm',
      );
      assert.equal(boundPm?.bindingKind, 'routing_group');
      assert.equal(boundPm?.routingGroupId, 'grp-custom-ctx');

      const updConn = await apiJson<{readonly gateway: GatewaySnapshot}>(
        base,
        token,
        'PUT',
        '/api/v4/connectors/conn-slack',
        {
          enabled: true,
          config: {
            webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXX',
            channel: '#forgeops-req',
          },
        },
      );
      assert.equal(updConn.status, 200);
      const slackConn = updConn.body.gateway.connectors.find(
        c => c.id === 'conn-slack',
      );
      assert.equal(slackConn?.enabled, true);

      const updPrivacy = await apiJson<{readonly gateway: GatewaySnapshot}>(
        base,
        token,
        'PUT',
        '/api/v4/privacy-masking',
        {enabled: true, maskSecrets: true, maskEmails: true},
      );
      assert.equal(updPrivacy.status, 200);
      assert.equal(updPrivacy.body.gateway.privacyMasking.enabled, true);

      const delProv = await apiJson<{readonly gateway: GatewaySnapshot}>(
        base,
        token,
        'DELETE',
        '/api/v4/providers/prov-custom-test',
      );
      assert.equal(delProv.status, 200);
      assert.ok(
        !delProv.body.gateway.providers.some(p => p.id === 'prov-custom-test'),
      );

      // 3. Onboard project & verify initial channels + Overleaf PRD document
      const onboarded = await apiJson<V4SessionDetail>(
        base,
        token,
        'POST',
        '/api/v4/onboard-folder',
        {
          folderPath: projectDir,
          title: 'Multi-Tenant Order Gateway',
          mode: 'team',
          executionMode: 'local',
        },
      );
      assert.equal(onboarded.status, 201);
      const sessionId = onboarded.body.session.id;
      assert.ok(
        onboarded.body.channels && onboarded.body.channels.length === 3,
      );
      assert.ok(
        onboarded.body.collabDoc && onboarded.body.collabDoc.blocks.length >= 6,
      );

      const reqChannelId = onboarded.body.channels![0]!.id;

      // 4. Post message mentioning @designer + inline HTML mockup attachment
      const post1 = await apiJson<{
        readonly post: CollabPostRecord;
        readonly spawnedCount: number;
        readonly detail: V4SessionDetail;
      }>(base, token, 'POST', `/api/v4/sessions/${sessionId}/collab/posts`, {
        channelId: reqChannelId,
        content: '@designer 请评审以下审批工作台 HTML 原型，并补充交互反馈',
        attachments: [
          {
            id: 'att-mockup-1',
            kind: 'html_mockup',
            title: 'order-console.html',
            subtitle: 'Initial Draft',
            htmlContent:
              '<div><h1>Order Console</h1><button>Approve</button></div>',
          },
        ],
      });
      assert.equal(post1.status, 201);
      assert.ok(post1.body.spawnedCount >= 1);
      const rootPostId = post1.body.post.id;

      // Edit HTML mockup inline
      const mockupUpd = await apiJson<{
        readonly post: CollabPostRecord;
        readonly detail: V4SessionDetail;
      }>(
        base,
        token,
        'PUT',
        `/api/v4/sessions/${sessionId}/collab/posts/${rootPostId}/mockup`,
        {
          attachmentId: 'att-mockup-1',
          htmlContent:
            '<div><h1>Order Console v2</h1><button>Ship</button></div>',
        },
      );
      assert.equal(mockupUpd.status, 200);
      assert.ok(
        mockupUpd.body.post.attachments[0]!.htmlContent!.includes('Console v2'),
      );

      // Toggle emoji reaction on & off
      const reactOn = await apiJson<{readonly post: CollabPostRecord}>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${sessionId}/collab/posts/${rootPostId}/react`,
        {emoji: '👍'},
      );
      assert.equal(reactOn.status, 200);
      assert.equal(
        reactOn.body.post.reactions.find(r => r.emoji === '👍')?.count,
        1,
      );

      // Reply inside thread + resolve + reopen on new reply
      const threadReply1 = await apiJson<{readonly detail: V4SessionDetail}>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${sessionId}/collab/posts`,
        {
          channelId: reqChannelId,
          parentPostId: rootPostId,
          content: '@pm 确认已对齐订单状态机字段约束',
        },
      );
      assert.equal(threadReply1.status, 201);
      assert.ok(
        (threadReply1.body.detail.posts ?? []).some(
          p => p.parentPostId === rootPostId,
        ),
      );

      const resolved = await apiJson<{readonly post: CollabPostRecord}>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${sessionId}/collab/posts/${rootPostId}/status`,
        {status: 'resolved'},
      );
      assert.equal(resolved.status, 200);
      assert.equal(resolved.body.post.threadStatus, 'resolved');

      // Posting a new reply automatically reopens resolved thread
      const threadReply2 = await apiJson<{
        readonly detail: V4SessionDetail;
      }>(base, token, 'POST', `/api/v4/sessions/${sessionId}/collab/posts`, {
        channelId: reqChannelId,
        parentPostId: rootPostId,
        content: '补充一项超时重放幂等边界',
      });
      assert.equal(threadReply2.status, 201);
      const reopenedRoot = threadReply2.body.detail.posts?.find(
        p => p.id === rootPostId,
      );
      assert.equal(reopenedRoot?.threadStatus, 'open');

      // 5. Run slash commands: /prd, /whiteboard, /mockup, /spec, /schedule
      for (const cmdText of [
        '/prd 增加风控阈值规则：单笔超过 50000 进入双人审批',
        '/whiteboard 绘制风控网关与状态机边界',
        '/mockup 生成审批规则配置页原型',
        '/schedule 每1小时 @pm 检查未关闭评审项',
        '/spec',
      ]) {
        const res = await apiJson<{
          readonly triggeredCommand: string | null;
          readonly detail: V4SessionDetail;
        }>(base, token, 'POST', `/api/v4/sessions/${sessionId}/collab/posts`, {
          channelId: reqChannelId,
          content: cmdText,
        });
        assert.equal(res.status, 201);
        assert.ok(res.body.triggeredCommand !== null);
      }

      // 6. Demo run includes poll attachment; test poll vote updating PRD goals
      const demo = await apiJson<V4SessionDetail>(
        base,
        token,
        'POST',
        '/api/v4/demo-run',
        {mode: 'team'},
      );
      assert.equal(demo.status, 201);
      const demoSid = demo.body.session.id;
      const pollPost = (demo.body.posts ?? []).find(p =>
        p.attachments.some(a => a.kind === 'decision_poll'),
      );
      assert.ok(pollPost, 'demo run should seed a decision_poll post');
      const pollAtt = pollPost.attachments.find(
        a => a.kind === 'decision_poll',
      )!;
      const firstOpt = pollAtt.pollOptions![0]!;
      const voted = await apiJson<{
        readonly post: CollabPostRecord;
        readonly doc: CollabDocSnapshot;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${demoSid}/collab/posts/${pollPost.id}/poll`,
        {attachmentId: pollAtt.id, optionId: firstOpt.id},
      );
      assert.equal(voted.status, 200);
      assert.equal(voted.body.post.threadStatus, 'resolved');
      assert.ok(
        voted.body.doc.blocks.some(b => b.markdown.includes(firstOpt.label)),
      );

      // 7. Overleaf-style PRD Block Edit -> Line Diffs + Block Comment (@architect) + Compile to Spec & Board
      const targetBlock = demo.body.collabDoc!.blocks.find(
        b => b.sectionKey === 'functional_scope',
      )!;
      const beforeRev = demo.body.collabDoc!.revision;
      const editedBlock = await apiJson<{
        readonly doc: CollabDocSnapshot;
        readonly detail: V4SessionDetail;
      }>(
        base,
        token,
        'PATCH',
        `/api/v4/sessions/${demoSid}/collab/doc/blocks/${targetBlock.id}`,
        {
          markdown: `${targetBlock.markdown}\n- **新增幂等校验引擎**：支持跨多钱包渠道请求签名去重`,
          authorName: '张架构师',
        },
      );
      assert.equal(editedBlock.status, 200);
      assert.ok(editedBlock.body.doc.revision > beforeRev);
      const latestRev = editedBlock.body.doc.revisions[0]!;
      assert.equal(latestRev.authorName, '张架构师');
      assert.ok(latestRev.diffHunks.some(h => h.kind === 'add'));

      const commentedBlock = await apiJson<{
        readonly doc: CollabDocSnapshot;
        readonly detail: V4SessionDetail;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${demoSid}/collab/doc/blocks/${targetBlock.id}/comment`,
        {
          text: '@architect 请确认幂等密钥与重试策略是否写入 Spec 接口边界',
          channelId: demo.body.channels![0]!.id,
        },
      );
      assert.equal(commentedBlock.status, 201);
      const updatedBlock = commentedBlock.body.doc.blocks.find(
        b => b.id === targetBlock.id,
      )!;
      assert.ok(updatedBlock.comments.length >= 1);
      assert.equal(
        commentedBlock.body.doc.revisions[0]!.authorId,
        'agent-architect',
      );
      assert.ok(
        (commentedBlock.body.detail.posts ?? []).some(
          p =>
            p.authorId === 'agent-architect' &&
            p.content.includes(targetBlock.title),
        ),
      );

      const prevSpecRev = commentedBlock.body.detail.specIR.revision;
      const compiled = await apiJson<{
        readonly specIR: SpecIRContract;
        readonly board: BoardSceneDoc;
      }>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${demoSid}/collab/doc/compile-spec`,
        {},
      );
      assert.equal(compiled.status, 200);
      assert.ok(compiled.body.specIR.revision > prevSpecRev);
      assert.ok(compiled.body.board.nodes.length >= 2);
      assert.ok(compiled.body.board.edges.length >= 1);

      // 8. Schedules + Unread Queue Drain + Dashboard Summary
      const createdSch = await apiJson<{
        readonly schedule: ScheduledTriggerRecord;
      }>(base, token, 'POST', `/api/v4/sessions/${demoSid}/collab/schedules`, {
        targetAgentId: 'agent-pm',
        intervalLabel: '每 30 分钟',
        promptText: '检查待定开放问题',
      });
      assert.equal(createdSch.status, 201);

      const ranSch = await apiJson<{
        readonly schedule: ScheduledTriggerRecord;
        readonly dashboard: DashboardSummaryPayload;
      }>(
        base,
        token,
        'POST',
        `/api/v4/collab/schedules/${createdSch.body.schedule.id}/run`,
        {},
      );
      assert.equal(ranSch.status, 200);
      assert.equal(ranSch.body.schedule.runCount, 1);
      assert.ok(ranSch.body.dashboard.agents.length >= 6);
      assert.ok(ranSch.body.dashboard.recentEdits.length >= 1);

      const drained = await apiJson<{readonly processed: number}>(
        base,
        token,
        'POST',
        `/api/v4/sessions/${sessionId}/collab/unread/drain`,
        {},
      );
      assert.equal(drained.status, 200);

      const delSch = await apiJson<{readonly ok: boolean}>(
        base,
        token,
        'DELETE',
        `/api/v4/collab/schedules/${createdSch.body.schedule.id}`,
      );
      assert.equal(delSch.status, 200);
      assert.equal(delSch.body.ok, true);
    } finally {
      await runtime.stop();
      rmSync(dataDir, {recursive: true, force: true});
      rmSync(projectDir, {recursive: true, force: true});
    }
  });
});

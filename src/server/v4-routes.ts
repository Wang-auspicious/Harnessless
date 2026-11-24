/**
 * HTTP route handlers for `/api/v4/*` (SDLC-Studio v4 Master Agent Orchestration).
 */

import type {IncomingMessage, ServerResponse} from 'node:http';
import type {MasterAgentEngine} from '../engines/master-agent.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  ArtifactPinStatus,
  ArtifactSurfaceType,
  BoardSceneDoc,
  CollabFeedItem,
  ConsensusAuthorKind,
  ConsensusEntryType,
  KanoAhpInputItem,
  KernelId,
  MasterExecutionMode,
  MasterSessionMode,
  ShipReviewDepth,
  SpecIRContract,
  TaskMutation,
  TaskNodeRole,
} from '../shared/v4-types.ts';
import {asRecord, optString, reqString} from '../shared/validation.ts';

export interface V4RouteHelpers {
  readonly readJsonBody: (req: IncomingMessage) => Promise<unknown>;
  readonly sendJson: (
    res: ServerResponse,
    statusCode: number,
    payload: unknown,
  ) => void;
}

const VALID_MODES: readonly MasterSessionMode[] = ['solo', 'team'];
const VALID_EXEC_MODES: readonly MasterExecutionMode[] = [
  'auto',
  'live',
  'local',
];
const VALID_KERNELS: readonly KernelId[] = [
  'master',
  'claude-code',
  'codex',
  'gemini-cli',
  'opencode',
  'pi',
  'native-api',
];
const VALID_SURFACES: readonly ArtifactSurfaceType[] = [
  'board',
  'spec_ir',
  'code_diff',
  'html_verify',
];
const VALID_PIN_STATUSES: readonly ArtifactPinStatus[] = [
  'waiting_on_agent',
  'waiting_on_human',
  'resolved',
];
const VALID_SHIP_DEPTHS: readonly ShipReviewDepth[] = [
  'fast',
  'standard',
  'deep',
];

function optEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const val = record[key];
  if (val === undefined || val === null || val === '') {
    return undefined;
  }
  if (typeof val !== 'string' || !allowed.includes(val as T)) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Invalid value for "${key}": expected one of ${allowed.join(', ')}`,
      400,
    );
  }
  return val as T;
}

export async function handleV4Route(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  master: MasterAgentEngine | undefined,
  helpers: V4RouteHelpers,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith('/api/v4')) {
    return false;
  }
  if (!master) {
    helpers.sendJson(res, 503, {
      code: 'V4_UNAVAILABLE',
      error: 'MasterAgentEngine is not configured on this runtime.',
      message: 'MasterAgentEngine is not configured on this runtime.',
    });
    return true;
  }

  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/api/v4/bootstrap') {
    const payload = await master.getBootstrap();
    helpers.sendJson(res, 200, payload);
    return true;
  }

  if (method === 'GET' && path === '/api/v4/catchup') {
    helpers.sendJson(res, 200, {items: master.getCatchup()});
    return true;
  }

  if (method === 'POST' && path === '/api/v4/onboard-folder') {
    const body = asRecord(await helpers.readJsonBody(req));
    const folderPath = reqString(body, 'folderPath', 1024);
    const title = optString(body, 'title', '', 200) || undefined;
    const mode = optEnum(body, 'mode', VALID_MODES);
    const executionMode = optEnum(body, 'executionMode', VALID_EXEC_MODES);
    const detail = await master.onboardFolder({
      folderPath,
      title,
      mode,
      executionMode,
    });
    helpers.sendJson(res, 201, detail);
    return true;
  }

  if (method === 'POST' && path === '/api/v4/demo-run') {
    const raw = await helpers.readJsonBody(req);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const mode = optEnum(body, 'mode', VALID_MODES);
    const detail = await master.createDemoRun({mode});
    helpers.sendJson(res, 201, detail);
    return true;
  }

  if (method === 'GET' && path === '/api/v4/sessions') {
    helpers.sendJson(res, 200, {sessions: master.listSessions()});
    return true;
  }

  // Kernels & routing
  if (method === 'GET' && path === '/api/v4/kernels') {
    const kernels = await master.probeKernels();
    helpers.sendJson(res, 200, {
      kernels,
      roleRouting: master.getRoleRouting(),
    });
    return true;
  }

  if (method === 'POST' && path === '/api/v4/kernels/probe') {
    const kernels = await master.probeKernels();
    helpers.sendJson(res, 200, {
      kernels,
      roleRouting: master.getRoleRouting(),
    });
    return true;
  }

  if (method === 'PUT' && path === '/api/v4/kernels/routing') {
    const body = asRecord(await helpers.readJsonBody(req));
    const routingRaw = asRecord(body['roleRouting'] ?? body);
    const patch: Partial<Record<TaskNodeRole, KernelId>> = {};
    const roles: readonly TaskNodeRole[] = [
      'architect',
      'coder',
      'tester',
      'reviewer',
      'steward',
    ];
    for (const role of roles) {
      const k = optEnum(routingRaw, role, VALID_KERNELS);
      if (k) {
        patch[role] = k;
      }
    }
    const roleRouting = master.updateRoleRouting(patch);
    helpers.sendJson(res, 200, {roleRouting});
    return true;
  }

  // Collab bus feed
  if (method === 'GET' && path === '/api/v4/collab') {
    const sessionId = url.searchParams.get('sessionId') ?? undefined;
    const reader = url.searchParams.get('reader') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam
      ? Math.max(1, Math.min(500, Number.parseInt(limitParam, 10) || 100))
      : 100;
    helpers.sendJson(res, 200, {
      items: master.listCollab(sessionId, reader, limit),
    });
    return true;
  }

  if (method === 'POST' && path === '/api/v4/collab') {
    const body = asRecord(await helpers.readJsonBody(req));
    const sessionId = reqString(body, 'sessionId', 120);
    const fromKernel = optEnum(body, 'fromKernel', VALID_KERNELS) ?? 'master';
    const rawTo = body['toKernel'];
    const toKernel: KernelId | 'all' =
      rawTo === 'all'
        ? 'all'
        : (optEnum(body, 'toKernel', VALID_KERNELS) ?? 'all');
    const kind = (optString(body, 'kind', 'handoff', 40) ||
      'handoff') as CollabFeedItem['kind'];
    const content = reqString(body, 'content', 4000);
    const taskId = optString(body, 'taskId', '', 120) || null;
    const audienceScope = optString(body, 'audienceScope', 'world', 120);
    const item = master.postCollab({
      sessionId,
      fromKernel,
      toKernel,
      kind,
      taskId,
      audienceScope,
      content,
    });
    helpers.sendJson(res, 201, {item});
    return true;
  }

  // Hosted Apps
  if (method === 'GET' && path === '/api/v4/apps') {
    helpers.sendJson(res, 200, {apps: master.listHostedApps()});
    return true;
  }

  const appCtrlMatch = /^\/api\/v4\/apps\/([^/]+)\/control$/.exec(path);
  if (method === 'POST' && appCtrlMatch) {
    const body = asRecord(await helpers.readJsonBody(req));
    const action = optEnum(body, 'action', [
      'start',
      'stop',
      'restart',
      'fork_v2',
    ] as const);
    if (!action) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        'action must be one of start, stop, restart, fork_v2',
        400,
      );
    }
    const result = await master.controlHostedApp(
      decodeURIComponent(appCtrlMatch[1]!),
      action,
    );
    helpers.sendJson(res, 200, result);
    return true;
  }

  // Session-scoped routes
  const sessionRootMatch = /^\/api\/v4\/sessions\/([^/]+)$/.exec(path);
  if (sessionRootMatch) {
    const sessionId = decodeURIComponent(sessionRootMatch[1]!);
    if (method === 'GET') {
      helpers.sendJson(res, 200, master.getSessionDetail(sessionId));
      return true;
    }
    if (method === 'PATCH') {
      const body = asRecord(await helpers.readJsonBody(req));
      const session = master.updateSessionMeta(sessionId, {
        mode: optEnum(body, 'mode', VALID_MODES),
        executionMode: optEnum(body, 'executionMode', VALID_EXEC_MODES),
        title: optString(body, 'title', '', 200) || undefined,
      });
      helpers.sendJson(res, 200, {session});
      return true;
    }
  }

  const convertTeamMatch =
    /^\/api\/v4\/sessions\/([^/]+)\/convert-to-team$/.exec(path);
  if (method === 'POST' && convertTeamMatch) {
    const sessionId = decodeURIComponent(convertTeamMatch[1]!);
    const raw = await helpers.readJsonBody(req);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const disclosureScope = optString(body, 'disclosureScope', 'team', 120);
    const session = master.convertToTeam(sessionId, disclosureScope);
    helpers.sendJson(res, 200, {session});
    return true;
  }

  const turnMatch = /^\/api\/v4\/sessions\/([^/]+)\/turn$/.exec(path);
  if (method === 'POST' && turnMatch) {
    const sessionId = decodeURIComponent(turnMatch[1]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const text = optString(body, 'text', '', 16_000);
    const targetKernel = optEnum(body, 'targetKernel', VALID_KERNELS);
    const executionMode = optEnum(body, 'executionMode', VALID_EXEC_MODES);
    const action = optEnum(body, 'action', [
      'chat',
      'freeze_spec',
      'decompose',
      'execute',
      'ship',
    ] as const);
    const detail = await master.handleTurn(sessionId, text, {
      targetKernel,
      executionMode,
      action,
    });
    helpers.sendJson(res, 200, detail);
    return true;
  }

  const grillMatch = /^\/api\/v4\/sessions\/([^/]+)\/grilling\/submit$/.exec(
    path,
  );
  if (method === 'POST' && grillMatch) {
    const sessionId = decodeURIComponent(grillMatch[1]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const messageId = optString(body, 'messageId', '', 120) || undefined;
    const rawAnswers = body['answers'];
    const answers: Record<string, string> = {};
    if (
      rawAnswers &&
      typeof rawAnswers === 'object' &&
      !Array.isArray(rawAnswers)
    ) {
      for (const [k, v] of Object.entries(
        rawAnswers as Record<string, unknown>,
      )) {
        if (typeof v === 'string') {
          answers[k] = v;
        }
      }
    }
    const detail = await master.submitGrilling(sessionId, {
      messageId,
      answers,
      acceptRecommended: Boolean(body['acceptRecommended']),
      freezeSpec: Boolean(body['freezeSpec']),
    });
    helpers.sendJson(res, 200, detail);
    return true;
  }

  const consensusMatch = /^\/api\/v4\/sessions\/([^/]+)\/consensus$/.exec(path);
  if (method === 'POST' && consensusMatch) {
    const sessionId = decodeURIComponent(consensusMatch[1]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const result = master.appendConsensus(sessionId, {
      authorPrincipalId:
        optString(body, 'authorPrincipalId', '', 120) || undefined,
      authorKind: optEnum(body, 'authorKind', [
        'human',
        'master_agent',
        'team_agent',
        'critic_agent',
      ] as const) as ConsensusAuthorKind | undefined,
      entryType: (optEnum(body, 'entryType', [
        'intent',
        'found',
        'asked',
        'advised',
        'kano',
        'ahp',
        'ruling',
        'dissent',
        'commit',
      ] as const) ?? 'ruling') as ConsensusEntryType,
      specAnchorId: optString(body, 'specAnchorId', '', 120) || null,
      payload: body['payload'] ?? {},
      commit: Boolean(body['commit']),
    });
    helpers.sendJson(res, 201, result);
    return true;
  }

  const quantizeMatch = /^\/api\/v4\/sessions\/([^/]+)\/quantize$/.exec(path);
  if (method === 'POST' && quantizeMatch) {
    const sessionId = decodeURIComponent(quantizeMatch[1]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const items = Array.isArray(body['items'])
      ? (body['items'] as KanoAhpInputItem[])
      : [];
    const pairwiseMatrix = Array.isArray(body['pairwiseMatrix'])
      ? (body['pairwiseMatrix'] as number[][])
      : undefined;
    const result = master.runQuantization(sessionId, {items, pairwiseMatrix});
    if (!result.passed) {
      helpers.sendJson(res, 422, {
        code: 'AHP_INCONSISTENT',
        error: result.diagnostic,
        message: result.diagnostic,
        result,
      });
      return true;
    }
    helpers.sendJson(res, 200, result);
    return true;
  }

  const boardMatch = /^\/api\/v4\/sessions\/([^/]+)\/board$/.exec(path);
  if (method === 'PUT' && boardMatch) {
    const sessionId = decodeURIComponent(boardMatch[1]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const board = (body['board'] ?? body) as BoardSceneDoc;
    const expectedRevision =
      typeof body['expectedRevision'] === 'number'
        ? body['expectedRevision']
        : undefined;
    const updated = master.updateBoard(sessionId, board, expectedRevision);
    helpers.sendJson(res, 200, updated);
    return true;
  }

  const specMatch = /^\/api\/v4\/sessions\/([^/]+)\/spec$/.exec(path);
  if (method === 'PUT' && specMatch) {
    const sessionId = decodeURIComponent(specMatch[1]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const specIR = (body['specIR'] ?? body) as SpecIRContract;
    const expectedRevision =
      typeof body['expectedRevision'] === 'number'
        ? body['expectedRevision']
        : undefined;
    const updated = master.updateSpecIR(sessionId, specIR, expectedRevision);
    helpers.sendJson(res, 200, updated);
    return true;
  }

  const pinsCreateMatch = /^\/api\/v4\/sessions\/([^/]+)\/pins$/.exec(path);
  if (method === 'POST' && pinsCreateMatch) {
    const sessionId = decodeURIComponent(pinsCreateMatch[1]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const surfaceType = optEnum(body, 'surfaceType', VALID_SURFACES) ?? 'board';
    const anchorRaw = body['anchorJson'];
    const anchorJson =
      typeof anchorRaw === 'string'
        ? anchorRaw
        : JSON.stringify(anchorRaw ?? {});
    const specNodeId = optString(body, 'specNodeId', '', 120) || null;
    const promptText = reqString(body, 'promptText', 4000);
    const created = master.createPin(sessionId, {
      surfaceType,
      anchorJson,
      specNodeId,
      promptText,
    });
    helpers.sendJson(res, 201, created);
    return true;
  }

  const pinPatchMatch = /^\/api\/v4\/sessions\/([^/]+)\/pins\/([^/]+)$/.exec(
    path,
  );
  if (method === 'PATCH' && pinPatchMatch) {
    const sessionId = decodeURIComponent(pinPatchMatch[1]!);
    const pinId = decodeURIComponent(pinPatchMatch[2]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const status = optEnum(body, 'status', VALID_PIN_STATUSES);
    const replyText =
      typeof body['replyText'] === 'string' ? body['replyText'] : undefined;
    const askAgent = Boolean(body['askAgent']);
    const result = master.updatePin(sessionId, pinId, {
      status,
      replyText,
      askAgent,
    });
    helpers.sendJson(res, 200, result);
    return true;
  }

  const decomposeMatch =
    /^\/api\/v4\/sessions\/([^/]+)\/tasks\/decompose$/.exec(path);
  if (method === 'POST' && decomposeMatch) {
    const sessionId = decodeURIComponent(decomposeMatch[1]!);
    const raw = await helpers.readJsonBody(req);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const result = await master.decomposeSessionTasks(sessionId, {
      force: Boolean(body['force']),
    });
    helpers.sendJson(res, 200, result);
    return true;
  }

  const mutateMatch = /^\/api\/v4\/sessions\/([^/]+)\/tasks\/mutate$/.exec(
    path,
  );
  if (method === 'PATCH' && mutateMatch) {
    const sessionId = decodeURIComponent(mutateMatch[1]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const plan = master.mutateSessionTasks(
      sessionId,
      body as unknown as TaskMutation,
    );
    helpers.sendJson(res, 200, {plan});
    return true;
  }

  const executeMatch = /^\/api\/v4\/sessions\/([^/]+)\/tasks\/execute$/.exec(
    path,
  );
  if (method === 'POST' && executeMatch) {
    const sessionId = decodeURIComponent(executeMatch[1]!);
    const raw = await helpers.readJsonBody(req);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const taskIds = Array.isArray(body['taskIds'])
      ? body['taskIds'].filter((x): x is string => typeof x === 'string')
      : undefined;
    const result = await master.executeTaskPlan(sessionId, {
      resumeOnly: Boolean(body['resumeOnly']),
      taskIds,
    });
    helpers.sendJson(res, 200, result);
    return true;
  }

  const filesMatch = /^\/api\/v4\/sessions\/([^/]+)\/files$/.exec(path);
  if (method === 'GET' && filesMatch) {
    const sessionId = decodeURIComponent(filesMatch[1]!);
    helpers.sendJson(res, 200, master.readWorkspaceFiles(sessionId));
    return true;
  }

  const fileMatch = /^\/api\/v4\/sessions\/([^/]+)\/file$/.exec(path);
  if (method === 'GET' && fileMatch) {
    const sessionId = decodeURIComponent(fileMatch[1]!);
    const relPath = url.searchParams.get('path') ?? '';
    helpers.sendJson(res, 200, master.readWorkspaceFile(sessionId, relPath));
    return true;
  }

  const diffsMatch = /^\/api\/v4\/sessions\/([^/]+)\/diffs$/.exec(path);
  if (method === 'GET' && diffsMatch) {
    const sessionId = decodeURIComponent(diffsMatch[1]!);
    helpers.sendJson(res, 200, {diffs: master.getSessionDiffs(sessionId)});
    return true;
  }

  const shipMatch = /^\/api\/v4\/sessions\/([^/]+)\/ship$/.exec(path);
  if (method === 'POST' && shipMatch) {
    const sessionId = decodeURIComponent(shipMatch[1]!);
    const raw = await helpers.readJsonBody(req);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    try {
      const result = await master.runShipReview(sessionId, {
        reviewDepth: optEnum(body, 'reviewDepth', VALID_SHIP_DEPTHS),
        reviewerKernel: optEnum(body, 'reviewerKernel', VALID_KERNELS),
        policyMode: optEnum(body, 'policyMode', [
          'shadow',
          'enforced',
        ] as const),
      });
      helpers.sendJson(res, 200, result);
    } catch (err) {
      if (
        err instanceof ForgeError &&
        err.details?.['reason'] === 'SELF_APPROVAL_BLOCKED'
      ) {
        helpers.sendJson(res, 409, {
          code: 'SELF_APPROVAL_BLOCKED',
          error: err.message,
          message: err.message,
        });
        return true;
      }
      throw err;
    }
    return true;
  }

  const shipVerdictMatch =
    /^\/api\/v4\/sessions\/([^/]+)\/ship\/([^/]+)\/verdict$/.exec(path);
  if (method === 'POST' && shipVerdictMatch) {
    const sessionId = decodeURIComponent(shipVerdictMatch[1]!);
    const reviewId = decodeURIComponent(shipVerdictMatch[2]!);
    const body = asRecord(await helpers.readJsonBody(req));
    const verdict = optEnum(body, 'verdict', ['passed', 'rejected'] as const);
    if (!verdict) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        'verdict must be "passed" or "rejected"',
        400,
      );
    }
    const comment = optString(body, 'comment', '', 2000) || undefined;
    const result = master.submitShipVerdict(sessionId, reviewId, {
      verdict,
      comment,
    });
    helpers.sendJson(res, 200, result);
    return true;
  }

  const deliverMatch = /^\/api\/v4\/sessions\/([^/]+)\/deliver$/.exec(path);
  if (method === 'POST' && deliverMatch) {
    const sessionId = decodeURIComponent(deliverMatch[1]!);
    const raw = await helpers.readJsonBody(req);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const result = await master.deliverSession(sessionId, {
      appName: optString(body, 'appName', '', 120) || undefined,
      versionTag: optString(body, 'versionTag', '', 40) || undefined,
    });
    helpers.sendJson(res, 200, result);
    return true;
  }

  helpers.sendJson(res, 404, {
    code: 'NOT_FOUND',
    error: `Unknown v4 route: ${method} ${path}`,
    message: `Unknown v4 route: ${method} ${path}`,
  });
  return true;
}

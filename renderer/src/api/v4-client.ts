/**
 * Typed HTTP + Multiplexed SSE client for SDLC-Studio v4 (`/api/v4/*`).
 */

import type {
  AgentBindingKind,
  ArtifactPin,
  ArtifactSurfaceType,
  BoardSceneDoc,
  CatchupSummaryItem,
  CollabDocSnapshot,
  CollabFeedItem,
  CollabPostRecord,
  ConsensusLogEntry,
  DashboardSummaryPayload,
  ExternalConnectorRecord,
  GatewaySnapshot,
  HostedAppCard,
  KanoAhpInputItem,
  KernelId,
  MasterSession,
  ModelProviderRecord,
  NativeKernelCard,
  PostAttachment,
  PrivacyMaskingConfig,
  ProviderModelEntry,
  ProviderPresetKind,
  QuantizationResult,
  RoutingGroupRecord,
  RoutingStrategy,
  RoutingTarget,
  ScheduledTriggerRecord,
  SessionExecutionMode,
  SessionMode,
  ShipReviewBundle,
  SpecIRContract,
  TaskDecompositionPlan,
  TaskMutation,
  TaskNodeRole,
  TurnDiffSnapshot,
  V4BootstrapPayload,
  V4SessionDetail,
  V4SseEnvelope,
  WorkspaceFileContent,
  WorkspaceFileEntry,
} from './v4-types.ts';

export class V4ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly payload: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    status: number,
    code: string | null,
    payload: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'V4ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function getBridgeConfig(): {
  readonly apiBaseUrl: string;
  readonly sessionToken: string;
} {
  if (window.forgeops?.apiBaseUrl) {
    return {
      apiBaseUrl: window.forgeops.apiBaseUrl,
      sessionToken: window.forgeops.sessionToken,
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    apiBaseUrl: params.get('apiBaseUrl') ?? 'http://127.0.0.1:4190',
    sessionToken: params.get('token') ?? '',
  };
}

async function v4Fetch<T>(
  path: string,
  options?: {
    readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly body?: unknown;
  },
): Promise<T> {
  const cfg = getBridgeConfig();
  const res = await fetch(`${cfg.apiBaseUrl}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${cfg.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  if (!res.ok) {
    const message =
      typeof parsed['error'] === 'string'
        ? parsed['error']
        : typeof parsed['message'] === 'string'
          ? parsed['message']
          : `HTTP ${res.status}`;
    const code = typeof parsed['code'] === 'string' ? parsed['code'] : null;
    throw new V4ApiError(message, res.status, code, parsed);
  }
  return parsed as T;
}

export const v4Api = {
  getBootstrap: (): Promise<V4BootstrapPayload> =>
    v4Fetch<V4BootstrapPayload>('/api/v4/bootstrap'),

  getCatchup: (): Promise<{readonly items: readonly CatchupSummaryItem[]}> =>
    v4Fetch<{readonly items: readonly CatchupSummaryItem[]}>('/api/v4/catchup'),

  onboardFolder: (body: {
    readonly folderPath: string;
    readonly title?: string;
    readonly mode?: SessionMode;
    readonly executionMode?: SessionExecutionMode;
  }): Promise<V4SessionDetail> =>
    v4Fetch<V4SessionDetail>('/api/v4/onboard-folder', {
      method: 'POST',
      body,
    }),

  demoRun: (body?: {readonly mode?: SessionMode}): Promise<V4SessionDetail> =>
    v4Fetch<V4SessionDetail>('/api/v4/demo-run', {
      method: 'POST',
      body: body ?? {},
    }),

  listSessions: (): Promise<{readonly sessions: readonly MasterSession[]}> =>
    v4Fetch<{readonly sessions: readonly MasterSession[]}>('/api/v4/sessions'),

  getSession: (sessionId: string): Promise<V4SessionDetail> =>
    v4Fetch<V4SessionDetail>(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}`,
    ),

  patchSession: (
    sessionId: string,
    body: {
      readonly mode?: SessionMode;
      readonly executionMode?: SessionExecutionMode;
      readonly title?: string;
    },
  ): Promise<{readonly session: MasterSession}> =>
    v4Fetch<{readonly session: MasterSession}>(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}`,
      {method: 'PATCH', body},
    ),

  convertToTeam: (
    sessionId: string,
    body?: {readonly disclosureScope?: string},
  ): Promise<{readonly session: MasterSession}> =>
    v4Fetch<{readonly session: MasterSession}>(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/convert-to-team`,
      {method: 'POST', body: body ?? {}},
    ),

  sendTurn: (
    sessionId: string,
    body: {
      readonly text: string;
      readonly targetKernel?: KernelId;
      readonly executionMode?: SessionExecutionMode;
      readonly action?:
        'chat' | 'freeze_spec' | 'decompose' | 'execute' | 'ship';
    },
  ): Promise<V4SessionDetail> =>
    v4Fetch<V4SessionDetail>(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/turn`,
      {method: 'POST', body},
    ),

  submitGrilling: (
    sessionId: string,
    body: {
      readonly messageId?: string;
      readonly answers: Readonly<Record<string, string>>;
      readonly acceptRecommended?: boolean;
      readonly freezeSpec?: boolean;
    },
  ): Promise<V4SessionDetail> =>
    v4Fetch<V4SessionDetail>(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/grilling/submit`,
      {method: 'POST', body},
    ),

  appendConsensus: (
    sessionId: string,
    body: {
      readonly authorPrincipalId?: string;
      readonly authorKind?: string;
      readonly entryType: string;
      readonly specAnchorId?: string;
      readonly payload: unknown;
      readonly commit?: boolean;
    },
  ): Promise<{
    readonly entry: ConsensusLogEntry;
    readonly consensusLog: readonly ConsensusLogEntry[];
  }> =>
    v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/consensus`, {
      method: 'POST',
      body,
    }),

  quantize: async (
    sessionId: string,
    body: {
      readonly items: readonly KanoAhpInputItem[];
      readonly pairwiseMatrix: readonly (readonly number[])[];
    },
  ): Promise<{
    readonly ok: boolean;
    readonly result: QuantizationResult;
    readonly errorMessage?: string;
  }> => {
    try {
      const result = await v4Fetch<QuantizationResult>(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/quantize`,
        {method: 'POST', body},
      );
      return {ok: true, result};
    } catch (err) {
      if (
        err instanceof V4ApiError &&
        err.status === 422 &&
        err.code === 'AHP_INCONSISTENT' &&
        err.payload['result']
      ) {
        return {
          ok: false,
          result: err.payload['result'] as QuantizationResult,
          errorMessage: err.message,
        };
      }
      throw err;
    }
  },

  saveBoard: (
    sessionId: string,
    body: {
      readonly board: BoardSceneDoc;
      readonly expectedRevision?: number;
    },
  ): Promise<{
    readonly board: BoardSceneDoc;
    readonly specIR: SpecIRContract;
  }> =>
    v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/board`, {
      method: 'PUT',
      body,
    }),

  saveSpec: (
    sessionId: string,
    body: {
      readonly specIR: SpecIRContract;
      readonly expectedRevision?: number;
    },
  ): Promise<{
    readonly board: BoardSceneDoc;
    readonly specIR: SpecIRContract;
  }> =>
    v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/spec`, {
      method: 'PUT',
      body,
    }),

  createPin: (
    sessionId: string,
    body: {
      readonly surfaceType: ArtifactSurfaceType;
      readonly anchorJson: string;
      readonly specNodeId?: string;
      readonly promptText: string;
    },
  ): Promise<{readonly pin: ArtifactPin; readonly specIR: SpecIRContract}> =>
    v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/pins`, {
      method: 'POST',
      body,
    }),

  updatePin: (
    sessionId: string,
    pinId: string,
    body: {
      readonly status?: 'waiting_on_agent' | 'waiting_on_human' | 'resolved';
      readonly replyText?: string;
      readonly askAgent?: boolean;
    },
  ): Promise<{readonly pin: ArtifactPin; readonly detail?: V4SessionDetail}> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/pins/${encodeURIComponent(pinId)}`,
      {method: 'PATCH', body},
    ),

  decomposeTasks: (
    sessionId: string,
    body?: {readonly force?: boolean},
  ): Promise<{
    readonly plan: TaskDecompositionPlan;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/tasks/decompose`,
      {method: 'POST', body: body ?? {}},
    ),

  mutateTasks: (
    sessionId: string,
    mutation: TaskMutation,
  ): Promise<{readonly plan: TaskDecompositionPlan}> =>
    v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/tasks/mutate`, {
      method: 'PATCH',
      body: mutation,
    }),

  executeTasks: (
    sessionId: string,
    body?: {
      readonly resumeOnly?: boolean;
      readonly taskIds?: readonly string[];
    },
  ): Promise<{
    readonly plan: TaskDecompositionPlan;
    readonly diffs: readonly TurnDiffSnapshot[];
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/tasks/execute`, {
      method: 'POST',
      body: body ?? {},
    }),

  listFiles: (
    sessionId: string,
  ): Promise<{
    readonly workspacePath: string;
    readonly files: readonly WorkspaceFileEntry[];
  }> => v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/files`),

  readFile: (
    sessionId: string,
    relPath: string,
  ): Promise<WorkspaceFileContent> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(relPath)}`,
    ),

  listDiffs: (
    sessionId: string,
  ): Promise<{readonly diffs: readonly TurnDiffSnapshot[]}> =>
    v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/diffs`),

  runShipReview: async (
    sessionId: string,
    body?: {
      readonly reviewDepth?: 'fast' | 'standard' | 'deep';
      readonly reviewerKernel?: KernelId;
      readonly policyMode?: 'shadow' | 'enforced';
    },
  ): Promise<{
    readonly blocked: boolean;
    readonly errorMessage?: string;
    readonly review?: ShipReviewBundle;
    readonly detail?: V4SessionDetail;
  }> => {
    try {
      const res = await v4Fetch<{
        readonly review: ShipReviewBundle;
        readonly detail: V4SessionDetail;
      }>(`/api/v4/sessions/${encodeURIComponent(sessionId)}/ship`, {
        method: 'POST',
        body: body ?? {},
      });
      return {blocked: false, review: res.review, detail: res.detail};
    } catch (err) {
      if (
        err instanceof V4ApiError &&
        err.status === 409 &&
        err.code === 'SELF_APPROVAL_BLOCKED'
      ) {
        return {blocked: true, errorMessage: err.message};
      }
      throw err;
    }
  },

  submitShipVerdict: (
    sessionId: string,
    reviewId: string,
    body: {
      readonly verdict: 'passed' | 'rejected';
      readonly comment?: string;
    },
  ): Promise<{
    readonly review: ShipReviewBundle;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/ship/${encodeURIComponent(reviewId)}/verdict`,
      {method: 'POST', body},
    ),

  deliverSession: (
    sessionId: string,
    body?: {readonly appName?: string; readonly versionTag?: string},
  ): Promise<{
    readonly deliveredCommitSha: string;
    readonly hostedApp: HostedAppCard;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/deliver`, {
      method: 'POST',
      body: body ?? {},
    }),

  listKernels: (): Promise<{
    readonly kernels: readonly NativeKernelCard[];
    readonly roleRouting: Record<TaskNodeRole, KernelId>;
  }> => v4Fetch('/api/v4/kernels'),

  probeKernels: (): Promise<{
    readonly kernels: readonly NativeKernelCard[];
    readonly roleRouting: Record<TaskNodeRole, KernelId>;
  }> => v4Fetch('/api/v4/kernels/probe', {method: 'POST', body: {}}),

  updateKernelRouting: (
    roleRouting: Partial<Record<TaskNodeRole, KernelId>>,
  ): Promise<{readonly roleRouting: Record<TaskNodeRole, KernelId>}> =>
    v4Fetch('/api/v4/kernels/routing', {
      method: 'PUT',
      body: {roleRouting},
    }),

  listCollab: (
    sessionId: string,
    reader?: string,
  ): Promise<{readonly items: readonly CollabFeedItem[]}> => {
    const query = new URLSearchParams({sessionId});
    if (reader) {
      query.set('reader', reader);
    }
    return v4Fetch(`/api/v4/collab?${query.toString()}`);
  },

  postCollab: (body: {
    readonly sessionId: string;
    readonly fromKernel: KernelId;
    readonly toKernel: KernelId;
    readonly kind: string;
    readonly taskId?: string;
    readonly audienceScope?: string;
    readonly content: string;
  }): Promise<{readonly item: CollabFeedItem}> =>
    v4Fetch('/api/v4/collab', {method: 'POST', body}),

  listApps: (): Promise<{readonly apps: readonly HostedAppCard[]}> =>
    v4Fetch('/api/v4/apps'),

  controlApp: (
    appId: string,
    action: 'start' | 'stop' | 'restart' | 'fork_v2',
  ): Promise<{
    readonly app: HostedAppCard;
    readonly forkedSession?: MasterSession;
  }> =>
    v4Fetch(`/api/v4/apps/${encodeURIComponent(appId)}/control`, {
      method: 'POST',
      body: {action},
    }),

  subscribeEvents: (onEvent: (ev: V4SseEnvelope) => void): (() => void) => {
    const cfg = getBridgeConfig();
    const url = `${cfg.apiBaseUrl}/api/events?token=${encodeURIComponent(cfg.sessionToken)}`;
    const es = new EventSource(url);
    es.onmessage = msg => {
      try {
        const parsed = JSON.parse(msg.data) as V4SseEnvelope;
        if (parsed && typeof parsed.type === 'string') {
          onEvent(parsed);
        }
      } catch {
        // Ignore malformed SSE frame.
      }
    };
    return () => es.close();
  },

  // Magpie-inspired Model Gateway, Providers, Routing, Profiles, Agents, Connectors
  getGateway: (): Promise<GatewaySnapshot> =>
    v4Fetch<GatewaySnapshot>('/api/v4/gateway'),

  getDashboard: (): Promise<DashboardSummaryPayload> =>
    v4Fetch<DashboardSummaryPayload>('/api/v4/dashboard'),

  upsertProvider: (body: {
    readonly id?: string;
    readonly name: string;
    readonly kind: ProviderPresetKind;
    readonly baseUrl: string;
    readonly newApiKey?: string;
    readonly newKeyLabel?: string;
    readonly models?: readonly ProviderModelEntry[];
    readonly enabled?: boolean;
  }): Promise<{
    readonly provider: ModelProviderRecord;
    readonly gateway: GatewaySnapshot;
  }> => v4Fetch('/api/v4/providers', {method: 'PUT', body}),

  testProvider: (
    providerId: string,
  ): Promise<{
    readonly provider: ModelProviderRecord;
    readonly gateway: GatewaySnapshot;
  }> =>
    v4Fetch(`/api/v4/providers/${encodeURIComponent(providerId)}/test`, {
      method: 'POST',
      body: {},
    }),

  deleteProvider: (
    providerId: string,
  ): Promise<{readonly gateway: GatewaySnapshot}> =>
    v4Fetch(`/api/v4/providers/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
    }),

  upsertRoutingGroup: (body: {
    readonly id?: string;
    readonly name: string;
    readonly strategy: RoutingStrategy;
    readonly targets: readonly RoutingTarget[];
    readonly failoverEnabled?: boolean;
  }): Promise<{
    readonly group: RoutingGroupRecord;
    readonly gateway: GatewaySnapshot;
  }> => v4Fetch('/api/v4/routing-groups', {method: 'PUT', body}),

  activateProfile: (
    profileId: string,
  ): Promise<{readonly gateway: GatewaySnapshot}> =>
    v4Fetch(`/api/v4/profiles/${encodeURIComponent(profileId)}/activate`, {
      method: 'POST',
      body: {},
    }),

  updateAgentBinding: (
    agentId: string,
    body: {
      readonly bindingKind?: AgentBindingKind;
      readonly providerId?: string | null;
      readonly modelId?: string | null;
      readonly routingGroupId?: string | null;
      readonly harnessId?: KernelId | null;
      readonly systemPrompt?: string;
      readonly enabled?: boolean;
    },
  ): Promise<{readonly gateway: GatewaySnapshot}> =>
    v4Fetch(`/api/v4/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      body,
    }),

  updateConnector: (
    connectorId: string,
    body: {
      readonly enabled?: boolean;
      readonly config?: Readonly<Record<string, string>>;
    },
  ): Promise<{
    readonly connector: ExternalConnectorRecord;
    readonly gateway: GatewaySnapshot;
  }> =>
    v4Fetch(`/api/v4/connectors/${encodeURIComponent(connectorId)}`, {
      method: 'PUT',
      body,
    }),

  updatePrivacyMasking: (
    body: Partial<PrivacyMaskingConfig>,
  ): Promise<{
    readonly privacyMasking: PrivacyMaskingConfig;
    readonly gateway: GatewaySnapshot;
  }> => v4Fetch('/api/v4/privacy-masking', {method: 'PUT', body}),

  // Vercel-Board Channels, Threads, Reactions, Queues, Schedules & Co-Edited PRD
  postChannelMessage: (
    sessionId: string,
    body: {
      readonly channelId?: string;
      readonly content: string;
      readonly parentPostId?: string | null;
      readonly attachments?: readonly PostAttachment[];
    },
  ): Promise<{
    readonly post: CollabPostRecord;
    readonly triggeredCommand: string | null;
    readonly spawnedCount: number;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(`/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/posts`, {
      method: 'POST',
      body,
    }),

  reactToPost: (
    sessionId: string,
    postId: string,
    emoji: string,
  ): Promise<{
    readonly post: CollabPostRecord;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/posts/${encodeURIComponent(postId)}/react`,
      {method: 'POST', body: {emoji}},
    ),

  setPostThreadStatus: (
    sessionId: string,
    postId: string,
    status: 'open' | 'resolved',
  ): Promise<{
    readonly post: CollabPostRecord;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/posts/${encodeURIComponent(postId)}/status`,
      {method: 'POST', body: {status}},
    ),

  selectPollOption: (
    sessionId: string,
    postId: string,
    attachmentId: string,
    optionId: string,
  ): Promise<{
    readonly post: CollabPostRecord;
    readonly doc: CollabDocSnapshot;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/posts/${encodeURIComponent(postId)}/poll`,
      {method: 'POST', body: {attachmentId, optionId}},
    ),

  updateHtmlMockup: (
    sessionId: string,
    postId: string,
    attachmentId: string,
    htmlContent: string,
  ): Promise<{
    readonly post: CollabPostRecord;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/posts/${encodeURIComponent(postId)}/mockup`,
      {method: 'PUT', body: {attachmentId, htmlContent}},
    ),

  drainUnreadQueue: (
    sessionId: string,
  ): Promise<{readonly processed: number; readonly detail: V4SessionDetail}> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/unread/drain`,
      {method: 'POST', body: {}},
    ),

  createSchedule: (
    sessionId: string,
    body: {
      readonly channelId?: string;
      readonly targetAgentId: string;
      readonly intervalLabel: string;
      readonly promptText: string;
    },
  ): Promise<{
    readonly schedule: ScheduledTriggerRecord;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/schedules`,
      {method: 'POST', body},
    ),

  runScheduleNow: (
    scheduleId: string,
  ): Promise<{
    readonly schedule: ScheduledTriggerRecord;
    readonly dashboard: DashboardSummaryPayload;
  }> =>
    v4Fetch(`/api/v4/collab/schedules/${encodeURIComponent(scheduleId)}/run`, {
      method: 'POST',
      body: {},
    }),

  deleteSchedule: (scheduleId: string): Promise<{readonly ok: boolean}> =>
    v4Fetch(`/api/v4/collab/schedules/${encodeURIComponent(scheduleId)}`, {
      method: 'DELETE',
    }),

  updateCollabDocBlock: (
    sessionId: string,
    blockId: string,
    body: {readonly markdown: string; readonly title?: string},
  ): Promise<{
    readonly doc: CollabDocSnapshot;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/doc/blocks/${encodeURIComponent(blockId)}`,
      {method: 'PATCH', body},
    ),

  commentCollabDocBlock: (
    sessionId: string,
    blockId: string,
    body: {readonly text: string; readonly channelId?: string},
  ): Promise<{
    readonly doc: CollabDocSnapshot;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/doc/blocks/${encodeURIComponent(blockId)}/comment`,
      {method: 'POST', body},
    ),

  compilePrdToSpec: (
    sessionId: string,
  ): Promise<{
    readonly specIR: SpecIRContract;
    readonly board: BoardSceneDoc;
    readonly doc: CollabDocSnapshot;
    readonly detail: V4SessionDetail;
  }> =>
    v4Fetch(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/collab/doc/compile-spec`,
      {method: 'POST', body: {}},
    ),
};

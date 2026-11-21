/**
 * Typed HTTP + Multiplexed SSE client for ForgeOps Renderer.
 */

import type {
  AddCommentRequest,
  BootstrapSnapshot,
  CausalDiffReport,
  ChangeDetailSnapshot,
  CodebaseProbeReport,
  ControlCommandInput,
  ControlSchemaResponse,
  CreateChangeRequest,
  CreateHubRequest,
  CreateMissionRequest,
  CreateMissionResponse,
  CreateRoomRequest,
  DecisionInput,
  EvidenceSearchHit,
  FocusProjection,
  ForgePreloadBridge,
  ForgeSseEvent,
  GitReconcileResult,
  HamaDetailSnapshot,
  MemoryLivingDocRecord,
  MemoryObservatorySnapshot,
  MemoryObservationRecord,
  MemoryRecallQuery,
  MemoryRecallResult,
  MemoryReflectResult,
  MissionDetailSnapshot,
  MissionEvidenceResponse,
  MissionTraceabilityResponse,
  PostRoomMessageRequest,
  ProbeMissionRequest,
  PromoteThreadToChangeRequest,
  ProposeGhostNodeRequest,
  ReconcileObservationInput,
  RegisterAdapterRequest,
  RegisterRepoRequest,
  ResolveCommentDispositionRequest,
  ResumeHandoverInput,
  ResumeHandoverResult,
  RoomDetailSnapshot,
  TakeoverStatusSnapshot,
  UpdateChangeTeamRequest,
  UpdateProviderSecretRequest,
  UpsertDomainTermRequest,
} from '../../../src/shared/api.ts';
import type {
  AdapterOperationalProfile,
  AgentAdapterManifest,
  AttentionItem,
  ChangeRecord,
  DaemonStatus,
  DomainTermEntry,
  EngineeringRoom,
  FederationHub,
  GraphNode,
  ModelProviderConfig,
  PermissionTier,
  RepositoryEntry,
  RoomMessage,
  SkillEntry,
  SoulConstitution,
  TranscriptMessage,
} from '../../../src/shared/types.ts';
import type {
  ExecutionMode,
  HamaCommentRecord,
  MergeReadinessReport,
  MissionDecisionRecord,
  MissionRecord,
} from '../../../src/shared/v3-types.ts';

declare global {
  interface Window {
    readonly forgeops?: ForgePreloadBridge;
  }
}

export interface DoctorReportDto {
  readonly gitReady: boolean;
  readonly gitVersion: string;
  readonly nodeVersion: string;
  readonly adapters: readonly AdapterOperationalProfile[];
  readonly prunedWorktreeEntries: readonly string[];
  readonly checkedAt: string;
}

export interface DreamConsolidationDto {
  readonly extractedPitfalls: number;
  readonly supersededDriftedMemories: number;
  readonly coldArchivedMemories: number;
  readonly capsulesRefreshed: number;
  readonly completedAt: string;
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

async function apiFetch<T>(
  path: string,
  options?: {readonly method?: 'GET' | 'POST'; readonly body?: unknown},
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
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      typeof json['message'] === 'string'
        ? json['message']
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export const forgeApi = {
  getBootstrap: (): Promise<BootstrapSnapshot> =>
    apiFetch<BootstrapSnapshot>('/api/bootstrap'),

  createHub: (body: CreateHubRequest): Promise<FederationHub> =>
    apiFetch<FederationHub>('/api/hubs', {method: 'POST', body}),

  anchorHubReview: (hubId: string): Promise<FederationHub> =>
    apiFetch<FederationHub>(`/api/hubs/${encodeURIComponent(hubId)}/anchor`, {
      method: 'POST',
    }),

  registerRepo: (body: RegisterRepoRequest): Promise<RepositoryEntry> =>
    apiFetch<RepositoryEntry>('/api/repositories', {method: 'POST', body}),

  upsertDomainTerm: (body: UpsertDomainTermRequest): Promise<DomainTermEntry> =>
    apiFetch<DomainTermEntry>('/api/domain-terms', {method: 'POST', body}),

  createChange: (body: CreateChangeRequest): Promise<ChangeRecord> =>
    apiFetch<ChangeRecord>('/api/changes', {method: 'POST', body}),

  createEpicChanges: (body: {
    readonly hubId: string;
    readonly repoIds: readonly string[];
    readonly epicTitle: string;
    readonly summary: string;
    readonly permissionTier: PermissionTier;
  }): Promise<readonly ChangeRecord[]> =>
    apiFetch<readonly ChangeRecord[]>('/api/changes/epic', {
      method: 'POST',
      body,
    }),

  getChangeDetail: (changeId: string): Promise<ChangeDetailSnapshot> =>
    apiFetch<ChangeDetailSnapshot>(
      `/api/changes/${encodeURIComponent(changeId)}`,
    ),

  getChangeDiff: (
    changeId: string,
  ): Promise<{
    readonly summary: string;
    readonly patch: string;
    readonly changedFiles: readonly string[];
  }> => apiFetch(`/api/changes/${encodeURIComponent(changeId)}/diff`),

  executeChange: (
    changeId: string,
  ): Promise<{readonly accepted: boolean; readonly changeId: string}> =>
    apiFetch(`/api/changes/${encodeURIComponent(changeId)}/execute`, {
      method: 'POST',
    }),

  archiveChange: (changeId: string): Promise<ChangeRecord> =>
    apiFetch<ChangeRecord>(
      `/api/changes/${encodeURIComponent(changeId)}/archive`,
      {method: 'POST'},
    ),

  updateChangeTeam: (
    changeId: string,
    body: UpdateChangeTeamRequest,
  ): Promise<ChangeRecord> =>
    apiFetch<ChangeRecord>(
      `/api/changes/${encodeURIComponent(changeId)}/team`,
      {method: 'POST', body},
    ),

  restoreToCheckpoint: (
    changeId: string,
    checkpointId: string,
  ): Promise<ChangeRecord> =>
    apiFetch<ChangeRecord>(
      `/api/changes/${encodeURIComponent(changeId)}/restore`,
      {method: 'POST', body: {checkpointId}},
    ),

  proposeGhostNode: (req: ProposeGhostNodeRequest): Promise<GraphNode> =>
    apiFetch<GraphNode>(
      `/api/changes/${encodeURIComponent(req.changeId)}/ghost`,
      {method: 'POST', body: req},
    ),

  setNodeCollapsed: (
    nodeId: string,
    collapsed: boolean,
  ): Promise<{readonly ok: boolean}> =>
    apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/collapse`, {
      method: 'POST',
      body: {collapsed},
    }),

  getSessionMessages: (
    sessionId: string,
  ): Promise<readonly TranscriptMessage[]> =>
    apiFetch<readonly TranscriptMessage[]>(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    ),

  resolveAttention: (id: string, resolution: string): Promise<AttentionItem> =>
    apiFetch<AttentionItem>(
      `/api/attention/${encodeURIComponent(id)}/resolve`,
      {method: 'POST', body: {resolution}},
    ),

  getRooms: (hubId: string, roomId?: string): Promise<RoomDetailSnapshot> => {
    const qs = new URLSearchParams({hubId});
    if (roomId) {
      qs.set('roomId', roomId);
    }
    return apiFetch<RoomDetailSnapshot>(`/api/rooms?${qs.toString()}`);
  },

  createRoom: (body: CreateRoomRequest): Promise<EngineeringRoom> =>
    apiFetch<EngineeringRoom>('/api/rooms', {method: 'POST', body}),

  postRoomMessage: (body: PostRoomMessageRequest): Promise<RoomMessage> =>
    apiFetch<RoomMessage>('/api/rooms/messages', {method: 'POST', body}),

  promoteThreadToChange: (
    body: PromoteThreadToChangeRequest,
  ): Promise<ChangeRecord> =>
    apiFetch<ChangeRecord>('/api/rooms/promote', {method: 'POST', body}),

  getMemoryObservatory: (
    hubId?: string,
  ): Promise<MemoryObservatorySnapshot> => {
    const qs = hubId ? `?hubId=${encodeURIComponent(hubId)}` : '';
    return apiFetch<MemoryObservatorySnapshot>(`/api/memory${qs}`);
  },

  searchEvidence: (
    query: string,
    hubId?: string,
  ): Promise<readonly EvidenceSearchHit[]> => {
    const qs = new URLSearchParams({q: query});
    if (hubId) {
      qs.set('hubId', hubId);
    }
    return apiFetch<readonly EvidenceSearchHit[]>(
      `/api/evidence/search?${qs.toString()}`,
    );
  },

  runSleepConsolidation: (): Promise<DreamConsolidationDto> =>
    apiFetch<DreamConsolidationDto>('/api/memory/dream', {method: 'POST'}),

  runEnvironmentDoctor: (): Promise<DoctorReportDto> =>
    apiFetch<DoctorReportDto>('/api/infra/doctor', {method: 'POST'}),

  runRetroOptimization: (changeId: string): Promise<unknown> =>
    apiFetch(`/api/infra/retro/${encodeURIComponent(changeId)}`, {
      method: 'POST',
    }),

  proposeInfraEvolution: (body: {
    readonly hubId: string;
    readonly infraRepoId: string;
    readonly title: string;
    readonly rationale: string;
    readonly permissionTier: PermissionTier;
  }): Promise<ChangeRecord> =>
    apiFetch<ChangeRecord>('/api/infra/evolve', {method: 'POST', body}),

  saveConstitution: (
    markdown: string,
    blockedCommands: readonly string[],
  ): Promise<SoulConstitution> =>
    apiFetch<SoulConstitution>('/api/infra/constitution', {
      method: 'POST',
      body: {markdown, blockedCommands},
    }),

  upsertSkill: (body: {
    readonly slug: string;
    readonly title: string;
    readonly category: SkillEntry['category'];
    readonly version: string;
    readonly promptBody: string;
  }): Promise<SkillEntry> =>
    apiFetch<SkillEntry>('/api/infra/skills', {method: 'POST', body}),

  registerAdapter: (
    body: RegisterAdapterRequest,
  ): Promise<{
    readonly manifest: AgentAdapterManifest;
    readonly probe: {readonly ok: boolean; readonly message: string};
  }> => apiFetch('/api/infra/adapters', {method: 'POST', body}),

  deleteAdapter: (adapterId: string): Promise<{readonly ok: boolean}> =>
    apiFetch(`/api/infra/adapters/${encodeURIComponent(adapterId)}/delete`, {
      method: 'POST',
    }),

  updateProviderSecret: (
    body: UpdateProviderSecretRequest,
  ): Promise<readonly ModelProviderConfig[]> =>
    apiFetch<readonly ModelProviderConfig[]>('/api/infra/providers', {
      method: 'POST',
      body,
    }),

  setDaemonEnabled: (
    id: DaemonStatus['id'],
    enabled: boolean,
  ): Promise<readonly DaemonStatus[]> =>
    apiFetch<readonly DaemonStatus[]>(
      `/api/infra/daemons/${encodeURIComponent(id)}`,
      {method: 'POST', body: {enabled}},
    ),

  pickDirectory: async (): Promise<string | null> => {
    if (window.forgeops?.pickDirectory) {
      return window.forgeops.pickDirectory();
    }
    return null;
  },

  openExternal: async (url: string): Promise<boolean> => {
    if (window.forgeops?.openExternal) {
      return window.forgeops.openExternal(url);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  },

  openPath: async (targetPath: string): Promise<boolean> => {
    if (window.forgeops?.openPath) {
      return window.forgeops.openPath(targetPath);
    }
    return false;
  },

  openInEditor: async (
    targetPath: string,
  ): Promise<{readonly ok: boolean; readonly editor: string}> => {
    if (window.forgeops?.openInEditor) {
      return window.forgeops.openInEditor(targetPath);
    }
    return {ok: false, editor: 'unavailable'};
  },

  probeMission: (body: ProbeMissionRequest): Promise<CodebaseProbeReport> =>
    apiFetch<CodebaseProbeReport>('/api/missions/probe', {
      method: 'POST',
      body,
    }),

  listMissions: (hubId?: string): Promise<readonly MissionRecord[]> =>
    apiFetch<readonly MissionRecord[]>(
      hubId
        ? `/api/missions?hubId=${encodeURIComponent(hubId)}`
        : '/api/missions',
    ),

  createMission: (body: CreateMissionRequest): Promise<CreateMissionResponse> =>
    apiFetch<CreateMissionResponse>('/api/missions', {method: 'POST', body}),

  getMissionDetail: (missionId: string): Promise<MissionDetailSnapshot> =>
    apiFetch<MissionDetailSnapshot>(
      `/api/missions/${encodeURIComponent(missionId)}`,
    ),

  getMissionFocus: (missionId: string): Promise<FocusProjection> =>
    apiFetch<FocusProjection>(
      `/api/missions/${encodeURIComponent(missionId)}/focus`,
    ),

  getMissionProbe: (missionId: string): Promise<CodebaseProbeReport> =>
    apiFetch<CodebaseProbeReport>(
      `/api/missions/${encodeURIComponent(missionId)}/probe`,
    ),

  resolveMissionDecision: (
    missionId: string,
    body: DecisionInput,
  ): Promise<{
    readonly decision: MissionDecisionRecord;
    readonly mission: MissionRecord;
    readonly focus: FocusProjection;
  }> =>
    apiFetch(`/api/missions/${encodeURIComponent(missionId)}/decisions`, {
      method: 'POST',
      body,
    }),

  executeMissionControl: (
    missionId: string,
    body: ControlCommandInput,
  ): Promise<{
    readonly mission: MissionRecord;
    readonly focus: FocusProjection;
    readonly spawnedMission?: MissionRecord;
  }> =>
    apiFetch(`/api/missions/${encodeURIComponent(missionId)}/control`, {
      method: 'POST',
      body,
    }),

  getMissionHama: (missionId: string): Promise<HamaDetailSnapshot> =>
    apiFetch<HamaDetailSnapshot>(
      `/api/missions/${encodeURIComponent(missionId)}/hama`,
    ),

  addHamaComment: (
    missionId: string,
    body: AddCommentRequest,
  ): Promise<HamaCommentRecord> =>
    apiFetch<HamaCommentRecord>(
      `/api/missions/${encodeURIComponent(missionId)}/comments`,
      {method: 'POST', body},
    ),

  resolveHamaComment: (
    missionId: string,
    commentId: string,
    body: ResolveCommentDispositionRequest,
  ): Promise<HamaCommentRecord> =>
    apiFetch<HamaCommentRecord>(
      `/api/missions/${encodeURIComponent(missionId)}/comments/${encodeURIComponent(commentId)}/disposition`,
      {method: 'POST', body},
    ),

  getMissionTraceability: (
    missionId: string,
  ): Promise<MissionTraceabilityResponse> =>
    apiFetch<MissionTraceabilityResponse>(
      `/api/missions/${encodeURIComponent(missionId)}/traceability`,
    ),

  getMissionReadiness: (missionId: string): Promise<MergeReadinessReport> =>
    apiFetch<MergeReadinessReport>(
      `/api/missions/${encodeURIComponent(missionId)}/readiness`,
    ),

  getMissionEvidence: (missionId: string): Promise<MissionEvidenceResponse> =>
    apiFetch<MissionEvidenceResponse>(
      `/api/missions/${encodeURIComponent(missionId)}/evidence`,
    ),

  getControlSchema: (): Promise<ControlSchemaResponse> =>
    apiFetch<ControlSchemaResponse>('/api/schema/controls'),

  getTakeoverStatus: (
    changeId: string,
    nodeId?: string,
  ): Promise<TakeoverStatusSnapshot> => {
    const q = nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : '';
    return apiFetch<TakeoverStatusSnapshot>(
      `/api/changes/${encodeURIComponent(changeId)}/takeover-status${q}`,
    );
  },

  pauseForHumanTakeover: (
    changeId: string,
    nodeId: string,
    actor?: string,
  ): Promise<TakeoverStatusSnapshot> =>
    apiFetch<TakeoverStatusSnapshot>(
      `/api/changes/${encodeURIComponent(changeId)}/nodes/${encodeURIComponent(nodeId)}/takeover`,
      {method: 'POST', body: {actor: actor ?? 'human_operator'}},
    ),

  resumeFromHumanHandover: (
    changeId: string,
    nodeId: string,
    body: ResumeHandoverInput,
  ): Promise<ResumeHandoverResult> =>
    apiFetch<ResumeHandoverResult>(
      `/api/changes/${encodeURIComponent(changeId)}/nodes/${encodeURIComponent(nodeId)}/resume-handover`,
      {method: 'POST', body},
    ),

  getCausalDiff: (changeId: string): Promise<CausalDiffReport> =>
    apiFetch<CausalDiffReport>(
      `/api/changes/${encodeURIComponent(changeId)}/causal-diff`,
    ),

  recallMemory: (body: MemoryRecallQuery): Promise<MemoryRecallResult> =>
    apiFetch<MemoryRecallResult>('/api/memory/recall', {method: 'POST', body}),

  reflectMemory: (body: {
    readonly hubId: string;
    readonly executionMode: ExecutionMode;
    readonly question: string;
    readonly limit?: number;
  }): Promise<MemoryReflectResult> =>
    apiFetch<MemoryReflectResult>('/api/memory/reflect', {
      method: 'POST',
      body,
    }),

  listLivingDocs: (
    hubId: string,
    executionMode: ExecutionMode = 'live',
  ): Promise<readonly MemoryLivingDocRecord[]> =>
    apiFetch<readonly MemoryLivingDocRecord[]>(
      `/api/memory/living-docs?hubId=${encodeURIComponent(hubId)}&executionMode=${encodeURIComponent(executionMode)}`,
    ),

  listObservations: (
    hubId: string,
    executionMode: ExecutionMode = 'live',
    includeRetired = false,
  ): Promise<readonly MemoryObservationRecord[]> =>
    apiFetch<readonly MemoryObservationRecord[]>(
      `/api/memory/observations?hubId=${encodeURIComponent(hubId)}&executionMode=${encodeURIComponent(executionMode)}&includeRetired=${includeRetired ? '1' : '0'}`,
    ),

  reconcileGitMemory: (body: {
    readonly hubId: string;
    readonly executionMode?: ExecutionMode;
    readonly repoIds?: readonly string[];
  }): Promise<GitReconcileResult> =>
    apiFetch<GitReconcileResult>('/api/memory/reconcile-git', {
      method: 'POST',
      body,
    }),

  reconcileObservation: (
    observationId: string,
    body: ReconcileObservationInput,
  ): Promise<MemoryObservationRecord> =>
    apiFetch<MemoryObservationRecord>(
      `/api/memory/observations/${encodeURIComponent(observationId)}/reconcile`,
      {method: 'POST', body},
    ),

  subscribeEvents: (onEvent: (ev: ForgeSseEvent) => void): (() => void) => {
    const cfg = getBridgeConfig();
    const url = `${cfg.apiBaseUrl}/api/events?token=${encodeURIComponent(cfg.sessionToken)}`;
    const es = new EventSource(url);
    es.onmessage = msg => {
      try {
        const parsed = JSON.parse(msg.data) as ForgeSseEvent;
        onEvent(parsed);
      } catch {
        // Ignore malformed frame.
      }
    };
    return () => es.close();
  },
};

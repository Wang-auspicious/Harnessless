/**
 * Shared HTTP & SSE wire contracts between Electron Host and React Renderer.
 */

import type {
  ApprovedRequirementsBaseline,
  BaselineImpactReport,
  CausalDiffFile,
  CausalDiffGroup,
  CausalDiffReport,
  CodebaseImportEdge,
  CodebaseProbeFileHit,
  CodebaseProbeReport,
  CodebaseRealityNote,
  CommentDisposition,
  ControlAvailability,
  ControlCommandInput,
  DecisionInput,
  DecisionPacketSummary,
  EvidenceBundle,
  EvidenceVerificationResult,
  ExecutionMode,
  FailureCategory,
  FailureDiagnosis,
  FailureForensicsCard,
  FocusExplainability,
  FocusProgressivePanels,
  GitReconcileResult,
  HamaArtifactRecord,
  HamaCommentRecord,
  IntentPresetId,
  MemoryEntityRecord,
  MemoryEdgeRecord,
  MemoryLivingDocRecord,
  MemoryObservationRecord,
  MemoryRecallQuery,
  MemoryRecallResult,
  MemoryReflectResult,
  MergeReadinessReport,
  MissionConfigOverrides,
  MissionDecisionRecord,
  MissionEventRecord,
  MissionGateRecord,
  MissionHealth,
  MissionRecord,
  MissionStage,
  MissionStageStepSummary,
  ReconcileObservationInput,
  ResumeHandoverInput,
  ResumeHandoverResult,
  TakeoverStatusSnapshot,
  TrialSimulationReport,
  TriageTrack,
  ValidationReport,
} from './v3-types.ts';
import type {ControlSettingDescriptor} from './control-schema.ts';
import type {
  AdapterOperationalProfile,
  AgentAdapterManifest,
  AttentionItem,
  AuditLedgerEntry,
  ChangeRecord,
  ChangeTeamConfig,
  CheckpointRecord,
  DaemonStatus,
  DomainTermEntry,
  EngineeringRoom,
  GraphEdge,
  GraphNode,
  FederationHub,
  ModelProviderConfig,
  PermissionTier,
  RehydrationCapsule,
  RepoTier,
  RepositoryEntry,
  RoomMessage,
  RoomScenario,
  RoomThread,
  SemanticMemory,
  SkillEntry,
  SlotLoadSnapshot,
  SoulConstitution,
  TranscriptMessage,
  TranscriptSession,
} from './types.ts';

export interface BootstrapSnapshot {
  readonly constitution: SoulConstitution;
  readonly hubs: readonly FederationHub[];
  readonly repositories: readonly RepositoryEntry[];
  readonly domainTerms: readonly DomainTermEntry[];
  readonly changes: readonly ChangeRecord[];
  readonly attentionQueue: readonly AttentionItem[];
  readonly capsules: readonly RehydrationCapsule[];
  readonly adapters: readonly AdapterOperationalProfile[];
  readonly providers: readonly ModelProviderConfig[];
  readonly skills: readonly SkillEntry[];
  readonly daemons: readonly DaemonStatus[];
  readonly slotLoad: SlotLoadSnapshot;
  readonly recentAuditLogs: readonly AuditLedgerEntry[];
}

export interface ChangeDetailSnapshot {
  readonly change: ChangeRecord;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly checkpoints: readonly CheckpointRecord[];
  readonly sessions: readonly TranscriptSession[];
}

export interface RoomDetailSnapshot {
  readonly rooms: readonly EngineeringRoom[];
  readonly threads: readonly RoomThread[];
  readonly messages: readonly RoomMessage[];
}

export interface MemoryObservatorySnapshot {
  readonly capsules: readonly RehydrationCapsule[];
  readonly activeMemories: readonly SemanticMemory[];
  readonly supersededMemories: readonly SemanticMemory[];
  readonly recentSessions: readonly TranscriptSession[];
}

export interface EvidenceSearchHit {
  readonly messageId: string;
  readonly sessionId: string;
  readonly adapterId: string;
  readonly role: string;
  readonly snippet: string;
  readonly createdAt: string;
}

export interface CreateHubRequest {
  readonly name: string;
  readonly rootPath: string;
  readonly description: string;
  readonly permissionTier: PermissionTier;
}

export interface RegisterRepoRequest {
  readonly hubId: string;
  readonly name: string;
  readonly tier: RepoTier;
  readonly localPath: string;
  readonly verifyCommand: string;
  readonly boundedContext: string;
  readonly contractSummary: string;
}

export interface UpsertDomainTermRequest {
  readonly hubId: string;
  readonly boundedContext: string;
  readonly owningRepoIds: readonly string[];
  readonly canonicalTerm: string;
  readonly localLabel: string;
  readonly definition: string;
  readonly forbiddenAliases: readonly string[];
  readonly schemaAnchors: readonly string[];
}

export interface CreateChangeRequest {
  readonly hubId: string;
  readonly repoId: string;
  readonly title: string;
  readonly summary: string;
  readonly permissionTier: PermissionTier;
  readonly maxOvernightHours?: number;
  readonly budgetUsdLimit?: number;
  readonly leadAdapterId?: string;
  readonly workerAdapterId?: string;
}

export interface ProposeGhostNodeRequest {
  readonly changeId: string;
  readonly title: string;
  readonly description: string;
  readonly insertBeforeNodeId: string;
  readonly gateCommand?: string;
}

export interface PostRoomMessageRequest {
  readonly roomId: string;
  readonly threadId?: string;
  readonly threadTitle?: string;
  readonly bodyMarkdown: string;
  readonly mentions?: readonly string[];
}

export interface CreateRoomRequest {
  readonly hubId: string;
  readonly name: string;
  readonly scenario: RoomScenario;
  readonly topic: string;
}

export interface PromoteThreadToChangeRequest {
  readonly threadId: string;
  readonly repoId: string;
  readonly title: string;
  readonly permissionTier: PermissionTier;
}

export interface UpdateProviderSecretRequest {
  readonly providerId: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
}

export interface UpdateChangeTeamRequest {
  readonly team: Partial<ChangeTeamConfig>;
  readonly permissionTier?: PermissionTier;
}

export type RegisterAdapterRequest = Omit<AgentAdapterManifest, 'builtIn'>;

export type ForgeSseEvent =
  | {
      readonly type: 'state.changed';
      readonly scope: string;
      readonly at: string;
    }
  | {
      readonly type: 'change.progress';
      readonly changeId: string;
      readonly nodeId: string;
      readonly status: string;
      readonly summary: string;
      readonly at: string;
    }
  | {
      readonly type: 'transcript.chunk';
      readonly sessionId: string;
      readonly changeId: string | null;
      readonly message: TranscriptMessage;
    }
  | {
      readonly type: 'room.message';
      readonly roomId: string;
      readonly message: RoomMessage;
    }
  | {
      readonly type: 'attention.raised';
      readonly item: AttentionItem;
    }
  | {
      readonly type: 'audit.logged';
      readonly entry: AuditLedgerEntry;
    }
  | {
      readonly type: 'mission.updated';
      readonly missionId: string;
      readonly status: string;
      readonly stage: string;
      readonly at: string;
    }
  | {
      readonly type: 'gate.opened';
      readonly missionId: string;
      readonly gateId: string;
      readonly kind: string;
      readonly at: string;
    }
  | {
      readonly type: 'gate.resolved';
      readonly missionId: string;
      readonly gateId: string;
      readonly action: string;
      readonly at: string;
    }
  | {
      readonly type: 'memory.consolidated';
      readonly hubId: string;
      readonly executionMode: ExecutionMode;
      readonly at: string;
    };

export interface CreateMissionRequest {
  readonly hubId?: string;
  readonly repoIds?: readonly string[];
  readonly repoPaths?: readonly string[];
  readonly projectId?: string;
  readonly title?: string;
  readonly rawIntent: string;
  readonly documents?: readonly {
    readonly title: string;
    readonly content: string;
  }[];
  readonly preset?: IntentPresetId;
  readonly executionMode?: ExecutionMode;
  readonly triageTrack?: TriageTrack;
  readonly parentBaselineId?: string;
  readonly configOverrides?: MissionConfigOverrides;
}

export interface FocusProjection {
  readonly mission: MissionRecord;
  readonly stage: MissionStage;
  readonly stageSteps: readonly MissionStageStepSummary[];
  readonly stageProgress?: {
    readonly currentStepIndex: number;
    readonly totalSteps: number;
    readonly percentComplete: number;
    readonly activeChangeCount: number;
    readonly certifiedChangeCount: number;
  };
  readonly health: MissionHealth;
  readonly rehydration: RehydrationCapsule | null;
  readonly primaryAction: MissionGateRecord | null;
  readonly pendingActionCount: number;
  readonly secondaryActions: readonly DecisionPacketSummary[];
  readonly availableControls: readonly ControlAvailability[];
  readonly explainability: FocusExplainability;
  readonly progressivePanels: FocusProgressivePanels;
}

export interface ProbeMissionRequest {
  readonly hubId?: string;
  readonly repoIds?: readonly string[];
  readonly repoPaths?: readonly string[];
  readonly rawIntent: string;
  readonly executionMode?: ExecutionMode;
}

export interface CreateMissionResponse {
  readonly mission: MissionRecord;
  readonly focus: FocusProjection;
  readonly probe?: CodebaseProbeReport;
}

export interface MissionDetailSnapshot {
  readonly mission: MissionRecord;
  readonly focus: FocusProjection;
  readonly gates: readonly MissionGateRecord[];
  readonly decisions: readonly MissionDecisionRecord[];
  readonly changes: readonly ChangeRecord[];
  readonly baseline: ApprovedRequirementsBaseline | null;
  readonly validation: ValidationReport | null;
  readonly trial: TrialSimulationReport | null;
  readonly probe?: CodebaseProbeReport | null;
}

export interface HamaDetailSnapshot {
  readonly missionId: string;
  readonly stage: string;
  readonly proposalReworkCount: number;
  readonly prdLocalEditCount: number;
  readonly artifacts: readonly HamaArtifactRecord[];
  readonly comments: readonly HamaCommentRecord[];
  readonly prdMarkdown: string | null;
  readonly baseline: ApprovedRequirementsBaseline | null;
}

export interface AddCommentRequest {
  readonly scopeKey: string;
  readonly paragraphRef?: string;
  readonly authorKind?: 'human' | 'agent';
  readonly authorLabel?: string;
  readonly severity?: 'blocking' | 'advisory';
  readonly body: string;
}

export interface ResolveCommentDispositionRequest {
  readonly disposition: CommentDisposition;
  readonly resolutionNote: string;
  readonly resolvedBy: string;
  readonly actorKind?: 'human' | 'agent';
}

export interface MemoryRetainRequest {
  readonly hubId: string;
  readonly repoId?: string | null;
  readonly missionId?: string | null;
  readonly executionMode?: ExecutionMode;
  readonly sourceType: string;
  readonly occurredAt?: string;
  readonly rawText: string;
  readonly authorityTier?: 'L3_locked' | 'L2_verified' | 'L1_observed';
}

export interface MemoryGraphSnapshot {
  readonly entities: readonly MemoryEntityRecord[];
  readonly edges: readonly MemoryEdgeRecord[];
}

export interface ControlSchemaResponse {
  readonly presets: readonly IntentPresetId[];
  readonly controls: readonly ControlSettingDescriptor[];
  readonly policies?: Readonly<Record<IntentPresetId, unknown>>;
}

export interface BaselineImpactRequest {
  readonly compareToBaselineId?: string;
  readonly nextBaselineId?: string;
}

export interface MissionEvidenceResponse {
  readonly bundle: EvidenceBundle;
  readonly verification: EvidenceVerificationResult;
}

export interface MissionTraceabilityResponse {
  readonly missionId: string;
  readonly baseline: ApprovedRequirementsBaseline | null;
  readonly changes: readonly ChangeRecord[];
  readonly readiness: MergeReadinessReport | null;
  readonly impact: BaselineImpactReport | null;
}

export type {
  BaselineImpactReport,
  CausalDiffFile,
  CausalDiffGroup,
  CausalDiffReport,
  CodebaseImportEdge,
  CodebaseProbeFileHit,
  CodebaseProbeReport,
  CodebaseRealityNote,
  ControlCommandInput,
  DecisionInput,
  FailureCategory,
  FailureDiagnosis,
  FailureForensicsCard,
  GitReconcileResult,
  MemoryLivingDocRecord,
  MemoryObservationRecord,
  MemoryRecallQuery,
  MemoryRecallResult,
  MemoryReflectResult,
  MissionEventRecord,
  ReconcileObservationInput,
  ResumeHandoverInput,
  ResumeHandoverResult,
  TakeoverStatusSnapshot,
};

export interface ForgePreloadBridge {
  readonly apiBaseUrl: string;
  readonly sessionToken: string;
  readonly hasNativeTitlebarOverlay?: boolean;
  pickDirectory(): Promise<string | null>;
  openExternal?(url: string): Promise<boolean>;
  openPath?(targetPath: string): Promise<boolean>;
  openInEditor?(
    targetPath: string,
  ): Promise<{readonly ok: boolean; readonly editor: string}>;
  setWindowTheme?(theme: 'light' | 'dark'): Promise<boolean>;
}

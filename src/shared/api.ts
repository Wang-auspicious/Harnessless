/**
 * Shared HTTP & SSE wire contracts between Electron Host and React Renderer.
 */

import type {
  AdapterOperationalProfile,
  AgentAdapterManifest,
  AttentionItem,
  AuditLedgerEntry,
  ChangeRecord,
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
    };

export interface ForgePreloadBridge {
  readonly apiBaseUrl: string;
  readonly sessionToken: string;
  pickDirectory(): Promise<string | null>;
}

/**
 * Canonical enterprise domain models shared across Host and Renderer faces.
 * Contains zero Node, filesystem, or DOM dependencies.
 */

export type PermissionTier = 'turbo' | 'supervised' | 'strict';
export type RepoTier = 'infra' | 'service';
export type AdapterTransport = 'acp-stdio' | 'cli-stream' | 'native-api';
export type AgentRole =
  | 'lead'
  | 'worker'
  | 'evaluator'
  | 'moderator'
  | 'infra_steward'
  | 'specialist';

export interface FederationHub {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly description: string;
  readonly agentWikiSummary: string;
  readonly permissionTier: PermissionTier;
  readonly lastHumanInteractionAt: string;
  readonly spacedReviewCount: number;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface RepositoryEntry {
  readonly id: string;
  readonly hubId: string;
  readonly name: string;
  readonly tier: RepoTier;
  readonly localPath: string;
  readonly defaultBranch: string;
  readonly verifyCommand: string;
  readonly contractSummary: string;
  readonly boundedContext: string;
  readonly lastHumanInteractionAt: string;
  readonly spacedReviewCount: number;
  readonly createdAt: string;
}

export interface DomainTermEntry {
  readonly id: string;
  readonly hubId: string;
  readonly boundedContext: string;
  readonly owningRepoIds: readonly string[];
  readonly canonicalTerm: string;
  readonly localLabel: string;
  readonly definition: string;
  readonly forbiddenAliases: readonly string[];
  readonly schemaAnchors: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ChangeStatus =
  | 'draft'
  | 'grilling'
  | 'planned'
  | 'running'
  | 'cooldown_hold'
  | 'paused_human'
  | 'auditing'
  | 'certified'
  | 'failed'
  | 'archived';

export interface AcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
  readonly checkCommand?: string;
  readonly certified: boolean;
}

export interface ChangeTeamConfig {
  readonly leadAdapterId: string;
  readonly leadModel: string;
  readonly workerAdapterId: string;
  readonly workerModel: string;
  readonly juniorAuditModel: string;
  readonly seniorAuditModel: string;
  readonly maxRetryLoops: number;
}

export interface ChangeRecord {
  readonly id: string;
  readonly hubId: string;
  readonly repoId: string;
  readonly crossRepoEpicId: string | null;
  readonly code: string;
  readonly title: string;
  readonly summary: string;
  readonly specMarkdown: string;
  readonly status: ChangeStatus;
  readonly permissionTier: PermissionTier;
  readonly worktreePath: string;
  readonly gitBranch: string;
  readonly baseCommitSha: string;
  readonly verifyCommand: string;
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly team: ChangeTeamConfig;
  readonly qualityScore: number;
  readonly budgetUsdLimit: number;
  readonly spentUsd: number;
  readonly maxOvernightHours: number;
  readonly prematureStopCount: number;
  readonly cooldownUntil: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type GraphNodeKind =
  | 'start'
  | 'verify'
  | 'phase_container'
  | 'task'
  | 'gates'
  | 'selfcheck'
  | 'audit_jqa'
  | 'audit_sqa'
  | 'decision'
  | 'restore'
  | 'checkpoint'
  | 'ghost'
  | 'end';

export type GraphNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'certified'
  | 'failed'
  | 'blocked_human'
  | 'rewound'
  | 'waived';

export interface GraphNode {
  readonly id: string;
  readonly changeId: string;
  readonly code: string;
  readonly parentWbsId: string | null;
  readonly containerNodeId: string | null;
  readonly kind: GraphNodeKind;
  readonly title: string;
  readonly description: string;
  readonly fileScope: readonly string[];
  readonly gateCommand: string | null;
  readonly assignedRole: AgentRole;
  readonly assignedAdapterId: string | null;
  readonly assignedModel: string | null;
  readonly status: GraphNodeStatus;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly collapsed: boolean;
  readonly positionX: number;
  readonly positionY: number;
  readonly width: number;
  readonly height: number;
  readonly outputSummary: string;
  readonly restoreTargetCheckpointId: string | null;
  readonly updatedAt: string;
}

export type EdgeKind = 'logic' | 'pass' | 'fail' | 'dep';

export interface GraphEdge {
  readonly id: string;
  readonly changeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly kind: EdgeKind;
  readonly label: string;
}

export interface CheckpointRecord {
  readonly id: string;
  readonly changeId: string;
  readonly nodeId: string;
  readonly label: string;
  readonly gitCommitSha: string;
  readonly gitTag: string;
  readonly rescueRef: string | null;
  readonly certifiedTaskCount: number;
  readonly totalTaskCount: number;
  readonly createdAt: string;
}

export type AttentionKind =
  'question' | 'gate_approval' | 'amendment_approval' | 'adapter_fault';

export interface AttentionItem {
  readonly id: string;
  readonly hubId: string;
  readonly repoId: string | null;
  readonly changeId: string | null;
  readonly nodeId: string | null;
  readonly threadId: string | null;
  readonly kind: AttentionKind;
  readonly question: string;
  readonly contextSnippet: string;
  readonly options: readonly string[];
  readonly recommendedIndex: number;
  readonly downstreamBlockedCount: number;
  readonly estimatedReadSeconds: number;
  readonly status: 'open' | 'answered' | 'dismissed';
  readonly resolution: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export type RoomScenario =
  'req-grill' | 'arch-council' | 'triage-ops' | 'direct-ops' | 'exec-briefing';

export interface EngineeringRoom {
  readonly id: string;
  readonly hubId: string;
  readonly name: string;
  readonly scenario: RoomScenario;
  readonly topic: string;
  readonly createdAt: string;
}

export interface RoomThread {
  readonly id: string;
  readonly roomId: string;
  readonly changeId: string | null;
  readonly title: string;
  readonly mandateScope: string;
  readonly status: 'active' | 'resolved' | 'promoted';
  readonly subscribedAgentIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoomMessage {
  readonly id: string;
  readonly roomId: string;
  readonly threadId: string | null;
  readonly authorKind: 'human' | 'agent' | 'system';
  readonly authorId: string;
  readonly authorLabel: string;
  readonly mentions: readonly string[];
  readonly bodyMarkdown: string;
  readonly metadataJson: string;
  readonly createdAt: string;
}

export interface AgentAdapterManifest {
  readonly id: string;
  readonly label: string;
  readonly specialty: string;
  readonly sovereignSoul: string;
  readonly transport: AdapterTransport;
  readonly command: string;
  readonly baseArgs: readonly string[];
  readonly healthProbeArgs: readonly string[];
  readonly mcpInjection:
    'acp-session' | 'claude-mcp-json' | 'codex-flag' | 'env-url' | 'none';
  readonly jsonlParser:
    | 'claude-stream'
    | 'codex-rpc'
    | 'opencode-json'
    | 'pi-json'
    | 'generic-jsonl'
    | 'none';
  readonly permissionFlags: {
    readonly turbo: readonly string[];
    readonly supervised: readonly string[];
    readonly strict: readonly string[];
  };
  readonly envAllowlist: readonly string[];
  readonly defaultModel: string;
  readonly supportedRoles: readonly AgentRole[];
  readonly maxConcurrentSlots: number;
  readonly builtIn: boolean;
}

export type AdapterHealthState =
  'healthy' | 'degraded' | 'circuit_open' | 'unprobed';

export interface AdapterOperationalProfile {
  readonly manifest: AgentAdapterManifest;
  readonly health: AdapterHealthState;
  readonly lastProbeMessage: string;
  readonly lastProbedAt: string | null;
  readonly rollingScoredSlices: number;
  readonly firstPassRate: number;
  readonly effectiveCostPerCertifiedUsd: number;
  readonly cacheHitRatio: number;
  readonly prematureStopRate: number;
  readonly consecutiveEnvFaults: number;
}

export interface ModelProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly protocol: 'openai-compatible' | 'anthropic-messages';
  readonly baseUrl: string;
  readonly hasApiKey: boolean;
  readonly maskedKeyHint: string;
  readonly models: readonly ModelCatalogEntry[];
  readonly updatedAt: string;
}

export interface ModelCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly tier: 'strong' | 'fast';
  readonly inputUsdPerMillion: number;
  readonly cachedInputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly contextWindowTokens: number;
}

export interface SkillEntry {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly category:
    'grill' | 'ddd' | 'architecture' | 'qa' | 'retro' | 'infra';
  readonly version: string;
  readonly promptBody: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

export interface SemanticMemory {
  readonly id: string;
  readonly hubId: string;
  readonly repoId: string | null;
  readonly kind: 'architecture' | 'pitfall_lesson' | 'convention' | 'adr';
  readonly title: string;
  readonly summary: string;
  readonly pathAnchors: readonly string[];
  readonly sourceSessionId: string | null;
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly supersededById: string | null;
  readonly stabilityHours: number;
  readonly recallCount: number;
  readonly lastRecalledAt: string;
  readonly staleSuspect: boolean;
  readonly createdAt: string;
}

export interface TranscriptSession {
  readonly id: string;
  readonly hubId: string;
  readonly changeId: string | null;
  readonly nodeId: string | null;
  readonly adapterId: string;
  readonly model: string;
  readonly role: AgentRole;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted';
}

export interface TranscriptMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolName: string | null;
  readonly isError: boolean;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly createdAt: string;
}

export interface ExecutionTelemetryRecord {
  readonly id: string;
  readonly hubId: string;
  readonly changeId: string;
  readonly nodeId: string;
  readonly adapterId: string;
  readonly model: string;
  readonly role: AgentRole;
  readonly outcome: 'certified' | 'task_failure' | 'env_fault';
  readonly firstPassCertified: boolean;
  readonly prematureStopTriggered: boolean;
  readonly durationSec: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly firstTurnCachedTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly diagnostic: string;
  readonly createdAt: string;
}

export type RehydrationTier = 'warm' | 'delta_30s' | 'deep_reanchor';

export interface RehydrationCapsule {
  readonly hubId: string;
  readonly hubName: string;
  readonly retentionScore: number;
  readonly stabilityHours: number;
  readonly elapsedHours: number;
  readonly mutationEntropy: number;
  readonly tier: RehydrationTier;
  readonly northStarGoal: string;
  readonly lastHumanAnchor: string;
  readonly autonomousDeltaBullets: readonly string[];
  readonly lockedDecisions: readonly string[];
  readonly nextDecisionPrompt: string | null;
  readonly generatedAt: string;
}

export interface EpistemicHandoff {
  readonly specConfirmedFacts: readonly string[];
  readonly agentHypotheses: readonly string[];
  readonly openConflicts: readonly string[];
  readonly uncertifiedCriteria: readonly string[];
}

export interface AuditLedgerEntry {
  readonly id: string;
  readonly hubId: string | null;
  readonly changeId: string | null;
  readonly category:
    | 'constitution'
    | 'infra_evolution'
    | 'checkpoint'
    | 'rewind'
    | 'ghost_amendment'
    | 'ddd_refactor'
    | 'dreaming'
    | 'gate_decision';
  readonly actor: string;
  readonly title: string;
  readonly detail: string;
  readonly createdAt: string;
}

export interface DaemonStatus {
  readonly id: 'continuity_watchdog' | 'dreaming_consolidator' | 'infra_patrol';
  readonly label: string;
  readonly enabled: boolean;
  readonly runningPass: boolean;
  readonly intervalSeconds: number;
  readonly lastRunAt: string | null;
  readonly lastSummary: string;
}

export interface SoulConstitution {
  readonly version: number;
  readonly title: string;
  readonly markdown: string;
  readonly blockedCommands: readonly string[];
  readonly updatedBy: string;
  readonly updatedAt: string;
}

export interface SlotLoadSnapshot {
  readonly maxWorkerSlots: number;
  readonly activeWorkerSlots: number;
  readonly queuedWorkerTasks: number;
  readonly humanPrioritySlotBusy: boolean;
}

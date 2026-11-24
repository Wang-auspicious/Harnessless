/**
 * SDLC-Studio v4.0 wire types, Master Agent orchestration contracts,
 * Kano/BWS/AHP quantization types, Board <-> Spec IR types, Task WBS types,
 * Claude Ship review types, and structural bridge for Native Kernels & CollabBus.
 */

export type KernelId =
  | 'master'
  | 'claude-code'
  | 'codex'
  | 'gemini-cli'
  | 'opencode'
  | 'pi'
  | 'native-api';

export type MasterSessionMode = 'solo' | 'team';

export type MasterExecutionMode = 'auto' | 'live' | 'local';

export type MasterStage =
  'intent' | 'spec' | 'tasks' | 'executing' | 'review' | 'delivered';

export interface MasterSession {
  readonly id: string;
  readonly title: string;
  readonly mode: MasterSessionMode;
  readonly executionMode: MasterExecutionMode;
  readonly workspacePath: string;
  readonly hubId: string;
  readonly repoId: string;
  readonly stage: MasterStage;
  readonly term: number;
  readonly crPassed: boolean;
  readonly activePlanId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MasterChatRole = 'human' | 'master' | 'agent' | 'system';

export type MasterChatKind =
  | 'text'
  | 'decision_card'
  | 'grilling'
  | 'collab_event'
  | 'trace_summary'
  | 'ship_card';

export interface DecisionCardPayload {
  readonly conclusion: string;
  readonly evidence: readonly string[];
  readonly recommendation: string;
  readonly risk: string;
  readonly decisionNeeded: string;
  readonly actionNeeded: string;
}

export interface GrillingQuestionOption {
  readonly id: string;
  readonly label: string;
  readonly rationale: string;
  readonly recommended?: boolean;
}

export interface GrillingQuestion {
  readonly id: string;
  readonly label: string;
  readonly isForkQuestion?: boolean;
  readonly defaultOptionId: string;
  readonly selectedOptionId?: string;
  readonly customAnswer?: string;
  readonly options: readonly GrillingQuestionOption[];
}

export interface GrillingPayload {
  readonly round: number;
  readonly title: string;
  readonly summary: string;
  readonly settled: readonly string[];
  readonly questions: readonly GrillingQuestion[];
  readonly resolved?: boolean;
}

export interface CollabEventMeta {
  readonly collabId: string;
  readonly fromKernel: KernelId;
  readonly toKernel: KernelId;
  readonly kind:
    'handoff' | 'question' | 'review' | 'finding' | 'decision' | 'delegate';
  readonly taskId?: string;
  readonly targetTab?:
    'tasks' | 'board_spec' | 'code_diff' | 'verify_html' | 'kernels' | 'dag';
}

export interface TraceSummaryItem {
  readonly verb: string;
  readonly object: string;
  readonly outcome: string;
  readonly status: 'ok' | 'running' | 'warn' | 'failed';
  readonly detail?: string;
  readonly kernelId?: KernelId;
  readonly taskId?: string;
}

export interface MasterChatMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: MasterChatRole;
  readonly agentKernel: KernelId;
  readonly kind: MasterChatKind;
  readonly content: string;
  readonly decisionCard?: DecisionCardPayload;
  readonly grilling?: GrillingPayload;
  readonly collabMeta?: CollabEventMeta;
  readonly traceItems?: readonly TraceSummaryItem[];
  readonly createdAt: string;
}

export type ConsensusAuthorKind =
  'human' | 'master_agent' | 'team_agent' | 'critic_agent';

export type ConsensusEntryType =
  | 'intent'
  | 'found'
  | 'asked'
  | 'advised'
  | 'kano'
  | 'ahp'
  | 'ruling'
  | 'dissent'
  | 'commit';

export type ConsensusCommitState = 'proposed' | 'committed' | 'superseded';

export interface ConsensusLogEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly term: number;
  readonly logSeq: number;
  readonly authorPrincipalId: string;
  readonly authorKind: ConsensusAuthorKind;
  readonly entryType: ConsensusEntryType;
  readonly specAnchorId: string | null;
  readonly payloadJson: string;
  readonly commitState: ConsensusCommitState;
  readonly createdAt: string;
}

export type KanoResponseLevel =
  'like' | 'expect' | 'neutral' | 'tolerate' | 'dislike';

export type KanoCategory = 'M' | 'O' | 'A' | 'I' | 'R' | 'Q';

export interface KanoVoteSample {
  readonly functional: KanoResponseLevel;
  readonly dysfunctional: KanoResponseLevel;
}

export interface BwsParameterMapping {
  readonly fuzzyTerm: string;
  readonly engineeringMetric: string;
  readonly assertion: string;
  readonly bestWorstScore?: number;
}

export interface KanoAhpInputItem {
  readonly reqId: string;
  readonly title: string;
  readonly functional?: KanoResponseLevel;
  readonly dysfunctional?: KanoResponseLevel;
  readonly samples?: readonly KanoVoteSample[];
  readonly bwsMappings?: readonly BwsParameterMapping[];
}

export interface KanoAhpScoreItem {
  readonly reqId: string;
  readonly title: string;
  readonly kanoCategory: KanoCategory;
  readonly betterSI: number;
  readonly worseDSI: number;
  readonly priorityBucket: 'p0_must' | 'p1_compete' | 'backlog' | 'rejected';
  readonly ahpWeight: number;
  readonly bwsMappings: readonly BwsParameterMapping[];
}

export interface QuantizationResult {
  readonly items: readonly KanoAhpScoreItem[];
  readonly ahpWeights: readonly number[];
  readonly lambdaMax: number;
  readonly ci: number;
  readonly cr: number;
  readonly passed: boolean;
  readonly maxConflictPair?: readonly [number, number];
  readonly diagnostic: string;
}

export type BoardNodeKind =
  'module' | 'service' | 'store' | 'ui' | 'gate' | 'external';

export interface BoardNode {
  readonly id: string;
  readonly label: string;
  readonly kind: BoardNodeKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly specModuleId: string;
  readonly status: 'draft' | 'confirmed' | 'blocked';
  readonly summary?: string;
}

export interface BoardEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly label: string;
}

export interface BoardSceneDoc {
  readonly nodes: readonly BoardNode[];
  readonly edges: readonly BoardEdge[];
  readonly revision: number;
}

export interface SpecIRModule {
  readonly moduleId: string;
  readonly boardNodeId: string;
  readonly title: string;
  readonly ownerPrincipalIds: readonly string[];
  readonly boundaryPseudocode: string;
  readonly allowedPaths: readonly string[];
  readonly verificationChecks: readonly string[];
}

export interface SpecSettledDecision {
  readonly decisionId: string;
  readonly origin: 'human' | 'agent_assumed_accepted' | 'consensus_quorum';
  readonly logSeq: number;
  readonly summary: string;
}

export interface SpecOpenPinRef {
  readonly pinId: string;
  readonly pinNumber: number;
  readonly surfaceType: ArtifactSurfaceType;
  readonly status: ArtifactPinStatus;
}

export interface SpecIRContract {
  readonly specId: string;
  readonly term: number;
  readonly status:
    'draft' | 'grilling' | 'builder_checked' | 'committed' | 'superseded';
  readonly goals: readonly string[];
  readonly nonGoals: readonly string[];
  readonly kanoSummary: readonly KanoAhpScoreItem[];
  readonly ubiquitousTerms: readonly string[];
  readonly modules: readonly SpecIRModule[];
  readonly settledDecisions: readonly SpecSettledDecision[];
  readonly openPins: readonly SpecOpenPinRef[];
  readonly revision: number;
}

export type ArtifactSurfaceType =
  'board' | 'spec_ir' | 'code_diff' | 'html_verify';

export type ArtifactPinStatus =
  'waiting_on_agent' | 'waiting_on_human' | 'resolved';

export interface ArtifactPin {
  readonly id: string;
  readonly sessionId: string;
  readonly surfaceType: ArtifactSurfaceType;
  readonly anchorJson: string;
  readonly specNodeId: string | null;
  readonly pinNumber: number;
  readonly promptText: string;
  readonly status: ArtifactPinStatus;
  readonly replyText: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export type TaskNodeRole =
  'architect' | 'coder' | 'tester' | 'reviewer' | 'steward';

export type DecomposedTaskStatus =
  'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'paused';

export interface TaskDiffStats {
  readonly added: number;
  readonly removed: number;
  readonly filesChanged: number;
}

export interface DecomposedTaskNode {
  readonly id: string;
  readonly planId: string;
  readonly title: string;
  readonly description: string;
  readonly role: TaskNodeRole;
  readonly assignedKernel: KernelId;
  readonly dependsOn: readonly string[];
  readonly fileScope: readonly string[];
  readonly acceptanceChecks: readonly string[];
  readonly status: DecomposedTaskStatus;
  readonly waveIndex: number;
  readonly worktreeBranch: string | null;
  readonly worktreePath: string | null;
  readonly checkpointId: string | null;
  readonly outputSummary: string;
  readonly diffStats: TaskDiffStats;
  readonly beforeTreeSha?: string;
  readonly afterTreeSha?: string;
  readonly error?: string;
}

export interface TaskDecompositionPlan {
  readonly id: string;
  readonly sessionId: string;
  readonly specRevision: number;
  readonly status: 'draft' | 'approved' | 'running' | 'completed' | 'failed';
  readonly tasks: readonly DecomposedTaskNode[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TaskMutation =
  | {
      readonly op: 'split';
      readonly taskId: string;
      readonly parts: readonly {
        readonly title: string;
        readonly description?: string;
        readonly role?: TaskNodeRole;
        readonly assignedKernel?: KernelId;
        readonly fileScope: readonly string[];
        readonly acceptanceChecks?: readonly string[];
      }[];
    }
  | {
      readonly op: 'merge';
      readonly taskIds: readonly string[];
      readonly title: string;
      readonly description?: string;
      readonly assignedKernel?: KernelId;
    }
  | {
      readonly op: 'reassign_kernel';
      readonly taskId: string;
      readonly assignedKernel: KernelId;
    }
  | {
      readonly op: 'update_deps';
      readonly taskId: string;
      readonly dependsOn: readonly string[];
    }
  | {
      readonly op: 'edit_checks';
      readonly taskId: string;
      readonly acceptanceChecks: readonly string[];
      readonly fileScope?: readonly string[];
    }
  | {
      readonly op: 'add_task';
      readonly title: string;
      readonly description: string;
      readonly role: TaskNodeRole;
      readonly assignedKernel: KernelId;
      readonly dependsOn?: readonly string[];
      readonly fileScope: readonly string[];
      readonly acceptanceChecks: readonly string[];
    }
  | {
      readonly op: 'remove_task';
      readonly taskId: string;
    };

export interface TurnDiffFile {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly patch: string;
}

export interface TurnDiffSnapshot {
  readonly id: string;
  readonly sessionId: string;
  readonly taskId: string;
  readonly kernelId: KernelId;
  readonly beforeTreeSha: string;
  readonly afterTreeSha: string;
  readonly files: readonly TurnDiffFile[];
  readonly createdAt: string;
}

export type ShipReviewDepth = 'fast' | 'standard' | 'deep';

export interface ShipReviewFinding {
  readonly id: string;
  readonly severity: 'info' | 'warn' | 'blocker';
  readonly category: 'security' | 'contract' | 'concurrency' | 'quality';
  readonly filePath: string;
  readonly summary: string;
  readonly fixedBySteward: boolean;
}

export interface ShipStewardFix {
  readonly id: string;
  readonly summary: string;
  readonly rollbackRecipe: string;
  readonly filesTouched: readonly string[];
}

export interface ShipReviewBundle {
  readonly id: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly reviewDepth: ShipReviewDepth;
  readonly reviewerKernel: KernelId;
  readonly coderKernels: readonly KernelId[];
  readonly antiSelfApprovalPassed: boolean;
  readonly findings: readonly ShipReviewFinding[];
  readonly stewardFixes: readonly ShipStewardFix[];
  readonly policyMode: 'shadow' | 'enforced';
  readonly wouldApprove: boolean;
  readonly answerHtml: string;
  readonly verdict: 'pending' | 'passed' | 'rejected';
  readonly createdAt: string;
}

export interface NativeKernelCard {
  readonly kernelId: KernelId;
  readonly displayName: string;
  readonly command: string;
  readonly installed: boolean;
  readonly version: string | null;
  readonly binaryPath: string | null;
  readonly defaultRoles: readonly TaskNodeRole[];
  readonly status: 'ready' | 'missing' | 'degraded' | 'builtin';
  readonly lastCheckedAt: string;
}

export interface CollabFeedItem {
  readonly id: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly fromKernel: KernelId;
  readonly toKernel: KernelId | 'all';
  readonly kind:
    'handoff' | 'question' | 'review' | 'finding' | 'decision' | 'delegate';
  readonly taskId: string | null;
  readonly audienceScope: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface HostedAppCard {
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  readonly versionTag: string;
  readonly workspacePath: string;
  readonly entryCommand: string;
  readonly urlOrPort: string | null;
  readonly status: 'stopped' | 'starting' | 'running' | 'crashed';
  readonly commitSha: string | null;
  readonly npsScore: number | null;
  readonly csatScore: number | null;
  readonly updatedAt: string;
}

export interface WorkspaceFileEntry {
  readonly path: string;
  readonly kind: 'file' | 'dir';
  readonly sizeBytes: number;
}

export interface WorkspaceFileContent {
  readonly path: string;
  readonly content: string;
  readonly lineCount: number;
  readonly truncated: boolean;
}

export interface V4SessionDetail {
  readonly session: MasterSession;
  readonly messages: readonly MasterChatMessage[];
  readonly consensusLog: readonly ConsensusLogEntry[];
  readonly quantization: QuantizationResult | null;
  readonly board: BoardSceneDoc;
  readonly specIR: SpecIRContract;
  readonly pins: readonly ArtifactPin[];
  readonly activePlan: TaskDecompositionPlan | null;
  readonly diffs: readonly TurnDiffSnapshot[];
  readonly latestShip: ShipReviewBundle | null;
  readonly collabFeed: readonly CollabFeedItem[];
  readonly hostedApps: readonly HostedAppCard[];
  readonly channels?: readonly CollabChannelRecord[];
  readonly posts?: readonly CollabPostRecord[];
  readonly collabDoc?: CollabDocSnapshot;
  readonly unreadQueue?: readonly UnreadQueueItem[];
  readonly schedules?: readonly ScheduledTriggerRecord[];
}

export interface V4BootstrapPayload {
  readonly sessions: readonly MasterSession[];
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Readonly<Record<TaskNodeRole, KernelId>>;
  readonly hostedApps: readonly HostedAppCard[];
  readonly pendingApprovalsCount: number;
  readonly activeSessionId: string | null;
  readonly gateway?: GatewaySnapshot;
  readonly dashboard?: DashboardSummaryPayload;
}

export interface CatchupSummaryItem {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly stage: MasterStage;
  readonly pendingPins: number;
  readonly pendingShipReview: boolean;
  readonly latestSummary: string;
  readonly updatedAt: string;
}

/**
 * Structural bridge for coordinator to wire `@runtime-collab`'s `CollabBus`
 * and `probeNativeKernels` into `ForgeRuntime` without cross-branch imports.
 */
export interface NativeRuntimeBridge {
  probeKernels?: () => Promise<readonly NativeKernelCard[]>;
  getRoleRouting?: () => Readonly<Record<TaskNodeRole, KernelId>>;
  setRoleRouting?: (
    routing: Partial<Readonly<Record<TaskNodeRole, KernelId>>>,
  ) => Readonly<Record<TaskNodeRole, KernelId>>;
  postCollab?: (input: {
    readonly sessionId: string;
    readonly fromKernel: KernelId;
    readonly toKernel: KernelId | 'all';
    readonly kind: CollabFeedItem['kind'];
    readonly taskId?: string | null;
    readonly audienceScope?: string;
    readonly allowedReaders?: readonly string[];
    readonly content: string;
  }) => CollabFeedItem;
  queryCollab?: (input: {
    readonly sessionId?: string;
    readonly readerPrincipal?: string;
    readonly limit?: number;
  }) => readonly CollabFeedItem[];
  subscribeCollab?: (cb: (item: CollabFeedItem) => void) => () => void;
}

export type V4SseEvent =
  | {
      readonly type: 'v4.session.updated';
      readonly session: MasterSession;
    }
  | {
      readonly type: 'v4.message.added';
      readonly sessionId: string;
      readonly message: MasterChatMessage;
    }
  | {
      readonly type: 'v4.consensus.entry';
      readonly sessionId: string;
      readonly entry: ConsensusLogEntry;
    }
  | {
      readonly type: 'v4.workspace.updated';
      readonly sessionId: string;
      readonly kind: 'board' | 'spec_ir' | 'quantization';
      readonly revision: number;
    }
  | {
      readonly type: 'v4.pin.changed';
      readonly sessionId: string;
      readonly pin: ArtifactPin;
    }
  | {
      readonly type: 'v4.plan.updated';
      readonly sessionId: string;
      readonly plan: TaskDecompositionPlan;
    }
  | {
      readonly type: 'v4.task.updated';
      readonly sessionId: string;
      readonly planId: string;
      readonly task: DecomposedTaskNode;
    }
  | {
      readonly type: 'v4.turn.snapshot';
      readonly sessionId: string;
      readonly snapshot: TurnDiffSnapshot;
    }
  | {
      readonly type: 'v4.collab.message';
      readonly sessionId: string;
      readonly item: CollabFeedItem;
    }
  | {
      readonly type: 'v4.ship.ready';
      readonly sessionId: string;
      readonly review: ShipReviewBundle;
    }
  | {
      readonly type: 'v4.app.updated';
      readonly app: HostedAppCard;
    }
  | {
      readonly type: 'v4.collab.post';
      readonly sessionId: string;
      readonly post: CollabPostRecord;
    }
  | {
      readonly type: 'v4.collab.doc';
      readonly sessionId: string;
      readonly revision: number;
    }
  | {
      readonly type: 'v4.gateway.updated';
      readonly scope:
        'providers' | 'routing' | 'profiles' | 'agents' | 'connectors';
    };

// ============================================================================
// Magpie-Inspired Model Gateway, Routing Groups, Profiles & Agent Roster
// ============================================================================

export type ProviderPresetKind =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'openrouter'
  | 'ollama'
  | 'openai-compatible';

export interface ProviderModelEntry {
  readonly id: string;
  readonly label: string;
  readonly contextK: number;
  readonly supportsTools?: boolean;
  readonly supportsReasoning?: boolean;
}

export interface ProviderApiKeyEntry {
  readonly id: string;
  readonly label: string;
  readonly keyPreview: string;
  readonly rawKey?: string;
  readonly enabled: boolean;
  readonly quotaExhausted?: boolean;
}

export interface ModelProviderRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderPresetKind;
  readonly baseUrl: string;
  readonly apiKeys: readonly ProviderApiKeyEntry[];
  readonly models: readonly ProviderModelEntry[];
  readonly enabled: boolean;
  readonly priority: number;
  readonly healthStatus: 'untested' | 'ok' | 'degraded' | 'error';
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export type RoutingStrategy = 'order' | 'rotate' | 'context-tiered';

export interface RoutingTarget {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly harnessId?: KernelId;
  readonly maxContextK?: number;
  readonly weight?: number;
}

export interface RoutingGroupRecord {
  readonly id: string;
  readonly name: string;
  readonly strategy: RoutingStrategy;
  readonly targets: readonly RoutingTarget[];
  readonly failoverEnabled: boolean;
  readonly updatedAt: string;
}

export interface ModelProfileRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly bindings: Readonly<
    Record<
      string,
      {
        readonly bindingKind: AgentBindingKind;
        readonly providerId?: string;
        readonly modelId?: string;
        readonly routingGroupId?: string;
        readonly harnessId?: KernelId;
      }
    >
  >;
  readonly active: boolean;
  readonly updatedAt: string;
}

export type AgentBindingKind =
  'provider_model' | 'routing_group' | 'cli_harness';

export type AgentRoleKey =
  | 'coordinator'
  | 'pm_analyst'
  | 'architect'
  | 'ui_prototyper'
  | 'engineer'
  | 'reviewer';

export interface AgentPersonaRecord {
  readonly id: string;
  readonly displayName: string;
  readonly handle: string;
  readonly roleKey: AgentRoleKey;
  readonly avatarKey: string;
  readonly accentColor: string;
  readonly bindingKind: AgentBindingKind;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly routingGroupId: string | null;
  readonly harnessId: KernelId | null;
  readonly systemPrompt: string;
  readonly resolvedModelLabel: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
}

export type ConnectorKind = 'slack' | 'github' | 'notion' | 'google_docs';

export interface ExternalConnectorRecord {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly config: Readonly<Record<string, string>>;
  readonly status: 'disconnected' | 'configured' | 'synced';
  readonly lastSyncAt: string | null;
  readonly updatedAt: string;
}

export interface PrivacyMaskingConfig {
  readonly enabled: boolean;
  readonly maskSecrets: boolean;
  readonly maskEmails: boolean;
  readonly allowDomains: readonly string[];
}

export interface GatewaySnapshot {
  readonly providers: readonly ModelProviderRecord[];
  readonly routingGroups: readonly RoutingGroupRecord[];
  readonly profiles: readonly ModelProfileRecord[];
  readonly agents: readonly AgentPersonaRecord[];
  readonly connectors: readonly ExternalConnectorRecord[];
  readonly privacyMasking: PrivacyMaskingConfig;
}

// ============================================================================
// Multi-Human / Multi-Agent Collaboration Channels, Rich Media & Live PRD Docs
// ============================================================================

export interface CollabChannelRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly createdAt: string;
}

export type PostAttachmentKind =
  | 'prd_card'
  | 'spec_card'
  | 'whiteboard_card'
  | 'html_mockup'
  | 'markdown_doc'
  | 'image'
  | 'video'
  | 'decision_poll';

export interface PostAttachment {
  readonly id: string;
  readonly kind: PostAttachmentKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly url?: string;
  readonly htmlContent?: string;
  readonly markdownContent?: string;
  readonly blockId?: string;
  readonly pollOptions?: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly votes: number;
    readonly recommended?: boolean;
  }[];
  readonly selectedPollOptionId?: string;
}

export interface PostReaction {
  readonly emoji: string;
  readonly count: number;
  readonly byViewer: boolean;
  readonly actors: readonly string[];
}

export interface CollabPostRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly channelId: string;
  readonly parentPostId: string | null;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorKind: 'human' | 'agent';
  readonly authorAvatar: string;
  readonly authorColor: string;
  readonly modelLabel: string;
  readonly content: string;
  readonly attachments: readonly PostAttachment[];
  readonly mentions: readonly string[];
  readonly reactions: readonly PostReaction[];
  readonly threadStatus: 'open' | 'resolved';
  readonly resolvedBy: string | null;
  readonly replyCount?: number;
  readonly replyAvatars?: readonly string[];
  readonly lastReplyAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UnreadQueueItem {
  readonly id: string;
  readonly sessionId: string;
  readonly channelId: string;
  readonly postId: string;
  readonly targetAgentId: string;
  readonly targetAgentName: string;
  readonly fromAuthor: string;
  readonly summary: string;
  readonly status: 'queued' | 'processing' | 'done';
  readonly createdAt: string;
  readonly processedAt: string | null;
}

export interface ScheduledTriggerRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly channelId: string;
  readonly targetAgentId: string;
  readonly targetAgentName: string;
  readonly intervalLabel: string;
  readonly promptText: string;
  readonly enabled: boolean;
  readonly runCount: number;
  readonly lastRunAt: string | null;
  readonly createdAt: string;
}

export type PrdSectionKey =
  | 'overview'
  | 'goals'
  | 'user_stories'
  | 'functional_scope'
  | 'architecture'
  | 'non_functional'
  | 'acceptance_criteria'
  | 'open_questions';

export interface DocBlockComment {
  readonly id: string;
  readonly authorName: string;
  readonly authorKind: 'human' | 'agent';
  readonly authorColor: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface CollabDocBlock {
  readonly id: string;
  readonly sectionKey: PrdSectionKey;
  readonly title: string;
  readonly markdown: string;
  readonly lastAuthorId: string;
  readonly lastAuthorName: string;
  readonly lastAuthorKind: 'human' | 'agent';
  readonly lastAuthorColor: string;
  readonly lastModelLabel: string;
  readonly lastEditedAt: string;
  readonly revision: number;
  readonly comments: readonly DocBlockComment[];
}

export interface DocLineDiffHunk {
  readonly kind: 'context' | 'add' | 'del';
  readonly text: string;
}

export interface CollabDocRevision {
  readonly id: string;
  readonly sessionId: string;
  readonly docKind: 'prd';
  readonly revision: number;
  readonly blockId: string;
  readonly blockTitle: string;
  readonly beforeMarkdown: string;
  readonly afterMarkdown: string;
  readonly diffHunks: readonly DocLineDiffHunk[];
  readonly diffSummary: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorKind: 'human' | 'agent';
  readonly authorColor: string;
  readonly modelLabel: string;
  readonly createdAt: string;
}

export interface CollabDocSnapshot {
  readonly sessionId: string;
  readonly docKind: 'prd';
  readonly title: string;
  readonly revision: number;
  readonly blocks: readonly CollabDocBlock[];
  readonly revisions: readonly CollabDocRevision[];
  readonly updatedAt: string;
}

export interface DashboardSummaryPayload {
  readonly agents: readonly (AgentPersonaRecord & {
    readonly state: 'working' | 'queued' | 'idle';
    readonly unreadCount: number;
    readonly editCount: number;
  })[];
  readonly activeSessionsCount: number;
  readonly queuedItems: readonly UnreadQueueItem[];
  readonly schedules: readonly ScheduledTriggerRecord[];
  readonly recentEdits: readonly CollabDocRevision[];
  readonly recentPosts: readonly CollabPostRecord[];
}

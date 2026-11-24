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
}

export interface V4BootstrapPayload {
  readonly sessions: readonly MasterSession[];
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Readonly<Record<TaskNodeRole, KernelId>>;
  readonly hostedApps: readonly HostedAppCard[];
  readonly pendingApprovalsCount: number;
  readonly activeSessionId: string | null;
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
    };

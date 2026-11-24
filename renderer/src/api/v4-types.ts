/**
 * SDLC-Studio v4 Renderer Wire Types.
 * Kept 100% aligned with `src/shared/v4-types.ts` and `/api/v4/*` routes.
 */

export type KernelId =
  | 'master'
  | 'claude-code'
  | 'codex'
  | 'gemini-cli'
  | 'opencode'
  | 'pi'
  | 'native-api';

export type TaskNodeRole =
  'architect' | 'coder' | 'tester' | 'reviewer' | 'steward';

export type SessionStage =
  'intent' | 'spec' | 'tasks' | 'executing' | 'review' | 'delivered';

export type SessionMode = 'solo' | 'team';
export type SessionExecutionMode = 'auto' | 'live' | 'local';

export interface MasterSession {
  readonly id: string;
  readonly title: string;
  readonly mode: SessionMode;
  readonly executionMode: SessionExecutionMode;
  readonly workspacePath: string;
  readonly hubId: string;
  readonly repoId: string;
  readonly stage: SessionStage;
  readonly term: number;
  readonly crPassed: boolean;
  readonly activePlanId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BuzzDecisionCard {
  readonly conclusion: string;
  readonly evidence: readonly string[];
  readonly recommendation: string;
  readonly risk: string;
  readonly decisionNeeded: string;
  readonly actionNeeded: string;
}

export interface GrillingOption {
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
  readonly options: readonly GrillingOption[];
}

export interface GrillingCardPayload {
  readonly round: number;
  readonly title: string;
  readonly summary: string;
  readonly settled: readonly string[];
  readonly questions: readonly GrillingQuestion[];
  readonly resolved?: boolean;
}

export type WorkspaceTabId =
  'tasks' | 'board' | 'code' | 'verify' | 'kernels' | 'dag';

export interface CollabMessageMeta {
  readonly collabId: string;
  readonly fromKernel: KernelId;
  readonly toKernel: KernelId;
  readonly kind: string;
  readonly taskId?: string | null;
  readonly targetTab?: WorkspaceTabId | string;
}

export interface TraceProgressItem {
  readonly verb: string;
  readonly object: string;
  readonly outcome: string;
  readonly status: 'running' | 'done' | 'failed' | 'pending' | string;
  readonly detail?: string;
  readonly kernelId?: KernelId;
  readonly taskId?: string;
}

export interface MasterChatMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: 'human' | 'master' | 'agent' | 'system';
  readonly agentKernel: KernelId;
  readonly kind:
    | 'text'
    | 'decision_card'
    | 'grilling'
    | 'collab_event'
    | 'trace_summary'
    | 'ship_card';
  readonly content: string;
  readonly decisionCard?: BuzzDecisionCard;
  readonly grilling?: GrillingCardPayload;
  readonly collabMeta?: CollabMessageMeta;
  readonly traceItems?: readonly TraceProgressItem[];
  readonly createdAt: string;
}

export interface ConsensusLogEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly term: number;
  readonly logSeq: number;
  readonly authorPrincipalId: string;
  readonly authorKind: string;
  readonly entryType: string;
  readonly specAnchorId: string | null;
  readonly payloadJson: string;
  readonly commitState: string;
  readonly createdAt: string;
}

export type KanoAnswer = 'like' | 'expect' | 'neutral' | 'tolerate' | 'dislike';

export interface BwsMapping {
  readonly fuzzyTerm: string;
  readonly engineeringMetric: string;
  readonly assertion: string;
  readonly bestWorstScore?: number;
}

export interface KanoAhpInputItem {
  readonly reqId: string;
  readonly title: string;
  readonly functional?: KanoAnswer;
  readonly dysfunctional?: KanoAnswer;
  readonly samples?: readonly {
    readonly functional: KanoAnswer;
    readonly dysfunctional: KanoAnswer;
  }[];
  readonly bwsMappings?: readonly BwsMapping[];
}

export interface KanoAhpScoreItem {
  readonly reqId: string;
  readonly title: string;
  readonly kanoCategory: 'M' | 'O' | 'A' | 'I' | 'R' | 'Q';
  readonly betterSI: number;
  readonly worseDSI: number;
  readonly priorityBucket: 'p0_must' | 'p1_compete' | 'backlog' | 'rejected';
  readonly ahpWeight: number;
  readonly bwsMappings: readonly BwsMapping[];
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

export interface BoardNodeDoc {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly specModuleId: string;
  readonly status: string;
  readonly summary?: string;
}

export interface BoardEdgeDoc {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly label: string;
}

export interface BoardSceneDoc {
  readonly nodes: readonly BoardNodeDoc[];
  readonly edges: readonly BoardEdgeDoc[];
  readonly revision: number;
}

export interface SpecModuleContract {
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
  readonly origin: string;
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
  readonly status: string;
  readonly goals: readonly string[];
  readonly nonGoals: readonly string[];
  readonly kanoSummary: readonly KanoAhpScoreItem[];
  readonly ubiquitousTerms: readonly string[];
  readonly modules: readonly SpecModuleContract[];
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

export type DecomposedTaskStatus =
  'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'paused';

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
  readonly outputSummary: string | null;
  readonly diffStats: {
    readonly added: number;
    readonly removed: number;
    readonly filesChanged: number;
  };
  readonly beforeTreeSha?: string | null;
  readonly afterTreeSha?: string | null;
  readonly error?: string | null;
}

export interface TaskDecompositionPlan {
  readonly id: string;
  readonly sessionId: string;
  readonly specRevision: number;
  readonly status: string;
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

export interface TurnDiffFileEntry {
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
  readonly files: readonly TurnDiffFileEntry[];
  readonly createdAt: string;
}

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
  readonly reviewDepth: 'fast' | 'standard' | 'deep';
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
  readonly toKernel: KernelId;
  readonly kind: string;
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
  readonly urlOrPort: string;
  readonly status: string;
  readonly commitSha: string;
  readonly npsScore: number | null;
  readonly csatScore: number | null;
  readonly updatedAt: string;
}

export interface CatchupSummaryItem {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly stage: SessionStage;
  readonly pendingPins: number;
  readonly pendingShipReview: boolean;
  readonly latestSummary: string;
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

export interface V4BootstrapPayload {
  readonly sessions: readonly MasterSession[];
  readonly kernels: readonly NativeKernelCard[];
  readonly roleRouting: Record<TaskNodeRole, KernelId>;
  readonly hostedApps: readonly HostedAppCard[];
  readonly pendingApprovalsCount: number;
  readonly activeSessionId: string | null;
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

export interface V4SseEnvelope {
  readonly type: string;
  readonly sessionId?: string;
  readonly payload?: unknown;
}

export type ExecutionMode = 'live' | 'simulation';
export type TriageTrack = 'express' | 'standard' | 'full_hama';
export type IntentPresetId = 'autopilot' | 'guided' | 'strict_audit';

export type MissionStage =
  | 'understand'
  | 'converge_spec'
  | 'plan_validate'
  | 'build_verify'
  | 'certify_deliver';

export type MissionStatus =
  | 'intent'
  | 'triage'
  | 'requirements'
  | 'baseline_frozen'
  | 'plan_review'
  | 'executing'
  | 'certification'
  | 'delivered'
  | 'paused_human'
  | 'cooldown_hold'
  | 'failed'
  | 'aborted';

export type MissionHealth =
  'flowing' | 'needs_you' | 'recovering' | 'completed' | 'failed' | 'aborted';

export type MissionGateKind =
  | 'triage_confirm'
  | 'clarification'
  | 'discussion'
  | 'evaluation'
  | 'approval'
  | 'conditions'
  | 'confirmation'
  | 'limit'
  | 'plan_review'
  | 'ghost_amendment'
  | 'build_escalation'
  | 'budget_extension'
  | 'qa_decision'
  | 'stale_upstream_gate'
  | 'delivery_approval'
  | 'setup_required';

export type DecisionAction =
  | 'confirm_triage'
  | 'clarify'
  | 'resolve_issue'
  | 'approve'
  | 'conditional_approve'
  | 'release_conditions'
  | 'request_changes'
  | 'confirm'
  | 'reject'
  | 'escalate'
  | 'retry_review'
  | 'approve_plan'
  | 'approve_ghost'
  | 'waive_ghost'
  | 'resume'
  | 'resync_upstream'
  | 'extend_budget'
  | 'hold'
  | 'approve_delivery'
  | 'switch_simulation';

export type ControlAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'retry_node'
  | 'rewind_checkpoint'
  | 'resync_upstream'
  | 'amend_ghost'
  | 'switch_preset'
  | 'escalate_triage'
  | 'evolve_baseline'
  | 'abort';

export interface MissionConfigOverrides {
  readonly budgetUsdLimit?: number;
  readonly maxOvernightHours?: number;
  readonly maxParallelSlots?: number;
  readonly maxDiscussionRounds?: number;
  readonly maxRevisions?: number;
  readonly maxLocalPrdEdits?: number;
  readonly targetRepoIds?: readonly string[];
  readonly leadAdapterId?: string;
  readonly leadModel?: string;
  readonly workerAdapterId?: string;
  readonly workerModel?: string;
}

export interface MissionRecord {
  readonly id: string;
  readonly hubId: string;
  readonly projectId: string;
  readonly code: string;
  readonly title: string;
  readonly rawIntent: string;
  readonly status: MissionStatus;
  readonly stage: MissionStage;
  readonly triageTrack: TriageTrack;
  readonly triageRationale: string;
  readonly preset: IntentPresetId;
  readonly executionMode: ExecutionMode;
  readonly version: number;
  readonly executionEpoch: number;
  readonly activeBaselineId: string | null;
  readonly parentBaselineId: string | null;
  readonly budgetUsdLimit: number;
  readonly spentUsd: number;
  readonly maxOvernightHours: number;
  readonly configOverrides: MissionConfigOverrides;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface DecisionOptionPreview {
  readonly action: DecisionAction;
  readonly label: string;
  readonly recommended: boolean;
  readonly consequencePreview: string;
  readonly requiresFeedback: boolean;
}

export interface MissionGateRecord {
  readonly id: string;
  readonly missionId: string;
  readonly changeId: string | null;
  readonly nodeId: string | null;
  readonly kind: MissionGateKind;
  readonly targetId: string;
  readonly targetHash: string;
  readonly targetRevision: number;
  readonly question: string;
  readonly contextSnippet: string;
  readonly options: readonly DecisionOptionPreview[];
  readonly status: 'open' | 'resolved' | 'dismissed';
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface DecisionInput {
  readonly gateId: string;
  readonly targetId: string;
  readonly targetHash: string;
  readonly idempotencyKey: string;
  readonly actor: string;
  readonly action: DecisionAction;
  readonly feedback: string;
  readonly scope: 'local' | 'proposal';
  readonly issueIds: readonly string[];
}

export interface MissionDecisionRecord {
  readonly id: string;
  readonly gateId: string;
  readonly missionId: string;
  readonly idempotencyKey: string;
  readonly payloadSha256: string;
  readonly targetId: string;
  readonly targetHash: string;
  readonly actor: string;
  readonly action: DecisionAction;
  readonly feedback: string;
  readonly scope: 'local' | 'proposal';
  readonly issueIds: readonly string[];
  readonly decidedAt: string;
}

export interface ControlCommandInput {
  readonly action: ControlAction;
  readonly expectedVersion?: number;
  readonly actor?: string;
  readonly nodeId?: string;
  readonly checkpointId?: string;
  readonly changeId?: string;
  readonly preset?: IntentPresetId;
  readonly ghostTitle?: string;
  readonly ghostDescription?: string;
  readonly insertBeforeNodeId?: string;
  readonly gateCommand?: string;
  readonly feedback?: string;
}

export interface ControlAvailability {
  readonly action: ControlAction;
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly impactSummary: string;
}

export interface MissionStageStepSummary {
  readonly stage: MissionStage;
  readonly label: string;
  readonly status: 'pending' | 'active' | 'completed' | 'blocked';
}

export interface DecisionPacketSummary {
  readonly gateId: string;
  readonly kind: MissionGateKind;
  readonly title: string;
  readonly targetId: string;
  readonly targetHash: string;
  readonly changeId: string | null;
}

export interface FocusExplainability {
  readonly whyHere: string;
  readonly waitingReason: string | null;
  readonly recentForensics?: readonly FailureForensicsCard[];
  readonly activeDddTerms: readonly {
    readonly canonicalTerm: string;
    readonly boundedContext: string;
    readonly forbiddenAliases: readonly string[];
  }[];
  readonly recalledMemories: readonly {
    readonly id: string;
    readonly title: string;
    readonly authorityTier: MemoryAuthorityTier;
    readonly score: number;
  }[];
}

export interface FocusProgressivePanels {
  readonly l1Summary: {
    readonly triageTrack: TriageTrack;
    readonly triageRationale: string;
    readonly preset: IntentPresetId;
    readonly executionMode: ExecutionMode;
    readonly budgetUsedUsd: number;
    readonly budgetLimitUsd: number;
    readonly baselineId: string | null;
  };
  readonly l2Work: {
    readonly changeIds: readonly string[];
    readonly totalNodes: number;
    readonly certifiedNodes: number;
    readonly runningNodes: number;
    readonly failedNodes: number;
    readonly hamaStage: string | null;
    readonly openCommentsCount: number;
    readonly blockingCommentsCount: number;
  };
  readonly l3Internals: {
    readonly executionEpoch: number;
    readonly missionVersion: number;
    readonly recentEventCount: number;
    readonly pendingOutboxCount: number;
    readonly deadLetterOutboxCount: number;
  };
}

export interface MissionEventRecord {
  readonly id: string;
  readonly missionId: string;
  readonly seq: number;
  readonly eventType: string;
  readonly actor: string;
  readonly payloadJson: string;
  readonly prevHash: string;
  readonly eventHash: string;
  readonly createdAt: string;
}

export interface ArtifactRef<K extends string = string> {
  readonly id: string;
  readonly kind: K;
  readonly revision: number;
  readonly hash: string;
}

export interface HamaArtifactRecord<
  T = unknown,
  K extends string = string,
> extends ArtifactRef<K> {
  readonly missionId: string;
  readonly subject: string;
  readonly createdAt: string;
  readonly data: T;
}

export type CommentDisposition =
  'open' | 'accepted' | 'changed' | 'rejected' | 'deferred';

export interface HamaCommentRecord {
  readonly id: string;
  readonly missionId: string;
  readonly scopeKey: string;
  readonly paragraphRef: string;
  readonly authorKind: 'human' | 'agent';
  readonly authorLabel: string;
  readonly severity: 'blocking' | 'advisory';
  readonly body: string;
  readonly disposition: CommentDisposition;
  readonly resolutionNote: string;
  readonly resolvedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AcceptanceCriterionV3 {
  readonly id: string;
  readonly key: string;
  readonly given: string;
  readonly when: string;
  readonly then: string;
}

export interface RequirementItem {
  readonly id: string;
  readonly scopeKey: string;
  readonly supersedesScopeKey?: string | null;
  readonly kind: 'functional' | 'nonfunctional';
  readonly title: string;
  readonly description: string;
  readonly value: string;
  readonly priority: 'must' | 'should' | 'could';
  readonly dependencies: readonly string[];
  readonly constraints: readonly string[];
  readonly acceptance: readonly AcceptanceCriterionV3[];
  readonly state: 'under_review' | 'baselined';
}

export interface TraceLink {
  readonly ideaAndDocumentIds: readonly string[];
  readonly issueIds: readonly string[];
  readonly proposal: ArtifactRef<'proposal'>;
  readonly scopeKey: string;
  readonly approvalId: string;
  readonly requirementId: string;
  readonly acceptanceIds: readonly string[];
}

export interface PrdDocument {
  readonly title: string;
  readonly revision: number;
  readonly proposal: ArtifactRef<'proposal'>;
  readonly approvalId: string;
  readonly background: string;
  readonly scenarios: readonly string[];
  readonly goals: readonly string[];
  readonly summary: string;
  readonly approach: readonly string[];
  readonly outOfScope: readonly string[];
  readonly constraints: readonly string[];
  readonly businessRules: readonly string[];
  readonly externalDependencies: readonly string[];
  readonly tradeoffs: readonly string[];
  readonly risks: readonly string[];
  readonly unresolved: readonly string[];
  readonly requirements: readonly RequirementItem[];
  readonly trace: readonly TraceLink[];
  readonly changes: readonly string[];
}

export interface ApprovedRequirementsBaseline {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly revision: number;
  readonly parentId: string | null;
  readonly mode: ExecutionMode;
  readonly approvedPrd: ArtifactRef<'prd'>;
  readonly approval: MissionDecisionRecord;
  readonly conditionalApproval?: MissionDecisionRecord;
  readonly confirmation: MissionDecisionRecord;
  readonly prd: PrdDocument;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface ValidationIssue {
  readonly id: string;
  readonly level: 'error' | 'warning' | 'info';
  readonly category:
    | 'structure'
    | 'spec_coverage'
    | 'contract'
    | 'ddd'
    | 'capability'
    | 'policy';
  readonly changeCode: string | null;
  readonly nodeCode: string | null;
  readonly requirementId: string | null;
  readonly message: string;
  readonly suggestion: string;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly issues: readonly ValidationIssue[];
  readonly checkedAt: string;
}

export interface TrialWave {
  readonly waveIndex: number;
  readonly nodeIds: readonly string[];
  readonly nodeCodes: readonly string[];
  readonly parallelSlotsUsed: number;
}

export interface TrialSimulationReport {
  readonly feasible: boolean;
  readonly totalExecutableNodes: number;
  readonly estimatedWaves: readonly TrialWave[];
  readonly criticalPathLength: number;
  readonly contendedNodePairs: readonly {
    readonly nodeA: string;
    readonly nodeB: string;
    readonly reason: string;
  }[];
  readonly unreachableNodeCodes: readonly string[];
}

export interface BaselineImpactReport {
  readonly parentBaselineId: string;
  readonly nextBaselineId: string;
  readonly addedScopeKeys: readonly string[];
  readonly removedScopeKeys: readonly string[];
  readonly modifiedScopeKeys: readonly string[];
  readonly renamedScopeCandidates: readonly {
    readonly fromScopeKey: string;
    readonly toScopeKey: string;
    readonly similarity: number;
  }[];
  readonly unchangedScopeKeys: readonly string[];
  readonly impactedChanges: readonly {
    readonly changeId: string;
    readonly changeCode: string;
    readonly affectedNodeIds: readonly string[];
    readonly preservedCertifiedNodeIds: readonly string[];
    readonly recommendation: 'patch_active_change' | 'spawn_successor_change';
  }[];
}

export interface MergeReadinessReport {
  readonly ready: boolean;
  readonly checkedAt: string;
  readonly repositories: readonly {
    readonly repoId: string;
    readonly repoName: string;
    readonly changeId: string;
    readonly changeCode: string;
    readonly targetBranch: string;
    readonly changeBranch: string;
    readonly clean: boolean;
    readonly conflictFiles: readonly string[];
    readonly diagnostic: string;
  }[];
}

export interface EpistemicItemRecord {
  readonly id: string;
  readonly changeId: string;
  readonly nodeId: string | null;
  readonly executionEpoch: number;
  readonly kind: 'spec_confirmed' | 'hypothesis' | 'conflict' | 'forensics';
  readonly content: string;
  readonly evidenceRef: string | null;
  readonly createdAt: string;
}

export type FailureCategory =
  'infra_env' | 'test_tampering' | 'spec_gap' | 'logic_bug';

export interface FailureDiagnosis {
  readonly category: FailureCategory;
  readonly fingerprint: string;
  readonly plainTitleZh: string;
  readonly plainTitleEn: string;
  readonly plainAdviceZh: string;
  readonly plainAdviceEn: string;
  readonly shouldRetryCoder: boolean;
  readonly evidenceLines: readonly string[];
}

export interface FailureForensicsCard {
  readonly failedNodeId: string;
  readonly failedNodeCode: string;
  readonly reasonCode: string;
  readonly summary: string;
  readonly diagnostics: readonly string[];
  readonly targetCheckpointLabel: string;
  readonly rescueRef: string;
  readonly failedAt: string;
  readonly category?: FailureCategory;
  readonly errorFingerprint?: string;
  readonly spinDetected?: boolean;
  readonly suggestedAction?: string;
}

export interface EvidenceBundle {
  readonly schemaVersion: 1;
  readonly missionId: string;
  readonly missionCode: string;
  readonly executionMode: ExecutionMode;
  readonly baselineId: string | null;
  readonly baselineSha256: string | null;
  readonly exportedAt: string;
  readonly traceabilityMatrix: readonly {
    readonly requirementId: string;
    readonly scopeKey: string;
    readonly acceptanceIds: readonly string[];
    readonly nodeIds: readonly string[];
    readonly changeIds: readonly string[];
    readonly certified: boolean;
  }[];
  readonly changes: readonly {
    readonly changeId: string;
    readonly code: string;
    readonly repoId: string;
    readonly gitBranch: string;
    readonly baseCommitSha: string;
    readonly headCheckpointSha: string | null;
    readonly status: string;
  }[];
  readonly mergeReadiness: MergeReadinessReport | null;
  readonly events: readonly MissionEventRecord[];
  readonly bundleSha256: string;
}

export interface EvidenceVerificationResult {
  readonly valid: boolean;
  readonly checkedEvents: number;
  readonly errors: readonly string[];
}

export type MemoryAuthorityTier = 'L3_locked' | 'L2_verified' | 'L1_observed';
export type MemoryFactKind =
  | 'world'
  | 'experience'
  | 'decision'
  | 'constraint'
  | 'pitfall'
  | 'rejected_option';
export type ObservationBeliefStatus =
  'active' | 'contested' | 'superseded' | 'retired';
export type LivingDocKind =
  | 'mental_model'
  | 'agent_wiki'
  | 'ddd_map'
  | 'pitfall_runbook'
  | 'baseline_changelog';

export interface MemoryDocumentRecord {
  readonly id: string;
  readonly hubId: string;
  readonly repoId: string | null;
  readonly missionId: string | null;
  readonly executionMode: ExecutionMode;
  readonly sourceType: string;
  readonly occurredAt: string;
  readonly contentSha256: string;
  readonly rawText: string;
  readonly metadataJson: string;
  readonly createdAt: string;
}

export interface MemoryChunkRecord {
  readonly id: string;
  readonly documentId: string;
  readonly hubId: string;
  readonly executionMode: ExecutionMode;
  readonly seq: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
  readonly tokenEstimate: number;
  readonly createdAt: string;
}

export interface MemoryFactRecord {
  readonly id: string;
  readonly hubId: string;
  readonly repoId: string | null;
  readonly missionId: string | null;
  readonly executionMode: ExecutionMode;
  readonly kind: MemoryFactKind;
  readonly subjectKey: string;
  readonly claim: string;
  readonly confidence: number;
  readonly authorityTier: MemoryAuthorityTier;
  readonly eventStartAt: string;
  readonly eventEndAt: string | null;
  readonly ingestedAt: string;
  readonly validUntil: string | null;
  readonly supersededByFactId: string | null;
  readonly sourceDocumentId: string;
  readonly sourceChunkId: string;
  readonly pathAnchors: readonly string[];
  readonly entityIds: readonly string[];
  readonly stabilityHours: number;
  readonly recallCount: number;
  readonly lastRecalledAt: string;
  readonly consolidated: boolean;
}

export interface ObservationHistoryEntry {
  readonly statement: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly reason: string;
  readonly factIds: readonly string[];
}

export interface MemoryObservationRecord {
  readonly id: string;
  readonly hubId: string;
  readonly repoId: string | null;
  readonly executionMode: ExecutionMode;
  readonly kind?: MemoryFactKind;
  readonly subjectKey: string;
  readonly title: string;
  readonly statement: string;
  readonly beliefStatus: ObservationBeliefStatus;
  readonly authorityTier: MemoryAuthorityTier;
  readonly history: readonly ObservationHistoryEntry[];
  readonly supportingFactIds: readonly string[];
  readonly contradictingFactIds: readonly string[];
  readonly entityIds: readonly string[];
  readonly pathAnchors: readonly string[];
  readonly stabilityHours: number;
  readonly recallCount: number;
  readonly lastRecalledAt: string;
  readonly staleSuspect: boolean;
  readonly updatedAt: string;
  readonly createdAt: string;
}

export interface MemoryEntityRecord {
  readonly id: string;
  readonly hubId: string;
  readonly executionMode: ExecutionMode;
  readonly entityType: string;
  readonly canonicalKey: string;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly updatedAt: string;
}

export interface MemoryEdgeRecord {
  readonly id: string;
  readonly hubId: string;
  readonly executionMode: ExecutionMode;
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly relation: string;
  readonly weight: number;
  readonly sourceFactId: string | null;
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly createdAt: string;
}

export interface MemoryLivingDocRecord {
  readonly id: string;
  readonly hubId: string;
  readonly repoId: string | null;
  readonly executionMode: ExecutionMode;
  readonly docKind: LivingDocKind;
  readonly slug: string;
  readonly title: string;
  readonly standingQuestion: string;
  readonly scopeEntities: readonly string[];
  readonly contentMarkdown: string;
  readonly citedObservationIds: readonly string[];
  readonly version: number;
  readonly stale: boolean;
  readonly refreshedAt: string;
  readonly updatedAt: string;
}

export interface MemoryRecallQuery {
  readonly hubId: string;
  readonly executionMode: ExecutionMode;
  readonly query: string;
  readonly limit?: number;
  readonly sinceIso?: string;
  readonly untilIso?: string;
  readonly includeRejected?: boolean;
}

export interface MemoryRecallHit {
  readonly targetKind: 'observation' | 'fact' | 'chunk';
  readonly targetId: string;
  readonly title: string;
  readonly content: string;
  readonly kind: MemoryFactKind | 'chunk';
  readonly authorityTier: MemoryAuthorityTier;
  readonly score: number;
  readonly retentionFactor: number;
  readonly channelsMatched: readonly (
    'fts' | 'vector' | 'graph' | 'temporal'
  )[];
  readonly sourceChunkExcerpt: string | null;
  readonly observationHistoryCount: number;
  readonly rejectedWarning: string | null;
  readonly pathAnchors: readonly string[];
}

export interface MemoryRecallResult {
  readonly query: string;
  readonly executionMode: ExecutionMode;
  readonly embeddingSpace: string;
  readonly hits: readonly MemoryRecallHit[];
}

export interface MemoryReflectResult {
  readonly question: string;
  readonly answerMarkdown: string;
  readonly confirmedFacts: readonly string[];
  readonly inferences: readonly string[];
  readonly contradictions: readonly string[];
  readonly citedChunkIds: readonly string[];
  readonly citedObservationIds: readonly string[];
  readonly usedLivingDocIds: readonly string[];
}

export interface CodebaseProbeFileHit {
  readonly repoId: string;
  readonly repoName: string;
  readonly filePath: string;
  readonly score: number;
  readonly lineCount: number;
  readonly matchedKeywords: readonly string[];
  readonly exports: readonly string[];
  readonly importers: readonly string[];
  readonly excerpt: string;
}

export interface CodebaseImportEdge {
  readonly repoId: string;
  readonly fromFile: string;
  readonly toFile: string;
  readonly specifier: string;
}

export interface CodebaseRealityNote {
  readonly level: 'info' | 'warning' | 'challenge';
  readonly titleZh: string;
  readonly titleEn: string;
  readonly detailZh: string;
  readonly detailEn: string;
  readonly relatedFiles: readonly string[];
}

export interface CodebaseProbeReport {
  readonly probedAt: string;
  readonly repoCount: number;
  readonly scannedFilesCount: number;
  readonly matchedFiles: readonly CodebaseProbeFileHit[];
  readonly importEdges: readonly CodebaseImportEdge[];
  readonly detectedVerifyCommands: readonly {
    readonly repoId: string;
    readonly repoName: string;
    readonly command: string;
  }[];
  readonly recentHotspots: readonly {
    readonly repoId: string;
    readonly filePath: string;
    readonly commitCount: number;
    readonly lastSubject: string;
  }[];
  readonly recentReverts: readonly {
    readonly repoId: string;
    readonly sha: string;
    readonly subject: string;
    readonly files: readonly string[];
  }[];
  readonly realityNotes: readonly CodebaseRealityNote[];
  readonly blastRadius: 'low' | 'medium' | 'high';
  readonly recommendedTrack: TriageTrack;
  readonly plainRationaleZh: string;
  readonly plainRationaleEn: string;
  readonly estimatedCostRangeUsd: readonly [number, number];
  readonly recalledMemories: readonly {
    readonly id: string;
    readonly title: string;
    readonly authorityTier: MemoryAuthorityTier;
    readonly rejectedWarning: string | null;
  }[];
}

export interface TakeoverStatusSnapshot {
  readonly changeId: string;
  readonly changeCode: string;
  readonly changeStatus: string;
  readonly nodeId: string;
  readonly nodeCode: string;
  readonly nodeTitle: string;
  readonly nodeStatus: string;
  readonly worktreePath: string;
  readonly gitBranch: string;
  readonly verifyCommand: string;
  readonly modifiedFiles: readonly string[];
  readonly diffSummary: string;
  readonly diffPatch: string;
  readonly forensics: FailureForensicsCard | null;
}

export interface ResumeHandoverInput {
  readonly runVerify?: boolean;
  readonly handoverNote?: string;
  readonly saveAsMemory?: boolean;
  readonly memoryTitle?: string;
  readonly autoResume?: boolean;
  readonly actor?: string;
}

export interface ResumeHandoverResult {
  readonly ok: boolean;
  readonly verifyPassed: boolean;
  readonly verifyOutput: string;
  readonly checkpointSha: string | null;
  readonly checkpointTag: string | null;
  readonly changedFiles: readonly string[];
  readonly memoryRetained: boolean;
  readonly resumedExecution: boolean;
  readonly message: string;
}

export interface CausalDiffFile {
  readonly filePath: string;
  readonly patch: string;
  readonly addedLines: number;
  readonly deletedLines: number;
}

export interface CausalDiffGroup {
  readonly nodeId: string | null;
  readonly nodeCode: string;
  readonly nodeTitle: string;
  readonly nodeStatus: string;
  readonly phaseLabel: string;
  readonly files: readonly CausalDiffFile[];
}

export interface CausalDiffReport {
  readonly changeId: string;
  readonly changeCode: string;
  readonly gitBranch: string;
  readonly totalFiles: number;
  readonly groups: readonly CausalDiffGroup[];
}

export interface GitReconcileResult {
  readonly checkedRepos: number;
  readonly contestedObservationIds: readonly string[];
  readonly detectedReverts: readonly {
    readonly repoId: string;
    readonly sha: string;
    readonly subject: string;
  }[];
  readonly retainedPitfalls: number;
  readonly checkedAt: string;
}

export interface ReconcileObservationInput {
  readonly resolution: 'adopt_code' | 'keep_rule' | 'retire';
  readonly newStatement?: string;
  readonly note?: string;
}

import {
  dslArray,
  dslBoolean,
  dslChoice,
  dslInteger,
  dslObject,
  dslOptional,
  dslString,
  SchemaError,
  type Schema,
  type Validated,
} from '../core/schema-dsl.ts';
import type {
  ArtifactRef,
  CodebaseProbeReport,
  ExecutionMode,
  MemoryAuthorityTier,
  MemoryFactKind,
  MemoryRecallHit,
  PrdDocument,
} from '../shared/v3-types.ts';

export const ROLES_DEFAULT = [
  'product',
  'architecture',
  'development',
  'design',
  'quality',
] as const;

export type HamaRole = (typeof ROLES_DEFAULT)[number];

export const EVAL_DIMENSIONS = [
  'value',
  'feasibility',
  'completeness',
  'risk',
] as const;

export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];

export type HamaStageName =
  | 'intake'
  | 'dependencies'
  | 'agenda'
  | 'discuss'
  | 'integrate'
  | 'evaluate'
  | 'approval'
  | 'conditions'
  | 'prd'
  | 'confirmation'
  | 'baselined'
  | 'blocked';

export const acceptanceDraftSchema = dslObject({
  key: dslString(80, 1),
  given: dslString(500, 1),
  when: dslString(500, 1),
  then: dslString(500, 1),
});

export const rawItemSchema = dslObject({
  id: dslString(60, 1),
  title: dslString(200, 1),
  detail: dslString(1000, 1),
  priority: dslChoice('must', 'should', 'could'),
  sourceRef: dslString(160, 1),
});

export const evidenceEntrySchema = dslObject({
  kind: dslChoice(
    'user_fact',
    'document_fact',
    'agent_inference',
    'assumption',
  ),
  claim: dslString(600, 1),
  sourceRef: dslString(160, 1),
});

export const intakeQuestionSchema = dslObject({
  question: dslString(400, 1),
  critical: dslBoolean,
});

export const intakeSchema = dslObject({
  summary: dslString(1200, 1),
  scenarios: dslArray(dslString(400, 1), 1, 12),
  goals: dslArray(dslString(400, 1), 1, 12),
  rawItems: dslArray(rawItemSchema, 1, 24),
  evidence: dslArray(evidenceEntrySchema, 0, 24),
  questions: dslArray(intakeQuestionSchema, 0, 12),
  ambiguities: dslArray(dslString(400, 1), 0, 12),
  risks: dslArray(dslString(400, 1), 0, 12),
  blockingQuestions: dslArray(dslString(400, 1), 0, 8),
});

export type IntakeArtifactData = Validated<typeof intakeSchema>;

export const dependencyEdgeSchema = dslObject({
  from: dslString(80, 1),
  to: dslString(80, 1),
  kind: dslChoice('depends_on', 'prerequisite', 'conflict', 'refines'),
  reason: dslString(400, 1),
});

export const dependencySchema = dslObject({
  edges: dslArray(dependencyEdgeSchema, 0, 48),
});

export type DependencyEdgeData = Validated<typeof dependencyEdgeSchema>;
export type DependencyArtifactData = Validated<typeof dependencySchema>;

export const issueDraftSchema = dslObject(
  {
    id: dslString(60, 1),
    title: dslString(200, 1),
    scopeKey: dslString(120, 1),
    summary: dslString(800, 1),
    priority: dslChoice('must', 'should', 'could'),
    itemIds: dslArray(dslString(60, 1), 1, 24),
    ownerRole: dslChoice(...ROLES_DEFAULT),
    openQuestions: dslArray(dslString(400, 1), 0, 12),
    blockingQuestion: dslOptional(dslString(400, 1)),
  },
  ['blockingQuestion'],
);

export const agendaSchema = dslObject({
  issues: dslArray(issueDraftSchema, 1, 20),
});

export type AgendaArtifactData = Validated<typeof agendaSchema>;

export interface HamaIssueState {
  readonly id: string;
  readonly title: string;
  readonly scopeKey: string;
  readonly summary: string;
  readonly priority: 'must' | 'should' | 'could';
  readonly itemIds: readonly string[];
  readonly ownerRole: HamaRole;
  readonly openQuestions: readonly string[];
  readonly blockingQuestion?: string;
  readonly status: 'open' | 'resolved' | 'blocked';
  readonly resolutionSummary: string;
  readonly round: number;
  readonly rejectedOptions: readonly string[];
}

export interface HamaBoardData {
  readonly issues: readonly HamaIssueState[];
  readonly edges: readonly DependencyEdgeData[];
}

export const proposalDraftSchema = dslObject({
  issueId: dslString(60, 1),
  summary: dslString(1000, 1),
  approach: dslArray(dslString(400, 1), 1, 12),
  acceptanceCriteria: dslArray(acceptanceDraftSchema, 1, 12),
  tradeoffs: dslArray(dslString(400, 1), 0, 12),
  constraints: dslArray(dslString(400, 1), 0, 12),
  risks: dslArray(dslString(400, 1), 0, 12),
  outOfScope: dslArray(dslString(400, 1), 0, 12),
});

export type ProposalDraftData = Validated<typeof proposalDraftSchema>;

export const critiqueSchema = dslObject({
  issueId: dslString(60, 1),
  role: dslChoice(...ROLES_DEFAULT),
  verdict: dslChoice('agree', 'concern', 'veto'),
  concerns: dslArray(dslString(400, 1), 0, 12),
  suggestedChanges: dslArray(dslString(400, 1), 0, 12),
  newEdges: dslArray(dependencyEdgeSchema, 0, 16),
});

export type CritiqueData = Validated<typeof critiqueSchema>;

export const localConsensusSchema = dslObject(
  {
    issueId: dslString(60, 1),
    resolved: dslBoolean,
    summary: dslString(1000, 1),
    approach: dslArray(dslString(400, 1), 1, 12),
    acceptanceCriteria: dslArray(acceptanceDraftSchema, 1, 12),
    tradeoffs: dslArray(dslString(400, 1), 0, 12),
    constraints: dslArray(dslString(400, 1), 0, 12),
    rejectedOptions: dslArray(dslString(400, 1), 0, 12),
    unresolvedQuestion: dslOptional(dslString(400, 1)),
  },
  ['unresolvedQuestion'],
);

export type LocalConsensusData = Validated<typeof localConsensusSchema>;

export interface DiscussionArtifactData {
  readonly issueId: string;
  readonly round: number;
  readonly proposal: ProposalDraftData;
  readonly critiques: readonly CritiqueData[];
  readonly consensus: LocalConsensusData;
}

export const proposalScopeItemSchema = dslObject(
  {
    scopeKey: dslString(120, 1),
    supersedesScopeKey: dslOptional(dslString(120, 1)),
    kind: dslChoice('functional', 'nonfunctional'),
    title: dslString(200, 1),
    description: dslString(1200, 1),
    value: dslString(600, 1),
    priority: dslChoice('must', 'should', 'could'),
    issueIds: dslArray(dslString(60, 1), 1, 16),
    dependencies: dslArray(dslString(120, 1), 0, 16),
    constraints: dslArray(dslString(400, 1), 0, 16),
    acceptance: dslArray(acceptanceDraftSchema, 1, 12),
  },
  ['supersedesScopeKey'],
);

const rawProposalSchema = dslObject({
  title: dslString(200, 1),
  background: dslString(1500, 1),
  scenarios: dslArray(dslString(400, 1), 1, 12),
  goals: dslArray(dslString(400, 1), 1, 12),
  summary: dslString(1500, 1),
  approach: dslArray(dslString(400, 1), 1, 16),
  outOfScope: dslArray(dslString(400, 1), 0, 16),
  constraints: dslArray(dslString(400, 1), 0, 16),
  businessRules: dslArray(dslString(400, 1), 0, 16),
  externalDependencies: dslArray(dslString(400, 1), 0, 16),
  tradeoffs: dslArray(dslString(400, 1), 0, 16),
  risks: dslArray(dslString(400, 1), 0, 16),
  unresolved: dslArray(dslString(400, 1), 0, 16),
  scopeItems: dslArray(proposalScopeItemSchema, 1, 24),
});

export type ProposalArtifactData = Validated<typeof rawProposalSchema>;

export const proposalSchema: Schema<ProposalArtifactData> = {
  json: rawProposalSchema.json,
  parse(value, path = '$'): ProposalArtifactData {
    const parsed = rawProposalSchema.parse(value, path);
    const seenKeys = new Set<string>();
    for (let i = 0; i < parsed.scopeItems.length; i += 1) {
      const key = parsed.scopeItems[i]!.scopeKey;
      if (seenKeys.has(key)) {
        throw new SchemaError(
          `${path}.scopeItems[${i}].scopeKey: duplicate scopeKey "${key}"`,
        );
      }
      seenKeys.add(key);
    }
    return parsed;
  },
};

export const evalFindingSchema = dslObject(
  {
    severity: dslChoice(
      'veto',
      'blocking',
      'condition',
      'uncertain',
      'informational',
    ),
    message: dslString(500, 1),
    scopeKey: dslOptional(dslString(120, 1)),
    issueIds: dslOptional(dslArray(dslString(60, 1), 0, 16)),
    owner: dslOptional(dslString(120, 1)),
    verification: dslOptional(dslString(400, 1)),
  },
  ['scopeKey', 'issueIds', 'owner', 'verification'],
);

const rawEvaluationSchema = dslObject({
  dimension: dslChoice(...EVAL_DIMENSIONS),
  verdict: dslChoice('pass', 'condition', 'fail', 'uncertain'),
  score: dslInteger(0, 100),
  summary: dslString(1000, 1),
  findings: dslArray(evalFindingSchema, 0, 16),
});

export type EvaluationArtifactData = Validated<typeof rawEvaluationSchema>;

export const evaluationSchema: Schema<EvaluationArtifactData> = {
  json: rawEvaluationSchema.json,
  parse(value, path = '$'): EvaluationArtifactData {
    const parsed = rawEvaluationSchema.parse(value, path);
    for (let i = 0; i < parsed.findings.length; i += 1) {
      const f = parsed.findings[i]!;
      if (f.severity === 'condition' || f.severity === 'uncertain') {
        if (!f.owner || !f.verification) {
          throw new SchemaError(
            `${path}.findings[${i}]: ${f.severity} finding requires non-empty owner and verification`,
          );
        }
      }
    }
    if (parsed.verdict === 'condition' || parsed.verdict === 'uncertain') {
      if (parsed.findings.length === 0) {
        throw new SchemaError(
          `${path}.findings: ${parsed.verdict} verdict requires at least one finding with owner and verification`,
        );
      }
      for (let i = 0; i < parsed.findings.length; i += 1) {
        const f = parsed.findings[i]!;
        if (!f.owner || !f.verification) {
          throw new SchemaError(
            `${path}.findings[${i}]: condition/uncertain finding requires non-empty owner and verification`,
          );
        }
      }
    }
    return parsed;
  },
};

export const prdDraftSchema = dslObject({
  title: dslString(200, 1),
  background: dslString(1500, 1),
  scenarios: dslArray(dslString(400, 1), 1, 12),
  goals: dslArray(dslString(400, 1), 1, 12),
  summary: dslString(1500, 1),
  approach: dslArray(dslString(400, 1), 1, 16),
  outOfScope: dslArray(dslString(400, 1), 0, 16),
  constraints: dslArray(dslString(400, 1), 0, 16),
  businessRules: dslArray(dslString(400, 1), 0, 16),
  externalDependencies: dslArray(dslString(400, 1), 0, 16),
  tradeoffs: dslArray(dslString(400, 1), 0, 16),
  risks: dslArray(dslString(400, 1), 0, 16),
  unresolved: dslArray(dslString(400, 1), 0, 16),
  changes: dslArray(dslString(400, 1), 0, 24),
});

export type PrdDraftData = Validated<typeof prdDraftSchema>;

export interface HamaReportData {
  readonly verdict:
    'pass' | 'conditional_pass' | 'revision_required' | 'escalation';
  readonly conditions: readonly {
    readonly dimension: EvalDimension;
    readonly message: string;
    readonly owner: string;
    readonly verification: string;
  }[];
  readonly evaluations: readonly ArtifactRef<`eval-${EvalDimension}`>[];
  readonly items: readonly EvaluationArtifactData[];
}

export interface HamaReworkData {
  readonly source: 'evaluation' | 'approval' | 'confirmation' | 'comments';
  readonly scope: 'local' | 'proposal';
  readonly reason: string;
  readonly feedback: string;
  readonly targetIssueIds: readonly string[];
  readonly at: string;
}

export interface HamaStartInput {
  readonly title: string;
  readonly rawIntent: string;
  readonly documents: readonly {
    readonly title: string;
    readonly content: string;
  }[];
  readonly parentPrd?: PrdDocument | null;
  readonly codebaseProbe?: CodebaseProbeReport;
}

export interface HamaMemoryBridge {
  recall(input: {
    readonly hubId: string;
    readonly executionMode: ExecutionMode;
    readonly query: string;
    readonly limit?: number;
  }): {readonly hits: readonly MemoryRecallHit[]};
  retain(input: {
    readonly hubId: string;
    readonly missionId?: string | null;
    readonly executionMode: ExecutionMode;
    readonly sourceType: string;
    readonly rawText: string;
    readonly authorityTier?: MemoryAuthorityTier;
    readonly structuredFacts?: readonly {
      readonly kind: MemoryFactKind;
      readonly subjectKey: string;
      readonly claim: string;
      readonly confidence?: number;
      readonly entityNames?: readonly string[];
    }[];
  }): unknown;
}

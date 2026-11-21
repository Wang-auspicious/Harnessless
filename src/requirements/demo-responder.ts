import type {PrdDocument} from '../shared/v3-types.ts';
import type {
  AgendaArtifactData,
  CritiqueData,
  DependencyArtifactData,
  EvalDimension,
  EvaluationArtifactData,
  HamaRole,
  IntakeArtifactData,
  LocalConsensusData,
  PrdDraftData,
  ProposalArtifactData,
  ProposalDraftData,
} from './contracts.ts';

function slugScope(text: string, fallback: string): string {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48);
  return clean || fallback;
}

export class SimulationHamaResponder {
  respondIntake(input: {
    readonly title: string;
    readonly rawIntent: string;
    readonly documents: readonly {
      readonly title: string;
      readonly content: string;
    }[];
    readonly clarification?: string;
  }): IntakeArtifactData {
    const docTitles = input.documents.map(d => d.title).filter(Boolean);
    const primaryScope = slugScope(input.title, 'core.workflow');
    const secScope = `${primaryScope}.security`;
    const docNote =
      docTitles.length > 0
        ? ` Grounded against documents: ${docTitles.join(', ')}.`
        : '';
    const clarifyNote = input.clarification
      ? ` Human clarification applied: ${input.clarification}.`
      : '';
    const simClarify =
      input.rawIntent.includes('[sim:clarify]') && !input.clarification;
    const blockingQuestions = simClarify
      ? ['Clarify primary deployment latency target and failure boundary.']
      : [];
    const questions = simClarify
      ? [
          {
            question:
              'Clarify primary deployment latency target and failure boundary.',
            critical: true,
          },
        ]
      : [];

    const evidence: IntakeArtifactData['evidence'] = [
      {
        kind: 'user_fact',
        claim: input.rawIntent.slice(0, 300) || input.title,
        sourceRef: 'intent',
      },
      ...input.documents.map(d => ({
        kind: 'document_fact' as const,
        claim: d.content.slice(0, 300) || d.title,
        sourceRef: d.title || 'document',
      })),
      {
        kind: 'agent_inference',
        claim: `Security and audit validation boundary inferred for ${secScope}.`,
        sourceRef: 'hama-intake',
      },
    ];

    return {
      summary: `Structured requirements intake for "${input.title}": ${input.rawIntent.slice(0, 240)}.${docNote}${clarifyNote}`,
      scenarios: [
        `Authorized operators execute "${input.title}" end-to-end with verifiable auditability.`,
        'Concurrent operations fail closed on invalid input or policy violations.',
      ],
      goals: [
        `Deliver deterministic specification coverage for "${input.title}".`,
        'Enforce strict authorization, validation, and bounded recovery.',
      ],
      rawItems: [
        {
          id: 'RAW-001',
          title: `${input.title} Core Flow`,
          detail: `${input.rawIntent.slice(0, 400)}${clarifyNote}`,
          priority: 'must',
          sourceRef: docTitles[0] ?? 'intent',
        },
        {
          id: 'RAW-002',
          title: 'Security & Audit Boundary',
          detail: `Enforce fail-closed input validation, permission checks, and traceable evidence under ${secScope}.`,
          priority: 'must',
          sourceRef: docTitles[1] ?? 'security-policy',
        },
      ],
      evidence,
      questions,
      ambiguities:
        simClarify || (input.rawIntent.length < 24 && !input.clarification)
          ? ['Clarify primary deployment latency target and failure policy.']
          : [],
      risks: [
        'Scope creep between core workflow delivery and secondary reporting hooks.',
      ],
      blockingQuestions,
    };
  }

  respondDependencies(intake: IntakeArtifactData): DependencyArtifactData {
    if (intake.rawItems.length < 2) {
      return {edges: []};
    }
    return {
      edges: [
        {
          from: 'ISS-002',
          to: 'ISS-001',
          kind: 'depends_on',
          reason:
            'Core workflow contracts must honor security and audit validation invariants.',
        },
      ],
    };
  }

  respondAgenda(intake: IntakeArtifactData): AgendaArtifactData {
    const usedKeys = new Set<string>();
    const issues = intake.rawItems.map((item, idx) => {
      let scopeKey = slugScope(item.title, `scope.${idx + 1}`);
      if (usedKeys.has(scopeKey)) {
        scopeKey = `${scopeKey}.${idx + 1}`;
      }
      usedKeys.add(scopeKey);
      return {
        id: `ISS-${String(idx + 1).padStart(3, '0')}`,
        title: item.title,
        scopeKey,
        summary: item.detail.slice(0, 500),
        priority: item.priority,
        itemIds: [item.id],
        ownerRole: (idx === 0 ? 'product' : 'architecture') as HamaRole,
        openQuestions:
          idx === 0 ? ['Confirm strict fail-closed error semantics.'] : [],
      };
    });
    return {issues};
  }

  respondPropose(input: {
    readonly issueId: string;
    readonly title: string;
    readonly scopeKey: string;
    readonly summary: string;
  }): ProposalDraftData {
    return {
      issueId: input.issueId,
      summary: `Proposal for ${input.issueId} (${input.title}): ${input.summary.slice(0, 300)}`,
      approach: [
        `Implement typed service contracts and deterministic validation for ${input.scopeKey}.`,
        'Persist hash-linked state transitions before triggering external side effects.',
      ],
      acceptanceCriteria: [
        {
          key: 'happy-path',
          given: `Valid inputs and authorized context exist for ${input.scopeKey}`,
          when: `${input.title} is invoked`,
          then: 'Operation completes deterministically and records verifiable evidence',
        },
        {
          key: 'fail-closed',
          given: `Malformed or unauthorized input reaches ${input.scopeKey}`,
          when: 'Boundary validation executes',
          then: 'Execution rejects cleanly with structured diagnostic error',
        },
      ],
      tradeoffs: [
        'Favor strict schema validation over permissive dynamic coercion.',
      ],
      constraints: ['Zero bypassing of permission checks or baseline hashes.'],
      risks: ['Latency spike if validation invokes synchronous network hops.'],
      outOfScope: ['Unrelated visual UI styling changes.'],
    };
  }

  respondCritique(input: {
    readonly issueId: string;
    readonly role: HamaRole;
    readonly rawIntent?: string;
    readonly feedback?: string;
    readonly round?: number;
    readonly peerIssueIds?: readonly string[];
  }): CritiqueData {
    const triggerConflict =
      (input.rawIntent?.includes('[sim:conflict_edge]') ||
        input.feedback?.includes('[sim:conflict_edge]')) &&
      input.role === 'architecture' &&
      (input.round ?? 1) <= 2 &&
      input.issueId !== 'ISS-001' &&
      (input.peerIssueIds ?? []).includes('ISS-001');

    return {
      issueId: input.issueId,
      role: input.role,
      verdict: input.role === 'quality' ? 'concern' : 'agree',
      concerns:
        input.role === 'quality'
          ? ['Ensure negative error path returns machine-readable error code.']
          : [],
      suggestedChanges:
        input.role === 'quality'
          ? ['Preserve deterministic failure diagnostics on rejected inputs.']
          : [],
      newEdges: triggerConflict
        ? [
            {
              from: input.issueId,
              to: 'ISS-001',
              kind: 'conflict',
              reason:
                'Simulated cross-issue contract conflict detected against peer proposal.',
            },
          ]
        : [],
    };
  }

  respondRefine(input: {
    readonly issueId: string;
    readonly draft: ProposalDraftData;
  }): LocalConsensusData {
    return {
      issueId: input.issueId,
      resolved: true,
      summary: input.draft.summary,
      approach: input.draft.approach,
      acceptanceCriteria: input.draft.acceptanceCriteria,
      tradeoffs: input.draft.tradeoffs,
      constraints: input.draft.constraints,
      rejectedOptions: [
        `Permissive untyped fallback on ${input.issueId} rejected to prevent silent corruption.`,
      ],
    };
  }

  respondIntegrate(input: {
    readonly title: string;
    readonly intake: IntakeArtifactData;
    readonly issues: readonly {
      readonly id: string;
      readonly title: string;
      readonly scopeKey: string;
      readonly priority: 'must' | 'should' | 'could';
      readonly summary: string;
    }[];
    readonly feedback?: string;
    readonly parentPrd?: PrdDocument | null;
  }): ProposalArtifactData {
    const usedScopeKeys = new Set<string>();
    const parentReqs = input.parentPrd?.requirements ?? [];
    const scopeItems = input.issues.map((iss, idx) => {
      let scopeKey = iss.scopeKey;
      if (usedScopeKeys.has(scopeKey)) {
        scopeKey = `${scopeKey}.${idx + 1}`;
      }
      usedScopeKeys.add(scopeKey);
      const parentReq = parentReqs[idx];
      const supersedesScopeKey =
        parentReq && parentReq.scopeKey !== scopeKey
          ? parentReq.scopeKey
          : undefined;
      return {
        scopeKey,
        ...(supersedesScopeKey ? {supersedesScopeKey} : {}),
        kind: (idx === 0 ? 'functional' : 'nonfunctional') as
          'functional' | 'nonfunctional',
        title: iss.title,
        description: `${iss.summary}${input.feedback ? ` [Integrated Feedback: ${input.feedback}]` : ''}`,
        value:
          idx === 0
            ? 'Core user capability with measurable acceptance checks.'
            : 'Operational reliability, security, and auditability boundary.',
        priority: iss.priority,
        issueIds: [iss.id],
        dependencies: idx > 0 ? [input.issues[0]!.scopeKey] : [],
        constraints: ['Strict fail-closed boundary enforcement'],
        acceptance: [
          {
            key: 'verified-behavior',
            given: `Configured environment and approved baseline for ${scopeKey}`,
            when: `${iss.title} executes`,
            then: 'Expected state transition and artifact checks pass cleanly',
          },
          {
            key: 'rejected-invalid',
            given: `Invalid payload targets ${scopeKey}`,
            when: 'Validator evaluates the request',
            then: 'Execution halts cleanly without partial state mutation',
          },
        ],
      };
    });

    return {
      title: `${input.title} Specification Proposal`,
      background: input.intake.summary,
      scenarios: input.intake.scenarios,
      goals: input.intake.goals,
      summary: `${input.intake.summary}${input.feedback ? ` Revised for: ${input.feedback}` : ''}`,
      approach: [
        'Compile requirements into dependency-ordered Twin-Graph phases.',
        'Isolate repo mutations behind Git worktree checkpoints and fail-closed gates.',
      ],
      outOfScope: ['Unrelated visual UI layout rewrites.'],
      constraints: [
        'Deterministic SDD verification without speculative mocks.',
      ],
      businessRules: [
        'Every requirement maps 1:1 to a traceable scopeKey and AC verification rule.',
      ],
      externalDependencies: ['Local Git toolchain and SQLite WAL storage.'],
      tradeoffs: [
        'Upfront schema validation trades minor latency for zero downstream drift.',
      ],
      risks: input.intake.risks,
      unresolved: [],
      scopeItems,
    };
  }

  respondEvaluate(input: {
    readonly dimension: EvalDimension;
    readonly proposal: ProposalArtifactData;
    readonly triggerCondition?: boolean;
    readonly rawIntent?: string;
    readonly feedback?: string;
    readonly reworkCount?: number;
  }): EvaluationArtifactData {
    const reworkCount = input.reworkCount ?? 0;
    const primaryItem = input.proposal.scopeItems[0];
    const primaryScope = primaryItem?.scopeKey ?? 'core';
    const primaryIssues = primaryItem?.issueIds ?? ['ISS-001'];

    const simVeto =
      ((input.rawIntent?.includes('[sim:veto]') && reworkCount === 0) ||
        input.feedback?.includes('[sim:veto]')) &&
      input.dimension === 'feasibility';
    if (simVeto) {
      return {
        dimension: 'feasibility',
        verdict: 'fail',
        score: 35,
        summary: 'Simulated veto: critical security/architecture violation.',
        findings: [
          {
            severity: 'veto',
            message:
              'Simulated veto requires human escalation before proposal approval.',
            scopeKey: primaryScope,
            owner: 'architecture',
            verification: 'Resolve architectural veto constraint',
          },
        ],
      };
    }

    const simBlocking =
      ((input.rawIntent?.includes('[sim:blocking]') && reworkCount === 0) ||
        input.feedback?.includes('[sim:blocking]')) &&
      input.dimension === 'feasibility';
    if (simBlocking) {
      return {
        dimension: 'feasibility',
        verdict: 'fail',
        score: 52,
        summary: 'Simulated blocking feasibility gap requiring Loop B rework.',
        findings: [
          {
            severity: 'blocking',
            message:
              'Simulated blocking finding requires re-discussing primary issue.',
            scopeKey: primaryScope,
            issueIds: primaryIssues,
            owner: 'architecture',
            verification: 'Address blocking feasibility gap via Loop B',
          },
        ],
      };
    }

    const simCondition =
      (input.triggerCondition && input.dimension === 'risk') ||
      ((input.rawIntent?.includes('[sim:conditional]') ||
        input.feedback?.includes('[sim:conditional]')) &&
        input.dimension === 'completeness');
    if (simCondition) {
      return {
        dimension: input.dimension,
        verdict: 'condition',
        score: 84,
        summary:
          'Evaluation audit requires release sign-off on fail-closed rollback.',
        findings: [
          {
            severity: 'condition',
            message: 'Verify checkpoint rollback cleans partial scope edits.',
            scopeKey: primaryScope,
            owner: 'quality',
            verification:
              'Run phase gate verification with dirty worktree check',
          },
        ],
      };
    }

    return {
      dimension: input.dimension,
      verdict: 'pass',
      score: 94,
      summary: `${input.dimension} review verified complete scope and traceability.`,
      findings: [],
    };
  }

  respondPrd(input: {
    readonly proposal: ProposalArtifactData;
    readonly revision: number;
    readonly feedback?: string;
  }): PrdDraftData {
    return {
      title: input.proposal.title,
      background: input.proposal.background,
      scenarios: input.proposal.scenarios,
      goals: input.proposal.goals,
      summary: `${input.proposal.summary}${input.feedback ? ` (Refined: ${input.feedback})` : ''}`,
      approach: input.proposal.approach,
      outOfScope: input.proposal.outOfScope,
      constraints: input.proposal.constraints,
      businessRules: input.proposal.businessRules,
      externalDependencies: input.proposal.externalDependencies,
      tradeoffs: input.proposal.tradeoffs,
      risks: input.proposal.risks,
      unresolved: input.proposal.unresolved,
      changes: [
        `PRD revision ${input.revision} synthesized from approved proposal.`,
      ],
    };
  }
}

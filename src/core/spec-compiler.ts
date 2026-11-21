import type {
  AcceptanceCriterion,
  DomainTermEntry,
  RepositoryEntry,
} from '../shared/types.ts';
import type {
  ApprovedRequirementsBaseline,
  RequirementItem,
} from '../shared/v3-types.ts';
import type {PhaseBlueprint, TaskBlueprint} from './twin-graph.ts';

export interface ChangeBlueprint {
  readonly repoId: string;
  readonly repoName: string;
  readonly dependsOnRepoIds: readonly string[];
  readonly title: string;
  readonly summary: string;
  readonly specMarkdown: string;
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly phases: readonly PhaseBlueprint[];
}

function tokenizeLower(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(t => t.length >= 2);
}

function assignRepoForRequirement(
  req: RequirementItem,
  repos: readonly RepositoryEntry[],
): RepositoryEntry {
  if (repos.length === 1) {
    return repos[0]!;
  }
  const tokens = new Set(
    tokenizeLower(`${req.title} ${req.description} ${req.scopeKey}`),
  );
  let best = repos[0]!;
  let bestScore = -1;
  for (const repo of repos) {
    const repoTokens = tokenizeLower(
      `${repo.name} ${repo.boundedContext} ${repo.contractSummary}`,
    );
    let score = repo.tier === 'infra' && req.kind === 'nonfunctional' ? 1 : 0;
    for (const tok of repoTokens) {
      if (tokens.has(tok)) {
        score += 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = repo;
    }
  }
  return best;
}

function inferFileScopeForRequirement(
  req: RequirementItem,
  idx: number,
): readonly string[] {
  const cleanKey = req.scopeKey
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (req.kind === 'nonfunctional') {
    return [`src/infra/${cleanKey || `nfr-${idx + 1}`}/**`];
  }
  return [`src/features/${cleanKey || `fr-${idx + 1}`}/**`];
}

export function compileBaselineToChangeBlueprints(input: {
  readonly title: string;
  readonly summary: string;
  readonly baseline: ApprovedRequirementsBaseline;
  readonly prdMarkdown: string;
  readonly repos: readonly RepositoryEntry[];
  readonly domainTerms: readonly DomainTermEntry[];
}): readonly ChangeBlueprint[] {
  if (input.repos.length === 0) {
    return [];
  }

  const sortedRepos = [...input.repos].sort((a, b) => {
    if (a.tier !== b.tier) {
      return a.tier === 'infra' ? -1 : 1;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });

  const infraRepoIds = sortedRepos
    .filter(r => r.tier === 'infra')
    .map(r => r.id);
  const reqsByRepo = new Map<string, RequirementItem[]>();
  for (const r of sortedRepos) {
    reqsByRepo.set(r.id, []);
  }

  for (const req of input.baseline.prd.requirements) {
    const owner = assignRepoForRequirement(req, sortedRepos);
    reqsByRepo.get(owner.id)!.push(req);
  }

  const activeRepos = sortedRepos.filter(
    r => (reqsByRepo.get(r.id)?.length ?? 0) > 0,
  );
  const targetRepos = activeRepos.length > 0 ? activeRepos : [sortedRepos[0]!];

  return targetRepos.map((repo, rIdx) => {
    const assignedReqs = reqsByRepo.get(repo.id) ?? [];
    const effectiveReqs =
      assignedReqs.length > 0 ? assignedReqs : input.baseline.prd.requirements;
    const dependsOnRepoIds =
      repo.tier === 'service'
        ? infraRepoIds.filter(id => targetRepos.some(tr => tr.id === id))
        : [];
    if (rIdx > 0 && dependsOnRepoIds.length === 0 && targetRepos.length > 1) {
      const prevInfra = targetRepos.find(
        (tr, idx) => idx < rIdx && tr.tier === 'infra',
      );
      if (prevInfra) {
        dependsOnRepoIds.push(prevInfra.id);
      }
    }

    const functionalReqs = effectiveReqs.filter(r => r.kind === 'functional');
    const nonFunctionalReqs = effectiveReqs.filter(
      r => r.kind === 'nonfunctional',
    );

    const p1Tasks: TaskBlueprint[] = (
      functionalReqs.length > 0 ? functionalReqs : effectiveReqs
    ).map((req, idx) => ({
      code: `1.${idx + 1}`,
      title: req.title,
      description: `${req.description}\nValue: ${req.value}\nAcceptance: ${req.acceptance.map(a => `[${a.id}] Given ${a.given} When ${a.when} Then ${a.then}`).join('; ')}`,
      fileScope: inferFileScopeForRequirement(req, idx),
      dependsOnCodes: req.dependencies
        .map(depId => {
          const depIdx = (
            functionalReqs.length > 0 ? functionalReqs : effectiveReqs
          ).findIndex(candidate => candidate.id === depId);
          return depIdx >= 0 && depIdx < idx ? `1.${depIdx + 1}` : null;
        })
        .filter((x): x is string => x !== null),
      requirementRefs: [req.id],
      acceptanceRefs: req.acceptance.map(a => a.id),
      planningRationale: `Implements ${req.id} (${req.scopeKey}) within isolated file scope.`,
      inputContract: `Locked Baseline ${input.baseline.id} v${input.baseline.revision} (${req.scopeKey})`,
      outputContract: `Verified slice satisfying ${req.acceptance.map(a => a.id).join(', ')}`,
    }));

    const p2Tasks: TaskBlueprint[] =
      nonFunctionalReqs.length > 0
        ? nonFunctionalReqs.map((req, idx) => ({
            code: `2.${idx + 1}`,
            title: req.title,
            description: `${req.description}\nConstraints: ${req.constraints.join('; ') || 'Standard SDD invariants'}`,
            fileScope: inferFileScopeForRequirement(req, idx),
            requirementRefs: [req.id],
            acceptanceRefs: req.acceptance.map(a => a.id),
            planningRationale: `Hardens non-functional requirement ${req.id} after functional slices.`,
            inputContract: 'Completed Phase P1 functional modules',
            outputContract: `Verified NFR compliance for ${req.acceptance.map(a => a.id).join(', ')}`,
          }))
        : [
            {
              code: '2.1',
              title: 'Cross-Slice Integration & SDD Contract Verification',
              description: `Verify end-to-end integration, error handling, and DDD canonical compliance for ${repo.name}.`,
              fileScope: ['src/**'],
              requirementRefs: effectiveReqs.map(r => r.id),
              acceptanceRefs: effectiveReqs.flatMap(r =>
                r.acceptance.map(a => a.id),
              ),
              planningRationale:
                'Final integration and edge-case verification across all functional slices.',
              inputContract: 'Certified Phase P1 task outputs',
              outputContract:
                'Integration-ready branch passing repository hard gates',
            },
          ];

    const phases: PhaseBlueprint[] = [
      {
        code: 'P1',
        title: 'Specification-Driven Core Delivery',
        description: `Deliver functional requirements in ${repo.boundedContext}.`,
        gateCommand: repo.verifyCommand,
        tasks: p1Tasks,
      },
      {
        code: 'P2',
        title: 'Non-Functional Hardening & Integration',
        description:
          'Verify constraints, quality gates, and release readiness.',
        gateCommand: repo.verifyCommand,
        tasks: p2Tasks,
      },
    ];

    const acceptanceCriteria: AcceptanceCriterion[] = effectiveReqs.flatMap(
      req =>
        req.acceptance.map(ac => ({
          id: ac.id,
          statement: `[${req.id}] Given ${ac.given}, When ${ac.when}, Then ${ac.then}`,
          checkCommand: repo.verifyCommand || undefined,
          certified: false,
        })),
    );

    const relevantTerms = input.domainTerms.filter(
      t =>
        t.owningRepoIds.length === 0 ||
        t.owningRepoIds.includes(repo.id) ||
        t.boundedContext === repo.boundedContext,
    );

    const specMarkdown = [
      input.prdMarkdown,
      '',
      `## Repository Target: ${repo.name} (${repo.boundedContext})`,
      relevantTerms.length > 0
        ? `Canonical Terms: ${relevantTerms.map(t => t.canonicalTerm).join(', ')}`
        : 'Canonical Terms: None registered',
    ].join('\n');

    return {
      repoId: repo.id,
      repoName: repo.name,
      dependsOnRepoIds,
      title:
        targetRepos.length > 1 ? `${input.title} [${repo.name}]` : input.title,
      summary: input.summary,
      specMarkdown,
      acceptanceCriteria,
      phases,
    };
  });
}

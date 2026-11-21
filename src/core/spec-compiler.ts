import type {
  AcceptanceCriterion,
  DomainTermEntry,
  RepositoryEntry,
} from '../shared/types.ts';
import type {
  ApprovedRequirementsBaseline,
  RequirementItem,
} from '../shared/v3-types.ts';
import {sha256Text} from './canonical-json.ts';
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
    if (
      score > bestScore ||
      (score === bestScore &&
        score === 0 &&
        req.kind === 'functional' &&
        best.tier !== 'service' &&
        repo.tier === 'service')
    ) {
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
  const hashSuffix = sha256Text(req.scopeKey).slice(0, 6);
  const slug = cleanKey
    ? `${cleanKey}-${hashSuffix}`
    : `${req.kind === 'nonfunctional' ? 'nfr' : 'fr'}-${idx + 1}-${hashSuffix}`;
  if (req.kind === 'nonfunctional') {
    return [`src/infra/${slug}/**`];
  }
  return [`src/features/${slug}/**`];
}

function topoSortRequirements(
  reqs: readonly RequirementItem[],
): RequirementItem[] {
  if (reqs.length <= 1) {
    return [...reqs];
  }
  const keyToIdx = new Map<string, number>();
  reqs.forEach((req, idx) => {
    keyToIdx.set(req.id, idx);
    keyToIdx.set(req.scopeKey, idx);
  });

  const inDegree = new Array<number>(reqs.length).fill(0);
  const adj: Array<Set<number>> = Array.from(
    {length: reqs.length},
    () => new Set<number>(),
  );
  reqs.forEach((req, idx) => {
    for (const depRef of req.dependencies) {
      const depIdx = keyToIdx.get(depRef);
      if (depIdx !== undefined && depIdx !== idx && !adj[depIdx]!.has(idx)) {
        adj[depIdx]!.add(idx);
        inDegree[idx] = (inDegree[idx] ?? 0) + 1;
      }
    }
  });

  const visited = new Array<boolean>(reqs.length).fill(false);
  const sorted: RequirementItem[] = [];
  while (sorted.length < reqs.length) {
    let pick = -1;
    for (let i = 0; i < reqs.length; i += 1) {
      if (!visited[i] && inDegree[i] === 0) {
        pick = i;
        break;
      }
    }
    if (pick === -1) {
      // Stable cycle-break fallback preserves input order.
      for (let i = 0; i < reqs.length; i += 1) {
        if (!visited[i]) {
          pick = i;
          break;
        }
      }
    }
    visited[pick] = true;
    sorted.push(reqs[pick]!);
    for (const nxt of adj[pick]!) {
      inDegree[nxt] = Math.max(0, inDegree[nxt]! - 1);
    }
  }
  return sorted;
}

function resolveDepCodes(
  req: RequirementItem,
  idx: number,
  pool: readonly RequirementItem[],
  prefix: '1' | '2',
): string[] {
  const codes = new Set<string>();
  for (const depRef of req.dependencies) {
    const depIdx = pool.findIndex(
      candidate => candidate.id === depRef || candidate.scopeKey === depRef,
    );
    if (depIdx >= 0 && depIdx !== idx) {
      codes.add(`${prefix}.${depIdx + 1}`);
    }
  }
  return [...codes];
}

function topoSortBlueprints(
  blueprints: readonly ChangeBlueprint[],
): ChangeBlueprint[] {
  if (blueprints.length <= 1) {
    return [...blueprints];
  }
  const idToIdx = new Map(blueprints.map((bp, i) => [bp.repoId, i]));
  const inDegree = new Array<number>(blueprints.length).fill(0);
  const adj: Array<Set<number>> = Array.from(
    {length: blueprints.length},
    () => new Set<number>(),
  );
  blueprints.forEach((bp, idx) => {
    for (const depRepoId of bp.dependsOnRepoIds) {
      const depIdx = idToIdx.get(depRepoId);
      if (depIdx !== undefined && depIdx !== idx && !adj[depIdx]!.has(idx)) {
        adj[depIdx]!.add(idx);
        inDegree[idx] = (inDegree[idx] ?? 0) + 1;
      }
    }
  });

  const visited = new Array<boolean>(blueprints.length).fill(false);
  const sorted: ChangeBlueprint[] = [];
  while (sorted.length < blueprints.length) {
    let pick = -1;
    for (let i = 0; i < blueprints.length; i += 1) {
      if (!visited[i] && inDegree[i] === 0) {
        pick = i;
        break;
      }
    }
    if (pick === -1) {
      for (let i = 0; i < blueprints.length; i += 1) {
        if (!visited[i]) {
          pick = i;
          break;
        }
      }
    }
    visited[pick] = true;
    sorted.push(blueprints[pick]!);
    for (const nxt of adj[pick]!) {
      inDegree[nxt] = Math.max(0, inDegree[nxt]! - 1);
    }
  }
  return sorted;
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
  const reqOwnerRepo = new Map<string, string>();
  for (const r of sortedRepos) {
    reqsByRepo.set(r.id, []);
  }

  for (const req of input.baseline.prd.requirements) {
    const owner = assignRepoForRequirement(req, sortedRepos);
    reqsByRepo.get(owner.id)!.push(req);
    reqOwnerRepo.set(req.id, owner.id);
    reqOwnerRepo.set(req.scopeKey, owner.id);
  }

  const activeRepos = sortedRepos.filter(
    r => (reqsByRepo.get(r.id)?.length ?? 0) > 0,
  );
  const targetRepos = activeRepos.length > 0 ? activeRepos : [sortedRepos[0]!];
  const targetRepoIdSet = new Set(targetRepos.map(r => r.id));

  const blueprints = targetRepos.map((repo, rIdx) => {
    const assignedReqs = reqsByRepo.get(repo.id) ?? [];
    const effectiveReqs = topoSortRequirements(
      assignedReqs.length > 0 ? assignedReqs : input.baseline.prd.requirements,
    );
    const depRepoSet = new Set<string>();
    if (repo.tier === 'service') {
      for (const id of infraRepoIds) {
        if (id !== repo.id && targetRepoIdSet.has(id)) {
          depRepoSet.add(id);
        }
      }
    }
    if (rIdx > 0 && depRepoSet.size === 0 && targetRepos.length > 1) {
      const prevInfra = targetRepos.find(
        (tr, idx) => idx < rIdx && tr.tier === 'infra',
      );
      if (prevInfra) {
        depRepoSet.add(prevInfra.id);
      }
    }
    for (const req of effectiveReqs) {
      for (const depRef of req.dependencies) {
        const ownerRepoId = reqOwnerRepo.get(depRef);
        if (
          ownerRepoId &&
          ownerRepoId !== repo.id &&
          targetRepoIdSet.has(ownerRepoId)
        ) {
          depRepoSet.add(ownerRepoId);
        }
      }
    }
    const dependsOnRepoIds = [...depRepoSet];

    const functionalReqs = effectiveReqs.filter(r => r.kind === 'functional');
    const nonFunctionalReqs = effectiveReqs.filter(
      r => r.kind === 'nonfunctional',
    );

    const p1Tasks: TaskBlueprint[] =
      functionalReqs.length > 0
        ? functionalReqs.map((req, idx) => ({
            code: `1.${idx + 1}`,
            title: req.title,
            description: `${req.description}\nValue: ${req.value}\nAcceptance: ${req.acceptance.map(a => `[${a.id}] Given ${a.given} When ${a.when} Then ${a.then}`).join('; ')}`,
            fileScope: inferFileScopeForRequirement(req, idx),
            dependsOnCodes: resolveDepCodes(req, idx, functionalReqs, '1'),
            requirementRefs: [req.id],
            acceptanceRefs: req.acceptance.map(a => a.id),
            planningRationale: `Implements ${req.id} (${req.scopeKey}) within isolated file scope.`,
            inputContract: `Locked Baseline ${input.baseline.id} v${input.baseline.revision} (${req.scopeKey})`,
            outputContract: `Verified slice satisfying ${req.acceptance.map(a => a.id).join(', ')}`,
          }))
        : [
            {
              code: '1.1',
              title: 'Contract & Architecture Alignment',
              description: `Align shared contracts, interfaces, and baseline invariants in ${repo.name} before non-functional hardening.`,
              fileScope: ['src/**'],
              dependsOnCodes: [],
              requirementRefs: nonFunctionalReqs.map(r => r.id),
              acceptanceRefs: [],
              planningRationale:
                'Prepares contract boundaries for non-functional hardening in Phase P2 without duplicating NFR slices.',
              inputContract: `Locked Baseline ${input.baseline.id} v${input.baseline.revision}`,
              outputContract:
                'Aligned module boundaries ready for Phase P2 NFR enforcement',
            },
          ];

    const p2Tasks: TaskBlueprint[] =
      nonFunctionalReqs.length > 0
        ? nonFunctionalReqs.map((req, idx) => ({
            code: `2.${idx + 1}`,
            title: req.title,
            description: `${req.description}\nConstraints: ${req.constraints.join('; ') || 'Standard SDD invariants'}`,
            fileScope: inferFileScopeForRequirement(req, idx),
            dependsOnCodes: resolveDepCodes(req, idx, nonFunctionalReqs, '2'),
            requirementRefs: [req.id],
            acceptanceRefs: req.acceptance.map(a => a.id),
            planningRationale: `Hardens non-functional requirement ${req.id} after functional slices.`,
            inputContract: 'Completed Phase P1 modules',
            outputContract: `Verified NFR compliance for ${req.acceptance.map(a => a.id).join(', ')}`,
          }))
        : [
            {
              code: '2.1',
              title: 'Cross-Slice Integration & SDD Contract Verification',
              description: `Verify end-to-end integration, error handling, and DDD canonical compliance for ${repo.name}.`,
              fileScope: ['src/**'],
              dependsOnCodes: [],
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

  return topoSortBlueprints(blueprints);
}

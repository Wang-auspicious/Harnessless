import type {ChangeRecord, GraphNode} from '../shared/types.ts';
import type {
  ApprovedRequirementsBaseline,
  BaselineImpactReport,
  RequirementItem,
} from '../shared/v3-types.ts';
import {sha256Canonical} from './canonical-json.ts';

function signatureOfRequirement(req: RequirementItem): string {
  return sha256Canonical({
    kind: req.kind,
    title: req.title,
    description: req.description,
    priority: req.priority,
    constraints: req.constraints,
    acceptance: req.acceptance.map(a => ({
      key: a.key,
      given: a.given,
      when: a.when,
      then: a.then,
    })),
  });
}

function tokenJaccard(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/)
        .filter(Boolean),
    );
  const setA = tok(a);
  const setB = tok(b);
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) {
      inter += 1;
    }
  }
  return inter / (setA.size + setB.size - inter);
}

export function analyzeBaselineImpact(input: {
  readonly parentBaseline: ApprovedRequirementsBaseline;
  readonly nextBaseline: ApprovedRequirementsBaseline;
  readonly activeChanges: readonly ChangeRecord[];
  readonly nodesByChangeId: ReadonlyMap<string, readonly GraphNode[]>;
}): BaselineImpactReport {
  const prevMap = new Map(
    input.parentBaseline.prd.requirements.map(r => [r.scopeKey, r]),
  );
  const nextMap = new Map(
    input.nextBaseline.prd.requirements.map(r => [r.scopeKey, r]),
  );

  const addedScopeKeys: string[] = [];
  const modifiedScopeKeys: string[] = [];
  const unchangedScopeKeys: string[] = [];
  const renamedFromSet = new Set<string>();
  const renamedScopeCandidates: Array<{
    readonly fromScopeKey: string;
    readonly toScopeKey: string;
    readonly similarity: number;
  }> = [];

  for (const [scopeKey, nextReq] of nextMap.entries()) {
    if (nextReq.supersedesScopeKey && prevMap.has(nextReq.supersedesScopeKey)) {
      renamedScopeCandidates.push({
        fromScopeKey: nextReq.supersedesScopeKey,
        toScopeKey: scopeKey,
        similarity: 1,
      });
      renamedFromSet.add(nextReq.supersedesScopeKey);
      modifiedScopeKeys.push(scopeKey);
      continue;
    }
    const prevReq = prevMap.get(scopeKey);
    if (!prevReq) {
      addedScopeKeys.push(scopeKey);
    } else if (
      signatureOfRequirement(prevReq) !== signatureOfRequirement(nextReq)
    ) {
      modifiedScopeKeys.push(scopeKey);
    } else {
      unchangedScopeKeys.push(scopeKey);
    }
  }

  const removedScopeKeys = [...prevMap.keys()].filter(
    key => !nextMap.has(key) && !renamedFromSet.has(key),
  );

  const rawRenamePairs: Array<{
    readonly fromScopeKey: string;
    readonly toScopeKey: string;
    readonly similarity: number;
  }> = [];
  for (const addedKey of addedScopeKeys) {
    const addedReq = nextMap.get(addedKey)!;
    for (const removedKey of removedScopeKeys) {
      const removedReq = prevMap.get(removedKey)!;
      const sim = tokenJaccard(
        `${addedReq.title} ${addedReq.description}`,
        `${removedReq.title} ${removedReq.description}`,
      );
      if (sim >= 0.45) {
        rawRenamePairs.push({
          fromScopeKey: removedKey,
          toScopeKey: addedKey,
          similarity: Number(sim.toFixed(3)),
        });
      }
    }
  }
  rawRenamePairs.sort((a, b) => {
    if (b.similarity !== a.similarity) {
      return b.similarity - a.similarity;
    }
    const fromCmp = a.fromScopeKey.localeCompare(b.fromScopeKey);
    return fromCmp !== 0 ? fromCmp : a.toScopeKey.localeCompare(b.toScopeKey);
  });
  const matchedFrom = new Set<string>();
  const matchedTo = new Set<string>();
  for (const pair of rawRenamePairs) {
    if (matchedFrom.has(pair.fromScopeKey) || matchedTo.has(pair.toScopeKey)) {
      continue;
    }
    matchedFrom.add(pair.fromScopeKey);
    matchedTo.add(pair.toScopeKey);
    renamedScopeCandidates.push(pair);
  }

  const impactedReqIds = new Set<string>();
  for (const key of [...modifiedScopeKeys, ...removedScopeKeys]) {
    const prevReq = prevMap.get(key);
    if (prevReq) {
      impactedReqIds.add(prevReq.id);
    }
  }
  for (const cand of renamedScopeCandidates) {
    const prevReq = prevMap.get(cand.fromScopeKey);
    if (prevReq) {
      impactedReqIds.add(prevReq.id);
    }
  }

  const impactedChanges = input.activeChanges.map(chg => {
    const nodes = input.nodesByChangeId.get(chg.id) ?? [];
    const affectedNodeIds: string[] = [];
    const preservedCertifiedNodeIds: string[] = [];

    for (const n of nodes) {
      if (n.kind !== 'task' && n.kind !== 'ghost') {
        continue;
      }
      const refs = n.requirementRefs ?? [];
      const isAffected = refs.some(ref => impactedReqIds.has(ref));
      if (isAffected) {
        affectedNodeIds.push(n.id);
      } else if (n.status === 'certified') {
        preservedCertifiedNodeIds.push(n.id);
      }
    }

    return {
      changeId: chg.id,
      changeCode: chg.code,
      affectedNodeIds,
      preservedCertifiedNodeIds,
      recommendation:
        chg.status === 'certified' ||
        affectedNodeIds.length > preservedCertifiedNodeIds.length
          ? ('spawn_successor_change' as const)
          : ('patch_active_change' as const),
    };
  });

  return {
    parentBaselineId: input.parentBaseline.id,
    nextBaselineId: input.nextBaseline.id,
    addedScopeKeys,
    removedScopeKeys,
    modifiedScopeKeys,
    renamedScopeCandidates,
    unchangedScopeKeys,
    impactedChanges,
  };
}

import {randomUUID} from 'node:crypto';
import type {
  AdapterOperationalProfile,
  ChangeRecord,
  DomainTermEntry,
  GraphEdge,
  GraphNode,
} from '../shared/types.ts';
import type {
  ApprovedRequirementsBaseline,
  IntentPresetId,
  ValidationIssue,
  ValidationReport,
} from '../shared/v3-types.ts';
import {detectTerminologyDrift} from './ddd.ts';
import {scopesOverlap} from './glob-scope.ts';
import {hasForwardCycle} from './twin-graph.ts';

function makeIssue(
  level: ValidationIssue['level'],
  category: ValidationIssue['category'],
  message: string,
  suggestion: string,
  changeCode: string | null = null,
  nodeCode: string | null = null,
  requirementId: string | null = null,
): ValidationIssue {
  return {
    id: `val-${randomUUID().slice(0, 8)}`,
    level,
    category,
    changeCode,
    nodeCode,
    requirementId,
    message,
    suggestion,
  };
}

function hasCrossChangeCycle(changes: readonly ChangeRecord[]): boolean {
  const byId = new Set(changes.map(c => c.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const c of changes) {
    inDegree.set(c.id, 0);
    adj.set(c.id, []);
  }
  for (const c of changes) {
    for (const depId of c.dependsOnChangeIds ?? []) {
      if (!byId.has(depId)) {
        continue;
      }
      adj.get(depId)!.push(c.id);
      inDegree.set(c.id, (inDegree.get(c.id) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
    }
  }
  let visited = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    visited += 1;
    for (const v of adj.get(u) ?? []) {
      const next = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, next);
      if (next === 0) {
        queue.push(v);
      }
    }
  }
  return visited !== changes.length;
}

export function validateCompiledMissionPlan(input: {
  readonly preset: IntentPresetId;
  readonly baseline: ApprovedRequirementsBaseline | null;
  readonly changes: readonly ChangeRecord[];
  readonly nodesByChangeId: ReadonlyMap<string, readonly GraphNode[]>;
  readonly edgesByChangeId: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly adapters: readonly AdapterOperationalProfile[];
  readonly domainTerms: readonly DomainTermEntry[];
}): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (input.changes.length === 0) {
    issues.push(
      makeIssue(
        'error',
        'structure',
        'Mission plan contains zero compiled repository Changes.',
        'Bind at least one repository to compile executable Twin-Graphs.',
      ),
    );
  }

  if (hasCrossChangeCycle(input.changes)) {
    issues.push(
      makeIssue(
        'error',
        'structure',
        'Cross-repository Change dependencies contain a directed cycle.',
        'Break cyclic dependsOnChangeIds across upstream/downstream repositories.',
      ),
    );
  }

  const adapterMap = new Map(input.adapters.map(a => [a.manifest.id, a]));
  const coveredReqs = new Set<string>();
  const coveredAcs = new Set<string>();

  for (const chg of input.changes) {
    const nodes = input.nodesByChangeId.get(chg.id) ?? [];
    const edges = input.edgesByChangeId.get(chg.id) ?? [];
    const execNodes = nodes.filter(n => n.kind !== 'phase_container');

    if (hasForwardCycle(nodes, edges)) {
      issues.push(
        makeIssue(
          'error',
          'structure',
          `Change ${chg.code} forward Twin-Graph contains a dependency cycle.`,
          'Remove cyclic task or logic edges.',
          chg.code,
        ),
      );
    }

    const startNode = execNodes.find(n => n.kind === 'start');
    const endNode = execNodes.find(n => n.kind === 'end');
    if (!startNode || !endNode) {
      issues.push(
        makeIssue(
          'error',
          'structure',
          `Change ${chg.code} is missing START or END anchor node.`,
          'Recompile Twin-Graph from blueprint.',
          chg.code,
        ),
      );
    } else {
      const fwdAdj = new Map<string, string[]>();
      for (const n of nodes) {
        fwdAdj.set(n.id, []);
      }
      for (const e of edges) {
        if (e.kind !== 'fail') {
          fwdAdj.get(e.sourceNodeId)?.push(e.targetNodeId);
        }
      }
      const reachable = new Set<string>([startNode.id]);
      const queue = [startNode.id];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const nxt of fwdAdj.get(curr) ?? []) {
          if (!reachable.has(nxt)) {
            reachable.add(nxt);
            queue.push(nxt);
          }
        }
        const currNode = nodes.find(n => n.id === curr);
        if (currNode?.kind === 'phase_container') {
          for (const child of nodes.filter(
            c => c.containerNodeId === currNode.id,
          )) {
            if (!reachable.has(child.id)) {
              reachable.add(child.id);
              queue.push(child.id);
            }
          }
        }
      }
      if (!reachable.has(endNode.id)) {
        issues.push(
          makeIssue(
            'error',
            'structure',
            `Change ${chg.code} END node is unreachable from START.`,
            'Connect phase checkpoints to END.',
            chg.code,
            endNode.code,
          ),
        );
      }

      for (const node of execNodes) {
        if (node.kind === 'restore' || node.id === endNode.id) {
          continue;
        }
        if (!reachable.has(node.id)) {
          issues.push(
            makeIssue(
              'error',
              'structure',
              `Orphan node ${chg.code}/${node.code} (${node.kind}) is unreachable from START.`,
              'Connect all executable Twin-Graph nodes to the START reachability DAG.',
              chg.code,
              node.code,
            ),
          );
        }
      }
    }

    if (input.preset === 'strict_audit') {
      if (chg.permissionTier !== 'strict') {
        issues.push(
          makeIssue(
            'error',
            'policy',
            `Change ${chg.code} uses permissionTier "${chg.permissionTier}" under strict_audit preset; expected "strict".`,
            'Set Change permissionTier to "strict" for strict_audit missions.',
            chg.code,
          ),
        );
      }
      const requiredKinds: ReadonlyArray<GraphNode['kind']> = [
        'gates',
        'audit_jqa',
        'audit_sqa',
        'decision',
      ];
      for (const reqKind of requiredKinds) {
        if (!execNodes.some(n => n.kind === reqKind)) {
          issues.push(
            makeIssue(
              'error',
              'policy',
              `Change ${chg.code} is missing required "${reqKind}" gate node under strict_audit preset.`,
              `Include ${reqKind} verification gates in every strict_audit Twin-Graph.`,
              chg.code,
            ),
          );
        }
      }
      for (const gateNode of execNodes.filter(n => n.kind === 'gates')) {
        if (!(gateNode.gateCommand ?? '').trim()) {
          issues.push(
            makeIssue(
              'error',
              'policy',
              `Hard gate ${chg.code}/${gateNode.code} has empty gateCommand under strict_audit preset.`,
              'Configure a deterministic repository verification command.',
              chg.code,
              gateNode.code,
            ),
          );
        }
      }
    }

    // Check DDD terminology drift in Change specification
    const specDrift = detectTerminologyDrift(
      chg.specMarkdown,
      input.domainTerms,
    );
    for (const d of specDrift) {
      issues.push(
        makeIssue(
          'error',
          'ddd',
          `Change ${chg.code} spec uses forbidden alias "${d.forbiddenAlias}" (line ${d.lineNumber}).`,
          `Replace with canonical DDD term "${d.canonicalTerm}" (${d.boundedContext}).`,
          chg.code,
        ),
      );
    }

    for (const node of nodes) {
      if (
        !Number.isInteger(node.maxAttempts) ||
        node.maxAttempts < 1 ||
        node.maxAttempts > 20
      ) {
        issues.push(
          makeIssue(
            'error',
            'policy',
            `Node ${chg.code}/${node.code} has invalid maxAttempts (${node.maxAttempts}); expected integer 1..20.`,
            'Set node maxAttempts between 1 and 20.',
            chg.code,
            node.code,
          ),
        );
      }
    }

    // L2 & L3 node checks
    for (const node of execNodes) {
      for (const ref of node.requirementRefs ?? []) {
        coveredReqs.add(ref);
      }
      for (const ac of node.acceptanceRefs ?? []) {
        coveredAcs.add(ac);
      }

      if (node.kind === 'task') {
        if (
          !(node.planningRationale ?? '').trim() ||
          !(node.inputContract ?? '').trim() ||
          !(node.outputContract ?? '').trim()
        ) {
          issues.push(
            makeIssue(
              'warning',
              'contract',
              `Task ${chg.code}/${node.code} is missing planningRationale or I/O contract.`,
              'Attach explicit inputContract, outputContract, and planningRationale.',
              chg.code,
              node.code,
            ),
          );
        }
      }

      if (node.assignedAdapterId) {
        const profile = adapterMap.get(node.assignedAdapterId);
        if (!profile) {
          issues.push(
            makeIssue(
              'error',
              'capability',
              `Node ${chg.code}/${node.code} references unknown adapter "${node.assignedAdapterId}".`,
              'Assign a registered adapter from Agents Market.',
              chg.code,
              node.code,
            ),
          );
        } else if (profile.health === 'circuit_open') {
          issues.push(
            makeIssue(
              'error',
              'capability',
              `Adapter "${profile.manifest.label}" on ${chg.code}/${node.code} has OPEN circuit breaker.`,
              'Run Environment Doctor or switch to a healthy adapter.',
              chg.code,
              node.code,
            ),
          );
        }
      }
    }

    // L3: Check overlapping fileScopes among sibling tasks inside same phase container
    const phaseContainers = nodes.filter(n => n.kind === 'phase_container');
    for (const container of phaseContainers) {
      const tasks = nodes.filter(
        n => n.containerNodeId === container.id && n.kind === 'task',
      );
      for (let i = 0; i < tasks.length; i += 1) {
        for (let j = i + 1; j < tasks.length; j += 1) {
          const tA = tasks[i]!;
          const tB = tasks[j]!;
          const depAB = edges.some(
            e =>
              e.kind !== 'fail' &&
              ((e.sourceNodeId === tA.id && e.targetNodeId === tB.id) ||
                (e.sourceNodeId === tB.id && e.targetNodeId === tA.id)),
          );
          if (!depAB && scopesOverlap(tA.fileScope, tB.fileScope)) {
            issues.push(
              makeIssue(
                'warning',
                'policy',
                `Parallelizable tasks ${tA.code} and ${tB.code} in ${chg.code} have overlapping fileScope; scheduler will serialize them.`,
                'Narrow task fileScope globs for full parallelism.',
                chg.code,
                tA.code,
              ),
            );
          }
        }
      }
    }
  }

  // L2: Baseline FR/AC coverage
  if (input.baseline) {
    for (const req of input.baseline.prd.requirements) {
      if (!coveredReqs.has(req.id)) {
        issues.push(
          makeIssue(
            req.priority === 'must' ? 'error' : 'warning',
            'spec_coverage',
            `Requirement ${req.id} ("${req.title}") is not mapped to any Task node.`,
            `Ensure a compiled Task references ${req.id} in requirementRefs.`,
            null,
            null,
            req.id,
          ),
        );
      }
      for (const ac of req.acceptance) {
        if (!coveredAcs.has(ac.id)) {
          issues.push(
            makeIssue(
              req.priority === 'must' ? 'error' : 'warning',
              'spec_coverage',
              `Acceptance criterion ${ac.id} (${req.id}) is uncovered by any Task.`,
              `Map ${ac.id} to an executable Task's acceptanceRefs.`,
              null,
              null,
              req.id,
            ),
          );
        }
      }
    }
  }

  const errorCount = issues.filter(i => i.level === 'error').length;
  const warningCount = issues.filter(i => i.level === 'warning').length;
  const infoCount = issues.filter(i => i.level === 'info').length;

  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

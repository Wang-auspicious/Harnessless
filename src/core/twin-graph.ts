/**
 * Pure Twin-Graph compiler, branch-isolated rewind reachability, and GhostNode
 * dynamic DAG amendment engine. Zero I/O dependencies.
 */

import {randomUUID} from 'node:crypto';
import {ForgeError} from '../shared/errors.ts';
import type {
  ChangeTeamConfig,
  EdgeKind,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
} from '../shared/types.ts';

export interface TaskBlueprint {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly fileScope?: readonly string[];
  readonly dependsOnCodes?: readonly string[];
}

export interface PhaseBlueprint {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly gateCommand?: string;
  readonly tasks: readonly TaskBlueprint[];
}

export interface CompiledTwinGraph {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
}

function makeNode(
  partial: Omit<
    GraphNode,
    | 'attemptCount'
    | 'collapsed'
    | 'outputSummary'
    | 'restoreTargetCheckpointId'
    | 'fileScope'
    | 'gateCommand'
  > & {
    fileScope?: readonly string[];
    gateCommand?: string | null;
    restoreTargetCheckpointId?: string | null;
  },
): GraphNode {
  return {
    ...partial,
    fileScope: partial.fileScope ?? [],
    gateCommand: partial.gateCommand ?? null,
    attemptCount: 0,
    collapsed: false,
    outputSummary: '',
    restoreTargetCheckpointId: partial.restoreTargetCheckpointId ?? null,
  };
}

function makeEdge(
  changeId: string,
  sourceNodeId: string,
  targetNodeId: string,
  kind: EdgeKind,
  label = '',
): GraphEdge {
  return {
    id: `edge-${randomUUID().slice(0, 12)}`,
    changeId,
    sourceNodeId,
    targetNodeId,
    kind,
    label,
  };
}

/**
 * Compiles hierarchical WBS phases into a synchronized Twin Graph with
 * collapsible PhaseContainer nodes, nested Task cards, deterministic Gates,
 * dual-level QA audits, and Decision -> Restore -> Checkpoint topology.
 */
export function compileTwinGraph(
  changeId: string,
  phases: readonly PhaseBlueprint[],
  defaultVerifyCommand: string,
  team: ChangeTeamConfig,
  nowIso: string,
): CompiledTwinGraph {
  if (phases.length === 0) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      'Twin Graph requires at least one phase blueprint',
    );
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let cursorY = 40;

  const startNode = makeNode({
    id: `node-${changeId}-start`,
    changeId,
    code: 'START',
    parentWbsId: null,
    containerNodeId: null,
    kind: 'start',
    title: 'Start Change',
    description: 'Initialize isolated git worktree and baseline mandate.',
    assignedRole: 'lead',
    assignedAdapterId: team.leadAdapterId,
    assignedModel: team.leadModel,
    status: 'certified',
    maxAttempts: 1,
    positionX: 340,
    positionY: cursorY,
    width: 220,
    height: 68,
    updatedAt: nowIso,
  });
  nodes.push(startNode);
  cursorY += 115;

  const specVerifyNode = makeNode({
    id: `node-${changeId}-spec-guard`,
    changeId,
    code: 'G1-VERIFY',
    parentWbsId: null,
    containerNodeId: null,
    kind: 'verify',
    title: 'Spec & DDD Integrity Guard',
    description:
      'Validate specification completeness and Ubiquitous Language alignment.',
    assignedRole: 'evaluator',
    assignedAdapterId: team.leadAdapterId,
    assignedModel: team.juniorAuditModel,
    status: 'ready',
    maxAttempts: 3,
    positionX: 310,
    positionY: cursorY,
    width: 280,
    height: 78,
    updatedAt: nowIso,
  });
  nodes.push(specVerifyNode);
  edges.push(makeEdge(changeId, startNode.id, specVerifyNode.id, 'logic'));
  cursorY += 120;

  const baseCheckpoint = makeNode({
    id: `node-${changeId}-cp-0`,
    changeId,
    code: 'CP-0',
    parentWbsId: null,
    containerNodeId: null,
    kind: 'checkpoint',
    title: 'Baseline Checkpoint',
    description: 'Clean worktree baseline commit & tag.',
    assignedRole: 'lead',
    assignedAdapterId: null,
    assignedModel: null,
    status: 'pending',
    maxAttempts: 1,
    positionX: 320,
    positionY: cursorY,
    width: 260,
    height: 74,
    updatedAt: nowIso,
  });
  nodes.push(baseCheckpoint);
  edges.push(makeEdge(changeId, specVerifyNode.id, baseCheckpoint.id, 'pass'));
  cursorY += 130;

  let upstreamCheckpointId = baseCheckpoint.id;
  let flowTailId = baseCheckpoint.id;

  phases.forEach((phase, pIdx) => {
    const cols = Math.min(3, Math.max(1, phase.tasks.length));
    const rows = Math.max(1, Math.ceil(phase.tasks.length / cols));
    const containerWidth = Math.max(360, cols * 230 + 48);
    const containerHeight = 76 + rows * 102 + 24;
    const containerId = `node-${changeId}-phase-${pIdx + 1}`;

    const containerNode = makeNode({
      id: containerId,
      changeId,
      code: phase.code,
      parentWbsId: null,
      containerNodeId: null,
      kind: 'phase_container',
      title: `${phase.code}: ${phase.title}`,
      description: phase.description,
      assignedRole: 'lead',
      assignedAdapterId: team.leadAdapterId,
      assignedModel: team.leadModel,
      status: 'pending',
      maxAttempts: Math.max(2, team.maxRetryLoops),
      positionX: 450 - Math.round(containerWidth / 2),
      positionY: cursorY,
      width: containerWidth,
      height: containerHeight,
      updatedAt: nowIso,
    });
    nodes.push(containerNode);
    edges.push(makeEdge(changeId, flowTailId, containerId, 'logic'));

    const codeToTaskId = new Map<string, string>();
    phase.tasks.forEach((task, tIdx) => {
      const col = tIdx % cols;
      const row = Math.floor(tIdx / cols);
      const taskId = `node-${changeId}-task-${pIdx + 1}-${tIdx + 1}`;
      codeToTaskId.set(task.code, taskId);

      nodes.push(
        makeNode({
          id: taskId,
          changeId,
          code: task.code,
          parentWbsId: containerId,
          containerNodeId: containerId,
          kind: 'task',
          title: task.title,
          description: task.description,
          fileScope: task.fileScope ?? [],
          assignedRole: 'worker',
          assignedAdapterId: team.workerAdapterId,
          assignedModel: team.workerModel,
          status: 'pending',
          maxAttempts: Math.max(2, team.maxRetryLoops),
          positionX: 24 + col * 224,
          positionY: 64 + row * 98,
          width: 208,
          height: 82,
          updatedAt: nowIso,
        }),
      );
    });

    phase.tasks.forEach((task, tIdx) => {
      const currentId = codeToTaskId.get(task.code)!;
      if (task.dependsOnCodes && task.dependsOnCodes.length > 0) {
        for (const depCode of task.dependsOnCodes) {
          const depId = codeToTaskId.get(depCode);
          if (depId) {
            edges.push(makeEdge(changeId, depId, currentId, 'dep'));
          }
        }
      } else if (tIdx > 0) {
        const prevCode = phase.tasks[tIdx - 1]?.code;
        const prevId = prevCode ? codeToTaskId.get(prevCode) : undefined;
        if (prevId) {
          edges.push(makeEdge(changeId, prevId, currentId, 'dep'));
        }
      }
    });

    cursorY += containerHeight + 56;

    const gatesNode = makeNode({
      id: `node-${changeId}-gates-${pIdx + 1}`,
      changeId,
      code: `${phase.code}-GATES`,
      parentWbsId: containerId,
      containerNodeId: null,
      kind: 'gates',
      title: `Hard Gates (${phase.code})`,
      description: 'Deterministic lint, typecheck, build, and DDD drift gate.',
      gateCommand: phase.gateCommand ?? defaultVerifyCommand,
      assignedRole: 'evaluator',
      assignedAdapterId: null,
      assignedModel: null,
      status: 'pending',
      maxAttempts: Math.max(2, team.maxRetryLoops),
      positionX: 310,
      positionY: cursorY,
      width: 280,
      height: 74,
      updatedAt: nowIso,
    });
    nodes.push(gatesNode);
    edges.push(makeEdge(changeId, containerId, gatesNode.id, 'logic'));
    cursorY += 112;

    const selfCheckNode = makeNode({
      id: `node-${changeId}-selfcheck-${pIdx + 1}`,
      changeId,
      code: `${phase.code}-SELFCHECK`,
      parentWbsId: containerId,
      containerNodeId: null,
      kind: 'selfcheck',
      title: `Pre-QA Selfcheck (${phase.code})`,
      description: 'Verify deliverable artifacts and file scope boundaries.',
      assignedRole: 'evaluator',
      assignedAdapterId: null,
      assignedModel: null,
      status: 'pending',
      maxAttempts: 2,
      positionX: 310,
      positionY: cursorY,
      width: 280,
      height: 72,
      updatedAt: nowIso,
    });
    nodes.push(selfCheckNode);
    edges.push(makeEdge(changeId, gatesNode.id, selfCheckNode.id, 'pass'));
    cursorY += 112;

    const jqaNode = makeNode({
      id: `node-${changeId}-jqa-${pIdx + 1}`,
      changeId,
      code: `${phase.code}-JQA`,
      parentWbsId: containerId,
      containerNodeId: null,
      kind: 'audit_jqa',
      title: 'Level 1 Consistency Audit (JQA)',
      description: 'Independent check of task completion & DDD naming rules.',
      assignedRole: 'evaluator',
      assignedAdapterId: team.leadAdapterId,
      assignedModel: team.juniorAuditModel,
      status: 'pending',
      maxAttempts: 3,
      positionX: 300,
      positionY: cursorY,
      width: 300,
      height: 76,
      updatedAt: nowIso,
    });
    nodes.push(jqaNode);
    edges.push(makeEdge(changeId, selfCheckNode.id, jqaNode.id, 'pass'));
    cursorY += 112;

    const sqaNode = makeNode({
      id: `node-${changeId}-sqa-${pIdx + 1}`,
      changeId,
      code: `${phase.code}-SQA`,
      parentWbsId: containerId,
      containerNodeId: null,
      kind: 'audit_sqa',
      title: 'Level 2 Architecture & Logic Review (SQA)',
      description: 'Independent senior review of acceptance criteria & safety.',
      assignedRole: 'evaluator',
      assignedAdapterId: team.leadAdapterId,
      assignedModel: team.seniorAuditModel,
      status: 'pending',
      maxAttempts: 3,
      positionX: 295,
      positionY: cursorY,
      width: 310,
      height: 76,
      updatedAt: nowIso,
    });
    nodes.push(sqaNode);
    edges.push(makeEdge(changeId, jqaNode.id, sqaNode.id, 'pass'));
    cursorY += 115;

    const decisionNode = makeNode({
      id: `node-${changeId}-decision-${pIdx + 1}`,
      changeId,
      code: `${phase.code}-DECISION`,
      parentWbsId: containerId,
      containerNodeId: null,
      kind: 'decision',
      title: `QA Gate Decision (${phase.code})`,
      description: 'Advance to checkpoint on PASS or trigger scoped Restore.',
      assignedRole: 'evaluator',
      assignedAdapterId: null,
      assignedModel: null,
      status: 'pending',
      maxAttempts: 1,
      positionX: 320,
      positionY: cursorY,
      width: 260,
      height: 72,
      updatedAt: nowIso,
    });
    nodes.push(decisionNode);
    edges.push(makeEdge(changeId, sqaNode.id, decisionNode.id, 'logic'));

    const restoreNode = makeNode({
      id: `node-${changeId}-restore-${pIdx + 1}`,
      changeId,
      code: `${phase.code}-RESTORE`,
      parentWbsId: containerId,
      containerNodeId: null,
      kind: 'restore',
      title: `Restore (${phase.code})`,
      description:
        'Create backup ref, rewind worktree to checkpoint, attach forensics.',
      assignedRole: 'lead',
      assignedAdapterId: null,
      assignedModel: null,
      status: 'pending',
      maxAttempts: 1,
      positionX: 680,
      positionY: cursorY - 60,
      width: 235,
      height: 74,
      restoreTargetCheckpointId: upstreamCheckpointId,
      updatedAt: nowIso,
    });
    nodes.push(restoreNode);

    edges.push(
      makeEdge(changeId, gatesNode.id, restoreNode.id, 'fail', 'FAIL'),
      makeEdge(changeId, jqaNode.id, restoreNode.id, 'fail', 'FAIL'),
      makeEdge(changeId, sqaNode.id, restoreNode.id, 'fail', 'FAIL'),
      makeEdge(changeId, decisionNode.id, restoreNode.id, 'fail', 'FAIL'),
      makeEdge(
        changeId,
        restoreNode.id,
        upstreamCheckpointId,
        'fail',
        'RESTORE',
      ),
    );

    cursorY += 122;

    const phaseCheckpoint = makeNode({
      id: `node-${changeId}-cp-${pIdx + 1}`,
      changeId,
      code: `CP-${pIdx + 1}`,
      parentWbsId: null,
      containerNodeId: null,
      kind: 'checkpoint',
      title: `QA Checkpoint (${phase.code})`,
      description: 'Physical Git commit + state snapshot.',
      assignedRole: 'lead',
      assignedAdapterId: null,
      assignedModel: null,
      status: 'pending',
      maxAttempts: 1,
      positionX: 315,
      positionY: cursorY,
      width: 270,
      height: 76,
      updatedAt: nowIso,
    });
    nodes.push(phaseCheckpoint);
    edges.push(
      makeEdge(changeId, decisionNode.id, phaseCheckpoint.id, 'pass', 'PASS'),
    );

    upstreamCheckpointId = phaseCheckpoint.id;
    flowTailId = phaseCheckpoint.id;
    cursorY += 135;
  });

  const endNode = makeNode({
    id: `node-${changeId}-end`,
    changeId,
    code: 'G3-CERTIFIED',
    parentWbsId: null,
    containerNodeId: null,
    kind: 'end',
    title: 'Certified & Ready to Ship',
    description: 'All WBS tasks, hard gates, and dual QA audits certified.',
    assignedRole: 'lead',
    assignedAdapterId: null,
    assignedModel: null,
    status: 'pending',
    maxAttempts: 1,
    positionX: 325,
    positionY: cursorY,
    width: 250,
    height: 72,
    updatedAt: nowIso,
  });
  nodes.push(endNode);
  edges.push(makeEdge(changeId, flowTailId, endNode.id, 'pass', 'SHIP'));

  return {nodes, edges};
}

/**
 * Computes exact branch-isolated rewind node IDs between `checkpointNodeId`
 * (exclusive) and `failedNodeId` (inclusive), including nested tasks inside
 * affected PhaseContainer nodes while preserving unrelated parallel branches.
 */
export function computeRewindSet(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  checkpointNodeId: string,
  failedNodeId: string,
): Set<string> {
  const forwardAdj = new Map<string, string[]>();
  const backwardAdj = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.kind === 'fail') {
      continue;
    }
    const fwd = forwardAdj.get(edge.sourceNodeId) ?? [];
    fwd.push(edge.targetNodeId);
    forwardAdj.set(edge.sourceNodeId, fwd);

    const bwd = backwardAdj.get(edge.targetNodeId) ?? [];
    bwd.push(edge.sourceNodeId);
    backwardAdj.set(edge.targetNodeId, bwd);
  }

  const descendants = new Set<string>();
  const fwdQueue = [...(forwardAdj.get(checkpointNodeId) ?? [])];
  while (fwdQueue.length > 0) {
    const cur = fwdQueue.shift()!;
    if (cur === checkpointNodeId || descendants.has(cur)) {
      continue;
    }
    descendants.add(cur);
    for (const nxt of forwardAdj.get(cur) ?? []) {
      fwdQueue.push(nxt);
    }
  }

  const ancestorsClosed = new Set<string>([failedNodeId]);
  const bwdQueue = [failedNodeId];
  while (bwdQueue.length > 0) {
    const cur = bwdQueue.shift()!;
    for (const prev of backwardAdj.get(cur) ?? []) {
      if (!ancestorsClosed.has(prev)) {
        ancestorsClosed.add(prev);
        bwdQueue.push(prev);
      }
    }
  }

  const rewindIds = new Set<string>();
  for (const id of descendants) {
    if (ancestorsClosed.has(id)) {
      rewindIds.add(id);
    }
  }

  // Include nested tasks belonging to any rewound PhaseContainer.
  for (const node of nodes) {
    if (node.containerNodeId && rewindIds.has(node.containerNodeId)) {
      rewindIds.add(node.id);
    }
  }
  rewindIds.delete(checkpointNodeId);
  return rewindIds;
}

/**
 * Checks whether non-fail edges contain a directed cycle.
 */
export function hasForwardCycle(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): boolean {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (e.kind === 'fail') {
      continue;
    }
    if (!inDegree.has(e.sourceNodeId) || !inDegree.has(e.targetNodeId)) {
      continue;
    }
    adj.get(e.sourceNodeId)!.push(e.targetNodeId);
    inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1);
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
      const nextDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, nextDeg);
      if (nextDeg === 0) {
        queue.push(v);
      }
    }
  }
  return visited !== nodes.length;
}

export interface GhostNodeSpliceInput {
  readonly changeId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly insertBeforeNodeId: string;
  readonly gateCommand?: string | null;
  readonly assignedAdapterId: string | null;
  readonly assignedModel: string | null;
  readonly nowIso: string;
}

/**
 * Dynamically splices a GhostNode (plan amendment) immediately before
 * `insertBeforeNodeId` while preserving acyclic graph invariants.
 */
export function spliceGhostNode(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  input: GhostNodeSpliceInput,
): CompiledTwinGraph {
  const target = nodes.find(n => n.id === input.insertBeforeNodeId);
  if (!target) {
    throw new ForgeError(
      'NOT_FOUND',
      `Target node "${input.insertBeforeNodeId}" not found in Twin Graph`,
      404,
    );
  }

  const ghostId = `node-${input.changeId}-ghost-${randomUUID().slice(0, 8)}`;
  const ghostNode: GraphNode = makeNode({
    id: ghostId,
    changeId: input.changeId,
    code: input.code,
    parentWbsId: target.parentWbsId,
    containerNodeId: target.containerNodeId,
    kind: 'ghost',
    title: input.title,
    description: input.description,
    gateCommand: input.gateCommand ?? null,
    assignedRole: 'worker',
    assignedAdapterId: input.assignedAdapterId,
    assignedModel: input.assignedModel,
    status: 'ready',
    maxAttempts: 3,
    positionX: Math.max(16, target.positionX - 28),
    positionY: Math.max(16, target.positionY - 92),
    width: 224,
    height: 82,
    updatedAt: input.nowIso,
  });

  const rewiredEdges: GraphEdge[] = edges.map(e => {
    if (e.kind !== 'fail' && e.targetNodeId === target.id) {
      return {...e, targetNodeId: ghostId};
    }
    return e;
  });
  const linkKind: EdgeKind = target.containerNodeId ? 'dep' : 'logic';
  rewiredEdges.push(
    makeEdge(input.changeId, ghostId, target.id, linkKind, 'AMEND'),
  );

  const nextNodes = [...nodes, ghostNode];
  if (hasForwardCycle(nextNodes, rewiredEdges)) {
    throw new ForgeError(
      'DAG_CYCLE',
      'GhostNode amendment rejected: introduces a cycle into the Twin Graph',
    );
  }
  return {nodes: nextNodes, edges: rewiredEdges};
}

/**
 * Returns nodes whose upstream forward dependencies are all `certified` or
 * `waived`, respecting PhaseContainer nesting rules.
 */
export function computeNextExecutableNodes(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): GraphNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const incomingForward = new Map<string, string[]>();
  for (const n of nodes) {
    incomingForward.set(n.id, []);
  }
  for (const e of edges) {
    if (e.kind === 'fail') {
      continue;
    }
    const arr = incomingForward.get(e.targetNodeId);
    if (arr) {
      arr.push(e.sourceNodeId);
    }
  }

  const isDone = (n: GraphNode | undefined): boolean =>
    Boolean(n && (n.status === 'certified' || n.status === 'waived'));

  const executableKinds = new Set<GraphNodeKind>([
    'verify',
    'task',
    'ghost',
    'gates',
    'selfcheck',
    'audit_jqa',
    'audit_sqa',
    'decision',
    'checkpoint',
    'end',
  ]);

  const ready: GraphNode[] = [];
  for (const node of nodes) {
    if (
      !executableKinds.has(node.kind) ||
      (node.status !== 'pending' &&
        node.status !== 'ready' &&
        node.status !== 'rewound')
    ) {
      continue;
    }

    // If nested inside a PhaseContainer, the container's own upstream must be done.
    if (node.containerNodeId) {
      const containerPreds = incomingForward.get(node.containerNodeId) ?? [];
      if (!containerPreds.every(pid => isDone(byId.get(pid)))) {
        continue;
      }
    }

    const preds = incomingForward.get(node.id) ?? [];
    const allPredsDone = preds.every(pid => {
      const predNode = byId.get(pid);
      if (!predNode) {
        return true;
      }
      if (predNode.kind === 'phase_container') {
        const childTasks = nodes.filter(c => c.containerNodeId === predNode.id);
        return childTasks.every(c => isDone(c));
      }
      return isDone(predNode);
    });

    if (allPredsDone) {
      ready.push(node);
    }
  }

  return ready;
}

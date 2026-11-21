import type {ChangeRecord, GraphEdge, GraphNode} from '../shared/types.ts';
import type {TrialSimulationReport, TrialWave} from '../shared/v3-types.ts';
import {scopesOverlap} from './glob-scope.ts';
import {computeNextExecutableNodes} from './twin-graph.ts';

const EXEC_KINDS = new Set<GraphNode['kind']>([
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

const BARRIER_KINDS = new Set<GraphNode['kind']>([
  'verify',
  'gates',
  'selfcheck',
  'audit_jqa',
  'audit_sqa',
  'decision',
  'checkpoint',
  'end',
]);

function selectWaveForChange(
  ready: readonly GraphNode[],
  maxSlots: number,
  contendedNodePairs: Array<{
    readonly nodeA: string;
    readonly nodeB: string;
    readonly reason: string;
  }>,
  codePrefix = '',
): GraphNode[] {
  if (ready.length === 0 || maxSlots <= 0) {
    return [];
  }
  if (BARRIER_KINDS.has(ready[0]!.kind)) {
    return [ready[0]!];
  }
  const waveNodes: GraphNode[] = [];
  for (const candidate of ready) {
    if (waveNodes.length >= maxSlots) {
      break;
    }
    if (BARRIER_KINDS.has(candidate.kind)) {
      continue;
    }
    const conflict = waveNodes.find(chosen =>
      scopesOverlap(chosen.fileScope, candidate.fileScope),
    );
    if (conflict) {
      contendedNodePairs.push({
        nodeA: `${codePrefix}${conflict.code}`,
        nodeB: `${codePrefix}${candidate.code}`,
        reason: 'Serialized due to overlapping or unrestricted fileScope',
      });
      continue;
    }
    waveNodes.push(candidate);
  }
  if (waveNodes.length === 0 && ready[0]) {
    waveNodes.push(ready[0]);
  }
  return waveNodes;
}

export function simulateTwinGraphTrial(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  maxParallelSlots = 3,
): TrialSimulationReport {
  const simNodes: GraphNode[] = nodes.map(n => ({
    ...n,
    status: n.kind === 'start' ? 'certified' : 'pending',
  }));
  const totalExecutableNodes = simNodes.filter(n =>
    EXEC_KINDS.has(n.kind),
  ).length;
  const estimatedWaves: TrialWave[] = [];
  const contendedNodePairs: Array<{
    readonly nodeA: string;
    readonly nodeB: string;
    readonly reason: string;
  }> = [];

  const slotCap = Math.max(1, maxParallelSlots);
  let guard = 0;
  while (guard < 200) {
    guard += 1;
    const ready = computeNextExecutableNodes(simNodes, edges);
    if (ready.length === 0) {
      break;
    }

    const waveNodes = selectWaveForChange(ready, slotCap, contendedNodePairs);

    for (const n of waveNodes) {
      const idx = simNodes.findIndex(x => x.id === n.id);
      if (idx >= 0) {
        simNodes[idx] = {...simNodes[idx]!, status: 'certified'};
      }
    }

    estimatedWaves.push({
      waveIndex: estimatedWaves.length + 1,
      nodeIds: waveNodes.map(n => n.id),
      nodeCodes: waveNodes.map(n => n.code),
      parallelSlotsUsed: waveNodes.length,
    });
  }

  const unreachableNodeCodes = simNodes
    .filter(n => EXEC_KINDS.has(n.kind) && n.status !== 'certified')
    .map(n => n.code);

  return {
    feasible: unreachableNodeCodes.length === 0,
    totalExecutableNodes,
    estimatedWaves,
    criticalPathLength: estimatedWaves.length,
    contendedNodePairs,
    unreachableNodeCodes,
  };
}

export function simulateMissionTrial(
  changes: readonly ChangeRecord[],
  nodesByChangeId: ReadonlyMap<string, readonly GraphNode[]>,
  edgesByChangeId: ReadonlyMap<string, readonly GraphEdge[]>,
  maxParallelSlots = 3,
): TrialSimulationReport {
  if (changes.length === 0) {
    return {
      feasible: false,
      totalExecutableNodes: 0,
      estimatedWaves: [],
      criticalPathLength: 0,
      contendedNodePairs: [],
      unreachableNodeCodes: [],
    };
  }

  const changeIds = new Set(changes.map(c => c.id));
  const simNodesByChange = new Map<string, GraphNode[]>();
  let totalExecutableNodes = 0;
  for (const chg of changes) {
    const cloned = (nodesByChangeId.get(chg.id) ?? []).map(n => ({
      ...n,
      status:
        n.kind === 'start' ? ('certified' as const) : ('pending' as const),
    }));
    totalExecutableNodes += cloned.filter(n => EXEC_KINDS.has(n.kind)).length;
    simNodesByChange.set(chg.id, cloned);
  }

  const estimatedWaves: TrialWave[] = [];
  const contendedNodePairs: Array<{
    readonly nodeA: string;
    readonly nodeB: string;
    readonly reason: string;
  }> = [];
  const slotCap = Math.max(1, maxParallelSlots);
  const multiChange = changes.length > 1;

  const isChangeDone = (changeId: string): boolean => {
    const nodes = simNodesByChange.get(changeId) ?? [];
    const exec = nodes.filter(n => EXEC_KINDS.has(n.kind));
    return exec.length > 0 && exec.every(n => n.status === 'certified');
  };

  let guard = 0;
  while (guard < 500) {
    guard += 1;
    const completedIds = new Set(
      changes.filter(c => isChangeDone(c.id)).map(c => c.id),
    );
    if (completedIds.size === changes.length) {
      break;
    }

    const unlocked = changes.filter(c => {
      if (completedIds.has(c.id)) {
        return false;
      }
      const deps = c.dependsOnChangeIds ?? [];
      return deps.every(
        depId => !changeIds.has(depId) || completedIds.has(depId),
      );
    });
    if (unlocked.length === 0) {
      break;
    }

    const waveEntries: Array<{
      readonly chg: ChangeRecord;
      readonly node: GraphNode;
    }> = [];
    for (const chg of unlocked) {
      const remainingSlots = slotCap - waveEntries.length;
      if (remainingSlots <= 0) {
        break;
      }
      const simNodes = simNodesByChange.get(chg.id) ?? [];
      const edges = edgesByChangeId.get(chg.id) ?? [];
      const ready = computeNextExecutableNodes(simNodes, edges);
      if (ready.length === 0) {
        continue;
      }
      const picked = selectWaveForChange(
        ready,
        remainingSlots,
        contendedNodePairs,
        multiChange ? `${chg.code}:` : '',
      );
      for (const node of picked) {
        waveEntries.push({chg, node});
      }
    }

    if (waveEntries.length === 0) {
      break;
    }

    for (const entry of waveEntries) {
      const list = simNodesByChange.get(entry.chg.id)!;
      const idx = list.findIndex(x => x.id === entry.node.id);
      if (idx >= 0) {
        list[idx] = {...list[idx]!, status: 'certified'};
      }
    }

    estimatedWaves.push({
      waveIndex: estimatedWaves.length + 1,
      nodeIds: waveEntries.map(e => e.node.id),
      nodeCodes: waveEntries.map(e =>
        multiChange ? `${e.chg.code}:${e.node.code}` : e.node.code,
      ),
      parallelSlotsUsed: waveEntries.length,
    });
  }

  const unreachableNodeCodes: string[] = [];
  for (const chg of changes) {
    for (const n of simNodesByChange.get(chg.id) ?? []) {
      if (EXEC_KINDS.has(n.kind) && n.status !== 'certified') {
        unreachableNodeCodes.push(
          multiChange ? `${chg.code}:${n.code}` : n.code,
        );
      }
    }
  }

  return {
    feasible: unreachableNodeCodes.length === 0 && totalExecutableNodes > 0,
    totalExecutableNodes,
    estimatedWaves,
    criticalPathLength: estimatedWaves.length,
    contendedNodePairs,
    unreachableNodeCodes,
  };
}

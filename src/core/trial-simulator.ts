import type {GraphEdge, GraphNode} from '../shared/types.ts';
import type {TrialSimulationReport, TrialWave} from '../shared/v3-types.ts';
import {scopesOverlap} from './glob-scope.ts';
import {computeNextExecutableNodes} from './twin-graph.ts';

export function simulateTwinGraphTrial(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  maxParallelSlots = 3,
): TrialSimulationReport {
  const execKinds = new Set<GraphNode['kind']>([
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
  const simNodes: GraphNode[] = nodes.map(n => ({
    ...n,
    status: n.kind === 'start' ? 'certified' : 'pending',
  }));
  const totalExecutableNodes = simNodes.filter(n =>
    execKinds.has(n.kind),
  ).length;
  const estimatedWaves: TrialWave[] = [];
  const contendedNodePairs: Array<{
    readonly nodeA: string;
    readonly nodeB: string;
    readonly reason: string;
  }> = [];

  let guard = 0;
  while (guard < 120) {
    guard += 1;
    const ready = computeNextExecutableNodes(simNodes, edges);
    if (ready.length === 0) {
      break;
    }

    const waveNodes: GraphNode[] = [];
    for (const candidate of ready) {
      if (waveNodes.length >= Math.max(1, maxParallelSlots)) {
        break;
      }
      const conflict = waveNodes.find(chosen =>
        scopesOverlap(chosen.fileScope, candidate.fileScope),
      );
      if (
        conflict &&
        (candidate.kind === 'task' || candidate.kind === 'ghost')
      ) {
        contendedNodePairs.push({
          nodeA: conflict.code,
          nodeB: candidate.code,
          reason: 'Serialized due to overlapping or unrestricted fileScope',
        });
        continue;
      }
      waveNodes.push(candidate);
    }

    if (waveNodes.length === 0 && ready[0]) {
      waveNodes.push(ready[0]);
    }

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
    .filter(n => execKinds.has(n.kind) && n.status !== 'certified')
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

/**
 * First-Class Task Decomposition Engine:
 * Converts Spec IR modules + codebase probe into a dependency-ordered WBS plan
 * with non-overlapping fileScope[], topological waveIndex, multi-kernel routing,
 * graph validation, and live mutations (split/merge/reassign/deps/checks/add/remove).
 */

import {randomUUID} from 'node:crypto';
import {ForgeError} from '../shared/errors.ts';
import type {CodebaseProbeReport} from '../shared/v3-types.ts';
import type {
  DecomposedTaskNode,
  KernelId,
  NativeKernelCard,
  SpecIRContract,
  TaskMutation,
  TaskNodeRole,
} from '../shared/v4-types.ts';

export const DEFAULT_ROLE_ROUTING: Readonly<Record<TaskNodeRole, KernelId>> = {
  architect: 'claude-code',
  coder: 'codex',
  tester: 'gemini-cli',
  reviewer: 'claude-code',
  steward: 'native-api',
};

const UI_OR_DOCS_RE =
  /\b(ui|view|page|component|css|style|html|doc|readme|frontend|renderer|dashboard)\b|界面|前端|文档|报告/i;

function normalizePathScope(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function dedupeScopes(scopes: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of scopes) {
    const clean = normalizePathScope(s);
    if (!clean || seen.has(clean)) {
      continue;
    }
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function scopesOverlap(a: string, b: string): boolean {
  const normA = normalizePathScope(a).replace(/\/\*+$/, '');
  const normB = normalizePathScope(b).replace(/\/\*+$/, '');
  if (!normA || !normB) {
    return false;
  }
  if (normA === normB) {
    return true;
  }
  return (
    normA.startsWith(`${normB}/`) ||
    normB.startsWith(`${normA}/`) ||
    (a.endsWith('/**') && normB.startsWith(normA)) ||
    (b.endsWith('/**') && normA.startsWith(normB))
  );
}

export function resolveKernelForRole(
  role: TaskNodeRole,
  roleRouting?: Partial<Readonly<Record<TaskNodeRole, KernelId>>>,
  availableKernels?: readonly NativeKernelCard[],
  strictAvailableOnly = false,
): KernelId {
  const preferred = roleRouting?.[role] ?? DEFAULT_ROLE_ROUTING[role];
  if (
    !strictAvailableOnly ||
    !availableKernels ||
    availableKernels.length === 0
  ) {
    return preferred;
  }
  const found = availableKernels.find(k => k.kernelId === preferred);
  if (found && (found.installed || found.status === 'builtin')) {
    return preferred;
  }
  const fallbackInstalled = availableKernels.find(
    k =>
      (k.installed || k.status === 'builtin') && k.defaultRoles.includes(role),
  );
  if (fallbackInstalled) {
    return fallbackInstalled.kernelId;
  }
  return 'native-api';
}

export interface TaskGraphValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly waveByTaskId: Readonly<Record<string, number>>;
}

export function validateTaskGraph(
  tasks: readonly DecomposedTaskNode[],
): TaskGraphValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map<string, DecomposedTaskNode>();

  for (const task of tasks) {
    if (byId.has(task.id)) {
      errors.push(`Duplicate task id "${task.id}"`);
    }
    byId.set(task.id, task);
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    dependents.set(task.id, []);
  }

  for (const task of tasks) {
    for (const depId of task.dependsOn) {
      if (depId === task.id) {
        errors.push(`Task "${task.id}" cannot depend on itself`);
        continue;
      }
      if (!byId.has(depId)) {
        errors.push(
          `Task "${task.id}" references unknown dependency "${depId}"`,
        );
        continue;
      }
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      dependents.get(depId)!.push(task.id);
    }
  }

  // Kahn's topological sort + wave computation
  const waveByTaskId: Record<string, number> = {};
  const queue: string[] = [];
  for (const task of tasks) {
    if ((inDegree.get(task.id) ?? 0) === 0) {
      queue.push(task.id);
      waveByTaskId[task.id] = 0;
    }
  }

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    const currentWave = waveByTaskId[current] ?? 0;

    for (const nextId of dependents.get(current) ?? []) {
      const candidateWave = currentWave + 1;
      if ((waveByTaskId[nextId] ?? 0) < candidateWave) {
        waveByTaskId[nextId] = candidateWave;
      }
      const nextDeg = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, nextDeg);
      if (nextDeg === 0) {
        queue.push(nextId);
      }
    }
  }

  if (visited !== tasks.length) {
    const cycleIds = tasks
      .filter(t => waveByTaskId[t.id] === undefined)
      .map(t => t.id);
    errors.push(
      `Cycle detected in task graph involving: ${cycleIds.join(', ')}`,
    );
  }

  // Detect fileScope overlap between concurrent tasks in the same wave
  const tasksByWave = new Map<number, DecomposedTaskNode[]>();
  for (const task of tasks) {
    const wave = waveByTaskId[task.id] ?? task.waveIndex;
    const list = tasksByWave.get(wave) ?? [];
    list.push(task);
    tasksByWave.set(wave, list);
  }

  for (const [wave, waveTasks] of tasksByWave.entries()) {
    for (let i = 0; i < waveTasks.length; i++) {
      const a = waveTasks[i]!;
      for (let j = i + 1; j < waveTasks.length; j++) {
        const b = waveTasks[j]!;
        for (const sa of a.fileScope) {
          for (const sb of b.fileScope) {
            if (scopesOverlap(sa, sb)) {
              warnings.push(
                `Wave ${wave} fileScope overlap between "${a.title}" (${sa}) and "${b.title}" (${sb})`,
              );
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    waveByTaskId,
  };
}

export function recomputeTaskWaves(
  tasks: readonly DecomposedTaskNode[],
): DecomposedTaskNode[] {
  const validation = validateTaskGraph(tasks);
  if (!validation.valid) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Invalid task dependency graph: ${validation.errors.join('; ')}`,
      400,
    );
  }

  const completedIds = new Set(
    tasks.filter(t => t.status === 'completed').map(t => t.id),
  );

  return tasks
    .map(task => {
      const waveIndex = validation.waveByTaskId[task.id] ?? 0;
      const allDepsDone = task.dependsOn.every(dep => completedIds.has(dep));
      const status =
        task.status === 'pending' && allDepsDone ? 'ready' : task.status;
      return {
        ...task,
        waveIndex,
        status,
      };
    })
    .sort((a, b) => a.waveIndex - b.waveIndex || a.id.localeCompare(b.id));
}

export interface DecomposeSpecOptions {
  readonly planId: string;
  readonly specIR: SpecIRContract;
  readonly probeReport?: CodebaseProbeReport | null;
  readonly availableKernels?: readonly NativeKernelCard[];
  readonly roleRouting?: Partial<Readonly<Record<TaskNodeRole, KernelId>>>;
  readonly strictAvailableOnly?: boolean;
}

function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 28) || 'module';
}

export function decomposeSpecToTasks(
  options: DecomposeSpecOptions,
): DecomposedTaskNode[] {
  const {
    planId,
    specIR,
    probeReport,
    availableKernels,
    roleRouting,
    strictAvailableOnly = false,
  } = options;

  const tasks: DecomposedTaskNode[] = [];
  const usedScopes = new Set<string>();

  const claimNonOverlappingScope = (
    preferredScopes: readonly string[],
    fallbackPath: string,
  ): string[] => {
    const result: string[] = [];
    for (const raw of dedupeScopes(preferredScopes)) {
      let conflict = false;
      for (const existing of usedScopes) {
        if (scopesOverlap(raw, existing)) {
          conflict = true;
          break;
        }
      }
      if (!conflict) {
        usedScopes.add(raw);
        result.push(raw);
      }
    }
    if (result.length === 0) {
      let candidate = normalizePathScope(fallbackPath);
      let suffix = 1;
      while (
        Array.from(usedScopes).some(existing =>
          scopesOverlap(candidate, existing),
        )
      ) {
        const dotIdx = fallbackPath.lastIndexOf('.');
        candidate =
          dotIdx > 0
            ? normalizePathScope(
                `${fallbackPath.slice(0, dotIdx)}-${suffix}${fallbackPath.slice(dotIdx)}`,
              )
            : normalizePathScope(`${fallbackPath}-${suffix}`);
        suffix += 1;
      }
      usedScopes.add(candidate);
      result.push(candidate);
    }
    return result;
  };

  const archKernel = resolveKernelForRole(
    'architect',
    roleRouting,
    availableKernels,
    strictAvailableOnly,
  );
  const coderKernel = resolveKernelForRole(
    'coder',
    roleRouting,
    availableKernels,
    strictAvailableOnly,
  );
  const testerKernel = resolveKernelForRole(
    'tester',
    roleRouting,
    availableKernels,
    strictAvailableOnly,
  );

  // Wave 0: Contract & Architecture scaffold owned by architect kernel (Claude Code)
  const archTaskId = `task-arch-${slugify(specIR.specId).slice(0, 12)}`;
  const archScope = claimNonOverlappingScope(
    ['docs/spec-contract.md', 'src/contracts/spec-types.ts'],
    'docs/spec-contract.md',
  );
  tasks.push({
    id: archTaskId,
    planId,
    title: 'Freeze Spec Contract & Interface Boundaries',
    description: `Materialize Spec IR (rev ${specIR.revision}, term ${specIR.term}) boundary pseudocode and shared interface definitions.`,
    role: 'architect',
    assignedKernel: archKernel,
    dependsOn: [],
    fileScope: archScope,
    acceptanceChecks: [
      'Contract definitions match Spec IR ubiquitous terms',
      'Zero unresolved spec anchors',
    ],
    status: 'ready',
    waveIndex: 0,
    worktreeBranch: null,
    worktreePath: null,
    checkpointId: null,
    outputSummary: '',
    diffStats: {added: 0, removed: 0, filesChanged: 0},
  });

  // Wave 1: Parallel module implementations with strictly disjoint file scopes
  const modules =
    specIR.modules.length > 0
      ? specIR.modules
      : [
          {
            moduleId: 'mod-core',
            boardNodeId: 'node-core',
            title: 'Core Domain Implementation',
            ownerPrincipalIds: ['owner-local'],
            boundaryPseudocode: 'export function executeCore(input): Result',
            allowedPaths: ['src/core-feature.js'],
            verificationChecks: ['node --test'],
          },
        ];

  const implTaskIds: string[] = [];
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i]!;
    const modSlug = slugify(mod.title || mod.moduleId);
    const taskId = `task-impl-${i + 1}-${modSlug.slice(0, 14)}`;
    const isUiOrDocs =
      UI_OR_DOCS_RE.test(mod.title) ||
      mod.allowedPaths.some(p => UI_OR_DOCS_RE.test(p));

    const assignedKernel = isUiOrDocs
      ? resolveKernelForRole(
          'tester',
          roleRouting,
          availableKernels,
          strictAvailableOnly,
        )
      : coderKernel;

    const scope = claimNonOverlappingScope(
      mod.allowedPaths,
      `src/${modSlug}.js`,
    );

    const checks =
      mod.verificationChecks.length > 0
        ? [...mod.verificationChecks]
        : ['Verify module exports match boundary pseudocode'];

    tasks.push({
      id: taskId,
      planId,
      title: `Implement ${mod.title}`,
      description: `Build module "${mod.title}" (${mod.moduleId}) adhering to boundary contract:\n${mod.boundaryPseudocode}`,
      role: 'coder',
      assignedKernel,
      dependsOn: [archTaskId],
      fileScope: scope,
      acceptanceChecks: checks,
      status: 'pending',
      waveIndex: 1,
      worktreeBranch: null,
      worktreePath: null,
      checkpointId: null,
      outputSummary: '',
      diffStats: {added: 0, removed: 0, filesChanged: 0},
    });
    implTaskIds.push(taskId);
  }

  // Wave 2: Verification & Acceptance Test Suite owned by tester kernel (Gemini CLI)
  const detectedCmds =
    probeReport?.detectedVerifyCommands.map(v => v.command).filter(Boolean) ??
    [];
  const verifyCommands =
    detectedCmds.length > 0
      ? detectedCmds
      : ['node --test tests/acceptance.test.mjs'];

  const testScope = claimNonOverlappingScope(
    ['tests/acceptance.test.mjs'],
    'tests/acceptance.test.mjs',
  );
  const testTaskId = `task-verify-${slugify(specIR.specId).slice(0, 12)}`;
  tasks.push({
    id: testTaskId,
    planId,
    title: 'Author & Execute Acceptance Verification Suite',
    description: `Write automated acceptance tests covering ${modules.length} module(s) and execute repository verification commands.`,
    role: 'tester',
    assignedKernel: testerKernel,
    dependsOn: implTaskIds,
    fileScope: testScope,
    acceptanceChecks: verifyCommands,
    status: 'pending',
    waveIndex: 2,
    worktreeBranch: null,
    worktreePath: null,
    checkpointId: null,
    outputSummary: '',
    diffStats: {added: 0, removed: 0, filesChanged: 0},
  });

  return recomputeTaskWaves(tasks);
}

export function applyTaskMutation(
  tasks: readonly DecomposedTaskNode[],
  mutation: TaskMutation,
): DecomposedTaskNode[] {
  const byId = new Map(tasks.map(t => [t.id, t] as const));

  switch (mutation.op) {
    case 'reassign_kernel': {
      if (!byId.has(mutation.taskId)) {
        throw new ForgeError(
          'NOT_FOUND',
          `Task "${mutation.taskId}" not found`,
          404,
        );
      }
      const next = tasks.map(t =>
        t.id === mutation.taskId
          ? {...t, assignedKernel: mutation.assignedKernel}
          : t,
      );
      return recomputeTaskWaves(next);
    }

    case 'update_deps': {
      if (!byId.has(mutation.taskId)) {
        throw new ForgeError(
          'NOT_FOUND',
          `Task "${mutation.taskId}" not found`,
          404,
        );
      }
      const nextDeps = Array.from(new Set(mutation.dependsOn));
      const next = tasks.map(t =>
        t.id === mutation.taskId ? {...t, dependsOn: nextDeps} : t,
      );
      return recomputeTaskWaves(next);
    }

    case 'edit_checks': {
      if (!byId.has(mutation.taskId)) {
        throw new ForgeError(
          'NOT_FOUND',
          `Task "${mutation.taskId}" not found`,
          404,
        );
      }
      const next = tasks.map(t =>
        t.id === mutation.taskId
          ? {
              ...t,
              acceptanceChecks: [...mutation.acceptanceChecks],
              fileScope: mutation.fileScope
                ? dedupeScopes(mutation.fileScope)
                : t.fileScope,
            }
          : t,
      );
      return recomputeTaskWaves(next);
    }

    case 'add_task': {
      const planId = tasks[0]?.planId ?? `plan-${randomUUID().slice(0, 8)}`;
      const newId = `task-${slugify(mutation.title).slice(0, 14)}-${randomUUID().slice(0, 6)}`;
      const newNode: DecomposedTaskNode = {
        id: newId,
        planId,
        title: mutation.title.trim(),
        description: mutation.description.trim(),
        role: mutation.role,
        assignedKernel: mutation.assignedKernel,
        dependsOn: mutation.dependsOn ? [...mutation.dependsOn] : [],
        fileScope: dedupeScopes(mutation.fileScope),
        acceptanceChecks: [...mutation.acceptanceChecks],
        status: 'pending',
        waveIndex: 0,
        worktreeBranch: null,
        worktreePath: null,
        checkpointId: null,
        outputSummary: '',
        diffStats: {added: 0, removed: 0, filesChanged: 0},
      };
      return recomputeTaskWaves([...tasks, newNode]);
    }

    case 'remove_task': {
      if (!byId.has(mutation.taskId)) {
        throw new ForgeError(
          'NOT_FOUND',
          `Task "${mutation.taskId}" not found`,
          404,
        );
      }
      const removed = byId.get(mutation.taskId)!;
      const next = tasks
        .filter(t => t.id !== mutation.taskId)
        .map(t => {
          if (!t.dependsOn.includes(mutation.taskId)) {
            return t;
          }
          const bridgedDeps = Array.from(
            new Set([
              ...t.dependsOn.filter(d => d !== mutation.taskId),
              ...removed.dependsOn,
            ]),
          );
          return {...t, dependsOn: bridgedDeps};
        });
      return recomputeTaskWaves(next);
    }

    case 'split': {
      const target = byId.get(mutation.taskId);
      if (!target) {
        throw new ForgeError(
          'NOT_FOUND',
          `Task "${mutation.taskId}" not found`,
          404,
        );
      }
      if (mutation.parts.length < 2) {
        throw new ForgeError(
          'VALIDATION_ERROR',
          'Split mutation requires at least 2 parts',
          400,
        );
      }

      const created: DecomposedTaskNode[] = mutation.parts.map((part, idx) => ({
        id: `${target.id}-p${idx + 1}`,
        planId: target.planId,
        title: part.title.trim(),
        description: (part.description ?? target.description).trim(),
        role: part.role ?? target.role,
        assignedKernel: part.assignedKernel ?? target.assignedKernel,
        dependsOn: [...target.dependsOn],
        fileScope: dedupeScopes(
          part.fileScope.length > 0
            ? part.fileScope
            : [`src/${slugify(part.title)}-${idx + 1}.js`],
        ),
        acceptanceChecks: part.acceptanceChecks
          ? [...part.acceptanceChecks]
          : [...target.acceptanceChecks],
        status: 'pending',
        waveIndex: target.waveIndex,
        worktreeBranch: null,
        worktreePath: null,
        checkpointId: null,
        outputSummary: '',
        diffStats: {added: 0, removed: 0, filesChanged: 0},
      }));
      const createdIds = created.map(c => c.id);

      const remapped = tasks
        .filter(t => t.id !== target.id)
        .map(t => {
          if (!t.dependsOn.includes(target.id)) {
            return t;
          }
          const nextDeps = Array.from(
            new Set([
              ...t.dependsOn.filter(d => d !== target.id),
              ...createdIds,
            ]),
          );
          return {...t, dependsOn: nextDeps};
        });

      return recomputeTaskWaves([...remapped, ...created]);
    }

    case 'merge': {
      const mergeIds = Array.from(new Set(mutation.taskIds));
      if (mergeIds.length < 2) {
        throw new ForgeError(
          'VALIDATION_ERROR',
          'Merge mutation requires at least 2 distinct task IDs',
          400,
        );
      }
      const targets = mergeIds.map(id => {
        const found = byId.get(id);
        if (!found) {
          throw new ForgeError('NOT_FOUND', `Task "${id}" not found`, 404);
        }
        return found;
      });
      const mergeSet = new Set(mergeIds);
      const first = targets[0]!;
      const mergedId = `task-merged-${randomUUID().slice(0, 8)}`;

      const externalDeps = Array.from(
        new Set(
          targets.flatMap(t => t.dependsOn).filter(dep => !mergeSet.has(dep)),
        ),
      );
      const mergedScopes = dedupeScopes(targets.flatMap(t => t.fileScope));
      const mergedChecks = Array.from(
        new Set(targets.flatMap(t => t.acceptanceChecks)),
      );

      const mergedNode: DecomposedTaskNode = {
        id: mergedId,
        planId: first.planId,
        title: mutation.title.trim(),
        description: (
          mutation.description ??
          targets.map(t => `- ${t.title}: ${t.description}`).join('\n')
        ).trim(),
        role: first.role,
        assignedKernel: mutation.assignedKernel ?? first.assignedKernel,
        dependsOn: externalDeps,
        fileScope: mergedScopes,
        acceptanceChecks: mergedChecks,
        status: 'pending',
        waveIndex: first.waveIndex,
        worktreeBranch: null,
        worktreePath: null,
        checkpointId: null,
        outputSummary: '',
        diffStats: {added: 0, removed: 0, filesChanged: 0},
      };

      const remaining = tasks
        .filter(t => !mergeSet.has(t.id))
        .map(t => {
          const hits = t.dependsOn.some(dep => mergeSet.has(dep));
          if (!hits) {
            return t;
          }
          const nextDeps = Array.from(
            new Set([
              ...t.dependsOn.filter(dep => !mergeSet.has(dep)),
              mergedId,
            ]),
          );
          return {...t, dependsOn: nextDeps};
        });

      return recomputeTaskWaves([...remaining, mergedNode]);
    }
  }
}

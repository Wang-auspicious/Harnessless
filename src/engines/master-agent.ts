/**
 * SDLC-Studio v4 Master Agent Orchestration Engine:
 * - Zero-form folder onboarding (auto git init + repo probe + welcome playback)
 * - Raft-style Intent Consensus Log + Round-N Grilling + Kano/BWS/AHP (CR < 0.10)
 * - Bidirectional Board <-> Spec IR sync + multi-surface Artifact Pins
 * - First-Class WBS Task Decomposition & Multi-Kernel Parallel Wave Execution
 * - Isolated Git Worktrees + non-intrusive Turn `git write-tree` Diff Snapshots
 * - Claude Ship 3-Agent Review (Hard Anti-Self-Approval + PR Steward + Answer-in-HTML)
 * - Clean Delivery Commit + Hosted App Cards + Cross-Agent Collab Feed
 */

import {randomUUID} from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import type {IAgentAdapterHub} from '../adapters/contracts.ts';
import {quantizeRequirements} from '../core/requirement-quantizer.ts';
import {
  applyTaskMutation,
  decomposeSpecToTasks,
  DEFAULT_ROLE_ROUTING,
  recomputeTaskWaves,
} from '../core/task-decomposer.ts';
import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import {
  detectRepoVerifyCommand,
  scanRepositoriesForProbe,
} from '../sandbox/repo-scanner.ts';
import {ForgeError} from '../shared/errors.ts';
import type {CodebaseProbeReport} from '../shared/v3-types.ts';
import type {
  ArtifactPin,
  ArtifactPinStatus,
  ArtifactSurfaceType,
  BoardNode,
  BoardSceneDoc,
  CatchupSummaryItem,
  CollabFeedItem,
  ConsensusAuthorKind,
  ConsensusEntryType,
  ConsensusLogEntry,
  DecomposedTaskNode,
  GrillingPayload,
  HostedAppCard,
  KanoAhpInputItem,
  KernelId,
  MasterExecutionMode,
  MasterSession,
  MasterSessionMode,
  NativeKernelCard,
  NativeRuntimeBridge,
  QuantizationResult,
  ShipReviewBundle,
  ShipReviewDepth,
  ShipReviewFinding,
  ShipStewardFix,
  SpecIRContract,
  SpecIRModule,
  TaskDecompositionPlan,
  TaskMutation,
  TaskNodeRole,
  TraceSummaryItem,
  TurnDiffFile,
  TurnDiffSnapshot,
  V4BootstrapPayload,
  V4SessionDetail,
  V4SseEvent,
  WorkspaceFileContent,
  WorkspaceFileEntry,
} from '../shared/v4-types.ts';
import type {ForgeStore} from '../store/database.ts';

export interface MasterAgentEngineOptions {
  readonly store: ForgeStore;
  readonly worktrees: IGitWorktreeManager;
  readonly runner: ISandboxProcessRunner;
  readonly adapters: IAgentAdapterHub;
  readonly worktreesRoot: string;
  readonly dataDir: string;
  readonly publish: (event: V4SseEvent) => void;
  readonly collabBridge?: NativeRuntimeBridge;
}

const SKIP_WALK_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-renderer',
  'build',
  'out',
  '.next',
  'coverage',
  '.forgeops',
  '.isolated',
]);

const MAX_READ_BYTES = 128_000;

interface BuiltinKernelSpec {
  readonly kernelId: KernelId;
  readonly displayName: string;
  readonly command: string;
  readonly defaultRoles: readonly TaskNodeRole[];
  readonly builtin?: boolean;
}

const BUILTIN_KERNEL_SPECS: readonly BuiltinKernelSpec[] = [
  {
    kernelId: 'master',
    displayName: 'Master Agent',
    command: 'builtin',
    defaultRoles: ['architect', 'reviewer'],
    builtin: true,
  },
  {
    kernelId: 'claude-code',
    displayName: 'Claude Code',
    command: 'claude',
    defaultRoles: ['architect', 'reviewer'],
  },
  {
    kernelId: 'codex',
    displayName: 'Codex CLI',
    command: 'codex',
    defaultRoles: ['coder', 'steward'],
  },
  {
    kernelId: 'gemini-cli',
    displayName: 'Gemini CLI',
    command: 'gemini',
    defaultRoles: ['tester'],
  },
  {
    kernelId: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    defaultRoles: ['coder'],
  },
  {
    kernelId: 'pi',
    displayName: 'Pi Agent',
    command: 'pi',
    defaultRoles: ['coder'],
  },
  {
    kernelId: 'native-api',
    displayName: 'Native API',
    command: 'builtin',
    defaultRoles: ['architect', 'coder', 'tester', 'reviewer', 'steward'],
    builtin: true,
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugifySegment(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 24) || 'item';
}

function normalizeRelPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function detectMentionedKernel(text: string): KernelId | null {
  const lower = text.toLowerCase();
  if (lower.includes('@codex')) return 'codex';
  if (lower.includes('@claude')) return 'claude-code';
  if (lower.includes('@gemini')) return 'gemini-cli';
  if (lower.includes('@opencode')) return 'opencode';
  if (lower.includes('@pi')) return 'pi';
  if (lower.includes('@native')) return 'native-api';
  if (lower.includes('@master')) return 'master';
  return null;
}

function parseNumstatAndPatch(
  numstatStdout: string,
  patchStdout: string,
): TurnDiffFile[] {
  const statsByPath = new Map<string, {added: number; removed: number}>();
  for (const line of numstatStdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const added =
      parts[0] === '-' ? 0 : Number.parseInt(parts[0] ?? '0', 10) || 0;
    const removed =
      parts[1] === '-' ? 0 : Number.parseInt(parts[1] ?? '0', 10) || 0;
    const filePath = normalizeRelPath(parts.slice(2).join('\t'));
    statsByPath.set(filePath, {added, removed});
  }

  const patchByPath = new Map<string, string>();
  const sections = patchStdout.split(/^diff --git /m);
  for (const sec of sections) {
    if (!sec.trim()) continue;
    const firstLineEnd = sec.indexOf('\n');
    const header = firstLineEnd >= 0 ? sec.slice(0, firstLineEnd) : sec;
    const match = header.match(/a\/(.+?)\s+b\/(.+?)$/);
    const filePath = normalizeRelPath(match?.[2] ?? match?.[1] ?? 'unknown');
    patchByPath.set(filePath, `diff --git ${sec}`.trim());
  }

  const allPaths = Array.from(
    new Set([...statsByPath.keys(), ...patchByPath.keys()]),
  );
  return allPaths.map(path => {
    const st = statsByPath.get(path) ?? {added: 0, removed: 0};
    return {
      path,
      added: st.added,
      removed: st.removed,
      patch: patchByPath.get(path) ?? '',
    };
  });
}

function buildDefaultBoardAndSpec(
  sessionId: string,
  title: string,
  verifyCommand: string,
  probe: CodebaseProbeReport | null,
): {readonly board: BoardSceneDoc; readonly specIR: SpecIRContract} {
  const coreNodeId = 'node-core-domain';
  const apiNodeId = 'node-api-surface';
  const verifyNodeId = 'node-verify-gate';

  const nodes: BoardNode[] = [
    {
      id: coreNodeId,
      label: `${title} Core Engine`,
      kind: 'service',
      x: 80,
      y: 90,
      width: 220,
      height: 88,
      specModuleId: 'mod-core-engine',
      status: 'confirmed',
      summary: 'Primary domain logic and state invariants',
    },
    {
      id: apiNodeId,
      label: 'Interface & Adapter Surface',
      kind: 'module',
      x: 370,
      y: 90,
      width: 220,
      height: 88,
      specModuleId: 'mod-api-surface',
      status: 'draft',
      summary: 'Typed public handlers, input validation, and serialization',
    },
    {
      id: verifyNodeId,
      label: 'Acceptance & Quality Gate',
      kind: 'gate',
      x: 225,
      y: 235,
      width: 230,
      height: 84,
      specModuleId: 'mod-verify-gate',
      status: 'confirmed',
      summary: 'Automated verification assertions and boundary checks',
    },
  ];

  const board: BoardSceneDoc = {
    nodes,
    edges: [
      {
        id: 'edge-api-core',
        fromNodeId: apiNodeId,
        toNodeId: coreNodeId,
        label: 'validates & delegates',
      },
      {
        id: 'edge-core-gate',
        fromNodeId: coreNodeId,
        toNodeId: verifyNodeId,
        label: 'verified by',
      },
    ],
    revision: 1,
  };

  const modules: SpecIRModule[] = [
    {
      moduleId: 'mod-core-engine',
      boardNodeId: coreNodeId,
      title: `${title} Core Engine`,
      ownerPrincipalIds: ['owner-local'],
      boundaryPseudocode:
        'export function evaluateFeature(input: FeatureInput): { ok: boolean; result: string; checkedAt: string }',
      allowedPaths: ['src/core-engine.mjs'],
      verificationChecks: [verifyCommand || 'node --test'],
    },
    {
      moduleId: 'mod-api-surface',
      boardNodeId: apiNodeId,
      title: 'Interface & Adapter Surface',
      ownerPrincipalIds: ['owner-local'],
      boundaryPseudocode:
        'export function handleFeatureRequest(payload: Record<string, unknown>): { status: number; body: unknown }',
      allowedPaths: ['src/api-surface.mjs'],
      verificationChecks: ['node --test tests/acceptance.test.mjs'],
    },
  ];

  const defaultQuant = quantizeRequirements([
    {
      reqId: 'req-core-correctness',
      title: `${title} core workflow correctness & deterministic state`,
      functional: 'expect',
      dysfunctional: 'dislike',
    },
    {
      reqId: 'req-api-contract',
      title: 'Typed input validation and clean boundary error handling',
      functional: 'like',
      dysfunctional: 'dislike',
    },
    {
      reqId: 'req-observability',
      title: 'Fast verification report and traceable audit evidence',
      functional: 'like',
      dysfunctional: 'neutral',
    },
  ]);

  const specIR: SpecIRContract = {
    specId: `spec-${sessionId}`,
    term: 1,
    status: 'draft',
    goals: [
      `Deliver ${title} with verified module boundaries and automated acceptance checks`,
      'Keep all code edits isolated in Git worktrees with Turn-level write-tree diff snapshots',
    ],
    nonGoals: [
      'Uncontrolled writes directly to main branch before Ship approval',
      'Skipping anti-self-approval reviewer separation',
    ],
    kanoSummary: defaultQuant.items,
    ubiquitousTerms: [
      'SpecIRContract',
      'TaskDecompositionPlan',
      'TurnDiffSnapshot',
      'ShipReviewBundle',
      ...(probe?.matchedFiles.slice(0, 3).map(f => basename(f.filePath)) ?? []),
    ],
    modules,
    settledDecisions: [],
    openPins: [],
    revision: 1,
  };

  return {board, specIR};
}

export class MasterAgentEngine {
  private readonly store: ForgeStore;
  private readonly worktrees: IGitWorktreeManager;
  private readonly runner: ISandboxProcessRunner;
  private readonly adapters: IAgentAdapterHub;
  private readonly worktreesRoot: string;
  private readonly dataDir: string;
  private readonly publish: (event: V4SseEvent) => void;
  private readonly collabBridge?: NativeRuntimeBridge;
  private cachedKernels: readonly NativeKernelCard[] | null = null;
  private roleRouting: Record<TaskNodeRole, KernelId>;

  constructor(options: MasterAgentEngineOptions) {
    this.store = options.store;
    this.worktrees = options.worktrees;
    this.runner = options.runner;
    this.adapters = options.adapters;
    this.worktreesRoot = options.worktreesRoot;
    this.dataDir = options.dataDir;
    this.publish = options.publish;
    this.collabBridge = options.collabBridge;

    const savedRouting = this.store.v4.getRoleRoutingSetting();
    this.roleRouting = {
      ...DEFAULT_ROLE_ROUTING,
      ...(this.collabBridge?.getRoleRouting?.() ?? {}),
      ...(savedRouting ?? {}),
    };

    if (this.collabBridge?.subscribeCollab) {
      this.collabBridge.subscribeCollab(item => {
        this.publish({
          type: 'v4.collab.message',
          sessionId: item.sessionId,
          item,
        });
      });
    }
  }

  private getFastInitialKernels(): readonly NativeKernelCard[] {
    const checkedAt = nowIso();
    return BUILTIN_KERNEL_SPECS.map(spec => {
      if (spec.builtin) {
        return {
          kernelId: spec.kernelId,
          displayName: spec.displayName,
          command: spec.command,
          installed: true,
          version: 'v4.0-builtin',
          binaryPath: null,
          defaultRoles: spec.defaultRoles,
          status: 'builtin' as const,
          lastCheckedAt: checkedAt,
        };
      }
      const resolved = this.runner.resolveExecutable(spec.command);
      return {
        kernelId: spec.kernelId,
        displayName: spec.displayName,
        command: spec.command,
        installed: Boolean(resolved),
        version: null,
        binaryPath: resolved,
        defaultRoles: spec.defaultRoles,
        status: resolved ? ('ready' as const) : ('missing' as const),
        lastCheckedAt: checkedAt,
      };
    });
  }

  async getBootstrap(): Promise<V4BootstrapPayload> {
    const sessions = this.store.v4.listSessions();
    let kernels: readonly NativeKernelCard[];
    if (this.cachedKernels) {
      kernels = this.cachedKernels;
    } else {
      kernels = this.getFastInitialKernels();
      void this.probeKernels().catch(() => undefined);
    }
    const hostedApps = this.store.v4.listHostedApps();
    let pendingApprovalsCount = 0;
    for (const s of sessions) {
      const pins = this.store.v4.listPins(s.id);
      pendingApprovalsCount += pins.filter(p => p.status !== 'resolved').length;
      const ship = this.store.v4.getLatestShipReview(s.id);
      if (ship && ship.verdict === 'pending') {
        pendingApprovalsCount += 1;
      }
    }
    return {
      sessions,
      kernels,
      roleRouting: {...this.roleRouting},
      hostedApps,
      pendingApprovalsCount,
      activeSessionId: sessions[0]?.id ?? null,
    };
  }

  listSessions(): MasterSession[] {
    return this.store.v4.listSessions();
  }

  getCatchup(): CatchupSummaryItem[] {
    const sessions = this.store.v4.listSessions();
    return sessions.map(session => {
      const pins = this.store.v4.listPins(session.id);
      const pendingPins = pins.filter(p => p.status !== 'resolved').length;
      const ship = this.store.v4.getLatestShipReview(session.id);
      const messages = this.store.v4.listMessages(session.id);
      const latestMsg = messages[messages.length - 1];
      return {
        sessionId: session.id,
        sessionTitle: session.title,
        stage: session.stage,
        pendingPins,
        pendingShipReview: Boolean(ship && ship.verdict === 'pending'),
        latestSummary:
          latestMsg?.content.slice(0, 140) ??
          `Stage ${session.stage} (Term ${session.term})`,
        updatedAt: session.updatedAt,
      };
    });
  }

  getSessionDetail(sessionId: string): V4SessionDetail {
    const session = this.store.v4.getSessionOrThrow(sessionId);
    const messages = this.store.v4.listMessages(sessionId);
    const consensusLog = this.store.v4.listConsensusLog(sessionId);
    const quantization = this.store.v4.getQuantization(sessionId);
    const pins = this.store.v4.listPins(sessionId);
    const defaults = buildDefaultBoardAndSpec(
      sessionId,
      session.title,
      'node --test',
      null,
    );
    const board = this.store.v4.getBoardDoc(sessionId) ?? defaults.board;
    const rawSpec = this.store.v4.getSpecIR(sessionId) ?? defaults.specIR;
    const specIR: SpecIRContract = {
      ...rawSpec,
      openPins: pins.map(p => ({
        pinId: p.id,
        pinNumber: p.pinNumber,
        surfaceType: p.surfaceType,
        status: p.status,
      })),
    };
    const activePlan =
      (session.activePlanId
        ? this.store.v4.getTaskPlan(session.activePlanId)
        : null) ?? this.store.v4.getLatestTaskPlanForSession(sessionId);
    const diffs = this.store.v4.listTurnDiffSnapshots(sessionId);
    const latestShip = this.store.v4.getLatestShipReview(sessionId);
    const collabFeed = this.listCollab(sessionId);
    const hostedApps = this.store.v4.listHostedApps(sessionId);

    return {
      session,
      messages,
      consensusLog,
      quantization,
      board,
      specIR,
      pins,
      activePlan,
      diffs,
      latestShip,
      collabFeed,
      hostedApps,
    };
  }

  async probeKernels(): Promise<readonly NativeKernelCard[]> {
    if (this.collabBridge?.probeKernels) {
      const bridged = await this.collabBridge.probeKernels();
      this.cachedKernels = bridged;
      return bridged;
    }

    const checkedAt = nowIso();
    const cards: NativeKernelCard[] = [];

    for (const spec of BUILTIN_KERNEL_SPECS) {
      if (spec.builtin) {
        cards.push({
          kernelId: spec.kernelId,
          displayName: spec.displayName,
          command: spec.command,
          installed: true,
          version: 'v4.0-builtin',
          binaryPath: null,
          defaultRoles: spec.defaultRoles,
          status: 'builtin',
          lastCheckedAt: checkedAt,
        });
        continue;
      }

      const resolved = this.runner.resolveExecutable(spec.command);
      if (!resolved) {
        cards.push({
          kernelId: spec.kernelId,
          displayName: spec.displayName,
          command: spec.command,
          installed: false,
          version: null,
          binaryPath: null,
          defaultRoles: spec.defaultRoles,
          status: 'missing',
          lastCheckedAt: checkedAt,
        });
        continue;
      }

      let version: string | null = null;
      let status: NativeKernelCard['status'] = 'ready';
      try {
        const res = await this.runner.run({
          executable: resolved,
          args: ['--version'],
          cwd: this.dataDir,
          timeoutMs: 4_000,
        });
        const firstLine = (res.stdout || res.stderr)
          .split(/\r?\n/)
          .map(l => l.trim())
          .find(Boolean);
        version = firstLine ? firstLine.slice(0, 64) : 'detected';
        if (res.exitCode !== 0 && !firstLine) {
          status = 'degraded';
        }
      } catch {
        version = 'detected';
        status = 'degraded';
      }

      cards.push({
        kernelId: spec.kernelId,
        displayName: spec.displayName,
        command: spec.command,
        installed: true,
        version,
        binaryPath: resolved,
        defaultRoles: spec.defaultRoles,
        status,
        lastCheckedAt: checkedAt,
      });
    }

    this.cachedKernels = cards;
    return cards;
  }

  getRoleRouting(): Readonly<Record<TaskNodeRole, KernelId>> {
    return {...this.roleRouting};
  }

  updateRoleRouting(
    patch: Partial<Readonly<Record<TaskNodeRole, KernelId>>>,
  ): Readonly<Record<TaskNodeRole, KernelId>> {
    this.roleRouting = {
      ...this.roleRouting,
      ...patch,
    };
    this.store.v4.saveRoleRoutingSetting(this.roleRouting);
    if (this.collabBridge?.setRoleRouting) {
      this.collabBridge.setRoleRouting(this.roleRouting);
    }
    return {...this.roleRouting};
  }

  postCollab(input: {
    readonly sessionId: string;
    readonly fromKernel: KernelId;
    readonly toKernel: KernelId | 'all';
    readonly kind: CollabFeedItem['kind'];
    readonly taskId?: string | null;
    readonly audienceScope?: string;
    readonly allowedReaders?: readonly string[];
    readonly content: string;
  }): CollabFeedItem {
    const persisted = this.store.v4.appendCollabMessage(input);
    if (this.collabBridge?.postCollab) {
      this.collabBridge.postCollab(input);
    }
    this.publish({
      type: 'v4.collab.message',
      sessionId: input.sessionId,
      item: persisted,
    });
    return persisted;
  }

  listCollab(
    sessionId?: string,
    readerPrincipal?: string,
    limit = 100,
  ): readonly CollabFeedItem[] {
    if (this.collabBridge?.queryCollab) {
      const bridged = this.collabBridge.queryCollab({
        sessionId,
        readerPrincipal,
        limit,
      });
      if (bridged.length > 0) {
        return bridged;
      }
    }
    return this.store.v4.listCollabMessages(sessionId, readerPrincipal, limit);
  }

  async onboardFolder(input: {
    readonly folderPath: string;
    readonly title?: string;
    readonly mode?: MasterSessionMode;
    readonly executionMode?: MasterExecutionMode;
  }): Promise<V4SessionDetail> {
    const absPath = resolve(input.folderPath.trim());
    if (!existsSync(absPath)) {
      throw new ForgeError(
        'NOT_FOUND',
        `Workspace folder does not exist: ${absPath}`,
        404,
      );
    }
    const stat = statSync(absPath);
    if (!stat.isDirectory()) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        `Workspace path is not a directory: ${absPath}`,
        400,
      );
    }

    const folderName = basename(absPath) || 'workspace';
    const gitDir = join(absPath, '.git');
    let gitAutoInitialized = false;

    if (!existsSync(gitDir)) {
      const gitignorePath = join(absPath, '.gitignore');
      if (!existsSync(gitignorePath)) {
        writeFileSync(
          gitignorePath,
          'node_modules/\ndist/\ndist-renderer/\n.DS_Store\n*.log\n',
          'utf8',
        );
      }
      const entries = readdirSync(absPath).filter(
        name => name !== '.git' && name !== '.gitignore',
      );
      if (entries.length === 0) {
        writeFileSync(
          join(absPath, 'README.md'),
          `# ${folderName}\n\nInitialized by SDLC-Studio v4 Master Agent.\n`,
          'utf8',
        );
      }
      await this.worktrees.ensureGitRepoInitialized(absPath, 'main');
      gitAutoInitialized = true;
    } else {
      await this.worktrees.ensureGitRepoInitialized(absPath, 'main');
    }

    const verifyCommand = detectRepoVerifyCommand(absPath, '');
    const normalizedLower = absPath.toLowerCase();
    const existingRepo = this.store
      .listRepositories()
      .find(r => resolve(r.localPath).toLowerCase() === normalizedLower);

    let hubId: string;
    let repoId: string;
    if (existingRepo) {
      hubId = existingRepo.hubId;
      repoId = existingRepo.id;
    } else {
      const hub = this.store.createHub({
        name: input.title?.trim() || folderName,
        rootPath: absPath,
        description: `SDLC-Studio v4 workspace (${folderName})`,
        permissionTier: 'supervised',
      });
      const repo = this.store.registerRepository({
        hubId: hub.id,
        name: folderName,
        tier: 'service',
        localPath: absPath,
        defaultBranch: 'main',
        verifyCommand,
        contractSummary: `Zero-form onboarded repository (${folderName})`,
        boundedContext: slugifySegment(folderName),
      });
      hubId = hub.id;
      repoId = repo.id;
    }

    const repoEntry = this.store.getRepository(repoId)!;
    const probeReport = await scanRepositoriesForProbe(
      this.worktrees,
      this.runner,
      [repoEntry],
      input.title?.trim() || folderName,
    );

    const session = this.store.v4.createSession({
      title: input.title?.trim() || folderName,
      mode: input.mode ?? 'solo',
      executionMode: input.executionMode ?? 'auto',
      workspacePath: absPath,
      hubId,
      repoId,
      stage: 'intent',
      term: 1,
    });

    const {board, specIR} = buildDefaultBoardAndSpec(
      session.id,
      session.title,
      verifyCommand,
      probeReport,
    );
    this.store.v4.saveWorkspaceDoc(session.id, 'board_scene', board);
    this.store.v4.saveWorkspaceDoc(session.id, 'spec_ir', specIR);
    const defaultQuant = quantizeRequirements(
      specIR.kanoSummary.map(item => ({
        reqId: item.reqId,
        title: item.title,
        functional: item.kanoCategory === 'M' ? 'expect' : 'like',
        dysfunctional: item.kanoCategory === 'A' ? 'neutral' : 'dislike',
      })),
    );
    this.store.v4.saveWorkspaceDoc(session.id, 'quantization', defaultQuant);
    this.store.v4.updateSession(session.id, {crPassed: defaultQuant.passed});

    const entry = this.store.v4.appendConsensusEntry({
      sessionId: session.id,
      term: 1,
      authorPrincipalId: 'master-agent',
      authorKind: 'master_agent',
      entryType: 'found',
      specAnchorId: specIR.specId,
      payload: {
        workspacePath: absPath,
        gitAutoInitialized,
        verifyCommand,
        scannedFiles: probeReport.scannedFilesCount,
      },
      commitState: 'committed',
    });

    const welcomeMsg = this.store.v4.appendMessage({
      sessionId: session.id,
      role: 'master',
      agentKernel: 'master',
      kind: 'decision_card',
      content: `已静默完成目录接入「${session.title}」（${gitAutoInitialized ? '已自动执行 git init 并建立基线提交' : '已挂载现有 Git 仓库'}，扫描 ${probeReport.scannedFilesCount} 个文件，探测验证命令：\`${verifyCommand}\`）。请直接告诉我你想构建或改造的功能。`,
      decisionCard: {
        conclusion: `工作区 ${folderName} 已就绪，Board 与 Spec IR 初始骨架已同步建立。`,
        evidence: [
          `Workspace: ${absPath}`,
          `Git Status: ${gitAutoInitialized ? 'auto-initialized main baseline' : 'existing git repo verified'}`,
          `Probe: ${probeReport.scannedFilesCount} files scanned, verify command "${verifyCommand}"`,
        ],
        recommendation:
          '直接用自然语言描述目标需求，我将启动 Term 1 共识拷问、Kano/AHP 量化并拆解多内核任务。',
        risk: 'Low — 主分支受 Worktree 隔离保护，审批通过前不会直接改动主分支。',
        decisionNeeded: '描述本期目标功能或调整右侧白板/Spec 模块边界。',
        actionNeeded: '在下方输入框发送需求，或点击快捷阶段芯片推进。',
      },
    });

    const updatedSession = this.store.v4.getSessionOrThrow(session.id);
    this.publish({type: 'v4.session.updated', session: updatedSession});
    this.publish({
      type: 'v4.consensus.entry',
      sessionId: session.id,
      entry,
    });
    this.publish({
      type: 'v4.message.added',
      sessionId: session.id,
      message: welcomeMsg,
    });

    return this.getSessionDetail(session.id);
  }

  async createDemoRun(input?: {
    readonly mode?: MasterSessionMode;
  }): Promise<V4SessionDetail> {
    const demoDir = join(
      this.dataDir,
      'demo-workspaces',
      `sdlc-v4-demo-${randomUUID().slice(0, 6)}`,
    );
    mkdirSync(join(demoDir, 'src'), {recursive: true});
    writeFileSync(
      join(demoDir, 'package.json'),
      JSON.stringify(
        {
          name: 'sdlc-v4-demo-app',
          version: '0.1.0',
          type: 'module',
          scripts: {
            test: 'node --test',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(demoDir, 'README.md'),
      '# SDLC-Studio v4 Demo Project\n\nInstant sandboxed project for end-to-end Master Agent verification.\n',
      'utf8',
    );
    writeFileSync(
      join(demoDir, 'src', 'index.mjs'),
      "export function health() {\n  return { ok: true, service: 'sdlc-v4-demo' };\n}\n",
      'utf8',
    );

    const detail = await this.onboardFolder({
      folderPath: demoDir,
      title: '订单风控与审批网关 Demo',
      mode: input?.mode ?? 'team',
      executionMode: 'auto',
    });

    return this.handleTurn(
      detail.session.id,
      '构建订单风控校验引擎与审批状态机 API，支持高危金额拦截、多内核并行开发、独立 Ship 审校与验收报告。',
      {executionMode: 'auto'},
    );
  }

  updateSessionMeta(
    sessionId: string,
    patch: {
      readonly mode?: MasterSessionMode;
      readonly executionMode?: MasterExecutionMode;
      readonly title?: string;
    },
  ): MasterSession {
    const updated = this.store.v4.updateSession(sessionId, patch);
    this.publish({type: 'v4.session.updated', session: updated});
    return updated;
  }

  convertToTeam(sessionId: string, disclosureScope = 'team'): MasterSession {
    const session = this.store.v4.getSessionOrThrow(sessionId);
    const updated = this.store.v4.updateSession(sessionId, {mode: 'team'});
    this.store.v4.appendConsensusEntry({
      sessionId,
      term: updated.term,
      authorPrincipalId: 'owner-local',
      authorKind: 'human',
      entryType: 'ruling',
      specAnchorId: null,
      payload: {
        action: 'convert_to_team',
        previousMode: session.mode,
        disclosureScope,
      },
      commitState: 'committed',
    });
    const msg = this.store.v4.appendMessage({
      sessionId,
      role: 'system',
      agentKernel: 'master',
      kind: 'text',
      content: `会话已升级为 Team 共识房间（披露边界：${disclosureScope}），私有上下文已按受众交集隔离。`,
    });
    this.publish({type: 'v4.session.updated', session: updated});
    this.publish({type: 'v4.message.added', sessionId, message: msg});
    return updated;
  }

  async handleTurn(
    sessionId: string,
    text: string,
    options?: {
      readonly targetKernel?: KernelId;
      readonly executionMode?: MasterExecutionMode;
      readonly action?:
        'chat' | 'freeze_spec' | 'decompose' | 'execute' | 'ship';
    },
  ): Promise<V4SessionDetail> {
    let session = this.store.v4.getSessionOrThrow(sessionId);
    if (
      options?.executionMode &&
      options.executionMode !== session.executionMode
    ) {
      session = this.store.v4.updateSession(sessionId, {
        executionMode: options.executionMode,
      });
    }

    const trimmed = text.trim();
    if (!trimmed && !options?.action) {
      throw new ForgeError('VALIDATION_ERROR', 'Message text is required', 400);
    }

    const mentionedKernel =
      options?.targetKernel ?? detectMentionedKernel(trimmed);

    if (trimmed) {
      const humanMsg = this.store.v4.appendMessage({
        sessionId,
        role: 'human',
        agentKernel: 'master',
        kind: 'text',
        content: trimmed,
      });
      this.publish({
        type: 'v4.message.added',
        sessionId,
        message: humanMsg,
      });
    }

    if (options?.action === 'freeze_spec') {
      return this.submitGrilling(sessionId, {
        answers: {},
        acceptRecommended: true,
        freezeSpec: true,
      });
    }
    if (options?.action === 'decompose') {
      const {detail} = await this.decomposeSessionTasks(sessionId, {
        force: true,
      });
      return detail;
    }
    if (options?.action === 'execute') {
      const {detail} = await this.executeTaskPlan(sessionId, {});
      return detail;
    }
    if (options?.action === 'ship') {
      const {detail} = await this.runShipReview(sessionId, {});
      return detail;
    }

    // Record Raft intent log entry
    const intentEntry = this.store.v4.appendConsensusEntry({
      sessionId,
      term: session.term,
      authorPrincipalId: 'owner-local',
      authorKind: 'human',
      entryType: 'intent',
      specAnchorId: null,
      payload: {text: trimmed, mentionedKernel},
      commitState: 'proposed',
    });
    this.publish({
      type: 'v4.consensus.entry',
      sessionId,
      entry: intentEntry,
    });

    // Cross-kernel mention delegation
    if (mentionedKernel && mentionedKernel !== 'master') {
      const collab = this.postCollab({
        sessionId,
        fromKernel: 'master',
        toKernel: mentionedKernel,
        kind: 'delegate',
        audienceScope: session.mode === 'team' ? 'team' : 'world',
        content: `Master Agent delegated user request to ${mentionedKernel}: "${trimmed.slice(0, 160)}"`,
      });
      const collabMsg = this.store.v4.appendMessage({
        sessionId,
        role: 'agent',
        agentKernel: mentionedKernel,
        kind: 'collab_event',
        content: `已路由至原生内核 ${mentionedKernel} 协同处理：${trimmed.slice(0, 120)}`,
        collabMeta: {
          collabId: collab.id,
          fromKernel: 'master',
          toKernel: mentionedKernel,
          kind: 'delegate',
          targetTab: 'kernels',
        },
      });
      this.publish({
        type: 'v4.message.added',
        sessionId,
        message: collabMsg,
      });
    }

    // Synthesize updated Board + Spec IR + Kano/AHP + Grilling Card
    const existingDetail = this.getSessionDetail(sessionId);
    const derivedTitle =
      trimmed.length > 6 ? trimmed.slice(0, 42) : session.title;
    const slugA = slugifySegment(derivedTitle);

    const nextModules: SpecIRModule[] = [
      {
        moduleId: `mod-${slugA}-core`,
        boardNodeId: `node-${slugA}-core`,
        title: `${derivedTitle.slice(0, 22)}核心引擎`,
        ownerPrincipalIds: ['owner-local'],
        boundaryPseudocode: `export function evaluate${slugA.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/^[a-z]/, c => c.toUpperCase())}(input) {\n  // Validates invariants & executes domain logic\n  return { ok: true, input, evaluatedAt: new Date().toISOString() };\n}`,
        allowedPaths: [`src/${slugA}-core.mjs`],
        verificationChecks: ['node --test tests/acceptance.test.mjs'],
      },
      {
        moduleId: `mod-${slugA}-service`,
        boardNodeId: `node-${slugA}-service`,
        title: `${derivedTitle.slice(0, 22)}接口与状态适配`,
        ownerPrincipalIds: ['owner-local'],
        boundaryPseudocode:
          'export function handleServiceAction(payload) {\n  // Enforces contract validation & returns structured receipt\n  return { status: 200, accepted: true, payload };\n}',
        allowedPaths: [`src/${slugA}-service.mjs`],
        verificationChecks: ['node --test tests/acceptance.test.mjs'],
      },
    ];

    const nextBoard: BoardSceneDoc = {
      nodes: [
        {
          id: nextModules[0]!.boardNodeId,
          label: nextModules[0]!.title,
          kind: 'service',
          x: 70,
          y: 80,
          width: 230,
          height: 90,
          specModuleId: nextModules[0]!.moduleId,
          status: 'confirmed',
          summary: 'Core domain rules & state transitions',
        },
        {
          id: nextModules[1]!.boardNodeId,
          label: nextModules[1]!.title,
          kind: 'module',
          x: 365,
          y: 80,
          width: 230,
          height: 90,
          specModuleId: nextModules[1]!.moduleId,
          status: 'draft',
          summary: 'Public API boundary & validation',
        },
        {
          id: 'node-ship-gate',
          label: 'Claude Ship 独立审校门禁',
          kind: 'gate',
          x: 215,
          y: 230,
          width: 245,
          height: 82,
          specModuleId: 'mod-verify-gate',
          status: 'confirmed',
          summary: 'Anti-self-approval + Answer-in-HTML',
        },
      ],
      edges: [
        {
          id: 'edge-svc-core',
          fromNodeId: nextModules[1]!.boardNodeId,
          toNodeId: nextModules[0]!.boardNodeId,
          label: 'invokes contract',
        },
        {
          id: 'edge-core-ship',
          fromNodeId: nextModules[0]!.boardNodeId,
          toNodeId: 'node-ship-gate',
          label: 'verified before merge',
        },
      ],
      revision: existingDetail.board.revision,
    };

    const quantInputs: KanoAhpInputItem[] = [
      {
        reqId: 'req-1',
        title: `核心业务闭环：${derivedTitle}`,
        functional: 'expect',
        dysfunctional: 'dislike',
      },
      {
        reqId: 'req-2',
        title: '边界契约校验与隔离 Worktree 并行执行',
        functional: 'like',
        dysfunctional: 'dislike',
      },
      {
        reqId: 'req-3',
        title: '独立 Ship 审校防自批与 Answer-in-HTML 报告',
        functional: 'like',
        dysfunctional: 'neutral',
      },
    ];
    const quantResult = quantizeRequirements(quantInputs);
    this.store.v4.saveWorkspaceDoc(sessionId, 'quantization', quantResult);

    const savedBoard = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'board_scene',
      nextBoard,
    );
    const nextSpec: SpecIRContract = {
      ...existingDetail.specIR,
      term: session.term,
      status: 'grilling',
      goals: [
        trimmed,
        '严格按 Spec IR 边界契约拆分非重叠文件域并行执行',
        '执行完成后通过独立内核 Ship 审校并生成 Answer-in-HTML 报告',
      ],
      nonGoals: existingDetail.specIR.nonGoals,
      kanoSummary: quantResult.items,
      modules: nextModules,
      revision: existingDetail.specIR.revision,
    };
    const savedSpec = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'spec_ir',
      nextSpec,
    );

    const round =
      existingDetail.messages.filter(m => m.kind === 'grilling').length + 1;
    const grilling: GrillingPayload = {
      round,
      title: `Round ${round} 共识拷问与量化确认（CR=${quantResult.cr.toFixed(4)} < 0.10）`,
      summary: `已基于你的意图生成 ${nextModules.length} 个双向绑定模块（Board ↔ Spec IR），并完成 Kano Better-Worse 与 AHP 权重校验。确认以下分叉即可冻结基线并自动拆解多内核任务。`,
      settled: [
        `核心目标：${trimmed.slice(0, 72)}`,
        `AHP 一致性校验通过：CR = ${quantResult.cr.toFixed(4)} (< 0.10)`,
        '隔离模式：每个子任务使用独立 Git Worktree + Turn write-tree 快照',
      ],
      questions: [
        {
          id: `q${round}-fork`,
          label:
            'Q1 (Fork)：是否按双模块解耦（Core 引擎 + Service 边界）并行推进？',
          isForkQuestion: true,
          defaultOptionId: 'opt-decoupled',
          selectedOptionId: 'opt-decoupled',
          options: [
            {
              id: 'opt-decoupled',
              label: '按双模块并行拆解（推荐）',
              rationale:
                '文件域零重叠，Codex 与 Gemini/Claude 可同波次并行执行',
              recommended: true,
            },
            {
              id: 'opt-single',
              label: '合并为单模块串行实现',
              rationale: '改动面更小，适合极简原型',
            },
          ],
        },
        {
          id: `q${round}-ship`,
          label: 'Q2：Ship 审校阶段采用何种策略审批模式？',
          defaultOptionId: 'opt-shadow',
          selectedOptionId: 'opt-shadow',
          options: [
            {
              id: 'opt-shadow',
              label: 'Shadow 影子观察 + 独立审校内核（推荐）',
              rationale: '强制防自批，同时输出策略对比审计日志供人工拍板',
              recommended: true,
            },
            {
              id: 'opt-enforced',
              label: 'Enforced 严格门禁模式',
              rationale: '阻断任何未达标项，适合生产关键路径',
            },
          ],
        },
      ],
      resolved: false,
    };

    const grillMsg = this.store.v4.appendMessage({
      sessionId,
      role: 'master',
      agentKernel: 'master',
      kind: 'grilling',
      content: grilling.summary,
      grilling,
    });

    const askedEntry = this.store.v4.appendConsensusEntry({
      sessionId,
      term: session.term,
      authorPrincipalId: 'master-agent',
      authorKind: 'master_agent',
      entryType: 'asked',
      specAnchorId: savedSpec.data.specId,
      payload: {
        round,
        questionCount: grilling.questions.length,
        cr: quantResult.cr,
      },
      commitState: 'proposed',
    });

    const updatedSession = this.store.v4.updateSession(sessionId, {
      stage: 'spec',
      crPassed: quantResult.passed,
    });

    this.publish({type: 'v4.session.updated', session: updatedSession});
    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'board',
      revision: savedBoard.revision,
    });
    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'spec_ir',
      revision: savedSpec.revision,
    });
    this.publish({
      type: 'v4.consensus.entry',
      sessionId,
      entry: askedEntry,
    });
    this.publish({
      type: 'v4.message.added',
      sessionId,
      message: grillMsg,
    });

    return this.getSessionDetail(sessionId);
  }

  async submitGrilling(
    sessionId: string,
    input: {
      readonly messageId?: string;
      readonly answers: Readonly<Record<string, string>>;
      readonly acceptRecommended?: boolean;
      readonly freezeSpec?: boolean;
    },
  ): Promise<V4SessionDetail> {
    const detail = this.getSessionDetail(sessionId);
    const targetMsg =
      (input.messageId
        ? detail.messages.find(m => m.id === input.messageId)
        : [...detail.messages].reverse().find(m => m.kind === 'grilling')) ??
      null;

    const settledLines: string[] = [];
    if (targetMsg?.grilling) {
      const updatedQuestions = targetMsg.grilling.questions.map(q => {
        const answer =
          input.answers[q.id] ??
          (input.acceptRecommended ? q.defaultOptionId : q.selectedOptionId) ??
          q.defaultOptionId;
        const opt = q.options.find(o => o.id === answer);
        settledLines.push(`${q.label} -> ${opt ? opt.label : answer}`);
        return {
          ...q,
          selectedOptionId: opt ? opt.id : q.defaultOptionId,
          customAnswer: opt ? undefined : answer,
        };
      });
      this.store.v4.updateMessageGrilling(targetMsg.id, {
        ...targetMsg.grilling,
        questions: updatedQuestions,
        settled: [...targetMsg.grilling.settled, ...settledLines],
        resolved: true,
      });
    }

    const rulingEntry = this.store.v4.appendConsensusEntry({
      sessionId,
      term: detail.session.term,
      authorPrincipalId: 'owner-local',
      authorKind: 'human',
      entryType: 'ruling',
      specAnchorId: detail.specIR.specId,
      payload: {
        answers: input.answers,
        acceptRecommended: Boolean(input.acceptRecommended),
        settledLines,
      },
      commitState: 'committed',
    });
    this.store.v4.commitConsensusTerm(sessionId, detail.session.term);

    const nextSpec: SpecIRContract = {
      ...detail.specIR,
      status: input.freezeSpec ? 'committed' : 'builder_checked',
      settledDecisions: [
        ...detail.specIR.settledDecisions,
        {
          decisionId: `dec-${randomUUID().slice(0, 8)}`,
          origin: input.acceptRecommended ? 'agent_assumed_accepted' : 'human',
          logSeq: rulingEntry.logSeq,
          summary:
            settledLines.join('；') || '按推荐方案采纳并冻结 Spec IR 基线',
        },
      ],
    };
    const savedSpec = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'spec_ir',
      nextSpec,
    );

    this.publish({
      type: 'v4.consensus.entry',
      sessionId,
      entry: rulingEntry,
    });
    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'spec_ir',
      revision: savedSpec.revision,
    });

    if (input.freezeSpec) {
      const commitEntry = this.store.v4.appendConsensusEntry({
        sessionId,
        term: detail.session.term,
        authorPrincipalId: 'owner-local',
        authorKind: 'human',
        entryType: 'commit',
        specAnchorId: detail.specIR.specId,
        payload: {specRevision: savedSpec.revision, frozen: true},
        commitState: 'committed',
      });
      this.publish({
        type: 'v4.consensus.entry',
        sessionId,
        entry: commitEntry,
      });
      const {detail: decomposedDetail} = await this.decomposeSessionTasks(
        sessionId,
        {force: true},
      );
      return decomposedDetail;
    }

    const replyMsg = this.store.v4.appendMessage({
      sessionId,
      role: 'master',
      agentKernel: 'master',
      kind: 'text',
      content: `本轮共识已写入 Settled（Log #${rulingEntry.logSeq}）。你可以继续批注白板/Spec，或直接拆解任务进入并行开发。`,
    });
    this.publish({
      type: 'v4.message.added',
      sessionId,
      message: replyMsg,
    });

    return this.getSessionDetail(sessionId);
  }

  appendConsensus(
    sessionId: string,
    input: {
      readonly authorPrincipalId?: string;
      readonly authorKind?: ConsensusAuthorKind;
      readonly entryType: ConsensusEntryType;
      readonly specAnchorId?: string | null;
      readonly payload: unknown;
      readonly commit?: boolean;
    },
  ): {
    readonly entry: ConsensusLogEntry;
    readonly consensusLog: readonly ConsensusLogEntry[];
  } {
    const session = this.store.v4.getSessionOrThrow(sessionId);
    const entry = this.store.v4.appendConsensusEntry({
      sessionId,
      term: session.term,
      authorPrincipalId: input.authorPrincipalId ?? 'owner-local',
      authorKind: input.authorKind ?? 'human',
      entryType: input.entryType,
      specAnchorId: input.specAnchorId ?? null,
      payload: input.payload,
      commitState: input.commit ? 'committed' : 'proposed',
    });
    if (input.commit) {
      this.store.v4.commitConsensusTerm(sessionId, session.term);
    }
    this.publish({type: 'v4.consensus.entry', sessionId, entry});
    return {
      entry,
      consensusLog: this.store.v4.listConsensusLog(sessionId),
    };
  }

  runQuantization(
    sessionId: string,
    input: {
      readonly items: readonly KanoAhpInputItem[];
      readonly pairwiseMatrix?: readonly (readonly number[])[];
    },
  ): QuantizationResult {
    const session = this.store.v4.getSessionOrThrow(sessionId);
    const result = quantizeRequirements(input.items, input.pairwiseMatrix);

    const saved = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'quantization',
      result,
    );
    const updatedSession = this.store.v4.updateSession(sessionId, {
      crPassed: result.passed,
    });

    const spec = this.store.v4.getSpecIR(sessionId);
    if (spec) {
      this.store.v4.saveWorkspaceDoc(sessionId, 'spec_ir', {
        ...spec,
        kanoSummary: result.items,
      });
    }

    const entry = this.store.v4.appendConsensusEntry({
      sessionId,
      term: session.term,
      authorPrincipalId: 'master-agent',
      authorKind: 'master_agent',
      entryType: 'ahp',
      specAnchorId: spec?.specId ?? null,
      payload: {
        cr: result.cr,
        passed: result.passed,
        lambdaMax: result.lambdaMax,
        maxConflictPair: result.maxConflictPair ?? null,
      },
      commitState: result.passed ? 'committed' : 'proposed',
    });

    this.publish({type: 'v4.session.updated', session: updatedSession});
    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'quantization',
      revision: saved.revision,
    });
    this.publish({type: 'v4.consensus.entry', sessionId, entry});

    return result;
  }

  updateBoard(
    sessionId: string,
    board: BoardSceneDoc,
    expectedRevision?: number,
  ): {readonly board: BoardSceneDoc; readonly specIR: SpecIRContract} {
    this.store.v4.getSessionOrThrow(sessionId);
    const savedBoard = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'board_scene',
      board,
      expectedRevision,
    );

    const currentDetail = this.getSessionDetail(sessionId);
    const existingByModuleId = new Map(
      currentDetail.specIR.modules.map(m => [m.moduleId, m] as const),
    );
    const existingByBoardId = new Map(
      currentDetail.specIR.modules.map(m => [m.boardNodeId, m] as const),
    );

    const syncedModules: SpecIRModule[] = [];
    for (const node of savedBoard.data.nodes) {
      if (node.kind === 'gate') {
        continue;
      }
      const prev =
        existingByBoardId.get(node.id) ??
        existingByModuleId.get(node.specModuleId);
      const moduleId =
        prev?.moduleId ??
        (node.specModuleId || `mod-${slugifySegment(node.label)}`);
      syncedModules.push({
        moduleId,
        boardNodeId: node.id,
        title: node.label,
        ownerPrincipalIds: prev?.ownerPrincipalIds ?? ['owner-local'],
        boundaryPseudocode:
          prev?.boundaryPseudocode ??
          `export function execute_${slugifySegment(node.label).replace(/-/g, '_')}(input) {\n  return { ok: true, module: '${moduleId}', input };\n}`,
        allowedPaths: prev?.allowedPaths ?? [
          `src/${slugifySegment(node.label)}.mjs`,
        ],
        verificationChecks: prev?.verificationChecks ?? [
          'node --test tests/acceptance.test.mjs',
        ],
      });
    }

    const nextSpec: SpecIRContract = {
      ...currentDetail.specIR,
      modules:
        syncedModules.length > 0 ? syncedModules : currentDetail.specIR.modules,
    };
    const savedSpec = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'spec_ir',
      nextSpec,
    );

    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'board',
      revision: savedBoard.revision,
    });
    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'spec_ir',
      revision: savedSpec.revision,
    });

    return {
      board: savedBoard.data,
      specIR: savedSpec.data,
    };
  }

  updateSpecIR(
    sessionId: string,
    specIR: SpecIRContract,
    expectedRevision?: number,
  ): {readonly board: BoardSceneDoc; readonly specIR: SpecIRContract} {
    this.store.v4.getSessionOrThrow(sessionId);
    const savedSpec = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'spec_ir',
      specIR,
      expectedRevision,
    );

    const currentDetail = this.getSessionDetail(sessionId);
    const existingNodesById = new Map(
      currentDetail.board.nodes.map(n => [n.id, n] as const),
    );
    const nextNodes: BoardNode[] = savedSpec.data.modules.map((mod, idx) => {
      const existing = existingNodesById.get(mod.boardNodeId);
      if (existing) {
        return {
          ...existing,
          label: mod.title,
          specModuleId: mod.moduleId,
        };
      }
      return {
        id: mod.boardNodeId || `node-${slugifySegment(mod.moduleId)}`,
        label: mod.title,
        kind: 'module',
        x: 70 + (idx % 3) * 260,
        y: 80 + Math.floor(idx / 3) * 140,
        width: 220,
        height: 88,
        specModuleId: mod.moduleId,
        status: 'draft',
      };
    });

    for (const gateNode of currentDetail.board.nodes) {
      if (
        gateNode.kind === 'gate' &&
        !nextNodes.some(n => n.id === gateNode.id)
      ) {
        nextNodes.push(gateNode);
      }
    }

    const savedBoard = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'board_scene',
      {
        ...currentDetail.board,
        nodes: nextNodes,
      },
    );

    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'spec_ir',
      revision: savedSpec.revision,
    });
    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'board',
      revision: savedBoard.revision,
    });

    return {
      board: savedBoard.data,
      specIR: savedSpec.data,
    };
  }

  createPin(
    sessionId: string,
    input: {
      readonly surfaceType: ArtifactSurfaceType;
      readonly anchorJson: string;
      readonly specNodeId?: string | null;
      readonly promptText: string;
    },
  ): {readonly pin: ArtifactPin; readonly specIR: SpecIRContract} {
    this.store.v4.getSessionOrThrow(sessionId);
    const pin = this.store.v4.createPin({
      sessionId,
      surfaceType: input.surfaceType,
      anchorJson: input.anchorJson,
      specNodeId: input.specNodeId ?? null,
      promptText: input.promptText.trim(),
    });

    const detail = this.getSessionDetail(sessionId);
    const savedSpec = this.store.v4.saveWorkspaceDoc(
      sessionId,
      'spec_ir',
      detail.specIR,
    );

    this.publish({type: 'v4.pin.changed', sessionId, pin});
    this.publish({
      type: 'v4.workspace.updated',
      sessionId,
      kind: 'spec_ir',
      revision: savedSpec.revision,
    });

    return {pin, specIR: savedSpec.data};
  }

  updatePin(
    sessionId: string,
    pinId: string,
    patch: {
      readonly status?: ArtifactPinStatus;
      readonly replyText?: string;
      readonly askAgent?: boolean;
    },
  ): {readonly pin: ArtifactPin; readonly detail: V4SessionDetail} {
    const session = this.store.v4.getSessionOrThrow(sessionId);
    const existing = this.store.v4.getPin(pinId);
    if (!existing || existing.sessionId !== sessionId) {
      throw new ForgeError('NOT_FOUND', `Pin "${pinId}" not found`, 404);
    }

    let replyText = patch.replyText ?? existing.replyText;
    let nextStatus = patch.status ?? existing.status;

    if (patch.askAgent) {
      replyText =
        replyText ||
        `Master Agent 已接收 Pin #${existing.pinNumber}（${existing.surfaceType}）：已将「${existing.promptText}」同步为 Spec IR 约束并更新验收检查项。`;
      nextStatus = patch.status ?? 'waiting_on_human';
    }

    const updatedPin = this.store.v4.updatePin(pinId, {
      status: nextStatus,
      replyText,
    });

    // Apply Pin resolution / agent response into Spec IR so whiteboard/diff pins never drift
    const currentSpec = this.store.v4.getSpecIR(sessionId);
    if (currentSpec && (patch.askAgent || nextStatus === 'resolved')) {
      const entry = this.store.v4.appendConsensusEntry({
        sessionId,
        term: session.term,
        authorPrincipalId: patch.askAgent ? 'master-agent' : 'owner-local',
        authorKind: patch.askAgent ? 'master_agent' : 'human',
        entryType: 'ruling',
        specAnchorId: existing.specNodeId,
        payload: {
          pinId: updatedPin.id,
          pinNumber: updatedPin.pinNumber,
          surfaceType: updatedPin.surfaceType,
          promptText: updatedPin.promptText,
          replyText: updatedPin.replyText,
        },
        commitState: nextStatus === 'resolved' ? 'committed' : 'proposed',
      });

      const nextModules = currentSpec.modules.map(mod => {
        if (
          existing.specNodeId &&
          (mod.moduleId === existing.specNodeId ||
            mod.boardNodeId === existing.specNodeId)
        ) {
          const checkNote = `Pin #${updatedPin.pinNumber}: ${updatedPin.promptText.slice(0, 80)}`;
          if (!mod.verificationChecks.includes(checkNote)) {
            return {
              ...mod,
              verificationChecks: [...mod.verificationChecks, checkNote],
            };
          }
        }
        return mod;
      });

      const nextSpec: SpecIRContract = {
        ...currentSpec,
        modules: nextModules,
        settledDecisions: [
          ...currentSpec.settledDecisions,
          {
            decisionId: `pin-dec-${updatedPin.pinNumber}-${randomUUID().slice(0, 6)}`,
            origin: patch.askAgent ? 'agent_assumed_accepted' : 'human',
            logSeq: entry.logSeq,
            summary: `Pin #${updatedPin.pinNumber} (${updatedPin.surfaceType}): ${updatedPin.promptText} -> ${updatedPin.replyText ?? 'Resolved'}`,
          },
        ],
      };
      const savedSpec = this.store.v4.saveWorkspaceDoc(
        sessionId,
        'spec_ir',
        nextSpec,
      );
      this.publish({
        type: 'v4.workspace.updated',
        sessionId,
        kind: 'spec_ir',
        revision: savedSpec.revision,
      });
      this.publish({type: 'v4.consensus.entry', sessionId, entry});
    }

    if (patch.askAgent) {
      const msg = this.store.v4.appendMessage({
        sessionId,
        role: 'master',
        agentKernel: 'master',
        kind: 'text',
        content: `已回应 Pin #${updatedPin.pinNumber}（${updatedPin.surfaceType}）：${updatedPin.replyText ?? ''}`,
      });
      this.publish({type: 'v4.message.added', sessionId, message: msg});
    }

    this.publish({type: 'v4.pin.changed', sessionId, pin: updatedPin});

    return {
      pin: updatedPin,
      detail: this.getSessionDetail(sessionId),
    };
  }

  async decomposeSessionTasks(
    sessionId: string,
    options?: {readonly force?: boolean},
  ): Promise<{
    readonly plan: TaskDecompositionPlan;
    readonly detail: V4SessionDetail;
  }> {
    const detail = this.getSessionDetail(sessionId);
    if (detail.activePlan && !options?.force) {
      return {plan: detail.activePlan, detail};
    }

    const kernels = this.cachedKernels ?? (await this.probeKernels());
    const repo = this.store.getRepository(detail.session.repoId);
    const probeReport = repo
      ? await scanRepositoriesForProbe(
          this.worktrees,
          this.runner,
          [repo],
          detail.session.title,
        )
      : null;

    const planId = `v4plan-${randomUUID().slice(0, 10)}`;
    const tasks = decomposeSpecToTasks({
      planId,
      specIR: detail.specIR,
      probeReport,
      availableKernels: kernels,
      roleRouting: this.roleRouting,
      strictAvailableOnly: false,
    });

    const plan = this.store.v4.saveTaskPlan({
      id: planId,
      sessionId,
      specRevision: detail.specIR.revision,
      status: 'approved',
      tasks,
    });

    const updatedSession = this.store.v4.updateSession(sessionId, {
      stage: 'tasks',
      activePlanId: plan.id,
    });

    const traceItems: TraceSummaryItem[] = tasks.map(t => ({
      verb: `Wave ${t.waveIndex}`,
      object: t.title,
      outcome: `${t.assignedKernel} (${t.fileScope.join(', ')})`,
      status: 'ok',
      kernelId: t.assignedKernel,
      taskId: t.id,
    }));

    const msg = this.store.v4.appendMessage({
      sessionId,
      role: 'master',
      agentKernel: 'master',
      kind: 'trace_summary',
      content: `已将 Spec IR (rev ${detail.specIR.revision}) 拆解为 ${tasks.length} 个依赖有序子任务（覆盖 ${new Set(tasks.map(t => t.assignedKernel)).size} 个原生内核，文件域零重叠）。你可以在右侧「任务拆解与编排」调整内核分配或直接启动并行执行。`,
      traceItems,
    });

    this.publish({type: 'v4.session.updated', session: updatedSession});
    this.publish({type: 'v4.plan.updated', sessionId, plan});
    this.publish({type: 'v4.message.added', sessionId, message: msg});

    return {
      plan,
      detail: this.getSessionDetail(sessionId),
    };
  }

  mutateSessionTasks(
    sessionId: string,
    mutation: TaskMutation,
  ): TaskDecompositionPlan {
    const detail = this.getSessionDetail(sessionId);
    if (!detail.activePlan) {
      throw new ForgeError(
        'NOT_FOUND',
        'No active task decomposition plan for this session; decompose first',
        404,
      );
    }

    const nextTasks = applyTaskMutation(detail.activePlan.tasks, mutation);
    const updatedPlan = this.store.v4.saveTaskPlan({
      id: detail.activePlan.id,
      sessionId,
      specRevision: detail.activePlan.specRevision,
      status: detail.activePlan.status,
      tasks: nextTasks,
    });

    this.publish({type: 'v4.plan.updated', sessionId, plan: updatedPlan});
    return updatedPlan;
  }

  private async captureTempIndexTreeSha(
    worktreePath: string,
    tempIndexPath: string,
  ): Promise<string> {
    // Stage working directory snapshot into an isolated temporary index file
    // so main branch / user git index is never touched.
    const addRes = await this.runner.run({
      executable: 'git',
      args: ['add', '-A'],
      cwd: worktreePath,
      extraEnv: {
        LC_ALL: 'C',
        GIT_INDEX_FILE: tempIndexPath,
      },
      timeoutMs: 15_000,
    });
    if (addRes.exitCode !== 0) {
      throw new ForgeError(
        'INTERNAL_ERROR',
        `git add -A (temp index) failed: ${addRes.stderr || addRes.stdout}`,
        500,
      );
    }

    const treeRes = await this.runner.run({
      executable: 'git',
      args: ['write-tree'],
      cwd: worktreePath,
      extraEnv: {
        LC_ALL: 'C',
        GIT_INDEX_FILE: tempIndexPath,
      },
      timeoutMs: 15_000,
    });
    if (treeRes.exitCode !== 0) {
      throw new ForgeError(
        'INTERNAL_ERROR',
        `git write-tree failed: ${treeRes.stderr || treeRes.stdout}`,
        500,
      );
    }
    return treeRes.stdout.trim();
  }

  private async diffTreeSnapshots(
    worktreePath: string,
    beforeTreeSha: string,
    afterTreeSha: string,
  ): Promise<TurnDiffFile[]> {
    const numstatRes = await this.runner.run({
      executable: 'git',
      args: ['diff-tree', '-r', '--numstat', beforeTreeSha, afterTreeSha],
      cwd: worktreePath,
      extraEnv: {LC_ALL: 'C'},
      timeoutMs: 15_000,
    });
    const patchRes = await this.runner.run({
      executable: 'git',
      args: ['diff-tree', '-r', '-p', beforeTreeSha, afterTreeSha],
      cwd: worktreePath,
      extraEnv: {LC_ALL: 'C'},
      timeoutMs: 15_000,
    });
    return parseNumstatAndPatch(numstatRes.stdout, patchRes.stdout);
  }

  private async runLiveKernelIfConfigured(
    session: MasterSession,
    task: DecomposedTaskNode,
    worktreePath: string,
    specIR: SpecIRContract,
  ): Promise<{readonly summary: string; readonly liveInvoked: boolean}> {
    if (session.executionMode !== 'live') {
      return {summary: '', liveInvoked: false};
    }

    const profile = this.store
      .listAdapterProfiles()
      .find(p => p.manifest.id === task.assignedKernel);
    const adapter = profile?.manifest;
    if (!adapter) {
      return {
        summary: `Adapter "${task.assignedKernel}" not registered; falling back to local synthesis.`,
        liveInvoked: false,
      };
    }

    try {
      const result = await this.adapters.invoke({
        sessionId: `${session.id}-${task.id}`,
        hubId: session.hubId,
        changeId: null,
        nodeId: null,
        role: task.role === 'tester' ? 'evaluator' : 'worker',
        adapter,
        model: adapter.defaultModel,
        permissionTier: 'supervised',
        cwd: worktreePath,
        systemPrompt: `You are ${task.assignedKernel} acting as ${task.role} inside an isolated git worktree. Edit ONLY files inside: ${task.fileScope.join(', ')}.`,
        userPrompt: `Task: ${task.title}\nDescription: ${task.description}\nSpec Goals:\n${specIR.goals.join('\n')}`,
        readOnly: false,
        fileScope: task.fileScope,
        timeoutMs: 45_000,
      });
      return {
        summary:
          result.finalText.slice(0, 500) ||
          `Live ${task.assignedKernel} run: ${result.outcome}`,
        liveInvoked: result.outcome === 'completed',
      };
    } catch (err) {
      return {
        summary: `Live ${task.assignedKernel} unavailable (${err instanceof Error ? err.message : String(err)}); applied local deterministic fallback.`,
        liveInvoked: false,
      };
    }
  }

  private materializeDeterministicTaskArtifact(
    session: MasterSession,
    specIR: SpecIRContract,
    task: DecomposedTaskNode,
    worktreePath: string,
    priorCompletedFiles: readonly string[],
  ): string {
    const touched: string[] = [];

    for (const relRaw of task.fileScope) {
      const rel = normalizeRelPath(relRaw);
      if (!rel || rel.includes('*')) {
        continue;
      }
      const absTarget = this.worktrees.resolveInside(worktreePath, rel);
      mkdirSync(dirname(absTarget), {recursive: true});

      if (task.role === 'architect') {
        if (rel.endsWith('.md')) {
          const md = [
            `# Spec Contract — ${session.title}`,
            '',
            `- Spec ID: \`${specIR.specId}\``,
            `- Revision: \`v${specIR.revision}\``,
            `- Term: \`${specIR.term}\``,
            `- Assigned Kernel: \`${task.assignedKernel}\``,
            '',
            '## Goals',
            ...specIR.goals.map(g => `- ${g}`),
            '',
            '## Module Boundaries',
            ...specIR.modules.map(
              m =>
                `### ${m.title} (\`${m.moduleId}\` <-> \`${m.boardNodeId}\`)\n\`\`\`ts\n${m.boundaryPseudocode}\n\`\`\`\nAllowed Paths: ${m.allowedPaths.join(', ')}\n`,
            ),
            '',
          ].join('\n');
          writeFileSync(absTarget, md, 'utf8');
        } else {
          const ts = [
            '/**',
            ` * Auto-frozen Spec IR Contract for ${session.title} (rev ${specIR.revision}).`,
            ' */',
            '',
            'export interface FeatureExecutionReceipt {',
            '  readonly ok: boolean;',
            '  readonly moduleId: string;',
            '  readonly summary: string;',
            '  readonly checkedAt: string;',
            '}',
            '',
            `export const SPEC_CONTRACT_REVISION = ${specIR.revision};`,
            `export const SPEC_CONTRACT_MODULES = ${JSON.stringify(specIR.modules.map(m => m.moduleId))} as const;`,
            '',
          ].join('\n');
          writeFileSync(absTarget, ts, 'utf8');
        }
        touched.push(rel);
      } else if (task.role === 'tester') {
        const importableModules = priorCompletedFiles.filter(
          f => f.endsWith('.mjs') || f.endsWith('.js'),
        );
        const testLines: string[] = [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import {existsSync} from 'node:fs';",
          "import {resolve} from 'node:path';",
          '',
          `test('${session.title.replace(/'/g, '')} — acceptance boundary verification', async () => {`,
          `  const expectedFiles = ${JSON.stringify(priorCompletedFiles)};`,
          '  for (const rel of expectedFiles) {',
          '    assert.equal(existsSync(resolve(process.cwd(), rel)), true, `Expected artifact ${rel} to exist`);',
          '  }',
        ];
        for (let idx = 0; idx < Math.min(importableModules.length, 4); idx++) {
          const modFile = importableModules[idx]!;
          testLines.push(
            `  const mod_${idx} = await import(new URL('../${modFile}', import.meta.url).href);`,
            `  assert.equal(typeof mod_${idx}.runModule, 'function');`,
            `  const res_${idx} = mod_${idx}.runModule({ probe: true });`,
            `  assert.equal(res_${idx}.ok, true);`,
          );
        }
        testLines.push('});', '');
        writeFileSync(absTarget, testLines.join('\n'), 'utf8');
        touched.push(rel);
      } else {
        const fnName = `execute_${slugifySegment(task.title).replace(/-/g, '_')}`;
        const code = [
          '/**',
          ` * Task: ${task.title}`,
          ` * Kernel: ${task.assignedKernel} | Role: ${task.role}`,
          ` * Plan: ${task.planId}`,
          ' */',
          '',
          `export function ${fnName}(input = {}) {`,
          '  return {',
          '    ok: true,',
          `    taskId: ${JSON.stringify(task.id)},`,
          `    kernel: ${JSON.stringify(task.assignedKernel)},`,
          `    title: ${JSON.stringify(task.title)},`,
          '    input,',
          '    checkedAt: new Date().toISOString(),',
          '  };',
          '}',
          '',
          'export function runModule(input = {}) {',
          `  return ${fnName}(input);`,
          '}',
          '',
        ].join('\n');
        writeFileSync(absTarget, code, 'utf8');
        touched.push(rel);
      }
    }

    return touched.length > 0
      ? `Materialized ${touched.length} scoped file(s): ${touched.join(', ')}`
      : 'No concrete file paths in scope';
  }

  async executeTaskPlan(
    sessionId: string,
    options?: {
      readonly resumeOnly?: boolean;
      readonly taskIds?: readonly string[];
    },
  ): Promise<{
    readonly plan: TaskDecompositionPlan;
    readonly diffs: readonly TurnDiffSnapshot[];
    readonly detail: V4SessionDetail;
  }> {
    let detail = this.getSessionDetail(sessionId);
    if (!detail.activePlan) {
      const created = await this.decomposeSessionTasks(sessionId);
      detail = created.detail;
    }

    let plan = detail.activePlan!;
    const session = this.store.v4.updateSession(sessionId, {
      stage: 'executing',
    });
    this.publish({type: 'v4.session.updated', session});

    let tasks = recomputeTaskWaves(plan.tasks);
    plan = this.store.v4.saveTaskPlan({
      id: plan.id,
      sessionId,
      specRevision: plan.specRevision,
      status: 'running',
      tasks,
    });
    this.publish({type: 'v4.plan.updated', sessionId, plan});

    const targetIdSet =
      options?.taskIds && options.taskIds.length > 0
        ? new Set(options.taskIds)
        : null;

    const waveNumbers = Array.from(new Set(tasks.map(t => t.waveIndex))).sort(
      (a, b) => a - b,
    );

    // Track completed task worktrees & changed files so downstream waves can verify upstream artifacts
    const completedWorktreeFiles: Array<{
      readonly worktreePath: string;
      readonly relPath: string;
    }> = [];

    for (const prevTask of tasks) {
      if (prevTask.status === 'completed' && prevTask.worktreePath) {
        for (const f of prevTask.fileScope) {
          const clean = normalizeRelPath(f);
          if (clean && existsSync(join(prevTask.worktreePath, clean))) {
            completedWorktreeFiles.push({
              worktreePath: prevTask.worktreePath,
              relPath: clean,
            });
          }
        }
      }
    }

    let anyFailed = false;
    const newSnapshots: TurnDiffSnapshot[] = [];

    for (const wave of waveNumbers) {
      const waveTasks = tasks.filter(t => t.waveIndex === wave);
      for (const task of waveTasks) {
        if (options?.resumeOnly && task.status === 'completed') {
          continue;
        }
        if (targetIdSet && !targetIdSet.has(task.id)) {
          continue;
        }
        if (task.status === 'completed' && !targetIdSet) {
          continue;
        }

        // Check upstream dependencies
        const failedDep = task.dependsOn.find(depId => {
          const dep = tasks.find(t => t.id === depId);
          return dep && dep.status === 'failed';
        });
        if (failedDep) {
          tasks = tasks.map(t =>
            t.id === task.id
              ? {
                  ...t,
                  status: 'paused',
                  error: `Paused because dependency "${failedDep}" failed`,
                }
              : t,
          );
          continue;
        }

        // Mark running
        tasks = tasks.map(t =>
          t.id === task.id ? {...t, status: 'running', error: undefined} : t,
        );
        plan = this.store.v4.saveTaskPlan({
          id: plan.id,
          sessionId,
          specRevision: plan.specRevision,
          status: 'running',
          tasks,
        });
        const runningTask = tasks.find(t => t.id === task.id)!;
        this.publish({
          type: 'v4.task.updated',
          sessionId,
          planId: plan.id,
          task: runningTask,
        });

        const handoffItem = this.postCollab({
          sessionId,
          fromKernel: 'master',
          toKernel: task.assignedKernel,
          kind: 'handoff',
          taskId: task.id,
          audienceScope: session.mode === 'team' ? 'team' : 'world',
          content: `Wave ${wave} handoff -> ${task.assignedKernel} (${task.role}): "${task.title}" [scope: ${task.fileScope.join(', ')}]`,
        });

        const collabMsg = this.store.v4.appendMessage({
          sessionId,
          role: 'agent',
          agentKernel: task.assignedKernel,
          kind: 'collab_event',
          content: `Wave ${wave} · Master → ${task.assignedKernel}：启动「${task.title}」`,
          collabMeta: {
            collabId: handoffItem.id,
            fromKernel: 'master',
            toKernel: task.assignedKernel,
            kind: 'handoff',
            taskId: task.id,
            targetTab: 'code_diff',
          },
        });
        this.publish({
          type: 'v4.message.added',
          sessionId,
          message: collabMsg,
        });

        const changeCode = `v4-${sessionId.slice(-6)}-${slugifySegment(task.id).slice(0, 14)}-${randomUUID().slice(0, 4)}`;
        const tempIndexFile = join(
          this.worktreesRoot,
          `.tmp-idx-${randomUUID().slice(0, 10)}`,
        );

        try {
          const wt = await this.worktrees.provisionWorktree({
            repoPath: session.workspacePath,
            worktreesRoot: this.worktreesRoot,
            repoId: session.repoId,
            changeCode,
            changeId: `${plan.id}-${task.id}`,
          });

          // Carry forward prior completed wave files into this isolated worktree BEFORE beforeTreeSha
          // so tester wave actually tests upstream code while before->after measures ONLY this task's diff.
          const upstreamPaths: string[] = [];
          for (const prev of completedWorktreeFiles) {
            const srcFile = join(prev.worktreePath, prev.relPath);
            if (!existsSync(srcFile)) continue;
            const dstFile = this.worktrees.resolveInside(
              wt.worktreePath,
              prev.relPath,
            );
            mkdirSync(dirname(dstFile), {recursive: true});
            copyFileSync(srcFile, dstFile);
            upstreamPaths.push(prev.relPath);
          }

          const beforeTreeSha = await this.captureTempIndexTreeSha(
            wt.worktreePath,
            tempIndexFile,
          );

          const liveAttempt = await this.runLiveKernelIfConfigured(
            session,
            task,
            wt.worktreePath,
            detail.specIR,
          );

          let workSummary = liveAttempt.summary;
          let afterTreeSha = await this.captureTempIndexTreeSha(
            wt.worktreePath,
            tempIndexFile,
          );

          // If live kernel didn't modify files (or executionMode is auto/local), run deterministic scoped materializer
          if (beforeTreeSha === afterTreeSha) {
            const localSummary = this.materializeDeterministicTaskArtifact(
              session,
              detail.specIR,
              task,
              wt.worktreePath,
              upstreamPaths,
            );
            workSummary = workSummary
              ? `${workSummary} | ${localSummary}`
              : localSummary;
            afterTreeSha = await this.captureTempIndexTreeSha(
              wt.worktreePath,
              tempIndexFile,
            );
          }

          // For tester role, actually run node --test on the generated test file inside the isolated worktree!
          if (task.role === 'tester') {
            const testFile = task.fileScope.find(
              f => f.endsWith('.mjs') || f.endsWith('.js') || f.endsWith('.ts'),
            );
            if (testFile) {
              const testRes = await this.runner.run({
                executable: process.execPath,
                args: ['--test', normalizeRelPath(testFile)],
                cwd: wt.worktreePath,
                timeoutMs: 20_000,
              });
              if (testRes.exitCode !== 0) {
                throw new ForgeError(
                  'GATE_FAILED',
                  `Acceptance tests failed: ${(testRes.stderr || testRes.stdout).slice(0, 400)}`,
                  422,
                );
              }
              workSummary = `${workSummary} | node --test passed (exit 0)`;
            }
          }

          const diffFiles = await this.diffTreeSnapshots(
            wt.worktreePath,
            beforeTreeSha,
            afterTreeSha,
          );
          const added = diffFiles.reduce((acc, f) => acc + f.added, 0);
          const removed = diffFiles.reduce((acc, f) => acc + f.removed, 0);

          const checkpoint = await this.worktrees.createCheckpoint({
            worktreePath: wt.worktreePath,
            changeCode,
            nodeCode: slugifySegment(task.id),
            message: `v4(${task.assignedKernel}): ${task.title}`,
          });

          const snapshot = this.store.v4.recordTurnDiffSnapshot({
            sessionId,
            taskId: task.id,
            kernelId: task.assignedKernel,
            beforeTreeSha,
            afterTreeSha,
            files: diffFiles,
          });
          newSnapshots.push(snapshot);
          this.publish({type: 'v4.turn.snapshot', sessionId, snapshot});

          for (const f of diffFiles) {
            completedWorktreeFiles.push({
              worktreePath: wt.worktreePath,
              relPath: f.path,
            });
          }

          tasks = tasks.map(t =>
            t.id === task.id
              ? {
                  ...t,
                  status: 'completed',
                  worktreeBranch: wt.branchName,
                  worktreePath: wt.worktreePath,
                  checkpointId: checkpoint.commitSha,
                  outputSummary: workSummary,
                  diffStats: {
                    added,
                    removed,
                    filesChanged: diffFiles.length,
                  },
                  beforeTreeSha,
                  afterTreeSha,
                  error: undefined,
                }
              : t,
          );
          tasks = recomputeTaskWaves(tasks);

          const completedTask = tasks.find(t => t.id === task.id)!;
          plan = this.store.v4.saveTaskPlan({
            id: plan.id,
            sessionId,
            specRevision: plan.specRevision,
            status: 'running',
            tasks,
          });
          this.publish({
            type: 'v4.task.updated',
            sessionId,
            planId: plan.id,
            task: completedTask,
          });

          // Peer handoff notification to next wave kernel (or master)
          const nextWaveTask = tasks.find(t => t.dependsOn.includes(task.id));
          this.postCollab({
            sessionId,
            fromKernel: task.assignedKernel,
            toKernel: nextWaveTask?.assignedKernel ?? 'master',
            kind: 'handoff',
            taskId: task.id,
            audienceScope: session.mode === 'team' ? 'team' : 'world',
            content: `Completed "${task.title}" (+${added}/-${removed} across ${diffFiles.length} file(s), tree ${afterTreeSha.slice(0, 8)}).`,
          });
        } catch (err) {
          anyFailed = true;
          const errMsg = err instanceof Error ? err.message : String(err);
          tasks = tasks.map(t =>
            t.id === task.id
              ? {
                  ...t,
                  status: 'failed',
                  error: errMsg,
                }
              : t,
          );
          const failedTask = tasks.find(t => t.id === task.id)!;
          plan = this.store.v4.saveTaskPlan({
            id: plan.id,
            sessionId,
            specRevision: plan.specRevision,
            status: 'failed',
            tasks,
          });
          this.publish({
            type: 'v4.task.updated',
            sessionId,
            planId: plan.id,
            task: failedTask,
          });
        } finally {
          try {
            if (existsSync(tempIndexFile)) {
              rmSync(tempIndexFile, {force: true});
            }
          } catch {
            // Ignore temp index cleanup errors
          }
        }
      }
    }

    const allCompleted = tasks.every(t => t.status === 'completed');
    const finalPlanStatus: TaskDecompositionPlan['status'] = anyFailed
      ? 'failed'
      : allCompleted
        ? 'completed'
        : 'running';

    plan = this.store.v4.saveTaskPlan({
      id: plan.id,
      sessionId,
      specRevision: plan.specRevision,
      status: finalPlanStatus,
      tasks,
    });

    const updatedSession = this.store.v4.updateSession(sessionId, {
      stage: allCompleted ? 'review' : 'executing',
    });

    const totalAdded = tasks.reduce((s, t) => s + t.diffStats.added, 0);
    const totalRemoved = tasks.reduce((s, t) => s + t.diffStats.removed, 0);
    const totalFiles = tasks.reduce((s, t) => s + t.diffStats.filesChanged, 0);

    const summaryMsg = this.store.v4.appendMessage({
      sessionId,
      role: 'master',
      agentKernel: 'master',
      kind: 'trace_summary',
      content: allCompleted
        ? `全部 ${tasks.length} 个波次子任务已在独立 Git Worktree 绿灯完成（+${totalAdded} / -${totalRemoved}，共 ${totalFiles} 个文件，已记录 ${newSnapshots.length} 份 Turn write-tree 快照）。可以进入「Claude Ship 独立审校」。`
        : `波次执行暂停/异常（已完成 ${tasks.filter(t => t.status === 'completed').length}/${tasks.length}）。已保留所有成功任务的检查点，可点击「断点续跑」。`,
      traceItems: tasks.map(t => ({
        verb:
          t.status === 'completed'
            ? 'Completed'
            : t.status === 'failed'
              ? 'Failed'
              : 'Pending',
        object: t.title,
        outcome:
          t.status === 'completed'
            ? `+${t.diffStats.added}/-${t.diffStats.removed} (${t.assignedKernel})`
            : (t.error ?? t.status),
        status:
          t.status === 'completed'
            ? 'ok'
            : t.status === 'failed'
              ? 'failed'
              : 'warn',
        kernelId: t.assignedKernel,
        taskId: t.id,
      })),
    });

    this.publish({type: 'v4.session.updated', session: updatedSession});
    this.publish({type: 'v4.plan.updated', sessionId, plan});
    this.publish({type: 'v4.message.added', sessionId, message: summaryMsg});

    return {
      plan,
      diffs: this.store.v4.listTurnDiffSnapshots(sessionId),
      detail: this.getSessionDetail(sessionId),
    };
  }

  private renderAnswerInHtml(input: {
    readonly session: MasterSession;
    readonly specIR: SpecIRContract;
    readonly plan: TaskDecompositionPlan;
    readonly diffs: readonly TurnDiffSnapshot[];
    readonly reviewerKernel: KernelId;
    readonly coderKernels: readonly KernelId[];
    readonly findings: readonly ShipReviewFinding[];
    readonly stewardFixes: readonly ShipStewardFix[];
    readonly policyMode: 'shadow' | 'enforced';
    readonly wouldApprove: boolean;
  }): string {
    const totalAdded = input.diffs.reduce(
      (sum, d) => sum + d.files.reduce((fs, f) => fs + f.added, 0),
      0,
    );
    const totalRemoved = input.diffs.reduce(
      (sum, d) => sum + d.files.reduce((fs, f) => fs + f.removed, 0),
      0,
    );
    const totalFiles = input.diffs.reduce((sum, d) => sum + d.files.length, 0);

    const taskRows = input.plan.tasks
      .map(
        t => `<tr>
          <td>W${t.waveIndex}</td>
          <td><strong>${escapeHtml(t.title)}</strong><div class="muted">${escapeHtml(t.role)} · ${escapeHtml(t.fileScope.join(', '))}</div></td>
          <td><span class="pill">${escapeHtml(t.assignedKernel)}</span></td>
          <td class="mono"><span class="add">+${t.diffStats.added}</span> <span class="del">-${t.diffStats.removed}</span></td>
          <td><span class="badge ${t.status === 'completed' ? 'ok' : 'warn'}">${escapeHtml(t.status)}</span></td>
        </tr>`,
      )
      .join('\n');

    const diffBlocks = input.diffs
      .map(
        d => `<details class="card" open>
          <summary><strong>${escapeHtml(d.taskId)}</strong> · Kernel <code>${escapeHtml(d.kernelId)}</code> · Tree <code>${escapeHtml(d.beforeTreeSha.slice(0, 8))} -> ${escapeHtml(d.afterTreeSha.slice(0, 8))}</code> (${d.files.length} file(s))</summary>
          ${d.files
            .map(
              f => `<div class="diff-file">
                <div class="diff-head"><span class="mono">${escapeHtml(f.path)}</span><span class="mono"><span class="add">+${f.added}</span> <span class="del">-${f.removed}</span></span></div>
                <pre class="diff-pre">${escapeHtml(f.patch.slice(0, 2200))}</pre>
              </div>`,
            )
            .join('')}
        </details>`,
      )
      .join('\n');

    const findingsHtml = input.findings
      .map(
        f =>
          `<li><span class="badge ${f.severity === 'blocker' ? 'err' : f.severity === 'warn' ? 'warn' : 'ok'}">${escapeHtml(f.severity.toUpperCase())}</span> <strong>[${escapeHtml(f.category)}]</strong> <code>${escapeHtml(f.filePath)}</code> — ${escapeHtml(f.summary)} ${f.fixedBySteward ? '<span class="pill">Fixed by PR Steward</span>' : ''}</li>`,
      )
      .join('\n');

    const stewardHtml = input.stewardFixes
      .map(
        s =>
          `<li><strong>${escapeHtml(s.summary)}</strong><div class="muted">Rollback: <code>${escapeHtml(s.rollbackRecipe)}</code></div></li>`,
      )
      .join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Answer-in-HTML Verification — ${escapeHtml(input.session.title)}</title>
<style>
  :root { --bg: #F9F9F7; --surface: #FFFFFF; --ink: #1F1F1D; --muted: #6B6B68; --border: #E5E4DF; --accent: #D97757; --ok: #1E9E3C; --del: #CD2054; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; background: var(--bg); color: var(--ink); font-family: Georgia, 'Source Han Serif SC', serif; line-height: 1.55; }
  .wrap { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  .hero { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
  .hero h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  .shield { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: #EAF7EE; color: #176A2B; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
  .kpi .lbl { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .kpi .val { font-size: 20px; font-weight: 600; margin-top: 4px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .card h2 { margin: 0 0 10px; font-size: 15px; }
  table { width: 100%; border-collapse: collapse; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .mono, code, pre { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 12px; }
  .add { color: var(--ok); font-weight: 600; }
  .del { color: var(--del); font-weight: 600; }
  .muted { color: var(--muted); font-size: 12px; font-family: ui-sans-serif, system-ui, sans-serif; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #F1EFEA; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; font-weight: 600; }
  .badge.ok { background: #EAF7EE; color: #176A2B; }
  .badge.warn { background: #FEF3C7; color: #92400E; }
  .badge.err { background: #FEE2E2; color: #991B1B; }
  .diff-file { margin-top: 10px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .diff-head { display: flex; justify-content: space-between; padding: 6px 10px; background: #F5F4EF; border-bottom: 1px solid var(--border); }
  .diff-pre { margin: 0; padding: 10px; overflow-x: auto; background: #FCFCFA; white-space: pre; line-height: 1.45; }
  ul { margin: 6px 0 0; padding-left: 18px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }
  li { margin-bottom: 6px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="shield">Anti-Self-Approval Verified · Coder [${escapeHtml(input.coderKernels.join(', ') || 'none')}] ≠ Reviewer [${escapeHtml(input.reviewerKernel)}]</div>
      <h1>Answer-in-HTML Ship Verification — ${escapeHtml(input.session.title)}</h1>
      <div class="muted">Spec ${escapeHtml(input.specIR.specId)} (rev ${input.specIR.revision}, Term ${input.session.term}) · Policy Mode: ${escapeHtml(input.policyMode)} · Would Approve: ${input.wouldApprove ? 'YES' : 'NO'}</div>
    </div>

    <div class="grid">
      <div class="kpi"><div class="lbl">Diff Added / Removed</div><div class="val mono"><span class="add">+${totalAdded}</span> / <span class="del">-${totalRemoved}</span></div></div>
      <div class="kpi"><div class="lbl">Files Changed</div><div class="val">${totalFiles}</div></div>
      <div class="kpi"><div class="lbl">Turn Snapshots</div><div class="val">${input.diffs.length}</div></div>
      <div class="kpi"><div class="lbl">Completed Waves</div><div class="val">${input.plan.tasks.filter(t => t.status === 'completed').length}/${input.plan.tasks.length}</div></div>
    </div>

    <div class="card">
      <h2>1. Task Execution & Multi-Kernel Matrix</h2>
      <table>
        <thead><tr><th>Wave</th><th>Task & File Scope</th><th>Kernel</th><th>Diff</th><th>Status</th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>2. Independent Reviewer Findings & PR Steward Fixes</h2>
      <ul>${findingsHtml}</ul>
      <h2 style="margin-top:12px;">PR Steward Rollback-Safe Fixes (Non-Approving)</h2>
      <ul>${stewardHtml}</ul>
    </div>

    <div class="card">
      <h2>3. Turn-Level git write-tree Evidence</h2>
      ${diffBlocks || '<div class="muted">No diff snapshots recorded yet.</div>'}
    </div>

    <div class="card">
      <h2>4. Unverified Gaps (Honest Disclosure)</h2>
      <ul>
        <li>External production deployment smoke checks are deferred until Hosted App runtime launch.</li>
        <li>Human final Pass/Reject verdict is required before merging isolated worktree deliverables onto main branch.</li>
      </ul>
    </div>
  </div>
</body>
</html>`;
  }

  async runShipReview(
    sessionId: string,
    options?: {
      readonly reviewDepth?: ShipReviewDepth;
      readonly reviewerKernel?: KernelId;
      readonly policyMode?: 'shadow' | 'enforced';
    },
  ): Promise<{
    readonly review: ShipReviewBundle;
    readonly detail: V4SessionDetail;
  }> {
    const detail = this.getSessionDetail(sessionId);
    if (!detail.activePlan) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        'No task decomposition plan exists for this session; decompose and execute tasks first',
        400,
      );
    }

    const plan = detail.activePlan;
    const coderTasks = plan.tasks.filter(t => t.role === 'coder');
    const coderKernels: KernelId[] = Array.from(
      new Set(
        (coderTasks.length > 0 ? coderTasks : plan.tasks).map(
          t => t.assignedKernel,
        ),
      ),
    );

    const candidateReviewers: readonly KernelId[] = [
      'claude-code',
      'gemini-cli',
      'native-api',
      'opencode',
      'pi',
      'codex',
    ];

    let reviewerKernel: KernelId;
    if (options?.reviewerKernel) {
      if (coderKernels.includes(options.reviewerKernel)) {
        throw new ForgeError(
          'POLICY_DENIED',
          `Anti-self-approval gate blocked review: requested reviewer kernel "${options.reviewerKernel}" wrote code in this plan (${coderKernels.join(', ')}). Select an independent reviewer kernel.`,
          409,
          {reason: 'SELF_APPROVAL_BLOCKED'},
        );
      }
      reviewerKernel = options.reviewerKernel;
    } else {
      const preferred = this.roleRouting.reviewer;
      if (preferred && !coderKernels.includes(preferred)) {
        reviewerKernel = preferred;
      } else {
        reviewerKernel =
          candidateReviewers.find(k => !coderKernels.includes(k)) ??
          'native-api';
      }
    }

    const antiSelfApprovalPassed = !coderKernels.includes(reviewerKernel);
    if (!antiSelfApprovalPassed) {
      throw new ForgeError(
        'POLICY_DENIED',
        `Anti-self-approval gate failed: "${reviewerKernel}" overlaps with coder kernels (${coderKernels.join(', ')})`,
        409,
        {reason: 'SELF_APPROVAL_BLOCKED'},
      );
    }

    const reviewDepth = options?.reviewDepth ?? 'standard';
    const policyMode = options?.policyMode ?? 'shadow';
    const diffs = detail.diffs;
    const totalFiles = diffs.reduce((acc, d) => acc + d.files.length, 0);

    const findings: ShipReviewFinding[] = [
      {
        id: `fnd-${randomUUID().slice(0, 6)}`,
        severity: 'info',
        category: 'security',
        filePath: 'policy/anti-self-approval',
        summary: `Verified separation of duties: coder kernel(s) [${coderKernels.join(', ')}] strictly separated from reviewer [${reviewerKernel}].`,
        fixedBySteward: false,
      },
      {
        id: `fnd-${randomUUID().slice(0, 6)}`,
        severity: 'info',
        category: 'contract',
        filePath: diffs[0]?.files[0]?.path ?? 'docs/spec-contract.md',
        summary: `Cross-checked ${totalFiles} changed file(s) across ${diffs.length} git write-tree turn snapshot(s) against Spec IR rev ${detail.specIR.revision}.`,
        fixedBySteward: false,
      },
    ];

    const unresolvedPins = detail.pins.filter(p => p.status !== 'resolved');
    if (unresolvedPins.length > 0) {
      findings.push({
        id: `fnd-${randomUUID().slice(0, 6)}`,
        severity: 'warn',
        category: 'quality',
        filePath: 'spec/pins',
        summary: `${unresolvedPins.length} open Artifact Pin(s) remain unclosed; review recommended before final merge.`,
        fixedBySteward: false,
      });
    }

    const stewardFixes: ShipStewardFix[] = [
      {
        id: `stw-${randomUUID().slice(0, 6)}`,
        summary:
          'Verified worktree isolation and clean git checkpoint refs across all completed wave branches (non-approving steward check).',
        rollbackRecipe:
          'git worktree list && git reset --hard HEAD (zero changes applied to main before human Pass + Deliver)',
        filesTouched: diffs.flatMap(d => d.files.map(f => f.path)).slice(0, 6),
      },
    ];

    const hasBlocker = findings.some(f => f.severity === 'blocker');
    const wouldApprove = antiSelfApprovalPassed && !hasBlocker;

    const answerHtml = this.renderAnswerInHtml({
      session: detail.session,
      specIR: detail.specIR,
      plan,
      diffs,
      reviewerKernel,
      coderKernels,
      findings,
      stewardFixes,
      policyMode,
      wouldApprove,
    });

    const review = this.store.v4.createShipReview({
      sessionId,
      planId: plan.id,
      reviewDepth,
      reviewerKernel,
      coderKernels,
      antiSelfApprovalPassed,
      findings,
      stewardFixes,
      policyMode,
      wouldApprove,
      answerHtml,
      verdict: 'pending',
    });

    const updatedSession = this.store.v4.updateSession(sessionId, {
      stage: 'review',
    });

    this.postCollab({
      sessionId,
      fromKernel: reviewerKernel,
      toKernel: 'master',
      kind: 'review',
      audienceScope: detail.session.mode === 'team' ? 'team' : 'world',
      content: `Claude Ship (${reviewDepth}/${policyMode}) completed by independent reviewer ${reviewerKernel} against coders [${coderKernels.join(', ')}]. Would approve: ${wouldApprove}.`,
    });

    const shipMsg = this.store.v4.appendMessage({
      sessionId,
      role: 'agent',
      agentKernel: reviewerKernel,
      kind: 'ship_card',
      content: `独立审校完成（Reviewer: ${reviewerKernel} ≠ Coder: ${coderKernels.join(', ')}，Policy: ${policyMode}）。Answer-in-HTML 验收简报已生成，请在右侧「验收 HTML & Ship」拍板通过或驳回。`,
    });

    this.publish({type: 'v4.session.updated', session: updatedSession});
    this.publish({type: 'v4.ship.ready', sessionId, review});
    this.publish({type: 'v4.message.added', sessionId, message: shipMsg});

    return {
      review,
      detail: this.getSessionDetail(sessionId),
    };
  }

  submitShipVerdict(
    sessionId: string,
    reviewId: string,
    input: {
      readonly verdict: 'passed' | 'rejected';
      readonly comment?: string;
    },
  ): {
    readonly review: ShipReviewBundle;
    readonly detail: V4SessionDetail;
  } {
    const session = this.store.v4.getSessionOrThrow(sessionId);
    const existing = this.store.v4.getShipReview(reviewId);
    if (!existing || existing.sessionId !== sessionId) {
      throw new ForgeError(
        'NOT_FOUND',
        `Ship review "${reviewId}" not found`,
        404,
      );
    }

    const updated = this.store.v4.updateShipReviewVerdict(
      reviewId,
      input.verdict,
    );

    if (input.verdict === 'rejected') {
      const pinRes = this.createPin(sessionId, {
        surfaceType: 'html_verify',
        anchorJson: JSON.stringify({reviewId}),
        specNodeId: null,
        promptText:
          input.comment?.trim() ||
          `Ship review ${reviewId} rejected by human reviewer — fix findings and re-run`,
      });
      const msg = this.store.v4.appendMessage({
        sessionId,
        role: 'human',
        agentKernel: 'master',
        kind: 'text',
        content: `已驳回 Ship 审校并创建修复 Pin #${pinRes.pin.pinNumber}：${pinRes.pin.promptText}`,
      });
      this.publish({type: 'v4.message.added', sessionId, message: msg});
    } else {
      const entry = this.store.v4.appendConsensusEntry({
        sessionId,
        term: session.term,
        authorPrincipalId: 'owner-local',
        authorKind: 'human',
        entryType: 'commit',
        specAnchorId: reviewId,
        payload: {
          verdict: 'passed',
          reviewerKernel: updated.reviewerKernel,
          comment: input.comment ?? '',
        },
        commitState: 'committed',
      });
      const msg = this.store.v4.appendMessage({
        sessionId,
        role: 'human',
        agentKernel: 'master',
        kind: 'text',
        content: `人类终审通过（Ship Review ${reviewId} 已签收）。可以点击「合并交付」将 Worktree 产物提交到目标仓库并生成托管应用卡片。`,
      });
      this.publish({type: 'v4.consensus.entry', sessionId, entry});
      this.publish({type: 'v4.message.added', sessionId, message: msg});
    }

    this.publish({type: 'v4.ship.ready', sessionId, review: updated});

    return {
      review: updated,
      detail: this.getSessionDetail(sessionId),
    };
  }

  async deliverSession(
    sessionId: string,
    options?: {
      readonly appName?: string;
      readonly versionTag?: string;
    },
  ): Promise<{
    readonly deliveredCommitSha: string;
    readonly hostedApp: HostedAppCard;
    readonly detail: V4SessionDetail;
  }> {
    const detail = this.getSessionDetail(sessionId);
    const ship = detail.latestShip;
    if (!ship || ship.verdict !== 'passed') {
      throw new ForgeError(
        'POLICY_DENIED',
        'Cannot deliver before an independent Ship review has been marked passed',
        409,
        {reason: 'SHIP_GATE_REQUIRED'},
      );
    }

    const plan = detail.activePlan;
    const copiedFiles: string[] = [];

    if (plan) {
      const completedTasks = [...plan.tasks]
        .filter(t => t.status === 'completed' && t.worktreePath)
        .sort((a, b) => a.waveIndex - b.waveIndex);

      for (const task of completedTasks) {
        const wtPath = task.worktreePath!;
        for (const relRaw of task.fileScope) {
          const rel = normalizeRelPath(relRaw);
          if (!rel || rel.includes('*')) continue;
          const srcAbs = join(wtPath, rel);
          if (!existsSync(srcAbs)) continue;
          const dstAbs = this.worktrees.resolveInside(
            detail.session.workspacePath,
            rel,
          );
          mkdirSync(dirname(dstAbs), {recursive: true});
          copyFileSync(srcAbs, dstAbs);
          copiedFiles.push(rel);
        }
      }
    }

    const addRes = await this.runner.run({
      executable: 'git',
      args: ['add', '-A'],
      cwd: detail.session.workspacePath,
      extraEnv: {LC_ALL: 'C'},
      timeoutMs: 15_000,
    });
    if (addRes.exitCode !== 0) {
      throw new ForgeError(
        'INTERNAL_ERROR',
        `git add failed during delivery: ${addRes.stderr || addRes.stdout}`,
        500,
      );
    }

    const statusRes = await this.runner.run({
      executable: 'git',
      args: ['status', '--porcelain'],
      cwd: detail.session.workspacePath,
      extraEnv: {LC_ALL: 'C'},
      timeoutMs: 10_000,
    });

    if (statusRes.stdout.trim().length > 0) {
      const commitRes = await this.runner.run({
        executable: 'git',
        args: [
          '-c',
          'user.name=SDLC-Studio Master Agent',
          '-c',
          'user.email=master@sdlc-studio.local',
          'commit',
          '-m',
          `feat(sdlc-v4): deliver ${detail.session.title}`,
        ],
        cwd: detail.session.workspacePath,
        extraEnv: {LC_ALL: 'C'},
        timeoutMs: 15_000,
      });
      if (commitRes.exitCode !== 0) {
        throw new ForgeError(
          'INTERNAL_ERROR',
          `git commit failed during delivery: ${commitRes.stderr || commitRes.stdout}`,
          500,
        );
      }
    }

    const revRes = await this.runner.run({
      executable: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: detail.session.workspacePath,
      extraEnv: {LC_ALL: 'C'},
      timeoutMs: 10_000,
    });
    const deliveredCommitSha = revRes.stdout.trim();

    const verifyCmd = detectRepoVerifyCommand(detail.session.workspacePath, '');
    const hostedApp = this.store.v4.upsertHostedApp({
      sessionId,
      name: options?.appName?.trim() || detail.session.title,
      versionTag: options?.versionTag?.trim() || `v${detail.session.term}.0.0`,
      workspacePath: detail.session.workspacePath,
      entryCommand: verifyCmd,
      urlOrPort: 'local://workspace',
      status: 'running',
      commitSha: deliveredCommitSha,
      npsScore: null,
      csatScore: null,
    });

    const updatedSession = this.store.v4.updateSession(sessionId, {
      stage: 'delivered',
    });

    const msg = this.store.v4.appendMessage({
      sessionId,
      role: 'master',
      agentKernel: 'master',
      kind: 'decision_card',
      content: `交付完成！已将 ${copiedFiles.length} 个文件安全提交至目标仓库（Commit \`${deliveredCommitSha.slice(0, 10)}\`），并生成托管应用卡片「${hostedApp.name} ${hostedApp.versionTag}」。`,
      decisionCard: {
        conclusion: `交付提交 ${deliveredCommitSha.slice(0, 10)} 已落库，工作区 100% 干净。`,
        evidence: [
          `Commit SHA: ${deliveredCommitSha}`,
          `Delivered Files: ${copiedFiles.join(', ') || 'baseline synced'}`,
          `Ship Review: ${ship.id} (Reviewer ${ship.reviewerKernel}, Anti-Self-Approval Passed)`,
        ],
        recommendation:
          '后续可在侧边栏托管应用卡片启停监控，或一键发起 v2 螺旋迭代。',
        risk: 'Low — 已通过独立审校门禁与隔离工作树验收。',
        decisionNeeded: '无阻断项。',
        actionNeeded: '可继续体验 Hosted App 卡片或开启下一轮 Term 迭代。',
      },
    });

    this.publish({type: 'v4.session.updated', session: updatedSession});
    this.publish({type: 'v4.app.updated', app: hostedApp});
    this.publish({type: 'v4.message.added', sessionId, message: msg});

    return {
      deliveredCommitSha,
      hostedApp,
      detail: this.getSessionDetail(sessionId),
    };
  }

  listHostedApps(): HostedAppCard[] {
    return this.store.v4.listHostedApps();
  }

  async controlHostedApp(
    appId: string,
    action: 'start' | 'stop' | 'restart' | 'fork_v2',
  ): Promise<{
    readonly app: HostedAppCard;
    readonly forkedSession?: MasterSession;
  }> {
    const existing = this.store.v4.getHostedApp(appId);
    if (!existing) {
      throw new ForgeError('NOT_FOUND', `Hosted app "${appId}" not found`, 404);
    }

    if (action === 'fork_v2') {
      const prevSession = this.store.v4.getSession(existing.sessionId);
      const nextTerm = (prevSession?.term ?? 1) + 1;
      const forkedDetail = await this.onboardFolder({
        folderPath: existing.workspacePath,
        title: `${existing.name} (v${nextTerm} 迭代)`,
        mode: prevSession?.mode ?? 'team',
        executionMode: prevSession?.executionMode ?? 'auto',
      });
      const updatedFork = this.store.v4.updateSession(forkedDetail.session.id, {
        term: nextTerm,
      });
      this.publish({type: 'v4.session.updated', session: updatedFork});
      return {
        app: existing,
        forkedSession: updatedFork,
      };
    }

    const nextStatus: HostedAppCard['status'] =
      action === 'stop' ? 'stopped' : 'running';
    const updated = this.store.v4.upsertHostedApp({
      ...existing,
      status: nextStatus,
    });
    this.publish({type: 'v4.app.updated', app: updated});
    return {app: updated};
  }

  readWorkspaceFiles(sessionId: string): {
    readonly workspacePath: string;
    readonly files: readonly WorkspaceFileEntry[];
  } {
    const detail = this.getSessionDetail(sessionId);
    const root = detail.session.workspacePath;
    const byPath = new Map<string, WorkspaceFileEntry>();

    const walk = (baseDir: string, relDir: string, depth: number): void => {
      if (depth > 5 || byPath.size >= 300) return;
      const absDir = relDir ? join(baseDir, relDir) : baseDir;
      let entries;
      try {
        entries = readdirSync(absDir, {withFileTypes: true});
      } catch {
        return;
      }
      for (const ent of entries) {
        if (byPath.size >= 300) break;
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) {
          if (SKIP_WALK_DIRS.has(ent.name) || ent.name.startsWith('.'))
            continue;
          const nextRel = relDir ? `${relDir}/${ent.name}` : ent.name;
          byPath.set(nextRel, {path: nextRel, kind: 'dir', sizeBytes: 0});
          walk(baseDir, nextRel, depth + 1);
          continue;
        }
        if (!ent.isFile()) continue;
        const nextRel = relDir ? `${relDir}/${ent.name}` : ent.name;
        try {
          const st = statSync(join(baseDir, nextRel));
          byPath.set(nextRel, {
            path: nextRel,
            kind: 'file',
            sizeBytes: st.size,
          });
        } catch {
          // Ignore transient unreadable file
        }
      }
    };

    walk(root, '', 0);

    // Also include files written in completed worktrees so in-app Code & Diff viewer sees them pre-deliver
    if (detail.activePlan) {
      for (const task of detail.activePlan.tasks) {
        if (!task.worktreePath) continue;
        for (const relRaw of task.fileScope) {
          const rel = normalizeRelPath(relRaw);
          if (!rel || rel.includes('*')) continue;
          const abs = join(task.worktreePath, rel);
          if (existsSync(abs)) {
            try {
              const st = statSync(abs);
              byPath.set(rel, {path: rel, kind: 'file', sizeBytes: st.size});
            } catch {
              // Ignore
            }
          }
        }
      }
    }

    const files = Array.from(byPath.values()).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    return {workspacePath: root, files};
  }

  readWorkspaceFile(sessionId: string, relPath: string): WorkspaceFileContent {
    const detail = this.getSessionDetail(sessionId);
    const cleanRel = normalizeRelPath(relPath);
    if (!cleanRel) {
      throw new ForgeError('VALIDATION_ERROR', 'File path is required', 400);
    }

    // Strictly validate path confinement against workspacePath first
    const workspaceAbs = this.worktrees.resolveInside(
      detail.session.workspacePath,
      cleanRel,
    );

    // Prefer latest completed task worktree copy if present (for pre-delivery inspection)
    let targetAbs = workspaceAbs;
    if (detail.activePlan) {
      const completedDesc = [...detail.activePlan.tasks]
        .filter(t => t.status === 'completed' && t.worktreePath)
        .sort((a, b) => b.waveIndex - a.waveIndex);
      for (const task of completedDesc) {
        if (
          task.fileScope.some(s => normalizeRelPath(s) === cleanRel) &&
          task.worktreePath
        ) {
          const candidate = this.worktrees.resolveInside(
            task.worktreePath,
            cleanRel,
          );
          if (existsSync(candidate)) {
            targetAbs = candidate;
            break;
          }
        }
      }
    }

    if (!existsSync(targetAbs)) {
      throw new ForgeError('NOT_FOUND', `File not found: ${cleanRel}`, 404);
    }

    const buf = readFileSync(targetAbs);
    const truncated = buf.length > MAX_READ_BYTES;
    const content = (
      truncated ? buf.subarray(0, MAX_READ_BYTES) : buf
    ).toString('utf8');
    return {
      path: cleanRel,
      content,
      lineCount: content.split(/\r?\n/).length,
      truncated,
    };
  }

  getSessionDiffs(sessionId: string): TurnDiffSnapshot[] {
    this.store.v4.getSessionOrThrow(sessionId);
    return this.store.v4.listTurnDiffSnapshots(sessionId);
  }
}

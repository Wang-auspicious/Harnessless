/**
 * Orca-style Native Multi-Agent Kernel Mounting, Bounded Health Probing
 * (`claude-code`, `codex`, `gemini-cli`, `opencode`, `pi`, `native-api`),
 * and Cross-Kernel Collaboration Orchestration.
 */

import {randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import type {ISandboxProcessRunner} from '../sandbox/contracts.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  AdapterOperationalProfile,
  AdapterTransport,
  AgentAdapterManifest,
  AgentRole,
  PermissionTier,
} from '../shared/types.ts';
import {BUILTIN_ADAPTER_MANIFESTS} from '../store/schema.ts';
import {runCliStreamSession} from './cli-stream.ts';
import type {
  AudienceScope,
  CollabBus,
  CollabMessage,
  DelegateKernelRequest,
  DelegateKernelResult,
} from './collab-bus.ts';
import type {
  AgentInvocationResult,
  IAgentAdapterHub,
  IMcpStationServer,
} from './contracts.ts';

export const GEMINI_CLI_MANIFEST: AgentAdapterManifest = {
  id: 'gemini-cli',
  label: 'Gemini CLI',
  specialty:
    'Frontend/UI Synthesis, Multimodal Verification & Long-Context Spec Review',
  sovereignSoul:
    'Pragmatic UI and verification engineer: keep artifacts crisp, verify contracts end-to-end, and surface concrete evidence.',
  transport: 'cli-stream',
  command: 'gemini',
  baseArgs: ['-p', '--output-format', 'stream-json'],
  healthProbeArgs: ['--version'],
  mcpInjection: 'env-url',
  jsonlParser: 'generic-jsonl',
  permissionFlags: {
    turbo: ['--approval-mode', 'yolo'],
    supervised: ['--approval-mode', 'auto_edit'],
    strict: ['--approval-mode', 'plan'],
  },
  envAllowlist: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  defaultModel: 'gemini-2.5-pro',
  supportedRoles: ['lead', 'worker', 'evaluator', 'specialist'],
  maxConcurrentSlots: 3,
  builtIn: true,
  promptTransport: 'stdin',
};

export interface NativeKernelStatus {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly available: boolean;
  readonly resolvedPath: string | null;
  readonly version: string | null;
  readonly authHint: string;
  readonly transport: AdapterTransport;
  readonly supportedRoles: readonly AgentRole[];
  readonly recommendedFor: readonly string[];
  readonly statusDetail: string;
}

const RECOMMENDED_ROLES_BY_KERNEL: Readonly<Record<string, readonly string[]>> =
  {
    codex: ['coder', 'refactor', 'tests'],
    'claude-code': ['architect', 'reviewer', 'spec-grill'],
    'gemini-cli': ['ui', 'docs', 'verifier'],
    opencode: ['coder', 'fast-slice'],
    pi: ['coder', 'lean-slice'],
    'kimi-acp': ['long-context', 'synthesis'],
    'hermes-acp': ['infra', 'diagnostics'],
    workbuddy: ['team-delivery', 'coder'],
    'native-api': ['fallback', 'steward', 'fast-checks'],
  };

const MAX_PROBE_TIMEOUT_MS = 5_000;

export function listAllKernelManifests(): readonly AgentAdapterManifest[] {
  const seen = new Set<string>();
  const merged: AgentAdapterManifest[] = [];

  for (const manifest of BUILTIN_ADAPTER_MANIFESTS) {
    if (!seen.has(manifest.id)) {
      seen.add(manifest.id);
      merged.push(manifest);
    }
    if (manifest.id === 'claude-code' && !seen.has(GEMINI_CLI_MANIFEST.id)) {
      seen.add(GEMINI_CLI_MANIFEST.id);
      merged.push(GEMINI_CLI_MANIFEST);
    }
  }

  if (!seen.has(GEMINI_CLI_MANIFEST.id)) {
    merged.push(GEMINI_CLI_MANIFEST);
  }

  return merged;
}

function buildAuthHint(manifest: AgentAdapterManifest): string {
  if (manifest.transport === 'native-api') {
    return 'Uses configured ModelProvider API key or local deterministic fallback';
  }
  const presentKeys = manifest.envAllowlist.filter(
    key =>
      typeof process.env[key] === 'string' &&
      process.env[key]!.trim().length > 0,
  );
  if (presentKeys.length > 0) {
    return `Env credential detected (${presentKeys.join(', ')}) or local CLI login`;
  }
  if (manifest.envAllowlist.length > 0) {
    return `Uses local CLI login or set ${manifest.envAllowlist[0]}`;
  }
  return 'Uses local CLI session login';
}

function extractVersionLine(stdout: string, stderr: string): string | null {
  const lines = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  const versionLike = lines.find(l => /\d+\.\d+(?:\.\d+)?/.test(l));
  return (versionLike ?? lines[0]!).slice(0, 100);
}

async function probeSingleKernel(
  manifest: AgentAdapterManifest,
  runner: ISandboxProcessRunner,
  profileById: ReadonlyMap<string, AdapterOperationalProfile>,
  timeoutMs: number,
): Promise<NativeKernelStatus> {
  const recommendedFor = RECOMMENDED_ROLES_BY_KERNEL[manifest.id] ?? [
    ...manifest.supportedRoles,
  ];
  const authHint = buildAuthHint(manifest);
  const existing = profileById.get(manifest.id);

  if (manifest.transport === 'native-api') {
    return {
      id: manifest.id,
      label: manifest.label,
      command: manifest.command,
      available: true,
      resolvedPath: 'builtin-api',
      version: 'builtin',
      authHint,
      transport: manifest.transport,
      supportedRoles: manifest.supportedRoles,
      recommendedFor,
      statusDetail: existing?.lastProbeMessage || 'Built-in API runner ready',
    };
  }

  const resolvedPath = runner.resolveExecutable(manifest.command);
  if (!resolvedPath) {
    return {
      id: manifest.id,
      label: manifest.label,
      command: manifest.command,
      available: false,
      resolvedPath: null,
      version: null,
      authHint,
      transport: manifest.transport,
      supportedRoles: manifest.supportedRoles,
      recommendedFor,
      statusDetail: `Binary "${manifest.command}" not found on PATH`,
    };
  }

  const probeArgs =
    manifest.healthProbeArgs.length > 0
      ? [...manifest.healthProbeArgs]
      : ['--version'];
  const boundedTimeout = Math.max(
    500,
    Math.min(MAX_PROBE_TIMEOUT_MS, timeoutMs),
  );

  const res = await runner.run({
    executable: manifest.command,
    args: probeArgs,
    cwd: process.cwd(),
    envAllowlist: manifest.envAllowlist,
    timeoutMs: boundedTimeout,
  });

  const version = extractVersionLine(res.stdout, res.stderr);
  const available = !res.timedOut && res.exitCode === 0;
  let statusDetail: string;
  if (available) {
    statusDetail = version
      ? `${resolvedPath} (${version})`
      : `${resolvedPath} (ready)`;
  } else if (res.timedOut) {
    statusDetail = `Probe timed out after ${boundedTimeout}ms (${resolvedPath})`;
  } else {
    statusDetail = `Probe exited with code ${res.exitCode}${version ? `: ${version}` : ''}`;
  }

  if (existing && existing.health === 'circuit_open') {
    statusDetail = `${statusDetail} [circuit_open]`;
  }

  return {
    id: manifest.id,
    label: manifest.label,
    command: manifest.command,
    available,
    resolvedPath,
    version,
    authHint,
    transport: manifest.transport,
    supportedRoles: manifest.supportedRoles,
    recommendedFor,
    statusDetail,
  };
}

export async function probeNativeKernels(
  runner: ISandboxProcessRunner,
  existingProfiles?: readonly AdapterOperationalProfile[],
  timeoutMs = MAX_PROBE_TIMEOUT_MS,
): Promise<readonly NativeKernelStatus[]> {
  const manifests = listAllKernelManifests();
  const profileById = new Map<string, AdapterOperationalProfile>();
  for (const profile of existingProfiles ?? []) {
    profileById.set(profile.manifest.id, profile);
  }
  return Promise.all(
    manifests.map(manifest =>
      probeSingleKernel(manifest, runner, profileById, timeoutMs),
    ),
  );
}

export interface CrossKernelCollaboratorDeps {
  readonly collabBus: CollabBus;
  readonly runner?: ISandboxProcessRunner;
  readonly adapterHub?: IAgentAdapterHub;
  readonly mcpStation?: IMcpStationServer;
  readonly manifests?: readonly AgentAdapterManifest[];
}

export interface CrossKernelWorkflowInput {
  readonly missionId: string;
  readonly taskId: string;
  readonly hubId?: string;
  readonly cwd: string;
  readonly coderKernelId: string;
  readonly reviewerKernelId: string;
  readonly taskPrompt: string;
  readonly artifactRelPath?: string;
  readonly fallbackArtifactContent?: string;
  readonly audienceScope?: AudienceScope;
  readonly allowedReaders?: readonly string[];
  readonly permissionTier?: PermissionTier;
  readonly mode?: 'auto' | 'live' | 'fallback';
  readonly enforceDistinctReviewer?: boolean;
  readonly timeoutMs?: number;
}

export interface CrossKernelStepResult {
  readonly step: 'code' | 'review';
  readonly kernelId: string;
  readonly modeUsed: 'live' | 'fallback';
  readonly summary: string;
  readonly outputText: string;
  readonly artifactRef: string | null;
  readonly collabMessage: CollabMessage;
  readonly outcome: 'completed' | 'rate_limited' | 'env_fault' | 'task_failure';
}

export interface CrossKernelWorkflowResult {
  readonly missionId: string;
  readonly taskId: string;
  readonly modeUsed: 'live' | 'fallback';
  readonly coderStep: CrossKernelStepResult;
  readonly reviewerStep: CrossKernelStepResult;
  readonly messages: readonly CollabMessage[];
  readonly summary: string;
  readonly passed: boolean;
}

export class CrossKernelCollaborator {
  private readonly collabBus: CollabBus;
  private readonly runner?: ISandboxProcessRunner;
  private readonly adapterHub?: IAgentAdapterHub;
  private readonly mcpStation?: IMcpStationServer;
  private readonly manifestsById: ReadonlyMap<string, AgentAdapterManifest>;

  constructor(deps: CrossKernelCollaboratorDeps) {
    this.collabBus = deps.collabBus;
    this.runner = deps.runner;
    this.adapterHub = deps.adapterHub;
    this.mcpStation = deps.mcpStation;
    const map = new Map<string, AgentAdapterManifest>();
    for (const m of deps.manifests ?? listAllKernelManifests()) {
      map.set(m.id, m);
    }
    this.manifestsById = map;
  }

  async runWorkflow(
    input: CrossKernelWorkflowInput,
  ): Promise<CrossKernelWorkflowResult> {
    const enforceDistinct = input.enforceDistinctReviewer ?? true;
    if (enforceDistinct && input.coderKernelId === input.reviewerKernelId) {
      throw new ForgeError(
        'POLICY_DENIED',
        `Anti-self-approval violation: reviewer kernel "${input.reviewerKernelId}" must differ from coder kernel "${input.coderKernelId}"`,
        409,
      );
    }

    const audienceScope: AudienceScope = input.audienceScope ?? 'team';
    const mode = input.mode ?? 'auto';
    const artifactRef = input.artifactRelPath?.trim() || null;

    const coderAgentId = `${input.coderKernelId}:coder`;
    const reviewerAgentId = `${input.reviewerKernelId}:reviewer`;

    // Step 1: Coder kernel executes or synthesizes artifact, then posts handoff.
    const coderExec = await this.executeKernelStep({
      missionId: input.missionId,
      taskId: input.taskId,
      hubId: input.hubId ?? 'hub-collab',
      cwd: input.cwd,
      kernelId: input.coderKernelId,
      agentIdentity: coderAgentId,
      role: 'worker',
      readOnly: false,
      permissionTier: input.permissionTier ?? 'supervised',
      systemPrompt:
        'You are the assigned Coder Kernel. Implement the requested artifact cleanly and report concise engineering evidence.',
      userPrompt: input.taskPrompt,
      audienceScope,
      mode,
      timeoutMs: input.timeoutMs,
    });

    if (coderExec.modeUsed === 'fallback' && artifactRef) {
      const targetPath = resolve(input.cwd, artifactRef);
      mkdirSync(dirname(targetPath), {recursive: true});
      const content =
        input.fallbackArtifactContent ??
        `// Generated by ${input.coderKernelId} (deterministic fallback) for task ${input.taskId}\nexport const taskSummary = ${JSON.stringify(input.taskPrompt.slice(0, 120))};\n`;
      writeFileSync(targetPath, content, 'utf8');
    }

    const coderSummary =
      coderExec.modeUsed === 'live'
        ? `${input.coderKernelId} completed slice${artifactRef ? ` (${artifactRef})` : ''}: ${coderExec.outputText.slice(0, 180)}`
        : `${input.coderKernelId} (local fallback) produced artifact${artifactRef ? ` ${artifactRef}` : ''} for task ${input.taskId}`;

    const handoffMessage = this.collabBus.recordHandoff({
      missionId: input.missionId,
      taskId: input.taskId,
      fromAgent: coderAgentId,
      fromKernel: input.coderKernelId,
      toAgent: reviewerAgentId,
      summary: coderSummary,
      artifactRef,
      audienceScope,
      allowedReaders: input.allowedReaders,
      metadata: {
        step: 'code',
        modeUsed: coderExec.modeUsed,
      },
    });

    const coderStep: CrossKernelStepResult = {
      step: 'code',
      kernelId: input.coderKernelId,
      modeUsed: coderExec.modeUsed,
      summary: coderSummary,
      outputText: coderExec.outputText,
      artifactRef,
      collabMessage: handoffMessage,
      outcome: coderExec.outcome,
    };

    // Step 2: Reviewer kernel reads peer handoff context from CollabBus (+ artifact)
    // and posts an independent review finding.
    const peerMessages = this.collabBus.query({
      missionId: input.missionId,
      taskId: input.taskId,
      readerId: reviewerAgentId,
      readerScope: audienceScope,
      readerTaskId: input.taskId,
    });

    let artifactPreview = '';
    if (artifactRef) {
      try {
        artifactPreview = readFileSync(
          resolve(input.cwd, artifactRef),
          'utf8',
        ).slice(0, 2_000);
      } catch {
        artifactPreview = '';
      }
    }

    const peerContextBlock = peerMessages
      .map(
        m =>
          `[#${m.seq} ${m.kind} ${m.fromKernel}->${m.toAgent ?? 'all'}] ${m.summary}`,
      )
      .join('\n');

    const reviewerPrompt = [
      `Review task ${input.taskId} originally implemented by ${input.coderKernelId}.`,
      `Peer collaboration context:\n${peerContextBlock || '(none)'}`,
      artifactPreview
        ? `Artifact (${artifactRef}):\n${artifactPreview}`
        : `Artifact ref: ${artifactRef ?? 'none'}`,
      'Return concise review findings and state PASS or FAIL.',
    ].join('\n\n');

    const reviewExec = await this.executeKernelStep({
      missionId: input.missionId,
      taskId: input.taskId,
      hubId: input.hubId ?? 'hub-collab',
      cwd: input.cwd,
      kernelId: input.reviewerKernelId,
      agentIdentity: reviewerAgentId,
      role: 'evaluator',
      readOnly: true,
      permissionTier: 'strict',
      systemPrompt:
        'You are the independent Reviewer Kernel. Verify correctness against peer handoff context without editing files.',
      userPrompt: reviewerPrompt,
      audienceScope,
      mode,
      timeoutMs: input.timeoutMs,
    });

    const hasArtifactEvidence = !artifactRef || artifactPreview.length > 0;
    const reviewPassed =
      reviewExec.modeUsed === 'live'
        ? reviewExec.outcome === 'completed' &&
          !/\bFAIL\b/i.test(reviewExec.outputText)
        : hasArtifactEvidence && peerMessages.length > 0;

    const reviewSummary =
      reviewExec.modeUsed === 'live'
        ? `${input.reviewerKernelId} review (${reviewPassed ? 'PASS' : 'NEEDS_FIX'}): ${reviewExec.outputText.slice(0, 180)}`
        : `${input.reviewerKernelId} (local fallback) verified ${peerMessages.length} peer handoff(s)${artifactRef ? ` and artifact ${artifactRef} (${artifactPreview.length} chars)` : ''}: ${reviewPassed ? 'PASS' : 'FAIL'}`;

    const reviewMessage = this.collabBus.post({
      missionId: input.missionId,
      taskId: input.taskId,
      fromAgent: reviewerAgentId,
      fromKernel: input.reviewerKernelId,
      toAgent: coderAgentId,
      kind: 'review',
      summary: reviewSummary,
      artifactRef,
      audienceScope,
      allowedReaders: input.allowedReaders,
      metadata: {
        step: 'review',
        modeUsed: reviewExec.modeUsed,
        passed: reviewPassed,
        reviewedSeqs: peerMessages.map(m => m.seq),
      },
    });

    const reviewerStep: CrossKernelStepResult = {
      step: 'review',
      kernelId: input.reviewerKernelId,
      modeUsed: reviewExec.modeUsed,
      summary: reviewSummary,
      outputText: reviewExec.outputText,
      artifactRef,
      collabMessage: reviewMessage,
      outcome: reviewExec.outcome,
    };

    const modeUsed: 'live' | 'fallback' =
      coderStep.modeUsed === 'live' && reviewerStep.modeUsed === 'live'
        ? 'live'
        : 'fallback';

    return {
      missionId: input.missionId,
      taskId: input.taskId,
      modeUsed,
      coderStep,
      reviewerStep,
      messages: [handoffMessage, reviewMessage],
      summary: `${input.coderKernelId} -> ${input.reviewerKernelId}: ${reviewPassed ? 'PASS' : 'FAIL'} (${modeUsed})`,
      passed: reviewPassed,
    };
  }

  async delegateTask(
    req: DelegateKernelRequest,
    options?: {
      readonly cwd?: string;
      readonly mode?: 'auto' | 'live' | 'fallback';
      readonly timeoutMs?: number;
    },
  ): Promise<DelegateKernelResult> {
    const manifest = this.manifestsById.get(req.targetKernel);
    const mode = options?.mode ?? 'fallback';

    if (!manifest && mode === 'live') {
      return this.collabBus.recordDelegate(req, {
        accepted: false,
        status: 'rejected',
        summary: `Unknown target kernel "${req.targetKernel}"`,
      });
    }

    if (mode !== 'fallback' && manifest && options?.cwd) {
      const execRes = await this.executeKernelStep({
        missionId: req.missionId,
        taskId: req.taskId ?? 'delegate',
        hubId: 'hub-collab',
        cwd: options.cwd,
        kernelId: manifest.id,
        agentIdentity: `${manifest.id}:${req.role}`,
        role: 'specialist',
        readOnly: req.role === 'reviewer' || req.role === 'evaluator',
        permissionTier: 'supervised',
        systemPrompt: `You are acting as delegated ${req.role} on kernel ${manifest.id}.`,
        userPrompt: req.prompt,
        audienceScope: req.audienceScope ?? 'team',
        mode,
        timeoutMs: options.timeoutMs,
      });

      return this.collabBus.recordDelegate(req, {
        accepted: true,
        status: execRes.outcome === 'completed' ? 'completed' : 'dispatched',
        summary: `${manifest.id} (${execRes.modeUsed}) handled delegated ${req.role} request`,
        outputText: execRes.outputText,
      });
    }

    return this.collabBus.recordDelegate(req, {
      accepted: true,
      status: 'completed',
      summary: `${req.targetKernel} (local fallback) accepted delegated ${req.role} task`,
      outputText: `Delegated task recorded for ${req.targetKernel} (${req.role}): ${req.prompt.slice(0, 160)}`,
    });
  }

  private async executeKernelStep(params: {
    readonly missionId: string;
    readonly taskId: string;
    readonly hubId: string;
    readonly cwd: string;
    readonly kernelId: string;
    readonly agentIdentity: string;
    readonly role: AgentRole;
    readonly readOnly: boolean;
    readonly permissionTier: PermissionTier;
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly audienceScope: AudienceScope;
    readonly mode: 'auto' | 'live' | 'fallback';
    readonly timeoutMs?: number;
  }): Promise<{
    readonly modeUsed: 'live' | 'fallback';
    readonly outcome: AgentInvocationResult['outcome'];
    readonly outputText: string;
  }> {
    if (params.mode === 'fallback') {
      return {
        modeUsed: 'fallback',
        outcome: 'completed',
        outputText: `Deterministic local execution for ${params.kernelId} (${params.role})`,
      };
    }

    const manifest = this.manifestsById.get(params.kernelId);
    if (!manifest) {
      if (params.mode === 'live') {
        throw new ForgeError(
          'NOT_FOUND',
          `Unknown native kernel manifest "${params.kernelId}"`,
          404,
        );
      }
      return {
        modeUsed: 'fallback',
        outcome: 'completed',
        outputText: `Fallback: manifest "${params.kernelId}" unavailable`,
      };
    }

    let reg: ReturnType<IMcpStationServer['registerAttempt']> | null = null;
    if (this.mcpStation) {
      reg = this.mcpStation.registerAttempt({
        hubId: params.hubId,
        missionId: params.missionId,
        changeId: params.missionId,
        nodeId: params.taskId,
        worktreePath: params.cwd,
        contractMarkdown: params.userPrompt,
        collabBus: this.collabBus,
        agentIdentity: params.agentIdentity,
        audienceScope: params.audienceScope,
      });
    }

    try {
      let result: AgentInvocationResult | null = null;
      const invocationReq = {
        sessionId: `collab-${randomUUID()}`,
        hubId: params.hubId,
        changeId: params.missionId,
        nodeId: params.taskId,
        role: params.role,
        adapter: manifest,
        model: manifest.defaultModel,
        permissionTier: params.permissionTier,
        cwd: params.cwd,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        readOnly: params.readOnly,
        mcpEndpointUrl: reg?.mcpEndpointUrl,
        mcpAttemptToken: reg?.attemptToken,
        timeoutMs: params.timeoutMs ?? 20_000,
      };

      if (this.adapterHub) {
        result = await this.adapterHub.invoke(invocationReq);
      } else if (this.runner && manifest.transport === 'cli-stream') {
        result = await runCliStreamSession(invocationReq, this.runner);
      }

      if (result && result.outcome === 'completed') {
        return {
          modeUsed: 'live',
          outcome: result.outcome,
          outputText: result.finalText,
        };
      }

      if (params.mode === 'live') {
        return {
          modeUsed: 'live',
          outcome: result?.outcome ?? 'env_fault',
          outputText:
            result?.diagnostic ||
            `Live kernel "${params.kernelId}" failed or unavailable`,
        };
      }

      return {
        modeUsed: 'fallback',
        outcome: 'completed',
        outputText: `Fallback after ${result?.outcome ?? 'offline'} (${result?.diagnostic ?? 'no live runner'})`,
      };
    } finally {
      reg?.revoke();
    }
  }
}

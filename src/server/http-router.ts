/**
 * Authenticated Loopback HTTP & Multiplexed SSE Control Server (`127.0.0.1:0`).
 * Protects all endpoints with a CSPRNG Bearer token and never blocks on
 * long-running agent execution.
 */

import {randomBytes, timingSafeEqual} from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {verifyEvidenceBundle} from '../core/canonical-json.ts';
import {rankAttentionQueue} from '../core/cognitive.ts';
import type {IAgentAdapterHub} from '../adapters/contracts.ts';
import type {HindsightEngine} from '../memory/hindsight-engine.ts';
import type {HamaEngine} from '../requirements/hama-engine.ts';
import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import type {
  BootstrapSnapshot,
  ChangeDetailSnapshot,
  CreateMissionRequest,
  ForgeSseEvent,
  MemoryObservatorySnapshot,
} from '../shared/api.ts';
import {
  CONTROL_SCHEMA_REGISTRY,
  INTENT_PRESETS,
} from '../shared/control-schema.ts';
import {ForgeError} from '../shared/errors.ts';
import type {RepoTier} from '../shared/types.ts';
import type {
  DecisionAction,
  ExecutionMode,
  IntentPresetId,
  MissionConfigOverrides,
  TriageTrack,
} from '../shared/v3-types.ts';
import {
  asRecord,
  optNumber,
  optString,
  optStringArray,
  PERMISSION_TIERS,
  reqEnum,
  reqString,
  validateAdapterManifest,
  validateControlCommand,
  validateDecisionInput,
} from '../shared/validation.ts';
import type {ForgeStore} from '../store/database.ts';
import type {ContinuityEngine} from '../engines/continuity.ts';
import type {DreamingEngine} from '../engines/dreaming.ts';
import type {InfraStewardEngine} from '../engines/infra-steward.ts';
import type {MissionOrchestrator} from '../engines/mission-orchestrator.ts';
import type {RequirementClosureEngine} from '../engines/requirement-closure.ts';
import type {EngineeringRoomsService} from './rooms-service.ts';
import type {HostSecretVault} from './secret-vault.ts';

export class ForgeHttpServer {
  readonly sessionToken: string;
  private server: Server | null = null;
  private port = 0;
  private readonly sseClients = new Set<ServerResponse>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private readonly store: ForgeStore;
  private readonly vault: HostSecretVault;
  private readonly worktrees: IGitWorktreeManager;
  private readonly runner?: ISandboxProcessRunner;
  private readonly adapters: IAgentAdapterHub;
  private readonly closure: RequirementClosureEngine;
  private readonly continuity: ContinuityEngine;
  private readonly steward: InfraStewardEngine;
  private readonly dreaming: DreamingEngine;
  private readonly rooms: EngineeringRoomsService;
  private readonly hindsight?: HindsightEngine;
  private readonly hama?: HamaEngine;
  private readonly missions?: MissionOrchestrator;
  private readonly worktreesRoot: string;

  constructor(deps: {
    readonly store: ForgeStore;
    readonly vault: HostSecretVault;
    readonly worktrees: IGitWorktreeManager;
    readonly runner?: ISandboxProcessRunner;
    readonly adapters: IAgentAdapterHub;
    readonly closure: RequirementClosureEngine;
    readonly continuity: ContinuityEngine;
    readonly steward: InfraStewardEngine;
    readonly dreaming: DreamingEngine;
    readonly rooms: EngineeringRoomsService;
    readonly hindsight?: HindsightEngine;
    readonly hama?: HamaEngine;
    readonly missions?: MissionOrchestrator;
    readonly worktreesRoot: string;
    readonly sessionToken?: string;
  }) {
    this.sessionToken = deps.sessionToken ?? randomBytes(32).toString('hex');
    this.store = deps.store;
    this.vault = deps.vault;
    this.worktrees = deps.worktrees;
    this.runner = deps.runner;
    this.adapters = deps.adapters;
    this.closure = deps.closure;
    this.continuity = deps.continuity;
    this.steward = deps.steward;
    this.dreaming = deps.dreaming;
    this.rooms = deps.rooms;
    this.hindsight = deps.hindsight;
    this.hama = deps.hama;
    this.missions = deps.missions;
    this.worktreesRoot = deps.worktreesRoot;
  }

  get apiBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve();
      });
    });

    this.heartbeatTimer = setInterval(() => {
      for (const client of this.sseClients) {
        client.write(': heartbeat\n\n');
      }
    }, 15_000);
    this.heartbeatTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();
    if (!this.server) {
      return;
    }
    const srv = this.server;
    this.server = null;
    await Promise.race([
      new Promise<void>(resolve => {
        srv.close(() => resolve());
        srv.closeAllConnections?.();
      }),
      new Promise<void>(resolve => setTimeout(resolve, 2_000)),
    ]);
  }

  broadcast(event: ForgeSseEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.sseClients) {
      client.write(frame);
    }
  }

  private isAuthenticated(req: IncomingMessage, url: URL): boolean {
    const authHeader = req.headers.authorization ?? '';
    const bearer = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const candidate = bearer || (url.searchParams.get('token') ?? '');
    const expectedBuf = Buffer.from(this.sessionToken, 'utf8');
    const actualBuf = Buffer.from(candidate, 'utf8');
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const origin = req.headers.origin;
    if (
      origin &&
      (origin === 'null' ||
        /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin))
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port || 80}`);
    } catch {
      this.sendJson(res, 400, {
        code: 'VALIDATION_ERROR',
        message: 'Malformed request URL',
      });
      return;
    }
    if (!this.isAuthenticated(req, url)) {
      this.sendJson(res, 401, {
        code: 'UNAUTHORIZED',
        message: 'Valid ForgeOps Bearer session token required.',
      });
      return;
    }

    try {
      const method = req.method ?? 'GET';
      const path = url.pathname;

      if (method === 'GET' && path === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        this.sseClients.add(res);
        req.on('close', () => {
          this.sseClients.delete(res);
        });
        return;
      }

      if (method === 'GET' && path === '/api/bootstrap') {
        this.sendJson(res, 200, this.buildBootstrapSnapshot());
        return;
      }

      if (method === 'POST' && path === '/api/hubs') {
        const body = asRecord(await this.readJsonBody(req));
        const hub = this.store.createHub({
          name: reqString(body, 'name', 120),
          rootPath: reqString(body, 'rootPath', 512),
          description: optString(body, 'description', '', 2048),
          permissionTier: reqEnum(body, 'permissionTier', PERMISSION_TIERS),
        });
        this.broadcast({
          type: 'state.changed',
          scope: 'hubs',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 201, hub);
        return;
      }

      const anchorMatch = /^\/api\/hubs\/([^/]+)\/anchor$/.exec(path);
      if (method === 'POST' && anchorMatch) {
        const hub = this.store.touchHubHumanAnchor(anchorMatch[1]!, true);
        this.broadcast({
          type: 'state.changed',
          scope: 'capsules',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, hub);
        return;
      }

      if (method === 'POST' && path === '/api/repositories') {
        const body = asRecord(await this.readJsonBody(req));
        const hubId = reqString(body, 'hubId', 80);
        if (!this.store.getHub(hubId)) {
          throw new ForgeError('NOT_FOUND', `Hub "${hubId}" not found`, 404);
        }
        const localPath = reqString(body, 'localPath', 512);
        await this.worktrees.ensureGitRepoInitialized(localPath, 'main');
        const repo = this.store.registerRepository({
          hubId,
          name: reqString(body, 'name', 120),
          tier: reqEnum(body, 'tier', [
            'infra',
            'service',
          ] as const) as RepoTier,
          localPath,
          verifyCommand: optString(body, 'verifyCommand', '', 512),
          boundedContext: reqString(body, 'boundedContext', 120),
          contractSummary: optString(body, 'contractSummary', '', 4096),
        });
        this.broadcast({
          type: 'state.changed',
          scope: 'repositories',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 201, repo);
        return;
      }

      if (method === 'POST' && path === '/api/domain-terms') {
        const body = asRecord(await this.readJsonBody(req));
        const hubId = reqString(body, 'hubId', 80);
        const term = this.store.upsertDomainTerm({
          hubId,
          boundedContext: reqString(body, 'boundedContext', 120),
          owningRepoIds: optStringArray(body, 'owningRepoIds', 32),
          canonicalTerm: reqString(body, 'canonicalTerm', 120),
          localLabel: optString(body, 'localLabel', '', 120),
          definition: reqString(body, 'definition', 2048),
          forbiddenAliases: optStringArray(body, 'forbiddenAliases', 32),
          schemaAnchors: optStringArray(body, 'schemaAnchors', 32),
        });
        const audit = this.store.appendAudit({
          hubId,
          changeId: null,
          category: 'ddd_refactor',
          actor: 'human_operator',
          title: `Locked DDD Term "${term.canonicalTerm}" (${term.boundedContext})`,
          detail: `Forbidden synonyms: ${term.forbiddenAliases.join(', ') || '(none)'}`,
        });
        this.broadcast({type: 'audit.logged', entry: audit});
        this.broadcast({
          type: 'state.changed',
          scope: 'ddd',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 201, term);
        return;
      }

      if (method === 'POST' && path === '/api/changes') {
        const body = asRecord(await this.readJsonBody(req));
        const change = await this.closure.createAndPlanChange({
          hubId: reqString(body, 'hubId', 80),
          repoId: reqString(body, 'repoId', 80),
          title: reqString(body, 'title', 200),
          summary: reqString(body, 'summary', 8192),
          permissionTier: reqEnum(body, 'permissionTier', PERMISSION_TIERS),
          maxOvernightHours: optNumber(body, 'maxOvernightHours', 8, 0.5, 48),
          budgetUsdLimit: optNumber(body, 'budgetUsdLimit', 25, 0.5, 5000),
          leadAdapterId: optString(body, 'leadAdapterId', '') || undefined,
          workerAdapterId: optString(body, 'workerAdapterId', '') || undefined,
          worktreesRoot: this.worktreesRoot,
        });
        this.broadcast({
          type: 'state.changed',
          scope: 'changes',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 201, change);
        return;
      }

      if (method === 'POST' && path === '/api/changes/epic') {
        const body = asRecord(await this.readJsonBody(req));
        const changes = await this.closure.createCoordinatedEpicChanges({
          hubId: reqString(body, 'hubId', 80),
          repoIds: optStringArray(body, 'repoIds', 32),
          epicTitle: reqString(body, 'epicTitle', 200),
          summary: reqString(body, 'summary', 8192),
          permissionTier: reqEnum(body, 'permissionTier', PERMISSION_TIERS),
          worktreesRoot: this.worktreesRoot,
        });
        this.broadcast({
          type: 'state.changed',
          scope: 'changes',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 201, changes);
        return;
      }

      const changeDetailMatch = /^\/api\/changes\/([^/]+)$/.exec(path);
      if (method === 'GET' && changeDetailMatch) {
        const changeId = changeDetailMatch[1]!;
        const change = this.store.getChange(changeId);
        if (!change) {
          throw new ForgeError(
            'NOT_FOUND',
            `Change "${changeId}" not found`,
            404,
          );
        }
        const detail: ChangeDetailSnapshot = {
          change,
          nodes: this.store.listGraphNodes(changeId),
          edges: this.store.listGraphEdges(changeId),
          checkpoints: this.store.listCheckpoints(changeId),
          sessions: this.store.listSessions({changeId, limit: 40}),
        };
        this.sendJson(res, 200, detail);
        return;
      }

      const changeDiffMatch = /^\/api\/changes\/([^/]+)\/diff$/.exec(path);
      if (method === 'GET' && changeDiffMatch) {
        const change = this.store.getChange(changeDiffMatch[1]!);
        if (!change) {
          throw new ForgeError('NOT_FOUND', 'Change not found', 404);
        }
        const diff = await this.worktrees.diffSinceCommit(
          change.worktreePath,
          change.baseCommitSha,
        );
        this.sendJson(res, 200, diff);
        return;
      }

      const changeExecMatch = /^\/api\/changes\/([^/]+)\/execute$/.exec(path);
      if (method === 'POST' && changeExecMatch) {
        const changeId = changeExecMatch[1]!;
        const change = this.store.getChange(changeId);
        if (!change) {
          throw new ForgeError('NOT_FOUND', 'Change not found', 404);
        }
        // Non-blocking launch: return 202 Accepted immediately while SSE streams progress.
        void this.continuity.startChangeExecution(changeId);
        this.sendJson(res, 202, {accepted: true, changeId});
        return;
      }

      const changeArchiveMatch = /^\/api\/changes\/([^/]+)\/archive$/.exec(
        path,
      );
      if (method === 'POST' && changeArchiveMatch) {
        const archived = this.store.archiveChange(changeArchiveMatch[1]!);
        this.broadcast({
          type: 'state.changed',
          scope: 'changes',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, archived);
        return;
      }

      const changeTeamMatch = /^\/api\/changes\/([^/]+)\/team$/.exec(path);
      if (method === 'POST' && changeTeamMatch) {
        const changeId = changeTeamMatch[1]!;
        const cur = this.store.getChange(changeId);
        if (!cur) {
          throw new ForgeError('NOT_FOUND', 'Change not found', 404);
        }
        const body = asRecord(await this.readJsonBody(req));
        const teamPatch = asRecord(body['team'] ?? {});
        const nextTeam = {
          leadAdapterId: optString(
            teamPatch,
            'leadAdapterId',
            cur.team.leadAdapterId,
            80,
          ),
          leadModel: optString(teamPatch, 'leadModel', cur.team.leadModel, 120),
          workerAdapterId: optString(
            teamPatch,
            'workerAdapterId',
            cur.team.workerAdapterId,
            80,
          ),
          workerModel: optString(
            teamPatch,
            'workerModel',
            cur.team.workerModel,
            120,
          ),
          juniorAuditModel: optString(
            teamPatch,
            'juniorAuditModel',
            cur.team.juniorAuditModel,
            120,
          ),
          seniorAuditModel: optString(
            teamPatch,
            'seniorAuditModel',
            cur.team.seniorAuditModel,
            120,
          ),
          maxRetryLoops: optNumber(
            teamPatch,
            'maxRetryLoops',
            cur.team.maxRetryLoops,
            1,
            20,
          ),
        };
        const nextTier =
          body['permissionTier'] !== undefined
            ? reqEnum(body, 'permissionTier', PERMISSION_TIERS)
            : cur.permissionTier;
        const updated = this.store.updateChange(changeId, {
          team: nextTeam,
          permissionTier: nextTier,
        });
        const audit = this.store.appendAudit({
          hubId: updated.hubId,
          changeId: updated.id,
          category: 'gate_decision',
          actor: 'human_operator',
          title: `Updated ${updated.code} Team & TQLA Configuration`,
          detail: `DEV=${nextTeam.workerAdapterId}:${nextTeam.workerModel} | JQA=${nextTeam.juniorAuditModel} | SQA=${nextTeam.seniorAuditModel}`,
        });
        this.broadcast({type: 'audit.logged', entry: audit});
        this.broadcast({
          type: 'state.changed',
          scope: 'changes',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, updated);
        return;
      }

      const changeRestoreMatch = /^\/api\/changes\/([^/]+)\/restore$/.exec(
        path,
      );
      if (method === 'POST' && changeRestoreMatch) {
        const body = asRecord(await this.readJsonBody(req));
        const restored = await this.continuity.manualRestoreToCheckpoint(
          changeRestoreMatch[1]!,
          reqString(body, 'checkpointId', 80),
        );
        this.sendJson(res, 200, restored);
        return;
      }

      const changeGhostMatch = /^\/api\/changes\/([^/]+)\/ghost$/.exec(path);
      if (method === 'POST' && changeGhostMatch) {
        const body = asRecord(await this.readJsonBody(req));
        const ghost = this.continuity.proposeGhostAmendment({
          changeId: changeGhostMatch[1]!,
          title: reqString(body, 'title', 160),
          description: reqString(body, 'description', 2048),
          insertBeforeNodeId: reqString(body, 'insertBeforeNodeId', 120),
          gateCommand: optString(body, 'gateCommand', '') || undefined,
          actor: 'human_operator',
        });
        this.sendJson(res, 201, ghost);
        return;
      }

      const takeoverStatusMatch =
        /^\/api\/changes\/([^/]+)\/takeover-status$/.exec(path);
      if (method === 'GET' && takeoverStatusMatch) {
        const nodeId = url.searchParams.get('nodeId') || undefined;
        this.sendJson(
          res,
          200,
          await this.continuity.getTakeoverStatus(
            takeoverStatusMatch[1]!,
            nodeId,
          ),
        );
        return;
      }

      const nodeTakeoverMatch =
        /^\/api\/changes\/([^/]+)\/nodes\/([^/]+)\/takeover$/.exec(path);
      if (method === 'POST' && nodeTakeoverMatch) {
        const body = asRecord(await this.readJsonBody(req));
        const actor = optString(body, 'actor', 'human_operator', 80);
        this.sendJson(
          res,
          200,
          await this.continuity.pauseForHumanTakeover(
            nodeTakeoverMatch[1]!,
            nodeTakeoverMatch[2]!,
            actor,
          ),
        );
        return;
      }

      const resumeHandoverMatch =
        /^\/api\/changes\/([^/]+)\/nodes\/([^/]+)\/resume-handover$/.exec(path);
      if (method === 'POST' && resumeHandoverMatch) {
        const body = asRecord(await this.readJsonBody(req));
        this.sendJson(
          res,
          200,
          await this.continuity.resumeFromHumanHandover(
            resumeHandoverMatch[1]!,
            resumeHandoverMatch[2]!,
            {
              runVerify:
                body['runVerify'] !== undefined
                  ? Boolean(body['runVerify'])
                  : true,
              handoverNote: optString(body, 'handoverNote', '', 2048),
              saveAsMemory: Boolean(body['saveAsMemory']),
              memoryTitle: optString(body, 'memoryTitle', '', 160) || undefined,
              autoResume:
                body['autoResume'] !== undefined
                  ? Boolean(body['autoResume'])
                  : true,
              actor: optString(body, 'actor', 'human_operator', 80),
            },
          ),
        );
        return;
      }

      const causalDiffMatch = /^\/api\/changes\/([^/]+)\/causal-diff$/.exec(
        path,
      );
      if (method === 'GET' && causalDiffMatch) {
        this.sendJson(
          res,
          200,
          await this.continuity.getCausalDiff(causalDiffMatch[1]!),
        );
        return;
      }

      const collapseMatch = /^\/api\/nodes\/([^/]+)\/collapse$/.exec(path);
      if (method === 'POST' && collapseMatch) {
        const body = asRecord(await this.readJsonBody(req));
        this.store.updateGraphNode(collapseMatch[1]!, {
          collapsed: Boolean(body['collapsed']),
        });
        this.broadcast({
          type: 'state.changed',
          scope: 'graph',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, {ok: true});
        return;
      }

      const sessMsgMatch = /^\/api\/sessions\/([^/]+)\/messages$/.exec(path);
      if (method === 'GET' && sessMsgMatch) {
        this.sendJson(
          res,
          200,
          this.store.listSessionMessages(sessMsgMatch[1]!),
        );
        return;
      }

      const resolveAttnMatch = /^\/api\/attention\/([^/]+)\/resolve$/.exec(
        path,
      );
      if (method === 'POST' && resolveAttnMatch) {
        const attnId = resolveAttnMatch[1]!;
        const body = asRecord(await this.readJsonBody(req));
        const resolution = reqString(body, 'resolution', 1024);
        const existingAttn = this.store
          .listAttentionItems(true)
          .find(a => a.id === attnId);
        if (!existingAttn) {
          throw new ForgeError(
            'NOT_FOUND',
            `Attention item "${attnId}" not found`,
            404,
          );
        }

        const linkedChange = existingAttn.changeId
          ? this.store.getChange(existingAttn.changeId)
          : null;
        if (linkedChange?.missionId) {
          if (!this.missions) {
            throw new ForgeError(
              'CONFLICT',
              `Mission-linked attention item "${attnId}" must be resolved via MissionOrchestrator`,
              409,
            );
          }
          const openGates = this.store.missions.listGates(
            linkedChange.missionId,
            false,
          );
          const matchingGate =
            openGates.find(
              g =>
                g.targetId === existingAttn.id ||
                (g.changeId === linkedChange.id &&
                  (!existingAttn.nodeId || g.nodeId === existingAttn.nodeId)),
            ) ?? openGates.find(g => g.changeId === linkedChange.id);

          const lower = resolution.toLowerCase();
          if (matchingGate) {
            let mappedAction: DecisionAction | null = null;
            if (lower.includes('waive')) {
              mappedAction = 'waive_ghost';
            } else if (matchingGate.kind === 'ghost_amendment') {
              mappedAction = 'approve_ghost';
            } else if (matchingGate.kind === 'budget_extension') {
              mappedAction = 'extend_budget';
            } else if (matchingGate.kind === 'qa_decision') {
              mappedAction = 'approve';
            } else if (matchingGate.kind === 'build_escalation') {
              mappedAction = 'resume';
            } else if (matchingGate.kind === 'clarification') {
              mappedAction = 'clarify';
            }
            const opt = mappedAction
              ? matchingGate.options.find(o => o.action === mappedAction)
              : undefined;
            if (!opt) {
              throw new ForgeError(
                'CONFLICT',
                `Mission-linked attention item "${attnId}" must be resolved via POST /api/missions/${linkedChange.missionId}/decisions`,
                409,
              );
            }
            const item = this.store.resolveAttention(attnId, resolution);
            await this.missions.resolveDecision(linkedChange.missionId, {
              gateId: matchingGate.id,
              targetId: matchingGate.targetId,
              targetHash: matchingGate.targetHash,
              idempotencyKey: `attn-${attnId}`,
              actor: 'human_operator',
              action: opt.action,
              feedback: resolution,
              scope: 'proposal',
              issueIds: [],
            });
            this.broadcast({
              type: 'state.changed',
              scope: 'attention',
              at: new Date().toISOString(),
            });
            this.sendJson(res, 200, item);
            return;
          }
          const item = this.store.resolveAttention(attnId, resolution);
          if (
            lower.includes('approve') ||
            lower.includes('resume') ||
            lower.includes('start')
          ) {
            await this.missions.executeControl(linkedChange.missionId, {
              action: 'resume',
              actor: 'human_operator',
              feedback: resolution,
            });
          }
          this.broadcast({
            type: 'state.changed',
            scope: 'attention',
            at: new Date().toISOString(),
          });
          this.sendJson(res, 200, item);
          return;
        }

        const item = this.store.resolveAttention(attnId, resolution);
        if (linkedChange) {
          if (resolution.toLowerCase().includes('turbo')) {
            this.store.updateChange(linkedChange.id, {permissionTier: 'turbo'});
          }
          if (item.nodeId) {
            const waive = resolution.toLowerCase().includes('waive');
            this.store.updateGraphNode(item.nodeId, {
              status: waive ? 'waived' : 'certified',
              outputSummary: `Human resolution: ${resolution}`,
            });
          }
          if (
            resolution.toLowerCase().includes('approve') ||
            resolution.toLowerCase().includes('resume') ||
            resolution.toLowerCase().includes('start')
          ) {
            this.store.updateChange(linkedChange.id, {status: 'planned'});
            void this.continuity.startChangeExecution(linkedChange.id);
          }
        }
        this.broadcast({
          type: 'state.changed',
          scope: 'attention',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, item);
        return;
      }

      if (method === 'GET' && path === '/api/rooms') {
        const hubId = url.searchParams.get('hubId') ?? '';
        const roomId = url.searchParams.get('roomId') ?? undefined;
        this.sendJson(res, 200, this.rooms.getRoomSnapshot(hubId, roomId));
        return;
      }

      if (method === 'POST' && path === '/api/rooms') {
        const body = asRecord(await this.readJsonBody(req));
        const room = this.store.createRoom({
          hubId: reqString(body, 'hubId', 80),
          name: reqString(body, 'name', 80),
          scenario: reqEnum(body, 'scenario', [
            'req-grill',
            'arch-council',
            'triage-ops',
            'direct-ops',
            'exec-briefing',
          ] as const),
          topic: optString(body, 'topic', '', 512),
        });
        this.sendJson(res, 201, room);
        return;
      }

      if (method === 'POST' && path === '/api/rooms/messages') {
        const body = asRecord(await this.readJsonBody(req));
        const msg = await this.rooms.postMessage({
          roomId: reqString(body, 'roomId', 80),
          threadId: optString(body, 'threadId', '') || undefined,
          threadTitle: optString(body, 'threadTitle', '') || undefined,
          bodyMarkdown: reqString(body, 'bodyMarkdown', 16_384),
          mentions: optStringArray(body, 'mentions', 16),
        });
        this.sendJson(res, 201, msg);
        return;
      }

      if (method === 'POST' && path === '/api/rooms/promote') {
        const body = asRecord(await this.readJsonBody(req));
        const change = await this.rooms.promoteThreadToChange({
          threadId: reqString(body, 'threadId', 80),
          repoId: reqString(body, 'repoId', 80),
          title: reqString(body, 'title', 200),
          permissionTier: reqEnum(body, 'permissionTier', PERMISSION_TIERS),
        });
        this.sendJson(res, 201, change);
        return;
      }

      if (method === 'GET' && path === '/api/memory') {
        const hubId = url.searchParams.get('hubId') ?? undefined;
        const allMemories = this.store.listSemanticMemories({
          hubId,
          includeSuperseded: true,
        });
        const snap: MemoryObservatorySnapshot = {
          capsules: this.dreaming.buildAllCapsules(),
          activeMemories: allMemories.filter(m => m.validUntil === null),
          supersededMemories: allMemories.filter(m => m.validUntil !== null),
          recentSessions: this.store.listSessions({hubId, limit: 35}),
        };
        this.sendJson(res, 200, snap);
        return;
      }

      if (method === 'GET' && path === '/api/evidence/search') {
        const q = url.searchParams.get('q') ?? '';
        const hubId = url.searchParams.get('hubId') ?? undefined;
        this.sendJson(res, 200, this.store.searchEvidenceFts(q, hubId, 30));
        return;
      }

      if (method === 'POST' && path === '/api/memory/dream') {
        const report = await this.dreaming.runSleepConsolidation();
        this.broadcast({
          type: 'state.changed',
          scope: 'memory',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, report);
        return;
      }

      if (method === 'POST' && path === '/api/infra/doctor') {
        const report = await this.steward.runEnvironmentDoctor();
        this.broadcast({
          type: 'state.changed',
          scope: 'infra',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, report);
        return;
      }

      const retroMatch = /^\/api\/infra\/retro\/([^/]+)$/.exec(path);
      if (method === 'POST' && retroMatch) {
        const resRetro = this.steward.runRetroOptimization(retroMatch[1]!);
        this.broadcast({
          type: 'state.changed',
          scope: 'hubs',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, resRetro ?? {ok: false});
        return;
      }

      if (method === 'POST' && path === '/api/infra/evolve') {
        const body = asRecord(await this.readJsonBody(req));
        const chg = await this.steward.proposeInfraEvolution({
          hubId: reqString(body, 'hubId', 80),
          infraRepoId: reqString(body, 'infraRepoId', 80),
          title: reqString(body, 'title', 200),
          rationale: reqString(body, 'rationale', 4096),
          permissionTier: reqEnum(body, 'permissionTier', PERMISSION_TIERS),
          worktreesRoot: this.worktreesRoot,
        });
        this.broadcast({
          type: 'state.changed',
          scope: 'changes',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 201, chg);
        return;
      }

      if (method === 'POST' && path === '/api/infra/constitution') {
        const body = asRecord(await this.readJsonBody(req));
        const updated = this.store.saveConstitution(
          reqString(body, 'markdown', 65_536),
          optStringArray(body, 'blockedCommands', 64),
          'human_operator',
        );
        this.broadcast({
          type: 'state.changed',
          scope: 'infra',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, updated);
        return;
      }

      if (method === 'POST' && path === '/api/infra/skills') {
        const body = asRecord(await this.readJsonBody(req));
        const skill = this.store.upsertSkill({
          slug: reqString(body, 'slug', 80),
          title: reqString(body, 'title', 140),
          category: reqEnum(body, 'category', [
            'grill',
            'ddd',
            'architecture',
            'qa',
            'retro',
            'infra',
          ] as const),
          version: optString(body, 'version', '1.0.0', 32),
          promptBody: reqString(body, 'promptBody', 32_768),
          updatedBy: 'human_operator',
        });
        this.broadcast({
          type: 'state.changed',
          scope: 'infra',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 201, skill);
        return;
      }

      if (method === 'POST' && path === '/api/infra/adapters') {
        const manifest = validateAdapterManifest(await this.readJsonBody(req));
        this.store.upsertAdapterManifest(manifest);
        const probe = await this.adapters.probeAdapter(manifest);
        this.store.updateAdapterProbe(manifest.id, probe.ok, probe.message);
        this.broadcast({
          type: 'state.changed',
          scope: 'infra',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 201, {manifest, probe});
        return;
      }

      const deleteAdapterMatch =
        /^\/api\/infra\/adapters\/([^/]+)\/delete$/.exec(path);
      if (method === 'POST' && deleteAdapterMatch) {
        this.store.deleteAdapter(deleteAdapterMatch[1]!);
        this.broadcast({
          type: 'state.changed',
          scope: 'infra',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, {ok: true});
        return;
      }

      if (method === 'POST' && path === '/api/infra/providers') {
        const body = asRecord(await this.readJsonBody(req));
        const providerId = reqString(body, 'providerId', 80);
        const baseUrl = optString(body, 'baseUrl', '');
        if (baseUrl) {
          this.store.updateModelProviderEndpoint(providerId, baseUrl);
        }
        if (
          body['apiKey'] !== undefined &&
          typeof body['apiKey'] === 'string'
        ) {
          this.vault.setApiKey(providerId, body['apiKey']);
        }
        this.broadcast({
          type: 'state.changed',
          scope: 'infra',
          at: new Date().toISOString(),
        });
        this.sendJson(
          res,
          200,
          this.store.listModelProviders(id => this.vault.getKeyStatus(id)),
        );
        return;
      }

      const daemonMatch = /^\/api\/infra\/daemons\/([^/]+)$/.exec(path);
      if (method === 'POST' && daemonMatch) {
        const body = asRecord(await this.readJsonBody(req));
        const id = reqEnum({id: daemonMatch[1]}, 'id', [
          'continuity_watchdog',
          'dreaming_consolidator',
          'infra_patrol',
        ] as const);
        const daemons = this.store.updateDaemon(id, {
          enabled: Boolean(body['enabled']),
        });
        this.sendJson(res, 200, daemons);
        return;
      }

      if (method === 'GET' && path === '/api/schema/controls') {
        this.sendJson(res, 200, {
          presets: ['autopilot', 'guided', 'strict_audit'] as const,
          controls: CONTROL_SCHEMA_REGISTRY,
          policies: INTENT_PRESETS,
        });
        return;
      }

      if (method === 'GET' && path === '/api/infra/outbox') {
        const limit = Number.parseInt(
          url.searchParams.get('limit') ?? '100',
          10,
        );
        this.sendJson(
          res,
          200,
          this.store.listOutboxEffects(
            Number.isFinite(limit) && limit > 0 ? Math.min(limit, 250) : 100,
          ),
        );
        return;
      }

      const outboxRetryMatch = /^\/api\/infra\/outbox\/([^/]+)\/retry$/.exec(
        path,
      );
      if (method === 'POST' && outboxRetryMatch) {
        const row = this.store.requeueOutboxEffect(outboxRetryMatch[1]!);
        this.broadcast({
          type: 'state.changed',
          scope: 'infra',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, row);
        return;
      }

      if (method === 'GET' && path === '/api/missions') {
        const hubId = url.searchParams.get('hubId') ?? undefined;
        const includeArchived =
          url.searchParams.get('includeArchived') === '1' ||
          url.searchParams.get('includeArchived') === 'true';
        this.sendJson(
          res,
          200,
          this.store.missions.listMissions(hubId, includeArchived),
        );
        return;
      }

      if (method === 'POST' && path === '/api/missions') {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        const body = asRecord(await this.readJsonBody(req));
        if (
          body['documents'] !== undefined &&
          !Array.isArray(body['documents'])
        ) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'Field "documents" must be an array',
            400,
          );
        }
        const rawDocs = Array.isArray(body['documents'])
          ? body['documents']
          : [];
        if (rawDocs.length > 24) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'Field "documents" exceeds maximum of 24 items',
            400,
          );
        }
        const documents = rawDocs.map((d, idx) => {
          const rec = asRecord(d, `documents[${idx}]`);
          return {
            title: reqString(rec, 'title', 200),
            content: reqString(rec, 'content', 65_536),
          };
        });
        const cfgRaw =
          body['configOverrides'] !== undefined
            ? asRecord(body['configOverrides'], 'configOverrides')
            : undefined;
        const configOverrides: MissionConfigOverrides | undefined = cfgRaw
          ? {
              budgetUsdLimit:
                cfgRaw['budgetUsdLimit'] !== undefined
                  ? optNumber(cfgRaw, 'budgetUsdLimit', 25, 0.1, 10_000)
                  : undefined,
              maxOvernightHours:
                cfgRaw['maxOvernightHours'] !== undefined
                  ? optNumber(cfgRaw, 'maxOvernightHours', 8, 0.25, 72)
                  : undefined,
              maxParallelSlots:
                cfgRaw['maxParallelSlots'] !== undefined
                  ? Math.trunc(optNumber(cfgRaw, 'maxParallelSlots', 3, 1, 8))
                  : undefined,
              maxDiscussionRounds:
                cfgRaw['maxDiscussionRounds'] !== undefined
                  ? Math.trunc(
                      optNumber(cfgRaw, 'maxDiscussionRounds', 3, 1, 6),
                    )
                  : undefined,
              maxRevisions:
                cfgRaw['maxRevisions'] !== undefined
                  ? Math.trunc(optNumber(cfgRaw, 'maxRevisions', 3, 1, 10))
                  : undefined,
              maxLocalPrdEdits:
                cfgRaw['maxLocalPrdEdits'] !== undefined
                  ? Math.trunc(optNumber(cfgRaw, 'maxLocalPrdEdits', 5, 1, 20))
                  : undefined,
              leadAdapterId:
                optString(cfgRaw, 'leadAdapterId', '') || undefined,
              leadModel: optString(cfgRaw, 'leadModel', '') || undefined,
              workerAdapterId:
                optString(cfgRaw, 'workerAdapterId', '') || undefined,
              workerModel: optString(cfgRaw, 'workerModel', '') || undefined,
            }
          : undefined;

        const createReq: CreateMissionRequest = {
          hubId: optString(body, 'hubId', '') || undefined,
          repoIds: optStringArray(body, 'repoIds', 32),
          repoPaths: optStringArray(body, 'repoPaths', 32),
          projectId: optString(body, 'projectId', '') || undefined,
          title: optString(body, 'title', '') || undefined,
          rawIntent: reqString(body, 'rawIntent', 32_768),
          documents,
          preset:
            body['preset'] !== undefined
              ? reqEnum<IntentPresetId>(body, 'preset', [
                  'autopilot',
                  'guided',
                  'strict_audit',
                ])
              : undefined,
          executionMode:
            body['executionMode'] !== undefined
              ? reqEnum<ExecutionMode>(body, 'executionMode', [
                  'live',
                  'simulation',
                ])
              : undefined,
          triageTrack:
            body['triageTrack'] !== undefined
              ? reqEnum<TriageTrack>(body, 'triageTrack', [
                  'express',
                  'standard',
                  'full_hama',
                ])
              : undefined,
          parentBaselineId:
            optString(body, 'parentBaselineId', '') || undefined,
          configOverrides,
        };
        const created = await this.missions.createMission(createReq);
        this.broadcast({
          type: 'state.changed',
          scope: 'missions',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 201, created);
        return;
      }

      if (method === 'POST' && path === '/api/missions/probe') {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        const body = asRecord(await this.readJsonBody(req));
        const probed = await this.missions.probeIntent({
          hubId: optString(body, 'hubId', '') || undefined,
          repoIds: optStringArray(body, 'repoIds', 32),
          repoPaths: optStringArray(body, 'repoPaths', 32),
          rawIntent: reqString(body, 'rawIntent', 32_768),
          executionMode:
            body['executionMode'] !== undefined
              ? reqEnum<ExecutionMode>(body, 'executionMode', [
                  'live',
                  'simulation',
                ])
              : undefined,
        });
        this.sendJson(res, 200, probed);
        return;
      }

      const missionProbeMatch = /^\/api\/missions\/([^/]+)\/probe$/.exec(path);
      if (method === 'GET' && missionProbeMatch) {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        this.sendJson(
          res,
          200,
          await this.missions.getMissionProbe(missionProbeMatch[1]!),
        );
        return;
      }

      const missionDetailMatch = /^\/api\/missions\/([^/]+)$/.exec(path);
      if (method === 'GET' && missionDetailMatch) {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        this.sendJson(
          res,
          200,
          this.missions.getMissionDetail(missionDetailMatch[1]!),
        );
        return;
      }

      const missionFocusMatch = /^\/api\/missions\/([^/]+)\/focus$/.exec(path);
      if (method === 'GET' && missionFocusMatch) {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        this.sendJson(
          res,
          200,
          this.missions.getFocusProjection(missionFocusMatch[1]!),
        );
        return;
      }

      const missionDecisionMatch = /^\/api\/missions\/([^/]+)\/decisions$/.exec(
        path,
      );
      if (method === 'POST' && missionDecisionMatch) {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        const parsed = validateDecisionInput(await this.readJsonBody(req));
        const out = await this.missions.resolveDecision(
          missionDecisionMatch[1]!,
          parsed,
        );
        this.broadcast({
          type: 'state.changed',
          scope: 'missions',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, out);
        return;
      }

      const missionControlMatch = /^\/api\/missions\/([^/]+)\/controls?$/.exec(
        path,
      );
      if (method === 'POST' && missionControlMatch) {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        const parsed = validateControlCommand(await this.readJsonBody(req));
        const out = await this.missions.executeControl(
          missionControlMatch[1]!,
          parsed,
        );
        this.broadcast({
          type: 'state.changed',
          scope: 'missions',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, out);
        return;
      }

      const missionHamaMatch = /^\/api\/missions\/([^/]+)\/hama$/.exec(path);
      if (method === 'GET' && missionHamaMatch) {
        if (!this.hama) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'HAMA engine unavailable',
            500,
          );
        }
        this.sendJson(res, 200, this.hama.getDetail(missionHamaMatch[1]!));
        return;
      }

      const missionCommentMatch = /^\/api\/missions\/([^/]+)\/comments$/.exec(
        path,
      );
      if (method === 'POST' && missionCommentMatch) {
        if (!this.hama) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'HAMA engine unavailable',
            500,
          );
        }
        const body = asRecord(await this.readJsonBody(req));
        const comment = this.hama.addComment(missionCommentMatch[1]!, {
          scopeKey: reqString(body, 'scopeKey', 120),
          paragraphRef: optString(body, 'paragraphRef', '', 160) || undefined,
          authorKind:
            body['authorKind'] !== undefined
              ? reqEnum(body, 'authorKind', ['human', 'agent'] as const)
              : 'human',
          authorLabel: optString(body, 'authorLabel', 'operator', 120),
          severity:
            body['severity'] !== undefined
              ? reqEnum(body, 'severity', ['blocking', 'advisory'] as const)
              : 'advisory',
          body: reqString(body, 'body', 8192),
        });
        this.sendJson(res, 201, comment);
        return;
      }

      const resolveCommentMatch =
        /^\/api\/missions\/([^/]+)\/comments\/([^/]+)\/disposition$/.exec(path);
      if (method === 'POST' && resolveCommentMatch) {
        if (!this.hama) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'HAMA engine unavailable',
            500,
          );
        }
        const body = asRecord(await this.readJsonBody(req));
        const updated = this.hama.resolveComment(
          resolveCommentMatch[1]!,
          resolveCommentMatch[2]!,
          {
            disposition: reqEnum(body, 'disposition', [
              'open',
              'accepted',
              'changed',
              'rejected',
              'deferred',
            ] as const),
            resolutionNote: optString(body, 'resolutionNote', '', 2048),
            resolvedBy: optString(body, 'resolvedBy', 'human_operator', 120),
            actorKind:
              body['actorKind'] !== undefined
                ? reqEnum(body, 'actorKind', ['human', 'agent'] as const)
                : 'human',
          },
        );
        this.sendJson(res, 200, updated);
        return;
      }

      const readinessMatch = /^\/api\/missions\/([^/]+)\/readiness$/.exec(path);
      if (method === 'GET' && readinessMatch) {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        this.sendJson(
          res,
          200,
          await this.missions.checkDeliveryReadiness(readinessMatch[1]!),
        );
        return;
      }

      const evidenceMatch = /^\/api\/missions\/([^/]+)\/evidence$/.exec(path);
      if (method === 'GET' && evidenceMatch) {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        const bundle = await this.missions.exportEvidenceBundle(
          evidenceMatch[1]!,
        );
        this.sendJson(res, 200, {
          bundle,
          verification: verifyEvidenceBundle(bundle),
        });
        return;
      }

      const traceabilityMatch = /^\/api\/missions\/([^/]+)\/traceability$/.exec(
        path,
      );
      if (method === 'GET' && traceabilityMatch) {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        this.sendJson(
          res,
          200,
          await this.missions.getMissionTraceability(traceabilityMatch[1]!),
        );
        return;
      }

      const missionEventsMatch = /^\/api\/missions\/([^/]+)\/events$/.exec(
        path,
      );
      if (method === 'GET' && missionEventsMatch) {
        const mission = this.store.missions.getMission(missionEventsMatch[1]!);
        if (!mission) {
          throw new ForgeError(
            'NOT_FOUND',
            `Mission "${missionEventsMatch[1]!}" not found`,
            404,
          );
        }
        const rawLimit = url.searchParams.get('limit');
        const limit =
          rawLimit !== null ? Number.parseInt(rawLimit, 10) : 10_000;
        this.sendJson(
          res,
          200,
          this.store.missions.listEvents(
            mission.id,
            Number.isFinite(limit) && limit > 0
              ? Math.min(limit, 50_000)
              : 10_000,
          ),
        );
        return;
      }

      if (method === 'GET' && path === '/api/baselines') {
        const projectId = url.searchParams.get('projectId') || undefined;
        this.sendJson(res, 200, this.store.hama.listBaselines(projectId));
        return;
      }

      const baselineImpactMatch = /^\/api\/baselines\/([^/]+)\/impact$/.exec(
        path,
      );
      if ((method === 'POST' || method === 'GET') && baselineImpactMatch) {
        if (!this.missions) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Mission orchestrator unavailable',
            500,
          );
        }
        let compareTo = url.searchParams.get('compareTo') ?? '';
        if (method === 'POST') {
          const body = asRecord(await this.readJsonBody(req));
          compareTo =
            optString(body, 'nextBaselineId', '') ||
            optString(body, 'compareToBaselineId', '') ||
            compareTo;
        }
        if (!compareTo) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            method === 'POST'
              ? 'Field "nextBaselineId" or "compareToBaselineId" is required'
              : 'Query parameter "compareTo" is required',
            400,
          );
        }
        this.sendJson(
          res,
          200,
          this.missions.compareBaselines(baselineImpactMatch[1]!, compareTo),
        );
        return;
      }

      const baselineMatch = /^\/api\/baselines\/([^/]+)$/.exec(path);
      if (method === 'GET' && baselineMatch) {
        const b = this.store.hama.getBaseline(baselineMatch[1]!);
        if (!b) {
          throw new ForgeError(
            'NOT_FOUND',
            `Baseline "${baselineMatch[1]!}" not found`,
            404,
          );
        }
        this.sendJson(res, 200, b);
        return;
      }

      if (method === 'POST' && path === '/api/memory/retain') {
        if (!this.hindsight) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Hindsight engine unavailable',
            500,
          );
        }
        const body = asRecord(await this.readJsonBody(req));
        const hubId = reqString(body, 'hubId', 80);
        if (!this.store.getHub(hubId)) {
          throw new ForgeError('NOT_FOUND', `Hub "${hubId}" not found`, 404);
        }
        const rawTier =
          body['authorityTier'] !== undefined
            ? reqEnum(body, 'authorityTier', [
                'L3_locked',
                'L2_verified',
                'L1_observed',
              ] as const)
            : undefined;
        const cappedTier =
          rawTier === 'L3_locked' ? ('L2_verified' as const) : rawTier;
        const resRetain = this.hindsight.retain({
          hubId,
          repoId: optString(body, 'repoId', '') || null,
          missionId: optString(body, 'missionId', '') || null,
          executionMode:
            body['executionMode'] !== undefined
              ? reqEnum<ExecutionMode>(body, 'executionMode', [
                  'live',
                  'simulation',
                ])
              : 'live',
          sourceType: reqString(body, 'sourceType', 80),
          occurredAt: optString(body, 'occurredAt', '') || undefined,
          rawText: reqString(body, 'rawText', 131_072),
          authorityTier: cappedTier,
        });
        this.sendJson(res, 201, resRetain);
        return;
      }

      if (method === 'POST' && path === '/api/memory/recall') {
        if (!this.hindsight) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Hindsight engine unavailable',
            500,
          );
        }
        const body = asRecord(await this.readJsonBody(req));
        const resRecall = this.hindsight.recall({
          hubId: reqString(body, 'hubId', 80),
          executionMode:
            body['executionMode'] !== undefined
              ? reqEnum<ExecutionMode>(body, 'executionMode', [
                  'live',
                  'simulation',
                ])
              : 'live',
          query: reqString(body, 'query', 2048),
          limit:
            body['limit'] !== undefined
              ? Math.trunc(optNumber(body, 'limit', 8, 1, 50))
              : undefined,
          sinceIso: optString(body, 'sinceIso', '') || undefined,
          untilIso: optString(body, 'untilIso', '') || undefined,
          includeRejected: Boolean(body['includeRejected']),
        });
        this.sendJson(res, 200, resRecall);
        return;
      }

      if (method === 'POST' && path === '/api/memory/reflect') {
        if (!this.hindsight) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Hindsight engine unavailable',
            500,
          );
        }
        const body = asRecord(await this.readJsonBody(req));
        const resReflect = this.hindsight.reflect({
          hubId: reqString(body, 'hubId', 80),
          executionMode:
            body['executionMode'] !== undefined
              ? reqEnum<ExecutionMode>(body, 'executionMode', [
                  'live',
                  'simulation',
                ])
              : 'live',
          question: reqString(body, 'question', 2048),
          limit:
            body['limit'] !== undefined
              ? Math.trunc(optNumber(body, 'limit', 8, 1, 50))
              : undefined,
        });
        this.sendJson(res, 200, resReflect);
        return;
      }

      if (method === 'GET' && path === '/api/memory/living-docs') {
        const hubId =
          url.searchParams.get('hubId') ??
          this.store.listHubs(false)[0]?.id ??
          '';
        const mode = this.parseExecutionModeQuery(
          url.searchParams.get('executionMode'),
        );
        this.sendJson(
          res,
          200,
          hubId ? this.store.memory.listLivingDocs(hubId, mode) : [],
        );
        return;
      }

      if (method === 'GET' && path === '/api/memory/observations') {
        const hubId =
          url.searchParams.get('hubId') ??
          this.store.listHubs(false)[0]?.id ??
          '';
        const mode = this.parseExecutionModeQuery(
          url.searchParams.get('executionMode'),
        );
        const includeRetired = url.searchParams.get('includeRetired') === '1';
        this.sendJson(
          res,
          200,
          hubId
            ? this.store.memory.listObservations(hubId, mode, includeRetired)
            : [],
        );
        return;
      }

      if (method === 'POST' && path === '/api/memory/reconcile-git') {
        if (!this.hindsight || !this.runner) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Hindsight or process runner unavailable',
            500,
          );
        }
        const body = asRecord(await this.readJsonBody(req));
        const hubId =
          optString(body, 'hubId', '') ||
          this.store.listHubs(false)[0]?.id ||
          '';
        if (!hubId || !this.store.getHub(hubId)) {
          throw new ForgeError('NOT_FOUND', `Hub "${hubId}" not found`, 404);
        }
        const mode: ExecutionMode =
          body['executionMode'] !== undefined
            ? reqEnum<ExecutionMode>(body, 'executionMode', [
                'live',
                'simulation',
              ])
            : 'live';
        const repoIds = optStringArray(body, 'repoIds', 32);
        const repos =
          repoIds.length > 0
            ? this.store
                .listRepositories(hubId)
                .filter(r => repoIds.includes(r.id))
            : this.store.listRepositories(hubId);
        const recResult = await this.hindsight.reconcileExternalGitChanges({
          hubId,
          executionMode: mode,
          repos,
          runner: this.runner,
        });
        this.broadcast({
          type: 'state.changed',
          scope: 'memory',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, recResult);
        return;
      }

      const obsReconcileMatch =
        /^\/api\/memory\/observations\/([^/]+)\/reconcile$/.exec(path);
      if (method === 'POST' && obsReconcileMatch) {
        if (!this.hindsight) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            'Hindsight engine unavailable',
            500,
          );
        }
        const body = asRecord(await this.readJsonBody(req));
        const updated = this.hindsight.resolveObservationConflict(
          obsReconcileMatch[1]!,
          {
            resolution: reqEnum(body, 'resolution', [
              'adopt_code',
              'keep_rule',
              'retire',
            ] as const),
            newStatement:
              optString(body, 'newStatement', '', 4096) || undefined,
            note: optString(body, 'note', '', 1024) || undefined,
          },
        );
        this.broadcast({
          type: 'state.changed',
          scope: 'memory',
          at: new Date().toISOString(),
        });
        this.sendJson(res, 200, updated);
        return;
      }

      if (method === 'GET' && path === '/api/memory/graph') {
        const hubId =
          url.searchParams.get('hubId') ??
          this.store.listHubs(false)[0]?.id ??
          '';
        const mode = this.parseExecutionModeQuery(
          url.searchParams.get('executionMode'),
        );
        this.sendJson(
          res,
          200,
          hubId
            ? {
                entities: this.store.memory.listEntities(hubId, mode),
                edges: this.store.memory.listEdges(hubId, mode),
              }
            : {entities: [], edges: []},
        );
        return;
      }

      this.sendJson(res, 404, {
        code: 'NOT_FOUND',
        message: `Unknown route: ${method} ${path}`,
      });
    } catch (err) {
      if (err instanceof ForgeError) {
        this.sendJson(res, err.status, {
          code: err.code,
          message: err.message,
          details: err.details,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, {
        code: 'INTERNAL_ERROR',
        message,
      });
    }
  }

  private parseExecutionModeQuery(raw: string | null): ExecutionMode {
    if (raw === null || raw === '') {
      return 'live';
    }
    if (raw === 'live' || raw === 'simulation') {
      return raw;
    }
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Invalid executionMode "${raw}": must be "live" or "simulation"`,
      400,
    );
  }

  private buildBootstrapSnapshot(): BootstrapSnapshot {
    const capsules = this.dreaming.buildAllCapsules();
    const retentionMap = new Map(
      capsules.map(c => [c.hubId, c.retentionScore]),
    );
    const attentionQueue = rankAttentionQueue(
      this.store.listAttentionItems(false),
      retentionMap,
    );

    return {
      constitution: this.store.getConstitution(),
      hubs: this.store.listHubs(false),
      repositories: this.store.listRepositories(),
      domainTerms: this.store.listDomainTerms(),
      changes: this.store.listChanges(undefined, false),
      attentionQueue,
      capsules,
      adapters: this.store.listAdapterProfiles(),
      providers: this.store.listModelProviders(id =>
        this.vault.getKeyStatus(id),
      ),
      skills: this.store.listSkills(),
      daemons: this.store.getDaemons(),
      slotLoad: this.adapters.getSlotLoad(),
      recentAuditLogs: this.store.listAuditLedger(60),
    };
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 2_097_152) {
        throw new ForgeError('VALIDATION_ERROR', 'Request payload > 2MB', 413);
      }
      chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ForgeError('VALIDATION_ERROR', 'Malformed JSON body', 400);
    }
  }

  private sendJson(
    res: ServerResponse,
    status: number,
    payload: unknown,
  ): void {
    const raw = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(raw),
    });
    res.end(raw);
  }
}

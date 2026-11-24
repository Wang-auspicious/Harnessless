/**
 * Scoped `forge_station` Loopback HTTP MCP Server (`127.0.0.1:0/mcp`).
 * Authenticates per-attempt bearer tokens and exposes the 7 governed
 * ForgeOps contract, artifact, memory, human-escalation, amendment, and
 * epistemic submission tools over JSON-RPC 2.0.
 */

import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {closeSync, openSync, readSync, statSync} from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {spliceGhostNode} from '../core/twin-graph.ts';
import type {IGitWorktreeManager} from '../sandbox/contracts.ts';
import {ForgeError} from '../shared/errors.ts';
import type {AttentionItem, GraphNode} from '../shared/types.ts';
import type {ForgeStore} from '../store/database.ts';
import {
  CollabBus,
  isValidAudienceScope,
  isValidCollabMessageKind,
  narrowAudienceScope,
  type AudienceScope,
  type CollabMessageKind,
  type DelegateKernelRequest,
  type DelegateKernelResult,
} from './collab-bus.ts';
import type {
  IMcpStationServer,
  McpAttemptRegistration,
  McpAttemptRegistrationInput,
  McpSubmissionPayload,
} from './contracts.ts';

interface ActiveAttemptContext extends McpAttemptRegistrationInput {
  readonly attemptToken: string;
  retainCallCount: number;
  revoked: boolean;
}

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

const MCP_TOOL_DEFINITIONS = [
  {
    name: 'forge_get_contract',
    description:
      'Retrieve the locked slice contract, DDD Ubiquitous Language glossary, and acceptance criteria.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'forge_read_artifact',
    description:
      'Read a file strictly confined inside the active Change git worktree.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path inside the isolated worktree.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_memory_search',
    description:
      'Search active bi-temporal semantic memories (ADRs, conventions, pitfall lessons) for this Federation Hub.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {type: 'string'},
        limit: {type: 'number'},
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_memory_recall',
    description:
      'Recall grounded engineering memories using 4-channel Hindsight retrieval (FTS5, Vector, Entity Graph, Temporal).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {type: 'string'},
        limit: {type: 'number'},
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_memory_reflect',
    description:
      'Synthesize an engineering answer from Living Docs and Hindsight observations separating confirmed facts from inferences.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {type: 'string'},
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_memory_retain',
    description:
      'Record a concise L1_observed engineering discovery or constraint (capped at 5 calls per slice).',
    inputSchema: {
      type: 'object',
      properties: {
        title: {type: 'string'},
        claim: {type: 'string'},
        subjectKey: {type: 'string'},
        confidence: {type: 'number'},
      },
      required: ['title', 'claim'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_report_progress',
    description:
      'Report structured milestone progress back to the ForgeOps execution engine.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_ask_human',
    description:
      'Raise a single structured multiple-choice clarification question to the Human Attention Queue.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {type: 'string'},
        options: {type: 'array', items: {type: 'string'}},
        contextSnippet: {type: 'string'},
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_propose_amendment',
    description:
      'Propose a dynamic GhostNode plan amendment before the active WBS node.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {type: 'string'},
        description: {type: 'string'},
        gateCommand: {type: 'string'},
      },
      required: ['title', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_submit',
    description:
      'Submit the completed slice with 4-section epistemic separation (spec-confirmed facts vs agent hypotheses).',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        specConfirmedFacts: {type: 'array', items: {type: 'string'}},
        agentHypotheses: {type: 'array', items: {type: 'string'}},
        openConflicts: {type: 'array', items: {type: 'string'}},
        certifiedCriteriaIds: {type: 'array', items: {type: 'string'}},
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_collab_post',
    description:
      'Post a structured peer collaboration message (handoff, question, review, finding, decision, delegate) to the audience-scoped CollabBus.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'handoff',
            'question',
            'review',
            'finding',
            'decision',
            'delegate',
          ],
        },
        toAgent: {type: 'string'},
        summary: {type: 'string'},
        artifactRef: {type: 'string'},
        audienceScope: {type: 'string'},
        allowedReaders: {type: 'array', items: {type: 'string'}},
      },
      required: ['kind', 'summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'forge_collab_read',
    description:
      'Read sequence-ordered peer collaboration messages authorized for this attempt audience scope.',
    inputSchema: {
      type: 'object',
      properties: {
        sinceSeq: {type: 'number'},
        limit: {type: 'number'},
        kinds: {type: 'array', items: {type: 'string'}},
      },
      additionalProperties: false,
    },
  },
  {
    name: 'forge_collab_delegate',
    description:
      'Delegate a scoped sub-task to another native agent kernel via the collaboration bus.',
    inputSchema: {
      type: 'object',
      properties: {
        targetKernel: {type: 'string'},
        role: {type: 'string'},
        prompt: {type: 'string'},
        fileScope: {type: 'array', items: {type: 'string'}},
      },
      required: ['targetKernel', 'role', 'prompt'],
      additionalProperties: false,
    },
  },
] as const;

const MAX_ARTIFACT_READ_BYTES = 524_288;
const RESERVED_RETAIN_SUBJECT_PREFIXES = [
  'ddd:',
  'req:',
  'constitution:',
  'decision:',
];

function tokensMatchTimingSafe(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

function readBoundedArtifactFile(filePath: string, maxChars: number): string {
  const st = statSync(filePath);
  if (!st.isFile()) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      'forge_read_artifact target is not a regular file',
      400,
    );
  }
  const toRead = Math.min(st.size, MAX_ARTIFACT_READ_BYTES);
  if (toRead <= 0) {
    return '';
  }
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(toRead);
    let offset = 0;
    while (offset < toRead) {
      const n = readSync(fd, buf, offset, toRead - offset, offset);
      if (n <= 0) {
        break;
      }
      offset += n;
    }
    return buf.subarray(0, offset).toString('utf8').slice(0, maxChars);
  } finally {
    closeSync(fd);
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(item => (typeof item === 'string' ? item.trim() : String(item ?? '')))
    .filter(Boolean);
}

export class McpStationServer implements IMcpStationServer {
  private readonly store: ForgeStore;
  private readonly worktrees: IGitWorktreeManager;
  private readonly defaultCollabBus = new CollabBus();
  private readonly attempts = new Map<string, ActiveAttemptContext>();
  private readonly submissions = new Map<string, McpSubmissionPayload>();
  private server: Server | null = null;
  private boundBaseUrl = 'http://127.0.0.1:0';

  constructor(store: ForgeStore, worktrees: IGitWorktreeManager) {
    this.store = store;
    this.worktrees = worktrees;
  }

  get baseUrl(): string {
    return this.boundBaseUrl;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const srv = createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    await new Promise<void>((resolvePromise, rejectPromise) => {
      srv.once('error', rejectPromise);
      srv.listen(0, '127.0.0.1', () => {
        srv.removeListener('error', rejectPromise);
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          this.boundBaseUrl = `http://127.0.0.1:${addr.port}`;
        }
        this.server = srv;
        resolvePromise();
      });
    });
  }

  async stop(): Promise<void> {
    this.attempts.clear();
    this.submissions.clear();
    const srv = this.server;
    this.server = null;
    if (!srv) {
      return;
    }
    await Promise.race([
      new Promise<void>(resolvePromise => {
        srv.close(() => resolvePromise());
        srv.closeAllConnections?.();
      }),
      new Promise<void>(resolvePromise => setTimeout(resolvePromise, 2_000)),
    ]);
  }

  registerAttempt(input: McpAttemptRegistrationInput): McpAttemptRegistration {
    const attemptToken = `mcp-${randomUUID()}`;
    const ctx: ActiveAttemptContext = {
      ...input,
      attemptToken,
      retainCallCount: 0,
      revoked: false,
    };
    this.attempts.set(attemptToken, ctx);

    return {
      attemptToken,
      mcpEndpointUrl: `${this.boundBaseUrl}/mcp`,
      revoke: () => {
        const existing = this.attempts.get(attemptToken);
        if (existing) {
          existing.revoked = true;
        }
        this.attempts.delete(attemptToken);
        this.submissions.delete(attemptToken);
      },
    };
  }

  getSubmission(attemptToken: string): McpSubmissionPayload | null {
    return this.submissions.get(attemptToken) ?? null;
  }

  private findAttemptByToken(
    token: string | null,
  ): ActiveAttemptContext | undefined {
    if (!token) {
      return undefined;
    }
    let matched: ActiveAttemptContext | undefined;
    for (const candidate of this.attempts.values()) {
      if (tokensMatchTimingSafe(token, candidate.attemptToken)) {
        matched = candidate;
      }
    }
    return matched;
  }

  private extractBearerOrQueryToken(req: IncomingMessage): string | null {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string') {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    try {
      const parsedUrl = new URL(req.url ?? '/mcp', this.boundBaseUrl);
      const queryToken = parsedUrl.searchParams.get('token');
      if (queryToken && queryToken.trim().length > 0) {
        return queryToken.trim();
      }
    } catch {
      // Ignore malformed URL.
    }
    return null;
  }

  private async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let rawBody = '';
    try {
      rawBody = await this.readBody(req);
    } catch (err) {
      const status = err instanceof ForgeError ? err.status : 400;
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(
        res,
        status,
        {
          jsonrpc: '2.0',
          id: null,
          error: {code: status === 413 ? -32000 : -32700, message},
        },
        status === 413,
      );
      return;
    }

    let rpc: JsonRpcRequest = {};
    try {
      if (rawBody.trim().length > 0) {
        rpc = JSON.parse(rawBody) as JsonRpcRequest;
      }
    } catch {
      this.sendJson(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: {code: -32700, message: 'Parse error'},
      });
      return;
    }

    const reqId = rpc.id ?? null;
    const token = this.extractBearerOrQueryToken(req);
    const ctx = this.findAttemptByToken(token);

    if (!ctx || ctx.revoked) {
      this.sendJson(res, 401, {
        jsonrpc: '2.0',
        id: reqId,
        error: {
          code: -32001,
          message:
            'UNAUTHORIZED: Missing, invalid, or revoked MCP attempt token',
        },
      });
      return;
    }

    const method = rpc.method ?? '';

    try {
      if (method === 'initialize') {
        this.sendJson(res, 200, {
          jsonrpc: '2.0',
          id: reqId,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {tools: {}},
            serverInfo: {name: 'forge_station', version: '2.1.0'},
          },
        });
        return;
      }

      if (method.startsWith('notifications/')) {
        res.writeHead(204);
        res.end();
        return;
      }

      if (method === 'tools/list') {
        this.sendJson(res, 200, {
          jsonrpc: '2.0',
          id: reqId,
          result: {tools: MCP_TOOL_DEFINITIONS},
        });
        return;
      }

      if (method === 'tools/call') {
        const params = rpc.params ?? {};
        const toolName =
          typeof params['name'] === 'string' ? params['name'] : '';
        const args =
          params['arguments'] && typeof params['arguments'] === 'object'
            ? (params['arguments'] as Record<string, unknown>)
            : {};

        const toolOutput = await this.executeToolCall(ctx, toolName, args);
        this.sendJson(res, 200, {
          jsonrpc: '2.0',
          id: reqId,
          result: {
            content: [
              {
                type: 'text',
                text:
                  typeof toolOutput === 'string'
                    ? toolOutput
                    : JSON.stringify(toolOutput),
              },
            ],
            structured: toolOutput,
            isError: false,
          },
        });
        return;
      }

      this.sendJson(res, 200, {
        jsonrpc: '2.0',
        id: reqId,
        error: {code: -32601, message: `Method not found: ${method}`},
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof ForgeError ? err.code : 'INTERNAL_ERROR';
      this.sendJson(res, 200, {
        jsonrpc: '2.0',
        id: reqId,
        error: {
          code: -32003,
          message: `${code}: ${message}`,
        },
      });
    }
  }

  private recordCollabAudit(
    ctx: ActiveAttemptContext,
    actor: string,
    title: string,
    detail: string,
  ): void {
    try {
      if (!this.store.isOpen) {
        return;
      }
      this.store.appendAudit({
        hubId: ctx.hubId || null,
        changeId: ctx.changeId || null,
        category: 'gate_decision',
        actor,
        title,
        detail,
      });
    } catch {
      // Do not fail collaboration tool calls when synthetic test IDs omit change rows.
    }
  }

  private async executeToolCall(
    ctx: ActiveAttemptContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'forge_get_contract': {
        return {
          changeId: ctx.changeId,
          nodeId: ctx.nodeId,
          contractMarkdown: ctx.contractMarkdown,
        };
      }

      case 'forge_read_artifact': {
        const relPath =
          typeof args['path'] === 'string' ? args['path'].trim() : '';
        if (!relPath) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'forge_read_artifact requires a non-empty "path"',
            400,
          );
        }
        const safePath = this.worktrees.resolveInside(
          ctx.worktreePath,
          relPath,
        );
        const content = readBoundedArtifactFile(safePath, 65_536);
        return {path: relPath, content};
      }

      case 'forge_memory_search':
      case 'forge_memory_recall': {
        const query =
          typeof args['query'] === 'string' ? args['query'].trim() : '';
        const limit =
          typeof args['limit'] === 'number' && args['limit'] > 0
            ? Math.min(25, Math.floor(args['limit']))
            : 8;
        if (ctx.hindsight) {
          return ctx.hindsight.recall(query, limit);
        }
        const memories = this.store.searchActiveSemanticMemories(
          query,
          ctx.hubId,
          limit,
        );
        return {
          count: memories.length,
          memories: memories.map(m => ({
            id: m.id,
            kind: m.kind,
            title: m.title,
            summary: m.summary,
            pathAnchors: m.pathAnchors,
          })),
        };
      }

      case 'forge_memory_reflect': {
        const question =
          typeof args['question'] === 'string' ? args['question'].trim() : '';
        if (!question) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'forge_memory_reflect requires a non-empty "question"',
            400,
          );
        }
        if (ctx.hindsight) {
          return ctx.hindsight.reflect(question);
        }
        return {
          question,
          answerMarkdown:
            'Hindsight reflection bridge unavailable in isolated mode.',
          confirmedFacts: [],
          inferences: [],
          contradictions: [],
        };
      }

      case 'forge_memory_retain': {
        if (ctx.retainCallCount >= 5) {
          throw new ForgeError(
            'POLICY_DENIED',
            'forge_memory_retain rate limit reached (max 5 calls per slice)',
            429,
          );
        }
        const title =
          typeof args['title'] === 'string' ? args['title'].trim() : '';
        const claim =
          typeof args['claim'] === 'string' ? args['claim'].trim() : '';
        const subjectKey =
          typeof args['subjectKey'] === 'string'
            ? args['subjectKey'].trim()
            : undefined;
        if (!title || !claim) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'forge_memory_retain requires non-empty "title" and "claim"',
            400,
          );
        }
        if (
          subjectKey &&
          RESERVED_RETAIN_SUBJECT_PREFIXES.some(prefix =>
            subjectKey.toLowerCase().startsWith(prefix),
          )
        ) {
          throw new ForgeError(
            'POLICY_DENIED',
            `forge_memory_retain cannot overwrite reserved subjectKey prefix "${subjectKey}"`,
            403,
          );
        }
        const rawConfidence =
          typeof args['confidence'] === 'number' &&
          Number.isFinite(args['confidence'])
            ? args['confidence']
            : 0.65;
        const confidence = Math.max(0.05, Math.min(0.65, rawConfidence));

        ctx.retainCallCount += 1;
        if (ctx.hindsight) {
          return ctx.hindsight.retainObserved(
            title,
            claim,
            subjectKey,
            confidence,
          );
        }
        const mem = this.store.recordSemanticMemory({
          hubId: ctx.hubId,
          kind: 'convention',
          title,
          summary: claim,
        });
        return {
          retainedId: mem.id,
          authorityTier: 'L1_observed',
          confidence,
        };
      }

      case 'forge_report_progress': {
        const summary =
          typeof args['summary'] === 'string' ? args['summary'].trim() : '';
        if (ctx.onProgress) {
          ctx.onProgress(summary);
        }
        return {ok: true, summary};
      }

      case 'forge_ask_human': {
        const question =
          typeof args['question'] === 'string' ? args['question'].trim() : '';
        const options = asStringArray(args['options']);
        const normalizedOptions =
          options.length >= 2
            ? options
            : ['Approve recommended path', 'Hold for manual adjustment'];
        const contextSnippet =
          typeof args['contextSnippet'] === 'string'
            ? args['contextSnippet']
            : '';

        let item: AttentionItem;
        if (ctx.onAskHuman) {
          item = ctx.onAskHuman(question, normalizedOptions, contextSnippet);
        } else {
          item = this.store.raiseAttention({
            hubId: ctx.hubId,
            changeId: ctx.changeId,
            nodeId: ctx.nodeId,
            kind: 'question',
            question,
            options: normalizedOptions,
            contextSnippet,
          });
        }
        return {attentionItem: item};
      }

      case 'forge_propose_amendment': {
        const title =
          typeof args['title'] === 'string' ? args['title'].trim() : '';
        const description =
          typeof args['description'] === 'string'
            ? args['description'].trim()
            : '';
        const gateCommand =
          typeof args['gateCommand'] === 'string'
            ? args['gateCommand'].trim()
            : undefined;

        let ghostNode: GraphNode;
        if (ctx.onProposeAmendment) {
          ghostNode = ctx.onProposeAmendment(title, description, gateCommand);
        } else {
          const nodes = this.store.listGraphNodes(ctx.changeId);
          const edges = this.store.listGraphEdges(ctx.changeId);
          const ghostCount = nodes.filter(n => n.kind === 'ghost').length;
          const spliced = spliceGhostNode(nodes, edges, {
            changeId: ctx.changeId,
            code: `GHOST-${ghostCount + 1}`,
            title: title || 'Dynamic Amendment',
            description: description || 'Runtime plan amendment',
            insertBeforeNodeId: ctx.nodeId,
            gateCommand: gateCommand ?? null,
            assignedAdapterId: null,
            assignedModel: null,
            nowIso: new Date().toISOString(),
          });
          this.store.saveTwinGraph(ctx.changeId, spliced.nodes, spliced.edges);
          ghostNode = spliced.nodes[spliced.nodes.length - 1]!;
        }
        return {ghostNode};
      }

      case 'forge_submit': {
        const payload: McpSubmissionPayload = {
          summary:
            typeof args['summary'] === 'string' ? args['summary'].trim() : '',
          specConfirmedFacts: asStringArray(args['specConfirmedFacts']),
          agentHypotheses: asStringArray(args['agentHypotheses']),
          openConflicts: asStringArray(args['openConflicts']),
          certifiedCriteriaIds: asStringArray(args['certifiedCriteriaIds']),
        };
        this.submissions.set(ctx.attemptToken, payload);
        if (ctx.onSubmitted) {
          ctx.onSubmitted(payload);
        }
        return {accepted: true, submission: payload};
      }

      case 'forge_collab_post': {
        const rawKind =
          typeof args['kind'] === 'string' ? args['kind'].trim() : '';
        if (!isValidCollabMessageKind(rawKind)) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            `forge_collab_post requires a valid "kind" (got "${rawKind}")`,
            400,
          );
        }
        const summary =
          typeof args['summary'] === 'string' ? args['summary'].trim() : '';
        if (!summary) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'forge_collab_post requires a non-empty "summary"',
            400,
          );
        }
        const toAgent =
          typeof args['toAgent'] === 'string' &&
          args['toAgent'].trim().length > 0
            ? args['toAgent'].trim()
            : null;
        const artifactRef =
          typeof args['artifactRef'] === 'string' &&
          args['artifactRef'].trim().length > 0
            ? args['artifactRef'].trim()
            : null;

        const callerScope: AudienceScope = ctx.audienceScope ?? 'team';
        let requestedScope: AudienceScope | undefined;
        if (
          typeof args['audienceScope'] === 'string' &&
          args['audienceScope'].trim().length > 0
        ) {
          const candidateScope = args['audienceScope'].trim();
          if (!isValidAudienceScope(candidateScope)) {
            throw new ForgeError(
              'VALIDATION_ERROR',
              `Invalid audienceScope "${candidateScope}"`,
              400,
            );
          }
          requestedScope = candidateScope;
        }
        const effectiveScope = narrowAudienceScope(callerScope, requestedScope);
        const allowedReaders = asStringArray(args['allowedReaders']);
        const actor =
          ctx.agentIdentity?.trim() || `${ctx.changeId}:${ctx.nodeId}`;
        const bus = ctx.collabBus ?? this.defaultCollabBus;
        const missionId = ctx.missionId?.trim() || ctx.changeId;

        const message = bus.post({
          missionId,
          taskId: ctx.nodeId,
          fromAgent: actor,
          fromKernel: actor,
          toAgent,
          kind: rawKind,
          summary,
          artifactRef,
          audienceScope: effectiveScope,
          allowedReaders,
        });

        this.recordCollabAudit(
          ctx,
          actor,
          `forge_collab_post (${rawKind})`,
          `seq=${message.seq} scope=${effectiveScope} to=${toAgent ?? 'all'}: ${summary.slice(0, 160)}`,
        );

        return {ok: true, message};
      }

      case 'forge_collab_read': {
        const sinceSeq =
          typeof args['sinceSeq'] === 'number' &&
          Number.isFinite(args['sinceSeq'])
            ? Math.max(0, Math.floor(args['sinceSeq']))
            : 0;
        const limit =
          typeof args['limit'] === 'number' &&
          Number.isFinite(args['limit']) &&
          args['limit'] > 0
            ? Math.min(100, Math.floor(args['limit']))
            : 50;
        const rawKinds = asStringArray(args['kinds']);
        const kinds: CollabMessageKind[] = rawKinds.filter(
          (k): k is CollabMessageKind => isValidCollabMessageKind(k),
        );
        const readerId =
          ctx.agentIdentity?.trim() || `${ctx.changeId}:${ctx.nodeId}`;
        const readerScope: AudienceScope = ctx.audienceScope ?? 'team';
        const bus = ctx.collabBus ?? this.defaultCollabBus;
        const missionId = ctx.missionId?.trim() || ctx.changeId;

        const messages = bus.query({
          missionId,
          sinceSeq,
          limit,
          kinds: kinds.length > 0 ? kinds : undefined,
          readerId,
          readerScope,
          readerTaskId: ctx.nodeId,
        });

        return {
          missionId,
          audienceScope: readerScope,
          latestSeq: bus.getLatestSeq(missionId),
          count: messages.length,
          messages,
        };
      }

      case 'forge_collab_delegate': {
        const targetKernel =
          typeof args['targetKernel'] === 'string'
            ? args['targetKernel'].trim()
            : '';
        const role =
          typeof args['role'] === 'string' ? args['role'].trim() : '';
        const prompt =
          typeof args['prompt'] === 'string' ? args['prompt'].trim() : '';
        if (!targetKernel || !role || !prompt) {
          throw new ForgeError(
            'VALIDATION_ERROR',
            'forge_collab_delegate requires non-empty "targetKernel", "role", and "prompt"',
            400,
          );
        }
        const fileScope = asStringArray(args['fileScope']);
        const actor =
          ctx.agentIdentity?.trim() || `${ctx.changeId}:${ctx.nodeId}`;
        const audienceScope: AudienceScope = ctx.audienceScope ?? 'team';
        const missionId = ctx.missionId?.trim() || ctx.changeId;
        const reqPayload: DelegateKernelRequest = {
          missionId,
          taskId: ctx.nodeId,
          fromAgent: actor,
          targetKernel,
          role,
          prompt,
          fileScope: fileScope.length > 0 ? fileScope : ctx.fileScope,
          audienceScope,
        };

        let result: DelegateKernelResult;
        if (ctx.onCollabDelegate) {
          result = await ctx.onCollabDelegate(reqPayload);
        } else {
          const bus = ctx.collabBus ?? this.defaultCollabBus;
          result = bus.recordDelegate(reqPayload);
        }

        this.recordCollabAudit(
          ctx,
          actor,
          `forge_collab_delegate (${targetKernel}/${role})`,
          `delegateId=${result.delegateId} scope=${audienceScope} status=${result.status}: ${prompt.slice(0, 140)}`,
        );

        return result;
      }

      default:
        throw new ForgeError(
          'NOT_FOUND',
          `Unknown MCP station tool "${toolName}"`,
          404,
        );
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolvePromise, rejectPromise) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;

      req.on('data', (chunk: Buffer) => {
        if (settled) {
          return;
        }
        total += chunk.length;
        if (total > 2_097_152) {
          settled = true;
          req.pause();
          rejectPromise(
            new ForgeError('VALIDATION_ERROR', 'MCP payload > 2MB', 413),
          );
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        resolvePromise(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', (err: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        rejectPromise(err);
      });
    });
  }

  private sendJson(
    res: ServerResponse,
    statusCode: number,
    payload: unknown,
    closeConnection = false,
  ): void {
    const body = JSON.stringify(payload);
    const headers: Record<string, string | number> = {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    };
    if (closeConnection) {
      headers['connection'] = 'close';
    }
    res.writeHead(statusCode, headers);
    res.end(body);
  }
}

/**
 * Scoped `forge_station` Loopback HTTP MCP Server (`127.0.0.1:0/mcp`).
 * Authenticates per-attempt bearer tokens and exposes the 7 governed
 * ForgeOps contract, artifact, memory, human-escalation, amendment, and
 * epistemic submission tools over JSON-RPC 2.0.
 */

import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
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
import type {
  IMcpStationServer,
  McpAttemptRegistration,
  McpAttemptRegistrationInput,
  McpSubmissionPayload,
} from './contracts.ts';

interface ActiveAttemptContext extends McpAttemptRegistrationInput {
  readonly attemptToken: string;
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
] as const;

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
    const srv = this.server;
    this.server = null;
    if (!srv) {
      return;
    }
    await new Promise<void>(resolvePromise => {
      srv.close(() => resolvePromise());
    });
  }

  registerAttempt(input: McpAttemptRegistrationInput): McpAttemptRegistration {
    const attemptToken = `mcp-${randomUUID()}`;
    const ctx: ActiveAttemptContext = {
      ...input,
      attemptToken,
      revoked: false,
    };
    this.attempts.set(attemptToken, ctx);

    return {
      attemptToken,
      mcpEndpointUrl: `${this.boundBaseUrl}/mcp?token=${encodeURIComponent(attemptToken)}`,
      revoke: () => {
        const existing = this.attempts.get(attemptToken);
        if (existing) {
          existing.revoked = true;
        }
      },
    };
  }

  getSubmission(attemptToken: string): McpSubmissionPayload | null {
    return this.submissions.get(attemptToken) ?? null;
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
    const rawBody = await this.readBody(req);
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
    const ctx = token ? this.attempts.get(token) : undefined;

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

      if (method === 'notifications/initialized') {
        this.sendJson(res, 200, {
          jsonrpc: '2.0',
          id: reqId,
          result: {ok: true},
        });
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

        const toolOutput = this.executeToolCall(ctx, toolName, args);
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

      this.sendJson(res, 404, {
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
        result: {
          isError: true,
          content: [{type: 'text', text: `${code}: ${message}`}],
        },
      });
    }
  }

  private executeToolCall(
    ctx: ActiveAttemptContext,
    toolName: string,
    args: Record<string, unknown>,
  ): unknown {
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
        const content = readFileSync(safePath, 'utf8').slice(0, 65_536);
        return {path: relPath, content};
      }

      case 'forge_memory_search': {
        const query =
          typeof args['query'] === 'string' ? args['query'].trim() : '';
        const limit =
          typeof args['limit'] === 'number' && args['limit'] > 0
            ? Math.min(25, Math.floor(args['limit']))
            : 8;
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
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        resolvePromise(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', rejectPromise);
    });
  }

  private sendJson(
    res: ServerResponse,
    statusCode: number,
    payload: unknown,
  ): void {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}

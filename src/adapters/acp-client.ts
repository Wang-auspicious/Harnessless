/**
 * Agent Client Protocol (ACP) JSON-RPC 2.0 over Stdio Session Runner.
 * Implements `initialize` -> `session/new` (with scoped MCP server injection) ->
 * `session/prompt`, streaming `session/update` notifications and enforcing
 * `session/request_permission` governance.
 */

import type {ISandboxProcessRunner} from '../sandbox/contracts.ts';
import type {PermissionTier} from '../shared/types.ts';
import type {
  AgentInvocationRequest,
  AgentInvocationResult,
} from './contracts.ts';

const RATE_LIMIT_PATTERN =
  /\b429\b|rate[_ -]?limit|quota exceeded|too many requests|overloaded/i;
const ENV_FAULT_PATTERN =
  /executable not found|command not found|enoent|eacces|spawn .* failed/i;

export interface AcpPermissionDecision {
  readonly allowed: boolean;
  readonly optionId: 'allow' | 'deny';
  readonly reason: string;
}

export function evaluateAcpPermission(
  tier: PermissionTier,
  readOnly: boolean,
  toolName: string,
  commandText = '',
): AcpPermissionDecision {
  const lowerTool = toolName.toLowerCase();
  const isWriteOrExec =
    lowerTool.includes('write') ||
    lowerTool.includes('edit') ||
    lowerTool.includes('patch') ||
    lowerTool.includes('delete') ||
    lowerTool.includes('bash') ||
    lowerTool.includes('exec') ||
    lowerTool.includes('command');

  if (readOnly && isWriteOrExec) {
    return {
      allowed: false,
      optionId: 'deny',
      reason: `Read-only evaluator session forbade mutation tool "${toolName}"`,
    };
  }

  if (tier === 'strict' && isWriteOrExec) {
    return {
      allowed: false,
      optionId: 'deny',
      reason: `Strict permission tier requires explicit human gate for "${toolName}"`,
    };
  }

  if (
    tier === 'supervised' &&
    /rm\s+-rf|git\s+push|git\s+reset\s+--hard/i.test(commandText)
  ) {
    return {
      allowed: false,
      optionId: 'deny',
      reason: 'Supervised tier blocked destructive command request',
    };
  }

  return {
    allowed: true,
    optionId: 'allow',
    reason: `Permitted under "${tier}" tier`,
  };
}

function buildAcpRpcRequests(req: AgentInvocationRequest): string {
  const mcpServers: Array<Record<string, unknown>> = [];
  if (req.adapter.mcpInjection === 'acp-session' && req.mcpEndpointUrl) {
    mcpServers.push({
      name: 'forge_station',
      transport: 'http',
      url: req.mcpEndpointUrl,
      headers: req.mcpAttemptToken
        ? {Authorization: `Bearer ${req.mcpAttemptToken}`}
        : {},
    });
  }

  const initFrame = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      clientInfo: {name: 'ForgeOps', version: '2.1.0'},
      capabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: !req.readOnly,
        },
      },
    },
  };

  const sessionNewFrame = {
    jsonrpc: '2.0',
    id: 2,
    method: 'session/new',
    params: {
      cwd: req.cwd,
      model: req.model || req.adapter.defaultModel,
      permissionTier: req.permissionTier,
      readOnly: req.readOnly,
      mcpServers,
    },
  };

  const promptFrame = {
    jsonrpc: '2.0',
    id: 3,
    method: 'session/prompt',
    params: {
      sessionId: req.sessionId,
      systemPrompt: req.systemPrompt,
      prompt: [
        {
          type: 'text',
          text: `${req.systemPrompt}\n\n${req.userPrompt}`.trim(),
        },
      ],
    },
  };

  return `${[initFrame, sessionNewFrame, promptFrame]
    .map(frame => JSON.stringify(frame))
    .join('\n')}\n`;
}

export async function runAcpSession(
  req: AgentInvocationRequest,
  runner: ISandboxProcessRunner,
): Promise<AgentInvocationResult> {
  const startedAt = Date.now();
  const resolved = runner.resolveExecutable(req.adapter.command);
  if (!resolved) {
    return {
      outcome: 'env_fault',
      finalText: '',
      mcpSubmission: null,
      inputTokens: 0,
      cachedTokens: 0,
      firstTurnCachedTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
      diagnostic: `ACP binary not found on PATH: ${req.adapter.command}`,
    };
  }

  const args = [
    ...req.adapter.baseArgs,
    ...req.adapter.permissionFlags[req.permissionTier],
  ];
  const extraEnv: Record<string, string> = {
    FORGEOPS_SESSION_ID: req.sessionId,
    FORGEOPS_PERMISSION_TIER: req.permissionTier,
    FORGEOPS_READ_ONLY: req.readOnly ? '1' : '0',
  };
  if (req.mcpEndpointUrl) {
    extraEnv['FORGEOPS_MCP_URL'] = req.mcpEndpointUrl;
  }
  if (req.mcpAttemptToken) {
    extraEnv['FORGEOPS_MCP_TOKEN'] = req.mcpAttemptToken;
  }

  const assistantChunks: string[] = [];
  const diagnostics: string[] = [];
  let inputTokens = 0;
  let cachedTokens = 0;
  let firstTurnCachedTokens = 0;
  let sawFirstTurnUsage = false;
  let outputTokens = 0;
  let costUsd = 0;
  let rpcErrorText = '';
  let permissionDeniedReason = '';

  const parseJsonRpcLine = (rawLine: string): void => {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('{')) {
      return;
    }
    try {
      const msg = JSON.parse(trimmed) as Record<string, unknown>;
      const method = typeof msg['method'] === 'string' ? msg['method'] : '';
      const params =
        msg['params'] && typeof msg['params'] === 'object'
          ? (msg['params'] as Record<string, unknown>)
          : {};

      if (method === 'session/update') {
        const update =
          params['update'] && typeof params['update'] === 'object'
            ? (params['update'] as Record<string, unknown>)
            : params;
        const kind =
          typeof update['sessionUpdate'] === 'string'
            ? update['sessionUpdate']
            : typeof update['type'] === 'string'
              ? update['type']
              : 'agent_message_chunk';
        const text =
          typeof update['text'] === 'string'
            ? update['text']
            : update['content'] &&
                typeof update['content'] === 'object' &&
                typeof (update['content'] as Record<string, unknown>)[
                  'text'
                ] === 'string'
              ? String((update['content'] as Record<string, unknown>)['text'])
              : '';
        const toolName =
          typeof update['toolName'] === 'string' ? update['toolName'] : null;

        if (text) {
          if (kind === 'tool_call' || toolName) {
            req.onChunk?.('tool', text, toolName);
          } else {
            assistantChunks.push(text);
            req.onChunk?.('assistant', text, null);
          }
        }
        return;
      }

      if (method === 'session/request_permission') {
        const toolName =
          typeof params['toolName'] === 'string'
            ? params['toolName']
            : 'tool_call';
        const cmdText =
          typeof params['command'] === 'string' ? params['command'] : '';
        const decision = evaluateAcpPermission(
          req.permissionTier,
          req.readOnly,
          toolName,
          cmdText,
        );
        req.onChunk?.(
          'tool',
          `[ACP Permission ${decision.optionId.toUpperCase()}] ${toolName}: ${decision.reason}`,
          toolName,
        );
        if (!decision.allowed) {
          permissionDeniedReason = decision.reason;
        }
        return;
      }

      if (msg['error'] && typeof msg['error'] === 'object') {
        const errObj = msg['error'] as Record<string, unknown>;
        rpcErrorText =
          typeof errObj['message'] === 'string'
            ? errObj['message']
            : JSON.stringify(errObj);
        diagnostics.push(rpcErrorText);
      }

      if (msg['result'] && typeof msg['result'] === 'object') {
        const resObj = msg['result'] as Record<string, unknown>;
        if (typeof resObj['text'] === 'string' && resObj['text'].length > 0) {
          assistantChunks.push(resObj['text']);
          req.onChunk?.('assistant', resObj['text'], null);
        }
        if (resObj['usage'] && typeof resObj['usage'] === 'object') {
          const u = resObj['usage'] as Record<string, unknown>;
          const inTok =
            typeof u['inputTokens'] === 'number'
              ? u['inputTokens']
              : typeof u['input_tokens'] === 'number'
                ? u['input_tokens']
                : 0;
          const cacheTok =
            typeof u['cachedTokens'] === 'number'
              ? u['cachedTokens']
              : typeof u['cached_tokens'] === 'number'
                ? u['cached_tokens']
                : 0;
          const outTok =
            typeof u['outputTokens'] === 'number'
              ? u['outputTokens']
              : typeof u['output_tokens'] === 'number'
                ? u['output_tokens']
                : 0;
          inputTokens += inTok;
          cachedTokens += cacheTok;
          if (!sawFirstTurnUsage) {
            firstTurnCachedTokens = cacheTok;
            sawFirstTurnUsage = true;
          }
          outputTokens += outTok;
          if (typeof u['costUsd'] === 'number') {
            costUsd += u['costUsd'];
          }
        }
      }
    } catch {
      // Non-JSON diagnostic line; ignore.
    }
  };

  const runResult = await runner.run({
    executable: req.adapter.command,
    args,
    cwd: req.cwd,
    envAllowlist: req.adapter.envAllowlist,
    extraEnv,
    stdinText: buildAcpRpcRequests(req),
    timeoutMs: req.timeoutMs ?? 120_000,
    onStdoutLine: parseJsonRpcLine,
  });

  const durationSec = Number(
    Math.max(0.01, runResult.durationMs / 1000).toFixed(3),
  );
  const combinedDiag = [
    rpcErrorText,
    permissionDeniedReason,
    runResult.stderr.trim(),
  ]
    .filter(Boolean)
    .join(' | ');

  if (
    RATE_LIMIT_PATTERN.test(combinedDiag) ||
    RATE_LIMIT_PATTERN.test(runResult.stdout)
  ) {
    return {
      outcome: 'rate_limited',
      finalText: assistantChunks.join('').trim(),
      mcpSubmission: null,
      inputTokens,
      cachedTokens,
      firstTurnCachedTokens,
      outputTokens,
      costUsd,
      durationSec,
      diagnostic: combinedDiag || 'ACP session rate limited (429)',
      retryAfterSeconds: 30,
    };
  }

  if (runResult.exitCode === 127 || ENV_FAULT_PATTERN.test(combinedDiag)) {
    return {
      outcome: 'env_fault',
      finalText: assistantChunks.join('').trim(),
      mcpSubmission: null,
      inputTokens,
      cachedTokens,
      firstTurnCachedTokens,
      outputTokens,
      costUsd,
      durationSec,
      diagnostic: combinedDiag || 'ACP adapter environment fault',
    };
  }

  if (runResult.exitCode !== 0 || rpcErrorText || permissionDeniedReason) {
    return {
      outcome: 'task_failure',
      finalText: assistantChunks.join('').trim(),
      mcpSubmission: null,
      inputTokens,
      cachedTokens,
      firstTurnCachedTokens,
      outputTokens,
      costUsd,
      durationSec,
      diagnostic: combinedDiag || `ACP exited with code ${runResult.exitCode}`,
    };
  }

  const finalText = assistantChunks.join('').trim() || runResult.stdout.trim();

  return {
    outcome: 'completed',
    finalText,
    mcpSubmission: null,
    inputTokens: inputTokens || Math.ceil(req.userPrompt.length / 4),
    cachedTokens,
    firstTurnCachedTokens,
    outputTokens: outputTokens || Math.ceil(finalText.length / 4),
    costUsd,
    durationSec,
    diagnostic: 'ACP session completed',
  };
}

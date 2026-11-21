/**
 * CLI JSONL Stream Session Runner (`codex`, `claude-code`, `opencode`, `pi`,
 * `workbuddy`, and custom CLI manifests).
 */

import type {ISandboxProcessRunner} from '../sandbox/contracts.ts';
import type {AgentAdapterManifest} from '../shared/types.ts';
import type {
  AgentInvocationRequest,
  AgentInvocationResult,
} from './contracts.ts';

const RATE_LIMIT_PATTERN =
  /\b429\b|rate[_ -]?limit|quota exceeded|too many requests|overloaded/i;
const ENV_FAULT_PATTERN =
  /executable not found|command not found|enoent|eacces|spawn .* failed/i;

export interface ParsedCliStreamEvent {
  readonly role: 'assistant' | 'tool';
  readonly text: string;
  readonly toolName: string | null;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly isError: boolean;
}

export function buildCliInvocationArgs(req: AgentInvocationRequest): {
  readonly args: string[];
  readonly stdinText?: string;
} {
  const {adapter, permissionTier, mcpEndpointUrl, mcpAttemptToken} = req;
  const args: string[] = [
    ...adapter.baseArgs,
    ...adapter.permissionFlags[permissionTier],
  ];

  if (mcpEndpointUrl) {
    if (adapter.mcpInjection === 'claude-mcp-json') {
      const mcpConfig = {
        mcpServers: {
          forge_station: {
            type: 'http',
            url: mcpEndpointUrl,
            headers: mcpAttemptToken
              ? {Authorization: `Bearer ${mcpAttemptToken}`}
              : {},
          },
        },
      };
      args.push('--mcp-config', JSON.stringify(mcpConfig));
    } else if (adapter.mcpInjection === 'codex-flag') {
      args.push('-c', `mcp_servers.forge_station.url="${mcpEndpointUrl}"`);
    }
  }

  const combinedPrompt = `${req.systemPrompt}\n\n${req.userPrompt}`.trim();
  const useStdin =
    adapter.promptTransport === 'stdin' || combinedPrompt.length > 2048;
  if (useStdin) {
    return {args, stdinText: combinedPrompt};
  }
  args.push(combinedPrompt);
  return {args};
}

function numVal(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function parseCliJsonlLine(
  parser: AgentAdapterManifest['jsonlParser'],
  rawLine: string,
): ParsedCliStreamEvent | null {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return null;
  }

  if (parser === 'none' || !trimmed.startsWith('{')) {
    return {
      role: 'assistant',
      text: trimmed,
      toolName: null,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      isError: false,
    };
  }

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return {
      role: 'assistant',
      text: trimmed,
      toolName: null,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      isError: false,
    };
  }

  let role: 'assistant' | 'tool' = 'assistant';
  let text = '';
  let toolName: string | null = null;
  let inputTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let costUsd =
    numVal(obj, 'total_cost_usd') ||
    numVal(obj, 'costUsd') ||
    numVal(obj, 'cost');
  const isError =
    obj['is_error'] === true ||
    obj['isError'] === true ||
    obj['type'] === 'error';

  // Extract usage across claude-stream, codex-rpc, opencode-json, pi-json, generic-jsonl
  const usageObj =
    obj['usage'] && typeof obj['usage'] === 'object'
      ? (obj['usage'] as Record<string, unknown>)
      : obj['tokens'] && typeof obj['tokens'] === 'object'
        ? (obj['tokens'] as Record<string, unknown>)
        : null;

  if (usageObj) {
    inputTokens =
      numVal(usageObj, 'input_tokens') ||
      numVal(usageObj, 'inputTokens') ||
      numVal(usageObj, 'input');
    cachedTokens =
      numVal(usageObj, 'cache_read_input_tokens') ||
      numVal(usageObj, 'cached_input_tokens') ||
      numVal(usageObj, 'cached_tokens') ||
      numVal(usageObj, 'cachedTokens') ||
      numVal(usageObj, 'cacheRead');
    if (
      !cachedTokens &&
      usageObj['cache'] &&
      typeof usageObj['cache'] === 'object'
    ) {
      cachedTokens = numVal(
        usageObj['cache'] as Record<string, unknown>,
        'read',
      );
    }
    outputTokens =
      numVal(usageObj, 'output_tokens') ||
      numVal(usageObj, 'outputTokens') ||
      numVal(usageObj, 'output');
    if (!costUsd && usageObj['cost'] && typeof usageObj['cost'] === 'object') {
      costUsd = numVal(usageObj['cost'] as Record<string, unknown>, 'total');
    }
  }

  // Claude stream-json message nested content
  if (obj['message'] && typeof obj['message'] === 'object') {
    const msgObj = obj['message'] as Record<string, unknown>;
    if (Array.isArray(msgObj['content'])) {
      const parts: string[] = [];
      for (const block of msgObj['content']) {
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>;
          if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
            role = 'tool';
            toolName = b['name'];
            parts.push(`[Tool: ${b['name']}]`);
          } else if (typeof b['text'] === 'string') {
            parts.push(b['text']);
          }
        }
      }
      text = parts.join('\n');
    }
    if (!usageObj && msgObj['usage'] && typeof msgObj['usage'] === 'object') {
      const u = msgObj['usage'] as Record<string, unknown>;
      inputTokens = numVal(u, 'input_tokens') || numVal(u, 'input');
      cachedTokens =
        numVal(u, 'cache_read_input_tokens') || numVal(u, 'cacheRead');
      outputTokens = numVal(u, 'output_tokens') || numVal(u, 'output');
    }
  }

  // Codex item.completed
  if (!text && obj['item'] && typeof obj['item'] === 'object') {
    const item = obj['item'] as Record<string, unknown>;
    if (typeof item['text'] === 'string') {
      text = item['text'];
    }
    if (
      item['type'] === 'command_execution' ||
      item['type'] === 'mcp_tool_call'
    ) {
      role = 'tool';
      toolName =
        typeof item['command'] === 'string'
          ? item['command']
          : typeof item['tool'] === 'string'
            ? item['tool']
            : 'tool';
      text =
        typeof item['aggregated_output'] === 'string'
          ? item['aggregated_output']
          : text;
    }
  }

  // Pi assistantMessageEvent
  if (
    !text &&
    obj['assistantMessageEvent'] &&
    typeof obj['assistantMessageEvent'] === 'object'
  ) {
    const ev = obj['assistantMessageEvent'] as Record<string, unknown>;
    if (typeof ev['delta'] === 'string') {
      text = ev['delta'];
    }
  }

  // Generic fallbacks
  if (!text) {
    if (typeof obj['text'] === 'string') {
      text = obj['text'];
    } else if (typeof obj['result'] === 'string') {
      text = obj['result'];
    } else if (typeof obj['content'] === 'string') {
      text = obj['content'];
    } else if (typeof obj['delta'] === 'string') {
      text = obj['delta'];
    }
  }

  if (!toolName && typeof obj['tool'] === 'string') {
    role = 'tool';
    toolName = obj['tool'];
  }

  return {
    role,
    text,
    toolName,
    inputTokens,
    cachedTokens,
    outputTokens,
    costUsd,
    isError,
  };
}

export async function runCliStreamSession(
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
      diagnostic: `CLI binary not found on PATH: ${req.adapter.command}`,
    };
  }

  const {args, stdinText} = buildCliInvocationArgs(req);
  const extraEnv: Record<string, string> = {
    FORGEOPS_SESSION_ID: req.sessionId,
    FORGEOPS_MODEL: req.model || req.adapter.defaultModel,
    FORGEOPS_PERMISSION_TIER: req.permissionTier,
    FORGEOPS_READ_ONLY: req.readOnly ? '1' : '0',
  };
  if (req.mcpEndpointUrl) {
    extraEnv['FORGEOPS_MCP_URL'] = req.mcpEndpointUrl;
  }
  if (req.mcpAttemptToken) {
    extraEnv['FORGEOPS_MCP_TOKEN'] = req.mcpAttemptToken;
  }

  const assistantParts: string[] = [];
  let inputTokens = 0;
  let cachedTokens = 0;
  let firstTurnCachedTokens = 0;
  let sawFirstTurnUsage = false;
  let outputTokens = 0;
  let costUsd = 0;
  let streamErrorText = '';

  const onStdoutLine = (line: string): void => {
    const parsed = parseCliJsonlLine(req.adapter.jsonlParser, line);
    if (!parsed) {
      return;
    }
    if (parsed.inputTokens > 0 || parsed.cachedTokens > 0) {
      inputTokens += parsed.inputTokens;
      cachedTokens += parsed.cachedTokens;
      if (!sawFirstTurnUsage) {
        firstTurnCachedTokens = parsed.cachedTokens;
        sawFirstTurnUsage = true;
      }
    }
    if (parsed.outputTokens > 0) {
      outputTokens += parsed.outputTokens;
    }
    if (parsed.costUsd > 0) {
      costUsd += parsed.costUsd;
    }
    if (parsed.isError && parsed.text) {
      streamErrorText = parsed.text;
    }
    if (parsed.text) {
      if (parsed.role === 'assistant') {
        assistantParts.push(parsed.text);
      }
      req.onChunk?.(parsed.role, parsed.text, parsed.toolName);
    }
  };

  const runResult = await runner.run({
    executable: req.adapter.command,
    args,
    cwd: req.cwd,
    envAllowlist: req.adapter.envAllowlist,
    extraEnv,
    stdinText,
    timeoutMs: req.timeoutMs ?? 120_000,
    onStdoutLine,
    signal: req.signal,
  });

  const durationSec = Number(
    Math.max(0.01, runResult.durationMs / 1000).toFixed(3),
  );
  const finalText = assistantParts.join('\n').trim() || runResult.stdout.trim();
  const diagText = [streamErrorText, runResult.stderr.trim()]
    .filter(Boolean)
    .join(' | ');
  const failed = runResult.exitCode !== 0 || streamErrorText.length > 0;

  if (
    failed &&
    (RATE_LIMIT_PATTERN.test(diagText) ||
      RATE_LIMIT_PATTERN.test(runResult.stdout))
  ) {
    return {
      outcome: 'rate_limited',
      finalText,
      mcpSubmission: null,
      inputTokens,
      cachedTokens,
      firstTurnCachedTokens,
      outputTokens,
      costUsd,
      durationSec,
      diagnostic: diagText || 'CLI harness rate limited (429)',
      retryAfterSeconds: 30,
    };
  }

  if (runResult.exitCode === 127 || ENV_FAULT_PATTERN.test(diagText)) {
    return {
      outcome: 'env_fault',
      finalText,
      mcpSubmission: null,
      inputTokens,
      cachedTokens,
      firstTurnCachedTokens,
      outputTokens,
      costUsd,
      durationSec,
      diagnostic:
        diagText || `Environment fault running ${req.adapter.command}`,
    };
  }

  if (runResult.exitCode !== 0 || streamErrorText) {
    return {
      outcome: 'task_failure',
      finalText,
      mcpSubmission: null,
      inputTokens,
      cachedTokens,
      firstTurnCachedTokens,
      outputTokens,
      costUsd,
      durationSec,
      diagnostic:
        diagText ||
        `${req.adapter.command} exited with code ${runResult.exitCode}`,
    };
  }

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
    diagnostic: `${req.adapter.label} completed`,
  };
}

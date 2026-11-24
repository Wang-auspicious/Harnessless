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
  /\b429\b|rate[_ -]?limit|quota exceeded|resource[_ -]?exhausted|too many requests|overloaded|retry[- ]after/i;
const AUTH_ERROR_PATTERN =
  /\b401\b|\b403\b|unauthorized|unauthenticated|invalid[_ -]?api[_ -]?key|missing[_ -]?api[_ -]?key|authentication failed|not logged in|login required|please run .*login|oauth.*expired/i;
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

function stripWriteFlagsForReadOnly(rawFlags: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rawFlags.length; i += 1) {
    const flag = rawFlags[i]!;
    if (
      flag === '--full-auto' ||
      flag === '--dangerously-skip-permissions' ||
      flag === '--yolo' ||
      flag === '-y'
    ) {
      continue;
    }
    if (flag === '--approval-mode') {
      const next = rawFlags[i + 1];
      if (next === 'yolo' || next === 'auto_edit') {
        i += 1;
        continue;
      }
    }
    out.push(flag);
  }
  return out;
}

export function buildCliInvocationArgs(req: AgentInvocationRequest): {
  readonly args: string[];
  readonly stdinText?: string;
} {
  const {adapter, permissionTier, mcpEndpointUrl, mcpAttemptToken} = req;
  const effectiveTier = req.readOnly ? 'strict' : permissionTier;
  const rawFlags = [
    ...adapter.baseArgs,
    ...adapter.permissionFlags[effectiveTier],
  ];
  const args: string[] = req.readOnly
    ? stripWriteFlagsForReadOnly(rawFlags)
    : [...rawFlags];

  const isGeminiCli = adapter.id === 'gemini-cli';
  const modelId = req.model.trim();
  const supportsModelFlag =
    adapter.id === 'claude-code' ||
    adapter.id === 'codex' ||
    adapter.id === 'gemini-cli';
  if (
    supportsModelFlag &&
    modelId.length > 0 &&
    !args.includes('--model') &&
    !args.includes('-m')
  ) {
    args.push('--model', modelId);
  }

  if (isGeminiCli && req.readOnly && !args.includes('--approval-mode')) {
    args.push('--approval-mode', 'plan');
  }

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
      if (mcpAttemptToken) {
        args.push(
          '-c',
          'mcp_servers.forge_station.bearer_token_env_var="FORGEOPS_MCP_TOKEN"',
        );
      }
    }
  }

  const combinedPrompt = `${req.systemPrompt}\n\n${req.userPrompt}`.trim();
  const useStdin =
    adapter.promptTransport === 'stdin' || combinedPrompt.length > 2048;

  if (isGeminiCli) {
    // Gemini CLI `-p`/`--prompt` expects a string argument; normalize bare `-p`
    // so following flags like `--output-format` are never swallowed as its value.
    const promptFlagIdx = args.findIndex(a => a === '-p' || a === '--prompt');
    if (promptFlagIdx >= 0) {
      const nextToken = args[promptFlagIdx + 1];
      const missingValue = nextToken === undefined || nextToken.startsWith('-');
      if (missingValue) {
        args.splice(promptFlagIdx + 1, 0, useStdin ? '' : combinedPrompt);
      }
    } else if (!useStdin) {
      args.push('-p', combinedPrompt);
    }
    return useStdin ? {args, stdinText: combinedPrompt} : {args};
  }

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

function extractErrorMessage(obj: Record<string, unknown>): string {
  const errVal = obj['error'];
  if (typeof errVal === 'string') {
    return errVal;
  }
  if (errVal && typeof errVal === 'object') {
    const errObj = errVal as Record<string, unknown>;
    if (typeof errObj['message'] === 'string') {
      return errObj['message'];
    }
    if (typeof errObj['code'] === 'string') {
      return errObj['code'];
    }
  }
  if (typeof obj['message'] === 'string') {
    return obj['message'];
  }
  return '';
}

export function parseCliJsonlLine(
  parser: AgentAdapterManifest['jsonlParser'],
  rawLine: string,
  adapterId?: string,
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

  const evType = typeof obj['type'] === 'string' ? obj['type'] : '';
  const isGemini = adapterId === 'gemini-cli';
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
    evType === 'error' ||
    evType === 'turn.failed' ||
    obj['status'] === 'error' ||
    obj['subtype'] === 'error';

  // Extract usage across claude-stream, codex-rpc, gemini-cli stats, opencode-json, pi-json
  const usageObj =
    obj['usage'] && typeof obj['usage'] === 'object'
      ? (obj['usage'] as Record<string, unknown>)
      : obj['tokens'] && typeof obj['tokens'] === 'object'
        ? (obj['tokens'] as Record<string, unknown>)
        : obj['stats'] && typeof obj['stats'] === 'object'
          ? (obj['stats'] as Record<string, unknown>)
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
      numVal(usageObj, 'cached') ||
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

  // Claude stream-json content_block_delta
  if (
    evType === 'content_block_delta' &&
    obj['delta'] &&
    typeof obj['delta'] === 'object'
  ) {
    const deltaObj = obj['delta'] as Record<string, unknown>;
    if (typeof deltaObj['text'] === 'string') {
      text = deltaObj['text'];
    }
  }

  // Gemini CLI stream-json (`message`, `tool_use`, `tool_result`, `result`)
  if ((isGemini || parser === 'generic-jsonl') && !text) {
    if (evType === 'tool_use') {
      role = 'tool';
      toolName =
        typeof obj['tool_name'] === 'string'
          ? obj['tool_name']
          : typeof obj['name'] === 'string'
            ? obj['name']
            : 'tool';
      text = `[Tool: ${toolName}]`;
    } else if (evType === 'tool_result') {
      role = 'tool';
      toolName =
        typeof obj['tool_name'] === 'string'
          ? obj['tool_name']
          : typeof obj['name'] === 'string'
            ? obj['name']
            : 'tool';
      text =
        typeof obj['output'] === 'string'
          ? obj['output']
          : typeof obj['content'] === 'string'
            ? obj['content']
            : '';
    } else if (
      evType === 'message' &&
      (obj['role'] === 'assistant' || obj['role'] === 'model')
    ) {
      if (typeof obj['content'] === 'string') {
        text = obj['content'];
      } else if (typeof obj['delta'] === 'string') {
        text = obj['delta'];
      }
    }
  }

  // Claude stream-json message nested content
  if (!text && obj['message'] && typeof obj['message'] === 'object') {
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

  // Structured error extraction
  if (isError && !text) {
    text = extractErrorMessage(obj);
  }

  // Generic fallbacks (skip user echo events on Gemini CLI)
  const isUserEcho = evType === 'message' && obj['role'] === 'user';
  if (!text && !isUserEcho) {
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
    FORGEOPS_PERMISSION_TIER: req.readOnly ? 'strict' : req.permissionTier,
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
    const parsed = parseCliJsonlLine(
      req.adapter.jsonlParser,
      line,
      req.adapter.id,
    );
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
  const failed =
    runResult.timedOut ||
    runResult.exitCode !== 0 ||
    streamErrorText.length > 0;

  if (failed && RATE_LIMIT_PATTERN.test(diagText)) {
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

  if (runResult.timedOut) {
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
      diagnostic: diagText
        ? `CLI harness timed out: ${diagText}`
        : `${req.adapter.command} timed out after ${Math.round((req.timeoutMs ?? 120_000) / 1000)}s`,
    };
  }

  if (failed && AUTH_ERROR_PATTERN.test(diagText)) {
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
      diagnostic: `AUTH_REQUIRED: ${diagText || `${req.adapter.command} authentication failed`}`,
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

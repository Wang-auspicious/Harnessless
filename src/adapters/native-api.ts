import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, relative} from 'node:path';
import {isFileInsideScope, normalizeRepoPath} from '../core/glob-scope.ts';
import type {IGitWorktreeManager} from '../sandbox/contracts.ts';
import type {
  AgentInvocationRequest,
  AgentInvocationResult,
  McpSubmissionPayload,
  ProviderSecretLookup,
  ProviderSecretResolved,
} from './contracts.ts';
import {parseRetryAfterSeconds} from './rate-limiter.ts';

function inferProviderCandidates(model: string): string[] {
  const lower = model.toLowerCase();
  if (lower.includes('/')) {
    const prefix = lower.split('/')[0]!;
    return [prefix, 'opencode-go', 'deepseek', 'openai', 'anthropic'];
  }
  if (
    lower.includes('v4.1-flash') ||
    lower === 'glm-5' ||
    lower === 'kimi-k2.5'
  ) {
    return ['opencode-go', 'deepseek', 'openai', 'anthropic'];
  }
  if (lower.startsWith('claude')) {
    return ['anthropic', 'opencode-go', 'openai', 'deepseek'];
  }
  if (
    lower.startsWith('gpt') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4')
  ) {
    return ['openai', 'opencode-go', 'deepseek', 'anthropic'];
  }
  return ['deepseek', 'opencode-go', 'openai', 'anthropic'];
}

function resolveProviderConfig(
  req: AgentInvocationRequest,
  lookupProvider: ProviderSecretLookup,
): ProviderSecretResolved | null {
  if (req.providerId) {
    const explicit = lookupProvider(req.providerId);
    if (explicit) {
      return explicit;
    }
  }
  const direct = lookupProvider(req.model);
  if (direct) {
    return direct;
  }
  const candidates = inferProviderCandidates(req.model);
  for (const id of candidates) {
    const found = lookupProvider(id);
    if (found && found.models?.some(m => m.id === req.model)) {
      return found;
    }
  }
  return candidates.length > 0 ? lookupProvider(candidates[0]!) : null;
}

function computeCatalogCostUsd(
  provider: ProviderSecretResolved,
  modelId: string,
  inputTokens: number,
  cachedTokens: number,
  outputTokens: number,
): number {
  const catalogEntry = provider.models?.find(m => m.id === modelId);
  const inPrice = catalogEntry?.inputUsdPerMillion ?? 0.5;
  const cachedPrice = catalogEntry?.cachedInputUsdPerMillion ?? 0.1;
  const outPrice = catalogEntry?.outputUsdPerMillion ?? 1.5;
  const uncachedIn = Math.max(0, inputTokens - cachedTokens);
  const total =
    (uncachedIn * inPrice +
      cachedTokens * cachedPrice +
      outputTokens * outPrice) /
    1_000_000;
  return Number(Math.max(0, total).toFixed(6));
}

function asStringList(val: unknown): string[] {
  if (!Array.isArray(val)) {
    return [];
  }
  return val
    .map(v => (typeof v === 'string' ? v.trim() : String(v ?? '')))
    .filter(Boolean);
}

interface NativeToolExecutionResult {
  readonly output: string;
  readonly isError: boolean;
  readonly submission?: McpSubmissionPayload;
}

const MAX_READ_BYTES = 524_288;

function readBoundedFileText(filePath: string, maxChars: number): string {
  const st = statSync(filePath);
  if (!st.isFile()) {
    throw new Error(`Path is not a regular file: ${filePath}`);
  }
  const toRead = Math.min(st.size, MAX_READ_BYTES);
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

function resolveCanonicalRoot(
  cwd: string,
  worktrees: IGitWorktreeManager,
): string {
  try {
    return realpathSync.native(cwd).replace(/^\\\\\?\\/, '');
  } catch {
    return worktrees.resolveInside(cwd, '.');
  }
}

function executeConfinedTool(
  req: AgentInvocationRequest,
  worktrees: IGitWorktreeManager,
  toolName: string,
  args: Record<string, unknown>,
): NativeToolExecutionResult {
  try {
    switch (toolName) {
      case 'read_file': {
        const relPath =
          typeof args['path'] === 'string' ? args['path'].trim() : '';
        if (!relPath) {
          return {output: 'Missing file path', isError: true};
        }
        const safePath = worktrees.resolveInside(req.cwd, relPath);
        const content = readBoundedFileText(safePath, 32_768);
        return {output: content, isError: false};
      }

      case 'list_dir': {
        const relPath =
          typeof args['path'] === 'string' ? args['path'].trim() : '.';
        const safePath = worktrees.resolveInside(req.cwd, relPath || '.');
        const entries = readdirSync(safePath);
        return {output: JSON.stringify(entries), isError: false};
      }

      case 'write_file': {
        if (req.readOnly) {
          return {
            output: 'POLICY_DENIED: write_file is blocked in readOnly session',
            isError: true,
          };
        }
        const relPath =
          typeof args['path'] === 'string' ? args['path'].trim() : '';
        if (!relPath) {
          return {output: 'Missing file path', isError: true};
        }
        const safePath = worktrees.resolveInside(req.cwd, relPath);
        const canonicalRoot = resolveCanonicalRoot(req.cwd, worktrees);
        const relPosix = relative(canonicalRoot, safePath).replace(/\\/g, '/');
        const canonicalRel = normalizeRepoPath(relPosix);
        if (!canonicalRel) {
          return {
            output: 'POLICY_DENIED: Invalid or escaping write path',
            isError: true,
          };
        }
        if (
          canonicalRel === '.forgeops' ||
          canonicalRel.startsWith('.forgeops/')
        ) {
          return {
            output:
              'POLICY_DENIED: Workers cannot write inside host-reserved .forgeops/',
            isError: true,
          };
        }
        if (
          req.fileScope &&
          req.fileScope.length > 0 &&
          !isFileInsideScope(canonicalRel, req.fileScope)
        ) {
          return {
            output: `POLICY_DENIED: "${canonicalRel}" is outside declared task fileScope [${req.fileScope.join(', ')}]`,
            isError: true,
          };
        }
        const content =
          typeof args['content'] === 'string' ? args['content'] : '';
        mkdirSync(dirname(safePath), {recursive: true});
        writeFileSync(safePath, content, 'utf8');
        return {
          output: `Wrote ${content.length} bytes to ${canonicalRel}`,
          isError: false,
        };
      }

      case 'submit_slice': {
        const submission: McpSubmissionPayload = {
          summary:
            typeof args['summary'] === 'string' ? args['summary'].trim() : '',
          specConfirmedFacts: asStringList(args['specConfirmedFacts']),
          agentHypotheses: asStringList(args['agentHypotheses']),
          openConflicts: asStringList(args['openConflicts']),
          certifiedCriteriaIds: asStringList(args['certifiedCriteriaIds']),
        };
        return {
          output: JSON.stringify({accepted: true, submission}),
          isError: false,
          submission,
        };
      }

      default:
        return {output: `Unknown tool: ${toolName}`, isError: true};
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {output: msg, isError: true};
  }
}

const OPENAI_TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file inside the isolated git worktree.',
      parameters: {
        type: 'object',
        properties: {path: {type: 'string'}},
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List directory entries inside the isolated git worktree.',
      parameters: {
        type: 'object',
        properties: {path: {type: 'string'}},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a file inside the isolated git worktree.',
      parameters: {
        type: 'object',
        properties: {
          path: {type: 'string'},
          content: {type: 'string'},
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_slice',
      description: 'Submit the completed slice and epistemic handoff.',
      parameters: {
        type: 'object',
        properties: {
          summary: {type: 'string'},
          specConfirmedFacts: {type: 'array', items: {type: 'string'}},
          agentHypotheses: {type: 'array', items: {type: 'string'}},
          openConflicts: {type: 'array', items: {type: 'string'}},
          certifiedCriteriaIds: {type: 'array', items: {type: 'string'}},
        },
        required: ['summary'],
      },
    },
  },
];

const ANTHROPIC_TOOLS_SCHEMA = OPENAI_TOOLS_SCHEMA.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

function buildTurnSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSig = AbortSignal.timeout(Math.max(100, timeoutMs));
  return parentSignal
    ? AbortSignal.any([parentSignal, timeoutSig])
    : timeoutSig;
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new Error('Aborted');
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      rejectPromise(new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolvePromise();
    }, ms);
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

async function fetchWithTransientRetry(
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal | undefined,
  turnTimeoutMs: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (parentSignal?.aborted) {
      throw new Error('Aborted');
    }
    try {
      const res = await fetch(url, {
        ...init,
        signal: buildTurnSignal(parentSignal, turnTimeoutMs),
      });
      if (res.status >= 500 && res.status < 600 && attempt < 2) {
        await res.body?.cancel().catch(() => {});
        await abortableSleep(
          350 * (attempt + 1) + Math.floor(Math.random() * 250),
          parentSignal,
        );
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (parentSignal?.aborted || attempt === 2) {
        throw err;
      }
      await abortableSleep(
        350 * (attempt + 1) + Math.floor(Math.random() * 250),
        parentSignal,
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function runNativeApiSession(
  req: AgentInvocationRequest,
  worktrees: IGitWorktreeManager,
  lookupProvider: ProviderSecretLookup,
): Promise<AgentInvocationResult> {
  const startedAt = Date.now();
  const provider = resolveProviderConfig(req, lookupProvider);
  const modelId = req.model || req.adapter.defaultModel;

  if (!provider || !provider.apiKey || provider.apiKey.trim().length === 0) {
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
      diagnostic: 'Missing provider API key',
    };
  }

  const maxTurns =
    req.maxToolTurns ?? (req.textOnly ? 1 : req.readOnly ? 8 : 16);
  const totalTimeoutMs = req.timeoutMs ?? 60_000;
  const maxTokens = req.maxOutputTokens ?? (req.readOnly ? 2048 : 4096);

  let inputTokens = 0;
  let cachedTokens = 0;
  let firstTurnCachedTokens = 0;
  let sawFirstTurn = false;
  let outputTokens = 0;
  let mcpSubmission: McpSubmissionPayload | null = null;
  let exhaustedToolTurns = false;
  const assistantTexts: string[] = [];

  const finalizeCost = (): number =>
    computeCatalogCostUsd(
      provider,
      modelId,
      inputTokens,
      cachedTokens,
      outputTokens,
    );

  const getRemainingTurnTimeoutMs = (): number | null => {
    const remaining = totalTimeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      return null;
    }
    return Math.min(90_000, remaining);
  };

  try {
    if (provider.protocol === 'openai-compatible') {
      const base = provider.baseUrl.replace(/\/+$/, '');
      const endpoint = base.endsWith('/chat/completions')
        ? base
        : `${base}/chat/completions`;

      const messages: Array<Record<string, unknown>> = [
        {role: 'system', content: req.systemPrompt},
        {role: 'user', content: req.userPrompt},
      ];

      for (let turn = 0; turn < maxTurns; turn += 1) {
        const turnTimeoutMs = getRemainingTurnTimeoutMs();
        if (turnTimeoutMs === null) {
          return {
            outcome: 'env_fault',
            finalText: assistantTexts.join('\n').trim(),
            mcpSubmission,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: finalizeCost(),
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: `Native API session exceeded timeout (${totalTimeoutMs}ms)`,
          };
        }

        const bodyPayload: Record<string, unknown> = {
          model: modelId,
          messages,
          max_tokens: maxTokens,
        };
        if (!req.textOnly) {
          bodyPayload['tools'] = req.readOnly
            ? OPENAI_TOOLS_SCHEMA.filter(t => t.function.name !== 'write_file')
            : OPENAI_TOOLS_SCHEMA;
        }

        const res = await fetchWithTransientRetry(
          endpoint,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify(bodyPayload),
          },
          req.signal,
          turnTimeoutMs,
        );

        if (res.status === 429) {
          await res.body?.cancel().catch(() => {});
          const retryAfterSeconds = parseRetryAfterSeconds(
            res.headers.get('retry-after'),
          );
          return {
            outcome: 'rate_limited',
            finalText: assistantTexts.join('\n').trim(),
            mcpSubmission,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: finalizeCost(),
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: 'OpenAI-compatible endpoint returned HTTP 429',
            retryAfterSeconds,
          };
        }

        if (res.status === 401 || res.status === 403) {
          await res.body?.cancel().catch(() => {});
          return {
            outcome: 'env_fault',
            finalText: '',
            mcpSubmission: null,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: finalizeCost(),
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: `Provider authentication failed (HTTP ${res.status})`,
          };
        }

        if (!res.ok) {
          const errBody = await res.text();
          return {
            outcome: 'task_failure',
            finalText: assistantTexts.join('\n').trim(),
            mcpSubmission,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: finalizeCost(),
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: `HTTP ${res.status}: ${errBody.slice(0, 300)}`,
          };
        }

        const data = (await res.json()) as Record<string, unknown>;
        if (data['usage'] && typeof data['usage'] === 'object') {
          const u = data['usage'] as Record<string, unknown>;
          const promptTok =
            typeof u['prompt_tokens'] === 'number'
              ? u['prompt_tokens']
              : typeof u['input_tokens'] === 'number'
                ? u['input_tokens']
                : 0;
          const compTok =
            typeof u['completion_tokens'] === 'number'
              ? u['completion_tokens']
              : typeof u['output_tokens'] === 'number'
                ? u['output_tokens']
                : 0;
          let turnCached =
            typeof u['cached_tokens'] === 'number'
              ? u['cached_tokens']
              : typeof u['prompt_cache_hit_tokens'] === 'number'
                ? u['prompt_cache_hit_tokens']
                : 0;
          if (
            !turnCached &&
            u['prompt_tokens_details'] &&
            typeof u['prompt_tokens_details'] === 'object'
          ) {
            const details = u['prompt_tokens_details'] as Record<
              string,
              unknown
            >;
            if (typeof details['cached_tokens'] === 'number') {
              turnCached = details['cached_tokens'];
            }
          }
          inputTokens += promptTok;
          cachedTokens += turnCached;
          if (!sawFirstTurn) {
            firstTurnCachedTokens = turnCached;
            sawFirstTurn = true;
          }
          outputTokens += compTok;
        }

        const choices = Array.isArray(data['choices']) ? data['choices'] : [];
        const firstChoice =
          choices[0] && typeof choices[0] === 'object'
            ? (choices[0] as Record<string, unknown>)
            : null;
        const msg =
          firstChoice?.['message'] && typeof firstChoice['message'] === 'object'
            ? (firstChoice['message'] as Record<string, unknown>)
            : null;

        if (!msg) {
          break;
        }

        if (typeof msg['content'] === 'string' && msg['content'].trim()) {
          assistantTexts.push(msg['content']);
          req.onChunk?.('assistant', msg['content'], null);
        }

        const toolCalls = Array.isArray(msg['tool_calls'])
          ? msg['tool_calls']
          : [];
        if (toolCalls.length === 0 || req.textOnly) {
          break;
        }

        messages.push(msg);

        for (const tc of toolCalls) {
          if (!tc || typeof tc !== 'object') {
            continue;
          }
          const tcObj = tc as Record<string, unknown>;
          const callId =
            typeof tcObj['id'] === 'string' ? tcObj['id'] : 'call_1';
          const fnObj =
            tcObj['function'] && typeof tcObj['function'] === 'object'
              ? (tcObj['function'] as Record<string, unknown>)
              : {};
          const toolName =
            typeof fnObj['name'] === 'string' ? fnObj['name'] : '';
          let parsedArgs: Record<string, unknown> = {};
          let argsValid = true;
          if (typeof fnObj['arguments'] === 'string') {
            const rawArgs = fnObj['arguments'].trim();
            if (rawArgs.length > 0) {
              try {
                const parsed = JSON.parse(rawArgs) as unknown;
                if (
                  parsed &&
                  typeof parsed === 'object' &&
                  !Array.isArray(parsed)
                ) {
                  parsedArgs = parsed as Record<string, unknown>;
                } else {
                  argsValid = false;
                }
              } catch {
                argsValid = false;
              }
            }
          } else if (
            fnObj['arguments'] &&
            typeof fnObj['arguments'] === 'object' &&
            !Array.isArray(fnObj['arguments'])
          ) {
            parsedArgs = fnObj['arguments'] as Record<string, unknown>;
          }

          const toolRes: NativeToolExecutionResult = argsValid
            ? executeConfinedTool(req, worktrees, toolName, parsedArgs)
            : {
                output: `Malformed JSON arguments for tool "${toolName}"`,
                isError: true,
              };
          req.onChunk?.('tool', toolRes.output, toolName);
          if (toolRes.submission) {
            mcpSubmission = toolRes.submission;
          }

          messages.push({
            role: 'tool',
            tool_call_id: callId,
            content: toolRes.output,
          });
        }

        if (mcpSubmission) {
          break;
        }
        if (turn === maxTurns - 1) {
          exhaustedToolTurns = true;
        }
      }
    } else {
      const base = provider.baseUrl.replace(/\/+$/, '');
      const endpoint = base.endsWith('/messages')
        ? base
        : base.endsWith('/v1')
          ? `${base}/messages`
          : `${base}/v1/messages`;

      const messages: Array<Record<string, unknown>> = [
        {role: 'user', content: req.userPrompt},
      ];

      const systemField = req.cacheStablePrefix
        ? [
            {
              type: 'text',
              text: req.systemPrompt,
              cache_control: {type: 'ephemeral'},
            },
          ]
        : req.systemPrompt;

      for (let turn = 0; turn < maxTurns; turn += 1) {
        const turnTimeoutMs = getRemainingTurnTimeoutMs();
        if (turnTimeoutMs === null) {
          return {
            outcome: 'env_fault',
            finalText: assistantTexts.join('\n').trim(),
            mcpSubmission,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: finalizeCost(),
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: `Native API session exceeded timeout (${totalTimeoutMs}ms)`,
          };
        }

        const bodyPayload: Record<string, unknown> = {
          model: modelId,
          max_tokens: maxTokens,
          system: systemField,
          messages,
        };
        if (!req.textOnly) {
          bodyPayload['tools'] = req.readOnly
            ? ANTHROPIC_TOOLS_SCHEMA.filter(t => t.name !== 'write_file')
            : ANTHROPIC_TOOLS_SCHEMA;
        }

        const res = await fetchWithTransientRetry(
          endpoint,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': provider.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(bodyPayload),
          },
          req.signal,
          turnTimeoutMs,
        );

        if (res.status === 429) {
          await res.body?.cancel().catch(() => {});
          const retryAfterSeconds = parseRetryAfterSeconds(
            res.headers.get('retry-after'),
          );
          return {
            outcome: 'rate_limited',
            finalText: assistantTexts.join('\n').trim(),
            mcpSubmission,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: finalizeCost(),
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: 'Anthropic endpoint returned HTTP 429',
            retryAfterSeconds,
          };
        }

        if (res.status === 401 || res.status === 403) {
          await res.body?.cancel().catch(() => {});
          return {
            outcome: 'env_fault',
            finalText: '',
            mcpSubmission: null,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: finalizeCost(),
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: `Anthropic authentication failed (HTTP ${res.status})`,
          };
        }

        if (!res.ok) {
          const errBody = await res.text();
          return {
            outcome: 'task_failure',
            finalText: assistantTexts.join('\n').trim(),
            mcpSubmission,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: finalizeCost(),
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: `HTTP ${res.status}: ${errBody.slice(0, 300)}`,
          };
        }

        const data = (await res.json()) as Record<string, unknown>;
        if (data['usage'] && typeof data['usage'] === 'object') {
          const u = data['usage'] as Record<string, unknown>;
          const inTok =
            typeof u['input_tokens'] === 'number' ? u['input_tokens'] : 0;
          const cacheRead =
            typeof u['cache_read_input_tokens'] === 'number'
              ? u['cache_read_input_tokens']
              : 0;
          const cacheCreate =
            typeof u['cache_creation_input_tokens'] === 'number'
              ? u['cache_creation_input_tokens']
              : 0;
          const outTok =
            typeof u['output_tokens'] === 'number' ? u['output_tokens'] : 0;
          inputTokens += inTok + cacheRead + cacheCreate;
          cachedTokens += cacheRead;
          if (!sawFirstTurn) {
            firstTurnCachedTokens = cacheRead;
            sawFirstTurn = true;
          }
          outputTokens += outTok;
        }

        const contentBlocks = Array.isArray(data['content'])
          ? data['content']
          : [];
        const toolResults: Array<Record<string, unknown>> = [];

        for (const block of contentBlocks) {
          if (!block || typeof block !== 'object') {
            continue;
          }
          const b = block as Record<string, unknown>;
          if (b['type'] === 'text' && typeof b['text'] === 'string') {
            assistantTexts.push(b['text']);
            req.onChunk?.('assistant', b['text'], null);
          } else if (
            !req.textOnly &&
            b['type'] === 'tool_use' &&
            typeof b['name'] === 'string'
          ) {
            const toolName = b['name'];
            const toolId = typeof b['id'] === 'string' ? b['id'] : 'toolu_1';
            const inputArgs =
              b['input'] && typeof b['input'] === 'object'
                ? (b['input'] as Record<string, unknown>)
                : {};
            const toolRes = executeConfinedTool(
              req,
              worktrees,
              toolName,
              inputArgs,
            );
            req.onChunk?.('tool', toolRes.output, toolName);
            if (toolRes.submission) {
              mcpSubmission = toolRes.submission;
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolId,
              content: toolRes.output,
              is_error: toolRes.isError,
            });
          }
        }

        if (toolResults.length === 0 || mcpSubmission || req.textOnly) {
          break;
        }

        messages.push({role: 'assistant', content: contentBlocks});
        messages.push({role: 'user', content: toolResults});
        if (turn === maxTurns - 1) {
          exhaustedToolTurns = true;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      outcome: 'env_fault',
      finalText: assistantTexts.join('\n').trim(),
      mcpSubmission,
      inputTokens,
      cachedTokens,
      firstTurnCachedTokens,
      outputTokens,
      costUsd: finalizeCost(),
      durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
      diagnostic: `Native API transport error: ${msg}`,
    };
  }

  const finalText = assistantTexts.join('\n').trim();

  if (exhaustedToolTurns) {
    return {
      outcome: 'task_failure',
      finalText,
      mcpSubmission,
      inputTokens,
      cachedTokens,
      firstTurnCachedTokens,
      outputTokens,
      costUsd: finalizeCost(),
      durationSec: Number(
        Math.max(0.01, (Date.now() - startedAt) / 1000).toFixed(3),
      ),
      diagnostic: `Exhausted maxToolTurns (${maxTurns}) while model continued requesting tool calls`,
    };
  }

  return {
    outcome: 'completed',
    finalText,
    mcpSubmission,
    inputTokens,
    cachedTokens,
    firstTurnCachedTokens,
    outputTokens,
    costUsd: finalizeCost(),
    durationSec: Number(
      Math.max(0.01, (Date.now() - startedAt) / 1000).toFixed(3),
    ),
    diagnostic: 'Native API session completed',
  };
}

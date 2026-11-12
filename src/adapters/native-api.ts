/**
 * Zero-CLI Commercial API Direct Tool-Call Loop Runner (`openai-compatible`
 * `/chat/completions` and `anthropic-messages` `/v1/messages`).
 * Enforces worktree path confinement via `worktrees.resolveInside` and
 * tracks prompt-cache hit metrics (`cached_tokens` / `cache_read_input_tokens`).
 */

import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {IGitWorktreeManager} from '../sandbox/contracts.ts';
import type {
  AgentInvocationRequest,
  AgentInvocationResult,
  McpSubmissionPayload,
  ProviderSecretLookup,
  ProviderSecretResolved,
} from './contracts.ts';

const MAX_TOOL_TURNS = 6;

function inferProviderCandidates(model: string): string[] {
  const lower = model.toLowerCase();
  if (lower.includes('/')) {
    const prefix = lower.split('/')[0]!;
    return [prefix, 'deepseek', 'openai', 'anthropic'];
  }
  if (lower.startsWith('claude')) {
    return ['anthropic', 'openai', 'deepseek'];
  }
  if (
    lower.startsWith('gpt') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3')
  ) {
    return ['openai', 'deepseek', 'anthropic'];
  }
  return ['deepseek', 'openai', 'anthropic'];
}

function resolveProviderConfig(
  model: string,
  lookupProvider: ProviderSecretLookup,
): ProviderSecretResolved | null {
  const candidates = inferProviderCandidates(model);
  let firstResolved: ProviderSecretResolved | null = null;
  for (const id of candidates) {
    const found = lookupProvider(id);
    if (found) {
      if (!firstResolved) {
        firstResolved = found;
      }
      if (found.apiKey && found.apiKey.trim().length > 0) {
        return found;
      }
    }
  }
  return firstResolved;
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
        const safePath = worktrees.resolveInside(req.cwd, relPath || '.');
        const content = readFileSync(safePath, 'utf8').slice(0, 32_768);
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
        const content =
          typeof args['content'] === 'string' ? args['content'] : '';
        const safePath = worktrees.resolveInside(req.cwd, relPath);
        mkdirSync(dirname(safePath), {recursive: true});
        writeFileSync(safePath, content, 'utf8');
        return {
          output: `Wrote ${content.length} bytes to ${relPath}`,
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

export async function runNativeApiSession(
  req: AgentInvocationRequest,
  worktrees: IGitWorktreeManager,
  lookupProvider: ProviderSecretLookup,
): Promise<AgentInvocationResult> {
  const startedAt = Date.now();
  const provider = resolveProviderConfig(req.model, lookupProvider);

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

  let inputTokens = 0;
  let cachedTokens = 0;
  let firstTurnCachedTokens = 0;
  let sawFirstTurn = false;
  let outputTokens = 0;
  let mcpSubmission: McpSubmissionPayload | null = null;
  const assistantTexts: string[] = [];

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

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model: req.model || req.adapter.defaultModel,
            messages,
            tools: req.readOnly
              ? OPENAI_TOOLS_SCHEMA.filter(
                  t => t.function.name !== 'write_file',
                )
              : OPENAI_TOOLS_SCHEMA,
          }),
        });

        if (res.status === 429) {
          return {
            outcome: 'rate_limited',
            finalText: assistantTexts.join('\n').trim(),
            mcpSubmission,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: 0,
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: 'OpenAI-compatible endpoint returned HTTP 429',
            retryAfterSeconds: 30,
          };
        }

        if (res.status === 401 || res.status === 403) {
          return {
            outcome: 'env_fault',
            finalText: '',
            mcpSubmission: null,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: 0,
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
            costUsd: 0,
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
        if (toolCalls.length === 0) {
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
          if (typeof fnObj['arguments'] === 'string') {
            try {
              parsedArgs = JSON.parse(fnObj['arguments']) as Record<
                string,
                unknown
              >;
            } catch {
              parsedArgs = {};
            }
          }

          const toolRes = executeConfinedTool(
            req,
            worktrees,
            toolName,
            parsedArgs,
          );
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
      }
    } else {
      // anthropic-messages protocol
      const base = provider.baseUrl.replace(/\/+$/, '');
      const endpoint = base.endsWith('/messages')
        ? base
        : base.endsWith('/v1')
          ? `${base}/messages`
          : `${base}/v1/messages`;

      const messages: Array<Record<string, unknown>> = [
        {role: 'user', content: req.userPrompt},
      ];

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: req.model || req.adapter.defaultModel,
            max_tokens: 4096,
            system: req.systemPrompt,
            messages,
            tools: req.readOnly
              ? ANTHROPIC_TOOLS_SCHEMA.filter(t => t.name !== 'write_file')
              : ANTHROPIC_TOOLS_SCHEMA,
          }),
        });

        if (res.status === 429) {
          return {
            outcome: 'rate_limited',
            finalText: assistantTexts.join('\n').trim(),
            mcpSubmission,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: 0,
            durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
            diagnostic: 'Anthropic endpoint returned HTTP 429',
            retryAfterSeconds: 30,
          };
        }

        if (res.status === 401 || res.status === 403) {
          return {
            outcome: 'env_fault',
            finalText: '',
            mcpSubmission: null,
            inputTokens,
            cachedTokens,
            firstTurnCachedTokens,
            outputTokens,
            costUsd: 0,
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
            costUsd: 0,
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
          const outTok =
            typeof u['output_tokens'] === 'number' ? u['output_tokens'] : 0;
          inputTokens += inTok + cacheRead;
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

        if (toolResults.length === 0 || mcpSubmission) {
          break;
        }

        messages.push({role: 'assistant', content: contentBlocks});
        messages.push({role: 'user', content: toolResults});
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
      costUsd: 0,
      durationSec: Math.max(0.01, (Date.now() - startedAt) / 1000),
      diagnostic: `Native API transport error: ${msg}`,
    };
  }

  const finalText = assistantTexts.join('\n').trim();
  const costUsd = Number(
    (
      ((inputTokens - cachedTokens) * 0.5 +
        cachedTokens * 0.1 +
        outputTokens * 1.5) /
      1_000_000
    ).toFixed(6),
  );

  return {
    outcome: 'completed',
    finalText,
    mcpSubmission,
    inputTokens,
    cachedTokens,
    firstTurnCachedTokens,
    outputTokens,
    costUsd: Math.max(0, costUsd),
    durationSec: Number(
      Math.max(0.01, (Date.now() - startedAt) / 1000).toFixed(3),
    ),
    diagnostic: 'Native API session completed',
  };
}

/**
 * Strict runtime boundary validation utilities (fail-closed, zero `any`).
 */

import {ForgeError} from './errors.ts';
import type {
  ControlAction,
  ControlCommandInput,
  DecisionAction,
  DecisionInput,
  IntentPresetId,
} from './v3-types.ts';
import type {
  AdapterTransport,
  AgentAdapterManifest,
  AgentRole,
  EpistemicHandoff,
  PermissionTier,
} from './types.ts';

export function asRecord(
  input: unknown,
  context = 'payload',
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Expected ${context} to be a JSON object`,
    );
  }
  return input as Record<string, unknown>;
}

export function reqString(
  obj: Record<string, unknown>,
  key: string,
  maxLen = 32_768,
): string {
  const val = obj[key];
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Field "${key}" must be a non-empty string`,
    );
  }
  if (val.length > maxLen) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Field "${key}" exceeds maximum length ${maxLen}`,
    );
  }
  return val.trim();
}

export function optString(
  obj: Record<string, unknown>,
  key: string,
  fallback = '',
  maxLen = 65_536,
): string {
  const val = obj[key];
  if (val === undefined || val === null) {
    return fallback;
  }
  if (typeof val !== 'string') {
    throw new ForgeError('VALIDATION_ERROR', `Field "${key}" must be a string`);
  }
  if (val.length > maxLen) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Field "${key}" exceeds maximum length ${maxLen}`,
    );
  }
  return val.trim();
}

export function optNumber(
  obj: Record<string, unknown>,
  key: string,
  fallback: number,
  min = 0,
  max = 1_000_000,
): number {
  const val = obj[key];
  if (val === undefined || val === null) {
    return fallback;
  }
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Field "${key}" must be a finite number`,
    );
  }
  if (val < min || val > max) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Field "${key}" must be between ${min} and ${max}`,
    );
  }
  return val;
}

export function reqEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const val = obj[key];
  if (typeof val !== 'string' || !allowed.includes(val as T)) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Field "${key}" must be one of: ${allowed.join(', ')}`,
    );
  }
  return val as T;
}

export function optStringArray(
  obj: Record<string, unknown>,
  key: string,
  maxItems = 128,
): string[] {
  const val = obj[key];
  if (val === undefined || val === null) {
    return [];
  }
  if (!Array.isArray(val) || val.length > maxItems) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Field "${key}" must be an array of at most ${maxItems} strings`,
    );
  }
  return val.map((item, idx) => {
    if (typeof item !== 'string') {
      throw new ForgeError(
        'VALIDATION_ERROR',
        `Field "${key}[${idx}]" must be a string`,
      );
    }
    return item.trim();
  });
}

export const PERMISSION_TIERS: readonly PermissionTier[] = [
  'turbo',
  'supervised',
  'strict',
];

const ADAPTER_TRANSPORTS: readonly AdapterTransport[] = [
  'acp-stdio',
  'cli-stream',
  'native-api',
];

const AGENT_ROLES: readonly AgentRole[] = [
  'lead',
  'worker',
  'evaluator',
  'moderator',
  'infra_steward',
  'specialist',
];

export function validateAdapterManifest(raw: unknown): AgentAdapterManifest {
  const rec = asRecord(raw, 'adapter manifest');
  const id = reqString(rec, 'id', 80);
  if (!/^[a-z0-9][a-z0-9-_]{1,63}$/.test(id)) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      'Adapter id must match ^[a-z0-9][a-z0-9-_]{1,63}$',
    );
  }
  const transport = reqEnum(rec, 'transport', ADAPTER_TRANSPORTS);
  const command =
    transport === 'native-api'
      ? optString(rec, 'command', 'builtin-api', 512)
      : reqString(rec, 'command', 512);
  const permRaw =
    rec['permissionFlags'] !== undefined
      ? asRecord(rec['permissionFlags'], 'permissionFlags')
      : {};
  const rolesRaw = optStringArray(rec, 'supportedRoles', 10);
  const supportedRoles: AgentRole[] =
    rolesRaw.length > 0
      ? rolesRaw.map(role => {
          if (!AGENT_ROLES.includes(role as AgentRole)) {
            throw new ForgeError(
              'VALIDATION_ERROR',
              `Unsupported agent role: ${role}`,
            );
          }
          return role as AgentRole;
        })
      : ['worker'];

  return {
    id,
    label: reqString(rec, 'label', 120),
    specialty: optString(rec, 'specialty', 'General Software Engineering', 240),
    sovereignSoul: optString(
      rec,
      'sovereignSoul',
      'Execute bounded engineering slices with strict verification.',
      8192,
    ),
    transport,
    command,
    baseArgs: optStringArray(rec, 'baseArgs', 32),
    healthProbeArgs: optStringArray(rec, 'healthProbeArgs', 8),
    mcpInjection: reqEnum(
      {mcpInjection: rec['mcpInjection'] ?? 'none'},
      'mcpInjection',
      ['acp-session', 'claude-mcp-json', 'codex-flag', 'env-url', 'none'],
    ),
    jsonlParser: reqEnum(
      {jsonlParser: rec['jsonlParser'] ?? 'generic-jsonl'},
      'jsonlParser',
      [
        'claude-stream',
        'codex-rpc',
        'opencode-json',
        'pi-json',
        'generic-jsonl',
        'none',
      ],
    ),
    permissionFlags: {
      turbo: optStringArray(permRaw, 'turbo', 16),
      supervised: optStringArray(permRaw, 'supervised', 16),
      strict: optStringArray(permRaw, 'strict', 16),
    },
    envAllowlist: optStringArray(rec, 'envAllowlist', 32),
    defaultModel: optString(rec, 'defaultModel', 'default', 160),
    supportedRoles,
    maxConcurrentSlots: Math.trunc(
      optNumber(rec, 'maxConcurrentSlots', 2, 1, 32),
    ),
    builtIn: Boolean(rec['builtIn']),
  };
}

export interface ValidatedSliceDeliverable {
  readonly summary: string;
  readonly modifiedFiles: readonly string[];
  readonly dddComplianceNote: string;
  readonly epistemicHandoff: EpistemicHandoff;
}

export function validateSliceDeliverable(
  raw: unknown,
): ValidatedSliceDeliverable {
  const rec = asRecord(raw, 'slice deliverable');
  const handoffRec =
    rec['epistemicHandoff'] !== undefined
      ? asRecord(rec['epistemicHandoff'], 'epistemicHandoff')
      : {};
  return {
    summary: reqString(rec, 'summary', 16_384),
    modifiedFiles: optStringArray(rec, 'modifiedFiles', 256),
    dddComplianceNote: optString(
      rec,
      'dddComplianceNote',
      'Canonical domain terms verified.',
      4096,
    ),
    epistemicHandoff: {
      specConfirmedFacts: optStringArray(handoffRec, 'specConfirmedFacts', 64),
      agentHypotheses: optStringArray(handoffRec, 'agentHypotheses', 64),
      openConflicts: optStringArray(handoffRec, 'openConflicts', 32),
      uncertifiedCriteria: optStringArray(
        handoffRec,
        'uncertifiedCriteria',
        64,
      ),
    },
  };
}

export interface ValidatedAuditVerdict {
  readonly passed: boolean;
  readonly score: number;
  readonly findings: readonly string[];
  readonly dddViolations: readonly string[];
}

export function extractBalancedJsonObject(raw: string): string | null {
  const fenced = /```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/i.exec(raw);
  const text = (fenced?.[1] ?? raw).trim();
  for (
    let start = text.indexOf('{');
    start >= 0;
    start = text.indexOf('{', start + 1)
  ) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i]!;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

export function parseFailClosedAuditJson(text: string): ValidatedAuditVerdict {
  try {
    const jsonSlice = extractBalancedJsonObject(text);
    if (!jsonSlice) {
      return {
        passed: false,
        score: 0,
        findings: ['Evaluator output contained no JSON verdict object.'],
        dddViolations: [],
      };
    }
    const parsed = asRecord(JSON.parse(jsonSlice));
    if (typeof parsed['passed'] !== 'boolean') {
      return {
        passed: false,
        score: 0,
        findings: ['Evaluator JSON missing boolean "passed" field.'],
        dddViolations: [],
      };
    }
    const rawScore =
      typeof parsed['score'] === 'number' && Number.isFinite(parsed['score'])
        ? Math.max(0, Math.min(1, parsed['score']))
        : parsed['passed']
          ? 0.9
          : 0.3;
    const findings = optStringArray(parsed, 'findings', 64);
    const dddViolations = optStringArray(parsed, 'dddViolations', 64);
    return {
      passed: parsed['passed'] && dddViolations.length === 0,
      score: rawScore,
      findings,
      dddViolations,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      score: 0,
      findings: [`Fail-closed audit JSON error: ${msg}`],
      dddViolations: [],
    };
  }
}

const DECISION_ACTIONS: readonly DecisionAction[] = [
  'confirm_triage',
  'clarify',
  'resolve_issue',
  'approve',
  'conditional_approve',
  'release_conditions',
  'request_changes',
  'confirm',
  'reject',
  'escalate',
  'retry_review',
  'approve_plan',
  'approve_ghost',
  'waive_ghost',
  'resume',
  'resync_upstream',
  'extend_budget',
  'hold',
  'approve_delivery',
  'switch_simulation',
];

const CONTROL_ACTIONS: readonly ControlAction[] = [
  'start',
  'pause',
  'resume',
  'retry_node',
  'rewind_checkpoint',
  'resync_upstream',
  'amend_ghost',
  'switch_preset',
  'escalate_triage',
  'evolve_baseline',
  'abort',
];

const INTENT_PRESET_IDS: readonly IntentPresetId[] = [
  'autopilot',
  'guided',
  'strict_audit',
];

export function validateDecisionInput(raw: unknown): DecisionInput {
  const rec = asRecord(raw, 'decision');
  return {
    gateId: reqString(rec, 'gateId', 120),
    targetId: reqString(rec, 'targetId', 120),
    targetHash: reqString(rec, 'targetHash', 128),
    idempotencyKey: reqString(rec, 'idempotencyKey', 128),
    actor: optString(rec, 'actor', 'human_operator', 120),
    action: reqEnum(rec, 'action', DECISION_ACTIONS),
    feedback: optString(rec, 'feedback', '', 8192),
    scope:
      rec['scope'] !== undefined
        ? reqEnum(rec, 'scope', ['local', 'proposal'] as const)
        : 'proposal',
    issueIds: optStringArray(rec, 'issueIds', 64),
  };
}

export function validateControlCommand(raw: unknown): ControlCommandInput {
  const rec = asRecord(raw, 'control command');
  const action = reqEnum(rec, 'action', CONTROL_ACTIONS);
  const expectedVersion =
    rec['expectedVersion'] !== undefined
      ? optNumber(rec, 'expectedVersion', 1, 1, 1_000_000)
      : undefined;
  const preset =
    rec['preset'] !== undefined
      ? reqEnum(rec, 'preset', INTENT_PRESET_IDS)
      : undefined;
  return {
    action,
    expectedVersion,
    actor: optString(rec, 'actor', 'human_operator', 120),
    nodeId: optString(rec, 'nodeId', '', 120) || undefined,
    checkpointId: optString(rec, 'checkpointId', '', 120) || undefined,
    changeId: optString(rec, 'changeId', '', 120) || undefined,
    preset,
    ghostTitle: optString(rec, 'ghostTitle', '', 160) || undefined,
    ghostDescription: optString(rec, 'ghostDescription', '', 2048) || undefined,
    insertBeforeNodeId:
      optString(rec, 'insertBeforeNodeId', '', 120) || undefined,
    gateCommand: optString(rec, 'gateCommand', '', 512) || undefined,
    feedback: optString(rec, 'feedback', '', 4096) || undefined,
  };
}

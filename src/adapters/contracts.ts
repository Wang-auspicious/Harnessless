/**
 * Universal Multi-Agent Adapter Hub, Scoped `forge_station` MCP, and
 * Concurrency Slot Broker contracts.
 */

import type {
  AdapterOperationalProfile,
  AgentAdapterManifest,
  AgentRole,
  AttentionItem,
  GraphNode,
  PermissionTier,
  SlotLoadSnapshot,
} from '../shared/types.ts';

export interface McpSubmissionPayload {
  readonly summary: string;
  readonly specConfirmedFacts: readonly string[];
  readonly agentHypotheses: readonly string[];
  readonly openConflicts: readonly string[];
  readonly certifiedCriteriaIds: readonly string[];
}

export interface McpAttemptRegistrationInput {
  readonly hubId: string;
  readonly changeId: string;
  readonly nodeId: string;
  readonly worktreePath: string;
  readonly contractMarkdown: string;
  readonly onProgress?: (summary: string) => void;
  readonly onAskHuman?: (
    question: string,
    options: readonly string[],
    contextSnippet: string,
  ) => AttentionItem;
  readonly onProposeAmendment?: (
    title: string,
    description: string,
    gateCommand?: string,
  ) => GraphNode;
  readonly onSubmitted?: (payload: McpSubmissionPayload) => void;
}

export interface McpAttemptRegistration {
  readonly attemptToken: string;
  readonly mcpEndpointUrl: string;
  readonly revoke: () => void;
}

export interface IMcpStationServer {
  readonly baseUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  registerAttempt(input: McpAttemptRegistrationInput): McpAttemptRegistration;
  getSubmission(attemptToken: string): McpSubmissionPayload | null;
}

export interface ProviderSecretResolved {
  readonly providerId: string;
  readonly protocol: 'openai-compatible' | 'anthropic-messages';
  readonly baseUrl: string;
  readonly apiKey: string | null;
}

export type ProviderSecretLookup = (
  providerId: string,
) => ProviderSecretResolved | null;

export interface AgentInvocationRequest {
  readonly sessionId: string;
  readonly hubId: string;
  readonly changeId: string | null;
  readonly nodeId: string | null;
  readonly role: AgentRole;
  readonly adapter: AgentAdapterManifest;
  readonly model: string;
  readonly permissionTier: PermissionTier;
  readonly cwd: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly readOnly: boolean;
  readonly mcpEndpointUrl?: string;
  readonly mcpAttemptToken?: string;
  readonly timeoutMs?: number;
  readonly prioritySlot?: boolean;
  readonly onChunk?: (
    role: 'assistant' | 'tool',
    content: string,
    toolName?: string | null,
  ) => void;
}

export interface AgentInvocationResult {
  readonly outcome: 'completed' | 'rate_limited' | 'env_fault' | 'task_failure';
  readonly finalText: string;
  readonly mcpSubmission: McpSubmissionPayload | null;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly firstTurnCachedTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly durationSec: number;
  readonly diagnostic: string;
  readonly retryAfterSeconds?: number;
}

export interface IAgentAdapterHub {
  probeAdapter(
    manifest: AgentAdapterManifest,
  ): Promise<{readonly ok: boolean; readonly message: string}>;
  probeAllAdapters(): Promise<readonly AdapterOperationalProfile[]>;
  invoke(req: AgentInvocationRequest): Promise<AgentInvocationResult>;
  getSlotLoad(): SlotLoadSnapshot;
}

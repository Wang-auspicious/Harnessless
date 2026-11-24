/**
 * In-process Cross-Agent Collaboration Bus (`CollabBus`) with sequence-ordered
 * message logs per mission/task, SSE-friendly subscriptions, and Buzz/Ankole
 * audience-intersection access control.
 */

import {randomUUID} from 'node:crypto';
import {ForgeError} from '../shared/errors.ts';

export type CollabMessageKind =
  'handoff' | 'question' | 'review' | 'finding' | 'decision' | 'delegate';

export type AudienceScope =
  'world' | 'team' | `private:${string}` | `task:${string}`;

export const COLLAB_MESSAGE_KINDS: readonly CollabMessageKind[] = [
  'handoff',
  'question',
  'review',
  'finding',
  'decision',
  'delegate',
];

export interface CollabMessage {
  readonly id: string;
  readonly seq: number;
  readonly missionId: string;
  readonly taskId: string | null;
  readonly fromAgent: string;
  readonly fromKernel: string;
  readonly toAgent: string | null;
  readonly kind: CollabMessageKind;
  readonly summary: string;
  readonly artifactRef: string | null;
  readonly audienceScope: AudienceScope;
  readonly allowedReaders: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface CollabPostInput {
  readonly missionId: string;
  readonly taskId?: string | null;
  readonly fromAgent: string;
  readonly fromKernel?: string;
  readonly toAgent?: string | null;
  readonly kind: CollabMessageKind;
  readonly summary: string;
  readonly artifactRef?: string | null;
  readonly audienceScope?: AudienceScope;
  readonly allowedReaders?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CollabReaderContext {
  readonly readerId?: string;
  readonly readerScope?: AudienceScope;
  readonly readerTaskId?: string | null;
}

export interface CollabQueryOptions extends CollabReaderContext {
  readonly missionId?: string;
  readonly taskId?: string;
  readonly sinceSeq?: number;
  readonly limit?: number;
  readonly kinds?: readonly CollabMessageKind[];
}

export interface DelegateKernelRequest {
  readonly missionId: string;
  readonly taskId: string | null;
  readonly fromAgent: string;
  readonly targetKernel: string;
  readonly role: string;
  readonly prompt: string;
  readonly fileScope?: readonly string[];
  readonly audienceScope?: AudienceScope;
  readonly allowedReaders?: readonly string[];
}

export interface DelegateKernelResult {
  readonly delegateId: string;
  readonly message: CollabMessage;
  readonly accepted: boolean;
  readonly targetKernel: string;
  readonly role: string;
  readonly status: 'queued' | 'dispatched' | 'completed' | 'rejected';
  readonly summary: string;
  readonly outputText?: string;
}

export type CollabSubscriber = (message: CollabMessage) => void;

export interface CollabSubscriptionFilter extends CollabReaderContext {
  readonly missionId?: string;
  readonly taskId?: string;
}

interface SubscriberEntry {
  readonly listener: CollabSubscriber;
  readonly filter?: CollabSubscriptionFilter;
}

export function isValidCollabMessageKind(
  value: unknown,
): value is CollabMessageKind {
  return (
    typeof value === 'string' &&
    (COLLAB_MESSAGE_KINDS as readonly string[]).includes(value)
  );
}

export function isValidAudienceScope(value: unknown): value is AudienceScope {
  if (typeof value !== 'string') {
    return false;
  }
  if (value === 'world' || value === 'team') {
    return true;
  }
  if (value.startsWith('private:')) {
    return value.slice('private:'.length).trim().length > 0;
  }
  if (value.startsWith('task:')) {
    return value.slice('task:'.length).trim().length > 0;
  }
  return false;
}

/**
 * Computes the effective write audience by intersecting the caller's bound
 * scope with an optional requested scope so a narrower/private context can
 * never widen disclosure into a broader room (Buzz/Ankole non-escalation).
 */
export function narrowAudienceScope(
  callerScope: AudienceScope,
  requestedScope?: AudienceScope,
): AudienceScope {
  if (!requestedScope) {
    return callerScope;
  }
  if (callerScope === 'world') {
    return requestedScope;
  }
  if (callerScope === 'team') {
    return requestedScope === 'world' ? 'team' : requestedScope;
  }
  if (callerScope.startsWith('task:')) {
    if (requestedScope.startsWith('private:')) {
      return requestedScope;
    }
    return callerScope;
  }
  // callerScope is `private:<principal>`: never allow disclosure outside it.
  return callerScope;
}

/**
 * Enforces Buzz/Ankole audience-intersection visibility rules (fail-closed):
 * - If `allowedReaders` is non-empty, `readerId` MUST be explicitly listed.
 * - `'world'` messages are readable by any scope (subject to `allowedReaders`).
 * - `'team'` messages are hidden from `'world'` readers.
 * - `'task:<id>'` messages require matching task scope/id, author/target match,
 *   or explicit `allowedReaders` membership, and are always hidden from `'world'`.
 * - `'private:<principal>'` messages require matching private scope, principal
 *   or author identity match, or explicit `allowedReaders` membership, and are
 *   always hidden from `'world'` and unrelated readers.
 */
export function canReaderAccessMessage(
  message: CollabMessage,
  reader: CollabReaderContext = {},
): boolean {
  const readerId = reader.readerId?.trim() || undefined;
  const readerScope = reader.readerScope;
  const readerTaskId = reader.readerTaskId?.trim() || undefined;

  if (message.allowedReaders.length > 0) {
    if (!readerId || !message.allowedReaders.includes(readerId)) {
      return false;
    }
  }

  const scope = message.audienceScope;
  if (scope === 'world') {
    return true;
  }

  if (readerScope === 'world') {
    return false;
  }

  if (scope === 'team') {
    return true;
  }

  if (scope.startsWith('task:')) {
    const targetTaskId = scope.slice('task:'.length);
    if (readerScope === scope) {
      return true;
    }
    if (readerTaskId && readerTaskId === targetTaskId) {
      return true;
    }
    if (
      readerId &&
      (readerId === message.fromAgent || readerId === message.toAgent)
    ) {
      return true;
    }
    if (
      readerId &&
      message.allowedReaders.length > 0 &&
      message.allowedReaders.includes(readerId)
    ) {
      return true;
    }
    return false;
  }

  if (scope.startsWith('private:')) {
    const principal = scope.slice('private:'.length);
    if (readerScope === scope) {
      return true;
    }
    if (
      readerId &&
      (readerId === principal || readerId === message.fromAgent)
    ) {
      return true;
    }
    if (
      readerId &&
      message.allowedReaders.length > 0 &&
      message.allowedReaders.includes(readerId)
    ) {
      return true;
    }
    return false;
  }

  return false;
}

export class CollabBus {
  private readonly messages: CollabMessage[] = [];
  private readonly subscribers = new Map<string, SubscriberEntry>();
  private readonly missionSeq = new Map<string, number>();
  private globalSeq = 0;

  post(input: CollabPostInput): CollabMessage {
    const missionId = input.missionId.trim();
    const fromAgent = input.fromAgent.trim();
    const summary = input.summary.trim();
    if (!missionId) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        'CollabBus.post requires non-empty missionId',
        400,
      );
    }
    if (!fromAgent) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        'CollabBus.post requires non-empty fromAgent',
        400,
      );
    }
    if (!summary) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        'CollabBus.post requires non-empty summary',
        400,
      );
    }
    if (!isValidCollabMessageKind(input.kind)) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        `Unsupported collaboration message kind "${String(input.kind)}"`,
        400,
      );
    }

    const audienceScope: AudienceScope = input.audienceScope ?? 'team';
    if (!isValidAudienceScope(audienceScope)) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        `Invalid audienceScope "${String(audienceScope)}"`,
        400,
      );
    }

    const allowedReaders = Array.from(
      new Set(
        (input.allowedReaders ?? [])
          .map(r => r.trim())
          .filter(r => r.length > 0),
      ),
    );

    this.globalSeq += 1;
    const seq = this.globalSeq;
    this.missionSeq.set(missionId, seq);

    const message: CollabMessage = {
      id: `clb-${randomUUID()}`,
      seq,
      missionId,
      taskId: input.taskId?.trim() || null,
      fromAgent,
      fromKernel: input.fromKernel?.trim() || fromAgent,
      toAgent: input.toAgent?.trim() || null,
      kind: input.kind,
      summary,
      artifactRef: input.artifactRef?.trim() || null,
      audienceScope,
      allowedReaders,
      metadata: input.metadata ? {...input.metadata} : {},
      createdAt: new Date().toISOString(),
    };

    this.messages.push(message);
    this.notifySubscribers(message);
    return message;
  }

  query(options: CollabQueryOptions = {}): readonly CollabMessage[] {
    const missionId = options.missionId?.trim() || undefined;
    const taskId = options.taskId?.trim() || undefined;
    const sinceSeq =
      typeof options.sinceSeq === 'number' && Number.isFinite(options.sinceSeq)
        ? options.sinceSeq
        : 0;
    const kindSet =
      options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
    const limit =
      typeof options.limit === 'number' &&
      Number.isFinite(options.limit) &&
      options.limit > 0
        ? Math.floor(options.limit)
        : undefined;

    const filtered: CollabMessage[] = [];
    for (const msg of this.messages) {
      if (msg.seq <= sinceSeq) {
        continue;
      }
      if (missionId && msg.missionId !== missionId) {
        continue;
      }
      if (taskId && msg.taskId !== taskId) {
        continue;
      }
      if (kindSet && !kindSet.has(msg.kind)) {
        continue;
      }
      if (!canReaderAccessMessage(msg, options)) {
        continue;
      }
      filtered.push(msg);
      if (limit !== undefined && filtered.length >= limit) {
        break;
      }
    }

    return filtered;
  }

  listByMission(
    missionId: string,
    options: Omit<CollabQueryOptions, 'missionId'> = {},
  ): readonly CollabMessage[] {
    return this.query({...options, missionId});
  }

  recordHandoff(input: {
    readonly missionId: string;
    readonly taskId?: string | null;
    readonly fromAgent: string;
    readonly fromKernel: string;
    readonly toAgent: string;
    readonly summary: string;
    readonly artifactRef?: string | null;
    readonly audienceScope?: AudienceScope;
    readonly allowedReaders?: readonly string[];
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): CollabMessage {
    return this.post({
      missionId: input.missionId,
      taskId: input.taskId ?? null,
      fromAgent: input.fromAgent,
      fromKernel: input.fromKernel,
      toAgent: input.toAgent,
      kind: 'handoff',
      summary: input.summary,
      artifactRef: input.artifactRef ?? null,
      audienceScope: input.audienceScope ?? 'team',
      allowedReaders: input.allowedReaders,
      metadata: input.metadata,
    });
  }

  recordDelegate(
    req: DelegateKernelRequest,
    result?: Partial<
      Pick<
        DelegateKernelResult,
        'accepted' | 'status' | 'summary' | 'outputText'
      >
    >,
  ): DelegateKernelResult {
    const delegateId = `del-${randomUUID()}`;
    const targetKernel = req.targetKernel.trim();
    const role = req.role.trim() || 'worker';
    const prompt = req.prompt.trim();
    if (!targetKernel || !prompt) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        'CollabBus.recordDelegate requires non-empty targetKernel and prompt',
        400,
      );
    }

    const summary =
      result?.summary?.trim() ||
      `Delegate [${role}] to ${targetKernel}: ${prompt.slice(0, 160)}`;
    const message = this.post({
      missionId: req.missionId,
      taskId: req.taskId,
      fromAgent: req.fromAgent,
      fromKernel: req.fromAgent,
      toAgent: targetKernel,
      kind: 'delegate',
      summary,
      artifactRef: req.fileScope?.[0] ?? null,
      audienceScope: req.audienceScope ?? 'team',
      allowedReaders: req.allowedReaders,
      metadata: {
        delegateId,
        targetKernel,
        role,
        prompt,
        fileScope: req.fileScope ? [...req.fileScope] : [],
      },
    });

    return {
      delegateId,
      message,
      accepted: result?.accepted ?? true,
      targetKernel,
      role,
      status: result?.status ?? 'queued',
      summary,
      outputText: result?.outputText,
    };
  }

  subscribe(
    listener: CollabSubscriber,
    filter?: CollabSubscriptionFilter,
  ): () => void {
    const id = `sub-${randomUUID()}`;
    this.subscribers.set(id, {listener, filter});
    return () => {
      this.subscribers.delete(id);
    };
  }

  getLatestSeq(missionId?: string): number {
    if (missionId) {
      return this.missionSeq.get(missionId.trim()) ?? 0;
    }
    return this.globalSeq;
  }

  clear(missionId?: string): void {
    if (!missionId) {
      this.messages.length = 0;
      this.missionSeq.clear();
      return;
    }
    const target = missionId.trim();
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i]?.missionId === target) {
        this.messages.splice(i, 1);
      }
    }
    this.missionSeq.delete(target);
  }

  private notifySubscribers(message: CollabMessage): void {
    for (const entry of this.subscribers.values()) {
      const f = entry.filter;
      if (f) {
        if (f.missionId && message.missionId !== f.missionId) {
          continue;
        }
        if (f.taskId && message.taskId !== f.taskId) {
          continue;
        }
        if (!canReaderAccessMessage(message, f)) {
          continue;
        }
      }
      try {
        entry.listener(message);
      } catch {
        // Isolate subscriber errors so bus delivery remains non-blocking.
      }
    }
  }
}

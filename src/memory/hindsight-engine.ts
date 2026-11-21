import {
  buildRehydrationCapsule,
  computeLinesEntropyContribution,
  computeRetentionScore,
  reinforceAgentMemoryStability,
} from '../core/cognitive.ts';
import {sha256Text} from '../core/canonical-json.ts';
import {isFileInsideScope} from '../core/glob-scope.ts';
import {ForgeError} from '../shared/errors.ts';
import type {DomainTermEntry, RehydrationCapsule} from '../shared/types.ts';
import type {
  ExecutionMode,
  LivingDocKind,
  MemoryAuthorityTier,
  MemoryFactKind,
  MemoryFactRecord,
  MemoryLivingDocRecord,
  MemoryObservationRecord,
  MemoryRecallHit,
  MemoryRecallQuery,
  MemoryRecallResult,
  MemoryReflectResult,
  ObservationHistoryEntry,
} from '../shared/v3-types.ts';
import type {ForgeStore} from '../store/database.ts';
import {
  LOCAL_EMBEDDING_DIMS,
  LOCAL_EMBEDDING_SPACE,
  cosineSimilarity,
  decodeFloat32Blob,
  embedTextLocal,
  encodeFloat32Blob,
} from './embeddings.ts';
import {
  buildFtsMatchQuery,
  buildFtsTokens,
  canonicalEntityKey,
} from './tokenizer.ts';

export interface StructuredMemoryFactInput {
  readonly kind: MemoryFactKind;
  readonly subjectKey: string;
  readonly claim: string;
  readonly confidence?: number;
  readonly pathAnchors?: readonly string[];
  readonly entityNames?: readonly string[];
}

export interface RetainMemoryInput {
  readonly hubId: string;
  readonly repoId?: string | null;
  readonly missionId?: string | null;
  readonly executionMode?: ExecutionMode;
  readonly sourceType: string;
  readonly occurredAt?: string;
  readonly rawText: string;
  readonly authorityTier?: MemoryAuthorityTier;
  readonly structuredFacts?: readonly StructuredMemoryFactInput[];
  readonly metadata?: Record<string, unknown>;
}

export interface ConsolidationReport {
  readonly processedFacts: number;
  readonly supersededObservations: number;
  readonly createdObservations: number;
  readonly corroboratedObservations: number;
  readonly refreshedDocs: number;
}

export interface HindsightEngineOptions {
  readonly synthesizeText?: (
    prompt: string,
    systemPrompt: string,
  ) => Promise<string | null>;
  readonly embedRemote?: (text: string) => Promise<{
    readonly embeddingSpace: string;
    readonly dims: number;
    readonly vector: Float32Array;
  } | null>;
}

export interface EnsureLivingDocInput {
  readonly hubId: string;
  readonly repoId?: string | null;
  readonly executionMode: ExecutionMode;
  readonly docKind: LivingDocKind;
  readonly slug: string;
  readonly title: string;
  readonly standingQuestion: string;
  readonly initialMarkdown: string;
}

type StageBRelation = 'CORROBORATE' | 'SUPERSEDE' | 'CONTRADICT' | 'DISTINCT';

interface RemoteVectorEntry {
  readonly targetKind: 'observation' | 'fact' | 'chunk';
  readonly targetId: string;
  readonly embeddingSpace: string;
  readonly dims: number;
  readonly vector: Float32Array;
}

const CONSOLIDATION_BATCH_SIZE = 80;

const ACYCLIC_DENYLIST = new Set([
  'living_doc',
  'capsule',
  'rehydration_capsule',
  'agent_wiki',
  'mental_model',
  'ddd_map',
  'pitfall_runbook',
  'baseline_changelog',
  'reflection',
]);

const RESERVED_L1_SUBJECT_PREFIXES = [
  'ddd:',
  'req:',
  'constitution:',
  'decision:',
];

const FUNCTIONAL_SUBJECT_PREFIXES = [
  'ddd:',
  'req:',
  'repo:',
  'decision:',
  'constitution:',
];

const AUTHORITY_RANK: Readonly<Record<MemoryAuthorityTier, number>> = {
  L1_observed: 1,
  L2_verified: 2,
  L3_locked: 3,
};

const AUTHORITY_MULTIPLIER: Readonly<Record<MemoryAuthorityTier, number>> = {
  L1_observed: 0.85,
  L2_verified: 1.15,
  L3_locked: 1.35,
};

const DEFAULT_LIVING_DOC_TEMPLATES: readonly {
  readonly docKind: LivingDocKind;
  readonly slug: string;
  readonly title: string;
  readonly standingQuestion: string;
  readonly initialMarkdown: string;
}[] = [
  {
    docKind: 'mental_model',
    slug: 'mental-model',
    title: 'Hub Mental Model',
    standingQuestion:
      'What is the current architecture, mental model, and active module boundaries?',
    initialMarkdown:
      '# Hub Mental Model\n\nAwaiting consolidated observations.',
  },
  {
    docKind: 'agent_wiki',
    slug: 'agent-wiki',
    title: 'Hub Agent-Wiki',
    standingQuestion: 'What is the current repository topology and DDD map?',
    initialMarkdown: '# Hub Agent-Wiki\n\nAwaiting topology synthesis.',
  },
  {
    docKind: 'ddd_map',
    slug: 'ddd-map',
    title: 'DDD Ubiquitous Language Map',
    standingQuestion:
      'What are the canonical DDD bounded contexts, domain terms, and forbidden aliases?',
    initialMarkdown:
      '# DDD Ubiquitous Language Map\n\nAwaiting canonical domain term consolidation.',
  },
  {
    docKind: 'pitfall_runbook',
    slug: 'pitfall-runbook',
    title: 'Pitfall & Rejected-Option Runbook',
    standingQuestion:
      'What pitfalls, gate failures, and rejected options must be avoided?',
    initialMarkdown:
      '# Pitfall & Rejected-Option Runbook\n\nNo pitfalls recorded yet.',
  },
  {
    docKind: 'baseline_changelog',
    slug: 'baseline-changelog',
    title: 'Baseline & Decision Changelog',
    standingQuestion:
      'What requirement baselines, decisions, and scope changes are active?',
    initialMarkdown:
      '# Baseline & Decision Changelog\n\nNo baseline deltas recorded yet.',
  },
];

function isFunctionalSubject(subjectKey: string): boolean {
  return FUNCTIONAL_SUBJECT_PREFIXES.some(p => subjectKey.startsWith(p));
}

function isCompatibleForSubjectMatch(
  obs: MemoryObservationRecord,
  fact: MemoryFactRecord,
): boolean {
  return (
    (fact.kind === 'rejected_option') ===
    ((obs.kind ?? 'world') === 'rejected_option')
  );
}

function splitTextIntoChunks(
  rawText: string,
  maxChars = 800,
  overlap = 100,
): Array<{
  readonly seq: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
}> {
  const clean = rawText.trim();
  if (!clean) {
    return [];
  }
  if (clean.length <= maxChars) {
    return [{seq: 0, startOffset: 0, endOffset: clean.length, text: clean}];
  }
  const chunks: Array<{
    seq: number;
    startOffset: number;
    endOffset: number;
    text: string;
  }> = [];
  let start = 0;
  let seq = 0;
  while (start < clean.length) {
    const end = Math.min(clean.length, start + maxChars);
    chunks.push({
      seq,
      startOffset: start,
      endOffset: end,
      text: clean.slice(start, end),
    });
    if (end >= clean.length) {
      break;
    }
    start = Math.max(start + 1, end - overlap);
    seq += 1;
  }
  return chunks;
}

function textMatchesTerm(
  text: string,
  lowerText: string,
  needle: string,
): boolean {
  const clean = needle.trim();
  if (!clean) {
    return false;
  }
  if (/[\u4e00-\u9fff]/.test(clean)) {
    return text.includes(clean);
  }
  return lowerText.includes(clean.toLowerCase());
}

function extractInlineEntities(
  text: string,
  extraNames: readonly string[] = [],
  domainTerms: readonly DomainTermEntry[] = [],
): Array<{
  readonly type: string;
  readonly name: string;
  readonly aliases: readonly string[];
}> {
  const out: Array<{
    type: string;
    name: string;
    aliases: readonly string[];
  }> = [];
  const seen = new Set<string>();
  const add = (
    type: string,
    rawName: string,
    aliases: readonly string[] = [],
  ): void => {
    const clean = rawName.trim();
    if (!clean) {
      return;
    }
    const key = `${type}:${canonicalEntityKey(clean)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        type,
        name: clean,
        aliases: Array.from(new Set([clean, ...aliases].filter(Boolean))),
      });
    }
  };

  const lowerText = text.toLowerCase();
  for (const term of domainTerms) {
    const termAliases = [
      term.canonicalTerm,
      term.localLabel,
      ...term.forbiddenAliases,
    ].filter(Boolean);
    if (termAliases.some(alias => textMatchesTerm(text, lowerText, alias))) {
      add('domain_term', term.canonicalTerm, termAliases);
    }
  }

  for (const name of extraNames) {
    add('concept', name);
  }
  for (const m of text.matchAll(
    /\b(?:FR|NFR|AC|CHG|MSN)-[A-Za-z0-9_-]{2,40}\b/g,
  )) {
    add('requirement', m[0]);
  }
  for (const m of text.matchAll(/\b[A-Z][a-z]+(?:[A-Z][A-Za-z0-9]+)+\b/g)) {
    add('domain_term', m[0]);
  }
  for (const m of text.matchAll(
    /(?:src|docs|renderer|verify)\/[A-Za-z0-9._/-]+/g,
  )) {
    add('file_path', m[0]);
  }
  return out.slice(0, 24);
}

function parseStageBDecision(raw: string | null): StageBRelation | null {
  if (!raw) {
    return null;
  }
  const upper = raw.toUpperCase();
  if (upper.includes('CORROBORATE')) {
    return 'CORROBORATE';
  }
  if (upper.includes('SUPERSEDE')) {
    return 'SUPERSEDE';
  }
  if (upper.includes('CONTRADICT')) {
    return 'CONTRADICT';
  }
  if (upper.includes('DISTINCT')) {
    return 'DISTINCT';
  }
  return null;
}

export class HindsightEngine {
  private readonly store: ForgeStore;
  private readonly options?: HindsightEngineOptions;
  private readonly vectorCache = new Map<
    string,
    Array<{
      readonly targetKind: 'observation' | 'fact' | 'chunk';
      readonly targetId: string;
      readonly vec: Float32Array;
    }>
  >();

  constructor(store: ForgeStore, options?: HindsightEngineOptions) {
    this.store = store;
    this.options = options;
  }

  retain(input: RetainMemoryInput): {
    readonly documentId: string;
    readonly insertedChunks: number;
    readonly insertedFacts: number;
  } {
    const normalizedSource = input.sourceType.trim().toLowerCase();
    const metaLayer = input.metadata?.['layer'];
    if (ACYCLIC_DENYLIST.has(normalizedSource) || metaLayer === 3) {
      throw new ForgeError(
        'POLICY_DENIED',
        `Acyclic Memory Law: "${input.sourceType}" cannot re-enter retain()`,
        403,
      );
    }

    const executionMode: ExecutionMode = input.executionMode ?? 'live';
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const authorityTier: MemoryAuthorityTier =
      input.authorityTier ?? 'L1_observed';
    const rawText = input.rawText.trim();
    if (!rawText) {
      throw new ForgeError(
        'VALIDATION_ERROR',
        'retain() requires non-empty rawText',
        400,
      );
    }

    if (authorityTier === 'L1_observed' && input.structuredFacts) {
      for (const f of input.structuredFacts) {
        const subjLower = f.subjectKey.trim().toLowerCase();
        if (RESERVED_L1_SUBJECT_PREFIXES.some(p => subjLower.startsWith(p))) {
          throw new ForgeError(
            'POLICY_DENIED',
            `L1_observed cannot write to reserved subjectKey "${f.subjectKey}"`,
            403,
          );
        }
      }
    }

    const contentSha = sha256Text(rawText);
    const result = this.store.atomic(() => {
      const {doc, inserted} = this.store.memory.upsertDocument({
        hubId: input.hubId,
        repoId: input.repoId,
        missionId: input.missionId,
        executionMode,
        sourceType: normalizedSource,
        occurredAt,
        contentSha256: contentSha,
        rawText,
        metadataJson: JSON.stringify(input.metadata ?? {}),
      });

      if (!inserted) {
        const docEnt = this.store.memory.upsertEntity({
          hubId: input.hubId,
          executionMode,
          entityType: 'document',
          canonicalKey: canonicalEntityKey(doc.id),
          displayName: `${normalizedSource}:${doc.id.slice(0, 10)}`,
          aliases: [doc.id],
        });
        const scopeEnt = input.missionId
          ? this.store.memory.upsertEntity({
              hubId: input.hubId,
              executionMode,
              entityType: 'mission',
              canonicalKey: canonicalEntityKey(input.missionId),
              displayName: input.missionId,
              aliases: [input.missionId],
            })
          : input.repoId
            ? this.store.memory.upsertEntity({
                hubId: input.hubId,
                executionMode,
                entityType: 'repo',
                canonicalKey: canonicalEntityKey(input.repoId),
                displayName: input.repoId,
                aliases: [input.repoId],
              })
            : this.store.memory.upsertEntity({
                hubId: input.hubId,
                executionMode,
                entityType: 'source_scope',
                canonicalKey: canonicalEntityKey(
                  `${normalizedSource}:${input.hubId}`,
                ),
                displayName: `${normalizedSource}:${input.hubId}`,
                aliases: [normalizedSource],
              });
        if (
          !this.store.memory.hasActiveEdge(
            input.hubId,
            executionMode,
            scopeEnt.id,
            docEnt.id,
            'referenced_in',
          )
        ) {
          this.store.memory.insertEdge({
            hubId: input.hubId,
            executionMode,
            sourceEntityId: scopeEnt.id,
            targetEntityId: docEnt.id,
            relation: 'referenced_in',
          });
        }
        return {documentId: doc.id, insertedChunks: 0, insertedFacts: 0};
      }

      const chunks = splitTextIntoChunks(rawText);
      const savedChunks = chunks.map(c => {
        const saved = this.store.memory.insertChunk({
          documentId: doc.id,
          hubId: input.hubId,
          executionMode,
          seq: c.seq,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          text: c.text,
          ftsTokens: buildFtsTokens(c.text),
          tokenEstimate: Math.max(1, Math.ceil(c.text.length / 4)),
        });
        const vec = embedTextLocal(c.text, LOCAL_EMBEDDING_DIMS);
        this.store.memory.upsertVector({
          hubId: input.hubId,
          executionMode,
          targetKind: 'chunk',
          targetId: saved.id,
          embeddingSpace: LOCAL_EMBEDDING_SPACE,
          dims: LOCAL_EMBEDDING_DIMS,
          vectorBlob: encodeFloat32Blob(vec),
        });
        return saved;
      });

      const domainTerms = this.store.listDomainTerms(input.hubId);
      for (const term of domainTerms) {
        this.store.memory.upsertEntity({
          hubId: input.hubId,
          executionMode,
          entityType: 'domain_term',
          canonicalKey: canonicalEntityKey(term.canonicalTerm),
          displayName: term.canonicalTerm,
          aliases: [
            term.canonicalTerm,
            term.localLabel,
            ...term.forbiddenAliases,
          ].filter(Boolean),
        });
      }

      const defaultConfidence =
        authorityTier === 'L3_locked'
          ? 0.98
          : authorityTier === 'L2_verified'
            ? 0.72
            : 0.55;
      const factsInput: readonly StructuredMemoryFactInput[] =
        input.structuredFacts && input.structuredFacts.length > 0
          ? input.structuredFacts
          : savedChunks.map((ch, idx) => ({
              kind: 'world',
              subjectKey: `doc:${doc.id.slice(-8)}:chunk-${idx}`,
              claim: ch.text.slice(0, 600),
              confidence: defaultConfidence,
            }));

      let insertedFacts = 0;
      const defaultChunkId = savedChunks[0]?.id;
      if (defaultChunkId) {
        for (const f of factsInput) {
          const cleanClaim = f.claim.trim();
          if (!cleanClaim) {
            continue;
          }
          const inlineEntities = extractInlineEntities(
            `${f.subjectKey} ${cleanClaim}`,
            f.entityNames,
            domainTerms,
          );
          const entityIds: string[] = [];
          for (const ent of inlineEntities) {
            const savedEnt = this.store.memory.upsertEntity({
              hubId: input.hubId,
              executionMode,
              entityType: ent.type,
              canonicalKey: canonicalEntityKey(ent.name),
              displayName: ent.name,
              aliases: ent.aliases,
            });
            entityIds.push(savedEnt.id);
          }

          const rawConf = f.confidence ?? defaultConfidence;
          const clampedConf =
            authorityTier === 'L1_observed'
              ? Math.min(0.65, Math.max(0.1, rawConf))
              : Math.max(0.1, Math.min(1, rawConf));

          const factRec = this.store.memory.insertFact({
            hubId: input.hubId,
            repoId: input.repoId,
            missionId: input.missionId,
            executionMode,
            kind: f.kind,
            subjectKey: f.subjectKey,
            claim: cleanClaim,
            ftsTokens: buildFtsTokens(`${f.subjectKey} ${cleanClaim}`),
            confidence: clampedConf,
            authorityTier,
            eventStartAt: occurredAt,
            sourceDocumentId: doc.id,
            sourceChunkId: defaultChunkId,
            pathAnchors: f.pathAnchors ?? [],
            entityIds,
            stabilityHours:
              authorityTier === 'L3_locked'
                ? 720
                : authorityTier === 'L2_verified'
                  ? 120
                  : 36,
          });

          const fVec = embedTextLocal(cleanClaim, LOCAL_EMBEDDING_DIMS);
          this.store.memory.upsertVector({
            hubId: input.hubId,
            executionMode,
            targetKind: 'fact',
            targetId: factRec.id,
            embeddingSpace: LOCAL_EMBEDDING_SPACE,
            dims: LOCAL_EMBEDDING_DIMS,
            vectorBlob: encodeFloat32Blob(fVec),
          });

          for (let i = 0; i + 1 < entityIds.length; i += 1) {
            this.store.memory.insertEdge({
              hubId: input.hubId,
              executionMode,
              sourceEntityId: entityIds[i]!,
              targetEntityId: entityIds[i + 1]!,
              relation:
                f.kind === 'pitfall' ? 'caused_failure_in' : 'related_to',
              sourceFactId: factRec.id,
            });
          }
          insertedFacts += 1;
        }
      }

      this.store.enqueueEffect(
        'memory.consolidate',
        `consolidate:${input.hubId}:${executionMode}`,
        {hubId: input.hubId, executionMode},
      );

      this.invalidateVectorCache(input.hubId, executionMode);
      return {
        documentId: doc.id,
        insertedChunks: savedChunks.length,
        insertedFacts,
      };
    });

    return result;
  }

  recall(query: MemoryRecallQuery): MemoryRecallResult {
    const limit = Math.max(1, Math.min(30, query.limit ?? 8));
    const ftsQuery = buildFtsMatchQuery(query.query);
    const nowMs = Date.now();

    type Candidate = {
      targetKind: 'observation' | 'fact' | 'chunk';
      targetId: string;
      title: string;
      content: string;
      kind: MemoryFactKind | 'chunk';
      authorityTier: MemoryAuthorityTier;
      stabilityHours: number;
      lastRecalledAt: string;
      sourceChunkId: string | null;
      supportingFactIds: readonly string[];
      historyCount: number;
      pathAnchors: readonly string[];
      channelScores: Map<'fts' | 'vector' | 'graph' | 'temporal', number>;
    };

    const candidates = new Map<string, Candidate>();
    const addRank = (
      key: string,
      channel: 'fts' | 'vector' | 'graph' | 'temporal',
      rank: number,
      weight: number,
      init: Omit<Candidate, 'channelScores'>,
    ): void => {
      const contrib = weight / (60 + rank);
      const existing = candidates.get(key);
      if (existing) {
        const prev = existing.channelScores.get(channel) ?? 0;
        if (contrib > prev) {
          existing.channelScores.set(channel, contrib);
        }
        return;
      }
      candidates.set(key, {
        ...init,
        channelScores: new Map([[channel, contrib]]),
      });
    };

    const resolveObsChunkId = (obs: MemoryObservationRecord): string | null => {
      const firstFactId = obs.supportingFactIds[0];
      if (!firstFactId) {
        return null;
      }
      return this.store.memory.getFact(firstFactId)?.sourceChunkId ?? null;
    };

    // Channel 1: Full-Text (FTS5)
    if (ftsQuery) {
      const obsHits = this.store.memory.searchFtsObservations(
        ftsQuery,
        query.hubId,
        query.executionMode,
        20,
      );
      obsHits.forEach((o, idx) =>
        addRank(`obs:${o.id}`, 'fts', idx + 1, 1.3, {
          targetKind: 'observation',
          targetId: o.id,
          title: o.title,
          content: o.statement,
          kind: o.kind ?? 'world',
          authorityTier: o.authorityTier,
          stabilityHours: o.stabilityHours,
          lastRecalledAt: o.lastRecalledAt,
          sourceChunkId: resolveObsChunkId(o),
          supportingFactIds: o.supportingFactIds,
          historyCount: o.history.length,
          pathAnchors: o.pathAnchors,
        }),
      );

      const factHits = this.store.memory.searchFtsFacts(
        ftsQuery,
        query.hubId,
        query.executionMode,
        20,
      );
      factHits.forEach((f, idx) =>
        addRank(`fact:${f.id}`, 'fts', idx + 1, 1.1, {
          targetKind: 'fact',
          targetId: f.id,
          title: f.subjectKey,
          content: f.claim,
          kind: f.kind,
          authorityTier: f.authorityTier,
          stabilityHours: f.stabilityHours,
          lastRecalledAt: f.lastRecalledAt,
          sourceChunkId: f.sourceChunkId,
          supportingFactIds: [],
          historyCount: 0,
          pathAnchors: f.pathAnchors,
        }),
      );

      const chunkHits = this.store.memory.searchFtsChunks(
        ftsQuery,
        query.hubId,
        query.executionMode,
        12,
      );
      chunkHits.forEach((c, idx) =>
        addRank(`chunk:${c.id}`, 'fts', idx + 1, 0.8, {
          targetKind: 'chunk',
          targetId: c.id,
          title: `Source Chunk #${c.seq}`,
          content: c.text,
          kind: 'chunk',
          authorityTier: 'L1_observed',
          stabilityHours: 36,
          lastRecalledAt: c.createdAt,
          sourceChunkId: c.id,
          supportingFactIds: [],
          historyCount: 0,
          pathAnchors: [],
        }),
      );
    }

    // Channel 2: Vector Similarity
    const qVec = embedTextLocal(query.query, LOCAL_EMBEDDING_DIMS);
    const vectors = this.getCachedVectors(query.hubId, query.executionMode);
    const scoredVecs = vectors
      .map(v => ({...v, sim: cosineSimilarity(qVec, v.vec)}))
      .filter(v => v.sim > 0.12)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 20);

    scoredVecs.forEach((sv, idx) => {
      if (sv.targetKind === 'observation') {
        const o = this.store.memory.getObservation(sv.targetId);
        if (
          o &&
          (o.beliefStatus === 'active' || o.beliefStatus === 'contested')
        ) {
          addRank(`obs:${o.id}`, 'vector', idx + 1, 1.2, {
            targetKind: 'observation',
            targetId: o.id,
            title: o.title,
            content: o.statement,
            kind: o.kind ?? 'world',
            authorityTier: o.authorityTier,
            stabilityHours: o.stabilityHours,
            lastRecalledAt: o.lastRecalledAt,
            sourceChunkId: resolveObsChunkId(o),
            supportingFactIds: o.supportingFactIds,
            historyCount: o.history.length,
            pathAnchors: o.pathAnchors,
          });
        }
      } else if (sv.targetKind === 'fact') {
        const f = this.store.memory.getFact(sv.targetId);
        if (f && f.validUntil === null) {
          addRank(`fact:${f.id}`, 'vector', idx + 1, 1.0, {
            targetKind: 'fact',
            targetId: f.id,
            title: f.subjectKey,
            content: f.claim,
            kind: f.kind,
            authorityTier: f.authorityTier,
            stabilityHours: f.stabilityHours,
            lastRecalledAt: f.lastRecalledAt,
            sourceChunkId: f.sourceChunkId,
            supportingFactIds: [],
            historyCount: 0,
            pathAnchors: f.pathAnchors,
          });
        }
      } else {
        const c = this.store.memory.getChunk(sv.targetId);
        if (c) {
          addRank(`chunk:${c.id}`, 'vector', idx + 1, 0.75, {
            targetKind: 'chunk',
            targetId: c.id,
            title: `Source Chunk #${c.seq}`,
            content: c.text,
            kind: 'chunk',
            authorityTier: 'L1_observed',
            stabilityHours: 36,
            lastRecalledAt: c.createdAt,
            sourceChunkId: c.id,
            supportingFactIds: [],
            historyCount: 0,
            pathAnchors: [],
          });
        }
      }
    });

    // Channel 3: Decaying 2-Hop Entity-Graph Spreading Activation
    const qLower = query.query.toLowerCase();
    const qNorm = canonicalEntityKey(query.query);
    const entities = this.store.memory.listEntities(
      query.hubId,
      query.executionMode,
    );
    const seedIds = new Set<string>();
    for (const ent of entities) {
      const matched =
        (ent.displayName.length >= 2 &&
          qLower.includes(ent.displayName.toLowerCase())) ||
        (ent.canonicalKey.length >= 2 && qNorm.includes(ent.canonicalKey)) ||
        ent.aliases.some(
          a => a.length >= 2 && qLower.includes(a.toLowerCase()),
        );
      if (matched) {
        seedIds.add(ent.id);
      }
    }
    if (seedIds.size > 0) {
      const edges = this.store.memory.listEdges(
        query.hubId,
        query.executionMode,
      );
      const activation = new Map<string, number>();
      const hop1BestWeight = new Map<string, number>();
      for (const sid of seedIds) {
        activation.set(sid, 1.0);
      }
      for (const e of edges) {
        const w = Math.max(0.1, Math.min(1, e.weight));
        if (seedIds.has(e.sourceEntityId)) {
          const score = 0.6 * w;
          activation.set(
            e.targetEntityId,
            Math.max(activation.get(e.targetEntityId) ?? 0, score),
          );
          if (!seedIds.has(e.targetEntityId)) {
            hop1BestWeight.set(
              e.targetEntityId,
              Math.max(hop1BestWeight.get(e.targetEntityId) ?? 0, w),
            );
          }
        }
        if (seedIds.has(e.targetEntityId)) {
          const score = 0.6 * w;
          activation.set(
            e.sourceEntityId,
            Math.max(activation.get(e.sourceEntityId) ?? 0, score),
          );
          if (!seedIds.has(e.sourceEntityId)) {
            hop1BestWeight.set(
              e.sourceEntityId,
              Math.max(hop1BestWeight.get(e.sourceEntityId) ?? 0, w),
            );
          }
        }
      }
      for (const e of edges) {
        const w2 = Math.max(0.1, Math.min(1, e.weight));
        const srcW1 = hop1BestWeight.get(e.sourceEntityId);
        if (srcW1 !== undefined) {
          const score = 0.35 * srcW1 * w2;
          activation.set(
            e.targetEntityId,
            Math.max(activation.get(e.targetEntityId) ?? 0, score),
          );
        }
        const dstW1 = hop1BestWeight.get(e.targetEntityId);
        if (dstW1 !== undefined) {
          const score = 0.35 * dstW1 * w2;
          activation.set(
            e.sourceEntityId,
            Math.max(activation.get(e.sourceEntityId) ?? 0, score),
          );
        }
      }

      const graphFacts = this.store.memory
        .listFactsByEntityIds(
          query.hubId,
          query.executionMode,
          [...activation.keys()],
          40,
        )
        .map(f => ({
          fact: f,
          act: Math.max(0, ...f.entityIds.map(eid => activation.get(eid) ?? 0)),
        }))
        .sort(
          (a, b) =>
            b.act - a.act || b.fact.ingestedAt.localeCompare(a.fact.ingestedAt),
        )
        .slice(0, 20);

      graphFacts.forEach(({fact: f, act}, idx) =>
        addRank(`fact:${f.id}`, 'graph', idx + 1, act > 0 ? act : 0.35, {
          targetKind: 'fact',
          targetId: f.id,
          title: f.subjectKey,
          content: f.claim,
          kind: f.kind,
          authorityTier: f.authorityTier,
          stabilityHours: f.stabilityHours,
          lastRecalledAt: f.lastRecalledAt,
          sourceChunkId: f.sourceChunkId,
          supportingFactIds: [],
          historyCount: 0,
          pathAnchors: f.pathAnchors,
        }),
      );
    }

    // Channel 4: Temporal Range
    const temporalFacts = this.store.memory.listFactsTemporal(
      query.hubId,
      query.executionMode,
      query.sinceIso,
      query.untilIso,
      20,
    );
    temporalFacts.forEach((f, idx) =>
      addRank(
        `fact:${f.id}`,
        'temporal',
        idx + 1,
        query.sinceIso ? 1.2 : 0.45,
        {
          targetKind: 'fact',
          targetId: f.id,
          title: f.subjectKey,
          content: f.claim,
          kind: f.kind,
          authorityTier: f.authorityTier,
          stabilityHours: f.stabilityHours,
          lastRecalledAt: f.lastRecalledAt,
          sourceChunkId: f.sourceChunkId,
          supportingFactIds: [],
          historyCount: 0,
          pathAnchors: f.pathAnchors,
        },
      ),
    );

    // Deduplicate consolidated observation + supporting fact hits
    const factToObsKey = new Map<string, string>();
    for (const [key, cand] of candidates.entries()) {
      if (cand.targetKind === 'observation') {
        for (const fid of cand.supportingFactIds) {
          if (!factToObsKey.has(fid)) {
            factToObsKey.set(fid, key);
          }
        }
      }
    }
    for (const [key, cand] of [...candidates.entries()]) {
      if (cand.targetKind !== 'fact') {
        continue;
      }
      const obsKey = factToObsKey.get(cand.targetId);
      if (!obsKey) {
        continue;
      }
      const obsCand = candidates.get(obsKey);
      if (!obsCand) {
        continue;
      }
      for (const [ch, sc] of cand.channelScores.entries()) {
        const prev = obsCand.channelScores.get(ch) ?? 0;
        if (sc > prev) {
          obsCand.channelScores.set(ch, sc);
        }
      }
      candidates.delete(key);
    }

    // Score Fusion: RRF x Ebbinghaus Retention x Authority Multiplier
    const ranked: MemoryRecallHit[] = [];
    for (const cand of candidates.values()) {
      const lastMs = Date.parse(cand.lastRecalledAt);
      const elapsedHours = Number.isFinite(lastMs)
        ? Math.max(0, (nowMs - lastMs) / 3_600_000)
        : 1;
      const retentionFactor = computeRetentionScore(
        elapsedHours,
        cand.stabilityHours,
      );
      const authMult = AUTHORITY_MULTIPLIER[cand.authorityTier];
      let rrfScore = 0;
      for (const sc of cand.channelScores.values()) {
        rrfScore += sc;
      }
      const finalScore = Number(
        (rrfScore * (0.5 + 0.5 * retentionFactor) * authMult).toFixed(4),
      );

      let sourceChunkExcerpt: string | null = null;
      if (cand.sourceChunkId) {
        const chk = this.store.memory.getChunk(cand.sourceChunkId);
        if (chk) {
          sourceChunkExcerpt = chk.text.slice(0, 220);
        }
      }

      ranked.push({
        targetKind: cand.targetKind,
        targetId: cand.targetId,
        title: cand.title,
        content: cand.content,
        kind: cand.kind,
        authorityTier: cand.authorityTier,
        score: finalScore,
        retentionFactor: Number(retentionFactor.toFixed(3)),
        channelsMatched: [...cand.channelScores.keys()],
        sourceChunkExcerpt,
        observationHistoryCount: cand.historyCount,
        rejectedWarning:
          cand.kind === 'rejected_option'
            ? 'REJECTED — DO NOT RE-PROPOSE'
            : null,
        pathAnchors: cand.pathAnchors,
      });
    }

    ranked.sort((a, b) => b.score - a.score);
    const topHits = ranked.slice(0, limit);

    if (topHits.length > 0) {
      const touchIso = new Date(nowMs).toISOString();
      this.store.atomic(() => {
        for (const hit of topHits) {
          if (hit.targetKind === 'observation') {
            this.store.memory.touchObservationRecall(
              hit.targetId,
              undefined,
              touchIso,
            );
            this.store.memory.touchVectorRecall(
              'observation',
              hit.targetId,
              touchIso,
            );
          } else if (hit.targetKind === 'fact') {
            this.store.memory.touchFactRecall(hit.targetId, touchIso);
            this.store.memory.touchVectorRecall('fact', hit.targetId, touchIso);
          } else {
            this.store.memory.touchVectorRecall(
              'chunk',
              hit.targetId,
              touchIso,
            );
          }
        }
      });
    }

    return {
      query: query.query,
      executionMode: query.executionMode,
      embeddingSpace: LOCAL_EMBEDDING_SPACE,
      hits: topHits,
    };
  }

  consolidatePendingFacts(
    hubId: string,
    executionMode: ExecutionMode,
  ): ConsolidationReport {
    const facts = this.store.memory.listUnconsolidatedFacts(
      hubId,
      executionMode,
      CONSOLIDATION_BATCH_SIZE,
    );
    if (facts.length === 0) {
      return {
        processedFacts: 0,
        supersededObservations: 0,
        createdObservations: 0,
        corroboratedObservations: 0,
        refreshedDocs: 0,
      };
    }

    const counters = this.applyConsolidationBatch(
      hubId,
      executionMode,
      facts,
      new Map(),
      [],
    );
    this.invalidateVectorCache(hubId, executionMode);
    const refreshedDocs = this.refreshStaleLivingDocs(hubId, executionMode);

    return {
      processedFacts: facts.length,
      supersededObservations: counters.supersededObservations,
      createdObservations: counters.createdObservations,
      corroboratedObservations: counters.corroboratedObservations,
      refreshedDocs,
    };
  }

  async consolidatePendingFactsAsync(
    hubId: string,
    executionMode: ExecutionMode,
  ): Promise<ConsolidationReport> {
    const facts = this.store.memory.listUnconsolidatedFacts(
      hubId,
      executionMode,
      CONSOLIDATION_BATCH_SIZE,
    );
    if (facts.length === 0) {
      return {
        processedFacts: 0,
        supersededObservations: 0,
        createdObservations: 0,
        corroboratedObservations: 0,
        refreshedDocs: 0,
      };
    }

    const stageBDecisions = new Map<string, StageBRelation>();
    const remoteVectors: RemoteVectorEntry[] = [];

    for (const fact of facts) {
      const compatible = this.store.memory
        .findActiveObservationsBySubject(hubId, executionMode, fact.subjectKey)
        .filter(o => isCompatibleForSubjectMatch(o, fact));
      const primary = compatible[0];

      if (primary && primary.statement !== fact.claim) {
        const sim = cosineSimilarity(
          embedTextLocal(primary.statement, LOCAL_EMBEDDING_DIMS),
          embedTextLocal(fact.claim, LOCAL_EMBEDDING_DIMS),
        );
        if (sim >= 0.45 && sim < 0.85 && this.options?.synthesizeText) {
          const decision = await this.classifyStageBRelation(primary, fact);
          if (decision) {
            stageBDecisions.set(fact.id, decision);
          }
        }
      }

      if (this.options?.embedRemote) {
        try {
          const remote = await this.options.embedRemote(fact.claim);
          if (remote && remote.vector.length === remote.dims) {
            remoteVectors.push({
              targetKind: 'fact',
              targetId: fact.id,
              embeddingSpace: remote.embeddingSpace,
              dims: remote.dims,
              vector: remote.vector,
            });
          }
        } catch {
          // Local vectors remain intact if remote embedding fails.
        }
      }
    }

    const counters = this.applyConsolidationBatch(
      hubId,
      executionMode,
      facts,
      stageBDecisions,
      remoteVectors,
    );

    if (
      this.options?.embedRemote &&
      counters.touchedObservationIds.length > 0
    ) {
      const obsRemoteVectors: RemoteVectorEntry[] = [];
      for (const obsId of new Set(counters.touchedObservationIds)) {
        const obs = this.store.memory.getObservation(obsId);
        if (!obs) {
          continue;
        }
        try {
          const remote = await this.options.embedRemote(obs.statement);
          if (remote && remote.vector.length === remote.dims) {
            obsRemoteVectors.push({
              targetKind: 'observation',
              targetId: obs.id,
              embeddingSpace: remote.embeddingSpace,
              dims: remote.dims,
              vector: remote.vector,
            });
          }
        } catch {
          // Non-fatal remote embedding failure.
        }
      }
      if (obsRemoteVectors.length > 0) {
        this.store.atomic(() => {
          for (const rv of obsRemoteVectors) {
            this.store.memory.upsertVector({
              hubId,
              executionMode,
              targetKind: rv.targetKind,
              targetId: rv.targetId,
              embeddingSpace: rv.embeddingSpace,
              dims: rv.dims,
              vectorBlob: encodeFloat32Blob(rv.vector),
            });
          }
        });
      }
    }

    this.invalidateVectorCache(hubId, executionMode);
    const refreshedDocs = await this.refreshStaleLivingDocsAsync(
      hubId,
      executionMode,
    );

    return {
      processedFacts: facts.length,
      supersededObservations: counters.supersededObservations,
      createdObservations: counters.createdObservations,
      corroboratedObservations: counters.corroboratedObservations,
      refreshedDocs,
    };
  }

  reflect(input: {
    readonly hubId: string;
    readonly executionMode: ExecutionMode;
    readonly question: string;
    readonly limit?: number;
  }): MemoryReflectResult {
    const recalled = this.recall({
      hubId: input.hubId,
      executionMode: input.executionMode,
      query: input.question,
      limit: input.limit ?? 10,
      includeRejected: true,
    });
    const docs = this.store.memory.listLivingDocs(
      input.hubId,
      input.executionMode,
    );
    const observations = this.store.memory.listObservations(
      input.hubId,
      input.executionMode,
    );

    const confirmedFacts: string[] = [];
    const inferences: string[] = [];
    const contradictions: string[] = [];
    const citedChunkIds = new Set<string>();
    const citedObservationIds = new Set<string>();

    for (const hit of recalled.hits) {
      const refTag =
        hit.targetKind === 'observation' ? ` [obs:${hit.targetId}]` : '';
      if (hit.targetKind === 'observation') {
        citedObservationIds.add(hit.targetId);
      } else if (hit.targetKind === 'chunk') {
        citedChunkIds.add(hit.targetId);
      }
      if (hit.rejectedWarning) {
        contradictions.push(`[${hit.rejectedWarning}]${refTag} ${hit.content}`);
      } else if (
        hit.authorityTier === 'L3_locked' ||
        hit.authorityTier === 'L2_verified'
      ) {
        confirmedFacts.push(`[${hit.authorityTier}]${refTag} ${hit.content}`);
      } else {
        inferences.push(`[${hit.authorityTier}]${refTag} ${hit.content}`);
      }
    }

    for (const obs of observations) {
      if (obs.beliefStatus === 'contested' || obs.staleSuspect) {
        citedObservationIds.add(obs.id);
        contradictions.push(
          `[${obs.beliefStatus}${obs.staleSuspect ? '/stale' : ''}] [obs:${obs.id}] ${obs.title}: ${obs.statement}`,
        );
      }
    }

    const answerMarkdown = [
      `### Reflection: ${input.question}`,
      '',
      '#### Confirmed Facts (L2/L3)',
      ...(confirmedFacts.length > 0
        ? confirmedFacts.map(x => `- ${x}`)
        : ['- (No verified facts recorded yet)']),
      '',
      '#### Observed Signals & Inferences (L1)',
      ...(inferences.length > 0 ? inferences.map(x => `- ${x}`) : ['- (None)']),
      '',
      '#### Contradictions & Rejected Options',
      ...(contradictions.length > 0
        ? contradictions.map(x => `- ${x}`)
        : ['- (None)']),
    ].join('\n');

    return {
      question: input.question,
      answerMarkdown,
      confirmedFacts,
      inferences,
      contradictions,
      citedChunkIds: [...citedChunkIds],
      citedObservationIds: [...citedObservationIds],
      usedLivingDocIds: docs.slice(0, 4).map(d => d.id),
    };
  }

  async reflectAsync(input: {
    readonly hubId: string;
    readonly executionMode: ExecutionMode;
    readonly question: string;
    readonly limit?: number;
  }): Promise<MemoryReflectResult> {
    const base = this.reflect(input);
    if (!this.options?.synthesizeText) {
      return base;
    }
    const obsList = this.store.memory.listObservations(
      input.hubId,
      input.executionMode,
    );
    const validObsIds = new Set(obsList.map(o => o.id));
    const systemPrompt =
      'Synthesize a concise engineering reflection in Markdown answering the standing question. Cite observations using [obs:<id>] tags and highlight contradictions or rejected options.';
    const prompt = [
      `Question: ${input.question}`,
      '',
      'Baseline Evidence:',
      base.answerMarkdown,
    ].join('\n');
    try {
      const synthesized = await this.options.synthesizeText(
        prompt,
        systemPrompt,
      );
      if (!synthesized || !synthesized.trim()) {
        return base;
      }
      const cited = new Set(base.citedObservationIds);
      for (const m of synthesized.matchAll(/\[obs:([A-Za-z0-9_-]+)\]/g)) {
        const obsId = m[1]!;
        if (validObsIds.has(obsId)) {
          cited.add(obsId);
        }
      }
      return {
        ...base,
        answerMarkdown: synthesized.trim(),
        citedObservationIds: [...cited],
      };
    } catch {
      return base;
    }
  }

  refreshStaleLivingDocs(hubId: string, executionMode: ExecutionMode): number {
    const docs = this.store.memory.listLivingDocs(hubId, executionMode);
    let refreshed = 0;
    for (const doc of docs) {
      if (!doc.stale) {
        continue;
      }
      const reflection = this.reflect({
        hubId,
        executionMode,
        question: doc.standingQuestion,
        limit: 8,
      });
      this.upsertRefreshedLivingDoc(hubId, executionMode, doc, reflection);
      refreshed += 1;
    }
    return refreshed;
  }

  async refreshStaleLivingDocsAsync(
    hubId: string,
    executionMode: ExecutionMode,
  ): Promise<number> {
    const docs = this.store.memory.listLivingDocs(hubId, executionMode);
    let refreshed = 0;
    for (const doc of docs) {
      if (!doc.stale) {
        continue;
      }
      const reflection = await this.reflectAsync({
        hubId,
        executionMode,
        question: doc.standingQuestion,
        limit: 8,
      });
      this.upsertRefreshedLivingDoc(hubId, executionMode, doc, reflection);
      refreshed += 1;
    }
    return refreshed;
  }

  ensureDefaultLivingDoc(
    hubId: string,
    executionMode: ExecutionMode,
  ): MemoryLivingDocRecord[];
  ensureDefaultLivingDoc(input: EnsureLivingDocInput): void;
  ensureDefaultLivingDoc(
    hubIdOrInput: string | EnsureLivingDocInput,
    executionModeArg?: ExecutionMode,
  ): MemoryLivingDocRecord[] | void {
    if (typeof hubIdOrInput !== 'string') {
      const input = hubIdOrInput;
      const existing = this.store.memory
        .listLivingDocs(input.hubId, input.executionMode)
        .find(d => d.docKind === input.docKind && d.slug === input.slug);
      if (!existing) {
        this.store.memory.upsertLivingDoc({
          hubId: input.hubId,
          repoId: input.repoId,
          executionMode: input.executionMode,
          docKind: input.docKind,
          slug: input.slug,
          title: input.title,
          standingQuestion: input.standingQuestion,
          scopeEntities: [],
          contentMarkdown: input.initialMarkdown,
          citedObservationIds: [],
          stale: false,
        });
      }
      return;
    }

    const hubId = hubIdOrInput;
    const executionMode: ExecutionMode = executionModeArg ?? 'live';
    const existingDocs = this.store.memory.listLivingDocs(hubId, executionMode);
    const created: MemoryLivingDocRecord[] = [];
    for (const tpl of DEFAULT_LIVING_DOC_TEMPLATES) {
      const exists = existingDocs.some(
        d => d.docKind === tpl.docKind && d.slug === tpl.slug,
      );
      if (!exists) {
        created.push(
          this.store.memory.upsertLivingDoc({
            hubId,
            repoId: null,
            executionMode,
            docKind: tpl.docKind,
            slug: tpl.slug,
            title: tpl.title,
            standingQuestion: tpl.standingQuestion,
            scopeEntities: [],
            contentMarkdown: tpl.initialMarkdown,
            citedObservationIds: [],
            stale: false,
          }),
        );
      }
    }
    return created;
  }

  detectGitDrift(
    hubId: string,
    executionMode: ExecutionMode,
    changeId: string,
    changedFiles: readonly string[],
    executionEpoch?: number,
  ): number {
    if (changedFiles.length === 0) {
      return 0;
    }
    const epoch =
      executionEpoch ?? this.store.getChange(changeId)?.executionEpoch ?? 1;
    const watermarkKey = `memory_drift_done:${changeId}:${epoch}`;
    if (this.store.getMeta<boolean>(watermarkKey)) {
      return 0;
    }

    const observations = this.store.memory.listObservations(
      hubId,
      executionMode,
    );
    let marked = 0;
    this.store.atomic(() => {
      for (const obs of observations) {
        if (obs.pathAnchors.length === 0) {
          continue;
        }
        const hit = changedFiles.some(file =>
          isFileInsideScope(file, obs.pathAnchors),
        );
        if (hit && !obs.staleSuspect) {
          this.store.memory.markObservationStaleSuspect(obs.id);
          marked += 1;
        }
      }
      if (marked > 0) {
        const staleDocIds = this.store.memory.markLivingDocsStale(
          hubId,
          executionMode,
        );
        if (staleDocIds.length > 0) {
          this.store.enqueueEffect(
            'memory.refresh_docs',
            `refresh_docs:${hubId}:${executionMode}`,
            {hubId, executionMode},
          );
        }
      }
      this.store.setMeta(watermarkKey, true);
    });
    return marked;
  }

  buildAllCapsules(
    nowMs = Date.now(),
    executionMode: ExecutionMode = 'live',
  ): RehydrationCapsule[] {
    const hubs = this.store.listHubs(false);
    const openAttention = this.store.listAttentionItems(false);

    return hubs.map(hub => {
      const anchorMs = Date.parse(hub.lastHumanInteractionAt);
      const changes = this.store
        .listChanges(hub.id, false)
        .filter(c => (c.executionMode ?? 'live') === executionMode);
      const audits = this.store.listAuditLedger(50, hub.id);
      const diffTotals = this.store.getTotalChangeLinesForHub(
        hub.id,
        executionMode,
        hub.lastHumanInteractionAt,
      );

      let tasksCertifiedSinceAnchor = 0;
      let ghostAmendmentsSinceAnchor = 0;
      const deltaHighlights: string[] = [];

      for (const chg of changes) {
        const nodes = this.store.listGraphNodes(chg.id);
        for (const n of nodes) {
          const updatedMs = Date.parse(n.updatedAt);
          if (Number.isFinite(anchorMs) && updatedMs >= anchorMs) {
            if (n.kind === 'task' && n.status === 'certified') {
              tasksCertifiedSinceAnchor += 1;
            }
            if (n.kind === 'ghost') {
              ghostAmendmentsSinceAnchor += 1;
            }
          }
        }
        if (chg.status === 'certified' || chg.status === 'running') {
          deltaHighlights.push(
            `${chg.code} (${chg.title}): status=${chg.status}, spent=$${chg.spentUsd.toFixed(2)}`,
          );
        }
      }

      const revisedObsCount = this.store.memory.countRevisedObservationsSince(
        hub.id,
        executionMode,
        hub.lastHumanInteractionAt,
      );
      const adrUpdatesSinceAnchor =
        audits.filter(
          a =>
            (a.category === 'constitution' || a.category === 'ddd_refactor') &&
            Date.parse(a.createdAt) >= anchorMs,
        ).length + revisedObsCount;

      const hubAttention = openAttention.find(a => a.hubId === hub.id);
      const terms = this.store.listDomainTerms(hub.id);
      const lockedDecisions = [
        ...terms
          .slice(0, 3)
          .map(
            t =>
              `DDD [${t.boundedContext}]: Canonical "${t.canonicalTerm}" (${t.definition})`,
          ),
        ...audits.slice(0, 3).map(a => a.title),
      ];

      const linesChanged = computeLinesEntropyContribution(
        diffTotals.linesAdded,
        diffTotals.linesDeleted,
      );

      return buildRehydrationCapsule({
        hubId: hub.id,
        hubName: hub.name,
        northStarGoal: hub.description,
        lastHumanInteractionAt: hub.lastHumanInteractionAt,
        spacedReviewCount: hub.spacedReviewCount,
        lastHumanAnchorSummary:
          audits[0]?.title ??
          `Initialized Federation Hub "${hub.name}" (${changes.length} active changes)`,
        entropyInputs: {
          tasksCertifiedSinceAnchor,
          ghostAmendmentsSinceAnchor,
          adrUpdatesSinceAnchor,
          linesChangedSinceAnchor:
            linesChanged > 0 ? linesChanged : tasksCertifiedSinceAnchor * 40,
        },
        deltaHighlights:
          deltaHighlights.length > 0
            ? deltaHighlights
            : ['Workspace steady; zero unreviewed autonomous mutations.'],
        lockedDecisions,
        topAttentionQuestion: hubAttention?.question ?? null,
        nowMs,
      });
    });
  }

  private applyConsolidationBatch(
    hubId: string,
    executionMode: ExecutionMode,
    facts: readonly MemoryFactRecord[],
    stageBDecisions: ReadonlyMap<string, StageBRelation>,
    remoteVectors: readonly RemoteVectorEntry[],
  ): {
    readonly supersededObservations: number;
    readonly createdObservations: number;
    readonly corroboratedObservations: number;
    readonly touchedObservationIds: readonly string[];
  } {
    let supersededObservations = 0;
    let createdObservations = 0;
    let corroboratedObservations = 0;
    const touchedObservationIds: string[] = [];
    const nowIso = new Date().toISOString();

    this.store.atomic(() => {
      for (const rv of remoteVectors) {
        this.store.memory.upsertVector({
          hubId,
          executionMode,
          targetKind: rv.targetKind,
          targetId: rv.targetId,
          embeddingSpace: rv.embeddingSpace,
          dims: rv.dims,
          vectorBlob: encodeFloat32Blob(rv.vector),
        });
      }

      for (const fact of facts) {
        const compatibleObs = this.store.memory
          .findActiveObservationsBySubject(
            hubId,
            executionMode,
            fact.subjectKey,
          )
          .filter(o => isCompatibleForSubjectMatch(o, fact));
        const primary = compatibleObs[0];

        if (!primary) {
          const obs = this.store.memory.upsertObservation({
            hubId,
            repoId: fact.repoId,
            executionMode,
            kind: fact.kind,
            subjectKey: fact.subjectKey,
            title: this.deriveObservationTitle(fact),
            statement: fact.claim,
            ftsTokens: buildFtsTokens(`${fact.subjectKey} ${fact.claim}`),
            beliefStatus: 'active',
            authorityTier: fact.authorityTier,
            history: [],
            supportingFactIds: [fact.id],
            contradictingFactIds: [],
            entityIds: fact.entityIds,
            pathAnchors: fact.pathAnchors,
            stabilityHours: fact.stabilityHours,
            staleSuspect: false,
          });
          this.store.memory.upsertVector({
            hubId,
            executionMode,
            targetKind: 'observation',
            targetId: obs.id,
            embeddingSpace: LOCAL_EMBEDDING_SPACE,
            dims: LOCAL_EMBEDDING_DIMS,
            vectorBlob: encodeFloat32Blob(
              embedTextLocal(obs.statement, LOCAL_EMBEDDING_DIMS),
            ),
          });
          this.store.memory.markFactConsolidated(fact.id);
          touchedObservationIds.push(obs.id);
          createdObservations += 1;
          continue;
        }

        const sim = cosineSimilarity(
          embedTextLocal(primary.statement, LOCAL_EMBEDDING_DIMS),
          embedTextLocal(fact.claim, LOCAL_EMBEDDING_DIMS),
        );
        const stageB = stageBDecisions.get(fact.id) ?? null;

        // Corroboration check (with strict authority isolation)
        if (
          stageB === 'CORROBORATE' ||
          (stageB === null && (sim >= 0.85 || primary.statement === fact.claim))
        ) {
          const primaryRank = AUTHORITY_RANK[primary.authorityTier];
          const factRank = AUTHORITY_RANK[fact.authorityTier];
          const isL1OnHigher =
            fact.authorityTier === 'L1_observed' && primaryRank > 1;
          const shouldUpgradeWording = factRank > primaryRank;
          const nextStatement = shouldUpgradeWording
            ? fact.claim
            : primary.statement;
          const nextTitle = shouldUpgradeWording
            ? this.deriveObservationTitle(fact)
            : primary.title;
          const nextAuth = shouldUpgradeWording
            ? fact.authorityTier
            : primary.authorityTier;
          const nextKind = shouldUpgradeWording
            ? fact.kind
            : (primary.kind ?? fact.kind);
          const nextStability = isL1OnHigher
            ? primary.stabilityHours
            : reinforceAgentMemoryStability(primary.stabilityHours);
          const nextAnchors = isL1OnHigher
            ? primary.pathAnchors
            : Array.from(
                new Set([...primary.pathAnchors, ...fact.pathAnchors]),
              );
          const nextEntities = isL1OnHigher
            ? primary.entityIds
            : Array.from(new Set([...primary.entityIds, ...fact.entityIds]));
          const nextStaleSuspect =
            fact.authorityTier === 'L1_observed' ? primary.staleSuspect : false;

          const updated = this.store.memory.upsertObservation({
            id: primary.id,
            hubId,
            repoId: isL1OnHigher
              ? primary.repoId
              : (fact.repoId ?? primary.repoId),
            executionMode,
            kind: nextKind,
            subjectKey: primary.subjectKey,
            title: nextTitle,
            statement: nextStatement,
            ftsTokens: buildFtsTokens(`${primary.subjectKey} ${nextStatement}`),
            beliefStatus: primary.beliefStatus,
            authorityTier: nextAuth,
            history: primary.history,
            supportingFactIds: Array.from(
              new Set([...primary.supportingFactIds, fact.id]),
            ),
            contradictingFactIds: primary.contradictingFactIds,
            entityIds: nextEntities,
            pathAnchors: nextAnchors,
            stabilityHours: nextStability,
            staleSuspect: nextStaleSuspect,
          });
          if (shouldUpgradeWording) {
            this.store.memory.upsertVector({
              hubId,
              executionMode,
              targetKind: 'observation',
              targetId: updated.id,
              embeddingSpace: LOCAL_EMBEDDING_SPACE,
              dims: LOCAL_EMBEDDING_DIMS,
              vectorBlob: encodeFloat32Blob(
                embedTextLocal(updated.statement, LOCAL_EMBEDDING_DIMS),
              ),
            });
          }
          this.store.memory.markFactConsolidated(fact.id);
          touchedObservationIds.push(updated.id);
          corroboratedObservations += 1;
          continue;
        }

        // Functional slot temporal supersession (rejected_option is exempt)
        const canSupersede =
          fact.kind !== 'rejected_option' &&
          (primary.kind ?? 'world') !== 'rejected_option' &&
          (stageB === 'SUPERSEDE' ||
            (stageB === null && isFunctionalSubject(fact.subjectKey)) ||
            (stageB === 'CONTRADICT' &&
              AUTHORITY_RANK[fact.authorityTier] >
                AUTHORITY_RANK[primary.authorityTier])) &&
          AUTHORITY_RANK[fact.authorityTier] >=
            AUTHORITY_RANK[primary.authorityTier];

        if (canSupersede) {
          const prevEntry: ObservationHistoryEntry = {
            statement: primary.statement,
            validFrom: primary.createdAt,
            validUntil: nowIso,
            reason: `Superseded by ${fact.authorityTier} fact ${fact.id}`,
            factIds: primary.supportingFactIds,
          };
          for (const oldFactId of primary.supportingFactIds) {
            this.store.memory.supersedeFact(oldFactId, fact.id, nowIso);
          }
          const updated = this.store.memory.upsertObservation({
            id: primary.id,
            hubId,
            repoId: fact.repoId ?? primary.repoId,
            executionMode,
            kind: fact.kind,
            subjectKey: primary.subjectKey,
            title: primary.title,
            statement: fact.claim,
            ftsTokens: buildFtsTokens(`${primary.subjectKey} ${fact.claim}`),
            beliefStatus: 'active',
            authorityTier: fact.authorityTier,
            history: [...primary.history, prevEntry],
            supportingFactIds: [fact.id],
            contradictingFactIds: primary.contradictingFactIds,
            entityIds: Array.from(
              new Set([...primary.entityIds, ...fact.entityIds]),
            ),
            pathAnchors: Array.from(
              new Set([...primary.pathAnchors, ...fact.pathAnchors]),
            ),
            stabilityHours: Math.max(
              primary.stabilityHours,
              fact.stabilityHours,
            ),
            staleSuspect:
              fact.authorityTier === 'L1_observed'
                ? primary.staleSuspect
                : false,
          });
          this.store.memory.upsertVector({
            hubId,
            executionMode,
            targetKind: 'observation',
            targetId: updated.id,
            embeddingSpace: LOCAL_EMBEDDING_SPACE,
            dims: LOCAL_EMBEDDING_DIMS,
            vectorBlob: encodeFloat32Blob(
              embedTextLocal(updated.statement, LOCAL_EMBEDDING_DIMS),
            ),
          });
          this.store.memory.markFactConsolidated(fact.id);
          touchedObservationIds.push(updated.id);
          supersededObservations += 1;
          continue;
        }

        const isContested =
          fact.kind !== 'rejected_option' &&
          (stageB === 'CONTRADICT' ||
            (isFunctionalSubject(fact.subjectKey) &&
              AUTHORITY_RANK[fact.authorityTier] <
                AUTHORITY_RANK[primary.authorityTier]));

        const distinctObs = this.store.memory.upsertObservation({
          hubId,
          repoId: fact.repoId,
          executionMode,
          kind: fact.kind,
          subjectKey: `${fact.subjectKey}#${fact.id.slice(-6)}`,
          title: this.deriveObservationTitle(fact),
          statement: fact.claim,
          ftsTokens: buildFtsTokens(`${fact.subjectKey} ${fact.claim}`),
          beliefStatus: isContested ? 'contested' : 'active',
          authorityTier: fact.authorityTier,
          history: [],
          supportingFactIds: [fact.id],
          contradictingFactIds: isContested ? primary.supportingFactIds : [],
          entityIds: fact.entityIds,
          pathAnchors: fact.pathAnchors,
          stabilityHours: fact.stabilityHours,
          staleSuspect: false,
        });
        this.store.memory.upsertVector({
          hubId,
          executionMode,
          targetKind: 'observation',
          targetId: distinctObs.id,
          embeddingSpace: LOCAL_EMBEDDING_SPACE,
          dims: LOCAL_EMBEDDING_DIMS,
          vectorBlob: encodeFloat32Blob(
            embedTextLocal(distinctObs.statement, LOCAL_EMBEDDING_DIMS),
          ),
        });
        this.store.memory.markFactConsolidated(fact.id);
        touchedObservationIds.push(distinctObs.id);
        createdObservations += 1;
      }

      const provisioned = this.ensureDefaultLivingDoc(hubId, executionMode);
      if (
        supersededObservations > 0 ||
        createdObservations > 0 ||
        provisioned.length > 0
      ) {
        const staleDocIds = this.store.memory.markLivingDocsStale(
          hubId,
          executionMode,
        );
        if (staleDocIds.length > 0) {
          this.store.enqueueEffect(
            'memory.refresh_docs',
            `refresh_docs:${hubId}:${executionMode}`,
            {hubId, executionMode},
          );
        }
      }

      if (facts.length >= CONSOLIDATION_BATCH_SIZE) {
        this.store.enqueueEffect(
          'memory.consolidate',
          `consolidate:${hubId}:${executionMode}`,
          {hubId, executionMode},
        );
      }
    });

    return {
      supersededObservations,
      createdObservations,
      corroboratedObservations,
      touchedObservationIds,
    };
  }

  private async classifyStageBRelation(
    primary: MemoryObservationRecord,
    fact: MemoryFactRecord,
  ): Promise<StageBRelation | null> {
    if (!this.options?.synthesizeText) {
      return null;
    }
    const systemPrompt =
      'Classify the relationship between an existing observation and a new candidate fact. Reply with ONE token: CORROBORATE, SUPERSEDE, CONTRADICT, or DISTINCT.';
    const prompt = [
      `Subject: ${fact.subjectKey}`,
      `Existing (${primary.authorityTier}): ${primary.statement}`,
      `New (${fact.authorityTier}, kind=${fact.kind}): ${fact.claim}`,
    ].join('\n');
    try {
      const reply = await this.options.synthesizeText(prompt, systemPrompt);
      return parseStageBDecision(reply);
    } catch {
      return null;
    }
  }

  private upsertRefreshedLivingDoc(
    hubId: string,
    executionMode: ExecutionMode,
    doc: MemoryLivingDocRecord,
    reflection: MemoryReflectResult,
  ): void {
    const preserveRetroWiki =
      doc.docKind === 'agent_wiki' &&
      doc.contentMarkdown.includes('Retro-Optimized');
    this.store.memory.upsertLivingDoc({
      hubId,
      repoId: doc.repoId,
      executionMode,
      docKind: doc.docKind,
      slug: doc.slug,
      title: doc.title,
      standingQuestion: doc.standingQuestion,
      scopeEntities: doc.scopeEntities,
      contentMarkdown: preserveRetroWiki
        ? doc.contentMarkdown
        : reflection.answerMarkdown,
      citedObservationIds: preserveRetroWiki
        ? Array.from(
            new Set([
              ...doc.citedObservationIds,
              ...reflection.citedObservationIds,
            ]),
          )
        : reflection.citedObservationIds,
      stale: false,
    });
  }

  private deriveObservationTitle(fact: MemoryFactRecord): string {
    const clean = fact.subjectKey.replace(/^[a-z]+:/, '');
    return `[${fact.kind}] ${clean.slice(0, 72)}`;
  }

  private getCachedVectors(
    hubId: string,
    executionMode: ExecutionMode,
  ): Array<{
    readonly targetKind: 'observation' | 'fact' | 'chunk';
    readonly targetId: string;
    readonly vec: Float32Array;
  }> {
    const key = `${hubId}:${executionMode}:${LOCAL_EMBEDDING_SPACE}`;
    const hit = this.vectorCache.get(key);
    if (hit) {
      return hit;
    }
    const rows = this.store.memory.listActiveVectors(
      hubId,
      executionMode,
      LOCAL_EMBEDDING_SPACE,
      2000,
      LOCAL_EMBEDDING_DIMS,
    );
    const decoded = rows.map(r => ({
      targetKind: r.targetKind,
      targetId: r.targetId,
      vec: decodeFloat32Blob(r.vectorBlob, r.dims),
    }));
    if (this.vectorCache.size >= 16) {
      const oldest = this.vectorCache.keys().next().value;
      if (oldest) {
        this.vectorCache.delete(oldest);
      }
    }
    this.vectorCache.set(key, decoded);
    return decoded;
  }

  private invalidateVectorCache(
    hubId: string,
    executionMode: ExecutionMode,
  ): void {
    this.vectorCache.delete(
      `${hubId}:${executionMode}:${LOCAL_EMBEDDING_SPACE}`,
    );
  }
}

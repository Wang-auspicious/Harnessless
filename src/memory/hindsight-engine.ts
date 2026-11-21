import {
  buildRehydrationCapsule,
  computeLinesEntropyContribution,
  computeRetentionScore,
  reinforceAgentMemoryStability,
} from '../core/cognitive.ts';
import {sha256Text} from '../core/canonical-json.ts';
import {isFileInsideScope} from '../core/glob-scope.ts';
import {ForgeError} from '../shared/errors.ts';
import type {RehydrationCapsule} from '../shared/types.ts';
import type {
  ExecutionMode,
  LivingDocKind,
  MemoryAuthorityTier,
  MemoryFactKind,
  MemoryFactRecord,
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

function isFunctionalSubject(subjectKey: string): boolean {
  return FUNCTIONAL_SUBJECT_PREFIXES.some(p => subjectKey.startsWith(p));
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

function extractInlineEntities(
  text: string,
  extraNames: readonly string[] = [],
): Array<{readonly type: string; readonly name: string}> {
  const out: Array<{type: string; name: string}> = [];
  const seen = new Set<string>();
  const add = (type: string, rawName: string): void => {
    const clean = rawName.trim();
    if (!clean) {
      return;
    }
    const key = `${type}:${canonicalEntityKey(clean)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({type, name: clean});
    }
  };

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

export class HindsightEngine {
  private readonly store: ForgeStore;
  private readonly vectorCache = new Map<
    string,
    Array<{
      readonly targetKind: 'observation' | 'fact' | 'chunk';
      readonly targetId: string;
      readonly vec: Float32Array;
    }>
  >();

  constructor(store: ForgeStore) {
    this.store = store;
  }

  retain(input: RetainMemoryInput): {
    readonly documentId: string;
    readonly insertedChunks: number;
    readonly insertedFacts: number;
  } {
    if (input.sourceType === 'living_doc' || input.sourceType === 'capsule') {
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

    const contentSha = sha256Text(rawText);
    const result = this.store.atomic(() => {
      const {doc, inserted} = this.store.memory.upsertDocument({
        hubId: input.hubId,
        repoId: input.repoId,
        missionId: input.missionId,
        executionMode,
        sourceType: input.sourceType,
        occurredAt,
        contentSha256: contentSha,
        rawText,
        metadataJson: JSON.stringify(input.metadata ?? {}),
      });

      if (!inserted) {
        if (input.missionId) {
          const docEnt = this.store.memory.upsertEntity({
            hubId: input.hubId,
            executionMode,
            entityType: 'document',
            canonicalKey: canonicalEntityKey(doc.id),
            displayName: `${input.sourceType}:${doc.id.slice(0, 10)}`,
            aliases: [doc.id],
          });
          const msnEnt = this.store.memory.upsertEntity({
            hubId: input.hubId,
            executionMode,
            entityType: 'mission',
            canonicalKey: canonicalEntityKey(input.missionId),
            displayName: input.missionId,
            aliases: [input.missionId],
          });
          this.store.memory.insertEdge({
            hubId: input.hubId,
            executionMode,
            sourceEntityId: msnEnt.id,
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

      // Seed hub DDD domain terms into entity registry for bilingual alias bridging.
      for (const term of this.store.listDomainTerms(input.hubId)) {
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

      const factsInput: readonly StructuredMemoryFactInput[] =
        input.structuredFacts && input.structuredFacts.length > 0
          ? input.structuredFacts
          : savedChunks.map((ch, idx) => ({
              kind: 'world',
              subjectKey: `doc:${doc.id.slice(-8)}:chunk-${idx}`,
              claim: ch.text.slice(0, 600),
              confidence: authorityTier === 'L3_locked' ? 0.98 : 0.72,
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
          );
          const entityIds: string[] = [];
          for (const ent of inlineEntities) {
            const savedEnt = this.store.memory.upsertEntity({
              hubId: input.hubId,
              executionMode,
              entityType: ent.type,
              canonicalKey: canonicalEntityKey(ent.name),
              displayName: ent.name,
              aliases: [ent.name],
            });
            entityIds.push(savedEnt.id);
          }

          const factRec = this.store.memory.insertFact({
            hubId: input.hubId,
            repoId: input.repoId,
            missionId: input.missionId,
            executionMode,
            kind: f.kind,
            subjectKey: f.subjectKey,
            claim: cleanClaim,
            ftsTokens: buildFtsTokens(`${f.subjectKey} ${cleanClaim}`),
            confidence: Math.max(0.1, Math.min(1, f.confidence ?? 0.75)),
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
      historyCount: number;
      pathAnchors: readonly string[];
      channels: Set<'fts' | 'vector' | 'graph' | 'temporal'>;
      rrfScore: number;
    };

    const candidates = new Map<string, Candidate>();
    const addRank = (
      key: string,
      channel: 'fts' | 'vector' | 'graph' | 'temporal',
      rank: number,
      weight: number,
      init: Omit<Candidate, 'channels' | 'rrfScore'>,
    ): void => {
      const existing = candidates.get(key);
      const contrib = weight / (60 + rank);
      if (existing) {
        existing.channels.add(channel);
        existing.rrfScore += contrib;
        return;
      }
      candidates.set(key, {
        ...init,
        channels: new Set([channel]),
        rrfScore: contrib,
      });
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
          kind: 'world',
          authorityTier: o.authorityTier,
          stabilityHours: o.stabilityHours,
          lastRecalledAt: o.lastRecalledAt,
          sourceChunkId: o.supportingFactIds[0] ?? null,
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
            kind: 'world',
            authorityTier: o.authorityTier,
            stabilityHours: o.stabilityHours,
            lastRecalledAt: o.lastRecalledAt,
            sourceChunkId: null,
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
            historyCount: 0,
            pathAnchors: [],
          });
        }
      }
    });

    // Channel 3: 2-Hop Entity-Graph Spreading Activation
    const qLower = query.query.toLowerCase();
    const qNorm = canonicalEntityKey(query.query);
    const entities = this.store.memory.listEntities(
      query.hubId,
      query.executionMode,
    );
    const seedIds = new Set<string>();
    for (const ent of entities) {
      const matched =
        qLower.includes(ent.displayName.toLowerCase()) ||
        qNorm.includes(ent.canonicalKey) ||
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
      const hop1 = new Set<string>(seedIds);
      for (const e of edges) {
        if (seedIds.has(e.sourceEntityId)) {
          hop1.add(e.targetEntityId);
        }
        if (seedIds.has(e.targetEntityId)) {
          hop1.add(e.sourceEntityId);
        }
      }
      const hop2 = new Set<string>(hop1);
      for (const e of edges) {
        if (hop1.has(e.sourceEntityId)) {
          hop2.add(e.targetEntityId);
        }
        if (hop1.has(e.targetEntityId)) {
          hop2.add(e.sourceEntityId);
        }
      }
      const graphFacts = this.store.memory.listFactsByEntityIds(
        query.hubId,
        query.executionMode,
        [...hop2],
        20,
      );
      graphFacts.forEach((f, idx) =>
        addRank(`fact:${f.id}`, 'graph', idx + 1, 1.0, {
          targetKind: 'fact',
          targetId: f.id,
          title: f.subjectKey,
          content: f.claim,
          kind: f.kind,
          authorityTier: f.authorityTier,
          stabilityHours: f.stabilityHours,
          lastRecalledAt: f.lastRecalledAt,
          sourceChunkId: f.sourceChunkId,
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
          historyCount: 0,
          pathAnchors: f.pathAnchors,
        },
      ),
    );

    // Score Fusion: RRF x Ebbinghaus Retention x Authority Multiplier
    const ranked: MemoryRecallHit[] = [];
    for (const cand of candidates.values()) {
      if (!query.includeRejected && cand.kind === 'rejected_option') {
        // Still include rejected options when explicitly asked or warn clearly
      }
      const lastMs = Date.parse(cand.lastRecalledAt);
      const elapsedHours = Number.isFinite(lastMs)
        ? Math.max(0, (nowMs - lastMs) / 3_600_000)
        : 1;
      const retentionFactor = computeRetentionScore(
        elapsedHours,
        cand.stabilityHours,
      );
      const authMult = AUTHORITY_MULTIPLIER[cand.authorityTier];
      const finalScore = Number(
        (cand.rrfScore * (0.5 + 0.5 * retentionFactor) * authMult).toFixed(4),
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
        channelsMatched: [...cand.channels],
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

    for (const hit of topHits) {
      if (hit.targetKind === 'observation') {
        this.store.memory.touchObservationRecall(hit.targetId);
      } else if (hit.targetKind === 'fact') {
        this.store.memory.touchFactRecall(hit.targetId);
      }
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
      80,
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

    let supersededObservations = 0;
    let createdObservations = 0;
    let corroboratedObservations = 0;
    const nowIso = new Date().toISOString();

    this.store.atomic(() => {
      for (const fact of facts) {
        const existingObs = this.store.memory.findActiveObservationsBySubject(
          hubId,
          executionMode,
          fact.subjectKey,
        );
        const primary = existingObs[0];

        if (!primary) {
          const obs = this.store.memory.upsertObservation({
            hubId,
            repoId: fact.repoId,
            executionMode,
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
          createdObservations += 1;
          continue;
        }

        const sim = cosineSimilarity(
          embedTextLocal(primary.statement, LOCAL_EMBEDDING_DIMS),
          embedTextLocal(fact.claim, LOCAL_EMBEDDING_DIMS),
        );

        // Corroboration check
        if (sim >= 0.85 || primary.statement === fact.claim) {
          const nextStability = reinforceAgentMemoryStability(
            primary.stabilityHours,
          );
          const nextAuth =
            AUTHORITY_RANK[fact.authorityTier] >
            AUTHORITY_RANK[primary.authorityTier]
              ? fact.authorityTier
              : primary.authorityTier;
          this.store.memory.upsertObservation({
            id: primary.id,
            hubId,
            repoId: primary.repoId,
            executionMode,
            subjectKey: primary.subjectKey,
            title: primary.title,
            statement: primary.statement,
            ftsTokens: buildFtsTokens(
              `${primary.subjectKey} ${primary.statement}`,
            ),
            beliefStatus: primary.beliefStatus,
            authorityTier: nextAuth,
            history: primary.history,
            supportingFactIds: Array.from(
              new Set([...primary.supportingFactIds, fact.id]),
            ),
            contradictingFactIds: primary.contradictingFactIds,
            entityIds: Array.from(
              new Set([...primary.entityIds, ...fact.entityIds]),
            ),
            pathAnchors: Array.from(
              new Set([...primary.pathAnchors, ...fact.pathAnchors]),
            ),
            stabilityHours: nextStability,
          });
          this.store.memory.markFactConsolidated(fact.id);
          corroboratedObservations += 1;
          continue;
        }

        // Stage A: Single-valued functional slot temporal supersession
        if (
          isFunctionalSubject(fact.subjectKey) &&
          AUTHORITY_RANK[fact.authorityTier] >=
            AUTHORITY_RANK[primary.authorityTier]
        ) {
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
          supersededObservations += 1;
          continue;
        }

        // Multi-valued or lower-authority differing claim -> keep distinct observation
        const distinctObs = this.store.memory.upsertObservation({
          hubId,
          repoId: fact.repoId,
          executionMode,
          subjectKey: `${fact.subjectKey}#${fact.id.slice(-6)}`,
          title: this.deriveObservationTitle(fact),
          statement: fact.claim,
          ftsTokens: buildFtsTokens(`${fact.subjectKey} ${fact.claim}`),
          beliefStatus:
            isFunctionalSubject(fact.subjectKey) &&
            AUTHORITY_RANK[fact.authorityTier] <
              AUTHORITY_RANK[primary.authorityTier]
              ? 'contested'
              : 'active',
          authorityTier: fact.authorityTier,
          history: [],
          supportingFactIds: [fact.id],
          contradictingFactIds: isFunctionalSubject(fact.subjectKey)
            ? primary.supportingFactIds
            : [],
          entityIds: fact.entityIds,
          pathAnchors: fact.pathAnchors,
          stabilityHours: fact.stabilityHours,
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
        createdObservations += 1;
      }

      if (supersededObservations > 0 || createdObservations > 0) {
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
    });

    this.invalidateVectorCache(hubId, executionMode);
    const refreshedDocs = this.refreshStaleLivingDocs(hubId, executionMode);

    return {
      processedFacts: facts.length,
      supersededObservations,
      createdObservations,
      corroboratedObservations,
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
      if (hit.targetKind === 'observation') {
        citedObservationIds.add(hit.targetId);
      } else if (hit.targetKind === 'chunk') {
        citedChunkIds.add(hit.targetId);
      }
      if (hit.rejectedWarning) {
        contradictions.push(`[${hit.rejectedWarning}] ${hit.content}`);
      } else if (
        hit.authorityTier === 'L3_locked' ||
        hit.authorityTier === 'L2_verified'
      ) {
        confirmedFacts.push(`[${hit.authorityTier}] ${hit.content}`);
      } else {
        inferences.push(`[${hit.authorityTier}] ${hit.content}`);
      }
    }

    for (const obs of observations) {
      if (obs.beliefStatus === 'contested' || obs.staleSuspect) {
        contradictions.push(
          `[${obs.beliefStatus}${obs.staleSuspect ? '/stale' : ''}] ${obs.title}: ${obs.statement}`,
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
      this.store.memory.upsertLivingDoc({
        hubId,
        repoId: doc.repoId,
        executionMode,
        docKind: doc.docKind,
        slug: doc.slug,
        title: doc.title,
        standingQuestion: doc.standingQuestion,
        scopeEntities: doc.scopeEntities,
        contentMarkdown: reflection.answerMarkdown,
        citedObservationIds: reflection.citedObservationIds,
        stale: false,
      });
      refreshed += 1;
    }
    return refreshed;
  }

  ensureDefaultLivingDoc(input: {
    readonly hubId: string;
    readonly repoId?: string | null;
    readonly executionMode: ExecutionMode;
    readonly docKind: LivingDocKind;
    readonly slug: string;
    readonly title: string;
    readonly standingQuestion: string;
    readonly initialMarkdown: string;
  }): void {
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
  }

  detectGitDrift(
    hubId: string,
    executionMode: ExecutionMode,
    changeId: string,
    changedFiles: readonly string[],
  ): number {
    if (changedFiles.length === 0) {
      return 0;
    }
    const watermarkKey = `memory_drift_done:${changeId}`;
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
        this.store.memory.markLivingDocsStale(hubId, executionMode);
      }
      this.store.setMeta(watermarkKey, true);
    });
    return marked;
  }

  buildAllCapsules(nowMs = Date.now()): RehydrationCapsule[] {
    const hubs = this.store.listHubs(false);
    const openAttention = this.store.listAttentionItems(false);

    return hubs.map(hub => {
      const anchorMs = Date.parse(hub.lastHumanInteractionAt);
      const changes = this.store.listChanges(hub.id, false);
      const audits = this.store.listAuditLedger(50, hub.id);
      const diffTotals = this.store.getTotalChangeLinesForHub(hub.id);

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
        'live',
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

import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {
  detectTerminologyDrift,
  renderUbiquitousLanguageSection,
  selectTermsForRepo,
} from '../core/ddd.ts';
import {isFileInsideScope} from '../core/glob-scope.ts';
import {
  SchemaError,
  dslArray,
  dslBoolean,
  dslNumber,
  dslObject,
  dslString,
  extractJsonPayload,
} from '../core/schema-dsl.ts';
import type {IAgentAdapterHub} from '../adapters/contracts.ts';
import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import type {ForgeErrorCode} from '../shared/errors.ts';
import type {ChangeRecord, GraphNode} from '../shared/types.ts';
import {parseFailClosedAuditJson} from '../shared/validation.ts';
import type {ForgeStore} from '../store/database.ts';

export interface CertificationVerdict {
  readonly certified: boolean;
  readonly score: number;
  readonly reasonCode: ForgeErrorCode | 'OK';
  readonly summary: string;
  readonly diagnostics: readonly string[];
}

const criteriaResultSchema = dslObject({
  criterionId: dslString(80, 1),
  passed: dslBoolean,
  evidence: dslString(500, 1),
});

const auditVerdictSchema = dslObject({
  certified: dslBoolean,
  score: dslNumber(0, 1),
  summary: dslString(1000, 1),
  dddDriftTerms: dslArray(dslString(200, 1), 0, 24),
  criteriaResults: dslArray(criteriaResultSchema, 0, 32),
  diagnostics: dslArray(dslString(400, 1), 0, 24),
});

function sliceDiffPrioritized(
  patch: string,
  fileScope: readonly string[],
  maxBytes = 32_768,
): string {
  if (!patch || patch.length <= maxBytes) {
    return patch;
  }
  const sections = patch.split(/(?=^diff --git )/m).filter(Boolean);
  if (sections.length <= 1) {
    return `${patch.slice(0, maxBytes - 48)}\n... [TRUNCATED BY 32KB DIFF SLICER] ...`;
  }

  const prioritized: string[] = [];
  const secondary: string[] = [];
  for (const sec of sections) {
    const headerMatch = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(sec);
    const filePath = headerMatch?.[2] ?? headerMatch?.[1] ?? '';
    if (
      fileScope.length > 0 &&
      filePath &&
      isFileInsideScope(filePath, fileScope)
    ) {
      prioritized.push(sec);
    } else {
      secondary.push(sec);
    }
  }

  let used = 0;
  const out: string[] = [];
  for (const sec of [...prioritized, ...secondary]) {
    const remaining = maxBytes - used;
    if (remaining <= 160) {
      out.push('\n... [REMAINING DIFF SECTIONS OMITTED AT 32KB BUDGET] ...');
      break;
    }
    if (sec.length <= remaining) {
      out.push(sec);
      used += sec.length;
    } else {
      const cap = Math.max(120, remaining - 64);
      out.push(`${sec.slice(0, cap)}\n... [FILE DIFF TRUNCATED] ...\n`);
      used += cap + 36;
    }
  }
  return out.join('');
}

export class CompletionCertifier {
  private readonly store: ForgeStore;
  private readonly runner: ISandboxProcessRunner;
  private readonly worktrees: IGitWorktreeManager;
  private readonly adapters: IAgentAdapterHub;

  constructor(
    store: ForgeStore,
    runner: ISandboxProcessRunner,
    worktrees: IGitWorktreeManager,
    adapters: IAgentAdapterHub,
  ) {
    this.store = store;
    this.runner = runner;
    this.worktrees = worktrees;
    this.adapters = adapters;
  }

  async certifyNode(
    change: ChangeRecord,
    node: GraphNode,
    sinceCommitSha?: string,
    signal?: AbortSignal,
  ): Promise<CertificationVerdict> {
    const baselineSha = sinceCommitSha || change.baseCommitSha;
    switch (node.kind) {
      case 'verify':
        return this.certifySpecIntegrity(change);
      case 'gates':
        return this.certifyHardGates(change, node, baselineSha, signal);
      case 'selfcheck':
        return this.certifySelfCheck(change, node, baselineSha);
      case 'audit_jqa':
        return this.certifyAudit(change, node, 'junior', baselineSha, signal);
      case 'audit_sqa':
        return this.certifyAudit(change, node, 'senior', baselineSha, signal);
      default:
        return {
          certified: true,
          score: 1,
          reasonCode: 'OK',
          summary: `Structural node ${node.code} verified.`,
          diagnostics: [],
        };
    }
  }

  private certifySpecIntegrity(change: ChangeRecord): CertificationVerdict {
    if (change.specMarkdown.trim().length < 40) {
      return {
        certified: false,
        score: 0.2,
        reasonCode: 'VALIDATION_ERROR',
        summary: 'Specification markdown is incomplete (< 40 chars).',
        diagnostics: ['Populate engineering specification before execution.'],
      };
    }
    const repo = this.store.getRepository(change.repoId);
    const terms = selectTermsForRepo(
      this.store.listDomainTerms(change.hubId),
      change.repoId,
      repo?.boundedContext,
    );
    const drift = detectTerminologyDrift(change.specMarkdown, terms);
    if (drift.length > 0) {
      return {
        certified: false,
        score: 0.3,
        reasonCode: 'DDD_DRIFT_DETECTED',
        summary: `Specification contains ${drift.length} forbidden DDD synonym(s).`,
        diagnostics: drift.map(
          d =>
            `Line ${d.lineNumber}: forbidden "${d.forbiddenAlias}" -> use canonical "${d.canonicalTerm}" (${d.boundedContext})`,
        ),
      };
    }
    return {
      certified: true,
      score: 0.95,
      reasonCode: 'OK',
      summary: `Spec & ${terms.length} DDD domain term(s) verified clean.`,
      diagnostics: [],
    };
  }

  private async certifyHardGates(
    change: ChangeRecord,
    node: GraphNode,
    baselineSha: string,
    signal?: AbortSignal,
  ): Promise<CertificationVerdict> {
    const cmd = (node.gateCommand ?? change.verifyCommand).trim();
    const blocked = this.store.getConstitution().blockedCommands;

    if (cmd.length > 0) {
      const res = await this.runner.runCommandString(
        cmd,
        change.worktreePath,
        180_000,
        blocked,
        signal,
      );
      if (res.exitCode !== 0 || res.timedOut) {
        const tail = `${res.stdout}\n${res.stderr}`.trim().slice(-1200);
        return {
          certified: false,
          score: 0,
          reasonCode: 'GATE_FAILED',
          summary: res.timedOut
            ? `Hard Gate command timed out: ${cmd}`
            : `Hard Gate exited with code ${res.exitCode}: ${cmd}`,
          diagnostics: [tail || 'Command failed with non-zero exit status.'],
        };
      }
    }

    const repo = this.store.getRepository(change.repoId);
    const terms = selectTermsForRepo(
      this.store.listDomainTerms(change.hubId),
      change.repoId,
      repo?.boundedContext,
    );
    const diff = await this.worktrees.diffSinceCommit(
      change.worktreePath,
      baselineSha,
    );
    const drift = detectTerminologyDrift(diff.patch, terms);
    if (drift.length > 0) {
      return {
        certified: false,
        score: 0.25,
        reasonCode: 'DDD_DRIFT_DETECTED',
        summary: `DDD Terminology Drift Gate blocked ${drift.length} prohibited alias(es) in worktree diff.`,
        diagnostics: drift.map(
          d =>
            `Diff line ${d.lineNumber}: prohibited alias "${d.forbiddenAlias}" -> replace with "${d.canonicalTerm}" (${d.lineExcerpt})`,
        ),
      };
    }

    return {
      certified: true,
      score: 1,
      reasonCode: 'OK',
      summary: `Hard Gates (${cmd || 'ddd-check'}) & DDD Terminology Gate passed.`,
      diagnostics: [],
    };
  }

  private async certifySelfCheck(
    change: ChangeRecord,
    node: GraphNode,
    baselineSha: string,
  ): Promise<CertificationVerdict> {
    if (!existsSync(change.worktreePath)) {
      return {
        certified: false,
        score: 0,
        reasonCode: 'CONFLICT',
        summary: `Worktree missing on disk: ${change.worktreePath}`,
        diagnostics: ['Isolated git worktree path does not exist.'],
      };
    }
    const diff = await this.worktrees.diffSinceCommit(
      change.worktreePath,
      baselineSha,
    );
    if (node.fileScope.length > 0 && diff.changedFiles.length > 0) {
      const outOfScope = diff.changedFiles.filter(
        file =>
          !file.startsWith('.forgeops/') &&
          !isFileInsideScope(file, node.fileScope),
      );
      if (outOfScope.length > 0) {
        return {
          certified: false,
          score: 0.4,
          reasonCode: 'GATE_FAILED',
          summary: `Modified ${outOfScope.length} file(s) outside declared fileScope.`,
          diagnostics: outOfScope.map(f => `Out-of-scope file: ${f}`),
        };
      }
    }
    return {
      certified: true,
      score: 0.94,
      reasonCode: 'OK',
      summary: `Pre-QA Selfcheck verified (${diff.changedFiles.length} changed file(s) in isolated worktree).`,
      diagnostics: [],
    };
  }

  private async certifyAudit(
    change: ChangeRecord,
    node: GraphNode,
    level: 'junior' | 'senior',
    baselineSha: string,
    signal?: AbortSignal,
  ): Promise<CertificationVerdict> {
    const executionMode = change.executionMode ?? 'live';
    const repo = this.store.getRepository(change.repoId);
    const terms = selectTermsForRepo(
      this.store.listDomainTerms(change.hubId),
      change.repoId,
      repo?.boundedContext,
    );
    const diff = await this.worktrees.diffSinceCommit(
      change.worktreePath,
      baselineSha,
    );

    const adapterProfile = this.store
      .listAdapterProfiles()
      .find(
        p =>
          p.manifest.id ===
          (node.assignedAdapterId ?? change.team.leadAdapterId),
      );
    const model =
      level === 'junior'
        ? change.team.juniorAuditModel
        : change.team.seniorAuditModel;

    if (
      executionMode === 'live' &&
      adapterProfile &&
      adapterProfile.health !== 'circuit_open'
    ) {
      const sess = this.store.startSession({
        hubId: change.hubId,
        changeId: change.id,
        nodeId: node.id,
        adapterId: adapterProfile.manifest.id,
        model,
        role: 'evaluator',
      });

      const nonce = randomBytes(6).toString('hex');
      const slicedPatch = sliceDiffPrioritized(
        diff.patch,
        node.fileScope,
        32_768,
      );
      const systemPrompt = [
        this.store.getConstitution().markdown,
        `You are an independent ${level.toUpperCase()} QA Auditor. You NEVER wrote this code. Audit strictly in read-only mode.`,
        renderUbiquitousLanguageSection(terms),
        `Return strict JSON ONLY matching schema: ${JSON.stringify(auditVerdictSchema.json)}`,
      ].join('\n\n');

      const userPrompt = [
        `Audit Change ${change.code}: ${change.title}`,
        `Target Scope: ${node.fileScope.join(', ') || '*'}`,
        `Acceptance Criteria:\n${change.acceptanceCriteria.map(c => `- [${c.id}] ${c.statement}`).join('\n')}`,
        `Diff Summary:\n${diff.summary || '(clean baseline)'}`,
        `<untrusted_diff nonce="${nonce}">\n${slicedPatch}\n</untrusted_diff>`,
      ].join('\n\n');

      this.store.appendTranscriptMessage({
        sessionId: sess.id,
        role: 'user',
        content: userPrompt,
      });

      const inv = await this.adapters.invoke({
        sessionId: sess.id,
        hubId: change.hubId,
        changeId: change.id,
        nodeId: node.id,
        role: 'evaluator',
        adapter: adapterProfile.manifest,
        model,
        permissionTier: change.permissionTier,
        cwd: change.worktreePath,
        systemPrompt,
        userPrompt,
        readOnly: true,
        textOnly: true,
        maxOutputTokens: 1500,
        cacheStablePrefix: true,
        timeoutMs: 60_000,
        signal,
      });

      if (inv.costUsd > 0) {
        this.store.addChangeCostAtomic(change.id, inv.costUsd);
        if (change.missionId) {
          this.store.missions.addMissionCostAtomic(
            change.missionId,
            inv.costUsd,
          );
        }
      }

      this.store.appendTranscriptMessage({
        sessionId: sess.id,
        role: 'assistant',
        content: inv.finalText || inv.diagnostic,
        isError: inv.outcome !== 'completed',
        inputTokens: inv.inputTokens,
        cachedTokens: inv.cachedTokens,
        outputTokens: inv.outputTokens,
      });
      this.store.finishSession(
        sess.id,
        inv.outcome === 'completed' ? 'completed' : 'failed',
      );

      if (inv.outcome === 'completed') {
        try {
          const parsed = extractJsonPayload(inv.finalText, auditVerdictSchema);
          const allCriteriaPassed = parsed.criteriaResults.every(c => c.passed);
          const certified = parsed.certified && allCriteriaPassed;
          return {
            certified,
            score: parsed.score,
            reasonCode:
              parsed.dddDriftTerms.length > 0
                ? 'DDD_DRIFT_DETECTED'
                : certified
                  ? 'OK'
                  : 'GATE_FAILED',
            summary: parsed.summary,
            diagnostics: [
              ...parsed.diagnostics,
              ...parsed.dddDriftTerms,
              ...parsed.criteriaResults
                .filter(c => !c.passed)
                .map(c => `[${c.criterionId}] ${c.evidence}`),
            ],
          };
        } catch (err) {
          const legacy = parseFailClosedAuditJson(inv.finalText);
          if (legacy.passed && err instanceof SchemaError) {
            return {
              certified: legacy.passed,
              score: legacy.score,
              reasonCode:
                legacy.dddViolations.length > 0
                  ? 'DDD_DRIFT_DETECTED'
                  : legacy.passed
                    ? 'OK'
                    : 'GATE_FAILED',
              summary: `${level.toUpperCase()} QA Audit certified (score ${(legacy.score * 100).toFixed(0)}%).`,
              diagnostics: [...legacy.findings, ...legacy.dddViolations],
            };
          }
          const msg = err instanceof Error ? err.message : String(err);
          return {
            certified: false,
            score: 0,
            reasonCode: 'GATE_FAILED',
            summary: `${level.toUpperCase()} QA Audit failed closed: ${msg}`,
            diagnostics: [...legacy.findings, msg],
          };
        }
      }

      return {
        certified: false,
        score: 0,
        reasonCode: 'ADAPTER_UNAVAILABLE',
        summary: `${level.toUpperCase()} QA Audit could not run (${inv.outcome}): ${inv.diagnostic}`,
        diagnostics: [inv.diagnostic || 'Audit adapter unavailable'],
      };
    }

    if (executionMode === 'live') {
      return {
        certified: false,
        score: 0,
        reasonCode: 'ADAPTER_UNAVAILABLE',
        summary: `${level.toUpperCase()} QA Audit halted fail-closed: evaluator adapter unavailable or circuit open.`,
        diagnostics: [
          'Configure a healthy evaluator provider or switch explicitly to simulation mode.',
        ],
      };
    }

    const drift = detectTerminologyDrift(diff.patch, terms);
    if (drift.length > 0) {
      return {
        certified: false,
        score: 0.2,
        reasonCode: 'DDD_DRIFT_DETECTED',
        summary: `${level.toUpperCase()} Deterministic Audit rejected DDD synonym drift.`,
        diagnostics: drift.map(
          d =>
            `Line ${d.lineNumber}: "${d.forbiddenAlias}" violates canonical "${d.canonicalTerm}"`,
        ),
      };
    }
    if (/FIXME_BLOCKER|AUDIT_FAIL_MARKER/.test(diff.patch)) {
      return {
        certified: false,
        score: 0.1,
        reasonCode: 'GATE_FAILED',
        summary: `${level.toUpperCase()} Deterministic Audit detected explicit blocker marker in patch.`,
        diagnostics: [
          'Remove blocker markers and satisfy acceptance invariants.',
        ],
      };
    }

    const score = level === 'junior' ? 0.91 : 0.93;
    return {
      certified: true,
      score,
      reasonCode: 'OK',
      summary: `${level.toUpperCase()} Structural & DDD Invariant Audit certified (${(score * 100).toFixed(0)}%).`,
      diagnostics: [],
    };
  }
}

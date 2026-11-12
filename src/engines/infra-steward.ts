/**
 * Infra Steward Agent & Control Plane Engine:
 * - Environment Doctor (`Neural Link` readiness probe + orphan worktree cleanup)
 * - Post-Change `Retro` optimizer (prunes `agent-wiki` summaries for zero-explorer
 *   ticket startup & distills reusable `SkillsBank` entries)
 * - Governed `INFRA` repository self-evolution under dual-level QA review
 */

import type {IAgentAdapterHub} from '../adapters/contracts.ts';
import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import type {
  AdapterOperationalProfile,
  AuditLedgerEntry,
  ChangeRecord,
  PermissionTier,
  SkillEntry,
} from '../shared/types.ts';
import type {ForgeStore} from '../store/database.ts';
import type {RequirementClosureEngine} from './requirement-closure.ts';

export interface EnvironmentDoctorReport {
  readonly gitReady: boolean;
  readonly gitVersion: string;
  readonly nodeVersion: string;
  readonly adapters: readonly AdapterOperationalProfile[];
  readonly prunedWorktreeEntries: readonly string[];
  readonly checkedAt: string;
}

export interface RetroOptimizationResult {
  readonly hubId: string;
  readonly changeId: string;
  readonly updatedWikiSummary: string;
  readonly updatedSkill: SkillEntry | null;
  readonly auditEntry: AuditLedgerEntry;
}

export class InfraStewardEngine {
  private readonly store: ForgeStore;
  private readonly runner: ISandboxProcessRunner;
  private readonly worktrees: IGitWorktreeManager;
  private readonly adapters: IAgentAdapterHub;
  private readonly closure: RequirementClosureEngine;

  constructor(
    store: ForgeStore,
    runner: ISandboxProcessRunner,
    worktrees: IGitWorktreeManager,
    adapters: IAgentAdapterHub,
    closure: RequirementClosureEngine,
  ) {
    this.store = store;
    this.runner = runner;
    this.worktrees = worktrees;
    this.adapters = adapters;
    this.closure = closure;
  }

  /**
   * Probes toolchain (`git`, `node`), all registered Agent Adapter harnesses,
   * and prunes orphan git worktree metadata across registered repositories.
   */
  async runEnvironmentDoctor(): Promise<EnvironmentDoctorReport> {
    this.store.updateDaemon('infra_patrol', {runningPass: true});
    try {
      let gitReady = false;
      let gitVersion = 'unavailable';
      const gitBin = this.runner.resolveExecutable('git');
      if (gitBin) {
        const res = await this.runner.run({
          executable: gitBin,
          args: ['--version'],
          cwd: process.cwd(),
          timeoutMs: 10_000,
        });
        gitReady = res.exitCode === 0;
        gitVersion = res.stdout.trim() || res.stderr.trim() || 'git detected';
      }

      const adapters = await this.adapters.probeAllAdapters();

      const pruned: string[] = [];
      for (const repo of this.store.listRepositories()) {
        try {
          const items = await this.worktrees.cleanupOrphanWorktrees(
            repo.localPath,
          );
          pruned.push(...items);
        } catch {
          // Ignore non-existent external paths during patrol.
        }
      }

      const checkedAt = new Date().toISOString();
      const healthyCount = adapters.filter(a => a.health === 'healthy').length;
      this.store.updateDaemon('infra_patrol', {
        runningPass: false,
        lastRunAt: checkedAt,
        lastSummary: `Git=${gitReady ? 'OK' : 'MISSING'} | ${healthyCount}/${adapters.length} adapters healthy | ${pruned.length} stale worktrees pruned`,
      });

      return {
        gitReady,
        gitVersion,
        nodeVersion: process.version,
        adapters,
        prunedWorktreeEntries: pruned,
        checkedAt,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.updateDaemon('infra_patrol', {
        runningPass: false,
        lastRunAt: new Date().toISOString(),
        lastSummary: `Doctor error: ${msg}`,
      });
      throw err;
    }
  }

  /**
   * Post-Change `Retro` pass:
   * Compresses newly certified repository contracts & DDD terms into a terse,
   * agent-optimized `agentWikiSummary` on the Federation Hub so future tickets
   * start with zero blind repository exploration.
   */
  runRetroOptimization(changeId: string): RetroOptimizationResult | null {
    const change = this.store.getChange(changeId);
    if (!change) {
      return null;
    }
    const hub = this.store.getHub(change.hubId);
    const repo = this.store.getRepository(change.repoId);
    if (!hub || !repo) {
      return null;
    }

    const allRepos = this.store.listRepositories(hub.id);
    const terms = this.store.listDomainTerms(hub.id);
    const certifiedChanges = this.store
      .listChanges(hub.id, true)
      .filter(c => c.status === 'certified')
      .slice(0, 6);

    const compressedWiki = [
      `# ${hub.name} — Agent-First Topology Map (Retro-Optimized)`,
      `Mission: ${hub.description}`,
      '',
      '## Service & Infra Topology (Read First — Skip Blind File Exploration)',
      ...allRepos.map(
        r =>
          `- [${r.tier.toUpperCase()}] \`${r.name}\` (Context: \`${r.boundedContext}\`, Verify: \`${r.verifyCommand}\`): ${r.contractSummary}`,
      ),
      '',
      '## Canonical Ubiquitous Language Anchors',
      ...(terms.length > 0
        ? terms.map(
            t =>
              `- \`${t.canonicalTerm}\` (${t.boundedContext}): ${t.definition} [Avoid: ${t.forbiddenAliases.join(', ') || 'none'}]`,
          )
        : ['- Register domain terms in DDD Studio to lock cross-repo naming.']),
      '',
      '## Recent Certified Deltas',
      ...certifiedChanges.map(
        c => `- ${c.code} (${c.title}): verified on branch \`${c.gitBranch}\``,
      ),
    ].join('\n');

    this.store.updateHubWiki(hub.id, compressedWiki);

    // Record reusable architectural memory from this certified change.
    this.store.recordSemanticMemory({
      hubId: hub.id,
      repoId: repo.id,
      kind: 'architecture',
      title: `${change.code} Certified Contract (${repo.name})`,
      summary: `Completed "${change.title}" in bounded context ${repo.boundedContext}. Verify gate: ${change.verifyCommand}.`,
      pathAnchors: [repo.name],
      stabilityHours: 72,
    });

    const existingRetro = this.store
      .listSkills()
      .find(s => s.slug === 'retro-wiki-pruner');
    const nextPatchVersion = existingRetro
      ? bumpPatchVersion(existingRetro.version)
      : '1.0.1';
    const updatedSkill = this.store.upsertSkill({
      slug: 'retro-wiki-pruner',
      title: 'Retro Agent-Wiki Optimizer',
      category: 'retro',
      version: nextPatchVersion,
      promptBody:
        existingRetro?.promptBody ??
        'Compress Hub topology and DDD boundaries for instant agent orientation.',
      updatedBy: 'infra_steward',
    });

    const auditEntry = this.store.appendAudit({
      hubId: hub.id,
      changeId: change.id,
      category: 'infra_evolution',
      actor: 'infra_steward',
      title: `Retro pruned Hub Agent-Wiki after ${change.code}`,
      detail: `Compressed ${allRepos.length} repo contracts & ${terms.length} DDD terms; bumped retro-wiki-pruner to v${nextPatchVersion}.`,
    });

    return {
      hubId: hub.id,
      changeId: change.id,
      updatedWikiSummary: compressedWiki,
      updatedSkill,
      auditEntry,
    };
  }

  /**
   * Governed `INFRA` evolution: spawns a tracked Twin-Graph Change specifically
   * targeting an `infra`-tier repository so harness/skill/pipeline upgrades go
   * through worktree isolation, hard gates, and dual QA audit before promotion.
   */
  async proposeInfraEvolution(input: {
    readonly hubId: string;
    readonly infraRepoId: string;
    readonly title: string;
    readonly rationale: string;
    readonly permissionTier: PermissionTier;
    readonly worktreesRoot: string;
  }): Promise<ChangeRecord> {
    const chg = await this.closure.createAndPlanChange({
      hubId: input.hubId,
      repoId: input.infraRepoId,
      title: `[INFRA] ${input.title}`,
      summary: input.rationale,
      permissionTier: input.permissionTier,
      worktreesRoot: input.worktreesRoot,
    });
    this.store.appendAudit({
      hubId: input.hubId,
      changeId: chg.id,
      category: 'infra_evolution',
      actor: 'infra_steward',
      title: `Initiated governed INFRA Change ${chg.code}`,
      detail: input.rationale,
    });
    return chg;
  }
}

function bumpPatchVersion(ver: string): string {
  const parts = ver.split('.').map(n => Number.parseInt(n, 10));
  if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
    return `${parts[0]}.${parts[1]}.${(parts[2] ?? 0) + 1}`;
  }
  return '1.0.1';
}

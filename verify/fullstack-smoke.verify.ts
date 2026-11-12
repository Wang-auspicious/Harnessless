/**
 * Verification Gate 3: Full-Stack `ForgeRuntime` Lifecycle, Loopback Bearer
 * Auth, End-to-End Twin-Graph Execution -> Git Checkpoints -> Retro Pruning,
 * Scoped Change Archiving, and Sleep Consolidation.
 */

import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import type {BootstrapSnapshot} from '../src/shared/api.ts';
import {ForgeRuntime} from '../src/server/runtime.ts';

describe('Full-Stack ForgeRuntime Control Plane & Twin-Graph E2E', () => {
  it('enforces Bearer auth, executes a Change through all QA checkpoints to G3-CERTIFIED, and preserves Hub on Archive', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'forgeops-verify-e2e-'));
    const runtime = new ForgeRuntime({dataDir, seedDemoOnEmpty: true});

    try {
      await runtime.start();
      const base = runtime.httpServer.apiBaseUrl;
      const token = runtime.httpServer.sessionToken;

      // 1. Unauthenticated HTTP call must be rejected with 401
      const unauth = await fetch(`${base}/api/bootstrap`);
      assert.equal(unauth.status, 401);

      // 2. Authenticated bootstrap returns seeded multi-repo Federation Hub + DDD terms
      const bootRes = await fetch(`${base}/api/bootstrap`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      assert.equal(bootRes.status, 200);
      const boot = (await bootRes.json()) as BootstrapSnapshot;
      assert.equal(boot.hubs.length, 1);
      assert.equal(boot.repositories.length, 3);
      assert.equal(boot.domainTerms.length, 2);
      assert.equal(boot.changes.length, 1);

      const seededChange = boot.changes[0]!;
      assert.equal(seededChange.code, 'CHG-001');

      // 3. Run full Twin-Graph execution loop to G3-CERTIFIED
      const certified = await runtime.continuity.startChangeExecution(
        seededChange.id,
      );
      assert.equal(certified.status, 'certified');
      assert.ok(certified.acceptanceCriteria.every(ac => ac.certified));

      // Verify physical Git checkpoints (CP-0, CP-1, CP-2) were committed & tagged
      const checkpoints = runtime.store.listCheckpoints(seededChange.id);
      assert.equal(checkpoints.length, 3);
      assert.ok(checkpoints.every(cp => cp.gitCommitSha.length === 40));

      // Verify Retro skill compressed Hub agentWikiSummary
      const refreshedHub = runtime.store.getHub(boot.hubs[0]!.id)!;
      assert.match(refreshedHub.agentWikiSummary, /SettlementVoucher/);

      // 4. Run Environment Doctor & Sleep-Time Dream Consolidation
      const doctor = await runtime.steward.runEnvironmentDoctor();
      assert.equal(doctor.gitReady, true);
      const dream = await runtime.dreaming.runSleepConsolidation();
      assert.equal(dream.capsulesRefreshed, 1);

      // 5. Scoped Archive: archiving CHG-001 hides ONLY CHG-001 and NEVER archives Hub or Repo!
      const archRes = await fetch(
        `${base}/api/changes/${seededChange.id}/archive`,
        {
          method: 'POST',
          headers: {Authorization: `Bearer ${token}`},
        },
      );
      assert.equal(archRes.status, 200);
      assert.equal(runtime.store.listHubs(false).length, 1);
      assert.equal(runtime.store.listRepositories().length, 3);
      assert.equal(runtime.store.listChanges(undefined, false).length, 0);
    } finally {
      await runtime.stop();
      rmSync(dataDir, {recursive: true, force: true});
    }
  });
});

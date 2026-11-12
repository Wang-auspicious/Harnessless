# ASF v2 — Engineering Change & Decision Log

All architectural shifts, audit findings, scope refinements, and runtime adjustments are recorded here in chronological order.

---

## [2026-11-11] Entry 002 — SOTA Kernel Synthesis, Workspace Isolation & Master Spec v2.0

### Context
Following user review of the initial audit and architectural options, six core architectural decisions were locked in and expanded with four SOTA research pillars:
1. **Attention Compression (`dsh-superagent-prototype`):** Minimize human supervision fatigue; surface only what requires human action.
2. **8-Hour Marathon Continuity (`deepseek-harness` + Ralph-Loop + `obelisk`):** Eliminate the 3–4 hour premature-stop failure mode via external `CompletionCertifier`, fresh-context task slices, 4-section epistemic rollover, and rate-limit `CooldownHolding`.
3. **Dual Cognitive Memory (`obelisk` + `Graphiti` + `MemoryBank` + `Letta` Sleep-Time Compute):** Couple Human Ebbinghaus Retention ($R_{\text{human}}$ across 3+ concurrent projects) with Agent 4-tier FTS5/Temporal Memory ($R_{\text{agent}}$ + `DreamingDaemon`).
4. **Embedded `FrontierHarness` Bench & Adaptive Coordinator:** Track `pass_rate`, `effective_cost_per_pass`, `cache_hit_rate_normalized`, and `premature_stop_rate` across universal adapters (`ACP`, `CLI Stream`, `Native API`) to dynamically tune `Strong-Commands-Weak` routing.

### Concrete Actions Taken
- Verified empirically that Electron 44 bundles Node `24.22.2` with built-in `node:sqlite` (`DatabaseSync`) and `FTS5` enabled (`FTS5_OK`), eliminating native C++ addon rebuild fragility on Windows.
- Isolated reference materials (`参考/`, PDF/MD specs, screenshots), cloned reference repositories (`dsh-superagent-prototype`, `deepseek-harness`, `obelisk`, `frontier-harness-eval`), and the legacy v1 prototype (`se-factory/`) inside `.isolated/` (gitignored).
- Initialized clean root Git repository on branch `main` at `d:/Desktop/Courses_27/SE/Software-factory`.
- Established strict **No Test Bloat Policy** (`verify/` capped at `< 12%` LoC; zero TDD mock sprawl; focus on real E2E & invariant gates).
- Authored [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md), [DEV-PIPELINE.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/DEV-PIPELINE.md), and [CHECKLIST.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHECKLIST.md).

---

## [2026-11-11] Entry 001 — Full Audit of Legacy v1 Prototype (`se-factory`)

### Summary of Defects Identified (Archiving v1 -> Clean v2 Rebuild)
1. **Vacuous Quality Gates:** `WorkflowEngine` gate runner existed, but `FactoryService` never wired `options.checks`, causing every Gate node to return vacuous `'pass'`.
2. **Disconnected UI Configuration:** `AgentsMarket`, `Change.team`, `settings.activeModel`, and `seniorQaModel` were ignored at runtime (`runLlmNode` hardcoded `settings.models[0]`).
3. **Broken Cross-Stage Context:** `resolveInput` only inspected immediate `logic` predecessors, which were empty `checkpoint` nodes—blinding downstream stages to upstream deliverables.
4. **Fail-Open Audit Parsing:** Unparseable LLM JSON defaulted to `'pass'`.
5. **Broken Gate Rejection:** `G1/G2/G3` checkpoints lacked `fail -> restore` edges; rejecting a gate terminated the workflow instead of looping back.
6. **Linear Array Rewind Bug:** `rangeBetween` reset parallel unrelated DAG branches based on topological array slice indices rather than graph reachability.
7. **Hollow Checkpoints:** Checkpoints stored JSON snapshots without binding to physical `git worktree` commits/tags.
8. **Synchronous Blocking HTTP API & UI Freeze:** `POST .../runs` held a single HTTP request open across multi-stage LLM execution without SSE streaming.
9. **Destructive Archive Bug:** `"Archive change"` archived the entire parent Project (`archived: true`), hiding all sibling Changes.
10. **Security & Subprocess Flaws:** Unauthenticated `127.0.0.1:43110` returned plaintext API keys on `GET /api/state`; `CliAgentAdapter` used `shell: true`, leaked full `process.env`, and lacked Windows process-tree cleanup.

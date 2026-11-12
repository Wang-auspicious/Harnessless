# ASF v2 — Engineering Milestone & Gate Checklist

> Updated continuously after every milestone and architectural decision.

## Phase 0: Audit, SOTA Kernel Research & Master Specification
- [x] **0.1** Audit legacy prototype (`.isolated/legacy-se-factory`) and catalog all 16 architectural/security/correctness defects
- [x] **0.2** Inspect reusable building blocks in `D:/Desktop/Courses_27/SE/H2` (`claude-code`, `codex`, `opencode`, `pi`, `mcp-station`, `code-workspace`, `collaboration`)
- [x] **0.3** Study classroom reference photos of Professor's **ASF Console**, **HAMA-Loop** PDF, Workflow V2 doc, and **Raft/Slock** UI
- [x] **0.4** Clone & analyze SOTA kernels in `.isolated/references/`:
  - [x] `deepseek-ai/dsh-superagent-prototype` (Attention conservation, `Trigger -> Eval -> Ticket -> Mandate`, `off/observe/auto`, reserved human concurrency slot, `Effects` outbox)
  - [x] `deepseek-ai/deepseek-harness` (`goal-round-driver` premature-stop root causes, `subagent-acp` JSON-RPC 2.0 wire lifecycle, compiler face rules)
  - [x] `tommy0103/obelisk` (`node:sqlite` + FTS5 unified transcript evidence store, 4-section epistemic context rollover)
  - [x] `frontier-harness-eval/eval` (`pass_rate`, `effective_cost_per_pass`, `cache_hit_rate_normalized`, `infra_invalid` separation)
  - [x] 2026 Multi-Agent Memory & Cognitive Science (`Letta` Sleep-Time Compute, `Graphiti` bi-temporal validity, `MemoryBank` Ebbinghaus retention & spaced repetition)
- [x] **0.5** Verify Electron 44 runtime embeds Node `24.22.2` with native `node:sqlite` + `FTS5_OK`
- [x] **0.6** Clean global root `d:/Desktop/Courses_27/SE/Software-factory`, isolate references into `.isolated/`, initialize root Git repository
- [x] **0.7** Author [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md), [DEV-PIPELINE.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/DEV-PIPELINE.md), [CHECKLIST.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHECKLIST.md), and [CHANGELOG.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHANGELOG.md)
- [ ] **0.8** User alignment & sign-off on `SPEC.md` v2.0 before executing M1–M8

---

## Phase 1 (M1): Toolchain, Shared Contracts & Pure Core Engine
- [ ] **1.1** Initialize `package.json`, `gts` ESLint config, `tsconfig.json`, `tsconfig.host.json`, `tsconfig.renderer.json`, and Vite 8 config
- [ ] **1.2** Implement `src/shared/` strict types, API route contracts, `AgentAdapterManifest` schema, error/reason codes, and runtime validators
- [ ] **1.3** Implement `src/core/dag.ts` (`TaskTree` ↔ `LogicGraph` sync, nested `PhaseNode` layout, `RewindSet` graph reachability, `GhostNode` splicing)
- [ ] **1.4** Implement `src/core/cognitive.ts` (Human Ebbinghaus $R_{\text{human}}$ + mutation entropy $\Delta_{\text{entropy}}$ + 3-tier capsule selector + Cross-Project Attention ranker + Agent Ebbinghaus $R_{\text{agent}}$)
- [ ] **1.5** Implement `src/core/bench.ts` (`FrontierHarness` normalized trial aggregator + `RoleFitnessScore` calculator + adaptive router)
- [ ] **1.6** Implement `src/core/policy.ts` (`Turbo | Supervised | Strict` gates, `dsh-superagent` admission `off | observe | auto`, Ticket stages)

## Phase 2 (M2): Unified SQLite+FTS5 Store & Git Worktree Sandbox
- [ ] **2.1** Implement `src/store/database.ts` (`node:sqlite` WAL, `SCHEMA_VERSION = 1`, `atomic()` `BEGIN IMMEDIATE` transactions, `afterCommit` hook)
- [ ] **2.2** Implement repositories for Projects, Changes, Twin Graph, Checkpoints, Attention, Channels/Threads, Obelisk FTS5 (`messages_fts`), Temporal Semantic Memories (`memories_fts`), and `Effects` Outbox
- [ ] **2.3** Implement `src/sandbox/process-runner.ts` (`shell: false`, Windows `PATHEXT` resolution, case-insensitive secret env scrubbing, `taskkill /T /F` tree cleanup)
- [ ] **2.4** Implement `src/sandbox/git-worktree.ts` (`resolveInside` realpath lock, per-Change `git worktree` lifecycle, atomic slice commits, `refs/sef-backup/...` rescue refs before physical Checkpoint rewind)

## Phase 3 (M3): Universal `AgentHub` & Scoped `sef_station` MCP
- [ ] **3.1** Implement `src/adapters/mcp-station.ts` (ephemeral per-attempt Bearer token + 7 `sef_*` tools: contract, upstream artifacts, FTS5/semantic memory query, progress, `ask_human`, `propose_ghost_node`, `submit`)
- [ ] **3.2** Implement `src/adapters/acp-client.ts` (JSON-RPC 2.0 stdio `initialize -> session/new -> session/prompt -> session/update -> session/request_permission` for `Kimi`, `Hermes`, `DSH`, `OpenCode ACP`, custom ACP agents)
- [ ] **3.3** Implement `src/adapters/cli-stream.ts` (built-in presets for `Codex`, `Claude Code`, `OpenCode`, `Pi`, `WorkBuddy` + declarative Custom CLI manifest runner + `doctor` probe)
- [ ] **3.4** Implement `src/adapters/native-api.ts` (OpenAI-compatible + Anthropic Messages streaming tool-loop with confined workspace tools)
- [ ] **3.5** Implement `src/adapters/resource-broker.ts` (`N` background worker slots + `1` reserved priority human-interaction slot)

## Phase 4 (M4): HAMA-Loop, 8-Hour `MarathonDaemon`, `DreamingDaemon` & `BenchCoordinator`
- [ ] **4.1** Implement `src/daemons/hama-loop.ts` (7-stage requirement grill, fail-closed 4D `TQLA` evaluators, `G1/G2/G3` reject-to-restore routing)
- [ ] **4.2** Implement `src/daemons/certifier.ts` (deterministic Host `Gate` runner + independent read-only `Evaluator` session + zero self-grading enforcement)
- [ ] **4.3** Implement `src/daemons/marathon.ts` (fresh-context slice loop, 4-section Epistemic Rollover, premature-stop counter & auto-continuation, rate-limit `CooldownHolding` backoff, 2x worker fail -> Strong Lead escalation, crash recovery notes)
- [ ] **4.4** Implement `src/daemons/dreaming.ts` (sleep-time pitfall distillation, `git diff` anchor drift invalidation `valid_until`, Ebbinghaus cold-pruning, instant human Re-hydration capsule pre-computation)
- [ ] **4.5** Implement `src/daemons/bench-runner.ts` (5 disposable-worktree micro-bench calibration tasks + live passive telemetry + health degradation auto-rerouting)

## Phase 5 (M5): Authenticated Host Server, Slock Hub Engine & Electron Shell
- [ ] **5.1** Implement `src/server/secret-vault.ts` (host-only credential storage; masked write-only API contract)
- [ ] **5.2** Implement `src/server/slock-hub.ts` (persistent Channels, Threads, `@agent` dispatch across all 5 collaboration scenarios, Promote-to-Change bridge)
- [ ] **5.3** Implement `src/server/http-router.ts` (`127.0.0.1:0` ephemeral port, CSPRNG Bearer token validation, non-blocking async endpoints + multiplexed SSE stream)
- [ ] **5.4** Implement `src/electron/main.ts` & `src/electron/preload.ts` (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, native folder picker IPC, clean daemon shutdown on quit)

## Phase 6 (M6): Renderer Desktop UI — Overview, Projects & Twin-Graph Workstation
- [ ] **6.1** Build ASF v2 dark precision design system, Multi-Project top/left rail with live $R_{\text{human}}$ Retention Badges & `Needs You` counters
- [ ] **6.2** Build **Executive Overview** (`Needs You Now` 1-question action cards, Ebbinghaus Re-hydration Capsules, Marathon & Slot load monitor)
- [ ] **6.3** Build **Project Registry & Change Dashboard** (`Turbo / Supervised / Strict` selector, `TQLA` breakdown, Team assignment, Docs viewer, scoped `Archive Change`)
- [ ] **6.4** Build **Workstation**: synchronized `TaskTree` WBS + `@xyflow/react` nested `PhaseNode` `LogicGraph` + `GhostNode` controls + streaming Flow Monitor + bottom Git SHA `Checkpoints` bar with Diff & Safe Rewind

## Phase 7 (M7): Renderer Desktop UI — Slock Hub, Cognitive Observatory, Bench & Infra
- [ ] **7.1** Build **Slock / Raft Collaboration Hub** (5 scenario channels, Thread Mandate drawer, `@agent` composer, 1-click Promote-to-Change)
- [ ] **7.2** Build **Memory & Cognitive Observatory** (interactive Human × Agent Ebbinghaus curves, `"Acknowledge & Anchor"` spaced review action, Obelisk FTS5 search, Active vs Superseded Temporal Memory table)
- [ ] **7.3** Build **Bench Center, Agents Market & Models Pool** (`FrontierHarness` Cost-vs-Pass scatter plot, 1-click Calibration Run, Custom Adapter Manifest modal + `Doctor` probe, Sovereign DNA editor, masked Models Pool)
- [ ] **7.4** Build **Infra Center** (versioned `Soul Constitution`, `Marathon / Dreaming / Bench` daemon controls, live `Evolution Logs`)

## Phase 8 (M8): Lean E2E Verification, Live Electron Smoke & Release Sign-Off
- [ ] **8.1** Author lean verification gates (`verify/core-and-memory.verify.ts`, `verify/marathon-and-adapters.verify.ts`, `verify/fullstack-smoke.verify.ts`) keeping `verify/` `< 12%` of total LoC
- [ ] **8.2** Pass `npm run verify` (`gts lint` + dual `tsc` + Vite build + all E2E verification gates = `0` errors)
- [ ] **8.3** Launch Electron desktop app, verify live interactive flows & visual polish, tag `v2.0.0`

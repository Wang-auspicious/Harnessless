# ForgeOps — Engineering Milestone & Gate Checklist

> Synchronized with [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md) and [SPEC.zh-CN.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.zh-CN.md). Updated continuously after every milestone.

## Phase 0 (M0): Architecture Design, Bilingual Specification & Workspace Foundation
- [x] **0.1** Establish clean root Git repository at `d:/Desktop/Courses_27/SE/Software-factory` with `.isolated/` workspace boundary
- [x] **0.2** Verify Electron 44 runtime (`Node 24.22.2`) native `node:sqlite` + `FTS5` readiness
- [x] **0.3** Design original ToB enterprise architecture: **Federation Hub (Multi-Repo Governance)**, **DDD Ubiquitous Language Engine**, **Infra Control Plane & `Infra Steward Agent`**, **Collapsible Twin Graph (`Decision -> Restore -> Checkpoint` + `GhostNode`)**, **8h Unattended Continuity Engine**, **Dual Ebbinghaus Cognitive Memory**, and **Lightweight Live Operational Telemetry**
- [x] **0.4** Author synchronized bilingual specifications ([SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md) & [SPEC.zh-CN.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.zh-CN.md)), [DEV-PIPELINE.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/DEV-PIPELINE.md), and [CHANGELOG.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHANGELOG.md)
- [x] **0.5** User confirmation to launch M1–M8 implementation

---

## Phase 1 (M1): Toolchain, Shared Schemas & Pure Domain Core
- [x] **1.1** Configure `package.json`, Google Style (`gts`), `tsconfig.json`, `tsconfig.renderer.json`, and Vite 8
- [x] **1.2** Implement `src/shared/` types, API contracts, `AgentAdapterManifest`, `DomainTermEntry`, reason codes, and boundary validators
- [x] **1.3** Implement `src/core/twin-graph.ts` (`WBS <-> Execution Graph` compiler, collapsible `PhaseContainer` layout, `Decision -> Restore -> Checkpoint` branch-isolated `RewindSet`, `GhostNode` splicing)
- [x] **1.4** Implement `src/core/ddd.ts` (Bounded Context registry, canonical term prompt builder, `forbiddenAliases` lexical drift detector)
- [x] **1.5** Implement `src/core/cognitive.ts` (Human Ebbinghaus $R_{\text{human}}$ + mutation entropy $\Delta_{\text{entropy}}$ + 3-tier capsule selector + Cross-Project Attention priority ranker + Agent utility retention $R_{\text{agent}}$)
- [x] **1.6** Implement `src/core/telemetry.ts` & `src/core/policy.ts` (`env_fault` vs `task_failure` circuit-breaker, rolling cost/pass efficiency, `Turbo | Supervised | Strict` governance)

## Phase 2 (M2): Unified SQLite+FTS5 Store & Multi-Repo Git Worktree Sandbox
- [x] **2.1** Implement `src/store/database.ts` (`node:sqlite` WAL, `SCHEMA_VERSION = 1`, `atomic()` single-writer transactions, `EffectsOutbox` `afterCommit` dispatcher)
- [x] **2.2** Implement repositories for Federation Hubs, Member Repos (`infra` vs `service`), DDD Terms, Changes, Twin Graph, Checkpoints, Attention Queue, Engineering Rooms, FTS5 Evidence (`messages_fts`), Bi-Temporal Semantic Memory (`memories_fts`), Skills Bank, and Audit Ledger
- [x] **2.3** Implement `src/sandbox/process-runner.ts` (`shell: false`, Windows `PATHEXT` executable resolver, case-insensitive credential env scrubbing, `taskkill /T /F` tree teardown)
- [x] **2.4** Implement `src/sandbox/git-worktree.ts` (`resolveInside` symlink-safe lock, multi-repo `git worktree` provisioning, atomic checkpoint tags, `refs/forgeops-backup/...` rescue refs prior to physical rewind)

## Phase 3 (M3): Universal `AgentHub`, Scoped `forge_station` MCP & Resource Broker
- [x] **3.1** Implement `src/adapters/mcp-station.ts` (per-attempt Bearer token + 7 `forge_*` tools: contract, artifact read, memory search, progress, `ask_human`, `propose_amendment`, `submit`)
- [x] **3.2** Implement `src/adapters/acp-client.ts` (JSON-RPC 2.0 stdio `initialize -> session/new -> session/prompt -> session/update -> session/request_permission` for `Kimi`, `Hermes`, `OpenCode ACP`, custom ACP binaries)
- [x] **3.3** Implement `src/adapters/cli-stream.ts` (first-class presets for `Codex`, `Claude Code`, `OpenCode`, `Pi`, `WorkBuddy` + declarative Custom CLI manifest + readiness probe)
- [x] **3.4** Implement `src/adapters/native-api.ts` (OpenAI-compatible + Anthropic Messages streaming tool-loop with confined workspace tools)
- [x] **3.5** Implement `src/adapters/resource-broker.ts` (`N` worker slots + `1` dedicated human priority interaction slot)

## Phase 4 (M4): Requirement Closure, 8h Continuity Engine, `Infra Steward` & Sleep Consolidator
- [x] **4.1** Implement `src/engines/requirement-closure.ts` (Hub-level `grill-with-docs`, DDD term grounding, fail-closed dual-level QA evaluation, cross-repo Change decomposition)
- [x] **4.2** Implement `src/engines/certifier.ts` (deterministic `GatesNode` runner + DDD compliance check + independent read-only `AuditNode` sessions)
- [x] **4.3** Implement `src/engines/continuity.ts` (fresh-context slice loop, 4-section epistemic rollover, premature-stop blocker & auto-continuation, `CooldownHolding` rate-limit resilience, 2-strike Strong Lead escalation, crash recovery notes)
- [x] **4.4** Implement `src/engines/infra-steward.ts` (Environment Doctor, post-change `Retro` `agent-wiki` pruner & skill distiller, governed `INFRA` self-evolution workflow)
- [x] **4.5** Implement `src/engines/dreaming.ts` (sleep-time pitfall extraction, `git diff` anchor drift invalidation `valid_until`, Ebbinghaus cold-archiving, instant human capsule pre-computation)

## Phase 5 (M5): Authenticated Host Server, Engineering Rooms & Electron Desktop Shell
- [x] **5.1** Implement `src/server/secret-vault.ts` (host-isolated API key vault with masked write-only responses)
- [x] **5.2** Implement `src/server/rooms-service.ts` (`#req-grill`, `#arch-council`, `#triage-ops`, `#direct-ops`, `#exec-briefing` channels, Thread Mandates, `@agent` routing, 1-click Promote-to-Change)
- [x] **5.3** Implement `src/server/http-router.ts` (`127.0.0.1:0` loopback server, CSPRNG Bearer token auth, non-blocking async commands + live SSE bus)
- [x] **5.4** Implement `src/electron/main.ts` & `src/electron/preload.ts` (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, directory picker IPC, graceful daemon shutdown)

## Phase 6 (M6): Renderer UI Part 1 — Overview, Federation Hub/DDD & Twin-Graph Workstation
- [x] **6.1** Build ForgeOps enterprise precision theme + Global Hub/Project switcher with live $R_{\text{human}}$ Retention Badges & `Needs You` indicators
- [x] **6.2** Build **Attention & Executive Overview** (1-question structured `Attention` cards, 3-tier Ebbinghaus Re-hydration Capsules, 8h Continuity & Slot dashboard)
- [x] **6.3** Build **Federation Hub, DDD Ubiquitous Language Studio & Change Dashboard** (`INFRA` vs `Service` repos, cross-repo contract map, DDD glossary editor, Change Team/Docs/Gates, scoped `Archive Change`)
- [x] **6.4** Build **Workstation**: synchronized WBS tree + collapsible `PhaseContainer` `@xyflow/react` canvas (`Verify -> Gates -> SelfCheck -> JQA/SQA Audit -> Decision -> Restore -> Checkpoint` + dashed `GhostNode`s) + streaming Flow Monitor + bottom Git SHA Checkpoints bar

## Phase 7 (M7): Renderer UI Part 2 — Engineering Rooms, Memory Observatory & Infra Plane
- [ ] **7.1** Build **Engineering Rooms** (5 scenario channels, Thread Mandate drawer, `@agent` autocomplete, Promote-to-Change modal)
- [ ] **7.2** Build **Cognitive Memory Observatory** (interactive Human × Agent Ebbinghaus curves, `"Acknowledge & Anchor"` spaced review button, FTS5 evidence search, Active vs. Superseded Temporal Memory browser)
- [ ] **7.3** Build **Infra Control Plane & Agent Factory** (`Infra Steward Agent` console, `Soul Constitution`, `Skills Bank`, `Agents Market` w/ Custom Manifest + live operational badges + `Doctor` check, `Models Pool`, `Daemon Agents`, `Evolution & Audit Logs`)

## Phase 8 (M8): Lean E2E Verification, Live Desktop Smoke & Release
- [ ] **8.1** Implement compact E2E verification gates (`verify/*.verify.ts` `< 12%` of total LoC)
- [ ] **8.2** Pass `npm run verify` (`gts lint` + dual `tsc` + Vite build + all verification gates = `0` errors)
- [ ] **8.3** Verify live Electron desktop startup, seed realistic multi-repo + DDD workspace, and tag `v2.1.0`

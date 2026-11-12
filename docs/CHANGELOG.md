# ForgeOps — Engineering Change & Architecture Decision Log

All specification evolutions, scope refinements, and architectural decisions are recorded here chronologically.

---

## [2026-11-12] Entry 005 — v2.2.0 DirectUI Native Shell, `Anthropic Serif` + `思源宋体` Typography, Full Bilingual i18n & SDD Spec Studio

### Context & Rationale
Hardened the desktop experience to eliminate webpage-like artifacts (accidental blue drag-selection, dead top-right ornament buttons, browser reload shortcuts), established an editorial serif typography system (`Anthropic Serif` + `思源宋体` / `Noto Serif SC`), delivered exhaustive live `简体中文 <-> English` switching across every surface, and integrated ForgeOps's signature SDD specification capabilities on top of the 1:1 light engineering console.

### Delivered Changes
1. **Editorial Serif Typography (`renderer/src/styles/theme.css`):**
   - Configured `@font-face` and `--font-sans` with `'Anthropic Serif'` (`AnthropicSerif-Regular` / `AnthropicSerif-Bold`) for Latin/numerals and `'ForgeOps Han Serif'` (`Source Han Serif SC` / `Noto Serif SC` / `思源宋体`) for Simplified Chinese across all controls, tables, drawers, modals, and React Flow Twin-Graph nodes.
2. **DirectUI Native Desktop Hardening (`src/electron/main.ts`, `src/electron/preload.ts`, `src/shared/api.ts`, `renderer/src/styles/theme.css`):**
   - Enforced `user-select: none` and `-webkit-user-drag: none` across all UI chrome, cards, headers, badges, and DAG nodes while preserving crisp selection (`.selectable`) and 1-click copy strictly inside code diffs, transcripts, terminal commands, and repository paths.
   - Added Windows native frameless `titleBarStyle: 'hidden'` + `titleBarOverlay`, single-instance lock (`requestSingleInstanceLock`), `window-bounds.json` geometry persistence, `forgeops:open-external` `http/https` allowlist IPC, external navigation quarantine (`setWindowOpenHandler` + `will-navigate`), and production reload shortcut blocking (`F5` / `Ctrl+R`).
3. **Interactive Top-Right Drawers & Exhaustive `简体中文 <-> English` Localization (`renderer/src/i18n.ts`, `renderer/src/App.tsx`, `renderer/src/views/*.tsx`):**
   - Turned every top-right utility control (`记忆保持 R%`, `Changelog / 更新日志`, `Doc / 架构规范`, `FAQ / 常见问题`, `GitHub / 代码仓库`, and `简体中文 · EN` toggle) into live interactive drawers/actions backed by persisted `localStorage('forgeops.lang')`.
   - Localized all 8 surface views (`WorkstationView`, `RegistryView`, `ChangeDashboardView`, `InfraCenterView`, `AgentFactoryView`, `RoomsView`, `ControlTaskView`, and `App` modals/drawers), including dynamic Twin-Graph stage headings, status tags, daemon names, room scenarios, and permission tiers.
4. **SDD Spec Capabilities Integrated into the 1:1 Light Console:**
   - Added global `Ctrl+K` / `Cmd+K` Command Palette (`App.tsx`), live Ebbinghaus $R_{\text{human}}$ Retention & 1-Question Attention Capsule drawer (`App.tsx`), Twin-Graph 4-Section `Epistemic Rollover` Node Inspector (`WorkstationView.tsx`), `G1 -> DDD -> G2 -> G3` SDD Spec Closure Ribbon + Live `DDD Ubiquitous Language` Forbidden-Alias Drift Scanner (`ChangeDashboardView.tsx`), and 1-click `@lead` / `@ddd` / `@qa` / `@steward` role invocation pills (`RoomsView.tsx`).

---

## [2026-11-12] Entry 004 — 1:1 Enterprise Light Console Overhaul & Stepped Zero-Overlap Twin-Graph Layout

### Context & Rationale
Replaced the dark cyber-style console with a crisp, light-first enterprise engineering workspace (`#f8fafc` / `#ffffff`, hairline slate borders `#e2e8f0`, indigo primary `#4f46e5`, flat geometric vector iconography) and refactored the Twin-Graph compiler and React Flow canvas to eliminate node/control overlaps while preserving 100% of ForgeOps's multi-repo, DDD, TQLA, ACP/CLI/API, and cognitive continuity capabilities.

### Delivered Changes
1. **Light Console Navigation Shell (`renderer/src/App.tsx`, `renderer/src/styles/theme.css`, `renderer/src/components/Icons.tsx`):**
   - Implemented collapsible left navigation sidebar with 4 structured domain groups (`Infra Center`, `Project Center -> Registry / Workstation`, `Agent Factory -> Agents Market / Models Pool / Skills Bank / MCP Protocol / Channels Gear`, `Control & Task -> Sessions / Cron Jobs / Heartbeat`, `Settings -> Environments`) and top breadcrumb + Hub switcher + utility bar (`Changelog`, `Doc`, `FAQ`, `GitHub`, `English / 中文`).
2. **2-Column Workstation & Stepped Horizontal Twin-Graph (`src/core/twin-graph.ts`, `src/engines/continuity.ts`, `renderer/src/views/WorkstationView.tsx`):**
   - Refactored `WorkstationView` to a clean 2-column layout: left WBS progress bar + collapsible `Phase` white task cards, and right underlined workspace tabs (`Task Details`, `Flow Monitor`, `Activity`, `Twin Graph`) with top-bar action strip (`Run / Resume`, `+ Amendment`, `Refresh`, `T3 · P2 / T5 · P1` team badge) and zero floating canvas buttons overlapping graph nodes.
   - Upgraded `compileTwinGraph` to a stepped, non-overlapping TQLA pipeline: `Start -> Spec Integrity Guard -> Preparation (Baseline) -> PhaseContainer` (up to 4-column nested task mini-cards with dynamic Y-shift collapse/expand) `-> Gates (Lint/Test) -> DecisionNode -> Pre-QA Selfcheck / JQA Audit / SQA Review -> DecisionNodes --[FAIL]--> Restore --[right-bus]--> Checkpoint -> QA Checkpoint -> End`.
   - Added bottom-left clickable physical Git SHA `Checkpoints` rollback pills (`refs/forgeops-backup/...` protected), bottom-right status `Legend`, and light `MiniMap`.
3. **1:1 Surface Suite & Backend Team/Adapter Endpoints (`src/server/http-router.ts`, `src/store/database.ts`, `renderer/src/views/*`):**
   - Added `RegistryView` (`INFRA Projects (T5)` vs `Regular Projects` cards with `Configure Team | Live View →`), `ChangeDashboardView` (`Change Team Configuration` + `TQLA Configuration` backed by `POST /api/changes/:id/team`), `InfraCenterView` (`Operational State`, date-grouped `Evolution Logs`, `Soul Constitution`, `Daemon Agents`, `Neural Link`), `AgentFactoryView` (periwinkle `Agents Market` hero, flat-vector `RobotAvatar` cards, `Agent Profile` sub-view, `POST /api/infra/adapters/:id/delete`, `Models Pool` provider grid, `Skills Bank` + DDD `Ubiquitous Language`, `MCP Protocol`), `RoomsView` (`Channels Gear`), and `ControlTaskView` (`Sessions`, `Cron Jobs`, `Heartbeat` Ebbinghaus curves, `Environments`).
   - Updated Electron `BrowserWindow` background to `#f8fafc` and bumped default store namespace (`forgeops-v2.2`) so fresh workspaces compile stepped Twin-Graph coordinates out of the box.

---

## [2026-11-11] Entry 003 — Completed M1–M8 Implementation, E2E Verification & `v2.1.0` Desktop Release

### Delivered Capabilities
1. **Toolchain, Contracts & Pure Domain Core (`M1`):**
   - Configured strict Google TypeScript Style (`gts` / ESLint 9 + Prettier), dual-face TypeScript (`NodeNext` Host + `Bundler` React 19 Renderer), Vite 8, and esbuild Electron 44 bundler (`dist/electron/` + `dist/renderer/`).
   - Implemented pure domain engines in `src/core/`: collapsible Twin-Graph compiler (`compileTwinGraph`), branch-isolated `computeRewindSet`, acyclic `spliceGhostNode`, DDD Ubiquitous Language drift detector (`detectTerminologyDrift`), Human × Agent Ebbinghaus retention & 3-tier capsule synthesizer (`buildRehydrationCapsule`), cross-project `rankAttentionQueue`, and `Turbo | Supervised | Strict` governance policy.
2. **SQLite WAL + FTS5 Store & Multi-Repo Git Worktree Sandbox (`M2`):**
   - Implemented `ForgeStore` (`src/store/database.ts`) over built-in `node:sqlite` with `SAVEPOINT` nested transactions, `messages_fts` & `memories_fts` FTS5 full-text indexes, bi-temporal (`valid_from` / `valid_until`) semantic memory supersession, and immutable `audit_ledger`.
   - Implemented `SandboxProcessRunner` (`shell: false`, Windows `PATHEXT`/`ComSpec` safety, credential scrubbing, `taskkill /T /F` tree teardown) and `GitWorktreeManager` (`realpathSync.native` symlink confinement, multi-repo `git worktree` provisioning, physical Git checkpoints, and `refs/forgeops-backup/...` rescue refs before rollback).
3. **Universal Multi-Agent Adapter Hub & Scoped `forge_station` MCP (`M3`):**
   - Implemented `McpStationServer` (per-attempt Bearer token auth + 7 governed `forge_*` tools), `acp-stdio` (`Kimi`, `Hermes`, `OpenCode ACP`), `cli-stream` (`Codex`, `Claude Code`, `OpenCode`, `Pi`, `WorkBuddy`, custom manifests), `native-api` (`OpenAI-compatible` & `Anthropic Messages`), and `ResourceSlotBroker` (`N` worker slots + `1` dedicated Human Priority Slot).
4. **8h Continuity, Requirement Closure, `Infra Steward` & Sleep Consolidation (`M4–M5`):**
   - Implemented `RequirementClosureEngine`, external `CompletionCertifier` (fail-closed `parseFailClosedAuditJson` + DDD drift gate), `ContinuityEngine` (epistemic rollover, premature-stop blocker, `CooldownHolding`, 2-strike Strong Lead escalation, crash recovery), `InfraStewardEngine` (`Environment Doctor`, post-change `Retro` `agent-wiki` pruning, governed `INFRA` evolution), `DreamingEngine`, `HostSecretVault`, `EngineeringRoomsService`, `ForgeHttpServer`, and hardened Electron 44 `main.ts` + `preload.ts`.
5. **6-Surface Enterprise Desktop UI & Lean Verification (`M6–M8`):**
   - Built `OverviewView`, `HubDddView`, `WorkstationView` (`@xyflow/react` collapsible `PhaseContainer` + `Decision -> Restore -> Checkpoint` + `GhostNode`), `RoomsView`, `MemoryObservatoryView` (Dual Ebbinghaus SVG curves + FTS5 search), and `InfraFactoryView`.
   - Verified Vite production output directory alignment (`dist/renderer` matching `dist/electron/main.cjs`), passed `npm run verify` (`0` lint/type errors, `6/6` E2E verification gates passing, `verify/` `< 4%` of source LoC), and verified live Electron 44 Chromium window boot (`FORGEOPS_ELECTRON_SMOKE_OK:true`).

---

## [2026-11-11] Entry 002 — v2.1 Enterprise Refinement: Multi-Repo Hub, DDD, Infra Steward & Bilingual Spec

### Context & Rationale
Refined the master architecture to focus strictly on original, high-leverage **ToB Enterprise Software Engineering** capabilities while eliminating unnecessary bloat and rigid toy-workflow patterns:

1. **Replaced Standalone Benchmark Bloat with Lightweight Live Operational Telemetry:**
   - Removed the heavy standalone offline benchmark runner and synthetic micro-benchmark tasks.
   - Retained zero-overhead **real-time execution feedback** collected passively during actual engineering slices (`env_fault` vs `task_failure` separation for automatic adapter circuit-breaking, rolling first-pass gate rate, effective cost per certified slice, cache ratio, and premature-stop tracking).
2. **Added Enterprise Multi-Repository `Federation Hub` & `Retro` Doc Pruning:**
   - Designed a centralized **Master Hub Workspace** owning cross-service topology maps (`docs/agent-wiki/` written concisely for agents to eliminate blind exploration turns), shared `Skills Bank`, and coordinated multi-repository `git worktree` Changes (`CrossRepoEpic`), paired with a post-change **Retro Loop** that continuously refines hub documentation.
3. **Added First-Class DDD `Ubiquitous Language` & Bounded Context Governance:**
   - Introduced a versioned **Domain Term Registry** (`canonicalTerm`, `boundedContext`, `owningRepoIds`, `forbiddenAliases`) injected into Requirement Grills, Slice Contracts, and Terminology Drift Gates, with one-click DDD alignment refactoring support.
4. **Elevated the `Infra Control Plane` & Dedicated `Infra Steward Agent`:**
   - Formally separated **`INFRA` Platform Governance** (`Soul Constitution`, `Skills Bank`, `Environment Doctor / Neural Link`, `Retro` wiki pruning, `Daemon Agents`, and governed platform self-evolution under dual-level QA audit) from regular business service repositories.
5. **100% Original Architecture Built Cleanly from Zero:**
   - Discarded rigid static workflow-graph patterns in favor of a dynamic **Living Twin-Graph Engine** (`Collapsible PhaseContainer` + `Verify -> Gates -> SelfCheck -> JQA/SQA Audit -> Decision --[FAIL]--> Restore --> Checkpoint` + runtime `GhostNode` amendments).
6. **Synchronized Bilingual Specifications:**
   - Published 1:1 synchronized English ([SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md)) and Chinese ([SPEC.zh-CN.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.zh-CN.md)) master specifications.

---

## [2026-11-11] Entry 001 — Workspace Isolation & Clean Repository Bootstrap

### Actions Taken
- Archived legacy prototype and reference materials into gitignored `.isolated/`.
- Verified Electron 44 runtime (`Node 24.22.2`) built-in `node:sqlite` + `FTS5` support.
- Initialized root Git repository on `main` with strict LF normalization (`.gitattributes`), Google TypeScript Style (`gts`) mandate, and `< 12%` LoC lean end-to-end verification policy.

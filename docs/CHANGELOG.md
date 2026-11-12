# ForgeOps — Engineering Change & Architecture Decision Log

All specification evolutions, scope refinements, and architectural decisions are recorded here chronologically.

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

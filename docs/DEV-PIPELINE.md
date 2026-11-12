# ForgeOps — Software Engineering Execution Pipeline & Governance Standard

- **Document ID:** `FORGEOPS-PIPELINE-2.1`
- **Governing Specifications:** [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md) · [SPEC.zh-CN.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.zh-CN.md)
- **Live Milestone Checklist:** [CHECKLIST.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHECKLIST.md)
- **Engineering Change Log:** [CHANGELOG.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHANGELOG.md)

---

## 1. Repository Structure & Clean Isolation

ForgeOps is engineered from zero at the **global workspace root** (`d:/Desktop/Courses_27/SE/Software-factory`), with all external notes, legacy scratch artifacts, and ad-hoc sandbox directories strictly confined to gitignored `.isolated/`:

```text
d:/Desktop/Courses_27/SE/Software-factory/
├── .isolated/                  # GITIGNORED: isolated scratch data & historical materials
├── docs/                       # Bilingual specifications & SE governance documents
│   ├── SPEC.md                 # Master Technical Specification (English)
│   ├── SPEC.zh-CN.md           # Synchronized Master Technical Specification (Chinese)
│   ├── DEV-PIPELINE.md         # Engineering execution standard (this file)
│   ├── CHECKLIST.md            # Milestone & gate tracking checklist
│   └── CHANGELOG.md            # Chronological architecture & change log
├── src/
│   ├── shared/                 # Pure TypeScript domain schemas, API contracts, reason codes, boundary validators
│   ├── core/                   # Zero-I/O domain engine: TwinGraph topology & rewind, DDD matcher, Ebbinghaus math, Policy
│   ├── store/                  # node:sqlite WAL database, migrations, FTS5 evidence & bi-temporal semantic stores, Outbox
│   ├── sandbox/                # Multi-repo git worktree manager, Rescue-Ref checkpoints, resolveInside, shell:false runner
│   ├── adapters/               # Universal AgentHub (ACP stdio, CLI stream, Native API), forge_station MCP, ResourceBroker
│   ├── engines/                # Requirement Closure, 8h Continuity Engine, Certifier, Infra Steward, Sleep Consolidator
│   ├── server/                 # Authenticated 127.0.0.1:0 HTTP + SSE router, Secret Vault, Engineering Rooms service
│   └── electron/               # Electron 44 main.ts + hardened contextBridge preload.ts
├── renderer/                   # React 19 + Vite 8 + @xyflow/react 12 desktop frontend
│   └── src/
│       ├── api/                # Typed client + multiplexed SSE subscriber
│       ├── components/         # High-density enterprise UI primitives, TwinGraph custom nodes, Ebbinghaus curves
│       └── views/              # Overview, Federation Hub & DDD Studio, Workstation, Engineering Rooms, Memory, Infra Plane
├── verify/                     # Lean, high-signal E2E & invariant verification gates (<12% of total LoC)
├── package.json
├── tsconfig.json               # Solution root referencing host + renderer compiler faces
├── tsconfig.host.json          # NodeNext strict config for src/ + verify/
├── tsconfig.renderer.json      # DOM/Bundler strict config for renderer/
└── .eslintrc.json              # Strict Google TypeScript Style (gts) ruleset
```

---

## 2. Google TypeScript Style & Architecture Invariants

1. **Strict Google Style (`gts`):**
   - 2-space indentation, single quotes `'...'`, required semicolons, trailing multiline commas.
   - `strict: true`, `noImplicitAny: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`.
   - Zero `any` and zero blind `as unknown as T` casts. Every process, network, file, and JSON boundary validates inputs explicitly via `src/shared/validation.ts`.
   - Closed discriminated unions terminate in `assertNever(x)`.
   - Commands use imperative verbs (`createHub`, `approveGate`, `restoreCheckpoint`); recorded execution facts use past tense (`sliceCertified`, `amendmentProposed`, `adapterDegraded`).
2. **Strict Layer & Compiler Face Boundaries:**
   - `src/core/` performs zero I/O (no `node:fs`, `node:child_process`, `node:http`, or `node:sqlite`).
   - `renderer/` imports only pure types and constants from `src/shared/`.
   - All persistent mutations run inside `Store.atomic()` single-writer transactions; external effects execute strictly via `EffectsOutbox` after transaction commit.

---

## 3. Lean Verification Policy (No TDD / Zero Unit-Test Bloat)

- **Hard Cap on Verification Code (`< 12%` of Codebase LoC):** We reject mock-heavy TDD unit-test sprawl. Code is built cleanly from [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md) / [SPEC.zh-CN.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.zh-CN.md) and verified through **four compact, real-system verification gates** wired into `npm run verify`:
  1. **Static Integrity Gate:** `gts lint` + `tsc -p tsconfig.host.json --noEmit` + `tsc -p tsconfig.renderer.json --noEmit` + Vite production bundle build (`0` errors).
  2. **Core, DDD & Cognitive Memory Gate (`verify/core-and-memory.verify.ts`):** Validates Twin-Graph branch-isolated `RewindSet`, DDD Ubiquitous Language forbidden-alias detection, Dual Ebbinghaus retention & capsule tiering, and `node:sqlite` FTS5 + bi-temporal (`valid_until`) memory supersession.
  3. **Multi-Repo Worktree, Continuity & Adapter Gate (`verify/continuity-and-sandbox.verify.ts`):** Exercises a real multi-repo Federation Hub + `git worktree` sandbox, `forge_station` scoped MCP auth, ACP/CLI stream framing, premature-stop rejection by `CompletionCertifier`, `GhostNode` amendment, and rescue-ref physical Git rollback.
  4. **Full-Stack Host & Electron Smoke Gate (`verify/fullstack-smoke.verify.ts`):** Boots the authenticated `127.0.0.1:0` server, verifies `401` rejection without Bearer token, runs an end-to-end Change + `Infra Steward` cycle, and verifies clean Electron boot.

---

## 4. Milestone Execution Roadmap (`M1`–`M8`)

| Milestone | Engineering Deliverables | Gate & Git Checkpoint |
| :--- | :--- | :--- |
| **M0 (Completed)** | Clean root workspace & `.isolated/` boundary, bilingual `SPEC.md` + `SPEC.zh-CN.md`, `DEV-PIPELINE.md`, `CHECKLIST.md`, `CHANGELOG.md` | Root Git commit on `main` |
| **M1** | Toolchain (`package.json`, Electron 44, React 19, XYFlow 12, `gts`, dual `tsconfig`), `src/shared/` contracts & validators, `src/core/` pure engine (TwinGraph topology & rewind, DDD glossary engine, Dual Ebbinghaus curves, live telemetry health scorer, Permission policies) | `lint` + dual `tsc` green $\to$ Commit `M1` |
| **M2** | `src/store/` (`node:sqlite` WAL + FTS5 evidence + bi-temporal semantic memory + `EffectsOutbox` + `AuditLedger`) & `src/sandbox/` (Federation Hub + multi-repo `git worktree` isolation, Rescue-Ref checkpoints, `resolveInside`, `shell: false` process-tree runner) | `core-and-memory` + worktree gate green $\to$ Commit `M2` |
| **M3** | `src/adapters/` Universal `AgentHub`: `acp-stdio` client (`Kimi`, `Hermes`, `OpenCode ACP`, custom ACP), `cli-stream` (`Codex`, `Claude Code`, `OpenCode`, `Pi`, `WorkBuddy`, Custom CLI manifest), `native-api` tool-loop, scoped `forge_station` MCP server, and `ResourceBroker` (with reserved human priority slot) | Adapter & MCP auth gate green $\to$ Commit `M3` |
| **M4** | `src/engines/`: Requirement & DDD Closure (`G1`), **8-Hour Continuity Engine** (fresh slices, 4-section epistemic rollover, external `CompletionCertifier`, `CooldownHolding` backoff, 2-strike Lead escalation), **`Infra Steward Engine`** (Environment Doctor, Retro Doc Pruner, governed `INFRA` evolution), and **`DreamingDaemon`** | `continuity-and-sandbox` gate green $\to$ Commit `M4` |
| **M5** | `src/server/` + `src/electron/`: Authenticated `127.0.0.1:0` HTTP + multiplexed SSE server, write-only Secret Vault, 5-scenario **Engineering Rooms** service, Electron `main.ts` + `preload.ts` `contextBridge` | Server + IPC security gate green $\to$ Commit `M5` |
| **M6** | `renderer/` Part 1: Enterprise dark theme, Multi-Hub/Project rail with live $R_{\text{human}}$ badges, **Attention & Executive Overview**, **Federation Hub & DDD Ubiquitous Language Studio**, and **Workstation** (collapsible `PhaseContainer` Twin Graph + `Decision -> Restore -> Checkpoint` visual flow + `GhostNode`s + Flow Monitor + Checkpoints bar) | Renderer `tsc` + Vite build green $\to$ Commit `M6` |
| **M7** | `renderer/` Part 2: **Engineering Rooms** (5 channels + Threads + `@agent` + Promote-to-Change), **Cognitive Memory Observatory** (Ebbinghaus curves + FTS5 search + Bi-temporal memory table), and **Infra Control Plane & Agent Factory** (`Infra Steward`, `Soul Constitution`, `Skills Bank`, `Agents Market` w/ live telemetry badges, `Models Pool`, `Evolution & Audit Logs`) | Full UI build green $\to$ Commit `M7` |
| **M8** | Complete `npm run verify` across all 4 gates, live Electron desktop launch & interactive walkthrough, seed enterprise multi-repo demo workspace, final `CHECKLIST.md` & `CHANGELOG.md` sign-off | All gates `0` errors $\to$ Tag `v2.1.0` |

### Strict Change-Control Protocol
Any mid-implementation adjustment must update **both** [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md) and [SPEC.zh-CN.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.zh-CN.md) synchronously, log the rationale in [CHANGELOG.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHANGELOG.md), and re-index [CHECKLIST.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHECKLIST.md) prior to coding.

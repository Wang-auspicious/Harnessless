# Software Engineering Execution Pipeline & Governance Standard

- **Document ID:** `SEF-PIPELINE-2.0`
- **Governing Spec:** [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md)
- **Live Checklist:** [CHECKLIST.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHECKLIST.md)
- **Change Log:** [CHANGELOG.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHANGELOG.md)

---

## 1. Repository Layout & Isolation Boundary

The project lives directly at the **global workspace root** (`d:/Desktop/Courses_27/SE/Software-factory`):

```text
d:/Desktop/Courses_27/SE/Software-factory/
├── .isolated/                  # GITIGNORED: course references, cloned SOTA repos, legacy v1, scratch/bench runs
│   ├── course-refs/            # Classroom photos (ASF Console), HAMA-Loop PDF, Workflow V2 MD, Raft/Factory PNGs
│   ├── references/             # dsh-superagent-prototype, deepseek-harness, obelisk, frontier-harness-eval
│   └── legacy-se-factory/      # Archived v1 prototype audited in Turn 1
├── docs/                       # Authoritative SE governance documents
│   ├── SPEC.md                 # Master Technical Specification v2.0
│   ├── DEV-PIPELINE.md         # Engineering execution standard (this file)
│   ├── CHECKLIST.md            # Milestone & gate tracking checklist
│   └── CHANGELOG.md            # Architectural & implementation change log
├── src/
│   ├── shared/                 # Zero-I/O shared TypeScript contracts, API routes, domain types, reason codes
│   ├── core/                   # Pure deterministic domain engine: DAG reachability, Ebbinghaus math, Bench scoring, Policy
│   ├── store/                  # node:sqlite WAL database, schema migrations, FTS5 evidence & semantic memory repositories, Outbox
│   ├── sandbox/                # Git worktree manager, Dual-Checkpoint commit/tag/rewind, resolveInside, hardened process runner
│   ├── adapters/               # Universal AgentHub: ACP stdio client, CLI stream adapters (Codex/Claude/OpenCode/Pi/Custom), Native API, sef_station MCP
│   ├── daemons/                # MarathonDaemon (8h slice loop + CompletionCertifier), DreamingDaemon (sleep-time memory), BenchCoordinator
│   ├── server/                 # Authenticated 127.0.0.1:0 HTTP + SSE router & composition Runtime
│   └── electron/               # Electron 44 main.ts + hardened contextBridge preload.ts
├── renderer/                   # React 19 + Vite 8 + @xyflow/react 12 desktop frontend
│   └── src/
│       ├── api/                # Typed client + live SSE event bus
│       ├── components/         # Shared high-density UI primitives, badges, curve charts, markdown/diff viewers
│       └── views/              # Overview, Projects/Changes, Workstation (Twin Graph), Slock Hub, Memory Observatory, Bench/Market, Infra
├── verify/                     # Lean, high-signal E2E & invariant verification suite (<12% of codebase LoC)
├── package.json
├── tsconfig.json               # Solution root referencing host + renderer faces
├── tsconfig.host.json          # NodeNext strict config for src/ + verify/
├── tsconfig.renderer.json      # DOM/Bundler strict config for renderer/
└── .eslintrc.json              # Google TypeScript Style (gts) ruleset
```

---

## 2. Coding Standards (Strict Google TypeScript Style)

1. **Google Style Enforcement (`gts`):**
   - 2-space indentation, single quotes `'...'`, semicolons required, trailing commas in multiline literals.
   - `strict: true`, `noImplicitAny: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`.
   - Zero `any` casts and zero blind `as unknown as T` casts. External wire inputs (HTTP bodies, CLI JSONL lines, ACP JSON-RPC frames, LLM JSON responses, SQLite JSON columns) pass through explicit narrowing validators in `src/shared/validation.ts`.
   - Exhaustive `switch` statements over discriminated unions end with `assertNever(value)`.
   - Imperative verb names for commands (`startChange`, `rewindToCheckpoint`, `answerAttention`) and past-tense names for adapter/executor facts (`sliceSubmitted`, `gateFinished`, `turnInterrupted`).
2. **Compiler Face Separation:**
   - `src/core/` imports **only** `src/shared/` and `node:crypto` (zero filesystem, child_process, or network imports).
   - `renderer/` imports **only** types/constants from `src/shared/`—never Node or Electron Main modules.

---

## 3. Lean Verification Philosophy (Strictly NO TDD / NO Unit-Test Bloat)

Per explicit engineering mandate:
- **Hard Prohibition on Test Sprawl:** We do **not** practice TDD and do **not** write mock-heavy per-file unit tests that mirror implementation lines. Total verification code under `verify/` **must remain `< 12%` of total source LoC**.
- **Spec-Driven Implementation + High-Signal End-to-End Gates:** Every milestone is engineered cleanly from [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md) first, then validated by **4 compact, real-system verification gates** run via `npm run verify`:
  1. **Static Gate (`lint` + `typecheck` + `build`):** `gts lint` + `tsc -p tsconfig.host.json --noEmit` + `tsc -p tsconfig.renderer.json --noEmit` + Vite production bundle build (`0` warnings/errors).
  2. **Core & SQLite+FTS5 Invariant Gate (`verify/core-and-memory.verify.ts`):** Verifies DAG branch-isolated rewind (`RewindSet`), Dual Ebbinghaus human/agent retention math, Bi-temporal memory supersession (`valid_until`), and Obelisk FTS5 transcript search on a real `node:sqlite` instance.
  3. **Git Worktree, Marathon & Universal Adapter Gate (`verify/marathon-and-adapters.verify.ts`):** Exercises a real temporary Git repository + `git worktree`, `sef_station` scoped MCP auth, ACP stdio + CLI stream protocol framing, premature-stop rejection by `CompletionCertifier`, GhostNode amendment, and safe physical checkpoint rollback (`refs/sef-backup/...`).
  4. **Full-Stack Server + Electron Smoke Gate (`verify/fullstack-smoke.verify.ts`):** Boots the real `Runtime` on `127.0.0.1:0`, verifies Bearer auth rejection (`401` without token), executes a full Change lifecycle (`HAMA Grill -> Twin Graph -> Slice Certify -> Bench Score`), and verifies headless Electron startup readiness.

---

## 4. Clean Reuse Map from `D:/Desktop/Courses_27/SE/H2`

We selectively adapt proven protocol mechanics from `H2` while re-architecting all storage, orchestration, and security from zero:

| `H2` Source Module | What We Reuse / Adapt | How ASF v2 Upgrades It |
| :--- | :--- | :--- |
| `H2/server/claude-code.ts` | `--output-format stream-json --verbose --strict-mcp-config` framing & event extraction | Upgraded to `shell: false`, Windows case-insensitive env scrubbing, normalized `TranscriptRecord` emission into SQLite FTS5 |
| `H2/server/codex.ts` | `codex app-server --listen stdio://` JSON-RPC turn/thread lifecycle | Integrated into `AgentHub` with `PermissionTier` mapping & stall watchdog |
| `H2/server/opencode.ts` & `pi.ts` | `OPENCODE_PURE=1` & `pi --mode json -p` stream parsing | Unified under `CliStreamAdapter` + custom manifest support (`WorkBuddy`, etc.) |
| `H2/server/mcp-station.ts` & `mcp-security.ts` | Per-attempt random Bearer credentials & `submit` validation pattern | Expanded into `sef_station` 7-tool contract (`sef_ask_human`, `sef_propose_ghost_node`, `sef_memory_query`, `sef_submit`) |
| `H2/server/code-workspace.ts` | `resolveInside` path traversal lock & safe command runner | Upgraded with `fs.realpathSync` symlink defense + multi-branch `git worktree` + backup-ref checkpointing |
| `H2/server/collaboration.ts` | Bounded multi-agent turn room mechanics | Upgraded to persistent SQLite-backed **Slock/Raft Channels + Threads + 5 Scenarios + Reserved Human Slot** |

---

## 5. Step-by-Step Milestone Execution Roadmap & Change Control

Execution proceeds sequentially through **Milestones M1–M8**:

| Milestone | Scope | Completion Gate & Git Checkpoint |
| :--- | :--- | :--- |
| **M0 (Done)** | Deep SOTA kernel research (`dsh-superagent`, `deepseek-harness`, `obelisk`, `frontier-harness-eval`), workspace `.isolated/` cleanup, root `git init`, `SPEC.md` + `DEV-PIPELINE.md` + `CHECKLIST.md` | Root Git commit `docs: establish ASF v2 master spec and SE governance` |
| **M1** | Project toolchain & `gts` scaffold (`package.json`, Electron 44, React 19, XYFlow 12, dual `tsconfig`), `src/shared/` contracts, `src/core/` pure engine (Twin Graph DAG reachability, Dual Ebbinghaus formulas, `FrontierHarness` scorer, Policy & Ticket stages) | `gts lint` + `tsc` green -> Git commit `feat(core): ...` |
| **M2** | `src/store/` (`node:sqlite` WAL + `SCHEMA_VERSION=1` + FTS5 triggers + `Effects` durable outbox) & `src/sandbox/` (real `git worktree` isolation, Dual Checkpoint + `refs/sef-backup` rollback, `resolveInside`, hardened `shell: false` process-tree runner) | `core-and-memory` + worktree smoke green -> Git commit `feat(store,sandbox): ...` |
| **M3** | `src/adapters/` Universal `AgentHub`: `acp-stdio` client (`Kimi`, `Hermes`, `DSH`), `cli-stream` (`Codex`, `Claude Code`, `OpenCode`, `Pi`, declarative Custom CLI), `native-api` tool-loop (`OpenAI-compat` + `Anthropic`), and scoped `sef_station` MCP server | Adapter wire & MCP auth verification green -> Git commit `feat(adapters): ...` |
| **M4** | `src/daemons/` Core Engines: **HAMA-Loop** 7-stage closure (`TQLA` fail-closed evaluators + `G1/G2/G3` reject-to-restore), **8-Hour `MarathonDaemon`** (fresh-context slices, Epistemic Rollover, external `CompletionCertifier`, quota backoff, Lead escalation), **`DreamingDaemon`**, and **`BenchCoordinator`** (5 micro-bench tasks + adaptive `Strong-Commands-Weak` router) | `marathon-and-adapters` verification green -> Git commit `feat(daemons): ...` |
| **M5** | `src/server/` + `src/electron/`: Authenticated `127.0.0.1:0` HTTP + live SSE server, write-only Secret Vault, Slock/Raft 5-scenario collaboration service (w/ reserved human concurrency slot), Electron `main.ts` + `preload.ts` `contextBridge` | Host server + IPC auth smoke green -> Git commit `feat(server,electron): ...` |
| **M6** | `renderer/` Desktop UI Part 1: App shell, Multi-Project Switcher w/ live $R_{\text{human}}$ badges, **Executive Overview** (`Needs You Now` + Re-hydration Capsules), **Project Registry & Change Dashboard**, and **Workstation (`Twin Graph` nested `PhaseNode` XYFlow + Live Flow Monitor + Checkpoints bar)** | Renderer `tsc` + Vite build green -> Git commit `feat(ui-workstation): ...` |
| **M7** | `renderer/` Desktop UI Part 2: **Slock/Raft Collaboration Hub** (5 scenarios + Threads + `@agent` + Promote-to-Change), **Memory & Cognitive Observatory** (Dual Ebbinghaus curves + FTS5 inspector + Temporal facts), **Bench Center / Agents Market / Models Pool**, and **Infra Center** (`Soul Constitution` + `Daemons` + `Evolution Logs`) | Full UI build green -> Git commit `feat(ui-hub): ...` |
| **M8** | End-to-end verification (`npm run verify`), Electron live boot & visual inspection, seed showcase dataset + real Git sandbox verification, final `CHECKLIST.md` & `CHANGELOG.md` sign-off | All 4 gates green (`0` lint/type/runtime errors) -> Release tag `v2.0.0` |

### Deviation & Change-Log Rule
Whenever an implementation obstacle, protocol quirk, or design improvement arises during M1–M8:
1. Record the root cause, impact, and updated design decision in [CHANGELOG.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHANGELOG.md) immediately.
2. Re-align [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md) and [CHECKLIST.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/CHECKLIST.md) **before** writing workaround code.

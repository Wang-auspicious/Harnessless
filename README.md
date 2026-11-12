# ForgeOps (`v2.1.0`)

**Enterprise Software Engineering Meta-Harness & Multi-Repository Control Plane**  
**面向多仓联邦治理、DDD 通用语言对齐与 8 小时无人值守连续交付的企业级软件工程元驾驭台（Electron 44 桌面应用）**

---

## Core Architecture Pillars | 核心架构支柱

1. **Multi-Repository Federation Hub & `Retro` Agent-Wiki Optimization (`多仓联邦主控仓与 Retro 精简`)**
   - Centralizes cross-repository service topology (`INFRA` vs `SERVICE` tiers), shared `Skills Bank`, Hub-level `Grill-with-Docs` requirement closure, and post-change `Retro` wiki pruning so agents start tickets with zero blind file-explorer waste.
2. **DDD Ubiquitous Language Studio & Drift Gate (`领域驱动设计通用语言与防漂移硬门禁`)**
   - Locks canonical domain identifiers (`DomainTermEntry`) per Bounded Context, injects them into agent prompts, and enforces zero prohibited synonyms (`forbiddenAliases`) on newly added Git diff lines during `Hard Gates` and `QA Audit`.
3. **Living Collapsible Twin-Graph & Rescue-Backed Git Checkpoints (`可折叠双生图与无损 Git 物理回退`)**
   - Synchronizes hierarchical WBS items with an interactive `@xyflow/react` execution graph (`Start -> G1-VERIFY -> CP-0 -> [PhaseContainer(Tasks) -> Gates -> SelfCheck -> JQA -> SQA -> Decision --PASS--> Checkpoint / --FAIL--> Restore] -> G3-CERTIFIED`), runtime `GhostNode` amendments, branch-isolated `computeRewindSet`, and `refs/forgeops-backup/...` rescue refs prior to any `git reset --hard`.
4. **8-Hour Unattended Continuity & External Certification (`8 小时无人值守连续性与外部独立认证`)**
   - Fresh-context bounded slices, 4-section epistemic rollover (`SPEC-CONFIRMED FACTS` vs `AGENT HYPOTHESES`), premature-stop interception, rate-limit `CooldownHolding`, 2-strike Strong Lead escalation, and strict external `CompletionCertifier`.
5. **Dual Human × Agent Ebbinghaus Cognitive Memory (`人机双向艾宾浩斯协同记忆系统`)**
   - Computes human retention $R_{\text{human}}(t) = e^{-\Delta t / S_{\text{human}}}$ compressed by unseen autonomous mutation entropy $\Delta_{\text{entropy}}$, generating 3-tier Re-hydration Capsules (`Warm`, `30s Delta`, `Deep Re-Anchor`) alongside SQLite FTS5 cross-harness evidence search and bi-temporal (`valid_from` / `valid_until`) semantic memory consolidated by `DreamingEngine`.
6. **Universal Multi-Agent Adapter Hub & `Infra Steward Agent` (`全协议多 Agent 接入中心与基建总管`)**
   - Supports `acp-stdio` (`Kimi`, `Hermes`, `OpenCode ACP`), `cli-stream` (`Codex`, `Claude Code`, `OpenCode`, `Pi`, `WorkBuddy`, custom CLI manifests), and `native-api` (`OpenAI-compatible`, `Anthropic Messages`), paired with per-attempt Bearer-authenticated `forge_station` MCP tools, a dedicated Human Priority Concurrency Slot, and lightweight live operational telemetry.

---

## Documentation | 工程文档

- **English Architecture Specification:** [docs/SPEC.md](./docs/SPEC.md)
- **中文同步架构规范说明书:** [docs/SPEC.zh-CN.md](./docs/SPEC.zh-CN.md)
- **Engineering Pipeline & Code Standards:** [docs/DEV-PIPELINE.md](./docs/DEV-PIPELINE.md)
- **Milestone Checklist:** [docs/CHECKLIST.md](./docs/CHECKLIST.md)
- **Engineering Changelog:** [docs/CHANGELOG.md](./docs/CHANGELOG.md)

---

## Quick Start | 快速启动

```bash
# Run Google TypeScript Style lint + Dual TypeScript checks + Production build + E2E Verification Gates
npm run verify

# Launch Electron 44 desktop application in live Vite HMR development mode
npm run dev

# Build production bundles and start packaged Electron desktop shell
npm run build
npm start
```

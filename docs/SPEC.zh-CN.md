# ForgeOps v3.0 — 统一 SDD 软件工厂内核技术规范说明书

- **文档编号：** `FORGEOPS-SPEC-3.0-ZH`
- **英文同步版本：** [SPEC.md](file:///d:/Desktop/Courses_27/SE/Software-factory/docs/SPEC.md)
- **技术底座：** Electron 44（内置 Node.js 24+ `node:sqlite` + FTS5）· React 19 · `@xyflow/react` 12 · TypeScript（Google `gts` 规范）
- **仓库根目录：** `d:/Desktop/Courses_27/SE/Software-factory`

---

## 1. 产品定位与七大 SDD 核心公理

### 1.1 统一规格驱动（SDD）软件工厂内核
**ForgeOps v3.0** 将前期多智能体协同需求工程（HAMA-Loop）、组织级长期记忆（Hindsight × 艾宾浩斯）、多仓联邦任务编排（Twin-Graph）、隔离 Git Worktree 沙箱与独立质量认证融合为一套内聚的 **规格驱动研发控制平面（SDD Control Plane）**。通过统一的 **Mission（任务使命）** 生命周期、自适应分诊（Adaptive Triage）、意图预设（Intent Presets）与阶段感知的 **上下文投射引擎（Contextual Surface Engine）**，彻底解决传统工具页面割裂、参数晦涩与运行状态不可解释的问题。

### 1.2 七大核心工程公理
1. **SDD 规格先行契约至上（不采用 TDD）：** 需求规格（`Goal`、`Proposal`、`FR/NFR`、`AcceptanceCriteria`、`DomainTermEntry` 与节点 I/O 契约）是唯一权威契约。所有开发切片、硬门禁与独立审计均严格回溯至冻结规格编号，不强制引入 TDD 红绿重构步骤。
2. **严格区分 `live` 真实模式与 `simulation` 演练模式（零静默伪造）：** 每个 Mission 创建时显式锁定不可变的 `executionMode`。在 `live` 模式下，缺少 API 密钥、外部 CLI 不可达、触发限流或审计 JSON 无法解析时**绝不静默伪造完成**，必须诚实暴露为 `setup_required`、`env_fault`、`cooldown_hold` 或 `GATE_FAILED`；`simulation` 模式用于离线确定性全链路演示，与 `live` 记忆、基线及遥测严格物理隔离。
3. **人类注意力守恒与适时投影（Right-Time Projection）：** 健康的自主运行保持零噪音；需人工介入时，由 `FocusProjection` 在同一焦点视图中一次性给出通俗状态解释、哈希绑定决策包、每个选项的下游影响预览（`consequencePreview`）与当前合法控制按钮。
4. **执行权与认证权彻底分离（严禁自证完成）：** Worker 智能体无权自行宣称任务完成。节点与变更必须通过宿主机确定性 **硬门禁（`exitCode === 0`）**、**阶段级 `fileScope` 范围检查**、**DDD 领域术语漂移门禁** 与独立只读 **JQA + SQA 逐条 AC 审计**。
5. **记忆严格无环数据流与权威分级：** Hindsight Layer 1 原始不可变文档与分块（`memory_documents` / `memory_chunks`）经 Layer 2 原子事实与演化观察（`memory_facts` / `memory_observations`）汇总为 Layer 3 活性知识文档（`memory_living_docs`）与人类重锚胶囊。Layer 3 产物**严禁**回灌 `retain()` 作为 Layer 1 文档；`L3_locked` 仅允许内核权威事件写入，Worker MCP 写入硬性封顶为 `L1_observed`。
6. **单写者 SQLite 原子事务与代数围栏（Fencing）：** 所有状态跃迁必须在 `ForgeStore.atomic()`（`BEGIN IMMEDIATE` + `PRAGMA busy_timeout = 5000`）内同步完成，编译期与运行期双双禁止异步回调。异步并行执行结果提交时必须校验 `(version, executionEpoch)` 防止过期覆盖，外部副作用通过带租约的 `EffectsOutbox` 可靠派发。
7. **零污染多仓 Git 沙箱隔离：** 变更隔离在 `changeId` 区分的专属 `git worktree` 中；`resolveInside` 封堵 `.git` 文件/目录、NTFS 数据流（`:`）、Windows 保留设备名及 `\\?\` 路径绕过；按公共 Git 目录（`--git-common-dir`）加锁消除 `.git/*.lock` 竞态；`diffSinceCommit` 全程只读零索引修改，且不改写开发者本地 `.git/config`。

---

## 2. 严格无环的五层模块依赖 DAG

下层模块严禁反向引用上层模块。`src/shared/` 保持 100% 纯 ES2022（无 `node:*` 依赖，不使用 `.findLast()` 等 ES2023+ 方法），确保 `tsconfig.json` 与 `tsconfig.renderer.json` 均零错误通过编译。

```text
Layer 0（纯共享契约 — ES2022）：
  src/shared/      -> errors.ts, v3-types.ts, control-schema.ts, types.ts, api.ts, validation.ts

Layer 1（纯领域内核 — 零 FS/SQLite/网络 I/O）：
  src/core/        -> canonical-json.ts, schema-dsl.ts, glob-scope.ts, ddd.ts, cognitive.ts,
                      policy.ts, telemetry.ts, twin-graph.ts, spec-compiler.ts,
                      spec-validator.ts, trial-simulator.ts, impact-analyzer.ts

Layer 2（基础设施原语 — 仅依赖 Layer 0-1）：
  src/sandbox/     -> contracts.ts, worktree-lock.ts, process-runner.ts, git-worktree.ts
  src/store/       -> schema.ts, mission-repo.ts, hama-repo.ts, memory-repo.ts, database.ts

Layer 3（子系统引擎 — 仅依赖 Layer 0-2，彼此通过窄回调接口装配）：
  src/memory/      -> tokenizer.ts, embeddings.ts, hindsight-engine.ts
  src/adapters/    -> contracts.ts, resource-broker.ts, rate-limiter.ts, mcp-station.ts,
                      native-api.ts, cli-stream.ts, acp-client.ts, index.ts
  src/requirements/-> contracts.ts, markdown.ts, demo-responder.ts, hama-engine.ts

Layer 4（编排与控制平面引擎 — 组合 Layer 3）：
  src/engines/     -> outbox-worker.ts, certifier.ts, continuity.ts, mission-orchestrator.ts,
                      dreaming.ts, infra-steward.ts, requirement-closure.ts

Layer 5（宿主运行时与回环服务）：
  src/server/      -> secret-vault.ts, rooms-service.ts, http-router.ts, runtime.ts
  src/electron/    -> main.ts, preload.ts
```

---

## 3. 统一 Mission 生命周期、自适应分诊与意图预设

### 3.1 Mission 聚合根与五大阶段
用户通过单一入口 `POST /api/missions` 创建 Mission，贯穿五大人类可读宏阶段（`MissionStage`）：
1. `understand`（`intent -> triage`：理解诉求与风险定级）
2. `converge_spec`（`requirements -> baseline_frozen`：多角色协同收敛并锁定需求基线）
3. `plan_validate`（`plan_review`：编译 Twin-Graph、3 级规格校验与静态并发试跑）
4. `build_verify`（`executing`：多仓/分片并行开发、硬门禁与阶段级工作树回退）
5. `certify_deliver`（`certification -> delivered`：无冲突合并预检、双级 QA 终审与可验证证据包交付）

异常与挂起横切状态：`paused_human`、`cooldown_hold`、`failed`、`aborted`。

### 3.2 自适应分诊轨（`express | standard | full_hama`）
- **`express`（快速通道）：** 明确的单仓局部改动。执行快速拆解 + DDD/Hindsight 校验 → 简明规格确认 → 编译执行。
- **`standard`（标准协同）：** 单仓中等复杂度特性。执行拆解与依赖分析 → 2–3 关键角色精简评审 → 整合方案与人工审批 → PRD 基线 → 构建。
- **`full_hama`（完整 7 阶段 HAMA 闭环）：** 涉及多仓库联动、高敏领域（`auth`、`billing`、`settlement`、`security`、`compliance`、`payment`、`migration`）、多份原始资料或高约束密度时自动触发完整 5 角色讨论、4 维并发独立评价、附条件审批与严格需求发布。
- **阶段边界规则：** `escalate_triage` 仅允许在基线冻结之前（`triage | requirements`）升级并自动复用已有 `intake` 与 `dependency_map` 工件；基线一旦冻结，任何需求调整必须走 **基线演进（Baseline Evolution `v1 -> v2`）**。

### 3.3 三档意图预设与自描述控制注册表（`GET /api/schema/controls`）
- **`autopilot`（全速自治）：** 对应 `turbo` 权限档，确定性门禁与质量评分达标（`>= 0.85`）自动放行，允许最多 6 个不修改验证命令的 `GhostNode` 自动插入，worker 并发 `3`、预算 `$25`、最长连续运行 `8h`。
- **`guided`（均衡领航，默认）：** 对应 `supervised` 权限档，在分诊升级确认、方案审批（`approval`）、PRD 终审（`confirmation`）、含警告的执行计划审查、运行期计划修订与最终交付时请求人工拍板，中间研发切片自动推进。
- **`strict_audit`（高敏严审）：** 对应 `strict` 权限档，所有需求关卡、计划审查、每个阶段 QA 决策闸口、GhostNode 修订与交付均需人工显式签批，worker 并发 `2`。

所有可调参数均在 `CONTROL_SCHEMA_REGISTRY` 注册 `{ key, group, label, plainExplanation, runtimeEffect, riskLevel, defaultByPreset, editableWhileRunning }`。运行中执行 `switch_preset` 仅作用于后续新触发的关卡与调度波次，平滑排水超额槽位而不中断已运行节点，绝不静默批准已打开的人工关口，且不可更改 `executionMode`。

---

## 4. 上下文投射引擎（Right-Time Projection）

### 4.1 焦点视图投影（`GET /api/missions/:id/focus`）
基于索引化 SQLite 读取（`< 10ms`，不触发同步 `git` 进程）返回单一规范投影：
- `stage` / `stageProgress`：当前所处宏阶段与子步骤进度。
- `health`：`'flowing' | 'needs_you' | 'recovering' | 'completed' | 'failed' | 'aborted'`。
- `rehydration`：人脑艾宾浩斯重锚胶囊。**当记忆保留率 $R_{\text{human}} \ge 0.75$（热记忆）时严格为 `null`**，实现健康状态零打扰；仅在转冷（`delta_30s` / `deep_reanchor`）时展开增量变化与锁定决策。
- `primaryAction` / `pendingActionCount` / `secondaryActions`：并发多关卡（多仓或多议题）全部可见而不被遮蔽，焦点高亮最高优先级的哈希绑定 `MissionGateRecord`，每个可选项附带下游影响预览 `consequencePreview`。
- `availableControls`：列出全部运行期控制指令（`start`, `pause`, `resume`, `retry_node`, `rewind_checkpoint`, `amend_ghost`, `switch_preset`, `escalate_triage`, `evolve_baseline`, `abort`）的当前合法性 `enabled`、禁用原因 `disabledReason` 与影响说明 `impactSummary`。
- `explainability`：当前步骤目的、阻塞/等待原因、激活的 DDD 术语及召回的 Hindsight 历史记忆。
- `progressivePanels`：按 L1（摘要与当前决策）、L2（双生图/Diff/日志/追踪矩阵）、L3（原始对话轨迹/记忆图谱/Outbox 队列/控制参数表）逐层披露。

### 4.2 哈希绑定幂等决策与 CAS 控制平面
- `POST /api/missions/:id/decisions`：强制校验 `{ gateId, targetId, targetHash, idempotencyKey, actor, action, feedback, scope, issueIds }`，采用规范 JSON SHA-256 校验幂等性（同 key 同摘要返回缓存 `200`，同 key 异载荷返回 `409 IDEMPOTENCY_CONFLICT`，版本过期返回 `409 CONFLICT`），彻底废除字符串模糊匹配。
- `POST /api/missions/:id/control`：基于 `(id, version)` 乐观 CAS 执行控制操作，并写入防篡改哈希链事件日志 `mission_events`。

---

## 5. 统一 HAMA-Loop 需求工程引擎（`src/requirements/`）

原生运行于主 SQLite 事务引擎内，取消独立工作区与伪文档节点包装：
1. **`intake`**：将原始想法与参考文档拆分为互不重复的基础需求与证据类型（`user_fact | document_fact | agent_inference | assumption`），构建带环路检测的 `dependency_map` 并识别关键澄清问题。自动注入 Hub `agent-wiki`、DDD 术语与 `Hindsight.recall()` 历史经验。
2. **`clarify`**：存在 `critical: true` 未知项时开启人工澄清关口。
3. **`discuss`（无依赖议题并发波次 + 事务性看板归约 + A 回路）**：
   - 主持人排期后，彼此间无 `depends_on | prerequisite | conflict` 边的基础议题并发执行 `propose -> cross-critique -> refine`。
   - 并发节点只写各自 `issueId` 隔离的草案/讨论工件；**单一同步事务归约器**在 `store.atomic()` 内合并更新 `issue_board` 与 `dependency_map`。若本波次新发现了连接同波次两议题的冲突或依赖，自动重开下游议题执行一轮对齐讨论。
4. **`integrate`**：Consensus Agent 综合形成带稳定 `scopeKey`（及演进时的 `supersedesScopeKey`）的候选方案，立即执行 DDD 禁用同义词校验。
5. **`eval-{value, feasibility, completeness, risk}` + `evaluation`（B 回路）**：
   - 四维并发只读独立评审；严重度代数 `veto | blocking | condition | uncertain | informational`。`condition` 与 `uncertain` 均必须写明责任人与可核验问题。`veto` 不可被均值抵消，强制升级人工裁决。
6. **`approval` 与强制 `conditions` 二次释放闸门**：`conditional_pass` 方案仅允许 `conditional_approve | request_changes | reject`，附条件批准后必须通过 `conditions` 闸口解除附加条件方可生成 PRD。
7. **`prd` -> `confirm` -> `publish`（C 回路 + 评论处置台账 + 不可变基线）**：
   - 每个 `scopeKey` 严格对应一条稳定 ID 需求（`FR-<sha256>` / `NFR-<sha256>`）及 Given/When/Then `AC-<sha256>`。
   - **独立返工预算计数：** `proposalReworkCount`（方案级返工）与 `prdLocalEditCount`（局部 PRD 修订）分账统计。
   - **评论与处置台账（`hama_comments`）：** 支持 `open | accepted | changed | rejected | deferred`；Agent 禁止将人工提出的 `blocking` 评论标记为 `rejected` 或 `deferred`；`publish()` 在插入 `approved_baselines` 的同一原子事务内强制断言零未关闭 `blocking` 评论。
   - `approved_baselines` 受 SQLite `BEFORE UPDATE/DELETE RAISE(ABORT)` 触发器保护。
   - 基线演进 `v1 -> v2` 通过 `analyzeBaselineImpact()` 比对新增/变更/更名/删除的 FR 与 AC，精准标记受影响及可复用的已认证节点。

---

## 6. Hindsight × 艾宾浩斯统一记忆引擎（`src/memory/`）

### 6.1 三层持久化与四路并行索引
1. **Layer 1（行不可变源）**：`memory_documents`（按 `(hub_id, execution_mode, content_sha256)` 去重并追加 `referenced_in` 图边）与 `memory_chunks` + `memory_chunks_fts`（内置中英双语分词器：保留原标识符、切分 `camelCase/snake_case`、生成重叠汉字二元组 bigram）。
2. **Layer 2（声明不可变事实 + 活性观察 + 四大索引）**：
   - `memory_facts`：触发器禁止 `DELETE` 及篡改 `claim/kind/hub_id/source_document_id/event_start_at/ingested_at/execution_mode`，仅允许演化 `valid_until`、`superseded_by_fact_id`、`stability_hours`、`recall_count`、`last_recalled_at` 与 `consolidated`。
   - `memory_observations`：聚合观点记录（`active | contested | superseded | retired`）与完整 `history_json` 演化轨迹；FTS5 触发器仅监听文本列更新（避免每次读取 `recall_count += 1` 触发重建索引）。
   - **四大正交索引**：FTS5 BM25 关键词索引、Float32 向量索引（本地 128 维确定性随机投影 `local-rp-128` + 可选 `/v1/embeddings` 按 `embedding_space` 隔离检索与有界 LRU 缓存）、规范化别名实体图索引（支持 2 跳扩散激活）与时间范围索引。
3. **Layer 3（活性综合文档 `memory_living_docs`）**：统一承载 `mental_model | agent_wiki | ddd_map | pitfall_runbook | baseline_changelog`，由 `OutboxWorker` 异步经 `reflect()` 刷新。

### 6.2 `retain` / `recall` / `reflect` 与两阶段后台整合
- **权威写入门槛**：内核权威事件写入 `L3_locked`，门禁与复盘写入 `L2_verified`，Agent MCP `forge_memory_retain` 严格限权为 `L1_observed`（单切片最多 5 次，置信度上限 `0.65`，绝不覆盖更高等级观察）。
- **四路 RRF 融合 `recall()`**：以倒数排名融合（RRF）结合艾宾浩斯保留率 $R(t) = \exp(-\Delta t / S)$ 与权威权重加权输出，附精确源码分块出处与演化历史；被否决方案以 `rejected_option` 显式警示。
- **两阶段后台整合**：Stage A 仅对单值槽位键（`ddd:*`, `req:*`, `repo:*`, `decision:*`, `constitution:*`）执行自动时态覆盖并保留双事实；多值经验按语义相似度协同强化或并存；Stage B 在 `live` 模式下对模糊区间调用严格 Schema 模型归类并触发过期文档刷新。
- **人类艾宾浩斯重锚**：直接从 SQLite 增量统计的 `lines_added + lines_deleted`、已认证任务数、GhostNode、修订观察数与 ADR 更新计算遗忘曲线，零同步 Git 进程开销。

---

## 7. 强化 SDD 并行编排、沙箱隔离与失败闭环认证

1. **规格编译器 + 三级校验 + 静态并发试跑**：`SpecCompiler` 按多仓拓扑顺序生成带 `dependsOnChangeIds`、`requirementRefs`、`acceptanceRefs`、`planningRationale` 与 I/O 契约的 Twin-Graph；`SpecValidator` 执行 L1（图无环/可达/跨仓拓扑）、L2（100% `must` FR/AC 覆盖与 DDD 合规）与 L3（适配器健康、并行 `fileScope` 冲突检测、策略合规）校验；`TrialSimulator` 静态推演并发波次与关键路径。
2. **阶段内并行波次调度 + `execution_epoch` 代际围栏**：同阶段内互不重叠 `fileScope` 的就绪任务并发执行（空 `fileScope` 独占工作树）；单层 `ResourceSlotBroker` 仅在叶子适配器调用持锁并响应 `AbortSignal`；所有成本累加、早停计数、节点状态、`GhostNode` 拼接（`spliceGhostNodeAtomic`）与持久化的 `change_epistemic_items` / `FailureForensicsCard` 均带 `executionEpoch` 校验原子的写入。
3. **阶段屏障回退（Phase-Barrier Rewind）**：单任务重试仅恢复自身 `fileScope` 而不波及并行兄弟任务；任何 `Restore` 或人工回退均先中止并排空在途 Worker、递增 `executionEpoch`、获取按 `--git-common-dir` 键控的仓库互斥锁、创建 `refs/forgeops-backup` 救援引用并复位至目标检查点，同时按 `computePhaseBarrierRewindSet` 同步重置磁盘上被撤销的下游节点状态。
4. **跨仓两阶段交付与上游失效检测**：所有 Change 均保留在 `forgeops/*` 隔离分支直至全部认证且通过零工作树修改的 `git merge-tree --write-tree` 冲突预检；上游 Change 认证 HEAD 变更时自动将下游 Change 标记为 `stale_upstream`。
5. **沙箱与认证零漏洞加固**：`diffSinceCommit` 全程只读（`core.quotePath=false` + `-z` + 纯 Node 未跟踪文件 diff 生成）；`resolveInside` 阻断任意层级 `.git`、尾部点/空格、NTFS ADS 与保留设备名；Git 提交使用 `-c user.name=...` 零本地配置污染；Windows `.cmd` 自动解包直启 `node.exe` 且长 Prompt 走 `stdinText`；认证器采用文件感知 32KB Diff 切片、随机 XML nonce 防注入围栏与逐条 AC 结构化验证，并在 `live` 模式下严格 Fail-Closed。
6. **哈希链事件日志与离线可验证证据包**：`mission_events` 维护 SHA-256 哈希链，`exportEvidenceBundle` 导出完整 `Intent -> Baseline -> FR/AC -> Node -> Commit -> Gate -> QA -> MergeReadiness` 追踪矩阵，可由 `verifyEvidenceBundle` 离线校验防篡改。

---

## 8. 数据库迁移（`SCHEMA_VERSION = 3`）与全量 HTTP/SSE 接口

- **幂等启动迁移**：`ForgeStore` 初始化时启用 WAL 与 `busy_timeout = 5000`，检测 `meta_kv.schema_version`：新库创建完整 v3 表与触发器；v1/v2 存量库在单事务内通过 `hasColumn` 检查补齐新列、建新表与索引，并将历史 `semantic_memories` 迁移至 Hindsight 三层结构。
- **v3 核心接口**（回环端口 + 256-bit Bearer 鉴权，CORS 严格限定回环与 Electron `null` 源）：
  - `GET /api/schema/controls`
  - `POST /api/missions` · `GET /api/missions` · `GET /api/missions/:id` · `GET /api/missions/:id/focus`
  - `POST /api/missions/:id/decisions` · `POST /api/missions/:id/control`
  - `GET /api/missions/:id/hama` · `POST /api/missions/:id/comments` · `POST /api/missions/:id/comments/:commentId/disposition`
  - `GET /api/missions/:id/traceability` · `GET /api/missions/:id/evidence` · `GET /api/missions/:id/events` · `GET /api/missions/:id/readiness`
  - `GET /api/baselines` · `GET /api/baselines/:baselineId` · `POST /api/baselines/:baselineId/impact`
  - `POST /api/memory/retain` · `POST /api/memory/recall` · `POST /api/memory/reflect` · `GET /api/memory/living-docs` · `GET /api/memory/observations` · `GET /api/memory/graph`
  - `GET /api/infra/outbox`
  - 全量向后兼容原有 `/api/bootstrap`、`/api/hubs`、`/api/repositories`、`/api/domain-terms`、`/api/changes/*`、`/api/attention/*`、`/api/rooms/*`、`/api/infra/*` 与 `/api/events` SSE 推送。

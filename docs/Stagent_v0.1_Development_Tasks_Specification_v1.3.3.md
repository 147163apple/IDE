# Stagent v0.1 研发任务拆解与工程执行规范 (v1.3.3 Vibe 模式与成熟 Agent 接入校准版)

> **v1.3.3 第二轮修订（2026-10-20，依据文档审查意见 8 条）**：
> 1. **(P1) DAG 与 Sprint 对齐**：Sprint 表按 JSON 边重排——`TASK-P.1`、`TASK-W.3`→`TASK-W.4`、`TASK-C.5` 全部前移至 Sprint 2，`TASK-D.2`（一键合并）后移至 Sprint 3，确保其前置依赖先完成；同步修正 C.3（移除已删除的 `C.2` 依赖）与 C.5（移除已推迟的 `C.4` 依赖）任务卡，使卡片与 JSON 边一致。
> 2. **(P1) 拆分 S.2**：v0.1 仅保留「按需合同草案生成（L0 规则 / L1 强模型）」；成熟度评分、HUD 徽章、风险气泡、Snooze、`SUPERVISOR_MATURITY_UPDATED` 帧统一移至 v0.2+。
> 3. **(P1) 完成状态如实化**：S.1 改为 `[PARTIAL]`（旧版已在 main `1a75616`，v1.3.3 增量未完成）；S.2/S.3 改为 `[REWORK]`（旧设计实现仅存于未合并分支 `wip/s2-s3-supervisor-old-design`，非 v0.1 验收依据），原测试数记录降级为「历史记录」。
> 4. **(P1) S.3 范围**：S.3 整体推迟 v0.2+，仅脱敏模块 `src/lib/ipc/redaction.ts` 作为 v0.1 保留范围（随 S.2 精简版移植）；C.2 不再依赖 S.3。
> 5. **(P2) 审批措辞**（架构规范 §2.2/§7.2）：区分「建议采纳」「合同生成与 Schema 校验」「合同授权」，仅保护清单命中需一次是/否。
> 6. **(P2) C.2 收窄**：v0.1 仅交付最小 Studio / 合同审阅 + 保护清单命中白话确认卡 + 模式指示；徽章/Snooze/风险气泡移至 v0.2+，不作前置验收。
> 7. **(P2) RFC §1.1 基线引用**改为 v1.3.3。
> 8. **(P2) 版本标注**：任务总表列头改为 v1.3.3；文件名待统一更名为 `*_v1.3.3.md`。

> **文档定位与最高基准**：本规范以《Stagent 系统架构设计规范 (v1.3.3 Vibe 模式、全局保护清单与成熟 Agent 接入校准版)》为唯一法典事实源。
> **代码基线事实**：以本地仓库当前测试基线为物理起点（测试文件与用例数量**以最新一次 CI 实际运行结果为准并附提交哈希**，本规范不再写死数字；既有底座包含 Git Worktree 物理隔离、Scoped MCP 网关、白名单受限执行、跨平台进程树全回收、Test Integrity Guard、TOCTOU 快照校验与自愈底座，以及 TASK-0.2b Schema v1.2.0 与 TASK-D.1 安全通信桥）。
> **核心修订成果 (v1.3.3，依据《三份规范文档综合审查与修订指令》2026-10-20)**：
> 1. **双轨 Worker 演进路线**：保留自研 API Worker（`ai-worker.ts`）作为保底基线与测试替身；新增 **TASK-W.5 成熟 Agent 适配器**（W.5a Claude Code / W.5b cursor-agent / W.5c OpenHands），统一经 `daemon/worker/cli-host/` 专用子进程隔离模块挂载（全仓唯一允许 spawn 的位置，强制 `shell:false` + 进程树托管）；Claude Code 优先保留原生工具 + 官方 Pre-tool hook 配合网关拦截。所有成熟 Agent 能力声明统一「待实机验证（verified_on: 空）」，实测通过后方标受控。
> 2. **Vibe 模式安全网**：新增 **TASK-P.1 全局保护清单与 Vibe 安全网**（`.stagent/protection.json`、Auto-Checkpoint、【撤销本轮改动】、静默合同、User-First Discard 冲突仲裁）。
> 3. **右栏会话承载**：新增 **TASK-C.6 右栏 Agent 会话**（流式渲染、工具卡片、打断、续接、Adapter 切换）。
> 4. **审批减负**：D.2 删除 Gate 5 二次确认弹窗改一键合并；合同与保护清单无交集自动批准；未触保护区预算追加/resume 不重批；S.1 移除默认 3s 防抖轮询、Supervisor 独立预算分账。
> 5. **排期去过载与阶段解耦**：Sprint 1 聚焦最小端到端（C.1 + C.3 + C.6 + W.5a）；Sprint 2 保护清单 + 快照撤销 + Diff + 受控执行前置（W.3/W.4）；Sprint 3 Claude Code 绕过负例实测收尾 + 一键合并（第二轮修订重排）；架构雷达（B.1/C.4）、成熟度评分、RFC-2026-002 整体推迟至 v0.2+ 另行立项。
>
> **v1.3.2 历史修订成果（存档）**：
> 1. **彻底闭环错误码与预算契约 (闭环 P1-N1 / P1-N2)**：对齐法典 A §6.4(3) 超时分列错误码（`E_COMMAND_TIMEOUT` / `E_TASK_TIMEOUT`）；对齐法典 A §9.1 `budget_limits` 增补的 `max_command_executions?` 与 `max_tool_calls?` 可选预算字段，使 TASK-W.3 与 0.2b 命令/工具调用计数熔断断言完全合法自洽。
> 2. **完善工作区与并发互斥锁双向断言 (闭环 P2-R5)**：在 §1.1 与 TASK-D.1 补齐存活 PID 锁冲突抛出 `E_WORKSPACE_LOCKED` 断言；与 TASK-D.2 (G-21) 运行时并发互斥锁协同闭环。
> 3. **严密化 Supervisor 节流门禁 (闭环 P2-R6)**：在 TASK-S.1 的 PASS 验收判据显式收录 3s Debounce、三类合法唤醒时机以及“Worker 流式期间零模型调用”断言，确保工程落地不可旁路。
> 4. **统一 Watcher 性能与合并兜底口径 (闭环 P2-R3)**：同步更新 TASK-B.2 核心目标、PASS 判据与 Sprint 5 门禁，消除硬性“50ms”与架构法典的脱节，统一定义为“watcher debounce 窗口内触发（性能目标 ≤50ms）+ 合并前指纹复核兜底”。
> 5. **消除历史陈旧噪音与工件对齐 (闭环 P2-R1 / P2-R2 / P2-R4 / P2-R7 / P2-R8)**：清除 0.2b 重复括号与分支数量矛盾；清除 D.1 文件列表中无意义的相同新旧路径注记；在 DAG ASCII 图中补齐 `S.3 ──► C.2` 与 `B.1 ──► C.4` 依赖边，规范化 JSON 边清单排版；矩阵列头校准为 `(v1.3.2)`，统领全流程 7 个敏捷 Sprint（Sprint 1~4 为控制面与受控编辑 MVP，Sprint 5~7 为架构雷达、物理合并门禁与全流程自举）。

---

## 1. 任务体系与研发全景矩阵 (Engineering Matrix)

### 1.1 研发任务与规范 §10 路线映射表 (v1.3.3：18 项底座 + 5 项新增)

> **测试数量口径（v1.3.3 统一）**：各任务卡「完成记录」中的文件/用例数为其交付当日的历史快照，仅供溯源；**当前有效基线一律以最新一次 CI 实际运行结果为准并附提交哈希**。

| 任务编号 | 任务名称 | 归属模块 | 状态 | 规范 §10 里程碑 | 关键变动与工程闭环要点 (v1.3.3) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-0.1** | 工程锁文件与跨平台 CI 自动化基线 | 基础设施 | **[COMPLETED]** | P0 基础设施 | 依赖锁死、`verify-env.mjs` 门禁脚本、跨平台环境校验已就绪。 |
| **TASK-0.2b** | Schema v1.2.0 增量演进、双状态机联动与存量迁移 | 数据模型 | **[COMPLETED]**（提交 `52c807c`；全量 48 文件 / 377 用例绿，typecheck/lint 通过；v1.3.2 增补第 4 条 PREPARING 回退断言与 G-09 记账规范映射） | P0 契约底座 | • 升级 `SoftwareContractV12` 与 `EvidenceBundleV11` 完整字段<br>• 实现 `validateStatePair`、`validateTransition` 与原子落盘<br>• 承接 v1.1.3 历史合同迁移与备份机制<br>• 15 ➔ 10 ErrorCode Catalog 全量映射（新增 `tests/unit/error-codes-mapping.test.ts`，G-15）<br>• 状态矩阵增补 4 条分支断言（`ABORTED+APPROVED`、拒绝后禁止回 DRAFT、ABORTED 终态、PREPARING 中断回退原子回置 `PENDING_REVIEW`，G-17）<br>• 账本持久化、模型切换不清零、命令/工具分列记账与熔断断言 (G-09) |
| **TASK-D.1** | CLI 引导入口与安全 WebSocket 通信桥 | 通信核销 | **[COMPLETED]**（2026-10-20；48 文件 / 377 用例全绿，含首帧 50ms 切断、Token 轮换、Origin/Host/2MB/速率/心跳断言） | P1 通信鉴权 | • 提前至 Sprint 1 解除 DAG 死锁<br>• CLI `stagent start`、动态端口 (3001~3010)、PID 锁与 Token 轮换 (G-13)<br>• 检测到存活 PID 锁时抛出 `E_WORKSPACE_LOCKED` 拒绝重复绑定工作区<br>• 首帧 AUTH 握手鉴权、非法以 `4401` 关闭<br>• 规范帧字典（同时保留 `EVIDENCE_READY`、`EVIDENCE_STATUS_CHANGED`、`TERMINAL_STREAM`，G-02）<br>• 补齐 Origin 校验、帧大小（≤2MB）与速率限制（G-12）、失联 3 次心跳遮罩 (G-13) |
| **TASK-A.1** | Git Worktree 物理隔离与生命周期管理 | 执行内核 | **[COMPLETED]** | P1 本地 Git | Worktree 创建、销毁、分支保护与 `.git/info/exclude` 隔离就绪。 |
| **TASK-A.2** | Scoped MCP 工具网关与路径沙箱校验 | 执行内核 | **[COMPLETED]** | P2 安全网关 | 路径防逃逸、Scope 读写授权、禁区强拦截与环境脱敏就绪。 |
| **TASK-A.3** | 依赖分级复用与工作区构建缓存隔离 | 执行内核 | **[COMPLETED]** | P1 依赖隔离 | 只读依赖复用 (ADR-002)、构建缓存目录隔离与符号链接降级就绪。 |
| **TASK-A.4** | 受限进程执行器与跨平台进程树全回收 | 执行内核 | **[COMPLETED]** | P2 进程执行 | 白名单命令执行、POSIX 进程组 / Windows taskkill 回收就绪。 |
| **TASK-A.5** | 循环重试熔断与费用/Token 硬上限监控 | 执行内核 | **[COMPLETED]** | P2 熔断守护 | 验证重试熔断 (`max_verification_retries: 3`)、超时与费用预检就绪。 |
| **TASK-A.6** | Daemon 崩溃自愈、Git 锁清理与 TOCTOU 校验 | 执行内核 | **[COMPLETED]** | P1 崩溃自愈 | 孤儿锁安全回收、`resume()` 扫描自愈、快照指纹校验就绪。 |
| **TASK-S.1** | Supervisor 建议会话与持久化存储管理 | 建议中枢 | **[PARTIAL]**（旧版 S.1 已在 main，提交 `1a75616`；v1.3.3 增量——独立预算、规则优先 L0/L1、默认关闭 3s 防抖——**待完成**） | P4 智能建议 | • Local-First 会话落盘 (`.stagent/sessions/`)、Prompt Pipeline<br>• 依赖层静态 AST 扫描禁令 + **运行时越权调用拦截正例断言 (G-11b)**<br>• **[待完成·v1.3.3]** 独立日预算分账 `.stagent/supervisor-budget.json` (超限拒绝模型调用且不侵占 Worker)<br>• **[待完成·v1.3.3]** 规则优先 L0/L1；唤醒节流器 3s Debounce **默认关闭**（旧版节流器默认开启，专用用例 18 个为历史记录） |
| **TASK-S.2** | 按需合同草案生成（L0 规则 / L1 强模型） | 建议中枢 | **[REWORK]**（旧设计实现存于未合并分支 `wip/s2-s3-supervisor-old-design`，**非 v0.1 验收依据**） | P4 合同草案 | • **v0.1**：用户显式请求或事件触发时按需生成草案，L0 规则优先、L1 强模型按需；白话文案<br>• 草案全字段生成 (含必填 `worker_spec`)<br>• **断言未决问题 100% 保留至草案元数据供用户确认 (G-11)**<br>• 移植保留脱敏模块 `src/lib/ipc/redaction.ts`<br>• **v0.2+**：成熟度评分（原 4 维评估器）推迟 `[D4]` |
| **TASK-S.3** | Supervisor HUD 建议流与 WebSocket 广播 | 建议中枢 | **[DEFERRED → v0.2+]** / **[REWORK]**（旧设计实现存于未合并分支 `wip/s2-s3-supervisor-old-design`，**非 v0.1 验收依据**） | P4 HUD 广播 | • v0.2+：WebSocket 建议帧广播（`MATURITY_UPDATED` / `DRAFT_PROPOSED` / `STATUS_CHANGED`）、ACCEPT/SNOOZE/DISMISS 上行 action<br>• **v0.1 保留范围**：仅脱敏模块 `redaction.ts`（并入 S.2 精简版移植）；鉴权连接过滤原则不变 |
| **TASK-W.1** | Coding Worker 适配器抽象与任务指令装配 | 编码内核 | **[COMPLETED]** | P2 Worker 适配 | • 统一 `CodingWorkerAdapter` 接口，支持 Managed AI / CLI<br>• **`AdapterCapabilityDeclaration` 补齐第 9 项 `known_limitations` (G-10)**<br>• 区分 `GATEWAY_ENFORCED` 与 `UNCONTROLLED_EXTERNAL`，默认拒绝未知能力<br>• 合同上下文装配 + Worktree 隔离校验，专用用例 34 个 |
| **TASK-W.2** | Scoped Gateway 强制工具注入与执行拦截 | 编码内核 | **[COMPLETED]** | P2 工具管辖 | • 统一为 `stagent_*` 命名空间 5 工具（含 `delete_file` / `list_directory`）<br>• **`stagent_write_file` 的 `expected_hash?` 乐观锁（G-03），失配 `E_CONFLICT`**<br>• **强制结构化 argv 且 `shell:false`，字面量拦截注入符号 (G-04)**<br>• 越界/禁区阻断并标记 `BLOCKED`，专用用例 29 个 |
| **TASK-W.3** | 测试环境、秘密脱敏与网络/端口策略守卫 | 编码内核 | **[NEW_TASK]** | P2 环境网络 | • 环境变量白名单过滤、`CI=true` 注入、`env_file_grants` 按命令授权<br>• **秘密遮蔽严密发生在日志截断之前**<br>• 网络策略拦截 (`DENY` / `EXPLICIT_TARGETS` / `USER_APPROVED`)、动态端口 |
| **TASK-W.4** | 高风险执行威胁守卫与运行时能力复检 (闭环 G-01 & G-20) | 编码内核 | **[NEW_TASK]** | P2 安全威胁 | • **闭环 G-01 & G-20**：落地 `daemon/worker/threat-guard.ts`<br>• 命令 argv 与仓库信任检查，高风险特权命令抛 `E_UNSAFE_EXECUTION` 并阻断<br>• 会话期周期性复检，检测到绕过立即降级为 `UNCONTROLLED_EXTERNAL` 并阻断 Evidence<br>• **落实 4 类绕过路径不可用负例断言** |
| **TASK-B.1** | 本地 AST 增量依赖图分析引擎 | 架构感知 | **[DEFERRED → v0.2+]** `[用户已确认 D4 · 2026-10-20]` | A §3 架构引擎 | • **统一路径前缀：`src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}` (G-16)**<br>• 冷启动 ≤1.5s，单文件增量修补 ≤20ms |
| **TASK-B.2** | 多活跃 Worktree 监听与 Evidence 状态联动 | 架构感知 | **[DEFERRED → v0.2+]** `[用户已确认 D4 · 2026-10-20]` | P4 状态失效 | • 扩展多活跃 Worktree 监听，排除 `.git`/`.stagent`/`dist` 等<br>• 外部变更在 watcher debounce 窗口内（性能目标 ≤50ms）触发 Evidence `STALE` 并广播 `EVIDENCE_STATUS_CHANGED`；合并前指纹复核兜底 |
| **TASK-C.1** | Cursor 式三栏 IDE 响应式工作台骨架与 Studio 视口 | 前端呈现 | **[NEW_TASK]** | P3 工作台闭环 | • 左侧文件树/Git 状态、中栏多标签、右栏双 Agent 对话<br>• **Header 补齐：模式（探索/合同执行）、Worker 受控徽标、当前任务分支 (G-06)**<br>• **审批后默认绑定合同 Worktree，主树编辑显式切换提示 (G-18)** |
| **TASK-C.2** | 中栏 Supervisor Studio 标签页与合同审阅面板（v0.1 精简版） | 前端呈现 | **[NEW_TASK]** | P4 审批界面 | • v0.1：Studio Tab 合同审阅（Scope、预算、验证命令、未决问题）、保护清单命中时白话是/否确认卡、模式指示<br>• 无交集合同由 Daemon 自动批准，前端不弹窗<br>• v0.2+：HUD 成熟度徽章、风险气泡、Snooze |
| **TASK-C.3** | Monaco 核心编辑器集成与受控 Worktree 读写 | 前端呈现 | **[NEW_TASK]** | P3 代码编辑 | • Monaco Editor 嵌入，可写/只读视觉区分，**编辑器内 Evidence STALE 指示 (G-18)**<br>• 服务端保存校验：`POST /api/worktree/files` 越权写入由 Daemon 403 拒绝 |
| **TASK-C.4** | 架构雷达视图与 Scope 圈选抽屉 | 前端呈现 | **[DEFERRED → v0.2+]** `[用户已确认 D4 · 2026-10-20]` | P3 架构雷达 | • 1000 节点拓扑渲染 (≤16ms patch, ≤30MB 内存)<br>• 交互式 Scope 圈选，已批准合同圈选禁止原地扩权 |
| **TASK-C.5** | 双栏 Diff 审阅器与结构化终端日志回放 | 前端呈现 | **[NEW_TASK]** | P3 差异终端 | • 双栏/内联 Git Diff 审阅<br>• 结构化终端流式日志展示、ANSI 渲染、先脱敏后截断 |
| **TASK-D.2** | 控制面 API 补齐、六大合并门禁与 Git Trailer 审计 | 通信核销 | **[INCREMENTAL_UPGRADE]** | P5 核销合并 | • 提供 `POST /api/contracts/:id/approve` (防 TOCTOU)<br>• `resume` 提供**双路径裁决负例断言** (违规返回 409，G-14)<br>• **并发互斥锁守卫**：同合同 execute/resume/abort/merge 冲突返回 409 / `E_WORKSPACE_LOCKED` 并生成 BLOCKED Evidence (G-21)<br>• **合并成功后原子落盘合同与证据快照至 `.stagent/` 目录 (G-05)**<br>• 对齐 A §5.2 的 4 个 Git Trailer，执行合并门禁（**v1.3.3**：删除 Gate 5 二次确认弹窗改一键合并，保留 Gate 0~4 与后台指纹复核；冲突按 User-First Discard 仲裁） |
| **TASK-E.1** | 双 Agent 协同与全流程 E2E 自动化测试 | 集成测试 | **[NEW_TASK]** | P6 集成自举 | • 覆盖 Happy Path 全生命周期无人值守自动化回归<br>• **覆盖 8 类故障分支（含 4 类授权不变式与非受控隔离，G-07）** |
| **TASK-E.2** | Stagent 仓库自举 (Dogfooding) 与发版交付 | 交付发版 | **[NEW_TASK]** | P6 真实验证 | 真实仓库自举演练、用量与已知限制客观报告、生产打包构建。 |
| **TASK-P.1** | 全局保护清单与 Vibe 模式安全网 | 安全与体验 | **[NEW_TASK]** (v1.3.3) | P3.5 保护清单 | `.stagent/protection.json`、首导入推荐卡片、Auto-Checkpoint、【撤销本轮改动】、静默合同、User-First Discard 冲突仲裁。 |
| **TASK-C.6** | 右栏 Agent 流式会话与打断续接 | 前端呈现 | **[NEW_TASK]** (v1.3.3) | P3 会话闭环 | 流式渲染、工具卡片、Stop/打断、排队追加、Adapter 切换、会话列表与 resume（映射 CLI 原生会话 ID）。 |
| **TASK-W.5a** | Claude Code 适配器（cli-host 黑盒实测） | 编码内核 | **[NEW_TASK]** (v1.3.3) | P5.5 受控实测 | cli-host spawn 挂载、Pre-tool hook 拦截、Headless 结构化输出、会话续接；4 类绕过负例实测。 |
| **TASK-W.5b** | cursor-agent 适配器（cli-host 黑盒实测） | 编码内核 | **[NEW_TASK]** (v1.3.3) | P5.5 受控实测 | 权限 deny 实测；不能完全关闭原生写能力则仅登记 `UNCONTROLLED_EXTERNAL`（仅 Vibe）。 |
| **TASK-W.5c** | OpenHands 适配器（容器隔离） | 编码内核 | **[NEW_TASK]** (v1.3.3) | P5.5 受控实测 | 容器内仅挂载任务 Worktree；`control_mode = SANDBOX_ENFORCED`。 |

---

## 2. 关键路径与 DAG 拓扑依赖 (Critical Path DAG，v1.3.3 重排)

> **v1.3.3 重排说明**：① 删除 `C.2→C.3`、`C.3→C.4`、`C.4→C.5` 串行链（无技术必要），C.3/C.5 仅依赖 C.1；② 新增 P.1、C.6、W.5a/b/c；③ B.1/B.2/C.4（架构雷达与监听联动）整体推迟至 v0.2+，不再构成 D.2 前置；④ C.2（Studio 精简版）后移至 Sprint 4；S.3（建议广播）推迟 v0.2+，C.2 不依赖 S.3；⑤ **第二轮修订**：Sprint 表按 JSON 边重排，D.2 的三条前置（C.5、P.1、W.4）均在 Sprint 2 完成，D.2 落 Sprint 3；C.3/C.5 任务卡的前置依赖同步修正为仅依赖 C.1（及已完成底座）。

### 2.1 依赖关系与机器可读边清单 (Machine-Readable Edges)

```
TASK-0.1 ──► TASK-0.2b ──► TASK-D.1 ──► TASK-C.1 (三栏骨架)
                             │              │
                             │              ├──► TASK-C.3 (Monaco 读写)
                             │              ├──► TASK-C.6 (右栏流式会话)
                             │              └──► TASK-C.5 (Diff 与终端)
                             │
                             ├──► TASK-W.1 (Worker 适配, COMPLETED)
                             │         │
                             │         ▼
                             │    TASK-W.2 (Gateway, COMPLETED) ──► TASK-W.3 ──► TASK-W.4
                             │         │
                             │         ▼
                             │    TASK-W.5a (Claude Code cli-host 实测) ──► TASK-W.5b / TASK-W.5c
                             │
                             └──► TASK-P.1 (保护清单 + Vibe 安全网)

  TASK-C.5 + TASK-P.1 + TASK-W.4 ──► TASK-D.2 (一键合并与门禁)
                                            │
   TASK-S.1 ──► TASK-S.2 (L0/L1 精简) ──► TASK-C.2 (Studio 精简版)
                                            │
                                            ▼
                                      TASK-E.1 ──► TASK-E.2

  (v0.2+ 推迟支线：TASK-B.1 ──► TASK-B.2；TASK-B.1 ──► TASK-C.4；TASK-S.2 ──► TASK-S.3 广播与成熟度评分)
```

> **拓扑边与底座依赖说明**：上述拓扑图与 JSON 边列表呈现 v0.1 关键路径主拓扑；已完成的历史执行内核底座（TASK-A.1~A.6）作为前置约束由各具体任务卡片显式引用与静态守卫。**依赖关系的权威事实源为下方 JSON 边清单与各任务卡「前置依赖」字段，ASCII 图仅为示意。**

**机器可读拓扑边列表 (JSON Edges)**：
```json
[
  { "from": "TASK-0.1", "to": "TASK-0.2b" },
  { "from": "TASK-0.2b", "to": "TASK-D.1" },
  { "from": "TASK-D.1", "to": "TASK-C.1" },
  { "from": "TASK-C.1", "to": "TASK-C.3" },
  { "from": "TASK-C.1", "to": "TASK-C.6" },
  { "from": "TASK-C.1", "to": "TASK-C.5" },
  { "from": "TASK-D.1", "to": "TASK-W.1" },
  { "from": "TASK-W.1", "to": "TASK-W.2" },
  { "from": "TASK-W.2", "to": "TASK-W.3" },
  { "from": "TASK-W.3", "to": "TASK-W.4" },
  { "from": "TASK-W.2", "to": "TASK-W.5a" },
  { "from": "TASK-W.5a", "to": "TASK-W.5b" },
  { "from": "TASK-W.5a", "to": "TASK-W.5c" },
  { "from": "TASK-D.1", "to": "TASK-P.1" },
  { "from": "TASK-C.5", "to": "TASK-D.2" },
  { "from": "TASK-P.1", "to": "TASK-D.2" },
  { "from": "TASK-W.4", "to": "TASK-D.2" },
  { "from": "TASK-S.1", "to": "TASK-S.2" },
  { "from": "TASK-C.1", "to": "TASK-C.2" },
  { "from": "TASK-S.2", "to": "TASK-C.2" },
  { "from": "TASK-D.2", "to": "TASK-E.1" },
  { "from": "TASK-E.1", "to": "TASK-E.2" }
]
```

**v0.2+ 推迟边（存档，不进入当前关键路径）**：
```json
[
  { "from": "TASK-D.1", "to": "TASK-B.1" },
  { "from": "TASK-B.1", "to": "TASK-B.2" },
  { "from": "TASK-B.1", "to": "TASK-C.4" },
  { "from": "TASK-S.2", "to": "TASK-S.3" }
]
```
> 注：`S.2 → S.3` 仅为 v0.2+ 推迟边；v0.1 中 `TASK-C.2` 的前置仅为 `TASK-C.1` 与 `TASK-S.2`，不依赖 S.3。

---

## 3. 详细任务卡明细 (Task Cards)

### 3.1 契约基线与通信底座（已完成底座，Sprint 0）

#### 【Task 0.2b】Schema v1.2.0 增量演进、双状态机联动与存量迁移
* **任务编号**：`TASK-0.2b`
* **前置依赖**：`TASK-0.1` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-20 交付，提交 `52c807c` 锁定基线；v1.3.1/v1.3.2 增补第 4 条 PREPARING 回退断言与 G-09 分列记账规范映射——G-15 错误码映射测试为 v1.3.0 已交付内容，非本次新增。**v1.3.3 口径更正**：该卡交付当日的用例数为历史快照，当前有效基线以最新一次 CI 实际运行结果 + 提交哈希为准；增量断言验证记录随下一次回归运行一并存档，不再单列"待补录"状态）
* **v1.3.3 配套修订**：`budget_limits` 的 `max_command_executions` / `max_tool_calls` 与 `E_CONFLICT → WRITE_CONFLICT` 原因码调整需随架构规范 v1.3.3 同步（本轮仅改文档，代码变更另行排期）。
* **核心目标**：
  1. 升级 `SoftwareContractV12` 与 `EvidenceBundleV11` 完整定义，逐字段 100% 对齐 A §9.1/§9.2（含 `budget_limits` 可选 `max_command_executions` 与 `max_tool_calls`）。
  2. 落实 `can_merge` 派生不变式：`superRefine` 校验 `status === "PASSED"` 且无违规无超额；外部写入类型 `Omit<Verdict, "can_merge">`。
  3. 重构状态机校验器：实现 `validateStatePair` 与 `validateTransition`，落盘采用原子写入 (`writeTemp + fsync + rename`)。
  4. **补齐状态机 4 条关键分支断言 (G-17)**：
     - 正例：`ABORTED + APPROVED`（已批准后发生故障安全中止，保留历史审批记录）；
     - 负例：合同被拒绝 (`ABORTED + REJECTED`) 后不得原地回到 `DRAFT`；
     - 负例：`ABORTED` 为终态，不得经 `resume` 跃迁至 `EXECUTING`；
     - 异常回退联动：`PREPARING` 初始化异常中断时，lifecycle 回退 `PENDING_APPROVAL` 同步原子回置 `approval.status = "PENDING_REVIEW"`（杜绝以历史批准态静默重建 Worktree）。
  5. **补齐用量账本 3 项断言 (G-09)**：
     - 用量跨 Daemon 重启持久化重载一致；
     - 切换模型供应商后累计开销不清零；
     - 模型费用上限与命令/工具调用上限分列记账，独立触发熔断。
  6. **补齐 ErrorCode Catalog 完备性测试 (G-15)**：新建 `tests/unit/error-codes-mapping.test.ts`，表驱动测试 15 个 `error_code` 到 10 个 `reason_code` 的双向映射（新增 `E_UNSAFE_EXECUTION ➔ UNSAFE_EXECUTION`、`FRAME_DIRECTION_FORBIDDEN ➔ PROTOCOL_VIOLATION` 等）。
  7. 存量 v1.1.3 合同迁移工具：备份至 `.stagent/migrations/`，禁止静默执行，标记需显式重批。
* **涉及核心文件**：
  - 修改：`src/lib/contract.schema.ts`
  - 修改：`src/lib/evidence.schema.ts`
  - 新增：`src/lib/state-machine.ts`
  - 新增：`src/lib/error-codes.ts`
  - 新增：`src/lib/migration.ts`
  - 测试：`tests/unit/contract-schema-v12.test.ts`
  - 测试：`tests/unit/evidence-schema-v11.test.ts`
  - 测试：`tests/unit/state-machine-matrix.test.ts`
  - 新增测试：`tests/unit/error-codes-mapping.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - Schema 校验通过，`can_merge` 派生反向用例全部阻断成功。
    - `tests/unit/state-machine-matrix.test.ts` 完整通过 A §9.1.1 组合矩阵与 4 条新分支断言（含 PREPARING 初始化异常中断时，lifecycle 回退 `PENDING_APPROVAL` 同步原子回置 `approval.status = "PENDING_REVIEW"`，杜绝静默授权重建 Worktree）。
    - `tests/unit/error-codes-mapping.test.ts` 15 ➔ 10 双向映射 100% 通过。
    - 账本持久化与分列记账断言通过。
  - **FAIL**：缺少任一字段校验；状态机允许非法跃迁。

---

#### 【Task D.1】CLI 引导入口与安全 WebSocket 通信桥
* **任务编号**：`TASK-D.1`
* **前置依赖**：`TASK-0.2b`
* **任务状态**：**[COMPLETED]**（2026-10-20 交付；验证：`npm test` 全量 48 文件 / 377 用例绿、`tsc --noEmit` 0 错误、eslint 0 违规、verify-env 通过；变更明细与偏差记录见本节末尾「D.1 交付附注」）
* **核心目标**：
  1. CLI 工具 (`stagent start`)：动态端口 (3001~3010) 探测、PID 锁获取（若已被存活进程占用抛出 `E_WORKSPACE_LOCKED` 拒绝重复启动）、Token 写入 (`.stagent/session-token`，权限 `0600`) 并唤起浏览器。
  2. **首帧 AUTH 鉴权闭环**：首帧必须为 `{ type: "AUTH", payload: { token } }`，校验失败立即以关闭码 `4401` 断开连接，不产生无限重连；服务端日志严禁打印 Token 明文。
  3. **规范 WS 帧字典 (G-02)**：
     - 同时保留 `EVIDENCE_READY`（证据生成完成待核销）与 `EVIDENCE_STATUS_CHANGED`（状态流转与外部变动失效）以及 `TERMINAL_STREAM`（命令执行流式日志）。
  4. **补齐 Origin、速率与心跳防护 (G-12/G-13)**：
     - 校验 `Origin`，仅放行本地合法来源 (`http://127.0.0.1:*` / `http://localhost:*`)，拒绝非法来源；
     - 限制单连接帧大小 ≤ 2MB，限制连接频率防 DoS；
     - 客户端 5s 心跳 PING，连续 3 次未收到 PONG（15s）在前端呈现重连遮罩；
     - Daemon 获取 PID 锁后强制轮换 Token，崩溃残留旧 Token 自动失效。
* **涉及核心文件**（已按仓库实际布局修正，见文末「路径映射约定」）：
  - 修改：`bin/stagent.ts`（CLI 入口：参数解析、动态端口探测、PID 锁检查与浏览器唤起）
  - 修改：`daemon/server.ts`（WS 服务端：首帧握手鉴权、Origin/Host 校验、帧大小与速率限制）
  - 修改：`src/lib/ipc/frames.ts`（帧字典与 FRAME_CATALOG：Daemon 与 UI 共享双向通信协议规范）
  - 修改：`src/lib/ipc/client.ts`（前端 WS 客户端：心跳探测与 15s 失联判定）
  - 修改：`src/lib/daemon-api.ts`（Token 仅经 `#fragment` 引导传递，删除 `?token=` query 通道）
  - 修改：`src/hooks/use-daemon-stream.ts`（前端 React Hook：连接管理、心跳状态与帧分发）
  - 测试：`tests/unit/ws-auth-handshake.test.ts`（首帧握手 / 50ms 切断 / Token 轮换 / 日志无明文）
  - 测试：`tests/unit/ws-frame-dictionary.test.ts`（13 类规范帧 + 目录完备性）
  - 测试：`tests/unit/cli-entry.test.ts`（参数解析 / fragment 构造 / 平台 opener）
  - 测试：`tests/daemon/ws-security.test.ts`（Origin / Host / 2MB / 速率 429 / query 禁令 / 方向门禁 / 默认端口）
  - 测试：`src/hooks/use-daemon-stream.test.tsx`（3 次心跳失联 → reconnecting）、`src/tests/daemon-api-token.test.tsx`（query 忽略 / fragment 抹除）
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 工作区检测到已有存活 PID 锁时，启动失败并返回/抛出 `E_WORKSPACE_LOCKED`，拒绝重复占用工作区。
    - 首帧非 AUTH 或 Token 错误在 50ms 内被 4401 切断。
    - 非法 Origin 连接被直接拒绝。
    - 模拟 3 次心跳丢失触发 UI 重连遮罩。
    - Token 轮换断言：新实例启动后，旧 Token 发送 AUTH 必然返回 4401。
  - **FAIL**：允许 URL Query 传 Token；未鉴权连接可接收广播帧。
* **D.1 交付附注**（2026-10-20）：
  - 心跳判定修正为「AUTH_OK 立即 PING，第 3 次失联落在 15s」（原实现为 20s，off-by-one）；UI 遮罩由 `status === "reconnecting"` 驱动，遮罩组件本体属 TASK-C.1。
  - 增强项（不超出规范）：Host 头回环校验（DNS Rebinding 防线，A §6.1"校验 Origin 与会话权限"的补足，因重绑定后 GET 不带 Origin）；WS `maxPayload = 2MB`（超限以 1009 关闭）；连接速率限制默认 30 次/10s/IP 可配置；帧方向门禁（客户端伪造 `server->client` 帧返回 `FRAME_DIRECTION_FORBIDDEN` 错误帧，不断连）。
  - 规范设计与符合项说明：① Origin 白名单放行 `::1` 属于 loopback 本地回路的标准符合项；② 浏览器唤起时 Token 经 URL **fragment**（`#token=`）传递 —— A §6.1 未指定页面凭证透传通道，fragment 不随 HTTP 请求发送且读取后立即 `history.replaceState` 抹除，完全满足"日志不得记录 token"的要求；③ `WORKER_LOG`/`SCOPE_ALERT` 两个 v1.1 历史扩展帧按 A §6.1"至少包括"措辞保留，证据失效现已同时广播规范帧 `EVIDENCE_STATUS_CHANGED`。
  - 端口默认值由 41792~41802 修正为本卡片的 3001~3010（`daemon/server.ts`、`src/lib/daemon-api.ts`）。

---

### 3.2 Supervisor 建议中枢实现（v1.3.3：S.1 增量/S.2 精简版落 Sprint 4，S.3 推迟 v0.2+）

#### 【Task S.1】Supervisor 建议会话与持久化存储管理
* **任务编号**：`TASK-S.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[PARTIAL]**（v1.3.3 第二轮修订如实化：**旧版 S.1 已完成并在 main，提交 `1a75616`**；v1.3.3 增量——①独立预算分账、②规则优先 L0/L1、③3s 防抖默认关闭——**待完成**，排 Sprint 4。旧版收尾记录见本卡「完成记录」，为历史记录，不代表 v1.3.3 增量已验收）
* **核心目标**：
  1. Local-First 会话管理，落盘至 `.stagent/sessions/{session_id}.json`，文件模式 `0600`。
  2. 依赖层 AST 扫描禁令：禁止引入 Gateway/Merger/Verifier/ProcessRunner/child_process。
  3. **落实运行时越权调用拦截正例断言 (G-11b)**：
     - 若 Supervisor 上下文尝试调用 `approveContract`、`mergeContract`、`setVerdict`、`execCommand`，底层控制面坚决抛出权限拒绝异常，产生 `GATEWAY_VIOLATION` 审计事件。
  4. **预算分账（v1.3.3 修订）**：Supervisor 拥有独立日预算（`.stagent/supervisor-budget.json`），**不再计入当前合同账本**；Supervisor 预算耗尽不影响 Worker 执行；Worker 合同账本不得含 Supervisor 用量。
  5. **唤醒节流器（v1.3.3 修订：规则优先 L0/L1）**：严禁伴随 Worker 逐 Token 轮询。唤醒时机修订为：① 用户显式请求；② Gateway 违规/熔断事件；③ Worker 回合结束且 diff 触及保护区。**「对话停顿 3s 即评估」默认关闭**（throttler 代码保留，配置开关控制）；VIBE 下 30 分钟连续聊天 Supervisor 模型调用应为 0（除非用户点击）。三类时机（修订前存档）：
     - ① 对话流静默 3s（输入停顿 Debounce 窗口）——**v1.3.3 默认关闭，仅保留代码与可配置开关**；
     - ② 用户在 UI 显式点击建议卡/请求分析（实测启用）；
     - ③ 捕获到 Daemon 抛出的 `BLOCKED`、连续测试失败或预算报警事件（实测启用）。
     - **断言（v1.3.3 口径）**：Worker 流式生成过程中 Supervisor 模型请求触发次数为 0；时机 ②③ 触发率 100%；时机 ① 在开关关闭时触发次数必须为 0。
* **涉及核心文件**：
  - 新增：`daemon/supervisor/session-manager.ts`
  - 新增：`daemon/supervisor/prompt-builder.ts`
  - 新增：`daemon/supervisor/types.ts`
  - 新增：`daemon/supervisor/throttler.ts`（唤醒节流器：3s 防抖 + 三类唤醒时机 + Worker 流式静默 + SNOOZE）
  - 测试：`tests/unit/supervisor-session.test.ts`
  - 测试：`tests/unit/supervisor-zero-tool-lint.test.ts`
  - 测试：`tests/unit/supervisor-runtime-permission.test.ts`
  - 测试：`tests/unit/supervisor-debounce-trigger.test.ts`（Worker 流式生成期间零模型调用断言、3s 停顿与事件唤醒测试）
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 会话文件原子落盘与恢复成功。
    - 静态依赖 AST 扫描零违规。
    - 运行时越权调用测试：调用审批/合并/写入 verdict/执行命令 100% 抛错被拒并记录告警。
    - 唤醒节流器测试：在 Worker 流式生成期间 Supervisor 模型调用次数严格为 0；UI 显式请求与控制面异常事件 100% 正确触发；3s 防抖开关关闭时零触发、开启时按既有 18 用例通过。
    - Supervisor 独立预算耗尽时模型调用被阻断，且**不影响 Worker 继续执行**（v1.3.3）。
  - **FAIL**：Supervisor 能绕过控制面直接执行命令或修改工作区，或在 Worker 流式生成过程中伴随发起模型轮询。
* **完成记录（历史记录 · 旧版 S.1，2026-10-20；当时 3s 防抖默认开启，非 v1.3.3 口径）**：
  - 交付物：`daemon/supervisor/throttler.ts`（`SupervisorWakeupThrottler`）+ `daemon/supervisor/index.ts` 导出。
  - 测试：`tests/unit/supervisor-debounce-trigger.test.ts`，共 **18 个用例**全部 PASS，分组如下：
    | 分组 | 用例数 | 覆盖断言 |
    |---|---|---|
    | 防抖窗口 | 3 | 3s 内 5 次输入仅 1 次评估（`coalesced_inputs=5`）；2999ms 不触发 / 3000ms 触发；持续输入重置窗口 |
    | 显式唤醒 | 2 | 显式点击立即触发并取消待触发窗口；连续显式请求各自触发 |
    | Worker 静默 | 3 | STREAMING / TOOL_RUNNING 期间 `model_calls` 严格为 0；静默开始时取消已排队窗口 |
    | 静默解除 | 4 | Turn End 解除静默并触发；积压阻断合并为 `WORKER_BLOCKED`；解除后防抖恢复；Turn End 合并待触发输入不重复评估 |
    | 控制面阻断 | 1 | 空闲态阻断事件立即唤醒 |
    | SNOOZE | 2 | 10 分钟静默期内全部拒绝；到期自动恢复 |
    | 生命周期/可观测性 | 3 | `dispose()` 清窗；评估异常被捕获不阻断后续；统计口径仅放行递增 `model_calls` |

---

#### 【Task S.2】按需合同草案生成引擎（L0 规则 / L1 强模型；v1.3.3 拆分精简）
* **任务编号**：`TASK-S.2`
* **前置依赖**：`TASK-S.1`
* **任务状态**：**[REWORK]**（旧设计实现——4 维成熟度评估器 + 草案编译器——**存于未合并分支 `wip/s2-s3-supervisor-old-design`，未进入 main，非 v0.1 验收依据**；v0.1 按下列精简目标在 Sprint 4 重做，草案编译器与脱敏模块可从该分支择取移植）
* **v1.3.3 范围拆分**：
  - **v0.1（本卡）**：按需合同草案生成——仅在用户显式请求或控制面事件触发时生成；L0 规则（保护清单匹配、路径提取、默认命令/预算）优先，L1 强模型按需补全；白话文案；计入 Supervisor 独立预算。
  - **v0.2+（推迟，`[用户已确认 D4]`）**：需求成熟度评分（4 维评估器、`maturity_assessment` 打分、HUD 徽章）。
* **核心目标**：
  1. 按需生成草案：输出 `rationale`、`unresolved_questions`、`assessed_at`、`model_id`（不再要求成熟度打分）。
  2. 草案授权遵循架构规范 §0.2：Scope 与保护清单无交集自动批准，有交集仅一次白话是/否；不存在任何基于分数的门禁。
  3. **未决问题 100% 保留至草案元数据 (G-11)**：提取生成符合 `SoftwareContractV12` 的草案，状态初始为 `DRAFT`，自动注入必填的 `worker_spec`；若存在 `unresolved_questions`，必须完整保存在草案中供用户核对。
* **涉及核心文件**（v0.1）：
  - 新增：`daemon/supervisor/contract-draft-generator.ts`（草案编译 + `submitDraftForApproval()`；可自 `wip/s2-s3-supervisor-old-design` 择取）
  - 新增：`daemon/supervisor/rules-l0.ts`（L0 规则草案装配）
  - 移植：`src/lib/ipc/redaction.ts`（共享深度脱敏，自旧 S.3 保留）
  - 修改：`daemon/supervisor/index.ts`（公开出口）
  - 测试：`tests/unit/supervisor-contract-generator.test.ts`
  - v0.2+（推迟）：`daemon/supervisor/maturity-evaluator.ts`、`tests/unit/supervisor-maturity-evaluator.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 草案 100% 通过 `SoftwareContractV12Schema.parse()`。
    - 断言：当 `unresolved_questions.length > 0` 时，草案元数据中的 `unresolved_questions` 逐项保留无遗漏。
    - 断言：草案必须包含合规的 `worker_spec`；未请求时 Supervisor 模型调用 = 0。
  - **FAIL**：草案遗漏未决问题；草案缺失 `worker_spec` 导致校验失败。
* **历史记录（旧设计实现，仅存于未合并分支 `wip/s2-s3-supervisor-old-design`，非 v0.1 验收依据）**：该分支上两个专用套件共 32 个用例曾报告 PASS（2026-10-20）。
  | 套件 / 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | 评估器 A 分数收敛 | 4 | 模糊意图 <50 且 `NEEDS_CLARIFICATION`、未决问题非空；明确意图 ≥80 且四维均 ≥80；明确比模糊高 ≥40 分；部分信息只拉高对应维度 |
  | 评估器 B 结构 | 3 | 四维齐备、权重合计 1；分数均在 0–100 且理由非空；总分可按维度加权复算 |
  | 评估器 C 建议性守卫 | 3 | 空对话不抛错、0 分 + 4 条未决问题；0 分与满分 `advisory_only` 均为 true；未决问题数量等于弱维度数 |
  | 评估器 D 输出契约 | 2 | `toAssessment()` 通过 `maturityAssessmentSchema`；`assessed_at` 来自注入时钟、`model_id` 可覆盖 |
  | 生成器 A 合规与状态 | 5 | 草案 100% 通过 Schema；初始 `DRAFT/DRAFT`；`DRAFT+PENDING_REVIEW` 被拒；提交后 `PENDING_APPROVAL/PENDING_REVIEW`；非 DRAFT 不可重复提交 |
  | 生成器 B worker_spec / 非门禁 | 3 | `GATEWAY_ENFORCED` + `MANAGED_TOOL_CALLING`；`score=0` 仍生成且元数据 score 为 0；无评分同样生成 |
  | 生成器 C G-11 | 2 | 未决问题逐项无遗漏无改写；评估报告转存后 score/rationale/model_id/assessed_at 完全一致 |
  | 生成器 D 装配 | 8 | 对话提取可写路径与禁区；显式 scope 覆盖；空对话安全兜底；默认两条验证命令；命令可覆盖；默认预算含计数值上限；预算可覆盖且合规；默认命令常量防漂移 |
  | 生成器 E 溯源 | 2 | `suggestion_id` + `suggested_scope` 落元数据；`conversation_ref` 保留全部消息 id |
  - 规范说明：A §9.1.1 状态矩阵只允许 `DRAFT↔DRAFT`、`PENDING_APPROVAL↔PENDING_REVIEW`，故草案初始态为 `DRAFT/DRAFT`；`submitDraftForApproval()` 原子推进至 `PENDING_APPROVAL/PENDING_REVIEW`。`DRAFT+PENDING_REVIEW` 被显式断言拒绝，已固化为可回归事实。

---

#### 【Task S.3】Supervisor HUD 建议流与 WebSocket 广播
* **任务编号**：`TASK-S.3`
* **前置依赖**：`TASK-S.2`, `TASK-D.1`
* **任务状态**：**[DEFERRED → v0.2+]** / **[REWORK]**（旧设计实现——含 `SUPERVISOR_MATURITY_UPDATED` 成熟度帧——**存于未合并分支 `wip/s2-s3-supervisor-old-design`，未进入 main，非 v0.1 验收依据**）
* **v0.1 保留范围**：仅脱敏模块 `src/lib/ipc/redaction.ts`（键名/真实值/形态三层脱敏、先脱敏后截断），随 TASK-S.2 精简版移植并独立验收；「仅鉴权连接可收帧」作为既有 D.1 原则继续生效。其余广播能力（成熟度帧、Snooze、HUD 上行 action）推迟 v0.2+ 重新评审，状态/草案推送需改接 L0 规则引擎后再评估。
* **核心目标**：
  1. 通过 WebSocket 广播 Supervisor 建议流至已认证客户端。**实现口径**：在 §6.1「类型至少包括」下扩展 `SUPERVISOR_MATURITY_UPDATED`（成熟度快照）、`SUPERVISOR_DRAFT_PROPOSED`（草案提案）、`SUPERVISOR_STATUS_CHANGED`（运行状态）三类下行帧；既有 `SUPERVISOR_SUGGESTION` 保持兼容。
  2. 支持客户端响应：`ACCEPT`、`SNOOZE`（10 分钟静默）、`DISMISS`。**实现口径**：新增上行帧 `SUPERVISOR_SUGGESTION_ACTION`（`client->server`，强制鉴权）。
  3. 建议去重与频控防打扰（30s 内容去重 + 10s/12 帧滑动窗口）。
  4. 敏感信息防护：所有下行 payload 经键名 / 真实值 / 形态三层脱敏，凭据原文不出现在帧中。
* **涉及核心文件**：
  - 新增：`daemon/supervisor/suggestion-broadcaster.ts`（广播决策、去重/频控/SNOOZE、脱敏、状态推导）
  - 新增：`src/lib/ipc/redaction.ts`（共享深度脱敏：`redactText` / `redactDeep`）
  - 修改：`src/lib/ipc/frames.ts`（协议 v1.3：4 类 Supervisor 帧 + payload 契约 + 帧目录）
  - 修改：`daemon/supervisor/throttler.ts`（状态快照 `state` + `setStateListener`，S.3 状态源）
  - 修改：`daemon/server.ts`（广播器接线、鉴权过滤、上行 action 分发、发送异常隔离）
  - 测试：`tests/unit/supervisor-broadcast.test.ts`（26 用例）
* **Pass/Fail 验收判定**：
  - **PASS**：认证客户端准时接收合规建议帧，SNOOZE 静默逻辑生效。
  - **FAIL**：未认证连接接收到帧。
* **历史记录（旧设计实现，仅存于未合并分支 `wip/s2-s3-supervisor-old-design`，非 v0.1 验收依据）**：该分支上 `tests/unit/supervisor-broadcast.test.ts` 共 26 个用例曾报告 PASS（2026-10-20；最终树整轮测试未在干净终端复跑）。
  | 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | A 成熟度事件 | 2 | 完整快照（score / badge / 四维 / 未决问题 / advisory_only）；0 分同样广播（非门禁） |
  | B 草案事件 | 4 | 摘要含目标/白名单/禁区/验收/命令/计数值预算；默认无全量、`includeContract` 时通过 Schema；G-11 未决问题逐项保留；摘要不含 env grants；兼容 `SUPERVISOR_SUGGESTION` 伴随帧 |
  | C 状态事件 | 3 | STREAMING → `WORKER_MUTED`；轮次结束 `WORKER_MUTED → EVALUATING → IDLE`；相同状态不重复广播 |
  | D SNOOZE 与防打扰 | 6 | SNOOZE 抑制成熟度但状态帧可送达、resume 恢复；到期自动解除并补发 IDLE；30s 去重；频控窗口恢复；DISMISS 后不再推送；ACCEPT/非法载荷 |
  | E 脱敏 | 6 | `sk-`/Bearer 形态抹除；宿主 `STAGENT_HOST_SECRET` 值不入帧；敏感键名整体替换且不改入参；合同 `authorization` 权限块不被误伤；长数组有界裁剪；先脱敏后截断 |
  | F 连接隔离与容错（真实 WS） | 5 | 已认证收到 / 未认证收不到；断线后广播返回 0 且不抛错、新连接可恢复；transport 异常计数且不外抛；上行 SNOOZE → SNOOZED 状态帧并抑制后续；草案帧仅认证可见且 < 2MB |
  - 协议变更说明：`src/lib/ipc/frames.ts` 协议版本由 v1.2 升至 **v1.3**；新增帧在 `FRAME_CATALOG` 标记 `spec: "v1.3"`，与 v1.2.1 的 13 类基础帧区分；`isClientToServerAllowed` 放行新增的上行 action 帧，其余方向约束不变。
  - 安全边界说明：广播器不持有连接表，所有下行统一经 `server.broadcast()`，后者逐连接校验 `authenticated === true`；发送异常按连接隔离（`terminate` + 移出集合），不会中断其余客户端或 Supervisor 评估循环。

---

### 3.3 受控 Coding Worker、安全策略、威胁守卫与成熟 Agent 适配（W.1/W.2 已完成；W.3/W.4 落 Sprint 2；W.5a 落 Sprint 1，绕过负例收尾落 Sprint 3）

#### 【Task W.1】Coding Worker 适配器抽象与任务指令装配
* **任务编号**：`TASK-W.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（2026-10-20 收尾：能力声明第 9 项 `known_limitations`、合同上下文装配、Worktree 边界校验与工具暴露收窄全部落地；专用用例 **34 个**全通过；用例总数以最新 CI 为准）
* **v1.3.3 定位调整**：自研 API Worker 由主线转为**保底运行基线与单元测试替身**；成熟 Agent 接入由 TASK-W.5a/b/c 承载。`AdapterCapabilityDeclaration` 增补字段：`billing_model`、`streaming_protocol`、`resume_mechanism`、`interrupt_supported`、`native_tools_disabled: string[]`、`verified_on`（实测 CLI 版本号与日期，空即「待实机验证」）。
* **核心目标**：
  1. 定义 `CodingWorkerAdapter` 接口，支持 Managed AI 与 CLI。
  2. **合同生效后的任务指令下发与装配 (Task Instruction Injection)**：
     - 当收到合同批准事件时，Session Router 组装标准任务指令卡片并推入**右侧 Worker 对话窗口**；
     - 注入最高优先级任务上下文（目标意图、文件白名单、禁止触碰目录、验收要求）；
     - 将 Worker 执行的工作目录强行锁定为生成的 Worktree 物理路径。
  3. **`AdapterCapabilityDeclaration` 补齐第 9 项 `known_limitations` (G-10)**：声明对象完整包含 9 项能力规范与平台矩阵。
  4. 注册中心默认拒绝未经能力证明的外部适配器进入 `GATEWAY_ENFORCED` 受控模式。
* **涉及核心文件**：
  - 新增：`daemon/worker/worker-adapter.interface.ts`
  - 新增：`daemon/worker/session-task-injector.ts`
  - 新增：`daemon/worker/adapter-registry.ts`
  - 修改：`daemon/worker/ai-worker.ts`（`prepare()` 装配 + 失败上下文回传）
  - 修改：`daemon/worker/openai-client.ts`（System Prompt 单一事实源）
  - 修改：`daemon/pipeline/orchestrator.ts`（传入宿主根强制 Worktree 隔离校验）
  - 测试：`tests/unit/worker-adapter.test.ts`
* **接口定义**：
  ```typescript
  export interface AdapterCapabilityDeclaration {
    adapter_id: string;
    protocol_version: string;
    model_metering_source: "PROVIDER" | "LOCAL_ESTIMATE";
    tool_interception_supported: boolean;
    filesystem_permissions: "GATEWAY_ONLY" | "DIRECT_UNCONTROLLED";
    command_permissions: "WHITELIST_ONLY" | "UNRESTRICTED_SHELL";
    cancellation_supported: boolean;
    session_recovery_supported: boolean;
    network_requirements: "NONE" | "EXPLICIT_ONLY" | "DIRECT_INTERNET";
    platform_support: ("darwin-arm64" | "darwin-x64" | "linux-x64" | "win32-x64")[];
    known_limitations: string[]; // 第 9 项必填已知限制 (G-10)
  }
  ```
* **Pass/Fail 验收判定**：
  - **PASS**：未声明 `known_limitations` 或声明直连 FS 的适配器，无法被注册为受控模式。
  - **FAIL**：未知黑盒适配器被登记为受控。
* **完成记录（2026-10-20）**：`tests/unit/worker-adapter.test.ts` 共 **34 个用例**全 PASS：
  | 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | A 合同上下文装配 | 8 | 目标/白名单/只读/禁区/验收/预算逐字段注入；Worktree 根与段落结构；known_limitations 默认注入与未声明告警；未批准合同拒绝装配 |
  | B 工具暴露 | 4 | 无命令授权时 exec 不暴露；有授权恢复；只能收窄子集；未授权显式请求被拒 |
  | C Worktree 边界 | 8 | 等于宿主根 / 祖先 / 非隔离目录 / 完全外部 / 相对路径 / 符号链接穿透 全部拒绝 |
  | D 能力声明与注册中心 | 8 | 空限制、直连 FS、无限制 Shell、无法拦截工具、空平台矩阵逐项拒绝；重复 ID 拒绝；黑盒仅可非受控登记 |
  | E AiWorker 集成 | 5 | Prompt 单一事实源；网关落盘；模型异常 `MODEL_CALL` 上下文；工具失败 `TOOL_WRITE` 上下文；越权 `SCOPE_VALIDATION` 零落盘 |
  | F 静态边界 | 1 | `daemon/worker/**` 零 `child_process` / 零原生执行 API（**v1.3.3 收窄**：唯一例外为 `daemon/worker/cli-host/` 专用子进程隔离模块，该模块允许 spawn 但强制结构化 argv + `shell:false` + 进程树托管回收；静态测试改为断言"cli-host 之外零 spawn"） |

---

#### 【Task W.2】Scoped Gateway 强制工具注入与执行拦截
* **任务编号**：`TASK-W.2`
* **前置依赖**：`TASK-W.1`, `TASK-A.2` (COMPLETED), `TASK-A.4` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-20 收尾：5 大工具注入、`expected_hash` 乐观锁、`delete_file`、别名 argv 执行与路径/命令拦截全部落地；专用用例 **29 个**全通过，全仓 55 文件 / 522 用例）
* **核心目标**：
  1. 注入 `stagent_*` 5 大标准工具。
  2. **`stagent_write_file` 的 `expected_hash?` 调整为可选 (G-03)**：
     - 若传入 `expected_hash`，执行严格乐观锁比对，哈希不符抛 `E_CONFLICT`；
     - 若未传入 `expected_hash`，视为新建文件，仅在合同 `writable_paths` 范围内放行。
  3. **强制结构化 argv 且 `shell:false` 调用 (G-04)**：
     - 命令执行必须以 `spawn(executable, args, { shell: false })` 执行；
     - 严密检查参数，包含未转义连接符（`;`, `&&`, `|`, `$()`）的参数作为字面量抛出 `E_UNAUTHORIZED_COMMAND`。
  4. 越界访问抛 `E_OUT_OF_SCOPE`，禁区抛 `E_FORBIDDEN_PATH`，违规后合同与证据标 `BLOCKED`。
* **涉及核心文件**：
  - 修改：`daemon/mcp/types.ts`（`expected_hash` / `command_alias` / `list_directory` / `delete_file` Schema）
  - 修改：`daemon/mcp/gateway.ts`（五工具分发、乐观锁、删除、别名 argv、Scope 码映射）
  - 新增：`daemon/worker/worker-toolset.ts`（按授权挂载的工具实例层）
  - 修改：`daemon/worker/session-task-injector.ts`（`WORKER_MCP_TOOLS` 五席位与 exec 暴露判定）
  - 修改：`daemon/worker/ai-worker.ts`（经 toolset 读写）
  - 测试：`tests/unit/worker-mcp-tools.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 未传 `expected_hash` 时新文件正常创建；传入错误 `expected_hash` 时被拒绝。
    - 包含注入符号（`;`, `&&`）的命令参数被字面量拦截，测试断言未进入系统 shell 执行。
    - 越界写入被阻断，合同与证据被标为 `BLOCKED`。
  - **FAIL**：使用 `shell: true` 执行命令；新文件因强制要求前值哈希而无法创建。
* **完成记录（2026-10-20）**：`tests/unit/worker-mcp-tools.test.ts` 共 **29 个用例**全 PASS：
  | 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | 五工具基本功能 | 9 | 读回内容+SHA-256；写入落盘；列举隐藏禁区/`.git`/`.stagent`；递归路径；历史别名等价；删除与 `ENOENT`；拒删目录 `E_NOT_A_FILE`；别名执行 exit 0；未知别名 `E_UNAUTHORIZED_COMMAND` |
  | 乐观锁 `expected_hash` | 4 | 命中写入；外部改动后 `E_CONFLICT` 且零覆盖；缺失文件传 hash 判冲突；非法 hash `INVALID_INPUT` |
  | 命令防注入 | 6 | `&&`/`\|`/`;`/`$()` 四类参数逐一拒绝且无副作用；旧式字符串拼接被拦；argv 字面量透传 |
  | 路径边界 | 6 | 穿越/绝对路径 `PATH_TRAVERSAL_DETECTED`；禁区 `E_FORBIDDEN_PATH`；越界 `E_OUT_OF_SCOPE`（写/删各一） |
  | 授权挂载 | 4 | 未授权 commands 时 exec 不挂载；授权后五工具全挂；收窄后未挂载即拒绝；AiWorker 经 toolset 落盘 |

---

#### 【Task W.3】测试环境、秘密脱敏与网络/端口策略守卫
* **任务编号**：`TASK-W.3`
* **前置依赖**：`TASK-W.2`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. 环境变量过滤：默认注入 `CI=true`，严禁继承宿主全部环境变量，仅放行合同 `allowed_environment_variable_names`。
  2. `env_file_grants` 授权：按命令 alias 注入对应的测试环境配置文件。
  3. **秘密遮蔽严密在截断之前执行**：对注入的秘密值做掩码替换，遮蔽必须早于输出双窗口截断，防止截断边界泄露。
  4. 网络与端口策略：`network_policy = "DENY"` 时拦截外部网络；动态端口冲突时给出可诊断错误，不误报为断言失败。
  5. **工具与命令预算分列记账断言 (闭环 G-09 第 3 子项)**：
     - 在命令执行器与 MCP 工具代理层实现独立记账；
     - `budget_limits` 中命令执行次数与工具调用次数分列记录并实时累加至账本；
     - 任何单项超限立即触发 `E_BUDGET_EXCEEDED` 熔断，断言不因模型 Token 未超标而放行违规工具调用。
* **涉及核心文件**：
  - 新增：`daemon/worker/policy-guard.ts`
  - 修改：`daemon/runner/command-runner.ts`
  - 测试：`tests/unit/policy-guard-env-network.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：宿主非白名单变量完全隔离；秘密遮蔽在截断前执行完毕；网络阻断生效；工具与命令分列记账超限时 100% 触发 E_BUDGET_EXCEEDED 熔断。
  - **FAIL**：环境变量泄露；秘密在截断边缘明文泄露。

---

#### 【Task W.4】高风险执行威胁守卫与运行时能力复检 (闭环 G-01 & G-20)
* **任务编号**：`TASK-W.4`
* **前置依赖**：`TASK-W.3`
* **任务状态**：**[NEW_TASK]**
* **核心目标 (闭环 A §4.2.3, §6.4.7, §7.3)**：
  1. **高风险执行威胁守卫 (产出 `E_UNSAFE_EXECUTION`)**：
     - 在命令启动前校验 argv 与仓库信任标记；
     - 命中不可信仓库、特权操作（`sudo`, `chown`, `insmod`）、访问任意主机路径或无法可靠限制子进程的高风险命令时，坚决拒绝执行；
     - 抛出 `E_UNSAFE_EXECUTION`，将 Evidence 置为 `status: "BLOCKED"` 且 `reason_code: "UNSAFE_EXECUTION"`，并在 UI 提示外置隔离。
  2. **运行时强制能力复检与降级**：
     - 在 Worker 会话期间，周期性或在每步工具调用前复检 Adapter 强制能力；
     - 若探测到启动配置被篡改、原生 FS/Shell 工具未被拦截或出现未知通道，立即将当前会话降级为 `UNCONTROLLED_EXTERNAL`，停止受控执行，阻断 Evidence 通过，并广播 `GATEWAY_VIOLATION`。
  3. **落实 4 类绕过路径不可用负例断言**：
     - 绕过 1：直接向 Worktree 外路径写入 ➔ 必然失败；
     - 绕过 2：执行未授权 Shell ➔ 必然失败；
     - 绕过 3：跨 Worktree 直接访问主工作树 ➔ 必然失败；
     - 绕过 4：跳过 Gateway 直接调用原生工具 ➔ 必然失败。
* **涉及核心文件**：
  - 新增：`daemon/worker/threat-guard.ts`
  - 新增：`daemon/worker/runtime-interceptor.ts`
  - 测试：`tests/unit/threat-guard-runtime-check.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 特权命令（如 `sudo ls`）被 Threat Guard 拦截，抛出 `E_UNSAFE_EXECUTION`，未产生子进程，Evidence 被标记为 `BLOCKED` + `UNSAFE_EXECUTION`。
    - 运行时注入未知工具通道后，Adapter 立即被降级为非受控状态，当前合同禁止生成通过证据。
    - 4 类绕过负例测试 100% 触发阻断。
  - **FAIL**：特权命令进入执行；绕过 Gateway 能够读写文件。

---

#### 【Task W.5a】Claude Code 适配器与 cli-host 黑盒实测 (v1.3.3 新增)
* **任务编号**：`TASK-W.5a`
* **前置依赖**：`TASK-W.2`, `TASK-C.6`（右栏会话通道）
* **任务状态**：**[PARTIAL]**（分支 `feat/w5a-claude-code`，未合并。已完成：cli-host 唯一 spawn（shell:false、进程组、SIGINT→SIGTERM→整树 SIGKILL，假 CLI 实测 <2s）；用户决定一律 API Key + `--bare --settings <Stagent 生成> --mcp-config <空集> --strict-mcp-config`；permissions.deny + --disallowedTools 硬限制 + PreToolUse hook（异常一律拒绝，onFailure:block）；只用 `--resume <session_id>`；永不 bypassPermissions；Key 仅注入子进程且报错脱敏。hook 层 4 类绕过负例确定性测试通过。真实 CLI 2.1.296 仅用无效 Key 做过参数/流格式冒烟（403，未计费）。**未完成**：Daemon 环境无 ANTHROPIC_API_KEY，未做真实编辑/打断/续接实测；4 类绕过未在真实 CLI 上实测；Gateway MCP 端点依赖 W.4。故 `verified_on` 为空，control_mode=UNCONTROLLED_EXTERNAL。）
* **核心目标**：
  1. 在 `daemon/worker/cli-host/` 专用子进程隔离模块中以 spawn 挂载 Claude Code CLI（结构化 argv、`shell:false`、进程树托管回收）；**全仓其余位置维持零 `child_process` 静态禁令**。
  2. **收敛策略（待实机验证，verified_on: 空）**：优先保留 Claude Code 原生工具，通过官方 **Pre-tool hook** 配合 Stagent 网关拦截；辅以工具白名单/黑名单收窄内置 Edit/Write/Bash/WebFetch；避免粗暴剥离原生工具导致模型死循环。工作目录锁定 Worktree。
  3. 接入其 Headless 模式与结构化输出（流式 JSON）对接右栏会话（TASK-C.6）；接入其会话续接能力实现 resume。
  4. 在 cli-host 中对**真实 CLI 版本**执行 W.4 的 4 类绕过负例实测，全部失败关闭后填写 `verified_on`（CLI 版本号 + 日期），方标记 `GATEWAY_ENFORCED`。
* **涉及核心文件**：
  - 新增：`daemon/worker/cli-host/claude-code-adapter.ts`
  - 新增：`daemon/worker/cli-host/process-host.ts`（spawn 托管与进程树回收）
  - 测试：`tests/unit/cli-host-claude-code.test.ts`（黑盒实测，含 4 类绕过负例）
* **Pass/Fail 验收判定**：
  - **PASS**：4 类绕过负例在真实 CLI 版本上 100% 失败关闭；`verified_on` 非空；流式输出与打断/续接实测达标。
  - **FAIL**：任一绕过路径可用；未实测即标记受控。

#### 【Task W.5b】cursor-agent 适配器黑盒实测 (v1.3.3 新增)
* **任务编号**：`TASK-W.5b`
* **前置依赖**：`TASK-W.5a`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：实测 cursor-agent 权限配置能否完全 deny shell/写文件并仅挂 Stagent MCP；凭证途径仅限官方登录或 API Key。**不能完全关闭原生写能力者只能登记为 `UNCONTROLLED_EXTERNAL`，仅 Vibe 模式可用，UI 显示"未受控"**。
* **Pass/Fail 验收判定**：同 W.5a 的实测纪律；`verified_on` 按实测结果填写或明确标注"未通过，仅 Vibe"。

#### 【Task W.5c】OpenHands 适配器（容器隔离，SANDBOX_ENFORCED）(v1.3.3 新增)
* **任务编号**：`TASK-W.5c`
* **前置依赖**：`TASK-W.5a`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：容器内仅挂载任务 Worktree，网络按合同策略；对应 `control_mode = "SANDBOX_ENFORCED"`，D.2 Gate 0 与 A §9.1 不变式承认该模式。
* **Pass/Fail 验收判定**：容器逃逸/越界挂载负例实测失败关闭；`verified_on` 填写实测版本与日期。

---

### 3.4 Cursor 式三栏 IDE 工作台与悬浮 HUD（C.1/C.3 落 Sprint 1；C.2 落 Sprint 4；C.4 推迟）

#### 【Task C.1】Cursor 式三栏 IDE 响应式工作台骨架与 Studio 视口
* **任务编号**：`TASK-C.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（分支 `feat/c1-three-column-layout` 提交 `e48f614`，待合并主线；门禁：tsc 0 错、eslint 0 错、npm test 53 文件 / 435 用例全过，其中 tests/ui/workspace-layout.test.tsx 7 用例）
* **核心目标**：
  1. 构建左栏（文件树/雷达）、中栏（Monaco/Diff/Supervisor Studio 多标签与分屏）、右栏（Coding Agent 对话）的三栏 IDE 布局。
  2. **中栏多标签与分屏架构**：
     - 支持中栏多标签页切换，支持系统级 `SupervisorStudio` 标签页；
     - 支持 Split Pane（分屏）：左侧打开代码/Diff，右侧打开 Supervisor Studio，实现并排对照。
  3. **Header 补齐 5 项展示要素与 HUD 胶囊 (G-06)**：
     - 仓库名称；
     - **当前分支**（活动合同执行期展示 `task/{contract_id}`，平时展示 Base 分支）；
     - **运行模式**（v1.3.3：清晰展示 `VIBE` 自由模式（默认）vs `PROTECTED` 保护模式；是否有合同正在执行由合同信息与执行状态单独展示）；
     - 当前合同 ID 与绑定的 Worktree 物理绝对路径；
     - **Worker 受控状态徽标**（`GATEWAY_ENFORCED` 绿色受控 vs `UNCONTROLLED_EXTERNAL` 黄色非受控）；
     - **Supervisor 入口**（v0.1：一键打开 Studio 快捷入口；成熟度打分徽章、未决风险气泡推迟 v0.2+）。
  4. **工作区默认绑定与切换提示 (G-18)**：合同批准后编辑区默认绑定 Worktree；切回主工作树时给出显式切换提示与执行状态指示。
* **涉及核心文件**：
  - 新增：`src/components/WorkspaceLayout.tsx`
  - 新增：`src/components/FileTree.tsx`
  - 新增：`src/components/WorkspaceHeader.tsx`
  - 新增：`src/components/SplitPaneContainer.tsx`
  - 测试：`tests/ui/workspace-layout.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：Header 完整包含模式指示、受控徽标、Studio 入口；中栏支持 Supervisor 专属标签页与分屏布局；审批后工作区自动切换绑定 Worktree。
  - **FAIL**：缺少受控徽标或模式指示；中栏无法渲染分屏或系统标签页。

---

#### 【Task C.2】中栏 Supervisor Studio 标签页与合同审阅面板
* **任务编号**：`TASK-C.2`
* **前置依赖**：`TASK-C.1`, `TASK-S.2`（v1.3.3 第二轮修订：移除已推迟的 `TASK-S.3`，与 JSON 边一致）
* **任务状态**：**[NEW_TASK]**（v0.1 精简版）
* **v0.1 范围**：最小 Studio / 合同审阅 + 保护清单命中时的白话确认卡 + 模式指示。**v0.2+（推迟，不作本卡前置或验收项）**：成熟度徽章、HUD 风险气泡、Snooze、`SUPERVISOR_MATURITY_UPDATED` 实时同步。
* **核心目标**：
  1. **中栏 `SupervisorStudioPane.tsx` 专属审阅区**：
     - 在中栏以 Tab 呈现（彻底废除阻断式 Modal 弹窗）；
     - 展示草案理由与 `unresolved_questions` 未决问题核对勾选单（白话）；
     - 结构化合同编辑：可写 Scope (`writable_paths`)、只读路径、强禁区、测试命令、Token 预算上限；
     - 执行期转为实时监控面板（Token 水表、改动文件列表、MCP 事件流、紧急暂停按钮）。
  2. **模式指示**：Header 显示当前模式（自由模式 VIBE / 保护模式 PROTECTED）与入口按钮，点击打开 Studio Tab。（原「HUD 胶囊 + 成熟度徽章 + 风险气泡」推迟 v0.2+。）
  3. **审批交互（v1.3.3 减负）**：合同 Scope 与保护清单无交集时由 Daemon 自动批准并记录备案（前端不弹窗）；有交集时仅向用户展示一个白话是/否卡片（"AI 想修改被保护的『登录』代码，同意吗？【是 / 否】"），用户点击后才发起签署请求 (`POST /api/contracts/:id/approve`)。
* **涉及核心文件**：
  - 新增：`src/components/SupervisorStudioPane.tsx`
  - 新增：`src/components/ContractEditorForm.tsx`
  - 新增：`src/components/ProtectionConfirmCard.tsx`（保护清单命中白话是/否卡）
  - v0.2+（推迟）：`src/components/SupervisorHUD.tsx`、`src/components/MaturityBadge.tsx`
  - 测试：`tests/ui/supervisor-studio-approval.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：用户在 Studio 中可直接编辑 Scope 并勾选未决问题；保护清单命中时仅出现一个白话是/否卡，用户点「是」前绝不向服务端发审批请求；无交集合同前端零弹窗；模式指示正确。
  - **FAIL**：保护清单命中的合同未经用户确认即被批准；弹窗超过一个是/否问题；合同审阅仍使用遮挡代码的阻断 Modal。

---

#### 【Task C.3】Monaco 核心编辑器集成与受控 Worktree 读写
* **任务编号**：`TASK-C.3`
* **前置依赖**：`TASK-C.1`, `TASK-A.2` (COMPLETED)（v1.3.3：移除已删除的 `C.2→C.3` 串行边）
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. Monaco Editor 嵌入，可写/只读视觉区分。
  2. **编辑器内 Evidence STALE 提示 (G-18)**：当关联合同 Evidence 变为 STALE 时，在中栏顶部弹出警告横幅，提示代码已被外部修改需重新验证。
  3. 服务端强制保存校验：保存必须调用 `POST /api/worktree/files`，越权保存由 Daemon 403 拒绝，记录 `GATEWAY_VIOLATION`，文件物理无改动。
* **涉及核心文件**：
  - 新增：`src/components/MonacoEditorPane.tsx`
  - 新增：`src/hooks/useWorktreeFile.ts`
  - 修改：`daemon/server.ts`
  - 测试：`tests/ui/monaco-editor-pane.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：越权写入请求返回 403 并在服务端留下违规记录；Evidence 失效时编辑器横幅即时展现。
  - **FAIL**：前端允许写入未授权路径；缺少 STALE 视觉指示。

---

### 3.5 架构感知、监听与差异审阅（C.5 落 Sprint 2；B.1/B.2/C.4 推迟至 v0.2+）

#### 【Task B.1】本地 AST 增量依赖图分析引擎
* **任务编号**：`TASK-B.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. **统一路径前缀 (G-16)**：解析 `src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`，构建文件级依赖拓扑。
  2. 达成性能门槛：1000 节点冷启动 ≤ 1.5s，单文件增量修补 ≤ 20ms。
* **涉及核心文件**：
  - 新增：`daemon/arch/ast-parser.ts`
  - 新增：`daemon/arch/dependency-graph.ts`
  - 测试：`tests/unit/ast-dependency-graph.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：冷启动 ≤1500ms，增量 ≤20ms，支持 JSON/MJS/CJS。
  - **FAIL**：解析内存泄漏或循环依赖死锁。

---

#### 【Task B.2】多活跃 Worktree 监听与 Evidence 状态联动
* **任务编号**：`TASK-B.2`
* **前置依赖**：`TASK-B.1`, `TASK-A.1` (COMPLETED), `TASK-A.6` (COMPLETED)
* **任务状态**：**[INCREMENTAL_UPGRADE]**
* **核心目标**：
  1. 监听多个活跃 Worktree，排除 `.git/`, `.stagent/`, `node_modules/`, `dist/`, `build/`, `coverage/`。
  2. **工作树外部变更检测与失效联动**：外部文件修改后，在配置的 watcher debounce 窗口内（性能目标 ≤50ms）触发 Evidence `STALE`（携带错误码 `E_EVIDENCE_STALE`），置 `can_merge = false`，广播 `EVIDENCE_STATUS_CHANGED`；即使监听事件因系统负载丢包，合并前指纹复核兜底机制亦强制撤销 `can_merge`。
* **涉及核心文件**：
  - 修改：`daemon/watcher/fs-watcher.ts`
  - 修改：`daemon/watcher/invalidation-engine.ts`
  - 测试：`tests/unit/multi-worktree-watcher-stale.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：外部改动在 watcher debounce 窗口内（性能目标 ≤50ms）将 Evidence 标为 STALE（携带 `E_EVIDENCE_STALE`）且 `can_merge` 为 false，广播 `EVIDENCE_STATUS_CHANGED`；合并前指纹复核兜底有效；忽略目录写入不误报。
  - **FAIL**：外部改动后 Evidence 仍为 PASSED，或合并前绕过快照复核。

---

#### 【Task C.4】架构雷达视图与 Scope 圈选抽屉
* **任务编号**：`TASK-C.4`
* **前置依赖**：`TASK-C.3`, `TASK-B.1`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. Cytoscape 渲染架构雷达，1000 节点局部 patch ≤ 16ms (60 FPS)，内存 ≤ 30MB。
  2. 交互圈选 Scope；已批准合同圈选强制派生新版本并重新审批，禁止原地扩权。
* **涉及核心文件**：
  - 新增：`src/components/ArchitectureRadar.tsx`
  - 新增：`src/components/ScopeSelectorDrawer.tsx`
  - 测试：`tests/ui/architecture-radar.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：大图流畅；已批准合同修改 Scope 强制触发 Revision 递增与重新审批。
  - **FAIL**：允许在原合同上原地修改 Scope。

---

#### 【Task C.5】双栏 Diff 审阅器与结构化终端日志回放
* **任务编号**：`TASK-C.5`
* **前置依赖**：`TASK-C.1`, `TASK-A.4` (COMPLETED)（v1.3.3：移除已推迟的 `TASK-C.4`）
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. 双栏/内联展示真实 Git Diff。
  2. 结构化终端流式回放日志，ANSI 彩色，超长日志先脱敏后头尾截断 (保留各 200 行)。
* **涉及核心文件**：
  - 新增：`src/components/DiffViewer.tsx`
  - 新增：`src/components/StructuredTerminal.tsx`
  - 测试：`tests/ui/diff-terminal-viewer.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：Diff 准确匹配 git；敏感信息在截断前已被遮蔽；超大输出前端不崩溃。
  - **FAIL**：未脱敏即截断。

---

#### 【Task C.6】右栏 Agent 流式会话与打断续接 (v1.3.3 新增)
* **任务编号**：`TASK-C.6`
* **前置依赖**：`TASK-C.1`, `TASK-D.1`
* **任务状态**：**[COMPLETED]**（分支 `feat/c6-agent-chat`，未合并主线。已用假适配器 + 演示 Agent 测过：流式、工具卡片、排队、打断（门闩立即生效、适配器 <2s 停止）、`.stagent/sessions/` 持久化与重启续接；真实 Claude Code 的流式/打断/续接见 W.5a。Adapter：自研保底（OpenAI 兼容，只聊天）/ 演示 Agent（不调用模型）。打断会清空排队消息。）
* **核心目标**：
  1. 右栏会话流式渲染（逐 Token）、工具调用卡片、改动预览；
  2. Stop/打断：用户随时中断，Agent 进程 2s 内停止输出；排队追加消息；
  3. Adapter 切换（自研保底 Worker / Claude Code / 其他已验证 Adapter）；
  4. 会话列表与 resume：映射各 CLI 的原生会话 ID，持久化于 `.stagent/sessions/`；关闭浏览器与重启 Daemon 后可续接同一会话并保留上下文；
  5. 消费 `CHAT_EVENT` 子类型帧（`delta`/`tool_call`/`tool_result`/`turn_end`/`interrupted`/`error`，架构规范 §6.1）。
* **涉及核心文件**：
  - 新增：`src/components/AgentChatPane.tsx`
  - 新增：`src/hooks/use-agent-session.ts`
  - 测试：`tests/ui/agent-chat-pane.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：首 token 可见延迟 ≤1s（本地测量）；打断后 2s 内 Agent 进程停止输出；Daemon/UI 重启后会话可续接且上下文完整。
  - **FAIL**：打断后仍有输出；重启丢会话。

---

### 3.5b 全局保护清单与 Vibe 安全网 (Sprint 2)

#### 【Task P.1】全局保护清单与 Vibe 模式安全网 (v1.3.3 新增) `[用户已确认 D1 / D2 · 2026-10-20]`
* **任务编号**：`TASK-P.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. `.stagent/protection.json` 全局保护清单（路径 glob + 白话名称），UI 一键加锁/解锁；
  2. 首导入推荐：Supervisor 以规则扫描识别核心模块，弹出白话推荐卡片（"为您推荐锁定【登录】与【支付】模块，一键保护"）；
  3. **Prompt 前置注入**：组装 Worker Prompt 时直接注入已锁定保护清单，引导 AI 主动规避；
  4. **静默合同（Silent Contract）**：Worker 改动未触碰保护清单时，Daemon 后台静默生成合同与快照，前端不弹窗；触碰保护清单时抛出极简白话是/否卡片；
  5. **Vibe 安全网**：Agent 执行改动前 Daemon 自动生成轻量 Git 快照（Auto-Checkpoint）；UI 顶层常驻白话按钮【撤销本轮改动】；
  6. **User-First Discard Rule**：合并冲突永远以用户主分支版本为准，丢弃 Worktree 冲突改动并提示 AI 重新修改；不向用户展示 Git 冲突界面。
* **涉及核心文件**：
  - 新增：`daemon/protection/protection-list.ts`
  - 新增：`daemon/protection/auto-checkpoint.ts`
  - 新增：`src/components/ProtectionCard.tsx`
  - 测试：`tests/unit/protection-silent-contract.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：保护路径在 VIBE 与 PROTECTED 下写入均被规则拦截（零模型调用）；无保护清单全程零弹窗；撤销按钮一键恢复现场；冲突时主分支版本永远胜出。
  - **FAIL**：保护路径被静默写入；出现 Git 冲突解决界面；弹窗超过一个是/否问题。

---

### 3.6 控制面 API 补齐、快照持久化与合并核销（Sprint 3；前置 C.5/P.1/W.4 于 Sprint 2 完成）

#### 【Task D.2】控制面 API 补齐、合并门禁（一键合并）与 Git Trailer 审计
* **任务编号**：`TASK-D.2`
* **前置依赖**：`TASK-D.1`, `TASK-W.4`, `TASK-C.5`, `TASK-P.1`（v1.3.3：移除已推迟的 `TASK-B.2`）
* **任务状态**：**[INCREMENTAL_UPGRADE]**
* **核心目标**：
  1. `POST /api/contracts/:id/approve`：校验 `contract_revision` 与授权指纹（防 TOCTOU），原子推进双状态并创建 Worktree。**v1.3.3 减负**：合同 Scope 与全局保护清单**无交集时自动批准**（记录备案，无需用户点击）；有交集时向用户发**至多一个**白话是/否问题。
  2. `POST /api/contracts/:id/resume`：**双路径裁决负例断言 (G-14)**：
     - 安全违规类 (`SCOPE_VIOLATION`, `UNAUTHORIZED_COMMAND`, `UNSAFE_EXECUTION`) 调用 resume 返回 `409 Conflict`；
     - 预算类 resume：**v1.3.3 减负**——未触碰保护清单时不重批、只记录备案，恢复前后重试计数与累计开销保持连续；触碰保护清单时才要求新审批版本。
  3. `POST /api/contracts/:id/abort` 与 `reject` 接口。
  4. **并发互斥与工作区互斥锁守卫 (G-21)**：
     - 依据 A §6.4(2) 与 §4.2，同一合同的 execute/resume/abort/merge 操作实施强互斥锁；
     - 并发重复调用立即拒绝并返回 HTTP 409 / 错误码 `E_WORKSPACE_LOCKED`，且不启动额外 Worker；
     - 写入 `verdict.status = "BLOCKED"`，对应 `reason_code = "WORKSPACE_LOCKED"`。
  5. **合同与证据快照持久化 (闭环 G-05)**：
     - 合并核销成功后，将合同快照写入 `.stagent/contracts/{contract_id}.json`，证据快照写入 `.stagent/evidence/{contract_id}-{evidence_id}.json`，文件模式严格设为 `0600`。
  6. 严格执行合并门禁（Gate 0 受控源 ➔ Gate 1 主树 Clean ➔ Gate 2 状态通过 ➔ Gate 3 实时指纹复核 ➔ Gate 4 测试完整性）。**v1.3.3 修订**：删除 Gate 5 二次确认弹窗，`can_merge=true` 时**一键合并**；Gate 3 实时指纹复核保留为 Daemon 后台兜底，用户不可见。**合并冲突仲裁（User-First Discard Rule）**：发生 Git 冲突时永远以用户主分支当前版本为准，直接丢弃 Worktree 冲突改动并提示 AI 重新基于最新代码修改，不向用户展示冲突解决界面。
  7. 写入 A §5.2 的 4 个标准 Git Trailer（`Audited-By`, `Stagent-Contract-ID`, `Stagent-Evidence-ID`, `Stagent-Verdict`），执行 Squash Merge 并清理 Worktree。
* **涉及核心文件**：
  - 修改：`daemon/server.ts`
  - 修改：`daemon/pipeline/merger.ts`
  - 修改：`daemon/pipeline/evidence-verifier.ts`
  - 测试：`tests/unit/control-plane-approve.test.ts`
  - 测试：`tests/unit/control-plane-merge-gates.test.ts`
  - 测试：`tests/unit/control-plane-resume.test.ts`
  - 测试：`tests/unit/control-plane-concurrent-lock.test.ts`（并发 409 E_WORKSPACE_LOCKED 与 BLOCKED Evidence 断言）
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 边界违规合同调用 resume 必然返回 409。
    - 主树 Dirty、Evidence STALE 或 Agent 非受控时 Merge 坚决拒绝。
    - 合并成功后，Commit 包含 4 个标准 Trailer，且 `.stagent/contracts/` 与 `.stagent/evidence/` 快照文件完整落地。
  - **FAIL**：残留 `X-Stagent-*` 临时键；合并后未写入规范快照。

---

### 3.7 端到端集成与自举发版（Sprint 6）

#### 【Task E.1】双 Agent 协同与全流程 E2E 自动化测试
* **任务编号**：`TASK-E.1`
* **前置依赖**：`TASK-D.2`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. Happy Path 全生命周期无人值守自动化回归。
  2. **覆盖 8 类故障分支自动化拦截 (闭环 G-07)**：
     - 故障 1：超时重试熔断；
     - 故障 2：测试文件未经授权篡改阻断；
     - 故障 3：外部手动修改触发 Evidence STALE 阻断；
     - 故障 4：主树 Dirty 阻断合并；
     - **故障 5（v1.3.3 限定）：保护模式下，未批准合同尝试触碰保护资产必须被拒绝**（Vibe 模式下无合同门槛，不适用本条，但保护清单拦截恒生效）；
     - **故障 6：Supervisor 建议尝试直接触发执行必须被拒绝**；
     - **故障 7：Worker 完成声明不得直接改变状态为 PASSED**；
     - **故障 8：外部非受控 Agent 的输出严禁作为受控 Evidence 通过**。
  3. **Vibe 模式新增用例（v1.3.3）**：
     - 新项目、无保护清单、无合同：Agent 新建/修改文件并运行测试，全程零弹窗零审批，Header 显示"自由模式"；
     - Auto-Checkpoint 生成与【撤销本轮改动】一键恢复现场；
     - 保护路径在 VIBE 与 PROTECTED 下写入均被规则拦截；
     - 未触保护区任务用户交互次数 = 1（合并按钮）；触保护区 ≤ 2（一个是/否 + 合并）；
     - 合并冲突时 User-First Discard：以主分支为准丢弃 Worktree 冲突改动。
* **涉及核心文件**：
  - 新增：`tests/e2e/dual-agent-workflow.test.ts`
  - 新增：`tests/e2e/fault-injection-regression.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：全链路 E2E 退出码为 0；8 类故障分支全部断言成功触发阻断。
  - **FAIL**：出现任何安全越权或测试挂起。

---

#### 【Task E.2】Stagent 仓库自举 (Dogfooding) 与发版交付
* **任务编号**：`TASK-E.2`
* **前置依赖**：`TASK-E.1`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. 在 Stagent 自身代码库中通过本地工作台完成真实自举演练。
  2. 输出演练报告 (`docs/reports/v0.1-dogfooding-report.md`)，客观披露实际开销与平台边界。
  3. 执行 `npm run build`，产出完整干净的生产发行包。
* **涉及核心文件**：
  - 新增：`docs/reports/v0.1-dogfooding-report.md`
  - 产出：`package.json`（v0.1.0）、生产 dist 目录
* **Pass/Fail 验收判定**：
  - **PASS**：自举 Commit 合规包含 4 个 Trailer，CLI 输出正常，生产构建 0 错误。
  - **FAIL**：生产构建失败或缺少依赖。

---

## 4. 单人串行排期与门禁实施指南 (Sprint Schedule，v1.3.3 去过载重排)

> **v1.3.3 重排原则**：阶段解耦、最小可用闭环前置。Sprint 1 结束即可端到端演示「右栏 Agent 改代码 → Monaco 查看」；Sprint 2 结束可演示「Diff + 保护清单 + 撤销」并完成受控执行前置（W.3/W.4）；Sprint 3 结束可演示「一键合并」。架构雷达（B.1/B.2/C.4）、成熟度评分与 RFC-2026-002 内容整体推迟至 v0.2+ 另行立项 `[用户已确认 D4 · 2026-10-20]`。

| 迭代阶段 (Sprint) | 计划推进任务卡 | 阶段核心交付物 | 强制门禁检查点 (Gate Check) |
| :--- | :--- | :--- | :--- |
| **Sprint 1: 最小端到端（Vibe）** | `TASK-C.1`（三栏骨架）➔ `TASK-C.6`（右栏流式会话）➔ `TASK-W.5a`（Claude Code cli-host 挂载）➔ `TASK-C.3`（Monaco 读写） | 三栏布局、右栏流式/打断/续接、Claude Code 子进程挂载与 Headless 输出 | 右栏 Claude Code 改文件，中栏实时可见，可打断（≤2s）、可续接；全量既有测试以最新 CI 结果为准保持绿灯 |
| **Sprint 2: 保护清单 + 受控执行前置** | `TASK-P.1`（保护清单 + 快照撤销 + 静默合同）➔ `TASK-C.5`（Diff 与终端）➔ `TASK-W.3`（环境/秘密/网络守卫）➔ `TASK-W.4`（威胁守卫与能力复检） | `.stagent/protection.json`、Auto-Checkpoint、【撤销本轮改动】、Header 模式指示、Diff 审阅、环境与网络守卫、`threat-guard.ts` | 保护路径任意模式被拦截；撤销一键恢复；W.4 的 4 类绕过路径负例断言通过；**D.2 的三条前置（C.5、P.1、W.4）全部达成** |
| **Sprint 3: 受控执行实测 + 一键合并** | `TASK-W.5a` 绕过负例实测收尾 ➔ `TASK-D.2`（一键合并，复用 merger，移除 Gate 5 弹窗） | 保护模式合同（自动批准/单问）、Worktree 执行、Evidence 生成、一键合并与 Git Trailer | Claude Code 在 `GATEWAY_ENFORCED` 下 4 类绕过负例全部失败关闭；`verified_on` 填写实测版本与日期；未触保护区任务用户交互 = 1 次（合并按钮），触保护区 ≤ 2 次 |
| **Sprint 4: Supervisor 规则优先** | `TASK-S.1` v1.3.3 增量（独立预算/规则优先/默认关防抖）➔ `TASK-S.2`（按需草案 L0/L1 精简版，白话文案，移植 `redaction.ts`）➔ `TASK-C.2`（Studio 精简版） | L0 规则引擎、L1 按需强模型、独立预算分账、白话草案、脱敏模块 | VIBE 下 30 分钟连续聊天 Supervisor 模型调用 = 0（未点击时）；草案 100% parse 通过 |
| **Sprint 5: 第二/第三个 Agent** | `TASK-W.5b` ➔ `TASK-W.5c` | cursor-agent / OpenHands（`SANDBOX_ENFORCED`）各自 cli-host 实测、计费模型分支 | 每个 Adapter 的 `verified_on` 如实填写；未通过者仅 Vibe 可用且 UI 显示"未受控" |
| **Sprint 6: E2E 与自举发版** | `TASK-E.1`（含 Vibe、保护清单与各 Adapter 用例）➔ `TASK-E.2` | 8 类故障分支（故障 5 限定保护模式）+ Vibe 专项用例、Dogfooding 报告、发版打包 | 全部故障分支阻断成功；`npm run build` 产出干净构建包；报告披露各 Agent 实测限制 |
| **v0.2+（推迟，另行立项）** `[用户已确认 D4 · 2026-10-20]` | `TASK-B.1` ➔ `TASK-B.2` ➔ `TASK-C.4` ➔ `TASK-S.3`（建议广播、成熟度评分与 HUD 徽章/Snooze）➔ RFC-2026-002（多子任务 DAG / 新鲜上下文 / Schema-First / 并行 Worktree） | 架构雷达、成熟度评分、多 Agent 编译流水线 | 另行立项评审 |

### 跨阶段门禁准则 (Gate Alignment)
根据 A §10 规定，阶段内任务支持依据 DAG 拓扑关系进行并行编码与单元验证；跨阶段进入联调前，必须以当前 Sprint 的 Gate Check 检查点为准绳，跑通：
```bash
node scripts/verify-env.mjs && npx tsc --noEmit && npm run lint && npm test
```
全部通过后方可推进下一阶段。

---

## 5. 路径映射约定（2026-10-20 核定）

仓库保留既有 `daemon/` 顶层结构，**不再新建平行的 `src/daemon/`**。各任务卡「涉及核心文件」已按下列映射逐条改写为仓库实际布局：

| 任务卡旧路径（v1.2.0 及更早） | 仓库实际路径 |
|---|---|
| `bin/stagent.mjs` / `src/cli/index.ts` | `bin/stagent.ts`（CLI 单一入口） |
| `src/daemon/ws-server.ts` / `src/daemon/http-router.ts` | `daemon/server.ts` |
| `src/daemon/ws-types.ts` | `src/lib/ipc/frames.ts`（协议为 Daemon 与浏览器共享，留在共享协议模块） |
| `src/daemon/scoped-mcp-gateway.ts` | `daemon/mcp/gateway.ts` |
| `src/daemon/process-runner.ts` | `daemon/runner/command-runner.ts` |
| `src/daemon/git-merger.ts` | `daemon/pipeline/merger.ts` |
| `src/daemon/evidence-stale-manager.ts` | `daemon/watcher/invalidation-engine.ts` |
| `src/daemon/evidence-verifier.ts` | `daemon/pipeline/evidence-verifier.ts`（待建） |
| `src/supervisor/*` | `daemon/supervisor/*`（待建） |
| `src/worker/*` | `daemon/worker/*`（待建） |
| `src/architecture/*` | `daemon/arch/*`（既有 `graph.ts`/`parser.ts`） |
| `src/watcher/worktree-watcher.ts` | `daemon/watcher/fs-watcher.ts` |
| `src/ui/components/*` | `src/components/*` |
| `src/ui/hooks/*` | `src/hooks/*`（WS 客户端 Hook 既有 `use-daemon-stream.ts`） |

**v1.3.3 新增模块路径（成熟 Agent 与保护清单）**：

| 模块 | 路径 | 说明 |
|---|---|---|
| 成熟 Agent 子进程隔离 | `daemon/worker/cli-host/` | **全仓唯一允许 `child_process`/spawn 的位置**；强制结构化 argv + `shell:false` + 进程树托管回收 |
| Claude Code 适配器 | `daemon/worker/cli-host/claude-code-adapter.ts` | Headless 结构化输出、Pre-tool hook 拦截、会话续接；`verified_on` 为空即待实机验证 |
| 全局保护清单 | `daemon/protection/protection-list.ts` + `.stagent/protection.json` | 路径 glob + 白话名称；任何模式下规则拦截 |
| Vibe 自动快照 | `daemon/protection/auto-checkpoint.ts` | Agent 改动前自动快照，支撑【撤销本轮改动】 |
| Supervisor 独立预算 | `.stagent/supervisor-budget.json` | 与合同/Worker 预算分账，不互相侵占 |

> **静态约束口径（v1.3.3 收窄）**：`daemon/worker/**` 维持零 `child_process` 静态禁令，唯一例外为 `daemon/worker/cli-host/**`；该例外的测试断言为"cli-host 之外零 spawn"。

测试文件统一归 `tests/{unit,daemon,integration,e2e}/`；浏览器 DOM 测试归 `src/tests/`、`src/hooks/`（vitest `dom` project）。

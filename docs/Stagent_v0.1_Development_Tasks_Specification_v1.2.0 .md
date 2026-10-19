# Stagent v0.1 研发任务拆解与工程执行规范 (v1.2.2 终审签发版)

> **文档定位与最高基准**：本规范以《Stagent 系统架构设计规范 (v1.2.1 双 Agent IDE 终审基线)》为唯一法典事实源，全面闭环第二轮复审报告提出的 **11 项 P1 缺口与 9 项 P2 规范细节**。
> **代码基线事实**：以本地仓库当前测试基线为物理起点（2026-10-20 实测：48 个测试文件、377 个用例全绿；包含 Git Worktree 物理隔离、Scoped MCP 网关、白名单受限执行、跨平台进程树全回收、Test Integrity Guard、TOCTOU 快照校验与自愈底座，以及 TASK-0.2b Schema v1.2.0 与 TASK-D.1 安全通信桥）。
> **核心修订成果 (v1.2.2)**：
> 1. **新增 `TASK-W.4` 威胁守卫与能力复检**：闭环 G-01 与 G-20，落地 `UNSAFE_EXECUTION` 判定与 4 类绕过负例断言，提供运行时强制能力复检与降级。
> 2. **契约与字典双向回写**：修正 `stagent_write_file` 的 `expected_hash?` 为可选（G-03）；WS 帧字典同时保留 `EVIDENCE_READY`、`EVIDENCE_STATUS_CHANGED` 与 `TERMINAL_STREAM`（G-02）；回写 A §9.3 错误码表与 §6.1 帧字典（G-19）。
> 3. **执行命令注入防线断言**：在 W.2/W.4 中强制断言结构化 argv 与 `shell: false`，字面量拦截连接符与子 Shell（G-04）。
> 4. **快照持久化前置闭环**：在 D.2 补齐 `.stagent/contracts/` 与 `.stagent/evidence/` 快照落盘子项（G-05）。
> 5. **UI 与全流程授权断言**：C.1 补齐“模式”与“Worker 受控徽标”（G-06）；E.1 故障分支扩充为 8 类（覆盖 4 类授权不变式与非受控隔离，G-07）；账本断言持久化、切换不清零与分列记账（G-09）。

---

## 1. 任务体系与研发全景矩阵 (Engineering Matrix)

### 1.1 研发任务与规范 §10 路线映射表 (全量 18 项闭环)

| 任务编号 | 任务名称 | 归属模块 | 状态 | 规范 §10 里程碑 | 关键变动与工程闭环要点 (v1.2.2) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-0.1** | 工程锁文件与跨平台 CI 自动化基线 | 基础设施 | **[COMPLETED]** | P0 基础设施 | 依赖锁死、`verify-env.mjs` 门禁脚本、跨平台环境校验已就绪。 |
| **TASK-0.2b** | Schema v1.2.0 增量演进、双状态机联动与存量迁移 | 数据模型 | **[COMPLETED]**（提交 `52c807c`；全量 48 文件 / 377 用例绿，typecheck/lint 通过；G-09 第 3 子项"工具/命令分列记账"按交付报告移交 TASK-W.3） | P0 契约底座 | • 升级 `SoftwareContractV12` 与 `EvidenceBundleV11` 完整字段<br>• 实现 `validateStatePair`、`validateTransition` 与原子落盘<br>• 承接 v1.1.3 历史合同迁移与备份机制<br>• 13 ➔ 9 ErrorCode Catalog 全量映射（新增 `tests/unit/error-codes-mapping.test.ts`，G-15）<br>• 状态矩阵增补 3 条分支断言（`ABORTED+APPROVED`、拒绝后禁止回 DRAFT、ABORTED 终态，G-17）<br>• 账本持久化、模型切换不清零、工具/命令分列记账断言 (G-09) |
| **TASK-D.1** | CLI 引导入口与安全 WebSocket 通信桥 | 通信核销 | **[COMPLETED]**（2026-10-20；48 文件 / 377 用例全绿，含首帧 50ms 切断、Token 轮换、Origin/Host/2MB/速率/心跳断言） | P1 通信鉴权 | • 提前至 Sprint 1 解除 DAG 死锁<br>• CLI `stagent start`、动态端口 (3001~3010)、PID 锁与 Token 轮换 (G-13)<br>• 首帧 AUTH 握手鉴权、非法以 `4401` 关闭<br>• 规范帧字典（同时保留 `EVIDENCE_READY`、`EVIDENCE_STATUS_CHANGED`、`TERMINAL_STREAM`，G-02）<br>• 补齐 Origin 校验、帧大小（≤2MB）与速率限制（G-12）、失联 3 次心跳遮罩 (G-13) |
| **TASK-A.1** | Git Worktree 物理隔离与生命周期管理 | 执行内核 | **[COMPLETED]** | P1 本地 Git | Worktree 创建、销毁、分支保护与 `.git/info/exclude` 隔离就绪。 |
| **TASK-A.2** | Scoped MCP 工具网关与路径沙箱校验 | 执行内核 | **[COMPLETED]** | P2 安全网关 | 路径防逃逸、Scope 读写授权、禁区强拦截与环境脱敏就绪。 |
| **TASK-A.3** | 依赖分级复用与工作区构建缓存隔离 | 执行内核 | **[COMPLETED]** | P1 依赖隔离 | 只读依赖复用 (ADR-002)、构建缓存目录隔离与符号链接降级就绪。 |
| **TASK-A.4** | 受限进程执行器与跨平台进程树全回收 | 执行内核 | **[COMPLETED]** | P2 进程执行 | 白名单命令执行、POSIX 进程组 / Windows taskkill 回收就绪。 |
| **TASK-A.5** | 循环重试熔断与费用/Token 硬上限监控 | 执行内核 | **[COMPLETED]** | P2 熔断守护 | 验证重试熔断 (`max_verification_retries: 3`)、超时与费用预检就绪。 |
| **TASK-A.6** | Daemon 崩溃自愈、Git 锁清理与 TOCTOU 校验 | 执行内核 | **[COMPLETED]** | P1 崩溃自愈 | 孤儿锁安全回收、`resume()` 扫描自愈、快照指纹校验就绪。 |
| **TASK-S.1** | Supervisor 建议会话与持久化存储管理 | 建议中枢 | **[NEW_TASK]** | P4 智能建议 | • Local-First 会话落盘 (`.stagent/sessions/`)、Prompt Pipeline<br>• 依赖层静态 AST 扫描禁令 + **运行时越权调用拦截正例断言 (G-11b)**<br>• 纳入共享 Token/费用预算账本 (超限拒绝模型调用) |
| **TASK-S.2** | 需求成熟度评估器与合同草案生成引擎 | 建议中枢 | **[NEW_TASK]** | P4 合同草案 | • 对话成熟度评估 (含 `assessed_at`、`model_id`)<br>• 成熟度纯建议性、禁止作为门禁 (低分/未评分合同可签署)<br>• 草案全字段生成 (含必填 `worker_spec`)<br>• **断言未决问题 100% 保留至草案元数据供用户确认 (G-11)** |
| **TASK-S.3** | Supervisor HUD 建议流与 WebSocket 广播 | 建议中枢 | **[NEW_TASK]** | P4 HUD 广播 | • WebSocket 建议帧广播 (`SUPERVISOR_SUGGESTION`)<br>• 客户端 ACCEPT/SNOOZE/DISMISS 交互与 10min 静默去重 |
| **TASK-W.1** | Coding Worker 适配器抽象与能力声明 | 编码内核 | **[NEW_TASK]** | P2 Worker 适配 | • 统一 `CodingWorkerAdapter` 接口，支持 Managed AI / CLI<br>• **`AdapterCapabilityDeclaration` 补齐第 9 项 `known_limitations` (G-10)**<br>• 区分 `GATEWAY_ENFORCED` 与 `UNCONTROLLED_EXTERNAL`，默认拒绝未知能力 |
| **TASK-W.2** | Scoped Gateway 强制工具注入与执行拦截 | 编码内核 | **[NEW_TASK]** | P2 工具管辖 | • 统一为 `stagent_*` 命名空间 5 工具<br>• **`stagent_write_file` 的 `expected_hash?` 调整为可选（未传为新建，传入做乐观锁，G-03）**<br>• **强制结构化 argv 且 `shell:false` 调用，字面量拦截注入符号 (G-04)**<br>• 越界修改/非法命令阻断并标记 `BLOCKED` |
| **TASK-W.3** | 测试环境、秘密脱敏与网络/端口策略守卫 | 编码内核 | **[NEW_TASK]** | P2 环境网络 | • 环境变量白名单过滤、`CI=true` 注入、`env_file_grants` 按命令授权<br>• **秘密遮蔽严密发生在日志截断之前**<br>• 网络策略拦截 (`DENY` / `EXPLICIT_TARGETS` / `USER_APPROVED`)、动态端口 |
| **TASK-W.4** | 高风险执行威胁守卫与运行时能力复检 | 编码内核 | **[NEW_TASK]** | P2 安全威胁 | • **闭环 G-01 & G-20**：落地 `daemon/worker/threat-guard.ts`<br>• 命令 argv 与仓库信任检查，高风险特权命令抛 `E_UNSAFE_EXECUTION` 并阻断<br>• 会话期周期性复检，检测到绕过立即降级为 `UNCONTROLLED_EXTERNAL` 并阻断 Evidence<br>• **落实 4 类绕过路径不可用负例断言** |
| **TASK-B.1** | 本地 AST 增量依赖图分析引擎 | 架构感知 | **[NEW_TASK]** | A §3 架构引擎 | • **统一路径前缀：`src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}` (G-16)**<br>• 冷启动 ≤1.5s，单文件增量修补 ≤20ms |
| **TASK-B.2** | 多活跃 Worktree 监听与 Evidence 状态联动 | 架构感知 | **[INCREMENTAL_UPGRADE]** | P4 状态失效 | • 扩展多活跃 Worktree 监听，排除 `.git`/`.stagent`/`dist` 等<br>• 外部变更 50ms 内触发 Evidence `STALE` 并广播 `EVIDENCE_STATUS_CHANGED` |
| **TASK-C.1** | Cursor 式三栏 IDE 响应式工作台骨架 | 前端呈现 | **[NEW_TASK]** | P3 工作台闭环 | • 左侧文件树/Git 状态、中栏多标签、右栏双 Agent 对话<br>• **Header 补齐：模式（探索/合同执行）、Worker 受控徽标、当前任务分支 (G-06)**<br>• **审批后默认绑定合同 Worktree，主树编辑显式切换提示 (G-18)** |
| **TASK-C.2** | 悬浮 Supervisor HUD 与合同审批面板 | 前端呈现 | **[NEW_TASK]** | P4 审批界面 | • 页面内悬浮 HUD 胶囊、成熟度指示器、未决风险气泡<br>• 审批弹窗展示完整 Scope、预算与验证命令，用户显式批准 |
| **TASK-C.3** | Monaco 核心编辑器集成与受控 Worktree 读写 | 前端呈现 | **[NEW_TASK]** | P3 代码编辑 | • Monaco Editor 嵌入，可写/只读视觉区分，**编辑器内 Evidence STALE 指示 (G-18)**<br>• 服务端保存校验：`POST /api/worktree/files` 越权写入由 Daemon 403 拒绝 |
| **TASK-C.4** | 架构雷达视图与 Scope 圈选抽屉 | 前端呈现 | **[NEW_TASK]** | P3 架构雷达 | • 1000 节点拓扑渲染 (≤16ms patch, ≤30MB 内存)<br>• 交互式 Scope 圈选，已批准合同圈选禁止原地扩权 |
| **TASK-C.5** | 双栏 Diff 审阅器与结构化终端日志回放 | 前端呈现 | **[NEW_TASK]** | P3 差异终端 | • 双栏/内联 Git Diff 审阅<br>• 结构化终端流式日志展示、ANSI 渲染、先脱敏后截断 |
| **TASK-D.2** | 控制面 API 补齐、六大合并门禁与审计核销 | 通信核销 | **[INCREMENTAL_UPGRADE]** | P5 核销合并 | • 提供 `POST /api/contracts/:id/approve` (防 TOCTOU)<br>• `resume` 提供**双路径裁决负例断言** (违规返回 409，G-14)<br>• **合并成功后原子落盘合同与证据快照至 `.stagent/` 目录 (G-05)**<br>• 对齐 A §5.2 的 4 个 Git Trailer，执行六大物理合并门禁 |
| **TASK-E.1** | 双 Agent 协同与全流程 E2E 自动化测试 | 集成测试 | **[NEW_TASK]** | P6 集成自举 | • 覆盖 Happy Path 全生命周期无人值守自动化回归<br>• **覆盖 8 类故障分支（含 4 类授权不变式与非受控隔离，G-07）** |
| **TASK-E.2** | Stagent 仓库自举 (Dogfooding) 与发版交付 | 交付发版 | **[NEW_TASK]** | P6 真实验证 | 真实仓库自举演练、用量与已知限制客观报告、生产打包构建。 |

---

## 2. 关键路径与 DAG 拓扑依赖 (Critical Path DAG)

### 2.1 依赖关系与机器可读边清单 (Machine-Readable Edges)

```
TASK-0.1 ──► TASK-0.2b ──► TASK-D.1
                             │
       ┌─────────────────────┼─────────────────────┬─────────────────────┐
       ▼                     ▼                     ▼                     ▼
  TASK-S.1 (Supervisor) TASK-W.1 (Worker)     TASK-B.1 (AST)        TASK-C.1 (IDE 布局)
       │                     │                     │                     │
       ▼                     ▼                     ▼                     ▼
  TASK-S.2 (Draft)      TASK-W.2 (Gateway)    TASK-B.2 (Watcher)    TASK-C.2 (HUD 审批)
       │                     │                                           │
       ▼                     ▼                                           ▼
  TASK-S.3 (Broadcast)  TASK-W.3 (Policy Guard)                     TASK-C.3 (Monaco 编辑)
       │                     │                                           │
       │                     ▼                                           ▼
       │                TASK-W.4 (Threat Guard)                     TASK-C.4 (雷达 Scope)
       │                     │                                           │
       │                     │                                           ▼
       │                     │                                      TASK-C.5 (Diff 终端)
       │                     │                                           │
       └─────────────────────┴─────────────────────┬─────────────────────┘
                                                   │
                                                   ▼
                                              TASK-D.2 (控制面 API、快照与合并门禁)
                                                   │
                                                   ▼
                                              TASK-E.1 (8 类故障分支全流程 E2E)
                                                   │
                                                   ▼
                                              TASK-E.2 (真实自举 Dogfooding 发版)
```

**机器可读拓扑边列表 (JSON Edges)**：
```json
[
  {"from": "TASK-0.1", "to": "TASK-0.2b"},
  {"from": "TASK-0.2b", "to": "TASK-D.1"},
  {"from": "TASK-D.1", "to": "TASK-S.1"},
  {"from": "TASK-S.1", "to": "TASK-S.2"},
  {"from": "TASK-S.2", "to": "TASK-S.3"},
  {"from": "TASK-D.1", "to": "TASK-W.1"},
  {"from": "TASK-W.1", "to": "TASK-W.2"},
  {"from": "TASK-W.2", "to": "TASK-W.3"},
  {"from": "TASK-W.3", "to": "TASK-W.4"},
  {"from": "TASK-D.1", "to": "TASK-B.1"},
  {"from": "TASK-B.1", "to": "TASK-B.2"},
  {"from": "TASK-D.1", "to": "TASK-C.1"},
  {"from": "TASK-C.1", "to": "TASK-C.2"},
  {"from": "TASK-C.2", "to": "TASK-C.3"},
  {"from": "TASK-C.3", "to": "TASK-C.4"},
  {"from": "TASK-C.4", "to": "TASK-C.5"},
  {"from": "TASK-S.3", "to": "TASK-D.2"},
  {"from": "TASK-W.4", "to": "TASK-D.2"},
  {"from": "TASK-B.2", "to": "TASK-D.2"},
  {"from": "TASK-C.5", "to": "TASK-D.2"},
  {"from": "TASK-D.2", "to": "TASK-E.1"},
  {"from": "TASK-E.1", "to": "TASK-E.2"}
]
```

---

## 3. 详细任务卡明细 (Task Cards)

### 3.1 契约基线与通信底座 (Sprint 1)

#### 【Task 0.2b】Schema v1.2.0 增量演进、双状态机联动与存量迁移
* **任务编号**：`TASK-0.2b`
* **前置依赖**：`TASK-0.1` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-20 交付，提交 `52c807c`；验证：`npm test` 全量绿、`tsc --noEmit` 0 错误、eslint 全目录 0 违规；交付明细见 `docs/reports/TASK-0.2b-交付与验证报告.md`）
* **核心目标**：
  1. 升级 `SoftwareContractV12` 与 `EvidenceBundleV11` 完整定义，逐字段 100% 对齐 A §9.1/§9.2。
  2. 落实 `can_merge` 派生不变式：`superRefine` 校验 `status === "PASSED"` 且无违规无超额；外部写入类型 `Omit<Verdict, "can_merge">`。
  3. 重构状态机校验器：实现 `validateStatePair` 与 `validateTransition`，落盘采用原子写入 (`writeTemp + fsync + rename`)。
  4. **补齐状态机 3 条关键分支断言 (G-17)**：
     - 正例：`ABORTED + APPROVED`（已批准后发生故障安全中止，保留历史审批记录）；
     - 负例：合同被拒绝 (`ABORTED + REJECTED`) 后不得原地回到 `DRAFT`；
     - 负例：`ABORTED` 为终态，不得经 `resume` 跃迁至 `EXECUTING`。
  5. **补齐用量账本 3 项断言 (G-09)**：
     - 用量跨 Daemon 重启持久化重载一致；
     - 切换模型供应商后累计开销不清零；
     - 模型费用上限与命令/工具调用上限分列记账，独立触发熔断。
  6. **补齐 ErrorCode Catalog 完备性测试 (G-15)**：新建 `tests/unit/error-codes-mapping.test.ts`，表驱动测试 13 个 `error_code` 到 9 个 `reason_code` 的双向映射（新增 `E_UNSAFE_EXECUTION ➔ UNSAFE_EXECUTION`）。
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
    - `tests/unit/state-machine-matrix.test.ts` 完整通过 A §9.1.1 组合矩阵与 3 条新分支断言。
    - `tests/unit/error-codes-mapping.test.ts` 13 ➔ 9 双向映射 100% 通过。
    - 账本持久化与分列记账断言通过。
  - **FAIL**：缺少任一字段校验；状态机允许非法跃迁。

---

#### 【Task D.1】CLI 引导入口与安全 WebSocket 通信桥
* **任务编号**：`TASK-D.1`
* **前置依赖**：`TASK-0.2b`
* **任务状态**：**[COMPLETED]**（2026-10-20 交付；验证：`npm test` 全量 48 文件 / 377 用例绿、`tsc --noEmit` 0 错误、eslint 0 违规、verify-env 通过；变更明细与偏差记录见本节末尾「D.1 交付附注」）
* **核心目标**：
  1. CLI 工具 (`stagent start`)：动态端口 (3001~3010) 探测、PID 锁获取、Token 写入 (`.stagent/session-token`，权限 `0600`) 并唤起浏览器。
  2. **首帧 AUTH 鉴权闭环**：首帧必须为 `{ type: "AUTH", payload: { token } }`，校验失败立即以关闭码 `4401` 断开连接，不产生无限重连；服务端日志严禁打印 Token 明文。
  3. **规范 WS 帧字典 (G-02)**：
     - 同时保留 `EVIDENCE_READY`（证据生成完成待核销）与 `EVIDENCE_STATUS_CHANGED`（状态流转与外部变动失效）以及 `TERMINAL_STREAM`（命令执行流式日志）。
  4. **补齐 Origin、速率与心跳防护 (G-12/G-13)**：
     - 校验 `Origin`，仅放行本地合法来源 (`http://127.0.0.1:*` / `http://localhost:*`)，拒绝非法来源；
     - 限制单连接帧大小 ≤ 2MB，限制连接频率防 DoS；
     - 客户端 5s 心跳 PING，连续 3 次未收到 PONG（15s）在前端呈现重连遮罩；
     - Daemon 获取 PID 锁后强制轮换 Token，崩溃残留旧 Token 自动失效。
* **涉及核心文件**（已按仓库实际布局修正，见文末「路径映射约定」）：
  - 修改：`bin/stagent.ts`（CLI 入口，原卡片的 `bin/stagent.ts` + `bin/stagent.ts` 合并于此）
  - 修改：`daemon/server.ts`（WS 服务，原 `daemon/server.ts`）
  - 修改：`src/lib/ipc/frames.ts`（帧字典与 FRAME_CATALOG，原 `src/lib/ipc/frames.ts`；协议为 Daemon/浏览器共享，故留在共享协议模块）
  - 修改：`src/lib/ipc/client.ts`（心跳 15s 判定修正）
  - 修改：`src/lib/daemon-api.ts`（Token 仅经 `#fragment` 引导，删除 `?token=` query 通道）
  - 修改：`src/hooks/use-daemon-stream.ts`（原 `src/hooks/use-daemon-stream.ts`）
  - 测试：`tests/unit/ws-auth-handshake.test.ts`（首帧握手 / 50ms 切断 / Token 轮换 / 日志无明文）
  - 测试：`tests/unit/ws-frame-dictionary.test.ts`（13 类规范帧 + 目录完备性）
  - 测试：`tests/unit/cli-entry.test.ts`（参数解析 / fragment 构造 / 平台 opener）
  - 测试：`tests/daemon/ws-security.test.ts`（Origin / Host / 2MB / 速率 429 / query 禁令 / 方向门禁 / 默认端口）
  - 测试：`src/hooks/use-daemon-stream.test.tsx`（3 次心跳失联 → reconnecting）、`src/tests/daemon-api-token.test.tsx`（query 忽略 / fragment 抹除）
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 首帧非 AUTH 或 Token 错误在 50ms 内被 4401 切断。
    - 非法 Origin 连接被直接拒绝。
    - 模拟 3 次心跳丢失触发 UI 重连遮罩。
    - Token 轮换断言：新实例启动后，旧 Token 发送 AUTH 必然返回 4401。
  - **FAIL**：允许 URL Query 传 Token；未鉴权连接可接收广播帧。
* **D.1 交付附注**（2026-10-20）：
  - 心跳判定修正为「AUTH_OK 立即 PING，第 3 次失联落在 15s」（原实现为 20s，off-by-one）；UI 遮罩由 `status === "reconnecting"` 驱动，遮罩组件本体属 TASK-C.x。
  - 增强项（不超出规范）：Host 头回环校验（DNS Rebinding 防线，A §6.1"校验 Origin 与会话权限"的补足，因重绑定后 GET 不带 Origin）；WS `maxPayload = 2MB`（超限以 1009 关闭）；连接速率限制默认 30 次/10s/IP 可配置；帧方向门禁（客户端伪造 `server->client` 帧返回 `FRAME_DIRECTION_FORBIDDEN` 错误帧，不断连）。
  - 规范偏差：① Origin 白名单额外放行 `::1`（A §4 仅要求 loopback，`::1` 属回环超集）；② 浏览器唤起时 Token 经 URL **fragment**（`#token=`）传递 —— 规范仅禁止 query，fragment 不随请求发送且读取后立即 `history.replaceState` 抹除；③ `WORKER_LOG`/`SCOPE_ALERT` 两个 v1.1 历史扩展帧按 A §6.1"至少包括"措辞保留，证据失效现已同时广播规范帧 `EVIDENCE_STATUS_CHANGED`。
  - 端口默认值由 41792~41802 修正为本卡片的 3001~3010（`daemon/server.ts`、`src/lib/daemon-api.ts`）。

---

### 3.2 Supervisor 建议中枢实现 (Sprint 2)

#### 【Task S.1】Supervisor 建议会话与持久化存储管理
* **任务编号**：`TASK-S.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. Local-First 会话管理，落盘至 `.stagent/sessions/{session_id}.json`，文件模式 `0600`。
  2. 依赖层 AST 扫描禁令：禁止引入 Gateway/Merger/Verifier/ProcessRunner/child_process。
  3. **落实运行时越权调用拦截正例断言 (G-11b)**：
     - 若 Supervisor 上下文尝试调用 `approveContract`、`mergeContract`、`setVerdict`、`execCommand`，底层控制面坚决抛出权限拒绝异常，产生 `GATEWAY_VIOLATION` 审计事件。
  4. 纳入共享账本：累计开销计入当前合同，达到 `cost_limits` 拒绝继续调用模型。
* **涉及核心文件**：
  - 新增：`daemon/supervisor/session-manager.ts`
  - 新增：`daemon/supervisor/prompt-builder.ts`
  - 新增：`daemon/supervisor/types.ts`
  - 测试：`tests/unit/supervisor-session.test.ts`
  - 测试：`tests/unit/supervisor-zero-tool-lint.test.ts`
  - 测试：`tests/unit/supervisor-runtime-permission.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 会话文件原子落盘与恢复成功。
    - 静态依赖 AST 扫描零违规。
    - 运行时越权调用测试：调用审批/合并/写入 verdict/执行命令 100% 抛错被拒并记录告警。
    - 预算耗尽时模型调用被阻断。
  - **FAIL**：Supervisor 能绕过控制面直接执行命令或修改工作区。

---

#### 【Task S.2】需求成熟度评估器与合同草案生成引擎
* **任务编号**：`TASK-S.2`
* **前置依赖**：`TASK-S.1`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. 分析对话成熟度，输出打分、`rationale`、`unresolved_questions`、`assessed_at`、`model_id`。
  2. 成熟度分数纯建议性，禁止作为门禁，低分/未打分草案依然允许用户手动签署。
  3. **未决问题 100% 保留至草案元数据 (G-11)**：提取生成符合 `SoftwareContractV12` 的草案，状态初始为 `DRAFT`，自动注入必填的 `worker_spec`；若存在 `unresolved_questions`，必须完整保存在草案中供用户核对。
* **涉及核心文件**：
  - 新增：`daemon/supervisor/maturity-evaluator.ts`
  - 新增：`daemon/supervisor/contract-draft-generator.ts`
  - 测试：`tests/unit/supervisor-maturity-draft.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 草案 100% 通过 `SoftwareContractV12Schema.parse()`。
    - 断言：当 `unresolved_questions.length > 0` 时，草案 `supervisor_metadata.maturity_assessment.unresolved_questions` 逐项保留无遗漏。
    - 断言：草案必须包含合规的 `worker_spec`；`score = 0` 不阻断后续签署。
  - **FAIL**：草案遗漏未决问题；草案缺失 `worker_spec` 导致校验失败。

---

#### 【Task S.3】Supervisor HUD 建议流与 WebSocket 广播
* **任务编号**：`TASK-S.3`
* **前置依赖**：`TASK-S.2`, `TASK-D.1`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. 通过 WebSocket 广播 `SUPERVISOR_SUGGESTION` 帧至已认证客户端。
  2. 支持客户端响应：`ACCEPT`、`SNOOZE`（10 分钟静默）、`DISMISS`。
  3. 建议去重与频控防打扰。
* **涉及核心文件**：
  - 新增：`daemon/supervisor/suggestion-broadcaster.ts`
  - 修改：`daemon/server.ts`
  - 测试：`tests/unit/supervisor-broadcaster.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：认证客户端准时接收合规建议帧，SNOOZE 静默逻辑生效。
  - **FAIL**：未认证连接接收到帧。

---

### 3.3 受控 Coding Worker、安全策略与威胁守卫 (Sprint 3)

#### 【Task W.1】Coding Worker 适配器抽象与能力声明
* **任务编号**：`TASK-W.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. 定义 `CodingWorkerAdapter` 接口，支持 Managed AI 与 CLI。
  2. **`AdapterCapabilityDeclaration` 补齐第 9 项 `known_limitations` (G-10)**：声明对象完整包含 9 项能力规范与平台矩阵。
  3. 注册中心默认拒绝未经能力证明的外部适配器进入 `GATEWAY_ENFORCED` 受控模式。
* **涉及核心文件**：
  - 新增：`daemon/worker/worker-adapter.interface.ts`
  - 新增：`daemon/worker/managed-ai-worker.adapter.ts`
  - 新增：`daemon/worker/adapter-registry.ts`
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

---

#### 【Task W.2】Scoped Gateway 强制工具注入与执行拦截
* **任务编号**：`TASK-W.2`
* **前置依赖**：`TASK-W.1`, `TASK-A.2` (COMPLETED), `TASK-A.4` (COMPLETED)
* **任务状态**：**[NEW_TASK]**
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
  - 新增：`daemon/worker/gateway-tool-bridge.ts`
  - 修改：`daemon/mcp/gateway.ts`
  - 测试：`tests/unit/gateway-worker-integration.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 未传 `expected_hash` 时新文件正常创建；传入错误 `expected_hash` 时被拒绝。
    - 包含注入符号（`;`, `&&`）的命令参数被字面量拦截，测试断言未进入系统 shell 执行。
    - 越界写入被阻断，合同与证据被标为 `BLOCKED`。
  - **FAIL**：使用 `shell: true` 执行命令；新文件因强制要求前值哈希而无法创建。

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
* **涉及核心文件**：
  - 新增：`daemon/worker/policy-guard.ts`
  - 修改：`daemon/runner/command-runner.ts`
  - 测试：`tests/unit/policy-guard-env-network.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：宿主非白名单变量完全隔离；秘密遮蔽在截断前执行完毕；网络阻断生效。
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

### 3.4 Cursor 式三栏 IDE 工作台与悬浮 HUD (Sprint 4)

#### 【Task C.1】Cursor 式三栏 IDE 响应式工作台骨架
* **任务编号**：`TASK-C.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. 构建左栏（文件树/Git）、中栏（多标签）、右栏（双 Agent 对话）的三栏 IDE 布局。
  2. **Header 补齐 5 项展示要素 (G-06)**：
     - 仓库名称；
     - **当前分支**（活动合同执行期展示 `task/{contract_id}`，平时展示 Base 分支）；
     - **运行模式**（清晰展示 `EXPLORATION` 探索模式 vs `CONTRACT_EXECUTION` 合同执行模式）；
     - 当前合同 ID 与绑定的 Worktree 物理绝对路径；
     - **Worker 受控状态徽标**（`GATEWAY_ENFORCED` 绿色受控 vs `UNCONTROLLED_EXTERNAL` 黄色非受控）。
  3. **工作区默认绑定与切换提示 (G-18)**：合同批准后编辑区默认绑定 Worktree；切回主工作树时给出显式切换提示与执行状态指示。
* **涉及核心文件**：
  - 新增：`src/components/WorkspaceLayout.tsx`
  - 新增：`src/components/FileTree.tsx`
  - 新增：`src/components/WorkspaceHeader.tsx`
  - 测试：`tests/ui/workspace-layout.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：Header 完整包含模式指示、受控徽标与当前分支；审批后工作区自动切换绑定 Worktree。
  - **FAIL**：缺少受控徽标或模式指示。

---

#### 【Task C.2】悬浮 Supervisor HUD 与合同审批面板
* **任务编号**：`TASK-C.2`
* **前置依赖**：`TASK-C.1`, `TASK-S.3`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：
  1. 右上角悬浮 HUD 胶囊：展示成熟度打分、未决风险气泡、一键审阅按钮。
  2. 审批弹窗：展示完整可写 Scope、严禁触碰路径、预算硬上限、命令白名单。
  3. 用户显式点击 "Approve & Start Worktree" 后发起签署请求。
* **涉及核心文件**：
  - 新增：`src/components/SupervisorHUD.tsx`
  - 新增：`src/components/ContractApprovalModal.tsx`
  - 新增：`src/components/MaturityBadge.tsx`
  - 测试：`tests/ui/supervisor-hud-approval.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：HUD 随 WS 动态刷新，用户显式点击前绝不向服务端发审批请求。
  - **FAIL**：存在静默自动批准逻辑。

---

#### 【Task C.3】Monaco 核心编辑器集成与受控 Worktree 读写
* **任务编号**：`TASK-C.3`
* **前置依赖**：`TASK-C.1`, `TASK-A.2`
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

### 3.5 架构感知、监听与差异审阅 (Sprint 5)

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
  2. 外部文件修改 50ms 内触发 Evidence `STALE`，置 `can_merge = false`，广播 `EVIDENCE_STATUS_CHANGED`。
* **涉及核心文件**：
  - 修改：`daemon/watcher/fs-watcher.ts`
  - 修改：`daemon/watcher/invalidation-engine.ts`
  - 测试：`tests/unit/multi-worktree-watcher-stale.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：外部改动 50ms 内将 Evidence 标为 STALE 且 can_merge 为 false；忽略目录写入不误报。
  - **FAIL**：外部改动后 Evidence 仍为 PASSED。

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
* **前置依赖**：`TASK-C.4`, `TASK-A.4` (COMPLETED)
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

### 3.6 控制面 API 补齐、快照持久化与合并核销 (Sprint 6)

#### 【Task D.2】控制面 API 补齐、六大合并门禁与 Git Trailer 审计
* **任务编号**：`TASK-D.2`
* **前置依赖**：`TASK-D.1`, `TASK-W.4`, `TASK-B.2`, `TASK-C.5`
* **任务状态**：**[INCREMENTAL_UPGRADE]**
* **核心目标**：
  1. `POST /api/contracts/:id/approve`：校验 `contract_revision` 与授权指纹（防 TOCTOU），原子推进双状态并创建 Worktree。
  2. `POST /api/contracts/:id/resume`：**双路径裁决负例断言 (G-14)**：
     - 安全违规类 (`SCOPE_VIOLATION`, `UNAUTHORIZED_COMMAND`, `UNSAFE_EXECUTION`) 调用 resume 返回 `409 Conflict`；
     - 预算类 resume 必须携带新审批版本，恢复前后重试计数与累计开销保持连续。
  3. `POST /api/contracts/:id/abort` 与 `reject` 接口。
  4. **合同与证据快照持久化 (闭环 G-05)**：
     - 合并核销成功后，将合同快照写入 `.stagent/contracts/{contract_id}.json`，证据快照写入 `.stagent/evidence/{contract_id}-{evidence_id}.json`，文件模式严格设为 `0600`。
  5. 严格执行六大合并门禁（Gate 0 受控源 ➔ Gate 1 主树 Clean ➔ Gate 2 状态通过 ➔ Gate 3 实时指纹复核 ➔ Gate 4 测试完整性 ➔ Gate 5 二次确认）。
  6. 写入 A §5.2 的 4 个 Git Trailer，执行 Squash Merge 并清理 Worktree。
* **涉及核心文件**：
  - 修改：`daemon/server.ts`
  - 修改：`daemon/pipeline/merger.ts`
  - 修改：`daemon/pipeline/evidence-verifier.ts`
  - 测试：`tests/unit/control-plane-approve.test.ts`
  - 测试：`tests/unit/control-plane-merge-gates.test.ts`
  - 测试：`tests/unit/control-plane-resume.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 边界违规合同调用 resume 必然返回 409。
    - 主树 Dirty、Evidence STALE 或 Agent 非受控时 Merge 坚决拒绝。
    - 合并成功后，Commit 包含 4 个标准 Trailer，且 `.stagent/contracts/` 与 `.stagent/evidence/` 快照文件完整落地。
  - **FAIL**：残留 `X-Stagent-*` 临时键；合并后未写入规范快照。

---

### 3.7 端到端集成与自举发版 (Sprint 7)

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
     - **故障 5：未批准合同尝试调用 Worker 必须被拒绝**；
     - **故障 6：Supervisor 建议尝试直接触发执行必须被拒绝**；
     - **故障 7：Worker 完成声明不得直接改变状态为 PASSED**；
     - **故障 8：外部非受控 Agent 的输出严禁作为受控 Evidence 通过**。
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

## 4. 单人串行排期与门禁实施指南 (Sprint Schedule)

| 迭代阶段 (Sprint) | 计划推进任务卡 | 阶段核心交付物 | 强制门禁检查点 (Gate Check) |
| :--- | :--- | :--- | :--- |
| **Sprint 1: 契约与通信底座** | `TASK-0.2b` ➔ `TASK-D.1` | Schema v1.2.0、双状态机校验、13➔9 错误码、CLI 引导、WS 首帧 AUTH | `npm test` Schema 校验、状态矩阵与 WS 握手测试 100% 绿灯 |
| **Sprint 2: Supervisor 建议中枢** | `TASK-S.1` ➔ `TASK-S.2` ➔ `TASK-S.3` | 会话管理、零执行权双层守卫、成熟度草案生成、未决问题保留、HUD 广播 | 静态 Lint 确认零工具引用，运行时越权拦截测试通过，草案 100% parse 通过 |
| **Sprint 3: Worker 适配与威胁守卫** | `TASK-W.1` ➔ `TASK-W.2` ➔ `TASK-W.3` ➔ `TASK-W.4` | Worker 适配抽象、`stagent_*` 工具拦截、秘密/网络守卫、威胁守卫与 4 类绕过负例 | 越界写入拦截、结构化 argv `shell:false`、特权命令抛 `E_UNSAFE_EXECUTION` 测试通过 |
| **Sprint 4: 三栏 IDE 与工作台** | `TASK-C.1` ➔ `TASK-C.2` ➔ `TASK-C.3` | Cursor 三栏布局、受控徽标、模式指示、悬浮 HUD、Monaco 嵌入与服务端 403 校验 | UI 交互正常，服务端 403 越权写入拦截测试通过，STALE 横幅即时呈现 |
| **Sprint 5: 架构雷达与失效联动** | `TASK-B.1` ➔ `TASK-B.2` ➔ `TASK-C.4` ➔ `TASK-C.5` | AST 依赖图、多 Worktree Watcher、雷达大图 (禁止原地扩权)、Diff/终端 | 增量分析 ≤20ms，外部改动 50ms 触发 STALE，终端日志先脱敏后截断 |
| **Sprint 6: 控制面与物理合并** | `TASK-D.2` | Approve 接口、Resume 双路径负例、六大合并门禁、4 个 Git Trailer、快照持久化 | 主树 Dirty 阻断、4 个合规 Trailer 自动测试通过、快照落盘断言通过 |
| **Sprint 7: E2E 集成与自举发版** | `TASK-E.1` ➔ `TASK-E.2` | 8 类故障分支全流程 E2E 自动化测试、Dogfooding 自举报告、发版打包 | 8 类故障分支全部阻断成功，npm run build 产出干净构建包 |

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

测试文件统一归 `tests/{unit,daemon,integration,e2e}/`；浏览器 DOM 测试归 `src/tests/`、`src/hooks/`（vitest `dom` project）。


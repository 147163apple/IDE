# Stagent v1.2.1 第二轮交叉一致性复审报告

> **复审对象**
> - 文档 A：《Stagent 系统架构设计规范 (v1.2.0 双 Agent IDE 演进基线)》（未变更，仍为唯一法典事实源）
> - 文档 B：《Stagent v0.1 研发任务拆解与工程执行规范 (v1.2.1 终审闭环版)》（本轮修订稿）
> **复审范围**：核验第一轮 28 项缺陷的闭环情况 + 审查修订引入的新问题。仍不检查本地代码。
> **复审日期**：2026-10-20

---

## 0. 复审判定

### 复审结论：**有条件通过（Conditional Pass）**

| 项目 | 结果 |
|---|---|
| **P0 阻断项** | **2/2 已闭环** ✅ —— Git Trailer 键名已完全对齐 A §5.2；DAG 循环已解除并提供可拓扑排序的机器可读边清单 |
| **P1 覆盖缺口** | 15 项中 **约 11 项实质闭环**，**4 项仍为部分/未闭环**；本轮新发现 **11 项 P1** |
| **P2 规范瑕疵** | 11 项中 **约 8 项闭环**；本轮新发现 **9 项 P2** |
| **契约主体一致性** | `SoftwareContractV12` 与 `EvidenceBundleV11` 现已 **逐字段 100% 对齐 A §9.1/§9.2**（含 `intent`/`authorization`/`verification_spec` 全量字段） |

**含义**：两份文档已不存在"照 B 实现会判 PASS 却违反 A"的反向验收，可以进入实现阶段；但下列 **11 项 P1 缺口必须在 Sprint 6（D.2）之前补齐断言与归属任务**，否则 §0.5 决策矩阵中的"本地安全边界""费用与熔断""双 Agent 分权"三条仍不可判定。

---

## 1. 第一轮 28 项闭环核验表

### 1.1 P0 项（2/2 闭环）

| 编号 | 问题 | 状态 | 核验依据 |
|---|---|---|---|
| F-01 | Git Trailer 键名冲突 | ✅ **已闭环** | D.2 目标 4 逐字采用 `Audited-By` / `Stagent-Contract-ID` / `Stagent-Evidence-ID` / `Stagent-Verdict`，明确"删除任何 `X-Stagent-*` 临时命名"，PASS 断言 4 项齐全且含真实退出码 |
| F-02 | DAG 循环依赖不可拓扑排序 | ✅ **已闭环** | D.1 前置依赖改为 `TASK-0.2b` 并提前至 Sprint 1；S.3 前置依赖 `S.2 + D.1`；D.2 前置依赖 `D.1 + W.3 + B.2 + C.5`；§2.1 提供 JSON 边清单且声明无环 |

### 1.2 维度一：数据模型（6 项）

| 编号 | 问题 | 状态 | 说明 |
|---|---|---|---|
| F-03 | `EvidenceBundleV11` 无类型定义 | ✅ 已闭环 | 0.2b 目标 2 给出完整接口；逐字段比对 A §9.2：**evidence_id / contract_id / contract_revision? / worker_session_id? / supervisor_suggestion_ids? / generated_at / usage 9 字段（含 `UNAVAILABLE` 三值枚举）/ worktree_snapshot / verdict（9 值 reason_code + verification_retry_count?）/ scope_audit / verification_results / git_info（含 `patch_fingerprint`）** 全部一致 |
| F-04 | `can_merge` 派生不变式无断言 | ✅ 已闭环 | 0.2b 目标 3 规定 `superRefine` 充要条件 + `Omit<Verdict, "can_merge">` 类型隔离；PASS 含 4 种 status × can_merge 表驱动；FAIL 含"允许外部直接注入 `can_merge: true`" |
| F-05 | "继承 v1.1.3"表述与 A 修订说明矛盾 | ✅ 已闭环 | 0.2b 接口现完整给出 `authorization`（含 `editor_command_template` / `env_file_grants` / `port_policy` / `network_policy` / `dependency_changes_allowed`）、`budget_limits.max_verification_retries`、`cost_limits.*`、`verification_spec.commands[].*` |
| F-06 | `contract_revision` 递增无承接 | ✅ 已闭环 | 0.2b PASS 含"任何 Scope/预算修改未递增 `contract_revision` 时校验失败"；C.4 目标 2 明确已批准/执行态必须派生新版本并重新审批 |
| F-07 | 成熟度结果结构不对齐 | ✅ 已闭环 | S.2 目标 1 显式产出 `assessed_at` 与 `model_id` |
| F-08/F-09 | 分数门禁语义/可选性 | ✅ 已闭环 | S.2 目标 2 + PASS 断言 `score = 0` 或 `score` 未定义仍可正常批准进入 `PREPARING` |

### 1.3 维度二：状态机（4 项）

| 编号 | 问题 | 状态 | 说明 |
|---|---|---|---|
| F-10 | 校验器签名无法表达二维矩阵 | ✅ 已闭环 | 拆分为 `validateStatePair(pair)` + `validateTransition(fromPair, toPair)`，新增 `src/lib/state-machine.ts` 与 `state-machine-matrix.test.ts` |
| F-11 | 原子写入无承接 | ✅ 已闭环 | 0.2b 目标 4 明确 `writeTemp + fsync + rename` |
| F-12 | A.6 版本倒挂 | ✅ 已闭环 | PREPARING 中断回退 + approval 回置的断言归属 0.2b 状态机模块，归属真空消除 |
| F-13 | 矩阵分支覆盖不全 | ⚠️ 部分闭环 | 覆盖 3 条；仍缺 `ABORTED + APPROVED` 正例、"拒绝后不得原地回 DRAFT" 负例、`ABORTED` 终态负例（见 G-17） |

### 1.4 维度三：职责边界（8 项）

| 编号 | 问题 | 状态 | 说明 |
|---|---|---|---|
| F-14 | Supervisor 零权验证方法学不足 | ✅ 已闭环 | S.1 目标 2：依赖层 AST 扫描禁令（Gateway/Merger/Verifier/ProcessRunner/child_process）+ 运行时硬拦截抛异常并告警 |
| F-15 | 成熟度不进入状态计算无断言 | ✅ 已闭环 | 同 F-08 |
| F-16 | 草案遗漏必填 `worker_spec` | ✅ 已闭环 | S.2 目标 3 + PASS 断言；未声明能力时默认 `UNCONTROLLED_EXTERNAL` |
| F-17 | Supervisor 未纳入共享账本 | ⚠️ 部分闭环 | S.1 目标 3 + PASS 已覆盖"消耗计入 cumulative"与"超限拒绝调用"；但"跨重启持久化/供应商切换不清零/工具与命令预算分别记账"仍无断言（见 G-09） |
| F-18 | Gateway 管辖四项缺失 | ⚠️ 部分闭环 | 能力声明 + 默认拒绝已闭环；**运行时强制能力复检与降级仍无任务**（见 G-20） |
| F-19 | MCP 工具清单不一致 | ⚠️ 部分闭环（引入新冲突） | 命名空间/5 工具/联合字面量已对齐；但 `expected_hash` 可选性出现新冲突（见 G-03） |
| F-20 | C.3 纯客户端只读 | ✅ 已闭环 | 保存必须走 `POST /api/worktree/files`，越权 403 + `GATEWAY_VIOLATION` + 文件不变 + Evidence STALE |
| F-21 | 缺 `approve` 归属 | ✅ 已闭环 | D.2 目标 1：approve 接口 + `contract_revision` 与授权字段指纹防 TOCTOU + 原子双状态写入 + 建 Worktree |
| F-22 | resume 双路径 | ⚠️ 部分闭环 | 目标已写双路径裁决；但 PASS 只断言了 Merge 拒绝，未断言"边界违规合同调用 resume 返回 409"（见 G-14） |
| F-23 | §4.3 环境/秘密/网络零承接 | ✅ 已闭环 | 新增 TASK-W.3 + `src/worker/policy-guard.ts` |
| F-24 | 缺 v1.1.3→v1.2.0 迁移 | ✅ 已闭环 | 0.2b 目标 5 + `src/lib/migration.ts` + 迁移测试 |
| F-25 | 门禁未覆盖非受控/PENDING_RESUME | ✅ 已闭环 | Gate 0 受控源校验；PASS 含"Agent 为非受控模式时 Merge 坚决拒绝" |

### 1.5 维度四：DAG 与里程碑（6 项）

| 编号 | 问题 | 状态 | 说明 |
|---|---|---|---|
| F-27 | 并行分支违反 §10 阶段门槛 | ❌ **未闭环** | DAG 仍让 P2(W)/P3(C)/P4(S) 三轨在 D.1 之后同时并行（见 G-08） |
| F-28 | Track B 在 §10 无阶段 | ✅ 已闭环 | B.1 里程碑改为"A §3 架构引擎"，不再自行编造阶段 |
| F-29 | 状态取值表不自洽 | ✅ 已闭环 | 全表仅剩 COMPLETED / INCREMENTAL_UPGRADE / NEW_TASK |
| F-30 | 悬空引用 TASK-0.2 | ✅ 已闭环 | 0.2b 前置依赖仅保留 `TASK-0.1` |
| F-31 | 门禁 2/3 冗余 | ✅ 已闭环 | Gate 3 改为实时重算 HEAD SHA 与快照指纹 |
| F-32 | 监听范围/忽略列表 | ⚠️ 部分闭环 | B.2 已完全对齐；B.1 仍只写"TS/JS/JSON"，**缺 `src/**` 路径前缀**（见 G-16） |

### 1.6 维度五：错误码（2 项）

| 编号 | 问题 | 状态 | 说明 |
|---|---|---|---|
| F-33 | 12→9 声明与表体矛盾 | ✅ 已闭环 | 改为 13 → 9，新增 `E_UNSAFE_EXECUTION ➔ UNSAFE_EXECUTION`，计数自洽 |
| F-34 | 12 个码仅 3 个有断言 | ⚠️ **部分闭环** | 仅 3 个码（E_OUT_OF_SCOPE / E_FORBIDDEN_PATH / E_UNAUTHORIZED_COMMAND）有显式断言；7 个仍无产出任务（见 G-01、G-07） |

---

## 2. 第二轮新发现缺陷

### 【G-01 / P1】`E_UNSAFE_EXECUTION` 已登记，但无任何生产任务产出该码

- **位置**：B【Task 0.2b】目标 6 vs 全部任务卡
- **说明**：0.2b 目标 6 把错误码目录扩到 13 项并新增 `E_UNSAFE_EXECUTION ➔ UNSAFE_EXECUTION`。但遍历全部 17 张卡片，**没有任何一张实现 A §4.2.3 的拒绝/外置隔离路径**（不可信仓库或 Agent、需特权/内核操作的命令、可访问任意主机路径/凭据的脚本、无法可靠限制子进程树或网络的高风险命令 → 拒绝自动执行，或要求用户明确选择独立 Docker/VM/外部隔离环境）。
- **风险**：目录里有一个无人产出的错误码；同时 A §4.2.3 是 §0.5"本地安全边界"行失败判据（"高风险命令未拒绝/未外置隔离"）的直接来源 —— **该失败判据当前无对应验收**。
- **建议**：新增 `TASK-W.4 高风险执行威胁守卫`，落 `src/worker/threat-guard.ts`：启动前对命令 argv + 仓库信任标记做判据，命中即拒绝并返回 `E_UNSAFE_EXECUTION`、Evidence `verdict.status = BLOCKED` + `reason_code = UNSAFE_EXECUTION`、UI 提示外置隔离；PASS 断言"特权命令/不可信仓库被拒绝且未落任何子进程"。

---

### 【G-02 / P1】WS 帧类型字典遗漏 A §6.1 的强制项 `EVIDENCE_READY`

- **位置**：A §6.1 vs B【Task D.1】目标 3
- **说明**：A §6.1 的类型清单含 `EVIDENCE_READY`；B 的字典以 `EVIDENCE_STATUS_CHANGED` 与 `TERMINAL_STREAM` 取而代之，**`EVIDENCE_READY` 未被登记**。虽然 A 措辞为"类型至少包括"，但 `EVIDENCE_READY` 是 §6.2 时序中"Daemon 生成 Evidence 后广播"的既有语义，删除它会使 C.5 与 B.2 的取证语义与 A 不一致（且 B.2 的 STALE 事件已由 `EVIDENCE_STATUS_CHANGED` 承担，两者功能不同）。
- **建议**：字典中同时保留 `EVIDENCE_READY`（Evidence 生成完成、等待核销）与 `EVIDENCE_STATUS_CHANGED`（状态迁移/失效），并说明二者职责边界。

---

### 【G-03 / P1】`expected_hash` 可选性冲突：A 为可选，B 强制必填

- **位置**：A §4.1 `stagent_write_file(params: { path; content; expected_hash?: string })` vs B【Task W.2】目标 1 "`stagent_write_file`: **强制要求传入** `expected_hash` 乐观锁"
- **说明**：A 将 `expected_hash` 定义为**可选**（新文件创建时无前值哈希）。B 改为强制必填，构成契约冲突；按 B 实现将无法创建任何新文件（或需要伪造哈希），与 W.2 自身 PASS 断言"可写范围内文件正常保存"矛盾。
- **建议**：改为"`expected_hash` 可选；**若传入**则必须与实际当前哈希一致（乐观锁校验），未命中即抛 `E_CONFLICT` 并由 A §4.1 目录补登记；**未传入**表示新建文件，仅在 `writable_paths` 内放行"。

---

### 【G-04 / P1】进程执行未断言 `shell:false` 与结构化 argv

- **位置**：A §2.4 Process Runner "结构化 argv、shell:false"；A §9.1 `verification_spec.commands[].args` 注释"结构化 argv；shell:false" vs B【Task W.2】【Task W.3】
- **说明**：B 的 W.2 只约束"仅允许合同 `allowed_commands` 白名单"，W.3 只覆盖环境/秘密/网络/端口，**两处都没有断言执行必须以结构化 argv 且 `shell:false` 方式调用**。A.4 虽已 COMPLETED，但"白名单 + 结构化 argv"在新架构下无人回归验证，而这是命令注入防护的核心（尤其 `editor_command_template` 与 `env_file_grants` 引入后风险面变大）。
- **建议**：W.2 增补断言：`exec_command` 与 `editor_command_template` 展开后必须以 `spawn(executable, args, { shell: false })` 执行；含 `;`、`&&`、`|`、`$()` 的参数必须被作为字面量拒绝。

---

### 【G-05 / P1】缺少合同/证据快照持久化任务，且与迁移任务形成前置缺失

- **位置**：A §5.2 "合并核销完成后……在仓库中**永久留存**合同快照 `.stagent/contracts/{contract_id}.json` 与证据快照 `.stagent/evidence/{contract_id}-{evidence_id}.json`" / ADR-006 vs B 全部卡片
- **说明**：B 中 D.2 只写"执行 Squash-Merge 并物理清理 Worktree"，**没有任务负责把合同快照与证据快照落到上述两条规范化路径**。而 0.2b 的迁移任务恰好要"识别 `.stagent/contracts/*.json` 中的旧合同" —— 它读取的目录在本规范里没有任何写入方，形成**前置缺失**（读路径无生产者）。
- **建议**：在 D.2 或 0.2b 增补快照落盘子项：合并成功后原子写入两条快照路径、文件模式 `0600`、记录 Git SHA/任务分支/验证命令/Diff 指纹；PASS 断言两条路径存在且可被重新 parse。

---

### 【G-06 / P1】C.1 顶部 Header 缺 A §7.1 的两项强制展示

- **位置**：A §7.1 "页面持续显示仓库名称、当前分支、**模式（探索/合同执行）**、合同 ID、Worktree 路径和 **Worker 是否受控**" vs B【Task C.1】目标 2
- **说明**：C.1 只列出"项目名称、Base 分支、当前合同 ID、绑定的 Worktree 物理绝对路径"，缺：
  - **模式（探索 / 合同执行）** —— 直接对应 A §0.5 "IDE 与项目身份" 行与 §7.1 的"编辑区默认绑定 Worktree"判定前提；
  - **Worker 是否受控** —— 对应 A §0.4 "没有可强制约束能力的 Agent 不得显示'受控执行'"与 §0.5 失败判据，是双 Agent 分权在 UI 上的唯一可见出口。
  另外 C.1 写"Base 分支"而 A §7.1 要求"**当前**分支"（合同执行期应为任务分支 `task/{contract_id}`）。
- **建议**：C.1 目标 2 与 PASS 补齐模式指示、Worker 受控徽标、当前分支三项展示与断言。

---

### 【G-07 / P1】E.1 故障分支未覆盖 A §7.5/§2.3 的授权不变式

- **位置**：A §7.5 与 §2.3 vs B【Task E.1】目标 2
- **说明**：E.1 保留原 4 类故障分支（超时重试熔断、测试文件篡改阻断、外部变动 STALE 阻断、主树 Dirty 阻断），但 A §7.5 另有三条**授权级不变式**没有对应回归：
  1. 未批准合同不得调用 Worker；
  2. Supervisor 建议不得启动执行；
  3. Worker 完成声明不得直接变成 `PASSED`（应停在 `VERIFYING`）。
  以及 §2.3：**外部非受控 Agent 的输出不得作为受控执行 Evidence**。
- **建议**：E.1 故障分支由 4 类扩为 8 类，对上述 4 条各建一条负例 E2E 断言。

---

### 【G-08 / P1（沿用未闭环）】并行分支仍违反 A §10"每阶段通过标准是下一阶段门槛"

- **位置**：A §10 前言 vs B §2.1 DAG / §4 Sprint 表
- **说明**：A §10 明确"阶段需按依赖排序……**每阶段通过标准是下一阶段门槛**"。B 的 DAG 在 `TASK-D.1` 之后同时展开四条并行轨道 —— `S.1(P4)`、`W.1(P2)`、`B.1(A §3)`、`C.1(P3)`，意味着 P3/P4 在 P2 验收通过之前即启动。这与 A 的阶段门槛语义直接冲突（也是第一轮 F-27 未被处理的一项）。
- **建议**：二选一并在两份文档中同时生效：
  - 方案 A（推荐）：在 A §10 增补"阶段内任务可并行推进；跨阶段进入集成联调前，必须通过上一阶段门槛"；
  - 方案 B：B 的 DAG 改为阶段串行门槛，Sprint 表增加 Gate 检查点列（目前 §4 已有该列，但未约束跨阶段顺序）。

---

### 【G-09 / P1】用量账本"持久化/供应商切换/分列记账"三项无断言

- **位置**：A §4.2.1 / ADR-004 验收判据 vs B【Task S.1】【Task A.5】【Task D.2】
- **说明**：S.1 已覆盖"计入 `cumulative_cost_minor_units`"与"超限拒绝调用"，D.2 覆盖"恢复前后累计连续"，但以下三条仍无任务或断言：
  1. 累计用量**跨 Daemon 重启**持久化（ADR-004："重启、重试、切换模型不清零"）；
  2. **供应商切换/模型切换**后累计不清零；
  3. **工具预算与命令预算分别记录**（A §4.2.1 末句："避免把模型费用上限误认为计算命令限制"）。
- **建议**：在 0.2b 或 A.5 增量回归中增加三条断言：重启后账本重载一致；切换供应商后累计不清零；模型/工具/命令三类计数分列且独立触发熔断。

---

### 【G-10 / P2】`AdapterCapabilityDeclaration` 缺第 9 项"已知限制"

- **位置**：A §2.7 第 9 项"及**已知限制**" vs B【Task W.1】接口
- **说明**：卡片自称"包含 9 项能力规范"，但接口实际只有 8 项能力 + `platform_support`（平台支持矩阵在 A 中已是第 8 项），**缺少 `known_limitations`**。
- **建议**：补 `known_limitations: string[]`，并在 PASS 中断言未声明已知限制的 Adapter 不予受控注册。

---

### 【G-11 / P2】S.2 删除了成熟度结果结构与"不确定项保留"断言

- **位置**：A §2.2 "输出必须通过 Schema 校验，并**展示不确定项供用户确认**" vs B【Task S.2】
- **说明**：修订版移除了原 `MaturityAssessmentResult` 接口与"未决问题列表完整保留在草案元数据中"的 PASS 断言。虽 schema 层已通过 `supervisor_metadata.maturity_assessment.unresolved_questions` 覆盖，但 S.2 侧**缺少一条可执行的断言**证明未决问题确实被带入草案元数据。
- **建议**：S.2 PASS 增补：`unresolved_questions.length > 0` 时，草案 `supervisor_metadata.maturity_assessment.unresolved_questions` 必须逐一保留。

---

### 【G-11b / P2】S.1 PASS 未包含"运行时越权调用被拒绝"的正例断言

- **位置**：B【Task S.1】目标 2 vs PASS
- **说明**：目标 2 描述了运行时硬拦截（调用 `approveContract` / `mergeContract` / `setVerdict` 抛异常并告警），但 PASS 三条断言只覆盖"会话落盘原子安全""静态依赖检查套件通过""预算硬约束测试"，**运行时拒绝未被纳入判定**。若实现只做静态 lint 也能判 PASS。
- **建议**：S.1 PASS 增补：Mock 权限测试断言调用审批/合并/写 verdict/执行命令四类方法全部被拒绝且产生告警事件。

---

### 【G-12 / P2】D.1 未承接 A §6.1 的 Origin 校验与速率/帧大小限制

- **位置**：A §1 通信行 + §6.1 第 2 条 vs B【Task D.1】
- **说明**：A 要求"校验 `Origin`、连接速率、帧大小和消息类型；只接受当前仓库 UI 的合法来源"。B 的 D.1 只保留首帧 AUTH、`4401`、token `0600`、日志不打印 token、5s 心跳，上述四项均未被断言。
- **建议**：D.1 增补 PASS 断言：非法/缺失 `Origin` 的连接被拒绝；超过阈值的连接速率、超限帧大小与非白名单消息类型被拒绝并计数。

---

### 【G-13 / P2】D.1 未断言心跳失联遮罩与 Token 轮换

- **位置**：A §6.1 "心跳每 5 秒发送一次 `PING`，**连续 3 次无回应后显示重连遮罩**"；"Daemon 获 PID 锁后**轮换 token**；崩溃残留 token 在下次成功启动后失效并轮换" vs B D.1
- **建议**：D.1 PASS 增补两条：模拟 3 次 PING 无 PONG 后 UI 呈现重连遮罩；Daemon 重新取得 PID 锁后旧 token 失效。

---

### 【G-14 / P2】D.2 PASS 缺 resume 双路径负例断言

- **位置**：B【Task D.2】目标 2 vs PASS
- **说明**：目标 2 已写明"预算耗尽类恢复须保留原审批版本；**安全越界类阻断拒绝在原版本 resume**"，但 PASS 四条断言只覆盖 approve 409、dirty 409、merge 拒绝、Trailer，**resume 拒绝路径无断言**。
- **建议**：D.2 PASS 增补：对 `reason_code ∈ {SCOPE_VIOLATION, UNAUTHORIZED_COMMAND, UNSAFE_EXECUTION}` 的合同调用 `resume` 返回 `409`；对预算类合同恢复前后 `verification_retry_count` 与 `cumulative_cost_minor_units` 连续。

---

### 【G-15 / P2】ErrorCode Catalog 无测试文件归属

- **位置**：B【Task 0.2b】"涉及核心文件"
- **说明**：目标 6 要求导出 13 → 9 完备映射表，但测试文件清单只有 `contract-schema-v12`、`evidence-schema-v11`、`state-machine-matrix` 三个，**没有 `error-codes.test.ts`**，映射完备性（含反向：每个 reason_code 至少一个来源）无法被自动验证。
- **建议**：新增 `tests/unit/error-codes-mapping.test.ts`，表驱动断言 13 项正向映射与 9 项反向来源。

---

### 【G-16 / P2】B.1 与 B.2 的监听范围口径不一致

- **位置**：A §3.1 "监听范围：仓库源码与活跃任务 Worktree 中的 **`src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`**" vs B【Task B.1】"解析项目内 TS/JS/JSON 文件"、B【Task B.2】扩展名已对齐
- **说明**：B.2 已完整对齐扩展名与忽略目录，但 B.1 仍缺 `src/**` 路径前缀，两卡之间存在口径差。
- **建议**：B.1 统一表述为"解析 `src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`"。

---

### 【G-17 / P2】状态矩阵仍缺 3 条分支断言

- **位置**：A §9.1.1 vs B【Task 0.2b】PASS
- **缺失**：
  1. `ABORTED + APPROVED` 正例（已批准后安全中止，保留审批历史事实）；
  2. "合同被拒绝后不得原地回到 `DRAFT`"负例；
  3. "`ABORTED` 为终态"负例（不得 resume 回 `EXECUTING`）。
- **建议**：三条全部建成表驱动断言并引用 A §9.1.1 行号。

---

### 【G-18 / P2】C.1 / C.3 未承接 A §2.5 编辑绑定与 §2.1 状态显示

- **位置**：A §2.5 "审批合同后，编辑区**默认绑定合同 Worktree**；主工作区编辑入口需要**明显切换并提示执行状态**"；A §2.1 "显示只读/可写、未批准/Worktree、**Evidence stale 状态**"
- **说明**：C.3 只覆盖可写/只读视觉区分；"审批后默认绑定 Worktree""主工作区编辑入口显式切换提示""编辑器内 Evidence stale 指示"三项无断言。
- **建议**：C.1/C.3 补齐上述三项展示与断言。

---

### 【G-19 / P1（治理）】B 单方面扩展了 A 的三处强制字典，违反"唯一法典事实源"

- **位置**：B 前言"以 A 为唯一法典事实源" vs B 的多处自我扩展
- **明细**：
  1. **错误码**：B 为 13 项，A §9.3 表体仅 12 项（新增 `E_UNSAFE_EXECUTION` 未回写 A）；
  2. **帧类型**：B 的字典**删除**了 A §6.1 的 `EVIDENCE_READY`，并新增 `EVIDENCE_STATUS_CHANGED`、`TERMINAL_STREAM`；
  3. **工具契约**：B 把 `expected_hash` 由可选改为强制（与 A §4.1 相反）。
- **风险**：B 作为下游执行文档对法典做了增删，两侧再度不一致；后续实现者无法判断以谁为准。
- **建议**：把这 3 项统一回写 A（修订 A §6.1 帧字典、§9.3 错误码表、§4.1 工具签名），或在 B 中显式标注"本地扩展项，待 A 下一版合并"，并保持 A 的字段可选性不被 B 覆盖。

---

### 【G-20 / P1】"绕过测试必须失败"缺少可执行断言（运行时强制能力复检）

- **位置**：A §7.3 "Adapter 若能绕开 Gateway 的原生文件或 shell 工具，不得进入受控模式；**测试必须验证绕过路径不可用，而非仅测试 MCP 工具可调用**"；A §6.4.7 / §2.3 "若 Adapter 失去 Gateway 强制能力、启动配置被修改或探测到未知工具通道，**立即停止受控状态并阻止 Evidence 通过**"
- **说明**：W.1 的 PASS 断言只覆盖**声明层**（`filesystem_permissions !== "GATEWAY_ONLY"` 不得注册为受控），缺少 A §7.3 要求的四类绕过负例：① 直接写 Worktree 外路径；② 执行未授权 shell；③ 访问主工作树；④ 跳过 Gateway 调用工具。同时，**运行时**失去强制能力后的"立即停止 + 阻断 Evidence"在全表无归属任务。
- **建议**：W.1 增补四类绕过负例断言（并显式要求"断言不可用"而非"断言可调用"）；新增 W.4 或并入 W.2：会话期对 Adapter 启动配置、工具通道做周期性复检，任一异常立即降级为 `UNCONTROLLED_EXTERNAL`、停止执行、阻断 Evidence 通过并广播 `GATEWAY_VIOLATION`。

---

## 3. 仍开放项汇总（实现前必须补齐）

| 编号 | 级别 | 一句话 |
|---|---|---|
| G-01 | P1 | `E_UNSAFE_EXECUTION` 无人产出；A §4.2.3 拒绝/外置隔离判据无承接 |
| G-19 | P1 | B 单方面增删 A 的强制字典（错误码/帧类型/工具签名），需回写 A |
| G-20 | P1 | 无"绕过路径不可用"负例断言；运行时强制能力复检与降级无归属 |
| G-08 | P1 | 并行分支仍违反 A §10 阶段门槛（第一轮 F-27 未处理） |
| G-02 | P1 | WS 帧字典遗漏 A §6.1 强制项 `EVIDENCE_READY` |
| G-03 | P1 | `expected_hash` 可选性冲突（A 可选 / B 强制） |
| G-04 | P1 | 未断言 `shell:false` 与结构化 argv |
| G-05 | P1 | 缺合同/证据快照落盘任务；迁移任务的读路径无生产者 |
| G-06 | P1 | C.1 Header 缺"模式"与"Worker 是否受控" |
| G-07 | P1 | E.1 故障分支未覆盖 A §7.5 三条授权不变式与 §2.3 输出隔离 |
| G-09 | P1 | 用量账本持久化/切换不清零/分列记账无断言 |
| G-10 | P2 | `AdapterCapabilityDeclaration` 缺 `known_limitations` |
| G-11 | P2 | S.2 缺"不确定项保留"断言 |
| G-11b | P2 | S.1 PASS 未含运行时越权拒绝断言 |
| G-12 | P2 | D.1 未承接 Origin 校验与速率/帧大小限制 |
| G-13 | P2 | D.1 未断言心跳遮罩与 Token 轮换 |
| G-14 | P2 | D.2 PASS 缺 resume 双路径负例 |
| G-15 | P2 | ErrorCode Catalog 无测试文件归属 |
| G-16 | P2 | B.1/B.2 监听路径前缀口径不一致 |
| G-17 | P2 | 状态矩阵缺 3 条分支断言 |
| G-18 | P2 | C.1/C.3 缺 Worktree 绑定与 Evidence stale 指示 |

---

## 4. 本轮已确认闭环的核心契约（可作为不回退基线）

1. `SoftwareContractV12` 全字段（含 `intent` / `authorization.git|file_system_scope|budget_limits|cost_limits|execution_permissions` / `verification_spec.commands[]`）与 A §9.1 **逐字段一致**。
2. `EvidenceBundleV11` 全字段（含 usage 9 字段、`accounting_mode` 三值、9 个 `reason_code`、`scope_audit`、`verification_results`、`patch_fingerprint`）与 A §9.2 **逐字段一致**。
3. `can_merge` 派生不变式（superRefine 充要条件 + `Omit<Verdict,"can_merge">` 类型隔离 + 表驱动测试）。
4. 状态机拆分为 `validateStatePair` / `validateTransition`，含原子落盘（`writeTemp+fsync+rename`）与 PREPARING 回退断言。
5. `contract_revision` 递增强制 + 已批准合同禁止原地扩权（C.4）。
6. Git Commit Trailer 四键名与 A §5.2 完全一致。
7. MCP 工具统一为 `stagent_*` 命名空间、5 工具齐全、`tool_name` 联合字面量约束。
8. Supervisor 双层零权守卫（依赖层 AST 禁令 + 运行时候拦截告警）+ 纳入共享预算账本。
9. Worker 能力声明 9 项（待补第 9 项）+ 默认拒绝未经证明的 Adapter。
10. 新增 `TASK-W.3` 承接 A §4.3（环境变量白名单 / `env_file_grants` / 先脱敏后截断 / 网络与端口策略）。
11. C.3 保存改为服务端 `POST /api/worktree/files` + 越权 403 + `GATEWAY_VIOLATION` + Evidence STALE。
12. D.2 补齐 `POST /api/contracts/:id/approve`（含 `contract_revision` + 授权字段指纹防 TOCTOU）+ 六大门禁。
13. 0.2b 承接 v1.1.3 → v1.2.0 迁移与备份，并给出迁移测试断言。
14. DAG 提供 JSON 机器可读边清单，无环，且与各卡前置依赖一致。
15. 任务状态取值归一为 COMPLETED / INCREMENTAL_UPGRADE / NEW_TASK。

---

## 5. 建议的签发条件

建议在满足以下三条后，将 B v1.2.1 正式签发为可执行基线：

1. **补齐 G-01、G-20 的归属任务**（建议新增 `TASK-W.4 高风险执行威胁守卫与运行时强制能力复检`），使 `UNSAFE_EXECUTION` 与"绕过路径不可用"有可执行的产出点与断言。
2. **回写 A**（G-19）：把 `E_UNSAFE_EXECUTION` 行补入 A §9.3；在 A §6.1 帧字典中同时保留 `EVIDENCE_READY` 并补登记 `EVIDENCE_STATUS_CHANGED` / `TERMINAL_STREAM`；确认 A §4.1 `expected_hash?` 的可选语义（修 B 而非 A）。
3. **统一阶段语义**（G-08）：A §10 增补并行条款，或 B 的 DAG 改为阶段串行门槛 —— 二者须择一并同步生效。

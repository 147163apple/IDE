# Stagent v0.1 研发任务拆解与工程执行规范 (v1.1.3 终审闭环版)

> **文档定位**：本规范作为 Stagent v0.1 首版研发的**唯一工程实施基线**。以《Stagent 系统架构设计规范 (v1.1.3 开发基线)》为唯一法典事实源，全面闭环架构路线映射、ADR-002 缓存分级、依赖拓扑完整性、网络与命令解析规范、双状态机原子联动、全生命周期错误码与原因码对齐，指导 Coding Agent 与工程师协同开工。

---

## 1. 任务体系与双坐标映射矩阵 (工程执行顺序 vs 规范 §10 路线里程碑)

为保证工程研发落地的高效性，并与《架构规范 v1.1.3》第 10 章的验收门槛严格互锁，建立**工程研发执行序列**与**产品演进验收里程碑**双坐标映射体系：

* **工程研发执行序列 (Engineering Execution Order)**：立足于底层运行时与依赖隔离的先决条件，遵循代码构建依赖，先筑牢 Worktree 物理隔离、MCP 安全网关、依赖复用与自愈底座（Track A），再并行推进架构雷达（Track B）与控制台界面（Track C），最终在本地通信桥与核销层（Phase 4）汇合。
* **规范 §10 演进路线与验收门槛 (Roadmap Milestones & Priority)**：立足于系统向独立开发者交付时的“用户可见功能与质量门槛”，划分为 P0–P5 六个里程碑。其中 P0–P4 均为 P0 核心阻塞优先级，P5 为 P1 恢复与增强优先级。

| 工程研发分期 (Engineering Phase) | 对应规范 §10 路线里程碑与优先级 | 归属任务编号 (Task ID) | 阶段核心目标与关键交付物 |
| :--- | :--- | :--- | :--- |
| **Phase 0: 基础设施与数据模型基线** | **P0：可复现工程底座 (P0 优先级)** | **TASK-0.1, TASK-0.2** | 依赖锁死、跨平台 CI 自动化、全字段 Contract & Evidence Schema、`verify-env.mjs` |
| **Track A: 本地执行内核** | **P1 / P3 / P5 执行底座**<br>• A.1 ➔ P1 本地 Git (P0)<br>• A.2, A.4, A.5 ➔ P3 真实执行与双熔断 (P0)<br>• A.3, A.6 ➔ P5 依赖复用与崩溃恢复 (P1) | **TASK-A.1, TASK-A.2, TASK-A.3, TASK-A.4, TASK-A.5, TASK-A.6** | • Worktree 物理生命周期与分支保护<br>• Scoped MCP 工具网关与路径沙箱<br>• 缓存优先/写保护探测的依赖复用 (ADR-002)<br>• 受限进程执行器与网络策略拦截<br>• 验证死循环与费用硬上限双熔断<br>• Daemon 崩溃状态机扫描与自愈引擎 |
| **Track B: 架构感知与文件监听** | **P2 / P4 架构与失效联动**<br>• B.1 ➔ P2 依赖地图 (P0)<br>• B.2 ➔ P4 外部变更与 Evidence 失效 (P0) | **TASK-B.1, TASK-B.2** | • Daemon 端 AST 增量依赖图分析器 (冷启动 ≤1.5s, 增量 ≤20ms)<br>• 文件系统监听与 Evidence STALE 状态联动 |
| **Track C: Web 交互控制台** | **P2 / P4 交互呈现**<br>• C.1, C.2 ➔ P2 Scope 圈选与合同审批 (P0)<br>• C.3 ➔ P4 Diff 审阅与编辑器调起 (P0) | **TASK-C.1, TASK-C.2, TASK-C.3** | • 合同待办卡与多币种/估算预算配置<br>• Cytoscape 架构雷达大图与 Scope 圈选<br>• 双栏 Git Diff 审阅与外部 Cursor 调起 |
| **Phase 4: 汇合串联与核销** | **P1 / P4 终审与核销**<br>• D.1 ➔ P1 Local Daemon 通信 (P0)<br>• D.2 ➔ P4 Evidence 审计与合并 (P0) | **TASK-D.1, TASK-D.2** | • CLI 入口与 127.0.0.1 WS 通信桥 (独立 session-token 鉴权与心跳)<br>• Evidence 终审清单、Squash Merge 与 Git Trailer |
| **Phase 5: 端到端集成与自举验证** | **P5：真实项目试用 (P1 优先级)** | **TASK-E.1, TASK-E.2** | • 全流程 E2E 自动化测试套件 (覆盖熔断恢复与安全中止)<br>• Stagent 仓库真实 Dogfooding 演练报告与 npm 包 |

---

## 2. 工程拓扑与关键路径 (Critical Path)

### 2.1 三轨并行网络图

```
[Phase 0: 基础与模型]
Task 0.1: CI 与工程锁文件基线 (Lockfile + Linter + CI)
   │
   └──► Task 0.2: 合同与证据核心 Schema 与类型基线 (全字段对齐)
           │
 ┌─────────┴───────────────────────────┬─────────────────────────────────┐
 │ [Track A: 本地执行内核]              │ [Track B: 架构感知与监听]        │ [Track C: Web 交互控制台]
 ▼                                     ▼                                 ▼
Task A.1: Worktree 物理隔离与生命周期   Task B.1: 本地 AST 依赖图分析引擎   Task C.1: 合同审批卡与预算配置
 │               │                     │                                 │
 ▼               │                     │                                 ▼
Task A.2: Scoped MCP 网关与路径沙箱     │                                 Task C.2: 架构雷达大图与 Scope 圈选
 │               │                     │                                 │
 ▼               │                     │                                 ▼
Task A.3: 依赖复用 (ADR-002) 与缓存隔离 │                                 Task C.3: Diff 审阅与编辑器安全调起
 │               │                     │                                 │
 ▼               │                     │                                 │
Task A.4: 真实命令受限执行与网络策略    │                                 │
 │               │                     ▼                                 │
 ▼               └────────────────► Task B.2: 变更监听与 Evidence 失效    │
Task A.5: 循环熔断与费用硬上限 (双熔断)  │                                 │
 │                                     │                                 │
 ▼                                     │                                 │
Task A.6: Daemon 崩溃恢复与自愈        │                                 │
 │                                     │                                 │
 └─────────────────┬───────────────────┴────────────────┬────────────────┘
                   │                                    │ (C.1, C.2 汇入 D.1; C.3 汇入 D.2)
                   ▼                                    ▼
       [Phase 4: 汇合串联与核销]
       Task D.1: CLI 引导与 Local IPC / WS 通信桥 (Token 鉴权, 需 A.6 + B.2 + C.1 + C.2)
                   │
                   ▼
       Task D.2: Evidence 审查与人工确认 Squash-Merge (Git Trailer, 需 D.1 + C.3)
                   │
                   ▼
       [Phase 5: 验收与自举验证]
       Task E.1: 端到端闭环自动化集成测试 (E2E)
                   │
                   ▼
       Task E.2: Stagent 仓库自举 (Dogfooding) 真实演练
```

### 2.2 关键路径分析
* **硬性主关键路径**：`Task 0.1` ➔ `Task 0.2` ➔ `Task A.1` ➔ `Task A.2` ➔ `Task A.3` ➔ `Task A.4` ➔ `Task A.5` ➔ `Task A.6` ➔ `Task D.1` ➔ `Task D.2` ➔ `Task E.1` ➔ `Task E.2`。
* **并行汇合逻辑**：
  * **Track B 汇合**：`Task B.1` 与 `Task A.1` 共同作为 `Task B.2` 的前置依赖（外部变更监听物理依赖 Worktree 目录）；`Task B.2` 汇入 `Task D.1`；
  * **Track C 汇合**：`Task C.1` 与 `Task C.2` 作为控制台主体能力汇入 `Task D.1`，确保本地通信桥启动时即可呈现审批卡与架构雷达；`Task C.3`（Diff 审阅）作为核销前置条件汇入 `Task D.2`。所有悬空依赖彻底消除。

---

## 3. 阶段任务卡明细 (Task Specifications)

### Phase 0: 基础设施与数据模型基线

#### 【Task 0.1】工程锁文件与跨平台 CI 自动化基线
* **任务标识**：`TASK-0.1`
* **所属阶段**：Phase 0 | **规范里程碑**：§10 P0 (优先级 P0)
* **前置依赖**：无
* **研发目标**：建立工程严格锁文件与跨平台 CI 校验流水线，保证在任何全新克隆的环境下均能一键重现构建与测试。
* **交付物代码清单**：
  * `package-lock.json`（全依赖严格锁定）
  * `.github/workflows/ci.yml`（自动化 CI 流水线：Lint、TypeScript 类型检查、单元测试）
  * `scripts/verify-env.mjs`（跨平台 Node.js 环境检测脚本，支持 Windows/macOS/Linux，校验 Node >= 20.x, Git >= 2.30）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. 在干净工作区执行 `npm ci` 零警告冲突安装成功；
    2. 执行 `node scripts/verify-env.mjs` 正确输出平台矩阵（操作系统、Node、Git 版本）；
    3. 执行 `npm run lint`、`npm run typecheck`、`npm test` 全部通过（0 errors）。
  * **FAIL**：`npm install` 产生 lockfile 变更；`ci.yml` 包含特定平台专属硬编码命令导致跨平台失败；CI 忽略类型或 Lint 报错。

---

#### 【Task 0.2】合同 (Contract) 与证据 (Evidence) 核心 Schema 与类型系统
* **任务标识**：`TASK-0.2`
* **所属阶段**：Phase 0 | **规范里程碑**：§10 P0 (优先级 P0)
* **前置依赖**：`TASK-0.1`
* **研发目标**：基于架构规范 §9.1 与 §9.2 建立核心领域模型，输出运行时严格校验的 Zod Schema 与 TypeScript 类型定义，覆盖全字段契约与双状态机联动校验。
* **交付物代码清单**：
  * `src/lib/contract.schema.ts`（定义 Contract、Scope、Budgets、CostLimits、ExecutionPermissions、VerificationCommands、LifecycleState、Approval）
  * `src/lib/evidence.schema.ts`（定义 EvidenceBundle、Verdict、ScopeAudit、VerificationResult、GitInfo、Usage、ReasonCode）
  * `tests/lib/contract.schema.test.ts`（Schema 正反例边界单元测试，100% 覆盖关键字段与状态联动）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. **生命周期状态严格对齐 §9.1 9 态枚举**：`DRAFT | PENDING_APPROVAL | PREPARING | EXECUTING | VERIFYING | PENDING_RESUME | AUDITED | MERGED | ABORTED`；
    2. **证据结论状态严格归属于 Evidence**：`EvidenceBundleV11.verdict.status` 枚举为 `PASSED | FAILED | BLOCKED | STALE`；
    3. **原因码枚举完整闭环 (§9.2)**：`reason_code` 包含 `"SCOPE_VIOLATION" | "BUDGET_EXHAUSTED" | "WORKSPACE_LOCKED" | "UNAUTHORIZED_COMMAND" | "VERIFICATION_RETRY_LIMIT" | "UNSAFE_EXECUTION" | "EVIDENCE_STALE" | "PREPARATION_INTERRUPTED" | "WORKTREE_LOST"`；
    4. **双状态机联动规则校验 (§9.1.1)**：`approval.status` 枚举为 `DRAFT | PENDING_REVIEW | APPROVED | REJECTED`；当且仅当状态为 `APPROVED` 时，`approved_by` 与 `approved_at` 必填；校验逻辑严格确保 `PENDING_APPROVAL` 与 `PENDING_REVIEW` 联动、`APPROVED` 与执行阶段联动，拒绝非法的状态机交叉组合；
    5. **命令结构化与双超时定义**：`verification_spec.commands[]` 包含 `executable: string; args: string[]; expected_exit_code: number; timeout_seconds: number; working_directory?: string`，杜绝 shell 注入歧义；单命令超时 `timeout_seconds` 与任务级总运行时长 `budget_limits.max_duration_seconds` 独立定义并分别校验；
    6. **执行权限配置全字段支持**：`execution_permissions` 包含 `allowed_commands`、`allowed_environment_variable_names`、`network_policy: "DENY" | "EXPLICIT_TARGETS" | "USER_APPROVED"`、`dependency_changes_allowed: boolean`、`editor_command_template?: string`、`env_file_grants?: Array<{ file: string, command_aliases: string[], variable_names: string[] }>`、`port_policy?: "NONE" | "DYNAMIC_IF_SUPPORTED" | "EXPLICIT"`；
    7. **多币种与账单状态支持**：`cost_limits` 包含 `max_cost_minor_units`（整数）、`currency`（字符串）、`pricing_version`、`accounting_mode: "PROVIDER_REPORTED" | "ESTIMATED"`；`EvidenceBundleV11.usage.accounting_mode` 完整支持 `"PROVIDER_REPORTED" | "ESTIMATED" | "UNAVAILABLE"`；
    8. **Schema 不变式断言**：`can_merge: boolean` 必须为纯派生字段，当且仅当 `status === 'PASSED'` 且不为 `STALE` 时为 `true`，其他状态强制为 `false`；
    9. **反例单元测试**：验证命令为空、路径包含 `../` 越界字符、预算金额为负数、或非法的状态机迁移值，Zod 必须抛出明确校验异常。
  * **FAIL**：Schema 允许空验证命令通过；缺失 `PREPARATION_INTERRUPTED` 或 `WORKTREE_LOST` 原因码；将 Evidence 的 FAILED/BLOCKED 混入合同生命周期；`can_merge: true` 与 `status: FAILED` 能够共存。

---

### Track A: 本地执行内核 (Execution Core)

#### 【Task A.1】Git Worktree 物理隔离与生命周期管理器
* **任务标识**：`TASK-A.1`
* **所属阶段**：Track A | **规范里程碑**：§10 P1 (优先级 P0)
* **前置依赖**：`TASK-0.2`
* **研发目标**：实现真实 Git Worktree 的物理创建、分支绑定、状态清理与锁竞争防御，严禁在主工作树直接改动文件，并保证不污染主工程 Git 状态。
* **交付物代码清单**：
  * `daemon/git/worktree-manager.ts`（封装 `git worktree add/remove/prune`，实现生命周期物理原语）
  * `daemon/git/branch-guard.ts`（分支保护：主分支只读锁定、任务分支命名合规校验）
  * `tests/daemon/worktree-manager.test.ts`（并发隔离、未提交变更提示与放行、物理 prune 测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. 对 Contract ID 为 `{contract_id}` 的任务，基于 `authorization.git.base_branch` 在规范化绝对路径 `<repo_root>/.stagent/worktrees/task-{contract_id}` 创建独立工作树，对应本地 Git 分支严格为 `task/{contract_id}`；
    2. 自动向主仓库的 `.git/info/exclude` 注册 `.stagent/` 目录，确保嵌在仓库内的 Worktree 物理目录绝对不会出现在主仓库的 `git status` 中；
    3. **未提交变更处理 (§6.3 异常 2)**：任务 Worktree 基于指定 base_branch 的 HEAD 检出；当主工作区存在未提交变更时，向用户发出明确提示（告知未提交修改不会包含在任务中），经确认后允许继续创建，且主工作区修改不会泄露进任务 Worktree；严禁隐式复制未提交内容或执行 `git reset`；
    4. 提供底层 `prune` 原语，能清理无有效关联的废弃工作树物理目录。*(注：跨进程状态机自愈与崩溃恢复严格由 TASK-A.6 承接)*。
  * **FAIL**：工作树路径逃逸出 `.stagent/worktrees/` 目录；分支命名未带 `task/` 前缀；未在 `.git/info/exclude` 排除 `.stagent/` 导致主工作区污染；检测到主工作区脏文件时直接硬报错阻断或执行 git reset。

---

#### 【Task A.2】Scoped MCP 工具网关与路径沙箱校验
* **任务标识**：`TASK-A.2`
* **所属阶段**：Track A | **规范里程碑**：§10 P3 (优先级 P0)
* **前置依赖**：`TASK-A.1`
* **研发目标**：实现向 Coding Agent 暴露的 MCP 工具执行前校验门禁，落地白名单、预算硬拦截、文件大小限制与路径穿越防御。
* **交付物代码清单**：
  * `daemon/mcp/gateway.ts`（MCP Tool 转发中间件与前置校验拦截器）
  * `daemon/mcp/path-resolver.ts`（路径归一化、符号链接解析、禁止跳出 Worktree 根目录）
  * `tests/daemon/mcp-gateway.test.ts`（越权写入拦截、预算超出熔断、超大文件保护、软链接逃逸测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. 读写操作严格限定在 Contract 规定的 `file_system_scope.readonly_paths` 与 `writable_paths` 内，严格禁止写入只读文件；任何命中 `strictly_forbidden_paths` 的读写一律硬拦截；
    2. `stagent_read_file` 必须实施大小限制保护（默认上限 1 MiB，超过截断并标记 `truncated: true`；二进制文件仅返回元数据与哈希，标记 `binary: true`，禁止文本解码）；
    3. `stagent_write_file` 每次写入校验并发锁与修改文件数预算；超出 `budget_limits.max_file_modifications` 时立即拦截；
    4. `stagent_declare_complete` 由服务端依据实际 Scope 校验、预算与测试结果判断，返回 `{ ready_for_audit: boolean; blockers: Array<{ code: string; message: string }> }`；
    5. 尝试通过 `../../etc/passwd`、绝对路径或指向外部目录的软链接逃逸时，网关立即抛出 `PathTraversalError`（错误码 `PATH_TRAVERSAL_DETECTED`，归属于 `SCOPE_VIOLATION`），工具调用返回 `BLOCKED` 并记入审计日志。
  * **FAIL**：允许修改 Contract 范围外的 `.git/config`、`package.json`（非 Scope 声明时）；读取超大二进制文件导致内存耗尽；预算超限仍继续写入；未检测软链接 realpath 导致工作区穿透。

---

#### 【Task A.3】依赖分级复用 (ADR-002) 与工作区构建缓存隔离
* **任务标识**：`TASK-A.3`
* **所属阶段**：Track A | **规范里程碑**：§10 P5 (优先级 P1)
* **前置依赖**：`TASK-A.2`
* **研发目标**：严格遵循架构规范 §5.3 与 ADR-002，实施“首选内容寻址缓存、受控只读视图、强制缓存隔离、安全自动降级”的分级策略，杜绝主工程污染。
* **交付物代码清单**：
  * `daemon/deps/resolver.ts`（锁文件核对、包管理器内容寻址缓存优先复用器）
  * `daemon/deps/write-protection-probe.ts`（文件系统写保护前置探测器）
  * `daemon/deps/cache-isolator.ts`（重定向 `.cache`、`.turbo`、`tsconfig.tsbuildinfo`、`.vite` 目录至 Worktree 内部）
  * `tests/daemon/deps-reuse.test.ts`（缓存命中测试、写保护探测、构建缓存落盘独立性测试、安全降级测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. **内容寻址缓存优先原则 (ADR-002)**：执行前严格核对主工作区锁文件（`package-lock.json`/`pnpm-lock.yaml`），优先复用包管理器管理的内容寻址缓存（npm cache, pnpm store, Yarn cache）；
    2. **只读依赖视图写保护前置探测**：仅当需要为任务挂载主目录 `node_modules` 结构时，必须首先通过写保护探测（验证尝试写只读目录时必然被拦截）；若且仅若操作系统/文件系统能够证明写保护时，才允许建立只读依赖软链接视图；
    3. **构建缓存物理隔离**：执行 `tsc -b`、`vite build` 或测试时，写入的 `.tsbuildinfo`、`.turbo`、`.vite` 及测试临时文件必须严格隔离在任务工作树内部，主工程对应目录的文件 modification time（mtime）与校验和绝对不变；
    4. **安全优雅降级**：当写保护不可证明、锁文件不一致、或任务声明需要新增/升级依赖时，系统自动降级为 Worktree 独立隔离安装或暂停向用户发出明确授权提示，绝不静默破坏主工程。
  * **FAIL**：构建产物覆盖或破坏了主工程现有编译缓存；在未验证写保护的情况下盲目共享导致主工程 `node_modules` 被意外污染；降级逻辑失效导致构建硬崩溃。

---

#### 【Task A.4】受限进程执行器、环境脱敏与真实命令引擎
* **任务标识**：`TASK-A.4`
* **所属阶段**：Track A | **规范里程碑**：§10 P3 (优先级 P0)
* **前置依赖**：`TASK-A.3`
* **研发目标**：运行 Contract 规定的真实验证命令（编译、测试、Lint），实施命令参数化白名单、命令/任务双超时杀除、环境脱敏、网络策略控制与输出脱敏截断。
* **交付物代码清单**：
  * `daemon/runner/command-runner.ts`（封装 `child_process.spawn`，结构化 argv 启动，禁用 shell 解析，落地网络策略与命令白名单）
  * `daemon/runner/env-filter.ts`（剥离敏感系统环境变量，按 `env_file_grants` 受控注入必要测试配置）
  * `tests/daemon/command-runner.test.ts`（命令超时与任务超时退出+SIGKILL、命令注入防御、网络隔离限制、脱敏与截断测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. **参数化白名单与防注入**：仅允许执行 Contract 审批通过的 `verification_spec.commands` 白名单别名；执行参数必须为结构化 `executable` 与 `args`，子进程必须通过 `shell: false` 启动，彻底杜绝管道 `|`、分号拼接、重定向符等注入；
    2. **环境变量脱敏与受控授权**：子进程默认剔除 `AWS_SECRET_ACCESS_KEY`、`GITHUB_TOKEN`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等敏感凭据；仅注入受控的 `CI=true`、`NODE_ENV=test`、`TERM=dumb`；仅当满足 `env_file_grants` 且属于指定命令别名时，才受控注入授权文件中的变量；
    3. **网络策略限制 (network_policy)**：当 Contract 的 `execution_permissions.network_policy === 'DENY'` 时，执行器必须施加断网约束（注入离线参数或隔离网络环境），严禁未经授权的外部网络通信；
    4. **独立双超时治理 (§6.3 异常 3)**：
       - 单命令超时遵循对应命令的 `timeout_seconds`；超时向进程组发送 `SIGTERM`，宽限 3s 后若未退出发送 `SIGKILL` 终止进程树（Windows 使用 Job Object），命令退出码标记为 `124`；
       - 任务总运行时长累计遵循 `budget_limits.max_duration_seconds`，总耗时超过 `max_duration_seconds`（默认 1800s）即刻中断任务；单命令遵循 `timeout_seconds`（默认 60s）；
    5. **安全脱敏与截断**：`stagent_exec_command` 返回 `{ exit_code, stdout_tail, stderr_tail, truncated: boolean, secret_redacted: boolean, duration_ms }`，日志必须先执行敏感词脱敏再执行有界截断（上限 100k 字符）。
  * **FAIL**：子进程继承了宿主敏感凭据；超时后遗留僵尸子进程；网络策略为 DENY 却发生外网请求；未分离 argv 使用 shell 拼接导致命令注入。

---

#### 【Task A.5】循环重试熔断与费用/Token 硬上限监控
* **任务标识**：`TASK-A.5`
* **所属阶段**：Track A | **规范里程碑**：§10 P3 (优先级 P0)
* **前置依赖**：`TASK-A.4`
* **研发目标**：严格依照架构规范 §4.2.1 与 §4.2.2 实现双重熔断器，统一使用基线错误码 `E_BUDGET_EXCEEDED` 与原因码 `BUDGET_EXHAUSTED`，杜绝死循环与失控账单。
* **交付物代码清单**：
  * `daemon/guard/loop-guard.ts`（连续验证失败追踪与熔断判定）
  * `daemon/guard/cost-monitor.ts`（Token 消耗累加器与多币种硬顶拦截，抛出标准错误码）
  * `tests/daemon/guard.test.ts`（连续验证失败触发熔断、Token/费用超限即时制动测试、持久化防重置测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. **验证死循环熔断 (§4.2.2)**：连续验证失败次数达到 `budget_limits.max_verification_retries`（默认 3 次）时，立即切断 AI 修复循环；合同 `lifecycle_state` 流转为 `PENDING_RESUME`，生成的 Evidence `verdict.status` 标记为 `BLOCKED`，原因码固定为 `VERIFICATION_RETRY_LIMIT`；
    2. **费用硬上限拦截 (§4.2.1)**：按 Contract 的 `cost_limits`（`max_cost_minor_units` 与 `currency`）监控累计消费与单次预估；在发起模型请求前通过 `assertCanConsume` 预检；一旦达到上限立即熔断，抛出错误码 `E_BUDGET_EXCEEDED`，合同流转为 `PENDING_RESUME`，Evidence 状态标记为 `BLOCKED`，原因码固定为 `BUDGET_EXHAUSTED`，阻止后续任何扣费与写操作；
    3. **防重置验收**：重启 Daemon、切换模型或变更命令别名均不得重置连续失败计数器与累计费用；
    4. **账单模式支持**：完整支持 `PROVIDER_REPORTED`、`ESTIMATED` 与 `UNAVAILABLE` 模式；熔断时完整保留当前文件 Diff、输出日志与原因码。
  * **FAIL**：连续重试超过上限仍继续无限修复；达到费用上限后仍然继续发出收费 API 请求；熔断后合同被直接标记为不可恢复的终态 FAILED；错误码未对齐基线标准。

---

#### 【Task A.6】Daemon 崩溃恢复与工作区自愈引擎
* **任务标识**：`TASK-A.6`
* **所属阶段**：Track A | **规范里程碑**：§10 P5 (优先级 P1)
* **前置依赖**：`TASK-A.5`
* **研发目标**：全面实现架构规范 §6.3 异常 4 的崩溃恢复机制，确保 Daemon 意外终止、机器断电或重启后，悬空合同与孤儿工作树可安全自愈。
* **交付物代码清单**：
  * `daemon/recovery/crash-recovery.ts`（启动时扫描未决合同、Worktree 比对、状态安全回退与孤儿清理）
  * `tests/daemon/crash-recovery.test.ts`（模拟 Daemon 崩溃、PREPARING 回退、EXECUTING 恢复为 PENDING_RESUME 单元测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. Daemon 启动并获取 PID 锁后，自动扫描 `.stagent/contracts/` 与 `.stagent/evidence/` 目录；
    2. 检索处于未决中间态（`PREPARING`、`EXECUTING`、`VERIFYING`）的悬空合同，并比对 `git worktree list`；
    3. **PREPARING 中断自愈**：若合同处于 `PREPARING`，说明工作树创建或依赖配置中断：安全清理半成品 Worktree，将合同回退为 `PENDING_APPROVAL`（并将 `approval.status` 回置为 `PENDING_REVIEW`，必须重新审批）或置为 `ABORTED`（原因码 `PREPARATION_INTERRUPTED`），供用户重新发起；
    4. **执行/验证中断自愈**：若合同处于 `EXECUTING` 或 `VERIFYING` 且 Worktree 物理存在，读取最新 Git Patch、日志快照与累计费用，安全将其流转为 `PENDING_RESUME`；若 Worktree 已丢失，则标记为 `ABORTED`（原因码 `WORKTREE_LOST`）；
    5. **孤儿清理**：发现无对应有效合同的残留 Worktree 目录时，执行安全 `git worktree prune`。
  * **FAIL**：崩溃重启后未决任务状态丢失或死锁；误删正在等待恢复的任务工作树；残留半成品 Worktree 阻塞后续执行。

---

### Track B: 架构感知与文件监听 (Architecture & Watcher)

#### 【Task B.1】本地 AST 增量依赖图分析引擎
* **任务标识**：`TASK-B.1`
* **所属阶段**：Track B | **规范里程碑**：§10 P2 (优先级 P0)
* **前置依赖**：`TASK-0.2`
* **研发目标**：在 Daemon 端基于 TypeScript Compiler API 或带路径别名/类型导入插件链的 SWC 建立文件级增量依赖图分析引擎，提取模块 import/export 依赖，计算入度出度并识别循环依赖。
* **交付物代码清单**：
  * `daemon/arch/parser.ts`（单文件 AST 解析、`import type` 标定与 tsconfig `paths` 别名解析）
  * `daemon/arch/graph.ts`（内存依赖图：拓扑排序、Tarjan 强连通分量循环检测）
  * `tests/daemon/arch-graph.test.ts`（复杂项目拓扑解析、增量更新性能、循环依赖检测测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. 准确解析 TypeScript/JavaScript 文件之间的绝对与相对引用关系（含 `import type` 识别与 `tsconfig.json` paths 路径别名解析）；
    2. 内置 Tarjan 算法，能以毫秒级耗时准确识别跨文件的循环依赖环路（Cycles）；
    3. **性能基线 (§3.3)**：全量冷启动初次解析 1000 个模块时间控制在 1.5s 内；单文件变更增量重新计算耗时 $\le 20	ext{ms}$。
  * **FAIL**：依赖图解析器被错误置于浏览器前端；无法检测出明显的循环依赖；增量计算耗时 > 20ms；全量冷启动耗时 > 1.5s。

---

#### 【Task B.2】文件系统监听器与 Evidence 状态失效联动
* **任务标识**：`TASK-B.2`
* **所属阶段**：Track B | **规范里程碑**：§10 P4 (优先级 P0)
* **前置依赖**：`TASK-B.1`, `TASK-A.1`
* **研发目标**：通过 chokidar 监听工作树文件变动，联动增量更新依赖图，并在外部编辑破坏已验证快照时即刻将 Evidence 标记为 `STALE`。
* **交付物代码清单**：
  * `daemon/watcher/fs-watcher.ts`（封装 chokidar，排除 `.git`、`.stagent`、`node_modules`）
  * `daemon/watcher/invalidation-engine.ts`（文件 Hash 校验、Evidence STALE 联动触发器）
  * `tests/daemon/watcher-invalidation.test.ts`（外部修改文件即时使 Evidence 变 STALE 单元测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. 监听范围精确受控：监听范围精确受控：排除宿主 `.git/`、`.stagent/` 元数据目录（`contracts/`, `evidence/`, `session-token`, `stagent.pid`）以及工作树内部的 `node_modules/` 与产物目录；**显式挂载并监听当前活跃任务的 Worktree**（`.stagent/worktrees/task-{active_id}/`），核销/合并后动态摘除；
    2. 当检测到处于 `AUDITED` 状态且 Verdict 为 `PASSED` 的任务工作树发生外部文件新增、修改或删除时，计算指纹比对不符后，立即将对应 Evidence 的 `verdict.status` 置为 `STALE`（原因码 `EVIDENCE_STALE`）；
    3. Evidence 变为 `STALE` 后，控制台界面的“合并”按钮即刻置灰禁用，必须重新发起验证方可恢复。
  * **FAIL**：外部随意篡改代码后系统仍允许按旧的 PASSED 结果直接合并；监听器漏报文件变更；误监听 `.stagent/` 目录导致自身死循环。

---

### Track C: Web 交互控制台 (Web Console UI)

#### 【Task C.1】合同审批卡、范围核验与预算配置面板
* **任务标识**：`TASK-C.1`
* **所属阶段**：Track C | **规范里程碑**：§10 P2 (优先级 P0)
* **前置依赖**：`TASK-0.2`
* **研发目标**：为开发者呈现直观的 Contract 待办卡，包含改动动机、严格区分的读写文件清单、真实验证命令及 Token/多币种费用硬指标设定，支持账单估算与不可用标注。
* **交付物代码清单**：
  * `src/components/contract/ContractCard.tsx`（合同概览卡，展示 Scope、Budgets 与验证命令）
  * `src/components/contract/BudgetVisualizer.tsx`（Token 预算条、费用滑块与硬上限配置，支持 ESTIMATED/UNAVAILABLE 标注）
  * `src/components/contract/ScopeList.tsx`（按可写/只读/严禁严格区分展示的文件树）
  * `tests/components/ContractCard.test.tsx`（组件渲染、数据绑定、审批提交事件测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. 严格区分展示 `writable_paths`（可写）与 `readonly_paths`（只读），并对 `strictly_forbidden_paths` 进行显著的锁定警告标识；
    2. 费用上限控件严格绑定合同 `currency` 与 `max_cost_minor_units`（如以分计算）；支持显示 `PROVIDER_REPORTED`、`ESTIMATED` 或 `UNAVAILABLE` 状态标识（当为 `UNAVAILABLE` 时展示明确警示标签）；
    3. 点击“批准并开工”后触发状态更新，合同进入只读锁定态，禁止在未经再次审批前随意二次修改。
  * **FAIL**：未明确标注验证命令让用户盲目审批；缺少费用硬上限输入控件；允许空范围提交；未能呈现 UNAVAILABLE 警示。

---

#### 【Task C.2】架构雷达大图、Scope 圈选与拓扑检索交互
* **任务标识**：`TASK-C.2`
* **所属阶段**：Track C | **规范里程碑**：§10 P2 (优先级 P0)
* **前置依赖**：`TASK-0.2`（可基于 Mock 拓扑数据独立开发）
* **研发目标**：基于 Cytoscape.js 提供大图浏览、快速搜索、层级折叠、环路高亮及一键向 Contract 注入选定 Scope 的交互能力，消除下游悬空。
* **交付物代码清单**：
  * `src/components/radar/RadarGraph.tsx`（画布渲染、自适应缩放与平移控制）
  * `src/components/radar/FilterToolbar.tsx`（Active / Scope / Cycles 快捷过滤开关）
  * `src/components/radar/ScopeSelector.tsx`（多选节点并批量导出为 Scope 声明的交互组件）
  * `tests/components/RadarGraph.test.tsx`（节点渲染、搜索定位、多选事件触发测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. **性能基线**：在 1000 个节点的大型拓扑下平移与缩放保持 60 FPS 流畅交互；
    2. 支持按文件名模糊搜索，命中节点自动居中高亮并缩放至可视区域；
    3. 打开 `Cycles` 开关时，画布上所有存在循环引用的模块边变为红色闪烁提示；
    4. 用户在画布上框选或多选节点后，点击“设为可写范围”，能直接将对应相对路径同步至新建合同的 `writable_paths` 中。
  * **FAIL**：在 1000 个节点下平移/缩放出现严重卡顿（低于 60 FPS）；无法圈选节点；搜索无响应。

---

#### 【Task C.3】差异审阅 (Diff Viewer) 与外部编辑器安全调起器
* **任务标识**：`TASK-C.3`
* **所属阶段**：Track C | **规范里程碑**：§10 P4 (优先级 P0)
* **前置依赖**：`TASK-0.2`
* **研发目标**：展示任务工作树与主工作区之间的清晰代码 Diff；提供一键在本地 Cursor / VS Code 中打开任务工作树的功能，严禁打开错误路径。
* **交付物代码清单**：
  * `src/components/diff/DiffViewer.tsx`（双栏/行内 Git Diff 比较视窗）
  * `src/components/editor/EditorOpener.tsx`（调起 VS Code / Cursor 的客户端交互）
  * `daemon/editor/launcher.ts`（服务端安全验证工作树绝对路径并执行参数化调起）
  * `tests/components/DiffViewer.test.tsx`（增删行高亮、空变更提示、降级路径复制测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. 点击“在 Cursor 中检查”时，系统向本地 Daemon 发送请求，调起目标严格指向 `.stagent/worktrees/task-{contract_id}` 的绝对路径；
    2. 使用参数化模板执行启动命令，严禁直接拼接 shell 字符串以防注入；
    3. 若系统检测到本地未安装或未注册命令行工具（如找不到 `cursor` 指令），界面必须优雅降级为“复制工作树路径至剪贴板”，并展示明确提示；
    4. 严禁打开主工作区根目录。
  * **FAIL**：打开了主工程根目录导致用户误在主分支编辑；调用失败后无任何响应。

---

### Phase 4: 汇合串联、通信与核销 (Integration & Approval)

#### 【Task D.1】CLI 引导入口与 Local IPC / WebSocket 通信桥 (安全鉴权)
* **任务标识**：`TASK-D.1`
* **所属阶段**：Phase 4 | **规范里程碑**：§10 P1 (优先级 P0)
* **前置依赖**：`TASK-A.6`, `TASK-B.2`, `TASK-C.1`, `TASK-C.2`
* **研发目标**：遵循架构规范 §6.1 打通终端 CLI、本地 Daemon 与 Web 控制台，实施严格的 127.0.0.1 绑定与独立 Token 握手鉴权，汇合执行内核、依赖图与审批界面。
* **交付物代码清单**：
  * `bin/stagent.ts`（终端可执行入口：`stagent start`）
  * `daemon/server.ts`（提供 HTTP 状态与 WebSocket 实时推送，实施 Token 鉴权与心跳治理）
  * `src/lib/ipc/client.ts`（前端 WebSocket 客户端，断线自动重连与状态同步）
  * `tests/integration/ipc-stream.test.ts`（长任务命令输出实时流式传输集成测试、握手拦截测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. **严格网络边界 (§6.1)**：服务必须且仅允许绑定本地回环地址 `127.0.0.1`（默认动态寻址优先 41792 或扫描可用端口），严禁监听 `0.0.0.0`；
    2. **Token 安全存储与握手鉴权**：Daemon 启动并获取 PID 锁后，生成单次随机安全 Token 写入 `.stagent/session-token`（文件权限设为 `0600`，仅当前用户可读写）；`.stagent/stagent.pid` 仅存储 PID 等非秘密元数据；WebSocket 连接建立时必须在 HTTP Upgrade 握手阶段通过 `Authorization: Bearer <session_token>` 校验，未授权连接即刻断开；
    3. **跨站防御**：严格校验 HTTP/WebSocket 请求头 `Origin`，拒绝来自外部非本地域名的连接，防范 DNS Rebinding 攻击；
    4. **协议完备性与心跳机制**：消息帧类型完整支持 `CONTRACT_UPDATE | WORKER_LOG | SCOPE_ALERT | EVIDENCE_READY | PING | PONG | ERROR`；客户端每 5 秒发送一次 `PING`，服务端响应 `PONG`；连续 3 次无响应（约 15 秒）触发前端断线重连遮罩；
    5. **日志流式无阻断**：在流式缓冲保护下完整捕获 stdout/stderr，延迟可观测，且长日志具备安全截断保护。
  * **FAIL**：监听在公网地址；无 Token 保护即可连接；Token 与 PID 混存或权限过于宽泛；端口冲突直接崩溃退出；日志传输阻塞导致进程卡死。

---

#### 【Task D.2】Evidence 验收清单核对与 Git Trailer 审计 Squash-Merge
* **任务标识**：`TASK-D.2`
* **所属阶段**：Phase 4 | **规范里程碑**：§10 P4 (优先级 P0)
* **前置依赖**：`TASK-D.1`, `TASK-C.3`
* **研发目标**：严格依照架构规范 §5.2 完成终审流程：基于 Evidence 呈现验收报告，由人类开发者显式确认后，执行 Git Squash-Merge 并生成规范的 Git Trailer 审计提交。
* **交付物代码清单**：
  * `src/components/evidence/EvidenceChecklist.tsx`（展示退出码、耗时、测试摘要、真实输出）
  * `daemon/pipeline/merger.ts`（核验 Evidence 快照、执行 `git merge --squash`、生成 Trailer 提交）
  * `tests/daemon/merger.test.ts`（非 PASSED/STALE 状态禁止合并、Git Trailer 格式验证测试）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. 只有当合同处于 `AUDITED` 状态、Evidence 的 `verdict.status === 'PASSED'`、`can_merge === true` 且不为 `STALE` 时，“核准并合并至主分支”按钮才被激活；
    2. **标准 Git Trailer 审计规范 (§5.2)**：合并 Commit 信息必须严格采用如下 Trailer 结构：
       ```text
       feat(scope): 任务简要说明

       由 Stagent 受限执行并通过全部门禁验证。

       Stagent-Contract-ID: {contract_id}
       Stagent-Evidence-ID: {evidence_id}
       Stagent-Verdict: PASSED
       Reviewed-By: {reviewer_identity}
       ```
    3. 合并成功后，安全注销并清理 `.stagent/worktrees/task-{contract_id}` 工作树，在仓库中持久化留存合同文件 `.stagent/contracts/{contract_id}.json` 与证据文件 `.stagent/evidence/{contract_id}-{evidence_id}.json`。
  * **FAIL**：在 FAILED/BLOCKED/STALE 状态下允许强制合并；Commit 提交信息缺失必要的 Git Trailer（特别是 `Stagent-Evidence-ID`）；合并后残留死锁分支；缺少存证持久化归档。

---

### Phase 5: 端到端集成与自举验证 (E2E & Dogfooding)

#### 【Task E.1】全流程端到端自动化集成回归测试
* **任务标识**：`TASK-E.1`
* **所属阶段**：Phase 5 | **规范里程碑**：§10 P5 (优先级 P1)
* **前置依赖**：`TASK-D.2`
* **研发目标**：通过 Playwright / Vitest 编写贯穿全流程的自动化集成回归套件，覆盖正常交付闭环、熔断恢复与安全中止的差异化流转。
* **交付物代码清单**：
  * `tests/e2e/happy-path.spec.ts`（发起意图 ➔ 审批合同 ➔ Worktree 执行 ➔ 验证通过 ➔ 人工确认 ➔ Squash-Merge 闭环）
  * `tests/e2e/circuit-breaker.spec.ts`（连续验证失败 3 次熔断、Token/费用超限停机、路径越权拦截）
  * `tests/e2e/crash-recovery.spec.ts`（模拟执行中与 PREPARING 中 Daemon 进程被 kill，重启后状态自愈）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. **正常场景闭环**：在沙盒仓库中完整走通全流程，最终在主仓库生成合规的 Git Trailer 审计提交；
    2. **差异化拦截与状态机流转 (§4.2)**：
       - **可恢复熔断**：费用/Token 超限（`BUDGET_EXHAUSTED`）或验证重试达到上限（`VERIFICATION_RETRY_LIMIT`），合同流转为 `PENDING_RESUME`，Evidence 标记为 `BLOCKED`；恢复时须由用户提高/重设预算或显式启动新验证轮次，并对新的合同版本重新审批，不能原地修改已批准版本；
       - **安全强行中止**：越权篡改只读文件（`SCOPE_VIOLATION`）或执行未授权命令（`UNAUTHORIZED_COMMAND`），合同流转为终态 `ABORTED`，Evidence 标记为 `BLOCKED`，严禁在原合同上原地 resume，必须重新创建或重新审批新合同版本；
    3. **崩溃恢复闭环**：执行状态的任务在 Daemon 重启后准确回到 `PENDING_RESUME` 并不丢失 Patch；PREPARING 中断的任务安全清理半成品工作树并回退为 `PENDING_APPROVAL`。
  * **FAIL**：E2E 测试出现非预期的死锁或超时；越权场景被错误归类为可恢复的 PENDING_RESUME；重启后任务状态丢失。

---

#### 【Task E.2】Stagent 仓库自举 (Dogfooding) 与发布打包
* **任务标识**：`TASK-E.2`
* **所属阶段**：Phase 5 | **规范里程碑**：§10 P5 (优先级 P1)
* **前置依赖**：`TASK-E.1`
* **研发目标**：使用 Stagent 本身接管自身的迭代演练（Dogfooding），修复自身的一个真实 Issue，产出首版发布包与试用报告。
* **交付物代码清单**：
  * `docs/reports/v0.1-dogfooding-report.md`（记录真实自举过程：性能表现、Token/费用消耗、失败恢复记录）
  * `dist/`（构建出的可发布二进制与前端静态资源包）
  * `README.md`（面向独立开发者的快速上手文档、安全与局限性声明）
* **核心验收标准与失败判据**：
  * **PASS**：
    1. 使用 Stagent 完成至少一次自身仓库真实小功能的端到端开发与合并；
    2. 架构雷达大图正常呈现自身源码拓扑；
    3. 合并提交包含完整的 Git Trailer 审计信息；
    4. 发布说明中明确记录本地进程受限边界（非强对抗沙箱）与支持的平台矩阵。
  * **FAIL**：自举过程中破坏主仓库 Git 状态；未在 README 声明安全边界产生误导。

---

## 4. 执行顺序表与依赖矩阵速查

| 任务标识 | 任务名称 | 工程阶段 | 规范 §10 里程碑 | 前置硬依赖 | 可并行开展的协同任务 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-0.1** | 工程锁文件与跨平台 CI 基线 | Phase 0 | P0 (优先级 P0) | 无 | 无（全工程第一步） |
| **TASK-0.2** | 合同与证据核心 Schema 与类型系统 | Phase 0 | P0 (优先级 P0) | TASK-0.1 | 无（全系统类型基线） |
| **TASK-A.1** | Git Worktree 物理隔离与生命周期管理器 | Track A | P1 (优先级 P0) | TASK-0.2 | TASK-B.1, TASK-C.1, TASK-C.2 |
| **TASK-A.2** | Scoped MCP 工具网关与路径沙箱校验 | Track A | P3 (优先级 P0) | TASK-A.1 | TASK-B.1, TASK-C.1, TASK-C.2 |
| **TASK-A.3** | 依赖分级复用 (ADR-002) 与缓存隔离 | Track A | P5 (优先级 P1) | TASK-A.2 | TASK-B.1, TASK-C.2, TASK-C.3 |
| **TASK-A.4** | 受限进程执行器与真实命令引擎 | Track A | P3 (优先级 P0) | TASK-A.3 | TASK-C.3 |
| **TASK-A.5** | 循环重试熔断与费用/Token 硬上限监控 | Track A | P3 (优先级 P0) | TASK-A.4 | TASK-C.3 |
| **TASK-A.6** | Daemon 崩溃恢复与工作区自愈引擎 | Track A | P5 (优先级 P1) | TASK-A.5 | TASK-C.3 |
| **TASK-B.1** | 本地 AST 增量依赖图分析引擎 | Track B | P2 (优先级 P0) | TASK-0.2 | Track A, Track C |
| **TASK-B.2** | 文件系统监听器与 Evidence 状态失效联动 | Track B | P4 (优先级 P0) | TASK-B.1, TASK-A.1 | Track A (A.2~A.6), Track C |
| **TASK-C.1** | 合同审批卡、范围核验与预算配置面板 | Track C | P2 (优先级 P0) | TASK-0.2 | Track A, Track B, TASK-C.2 |
| **TASK-C.2** | 架构雷达大图与 Scope 圈选交互 | Track C | P2 (优先级 P0) | TASK-0.2 | Track A, Track B, TASK-C.1 |
| **TASK-C.3** | 差异审阅 (Diff Viewer) 与外部编辑器调起 | Track C | P4 (优先级 P0) | TASK-0.2 | Track A, Track B |
| **TASK-D.1** | CLI 引导入口与 Local IPC / WS 通信桥 | Phase 4 | P1 (优先级 P0) | TASK-A.6, TASK-B.2, TASK-C.1, TASK-C.2 | TASK-C.3 |
| **TASK-D.2** | Evidence 终审清单与 Git Trailer Squash-Merge | Phase 4 | P4 (优先级 P0) | TASK-D.1, TASK-C.3 | 无 |
| **TASK-E.1** | 全流程端到端自动化集成回归测试 | Phase 5 | P5 (优先级 P1) | TASK-D.2 | 无 |
| **TASK-E.2** | Stagent 仓库自举演练与发布打包 | Phase 5 | P5 (优先级 P1) | TASK-E.1 | 无 |

---

## 5. 研发规范与质量防护守则

1. **红线一：Schema 即宪法**
   `src/lib/contract.schema.ts` 与 `src/lib/evidence.schema.ts` 是全工程唯一契约。严格保持与《架构规范 v1.1.3》§9.1 与 §9.2 完全对齐，严禁在业务代码中引入未经 Schema 校验的私有字段。
2. **红线二：真实验证命令与绝对路径控制**
   子进程运行命令必须是真实命令（结构化 argv 启动，`shell: false` 启动，带参数化白名单）；调用外部编辑器时，启动路径必须严格指向 `.stagent/worktrees/task-{contract_id}` 的规范化物理绝对路径，严禁指向主工作区。
3. **红线三：绝不污染主工程**
   `.stagent/` 目录强制写入 `.git/info/exclude`；依赖复用必须执行写保护前置探测与缓存重定向，写保护无法证明时强制降级隔离安装。
4. **红线四：严格的本地安全回环与凭据隔离**
   Local Daemon 严禁监听 `0.0.0.0`，默认绑定 `127.0.0.1:41792`；启动时生成随机 Token 独立写入 `.stagent/session-token`（权限 `0600`），`.stagent/stagent.pid` 仅存进程元数据；WebSocket 握手通过 Authorization Header 鉴权并校验 Origin。
5. **红线五：规范统一事实源**
   若在开发过程中发现测试用例或代码逻辑与《Stagent 系统架构设计规范 (v1.1.3 开发基线)》存在歧义，必须以《架构规范 v1.1.3》为唯一准绳，不得自创命名与规则。

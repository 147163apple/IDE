# Stagent v0.2+ 架构演进蓝图与多 Agent 编译流水线技术规范 (RFC)

- **RFC 编号**：RFC-2026-002
- **版本标识**：v0.2.0-RFC.2
- **状态**：**DEFERRED / 远期提案附录**（2026-10-20 架构校准决议：**本文档不进入 v0.1 实施路线，不构成当前阶段的工程阻碍或验收依据**；其中「子任务新鲜上下文」与「Schema-First 公共接口任务」两点作为可选策略被 v0.1 规范吸收，其余内容待 v0.2+ 另行立项评审）
- **基线依赖**：Stagent v1.3.3 规范体系（架构规范 v1.3.3、任务规范 v1.3.3）
- **适用范围**：Stagent 核心调度器（Daemon Orchestrator）、Supervisor 编译引擎、受控 Worker 适配器、多 Agent 隔离生命周期管理
- **发布日期**：2026-10-20

> **v0.2.0-RFC.2 修订说明**：依据《三份规范文档综合审查与修订指令》（2026-10-20），本文档整体降级为远期提案附录：取消强制只读需求阶段（§3.1）、成熟度阈值不再自动触发编译（§3）、删除「防伪/不可篡改」越界措辞并对齐 `verification_spec`（§3.4/§3.5）、修正 Schema 类型定义（§4.1）、正交性校验归属 Daemon 确定性计算（§5）、失败不再自动 Git Reset（§6）、补充多子任务成本说明（§3.3）。本文描述的成熟 Agent（Claude Code / cursor-agent / OpenHands）能力一律遵循「接入前实机验证」纪律，未实测前不得标记为受控。

---

## 1. 摘要与核心动机 (Executive Summary & Motivation)

### 1.1 现状与痛点剖析 (Why v0.2+?)
在 Stagent v0.1（v1.3.3 基线）中，系统确立了“Supervisor 审需求/出合同、Daemon 管隔离/跑验证、单一受控 Worker 执行”的核心骨架，并通过全量自动化测试基线（以最新 CI 运行结果与提交哈希为准，不写死用例数）实证了核心安全不变式。

然而，在面对复杂真实软件项目（包含需求推导、接口契约设计、前后端联调、数据迁移、组件级重构）时，现有的“单 Worker 串行大合同”模式面临以下三个结构性工程瓶颈：

1. **“提笔就写代码”的过早执行陷阱（Premature Execution）**：
   用户在提出业务想法时，往往处于发散与推敲阶段。传统 AI 编程工具过早赋予 Agent 磁盘写权限，导致大量垃圾文件产生，破坏现有代码树。
2. **长会话智商衰减与上下文污染（Context Degradation & Thrashing）**：
   随开发轮次深入，代码报错堆栈、废弃尝试与长文本填满上下文，LLM 注意力严重分散，遗忘核心架构约束（如文件白名单、类型契约）。
3. **接口设计失步与联调地狱（Contract Drift）**：
   在复杂功能开发中，若无显式的前置类型约束，前后端或不同模块间的接口命名与数据结构极易产生隐式偏差，导致端到端集成阶段频繁白屏。

### 1.2 核心愿景 (Core Vision)
Stagent v0.2+ 提出**“编译器视角的现代软件工厂”**范式，将软件工程解构为由形式化契约驱动的五阶段编译流水线：
> **业务意图（Natural Language）➔ 软件授权合同（IR: SoftwareContract V2）➔ 架构约束与任务 DAG ➔ 上下文隔离的子任务 Worker 集合 ➔ 确定性物理验证（Evidence Bundle）➔ 原子合并**

---

## 2. 核心不变式与架构基石 (Core Invariants)

v0.2+ 在引入多 Agent 分工机制的同时，**严格继承并加固** v0.1 锁定的核心安全不变式，严禁退化为不受控的聊天式多 Agent：

1. **不变式 1：Supervisor 零执行权（Zero-Tool Execution Invariant）**
   Supervisor 恒为只读顾问与意图编译器，严禁挂载任何写操作、Shell 执行或文件修改工具。Supervisor 绝不直接调度或指挥 Worker。
2. **不变式 2：调度权下沉 Daemon（Deterministic Orchestration）**
   多 Agent 的调度器必须是**确定性的状态机（Finite State Machine）**与系统守护进程（Daemon），严禁用具有幻觉倾向的 LLM 作为全局调度官。
3. **不变式 3：AI 零判卷权与零合并权（Zero Self-Certification）**
   Agent 绝对没有权力判定自身测试通过，也没有权限执行 Git 合并。测试通过必须且只能由 Daemon 在操作系统中执行真实命令，以退出码 `Exit Code = 0` 及文件哈希指纹为准；合并必须由 Git 引擎原子执行。
4. **不变式 4：任务粒度物理隔离（Task-Level Worktree Isolation）**
   每个执行子任务必须绑定专属上下文与专属隔离目录，严禁两个 Worker 共享未经验证的脏工作区。

---

## 3. 五阶段执行编译流水线 (The 5-Stage Compilation Pipeline)

```
[ 用户 (User) ]
      │
      ▼
┌────────────────────────────────────────────────────────┐
│ 阶段 0：需求梳理与澄清 (Requirement Chat)                │
│ • 右侧专属聊天 Agent (Zero Write Tools)                  │
│ • Supervisor 规则优先按需介入，产出成熟度建议            │
└──────────────────────────┬─────────────────────────────┘
                           │ Supervisor 提出建议，由用户
                           │ （或保护清单规则）决定是否编译
                           ▼
┌────────────────────────────────────────────────────────┐
│ 阶段 1：业务意图编译 (Contract IR Compilation)          │
│ • Supervisor 编译生成 SoftwareContract V2 (DAG)        │
│ • 冻结架构边界、路径白名单、Schema 契约与验收基线       │
│ • 【硬性门禁】：用户人工审阅并点击签署 (Approve)         │
└──────────────────────────┬─────────────────────────────┘
                           │ 用户签署授权
                           ▼
┌────────────────────────────────────────────────────────┐
│ 阶段 2：任务分发与上下文隔离执行 (Orchestrated Workers)   │
│ • Daemon Orchestrator 解析任务 DAG 拓扑                 │
│ • 单任务单 Agent 实例化 (Task-per-Agent Lifecycle)     │
│ • Task 0: 核心类型先行 (Schema-First) ➔ 产出公共契约     │
│ • Task N: 各子任务 Worker 串行/安全拓扑执行 ➔ 任务完即销毁 │
└──────────────────────────┬─────────────────────────────┘
                           │ 执行完成
                           ▼
┌────────────────────────────────────────────────────────┐
│ 阶段 3：确定性独立物理验证 (Deterministic Verification)  │
│ • Daemon 独立接管，在物理环境中静默运行全量测试套件     │
│ • 采集真实 Exit Code、执行耗时、Git Diff                 │
│ • 生成 EvidenceBundle V2 (can_merge 确定性派生)         │
└──────────────────────────┬─────────────────────────────┘
                           │ 验证全绿 (can_merge = true)
                           ▼
┌────────────────────────────────────────────────────────┐
│ 阶段 4：原子级联代码合并 (Atomic Git Merge)            │
│ • Git 引擎原子执行 git merge --squash                   │
│ • 自动加盖 4 键标准 Git Trailer 审计追溯标记            │
│ • 销毁临时 Worktree，归档交付报告                       │
└────────────────────────────────────────────────────────┘
```

### 3.1 阶段 0：需求梳理与探索 (Requirement Chat)
- **界面形态**：工作台右侧交互框，需求讨论与编码在**同一右栏会话**中连续进行，不做物理阶段切割。
- **权限约束（修订）**：**不再强制物理剥离文件修改工具**。在 Vibe 模式下，Agent 可直接改代码并由 Daemon 自动快照兜底（详见架构规范 §0.6）；「只读需求模式」仅作为用户可选开关存在，不是强制阶段。
- **副作用隔离**：由 Vibe 模式安全网（Auto-Checkpoint + 一键撤销）与全局保护清单承担，而非通过剥夺 Agent 能力实现。
- **Supervisor 触发（修订）**：移除「对话停顿 3s 即评估」的旁听轮询；Supervisor 规则优先（L0 确定性规则零模型调用），仅在用户显式请求、Gateway 违规/熔断事件或 diff 触及保护清单时按需介入。

### 3.2 阶段 1：业务意图形式化编译 (Contract IR Compilation)
- **触发机制（修订）**：当意图满足「可观察、可边界、可冻结、可验证」条件时，Supervisor **建议**将会话历史编译为中介表示（IR）——`SoftwareContractV20`。**成熟度分数仅为建议性信号，不构成任何自动触发条件**；是否进入编译由用户显式决定（或命中保护清单规则时按架构规范 §0.6 处理）。
- **技术方案冻结**：合同中必须锁定：
  1. 需求意图（Objective & User Intent）；
  2. 接口设计（TypeScript/Zod 形式化契约）；
  3. 子任务依赖拓扑（Task DAG）；
  4. 路径白名单与禁区（Allowed / Forbidden Paths）；
  5. 物理验收断言（Acceptance Criteria & Test Commands）。
- **授权门禁**：必须经用户在 Supervisor Studio 中明示签字（Approve），不可绕过。

### 3.3 阶段 2：上下文隔离的多 Agent 任务分发 (Orchestrated Execution)
- **上下文纯净化（Single-Task Lifecycle，可选策略）**：
  「每子任务新起全新 Worker 实例」为**可选策略，默认关闭（默认单会话顺序执行）**。启用时 UI 必须显式展示预估的额外模型开销（每新增一个 Worker 实例约增加一份 System Prompt 与上下文切片的 Token 成本），由用户确认后生效。启用时：Daemon Orchestrator 为 DAG 中的每一个子任务拉起**全新且独立的 Worker 实例**。
  - Worker System Prompt 仅包含：全局合同目标 + 当前子任务详细 Spec + 当前任务的路径白名单 + 相关依赖类型的上下文切片。
  - **任务完成即销毁**：当前子任务通过代码检查后，该 Worker 会话生命周期直接终结，不把调试残留带入下一个任务。
- **Schema 先行法则（Schema-First Topology）**：
  在前后端或跨模块任务中，DAG 的首个前置任务必须为 `Task-0: Type & Contract Declarations`（定义接口 DTO 与类型文件）。后续的前后端 Worker 必须显式引入同一份静态类型，从根源消除联调不一致。

### 3.4 阶段 3：确定性独立物理验证 (Deterministic Verification)
- **去中心化执行，中心化验收**：所有子任务完成后，Daemon 接管控制权。
- **物理沙盒执行**：Daemon 调用系统 Runner 在真实环境中运行合同 `verification_spec.commands` 声明的结构化验证命令（argv + `shell:false`），不写死具体命令串。
- **证据链封存**：捕获真实进程退出码与标准错误流，计算 Worktree 内文件哈希，派生 `EvidenceBundleV20`。哈希指纹仅用于一致性校验，**不构成防篡改签名**（对齐架构规范 ADR-006 的诚实声明）。

### 3.5 阶段 4：原子级联代码合并 (Atomic Git Merge)
- **合并门禁**：仅当 `Evidence.verdict.can_merge === true` 且主分支无未提交脏改动时放行。
- **无损合流**：底层调用 Git 引擎执行 Squash Merge，自动追加审计 Trailer（用于追溯与一致性核对，不构成防篡改签名）：
  ```git
  Audited-By: Stagent-Daemon
  Stagent-Contract-ID: contract-20261020-auth-v2
  Stagent-Evidence-ID: evidence-20261020-xyz789
  Stagent-Verdict: PASSED
  ```

---

## 4. 数据契约与类型定义演进 (Schema Evolution)

### 4.1 任务 DAG 与子任务契约 (`SoftwareContractV20`)
相比 v0.1 的单块合同，v0.2 引入拓扑图结构：

```typescript
export interface SubTaskSpec {
  id: string;                      // 例如: "task-01-schema", "task-02-backend"
  title: string;
  objective: string;
  depends_on: string[];            // 依赖的前置子任务 ID 数组
  scope: {
    allowed_files: string[];       // 细粒度白名单（互斥或严格继承）
    forbidden_files: string[];
  };
  context_slices: string[];        // 仅向此 Worker 注入的文件上下文路径
  acceptance_tests: string[];      // 当前子任务的验收命令
}

// 注：SoftwareContractV12（架构规范 §9.1）本身无 `tasks` 字段，此处直接继承全量字段
export interface SoftwareContractV20 extends Omit<SoftwareContractV12, "schema_version" | "contract_version"> {
  contract_version: "2.0.0";
  execution_strategy: "SERIAL_PIPELINE" | "ISOLATED_PARALLEL";
  task_graph: {
    nodes: SubTaskSpec[];
    edges: Array<{ from: string; to: string }>;
  };
  shared_contracts: {
    schema_files: string[];        // 跨任务必须共享的契约接口文件
  };
}
```

### 4.2 拓扑执行状态机演进
Daemon 调度器在 `EXECUTING` 状态内部细分二级子状态机：
```
EXECUTING
  ├── TASK_RESOLVING (拓扑排序与就绪检查)
  ├── TASK_SPAWNING  (装配并拉起单任务 Worker)
  ├── TASK_RUNNING   (受管 Gateway 监控写入与预算)
  ├── TASK_COMMITTING (子任务临时 Commit)
  └── TASK_COMPLETED (销毁当前 Worker 上下文 ➔ 步进下一节点)
```

---

## 5. 并发模型与 Worktree 拓扑 (Concurrency & Isolation)

在 v0.2+ 中，若任务拓扑声明支持安全并行（`ISOLATED_PARALLEL`），系统采用**静态互斥校验 + 多 Worktree 隔离机制**：

1. **Scope 正交性静态校验（Orthogonal Scope Validation）**：
   若两任务声明并行，**由 Daemon 以确定性集合运算执行正交性校验**（Supervisor 只提议拆分方案，不承担证明职责，对齐不变式 2「调度确定性」）：
   $$	ext{AllowedFiles}(Task_A) \cap 	ext{AllowedFiles}(Task_B) = \emptyset$$
   任何重叠路径（包括公共配置文件）均判定为非法并行，强制退化为串行依赖。
2. **物理隔离 Worktree 拓扑**：
   - Task A 运行在 `.stagent/worktrees/wt-task-A`
   - Task B 运行在 `.stagent/worktrees/wt-task-B`
3. **拓扑级联验证（Topological Re-Verification）**：
   并行分支各自验证通过后，先合并入临时集成阶段分支；在合并回主分支前，由 Daemon 执行**全量集成回归测试**，防止产生语义隐式冲突。

---

## 6. 异常回滚与熔断策略 (Failure Modes & Circuit Breakers)

| 故障场景 | 发生阶段 | 处理策略与状态机流转 |
| :--- | :--- | :--- |
| **子任务执行超限** | Stage 2 (Worker) | 触发 `E_BUDGET_EXCEEDED` 熔断；当前 Worker 强制终止；保留 Worktree 现场，进入 `BLOCKED`，向用户呈递上下文求助。 |
| **单个子任务测试失败** | Stage 2 / Stage 3 | 允许在当前子任务内重试（受 `max_verification_retries` 限制）；重试耗尽则中止下游全部 DAG 节点，**保留失败 Worktree 现场供用户在 UI 查看 Diff 与日志，由用户一键丢弃或接管**，严禁自动 Git Reset 销毁现场。 |
| **主工程发生并发锁冲突** | Any Stage | 触发 `E_WORKSPACE_LOCKED`（HTTP 409），拒绝重复实例化 Daemon 与 Worker。 |
| **外部文件意外篡改** | Stage 3 / 4 | FS Watcher 检测到未授权文件变动，标记 `Evidence.status = STALE`，合并门禁硬阻断（`can_merge = false`）。 |

---

## 7. 实施路线与向前兼容规划 (Roadmap & Compatibility)

> **2026-10-20 校准决议**：以下阶段二至四整体**推迟至 v0.3+ 另行立项评审**，不进入 v0.1/v0.2 当前路线。v0.1 的当前路线以《研发任务拆解规范 v1.3.3》§4 的新排期（最小端到端 → 保护清单与一键合并 → 成熟 Agent 受控实测）为准。

- **第一阶段（v0.1 基线，当前）**：
  保持当前已完成底座（以最新 CI 结果与提交哈希为准，不再写死用例数），按任务规范 v1.3.3 新排期推进最小端到端闭环。
- **第二阶段（v0.3+ 候选：单任务单 Agent 串行管线）**：
  扩展 `contract.schema.ts` 支持 `SubTaskSpec[]` 串行数组；实现 Daemon 的 Worker 会话轮转与上下文清理器；右侧会话支持“需求模式（只读）”与“编码模式”角色切换（可选开关，非强制阶段）。
- **第三阶段（v0.3+ 候选：Schema-First 拓扑与公共契约先行）**：
  Supervisor 提议“接口优先”拆解方案（正交性与调度由 Daemon 确定性执行）；前端自动渲染 DAG 执行进度树与子任务状态卡片。
- **第四阶段（v0.3+ 候选：正交 Worktree 拓扑与高级验证）**：
  正式引入多 Worktree 物理隔离与正交 Scope 校验引擎，支持高确定性场景下的安全并行。

---

*本规范由 Stagent 核心架构委员会与形式化工程组共同制定，作为 v0.2+ 迭代的技术依据与验收纲领。*

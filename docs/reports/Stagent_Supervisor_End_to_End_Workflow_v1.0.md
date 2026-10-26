# Supervisor 端到端职责工作流规范 (从模糊需求到交付验收)
> **已迁入 SSOT（2026-10-26）**：Supervisor 产品与监理现行权威见 [`docs/specs/Stagent_Supervisor_Specification_v2.0.md`](../specs/Stagent_Supervisor_Specification_v2.0.md)（五大章合流）。**与本文冲突处以 SSOT 为准**；本文保留作档案/字段对接参考。 体验层以 `TASK-C.18`（自由对话 + 单页方案审阅 + 确认方案）为现行定案。

**版本**: v1.0.0-draft  
**定位**: 五阶段骨架**附件**（讨论稿）  
**状态**: **讨论稿 / 已入库 reports · 未升格为施工依据**  
**权威定稿**：冲突一律以《**Supervisor运转机制-2026-10-25**》为准（尤其 Impact 降级、**不静默放行**）。  
**消歧对齐（2026-10-26）**：五阶段叙事保留；**交付主态词汇**对齐右栏 **§14.11 EO-01**（`DeliveryState` / `DeliveryLifecycleState` vs `TaskSubState`）；沙盒与路径对齐 **EO-02**；越界挂起对齐 **EO-07** / 澄清 **§6** Top5 #3。文档资产态（`DRAFT`/`PROPOSED`/`FROZEN`…）见 DocGov，**不得**冒充 DeliveryState。**CLOSED ≠ 已实现**；未升格、未立卡。  
**关联**:
- 《Supervisor运转机制-2026-10-25》（定稿）
- 《合同设计说明-2026-10-25》§7.3–§7.5
- 《决策记录对账-2026-10-25》
- 《Supervisor右栏对话行为-设计-2026-10-26》**§14.11 EO-01～10 CLOSED**
- 《Stagent_Clarification_and_Authorization_Specification_v1.0》**§6**；《Stagent_Interface_Contract_Checklist_v1.0》**§3**
- 《Stagent_Documentation_Governance_Lifecycle_Chapter_v1.0》（资产态分轨）

---

## 1. 工作流总览

Supervisor 在 Stagent 体系中扮演“项目总监兼架构导师”角色。其职责并非简单的请求转发，而是贯穿从**意图启发、感官对齐、范围收敛、监督实施到对抗性验收**的全生命周期。

整个端到端工作流划分为 5 个标准阶段：
1. **阶段 1：意图启发与业务澄清 (Clarification & Advice)**
2. **阶段 2：只读探索与感官对齐 (Read-Only Probing & Mock Prototyping)**
3. **阶段 3：影响收敛与白话合同草拟 (Impact Convergence & Contract Drafting)**
4. **阶段 4：实施编排与红队质询 (Execution Orchestration & Red-Team Audit)**
5. **阶段 5：证据核销与辅助验收 (Evidence Settlement & Acceptance)**

### 1.1 五阶段 ↔ EO-01 交付主态（映射表）

| 工作流阶段 | 典型 `DeliveryLifecycleState` / EO-01 `DeliveryState` | 备注 |
| :--- | :--- | :--- |
| 阶段 1 | `CLARIFYING` / `PLAN_DRAFTING` → `PLAN_READY` | 方案可早；资产 `requirements` 可为 DocGov `DRAFT` |
| 阶段 1→2 门禁 | **`PLAN_CONFIRMED`** 后才解锁 Demo 生产 | **单向 DAG**；不可跳步；失败停 `DEMO_FAILED`（`TaskSubState`） |
| 阶段 2 | `DEMO_INTERACTIVE_READY` / `DEMO_NATIVE_FLOW_READY` / `DEMO_DEGRADED_READY` | 对外三态；或主干 `DEMO_READY`+`demo_mode`；**废除**无模式单一 Ready |
| 阶段 3 | `CONTRACT_PROPOSED`（活动态）→ 用户确认 Demo 后进入签署 | 资产 `requirements` → DocGov `PROPOSED`；交付主态不以 `PROPOSED` 冒充 |
| 签署生效 | **`CONTRACT_SIGNED`** | 资产轨可 `FROZEN`；**不用** `APPROVED`/`FROZEN` 作 DeliveryState |
| 阶段 4 | `IMPLEMENTING` / `PAUSED` / `REWORK_REQUIRED` | Worker 只挂 `.stagent/worktrees/{contract_id}/`（EO-02）；越界 → SIGINT 软停 3s → SIGKILL → 吊销 `exec_token` → 清锁（EO-07 / Top5 #3） |
| 阶段 5 | `VERIFYING` → **`CANDIDATE_VERIFIED`** → **`MERGED`** → **`DELIVERED`** | **废除**笼统交付 `VERIFIED`；合并前可返工；已 `MERGED` 只能新微合同 |

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Supervisor 端到端职责流水线                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
   [阶段 1: 意图启发]       [阶段 2: 感官对齐]       [阶段 3: 影响收敛]       [阶段 4: 监督质询]       [阶段 5: 辅助验收]
 ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
 │ 接收模糊输入     │     │ AST 只读探测    │     │ 依赖爆炸半径分析 │     │ 任务卡派发 Worker│     │ 收集测试 Evidence│
 │ 启发式技能建议   │ ──> │ 生成隔离 Mock   │ ──> │ 框定最小 Scope   │ ──> │ 监控越界与超时   │ ──> │ 关联候选 Tree SHA│
 │ 提炼业务分歧卡片 │     │ 驱动用户试玩    │     │ 生成白话合同草案 │     │ 对抗性质询挑刺   │     │ 渲染真机验收界面 │
 └─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 2. 分阶段输入、决策与产物矩阵

| 阶段名称 | 输入 (Inputs) | Supervisor 内部决策机制 (Key Decisions) | 阶段产出物 (Outputs) |
| :--- | :--- | :--- | :--- |
| **阶段 1：意图启发与业务澄清** | • 用户非结构化自然语言输入<br>• 用户既有项目的业务元数据（只读）<br>• 行业最佳实践知识库 | 1. **意图分类**: 属于功能新增、缺陷修复、架构重构还是纯咨询？<br>2. **模式推荐**: 推荐 Mode 1 (轻量改动) 还是 Mode 2 (标准合同)？<br>3. **分歧识别**: 识别隐藏假设与业务死角，决策是否需要拆分大需求为 Micro-Contracts。<br>4. **技能推荐**: 主动建议行业成熟方案（如会员规则选择消费达标制而非复杂付费制）。 | • **澄清卡片 / 对话输出**: 2~3 个带推荐标签的白话选择题<br>• **需求断言草案**: `requirements.md (DRAFT)`（包含核心实体与业务规则） |
| **阶段 2：只读探索与感官对齐** | • 用户在阶段 1 **`PLAN_CONFIRMED`** 后的业务规则<br>• 项目源码只读租约 (`lease.readonly`)<br>• 通用前端组件模板库<br>• Demo 落点：`.stagent/prototypes/`（**≠** worktree；EO-02） | 1. **代码探测决策**: 解析当前路由表、状态模型与 UI 框架，判断现有能力复用度。<br>2. **原型拟合决策**: 提炼界面关键状态；纯后端走 `NATIVE_FLOW` 一等公民流程卡。<br>3. **对齐判定**: 用户确认对应三态之一后方可进入阶段 3 / 签署门禁（`can_sign`，EO-06 / Top5 #4）。 | • **只读分析快照**: 现有代码骨架与候选挂载点<br>• **隔离 Demo / 流程卡**: 独立 Origin/CSP；预览事件可保留 `DEMO_PREVIEW_STATUS`（BUILDING/ERROR…），**对外就绪态**须映射 **`DEMO_INTERACTIVE_READY` / `DEMO_NATIVE_FLOW_READY` / `DEMO_DEGRADED_READY`**（旧笼统 READY → deprecated） |
| **阶段 3：影响收敛与白话合同草拟** | • 阶段 2 已确认的 Demo 三态之一（交互 / 原生流程卡 / 降级流程卡）<br>• 项目完整依赖图谱 (AST Import Graph)<br>• 保护区清单 (`protected_paths`) | 1. **爆炸半径控制**: 计算最小依赖闭包，裁剪非必要修改，将 `writable_paths` 锁定在最小集合。<br>2. **安全降级**: 绝对排除 Auth、支付核心底层等敏感区域。<br>3. **验证集设计**: 规划必需单元测试与已有功能回归集（杜绝空验证集）。<br>4. **白话翻译**: 将底层技术路径翻译成非技术用户秒懂的业务语言。 | • **白话合同提案 (`ContractProposal`)**: 提交 Daemon 审核；签署后交付主态 → **`CONTRACT_SIGNED`**<br>• **需求断言快照**: `requirements.md` 资产态 `PROPOSED`（DocGov）；**不是** DeliveryState<br>• **任务施工 DAG 草案**: 细化任务卡 |
| **阶段 4：实施编排与红队质询** | • Daemon 签发的限权 **`exec_token`**（双层令牌：外部 session + 内部 exec；Top5 #1 / EO-07；旧称 `ExecutionToken` → deprecated 别名）<br>• 独立隔离 Worktree：`.stagent/worktrees/{contract_id}/`（Worker **仅**挂载此根；禁 `../`；EO-02）<br>• Coding Worker 的实时代码补丁与执行日志 | 1. **任务卡编排**: 生成针对 Coding Worker 的高内聚、单任务 Prompt（限定在单一文件或函数内）。<br>2. **网关状态监控**: `E_OUT_OF_SCOPE` → **原子拦截**：阻断当次 IO → `SIGINT` 软停 **3s** 释锁 → 超时 `SIGKILL` → 吊销 `exec_token` → 清 `index.lock` → 交付主态 **`PAUSED`** 问人（**禁止静默放行**；Top5 #3 / EO-07）。<br>3. **红队对抗质询 (S.5)**: Worker 声明完成时，执行挑刺审查：<br>   - 断言有效性审查（是否是假测试？）<br>   - 边界值漏洞审查（折扣是否会为负？）<br>   - 回归测试执行情况。<br>4. **返工控制**: 发现缺陷，强制将返工范围限制在已改文件与合同交集内；交付主态可 `REWORK_REQUIRED`（仅 `MERGED` 前）。 | • **Worker 任务指令流**<br>• **质询报告 (`DisputeReport`)**: 内部自查通过或发起自动返工<br>• **Graph 节点状态提案**: 提请 Daemon 推进 `IMPLEMENTING` / `VERIFYING` 等主态与 `TaskSubState` |
| **阶段 5：证据核销与辅助验收** | • 实施完成的候选代码 Git Tree<br>• 物理测试日志与覆盖率报告<br>• 冻结的需求断言列表（资产轨 `FROZEN`） | 1. **真实性核销**: 逐条核验 `requirements.md` 中的断言是否均有对应通过的测试 Evidence。<br>2. **环境保真度评估**: 确认真机预览（Live Preview）是否就绪且无未捕获控制台错误。<br>3. **验收指导决策**: 为用户整理最简明直观的验收验证路径（例如：“请在第 5 屏查看以下 2 处改动效果”）。 | • **完整证据链包 (Evidence Bundle)**: 绑定候选 Tree SHA；交付主态 → **`CANDIDATE_VERIFIED`**（旧笼统 `VERIFIED` → deprecated）<br>• **用户验收卡片**: 真机预览、测试通过清单与一键合并/回滚<br>• **合并与归档**: 合并成功 → **`MERGED`**；脱敏写入 `.stagent/records/{contract_id}/`（含 `audit-manifest.json`）成功 → **`DELIVERED`**；资产轨可 `ARCHIVED`（DocGov）。失败停 `MERGED`，严禁伪造完结 |

---

## 3. 核心机制详细执行规程

### 3.1 阶段 1：业务启发与提问收敛规则
- **轮次上限**: 澄清提问严格限制在 **2 轮以内**。
- **推荐策略**: 每个选择题必须包含且仅包含 1 个 `is_recommended: true` 的选项，并附带一行通俗的理由（Trade-off）。
- **非阻塞默认值**: 对于用户未明确决定的非核心细节，Supervisor 自动采用“业界安全默认值”，并在合同中明确列出。

### 3.2 阶段 2：只读探索与 Mock 伴生规则
- **门禁顺序**: 须先 **`PLAN_CONFIRMED`**，再进入 Demo 生产（EO-01 DAG；不可跳步）。
- **零污染法则**: Demo 源码落 **`.stagent/prototypes/`**（gitignore）；严禁写入宿主 `package.json` 或主工作树；**prototypes ≠ worktrees**（EO-02）。
- **快速产出**: Mock Demo 应在方案初确后的 **30 秒内** 完成构建并输出预览链接；失败 → `DEMO_FAILED`，可重试或显式降级为 `DEMO_DEGRADED_READY`（须弹窗确认，禁静默偷换）。
- **试玩门禁**: 用户确认对应三态（`DEMO_INTERACTIVE_READY` / `DEMO_NATIVE_FLOW_READY` / `DEMO_DEGRADED_READY`）后，方可进入阶段 3 / `can_sign`；纯后端不得冒充可交互 Demo。

### 3.3 阶段 3：影响面推导 (Impact Analysis) 算法约束
> **口径（定稿收紧）**：以下为**目标约束**；v0.1 **可降级**为保守 Scope + P.1。完整 AST = **v0.2+**（合同说明 §7.5 #7 = 未实现）。勿写成已交付。

- **依赖追踪（目标）**: 从受影响的路由/页面组件出发，沿 AST `import` 关系向上向下各遍历最大不超过 **2 跳 (Two Hops)**。
- **写路径收敛（目标）**: `writable_paths` 列表文件数量默认宜不超过 **5 个**。若超过，Supervisor 应评估拆成两个微步合同。
- **通配符禁止**: 路径中禁止出现 `*` 或 `**`，必须为明确的相对路径字符串。

### 3.4 阶段 4：红队自查质询 (Supervisor Dispute Engine)
- **审查维度**:
  1. **测试真伪**: 检查新增测试中是否包含断言，禁止无断言测试。
  2. **既有回归**: 必须跑通项目原有的核心测试套件，零破坏。
  3. **未跟踪文件**: 调用 Gateway 检查是否存在未纳入 Git 跟踪的新增文件，确保全进 Scope 门禁。
- **超时（定稿）**: 质询自查最长执行 **60 秒**。超时 **不静默放行**：暂停或标黄 + 写审计；有限次回打；反复失败或需扩 Scope → **必须回用户**（见《Supervisor运转机制》§5.2）。
- **越界 / 挂起（交叉引用）**: Gateway 报 `E_OUT_OF_SCOPE` 时按 **EO-07 / Top5 #3** 原子拦截（SIGINT 3s → SIGKILL → 吊销 `exec_token` → 清锁 → `PAUSED`），本附件不另开处置选择题。

### 3.5 阶段 5：辅助验收与回滚保障
- **真机双视窗**: 在第五屏提供“改动前”与“改动后”的对比预览。
- **一键决策**: 用户点击 `[ 验收通过并合并 ]` → 先标定 **`CANDIDATE_VERIFIED`**，Daemon 原子合并成功 → **`MERGED`**，再跑 EO-05 脱敏归档；全部成功才 **`DELIVERED`**。用户点击 `[ 拒绝并放弃 ]` → 可 `ABORTED`；Supervisor 配合清理临时 Worktree（按 EO-09 manifest），主干 0 污染。
- **合并前 vs 合并后**: 合并前质疑 → `REWORK_REQUIRED`；**禁止** `MERGED → REWORK_REQUIRED`（新缺陷开微合同）。

---

## 4. 与 EO / DocGov / Top5 交叉收口（2026-10-26）

| 主题 | 定案指针 |
| :--- | :--- |
| 交付主态枚举 | 右栏 **EO-01** `DeliveryState`；本附件 §1.1 映射表 |
| 资产文件态 | DocGov **`DocumentAssetStatus`**（`DRAFT`/`PROPOSED`/`FROZEN`/`VERIFIED`…）≠ DeliveryState |
| 沙盒路径 | **EO-02**：Worker 只见 `.stagent/worktrees/{contract_id}/`；禁 `../` |
| Token / 越界软停 / Demo 三态 / 无 Git 审计 | 澄清 **§6** + Checklist **§3** API Top5 CLOSED |

**仍为讨论稿**；**CLOSED ≠ 已实现**；未升格、未立卡。冲突时：《Supervisor运转机制》定稿 + 右栏 EO CLOSED 优先于本附件旧字面。

# Stagent Supervisor 规范（Supervisor 单一事实源 · SSOT）

> **版本**：**v2.0.2**（本文档由原先独立的 v2.0 正文与 v2.0.2 裁定层**物理合流**而成；版本流转交由 Git Tag 与 commit 历史承载）  
> **日期**：2026-10-26（Asia/Hong_Kong）· 2026-10-27 合流重组  
> **状态**：**现行生效 · 全项目唯一的 Supervisor 单一事实源（SSOT）**  
> **立卡**：`TASK-C.19` / `DOC-SSOT-Supervisor` → **[COMPLETED]**（Tina t906u 授权合流起草）  
> **补丁**：`TASK-C.21` / `DOC-SSOT-Supervisor-Patch` → **[COMPLETED]**（Tina t910u「补丁」；审查冲突与不足钉死）  
> **产品定案锚点**：`TASK-C.18` tip `909198a`（方案工作台单页：自由对话 + 方案审阅 + 确认方案开工）

### 本文的读法

1. **第一部分（§0～§6）**是 SSOT 正文：角色心智、旁观编译、中栏呈现、门禁隔离、状态与异常。
2. **第二部分（§7～§12）**是裁定与验收：五项决策（D1–D5）、冲突消解记录（R1–R5）、55 条验收矩阵、任务状态判定口径、验证环境。
3. 两部分**原本是两个物理文件**（v2.0 与 v2.0.2），2026-10-27 合流为一篇，**未改写任何条文**，仅消除「点名覆盖」机制在长上下文下必然失效的问题。
4. 第二部分内的交叉引用形如「§N」且不带小数者，均指**第二部分**第 N 章；指向第一部分者一律显式写作「第一部分 §N」。

### Changelog

| 版本 | 日期（Asia/Hong_Kong） | 摘要 |
| :--- | :--- | :--- |
| **v2.0.3（草案）** | 2026-10-27 | **未并入本文。** 判别联合数据模型 / 三元哈希绑定 / 终态清理协议等条款代码 0 命中，已抽为独立 RFC：[`../rfc/scheme-snapshot-and-attestation-model.md`](../rfc/scheme-snapshot-and-attestation-model.md)。 |
| **v2.0.2 补丁 2** | 2026-10-27 | 测试基建去抖：34 段 daemon 端口区间迁到两两互斥并加 `tests/unit/test-port-map.test.ts` 守卫；WS 延迟断言改相对测量；`authTimeoutMs` 拆成「成功路径宽预算 / 超时用例短预算」。详见 §11.3 / §11.4。 |
| **v2.0.2 补丁** | 2026-10-27 | R-10 / F-07 补 HTTP 级注入测试（`tests/integration/scheme-confirm-http-injection.test.ts`，7 条）；补 `onContractCreated` 回报使补偿能精确定位已建合同。全量 `npx vitest run` 转绿。 |
| **v2.0.2** | 2026-10-26 | 五项决策钉死（单一确认谓词 / 直接签署状态边 / 事务补偿 / 权威优先级 / `completeness` 语义）+ 55 条验收矩阵（逐条绑测试 ID，`✅ 55 / ⏳ 0`）；通配符分级补「绿野脚手架种子」例外；`freezeScheme` 改为幂等，快照摘要剔除 `updatedAt`。 |
| **v2.0.1** | 2026-10-26 | Tina t909u/t910u 审查补丁：① **Demo 为体验增强项，跳过 Demo 可直接「确认方案」开工**（见 ADR-0010）；② 通配符分级；③ 「确认方案」五步原子时序钉死；④ 手改字段级 `user_pinned`；⑤ Demo 失败双按钮降级与风险标记；⑥ `demoReady` 硬性布尔底线。 |
| v2.0.0 | 2026-10-26 | 初版 SSOT 五大章合流（`TASK-C.19`）；体验对齐 C.18。 |
| **合流重组** | 2026-10-27 | 文档治理：v2.0 正文与 v2.0.2 裁定层物理合并为本文；文件名去版本号；ADR-0001～0013 抽为独立文件（见 [`../adr/`](../adr/)）。 |

---

## 0. 权威声明（先读这一节）

**本文是 Stagent Supervisor 的单一事实源（Single Source of Truth）。**

- 凡「右栏怎么聊、中栏怎么显、何时出 Demo、如何确认方案、施工门禁与异常怎么处置」——**只认本文**。
- 下列合流前碎片若与本文冲突，**一律以本文为准**。Tina t908u「归档」（`TASK-C.20`）后正文曾置于 `docs/archive/supervisor-pre-ssot/`；该目录已于 2026-10-27 文档治理整体移除，原文查 Git 历史（`git log --diff-filter=D -- docs/archive/`）：
  - `right-panel-conversation-design.md`
  - `supervisor-end-to-end-workflow.md`
  - `clarification-and-authorization.md`
  - `interface-contract-checklist.md`
  - `supervisor-mechanism.md`（机制定稿；与 C.18 体验冲突处以本文第 1～3 章为准，第 4～5 章硬防线与之对齐）
- **造 Stagent 本体的施工权威**仍是 [`../specs/system-architecture.md`](../specs/system-architecture.md)（架构宪法）+ [`../specs/development-tasks.md`](../specs/development-tasks.md)（任务卡）+ [`../specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md)（运行时硬契约）。本文不替代这三份，只统合 **Supervisor 产品与监理灵魂**。
- **不可逆决策**另见 [`../adr/`](../adr/)：ADR-0007（分权）、ADR-0010（Demo 可选门禁）、ADR-0011（审计侧车路径）、ADR-0012（`MERGED` 终态）、ADR-0013（Worker 隔离）。
- **CLOSED ≠ 已全实现**：第 4 章「已验证硬防线」标明 v0.1 已验项；其余为目标契约时须注明。
- **历史废弃（体验层）**（勿再当现行 UX）：
  - 日常五视口 Tab（原型试玩 / 任务图谱 / 质疑自查 / 合同审阅 / 真机试玩）作为主入口 → **C.18 起废弃为日常入口**（组件可留档，不作主路径）。
  - 右栏强制 ≤2 轮选择题门控（Top7 §4 / C.11a 体感）→ **C.18 起废弃为日常门控**；安全默认与关键冲突改在中栏决议区确认。
  - 中栏「继续澄清需求 / 继续讨论需求」类按钮 → **禁止出现**；用户不满意直接在右栏继续聊或手改方案。
  - 交付主态用资产 `FROZEN`/`APPROVED` 冒充「已签署可开工」、笼统 `VERIFIED`、无模式单一 `DEMO_READY` → **作废**（见第 5 章状态轨）。
  - **EO-06「未确认 Demo 禁止签署」在新体验主链上的硬卡解读** → **废止/覆盖**（v2.0.1）：Demo 为体验增强项；无 UI 或用户未点「生成 Demo」而直接「确认方案」须放行。若**已生成** Demo，则签署前仍须用户显式确认该 Demo（见 §2.1、§4.6）。

---

## 1. 角色人设与心智模型（双层心智）

### 1.1 一句话

**右栏是自由的业务搭档；幕后 Supervisor 是全景旁观者、意图编译器与底线守门人。用户从不直接跟写码 Worker 谈产品。**

### 1.2 双层分工（现行生效）

| 层 | 名称 | 用户感知 | 职责 | 绝不做什么 |
| :--- | :--- | :--- | :--- | :--- |
| **水面上** | **右栏 AI Partner** | 像跟懂业务的搭档自由聊 | 发散引导、挖真实需求、白话交流、无技术枷锁、无机械问卷剧本 | 不自批合同、不写主干、不扩 Scope、不假装「聊完就等于已开工」 |
| **水面下** | **幕后 Supervisor** | 几乎看不见「另一个 Agent」 | 静默旁观对话；评估充分度；编译模块/流程/冲突/默认推荐；刷新中栏方案；在门禁时刻推进 Demo / 冻结 / 派工 / 红队 / 证据提案 | 不抢右栏话筒做连珠炮审讯；不静默放行越界；不自签 Execution Token；不直接写用户项目主干 |

**铁律（提案与裁决分离）**：Supervisor **只提案**；用户拍板；**Daemon** 裁决状态与签发/吊销凭证；**Gateway** 物理拦截越界。

### 1.3 与周边角色的边界

| 角色 | 做什么 | 边界 |
| :--- | :--- | :--- |
| **用户** | 自由聊、审中栏图与决议、生成/试 Demo、点「确认方案」、真机验收 / 紧急暂停 / 回滚 | 不审 Diff、不维护两份大规范、不直接指挥 Worker 扩权 |
| **右栏 AI Partner** | 对话体验与意图采集 | 不拥有写主干权；关键未决交给中栏决议区，而非逼用户答技术填空 |
| **Supervisor** | 编译、旁观触发、红队质询、证据提案、验收引导 | 不自批、不自写主干、不静默扩 Scope |
| **Coding Worker** | 在 Worktree + `writable_paths` 内改码自测 | 不聊产品、不扩 Scope、不合主干、不宣称「我说完成就点亮」 |
| **Daemon / Gateway** | Schema 校验、Token、拦越界、门禁、指纹、合并/Abort | 不做产品决策；不替用户点「确认方案」 |

### 1.4 心智模型（双面镜）

- **对用户（Cognitive Shield）**：自然语言、图表方案、少量关键抉择；Git/沙盒/Hash/锁文件沉在水面下。
- **对 Daemon/Worker（Contract Compiler）**：结构化 Scope、确定性断言、状态机事件、无歧义路径；防脑补。

### 1.5 与 Cursor / Devin 的差异（产品壁垒）

Stagent 的灵魂不是「另一个能写码的聊天框」，而是：**自由对话挖需求 → 中栏可审的全景方案（含图与默认推荐）→ 用户一键确认后才冻结并施工，全程有物理门禁。** Supervisor 正是把模糊愿望编译成可靠交付契约的那一层。

---

## 2. 旁观触发与编译机制（何时动、怎么动）

### 2.1 旁观原则（现行生效）

1. **右栏不停聊、Supervisor 默听**：不因「还没问完两轮选择题」而阻塞对话（**历史废弃**：≤2 轮问卷门控）。
2. **方案可早、Demo 须晚且可选**：中栏方案草稿随聊平静更新；**Demo 不得抢跑**——须 `demoReady` 达标且用户主动点「生成 Demo」（或等价显式动作）。**Demo 是体验增强项，不是开工硬前置**：无 UI 诉求、纯逻辑/脚本任务、或用户觉得静态图表已够清楚而未点「生成 Demo」时，允许直接点「确认方案」，**以审阅后的静态方案为准直接授权开工**，系统**不得**弹「请先确认 Demo」类硬阻断。
3. **已生成 Demo 则须显式确认**：一旦用户点过「生成 Demo」且原型已产出，签署/「确认方案」前须经用户显式确认该 Demo（可与「确认方案」同屏摘要一并确认）；**不得**在用户从未生成 Demo 时，用旧 EO-06 口径卡住开工。
4. **默认推荐须可见可确认**：对话未明说的业务项，Supervisor 可给业界安全默认，但必须出现在中栏「决议区」，默认勾选/推荐态，**用户可改、须知悉**，不得静默写进冻结 Spec 却不展示。
5. **冲突显式化**：对话或模块之间出现互斥假设（例如「要真库」vs「先假数据」、多模块是否分期），进入决议区让用户抉择；**存在 OPEN 未决冲突时禁止**浮现「生成 Demo」与通过「确认方案」。

### 2.2 充分度评估（`sufficiency` / `completeness` / `demoReady`）

**目标**：用**结构化规则**判断方案是否够出 Demo、是否够确认开工。**禁止只靠大模型自报 `completeness` 分**——模型极易「自嗨」刚聊一句就打 80 分，导致「生成 Demo」过早弹出。

**硬性布尔底线（`demoReady` 必要条件，现行契约 · v2.0.1）**——下列全部为真才可置 `demoReady = true`：

1. 识别出 **≥ 2 个业务模块**；
2. 识别出 **≥ 1 条主流程**（流程/时序可表达）；
3. **无 OPEN 未决冲突**（决议区冲突卡均已用户抉择或关闭）；
4. 至少有 **≥ 1 轮有效业务属性输入**（非寒暄；含受众/数据模式/优先级/核心实体等任一业务属性的实质陈述或确认）。

**辅助分（非充分条件）**：

- `completeness` 0–100 **只作 UI 进度条展示**。
  > **v2.0.2 裁废（D5，见 §7）**：`completeness` **不参与任何门禁**、任何分支、任何 `disabled` 推导；`completeness ≥ 60` 阈值语义已废止。上列四条布尔底线是 `demoReady` 的全部内容。
- 实现侧可对启发式分做封顶/校验，**不得**把模型 JSON 里的自报分直接当权威。

**现行实现口径（C.18 薄切片 + v2.0.1 契约）**：从对话语料抽取业务模块、拼 Mermaid、生成默认决策与冲突卡（`src/lib/journey/scheme-draft.ts`）；工程落地须对齐上列布尔底线（未完全对齐前以规范为准纠偏，不得以「模型觉得够了」放行）。

**确认方案 vs Demo**：`canConfirmScheme`（可点「确认方案」）= 无 OPEN 冲突 + 方案摘要可审；**不要求** `demoReady`，**不要求**已生成/已确认 Demo。`demoReady` 只控制「生成 Demo」按钮浮现。

> **v2.0.2 收口（D1，见 §7）**：`canConfirmScheme` 已降为兼容别名，唯一门禁是 `evaluateSchemeConfirmation(draft, demo)`（含「已生成必须已确认」与「修订必须一致」）。新代码禁止使用 `canConfirmScheme`。

**演进方向**：硬字段清单（核心实体、主流程、验收判据、数据模式、受众）可继续加严布尔求值；**不得**回退到强制问卷打断右栏。

### 2.3 编译产物（从自由对话到机器可执行）

| 编译物 | 给人看 | 给机器用 |
| :--- | :--- | :--- |
| 业务模块列表 | 模块卡片 / 思维导图 | Scope 种子、任务拆分线索 |
| 架构 / 流程 / 时序图 | Mermaid 或等价可视化 | 一致性检查、Demo 骨架 |
| 默认推荐决策 | 决议区「AI 推荐 · 待确认」 | 写入草案 defaults；确认后进冻结快照 |
| 冲突抉择 | 决议区二选一/多选一 | 阻断 `demoReady` / 确认方案直至选完 |
| 白话目标与验收 | 摘要 + 验收要点 | 合同 intent、验证命令提案 |
| 最小可写 Scope（v0.1=保守规则+P.1） | 「会改哪里 / 绝不碰哪里」 | `writable_paths` / `forbidden_paths`；**通配符分级**见 §4.2（老项目禁顶层裸通配；绿野/新模块允许子目录通配并落盘收敛） |

### 2.4 触发节拍（旁观何时「动一下」）

| 时机 | Supervisor 动作 | 用户是否被打断 |
| :--- | :--- | :--- |
| 用户每轮有效发言后 | 增量刷新中栏方案（防抖；Quiet Live Patch；尊重 `user_pinned`，见 §3.3） | 否 |
| 检出新冲突 / 高风险默认 | 决议区高亮待确认项 | 否（中栏提示，非右栏逼问） |
| `demoReady` 首次达成（硬性布尔底线） | 浮现「生成 Demo」 | 否 |
| 用户点「生成 Demo」 | 在 `.stagent/prototypes/` 产隔离原型（失败见 §5.4 双按钮降级） | 仅在失败/降级时要确认 |
| 用户点「确认方案」 | **按 §5.2.1 五步原子事务**执行（验冲突→断右栏→冻结→SIGNED→Worktree/Token→切施工态） | 是（唯一终态确认） |
| 施工越界 / 返工超限 / 紧急暂停 | 见第 5 章 | 是（人话告警卡） |

---

## 3. 中栏方案操作台呈现规范（人看得懂的全景）

### 3.1 布局总览（现行生效 · C.18）

```
┌───────────────┬────────────────────────────┬──────────────────┐
│ 左：需求列表   │ 中：方案审阅（唯一主页）      │ 右：自由对话       │
│ + 规范与资产  │  图 → 决议 → Demo → 确认方案 │  AI Partner       │
└───────────────┴────────────────────────────┴──────────────────┘
```

- ActivityBar：**单门**进入方案工作台（承 `TASK-C.16`）。
- **日常只有一个中栏页面：「方案审阅」**；旧五视口不作日常入口。
- 右栏：**自由输入发送**；无「必须先答完两轮题才能往下」的门闸。

### 3.2 自上而下信息流（必须按此收口）

1. **标题与白话摘要** — 本轮要做的事（随聊更新；可手改备注）。
2. **业务图表流**（至少能表达；现行为启发式 Mermaid）：
   - 架构图（模块挂载关系）
   - 业务模块思维导图
   - 流程 / 时序图（主路径怎么走）
3. **决议区**
   - **关键分歧抉择**（冲突卡：用户必选）
   - **AI 默认推荐确认**（未明说项：展示推荐值 + 确认/改选）
4. **「生成 Demo」按钮**（条件浮现，非常驻）
   - 仅当 `demoReady`（§2.2 硬性布尔底线）为真时出现。
   - 语义：Demo 是方案展示的**增强**部分；上方方案不够完整则**不出现**该按钮。
   - **不出现 ≠ 不能开工**：用户仍可在最底部点「确认方案」。
5. **最底部唯一终态按钮：「确认方案」**
   - 点击后严格执行 §5.2.1 原子时序：**冻结 Spec → `CONTRACT_SIGNED` → Worktree/Token → 施工**。
   - **不**以「是否已生成/确认 Demo」为前置（除非本轮**已经**生成了 Demo，则须一并显式确认该 Demo，见 §2.1）。
   - **禁止**并列「继续澄清需求」「继续讨论需求」等按钮。
   - 用户若不满：回到右栏继续聊，或直接手改中栏备注/决议；方案应随聊再更新（尊重 pin）。

### 3.3 手改与随聊共编（字段级脏检查）

- 中栏允许用户手改备注、模块名、决议选择与图表旁注；手改优先于 AI 默认。
- **字段级脏检查（强制）**：凡被用户鼠标/键盘手动编辑过的节点或字段，立即标 `user_pinned: true`（或等价 `source: user` + pin 标志）。
- Supervisor 随聊 **Quiet Live Patch** 时：
  - **只增量合并未 pin 节点**（追加新模块、更新未碰过的推荐默认、刷新未 pin 的 Mermaid 片段）；
  - **严禁无提示全量重置**方案树或覆盖已 pin 字段（含正在输入的草稿与光标态）；
  - 若 AI 新意图与已 pin 内容冲突：在决议区提出「覆盖建议」，**等用户显式同意**后再解 pin / 覆盖。
- 右栏新对话应合并进方案，但**不得无提示覆盖**用户已确认的抉择。
- 冻结后中栏方案只读；要大改须新一轮微合同（见第 5 章），不得静默解冻改写已签快照。

### 3.4 Demo 在中栏的位置

- Demo 预览/入口挂在图表与决议**之下**、「确认方案」**之上**（「方案够了才**可**生成；生成后仍可再聊再改；**确认方案**才开工——亦可跳过 Demo 直接确认」）。
- Demo 物理落点：`.stagent/prototypes/{id}/`（gitignore，不进主干）；**≠** `.stagent/worktrees/{contract_id}/`。
- 三态能力（交互 Demo / 原生流程卡 / 降级流程卡）见 §4.6 / §5.4；呈现上**不得**把流程卡偷渡成「已可交互试玩」。
- **`can_sign`（v2.0.1 澄清）**：
  - 未生成 Demo → 允许以静态方案签署/确认方案（须无 OPEN 冲突）；
  - 已生成 Demo → 须用户显式确认该 Demo（或显式选择「接受仅用流程图说明开工（标风险）」降级路径）后才可签；
  - **禁止**在用户从未点「生成 Demo」时，因「Demo 未确认」拒签。

---

## 4. 门禁、隔离与工程硬契约（防越界底座）

> 本章收录 **v0.1 已验证或已定案** 的硬防线。实现以任务卡与代码钉桩为准；规范叙述保持诚实口径。

### 4.1 签署分水岭（零无授权写入）

| 阶段 | 允许 | 禁止 |
| :--- | :--- | :--- |
| **确认方案前** | 只读分析；草案写入 `.stagent/drafts/`；Demo 写入 `.stagent/prototypes/` | 写用户项目主干；下发写权限 `exec_token`；跳过用户确认开工 |
| **确认方案 / 签署后** | Worker 仅在 `.stagent/worktrees/{contract_id}/` + 合同 `writable_paths` 内施工 | 改合同本身；挂载/改写 `prototypes/` 或 `records/`；`../` 穿出 worktree；静默扩 Scope |

**不变量**：签署事件落盘前，主干工作区改动必须为 **0 字节**（drafts/prototypes 除外且不得进主干）。

### 4.2 最小可写 Scope 与严禁路径（通配符分级 · v2.0.1）

- **可写**：Impact 目标优先为精确相对路径；**v0.1 可降级**为保守规则/关键词圈选 + **P.1 保护清单**补漏。完整 AST 双向遍历 = **v0.2+**（不可写成已交付）。
- **通配符分级（强制澄清，覆盖旧「已签合同一律禁 `*`/`**`」一刀切）**：
  1. **老项目 / 改已有敏感资产**：严禁顶层裸通配（如 `src/**`、`**/*`、仓库根 `*`）；Daemon 对这类裸通配**拒批**（400/403）。应收敛到精确文件或窄目录。
  2. **新功能 / 从零新建（绿野）**：允许**模块级子目录通配**作为签署时的 Scope 种子（例：`src/features/finance/**`、`src/components/ProgressBoard/**`），以便尚未存在的文件可被创建。
  3. **落盘收敛**：Worker 在施工中每创建/改写文件后，Daemon/Supervisor 须将通配**收敛/替换**为具体文件 manifest（写入合同附属或执行快照）；验收与审计以收敛后的清单为准，不得长期悬挂无界通配。
  4. **敏感区永不被通配覆盖**：即使绿野，`.env*`、`.git/**`、`.stagent/**`、锁文件、认证/支付等 P.1 保护区仍一票否决，不可被任何 `writable_paths` 通配吞入。
  > **v2.0.2 改判（R1 / R1-b，见 §8）**：判据钉死为「**仓库里有没有项目声明**」（`package.json` 缺失即绿野，与 `daemon/supervisor/rules-l0.ts::isGreenfieldRepo` 同一口径）：① 绿野 → `src/**`、`tests/**` 可作为脚手架种子放行；② 有项目声明 → 顶层裸通配拒绝，须收敛到精确文件或模块级子目录；③ 全仓通配（`**`、`**/*`、`*`、`*/**`）**任何形态**都拒绝。
  > **首版判据（「该顶层目录是否已存在」已被实测证伪并留痕）**：仓库内 40+ 处夹具、以及非 npm 工程（Python/Go/纯脚本）都以 `src/**` 为常规写法，按目录存在性判会把它们一律判死。测试 `T-SCOPE-007/007b/007c/014/015`。
- **其他目标约束**：依赖追踪默认 ≤2 hop；单合同 `writable_paths` 宜小，过大拆微合同。
- **严禁 / 保护**：`.env*`、`.git/**`、`.stagent/**`（治理自锁）、锁文件、认证/支付等敏感区（P.1 一票否决）。
- **脏区防误伤（已验）**：未 `acknowledge_dirty` 不得把脏主仓路径卷入可写施工；API 返回 **409** + 白话低恐慌排除建议；确认后排除并入禁写（`TASK-H.6` / C.14d）。

### 4.3 OS 只读分析证明（已验口径）

- 基线/只读扫描须能给出 **OS 级只读证明**（Darwin：`sandbox-exec`；写拒登记为平台等价 EPERM/EROFS；断网证明等）。
- **未证明不得升级硬承诺**（逻辑沙盒 ≠ OS 挂载时须诚实标注）。见 `TASK-C.14e`。

### 4.4 执行凭证与越界熔断（已定案 / 多卡落地）

- **双层 Token**：外部 `session-token` + 内部 `exec_token`（绑定 `contract_id` + worktree）；`PAUSED` **硬吊销**；恢复用一次性 `resume_token`+`jti`（Top5 #1 / EO-07 / C.12a）。
- **越界原子拦截**：阻断当次 IO → `SIGINT` 软停 **3s** 释锁 → 超时 `SIGKILL` → 吊销 `exec_token` → 清锁 → 交付态 **`PAUSED`** 问人；**禁止静默放行**（Top5 #3 / C.12c）。
- Worker **只挂载** `.stagent/worktrees/{contract_id}/`；禁符号链接穿出、禁 `../`（EO-02）。

### 4.5 验收断言与证据

- 合同须带可执行验证命令；绿野/主路径常用 **`npm run typecheck`** 与 **`npm test`**（时限由合同预算约束）。
- **空验证集不得点亮**；Worker「我说完成」不够——须 Evidence 核销后由 Supervisor **提案**点亮，Daemon 裁决。
- 红队质询：查假测试/空断言、既有回归、未跟踪文件是否进 Scope；超时 **不静默放行**（暂停/标黄+审计；扩 Scope 必须新卡重签）。
- 无 Git 时审计侧车：`.stagent/records/{contract_id}/audit-manifest.json`（脱敏后哈希；Top5 #5）。**永久保留 = 脱敏后完整记录**，不是明文原声（EO-04/10）。

### 4.6 Demo / 归档隔离与 `can_sign`（v2.0.1）

- 活跃 Demo：`.stagent/prototypes/`（gitignore，不进主干）。
- 施工：`.stagent/worktrees/{contract_id}/`。
- 归档：`.stagent/records/{contract_id}/`（轻量拷贝 + audit-manifest）；`prototypes ≠ worktrees ≠ records`。
- **Demo 门禁（覆盖旧 EO-06 硬卡在新体验主链上的解读）**：
  - Demo = **体验增强项**，不是所有任务的开工硬前置。
  - **无 UI**、或用户**未点**「生成 Demo」而直接「确认方案」→ **以审阅后的静态图表方案为准直接开工**，Daemon/`can_sign` **不得强阻断**。
  - **已生成** Demo → 签署须经用户**显式确认 Demo**；或走 §5.4「接受仅用流程图说明开工（标风险）」降级并写入风险标记。
  - 合同/证据字段建议：`demo.status = none | building | ready | confirmed | failed | degraded_flowcard`；仅当 `ready` 且用户未确认、又未选降级时，才阻断签署。
  > **v2.0.2 权威优先级（D4，见 §7）**：① 有 `confirmation_id` → 按冻结快照求值，快照缺失即拒签（`409 E_SCHEME_SNAPSHOT_NOT_FOUND`）；② 无 `confirmation_id` → 回退最新确认记录；③ 完全无记录 → 视为从未生成，允许直签。旧实现「仅在已有确认记录时才校验」导致 `confirmed:false` 被整条跳过 —— 「已生成但没点确认」反而比「没生成」更容易签，属缺陷，v2.0.2 起 `confirmed !== true` 一律 `E_DEMO_NOT_CONFIRMED`。
  > **权威边界**：UI 的谓词求值只是**提前告知**；真正放行以 Daemon 求值为准。二者不一致时以 Daemon 为准并记一条告警（视为 D1 违约缺陷）。

---

## 5. 全生命周期状态图与异常处理

### 5.1 三轨解耦（强制）

| 轨 | 管什么 | 权威名 |
| :--- | :--- | :--- |
| **A. 交付主生命周期** | 用户可见本轮进度 | `DeliveryState` / `DeliveryLifecycleState`（EO-01） |
| **B. 文档资产态** | 单份文档/快照 | DocGov `DocumentAssetStatus`：`DRAFT`→`PROPOSED`→`FROZEN`→… |
| **C. 子任务活动态** | 瞬态 | `TaskSubState`（如 `DEMO_BUILDING` / `DEMO_FAILED` / `CONTRACT_SIGNING`） |

**铁律**：资产 `FROZEN` ≠ 已开工；资产 `VERIFIED` ≠ 已 `MERGED`。广播须带 `session_epoch` + `state_seq`，防重连倒流。

### 5.2 用户旅程主链（现行产品叙事 · 对齐 C.18 / v2.0.1）

```text
自由对话（右栏）
    → 方案草稿随聊更新（中栏·资产 DRAFT；尊重 user_pinned）
    → [可选] 决议确认 / 冲突抉择
    → [可选] demoReady → 浮现「生成 Demo」→ 试玩（prototypes）→ 显式确认 Demo
    → 「确认方案」（可不经 Demo）→ §5.2.1 原子事务
    → CONTRACT_SIGNED → IMPLEMENTING（worktree + Worker）
    → VERIFYING → CANDIDATE_VERIFIED → MERGED
    →（脱敏归档成功可标交付完结；失败停 MERGED，禁伪造）
```

**v0.1 运行时终态对外口径**：以 **`MERGED`** 为合并成功主归档点（硬化收官）；旧文单独强调的 `DELIVERED` 若未在运行时独立存在，话术挂在已合并归档上，不得伪标。

### 5.2.1 「确认方案」点击瞬间的原子动作链（钉死 · 防前端抢跑 / Daemon 409）

用户点击「确认方案」后，**同一事务内按序**执行（任一步失败则整链中止并回滚到可重试的审阅态，不得半签半开）：

1. **验未决冲突**：若决议区仍有 OPEN 冲突 → **拒绝跳转**，中栏冲突卡摇红/高亮，保留可编辑；**不**进入签署。
2. **阻断右栏新输入**：输入框禁用；若右栏仍在**流式输出**：
   - **策略（现行钉死）**：**中断**当前流式生成（停止 token 泵送），保留已输出文本为历史气泡；**不等待**其自然结束（避免确认按钮「假死」）。
   - 中断后本轮旁观 Patch **不再**写入方案（避免与冻结快照竞态）；未 pin 的半成品增量丢弃或标为 `aborted`。
3. **冻结快照落盘**：将中栏方案 + 决议 +（若有）Demo 确认/降级结论写入 `.stagent/drafts/`（或合同草案）不可变快照；中栏立即切**灰色只读**（可附轻量「确认开工摘要」只读条，**非**第二道「继续澄清」）。
4. **状态置 `CONTRACT_SIGNED`（经授权链路）**：现行实现可经 `PENDING_APPROVAL` → 用户批准/一键授权，但产品叙事上「确认方案」即用户终态拍板；Daemon 签发后方为机器可执行。
5. **配 Worktree + 发 Token → 中栏切入施工进度**：挂载 `.stagent/worktrees/{contract_id}/`，签发 `exec_token`，中栏无缝切到施工进度/任务图谱（或方案页内嵌施工态）；**禁止**前端在步骤 4 完成前抢跑 Worker。

**禁止**：确认瞬间并行接受新的右栏用户消息写入同一草案；确认后静默解冻改写已签快照。

> **v2.0.2 补充（D3，见 §7）**：上述五步已落为带幂等键与补偿的事务 —— 阶段名 `CLAIM_AND_QUIESCE → VALIDATE_CONFIRMATION → FREEZE_SNAPSHOT → SIGN_AND_PREPARE → COMMIT`，实现见 `src/lib/journey/confirm-scheme-atomic.ts`。
> **幂等契约**：`confirmation_id` 由**前端生成**，同一修订重试必须复用同一 id，换修订才换 id（**裁决 D-1 选定此式**；内容派生式 `sha256(scheme_id + revision + digest)` 作为 v0.2 备选，见 RFC）。同 id + 同内容 → `idempotent: true` 不重复签署；同 id + 不同内容 → `E_CONFIRMATION_ID_REUSED`，绝不覆盖。
> **补偿契约**：第 4 阶段任何失败都必须 `compensate`；补偿失败 → `E_COMPENSATION_FAILED`，**保持锁定**，禁止假装成功、禁止静默解锁。快照落盘路径钉死为 `.stagent/drafts/schemes/{confirmation_id}.json`，摘要剔除 `updatedAt`。

### 5.3 与五阶段监理职责的映射（机制层仍有效）

| 阶段 | 监理职责 | 产品触点 |
| :--- | :--- | :--- |
| 1 意图启发 | 分类、默认推荐、拆微步建议 | 右栏自由聊 + 中栏决议 |
| 2 感官对齐 | 只读探测、隔离 Demo | 「生成 Demo」 |
| 3 影响收敛 | 最小 Scope、白话合同/Spec | 确认方案前的范围说明 |
| 4 实施编排与红队 | 派工、越界挂起、质询回打 | 施工中状态 / 暂停卡 |
| 5 证据与验收 | Evidence、真机引导、合并提案 | 验收 / 合并 / 回滚 |

### 5.4 异常与人话处置

| 异常 | 系统行为 | 对人怎么说 |
| :--- | :--- | :--- |
| **紧急暂停** | 用户触发 Abort/Pause → 吊销 `exec_token` → 保留现场 | 「已暂停，改动还在隔离区，可恢复或放弃」 |
| **越界熔断** | 原子拦截 → `PAUSED` | 「差点改到约定外的文件，已拦住；要扩权还是回滚？」扩权 = **新卡重签**，禁止默许 |
| **Demo 失败** | `DEMO_FAILED`；中栏 Demo 区展示失败原因 + **两个显式动作**（见下） | 禁静默偷换为交互 Demo；禁假装「已可试玩」 |
| **返工超限** | 按 `assertion_id` 计数；超限 `ESCALATED_HUMAN` | 「同一问题来回改太多次了，需要你拍板怎么收束」；返工期禁偷偷追加新断言 |
| **合并后新缺陷** | **禁止** `MERGED → REWORK_REQUIRED` | 开**新微合同**，不解开已合并轮次 |
| **放弃本轮** | 二次确认；非成功终态归档 | 清理临时 worktree；不得标成已交付 |

### 5.4.1 Demo 失败时的中栏呈现（钉死 · v2.0.1）

非技术用户点完「生成 Demo」后若 Vite/沙盒构建失败，**中栏 Demo 区域**必须同时提供且仅提供：

1. **【重试生成】** — 重新走原型构建；状态回到 `DEMO_BUILDING`。
2. **【接受仅用流程图说明开工（标风险）】** — 显式降级：采用中栏已有的 Mermaid/流程说明作为感官对齐替代物；**不是**在 Demo 视口里塞一张伪装成交互 Demo 的静态卡而不告知。

降级接受后的**风险标记写法（合同/证据须落盘）**：

- `demo.status = degraded_flowcard`
- `demo.risk_flags` 至少包含：`NO_INTERACTIVE_DEMO`
- 白话摘要示例：「本轮未提供可点击试玩原型，仅以流程图/架构图说明对齐；真实界面以施工后真机为准。」
- UI：中栏 Demo 区显示黄色风险条；「确认方案」摘要中复述该风险，避免用户误以为已试玩过。

**禁止**：失败后自动把降级流程卡标成「交互 Demo 就绪」；禁止无按钮的静默降级。

### 5.5 微合同（切蛋糕）

大欲望由 Supervisor **建议**拆成半小时级小步；每步：聊清 → 方案 →（可选 Demo）→ 确认方案 → 施工 → 验收。拍板永远在用户。Demo 全程可选（§2.1 / §4.6）。

---

## 6. 附录：权威指针与未吸尽项

### 6.1 已吸收并洗练的来源

| 来源 | 本文落点 |
| :--- | :--- |
| 右栏设计稿 §0 双面镜 / 编译哲学 | §1、§2 |
| C.18 自由对话 + 单页方案审阅 + 确认方案 | §1～§3（**现行体验**） |
| C.21 / Tina t910u 审查补丁（Demo 门禁、通配分级、确认原子时序、pin、降级、demoReady） | §2.1–2.2、§3.3–3.4、§4.2、§4.6、§5.2.1、§5.4.1 |
| C.16 单门工作台 | §3.1 |
| 运转机制定稿四机制/五阶段/红队收紧 | §1、§4.5、§5.3 |
| 澄清授权稿：签署前后权限、不变量、方案早 Demo 晚 | §2.1、§4.1、§4.6 |
| Top7 / API Top5 / EO-01～10 / Spec Freeze 状态轨 | §4、§5.1 |
| DocGov 资产态分轨 | §5.1 |
| C.14d/e、H.6 脏区与 OS 只读 | §4.2、§4.3 |
| C.12a–e Token/越界/Demo/审计 | §4.4～§4.6 |
| 主路径里程碑 / 硬化收官终态口径 | §5.2 |

### 6.1b 架构决策记录（独立 ADR）

本 SSOT 涉及的全部不可逆决策已抽为独立文件，见 [`../adr/`](../adr/)：

| ADR | 与本文的关系 |
| :--- | :--- |
| [ADR-0007](../adr/0007-dual-agent-daemon-authority.md) | §1 提案与裁决分离铁律的来源 |
| [ADR-0010](../adr/0010-demo-optional-not-hard-gate.md) | §2.1 / §3.4 / §4.6 的 Demo 可选门禁（**推翻旧 Demo 硬前置**） |
| [ADR-0011](../adr/0011-audit-sidecar-records-path.md) | §4.5 审计侧车路径（废止 `.stagent/metadata/`） |
| [ADR-0012](../adr/0012-merged-as-terminal-state.md) | §5.2 终态口径（`MERGED`，无独立 `DELIVERED`） |
| [ADR-0013](../adr/0013-cli-isolation-without-bare.md) | Worker 适配器隔离（弃用 `--bare`） |
| [ADR-0008](../adr/0008-demo-isolated-origin.md) | §4.6 Demo 独立 Origin |

### 6.2 已知未吸尽 / 仍分治（不假装本文已吞掉）

1. **Interface Checklist 全量通道矩阵（A–F 非 Top5 行）**：字段级 Pending、UI 排版细则仍以 Checklist 讨论稿为对接看板；本文只收硬门禁与 Top5 定案。
2. **完整 AST Impact / Mode 0–4 / 真脑图 / 云归档 / W.5b·c / D.1e**：继续 **v0.2+ 封印**，本文仅保留诚实降级口径。
3. **右栏 1300+ 行历史补丁与演示脚本（C.11 五步体感）**：产品哲学已折叠进本文；逐条 UI 文案与演示卡不整份搬迁。
4. **方案图 LLM 精画**：现行为启发式薄切片；升级须另立卡，不在本文假装已交付。
5. **《架构规范》《任务规范》正文**：不因本文自动改写；任务回写仅 `TASK-C.19` 薄卡。
6. **Spec Freeze「五正文分治」索引**：Freeze 记录仍是封版锚点；**Supervisor 体验与监理 SSOT 升级为本文**——Freeze 文首应加指针，避免双 SSOT 打架。

### 6.3 给研发的最短上下文用法

写 Supervisor / 工作台相关代码时，优先把 **本文全文** 放入上下文；需要字段 Schema 时再打开 Checklist 附录；需要任务验收句时打开《任务规范》对应 `TASK-*` 卡。

---

*文档结束。冲突以本文为准；实现以任务卡与 git tip 为准。*

---

# 第二部分 · 裁定、冲突消解与验收矩阵

> **来源**：原 `Stagent_Supervisor_Specification_v2.0.2`（裁定与验收矩阵）。2026-10-27 与第一部分物理合流。
> **⚠️ 未接线即未完成**：§9 矩阵中标 `⏳` 的行不得在任何任务卡上标记 `COMPLETED`（判定口径见 §10）。
> **冲突时按此优先级读**：**§7 决策 > 第一部分具体条款 > 第一部分原则性表述 > 已归档旧文档**。

## 7. 五项决策（钉死）

### D1 · 确认门禁只允许一个谓词

**决策**：`evaluateSchemeConfirmation(draft, demo)` 是**唯一**的「能不能点确认方案」判定函数。UI、Daemon、脚本、重试**全部**调用它；任何形式的第二套判断（分数阈值、按钮态 `disabled` 推导、后端独立 if）都视为缺陷。

- **实现锚点**：`src/lib/journey/scheme-draft.ts` → `evaluateSchemeConfirmation`
- **UI 调用点**：`src/routes/index.tsx` → `schemeConfirmation`（`useMemo`）→ `SchemeReviewPane`
- **Daemon 侧等价物**：`daemon/supervisor/demo/signing-gate.ts` → `evaluateSnapshotDemoGate` / `evaluateLatestDemoGate`（同一组拒绝码，不得自造新码）
- **废止**：v2.0.1 遗留的 `completeness >= 40` 前端门槛 —— **删除，不保留**。
- **兼容**：`canConfirmScheme(draft)` 仅是 `evaluateSchemeConfirmation(draft, EMPTY_DEMO_GATE).ok` 的别名，新代码禁止使用。

**拒绝码闭集**（新增码必须同时更新本文与测试）：

| 码 | 触发条件 | 用户可做什么 |
| :--- | :--- | :--- |
| `E_SCHEME_ALREADY_FROZEN` | 方案已冻结 | 无需操作（已签署） |
| `E_SCHEME_CONFLICTS_OPEN` | 仍有 `chosenId === null` 的冲突 | 在中栏决议区选一个 |
| `E_SCHEME_NOT_REVIEWABLE` | 标题 < 2 字或（摘要 < 8 字且无模块） | 继续聊或手改 |
| `E_DEMO_BUILDING` | `demo.status === "building"` | 等完成或重试 |
| `E_DEMO_FAILED` | `demo.status === "failed"` | 重试 / 显式接受降级 |
| `E_DEMO_CONFIRMATION_REQUIRED` | 已生成但 `decision_revision !== scheme_revision` | 点「确认 Demo」或「接受降级」 |
| `E_DEMO_STALE` | `demo.scheme_revision !== scheme_revision` | 重新生成 Demo |

### D2 · 允许 `PLAN_CONFIRMED → CONTRACT_SIGNED` 直签

**决策**：Demo 是**可选增强项**。状态机必须显式存在 `PLAN_CONFIRMED → CONTRACT_SIGNED` 这条边，且**只由 D1 的谓词守卫**（`demo.status === "none"` 时放行；已生成则必须先确认）。

- **实现锚点**：`src/lib/state/delivery-state.ts` → `DELIVERY_TRANSITIONS.PLAN_CONFIRMED`
- **保留**：`PLAN_CONFIRMED → DEMO_READY → CONTRACT_SIGNED` 老链路继续合法。
- **禁止**：`PLAN_READY → CONTRACT_SIGNED`（跳级）；`MERGED → REWORK_REQUIRED`（开新微合同）。

### D3 · 「确认方案」是带幂等键与补偿的原子事务

**决策**：点击「确认方案」= 五阶段事务，顺序不可调换：

| # | 阶段 | 必须完成的事 | 失败语义 |
| :--- | :--- | :--- | :--- |
| 1 | `CLAIM_AND_QUIESCE` | 中断右栏流式 + 禁用右栏输入 | 失败即中止，**不落任何盘** |
| 2 | `VALIDATE_CONFIRMATION` | 在**已冻结**的同一修订上跑 D1 谓词 | 失败即解锁，可重试 |
| 3 | `FREEZE_SNAPSHOT` | 写不可变快照 `.stagent/drafts/schemes/{confirmation_id}.json` | 失败即解锁，**不进签署** |
| 4 | `SIGN_AND_PREPARE` | 建合同（带 `confirmation_id`）→ 批准 → 建任务图 | 失败必须 `compensate` |
| 5 | `COMMIT` | 记住幂等结果，方案冻结，右栏保持锁定 | — |

**幂等契约**：
- `confirmation_id` 由前端生成，**同一修订重试必须复用同一 id**；换修订才换 id。
- 同 id + 同内容 → 返回原结果（`idempotent: true`），**不重复签署**。
- 同 id + 不同内容 → `E_CONFIRMATION_ID_REUSED`（前端）/ `E_SCHEME_CONFIRMATION_CONFLICT`（快照层），**绝不覆盖**。
- 快照摘要**不含** `updatedAt`（见 §8 R3）；`freezeScheme` 对已冻结方案**幂等返回原对象**。

**补偿契约**：
- 第 4 阶段任何失败都必须调用 `compensate`（终止本次已建合同；token/Worktree 回收由 Daemon 负责）。
- 补偿成功 → 解锁右栏，可重试。
- 补偿失败 → `E_COMPENSATION_FAILED`，**保持锁定**并提示需人工处理。**禁止**假装成功、禁止静默解锁。
- 第 5 阶段成功 → 右栏**保持锁定**：冻结后右栏输入只会被 `rebuildSchemeFromCorpus` 静默丢弃，锁定是诚实呈现。解锁只在「新建需求」时发生。

- **实现锚点**：`src/lib/journey/confirm-scheme-atomic.ts` → `runConfirmSchemeAtomic`；`src/routes/index.tsx` → `handleConfirmScheme`；`daemon/pipeline/scheme-snapshot-store.ts`；`daemon/server.ts` → `POST /api/supervisor/scheme/freeze`

### D4 · 权威优先级：Daemon 快照 > 最新记录 > 从未生成

**决策**：签署门禁的输入有明确优先级，**不允许**「没传快照就放行」：

1. **有 `confirmation_id`**：读冻结快照，按快照内 `demo` 事实逐项核对（`evaluateSnapshotDemoGate`）。快照不存在/损坏 → `409 E_SCHEME_SNAPSHOT_NOT_FOUND`，**拒绝签署**。
2. **无 `confirmation_id`（旧路径）**：回退最新 Demo 确认记录（`evaluateLatestDemoGate`）。
3. **完全无记录**：视为「从未生成 Demo」→ 允许直签。

**必须防住的回归**：旧实现「仅在已有确认记录时才校验 `canSign`」，导致 `confirmed: false` 的记录被整条跳过 —— 「已生成但没点确认」反而比「没生成」更容易签。v2.0.2 起，`confirmed !== true` 一律 `E_DEMO_NOT_CONFIRMED`。

**权威边界**：UI 的谓词求值只是**提前告知**；真正放行以 Daemon 求值为准。二者结论不一致时，以 Daemon 为准并记一条告警（视为 D1 违约缺陷）。

- **实现锚点**：`daemon/supervisor/demo/signing-gate.ts`；`daemon/pipeline/orchestrator.ts` → `approve(..., { demoGate })` / `admit(..., { demoGate })`；`daemon/server.ts` → `POST /api/contracts/:id/approve`

### D5 · `completeness` 只是展示分，`demoReady` 恰为四条布尔底线

**决策**：
- `demoReady = modules.length >= 2 && hasMainFlow(draft) && openConflicts === 0 && business_input_rounds >= 1`
- `completeness`（0–100）**不得**出现在任何门禁、分支、`disabled` 推导里；只用于中栏进度展示。
- `sufficiency` 属 Supervisor 内部信号，与签署门禁无关。

**禁止**：以 `completeness >= N` 作为放行条件（v2.0.1 遗留实现已删除）；以 `completeness` 作为拒绝理由文案。

- **实现锚点**：`src/lib/journey/scheme-draft.ts` → `computeDemoReady` / `scoreCompleteness`

---

## 8. 审查冲突消解（v2.0.1 → v2.0.2）

| # | 原冲突 | v2.0.2 裁定 | 落点 |
| :--- | :--- | :--- | :--- |
| R1 | §4.2 说「老项目禁裸通配」，但绿野脚手架会生成 `src/**`、`tests/**`，字面上同样被禁 | 判据钉死为「**仓库里有没有项目声明**」（`package.json` 缺失即绿野，与 `daemon/supervisor/rules-l0.ts::isGreenfieldRepo` 同一口径）：<br>① 绿野 → `src/**`、`tests/**` 可作为脚手架种子放行；<br>② 有项目声明 → 顶层裸通配拒绝，必须收敛到精确文件或模块级子目录；<br>③ 全仓通配（`**`、`**/*`、`*`、`*/**`）→ **任何形态**都拒绝 | `src/lib/writable-scope-grade.ts` → `gradeWritableScope` |
| R1-b | 首版把判据写成「该顶层目录是否已存在」，实测证伪 | **改判并留痕**：仓库内 40+ 处夹具、以及非 npm 工程（Python/Go/纯脚本）都以 `src/**` 为常规写法；按目录存在性判会把它们一律判死，且与产品既有 `isGreenfieldRepo` 语义分叉。按声明判则精确命中风险面（**已有工程声明却仍要整目录可写**），实测 20 条受影响的既有用例全部恢复 | 同上；`tests/unit/writable-scope-grade.test.ts` T-SCOPE-007b/014/015 |
| R2 | §4.2 只说「落盘后收敛」，没说收敛何时发生、保留什么 | 收敛规则钉死：`exact` 原样保留；glob 被其命中的已写文件替换（去重）；未命中则保留原 glob 种子 | `convergeWritableManifest` |
| R3 | §5.2.1 要求快照幂等，但摘要含 `updatedAt`，重试必然摘要不同 → 被判「另一版方案」 | 摘要**剔除 `updatedAt`**（纯本地时间戳，不承载决策）；其余字段全参与。`freezeScheme` 对已冻结方案幂等返回 | `scheme-snapshot-store.ts::schemeSnapshotDigest`、`scheme-draft.ts::freezeScheme` |
| R4 | §5.2.1 第 4 步写「可经 `PENDING_APPROVAL` → 用户批准」，与「用户点确认即拍板」有歧义 | 产品语义上点击即拍板；机械上仍走 `PENDING_APPROVAL → PREPARING` 授权链，**前端不得在批准完成前拉起 Worker** | `handleConfirmScheme.signAndPrepare` |
| R5 | §2.2 曾以 `completeness >= 60` 作辅助门禁，与 D5 冲突 | 废止阈值语义，只留展示 | 见 D5 |

---

## 9. 验收矩阵（每条绑定测试 ID）

**图例**：`✅` 已实现且有通过测试 · `⏳` 已有实现但缺自动化证据（**不得标 COMPLETED**） · `—` 不适用

测试文件：
- `tests/unit/scheme-confirmation-gate.test.ts` → `T-GATE-*` / `T-STATE-*`
- `tests/unit/confirm-scheme-atomic.test.ts` → `T-ATOM-*`
- `tests/unit/writable-scope-grade.test.ts` → `T-SCOPE-*`
- `tests/unit/scheme-signing-gate.test.ts` → `T-DEMO-*`
- `tests/ui/task-c22-confirm-wiring.test.tsx` → `T-UI-*`

### 9.1 状态前置条件（允许签署的起点）

| ID | 前置状态 | 期望 | 测试 |
| :--- | :--- | :--- | :--- |
| M-01 | `PLAN_CONFIRMED` + `demo.status=none` | 允许直签 | ✅ T-GATE-001 / T-STATE-001 |
| M-02 | `PLAN_CONFIRMED` + Demo `ready` 且同修订已确认 | 允许签署 | ✅ T-GATE-002 |
| M-03 | `PLAN_CONFIRMED` + Demo `degraded_flowcard` 且已显式接受 | 允许签署，标记 `NO_INTERACTIVE_DEMO` | ✅ T-GATE-010 |
| M-04 | `DEMO_READY`（老链路） | 允许签署 | ✅ T-STATE-002 |
| M-05 | `PLAN_READY` | 拒绝（跳级） | ✅ T-STATE-003 |
| M-06 | 方案已冻结 | 拒绝重复确认 | ✅ T-GATE-009 |

### 9.2 拒绝用例（每一条都必须给出可执行的原因）

| ID | 场景 | 期望拒绝码 | 测试 |
| :--- | :--- | :--- | :--- |
| R-01 | Demo `building` | `E_DEMO_BUILDING` | ✅ T-GATE-003 |
| R-02 | Demo `failed` 未处置 | `E_DEMO_FAILED` | ✅ T-GATE-004 |
| R-03 | Demo 已生成未确认 | `E_DEMO_CONFIRMATION_REQUIRED` | ✅ T-GATE-005 |
| R-04 | Demo 基于旧修订 | `E_DEMO_STALE` | ✅ T-GATE-006 |
| R-05 | 有 OPEN 冲突（即使 Demo 就绪） | `E_SCHEME_CONFLICTS_OPEN` | ✅ T-GATE-007 |
| R-06 | 方案不可审阅 | `E_SCHEME_NOT_REVIEWABLE` | ✅ T-GATE-008 |
| R-07 | 降级卡未显式接受 | `E_DEMO_CONFIRMATION_REQUIRED` | ✅ T-GATE-010 |
| R-08 | `completeness` 高但缺主流程 | `demoReady=false`（不因分数放行） | ✅ T-GATE-011 |
| R-09 | Daemon 侧 `confirmed:false` 记录 | `E_DEMO_NOT_CONFIRMED`（**旧实现会跳过**） | ✅ T-DEMO-002 / T-DEMO-010 |
| R-10 | 快照不存在但传了 `confirmation_id` | `409 E_SCHEME_SNAPSHOT_NOT_FOUND` | ✅ T-HTTP-R10-001（创建）/ T-HTTP-R10-002（签署） |
| R-11 | 老项目 `src/**` | `E_WRITABLE_SCOPE_POLICY` 403 | ✅ T-SCOPE-011 |
| R-12 | 全仓通配 `**/*` | 拒绝（任何项目形态） | ✅ T-SCOPE-007c |
| R-13 | 敏感路径 `.env` / `.stagent/` / 锁文件 | `sensitive_forbidden` | ✅ T-SCOPE-005 / T-SCOPE-008 |
| R-14 | 仓库已有 `package.json` 却仍声明 `src/**` | 拒绝（判据是工程声明，不是目录是否存在） | ✅ T-SCOPE-015 |

### 9.3 幂等用例

| ID | 场景 | 期望 | 测试 |
| :--- | :--- | :--- | :--- |
| I-01 | 同 `confirmation_id` + 同修订重放 | `idempotent: true`，签署次数仍为 1 | ✅ T-ATOM-002 |
| I-02 | 同 id + 换修订 | `E_CONFIRMATION_ID_REUSED`，不签署 | ✅ T-ATOM-003 |
| I-03 | 快照同 id + 同内容重放 | 返回原快照，`created_at` 不变 | ✅ T-DEMO-013 |
| I-04 | 重试时重新冻结（`updatedAt` 变化） | 摘要不变，不冲突 | ✅ T-DEMO-013b |
| I-05 | 快照同 id + 内容变化 | `E_SCHEME_CONFIRMATION_CONFLICT`，不覆盖 | ✅ T-DEMO-014 |
| I-06 | 已冻结方案再冻结 | 原样返回（引用相等） | ✅ T-DEMO-013c |
| I-07 | 失败后同 id 重试 | 不被失败的幂等记录污染 | ✅ T-ATOM-011 |
| I-08 | `confirmation_id` 非法（越界/过短） | `E_CONFIRMATION_ID_INVALID`，不触碰右栏 | ✅ T-ATOM-010 / T-DEMO-015 |

### 9.4 故障注入（每一阶段都要能失败得干净）

| ID | 注入点 | 期望副作用 | 测试 |
| :--- | :--- | :--- | :--- |
| F-01 | 右栏静默失败（流式中断超时） | `E_QUIESCE_FAILED`，零写盘、零签署 | ✅ T-ATOM-005 |
| F-02 | 谓词拒绝 | 在 `VALIDATE` 中止，不写快照，解锁 | ✅ T-ATOM-006 |
| F-03 | 快照落盘失败（磁盘只读） | `E_SCHEME_SNAPSHOT_FAILED`，不签署，解锁 | ✅ T-ATOM-007 |
| F-04 | 签署失败 + 补偿成功 | `E_SIGN_AND_PREPARE_FAILED`，解锁可重试 | ✅ T-ATOM-008 |
| F-05 | 签署失败 + 补偿失败 | `E_COMPENSATION_FAILED`，**保持锁定** | ✅ T-ATOM-009 |
| F-06 | 修订号已过期（并发改方案） | `E_SCHEME_REVISION_MISMATCH`，不写快照 | ✅ T-ATOM-004 |
| F-07 | 任务图创建失败 | 归入 `SIGN_AND_PREPARE` 失败 → 补偿终止合同 | ✅ T-HTTP-F07-001（补偿成功）/ T-HTTP-F07-002（补偿失败） |
| F-08 | 快照文件损坏 / 手工篡改 | `readSchemeSnapshot` 返回 `null` → 拒签 | ✅ T-DEMO-015 |

### 9.5 Scope 分级（通配符）

| ID | 输入 | 期望分类/裁决 | 测试 |
| :--- | :--- | :--- | :--- |
| S-01 | `src/features/finance/report.ts` | `exact`，接受 | ✅ T-SCOPE-001 / T-SCOPE-006 |
| S-02 | `src/**`、`tests/**`（老项目） | `bare_top_glob`，拒绝 | ✅ T-SCOPE-002 / T-SCOPE-011 |
| S-03 | `**`、`**/*`、`*` | `bare_top_glob`，拒绝 | ✅ T-SCOPE-003 |
| S-04 | `src/features/finance/**` | `module_subdir_glob`，接受 | ✅ T-SCOPE-004 |
| S-05 | `src/**`（空绿野仓库，无 `package.json`） | 脚手架种子，接受 | ✅ T-SCOPE-007 / T-SCOPE-014 |
| S-06 | `src/**`（仓库已有 `package.json`） | 拒绝，须收敛到模块级 | ✅ T-SCOPE-007b / T-SCOPE-015 |
| S-07 | 收敛：glob 命中已写文件 | 替换为具体文件 | ✅ T-SCOPE-009 |
| S-08 | 收敛：glob 无命中 | 保留原种子 | ✅ T-SCOPE-009 |
| S-09 | 收敛去重 | 同一文件不重复 | ✅ T-SCOPE-010 |

**统计**：§3.1–§3.5 共 **45** 条，其中 `✅ 45` / `⏳ 0`。

> R-10 与 F-07 原先只能靠单测桩验证，现已补 `tests/integration/scheme-confirm-http-injection.test.ts`：起真 Daemon，故障由真实 HTTP 请求注入，断言落在落盘后的权威状态（合同 `lifecycle_state`、快照可回读性、图谱 404）而非内存桩的调用次数。

### 9.6 前端接线（组件必须真的连到谓词与回调）

> 评审反复出现的一类缺陷：函数写好了、`grep` 得到符号，但组件没传 props —— 新分支永远不渲染。以下用例专门守这一层。

| ID | 断言 | 测试 |
| :--- | :--- | :--- |
| U-01 | 未生成 Demo → 确认按钮可用、无阻断条 | ✅ T-UI-001 |
| U-02 | Demo 已生成未确认 → 确认按钮禁用 + 说明原因 | ✅ T-UI-002 |
| U-03 | 有未决冲突 → 即使 Demo 已确认也不放行 | ✅ T-UI-003 |
| U-04 | `completeness` 极低但四条件齐备 → 按钮仍可用 | ✅ T-UI-004 |
| U-05 | 点「确认此 Demo」真的触发 `onConfirmDemo` | ✅ T-UI-005 |
| U-06 | Demo 失败 → 同时给重试与接受降级，两者均可点 | ✅ T-UI-006 |
| U-07 | 已接受降级 → 显示已确认条且可确认 | ✅ T-UI-007 |
| U-08 | Demo 属旧修订 → 确认入口禁用（须先重生成） | ✅ T-UI-008 |
| U-09 | `locked=true` → 锁定条可见且带原因 | ✅ T-UI-009 |
| U-10 | 未锁定 → 无锁定条 | ✅ T-UI-010 |

测试文件：`tests/ui/task-c22-confirm-wiring.test.tsx`。

**合计 55 条**：`✅ 55` / `⏳ 0`。

---

## 10. 任务状态判定口径（防「假 COMPLETED」）

一条任务卡可在规范里标 `COMPLETED`，**当且仅当**：

1. §9 矩阵中属于它的行**全部**为 `✅`（有测试文件 + 测试 ID 可搜到 + 该测试在本地通过）；
2. `npm run typecheck` 相对基线**无新增错误**（本项目基线尚有已知错误，见 §11）；
3. 无「仅前端改了、Daemon 未接」或「仅写了函数、无调用点」的情况 —— 评审时必查调用点（`grep` 关键符号），不接受「代码已存在」当完成。

当前状态（2026-10-26）：

| 能力 | 实现 | 测试 | 可标 COMPLETED |
| :--- | :--- | :--- | :--- |
| 单一确认谓词（D1/D5） | ✅ | ✅ 16 条 | ✅ 是 |
| 直接签署状态边（D2） | ✅ | ✅ 3 条 | ✅ 是 |
| 确认方案原子事务 + 补偿（D3） | ✅ | ✅ 13 条 | ✅ 是 |
| Daemon 签署门禁 + 快照（D4） | ✅ | ✅ 18 条 | ✅ 是 |
| 通配符分级接入合同创建/批准 | ✅ | ✅ 17 条 | ✅ 是 |
| HTTP 级故障注入（R-10、F-07） | ✅ | ✅ 7 条 | ✅ 是 |

---

## 11. 验证环境与已知限制（诚实声明）

### 11.1 已通过的验证（2026-10-27 复跑）

| 项目 | 命令 | 结果 |
| :--- | :--- | :--- |
| 前端构建 | `npx vite build` | ✅ 通过（`✓ built`，预渲染 `/` 成功） |
| 类型检查 | `npx tsc --noEmit` | ✅ 相对基线**无新增**（13 条基线错误不变；另 1 条随旧 `canSign` 调用移除而消失） |
| 本次新增单测 | 4 个文件 | ✅ 64/64 |
| 本次新增 HTTP 注入测 | `scheme-confirm-http-injection` | ✅ 7/7（起真 Daemon，覆盖 R-10 / F-07） |
| 该套件的「有牙」验证 | 临时回退 `compensate` 的 `contract_id` 透传 | ✅ `T-HTTP-F07-001` 如期转红（`E_COMPENSATION_FAILED` ≠ `E_SIGN_AND_PREPARE_FAILED`），恢复后转绿 |
| 确认链回归 | 5 个文件（gate / atom / demo / scope / UI） | ✅ 74/74 |
| 合同与中止回归 | `contract-api` + `resume-abort` | ✅ 14/14 |
| 本次新增 UI 测 | `task-c22-confirm-wiring` | ✅ 10/10（既有 `task-c18` 5 条亦无回归） |
| 进程启动白名单 | `spawn-whitelist` | ✅ 17/17（新模块曾因注释里出现 `.exec(` 被误判，已改 `String#match` 并修正注释） |
| 端口登记表守卫 | `test-port-map` | ✅ 4/4（34 段区间两两互斥；合成重叠必被检出；临时制造真实重叠已验证转红） |
| WS / IPC 套件 | `ws-auth-handshake` + `ipc-stream` + `presentation-state-wiring` + `ws-auth` + `ws-security` | ✅ 33/33；5 文件满并发 60/60 |
| **全量** | `npx vitest run` | ⚠️ **1546 条 / 1533 过 / 7 失败 / 6 跳过**（见 §11.2 归因：7 条均非本卡代码） |

### 11.2 全量结果与归因

**最终读数（2026-10-27 06:06，端口去重 + 相对测量之后）**：`npx vitest run` → **1546 条 / 1533 过 / 7 失败 / 6 跳过**（199 文件：194 过 / 4 失败 / 1 跳过）。比上一版多 5 条（`test-port-map` 4 条 + `ws-auth-handshake` 的超时标尺 1 条）。

**7 条失败逐条归因——没有一条来自本次改动**：

| # | 失败项 | 条数 | 真实原因 |
| :--- | :--- | :--- | :--- |
| 1 | `baseline-c14e` OS 沙箱（写拒绝 / 出网失败 / 聚合 / 归档证据） | 4 | **本机 `sandbox-exec` 事实上不可用**：macOS 26.6.2 上只要 seatbelt 配置含 `deny` 子句（`(deny default)` 或 `(allow default)(deny network*)` 一样），内核就拒收——`sandbox_apply: Operation not permitted`，退出码 71；`(allow default)` 却能正常跑。探针因此拿不到任何「被拒绝」的证据。**并顺带暴露一个产品缺陷**：网络探针用 `code !== "CONNECTED"` 判定，无输出（`code === null`）被算成「断网已证明」，会给归档凭空挂一条假证据（详见 §11.5）。 |
| 2 | `chat-session` 「首字 ≤1s」 | 1 | 绝对延迟断言（实测 1955ms）。该轮 `setup` 累计 **2123s**、整轮 19.6 分钟，机器处于极端降速状态——这条是机器级 SLA，负载下不成立，见 §11.4。 |
| 3 | `deps-reuse` 「零拷贝挂载 < 500ms」 | 1 | 同类绝对延迟断言（实测 1553ms）。 |
| 4 | `task-c17-debug-log` 「daemon.jsonl 轮转」 | 1 | 30s 用例超时，同样是极端负载；上一轮它的 4 条同族用例是撞上沙箱删除阈值（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，count 50/50），本轮只剩这条超时。 |

对照：同一环境下**全部** WS / IPC / 端口相关用例（`ws-auth-handshake`、`ipc-stream`、`presentation-state-wiring`、`ws-auth`、`ws-security`、`test-port-map`、以及 `chaos-concurrency` / `merge-decision-d4` / `task-c15b`）均通过——这正说明 §5.4 的处置有效：原先必红的 3 条 WS 用例已在满并发下稳定通过。

> 读数口径仍然诚实：上一版「0 失败」是权限窗口与负载都正常的时段取得的。**要复现 0 失败，需要在启用沙箱、且机器无其他重负载的时段跑。**

**处置后读数（2026-10-27 06:20）**：`npx vitest run` → **1549 条 / 1532 过 / 7 失败 / 10 跳过**。上表 7 条已全部消除（沙箱 4 条改判 + 判定口径修复，性能 3 条改为「SLA + 3×本机调度抖动」，见 §11.4/§11.5），跳过数从 6 增至 10 是因为 4 条「真跑一次」的沙箱用例在本机不可证明时被显式跳过。

新出现的 7 条属于另一类，均**不是**产品回归：

| 类别 | 条数 | 说明 |
| :--- | :--- | :--- |
| safe-delete 垫片 | 6 | `SAFE_DELETE_BULK_CONFIRM_REQUIRED`（count 50/50，`scope: "turn"`）——执行环境在同一轮累计 50 次删除后拒绝后续删除，`afterEach` 清理临时目录时抛错。仓库内已有先例（`tests/unit/deadlock-call-sites.test.ts` 的 `diskDeleteBlocked()`），按同一口径改造清理逻辑即可。 |
| dom UI 偶红 | 1 | `tests/ui/supervisor-draft-wiring.tsx` 的 `intent-paths` 断言，单跑 5/5 必绿、全量偶红；报错里打印的期望值是 14 条绿野种子，提示存在「预填被后续刷新覆盖」的时序问题。 |

这两项（safe-delete 垫片 6 条、dom UI 偶红 1 条）的**复现步骤、已知事实、假设与验收标准见本节上表**，状态为**未闭环**，交给后续执行。
> **⚠️ 文档事实校正（2026-10-27）**：原文指向 `docs/tasks/TASK-C.21-未闭环收尾-cursor-brief.md`。该目录与文件在当前仓库中**均不存在**（推测为写作时拟建路径，从未落盘）。按 D-7 裁决，此处改为**内联承载**，不再引用不存在的路径。若后续为这两项立卡，请写入 [`../specs/development-tasks.md`](../specs/development-tasks.md)。

此前一轮（提交者终端，03:05）读到 **1540 条 / 1525 过 / 9 失败**，9 条已逐条归因并全部消除：

| # | 失败项 | 条数 | 真实原因 | 处置 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `unit/supervisor-contract-generator` | 4 | 已提交的 `d8ff4e1`（绿野 npm 对齐）在**临时仓库没有 `package.json`** 时把 14 条脚手架种子并入可写范围、把 `max_file_modifications` 抬到 40；而这几条用例要测的是「默认预算」与「显式 scope」，夹具缺 `package.json` 就被判成绿野 | ✅ 夹具补 `package.json`（回归常规项目语义）；另加一条专门用例锁定绿野行为（种子并入 + 预算 40 + 用户路径仍排第一 + 非绿野对照组不变） |
| 2 | `integration/supervisor-draft-api` | 1 | 同上：`context_paths` 优先级用例的临时仓库同为绿野，期望被种子污染 | ✅ 夹具补 `package.json`，12/12 通过 |
| 3 | `unit/git-cwd-isolation` | 3 | **宿主仓库 `.git/config.lock` 残留**（189 字节、写了一半的 `[core]` 段），断言 `lockExists === false` 直接读到它 | ✅ 见下「锁的真实来源」，清理后 23/23 通过 |
| 4 | `daemon/chat-session` | 1 | `POST /api/chat/.../messages` 返回 409 `E_CHECKPOINT_FAILED`——本轮开工前的 git 快照写入被环境拒绝（`ensureCheckpoint`）。同一份代码清理后 7/7 通过 | ✅ 已随权限窗口恢复而转绿 |

**锁的真实来源（已定位，修正早前猜测）**：`.git/config.lock` 与 `.git/worktrees/stagent-base/HEAD.lock` 不是测试套件泄漏，而是**一次被中断的 `git worktree add` 的残骸**——`git worktree list` 里挂着一个 `locked initializing`、HEAD 全零、目录只剩一个坏 `.git` 文件的 `/private/tmp/stagent-base`。处置链条：`worktree unlock` → 删除该目录 → `worktree prune -v`（输出 `gitdir file points to non-existent location`）→ 列表恢复为宿主 + 4 个真实任务 worktree。

跑测期间宿主 `.git` 会出现 50+ 次 `index.lock` 的创建/删除事件，这是 git 读命令刷新索引的正常行为，**跑完为 0**；空闲 10 秒实测零事件，因此不是常驻 daemon 在轮询。

**首轮读数（历史，同日更早）**：1533 条 / 1499 过 / 28 失败 / 6 跳过。其中 18 条是 R1 首版判据过严导致的 403（已按 §8 R1 改判）、1 条是新模块被进程扫描误判（已改 `String#match`），其余 9 条即上表。

### 11.3 验证环境的三个坑（都会伪装成断言失败）

1. **权限窗口会随会话收紧，且不预告**。`scheme-confirm-http-injection` 首次 7/7 通过后，同一会话稍后重跑在 `beforeEach` 就失败——`git init` 报 `fatal: could not set 'core.repositoryformatversion' to '0'`（`.git/config` 写入被拒），7 条全部在 16ms 内失败、**无断言参与**。`vitest.global-setup.ts` 已把 `TMPDIR` 重定向到仓库内 `.tmp/vitest`，该策略连此目录的 git 写入也拒绝。判别方法：失败耗时异常短且集中在 `beforeEach`，就不是断言问题。
2. **残留锁比失败更贵**。被中断的 git 写入会留下 `.git/config.lock` / `.git/index.lock`，前者让 `git-cwd-isolation` 稳定变红，后者让仓库直接不可提交。跑测前先 `find .git -name '*.lock'`，跑完后 `git worktree list` 也顺手看一眼有没有 `locked initializing` 的残骸。
3. **daemon 测试的端口段是硬约束，现在由测试守住**。`createDaemon` 在区间内找空位，两套件共用同一段时，8 路并发下会「连上了但不是这个 daemon」，表现为 `unexpected first frame: ERROR`、`AUTH_OK` 回放拿到 `false` 一类怪错误，而不是干脆的 `EADDRINUSE`——所以它极易被误判成产品缺陷。本卡曾误用 3690–3695（属 `resume-abort` / `presentation-state-wiring` / `task-c15b`）。本轮把全部 34 段区间迁到互斥位置：

   | 文件 | 区间 | 文件 | 区间 |
   | :--- | :--- | :--- | :--- |
   | `scheme-confirm-http-injection`（本卡） | 3800–3809 | `task-c15b-rework-live-path` | 3860–3869 |
   | `ipc-stream` | 3810–3819 | `happy-path`（e2e） | 3870–3879 |
   | `presentation-state-wiring` | 3820–3829 | `circuit-breaker`（e2e） | 3880–3889 |
   | `ws-auth-handshake` | 3830–3839 | `protection-endpoint` | 3890–3899 |
   | `chaos-concurrency` | 3840–3849 | `supervisor-draft-api` | 3900–3909 |
   | `merge-decision-d4` | 3850–3859 | `console-static-d1b` | 3910–3919 |
   | | | `crash-recovery`（daemon） | 3920–3929 |

   并新增 `tests/unit/test-port-map.test.ts` 把这条约定变成可执行断言：扫描 `tests/**` 收集 `startPort`/`endPort`，任意两段重叠即失败（含同文件内），另查「构造 daemon 却没声明区间」的文件——`createDaemon` 的默认段是 3001–3010，不声明就等于所有未声明套件共享同一段。该守卫已用「临时把 `ipc-stream` 改成 3832–3836」验过会转红，报错直接点出 `ws-auth-handshake [3830–3839] ↔ ipc-stream [3832–3836]` 并打印整张登记表。

### 11.4 负载敏感断言：分清「延迟断言」与「等待预算」

8 fork 争 CPU 时，同一批 WS 用例会单跑全绿、并发偶红。本轮把成因拆成两类，处置方式不同：

**A. 延迟断言（断言「多快」）→ 必须相对测量。** `ws-auth-handshake` 原有两条 `expect(elapsed).toBeLessThan(200)`，并发下实测 396 / 561ms——它测的是调度公平性，不是产品行为。改为：

- **同机同刻取标尺**：先测一次「连上不发帧、等满 `authTimeout` 才断」的耗时，断言拒绝路径比它快出大半个预算。负载把两条路径同向推后，相减后只剩行为差。
- **计时起点放在「发起连接」而不是 `open` 回调**：服务端的 `authTimeout` 只在连接建立后才起算，从 `open` 起量会被握手期间的调度延迟吃掉一截——实测吃掉 627ms（1500ms 预算只量到 873ms），足以让标尺缩水、把差值断言打成假失败。
- **另加一条与负载无关的行为判别**：两条路径都发 4401，但 ERROR 帧的 message 不同（`Invalid session token` / `First frame must be AUTH` / `AUTH frame required within auth timeout`）。断言「原因不是超时」，比任何毫秒数都稳。帧在对端先 close 时可能随 socket 拆除一起丢，故 `reason` 允许为 `null`，只断言 `not.toBe(超时文案)`。

**B. 等待预算（断言「最终会到」）→ 必须宽松，失败要说清是「没到」。** `nextFrame` / `connectAndCollect` 的超时属于此类，收紧只会把「帧晚到」误判成「没反应」：

- `nextFrame` 预算 2s → 5s，并在连接先关闭时**立刻**失败并报出 close code——否则只能干等 2s 再报「没等到帧」，把「服务端 4401 了」误诊成「服务端没反应」。
- `connectAndCollect` 预算 1.5s → 5s，但 AUTH_OK 之后给 500ms 宽限即收工（服务端发完 AUTH_OK 紧接着回放），正常路径不让用例白等预算；连接被服务端关掉时立即交回已收帧。

**C. 真正的元凶：成功路径与超时用例共用一个 `authTimeoutMs`。** `ipc-stream` / `ws-auth-handshake` / `ws-auth` 都把 `authTimeoutMs` 设成 400ms 以便快速测超时，但这份配置**同样约束成功路径**：8 fork 抢 CPU 时 AUTH 帧的处理被拖过 400ms，服务端按配置先行 4401，合法 Token 也拿不到 `AUTH_OK`。更麻烦的是 ERROR 帧会随 socket 拆除一起丢，客户端只看到「没反应」——这正是 `unexpected first frame: ERROR` 与 `authOk === false` 的真实来源。处置是**按用例切换预算**（三个套件都加了 `startDaemon(ms)`）：

- `beforeEach` 起**宽预算**（`ipc-stream` / `ws-auth` 8s，`ws-auth-handshake` 10s），成功路径不陪绑；
- **超时用例自行切到短预算**（400ms；`ws-auth-handshake` 的拒绝用例 1s，因为标尺要快才能做差），并断言「等满了才断」（`elapsed ≥ 0.9 × 预算`）。

这**不是**放宽断言：超时用例仍然严格断言等满，只是把「测超时」和「测握手成功」两件事从同一个旋钮上解耦。全量实测：`ipc-stream` 6 条 7.2s、`ws-auth` 8 条 9.8s，与拆分前基本持平。

收敛结果：原先 8 文件满并发 60 条里必红 3 条（`ipc-stream` 握手、`presentation-state-wiring` 回放、`ws-auth-handshake` 合法 Token），现 60/60 通过；五个 WS 套件同跑 33/33；同一批用例在全量 1546 条的环境里也全绿。

**其余三条性能断言：补了余量函数，SLA 仍以原值为基线。**

它们在 06:06 那轮也红了，但性质与 WS 那批不同——是产品级性能门槛，不能简单删掉。处置方式是给余量，不是给豁免：

| 用例 | 原断言 | 现断言 | 极端负载实测 |
| :--- | :--- | :--- | :--- |
| `chat-session` 流式首字 | `首字 < 1000ms` | `< 1000 + 3 × 本机调度抖动` | 1955ms |
| `deps-reuse` 零拷贝挂载 | `< 500ms` | `< 500 + 3 × 本机调度抖动` | 1553ms |
| `task-c17-debug-log` 轮转 | 30s 用例超时 | 120s（等待预算） | 超时 |

「本机调度抖动」由 `tests/helpers/load.ts` 的 `measureSchedulingStallMs()` 现测：跑三次 0ms 定时器取中位数。机器健康时它≈0，断言等价于原始 SLA；机器被拖垮时余量随实测放大——**但仍在断言，不静默放过**，失败信息里会打印抖动值，一眼能分清「产品变慢」还是「机器卡了」。

`deps-reuse` 那条还补了一句注释：零拷贝的**本质证据**是 `lstat().isSymbolicLink()`，500ms 只是「顺手用 symlink 而不是 install」的旁证，别把旁证当主证。

`task-c17` 的超时是真的在写满轮转阈值（每次 64KB + stat），并发下顶到 30s 默认值；它属于「等待预算」，给到 120s 即可，不存在放宽语义的问题。

**F-07 补测顺带修掉一个真实缺陷**：`runConfirmSchemeAtomic` 原先在 `SIGN_AND_PREPARE` 失败时调用 `compensate` **不传** `contract_id`——建图失败发生在合同已落库之后，补偿只能靠前端闭包里的 `staging.contractId` 兜底。现已补 `signAndPrepare({ onContractCreated })`：合同一落库即回报事务，补偿与失败结果都带上该 id，`T-HTTP-F07-001` 断言 `result.contract_id === 已建合同 id` 且 `compensate` 拿到的就是它。

### 11.5 OS 沙箱证明的诚实性缺陷（本轮修复）

追查那 4 条沙箱失败时，发现的不只是环境问题，而是一个**会让证据链造假的缺陷**：

`proveScanNetworkDenied` 用 `denied = code !== "CONNECTED"` 判定。沙箱应用失败时子进程根本没跑起来，stdout 为空 → `code === null` → `null !== "CONNECTED"` 成立 → **`denied: true`**。同一次探测里，写路径用的是 `code !== "WROTE" && code !== null`（正确），两条路径口径不一致，于是出现「写未证明、网已证明」这种自相矛盾的结论。若此时落盘，`runProgressiveBaselineScan` 会把 `os_sandbox.network_denied = true` 写进归档，`osSandboxFullyProven` 也可能据此把「绝不触碰线上业务」升级成已兑现承诺——而实际上什么都没证明。

修复（`daemon/baseline/os-sandbox.ts`）：

| 改动 | 内容 |
| :--- | :--- |
| `probeDeniedFromOutput(stdout, successToken)` | 抽出纯函数，判据只有一条：**必须有输出**。无输出 → 返回 `false`（未证明），两条路径共用同一口径 |
| `isSandboxLaunchFailure(stderr)` | 识别 `sandbox_apply` / `sandbox-exec:` / `Operation not permitted`，用于在 notes 里写明失败原因 |
| `isOsSandboxApplicable()` | 用**实际使用的配置**探测（含 `deny` 子句），而不是宽松配置——实测宽松配置能跑，会给出「可用」的假结论 |
| `proveOsSandbox` 的 notes | 无法应用时写明「本轮不构成只读/断网证明」 |
| `baseline-c14e` 测试 | 本机不可证明时 `skipIf` 跳过 4 条真跑用例（不再报假红），另加 3 条用例：两条纯函数守住判定口径（任何平台都跑），一条断言「无法应用时不得声称已证明」 |

**这条缺陷的价值高于 4 条红**：它是「证据可以凭空生成」这一类问题，比任何一次断言失败都严重。测试改绿只是副产品。

---

## 12. 权威指针

| 主题 | 权威文件 |
| :--- | :--- |
| Supervisor 产品与监理语义 | 本文档（第一部分 + 第二部分） |
| 系统不变量 / 架构宪法 | [`../specs/system-architecture.md`](../specs/system-architecture.md) |
| 任务与验收 | [`../specs/development-tasks.md`](../specs/development-tasks.md) |
| 运行时硬契约（Scope / Token / 审计 / 终态） | [`../specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md) |
| 不可逆技术决策 | [`../adr/`](../adr/)（ADR-0007 / 0010 / 0011 / 0012 / 0013 与本文直接相关） |
| 交付状态机 | `src/lib/state/delivery-state.ts`（代码即权威） |
| 确认事务 | `src/lib/journey/confirm-scheme-atomic.ts`（代码即权威） |
| 签署门禁 | `daemon/supervisor/demo/signing-gate.ts`（代码即权威） |

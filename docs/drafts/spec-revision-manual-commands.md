# 规格修订稿（草案）：`manual_confirmation` 与 `verification_spec.commands` 条件化

> **性质**：修订**建议稿**，不是规范。由规格 owner 逐条采纳后，另起 PR 改动各目标文件。本文件不改 `src/`、`tests/`，也不改任何规格正文。
> **基线**：`main` @ `37f71d031d3e95cb04ac4edcb87641bd84b17110`（本分支 `opus-draft/spec-revision-manual-commands` 自此建出）。
> **参考的草稿分支**：PR #3 的 `Task-J.1-J.2-J.3-J.4` @ `e7f57b4915095c61af90b8d73f149a253e8c2bd4`。下文中凡引用 `scope-plan.ts`、`scope-plan-builder.ts`、`server.ts` 签署链、`scheme-confirm-scope-drift.test.ts`、`open-items-2026-10-28.md` 的内容，都标「草稿分支」。这些文件在 main 上不存在。
> **引用纪律**：只写「文件 + 节号」或「文件 + 函数名」，不写行号。

## 0. 裁决编号

本稿用下列编号回指已批准的裁决：

| 编号 | 裁决内容 |
| :--- | :--- |
| R1 | 采用方案 C + D。`verification_spec` 增加可选字段 `manual_confirmation`，其值为 `{ reason_required: true, capture_evidence: ["actor","confirmed_at","reason"] }`。`commands.min(1)` 改为条件约束。`createContractDraft` 不再注入默认命令。`MANUAL_REVIEW` 与 `manual_confirmation` 是两套独立机制。 |
| R2 | 配套守卫写进验收条款，共四项：`executeWithSignal` 遇零命令不得判 PASSED；`deriveCanMerge` 与 `Merger` 增加人工确认输入；`buildProposalFromContract` 生成 `MANUAL_REVIEW` 节点；`manual_approved` 只能来自用户显式点击（依赖 N-1）。 |
| R3a | runtime §5.4 与 supervisor §4.5 的「须带可执行命令」增加 `manual_confirmation` 例外。 |
| R3b | 采纳方案 E：绿野项目走 L0 npm 验收，由 Worker 搭脚手架，`manual_only` 的适用范围收窄。修改 J.2 卡范围 4 与 S207b 夹具期望。S207c 的 `it.fails` 随落地解除。 |
| R3c | 架构 §6.4 D-5 的 `NONE` 自动点亮与 §3.2.2 对齐，不采用 D-5 原口径。 |
| R4 | 合同 schema 版本升为 `1.3.1`。 |
| R5 | J.5 卡依赖加 N-1 硬前置，验收补「manual_only → MANUAL_REVIEW 节点」。open-items 第 1 项描述更正为 MISMATCH 路径。 |

**复核结论**：下文写「复核」时，指上一轮方案分析里对代码路径的核实结论。具体为：
- 零命令时 `executeWithSignal` 的 `[].every(...)` 返回 `true`，状态判为 PASSED，`deriveCanMerge` 返回 `true`。
- S207b/c 的实际失败路径是 `createContractDraft` 回填 `npm test` 后，`contractScopeMismatch` 返回 `409 E_SCHEME_SNAPSHOT_MISMATCH`。
- 生产代码里 `createContractDraft` 的三个调用方都不会传入空 `commands`。

---

## 1. `src/lib/contract.schema.ts`：schema 层改写建议（文字描述，不含代码）

### 1.1 `verification_spec`

- **原文**：`softwareContractSchema` 中，`verification_spec` 为 `{ commands: z.array(verificationCommandSchema).min(1, "At least one verification command is required") }`。
- **新文本**：
  1. `verification_spec` 改为 `{ commands, manual_confirmation? }`。
     - `commands`：`verificationCommandSchema` 数组，长度下限 0。含义收窄为「Daemon 会真实执行的命令」。
     - `manual_confirmation`：可选对象，形如 `{ reason_required: true, capture_evidence: ["actor","confirmed_at","reason"] }`。
       - `reason_required` 取字面量 `true`。
       - `capture_evidence` 恰好由这三项组成，顺序不限，不得增删。
  2. `superRefine` 增加一条：`commands.length === 0` 时必须提供 `manual_confirmation`，否则报错 `"At least one verification command is required unless manual_confirmation is declared"`。这样「空命令加空确认」仍然被拒绝。
  3. `commands.length > 0` 时是否允许同时声明 `manual_confirmation`，**本稿不定**，见新增裁定项 N-③。
- **裁决依据**：R1（方案 C）。
- **影响说明**：
  - 存量合同都满足「至少一条命令」，读取时全部有效。
  - 这一改动放开了零命令合同。零命令合同的安全性**完全依赖**第 7 节的守卫，守卫必须与本条在同一个实现 PR 中落地。

### 1.2 `createContractDraft`

- **原文**：`createContractDraft` 在 `params.commands` 为空或缺省时，静默写入 `{ alias: "test", executable: "npm", args: ["test"], expected_exit_code: 0, timeout_seconds: 60 }`。代码里**没有**名为 `DEFAULT_VERIFICATION_COMMAND` 的常量，这一默认值是写在函数体里的字面量。
- **新文本**：
  - 删除这一回填，`params.commands` 原样写入。
  - 新增可选参数 `manualConfirmation`，原样写入 `verification_spec.manual_confirmation`。
  - `commands` 为空且未提供 `manualConfirmation` 时，交给 schema 拒绝，不再降级。
- **裁决依据**：R1（方案 D）。
- **影响说明**：
  - 按复核结论，生产调用方的行为不变。这三个调用方是：`src/routes/index.tsx` 中手工建卡表单的 `createContractDraft` 调用；`daemon/supervisor/draft-generator.ts`，其命令已由 `buildL0Plan` 填好；`daemon/supervisor/dispute/classification.ts`，它复制原合同的命令。
  - 草稿分支测试助手 `contractFromPlan` 的失败原因，会从 `E_SCHEME_SNAPSHOT_MISMATCH` 变为 schema 拒绝。等 C 落地后，两者都会消失。
  - `rules-l0.ts::buildL0Plan` 里的 `DEFAULT_DRAFT_COMMANDS` 不在本条范围内，见新增裁定项 N-④。

### 1.3 schema 版本 `1.3.1`

- **原文**：`SOFTWARE_CONTRACT_SCHEMA_VERSION = "1.3.0"`；`SUPPORTED_CONTRACT_SCHEMA_VERSIONS = [LEGACY_CONTRACT_SCHEMA_VERSION_V12, SOFTWARE_CONTRACT_SCHEMA_VERSION]`。文件底部的 `superRefine` 用 `contract.schema_version === SOFTWARE_CONTRACT_SCHEMA_VERSION` 来判断 `authorization.git` 各字段是否必填。
- **新文本**：
  1. 当前签发版本改为 `"1.3.1"`。新增 `LEGACY_CONTRACT_SCHEMA_VERSION_V130 = "1.3.0"`，加入支持白名单，保证存量 1.3.0 合同可以解析。
  2. `authorization.git` 必填判定改为「`schema_version` 属于 `{1.3.0, 1.3.1}`」。**不能沿用全等判断**：沿用的话，存量 1.3.0 合同会悄悄失去 Git 授权凭证必填的约束。
  3. `manual_confirmation` 只允许出现在 `1.3.1` 合同上。`1.3.0` 合同带有该字段时拒绝。这样审计时能从版本号看出合同是否可能走人工确认路径。
  4. 存量 `1.3.0` 合同**不强制改写**，读取时视为「`commands` 至少一条、没有人工确认」。`1.2.0` 合同仍由 `migration.ts::migrateContractToV13` 迁移。迁移后的目标版本是 1.3.0 还是 1.3.1，见新增裁定项 N-⑤。
- **裁决依据**：R4。
- **影响说明**：
  - 涉及代码：`migration.ts` 中的 `MigrationResultV13.to` 类型，以及 `migrateContractToV13` 里 `migrated["schema_version"] = SOFTWARE_CONTRACT_SCHEMA_VERSION` 这一句。
  - 涉及测试：`tests/unit/contract-schema-v13.test.ts`、`migration-v13.test.ts`、`contract-schema-v12.test.ts` 中断言 `"1.3.0"` 的用例。
  - 配套文档：`system-architecture.md` §9.1 标题「软件合同 Schema (v1.3.0)」和 §10.2 迁移指南需要同步。这两处不在本次覆盖清单内，只列出提示。

### 1.4 `MANUAL_REVIEW` 与 `manual_confirmation` 的边界

- **新文本**（建议写进 schema 注释，同时加进架构 §3.2.2 末尾，见 4.2 节）：
  - `MANUAL_REVIEW` 是**任务图节点**的类型（模式为 `MANUAL`）。它决定一个节点能否点亮，证据是节点级的 `manual_approved`。
  - `manual_confirmation` 是**合同级**的交付确认声明。它决定零命令合同能否得到可合并的裁决，证据是 `actor`、`confirmed_at`、`reason` 三项。
  - 两者**互不替代**：节点全部人工点亮，不能视为合同已完成人工确认；合同完成人工确认，也不能让任何节点点亮。
- **裁决依据**：R1（「两套独立机制」）。

---

## 2. `runtime-contract-and-safety.md` §5.4「验收断言与证据」

- **原文**（第 1 条）：「合同须带**可执行**验证命令（`shell:false` 的 argv）。绿野/主路径常用 `npm run typecheck` 与 `npm test`。」
- **新文本**：「合同须带**可执行**验证命令（`shell:false` 的 argv）。绿野/主路径常用 `npm run typecheck` 与 `npm test`；绿野项目由 Worker 搭脚手架后按此验收。**例外**：项目已有非 npm 的项目声明且没有任何可执行检查时，合同可以不带命令，但必须声明 `verification_spec.manual_confirmation`，交付前由用户填写理由完成人工确认（记录 `actor` / `confirmed_at` / `reason`）。零命令合同的执行结果不得判为 PASSED，`can_merge` 必须同时满足人工确认已记录。」
- **原文**（第 4 条）：「`can_merge` 只能由 Daemon 依据真实退出码派生（ADR-0005）。」
- **新文本**：**本稿不改写**，矛盾挂为新增裁定项 N-①。
- **裁决依据**：R3a、R3b、R2。
- **影响说明**：「空验证集不得点亮」（第 2 条）保持不变，与 4.1 节对齐。

## 3. `supervisor.md` §4.5「验收断言与证据」

- **原文**（第 1 条）：「合同须带可执行验证命令；绿野/主路径常用 **`npm run typecheck`** 与 **`npm test`**（时限由合同预算约束）。」
- **新文本**：「合同须带可执行验证命令；绿野/主路径常用 **`npm run typecheck`** 与 **`npm test`**（时限由合同预算约束；绿野由 Worker 搭脚手架后按此验收）。**例外**：非 npm 项目且没有任何可执行检查时，合同以 `verification_spec.manual_confirmation` 代替命令（见 `runtime-contract-and-safety.md` §5.4）。人工确认与节点的 `MANUAL_REVIEW` 点亮互不替代。」
- **裁决依据**：R3a、R3b、R1。
- **影响说明**：本节其余各条不变。§15.3、§15.4 与 R3b 存在冲突，本稿未改，挂为新增裁定项 N-②。

## 4. `system-architecture.md`

### 4.1 §6.4 D-5「无验证命令节点点亮死锁」

- **原文**（处置列）：「**支持 `verification_mode` 声明与零空集校验**：节点声明为 `MANUAL_REVIEW` 时，由用户在 UI 显式点击【确认此项】人工点亮；声明为 `COMMAND` 时严禁空命令集（若为空报错 `E_EMPTY_VERIFICATION_BLOCKED`）；声明为 `NONE` 时文件写入成功后自动点亮。杜绝因缺少命令或空集导致拓扑死锁或虚假点亮。」
- **新文本**：「**支持 `verification_mode` 声明与零空集校验**：节点为 `MANUAL_REVIEW` 时（代码中验证模式为 `MANUAL`），只能由用户在 UI 上显式点击【确认此项】人工点亮，`manual_approved` 不得由前端代填或系统推断；节点为 `COMMAND` 时严禁空命令集（为空即报 `E_EMPTY_VERIFICATION_BLOCKED`）。**不设 `NONE` 模式**：没有命令也没有人工确认的节点一律不点亮（与 §3.2.2 核心红线一致）。合同没有可执行命令时，由合同级 `verification_spec.manual_confirmation` 承接交付确认（与节点点亮相互独立）。」
- **裁决依据**：R3c、R2（第 4 项）、R1。
- **影响说明**：
  - 代码里本来就没有 `NONE`（见 `src/lib/graph/task-graph.ts::VERIFICATION_MODES`），这次是文档向代码收敛。
  - §9.4 的 `verification_mode: "COMMAND" | "MANUAL_REVIEW" | "NONE"` 需要同步，见新增裁定项 N-⑥。

### 4.2 §3.2.2「渐进点亮充要条件」

- **原文**（核心红线纪律）：「**严禁无证据或空验证集直接点亮！** 当 `verification_mode === "COMMAND"` 时，若绑定的 `commands` 集合为空……**绝对禁止**将节点置为 `ILLUMINATED`……」
- **新文本**：原文保留。在第 3 小节「人工复核与快速通道节点」末尾追加：
  > **合同零命令时的节点形态**：合同 `verification_spec.commands` 为空（已声明 `manual_confirmation`）时，Daemon 生成的施工节点一律为 `MANUAL_REVIEW`，不生成没有命令可绑的 `CODE_MODIFICATION` 节点。节点人工点亮只证明「用户看过这一步」，不构成合同交付确认；合同交付确认另由 `manual_confirmation` 记录。
- **裁决依据**：R3c、R2（第 3 项）、R1。
- **影响说明**：
  - 第 1 小节「代码修改型节点」的充要条件（命令集合非空且全绿）不变。
  - 零命令项目的施工步骤需要逐节点人工点亮，与 supervisor §16.4 的「自动推进」冲突，见新增裁定项 N-⑦。

## 5. `development-tasks.md`

### 5.1 TASK-J.5 卡

- **原文**（前置依赖）：「`TASK-J.3`、`TASK-J.4`」
- **新文本**：「`TASK-J.3`、`TASK-J.4`；**N-1（硬前置）**：核销路径的 `manual_approved` 只能来自用户显式点击，前端不得代填退出码或人工确认。未落地前，本卡生成的 `MANUAL_REVIEW` 节点会被自动点亮，构成假绿。」
- **原文**（验收 PASS）：现有三条（`T-ATOM-012`、`T-UI-011`～`013`、J.4 集成测试不回归）。
- **新文本**：在现有三条之后追加：
  - 「**manual_confirmation 角色与定位**：`manual_confirmation` 的角色从 "manual_only 默认路径" 改为 "自动化验证手段穷尽后的兜底路径"。点亮验证严格执行优先级链：“①项目类型检测 → ②生成该类型最先进的真实命令验证 → ③自动化手段穷尽证明后，才退回 manual_confirmation 人工确认”。」
  - 「**验收前提**：`manual_confirmation` 的验收前提必须为「穷尽自动化验证手段的证明」。」
  - 「**三处守卫条款（保留并注明兜底语义）**：
    1. `executeWithSignal` 遇零命令不得判 PASSED：属于自动化穷尽后的兜底阻断，证据 `verdict.status` 维持非 PASSED，`can_merge === false`，直至记录人工确认；
    2. `deriveCanMerge` / `Merger` 接人工确认：零命令合同在完成人工确认记录（`actor` / `confirmed_at` / `reason` 齐全）之后，才可能 `can_merge === true`，Merger 读取并核销人工确认留痕；
    3. `buildProposalFromContract` 生成 `MANUAL_REVIEW` 节点：`ScopePlan.verification.manual_only === true`（且具备自动化手段穷尽证明）时，组装出的合同 `verification_spec.commands` 为空且带 `manual_confirmation`；建图得到的全部施工节点为 `MANUAL_REVIEW`（验证模式 `MANUAL`），不出现占位别名 `verify`，承接兜底人工复核。」
  - 「核销请求中由调用方提供的 `manual_approved` 不能单独让节点点亮（与 N-1 的验收联动）。」
- **新文本**（FAIL 追加）：「零命令合同在没有人工确认记录时出现 `can_merge === true`；或未提供自动化手段穷尽证明即生成 `manual_confirmation` 兜底合同；或 manual_only 方案生成了带占位验证别名的 `CODE_MODIFICATION` 节点。」
- **裁决依据**：R5、R2。
- **影响说明**：
  - N-1 目前没有任务卡编号，§2.1 的 JSON 边清单无法登记这条硬前置，见新增裁定项 N-⑧。
  - J.4 卡的验收原文要求「老项目、绿野、非 npm 三类夹具……合同 `lifecycle_state` 到达批准后状态」，与 C 的落地时点有耦合，见 5.2 节。

### 5.2 TASK-J.2 卡范围 4 与 S207b 夹具

- **原文**（J.2 范围 4）：「`verification`：取仓库 `package.json` 实际存在的 `typecheck` / `test` 脚本生成命令；一个都没有 → `commands = []`、`manual_only = true`、白话「这个项目没有自动检查，完成后需要你试玩确认」。」
- **新文本**：「`verification`：
  ① **绿野**（与 `isGreenfieldRepo` 同口径：仓库根没有 `package.json`，**也没有其他项目声明**）→ 从 "manual_only" 改为「L0 类型检测验收合同」（Worker 按检测结果搭对应脚手架，绿野项目不再签 manual_only），生成对应真实命令验证（如 `npm run typecheck`、`npm test`），`manual_only = false`。
  ② **已知类型项目**（有项目特征文件，如 npm、Python、Rust、Go）→ 依据项目类型检测器与命令模板表生成对应最先进的真实验证命令；一个都没有时，需经自动化验证手段穷尽证明后，才退回 `commands = []`、`manual_only = true`。
  ③ **非 npm / 其他声明项目**（如 `pyproject.toml` 等）→ 优先匹配对应类型检测器与命令模板；仅在穷尽自动化手段证明后，才退回 `commands = []`、`manual_only = true`。
  `manual_only = true` 作为兜底路径时白话为「这个项目已穷尽自动检查手段，完成后需要你试玩确认」，合同带 `manual_confirmation`。」
- **原文**（J.2 验收）：「无 `typecheck` / `test` 脚本 → `manual_only === true`。」
- **新文本**：「绿野 → `manual_only === false` 且签发 L0 类型检测验收合同；已知类型项目生成对应类型真实命令；仅在穷尽自动化手段证明后 → `manual_only === true` 兜底。」
- **原文**（S207b，草稿分支 `tests/integration/scheme-confirm-scope-drift.test.ts`）：`it.fails("T-HTTP-S207b 绿野完整链（被挂账项 1 阻塞：commands=[] 过不了合同 schema）")`，断言 `expect(plan.verification.manual_only).toBe(true)`。
- **新文本**（夹具期望，供实现 PR 落实）：
  - **S207b**：期望从 manual_only 改为「L0 类型检测验收合同」，改为普通 `it`，断言 `manual_only === false`，`plan.verification.commands` 为 L0 类型检测生成的对应真实验证命令，完整链 preflight → freeze → create → approve 成功；`it.fails` 可解除（解除条款：类型检测器 + J.1–J.4 合入）。
  - **S207c（非 npm 绿野）**：保留 `it.fails`，解除条件改为「Python 类检测器落地，或 owner 确认该类型退回 manual_confirmation」。
- **裁决依据**：R3b。
- **影响说明**：
  - ②「npm 项目但没有脚本」仍判 manual_only，这是本稿对「收窄」的解读，见新增裁定项 N-②。
  - 「绿野」的判定口径从「没有 `package.json`」收紧为「没有任何项目声明」，是否需要同步修改 `isGreenfieldRepo` 与 runtime §4.1 的判据，见新增裁定项 N-⑨。

### 5.3 项目类型检测器与命令模板表设计约束（J.2 扩展）

- **核心设计约束**：新增「项目类型检测器 + 命令模板表」，检测表为可扩展的「特征文件 → 验证命令模板」映射，不是写死 npm 一条路径。
- **映射扩展规则**：每新增一类项目类型 = 新增一行映射。初始支持与扩展映射规范如下：
  - **npm**：特征文件 `package.json` → 命令模板 `npm test`（或 `npm run typecheck`）
  - **Python**：特征文件 `pyproject.toml` / `setup.py` / `requirements.txt` → 命令模板 `pytest` 或语法检查（`python -m py_compile` 等）
  - **Rust**：特征文件 `Cargo.toml` → 命令模板 `cargo test`
  - **Go**：特征文件 `go.mod` → 命令模板 `go test ./...`
- **优先级链执行纪律**：点亮验证严格执行优先级链：“①项目类型检测 → ②生成该类型最先进的真实命令验证 → ③自动化手段穷尽证明后，才退回 manual_confirmation 人工确认”。Worker 必须根据类型检测结果搭建对应脚手架并生成真实命令验证，杜绝在存在可用检测器时直接退回 manual_confirmation。

## 6. `open-items-2026-10-28.md` 第 1 项更正建议（草稿分支文件）

> 该文件只存在于草稿分支 `Task-J.1-J.2-J.3-J.4`，main 上没有。本分支不能触碰其他分支，因此这里只给出更正文本，由 PR #3 的维护方采纳。

### 6.1 open-items 第 1 项更正（老项目/蓝野与绿野授权条件）

- **原文**（事实第 3 点）：「因此这类方案直接建合同会被 schema 拒绝，与 SSOT §15.4「没有自动检查 → 施工步骤按 `MANUAL_REVIEW` 处理」的意图不一致。」
- **新文本**：「T-HTTP-S207b/c 的实际失败路径**不是** schema 拒绝。测试助手 `contractFromPlan` 先调 `createContractDraft`，后者把空 `commands` 静默回填为 `npm test`，所以合同能通过 schema。随后 `POST /api/contracts`（带 `confirmation_id`）在签署链比对时，合同命令与快照里的 `[]` 不一致，`contractScopeMismatch` 返回 **`409 E_SCHEME_SNAPSHOT_MISMATCH`（`field: verification_spec`）**。伪造的默认命令把 schema 冲突掩盖成了 MISMATCH。若绕开 `createContractDraft` 直接组装合同，才会出现 schema 拒绝（`At least one verification command is required`）。」
- **新文本**（建议决策点改写）：「已裁决：方案 C + D（见 `docs/drafts/spec-revision-manual-commands.md`）。S207b 依据 R3b 改为绿野 npm 验收（普通 `it`）；S207c 的 `it.fails` 随 C 与守卫落地解除。
  > **授权条件注明**：`manual_confirmation` 仅适用于穷尽自动化验证后仍无法机器验证的场景。」
- **裁决依据**：R5、复核结论。
- **影响说明**：实际报错码按代码路径推断，需要实机复跑确认（尚未执行）。

---

## 7. 守卫条款的实现落点清单（供后续实现 PR 引用，不含实现代码）

> **守卫核心总则**：点亮验证严格执行优先级链：“**①项目类型检测 → ②生成该类型最先进的真实命令验证 → ③自动化手段穷尽证明后，才退回 manual_confirmation 人工确认**”。`manual_confirmation` 的角色从 "manual_only 默认路径" 改为 "自动化验证手段穷尽后的兜底路径"。

| # | 守卫 | 落点（文件 + 函数名） | 改动点 | 对应验收 |
| :--- | :--- | :--- | :--- | :--- |
| G1 | 零命令不得判 PASSED（兜底语义） | `daemon/pipeline/orchestrator.ts::Orchestrator.executeWithSignal` | 计算 `allPassed` 的地方：`verificationResults` 为空时不能取 `every` 的空真值；零命令合同的状态改为「等待人工确认」（具体是 verdict 新状态还是 `BLOCKED` 加原因码，见新增裁定项 N-⑩），`nextState` 不能进入 `AUDITED`。`recordVerificationRoundFailure` 不对零命令合同计返工。注明兜底语义：仅在自动化验证手段穷尽后生效。 | J.5 追加验收第 2 条 |
| G2 | `can_merge` 增加人工确认输入（兜底语义） | `src/lib/evidence.schema.ts::deriveCanMerge`；同文件 `evidenceBundleSchema` 的 `superRefine` 不变式二 | `deriveCanMerge` 入参增加「合同是否声明 `manual_confirmation`」与「人工确认记录是否齐全（`actor` / `confirmed_at` / `reason`）」两项；声明了但未齐全时返回 `false`。Evidence 增加人工确认记录字段（可选）。注明兜底语义：仅在穷尽自动化手段证明后凭人工确认放行。 | J.5 追加验收第 2 条 |
| G3 | Merger 消费人工确认（兜底语义） | `daemon/pipeline/merger.ts`（合并门禁检查 `verdict.status` 与 `can_merge` 的段落）；审计 Trailer 模板 | 门禁读取 Evidence 的人工确认记录并校验与合同声明一致；合并提交 Trailer 与 `audit-manifest` 追加人工确认留痕（属于 L2 用户决定，不得标为机器证明）。注明兜底语义：承接人工确认放行。 | J.5 追加验收第 2 条 |
| G4 | 零命令合同生成 `MANUAL_REVIEW` 节点（兜底语义） | `src/lib/journey/proposal-from-contract.ts::buildProposalFromContract` | 合同 `commands` 为空且提供自动化手段穷尽证明时：节点 `kind = "MANUAL_REVIEW"`、`verification_mode = "MANUAL"`、`verification_commands = []`；删除占位别名 `["verify"]` 的回退。`daemon/graph/graph-engine.ts::sanitizeProposalNode` 的 `KIND_MODE_MATRIX` 已允许此组合，无需改。 | J.5 追加验收第 1 条 |
| G5 | `manual_approved` 只能来自用户显式点击（N-1） | `src/lib/graph/startable.ts::buildCommandResultsForVerify`；`src/routes/index.tsx::handleVerifyGraphNode`；`daemon/server.ts::handleTaskGraph`（verify 分支）；`daemon/graph/illumination-verifier.ts::evaluateIllumination` | 前端核销按钮不再代填 `manual_approved: true` 与各类退出码；人工点亮走独立的「确认此项」交互。Daemon 侧是否校验点击来源，属于 N-1 的方案选择（N-1 的 issue 草稿已并列选项 A 与 B）。 | J.5 追加验收第 3 条；N-1 |
| G6 | 合同组装带入 `manual_confirmation` | 草稿分支 `src/lib/journey/scope-plan.ts::scopePlanToContractScope`；草稿分支 `daemon/server.ts::contractScopeMismatch` | 经自动化验证手段穷尽证明后，`manual_only` 时输出 `manual_confirmation`；签署链比对时一并比较这个字段，避免快照与合同一边有、一边没有。 | J.5 追加验收第 1 条 |
| G7 | 绿野走 L0 类型检测验收合同 | 草稿分支 `daemon/supervisor/scope-plan-builder.ts::buildVerification` | 绿野（没有任何项目声明）时签发 L0 类型检测验收合同，Worker 按类型检测结果搭对应脚手架，生成对应真实命令验证，不再签 `manual_only`。 | J.2 修订验收；S207b |
| G8 | 点亮验证优先级链守卫 | `daemon/supervisor/scope-plan-builder.ts` 及项目类型检测器 | 严格执行优先级链：“①项目类型检测 → ②生成该类型最先进的真实命令验证 → ③自动化手段穷尽证明后，才退回 manual_confirmation 人工确认”，严禁绕过检测直接生成兜底合同。 | J.2 范围 4、J.5 验收 |

---

## 8. 裁定项归档与新增矛盾

### 8.1 第一版裁定项（N-① ~ N-⑩）归档（已裁决，不得重开）

> 规格 owner 已拍板全部裁定项，第一版 N-①～N-⑩ 全部标记为「已裁决」归档，保留编号与一句话结论备查，不得重开：

- **N-①（人工确认能否参与 `can_merge`）**：**【已裁决归档】** 人工确认作为穷尽自动化验证手段后的兜底证据接入 `deriveCanMerge` 与 `Merger`（需记录 `actor` / `confirmed_at` / `reason` 齐全），满足后方可派生 `can_merge === true`。
- **N-②（`manual_only` 收窄的边界：npm 项目没有脚本时怎么办）**：**【已裁决归档】** 引入项目类型检测器与命令模板表，绿野及支持类型走对应脚手架与真实命令验证，`manual_only` 仅在自动化验证手段穷尽证明后作为兜底。
- **N-③（命令与人工确认能否同时存在）**：**【已裁决归档】** 优先执行真实自动化命令验证，`manual_confirmation` 仅在零命令且自动化手段穷尽证明后作为兜底路径生效，二者不作为常规并存模式。
- **N-④（`buildL0Plan` 的默认命令是否在 D 的范围内）**：**【已裁决归档】** 纳入扩展类型检测器体系，按项目类型特征文件映射对应命令模板，不再统一强制注入 npm 默认命令。
- **N-⑤（`1.2.0` 合同迁移后的目标版本）**：**【已裁决归档】** 裁决原文（R4）：「schema 版本升 1.3.1（语义扩展便于迁移/审计识别新旧合同）」。迁移目标直接写为 `1.3.1`。
- **N-⑥（架构 §9.4 的枚举取值与代码不一致）**：**【已裁决归档】** 废弃 `NONE` 模式，枚举全面向代码实现（`COMMAND`、`MANUAL` 等）对齐。
- **N-⑦（人工点亮与自动推进冲突）**：**【已裁决归档】** N-⑦ 裁决本体：绿野及零命令项目默认走项目类型检测 + 自动生成真实命令（E 路径），不走批量人工确认；manual_confirmation 仅在自动化手段穷尽证明后作为兜底。（以下显式点击约束为兜底路径内的防伪造规则，保留原文。）裁决原文（R2 / R3c / §3.2.2）：「`manual_approved` 只能来自用户显式点击（依赖 N-1）」，「节点为 `MANUAL_REVIEW` 时（代码中验证模式为 `MANUAL`），只能由用户在 UI 上显式点击【确认此项】人工点亮，`manual_approved` 不得由前端代填或系统推断」。零命令兜底模式下所有施工步骤不以自动推进绕过显式人工确认。
- **N-⑧（N-1 没有任务卡编号）**：**【已裁决归档】** 确认作为 J.5 卡的硬前置依赖，补齐规范前置约束链。
- **N-⑨（「绿野」判据的口径）**：**【已裁决归档】** 绿野判据收紧为没有任何项目声明，配合 L0 类型检测器；非 npm 绿野按对应类型脚手架/检测器处理，不再签 manual_only。
- **N-⑩（零命令合同执行后的状态）**：**【已裁决归档】** `executeWithSignal` 遇零命令不判 PASSED，置为非 PASSED 的兜底阻断状态，直到补齐人工确认记录。

### 8.2 本次改写新发现的规格矛盾（待裁定项，不给倾向结论）

> 本节只列本次改写中新发现的规格矛盾。每条原样引用两处冲突原文（引用格式为「文件 + 函数名/节号」，不写绝对行号），需运行时证据的标「需实机证据」，不给倾向结论。

**新矛盾 1：类型检测器多语言扩展与既有绿野判据硬编码 `package.json` 的冲突**
- **对应裁决/守卫编号**：裁决 R3b；守卫 G7、G8；对应归档项 N-⑨（涉及 §5.2、§5.3）
- `docs/specs/runtime-contract-and-safety.md` §4.1「通配符分级（判据钉死）」原文：「判据是「**仓库里有没有项目声明**」——`package.json` 缺失即绿野，与 `daemon/supervisor/rules-l0.ts::isGreenfieldRepo` 同一口径」。
- `daemon/supervisor/rules-l0.ts::isGreenfieldRepo`（需实机证据）原文：「`return !fs.existsSync(path.join(repoRoot, "package.json"));`」。
- 冲突事实说明：新增设计约束要求类型检测器支持 Python (`pyproject.toml`)、Rust (`Cargo.toml`)、Go (`go.mod`) 等特征文件；而既有规范与代码判据将缺失 `package.json` 硬编码等同于绿野，导致带 `pyproject.toml` 等声明的非 npm 项目在无 `package.json` 时会被误判为绿野，进而错误触发绿野脚手架逻辑。

**新矛盾 2：零命令人工确认兜底参与合并与 ADR-0005 纯退出码门禁的冲突**
- **对应裁决/守卫编号**：裁决 R2；守卫 G2、G3；对应归档项 N-①（涉及 §5.1、§7 G2/G3）
- `docs/adr/0005-deterministic-verification-gate.md` §决策 1 原文：「`can_merge` 与任何验收结论只能由 Daemon 依据真实进程退出码派生。模型对 `can_merge` 无任何设定权；Worker 自报的通过/失败仅作为索引用途，结论必须由独立校验器重算。」
- `docs/specs/runtime-contract-and-safety.md` §5.4 及本次修订 G2 守卫条款原文：「`deriveCanMerge` 入参增加「合同是否声明 `manual_confirmation`」与「人工确认记录是否齐全（`actor` / `confirmed_at` / `reason`）」两项；声明了但未齐全时返回 `false`……记录人工确认之后，才可能 `can_merge === true`。」
- 冲突事实说明：ADR-0005 明确红线约束 `can_merge` 只能由真实退出码派生，而 `manual_confirmation` 兜底路径引入了用户人工确认记录作为 `can_merge` 放行的必要输入，二者在门禁判据的唯一物理来源定义上存在冲突。

**新矛盾 3：`executeWithSignal` 空命令集默认放行与零命令禁止判 PASSED 守卫的冲突**
- **对应裁决/守卫编号**：裁决 R2；守卫 G1；对应归档项 N-⑩（涉及 §5.1、§7 G1）
- `daemon/pipeline/orchestrator.ts::Orchestrator.executeWithSignal`（需实机证据）计算 `allPassed` 原文：「`const allPassed = verificationResults.every((r) => r.exit_code === 0);`」。
- `docs/specs/runtime-contract-and-safety.md` §5.4 及本次修订 G1 守卫条款原文：「严禁无证据或空验证集直接点亮；零命令合同的执行结果不得判为 PASSED……`verificationResults` 为空时不能取 `every` 的空真值；零命令合同的状态改为「等待人工确认」……`nextState` 不能进入 `AUDITED`。」
- 冲突事实说明：在 JavaScript 运行时中空数组的 `.every()` 恒返回 `true`，导致零命令合同在实际执行时直接判为 `allPassed = true` 并流转至成功状态，与规范中严格禁止空验证集或零命令判定 PASSED 的安全守卫直接冲突。

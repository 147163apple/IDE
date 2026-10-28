# 挂账项登记（2026-10-28）

> 本文件只做**记录**：不修改任何规格文档、不改 schema、不改已交付实现。
> 每项标明触发任务、事实、影响与建议决策时点。

## 1. `manual_only` 与合同 schema 的 `verification_spec.commands` 最小长度冲突

- **触发任务**：TASK-J.2（`scopePlanToContractScope`）/ 待 TASK-J.5 决策。
- **事实**：
  - `ScopePlan.verification.manual_only === true` 时（项目 `package.json` 里没有 `typecheck` / `test` 脚本），J.2 的 `scopePlanToContractScope` 原样返回 `verification_spec.commands = []`。
  - 合同 schema（`src/lib/contract.schema.ts`）要求 `verification_spec.commands` **至少一条**（`min(1, "At least one verification command is required")`）。
  - 因此这类方案直接建合同会被 schema 拒绝，与 SSOT §15.4「没有自动检查 → 施工步骤按 `MANUAL_REVIEW` 处理」的意图不一致。
- **本轮处理**：**不改 schema、不改 `scope-plan` 输出**；仅在 J.5 接线前登记。
- **建议决策点**：TASK-J.5 决定采用哪条路径（例如：schema 允许 `commands: []` 且以 `manual_only`/`MANUAL_REVIEW` 表达；或 J.5 生成一条显式的人工验收占位命令）。两条路径都需同步更新 J.2/J.5 的验收断言。
- **修复条款（挂账修复时必须执行）**：解除 `tests/integration/scheme-confirm-scope-drift.test.ts` 中 T-HTTP-S207b/c 的 `it.fails`，否则挂账修复后测试反红。

## 2. `E_SCOPE_INVARIANT_BROKEN` 未登记进规格文档

- **触发任务**：TASK-J.4 第 4 条（签署链跳过 `assertContractScopeAllowed` 前的 D1 不变量断言）。
- **事实**：TASK-J.4 卡片要求「失败则记告警并返回 `500 E_SCOPE_INVARIANT_BROKEN`」，且若新增该码须同步补进 `runtime-contract-and-safety.md` §2.3 与 SSOT §15.5。
- **本轮处理**：按本轮约束**不修改规格文档**；代码返回 500 时会带该 code 与告警日志，但文档登记**待补**。
- **建议决策点**：下一次允许改规格文档时，把该码补进 §2.3「Daemon 专属码」表与 SSOT §15.5；或改为复用既有内部错误码。

## 3. Claude CLI 运行时版本检查

- **触发任务**：TASK-J.1（收尾要求明确列为挂账）。
- **事实**：真实 CLI 验证基于 `claude --version = 2.1.296 (Claude Code)`；适配器目前不校验运行时 CLI 版本，也不在启动时拒绝过旧/过新的 CLI。
- **本轮处理**：**不实现**运行时版本检查，只在验证报告中登记版本输出。
- **建议决策点**：单开卡片决定「最低/最高支持版本 + 不匹配时的降级或拒绝策略」，避免在 J.1 中扩大范围。

## 4. Windows 单元测试失败（挂账，非阻断）

- **触发任务**：所有在 Windows runner 上跑单元测试的变更。CI 中 `windows-latest` 为 `continue-on-error`，不阻断合并。
- **事实**：
  - 运行 `40638941385`（PR #5 head `6159b634`）：44 个失败，分布在 20 个文件。
  - 运行 `40640283813`（main `37f71d03`，仅 README 文档改动）：45 个失败，分布在 20 个文件。README 不涉及测试代码。
  - 两次共同失败 37 项；只在一次运行失败的 15 项（8 + 7）。
  - 共同失败覆盖的模块较杂：cli-host（7）、supervisor-draft-api（4）、migration-v113（3）、contract-api（3）、ws-auth-handshake（3）、merger（2）、recent-projects-api（2）、repo-delete-api（2）、ws-security（2）及若干单项文件。其中既有 spawn、符号链接、权限位、撤销、备份等系统行为，也有 HTTP 层 401/400/409/402 断言，并非全部是系统级平台差异。
  - 仅一次失败的 15 项中，11 项属于 WebSocket/鉴权/Origin/端口族（`ws-auth`、`ws-security`、`ipc-stream`），另 4 项为 `resume-abort`、`recent-projects` C.8c、`worktree-files`、`supervisor` 非 POST 405。
- **分层登记**：
  - **稳定层**：两次运行都失败的 37 项，按模块逐一修复平台适配问题。目前只有两次运行数据，分层是暂定的，需下次运行复核。
  - **抖动层**：只在一次运行失败的 15 项，标注为非确定性，每次失败子集不固定。假设（未验证）是测试的端口分配（如 3001~3010 窗口并发抢占）与握手超时时长，而非被测逻辑。不逐条追，宜在测试基础设施层统一处理。
  - **观察项**：`resume-abort.test.ts` 的“abort：待审批合同被驳回”。若下次运行复现且与 abort/审批竞争窗口相关，归稳定层；若不复现，归抖动层。
- **验收口径（Windows 修复 PR）**：稳定层清零；抖动层收敛为固定小集或清零。不以“Windows 全绿”为唯一目标。
- **观测指标**：每次 CI 记录共同失败集与抖动集的数量与比例。抖动集突然扩大或出现新模块，视为警示信号。
- **建议决策点**：由 Windows 适配卡决定稳定层修复顺序，以及抖动层的测试基础设施改造。

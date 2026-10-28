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

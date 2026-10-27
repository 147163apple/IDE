# ADR-0012: `MERGED` 为唯一运行时交付终态（不设独立 `DELIVERED` 枚举）

> **状态**: ACCEPTED
> **决策日期**: 2026-10-27（Asia/Hong_Kong）
> **立卡**: `TASK-H.2`（v0.1 硬化方案 B），实现合入 commit `d960263`
> **SUPERSEDES**: Spec Freeze §2.1 与 DocGov §3.1 中的 `MERGED → DELIVERED` 一段
> **相关**: ADR-0005（门禁）、ADR-0011（审计侧车）、[`../reports/v0.1-hardening-closure.md`](../reports/v0.1-hardening-closure.md) §3

## 背景

规范体系早期为交付主生命周期设计了一条完整终态链：

```
… → CANDIDATE_VERIFIED → MERGED → DELIVERED
```

其中 `DELIVERED` 的语义是「脱敏归档成功」。但实现侧从未建立这个枚举：合并成功后运行时即停在 `MERGED`，归档（写入 `.stagent/records/{contract_id}/` + audit-manifest）是合并后的一个附加动作，成功与否都不再改变主状态。

这造成了 **规范与代码长期不一致**：文档写三态，代码只有两态；v0.1 主路径里程碑纪要 §4 已把「无单独 `DELIVERED` 运行时枚举」列为第 1 号已知缝。

## 决策

**采用方案 B：`MERGED` 即对外主归档终态，不为 `DELIVERED` 建立独立运行时枚举。**

三条配套口径：

1. **合并成功即视为交付成功路径**。前端 / 状态投影统一以「已交付归档」话术挂在 `MERGED` 上，**不得伪标**一个代码里不存在的状态。
2. **脱敏归档失败的处理是「停 `MERGED` + 如实标记」，不是回退**。若 `records/` 归档或 audit-manifest 写入失败（例如缺 `audit-manifest.json`），系统**停**在 `MERGED` 并如实记录归档未完成，**严禁**伪造完结、也**严禁**把已合并的轮次回退。
3. **保留三段语义，但不保留第三个枚举**：`CANDIDATE_VERIFIED`（合并前候选核验）→ `MERGED`（已合并）→ 归档成功（一个布尔/标记，不是状态）。

## 后果

**正面**：规范与代码对齐；对外话术不再承诺一个不存在的状态；`TASK-H.2` 的收官口径（Tag `v0.1.0`）得以成立。

**代价与约束**：
- **必须回写的存量文档**：Spec Freeze §2.1 的状态链、DocGov §3.1 的旧名→新名表与 §4.2 的 `VERIFIED → ARCHIVED` 门槛、Supervisor E2E Workflow §1.1 映射表。这些文件已整体归档，本 ADR 在其头部登记失效条款。
- 未来若确需区分「已合并」与「已归档」，正确做法是**新增状态并单独立卡**，不得悄悄复活 `DELIVERED` 一词。

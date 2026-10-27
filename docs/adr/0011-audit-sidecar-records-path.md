# ADR-0011: 无 Git 审计侧车统一落点 `.stagent/records/{contract_id}/audit-manifest.json`

> **状态**: ACCEPTED
> **决策日期**: 2026-10-27（Asia/Hong_Kong）
> **SUPERSEDES**: Top7 §7 建议路径 `.stagent/metadata/audit-manifest.json`
> **代码证据**: `daemon/guard/audit-manifest.ts:10` → `RECORDS_ROOT = ".stagent/records"`
> **相关**: ADR-0006（非防篡改）、ADR-0005（Evidence 绑定）
> **权威正文**: [`../specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md) §6

## 背景

当项目不是一个 Git 仓库时，系统失去了两类东西：**Git Commit SHA** 和 **Git Trailer 审计追溯标记**。早期处理方式是给审计数据找一个「附加快照目录」。

2026-10-25 的 Top7 拍板把它写成了 `.stagent/metadata/audit-manifest.json`；同一时期 DocGov §10.4 与 Spec Freeze §2.4、Supervisor SSOT §4.5 却一致写成了 `.stagent/records/{contract_id}/audit-manifest.json`。**同一个交付物存在两个权威路径**，且 DocGov §10.4 已明文写着「废止旧建议路径 `.stagent/metadata/`」。

这属于典型的规范漂移：两份文档各自誊抄，谁也没回写谁。

## 决策

**唯一权威落点：`.stagent/records/{contract_id}/audit-manifest.json`。**

1. 按合同维度分目录，与 `.stagent/records/{contract_id}/` 下已有的 Demo 轻量拷贝、摘要共同构成一轮交付的完整审计包；
2. **`.stagent/metadata/` 自本 ADR 起废止**，任何新代码不得写入该路径；
3. **必须先过脱敏管道再落盘**：记录相关文件 SHA-256 与合同 Hash，永久保留的是**脱敏后的完整记录**，不是明文原声；
4. 它是独立于 Git Trailer 的**对等降级审计链**，不是 Trailer 的替代品：有 Git 时二者并存，无 Git 时它单独承载完整性。

## 裁定依据（为什么可以机械裁定，无需人工选择）

代码事实明确且唯一：`daemon/guard/audit-manifest.ts:10` 导出 `RECORDS_ROOT = ".stagent/records"`，并被 `daemon/pipeline/records-archive.ts` 实际引用。同时 DocGov §10.4 留有显式的文档级废止证据。**代码与多数文档一致，且存在显式废止声明**，因此本条不属于争议项。

## 后果

**正面**：消灭双路径；位置与 `.stagent/records/` 的其余归档内容同构，`TASK-H.8`（records 脱敏 zip 导出 + 单项目清理）可统一处理。

**代价与约束**：
- Top7 曾整体归档为 `../archive/engineering-decisions-top7.md`（该归档文件已于 2026-10-27 移除，原文见 Git 历史），其 §7 条文须标注被本 ADR 取代（见该文件头部的「条文失效登记」表）；
- 既有审计报告若引用旧路径，属历史记录，不做迁移，但不得作为新实现的依据。

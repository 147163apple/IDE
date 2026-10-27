# ADR-0010: Demo 降为体验增强项，允许跳过 Demo 直签合同

> **状态**: ACCEPTED
> **决策日期**: 2026-10-27（Asia/Hong_Kong）
> **立卡**: `TASK-C.21` / `DOC-SSOT-Supervisor-Patch`（Tina t910u「补丁」）
> **SUPERSEDES**: 核心资产治理 §二.3-2 硬门禁「合同已签、Demo 未确认 → 禁写真实代码」；DocGov §3.1「`PLAN_CONFIRMED` 后才进 Demo，单向 DAG 不可跳步」；Supervisor E2E Workflow §1.1 同款表述
> **同时澄清**: EO-06「未确认 Demo 禁止签署」在**新体验主链**上的硬卡解读就此作废
> **落地**: [`../specs/supervisor.md`](../specs/supervisor.md) §4.6 / §5.2；[`../specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md)

## 背景

v0.1 早期（Studio 五视口 + C.11 五步体感）把 Demo 设计成**所有任务的开工硬前置**：必须先生成静态原型、用户点了「确认 Demo」，才允许签署合同、开工写真实代码。对应条文包括核心资产治理的阻断硬门禁 #2 与 DocGov 的 DAG 不可跳步。

`TASK-C.18`（方案工作台单页）之后产品主链发生变化：右栏自由对话 + 中栏单一方案审阅页 + 底部唯一「确认方案」按钮。这条新主链下 Demo 硬前置暴露出三类问题：

1. **无 UI 诉求的任务被无用门禁卡住**。纯逻辑重构、脚本改写、配置类任务本就没有可试玩界面，却必须先「生成一个 Demo」。
2. **教会了用户错误心智**。用户会以为「没让我试玩 = 还不能开工」，而实际上静态方案（架构图 / 流程图 / 决议区）已经足够对齐意图。
3. **与 EO-06 的原意脱节**。EO-06 是为了防「未感官对齐就写真代码」，但在新主链里它被误读成「没 Demo 就不许签」，把保护性条文变成了阻断性条文。

## 决策

1. **Demo 是体验增强项，不是开工硬前置。** 状态机必须显式存在 `PLAN_CONFIRMED → CONTRACT_SIGNED` 这条边：`demo.status === "none"` 时**放行直签**；该边只由唯一谓词 `evaluateSchemeConfirmation` 守卫。
2. **已生成则必须确认。** 一旦用户点过「生成 Demo」且原型已产出，签署前仍需用户显式确认该 Demo，或显式选择「接受仅用流程图说明开工（标风险）」降级路径。缺失确认 → `E_DEMO_NOT_CONFIRMED`。
3. **保留老链路。** `PLAN_CONFIRMED → DEMO_READY → CONTRACT_SIGNED` 继续合法，**不做删除**——它是「有 UI 的项目」的自然路径。
4. **禁止两种极端**：① `PLAN_READY → CONTRACT_SIGNED`（跳级）必须拒绝；② 在用户**从未生成** Demo 时以「Demo 未确认」为由拒签，同样必须拒绝。

## 后果

**正面**：
- 无 UI 类任务不再被无关门禁卡住，「确认方案」真正成为唯一的终态按钮；
- 与代码实现完全一致——`evaluateSchemeConfirmation`（`src/lib/journey/scheme-draft.ts`）、`DELIVERY_TRANSITIONS.PLAN_CONFIRMED`（`src/lib/state/delivery-state.ts`）、`evaluateSnapshotDemoGate`（`daemon/supervisor/demo/signing-gate.ts`）在本次裁决前**已按此口径实现**。本 ADR 是把代码事实升格为规范，而非引入新行为。

**代价与约束**：
- **必须回写的存量文档**（否则会长期作为僵尸条文误导）：核心资产治理 §二.3-2、DocGov §3.1、Supervisor E2E Workflow §1.1。这三条已在本 ADR 头部列为 SUPERSEDED。
- `canConfirmScheme` 成为唯一谓词（详见 `supervisor.md` §7 D1）；任何第二套判断——包括「UI 根据自己的状态推导 disabled」——均视为缺陷。
- **CLOSED ≠ 已实现**：本 ADR 记录的是已生效的产品/工程口径，具体条款是否落地仍以 task 卡与测试为准。

# docs/reports · 阅读顺序与索引

> 更新日期：2026-10-26（Asia/Hong_Kong）  
> **Spec Freeze 锚点**：[`Stagent_Spec_Freeze_Record_2026-10-26.md`](./Stagent_Spec_Freeze_Record_2026-10-26.md) — 规范资产封版记录（CLOSED 五份+右栏索引；CLOSED≠已实现；未升格立卡）  
> 本目录是设计说明、对账与讨论稿的落点；**造 Stagent 的施工权威**仍是仓库根 `docs/` 下的《架构规范》《任务规范》。  
> **讨论稿 ≠ 施工依据**；写代码只认任务卡 + 合同说明 §7.5 钉桩。

## 推荐阅读顺序（决策 / Supervisor 相关）

0. [`Stagent_Spec_Freeze_Record_2026-10-26.md`](./Stagent_Spec_Freeze_Record_2026-10-26.md) — **Spec Freeze 封版记录**（唯一事实源锚点；CLOSED≠已实现）
1. [`合同设计说明-2026-10-25.md`](./合同设计说明-2026-10-25.md) — 护照 vs 宪法、导言三锤、§7.3–§7.5  
2. [`Supervisor运转机制-2026-10-25.md`](./Supervisor运转机制-2026-10-25.md) — 定稿：四机制 + 五阶段 + 收紧  
3. [`核心资产治理-追溯与变更判定-2026-10-25.md`](./核心资产治理-追溯与变更判定-2026-10-25.md) — 六类资产生命周期、追溯硬门禁、轻量变更判定  
4. [`工程决策拍板-Top7-2026-10-25.md`](./工程决策拍板-Top7-2026-10-25.md) — Demo/Token/越界/澄清轮次/拒约回退/重连/无Git 七条硬标准（讨论稿未整份升格）  
4b. [`BRIEF-C11-Supervisor五步-起床验收.md`](./BRIEF-C11-Supervisor五步-起床验收.md) — C.11a–e 过夜合入后如何打开前端验收  
4c. [`Supervisor右栏对话行为-设计-2026-10-26.md`](./Supervisor右栏对话行为-设计-2026-10-26.md) — 右栏对话时 Supervisor 做什么（**仍讨论稿**；**§0 语义折叠**；**§8～§13 产品 CLOSED**；**产品 DEC-01～06 / 四补钉 CLOSED**；**工程 EO-01～10 CLOSED** + **§14.3↔§14.11 交叉核对加固**；CLOSED ≠ 已实现；未升格、未立卡）
5. [`任务图谱-设计说明-2026-10-24.md`](./任务图谱-设计说明-2026-10-24.md) — 全景 / 施工双视角  
6. [`决策记录对账-2026-10-25.md`](./决策记录对账-2026-10-25.md) — 15 项矩阵校正、入库状态、缺口  
7. 三份讨论稿（已入库、未升格）：
   - [`Stagent_Clarification_and_Authorization_Specification_v1.0.md`](./Stagent_Clarification_and_Authorization_Specification_v1.0.md) — Top7 + 右栏 DEC·EO + **API Top5 CLOSED**；§5 待决议已核销；**仍讨论稿未升格**
   - [`Stagent_Documentation_Governance_Lifecycle_Chapter_v1.0.md`](./Stagent_Documentation_Governance_Lifecycle_Chapter_v1.0.md) — **DocumentAssetStatus** 与 EO-01 交付主态**分轨**（§3.1）；**仍讨论稿未升格**
   - [`Stagent_Interface_Contract_Checklist_v1.0.md`](./Stagent_Interface_Contract_Checklist_v1.0.md) — **API Top5 CLOSED**（§3）；**仍讨论稿未升格**
8. 骨架附件（以定稿为准）：[`Stagent_Supervisor_End_to_End_Workflow_v1.0.md`](./Stagent_Supervisor_End_to_End_Workflow_v1.0.md) — 五阶段 ↔ EO-01 映射（§1.1）；越界/沙盒交叉 EO-02/07

## 仍缺（指导写码前）

Top7 已拍板；C.11a–e 过夜已合（见 BRIEF-C11）。**五份规范+右栏 Spec Freeze**（见封版记录）；Impact/Mode/AST = v0.2+；讨论稿仍未整份升格、未立卡。

## 目录精简（2026-10-25）

已删除 32 份过期单卡交付说明、phase-checklist、走查/复审/一致性报告等；本目录仅保留决策与设计相关重要文档。施工验收仍以《任务规范》与 git 历史为准，不以已删报告为准。

## 正式规范（不在本目录）

- `docs/Stagent_System_Architecture_Specification_v1.6.1.md`
- `docs/Stagent_v0.1_Development_Tasks_Specification_v1.6.2.md`
- `docs/Stagent_v0.2_Architecture_Evolution_RFC.md`

**仓库中不存在**《产品体验与技术底座设计规范 v1.1》。

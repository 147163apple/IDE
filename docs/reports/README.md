# docs/reports · 阅读顺序与索引

> 更新日期：2026-10-26（Asia/Hong_Kong）· 同日 D 类过程件归档至 `docs/archive/`  
> **Spec Freeze 锚点**：[`Stagent_Spec_Freeze_Record_2026-10-26.md`](./Stagent_Spec_Freeze_Record_2026-10-26.md) — 规范资产封版记录（CLOSED 五份+右栏索引；CLOSED≠免体验；**C.12a–e / C.14a–c 已 COMPLETED**；基线见封版 §7，不并入五正文）  
> 本目录是设计说明、对账与讨论稿的落点；**造 Stagent 的施工权威**仍是仓库根 `docs/` 下的《架构规范》《任务规范》。  
> **讨论稿 ≠ 施工依据**；写代码只认任务卡 + 合同说明 §7.5 钉桩。

## 推荐阅读顺序（决策 / Supervisor 相关）

0. [`Stagent_Spec_Freeze_Record_2026-10-26.md`](./Stagent_Spec_Freeze_Record_2026-10-26.md) — **Spec Freeze 封版记录**（唯一事实源锚点；CLOSED≠免体验；§6 → C.12；**§7 → 基线 C.14a–c**，不并入五正文）
1. [`合同设计说明-2026-10-25.md`](./合同设计说明-2026-10-25.md) — 护照 vs 宪法、导言三锤、§7.3–§7.5  
2. [`Supervisor运转机制-2026-10-25.md`](./Supervisor运转机制-2026-10-25.md) — 定稿：四机制 + 五阶段 + 收紧  
3. [`核心资产治理-追溯与变更判定-2026-10-25.md`](./核心资产治理-追溯与变更判定-2026-10-25.md) — 六类资产生命周期、追溯硬门禁、轻量变更判定  
4. [`工程决策拍板-Top7-2026-10-25.md`](./工程决策拍板-Top7-2026-10-25.md) — Demo/Token/越界/澄清轮次/拒约回退/重连/无Git 七条硬标准（讨论稿未整份升格）  
4b. [`Supervisor右栏对话行为-设计-2026-10-26.md`](./Supervisor右栏对话行为-设计-2026-10-26.md) — 右栏对话时 Supervisor 做什么（**Spec Freeze 五正文之一**；**§0 语义折叠**；**§8～§13 产品 CLOSED**；**产品 DEC-01～06 / 四补钉 CLOSED**；**工程 EO-01～10 CLOSED**；CLOSED ≠ 免体验；Top5 Delta → **C.12a–e COMPLETED**）
5. [`任务图谱-设计说明-2026-10-24.md`](./任务图谱-设计说明-2026-10-24.md) — 全景 / 施工双视角  
6. ~~决策记录对账~~ → 已归档 [`../archive/决策记录对账-2026-10-25.md`](../archive/决策记录对账-2026-10-25.md)（过程件，非现行权威）  
7. 三份讨论稿（已入库、未升格）：
   - [`Stagent_Clarification_and_Authorization_Specification_v1.0.md`](./Stagent_Clarification_and_Authorization_Specification_v1.0.md) — Top7 + 右栏 DEC·EO + **API Top5 CLOSED**；§5 待决议已核销；Top5→**C.12a–e** 已立卡（正文仍讨论稿）
   - [`Stagent_Documentation_Governance_Lifecycle_Chapter_v1.0.md`](./Stagent_Documentation_Governance_Lifecycle_Chapter_v1.0.md) — **DocumentAssetStatus** 与 EO-01 交付主态**分轨**（§3.1）；**仍讨论稿未升格**
   - [`Stagent_Interface_Contract_Checklist_v1.0.md`](./Stagent_Interface_Contract_Checklist_v1.0.md) — **API Top5 CLOSED**（§3）；Top5→**C.12a–e** 已立卡（正文仍讨论稿）
   - [`已有项目接管-基线档案体验设计讨论稿-2026-10-26.md`](./已有项目接管-基线档案体验设计讨论稿-2026-10-26.md) — 项目现状基线档案（Tina 三题定案+工程补丁+升格备忘；**讨论稿正文仍不整份并入 Freeze**；确认≠授权；双图谱分离；**`TASK-C.14a`–`c` COMPLETED**，见封版 §7）
8. 骨架附件（以定稿为准）：[`Stagent_Supervisor_End_to_End_Workflow_v1.0.md`](./Stagent_Supervisor_End_to_End_Workflow_v1.0.md) — 五阶段 ↔ EO-01 映射（§1.1）；越界/沙盒交叉 EO-02/07

## 仍缺（指导写码前）

Top7 已拍板；C.11a–e / C.12a–e / C.14a–c 均已 COMPLETED（见封版 §6–§7、任务规范；C.11 起床 BRIEF 已归档）。**五份规范+右栏 Spec Freeze**（见封版记录；**不**把基线讨论稿并入五正文）。Impact/Mode/AST = v0.2+；下一项待 Tina 点名。

## 目录精简（2026-10-25）

已删除 32 份过期单卡交付说明、phase-checklist、走查/复审/一致性报告等；本目录仅保留决策与设计相关重要文档。施工验收仍以《任务规范》与 git 历史为准，不以已删报告为准。

## 已归档过程件（勿当现行权威）

见 [`docs/archive/README.md`](../archive/README.md)。本轮移入：决策记录对账、BRIEF-C11、P1 验收核查清单、W3 待办、W5a isolation-design。

## 正式规范（不在本目录）

- `docs/Stagent_System_Architecture_Specification_v1.6.1.md`
- `docs/Stagent_v0.1_Development_Tasks_Specification_v1.6.2.md`
- `docs/Stagent_v0.2_Architecture_Evolution_RFC.md`

**仓库中不存在**《产品体验与技术底座设计规范 v1.1》。

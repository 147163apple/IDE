# docs/archive · 过程稿与历史归档

> **更新日期**：2026-10-27（Asia/Hong_Kong）· 文档治理重组
> **本目录不是施工权威。** 文件均为 **SUPERSEDED / 过程件**：曾用于对账、验收、缺口登记或阶段性设计，已被现行规范吸收或取代。
> **勿硬删**（保留 git 历史与可追溯引用）；**勿当作**现行规范或任务卡 Scope。
>
> **现行权威**：[`../specs/`](../specs/)（四件套）+ [`../adr/`](../adr/)（13 篇 ADR）。地图见 [`../README.md`](../README.md)。

---

## 归档清单

| 文件 | 主题 | 为何归档 | 是否含现行规范未收录的独特细节 |
| :--- | :--- | :--- | :--- |
| [`engineering-decisions-top7.md`](./engineering-decisions-top7.md) | Top7 硬标准拍板 | §4 澄清 ≤2 轮**已作废**（D-3）；§7 audit 路径**已废止**（ADR-0011）；其余已被吸收 | ✅ §5 拒约回退保留 Demo、「最多 2 下交互」承诺 |
| [`core-asset-governance-and-change-triage.md`](./core-asset-governance-and-change-triage.md) | 六类资产生命周期、阻断硬门禁、变更六档判定 | Demo 硬前置条文已推翻（ADR-0010） | ✅ **阻断哈希只锁可观测行为字段**；**变更六档矩阵（轻改/重签/重签验/重签权/新轮次/返工）** |
| [`contract-passport-design.md`](./contract-passport-design.md) | 宪法 vs 施工护照、双状态机、五屏交互 | §7.5 对账基于旧 tip，未回写 | ✅ **§7.3.5 Impact Analysis 五步流水线 + 四大红线 + AC-01~05**（v0.2 唯一依据） |
| [`task-graph-and-panorama-design.md`](./task-graph-and-panorama-design.md) | 四透视卡、双视角、防假绿、全景 vs 施工 | v0.1 全景口径部分被 C.10q 追上 | ✅ §9.1 四透视卡定义；§9.4 五组名称消歧义；节点七态白话 |
| [`open-project-vision-and-status.md`](./open-project-vision-and-status.md) | 打开项目 D.1/D.1b/D.1c/D.1d 分层与安全不变式 | D.1d 已 COMPLETED | ✅ 三层「是/不是」辨析表 |
| [`baseline-archive-onboarding-design.md`](./baseline-archive-onboarding-design.md) | 项目现状基线档案、双图谱分离、确认≠授权 | C.14a–e 已 COMPLETED | ✅ **五类材料可靠反推范围 vs 盲区**；**provenance 六态白话标签**；附录 C.14e 平台沙盒实情表 |
| [`document-asset-governance-chapter.md`](./document-asset-governance-chapter.md) | `DocumentAssetStatus` 六态、冻结/哈希/Git 绑定、审计七问 | 未升格；§3.1 Demo 不可跳步已推翻 | ✅ §7 绑定关联链；§9 审计七问；**§10.4 明文废止 `.stagent/metadata/`** |
| [`protection-list-plain-design.md`](./protection-list-plain-design.md) | P.1 保护清单白话设计 v2 | 未随后续实现回写 | ✅ 四类绕过白话定义；API Key 五不落盘；撤销整轮语义 |
| [`protection-list-acceptance-checklist.md`](./protection-list-acceptance-checklist.md) | P.1 十步手工验收核查 | 过程清单 | — |
| [`non-technical-journey-acceptance.md`](./non-technical-journey-acceptance.md) | 非技术用户八步旅程验收稿 | **裁决 D-6**：缺乏测试 ID 与 Commit SHA 锚点，**不作为正式工程审计证据** | ✅ 八步 ×「看见什么/点什么/成功标准」三段式（唯一非技术体验基线） |
| [`c11-supervisor-five-step-brief.md`](./c11-supervisor-five-step-brief.md) | C.11a–e 五步起床验收 BRIEF | 卡已 COMPLETED | — |
| [`decision-matrix-reconciliation.md`](./decision-matrix-reconciliation.md) | Tina 15 项矩阵对账 | 过程对账 | ✅ 「已正式记录 vs 代码现状」防高估对照 |
| [`claude-code-isolation-design.md`](./claude-code-isolation-design.md) | Claude Code 隔离实测档案 | 决策已升格为 [ADR-0013](../adr/0013-cli-isolation-without-bare.md) | ✅ **A/B/C 三组对照实验**；`--restricted` 备选；专用 config dir 实测；**被 `claude-code-adapter.ts` 代码引用** |

Supervisor 合流前碎片另见 [`supervisor-pre-ssot/`](./supervisor-pre-ssot/)。

---

## 引用纪律

1. 归档件之间的相互引用保持原样，不做批量改写（历史文件不应被当代化）。
2. 新增文档**不得**以本目录文件为施工依据；若要引用其中的独特设计，应在现行规范中重新表述并回指本目录作为历史来源。
3. W.3 的两项**未修复**缺口已移出本目录，见 [`../backlog/w3-known-gaps.md`](../backlog/w3-known-gaps.md)。

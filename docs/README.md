# Stagent 文档地图

> **更新日期**：2026-10-27（Asia/Hong_Kong）· 文档治理重组
> **命名约定**：文件名**不含版本号与日期后缀**，统一英文 kebab-case；版本流转交由 **Git Tag 与 commit 历史**承载，每份规范在文件头标注定稿基线版本。
> **本次重组做了什么**：40 份文档 → **4 份现行规范 + 13 篇 ADR + 2 份 RFC + 3 份签收报告 + 17 份归档 + 1 份 backlog + 5 份模板**。删除 5 份 11 行 stub 短桩与 1 个 `.DS_Store`；把同一份 Supervisor SSOT 的 3 个物理文件合流为 1 份；修复 8 处指向已删除文件的悬空引用。

---

## 0. 三条铁律（先看这里）

1. **施工权威只有四份**：`specs/` 下的 `system-architecture.md`、`development-tasks.md`、`supervisor.md`、`runtime-contract-and-safety.md。写代码只认这四份 + 任务卡。
2. **`backlog/` 不是权威**。`backlog/` 是仍要修的待办清单，与现行规范冲突时一律以现行规范为准。原 `archive/` 过程稿目录已移除，历史脉络查 Git 历史。
3. **`rfc/` 不是规范**。RFC 是未批准/未实现的提案，其中条款**不具备**标记 `COMPLETED` 的资格。

---

## 1. 现行规范（`specs/`）· 施工权威

| 文件 | 主题 | 定稿基线 |
| :--- | :--- | :--- |
| [`specs/system-architecture.md`](./specs/system-architecture.md) | 架构宪法：产品定义、系统拓扑、分层职责、安全网关、Git/Worktree、状态机、数据模型、路线图 | v1.6.1（commit `4280de6`） |
| [`specs/development-tasks.md`](./specs/development-tasks.md) | 任务卡：87 张卡、DAG 依赖、Sprint 排期、修订流水 | v1.6.2 |
| [`specs/supervisor.md`](./specs/supervisor.md) | Supervisor 单一事实源（SSOT）：产品与监理语义；由 v2.0 正文 + v2.0.2 裁定层**物理合流**而成；**第三部分（v2.1）**定义意图编译器、《改动范围与验收方式》与确认后单页四幕旅程。**用户旅程以本文为准**，架构规范 §0.2 / §7.1 的旧旅程已加取代标注 | v2.1 |
| [`specs/runtime-contract-and-safety.md`](./specs/runtime-contract-and-safety.md) | 运行时硬契约：合同护照、Scope/通配分级、P.1 保护清单、Token/越界熔断、审计侧车、终态与清理、错误码分层 | 2026-10-27 新建（收口自 6 处散落条文） |

---

## 2. 架构决策记录（`adr/`）· 13 篇

[`adr/README.md`](./adr/README.md) — ADR-0001～0009 从架构规范 §8 原样抽出；**0010～0013 为本轮补录**：

- [0010](./adr/0010-demo-optional-not-hard-gate.md) Demo 降为体验增强项，允许跳过 Demo 直签
- [0011](./adr/0011-audit-sidecar-records-path.md) 审计侧车统一 `.stagent/records/{contract_id}/`
- [0012](./adr/0012-merged-as-terminal-state.md) `MERGED` 为唯一运行时终态
- [0013](./adr/0013-cli-isolation-without-bare.md) Claude Code 隔离弃用 `--bare`（被 `daemon/worker/cli-host/claude-code-adapter.ts` 强依赖）

---

## 3. 提案（`rfc/`）· 未批准

| 文件 | 主题 | 状态 |
| :--- | :--- | :--- |
| [`rfc/v0.2-multi-agent-pipeline.md`](./rfc/v0.2-multi-agent-pipeline.md) | v0.2 多 Agent 编译流水线、五阶段、Schema-First、并行 Worktree、三级信任模型 + 附录 A/B/C 锚定 | **DEFERRED**（RFC-2026-002，不进 v0.1） |
| [`rfc/scheme-snapshot-and-attestation-model.md`](./rfc/scheme-snapshot-and-attestation-model.md) | Scheme 快照规范化 AST、判别联合类型、三元哈希绑定、终态清理协议 | **PROPOSED**（RFC-2026-003；代码 0 命中，**不得**当现行规范引用） |

---

## 4. 历史签收与封版（`reports/`）

- [`reports/spec-freeze-record.md`](./reports/spec-freeze-record.md) — Spec Freeze 封版索引
- [`reports/v0.1-mainline-milestone.md`](./reports/v0.1-mainline-milestone.md) — v0.1 主路径 Sign-off
- [`reports/v0.1-hardening-closure.md`](./reports/v0.1-hardening-closure.md) — v0.1 硬化收官（Tag `v0.1.0`）

---

## 5. 待修缺口（`backlog/`）

[`backlog/w3-known-gaps.md`](./backlog/w3-known-gaps.md) — W.3 遗留的 **2 项未修复缺口**（`tmpRoot` GC、`splitShellSegments` 引号边界盲区），均附量化 PASS/FAIL 判据。**故意留在 backlog**：它们仍是待办，不是历史。

---

## 6. 归档（已移除）

原 `archive/` 目录（含 `supervisor-pre-ssot/` 下的过程稿碎片）已整体移除，不再作为查资料的入口：其中仍有价值的设计细节已分别并入 `specs/`、`adr/`、`rfc/`，历史原文查 Git 历史（`git log --diff-filter=D -- docs/archive/`）。

---

## 7. 模板（`templates/`）· 非当前施工依据

> **定位声明（裁决 D-4）**：本目录是 **Supervisor 未来渲染工件的脚手架**，服务于 [`rfc/scheme-snapshot-and-attestation-model.md`](./rfc/scheme-snapshot-and-attestation-model.md) 提出的「AST → 五份 Markdown 工件」映射。
> **⚠️ 当前不作为 Stagent 的施工依据**——该映射尚未实现（代码 0 命中）。写代码、写卡、写验收都不要引用本目录。

| 文件 | 用途 |
| :--- | :--- |
| [`templates/00-filling-guide.md`](./templates/00-filling-guide.md) | 统一 ID 空间与填写顺序 |
| [`templates/01-prd.md`](./templates/01-prd.md) | PRD |
| [`templates/02-system-design-and-api-contract.md`](./templates/02-system-design-and-api-contract.md) | 系统设计与接口契约 |
| [`templates/03-acceptance-matrix.md`](./templates/03-acceptance-matrix.md) | 验收矩阵 |
| [`templates/04-traceability-matrix.md`](./templates/04-traceability-matrix.md) | 需求—设计—测试追溯矩阵 |

---

## 8. 已删除的文档（勿再引用）

下列文件在 2026-10-25 `docs/reports/` 目录精简时删除，2026-10-27 已清理全部指向它们的引用：

- `docs/reports/v0.1-dogfooding-report.md`
- `docs/reports/phase-checklist-M1.md` … `M8.md`
- `docs/reports/工作台交互走查-2026-10-24.md`
- `docs/reports/W5a-真实CLI验证报告-2026-10-21.md`
- `docs/reports/stagent-task-flow-and-comparison.md`
- `docs/reports/` 下 5 份 Supervisor stub 短桩（2026-10-27 删除）
- `docs/tasks/TASK-C.21-未闭环收尾-cursor-brief.md`（一次性执行指令，收尾完成后已删除）

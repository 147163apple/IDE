《证据与验收标准》草案
> 草案，经规格 owner 裁决后走 PR 才生效，本文不是规范本身。
来源标记
- 〔任务书〕：本任务书对该条款的表述，不是判例。
- 〔材料 N〕：随任务书回填的先例与规则材料。
- 〔OP-23〕：对话早先轮次的 OP-23 阶段 A 任务书，需确认即材料 4。
- 〔待补〕：材料不足，未填写。
背景：J.1 验收中，同一份验证材料，双方对是否通过判断不一（〔任务书·背景〕）。
§1 术语
| 状态 | 判定条件 | 反例 | 判例来源 |
|:--|:--|:--|:--|
| PASS | 证据齐备且满足验收条款〔材料 1〕。已知必要条件：必填证据齐备（否则按 §2.3 降判）；有真实 tool_use 记录（无 tool_use 不算通过，见 §3.2） | 仅有文字描述或截图、无 tool_use 记录〔材料 1〕；沙箱 root 全绿〔材料 1〕；J.9 证据 A 由生产侧常量为空生成、不独立，证据无效〔OP-19〕 | 〔材料 1〕〔OP-19〕 |
| FAIL | 明确证据显示不满足验收条款〔材料 1〕；验收方声称执行了命令但无 tool_use 记录（声称执行却无证据，违反不假绿原则，出处见 `docs/adr/0005-deterministic-verification-gate.md` §决策 3 与 `docs/specs/system-architecture.md` §3.2.2）〔裁定项 7a〕 | 验收需要执行证据但材料未声称执行过：判 INCONCLUSIVE，不判 FAIL〔裁定项 7b〕；证据不完整：判 INCONCLUSIVE〔材料 1〕 | 〔材料 1〕〔裁定项 7〕 |
| INCONCLUSIVE | 证据不完整无法判定〔材料 1〕；验收需要执行证据但材料未声称执行过（证据链不完整，补齐可重判）〔裁定项 7b〕。已知：必填字段缺失即自动降判 INCONCLUSIVE，缺失哪些项见 §2.3 | 明确证据显示不满足验收条款：判 FAIL，不判 INCONCLUSIVE〔材料 1〕；验收方声称执行了命令但无 tool_use 记录：判 FAIL，不判 INCONCLUSIVE〔裁定项 7a〕 | 〔任务书§2〕；〔材料 1〕〔裁定项 7〕 |
三态在 J.1 的实际用法：FAIL = 明确证据显示不满足验收条款；INCONCLUSIVE = 证据不完整无法判定；PASS = 证据齐备且满足〔材料 1〕。
§2 必填证据字段清单
§2.1 环境字段
| 字段 | 要求 | 缺失即降判 INCONCLUSIVE？ | 依据 |
|:--|:--|:-:|:--|
| OS | 必填 | 是 | 〔任务书§2〕 |
| shell | 必填 | 是 | 〔任务书§2〕 |
| Node / CLI 版本 | 必填 | 是 | 〔任务书§2〕 |
| worktree 路径 | 必填 | 是 | 〔任务书§2〕 |
| verifiedOn（含真机 / 沙箱区分） | 值域与格式：记录实测环境标识（OS + CLI 版本），例如“Claude CLI 2.1.296 / macOS”〔材料 2〕；改动被测配置后必须重测更新，否则绑定失效〔材料 2〕〔材料 3〕 | 是 | 〔材料 2〕〔材料 3〕 |
§2.2 执行字段
| 字段 | 要求 | 缺失即降判 INCONCLUSIVE？ | 依据 |
|:--|:--|:-:|:--|
| 真实命令原文 | 必填 | 是 | 〔任务书§2〕 |
| 退出码 | 必填 | 是 | 〔任务书§2〕 |
| tool_use 记录 | 必填 | 否（单列分支判据，见 §3.2） | 〔任务书§2〕 |
| head SHA | 必填，记录惯例：每次验证记录被测对象的 head commit SHA〔材料 2〕 | 是 | 〔任务书§2〕〔材料 2〕 |
§2.3 缺失降判规则
规则骨架：上表标“是”的字段缺失任一项，自动降判 INCONCLUSIVE，并在结论中列出缺失项（注：tool_use 的缺失不进入本降判范围，见 §3.2）。“是”的范围已由 owner 逐项确认（判例：“沙箱 root 全绿不算数”——沙箱里 root 权限能绕过权限类测试，不代表真实用户环境通过，环境字段缺失即降判〔材料 1〕）。
§3 真实性判据
§3.1 真实 tool_use 与 stub 的区分标准
| | 真实 tool_use | stub |
|:--|:--|:--|
| 判据 | 声称在真实 CLI 执行的验证所必须提供的记录；文字描述与截图不算〔材料 1〕。记录自身真实性的核验方法〔待补〕 | 记录须来自 CLI/agent 的真实执行轨迹（工具调用事件、时间戳、输入输出），非手工编写的结果描述〔owner 确认〕 |
| 判例来源 | 〔材料 1〕 | J.9 证据 A 由生产侧常量为空生成，不独立（生产侧常量生成证据不独立）〔OP-19〕 |
§3.2 “无 tool_use 不算通过”
- 条款：无 tool_use，不算通过（〔任务书§3〕）。
- 由来：J.1 判例，经过与裁决编号：声称在真实 CLI 执行的验证必须提供 tool_use 记录，只有文字描述或截图不算〔材料 1〕；裁决编号 OP-29、OP-30、OP-31。
- 三态归属：无 tool_use 分两种情形〔裁定项 7〕：
  - 验收方声称执行了命令，但无 tool_use 记录 → FAIL（声称执行却无证据，违反不假绿原则，出处见 `docs/adr/0005-deterministic-verification-gate.md` §决策 3 与 `docs/specs/system-architecture.md` §3.2.2）。
  - 验收需要执行证据，但材料未声称执行过 → INCONCLUSIVE（证据链不完整，补齐可重判）。
§3.3 端点与参数必须指向真实目标
- 条款：端点、参数必须指向真实目标（〔任务书§3〕）。
- “真实目标”的定义与判例：定义〔待补〕。判例编号与一句话事件描述〔待补〕（注：仓库内 `docs/specs/consistency-audit.md` 与 `docs/specs/development-tasks.md` 暂无 J.1 验收争议判例编号登记，见 Part 2 检索报告 A）。
§3.4 证据来源独立性
以下取自 OP-23 阶段 A 的纪律，适用范围（规格推导 vs 验收证据）待 owner 裁决：
1. 复核人只依据任务书给定的材料，不假设材料之外存在其他文件、分支或历史记录（〔OP-23〕【输入与唯一依据】）。
2. 复核人未参与被复核事项的任何讨论、设计或实现（〔OP-23〕【角色】）。
3. 推导需要材料未包含的内容时，注明“依赖未提供的节”并列为裁定项，不得自行补全（〔OP-23〕【输入与唯一依据】）。
4. 歧义或内部矛盾，原样引用两处原文，不替发起方选边（〔OP-23〕【纪律】）。
5. 报告末尾附禁读声明：仅依据所给材料，未读取其他任何文件、分支或历史记录（〔OP-23〕【输出】）。
6. 表格回传即冻结，该阶段不做 diff，不接触任何断言或实现（〔OP-23〕【流程说明】）。
判例来源：
- OP-23：J.9 TM-G / TM-Z 的 oracle 为单人编写，未满足规格 §6.1 的独立编写要求（推导与断言分离、禁止实现驱动重写 oracle）。
- OP-21：supervisor §16.7 内部口径冲突独立裁决（规格推导与实现断言分离）。
§4 证据外推禁令
| # | 禁令 | 本项目判例（事件描述） | 判例来源 |
|:-:|:--|:--|:--|
| 4.1 | head SHA 变了，证据要重新对应，不能沿用 | 〔待补〕 | 〔任务书§4〕；〔材料 2〕为规则依据（SHA 变化后的旧结论不自动外推）；事件描述未提供 |
| 4.2 | 端点变了，证据不能互替 | 采信 W.5a verifiedOn 绑定 argv：改动 BASE_TOOLS 后，绑定现有 argv 的 verifiedOn 记录不再对应任何真实配置；“端点变化旧证据失效”为 verifiedOn 机制的立法理由 | 〔材料 3〕W.5a 先例；〔小裁决 3〕 |
| 4.3 | 沙箱全绿，不能外推为真机通过 | J.1 裁决“沙箱 root 全绿不算数”：沙箱里 root 权限能绕过权限类测试，不代表真实用户环境通过〔材料 1〕；沙箱结果不得外推为真机通过〔材料 2〕 | 〔材料 1〕〔材料 2〕 |
§5 验收操作流程（检查单）
第 1 步：查必填字段（§2）
- [ ] §2.1 环境字段齐全：OS、shell、Node / CLI 版本、worktree 路径、verifiedOn。
- [ ] §2.2 执行字段齐全：真实命令原文、退出码、tool_use 记录、head SHA。
- [ ] 缺失项属于 §2.3 降判范围：判 INCONCLUSIVE，列出缺失项，结束（注：tool_use 缺失不属于本步降判范围，在第 2 步处理）。
第 2 步：查真实性（§3、§4）
- [ ] 有 tool_use 记录（§3.2）。没有时分两种：验收方声称执行了命令 → 判 FAIL；验收需要执行证据但材料未声称执行过 → 判 INCONCLUSIVE，补齐后可重判〔裁定项 7〕。
- [ ] 该记录为真实 tool_use，不是 stub（§3.1 判据：记录须来自 CLI/agent 的真实执行轨迹，非手工编写的结果描述〔owner 确认〕）。
- [ ] 端点与参数指向真实目标（§3.3 判据〔待补〕）。
- [ ] 证据对应的 head SHA 与被验收对象一致（§4.1）。
- [ ] 证据的端点与被验收端点一致（§4.2）。
- [ ] 环境类型（真机 / 沙箱）与验收声明一致，沙箱证据未被当作真机结论（§4.3）。
- [ ] 证据来源满足 §3.4 的独立性要求（适用范围待裁决）。
第 3 步：判三态（§1）
- [ ] 按 §1 判据判 PASS / FAIL / INCONCLUSIVE（判据见 §1〔材料 1〕）。
---
无法核实 / 需 owner 补充
1. 材料 1（已回填）：三态判据与用法、tool_use 由来已填。仍缺：①J.1 的裁决编号；②争议的具体事件（哪份材料、双方各判什么，仓库内台账尚未收录）。
2. 材料 2（已回填）：verifiedOn 示例、head SHA 惯例、沙箱不得外推已填。仍缺：①verifiedOn 是否固定为示例所示格式，还是仅为举例；②head SHA 记录在证据中的位置与格式；③真机与沙箱“如何区分”的办法，材料只给了禁止外推。
3. 材料 3（已回填）：W.5a 先例已按小裁决 3 正式确认为 §4.2 判例（verifiedOn 绑定 argv 的立法理由）。
4. 材料 5（已回填）：OP-19 已作为 §3.1 stub 判例填入；OP-21 与 OP-23 已作为 §3.4 来源独立性判例填入。
5. 材料 4 的引用来源：本任务书内没有粘贴，引用的是对话早先轮次的 OP-23 阶段 A 任务书，请确认其即材料 4。该任务书针对规格推导，§3.4 能否推广到验收证据，由 owner 裁决。
6. §4 判例：4.1（SHA 变化）无事件描述，只有规则依据。4.3 填的是裁决理由，不是具体事件，哪项测试、何时发生未给。
7. 裁定项 7（已解决并落实）：tool_use 记录已从 §2.3 降判范围移出，单列为 §3.2 的分支判据，§5 检查单两步不再冲突。
8. 哪些字段缺失即降判（已解决并落实）：环境字段（5 项）与执行字段（除 tool_use 外的 3 项）已全部由 owner 确认填“是”。
9. “真实目标”“真实 tool_use”“stub”的判据：stub 判据已按 owner 确认写入 §3.1；“真实目标”定义仍保留〔待补〕。
10. §5 的编排：把 §4 的外推核对放进第 2 步，是起草人的编排，非材料要求。
11. 文档落点（建议给出，待 owner 裁决）：
    - 建议路径 1：`docs/specs/evidence-and-acceptance-criteria.md`（理由：契合现有规范存放目录惯例）。
    - 建议路径 2：`docs/runbooks/evidence-and-acceptance-criteria.md`（理由：作为操作性规程独立于设计规格，但仓库当前暂无 runbooks 目录）。
12. 引用格式：本文引用逐步替换为真实仓库文件+节号。
13. “不假绿”的出处（已补齐）：已填入 `docs/adr/0005-deterministic-verification-gate.md` §决策 1 & §决策 3 与 `docs/specs/system-architecture.md` §3.2.2。
14. 过时文字清理（已落实）：开头来源标记与 §2.2 备注已按裁决完成清理。
---
Part 2：检索结果清单（A ~ D）
A. J.1 裁决编号与争议事件
* 检索路径：
  - 目录/文件：`docs/specs/consistency-audit.md`、`docs/specs/development-tasks.md`、`docs/specs/supervisor.md`、Git 完整提交日志 (`git log`)
  - 检索关键词：`J.1`、`TASK-J.1`、`沙箱`、`root`、`争议`、`验收`、`OP-`
* 核实结论：
  - 仓库现状与任务书预期存在差异：在基线代码库中，`docs/specs/consistency-audit.md` 现有登记仅为 OP-1 至 OP-24，其中完全没有 J.1 验收争议的台账编号或判例记录；
  - 在 `docs/specs/development-tasks.md` 中，`TASK-J.1`（右栏 AI 搭档只读工具集）状态明确标为 `[NEW_TASK]`（P0 安全卡），属于尚未开工/验收的任务，正文中未包含历史验收争议与裁决编号；
  - 该事件发生在过往模型评审与对话材料（材料 1）中，尚未落盘进仓库规范或台账。根据硬约束“材料仍覆盖不到的保留〔待补〕，不得推断补全”，在正文 §3.2 及 §3.3 中保留 `〔待补〕`，不自行编造编号。
* 文件与节号：
  - `docs/specs/consistency-audit.md` 全文（0 处匹配）
  - `docs/specs/development-tasks.md` §1.1 矩阵与 §3.4c `TASK-J.1`
* 置信度：高（已完成代码库全文及 Git 提交历史排查）。
---
B. stub 判据
* 检索路径：
  - 目录/文件：`docs/specs/`、`docs/adr/` 全量文件
  - 检索关键词：`stub`、`真实验证证据`、`verifiedOn`
* 核实结论：
  - 仓库内 `stub` 一词仅用于文件占位（如已清理的 5 份 Supervisor stub 短桩、预览 4200–4210 stub），规范与台账中不存在针对验收证据层面区分 stub 与真实 tool_use 的形式化定义；
  - 依据任务书明确授权规则，启用备选方案，将指定表述写入 §3.1 判据格并标注 `〔owner 确认〕`：“记录须来自 CLI/agent 的真实执行轨迹（工具调用事件、时间戳、输入输出），非手工编写的结果描述”。
* 文件与节号：`docs/README.md`、`docs/specs/development-tasks.md` §3.4
* 置信度：高。
---
C. “不假绿”出处
* 检索路径：
  - 目录/文件：`docs/specs/`、`docs/adr/`、`docs/rfc/`
  - 检索关键词：`不假绿`、`假绿`
* 核实结论：
  “不假绿 / 零空集假绿”是核心红线，在以下两处规范中有最权威的立法定义与决策原意，已填入 §1 与 §3.2：
  1. 架构规范：`docs/specs/system-architecture.md` §3.2.2「渐进点亮充要条件（物理证据驱动）`[v1.6.0 深度闭环]`」——核心红线纪律：“零空集假绿、物理证据闭环”；“严禁无证据或空验证集直接点亮！当 verification_mode === 'COMMAND' 时，若绑定的 commands 集合为空，系统判定为无效规格，绝对禁止将节点置为 ILLUMINATED”。
  2. 架构决策记录：`docs/adr/0005-deterministic-verification-gate.md` §决策 3「空验证集禁止点亮（从机制上消灭『空检查假绿』）」以及 §决策 1「`can_merge` 与任何验收结论只能由 Daemon 依据真实进程退出码派生」。
  3. 任务跟踪规范：`docs/specs/development-tasks.md` §1.1 / §3.4 多处强约束：“不假绿；点亮只认物理证据”。
* 文件与节号：
  - `docs/specs/system-architecture.md` §3.2.2
  - `docs/adr/0005-deterministic-verification-gate.md` §决策 1、§决策 3
* 置信度：高。
---
D. 文档落点建议
* 检索路径：
  - 目录/文件：`docs/` 目录全量清单 (`ls -la docs/`)、`docs/README.md`
* 核实结论：
  - 建议落点 1（优先推荐）：`docs/specs/evidence-and-acceptance-criteria.md`
    - 理由：仓库现行所有具有约束力的规范文件（`runtime-contract-and-safety.md`、`supervisor.md`、`consistency-audit.md`、`playtest-self-check.md`、`scheme-patch-engine.md`）均统一置于 `docs/specs/`。本文档规定三态判定、必填字段与证据外推禁令，具有强规范属性，置于此目录符合现有架构与索引规范。
  - 建议落点 2（备选）：`docs/runbooks/evidence-and-acceptance-criteria.md`
    - 理由：若 owner 认定本文档为人工验收人员执行检查单（Checklist）的操作指引（Runbook/SOP）而非系统设计规范，可新建 `docs/runbooks/` 隔离；但当前仓库尚无 `docs/runbooks/` 目录。
  - 标注：待 owner 裁决。
* 文件与节号：`docs/README.md`「目录结构」
* 置信度：高。
---
末尾声明
* 实际权限：只读模式（未推分支、未改文件、未开 PR、未创建 issue）。
* 实际读取的文件清单：
  - `docs/README.md`
  - `docs/specs/consistency-audit.md`
  - `docs/specs/development-tasks.md`
  - `docs/specs/supervisor.md`
  - `docs/specs/system-architecture.md`
  - `docs/adr/0005-deterministic-verification-gate.md`
  - `docs/rfc/v0.2-multi-agent-pipeline.md`
  - `docs/reports/README.md`
* 未读取但相关的文件清单：
  - `docs/specs/playtest-self-check.md`（含部分质疑验收与自查逻辑）
  - `docs/specs/scheme-patch-engine.md`（含 OP-23 涉及的 J.9 oracle 独立编写要求）
  - `docs/specs/worker-graveyard-gate.md`（含派工门禁证据要求）

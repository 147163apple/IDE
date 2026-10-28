# 规格一致性审计收尾记录（2026-10-28）

> **性质**：审计收尾记录，只登记、不改任务状态。任务卡（`development-tasks.md`）状态未改动。
> **2026-10-28 裁决落笔**：C-3、C-4、C-5 已拍板并移入「一之二」；OP-11 已销项（见「五」第 10 项）；新增 OP-19（C-4 按钮文案统一）。本次修改不改任务状态。
> **基线**：`main` @ `e610016`。**PR #9 仍为 open、未合入**。本记录的机械修复与 PR #9 不重叠：PR #9 改动 supervisor §12 与 §20、dev-tasks 的 S.5 / J.10 / J.16 与状态回写 39→83、runtime §8 L3 行、README 附属段；本记录不触及这些位置。两者合并顺序互不影响。**本记录完成后更新**：PR #9（`e430193`）与本记录所在 PR #10（`99cfe51`）已先后合入 main；上文「open、未合入」为撰写时的历史状态。
> **行号**：本文「行号」指 `e610016` 快照中的物理行，仅供审计定位；规格正文不引用行号。
> **编号**：`C-` 待裁决矛盾；`M-` 本 PR 机械修复；`OP-` 挂账项。`C-1` 本轮无前次记录，留空位。

## 一、待裁决矛盾（未修，等裁决）

| 编号 | 矛盾 | 双方位置 | 建议（待裁决，未采纳） | 裁决人 |
| :--- | :--- | :--- | :--- | :--- |
| C-1 | 留空：本轮未找到前次审计的 C-1 记录 | — | 若前次 C-1 存在，请告知后合并编号 | Tina |

**C-2 已修**（见 M-7、M-8）：`demoReady` 的「≥2 个业务模块」与 supervisor 第三部分 §14.10 的「≥1 个 `user_visible` 模块」冲突。已按 §14.10 裁决，相关位置改为指针，不再复述谓词。

## 一之二、已拍板裁决（2026-10-28，Tina）

| 编号 | 原矛盾 | 裁决 | 裁决依据 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| C-3 | Fast Path 的施工载体（Worktree / VIBE 直改）口径不一致 | 免 Worktree **仅限非生产产物**（Demo 展示代码、图标/素材、`.stagent/` 内方案文档）；会进入可执行工程的生产代码（`src/`、`daemon/`、工具链产物）**一律走 Worktree**。VIBE 直改仅适用于上述非生产产物。 | Tina 裁决（2026-10-28）。非生产产物无交付风险；生产代码须可审计、可撤销，故走 Worktree。 | supervisor §16.11「免 Worktree 边界」；架构 §0.2.3.1 加例外指针 |
| C-4 | 超时卡（D-3）仍请用户选「按 Bug 修复 / 按新需求演进」 | 出口改为白话二选【这是 Bug，免费修】/【我想要新功能，下一轮做】；分类由系统内部归，接 attributions 路由，不向用户暴露技术分类。**按钮文案已统一为 supervisor §16.7 文案，OP-19 已销项。** | Tina 裁决（2026-10-28）。 | 架构 §6.4 D-3 单元格 |
| C-5 | 「三次上限」是否包含自动重试 | 三次上限**仅计用户手动触发的重试**；系统首次自动重试不计入，计数器只在用户手动重试时递增。 | Tina 裁决（2026-10-28）。原审计所指的冲突自动重试位于 supervisor 第三部分 §16.8。 | 架构 §6.4 D-1 单元格；supervisor §16.8 |


## 二、机械修复清单（本 PR）

| 编号 | 文件 | 位置（`e610016` 行） | 修改 | 依据 |
| :--- | :--- | :--- | :--- | :--- |
| M-1 | `docs/specs/supervisor.md` | §18 表，行 1604 | 第二个 `V-10`（点击中栏条目滚动并高亮）改为 **`V-14`** | 与行 1580 的 `V-10`（INV-LEDGER-01）撞号。未采用「改为 V-11」：行 1581 的 V-11（INV-LEDGER-02）已占用，改 V-11 会产生新撞号。V-14 全库无 §18 占用（intent-compiler 的 ADV-14 属另一命名空间）。 |
| M-2 | `docs/specs/supervisor.md` | §18 统计行，行 1611 | 「本节 35 条，`⏳ 35`」→「本节 39 条，`⏳ 39`」 | 表内实际 39 行：V-01～V-13 共 13、S2-01～S2-09 共 9、J-01～J-15 共 15、P-01 共 1、UI 的 V 行 1。 |
| M-3 | `docs/specs/supervisor.md` | §14.11 `attributions` 块，行 1155 | `trigger` 删除 `\| string` 兜底；新增可选 `linked_reason_code?: reasonCodeSchema`（只读引用，仅 `acceptance_fail` 可带） | K-16 原文；`playtest-self-check.md` §5.2、SR-5、TM-PK-11/12 与之一致。intent-compiler-prompt §2.2 的「非码类写入边界」无需改。 |
| M-4 | `docs/specs/playtest-self-check.md` | §5.2，行 274 | 「现行 SSOT」→「K-16 前 SSOT 口径（已由 K-16 收紧为闭集）」 | 避免把已收紧前的类型写成现行。 |
| M-5 | `docs/specs/supervisor.md` | 版本记录，行 27 | 「47 码责任表」后补注现行 51 码 | 历史条目不回改，只补注。`scheme-patch-engine.md` 与 `intent-compiler-prompt.md` §2.1/§2.2 无 47 命中，已核。 |
| M-6 | `docs/specs/development-tasks.md` | TASK-J.10 正文，行 2856 | 「（21/47）」后补注：47 为定稿口径，现行 51 码，待重算（OP-15） | 全库「21/47」仅此一处。 |
| M-7 | `docs/specs/runtime-contract-and-safety.md` | §3，行 133 | 「demoReady 的四条布尔底线」整行改为指针：「`demoReady` 判定以 `supervisor.md` §14.10（v2.1 改判：`≥ 1` 个 `user_visible` 模块）为准，本节不复述谓词。」 | C-2。 |
| M-8 | `docs/specs/supervisor.md` | §2.2 标题行，行 115（第 1 条在行 117） | 标题加改判指针：第 1 条已由第三部分 §14.10 改判 | C-2。§7 D5 段（行 822）已声称「各处已加改判指针」，本处此前缺失，属新发现。 |
| M-9 | `src/lib/error-codes.ts`（代码注释，可选项） | 文件头，行 6 | 「14 个 `error_code`」→「17 个 `error_code`」 | `ERROR_CODES` 数组实为 17 项。仅改注释，不改码表。若认为代码注释不应进文档 PR，撤回本条并转 OP-16。 |
| M-10 | 核对，无需改 | `development-tasks.md` TASK-J.9 卡（行 219、2823）与第二批预告（行 2905）的「V-10～V-13」 | 不改 | 指向 §18 行 1580–1583（INV-LEDGER-01～03 与 V-13），与 M-1 无关。 |

## 三、挂账项（本 PR 不改）

| 编号 | 挂账项 | owner | 触发条件 | 依据 |
| :--- | :--- | :--- | :--- | :--- |
| OP-1 | 确认路径 `occurrence` 洗白（`mark_user_confirmed`） | 引擎实施（J.9）；裁决 Tina | J.9 实施前裁定；落地前不得视为无问题 | supervisor §14.11 K-12「显式风险」 |
| OP-2 | `remove_item` 去留（可绕过入墓） | J.10 实施 | J.10 实施期；若保留，先做组装期否定词检查 | PR #5 审核挂账 |
| OP-3 | `surface_log`（GAP-P8）呈现日志 | J.16 实施 | J.16 实施时写入 §15.4 投影 | playtest-self-check 行 61、305。非错误码，是数据字段；代码 0 命中。 |
| OP-4 | 门禁码无成表闭集 | J.18 实施 PR | 建立 runtime §8.1 闭集并同步 ERROR_CODES 映射时 | runtime §8 L3 行脚注；K-15 |
| OP-5 | `E_GATE_SCAN_FAILED` 仅存在于规格 | J.18 | J.18 实施时 | worker-graveyard-gate 行 338、439；`src/` 与 `daemon/` 0 命中 |
| OP-6 | `E_TEST_FILE_WRITE_BLOCKED` 有代码、未登记 | 门禁闭集 owner（J.18） | 闭集建立时登记入 §8.1 与 ERROR_CODES（需定映射） | `daemon/mcp/gateway.ts` 行 137 及多处抛出；不在 ERROR_CODES，runtime §8 L3 亦未列 |
| OP-7 | `E_PROPOSAL_PREVIOUSLY_REJECTED` 代码未实现 | J.18 | J.18 实施 PR（K-15） | 规格已登记；`src/` 与 `daemon/` 0 命中 |
| OP-8 | `E_CHECKPOINT_FAILED` 以字符串直接返回 409，未入码表 | J.18 闭集 | 同 OP-4 | `daemon/server.ts` 行 1767、1844；runtime §8 L3 脚注已注明 |
| OP-9 | `E_WRITABLE_SCOPE_POLICY` 为类上的码，未入码表 | 签署链（J.3/J.5）；裁定 | 闭集建立时 | `daemon/supervisor/scope-gate.ts` 行 15；runtime §2.3 已注明与 `E_SCOPE_POLICY` 不同 |
| OP-10 | `E_PREPARATION_FAILED` 孤儿码：表内有，`src/` 与 `daemon/` 无抛出点 | 码表维护（待指定） | 下次 error-codes 修订，二选一：删除，或补抛出点 | `src/lib/error-codes.ts` 行 33、194；仅测试手工构造 |
| OP-11 | ~~`E_COMMAND_TIMEOUT` 值分歧~~ | — | **已销项**（见「五」第 10 项） | 原依据见「五」第 10 项 |
| OP-12 | S.5 已知 7 处局限 | J.16 实施 | J.16 实施时 | dev-tasks S.5 行注（PR #9） |
| OP-13 | 第一印象窗口长度 | Tina | J.16 实施前 | supervisor §13.3 实施期待定项 |
| OP-14 | `attributions` 回填方 | J.16 | J.16 实施前 | playtest-self-check §5 与 §7.10 |
| OP-15 | 「21/47」按 51 码重算 | J.10 | J.10 实施前 | M-6 |
| OP-16 | M-9 代码注释是否进文档 PR | Tina | 本 PR 审核时 | M-9 为可选项 |
| OP-17 | PR #9 合入 | Tina | 审核后 | PR #9 open，clean |
| OP-18 | 审计未覆盖范围：架构 §1–§4、§9；state-machine-contract 其余章节；constants-and-paths | 下一轮审计 | 下一轮 | 本轮只核 §0.2.3.1、§5.2.2、§6.4、§6.5、§7.1 与 state-machine §4 |
| ~~OP-19~~ | ~~按钮文案统一~~ | — | **已销项**：以 supervisor §16.7 与 §18 行为规范层文案为准，架构 §6.4 D-3 已同步为「这是 Bug，免费修 / 我想要新功能，下一轮做」（Tina 裁决，2026-10-28） | C-4 裁决落笔时发现 |
| ~~OP-20~~ | 上一轮审计漏网：架构「低置信度降级」条目仍写用户点选「按缺陷修复 / 按新需求演进」，未随 OP-19 同步 | — | **已销项**（本 PR）：该条改为系统向用户提业务澄清问题，口径指向 supervisor §16.7；架构底部改判说明与 supervisor §16.7 的取代说明、禁止项保留 | 逐处核对 OP-19 相关 grep 命中时发现 |
| ~~OP-21~~ | supervisor §16.7 内部口径冲突：低置信度时既写「系统问一个业务问题、不把技术分类推给用户」，又写「底部仍显示两按钮，上方加一行『我不确定是谁的问题，你定』」 | — | **已销项**（本 PR）：裁决为「以 supervisor §16.7 澄清问题口径为准，质询台规格段已同步，按钮保留为用户主动裁决入口」；底部按钮段改为低置信度先问业务澄清问题、按钮标注「我不确定是谁的问题」 | 本 PR 修架构时发现；后续提交已同步 supervisor 质询台规格段 |
| OP-22 | J.8「施工·返工」行歧义：§16.2 第 1404 行用「→」把过程压成一行（`REWORK_REQUIRED → IMPLEMENTING`、`VERIFYING → EXECUTING`），返工回到 IMPLEMENTING 后快照上与首次施工同构，无法区分 | Tina 裁决；J.8 后续 | 裁决：代码按现状保留（返工仅在 REWORK_REQUIRED 瞬态可见，之后归「进行中」）；建议补充可观测标记（如快照字段 `rework_in_progress`），否则返工子态只能覆盖 REWORK_REQUIRED 瞬态 | PR #4（J.8）审核，`src/lib/state/journey-stage.ts` 的 `build_rework` 行注释；supervisor §16.2 第 1404 行 |

## 四、三层皮权威表

| 层 | 管什么 | 文件 | 冲突时 |
| :--- | :--- | :--- | :--- |
| **规格 SSOT** | 产品与契约 | 架构 `system-architecture.md`（宪法；§0.2 与 §7.1 等已有改判横幅）；`supervisor.md` 第三部分（v2.1，现行生效）；`runtime-contract-and-safety.md`（硬契约）；`development-tasks.md`（任务卡与施工 DAG） | 上位规格优先；第三部分 §17 决策与第一部分 §7 同级 |
| **实施口径（附属）** | 某条 SSOT 的实施细节 | `scheme-patch-engine.md`（§14.2/§14.3/§14.11）；`intent-compiler-prompt.md`（§14.4–§14.9，引擎码表以引擎为准）；`worker-graveyard-gate.md`（§14.11 INV-LEDGER-03）；`playtest-self-check.md`（§16.7） | 以所指上位规格为准 |
| **代码即权威** | 运行时事实 | `src/lib/state/delivery-state.ts`；`src/lib/journey/confirm-scheme-atomic.ts`；`daemon/supervisor/demo/signing-gate.ts`；`daemon/guard/audit-manifest.ts`；`daemon/supervisor/rules-l0.ts`；`src/lib/error-codes.ts`（码表目录） | 代码现状不等于目标规格，差距登记在 supervisor §19 |
| **草案（非依据）** | 不作施工依据 | `constants-and-paths.md`、`state-machine-contract.md`（待核验草案）；`rfc/`、`templates/` | 不引用为现行规范 |

## 五、已验证销项清单（本轮）

| 项 | 结论 | 证据 |
| :--- | :--- | :--- |
| 1. 架构 §0.2.3.1、§5.2.2、§6.4、§6.5、§7.1 的外部引用逐条核对 | 编号与所指内容一致：§0.2.3.1 第 3 条（越界熔断）、§5.2.2（Checkpoint）、§6.5.2（0.7 门槛）、§6.5.3（子集检查）、§6.5.4、§7.1（被 D8 取代）。有三处语义问题，见 C-3、C-4、C-5 | supervisor 行 873、1457、1507、1518、1548、1559；架构行 141、703、807、813、815、822、855 |
| 2. state-machine-contract §4 的 `ReasonCode` | 代表码引用，非全量枚举，**不触发 F-6**。未被引用的 4 码（`UNSAFE_EXECUTION`、`EVIDENCE_STALE`、`PREPARATION_INTERRUPTED`、`WORKSPACE_LOCKED`）不构成缺口 | state-machine 行 100–103 |
| 3. `ERROR_CODES` 孤儿码反向检查 | 17 码（头注释「14 个」为旧值，M-9）。除 `E_PREPARATION_FAILED`（OP-10）外，16 码在 `daemon/` 均有抛出或返回点。`E_COMMAND_TIMEOUT` 值分歧见 OP-11。检查范围为 `src/` 与 `daemon/`（抛出点在 `daemon/`，只查 `src/` 会误报） | 非注释、非测试命中计数，见 OP-10、OP-11 |
| 4. 门禁码补登归属清点 | `E_GATE_SCAN_FAILED`（仅规格）、`E_TEST_FILE_WRITE_BLOCKED`（有代码、未登记）、`E_PROPOSAL_PREVIOUSLY_REJECTED`（仅规格）、`surface_log`（数据字段，代码 0 命中）。已归入 OP-3、OP-5 至 OP-7 | 见 OP-3 至 OP-9 |
| 5. 「≥2 模块」残留 | 除 M-7、M-8 外，supervisor 行 1627（L-07 落差登记，记录当前代码事实）无需改；§7 D5 段（行 822）已指向 §14.10 | — |
| 6. 51 码计数 | intent-compiler-prompt 行 11 与 §2.2 已为 51；47 残留两处（M-5、M-6） | — |
| 7. `attributions` 的三处引用 | playtest、intent-compiler-prompt、supervisor 对 `trigger` 的描述一致，除 M-3（类型）与 M-4（措辞）外无需改 | TM-PK-11、TM-PK-12、SR-5 已按闭集写 |
| 8. §18 撞号与统计 | 修复前 `V-10` 重复、统计 35（应为 39），已修为 M-1、M-2；修复后 V-01～V-14 无重复 | — |
| 9. J.9 卡的 V-10～V-13 指针 | 核对正确，无需改（M-10） | — |
| 10. OP-11 `E_COMMAND_TIMEOUT` / `E_COMMAND_REJECTED` 常量值对齐 | 销项。`daemon/runner/command-runner.ts` 两常量值改为 `E_` 前缀，与 gateway 实际产出一致。**纠正原记录**：`E_COMMAND_REJECTED` 并非无引用，它是 `CommandSecurityError` 的默认码（gateway 对该类统一映射为 `E_UNAUTHORIZED_COMMAND`，对外输出不变；内部 `.code` 与错误消息前缀随之变化）。`E_COMMAND_TIMEOUT` 确无引用。 | 仓库全文检索（克隆后 grep）；`tests/` 无字面量 `COMMAND_REJECTED` / `COMMAND_TIMEOUT` |
| 11. C-3 | 销项（裁决已落笔） | 见「一之二」 |
| 12. C-4 | 销项（口径已落笔；文案统一见 OP-19，已销项） | 见「一之二」 |
| 13. C-5 | 销项（计数口径已写死） | 见「一之二」 |

**未覆盖**：本轮未逐字核对的范围见 OP-18；`src/` 与 `daemon/` 的检查基于 `e610016` 快照的文本检索，未运行测试。

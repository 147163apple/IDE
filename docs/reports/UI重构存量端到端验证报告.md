# UI 重构 · 存量项目端到端验证报告

> **口径说明（2026-10-23 同步至主仓库后补记）**
>
> - 本报告撰写时为 **v1.3.3** 规格口径（架构 v1.3.3 / 任务 v1.3.3），现场为 `/Users/tina/Desktop/1018` 副本仓库，基线 `9da451c`。主仓库规格现已升级为 **架构 v1.6.1 / 任务 v1.6.2**，正文出现的规范章节号与术语请以 v1.6.x 复核；流程结论（合同 → 准入 → 隔离 → 验证 → 合并闭环成立）不因版本升级而改变。
> - 覆盖范围仅 `6b19091`（3 files，+210 / −14）。其后两个 UI 提交不在本次演练内：`508cd4c`（Cursor 式 IDE 骨架、Supervisor Tab、设置页）与 `3266f45`（顶栏精简 · 设置抽屉化 · 首屏欢迎态 · 雷达宽屏 Tab，并打通 `POST /api/supervisor/draft`）。二者以 `tests/ui`、`tests/unit`、`tests/integration` 用例及合并后门禁为准，不由本报告背书。
> - 报告中的绝对路径仅代表当时现场；改动已通过 `git merge --no-ff` 同步进主仓库，既有提交历史未重写。

- **仓库**：`/Users/tina/Desktop/1018`（Stagent 副本仓库）
- **分支 / 基线**：`main` @ `9da451c`（v0.1.0 发版提交）
- **业务载体**：UI 体验重构与布局优化（真实改动，非示例桩）
- **执行方式**：Stagent 自身受控流水线（合同 → 准入求交 → 隔离 Worktree → 网关写入 → 真命令验证 → Evidence → Gate 0–4 → Squash Merge）
- **执行时间**：2026-10-22 19:50–19:51（GMT+8）
- **结论**：**闭环成立** —— 准入走了真实的 `NEEDS_APPROVAL`（弹窗确认）分支，2 条验证命令在 Worktree 内真实执行并 exit 0，Evidence `PASSED` / `can_merge=true`，合并提交 `6b19091` 落 `main`，现场零残留。

---

## 0. 关键数字

| 项 | 值 |
| --- | --- |
| 合同 | `contract_1792669860746_80cp9` |
| 准入裁决 | `NEEDS_APPROVAL`（保护清单求交命中 1 条） |
| 待审批卡 | `pc-ced51841` |
| 批准人 / 版本 | `local-user` / `approved_revision=1` |
| Worktree | `.stagent/worktrees/task-contract_1792669860746_80cp9`（合并后已删除） |
| 改动规模 | 3 files，**+210 / −14** |
| 验证 | `typecheck` exit 0（2 351 ms）· `ui-tests` exit 0（1 659 ms） |
| Evidence | `evi_1792669865014_fda7h` · `PASSED` · `can_merge=true` · 重试 0 |
| 指纹 | `snapshot_fingerprint = e44bf887…46dd88db` |
| 证据哈希 | `083c8e22…93ed46e3c`（`shasum -a 256` 独立复算一致） |
| 合并提交 | `6b190919ad88cc2663dc60d98421b51dd8ef7496` |
| 耗时 | 准入 3 ms · 审批+Worktree 98 ms · 写入 4 ms · 验证 4 230 ms · 合并+清理 148 ms · **合计 4 506 ms** |
| 用量 | Token 0 / 费用 0（`accounting_mode=UNAVAILABLE`，见 §6 R-5） |

---

## 1. 前置：基线核实（含一处必须先修的事实）

**执行前发现：`/Users/tina/Desktop/1018` 目录内没有 `.git`。** 它是一份纯文件副本（含 `node_modules`、`dist`），缺少 `.gitignore`、`.npmrc`、`.github/workflows/ci.yml` 三个点文件——即"复制时排除了点文件"的产物。没有 Git 就没有 Worktree、diff、Squash Merge 与 Trailer，整条流水线无法起步。

处置（可复核）：

1. 逐文件比对副本与 `9da451c` 的 blob 哈希：**301 个文件中 297 个字节级一致**；缺 3 个点文件；`docs/Stagent_v0.1_Development_Tasks_Specification_v1.3.3.md` 比该提交新一次（`6d7fa59` 的文档修订）。
2. 以 `1020` 为对象源 `git fetch`（**复用真实提交对象，不伪造历史**），`git checkout -f -B main 9da451c` 固定到目标基线，随之补回 3 个点文件、1 个文档回到 `9da451c` 版本；随后移除临时 remote，避免误推。
3. 结果：`git log -1` → `9da451c`；`git status --porcelain -uall` → **空**。

> 结论：**基线提交与文件内容是真的，git 元数据是本轮重建的**。不含任何用户改动丢失（唯一被覆盖的是 1 个文档的较新修订，其内容仍在 `1020` 仓库 `6d7fa59`）。

---

## 2. 阶段一：合同（Contract）

| 字段 | 值 |
| --- | --- |
| 标题 / Intent | `UI 体验重构与布局优化` |
| writable_paths | `src/components/**`、`src/routes/**`（业务约束）<br>`src/components/WorkspaceLayout.tsx`、`src/components/layout/CollapsibleSection.tsx`、`src/routes/index.tsx`（具体路径，见下注） |
| strictly_forbidden_paths | `daemon/**`、`.stagent/**`、`tests/daemon/**`、`package.json` |
| 验证命令 | `typecheck` = `npm run typecheck`（期望 0，300 s）<br>`ui-tests` = `npx vitest run tests/ui/`（期望 0，420 s） |
| 预算 | `max_file_modifications=4`、`max_total_diff_lines=2000`、`max_duration_seconds=1800`、`max_verification_retries=1` |
| 落盘 | `.stagent/contracts/contract_1792669860746_80cp9.json`（终态 `lifecycle_state=MERGED`） |

> **注（真实约束，不是简化）**：`AiWorker.collectContext()` 只枚举**具体路径**（`ai-worker.ts:306-316`，通配符跳过）。若只写 `src/components/**` 与 `src/routes/**`，Worker 上下文为空，无法读取既有 `index.tsx` 做接线。因此合同同时登记 3 个具体路径——它们全部落在上述两棵树内，未越界。

---

## 3. 阶段二：准入求交（Admit）

保护清单（`.stagent/protection.json`）本次登记 1 条，用于让求交真实发生：

```json
{ "name": "保护确认卡组件", "patterns": ["src/components/ProtectionCard.tsx"] }
```

准入结果（原文）：

```
decision      : NEEDS_APPROVAL
reason        : 合同范围触碰保护清单，需要你确认后才会开工
protected_hits: ["src/components/ProtectionCard.tsx"]
entry_names   : ["保护确认卡组件"]
card_id       : pc-ced51841
```

- 运行模式：`PROTECTED`（清单非空）。
- 裁决路径：**弹窗确认**，不是自动批准；因为写清单范围（`src/components/**`）与保护条目存在交集，`intersectWithProtection()` 按见证路径判定命中。
- 确认动作：`orchestrator.approve(id, "local-user")` → `PREPARING → EXECUTING`，`approved_by=local-user`、`approved_at=2026-10-22T11:51:00.762Z`、`approved_revision=1`（与 `contract_revision` 绑定，防 TOCTOU）。
- **如实说明**：本次为无头执行，批准由驱动器调用 API 完成，不是人在 UI 上点击（见 §6 R-2）；卡片本身已登记并持久化。

---

## 4. 阶段三：隔离执行（Isolation & Worker）

| 项 | 实测 |
| --- | --- |
| Worktree | `.stagent/worktrees/task-contract_1792669860746_80cp9`（独立分支 `task/contract_…`） |
| 依赖策略 | ADR-002 共享复用（锁文件一致 → `SHARED_SYMLINK`，未重装依赖） |
| 写入通道 | `AiWorker` → `ScopedWorktreeGateway`（范围校验 / 预算 / 测试完整性 / 审计同一通道） |
| 写入结果 | 3 个文件：`WorkspaceLayout.tsx`（重写）、`layout/CollapsibleSection.tsx`（新增）、`routes/index.tsx`（定点接线） |
| 网关拦截 | **0 次越权**（`.stagent/audit/` 未生成任何 `GATEWAY_VIOLATION`） |
| 范围校验 | 整批通过（`scope_audit.passed=true`，`forbidden_violations=[]`） |

---

## 5. 阶段四：验证与 Evidence

两条命令均在 **Worktree 内**执行（可由 vitest 输出的路径自证）：

```
[stdout] > tanstack_start_ts@0.1.0 typecheck
[stdout] > tsc --noEmit
[stdout]  RUN  v4.1.12 /Users/tina/Desktop/1018/.stagent/worktrees/task-contract_1792669860746_80cp9
[stdout]  ✓  dom  tests/ui/index-route.test.tsx (3 tests) 112ms
[stdout]  ✓  dom  tests/ui/supervisor-admission-route.test.tsx (4 tests) 197ms
[stdout]  ✓  dom  tests/ui/supervisor-studio-approval.test.tsx (16 tests) 83ms
[stdout]  ✓  dom  tests/ui/agent-chat-pane.test.tsx (8 tests) 62ms
[stdout]  ✓  dom  tests/ui/workspace-layout.test.tsx (8 tests) 54ms
[stdout]  ✓  dom  tests/ui/monaco-editor-pane.test.tsx (4 tests) 47ms
[stdout]  ✓  dom  tests/ui/diff-terminal-viewer.test.tsx (5 tests) 39ms
[stdout]  Test Files  7 passed (7)
[stdout]       Tests  48 passed (48)
```

| 命令 | exit code | 耗时 | 判定 |
| --- | --- | --- | --- |
| `typecheck` | **0** | 2 351 ms | PASSED |
| `ui-tests` | **0** | 1 659 ms | PASSED |

Evidence 关键字段（`.stagent/evidence/contract_1792669860746_80cp9-evi_1792669865014_fda7h.json`）：

```json
"verdict": { "status": "PASSED", "can_merge": true,
             "summary": "All 2 verification command(s) passed",
             "verification_retry_count": 0 },
"worktree_snapshot": { "snapshot_fingerprint": "e44bf887…46dd88db",
                       "captured_at": "2026-10-22T11:51:05.067Z" },
"git_info": { "base_commit_sha": "9da451c6d077684baa769f54c88af76fb06dae6f",
              "task_commit_sha": "1461c19c6887726f4d927dc07adea3fa8616e6f3",
              "diff_stat": "", "patch_fingerprint": "e3b0c442…b855" },
"scope_audit": { "passed": true, "files_changed": [], "forbidden_violations": [] },
"usage": { "accounting_mode": "UNAVAILABLE", "currency": "CNY", "limit_reached": false }
```

证据哈希独立复算（与 Trailer 逐字符一致）：

```
$ shasum -a 256 .stagent/evidence/contract_1792669860746_80cp9-evi_1792669865014_fda7h.json
083c8e22da15005611547b6c7af354eaf7b27197500caa60cc8bda593ed46e3c
```

---

## 6. 阶段五：Gate 0–4 与 Squash Merge

`merger.ts` 依次校验：合同存在（Gate 0）→ `AUDITED` 态（Gate 1）→ Evidence 存在且同合同（Gate 2）→ 指纹复核 `assertEvidenceIntegrity`（Gate 3）→ 主树 clean + 冲突处置（Gate 4），全部通过后 `merge --squash` 并注入 Trailer。

合并提交 `6b19091` 原文：

```
feat(1792669860746_80cp9): UI 体验重构与布局优化

由 Stagent 受限执行并通过全部门禁验证。

Stagent-Contract-ID: contract_1792669860746_80cp9
Stagent-Evidence-ID: evi_1792669865014_fda7h
Stagent-Evidence-Hash: 083c8e22da15005611547b6c7af354eaf7b27197500caa60cc8bda593ed46e3c
Stagent-Verdict: PASSED
Stagent-Approval-Status: APPROVED
Reviewed-By: local-user
```

```
 src/components/WorkspaceLayout.tsx           | 139 ++++++++++++++++++++---
 src/components/layout/CollapsibleSection.tsx |  72 ++++++++++++++
 src/routes/index.tsx                         |  13 ++-
 3 files changed, 210 insertions(+), 14 deletions(-)
```

- `worktree_removed=true`、`nothingToMerge=false`、`conflict_resolution=null`（无冲突）。
- 合并后复跑 `npx vitest run tests/ui/`：**7 文件 / 48 用例全绿**（主树状态自证）。
- **Trailer 实为 6 条，不是 7 条**：`Stagent-Tests-Modified` 是条件写入（仅当 `tests_modified=true`）。本次合同把可写范围限定在 `src/**`，测试文件根本不在授权范围，`tests_modified=false`，故第 7 条按设计缺席。这不是字段丢失，也不能为了凑数去改测试——那会与业务约束 `writable_paths` 直接冲突。

---

## 7. 业务改动：布局重构做了什么

针对"布局混乱、不知如何使用"：把信息流固定成「意图 → 审阅 → 证据」，并给三处面板统一的收拢语义。

| 区域 | 改动前 | 改动后 |
| --- | --- | --- |
| 左栏 | 只有文件树 | **意图对话**（说清改什么）+ 可收拢文件树（收起后仍显示根路径） |
| 中栏 | 代码标签 / Studio 二选一 | 代码标签页 + **可收拢 Studio dock**（收拢后代码回全宽，审批卡不丢） |
| 右栏 | Coding Agent 对话 | **任务与证据摘要**（对话迁至左栏意图区） |
| 底栏 | 无 | **抽屉式 SmartTerminal**，默认收起，点开看命令输出与退出码 |
| 公共 | 各面板开关文案/无障碍属性不一致 | 统一 `CollapsibleSection`：整条标题可点、`aria-expanded` + `data-state` 双写、折叠保留摘要 |

**D4 合规自检**：`WorkspaceLayout.tsx` / `CollapsibleSection.tsx` 中 `Hub | HUD | 成熟度` 命中 **1 处，且是注释里的"不引入"声明**（`WorkspaceLayout.tsx:74`）；零实现，未引入中心 Hub、顶部 HUD 或成熟度气泡。

---

## 8. 偏差、未验证项与已知缺陷

| # | 项 | 影响 | 处置 |
| --- | --- | --- | --- |
| R-1 | 副本仓库原本无 `.git`（纯文件副本，缺 3 个点文件） | 流水线无法起步 | 已按 §1 重建 git 元数据（297/301 文件字节级一致）；基线为真、元数据为本轮重建 |
| R-2 | 审批由驱动器调 `approve()` 完成，非人在 UI 点击 | "弹窗确认"的**人机交互**环节未被实机验证 | 卡片 `pc-ced51841` 已登记并持久化；判定路径 `NEEDS_APPROVAL` 真实 |
| R-3 | 本次 run JSON 的 `baseline.head` 字段是**合并后**读取（驱动器缺陷，应为 `9da451c`） | 该字段不能当基线证据 | 真实基线以 Evidence `git_info.base_commit_sha=9da451c…` 为准；缺陷已记录，未回改产物 |
| R-4 | Trailer 实为 6 条（缺 `Stagent-Tests-Modified`） | 与"7 条"表述有差 | 条件字段语义正确（§6）；要 7 条必须放开测试文件写权限 |
| R-5 | **无真实模型**：无 `OPENAI_API_KEY`，Worker 为确定性写手 | "AI 自己写出这套布局"未被验证 | 写入走同一 `AiWorker` + 网关；Token/费用 0，`accounting_mode=UNAVAILABLE` |
| R-6 | 复现 E.2 已知缺陷：`scope_audit.files_changed=[]`、`git_info.diff_stat=""`、`patch_fingerprint=sha256("")` | 不能用 Evidence 判断改动范围 | 以合并提交 diff 为准（3 files / +210−14）；缺陷未修 |
| R-7 | 保护清单是本次为演示求交**新建**的 1 条 | 不代表用户真实清单 | 清单与命中文件均已落盘，可复核 |
| R-8 | 底栏 SmartTerminal 与 Studio 内终端共用同一 `stream.terminal` 数据源，尚未收敛为单一入口 | 同一份数据两处渲染 | 增量重构取舍：一次性改 1 440 行 `index.tsx` 的多个插槽风险过高，留待下一轮 |
| R-9 | 只在 jsdom 单测层面验证，未开浏览器实机点击；未做响应式断点与拖拽调宽；未跑全量测试（按要求仅 `tests/ui/` + typecheck） | UI 真机观感未验证 | 如需，可补 `npm run dev` 实机走查并跑全量 |

---

## 9. 复现步骤

```bash
cd /Users/tina/Desktop/1018
git log -1 --format=%h          # 应为 9da451c
git status --porcelain -uall    # 应为空
npx tsx .stagent/ui-e2e/run.ts  # 驱动器（位于 .stagent/，已被 .gitignore 忽略）
```

产物：

- 指标：`.stagent/ui-e2e/run-1792669865281.json`
- 逐行终端输出：`.stagent/ui-e2e/terminal-1792669865281.log`
- 合同 / 证据：`.stagent/contracts/…json`、`.stagent/evidence/…json`

> 说明：驱动器与载荷放在 `.stagent/`（gitignored）而非 `scripts/`，是为了在运行期保持主工作树 `clean`——否则 Gate 4 会以 `E_MAIN_TREE_DIRTY` 直接阻断。

# TASK-S.1 交付与验证报告

- **任务**：Supervisor 建议会话与持久化存储管理
- **日期**：2026-10-20
- **代码状态**：已完成，**未提交**（按指令暂不 commit）
- **目录约定**：按既定路径映射落盘 `daemon/supervisor/`（未新建 `src/supervisor/`）

---

## 1. 交付物清单

### 1.1 新增实现（6 文件 / 1,412 行）

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `daemon/supervisor/types.ts` | 158 | 会话/消息/上下文/Prompt 结构定义；`schema_version = 1.0.0` |
| `daemon/supervisor/session-manager.ts` | 512 | Local-First 会话落盘、加载、列表、清除、崩溃恢复、结构校验 |
| `daemon/supervisor/prompt-builder.ts` | 265 | Prompt 五段流水线 + 预算感知的对话窗口裁剪 |
| `daemon/supervisor/permissions.ts` | 276 | G-11b 运行时越权拦截 + `GATEWAY_VIOLATION` 审计（JSONL + 帧载荷） |
| `daemon/supervisor/budget.ts` | 187 | 合同共享账本适配：模型调用前置校验 + 用量回写 |
| `daemon/supervisor/index.ts` | 14 | 模块出口 + 依赖纪律声明 |

### 1.2 修改（1 文件）

- `daemon/index.ts`：新增 `export * from "./supervisor"`。

### 1.3 新增测试（4 文件 / 1,197 行 / 38 用例）

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/unit/supervisor-session.test.ts` | 20 | 落盘/加载/列表/清除、0600+0700、损坏隔离、孤儿临时文件清理、路径穿越、非法结构拒绝、Prompt 五段与窗口裁剪 |
| `tests/unit/supervisor-zero-tool-lint.test.ts` | 5 | TS AST 静态扫描（import / export-from / require / 动态 import）+ 传递闭包 + 负例控制 |
| `tests/unit/supervisor-runtime-permission.test.ts` | 7 | 4 类特权调用 100% 拒绝、只读透传、未知方法默认拒绝、审计落盘与帧载荷 |
| `tests/unit/supervisor-budget.test.ts` | 6 | 共享账本超额前置阻断、用量回写、跨实例持久化、`cost_limits` 折算 |

---

## 2. 实现要点与代码证据

### 2.1 Local-First 会话持久化（0600 / 原子写入）

- 路径：`<repo>/.stagent/sessions/{session_id}.json`，目录 `0700`、文件 `0600`（构造与写入后各 `chmod` 一次，规避旧版本宽权限残留）。
- 写入复用 `src/lib/state-machine.ts` 的 `writeJsonAtomic`（`temp → fsync → rename → 目录 fsync`），复用而非重写，保证与合同状态写入同一份原子实现。
- `session_id` 白名单 `^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$`，非法 id 抛 `E_FORBIDDEN_PATH`，从入口阻断路径穿越。
- `recover()`：损坏文件隔离为 `*.corrupt-{ts}`（保留证据不删除）、清理孤儿 `.tmp-{pid}-{ts}`、返回健康会话。

### 2.2 Prompt 组装流水线

五段固定结构：`角色与权限边界` → `项目现状` → `架构约束` → `最近事件摘要`（可选）→ `对话上下文` → `输出格式`。

- 系统段显式声明零工具、不可批准/合并/写 verdict；
- 窗口裁剪从新到旧填充，超出预算的消息 id 记入 `dropped_message_ids`；单条超预算时截断并标记 `…[truncated]`，**已纳入消息不会误记入 dropped**（有独立回归用例）。

### 2.3 静态依赖禁令（Zero-Tool Invariant）

`tests/unit/supervisor-zero-tool-lint.test.ts` 用 TypeScript Compiler API 构建 import 图（含 `require` 与动态 `import()`），沿相对路径做传递闭包：

- 黑名单：`child_process`、`daemon/mcp/gateway`、`daemon/pipeline/merger`、`daemon/pipeline/orchestrator`、`daemon/pipeline/contract-store`、`daemon/runner/command-runner`、`daemon/git/worktree-manager`、`daemon/git/branch-guard`、`daemon/worker/ai-worker`、`daemon/recovery/crash-recovery`、`daemon/core/contract-mutex`、`daemon/server`；
- 断言传递闭包确实穿透到 `src/lib/state-machine`、`daemon/guard/cost-monitor`（证明不是只扫第一层）；
- 负例控制：构造含 5 类违规引用的 fixture，扫描器全部识别。

### 2.4 运行时越权拦截（G-11b）

`createSupervisorControlPlane(real, { audit })` 返回只读视图：

- 只读白名单（`getContract` / `listContracts` / `getEvidence` / `getSession` / `getStatus`）绑定透传；
- `approveContract` / `mergeContract` / `setVerdict` / `execCommand` 及其余任何函数属性 → **先写 `GATEWAY_VIOLATION` 审计，再抛 `SupervisorPermissionDeniedError`**（`code = E_UNAUTHORIZED_COMMAND`，`reason_code = UNAUTHORIZED_COMMAND`）；
- 审计通道自身抛错时仍然拒绝（不会因审计故障放行）；
- 审计入口 `createSupervisorViolationAuditor` 追加写 `.stagent/audit/supervisor-violations.jsonl`（0600，逐行 JSON + fsync），并可注入 `sink` 供 Daemon 广播为 WebSocket 帧（`toGatewayViolationPayload`）。

### 2.5 共享预算控制

`SupervisorBudgetLedger` 不自建账本，接收合同同一个 `CostMonitor` 实例（同 `statePath` 即同账本）：

- `assertCanCallModel()` → `CostMonitor.assertCanConsume()`，超额抛 `E_BUDGET_EXCEEDED`；
- `runModelCall()`：校验 → 调用 → `recordUsage(..., { agent: "supervisor", contract_id })`，调用前阻断时 `call` 完全不会执行；
- `fromCostLimits()` 将合同 `cost_limits` 的 input+output 上限折算为合计上限（缺一则不设 token 上限，避免臆造），金额上限与币种直通。

---

## 3. 门禁结果

> 以下为**会话重启后、以最终代码**在干净环境复跑的权威戳记（2026-10-20 04:11）。

| 门禁 | 退出码 | 结果 |
| --- | --- | --- |
| `npm test`（全量） | **0** | **52 文件 / 428 用例全绿**，0 失败 |
| `npm run typecheck`（`tsc --noEmit`） | **0** | 0 错误 |
| `npx eslint`（daemon/supervisor、daemon/index.ts、4 个新测试 + 全仓逐目录覆盖 10 个目标） | **0** | 0 违规 |
| `npx prettier --check`（6 实现 + 4 测试 + `daemon/index.ts`） | 0 | All matched files use Prettier code style |

### 3.1 分组测试证据

| 测试文件 | 用例数 | 结果 |
| --- | --- | --- |
| `tests/unit/supervisor-session.test.ts` | 20 | ✓ |
| `tests/unit/supervisor-runtime-permission.test.ts` | 7 | ✓ |
| `tests/unit/supervisor-budget.test.ts` | 6 | ✓ |
| `tests/unit/supervisor-zero-tool-lint.test.ts` | 5 | ✓ |
| **Supervisor 小计** | **38** | **全部通过** |
| 全量合计 | 428 | 52 文件全通过，`FAILED_CASES=0` |

---

## 4. 环境阻断（已解除，留档说明）

会话进行到 03:34 时，一次并行测试进程被 SIGTERM（exit 137）终止，之后 **safe-delete 守护的状态目录变为不可写**：

- `fs.unlinkSync` / `rm` / Python `os.unlink` 全部返回 `[safe-delete][SAFE_DELETE_BULK_GUARD_ERROR] state lock timeout`；
- 守护自身 `state.json` 的 `rename` 返回 `EPERM`，导致它无法清理自己的 `.lock`；
- 结果：**任何删除操作**（含测试内的临时目录清理）都被拒绝，全量运行出现 31 个文件失败，失败堆栈 100% 落在 `node-safe-delete-shim.cjs`（588 项删除被拒），无一条断言级失败指向本次新增代码。

受影响的两个用例（`manager.clear()`、`recover()` 孤儿临时文件清理）在环境故障期间失败，**根因确认为工具链环境而非实现缺陷**。

**解除与复验**：会话重启后删除能力恢复（`rm` 探测返回 `RM_OK`），已以最终代码复跑全量测试，`clear()` 与孤儿清理两项用例随之通过，§3 门禁即为该次戳记。同期清理了环境故障期间遗留的 3 个 4 字节 `blat` 探测残留（`1zs1uawd`、`z7gshym2`、`uyrvtqhd`），`git status` 现仅含本卡片改动。

---

## 5. 规范偏差与说明

1. **只读白名单为显式登记制**（比规范更严）：未登记方法默认拒绝，避免「换个方法名即绕过」。
2. **审计事件双出口**：JSONL 落盘保证留痕，`sink` 供 Daemon 转发 `GATEWAY_VIOLATION` 帧；帧广播接线属 TASK-S.3 范围。
3. **预算镜像仅展示**：会话文件里的 `usage` 快照不参与放行判断，唯一权威是合同 `CostMonitor`。
4. **`CostMonitor` 币种语义为既有实现**：金额最小单位按 ×100 折算，跨币种换算能力仍属既有账本边界，本卡片未扩展。
5. **`E_UNAUTHORIZED_COMMAND` 常量改名**：`daemon/index.ts` 的 barrel 与 `runner/command-runner` 同名导出冲突，改为 `SUPERVISOR_PERMISSION_ERROR_CODE`（值不变，避免破坏 `err.code` 判定）。

---

## 6. 后续修订（2026-10-22 · Sprint 4 核验发现，本报告上述口径已失效处）

> 本节由 Sprint 4（分支 `feat/s1-s2-supervisor-draft-pipeline`）回填。**本报告 §1~§5 记录的 2026-10-20 交付仍成立（会话管理 / 提示词 / 越权拦截 / AST 零工具四块未改动），但"预算"部分的口径与 v1.3.3 分账要求相反，已在 Sprint 4 纠正。**

1. **§5 第 3 条「唯一权威是合同 `CostMonitor`」失效**。`1a75616` 的 `daemon/supervisor/budget.ts` 是**复用合同同一个 `CostMonitor` 实例**（提交说明原文：*"复用合同同一 CostMonitor 账本"*），实为"混账"，与 v1.3.3 §S.1「Supervisor 拥有独立日预算（`.stagent/supervisor-budget.json`），不再计入当前合同账本」直接冲突。当时报告把它记为"已完成"，属**结论下得过早**，本次如实更正。
2. **现行实现**：`SupervisorBudgetLedger.independent({ repoRoot })` 自建 `CostMonitor` 并落盘 `.stagent/supervisor-budget.json`；默认日预算 `DEFAULT_SUPERVISOR_DAILY_BUDGET` = 200k tokens / 50.00 CNY，**不读取合同 `cost_limits`**。`fromCostLimits()` 保留但已标注为测试/自定义额度辅助入口，生产路径不得用它把合同额度接进 Supervisor。
3. **测试口径重写**：`tests/unit/supervisor-budget.test.ts` 由 6 例改为 7 例，新增「Worker 合同账本零污染」与「重启后累计值恢复」断言；S.1 四套件由 38 例变为 **39 例**（6→7）。
4. **`throttler.ts` 归属澄清**：本报告未交付 `daemon/supervisor/throttler.ts`，该文件**从未进入 main**，仅存于未合并分支 `wip/s2-s3-supervisor-old-design`（`2319459`）；其中"18 例防抖用例"同样只在该分支。TASK-S.1 因该项仍缺而维持 `[PARTIAL]`。

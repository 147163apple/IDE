# TASK-D.3 交付说明：15 状态投影持久化与防死锁自愈引擎

- 工作分支：`feat/task-d3-deadlock-persistence`（工作树 `/Users/tina/Desktop/1020-d3p`，合入后已移除）
- 基线：`main@9f3b303`（开工瞬间最新 main；相对用户给定 `5117b27` 仅多 C.7 文档回写）
- 规范依据：《Stagent 系统架构设计规范 v1.6.1》§6.3.1 / §9.6 / P3.7；《研发任务拆解规范 v1.6.2》TASK-D.3
- 门禁结果：合后四件套全绿（**1084 passed / 6 skipped**）；`tsc` 0 错、eslint 0 错、build 通过
- 合入主线：`main` merge `9a19f4d`（2026-10-23）；功能提交 `c2fcb8a` + `83ec516`；首段投影词汇表 `f548aeb`

## 1. 交付清单

| 层 | 文件 | 内容 |
| :--- | :--- | :--- |
| 共享词汇表 | `src/lib/state/presentation-state.ts` | 15 态确定性投影（daemon/前端共用；首段 `f548aeb`） |
| 持久化 | `daemon/state/presentation-store.ts` | `.stagent/state.json` 原子落盘；与 contracts 并列 |
| 投影接线 | `daemon/state/presentation-projector.ts` | Daemon 侧投影 + `STATE_CHANGED` 广播与重连回放 |
| 看门狗 | `daemon/state/deadlock-resilience.ts` | D-1~D-5；可注入时钟 + `sweep`；钩子可故障注入 |
| D-2 接线 | `daemon/core/contract-mutex.ts` | 租约 acquire/renew(15s)/release；锁文件白名单回收 |
| D-4 接线 | `daemon/pipeline/merger.ts`、`orchestrator.ts`、`server.ts` | 合并前基线校验；409 + 二选一；`merge-decision`；真重演路径 |
| D-5 接线 | `daemon/mcp/gateway.ts`、`command-runner.ts` | 60/300/600s 分层；pid 回填；超时证据 |
| D-1/D-3 | `orchestrator.ts` / server 钩子 | abort 超时回收；`PENDING_RESUME` → `healResume` |
| 测试 | `presentation-persistence` / `deadlock-resilience` / `deadlock-call-sites` / `merge-decision-d4` 等 | 引擎故障注入 + 生产调用点 + HTTP 接线 |
| 规范回写 | `docs/Stagent_v0.1_Development_Tasks_Specification_v1.6.2.md` | §1.1 / 详细卡 `[PARTIAL]` → `[COMPLETED]`；基线 `main`@`9a19f4d` |

## 2. 关键设计取舍

1. **投影不写回合同**：展示态进 `state.json`，避免 `contract_revision` 误触发重新审批。
2. **看门狗不用裸定时器**：心跳驱动 `sweep`，挂起恢复后一次补齐；测试可停在 14 999 / 15 000 ms。
3. **先摘除再执行副作用**：杀进程失败不让条目留表每秒重试。
4. **信息不足不猜状态**：投影返回 `null` 时跳过广播与落盘，界面停在上一帧。

## 3. 门禁结果

| 项目 | 结果 |
| :--- | :--- |
| `npm run typecheck` | 0 error |
| `npm run lint` | 0 error（存量 react-refresh warning 非本卡引入） |
| `npm run build` | exit 0，dist 33 文件 / 3.31 MB |
| `npm test`（合后 main） | **1084 passed / 6 skipped / 0 failed** |

## 4. 残余口径差（不阻塞）

1. D-4 只比证据 `base_commit_sha` 与当前 main tip，不校验工作树真实 merge-base。
2. D-5 超时证据借用 `BLOCKED + BUDGET_EXHAUSTED` + `TIMEOUT:` 前缀（无独立 TIMEOUT verdict）。
3. D-1 强杀经 `orchestrator.abort` 进程树回收，非看门狗直接对 worker pid 发 SIGKILL。

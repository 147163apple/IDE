# TASK-S.1 交付说明：Supervisor 3s 唤醒节流器（默认关闭）

- 工作分支：`feat/task-s1-throttler`（保留，未删）
- 基线：`main@6d4f4a5`（C.2 文档回写后）
- 规范依据：《Stagent 系统架构设计规范 v1.6.1》A §2.2；《研发任务拆解规范 v1.6.2》TASK-S.1（v1.3.3 口径）
- 门禁结果：合后四件套全绿（**1122 passed / 6 skipped**）；`tsc` 0 错、eslint 0 错、build 通过（dist 33 文件 / 3.35 MB）
- 合入主线：`main` merge `a9066dd`（2026-10-24）；功能提交 `a7d7292`

## 1. 交付清单

| 层 | 文件 | 内容 |
| :--- | :--- | :--- |
| 节流器 | `daemon/supervisor/throttler.ts` | `SupervisorWakeupThrottler`：3s 防抖、显式/阻断/回合结束唤醒、Worker 硬静默、SNOOZE 10 分钟；`idleDebounceEnabled` 默认 `false` |
| 导出 | `daemon/supervisor/index.ts` | `export * from "./throttler"` |
| 对齐 | `mapWakeTriggerToDraftTrigger` | 与 `draft-generator` 触发枚举对齐（`IDLE_DEBOUNCE`→`DEBOUNCE_TIMER`） |
| 测试 | `tests/unit/supervisor-debounce-trigger.test.ts` | **23 例**（默认关闭 5 + 开启态历史 18） |
| 规范回写 | `docs/Stagent_v0.1_Development_Tasks_Specification_v1.6.2.md` | §1.1 / 详细卡 `[PARTIAL]` → `[COMPLETED]`；基线 `main`@`a9066dd` |

## 2. 关键设计取舍

1. **IDLE_DEBOUNCE 默认关闭**：打字不停评估；VIBE 连续聊天零 Supervisor 模型调用（除非用户点击或控制面事件）。
2. **从旧设计分支挑拣移植**：来源 `wip/s2-s3-supervisor-old-design`，按 v1.3.3 口径改默认关闭，不整支合入旧设计。
3. **时间源可注入**：单测精确停在 2999 / 3000 ms，无需真实等待。

## 3. 门禁结果

| 项目 | 结果 |
| :--- | :--- |
| `npm run typecheck` | 0 error |
| `npm run lint` | 0 error（存量 react-refresh warning 非本卡引入） |
| `npm run build` | exit 0，dist 33 文件 / 3.35 MB |
| `npm test`（合后 main） | **1122 passed / 6 skipped / 0 failed** |

## 4. 残余口径差（不阻塞）

1. Daemon 聊天/会话路由侧尚未挂载节流器实例（模块已导出，接聊天即可）。
2. 旧版「完成记录」中 2026-10-22「throttler 不在 main」归档校正注仍保留为历史，勿与本轮交付混读。

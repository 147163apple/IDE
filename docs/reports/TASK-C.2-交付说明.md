# TASK-C.2 交付说明：Studio 四视口壳与展示态智能切换

- 工作分支：`feat/task-c2-four-viewports`（保留，未删）
- 基线：`main@4e3f6c1`（D.3 文档回写后）
- 规范依据：《Stagent 系统架构设计规范 v1.6.1》P4 审批与多维视口；《研发任务拆解规范 v1.6.2》TASK-C.2
- 门禁结果：合后四件套全绿（**1099 passed / 6 skipped**）；`tsc` 0 错、eslint 0 错、build 通过（dist 33 文件 / 3.35 MB）
- 合入主线：`main` merge `51039aa`（2026-10-24）；功能提交 `c1ad3be`

## 1. 交付清单

| 层 | 文件 | 内容 |
| :--- | :--- | :--- |
| 视口壳 | `src/components/studio/StudioViewportShell.tsx` | 四视口统一挂载；`hidden` 保活，切换不丢表单与点亮 |
| Demo | `src/components/studio/DemoPreviewPane.tsx` | iframe 嵌入 S.4 预览；沙箱仅 `allow-scripts` |
| Graph | `src/components/studio/TaskGraphPane.tsx` | 复用 C.7 `TaskGraphPanel` |
| 质疑 | `src/components/studio/DisputeConsolePane.tsx` | 接入 S.5 质疑自查 API |
| 路由 | `src/components/studio/viewport-routing.ts` | 展示态 → 默认视口映射 |
| 流 | `src/hooks/use-daemon-stream.ts`、`src/lib/daemon-api.ts` | 消费 `presentation_state`（`STATE_CHANGED` + `GET /api/state`） |
| Origin | `src/lib/ipc/demo-origin.ts` | Demo 预览 Origin 辅助 |
| 路由页 | `src/routes/index.tsx`、`SupervisorStudioPane.tsx` | 中栏接入四视口壳 |
| 测试 | `tests/ui/studio-viewport-switching.test.tsx` | 15 例：手动切 / 智能切 / 保活 |
| 规范回写 | `docs/Stagent_v0.1_Development_Tasks_Specification_v1.6.2.md` | §1.1 / 详细卡 `[PARTIAL]` → `[COMPLETED]`；基线 `main`@`51039aa` |

## 2. 关键设计取舍

1. **默认视口只跟 Daemon 展示态**：不在前端猜状态；手动 Tab 可覆盖，展示态一变清覆盖。
2. **四视口同时挂载、`hidden` 切换**：避免卸载导致表单与点亮状态丢失。
3. **Demo iframe 沙箱收紧**：仅 `allow-scripts`，严禁 `allow-same-origin`，对齐 S.4 CSP / Origin 门禁。

## 3. 门禁结果

| 项目 | 结果 |
| :--- | :--- |
| `npm run typecheck` | 0 error |
| `npm run lint` | 0 error（存量 react-refresh warning 非本卡引入） |
| `npm run build` | exit 0，dist 33 文件 / 3.35 MB |
| `npm test`（合后 main） | **1099 passed / 6 skipped / 0 failed** |

## 4. 残余口径差（不阻塞）

1. 【修改原型】/【确认原型并实施真实工程】按钮 UI 在位，旅程编排层仍为弱接线。
2. 矩阵旧注「水表」非本卡 Pass 项，未纳入本次交付。

# TASK-S.6b 交付说明

- 状态：**[COMPLETED]**（2026-10-24）
- 合入：merge `024d2b8`；功能 `613ff51`（`feat/task-s6b-real-playtest`）
- 门禁：合后四件套全绿（**1165 passed / 6 skipped**）；`tsc` 0 错、eslint 0 错、build 通过

## 交付清单

| 项 | 说明 |
| --- | --- |
| 真机预览服务 | `daemon/supervisor/preview/`：4200–4210 静态 stub / attachUrl 外链 |
| Origin 防线 | `real-preview-origin.ts`；Daemon 拒预览 Origin 回连 |
| Studio 视口 | 第五 Tab「真机试玩」；`RealPlaytestPane` iframe +「在浏览器打开」 |
| 旅程分流 | `REAL_PLAYTEST` → `START_REAL_PLAYTEST`；右侧白话即可启动 |
| API | `POST /api/preview/real/start|stop`；`GET .../status`；帧 `REAL_PLAYTEST_STATUS` |

## 非目标（本卡未做）

- 关沙箱 / 密钥 / 架构大改
- W.5b/c、S.3 HUD、大抛光
- 完整业务仓库真施工（无产物时用试玩桩走通产品壳）

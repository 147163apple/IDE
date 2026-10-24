# Stagent v0.1 研发任务拆解与工程执行规范 (v1.6.2 代码事实对齐与卡片净化版)

> **版本定义与基线声明 (v1.6.2 · 2026-10-23)**：
> 1. **架构规范深度对齐**：本工程规范依据《Stagent 系统架构设计规范 (v1.6.1 代码对齐与规范定稿版)》全面修订签发，严格对齐其 §10 演进路线图（包含 P0.2c、P3.7、P4.5、P5.7 等关键里程碑）；
> 2. **代码物理基线明确**：当前本地物理 HEAD 为仓库 `main`@`6415fbd`（含 S.6 merge）。测试基线以合后四件套为准（**1155 passed / 6 skipped**）；本轮为文档状态回写（合后已实测四件套）。代码当前已交付数据模型为 Contract Schema v1.3.0（经 TASK-0.2c）；
> 3. **底座演进任务认领**：本规范新增 **`TASK-0.2c`**，明确认领架构规范之 P0.2c 里程碑（C-01 整改项），将 Schema v1.3.0（`approval`、`authorization.git`）、Fast Path 确定性流转边 (`DRAFT -> PREPARING -> EXECUTING`)、自愈迁移边 (`PENDING_RESUME -> PREPARING`) 与外部改码级联降级边 (`AUDITED -> VERIFYING`) 列为当前工程第一执行优先级；
> 4. **通信与防死锁引擎认领**：新增 **`TASK-D.3`**，认领架构规范之 P3.7 里程碑（15 展示状态确定性投影持久化与五类死锁自愈机制 D-1~D-5）；
> 5. **卡片状态净化**：已完成任务卡仅描述该卡已交付内容；后续增补需求拆为独立待办卡。新增 `TASK-W.2b` 与 `TASK-D.2b` 承接未跟踪文件 Scope 阻断和 v1.3 合同迁移接入，不再混入已完成卡。
> 6. **状态回写（2026-10-23）**：`TASK-C.7` 已合入 main（merge `5117b27`）。§1.1 矩阵与 §3.5 详细卡状态由 `[NEW_TASK]` 更新为 `[COMPLETED]`，并按实际代码校正卡片文件清单（`TaskGraphPanel` / `FunctionalTree` / `ExecutionDag`，含 `evidence-collector.ts`）。门禁：干净环境四件套全绿（1032 passed / 6 skipped）。残余口径差已在卡片内登记。
> 7. **状态回写（2026-10-23 · 文档校正）**：`TASK-W.2b` 由 `[NEW_TASK]` 更正为 `[COMPLETED]`（证据 `87f909c` / merge `05f090f`，`untracked-scope-guard` + `E_OUT_OF_SCOPE_UNTRACKED`）；`TASK-S.4` 去掉「待合入 main」并注明经 `d5ee448` 合入；`TASK-S.1` PARTIAL 备注校正为「L0/L1 已在 S.2，仅剩 3s 防抖节流器（main 无 `throttler.ts`）」；测试基线改写为 `main`@`9f3b303`，并以 C.7 干净环境复验（1032 passed / 6 skipped）为准。
> 8. **状态回写（2026-10-23 · D.3）**：`TASK-D.3` 由 `[PARTIAL]` 更新为 `[COMPLETED]`（merge `9a19f4d`，含 `c2fcb8a` 持久化/`STATE_CHANGED`/看门狗引擎 + `83ec516` D-2/D-4/D-5 生产接线）。§1.1 矩阵与详细卡状态同步回写；测试基线改写为 `main`@`9a19f4d`，合后四件套 **1084 passed / 6 skipped**。残余口径差已在卡片内登记。
> 9. **状态回写（2026-10-24 · C.2）**：`TASK-C.2` 由 `[PARTIAL]` 更新为 `[COMPLETED]`（merge `51039aa`，功能提交 `c1ad3be`：Studio 四视口壳 + 展示态智能切换）。§1.1 矩阵与详细卡状态同步回写；测试基线改写为 `main`@`51039aa`，合后四件套 **1099 passed / 6 skipped**。残余口径差已在卡片内登记。
> 10. **状态回写（2026-10-24 · S.1）**：`TASK-S.1` 由 `[PARTIAL]` 更新为 `[COMPLETED]`（merge `a9066dd`，功能提交 `a7d7292`：`SupervisorWakeupThrottler` 3s 防抖默认关闭）。§1.1 矩阵与详细卡状态同步回写；测试基线改写为 `main`@`a9066dd`，合后四件套 **1122 passed / 6 skipped**。残余口径差已在卡片内登记。
> 11. **状态回写（2026-10-24 · S.6 立卡）**：新增 **`TASK-S.6` 非技术旅程串联**（当时 `[NEW_TASK]`）。吸收 `TASK-C.2` 残余「【修改原型】/【确认原型并实施真实工程】弱接线」；`TASK-S.3` 仍为 `[DEFERRED → v0.2+]`；**不改**架构规范 v1.6.1。对照：`docs/reports/非技术用户旅程验收稿.md`。
> 12. **状态回写（2026-10-24 · S.6 合入）**：`TASK-S.6` 由 `[NEW_TASK]` 更新为 `[COMPLETED]`（merge `6415fbd`，功能 `bbab79e`；合后四件套 **1155 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：右侧确定性分流（质疑/Fast Path/大事草案）、`POST /api/supervisor/journey`、确认原型真建全灰 TaskGraph、需求说明可感知刷新、视口建议切换。**降级登记 S.6b**：`REAL_PLAYTEST` 真预览 URL 挂中栏/外链未做，不阻塞 1–4。
> 13. **状态回写（2026-10-24 · S.6b 合入）**：`TASK-S.6b`（原 S.6 降级项）标 **[COMPLETED]**（merge `024d2b8`，功能 `613ff51`；合后四件套 **1165 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：真机预览 4200–4210 + stub/attach、Studio「真机试玩」视口 iframe/外链、旅程 `REAL_PLAYTEST`→`START_REAL_PLAYTEST`、Origin 防线。不改架构规范；未做 W.5b/c / S.3 HUD。
> 14. **状态回写（2026-10-24 · D.1b 立卡）**：新增 **`TASK-D.1b` 一键打开项目（Daemon 托管控制台 + open CLI）**（`[NEW_TASK]`）。前置 `TASK-D.1`；目标 `stagent open <路径>` → 单浏览器窗口工作台已连上，无需第二终端/手拷 Token。**不改**架构规范 v1.6.1、不改产品代码；不推翻 D.1 鉴权；不含 Electron/Tauri/系统协议。
> 15. **状态回写（2026-10-24 · D.1b 合入）**：`TASK-D.1b` 由 `[NEW_TASK]` 更新为 `[COMPLETED]`（merge `d5b35e0`，功能 `946e9fc`；合后四件套 **1188 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：`stagent open <路径>` 复用/启动 Daemon、同源托管 `dist/public`、自动打开 `#token=&base=` 单窗口；无钥匙拒连；`E_WORKSPACE_LOCKED` 白话；Demo 仍独立 Origin。不改架构规范；不含 Electron/Tauri/系统协议。
> 16. **状态回写（2026-10-24 · D.1c 立卡）**：新增 **`TASK-D.1c` 最近项目一键重开**（`[NEW_TASK]`）。前置 `TASK-D.1b`；目标：控制台「打开项目」展示最近列表，一点即复用/唤起带 token 会话，无需再敲 `stagent open`；**不含**真·任意路径文件夹选择器（留给本机助手/Electron）。**不改**架构规范 v1.6.1、不改产品代码；不推翻 D.1/D.1b 鉴权。
> 17. **状态回写（2026-10-24 · D.1c 合入）**：`TASK-D.1c` 由 `[NEW_TASK]` 更新为 `[COMPLETED]`（合入 main tip `f3e371e`，分支 `feat/task-d1c-recent-projects` 快进；合后四件套 **1204 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：本机 `~/.stagent/recent-projects.json` 最近列表；`stagent open` 成功写入；控制台「打开项目」一点重开带 `#token=`；`GET/POST /api/recent-projects`；不含任意路径选择器。不改架构规范；不推翻 D.1/D.1b 鉴权。
> 18. **状态回写（2026-10-24 · D.1d / D.1e 立卡 · 打开项目生产级文档）**：新增 **`TASK-D.1d` 修复同源控制台空白（生产可用单窗口）**（`[NEW_TASK]`）与 **`TASK-D.1e` 桌面壳/本机助手真·选文件夹**（`[NEW_TASK]`，**可 defer**）。登记 D.1b 已知缺陷：`dist/public/index.html` 静态壳无法驱动 TanStack Start 控制台 → `stagent open` 同源页空白；临时绕路 Vite + `#token=` / `#base=`。对照：`docs/reports/打开项目-愿景与现状.md`。**不改**产品代码；架构规范仅 §11 短注「控制台可同源托管 vs Demo 必须独立 Origin」；不推翻 D.1 loopback+#token；Demo 仍独立 Origin。
> 19. **状态回写（2026-10-24 · Tina 口径对齐 · 打开项目施工合同）**：按产品负责人口径修订——`TASK-D.1d` 前置明确为 `TASK-D.1b` + `TASK-C.2`（均为 COMPLETED），状态 `[NEW_TASK]`，作为非技术可用性**当前最高优先** DX 修复；验收含四件套 + `dist` 静态可用性回归；`TASK-D.1e` 由「NEW 可 defer」改为 **`[DEFERRED → v0.2+]`**（P5.8，不阻塞 v0.1 / D.1d）；Sprint：D.1d 为非技术进门关键门禁，与已合入的 S.6 旅程串联形成优先/并行关系。架构规范仅轻量锚定（单窗口静态 SPA 可由 Daemon 服务；系统文件夹选择器 v0.2+ P5.8），**不推翻** ADR-008 / Demo 独立 Origin / loopback+#token。本轮仍**仅文档**。
> 20. **状态回写（2026-10-24 · D.1d 合入）**：`TASK-D.1d` 由 `[IN_PROGRESS → 功能分支待合]` 更新为 **`[COMPLETED]`**（合入 main tip `b11d15b`，分支 `feat/task-d1d-same-origin-console` 快进；合后四件套 **1208 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：启用 `tanstackStart.spa`；`scripts/package-dist.mjs` 将预渲染 `_shell.html` 提升为 `dist/public/index.html`；`daemon/console/static-host.ts` 仅托管含 `$_TSR` + `index-*.js` 的可 hydrate 壳；新增 `console-dist-spa-shell` 等 dist 静态可用性回归。不推翻 D.1 loopback+#token/AUTH/Origin；Demo 仍独立 Origin。**本轮不改**架构规范 v1.6.1（已有 §4.4 / §11 注记 8 轻量锚定）。
> 21. **状态回写（2026-10-24 · UX 走查 Top3 立卡）**：同源单窗口可用后，非技术走查发现「能开但不能舒服用」。新增 **`TASK-C.8a`**（老板模式文案与默认助手 / 消演示恐吓与 Key 向导）、**`TASK-C.8b`**（Fast Path 老板三步台）、**`TASK-C.8c`**（连接与打开死路自救：无钥匙一键重开 + 粘贴路径打开；**不含** D.1e 系统选择器）三张 `[NEW_TASK]`。前置均锚定 `TASK-D.1d` COMPLETED（`b11d15b` / 文档基线 `fea44e2`）；C.8b 另依赖 `TASK-S.6`；C.8c 依赖 D.1b/D.1c/D.1d 且不抢 D.1e。建议排期 **C.8a → C.8c → C.8b**；**当前首要**指向 C.8a。对照：`docs/reports/工作台交互走查-2026-10-24.md`。**本轮仅文档**；**不改**架构规范（老板模式文案层不改变鉴权 / Demo Origin）。
> 22. **状态回写（2026-10-24 · C.8a 合入）**：`TASK-C.8a` 由 `[IN_PROGRESS]`（`feat/task-c8a-boss-copy`）更新为 **`[COMPLETED]`**（合入 main tip `15ef8e6`，分支快进；合后四件套 **1213 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：演示改为可折叠「练习沙箱」；收起「不调用模型」大黄恐吓；默认优先真助手；未配 Key 时右栏三步向导一键进设置；设置页模型钥匙白话闭环。**不推翻** D.1 鉴权 / Demo Origin；**本轮不改**架构规范 v1.6.1（老板模式仅文案/默认助手呈现）。
> 23. **状态回写（2026-10-24 · C.8c 合入）**：`TASK-C.8c` 由 `[NEW_TASK]`（`feat/task-c8c-open-rescue`）更新为 **`[COMPLETED]`**（合入 main tip `950e53e`，分支快进；合后四件套 **1217 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：无钥匙冷开 `POST /api/session/relaunch` 一键重开带钥匙会话；已鉴权可粘贴绝对路径经 `/api/recent-projects/open` 打开已存在目录；打开面板/空态少催终端与 `#token=`，高级说明折叠。**不抢** `TASK-D.1e`（系统选夹仍 DEFERRED）；**不推翻** D.1 鉴权 / Demo Origin；**本轮不改**架构规范 v1.6.1。
> 24. **状态回写（2026-10-24 · C.8b 合入）**：`TASK-C.8b` 由 `[NEW_TASK]`（`feat/task-c8b-boss-fastpath`）更新为 **`[COMPLETED]`**（合入 main tip `6d16939`，分支快进；合后四件套 **1224 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：小事 Fast Path 中栏默认老板三步「改哪里 / 要不要动保护 / 确认开改」；Scope glob、npm、Daemon、工程师合同细节收入可折叠高级详情；保护命中必须勾选才能开改；中/高风险大事仍走完整合同台。**不改** Fast Path 准入规则与状态机边；**不推翻** D.1 鉴权 / Demo Origin；**本轮不改**架构规范 v1.6.1。
> 25. **状态回写（2026-10-24 · UX 第二轮走查立卡 · 页面逻辑指挥权）**：C.8 Top3 合入后二次走查发现「多个指挥官同时喊」。新增 **`TASK-C.9a`**（首屏单一主路径：无钥匙/有钥匙空闲/进行中三态只留一个指挥信号）、**`TASK-C.9b`**（助手模式互斥：练习 vs 真助手 vs 向导；发送键与中栏随模式）、**`TASK-C.9c`**（打开项目面板生命周期：默认收、成功即关、已连接降级为切换）、**`TASK-C.9d`**（进行中中栏让路：对话/三步台时收欢迎页；设置从向导深链并回跳）四张 `[NEW_TASK]`。前置均锚定 `TASK-C.8a`/`C.8b`/`C.8c` COMPLETED（main tip `15ef8e6` / `950e53e` / `6d16939`，文档基线 `4853823`）。建议排期 **C.9a → C.9b → C.9c → C.9d**；**当前首要**指向 **C.9a**。对照：`docs/reports/工作台交互走查-2026-10-24.md` §5（第二轮）。**本轮仅文档**；**不改**架构规范（呈现/面板生命周期不改变鉴权 / Demo Origin）。
> 26. **状态回写（2026-10-24 · C.9a 合入）**：`TASK-C.9a` 由 `[NEW_TASK]`（`feat/task-c9a-single-command-surface`）更新为 **`[COMPLETED]`**（合入 main tip `ef0e1a7`，分支快进；合后四件套 **1231 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：`resolveCommandSurface` 三态（no_key / idle / in_progress）单一主 CTA；欢迎区/打开面板/顶栏徽标降级；UI+单元回归。**不推翻**鉴权 / Demo Origin；架构规范仅 §11 注记 9 轻量锚定（呈现纪律；不改变鉴权/Demo Origin）。
> 27. **状态回写（2026-10-24 · C.9b 合入）**：`TASK-C.9b` 由 `[NEW_TASK]`（`feat/task-c9b-assistant-mode-mutex`）更新为 **`[COMPLETED]`**（合入 main tip `c4818fa`，分支快进；合后四件套 **1239 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：`resolveAssistantMode` 三态互斥（wizard / practice / real）；向导态发送禁用+唯一去配置；练习横幅；中栏随模式；`assistant-mode.ts` + UI/单元回归。**不推翻**鉴权 / 真实云调用门禁；架构规范仅 §11 注记 9 轻量锚定延续（呈现层）。
> 28. **状态回写（2026-10-24 · C.9c 合入）**：`TASK-C.9c` 由 `[NEW_TASK]`（`feat/task-c9c-open-panel-lifecycle`）更新为 **`[COMPLETED]`**（合入 main tip `2f5d653`，分支快进；合后四件套 **1246 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：默认收起；打开/切换/重开成功即关；已连接入口「切换项目」；`open-project-panel.ts` + UI/单元回归。**不抢** D.1e；**不回退** C.8c；架构规范仅 §11 注记 9 轻量锚定延续。
> 29. **状态回写（2026-10-24 · C.9d 合入）**：`TASK-C.9d` 由 `[NEW_TASK]`（`feat/task-c9d-middle-yield-settings-return`）更新为 **`[COMPLETED]`**（合入 main tip `edc28ce`，分支快进；合后四件套 **1254 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：进行中 `middle-yield` 收欢迎页；三步台/保护确认自动开 Studio；设置深链模型钥匙 +「配完了，返回对话」；PROTECTED 聊≠改白话。**不含**重做 Studio 四视口；架构规范仅 §11 注记 9 轻量锚定延续。C.9a–d 第二轮指挥权收口。
> 30. **状态回写（2026-10-24 · UX 第三轮走查立卡 · 进行中收口与设置老板主路径）**：C.9 合入后三次走查发现「进行中粘住空壳」与「设置仍像机房」。新增 **`TASK-C.10a`**（进行中生命周期收口：旅程/确认/Fast Path 结束后退出 in_progress；中栏无确认/三步台时不要空 middle-yield 壳）、**`TASK-C.10b`**（设置页老板主路径：模型钥匙主视线；Daemon/Token/工程师项收进「高级」；保留 C.9d 深链+回跳）、**`TASK-C.10c`**（可选/可并入统一抛光：界面暗号清扫，**不挡** C.10a/b，本轮标 **`[DEFERRED · 可并入统一抛光]`**）三张卡。前置：C.10a ← C.9a+C.9d；C.10b ← C.9d+C.8a。建议排期 **C.10a → C.10b**；**当前首要**指向 **C.10a**。对照：`docs/reports/工作台交互走查-2026-10-24.md` §6（第三轮）。**本轮仅文档**；架构规范仅 §11 注记 9 轻量续写（进行中退出/设置呈现层级，不改变鉴权/Demo Origin）。
> 31. **状态回写（2026-10-24 · C.10a 合入）**：`TASK-C.10a` 由 `[NEW_TASK]`（`feat/task-c10a-in-progress-lifecycle`）更新为 **`[COMPLETED]`**（合入 main tip `5207df2`，分支快进；合后四件套 **1261 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：`resolveActiveInProgress` / `shouldRenderMiddleYieldShell`；历史旅程卡不粘住 in_progress；无确认/三步台不空让路壳；三步台进行中保持 Studio；单元+UI 回归。**不推翻**鉴权 / Studio 四视口；架构规范仅 §11 注记 9 轻量锚定延续。
> 32. **状态回写（2026-10-24 · C.10b 合入）**：`TASK-C.10b` 由 `[NEW_TASK]`（`feat/task-c10b-settings-boss-path`）更新为 **`[COMPLETED]`**（合入 main tip `be33a26`，分支快进；合后四件套 **1265 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：设置页主视线「模型钥匙」置顶；Daemon / Session Token / 运行诊断 / 工作区收进默认折叠 `settings-advanced`；保留 C.9d 深链与「配完了，返回对话」。**不推翻**鉴权语义；token 能力保留仅藏层级。`TASK-C.10c` 仍 **DEFERRED**。
> 33. **状态回写（2026-10-24 · C.10c 正式立卡 · 界面暗号/命名清扫）**：按 Tina 对齐范围将 **`TASK-C.10c`** 由 `[DEFERRED · 可并入统一抛光]` 升为 **`[NEW_TASK]`**。 范围：单壳多标签不拆多路由；白话改名（Supervisor→「项目审阅」；Supervisor Studio→「合同操作台」与 C.8b 一致；SmartTerminal/底栏→「验证输出」；ActivityBar title 去英文暗号）；收掉任务图谱双入口（日常只留合同操作台内视口，左栏入口改指向该视口或弱化）；可选弱化空闲「说需求/新建需求」双 CTA。 **不重做** C.9/C.10a/b 指挥纪律；**不改**鉴权；**不抢** D.1e。前置：C.10a/b COMPLETED。**当前首要**→ **C.10c**。 对照：走查报告 §6 别扭#4–7 + 页面分层说明。**本轮先文档**；架构规范仅 §11 注记 9 轻量续写（命名/入口呈现，不改变鉴权/Demo Origin）。

## 1. 任务体系与研发全景矩阵 (Engineering Matrix)

### 1.1 研发任务与规范 §10 路线映射表 (v1.6.2：完成状态与新增待办分离)

> **测试数量口径（v1.6.2）**：任务卡中的历史文件/用例数仅供溯源；当前物理代码 HEAD 仍以 `main`@`be33a26`（C.10b）为准（C.10c 本轮仅文档立卡）；文档基线以本条回写 tip 为准。测试基线以最近代码合入四件套为准（**1265 passed / 6 skipped**）。

| 任务编号 | 任务名称 | 归属模块 | 状态 | 规范 §10 里程碑 | 关键变动与工程闭环要点 (v1.6.1) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-0.1** | 工程锁文件与跨平台 CI 自动化基线 | 基础设施 | **[COMPLETED]** | P0 基础设施 | 依赖锁死、`verify-env.mjs` 门禁脚本、跨平台环境校验已就绪。 |
| **TASK-0.2b** | Schema v1.2.0 增量演进、双状态机联动与存量迁移 | 数据模型 | **[COMPLETED]**（提交 `52c807c` 锁定基线；当前物理基线已交付） | P0 契约底座 | • 升级 `SoftwareContractV12` 与 `EvidenceBundleV11` 完整字段<br>• 实现 `validateStatePair`、`validateTransition` 与原子落盘<br>• 承接历史合同迁移与备份机制，10 错误码映射通过 |
| **TASK-0.2c** | Schema v1.3.0 增量演进、Fast Path 与自愈迁移边实现 | 数据模型与状态机 | **[COMPLETED]**（提交 `fb2cc67`，经 `cd7e7e0` 合入 main；tsc 0 错 / eslint 0 错；新增 48 项单测、迁移矩阵 +7，全量 903 例） | P0.2c 契约与状态机演进 (C-01) | • 认领 C-01 整改项，代码落地第一优先级<br>• 升级 `SoftwareContractV13` 与 Zod Schema，增设 `approval` 与 `authorization.git`<br>• 补齐 Fast Path 严格流转边 (`DRAFT -> PREPARING -> EXECUTING`，严禁直跳)<br>• 补齐外部改码级联降级边 (`AUDITED -> VERIFYING`，使 Evidence 失效并回退重验)<br>• 补齐恢复探测自愈边 (`PENDING_RESUME -> PREPARING`，探测 Worktree 丢失自愈重建)<br>• 升级 `migrateContractToV13`，执行态族白名单回填 (`user:legacy`)，草案/待审安全保持，零静默授权<br>• 新增 `tests/unit/contract-schema-v13.test.ts`、9 态 lifecycle 迁移矩阵覆盖及 15 态展示投影测试 |
| **TASK-D.1** | CLI 引导入口与安全 WebSocket 通信桥 | 通信核销 | **[COMPLETED]**（2026-10-20；48 文件 / 377 用例全绿，含首帧 50ms 切断、Token 轮换、Origin/Host/2MB/速率/心跳断言） | P1 通信鉴权 | • 提前至 Sprint 1 解除 DAG 死锁<br>• CLI `stagent start`、动态端口 (3001~3010)、PID 锁与 Token 轮换 (G-13)<br>• 检测到存活 PID 锁时抛出 `E_WORKSPACE_LOCKED` 拒绝重复绑定工作区<br>• 首帧 AUTH 握手鉴权、非法以 `4401` 关闭<br>• 规范帧字典（同时保留 `EVIDENCE_READY`、`EVIDENCE_STATUS_CHANGED`、`TERMINAL_STREAM`）<br>• 补齐 Origin 校验、帧大小（≤2MB）与速率限制、失联 3 次心跳遮罩 |
| **TASK-D.1b** | 一键打开项目（Daemon 托管控制台 + open CLI） | 通信核销 / DX | **[COMPLETED]**（2026-10-24 合入 main，merge `d5b35e0`；功能 `946e9fc`；合后四件套 1188 passed / 6 skipped） | P1 通信鉴权（DX 增量） | • `stagent open <路径>` → 单浏览器窗口工作台已连上，无需第二终端/手拷 Token<br>• Daemon 托管 `dist/public` 同源控制台；自动 open `#token=` fragment；`#base=` 避免死认 3001<br>• Demo 仍独立 Origin（4100~4110）；不推翻 D.1 鉴权；不含 Electron/Tauri/系统协议 |
| **TASK-D.1c** | 最近项目一键重开（控制台「打开项目」） | 通信核销 / DX | **[COMPLETED]**（2026-10-24 合入 main，tip `f3e371e`；合后四件套 1204 passed / 6 skipped） | P1 通信鉴权（DX 增量） | • 控制台「打开项目」展示最近工作区列表；一点即复用/唤起带 `#token=` 会话，无需再敲 `stagent open`<br>• 本机 `~/.stagent/recent-projects.json`（非业务仓保护区）；`stagent open` 成功写入；`GET/POST /api/recent-projects`<br>• **不含**真·任意路径文件夹选择器；不推翻 D.1/D.1b 鉴权；锁冲突白话 |
| **TASK-D.1d** | 修复同源控制台空白（生产可用单窗口） | 通信核销 / DX | **[COMPLETED]**（2026-10-24 合入 main，tip `b11d15b`；合后四件套 1208 passed / 6 skipped） | P1 通信鉴权（DX 增量） | • 前置 `D.1b`+`C.2`；`dist/public` 驱动完整 Studio（SPA `$_TSR` 壳，非残缺静态壳）<br>• `stagent open` 单窗口可聊、无白屏、不强制二次起 Vite；四件套 + dist 静态可用性回归已绿<br>• **不推翻** D.1 loopback+#token/AUTH/Origin；Demo 仍 4100~4110 独立 Origin |
| **TASK-D.1e** | 桌面壳/本机助手：真·选文件夹（Import 同壳） | 通信核销 / DX | **[DEFERRED → v0.2+]** | P5.8 产品壳（v0.2+） | • 系统文件夹选择器 / 轻量本机助手或 Electron·Tauri；Import/New 与工作台同壳<br>• 仍经 D.1 鉴权发 `#token=`；**推迟至 v0.2+**，不阻塞 v0.1 / D.1d；不含把 Demo 改同源 |
| **TASK-D.3** | 15 状态确定性投影持久化与防死锁自愈引擎 | 通信与控制面 | **[COMPLETED]**（2026-10-23 合入 main，merge `9a19f4d`；含 `c2fcb8a` + `83ec516`；合后四件套 1084 passed / 6 skipped） | P3.7 状态投影与防死锁 | • `presentation_state` 落盘 `.stagent/state.json`（与 contracts 并列，不写回合同）+ Daemon `STATE_CHANGED` 广播与重连回放<br>• D-1~D-5 看门狗引擎（可注入时钟 + `sweep`）及生产接线：D-1 abort 超时、D-2 租约心跳、D-3 `PENDING_RESUME` 自愈、D-4 merge 409 二选一、D-5 Gateway 分层超时<br>• 新增/更新：`presentation-store` / `presentation-projector` / `deadlock-resilience` 与接线、集成测试 |
| **TASK-A.1** | Git Worktree 物理隔离与生命周期管理 | 执行内核 | **[COMPLETED]** | P1 本地 Git | Worktree 创建、销毁、分支保护与 `.git/info/exclude` 隔离就绪。 |
| **TASK-A.2** | Scoped MCP 工具网关与路径沙箱校验 | 执行内核 | **[COMPLETED]** | P2 安全网关 | 路径防逃逸、Scope 读写授权、禁区强拦截与环境脱敏就绪。 |
| **TASK-A.3** | 依赖分级复用与工作区构建缓存隔离 | 执行内核 | **[COMPLETED]** | P1 依赖隔离 | 只读依赖复用 (ADR-002)、构建缓存目录隔离与符号链接降级就绪。 |
| **TASK-A.4** | 受限进程执行器与跨平台进程树全回收 | 执行内核 | **[COMPLETED]** | P2 进程执行 | 白名单命令执行、POSIX 进程组 / Windows taskkill 回收就绪。 |
| **TASK-A.5** | 循环重试熔断与费用/Token 硬上限监控 | 执行内核 | **[COMPLETED]** | P2 熔断守护 | 验证重试熔断 (`max_verification_retries: 3`)、超时与费用预检就绪。 |
| **TASK-A.6** | Daemon 崩溃自愈、Git 锁清理与 TOCTOU 校验 | 执行内核 | **[COMPLETED]** | P1 崩溃自愈 | 孤儿锁安全回收、`resume()` 扫描自愈、快照指纹校验就绪。 |
| **TASK-S.1** | Supervisor 建议会话与持久化存储管理 | 建议中枢 | **[COMPLETED]**（2026-10-24 合入 main，merge `a9066dd`；功能 `a7d7292`；合后四件套 1122 passed / 6 skipped；节流器单测 23 例） | P4 智能建议 | • Local-First 会话落盘 (`.stagent/sessions/`)、Prompt Pipeline<br>• 依赖层静态 AST 扫描禁令 + 运行时越权调用拦截正例断言<br>• 独立日预算分账 `.stagent/supervisor-budget.json`<br>• `SupervisorWakeupThrottler`：3s Debounce 默认关闭；显式/阻断/回合结束仍唤醒；STREAMING/TOOL_RUNNING 硬静默；SNOOZE 10 分钟 |
| **TASK-S.2** | 按需合同草案生成（L0 规则 / L1 强模型） | 建议中枢 | **[COMPLETED]**（按需触发、L0 规则引擎、L1 强模型补全、G-11 未决问题零丢失、脱敏均已落地） | P4 合同草案 | • 用户显式请求或事件触发时按需生成草案，L0 规则优先、L1 强模型按需；白话文案<br>• 草案全字段生成 (含必填 `worker_spec`)<br>• 断言未决问题 100% 保留至草案元数据供用户确认 (G-11)<br>• 保留脱敏模块 `src/lib/ipc/redaction.ts` |
| **TASK-S.3** | Supervisor HUD 建议流与 WebSocket 广播 | 建议中枢 | **[DEFERRED → v0.2+]** | P4 HUD 广播 | • v0.2+：WebSocket 建议帧广播、ACCEPT/SNOOZE/DISMISS 上行 action<br>• v0.1 保留范围：仅脱敏模块并入 S.2 精简版移植 |
| **TASK-S.4** | Demo 静态原型生成器与 Mock 预览服务 | 建议中枢 | **[COMPLETED]**（提交 `95ea2a3` + `07af0f2`，经 `d5ee448` 合入 main；19 项单测全绿、tsc 0 错 / eslint 0 错） | P4.5 原型先行 (v1.6.1) | • 单文件受控落盘上限 ≤2MB（超限抛 `E_DEMO_PAYLOAD_TOO_LARGE`）<br>• 独立 Origin 端口 (4100~4110) 与轻量预览服务<br>• 前端 `iframe sandbox="allow-scripts"` (严禁 `allow-same-origin`)<br>• 严格 CSP 策略阻断连接 Daemon 端口；Daemon 校验 Origin 阻断 Demo iframe 越权 RPC<br>• 增量演进快照归档与回退机制 |
| **TASK-S.5** | Supervisor 质疑自查与根因分流归因引擎 | 建议中枢 | **[COMPLETED]**（`a1469b7` + `a83f18a`，经 `2bb1313`、`5748ad0` 合入 main；tsc 0 错；新增 19 用例 + main 回归 90 例全绿） | P5.7 质疑自查 (v1.6.1) | • 第 0 步补齐 `.stagent/specs/requirements.md` 受控快照：合同意图初始化、`specs/revisions/req-v*.md` 冻结、执行期不可变（`E_SPEC_SNAPSHOT_IMMUTABLE`）<br>• `evidence-triad.ts`：会话原始意图/确认记录 + 规范快照命中条目 + Worktree Diff/终端/验证退出码三方抓取<br>• 60s 看门狗 `E_DISPUTE_TIMEOUT`；置信度 < 0.7 自动降级人工裁决<br>• 分流 `IMPLEMENTATION_BUG` / `REQUIREMENT_DRIFT`；返工严格取「变更文件 ∩ 合同 Scope」，越界进 `rejected_paths` 并提示 `EXPANDED_SCOPE_REQUIRED`，绝不扩权<br>• `POST /api/supervisor/dispute` + `DISPUTE_REPORT_READY` 广播（含三方证据链摘要）；`change_request_id` 贯通报告/提案 |
| **TASK-S.6** | 非技术旅程串联（右侧分流 + 确认原型开工） | 建议中枢 / 编排粘合 | **[COMPLETED]**（2026-10-24 合入 main，merge `6415fbd`；功能 `bbab79e`；合后四件套 1155 passed / 6 skipped；**S.6b 已收口** merge `024d2b8` / `613ff51`，1165 passed / 6 skipped） | P4.5 / P5.7 串联（八步旅程最后一公里） | • 右侧唯一入口白话分流：质疑 → `POST /api/supervisor/dispute` + 白话卡；大事 → 草案；小事 → Fast Path（免强制 Demo）<br>• 吸收 C.2 残余：【确认原型并实施真实工程】真建全灰 TaskGraph 并进入审批/开工链（禁止只改 nonce）<br>• 聊完一段落后左侧需求说明可感知刷新；审批/开工后中栏图随真实 Evidence 点亮（复用既有 verify）<br>• **S.6b COMPLETED**：`REAL_PLAYTEST` 真预览 URL 挂中栏 iframe +「在浏览器打开」外链（4200–4210 stub/attach）<br>• 底座复用 S.4/C.7/S.5/C.2/S.2/W.5a，不重砌；对照 `docs/reports/非技术用户旅程验收稿.md` |
| **TASK-W.1** | Coding Worker 适配器抽象与任务指令装配 | 编码内核 | **[COMPLETED]**（已合入 main，worker-adapter.interface / adapter-registry 在位） | P2 Worker 适配 | • 统一 `CodingWorkerAdapter` 接口，支持 Managed AI / CLI<br>• 补齐第 9 项 `known_limitations`<br>• 区分 `GATEWAY_ENFORCED` 与 `UNCONTROLLED_EXTERNAL`<br>• 合同上下文装配 + Worktree 隔离校验，专用用例 34 个 |
| **TASK-W.2** | Scoped Gateway 强制工具注入与执行拦截 | 编码内核 | **[COMPLETED]**（2026-10-21 核验：`2e1290c` 已合入 main；仅含当时交付范围） | P2 工具管辖 | • 统一 `stagent_*` 命名空间 5 工具（含 `delete_file` / `list_directory`）<br>• `stagent_write_file` 的 `expected_hash?` 乐观锁（G-03），失配 `E_CONFLICT`<br>• 强制结构化 argv 且 `shell:false`，字面量拦截注入符号 (G-04)<br>• 越界/禁区阻断并标记 `BLOCKED`，专用用例 29 个 |
| **TASK-W.2b** | 未跟踪文件 Scope 联合检查与越界阻断 | 编码内核 | **[COMPLETED]**（提交 `87f909c`，经 `05f090f` 合入 main；`daemon/pipeline/untracked-scope-guard.ts` + `E_OUT_OF_SCOPE_UNTRACKED`） | P2 Scope 完整性 | • 执行后同时检查 tracked Diff 与 untracked 文件<br>• 新增稳定错误码 `E_OUT_OF_SCOPE_UNTRACKED`<br>• 前置：TASK-0.2c、TASK-W.2 |
| **TASK-W.3** | 测试环境、秘密脱敏与网络/端口策略守卫 | 编码内核 | **[COMPLETED]**（policy-guard.ts 已接入 Gateway 与 Runner；14 用例绿） | P2 环境网络 | • 环境变量白名单过滤、`CI=true` 注入、`env_file_grants` 按命令授权<br>• 秘密遮蔽严密发生在日志截断之前<br>• 网络策略拦截 (`DENY` / `EXPLICIT_TARGETS` / `USER_APPROVED`)、动态端口 |
| **TASK-W.4** | 高风险执行威胁守卫与运行时能力复检 | 编码内核 | **[COMPLETED]**（threat-guard.ts + runtime-interceptor.ts 已接入；26 用例绿） | P2 安全威胁 | • 闭环 G-01 & G-20：落地 `daemon/worker/threat-guard.ts`<br>• 命令 argv 与仓库信任检查，高风险特权命令抛 `E_UNSAFE_EXECUTION` 并阻断<br>• 会话期周期性复检，检测到绕过立即降级为 `UNCONTROLLED_EXTERNAL` 并阻断 Evidence<br>• 落实 4 类绕过路径不可用负例断言 |
| **TASK-W.5a** | Claude Code 适配器（cli-host 黑盒实测） | 编码内核 | **[PASS]**（真实 CLI 负例 6/6 全绿，已完成 Shell 加固） | P5.5 受控实测 | cli-host spawn 挂载、Pre-tool hook 拦截、Headless 结构化输出、会话续接；4 类绕过负例实测。 |
| **TASK-W.5b** | cursor-agent 适配器（cli-host 黑盒实测） | 编码内核 | **[NEW_TASK]** | P5.5 受控实测 | 权限 deny 实测；不能完全关闭原生写能力则仅登记 `UNCONTROLLED_EXTERNAL`（仅 Vibe）。 |
| **TASK-W.5c** | OpenHands 适配器（容器隔离） | 编码内核 | **[NEW_TASK]** | P5.5 受控实测 | 容器内仅挂载任务 Worktree；`control_mode = SANDBOX_ENFORCED`。 |
| **TASK-B.1** | 本地 AST 增量依赖图分析引擎 | 架构感知 | **[DEFERRED → v0.2+]** | A §3 架构引擎 | 冷启动 ≤1.5s，单文件增量修补 ≤20ms。 |
| **TASK-B.2** | 多活跃 Worktree 监听与 Evidence 状态联动 | 架构感知 | **[DEFERRED → v0.2+]** | P4 状态失效 | 外部变更在 watcher debounce 窗口内触发 Evidence `STALE`；合并前指纹复核兜底。 |
| **TASK-C.1** | Cursor 式三栏 IDE 响应式工作台骨架与 Studio 视口 | 前端呈现 | **[COMPLETED]**（WorkspaceLayout / WorkspaceHeader / SplitPaneContainer 在位；8 用例绿） | P3 工作台闭环 | • 左侧文件树/Git 状态、中栏多标签、右栏双 Agent 对话<br>• Header 补齐模式、受控徽标与分支指示<br>• 审批后默认绑定合同 Worktree |
| **TASK-C.2** | 中栏 Supervisor Studio 多维视口集成 | 前端呈现 | **[COMPLETED]**（2026-10-24 合入 main，merge `51039aa`；功能 `c1ad3be`；合后四件套 1099 passed / 6 skipped；新增 UI 15 例） | P4 审批与多维视口 | • `StudioViewportShell` 统一挂载 Demo / Graph / 质疑 / 合同四视口（`hidden` 保活，切换不丢表单与点亮）<br>• 默认视口只消费 Daemon `presentation_state`（`STATE_CHANGED` + `GET /api/state` 兜底）；手动 Tab 可覆盖，展示态一变清覆盖<br>• 复用 C.7 `TaskGraphPanel`、S.4 iframe 沙箱（仅 `allow-scripts`）、S.5 质疑自查 API；合同审阅与保护清单白话卡保持 |
| **TASK-C.3** | Monaco 核心编辑器集成与受控 Worktree 读写 | 前端呈现 | **[COMPLETED]**（MonacoEditorPane + useWorktreeFile 在位；4 用例绿） | P3 代码编辑 | Monaco Editor 嵌入，可写/只读视觉区分，编辑器内 Evidence STALE 指示，越权保存 403 拒绝。 |
| **TASK-C.4** | 架构雷达视图与 Scope 圈选抽屉 | 前端呈现 | **[DEFERRED → v0.2+]** | P3 架构雷达 | 1000 节点拓扑渲染；交互式 Scope 圈选。 |
| **TASK-C.5** | 双栏 Diff 审阅器与结构化终端日志回放 | 前端呈现 | **[COMPLETED]**（components/diff/* + StructuredTerminal.tsx 在位；5 用例绿） | P3 差异终端 | 双栏/内联 Git Diff 审阅；结构化终端流式日志展示、ANSI 渲染、先脱敏后截断。 |
| **TASK-C.6** | 右栏 Agent 流式会话与打断续接 | 前端呈现 | **[COMPLETED]**（AgentChatPane + use-agent-session 在位；8 用例绿） | P3 会话闭环 | 流式渲染、工具卡片、Stop/打断、排队追加、Adapter 切换、会话列表与 resume。 |
| **TASK-C.7** | 业务功能树与 Task Graph 渐进点亮视口 | 工作台 UI | **[COMPLETED]**（2026-10-23 合入 main，merge `5117b27`；原交付于 `feat/task-c7-graph-engine`，基线 `main@05f090f`；干净环境四件套全绿：1032 passed / 6 skipped；新增 31 用例：24 单元 + 7 UI） | P4.5 拓扑点亮 (v1.6.1) | • `daemon/graph/graph-engine.ts`：Daemon 独占内存权威 + 原子落盘 `.stagent/specs/task_graph.json`，`revision` 单调递增、对外只给快照<br>• `SupervisorProposalV1` 以 `Omit<TaskNode, "state" \| "executed_at" \| "commit_sha">` 类型层剥离运行态；运行期夹带运行态字段直接 `E_PROPOSAL_INVALID`<br>• 七态严格对齐 §3.2.1；`illumination-verifier.ts` 要求「受控写入 + 退出码 0 + Commit SHA + 文件指纹」，空命令集/空结果集 `E_EMPTY_VERIFICATION_BLOCKED` 拒绝点亮（UI 警告灰，不假绿）<br>• `evidence-collector.ts`：文件 SHA-256、Scope、HEAD 由 Daemon 现算，HTTP 调用方不得自报证据<br>• 外部改码 `STALE_REVERIFY` 变灰并撤销指纹；AUDITED 合同同周期退回 VERIFYING<br>• `TASK_GRAPH_UPDATED` 帧 + `revision` 乱序保护；业务功能树 / 执行 DAG 双视图，100ms 翠绿过渡<br>• 左栏【规范与资产】专区展示需求 / 合同 / Demo 与真实点亮进度；文件树随图谱更新刷新 |
| **TASK-C.8a** | 老板模式文案与默认助手（消演示恐吓 / Key 向导） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `15ef8e6`；合后四件套 1213 passed / 6 skipped） | P4 体验打磨 | • 前置 `D.1d` COMPLETED<br>• 演示→可折叠练习沙箱；收起「不调用模型」恐吓；默认优先真助手<br>• 未配 Key：右栏三步向导 + 一键进设置；设置页白话闭环<br>• **不含**改鉴权 / Demo Origin / 新开桌面壳 |
| **TASK-C.8b** | Fast Path 老板三步台（藏工程师合同细节） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `6d16939`；合后四件套 1224 passed / 6 skipped） | P4 体验打磨 | • 前置 `D.1d` + `S.6` COMPLETED<br>• 小事 Fast Path 中栏收成老板三步：「改哪里 / 要不要动保护 / 确认开改」<br>• 默认折叠 src/**、npm、Daemon、保护解锁等合同工程细节；需要时再展开<br>• **不含**改 Fast Path 准入规则本体 / 状态机边 |
| **TASK-C.8c** | 连接与打开死路自救（无钥匙一键重开 + 粘贴路径） | 工作台 UX / DX | **[COMPLETED]**（2026-10-24 合入 main，tip `950e53e`；合后四件套 1217 passed / 6 skipped） | P4 体验打磨 | • 前置 `D.1b`/`D.1c`/`D.1d` COMPLETED；**不抢** `D.1e`（系统选择器仍 DEFERRED）<br>• 无 token 冷开：一键重开带钥匙会话，不死锁对话<br>• 开新夹：粘贴绝对路径 + 一键重开/唤起，少催「去终端敲 npx stagent open」说明书<br>• **不含**系统文件夹选择器 / Electron·Tauri |
| **TASK-C.9a** | 首屏单一主路径（三态只留一个指挥信号） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `ef0e1a7`；合后四件套 1231 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.8a`/`C.8b`/`C.8c` COMPLETED<br>• `resolveCommandSurface`：no_key / idle / in_progress 单一主 CTA<br>• 欢迎区/打开面板默认收/顶栏徽标降级<br>• **不含**改鉴权 / Demo Origin / 新开桌面壳 |
| **TASK-C.9b** | 助手模式互斥（练习 vs 真助手 vs 向导） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `c4818fa`；合后四件套 1239 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9a` + `C.8a` COMPLETED<br>• `resolveAssistantMode`：wizard / practice / real 互斥；向导发送禁用<br>• 练习横幅 + 中栏随模式；禁止缺钥匙装忙<br>• **不含**改鉴权 / 真实云调用门禁本体 |
| **TASK-C.9c** | 打开项目面板生命周期（默认收 / 成功即关） | 工作台 UX / DX | **[COMPLETED]**（2026-10-24 合入 main，tip `2f5d653`；合后四件套 1246 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9a` + `C.8c` COMPLETED；**不抢** `D.1e`<br>• 默认收；成功即关；已连接「切换项目」；`resolveOpenProjectEntryPresentation`<br>• **不含**系统文件夹选择器 |
| **TASK-C.9d** | 进行中中栏让路（收欢迎页 / 设置深链回跳） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `edc28ce`；合后四件套 1254 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9a` + `C.9b` + `C.8b` COMPLETED<br>• `middle-yield` + 自动开 Studio；设置深链/回跳；聊≠改白话<br>• **不含**重做 Studio 四视口路由本体 |
| **TASK-C.10a** | 进行中生命周期收口（退出 in_progress / 无空让路壳） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `5207df2`；合后四件套 1261 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9a` + `C.9d` COMPLETED<br>• `resolveActiveInProgress`；历史旅程卡不粘；无空 middle-yield；Studio 保持开<br>• 与 C.9a/C.9d 指挥纪律一致<br>• **不含**重做 Studio 四视口；改鉴权 |
| **TASK-C.10b** | 设置页老板主路径（钥匙主视线 / 工程师项进高级） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `be33a26`；合后四件套 1265 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9d` + `C.8a` COMPLETED<br>• 模型钥匙置顶；高级默认折叠含连接/诊断/工作区<br>• 保留 C.9d 深链 + 返回对话<br>• **不含**改鉴权语义；取消 token 能力 |
| **TASK-C.10c** | 界面暗号/命名清扫（白话标签 + 图谱单入口） | 工作台 UX | **[NEW_TASK]**（2026-10-24 正式立卡；由 DEFERRED 升格） | P4 抛光 | • 前置 `C.10a`/`C.10b` COMPLETED<br>• 白话：Supervisor→项目审阅；Studio→合同操作台；SmartTerminal→验证输出；ActivityBar 去英文暗号<br>• 任务图谱只留合同操作台内一扇门（左栏改指向或弱化）<br>• 可选弱化空闲双 CTA；**不重做**指挥纪律；**不改**鉴权；**不抢** D.1e |
| **TASK-P.1** | 全局保护清单与 Vibe 模式安全网 | 安全与体验 | **[COMPLETED]**（提交 08e95da 已合入 main；17 用例绿） | P3.5 保护清单 | `.stagent/protection.json`、首导入推荐卡片、Auto-Checkpoint、【撤销本轮改动】、静默合同、User-First Discard 冲突仲裁。 |
| **TASK-D.2** | 控制面 API 补齐、六大合并门禁与 Git Trailer 审计 | 通信核销 | **[COMPLETED]**（2026-10-21 步骤 D 收口；仅含当时交付范围） | P5 核销合并 | • 控制面 approve/execute/resume/abort/merge 与既有 Gate 0–4 已落地<br>• 4 条标准 Git Trailer 与 User-First Discard 已交付；增量范围由 D.2b 承接 |
| **TASK-D.2b** | 未跟踪文件合并门禁与 Contract v1.3 零静默迁移接入 | 通信核销 | **[COMPLETED]**（提交 `150dc47` 锁定；合并前未跟踪门禁、零静默迁移接入、Trailer 尺寸守护均已落地） | P5 增量门禁 | • 在已跟踪/未跟踪文件上执行合同 Scope 联合检查<br>• 接入 `migrateContractToV13`，防止历史合同静默获批<br>• 前置：TASK-0.2c、TASK-D.2、TASK-W.2b |
| **TASK-E.1** | 双 Agent 协同与全流程 E2E 自动化测试 | 集成测试 | **[COMPLETED]**（`c82a7bb`；交付测试在位） | P6 集成自举 | 覆盖 Happy Path 全生命周期无人值守自动化回归；覆盖 8 类故障分支（含 4 类授权不变式与非受控隔离）。 |
| **TASK-E.2** | Stagent 仓库自举 (Dogfooding) 与发版交付 | 交付发版 | **[COMPLETED]**（`9b15c20`、`178a8a6`；报告与发版记录在位） | P6 真实验证 | 真实仓库自举演练、用量与已知限制客观报告、生产打包构建。 |

---
## 2. 关键路径与 DAG 拓扑依赖 (Critical Path DAG，v1.6.2 对齐版)

> **v1.6.2 对齐说明**：纳入架构规范 v1.6.1 核心底座演进任务 `TASK-0.2c`（Schema v1.3.0 与自愈迁移边）与通信/防死锁引擎 `TASK-D.3`（15 状态投影持久化与死锁自愈）。将非技术用户八步闭环（澄清 -> Demo -> Graph -> 点亮 -> 真机 -> 质疑自查 -> 增量演进）牢牢构筑在强类型数据模型与防死锁底座之上。

### 2.1 依赖关系与机器可读边清单 (Machine-Readable Edges)

> **依赖源优先级**：任务卡「前置依赖」与下方 JSON 边清单必须一致；下方 ASCII 图仅表示关键路径示意，不穷举全部边。出现不一致时以任务卡与 JSON 的逐边校验为阻断条件，必须先修正文档再开工。

```
TASK-0.1 ──► TASK-0.2b ──► TASK-0.2c (Schema v1.3.0 & 自愈边) ──► TASK-D.1 ──► TASK-D.3 (15状态投影 & 防死锁)
                                                                    │              │
                                                                    │              ├──► TASK-D.1b (一键打开项目) [COMPLETED]
                                                                    │              │      └──► TASK-D.1c (最近项目一键重开) [COMPLETED]
                                                                    │              │             └──► TASK-D.1d (修复同源空白) [COMPLETED]
                                                                    │              │                    ├──► TASK-D.1e (真·选文件夹/桌面壳) [DEFERRED → v0.2+ / P5.8]
                                                                    │              │                    └──► TASK-C.8a / C.8b / C.8c [COMPLETED] ──► TASK-C.9a–C.9d [COMPLETED] ──► TASK-C.10a/b [COMPLETED]（第三轮；C.10c DEFERRED）
                                                                    │              │
                                                                    │              ├──► TASK-C.1 (三栏骨架)
                                                                    │              │      ├──► TASK-C.3 (Monaco 读写)
                                                                    │              │      ├──► TASK-C.6 (右栏流式会话)
                                                                    │              │      └──► TASK-C.5 (Diff 与终端)
                                                                    │              │
                                                                    ├──► TASK-W.1 ─┴─► TASK-W.2 (Gateway) ──► TASK-W.3 ──► TASK-W.4
                                                                    │                                              │
                                                                    │                                              └──► TASK-W.5a
                                                                    │
                                                                    └──► TASK-P.1 (保护清单 + Vibe 安全网)

  TASK-C.5 + TASK-P.1 + TASK-W.4 ──► TASK-D.2 (合并门禁与审计核销)
                                            │
  TASK-S.1 ──► TASK-S.2 (草案生成) ─────────┼──────────────────────────────┐
                 │                          │                              │
                 ▼                          ▼                              ▼
            TASK-S.4 (Demo 原型)      TASK-C.7 (Task Graph 点亮)    TASK-S.5 (质疑自查)
                 │                          │                              │
                 └──────────────────┬───────┴──────────────────────────────┘
                                    ▼
                              TASK-C.2 (Studio 多维视口集成)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼                               ▼
              TASK-S.6 (非技术旅程串联)        TASK-E.1 ──► TASK-E.2
              （右侧分流 + 确认原型开工；       （v0.1 既有基线，已完成）
               前置 S.4/C.7/S.5/C.2/S.2/W.5a）
                                    │
                    ┌───────────────┼──────────────────────────────┐
                    ▼               ▼                              ▼
              TASK-C.8a        TASK-C.8c                      TASK-C.8b
              （老板文案/默认助手） （无钥匙一键重开+粘贴路径）   （Fast Path 老板三步台）
              前置 D.1d         前置 D.1b/D.1c/D.1d；不抢 D.1e   前置 D.1d + S.6
              [COMPLETED]       [COMPLETED]                       [COMPLETED]
              建议序：C.8a（已合）→ C.8c（已合）→ C.8b（已合）· Top3 收口
                                    │
                    ┌───────────────┼──────────────────────────────┐
                    ▼               ▼                              ▼
              TASK-C.9a ──► TASK-C.9b ──► TASK-C.9c ──► TASK-C.9d
              （首屏单一主路径） （助手模式互斥） （打开面板生命周期） （进行中中栏让路）
              前置 C.8a/b/c     前置 C.9a+C.8a   前置 C.9a+C.8c     前置 C.9a+C.9b+C.8b
              [COMPLETED]       [COMPLETED]      [COMPLETED]         [COMPLETED]
              建议序：C.9a→C.9b→C.9c→C.9d 均已合 · **第二轮指挥权收口**
                                    │
                    ┌───────────────┼──────────────────────────────┐
                    ▼               ▼                              ▼
              TASK-C.10a       TASK-C.10b                    TASK-C.10c
              │                │                             │
              前置 C.9a+C.9d    前置 C.9d+C.8a              前置 C.10a+C.10b
              [COMPLETED]       [COMPLETED]                 [NEW_TASK]
              建议序：C.10a/b 已合 · **第三轮体验卡**；**当前首要 C.10c** 暗号/命名清扫

  【增量门禁旁支，不阻塞主链】TASK-0.2c + TASK-W.2 ──► TASK-W.2b (Scope 检测)
                                   └─ 与 TASK-D.2 汇合 ──► TASK-D.2b (合并门禁) ──► TASK-S.5
```

**机器可读拓扑边列表 (JSON Edges，v1.6.2)**：
```json
[
  { "from": "TASK-0.1", "to": "TASK-0.2b" },
  { "from": "TASK-0.2b", "to": "TASK-0.2c" },
  { "from": "TASK-0.2c", "to": "TASK-D.1" },
  { "from": "TASK-D.1", "to": "TASK-D.3" },
  { "from": "TASK-D.1", "to": "TASK-D.1b" },
  { "from": "TASK-D.1b", "to": "TASK-D.1c" },
  { "from": "TASK-D.1b", "to": "TASK-D.1d" },
  { "from": "TASK-D.1c", "to": "TASK-D.1d" },
  { "from": "TASK-C.2", "to": "TASK-D.1d" },
  { "from": "TASK-D.1d", "to": "TASK-D.1e" },
  { "from": "TASK-D.1", "to": "TASK-C.1" },
  { "from": "TASK-C.1", "to": "TASK-C.3" },
  { "from": "TASK-C.1", "to": "TASK-C.6" },
  { "from": "TASK-C.6", "to": "TASK-W.5a" },
  { "from": "TASK-C.1", "to": "TASK-C.5" },
  { "from": "TASK-D.1", "to": "TASK-W.1" },
  { "from": "TASK-W.1", "to": "TASK-W.2" },
  { "from": "TASK-0.2c", "to": "TASK-W.2b" },
  { "from": "TASK-W.2", "to": "TASK-W.2b" },
  { "from": "TASK-W.2", "to": "TASK-W.3" },
  { "from": "TASK-W.3", "to": "TASK-W.4" },
  { "from": "TASK-W.2", "to": "TASK-W.5a" },
  { "from": "TASK-D.1", "to": "TASK-P.1" },
  { "from": "TASK-C.5", "to": "TASK-D.2" },
  { "from": "TASK-P.1", "to": "TASK-D.2" },
  { "from": "TASK-W.4", "to": "TASK-D.2" },
  { "from": "TASK-0.2c", "to": "TASK-D.2b" },
  { "from": "TASK-D.2", "to": "TASK-D.2b" },
  { "from": "TASK-W.2b", "to": "TASK-D.2b" },
  { "from": "TASK-0.2c", "to": "TASK-S.2" },
  { "from": "TASK-S.1", "to": "TASK-S.2" },
  { "from": "TASK-S.2", "to": "TASK-S.4" },
  { "from": "TASK-S.2", "to": "TASK-C.7" },
  { "from": "TASK-C.1", "to": "TASK-C.7" },
  { "from": "TASK-D.3", "to": "TASK-C.7" },
  { "from": "TASK-D.2", "to": "TASK-S.5" },
  { "from": "TASK-D.2b", "to": "TASK-S.5" },
  { "from": "TASK-S.2", "to": "TASK-S.5" },
  { "from": "TASK-S.4", "to": "TASK-C.2" },
  { "from": "TASK-C.7", "to": "TASK-C.2" },
  { "from": "TASK-S.5", "to": "TASK-C.2" },
  { "from": "TASK-D.3", "to": "TASK-C.2" },
  { "from": "TASK-C.1", "to": "TASK-C.2" },
  { "from": "TASK-C.2", "to": "TASK-E.1" },
  { "from": "TASK-E.1", "to": "TASK-E.2" },
  { "from": "TASK-S.4", "to": "TASK-S.6" },
  { "from": "TASK-C.7", "to": "TASK-S.6" },
  { "from": "TASK-S.5", "to": "TASK-S.6" },
  { "from": "TASK-C.2", "to": "TASK-S.6" },
  { "from": "TASK-S.2", "to": "TASK-S.6" },
  { "from": "TASK-W.5a", "to": "TASK-S.6" },
  { "from": "TASK-D.1d", "to": "TASK-C.8a" },
  { "from": "TASK-D.1d", "to": "TASK-C.8b" },
  { "from": "TASK-S.6", "to": "TASK-C.8b" },
  { "from": "TASK-D.1b", "to": "TASK-C.8c" },
  { "from": "TASK-D.1c", "to": "TASK-C.8c" },
  { "from": "TASK-D.1d", "to": "TASK-C.8c" },
  { "from": "TASK-C.8a", "to": "TASK-C.9a" },
  { "from": "TASK-C.8b", "to": "TASK-C.9a" },
  { "from": "TASK-C.8c", "to": "TASK-C.9a" },
  { "from": "TASK-C.9a", "to": "TASK-C.9b" },
  { "from": "TASK-C.8a", "to": "TASK-C.9b" },
  { "from": "TASK-C.9a", "to": "TASK-C.9c" },
  { "from": "TASK-C.8c", "to": "TASK-C.9c" },
  { "from": "TASK-C.9a", "to": "TASK-C.9d" },
  { "from": "TASK-C.9b", "to": "TASK-C.9d" },
  { "from": "TASK-C.8b", "to": "TASK-C.9d" },
  { "from": "TASK-C.9a", "to": "TASK-C.10a" },
  { "from": "TASK-C.9d", "to": "TASK-C.10a" },
  { "from": "TASK-C.9d", "to": "TASK-C.10b" },
  { "from": "TASK-C.8a", "to": "TASK-C.10b" },
  { "from": "TASK-C.10a", "to": "TASK-C.10c" },
  { "from": "TASK-C.10b", "to": "TASK-C.10c" }
]
```

---
## 3. 详细任务卡明细 (Task Cards)

> **任务状态纪律（v1.6.2）**：`[COMPLETED]` 仅表示该卡列明范围已交付；后续版本的增补不得附加在完成卡内。若核验发现增补未实现，必须拆为有编号、前置依赖、状态及验收条件的独立任务卡。

### 3.1 契约基线与通信底座（Sprint 0 基础设施与演进）

#### 【Task 0.2b】Schema v1.2.0 增量演进、双状态机联动与存量迁移
* **任务编号**：`TASK-0.2b`
* **前置依赖**：`TASK-0.1` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-20 交付，提交 `52c807c` 锁定基线；v1.3.1/v1.3.2 增补第 4 条 PREPARING 回退断言与 G-09 分列记账规范映射——G-15 错误码映射测试为 v1.3.0 已交付内容，非本次新增。**v1.3.3 口径更正**：该卡交付当日的用例数为历史快照，当前有效基线以最新一次 CI 实际运行结果 + 提交哈希为准；增量断言验证记录随下一次回归运行一并存档，不再单列"待补录"状态）
* **字段事实说明**：`max_command_executions` 与 `max_tool_calls` 已属于本卡交付字段；本卡不包含 v1.3.0 之后的新增合同迁移要求。
* **核心目标**：
  1. 升级 `SoftwareContractV12` 与 `EvidenceBundleV11` 完整定义，逐字段 100% 对齐 A §9.1/§9.2（含 `budget_limits` 可选 `max_command_executions` 与 `max_tool_calls`）。
  2. 落实 `can_merge` 派生不变式：`superRefine` 校验 `status === "PASSED"` 且无违规无超额；外部写入类型 `Omit<Verdict, "can_merge">`。
  3. 重构状态机校验器：实现 `validateStatePair` 与 `validateTransition`，落盘采用原子写入 (`writeTemp + fsync + rename`)。
  4. **补齐状态机 4 条关键分支断言 (G-17)**：
     - 正例：`ABORTED + APPROVED`（已批准后发生故障安全中止，保留历史审批记录）；
     - 负例：合同被拒绝 (`ABORTED + REJECTED`) 后不得原地回到 `DRAFT`；
     - 负例：`ABORTED` 为终态，不得经 `resume` 跃迁至 `EXECUTING`；
     - 异常回退联动：`PREPARING` 初始化异常中断时，lifecycle 回退 `PENDING_APPROVAL` 同步原子回置 `approval.status = "PENDING_REVIEW"`（杜绝以历史批准态静默重建 Worktree）。
  5. **补齐用量账本 3 项断言 (G-09)**：
     - 用量跨 Daemon 重启持久化重载一致；
     - 切换模型供应商后累计开销不清零；
     - 模型费用上限与命令/工具调用上限分列记账，独立触发熔断。
  6. **补齐 ErrorCode Catalog 完备性测试 (G-15)**：新建 `tests/unit/error-codes-mapping.test.ts`，表驱动测试 15 个 `error_code` 到 10 个 `reason_code` 的双向映射（新增 `E_UNSAFE_EXECUTION ➔ UNSAFE_EXECUTION`、`FRAME_DIRECTION_FORBIDDEN ➔ PROTOCOL_VIOLATION` 等）。
  7. 存量 v1.1.3 合同迁移工具：备份至 `.stagent/migrations/`，禁止静默执行，标记需显式重批。
* **涉及核心文件**：
  - 修改：`src/lib/contract.schema.ts`
  - 修改：`src/lib/evidence.schema.ts`
  - 新增：`src/lib/state-machine.ts`
  - 新增：`src/lib/error-codes.ts`
  - 新增：`src/lib/migration.ts`
  - 测试：`tests/unit/contract-schema-v12.test.ts`
  - 测试：`tests/unit/evidence-schema-v11.test.ts`
  - 测试：`tests/unit/state-machine-matrix.test.ts`
  - 新增测试：`tests/unit/error-codes-mapping.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - Schema 校验通过，`can_merge` 派生反向用例全部阻断成功。
    - `tests/unit/state-machine-matrix.test.ts` 完整通过 A §9.1.1 组合矩阵与 4 条新分支断言（含 PREPARING 初始化异常中断时，lifecycle 回退 `PENDING_APPROVAL` 同步原子回置 `approval.status = "PENDING_REVIEW"`，杜绝静默授权重建 Worktree）。
    - `tests/unit/error-codes-mapping.test.ts` 15 ➔ 10 双向映射 100% 通过。
    - 账本持久化与分列记账断言通过。
  - **FAIL**：缺少任一字段校验；状态机允许非法跃迁。

---


---

#### 【Task 0.2c】Schema v1.3.0 增量演进、Fast Path 与自愈迁移边实现 `[认领架构 P0.2c / C-01]`
* **任务编号**：`TASK-0.2c`
* **前置依赖**：`TASK-0.2b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-23 交付：分支 `feat/task-0.2c-contract-v1.3-statemachine` 提交 `fb2cc67`，经 `cd7e7e0` 合入 main。落地内容：Schema 1.2.0/1.3.0 双版本白名单（新合同签发 1.3.0）、`creator` 增 `system:fast-path`、`authorization.git` 的 `allowed_operations`/`forbidden_flags`/`enforce_clean_base`（禁用参数强制内嵌五项、不可覆盖）、`approval` 增签名/准入决策/决策说明/驳回者并约束 `ADMITTED_AUTOMATIC` 仅限 `system:fast-path`；状态机增三条受控边——Fast Path `DRAFT→PREPARING`（Guard：系统凭证 + LOW 风险，`DRAFT→EXECUTING` 恒非法）、自愈 `PENDING_RESUME→PREPARING`（`WORKTREE_MISSING_HEAL`）、降级 `AUDITED→VERIFYING`（`EXTERNAL_MUTATION`）；`migrateContractToV13` 执行态族白名单回填 `user:legacy`，草案/待审保持原态并清除残留审批戳记，`ABORTED` 保留「批准后中止」历史。门禁：`tsc --noEmit` 0 错、eslint 0 错、全量 903 例（896 通过 / 6 跳过 / 1 例为 daemon 夹具 `git init` 被沙箱拦截的环境性失败，非断言失败）。偏差：审批枚举沿用架构 §9.1 的 `DRAFT/PENDING_REVIEW/APPROVED/REJECTED`（非任务书正文的 `PENDING/SUPERSEDED`）；lifecycle 保持 `VERIFYING`（规范无 `MERGING`）；`approved_at` 保持 ISO 字符串。未纳入本卡：`worker_spec` 的 `SANDBOX_ENFORCED`/`billing_model`/`verified_on`、顶层 `scope`、`EvidenceBundleV12`、未跟踪文件检查（由 TASK-W.2b 承担））
* **v0.1 范围**：数据模型从 v1.2.0 升级至 v1.3.0，实现审批与 Git 授权完整字段校验，增补 Fast Path、恢复自愈与外部改码降级三条关键状态转移边，升级存量合同无静默授权迁移。
* **核心目标**：
  1. **数据模型升级与 Zod 校验 (`src/lib/contract.schema.ts`)**：
     - 升级 `SoftwareContractV13` 与 `EvidenceBundleV12` 定义，严格对齐架构规范 §9.1；
     - 新增必填字段 `authorization.git`：包含 `allowed_operations: string[]`（白名单操作）、`forbidden_flags: string[]`（禁止参数，如 `--force`, `-f`, `--hard`, `--amend`, `--no-verify`）与 `enforce_clean_base: boolean`；
     - 新增必填字段 `approval`：包含 `status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED"`、`approved_by: string`、`approved_at: number`（可空）；
     - Zod 校验不变式：在 `SoftwareContractSchemaV13` 中使用 `superRefine` 校验当且仅当合同处于执行态族时 `approval.status` 必须为 `"APPROVED"` 且 `approved_by` 与 `approved_at` 非空。
  2. **状态机迁移路径闭环 (`src/lib/state-machine.ts`)**：
     - **Fast Path 直通流转边**：严格实现 `DRAFT -> PREPARING -> EXECUTING`，在 `validateTransition` 中坚决禁止任何跳过 `PREPARING` 的直跳边（违规抛出 `ILLEGAL_TRANSITION`）；
     - **外部改码级联降级边**：增设 `AUDITED -> VERIFYING`（触发原因：`EXTERNAL_MUTATION`），当外部文件修改导致 Evidence 降级为 `STALE` 时，原子将合同态从 `AUDITED` 拉回 `VERIFYING`，强制触发复检；
     - **恢复探测自愈边**：增设 `PENDING_RESUME -> PREPARING`（触发原因：`WORKTREE_MISSING_HEAL`），在 Daemon 恢复合同时若探测到工作树目录丢失，自愈回退至 `PREPARING` 重新物理检出；
     - 校验 9 种 lifecycle 状态迁移边矩阵，并验证 15 种展示状态投影；不得把展示态数量当作 lifecycle 状态数量。
  3. **存量合同向后兼容无静默授权迁移 (`src/lib/migration.ts`)**：
     - 实现 `migrateContractToV13(v12Contract)`：
       - 执行态族白名单回填：仅对处于 `{PREPARING, EXECUTING, VERIFYING, PENDING_RESUME, AUDITED, MERGED}` 的历史合同回填 `status: "APPROVED", approved_by: "user:legacy"`；
       - 待审与草案态安全保持：历史合同若处于 `DRAFT` 则回填 `status: "DRAFT"`；若处于 `PENDING_APPROVAL` 则回填 `status: "PENDING_REVIEW"`，**绝对严禁静默回填为 APPROVED**；
       - 中止态闭环分支：历史合同处于 `ABORTED` 则回填 `status: "REJECTED", rejected_by: "system:aborted"`；
       - `authorization.git` 默认安全填充：注入默认白名单与禁用参数。
* **涉及核心文件**：
  - 修改：`src/lib/contract.schema.ts`
  - 修改：`src/lib/state-machine.ts`
  - 修改：`src/lib/migration.ts`
  - 测试：`tests/unit/contract-schema-v13.test.ts`
  - 测试：`tests/unit/state-machine-v13-transitions.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：`contract-schema-v13.test.ts` 全绿；9 态 lifecycle 迁移边矩阵与 15 展示态投影测试通过；Fast Path (`DRAFT->PREPARING->EXECUTING`)、自愈 (`PENDING_RESUME->PREPARING`)、降级 (`AUDITED->VERIFYING`) 全部通过；迁移函数零静默授权（对 DRAFT 和 PENDING_APPROVAL 绝不输出 APPROVED）。
  - **既有基线守护**：开工前归档 `main`@`6d7fa59` 的实测结果（86 文件 / 785 通过 / 6 跳过）；完成后要求既有用例零非预期回归。重点运行 `tests/unit/state-machine-matrix.test.ts`、`tests/unit/migration-v113.test.ts`、`tests/unit/contract-schema-v12.test.ts`、`tests/unit/contract-auto-approve.test.ts`、`tests/e2e/happy-path.spec.ts`。矩阵测试任何既有期望的改动均须逐条记录原因及其对应的新合法边，不得为通过新测试而整体放宽矩阵。
  - **FAIL**：出现 `DRAFT -> EXECUTING` 直跳；迁移函数将未审批历史合同静默标记为 APPROVED；或既有测试失败而未说明并修复。

---

#### 【Task D.1】CLI 引导入口与安全 WebSocket 通信桥
* **任务编号**：`TASK-D.1`
* **前置依赖**：`TASK-0.2b`
* **任务状态**：**[COMPLETED]**（2026-10-20 交付；验证：`npm test` 全量 48 文件 / 377 用例绿、`tsc --noEmit` 0 错误、eslint 0 违规、verify-env 通过；变更明细与偏差记录见本节末尾「D.1 交付附注」）
* **核心目标**：
  1. CLI 工具 (`stagent start`)：动态端口 (3001~3010) 探测、PID 锁获取（若已被存活进程占用抛出 `E_WORKSPACE_LOCKED` 拒绝重复启动）、Token 写入 (`.stagent/session-token`，权限 `0600`) 并唤起浏览器。
  2. **首帧 AUTH 鉴权闭环**：首帧必须为 `{ type: "AUTH", payload: { token } }`，校验失败立即以关闭码 `4401` 断开连接，不产生无限重连；服务端日志严禁打印 Token 明文。
  3. **规范 WS 帧字典 (G-02)**：
     - 同时保留 `EVIDENCE_READY`（证据生成完成待核销）与 `EVIDENCE_STATUS_CHANGED`（状态流转与外部变动失效）以及 `TERMINAL_STREAM`（命令执行流式日志）。
  4. **补齐 Origin、速率与心跳防护 (G-12/G-13)**：
     - 校验 `Origin`，仅放行本地合法来源 (`http://127.0.0.1:*` / `http://localhost:*`)，拒绝非法来源；
     - 限制单连接帧大小 ≤ 2MB，限制连接频率防 DoS；
     - 客户端 5s 心跳 PING，连续 3 次未收到 PONG（15s）在前端呈现重连遮罩；
     - Daemon 获取 PID 锁后强制轮换 Token，崩溃残留旧 Token 自动失效。
* **涉及核心文件**（已按仓库实际布局修正，见文末「路径映射约定」）：
  - 修改：`bin/stagent.ts`（CLI 入口：参数解析、动态端口探测、PID 锁检查与浏览器唤起）
  - 修改：`daemon/server.ts`（WS 服务端：首帧握手鉴权、Origin/Host 校验、帧大小与速率限制）
  - 修改：`src/lib/ipc/frames.ts`（帧字典与 FRAME_CATALOG：Daemon 与 UI 共享双向通信协议规范）
  - 修改：`src/lib/ipc/client.ts`（前端 WS 客户端：心跳探测与 15s 失联判定）
  - 修改：`src/lib/daemon-api.ts`（Token 仅经 `#fragment` 引导传递，删除 `?token=` query 通道）
  - 修改：`src/hooks/use-daemon-stream.ts`（前端 React Hook：连接管理、心跳状态与帧分发）
  - 测试：`tests/unit/ws-auth-handshake.test.ts`（首帧握手 / 50ms 切断 / Token 轮换 / 日志无明文）
  - 测试：`tests/unit/ws-frame-dictionary.test.ts`（13 类规范帧 + 目录完备性）
  - 测试：`tests/unit/cli-entry.test.ts`（参数解析 / fragment 构造 / 平台 opener）
  - 测试：`tests/daemon/ws-security.test.ts`（Origin / Host / 2MB / 速率 429 / query 禁令 / 方向门禁 / 默认端口）
  - 测试：`src/hooks/use-daemon-stream.test.tsx`（3 次心跳失联 → reconnecting）、`src/tests/daemon-api-token.test.tsx`（query 忽略 / fragment 抹除）
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 工作区检测到已有存活 PID 锁时，启动失败并返回/抛出 `E_WORKSPACE_LOCKED`，拒绝重复占用工作区。
    - 首帧非 AUTH 或 Token 错误在 50ms 内被 4401 切断。
    - 非法 Origin 连接被直接拒绝。
    - 模拟 3 次心跳丢失触发 UI 重连遮罩。
    - Token 轮换断言：新实例启动后，旧 Token 发送 AUTH 必然返回 4401。
  - **FAIL**：允许 URL Query 传 Token；未鉴权连接可接收广播帧。
* **D.1 交付附注**（2026-10-20）：
  - 心跳判定修正为「AUTH_OK 立即 PING，第 3 次失联落在 15s」（原实现为 20s，off-by-one）；UI 遮罩由 `status === "reconnecting"` 驱动，遮罩组件本体属 TASK-C.1。
  - 增强项（不超出规范）：Host 头回环校验（DNS Rebinding 防线，A §6.1"校验 Origin 与会话权限"的补足，因重绑定后 GET 不带 Origin）；WS `maxPayload = 2MB`（超限以 1009 关闭）；连接速率限制默认 30 次/10s/IP 可配置；帧方向门禁（客户端伪造 `server->client` 帧返回 `FRAME_DIRECTION_FORBIDDEN` 错误帧，不断连）。
  - 规范设计与符合项说明：① Origin 白名单放行 `::1` 属于 loopback 本地回路的标准符合项；② 浏览器唤起时 Token 经 URL **fragment**（`#token=`）传递 —— A §6.1 未指定页面凭证透传通道，fragment 不随 HTTP 请求发送且读取后立即 `history.replaceState` 抹除，完全满足"日志不得记录 token"的要求；③ `WORKER_LOG`/`SCOPE_ALERT` 两个 v1.1 历史扩展帧按 A §6.1"至少包括"措辞保留，证据失效现已同时广播规范帧 `EVIDENCE_STATUS_CHANGED`。
  - 端口默认值由 41792~41802 修正为本卡片的 3001~3010（`daemon/server.ts`、`src/lib/daemon-api.ts`）。

---


---

#### 【Task D.1b】一键打开项目（Daemon 托管控制台 + open CLI）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-D.1b`
* **前置依赖**：`TASK-D.1` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，merge `d5b35e0`；分支 `feat/task-d1b-one-click-open` 功能 `946e9fc`。门禁：合后四件套全绿（1188 passed / 6 skipped）；tsc 0 错、eslint 0 errors、build 通过。落地清单：`bin/stagent.ts`（`open` 子命令：复用健康 Daemon / 新启、同源或 Vite+#base=、自动唤起浏览器）、`daemon/console/static-host.ts` + `daemon/server.ts`（同源托管 SPA 仅 `/`/`/index.html`+资产）、`daemon/core/pid-lock.ts` + `src/lib/error-codes.ts`（`E_WORKSPACE_LOCKED` 白话）、`src/lib/daemon-api.ts`（`#token=&base=` 解析与同端口段推断）、`OpenProjectEntry` / README、`scripts/package-dist.mjs` 写入 `dist/public/index.html`。**口径说明**：① 控制台同源托管不改变 D.1 AUTH/fragment/Origin；② Demo 仍 4100~4110 独立 Origin；③ 无 `dist/public` 时回退 Vite 5173 并在 fragment 注入 `base=`。**残余口径差**：最近项目列表已交 `TASK-D.1c`（COMPLETED）；**同源托管空白页**已交 `TASK-D.1d` 并合入 main tip `b11d15b`（COMPLETED）；不含 Electron/Tauri/系统协议）
* **对照痛点**：当前启动常需第二终端 + 手拷 Token；目标体验接近 Cursor「打开项目」——一条命令、单浏览器窗口即可聊。
* **v0.1 范围**：`stagent open <路径>` → Daemon 托管 `dist/public` 同源控制台 + 自动唤起浏览器 `#token=` fragment → 工作台已连上；可选最近项目列表；Demo 仍独立 Origin（4100~4110），不与控制台同源。底座复用 D.1（端口/PID 锁/Token/AUTH/Origin），只补 DX 粘合、不重砌鉴权。
* **明确不包含**：
  - Electron / Tauri 桌面壳
  - 系统自定义协议（可后续）
  - 推翻 D.1 鉴权模型（仍须 AUTH / fragment Token / Origin 校验；日志不得打印 Token 明文）
  - 修改《系统架构设计规范》或另开 ADR
* **核心目标**：
  1. **一条命令打开**：`stagent open <工作区路径>`（或无参走最近项目）启动/复用本工作区 Daemon，托管控制台静态资源（与 Daemon 同源），自动 `open` 浏览器至带 `#token=` 的控制台 URL；用户无需第二终端、无需手拷 Token。
  2. **鉴权不变**：无钥匙（无 fragment / 未 AUTH）地址连不上工作台；Token 仍经 fragment 传递并立即抹除；服务端日志严禁打印 Token 明文（继承 D.1）。
  3. **换项目 / 锁冲突白话**：对另一路径再 `open` 打开新项目；若目标工作区已有存活 PID 锁，抛出/展示白话 `E_WORKSPACE_LOCKED`（或等价提示），不静默抢占。
  4. **Demo 仍独立 Origin**：S.4 Demo 预览继续 4100~4110 独立 Origin + 严 CSP；控制台同源托管不得让 Demo iframe 获得 Daemon 同源权限。
* **涉及核心文件（实施时以实际接线为准，本卡仅定范围）**：
  - CLI：`bin/stagent.ts`（或等价）新增 `open` 子命令；可选最近项目落盘
  - Daemon：托管 `dist/public` 静态控制台（同源）；复用 D.1 端口/PID 锁/Token/AUTH
  - 前端：无钥匙入口拒绝；fragment Token 读取与抹除（既有 D.1）
  - 测试：open CLI、无 Token 拒绝、锁冲突白话、Demo Origin 隔离回归
* **Pass/Fail 验收断言（≤5，可测、白话）**：
  1. **一条命令单窗口可聊**：在空目录或已有项目上执行 `stagent open <路径>`，只出现一个浏览器窗口，工作台已连上并可与右侧聊天（无需第二终端、无需手拷 Token）。
  2. **无钥匙连不上**：打开不带有效 `#token=` / 未 AUTH 的控制台地址，工作台连不上（不得旁路 D.1 鉴权）。
  3. **换路径 / 锁冲突白话**：对另一路径 `open` 打开新项目；若工作区已锁，用户看到白话锁冲突提示（如 `E_WORKSPACE_LOCKED`），不静默抢占。
* **Pass/Fail 验收判定**：
  - **PASS**：上述断言 1–3 均可在本地手测复现；Demo 仍独立 Origin；日志无 Token 明文；不引入 Electron/系统协议。
  - **FAIL**：仍要求用户拷 Token 或开第二终端；无钥匙可进工作台；Demo 与控制台同源导致 iframe 可打 Daemon；打印 Token 明文；把缺口塞回已完成的 D.1 而不立本卡。

---

#### 【Task D.1c】最近项目一键重开（控制台「打开项目」）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-D.1c`
* **前置依赖**：`TASK-D.1b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `f3e371e`；分支 `feat/task-d1c-recent-projects` 快进合入。门禁：合后四件套全绿（1204 passed / 6 skipped）；tsc 0 错、eslint 0 errors、build 通过。落地清单：`daemon/core/recent-projects.ts`（用户级 `~/.stagent/recent-projects.json` 0600，非业务仓保护区）、`daemon/core/open-workspace.ts`（复用健康 Daemon / spawn 本仓 `stagent start`）、`daemon/server.ts`（`GET/POST /api/recent-projects`）、`bin/stagent.ts`（open 成功写入最近）、`OpenProjectEntry` + `daemon-api`（列表渲染 / 一点重开带 `#token=`）、spawn 白名单登记。**口径说明**：① 不含任意路径文件夹选择器；新路径首次仍走 `stagent open`；② 不推翻 D.1/D.1b AUTH/fragment/Origin；③ 锁冲突白话 `E_WORKSPACE_LOCKED`。**残余口径差**：真·任意路径选择器留给 `TASK-D.1e`（可 defer：本机助手/Electron）；同源空白已由 `TASK-D.1d` 合入 `b11d15b` 收口）
* **对照痛点**：D.1b 后仍常要在终端敲 `stagent open <路径>`；用户期望在已打开的控制台里点「打开项目」看到最近列表，一点即进带钥匙会话（接近 Cursor「最近打开」）。
* **v0.1 范围**：控制台「打开项目」入口展示最近工作区列表；点击某一项 → 复用健康 Daemon 或按 D.1b 路径唤起 → 打开/切换到带 `#token=`（及必要 `#base=`）的同源控制台会话，无需再敲 `stagent open`。最近列表由本机受控落盘（如用户级或 `.stagent` 旁的最近路径记录），在 `open` / 成功连接时更新。**明确不含**浏览器真·任意路径文件夹选择器（留给后续本机小助手 / Electron）。
* **明确不包含**：
  - 真·任意路径文件夹选择器（`<input type="file" webkitdirectory>` 或系统对话框选任意本地路径）
  - Electron / Tauri 桌面壳、系统自定义协议
  - 推翻 D.1 / D.1b 鉴权（仍须 AUTH / fragment Token / Origin；日志不得打印 Token 明文）
  - 修改《系统架构设计规范》或另开 ADR
* **核心目标**：
  1. **最近列表看得见**：已连上的控制台里，「打开项目」展示最近工作区路径列表（空列表时白话提示：可用 `stagent open <路径>` 首次打开后出现在此）。
  2. **一点即重开带钥匙**：点击列表中某一项，复用/唤起该工作区 Daemon 并进入已带 `#token=` 的会话（同源或既有 D.1b `#base=` 回退），用户无需再敲 `stagent open`、无需手拷 Token。
  3. **不含任意路径选择器**：本卡不提供「浏览磁盘选任意文件夹」；新路径首次仍走 D.1b CLI（或后续本机助手/Electron 卡）。锁冲突时白话 `E_WORKSPACE_LOCKED`（或等价），不静默抢占。
* **涉及核心文件（实施时以实际接线为准，本卡仅定范围）**：
  - 前端：控制台「打开项目」/最近列表 UI（可扩展既有 `OpenProjectEntry`）
  - 最近记录：本机受控落盘读写（路径规范化、上限条数、去重）；`open` / 成功连接时更新
  - Daemon / CLI：复用 D.1b 复用健康 Daemon、同源托管、`#token=&base=` 唤起；可选轻量 API 供控制台请求「打开某最近路径」
  - 测试：最近列表渲染、一点重开带 token、无钥匙拒连回归、锁冲突白话；负例：本卡不出现任意路径系统选择器
* **Pass/Fail 验收断言（≤5，可测、白话）**：
  1. **最近列表看得见**：在控制台点「打开项目」，能看到最近打开过的工作区列表（至少含曾用 `stagent open` 成功打开的路径）。
  2. **一点即带钥匙可聊**：点击列表中某一项后，进入/切换到该项目工作台且已连上（带有效钥匙），无需再敲 `stagent open`、无需手拷 Token。
  3. **不含任意路径选择器**：本卡交付界面没有「浏览磁盘选任意文件夹」；新项目首次仍用 D.1b CLI；无钥匙地址仍连不上；锁冲突白话提示。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–3 均可在本地手测复现；不引入 Electron/任意路径选择器；日志无 Token 明文；不推翻 D.1/D.1b。
  - **FAIL**：仍只能靠终端 `stagent open` 重开最近项目；一点后仍要手拷 Token；夹带真·任意路径选择器却标本卡完成；把缺口塞回已完成的 D.1b 而不立本卡。

---

#### 【Task D.1d】修复同源控制台空白（生产可用单窗口）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-D.1d`
* **前置依赖**：`TASK-D.1b` (COMPLETED), `TASK-C.2` (COMPLETED)；建议亦具备 `TASK-D.1c` (COMPLETED) 以便最近重开联调，**不以 D.1c 为硬阻断**
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `b11d15b`；分支 `feat/task-d1d-same-origin-console` 快进合入。门禁：合后四件套全绿（**1208 passed / 6 skipped**）；tsc 0 错、eslint 0 errors、build 通过。落地清单：启用 `tanstackStart.spa`；`scripts/package-dist.mjs` 将预渲染 `_shell.html` 提升为 `dist/public/index.html`；`daemon/console/static-host.ts` 仅托管含 `$_TSR` + `index-*.js` 的可 hydrate 壳；新增/扩展 `console-dist-spa-shell` 等 dist 静态可用性回归。**口径说明**：① 根因=空白 `index.html` + `hydrateRoot(document)` 不匹配，且 static-host 曾忽略 SPA `_shell.html`；② 不推翻 D.1 loopback+#token/AUTH/Origin；③ Demo 仍 4100~4110 独立 Origin；④ Vite+#base 可保留为开发态可选绕路，不再是生产必经。对照：`docs/reports/打开项目-愿景与现状.md`。**本轮文档回写不改**架构规范（已有注记 8））
* **对照痛点 / 已修复缺陷（合入前）**：D.1b 宣称「同源单窗口」；合入前 `scripts/package-dist.mjs` 写入的 `dist/public/index.html` 为极简静态壳（仅挂 `assets/index-*.js`），TanStack Start 无法完成客户端启动 → `http://127.0.0.1:30xx/#token=…` 常见空白页。临时绕路曾为 Vite + `#token=` / `#base=`。**合入 `b11d15b` 后**：生产路径以可 hydrate SPA 壳为准，不再把残缺空白壳标为已验收。
* **v0.1 范围**：使 Daemon 同源托管的控制台在 `stagent open` 后**生产可用**——单浏览器窗口展示完整三栏工作台并完成 AUTH 连接，可与右侧聊天；不再依赖「必须再开 Vite」才能用。允许保留 Vite+#base 作为开发态可选绕路，但不得再把空白壳标成已验收的单窗口体验。
* **明确不包含**：
  - 推翻 D.1 鉴权（仍须 `127.0.0.1` + `#token=` fragment + WS AUTH + Origin；日志不得打印 Token 明文）
  - 将 Demo 预览改为与 Daemon/控制台同源（Demo 仍 4100~4110 独立 Origin + 禁 `allow-same-origin`）
  - Electron / Tauri / 系统文件夹选择器（归 `TASK-D.1e`）
  - 重开 S.6 八步旅程或 W.5b/c 施工适配
* **核心目标**：
  1. **同源页不再空白**：`npm run build` 后 `stagent open <路径>` 打开的 Daemon 端口页面须渲染完整工作台（非白屏），`#token=` 完成连接。
  2. **单窗口可聊**：无需第二终端手拷 Token、无需必须再起 Vite，即可右侧聊天（开发态 Vite+#base 可保留为可选）。
  3. **安全与隔离不回退**：无钥匙仍连不上；Demo 独立 Origin 回归仍绿；锁冲突白话。
* **涉及核心文件（实施时以调查为准，本卡不锁死改法）**：
  - 构建装配：`scripts/package-dist.mjs`（当前 `writeConsoleIndexHtml`）、`dist/public/**`
  - 托管：`daemon/console/static-host.ts`、`daemon/server.ts`
  - 前端启动：TanStack Start / Vite 客户端入口与路由水合所需资源（可能需 client-only 构建或正确 SSR 静态导出——**由实现卡调查后选定，文档不预设唯一根因处方**）
  - 测试：同源 open 冒烟（非空白 + 已连接）、无 Token 拒连、Demo Origin 隔离回归；可选 Playwright/组件级「根节点可见」
* **Pass/Fail 验收断言（≤5，可测、白话）**：
  1. **同源不再空白**：`npm run build` 后执行 `stagent open <临时目录或样例仓>`，打开的 Daemon 同源 URL（含 `#token=`）在合理时间内出现工作台主壳（左/中/右结构可见），**不是**持续空白 HTML。
  2. **单窗口可聊**：同一窗口内完成连接后，右侧输入框可用（发一条非破坏性消息或至少出现已连接会话态）；无需用户再开 Vite 或手拷 Token。
  3. **无钥匙仍拒连**：去掉或篡改 `#token=` 后工作台连不上（不旁路 D.1）。
  4. **Demo 仍独立 Origin**：S.4 Demo 预览仍在独立端口 Origin；控制台同源不得使 Demo iframe 获得 Daemon 同源权限（禁 `allow-same-origin` 等既有负例仍过）。
  5. **门禁**：四件套全绿（`npm test` / `typecheck` / `lint` 0 errors / `build`）；新增或扩展 **`dist` 静态打包产物可用性回归**（build 后同源入口可挂载，禁止再把残缺空白壳标为 PASS）。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 本地可复现；日志无 Token 明文；不引入桌面壳冒充本卡完成。
  - **FAIL**：同源仍空白却标完成；只能靠 Vite 才算「能用」却声称 D.1d 完成；无 dist 静态可用性回归却标完成；Demo 与控制台同源可打 Daemon；打印 Token 明文。

---

#### 【Task D.1e】桌面壳 / 本机助手：真·选文件夹（Import 与工作台同壳）`[DEFERRED → v0.2+ · P5.8 · 2026-10-24]`
* **任务编号**：`TASK-D.1e`
* **前置依赖**：`TASK-D.1d`（建议 v0.2 开工前先完成生产可用单窗口；并行亦须满足 D.1 鉴权）
* **任务状态**：**[DEFERRED → v0.2+]**（架构路线 **P5.8**；**不阻塞** v0.1 / `TASK-D.1d` / 八步旅程验收；2026-10-24 经 Tina 口径对齐为正式推迟，本轮仅文档占位）
* **对照痛点**：浏览器无法弹出系统级「选任意本地文件夹」；D.1c 只有最近列表；用户仍觉「第一次打开很麻烦」，期望接近 Cursor Open / Import。
* **v0.1+ 范围（可延后到桌面壳里程碑）**：提供本机助手或 Electron/Tauri（或等价）能力：在**同一产品壳**内「打开项目 / Import / New Project」→ 系统对话框选文件夹或创建空项目 → 自动启动/复用 Daemon 并进入已带钥匙的工作台。安全模型仍落在 D.1：loopback、`#token=` / 安全等价注入、AUTH、Origin；Demo 仍独立 Origin。
* **明确不包含（本卡立项时仍禁止偷换）**：
  - 在未做桌面壳的纯浏览器里假装已支持任意路径选择器并标完成
  - 推翻 D.1 鉴权或把 Token 长期写入可分享的 query/localStorage 明文
  - 将 Demo 改为 Daemon 同源
* **核心目标**：
  1. **真·选文件夹**：用户在产品 UI 内触发系统文件夹选择器（或受控本机助手），选中路径后进入工作台。
  2. **同壳**：Import/New/最近/工作台在同一产品表面，而不是「终端命令 + 另一个空白浏览器页」心智。
  3. **正式推迟**：v0.1 仅文档占位；排期在 v0.2+（P5.8），不得把缺口塞回已完成的 D.1c，亦不得阻塞 D.1d。
* **Pass/Fail 验收断言（≤5；若本卡 defer 则实施当轮再测）**：
  1. **选文件夹可进**：产品内一点「打开项目」→ 系统选夹 → 工作台已连上可聊（不手拷 Token）。
  2. **同壳**：选夹与聊天在同一应用表面（桌面壳或明确的本机助手 UX），而非仅 README 教用户开终端。
  3. **鉴权与 Demo 不回退**：无钥匙拒连；Demo 独立 Origin；日志无 Token 明文。
* **Pass/Fail 验收判定**：
  - **PASS（实施轮 / v0.2+）**：断言 1–3 成立；v0.1 保持 DEFERRED 且未伪称已交付即为合规。
  - **FAIL**：无桌面能力却标完成；削弱 D.1/Demo 隔离。

---
#### 【Task D.3】15 状态确定性投影持久化与防死锁自愈引擎
 `[认领架构 P3.7]`
* **任务编号**：`TASK-D.3`
* **前置依赖**：`TASK-0.2c`, `TASK-D.1`
* **任务状态**：**[COMPLETED]**（2026-10-23 合入 main，merge `9a19f4d`；分支 `feat/task-d3-deadlock-persistence`：`c2fcb8a`（持久化 / 投影广播 / D-1~D-5 引擎）+ `83ec516`（D-2/D-4/D-5 生产接线）；首段投影词汇表仍为 `f548aeb` / `cd7e7e0`。门禁：合后四件套全绿（1084 passed / 6 skipped）；tsc 0 错、eslint 0 错、build 通过。落地清单：`src/lib/state/presentation-state.ts`（15 态词汇表，daemon/前端共用）、`daemon/state/presentation-store.ts` / `presentation-projector.ts`（`.stagent/state.json` 落盘，不写回合同）、`daemon/state/deadlock-resilience.ts`（可注入时钟 + `sweep`；D-1~D-5）、`daemon/core/contract-mutex.ts`（D-2 租约观察者 + 锁文件白名单回收）、`daemon/pipeline/merger.ts`（D-4 `assertTargetBranchNotAdvanced` + `TargetBranchAdvancedError`）、`daemon/pipeline/orchestrator.ts`（`replayOnCurrentBaseline` / `healResume` / 超时证据）、`daemon/mcp/gateway.ts` + `daemon/runner/command-runner.ts`（D-5 分层登记与 pid 回填）、`daemon/server.ts`（回收钩子、`POST .../merge` 409 options、`POST .../merge-decision`）。**口径说明**：① 展示态变化不写进合同，避免误触发 `contract_revision` 重新审批；② 看门狗不用裸 `setTimeout`，由心跳驱动 `sweep`，挂起恢复后一次补齐过期项；③ D-1 强杀经 `orchestrator.abort` → runner 进程树 SIGTERM→SIGKILL（Daemon 无独立 worker pid 登记表）；④ D-5 超时证据借用 `BLOCKED + BUDGET_EXHAUSTED` + `TIMEOUT:` 前缀（Evidence verdict 无独立 `TIMEOUT` 枚举）。**残余口径差（不阻塞验收，需登记）**：① D-4 仅比证据 `base_commit_sha` 与当前 main tip，不校验工作树真实 merge-base；② 沙箱 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 配额耗尽时 D-2 盘上锁文件断言可跳过（租约事件断言仍严格）；③ 信息不足时投影返回 `null`，界面停在上一帧而不猜状态）
* **v0.1 范围**：15 种展示状态确定性映射引擎、`presentation_state` 持久化落盘与 WebSocket 广播、五类死锁自愈机制 (D-1~D-5)。
* **核心目标**：
  1. **确定性状态投影引擎 (`daemon/state/presentation-state.ts`)**：
     - 严格实现架构规范 §6.3.1 的唯一 15 态词汇表，输入 `(approval.status, lifecycle_state)` 及运行时上下文；以下每一对均明确按该顺序书写，不能把 lifecycle 与 approval 对调：
       - `(DRAFT, DRAFT) + demo_service.status !== "RUNNING" ➔ EXPLORING`
       - `(DRAFT, DRAFT) + demo_service.status === "RUNNING" ➔ DEMO_PREVIEW`
       - `(APPROVED, PREPARING) + DAG 生成中 ➔ GRAPH_MAPPING`
       - `(PENDING_REVIEW, PENDING_APPROVAL) + 等待用户授权 ➔ NEEDS_APPROVAL`
       - `(APPROVED, EXECUTING) + stopping_requested === false ➔ EXECUTING`
       - `(APPROVED, EXECUTING) + stopping_requested === true ➔ STOPPING`
       - `(APPROVED, PENDING_RESUME) + suspend_reason 已设置 ➔ PAUSED`
       - `(APPROVED, VERIFYING) + verification_passed !== false ➔ VERIFYING`
       - `(APPROVED, VERIFYING) + verification_passed === false 且 retry_count < max_retries ➔ FAILED`
       - `(APPROVED, AUDITED) + real_preview.status === "RUNNING" 且无质疑 ➔ REAL_PLAYTEST`
       - `(APPROVED, AUDITED) + dispute_session.status === "OPEN" ➔ DISPUTED_INSPECTING`
       - `(APPROVED, AUDITED) + evidence.can_merge === true 且无冲突 ➔ READY_TO_MERGE`
       - `(APPROVED, AUDITED) + 检测到目标分支推进 ➔ CONFLICT`
       - `(APPROVED, MERGED) ➔ MERGED`
       - `(REJECTED 或 APPROVED, ABORTED) ➔ ABORTED`（保留历史审批事实，对齐架构 §9.1.1 配对矩阵）
       - **`(APPROVED, AUDITED)` 四分支判定优先级（必须按序短路求值，安全优先）**：`CONFLICT` > `DISPUTED_INSPECTING` > `REAL_PLAYTEST` > `READY_TO_MERGE`；即目标分支已推进时即使存在 OPEN 质疑也先呈现 `CONFLICT`，存在 OPEN 质疑时即使真机预览在跑也先呈现 `DISPUTED_INSPECTING`，禁止四者同真时的实现自由裁量。
       - 上述为架构 §6.3.1 的全部 15 种用户可见状态；禁止引入旧版 `CONTRACT_REVIEW`、`GRAPH_ORCHESTRATING`、`PREPARING` 等额外展示态。底层非执行态中间转换不得伪装为第 16 个 UI 状态。
     - 将派生出的 `presentation_state` 持久化写入 `.stagent/state.json`；
     - 通过 WebSocket 向 UI 实时广播状态变更帧，断线重连能够瞬间无损还原界面视图。
  2. **五类死锁自愈看门狗 (`daemon/state/deadlock-resilience.ts`)**：
     - **D-1 停止超时看门狗**：`STOPPING` 态超过 15 秒触发强杀看门狗，发送 SIGKILL 回收子进程，强制释放工作区互斥锁，原子转入 `ABORTED`；
     - **D-2 孤儿锁与租约心跳**：互斥锁租约设为 60 秒，Daemon 心跳周期 15 秒续租；超过 90 秒无心跳自动判定为崩溃死锁，由看门狗安全回收释放；
     - **D-3 恢复自愈探测**：`PENDING_RESUME` 时探测任务工作树物理存在性，若已被外部意外删除，自动触发 `PENDING_RESUME -> PREPARING` 重建自愈；
     - **D-4 目标分支前进二选一**：合并前检测目标分支向前推进，提示【以当前分支为基线重演】或【放弃候选成果】，禁止前端死锁；
     - **D-5 分层超时机制**：命令执行按 60s/300s/600s 分层看门狗兜底，超限安全回收并生成 TIMEOUT 证据。
* **涉及核心文件（以实际落地为准）**：
  - 共享词汇表：`src/lib/state/presentation-state.ts`（首段 `f548aeb`；daemon/前端共用）
  - 新增：`daemon/state/presentation-store.ts`、`daemon/state/presentation-projector.ts`
  - 新增：`daemon/state/deadlock-resilience.ts`
  - 修改：`daemon/core/contract-mutex.ts`、`daemon/mcp/gateway.ts`、`daemon/pipeline/merger.ts`、`daemon/pipeline/orchestrator.ts`、`daemon/pipeline/contract-store.ts`、`daemon/runner/command-runner.ts`、`daemon/server.ts`
  - 测试：`tests/unit/presentation-state.test.ts`、`tests/unit/presentation-persistence.test.ts`、`tests/unit/deadlock-resilience.test.ts`、`tests/unit/deadlock-call-sites.test.ts`、`tests/integration/merge-decision-d4.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：架构 §6.3.1 的 15 种展示状态均由明确的 `(approval.status, lifecycle_state)` 二元组及运行时判据确定性派生；D-1~D-5 故障注入测试 100% 成功解除死锁，断网断线重连无数据丢失。
  - **FAIL**：前端展示态脱离底层物理状态伪造；子进程卡死超过 15 秒未强制回收导致锁悬挂。

---

### 3.2 Supervisor 建议中枢、原型生成、质疑自查与非技术旅程串联（v1.5.0 全生命周期升级；含 S.6）

#### 【Task S.1】Supervisor 建议会话与持久化存储管理
* **任务编号**：`TASK-S.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，merge `a9066dd`；分支 `feat/task-s1-throttler` 提交 `a7d7292`。门禁：合后四件套全绿（1122 passed / 6 skipped）；tsc 0 错、eslint 0 错、build 通过（dist 33 文件 / 3.35 MB）。落地清单：既有会话/Prompt/权限/独立预算分账 + `daemon/supervisor/throttler.ts`（`SupervisorWakeupThrottler`，`idleDebounceEnabled` 默认 `false`）+ `tests/unit/supervisor-debounce-trigger.test.ts`（**23 例**：默认关闭 5 + 历史开启态 18）。规则优先 L0/L1 仍记在 TASK-S.2。**口径说明**：①「对话停顿 3s」默认关闭，显式点击/控制面阻断/回合结束仍立即唤醒；② Worker `STREAMING`/`TOOL_RUNNING` 硬静默；③ `SNOOZE` 默认 10 分钟；④ `mapWakeTriggerToDraftTrigger` 对齐 draft-generator 枚举（`IDLE_DEBOUNCE`→`DEBOUNCE_TIMER` 双保险）。**残余口径差（不阻塞验收，需登记）**：① Daemon 聊天/会话路由侧尚未挂载节流器实例（模块已从 `daemon/supervisor/index.ts` 导出，合入后接聊天即可）；② 旧版「完成记录」中 2026-10-22 归档校正注仍保留为历史，勿与本轮交付混读）
* **核心目标**：
  1. Local-First 会话管理，落盘至 `.stagent/sessions/{session_id}.json`，文件模式 `0600`。
  2. 依赖层 AST 扫描禁令：禁止引入 Gateway/Merger/Verifier/ProcessRunner/child_process。
  3. **落实运行时越权调用拦截正例断言 (G-11b)**：
     - 若 Supervisor 上下文尝试调用 `approveContract`、`mergeContract`、`setVerdict`、`execCommand`，底层控制面坚决抛出权限拒绝异常，产生 `GATEWAY_VIOLATION` 审计事件。
  4. **预算分账（v1.3.3 修订）**：Supervisor 拥有独立日预算（`.stagent/supervisor-budget.json`），**不再计入当前合同账本**；Supervisor 预算耗尽不影响 Worker 执行；Worker 合同账本不得含 Supervisor 用量。
  5. **唤醒节流器（v1.3.3 修订：规则优先 L0/L1）**：严禁伴随 Worker 逐 Token 轮询。唤醒时机修订为：① 用户显式请求；② Gateway 违规/熔断事件；③ Worker 回合结束且 diff 触及保护区。**「对话停顿 3s 即评估」默认关闭**（throttler 代码保留，配置开关控制）；VIBE 下 30 分钟连续聊天 Supervisor 模型调用应为 0（除非用户点击）。三类时机（修订前存档）：
     - ① 对话流静默 3s（输入停顿 Debounce 窗口）——**v1.3.3 默认关闭，仅保留代码与可配置开关**；
     - ② 用户在 UI 显式点击建议卡/请求分析（实测启用）；
     - ③ 捕获到 Daemon 抛出的 `BLOCKED`、连续测试失败或预算报警事件（实测启用）。
     - **断言（v1.3.3 口径）**：Worker 流式生成过程中 Supervisor 模型请求触发次数为 0；时机 ②③ 触发率 100%；时机 ① 在开关关闭时触发次数必须为 0。
* **涉及核心文件（以实际落地为准）**：
  - 新增：`daemon/supervisor/session-manager.ts`
  - 新增：`daemon/supervisor/prompt-builder.ts`
  - 新增：`daemon/supervisor/types.ts`
  - 新增：`daemon/supervisor/throttler.ts`（唤醒节流器：3s 防抖 + 三类唤醒时机 + Worker 流式静默 + SNOOZE）
  - 测试：`tests/unit/supervisor-session.test.ts`
  - 测试：`tests/unit/supervisor-zero-tool-lint.test.ts`
  - 测试：`tests/unit/supervisor-runtime-permission.test.ts`
  - 测试：`tests/unit/supervisor-debounce-trigger.test.ts`（Worker 流式生成期间零模型调用断言、3s 停顿与事件唤醒测试）
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 会话文件原子落盘与恢复成功。
    - 静态依赖 AST 扫描零违规。
    - 运行时越权调用测试：调用审批/合并/写入 verdict/执行命令 100% 抛错被拒并记录告警。
    - 唤醒节流器测试：在 Worker 流式生成期间 Supervisor 模型调用次数严格为 0；UI 显式请求与控制面异常事件 100% 正确触发；3s 防抖开关关闭时零触发、开启时按既有 18 用例通过。
    - Supervisor 独立预算耗尽时模型调用被阻断，且**不影响 Worker 继续执行**（v1.3.3）。
  - **FAIL**：Supervisor 能绕过控制面直接执行命令或修改工作区，或在 Worker 流式生成过程中伴随发起模型轮询。
* **完成记录（历史记录 · 旧版 S.1，2026-10-20；当时 3s 防抖默认开启，非 v1.3.3 口径）**：
  - ⚠️ **2026-10-22 归档校正**：以下 `throttler.ts` 与 18 例**不在 main**，仅存于未合并分支 `wip/s2-s3-supervisor-old-design`（`2319459`）；main 上 `1a75616` 只含 `session-manager.ts` / `prompt-builder.ts` / `permissions.ts` / `budget.ts` 四文件。本段整体保留为历史记录，**不得作为 v0.1 验收依据**。
  - 交付物：`daemon/supervisor/throttler.ts`（`SupervisorWakeupThrottler`）+ `daemon/supervisor/index.ts` 导出。
  - 测试：`tests/unit/supervisor-debounce-trigger.test.ts`，共 **18 个用例**全部 PASS，分组如下：
    | 分组 | 用例数 | 覆盖断言 |
    |---|---|---|
    | 防抖窗口 | 3 | 3s 内 5 次输入仅 1 次评估（`coalesced_inputs=5`）；2999ms 不触发 / 3000ms 触发；持续输入重置窗口 |
    | 显式唤醒 | 2 | 显式点击立即触发并取消待触发窗口；连续显式请求各自触发 |
    | Worker 静默 | 3 | STREAMING / TOOL_RUNNING 期间 `model_calls` 严格为 0；静默开始时取消已排队窗口 |
    | 静默解除 | 4 | Turn End 解除静默并触发；积压阻断合并为 `WORKER_BLOCKED`；解除后防抖恢复；Turn End 合并待触发输入不重复评估 |
    | 控制面阻断 | 1 | 空闲态阻断事件立即唤醒 |
    | SNOOZE | 2 | 10 分钟静默期内全部拒绝；到期自动恢复 |
    | 生命周期/可观测性 | 3 | `dispose()` 清窗；评估异常被捕获不阻断后续；统计口径仅放行递增 `model_calls` |

---


---

#### 【Task S.2】按需合同草案生成引擎（L0 规则 / L1 强模型；v1.3.3 拆分精简）
* **任务编号**：`TASK-S.2`
* **前置依赖**：`TASK-S.1`
* **任务状态**：**[COMPLETED]**（v0.1 精简版于 **2026-10-22** 在 `feat/s1-s2-supervisor-draft-pipeline` 落地：按需触发 + L0 规则 + L1 按需补全 + G-11 未决问题零丢失 + 独立预算记账 + `redaction.ts` 移植，三套新单测 45 例全绿；成熟度评分器/徽章/气泡按 v1.3.3 明令**未引入**。旧设计的 4 维评估器 + 草案编译器仍存于未合并分支 `wip/s2-s3-supervisor-old-design`，非 v0.1 验收依据）
* **v1.3.3 范围拆分**：
  - **v0.1（本卡）**：按需合同草案生成——仅在用户显式请求或控制面事件触发时生成；L0 规则（保护清单匹配、路径提取、默认命令/预算）优先，L1 强模型按需补全；白话文案；计入 Supervisor 独立预算。
  - **v0.2+（推迟，`[用户已确认 D4]`）**：需求成熟度评分（4 维评估器、`maturity_assessment` 打分、HUD 徽章）。
* **核心目标**：
  1. 按需生成草案：输出 `rationale`、`unresolved_questions`、`assessed_at`、`model_id`（不再要求成熟度打分）。
  1b. **分级自适应准入评估器 (Adaptive Admission Risk Evaluator, v1.4.0 新增)**：
     - **Fast Path（轻量快速通道）**：分析修改意图与路径，若为单文件非核心展示层修改（如 CSS / 文案 / 单组件），无 Shell 执行且不触碰保护清单，自动打标 `auto_admitted: true`，生成静默合同由 Daemon 自动放行，免去用户弹窗审批；
     - **Standard / Strict Path**：多文件逻辑重构或涉及敏感配置时，进入标准或强门禁合同草案生成。
  2. 草案授权遵循架构规范 §0.2：Scope 与保护清单无交集自动批准，有交集仅一次白话是/否；不存在任何基于分数的门禁。
  3. **未决问题 100% 保留至草案元数据 (G-11)**：提取生成符合 `SoftwareContractV12` 的草案，状态初始为 `DRAFT`，自动注入必填的 `worker_spec`；若存在 `unresolved_questions`，必须完整保存在草案中供用户核对。
* **涉及核心文件**（v0.1，✅ 均已落地；文件名按实际交付校正）：
  - 新增：`daemon/supervisor/draft-generator.ts`（原计划名 `contract-draft-generator.ts`，草案编译 + `submitDraftForApproval()`）
  - 新增：`daemon/supervisor/rules-l0.ts`（L0 规则草案装配：路径提取 / 保护清单匹配 / 默认命令与预算）
  - 移植：`src/lib/ipc/redaction.ts`（共享深度脱敏，自旧 S.3 保留）
  - 修改：`daemon/supervisor/index.ts`（公开出口）
  - 修改：`daemon/supervisor/budget.ts`（改为独立账本 `independent()`）、`daemon/supervisor/types.ts`（快照注释口径同步）
  - 测试：`tests/unit/supervisor-contract-generator.test.ts`、`tests/unit/ipc-redaction.test.ts`、`tests/unit/supervisor-budget.test.ts`
  - v0.2+（推迟）：`daemon/supervisor/maturity-evaluator.ts`、`tests/unit/supervisor-maturity-evaluator.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 草案 100% 通过 `SoftwareContractV12Schema.parse()`。
    - 断言：当 `unresolved_questions.length > 0` 时，草案元数据中的 `unresolved_questions` 逐项保留无遗漏。
    - 断言：草案必须包含合规的 `worker_spec`；未请求时 Supervisor 模型调用 = 0。
  - **FAIL**：草案遗漏未决问题；草案缺失 `worker_spec` 导致校验失败。
* **历史记录（旧设计实现，仅存于未合并分支 `wip/s2-s3-supervisor-old-design`，非 v0.1 验收依据）**：该分支上两个专用套件共 32 个用例曾报告 PASS（2026-10-20）。
  | 套件 / 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | 评估器 A 分数收敛 | 4 | 模糊意图 <50 且 `NEEDS_CLARIFICATION`、未决问题非空；明确意图 ≥80 且四维均 ≥80；明确比模糊高 ≥40 分；部分信息只拉高对应维度 |
  | 评估器 B 结构 | 3 | 四维齐备、权重合计 1；分数均在 0–100 且理由非空；总分可按维度加权复算 |
  | 评估器 C 建议性守卫 | 3 | 空对话不抛错、0 分 + 4 条未决问题；0 分与满分 `advisory_only` 均为 true；未决问题数量等于弱维度数 |
  | 评估器 D 输出契约 | 2 | `toAssessment()` 通过 `maturityAssessmentSchema`；`assessed_at` 来自注入时钟、`model_id` 可覆盖 |
  | 生成器 A 合规与状态 | 5 | 草案 100% 通过 Schema；初始 `DRAFT/DRAFT`；`DRAFT+PENDING_REVIEW` 被拒；提交后 `PENDING_APPROVAL/PENDING_REVIEW`；非 DRAFT 不可重复提交 |
  | 生成器 B worker_spec / 非门禁 | 3 | `GATEWAY_ENFORCED` + `MANAGED_TOOL_CALLING`；`score=0` 仍生成且元数据 score 为 0；无评分同样生成 |
  | 生成器 C G-11 | 2 | 未决问题逐项无遗漏无改写；评估报告转存后 score/rationale/model_id/assessed_at 完全一致 |
  | 生成器 D 装配 | 8 | 对话提取可写路径与禁区；显式 scope 覆盖；空对话安全兜底；默认两条验证命令；命令可覆盖；默认预算含计数值上限；预算可覆盖且合规；默认命令常量防漂移 |
  | 生成器 E 溯源 | 2 | `suggestion_id` + `suggested_scope` 落元数据；`conversation_ref` 保留全部消息 id |
  - 规范说明：A §9.1.1 状态矩阵只允许 `DRAFT↔DRAFT`、`PENDING_APPROVAL↔PENDING_REVIEW`，故草案初始态为 `DRAFT/DRAFT`；`submitDraftForApproval()` 原子推进至 `PENDING_APPROVAL/PENDING_REVIEW`。`DRAFT+PENDING_REVIEW` 被显式断言拒绝，已固化为可回归事实。
* **完成记录（v0.1 精简版 · 2026-10-22 落地，Sprint 4）**：
  - 交付物：`daemon/supervisor/rules-l0.ts`（L0 规则引擎，零模型调用）、`daemon/supervisor/draft-generator.ts`（按需生成 + L1 补全 + G-11 + 费用分账）、`src/lib/ipc/redaction.ts`（三层脱敏）、`daemon/supervisor/budget.ts`（改独立账本）。
  - 关键实现口径：
    - **按需触发是结构性的，不是配置项**：`DraftTriggerKind` 中 `IDLE_TIMER` / `DEBOUNCE_TIMER` 一律返回 `{ generated: false, reason: "NOT_REQUESTED", model_calls: 0 }`，函数体在装配之前即返回，模型调用不存在发生路径。这是「VIBE 下 30 分钟连续聊天 Supervisor 调用 = 0」的结构保证。
    - **L0 只匹配不削减**：命中保护清单的路径**仍保留在 `writable_paths`**，另外回报 `protected_files` / `protected_entry_names` / `needs_protection_approval` / `protection_error`，交由 §0.2「有交集 ≤2 次交互」处理，规则引擎不代替用户做决定。
    - **L1 必须带账本**：`enrich` 与 `budgetLedger` 同时存在才允许调用模型，否则抛 `MISSING_BUDGET_LEDGER`，杜绝"免费调用"绕过费用分账。
    - **G-11 不去重**：L0 与 L1 的 `unresolved_questions` 按序拼接、刻意不去重（去重会静默吞条），完整写入 `supervisor_metadata.maturity_assessment`。
    - **剔除项**：`maturity_assessment` 只写 `rationale` / `unresolved_questions` / `model_id` / `assessed_at`，**不写 `score`**；无评估器、无徽章、无风险气泡（Schema 中 `score` 仍为可选字段以兼容旧数据，但不参与任何 refine 或授权分支）。
  - 测试（45 例全绿，`npm test` 全量 722 passed / 6 skipped 无回归）：
    | 套件 | 用例数 | 覆盖断言 |
    |---|---|---|
    | `tests/unit/ipc-redaction.test.ts` | 21 | 键名脱敏（大小写/下划线/连字符变体）、真实凭据值指纹脱敏（≥6 字符）、形态脱敏（sk-/ghp_/AKIA/xoxb-/Bearer/PEM/`KEY=`）、先脱敏后截断、嵌套对象/数组、计数按出现次数、循环引用不爆栈 |
    | `tests/unit/supervisor-budget.test.ts` | 7 | 独立落盘 `.stagent/supervisor-budget.json`、重启后累计值恢复、超额在 `call` 之前抛 `E_BUDGET_EXCEEDED`、**Worker 合同账本零污染**、快照剩余额度口径 |
    | `tests/unit/supervisor-contract-generator.test.ts` | 17 | 定时/防抖触发零生成零调用、L0 路径提取与默认命令、保护清单命中仍保留可写路径并置 `needs_protection_approval`、草案 100% `parse()` 通过、初始 `DRAFT/DRAFT`、`submitDraftForApproval` 状态跃迁与非法态拒绝、G-11 未决问题零丢失、L1 无账本抛错、L1 用量只记独立账本、`maturity_assessment` 不含 `score` |
  - 如实保留的残余（不阻塞验收）：
    - **L1 尚无生产模型适配器**：`enrich` 是注入函数，当前仅测试与未来编排层可调用；未接线前生产路径恒为纯 L0（零费用），不会误触发。
    - **草案生成器尚未接入 UI / 控制面**：属 `TASK-C.2`（Studio 精简版）与 `TASK-S.3`（推迟 v0.2+）范围。
    - ~~`throttler.ts` 仍缺失~~ → **已于 2026-10-24 合入**（merge `a9066dd` / `a7d7292`），`TASK-S.1` 升为 `[COMPLETED]`；见 S.1 交付说明。

---


---

#### 【Task S.3】Supervisor HUD 建议流与 WebSocket 广播
* **任务编号**：`TASK-S.3`
* **前置依赖**：`TASK-S.2`, `TASK-D.1`
* **任务状态**：**[DEFERRED → v0.2+]** / **[REWORK]**（旧设计实现——含 `SUPERVISOR_MATURITY_UPDATED` 成熟度帧——**存于未合并分支 `wip/s2-s3-supervisor-old-design`，未进入 main，非 v0.1 验收依据**）
* **v0.1 保留范围**：仅脱敏模块 `src/lib/ipc/redaction.ts`（键名/真实值/形态三层脱敏、先脱敏后截断），随 TASK-S.2 精简版移植并独立验收；「仅鉴权连接可收帧」作为既有 D.1 原则继续生效。其余广播能力（成熟度帧、Snooze、HUD 上行 action）推迟 v0.2+ 重新评审，状态/草案推送需改接 L0 规则引擎后再评估。
* **核心目标**：
  1. 通过 WebSocket 广播 Supervisor 建议流至已认证客户端。**实现口径**：在 §6.1「类型至少包括」下扩展 `SUPERVISOR_MATURITY_UPDATED`（成熟度快照）、`SUPERVISOR_DRAFT_PROPOSED`（草案提案）、`SUPERVISOR_STATUS_CHANGED`（运行状态）三类下行帧；既有 `SUPERVISOR_SUGGESTION` 保持兼容。
  2. 支持客户端响应：`ACCEPT`、`SNOOZE`（10 分钟静默）、`DISMISS`。**实现口径**：新增上行帧 `SUPERVISOR_SUGGESTION_ACTION`（`client->server`，强制鉴权）。
  3. 建议去重与频控防打扰（30s 内容去重 + 10s/12 帧滑动窗口）。
  4. 敏感信息防护：所有下行 payload 经键名 / 真实值 / 形态三层脱敏，凭据原文不出现在帧中。
* **涉及核心文件**：
  - 新增：`daemon/supervisor/suggestion-broadcaster.ts`（广播决策、去重/频控/SNOOZE、脱敏、状态推导）
  - 新增：`src/lib/ipc/redaction.ts`（共享深度脱敏：`redactText` / `redactDeep`）
  - 修改：`src/lib/ipc/frames.ts`（协议 v1.3：4 类 Supervisor 帧 + payload 契约 + 帧目录）
  - 修改：`daemon/supervisor/throttler.ts`（状态快照 `state` + `setStateListener`，S.3 状态源）
  - 修改：`daemon/server.ts`（广播器接线、鉴权过滤、上行 action 分发、发送异常隔离）
  - 测试：`tests/unit/supervisor-broadcast.test.ts`（26 用例）
* **Pass/Fail 验收判定**：
  - **PASS**：认证客户端准时接收合规建议帧，SNOOZE 静默逻辑生效。
  - **FAIL**：未认证连接接收到帧。
* **历史记录（旧设计实现，仅存于未合并分支 `wip/s2-s3-supervisor-old-design`，非 v0.1 验收依据）**：该分支上 `tests/unit/supervisor-broadcast.test.ts` 共 26 个用例曾报告 PASS（2026-10-20；最终树整轮测试未在干净终端复跑）。
  | 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | A 成熟度事件 | 2 | 完整快照（score / badge / 四维 / 未决问题 / advisory_only）；0 分同样广播（非门禁） |
  | B 草案事件 | 4 | 摘要含目标/白名单/禁区/验收/命令/计数值预算；默认无全量、`includeContract` 时通过 Schema；G-11 未决问题逐项保留；摘要不含 env grants；兼容 `SUPERVISOR_SUGGESTION` 伴随帧 |
  | C 状态事件 | 3 | STREAMING → `WORKER_MUTED`；轮次结束 `WORKER_MUTED → EVALUATING → IDLE`；相同状态不重复广播 |
  | D SNOOZE 与防打扰 | 6 | SNOOZE 抑制成熟度但状态帧可送达、resume 恢复；到期自动解除并补发 IDLE；30s 去重；频控窗口恢复；DISMISS 后不再推送；ACCEPT/非法载荷 |
  | E 脱敏 | 6 | `sk-`/Bearer 形态抹除；宿主 `STAGENT_HOST_SECRET` 值不入帧；敏感键名整体替换且不改入参；合同 `authorization` 权限块不被误伤；长数组有界裁剪；先脱敏后截断 |
  | F 连接隔离与容错（真实 WS） | 5 | 已认证收到 / 未认证收不到；断线后广播返回 0 且不抛错、新连接可恢复；transport 异常计数且不外抛；上行 SNOOZE → SNOOZED 状态帧并抑制后续；草案帧仅认证可见且 < 2MB |
  - 协议变更说明：`src/lib/ipc/frames.ts` 协议版本由 v1.2 升至 **v1.3**；新增帧在 `FRAME_CATALOG` 标记 `spec: "v1.3"`，与 v1.2.1 的 13 类基础帧区分；`isClientToServerAllowed` 放行新增的上行 action 帧，其余方向约束不变。
  - 安全边界说明：广播器不持有连接表，所有下行统一经 `server.broadcast()`，后者逐连接校验 `authenticated === true`；发送异常按连接隔离（`terminate` + 移出集合），不会中断其余客户端或 Supervisor 评估循环。

---


---

#### 【Task S.4】Demo 静态原型生成器与 Mock 预览服务 `[v1.6.1 升级]`
* **任务编号**：`TASK-S.4`
* **前置依赖**：`TASK-S.2`
* **任务状态**：**[COMPLETED]**（2026-10-23 交付：分支 `feat/task-s4-demo-service`，提交 `95ea2a3`、`07af0f2`，经 `d5ee448` 合入 main。落地内容：需求摘要 → 纯静态原型生成（`.stagent/demo/`，产出 `index.html`/`styles.css`/`app.js`）、单文件 2MB UTF-8 字节闸门（`E_DEMO_PAYLOAD_TOO_LARGE`，HTTP 413，先全量校验再统一落盘）、独立 Origin 预览服务（仅绑 127.0.0.1:4100~4110，`findAvailablePort` + `listen` 双重端口回退）、CSP `default-src 'none'; connect-src 'none'` 与路径逃逸/隐藏文件防护、版本快照与按 ID 回退（含残留资源清理）、`DEMO_PREVIEW_STATUS` 生命周期广播（`RUNNING`/`STOPPED`/`ERROR`）、Daemon HTTP 与 WS 入口对 Demo 来源 403（**置于 CORS 放行之前**，并覆盖 sandbox iframe 的 `Origin: null`）。门禁：tsc 0 错、eslint 0 错、19 项定向单测全绿。偏离说明：采用三资源而非单文件——严格 CSP 下 `script-src 'self'` 不允许内联脚本，维持单文件需放开 `'unsafe-inline'`，安全性优先；2MB 仍按单文件独立判定。范围外（经需求方裁决）：`createDemoPreview` 的上层调用归 TASK-C.2/旅程编排层，热重载归右栏会话打补丁时对接）
* **v0.1 范围**：受控单页静态 HTML/React 原型生成 + 虚拟 Mock 数据构造 + 独立端口与跨源沙箱隔离预览服务。
* **核心目标**：
  1. **原型受控构建器 (`daemon/supervisor/demo/demo-generator.ts`)**：
     - 在需求澄清告一段落后，根据已收敛的 `.stagent/specs/requirements.md`，提取页面布局、核心功能分支与表单字段；
     - 自动组装纯静态前端页面（包含 Tailwind/CSS 样式与内嵌虚拟 Mock 数据），落地于 `.stagent/demo/` 临时工作区；
     - **单文件落盘上限 ≤ 2MB**：落盘前检查生成资产尺寸，单文件超过 2MB 立即拒绝写入并抛出 `E_DEMO_PAYLOAD_TOO_LARGE`；
     - 严禁赋予任何真实数据库或外部网络权限（纯静态前端 Mock）。
  2. **跨源沙箱预览服务与 CSP 隔离 (`daemon/supervisor/demo/preview-server.ts`)**：
     - 在本地分配独立随机未占用端口（如 4100~4110），启动基于 Node 的静态 Web 预览服务（独立 Origin）；
     - 前端 Studio 视口必须通过 `<iframe sandbox="allow-scripts">` 嵌入，**严格严禁添加 `allow-same-origin`**；
     - 注入严格 Content-Security-Policy (CSP)：禁止 Demo 页面发起向 Daemon 端口或外部非白名单域名的网络请求；
     - Daemon 端 RPC/API 网关增加 Origin 校验，来自 Demo iframe 的跨源请求一律以 403 阻断；
     - 通过 WebSocket 向 UI 广播 `DEMO_PREVIEW_STATUS`（包含独立预览 URL 与更新时间戳）；
     - 支持热重载更新：当用户在右侧对话中打补丁时，增量重写 Demo 文件并触发页面无刷新重载。
  3. **增量原型演进与历史快照回退 (`daemon/supervisor/demo/demo-evolution.ts`)**：
     - 每次需求变更生成新的 Demo patch，并将历史版本保存于 `.stagent/demo/snapshots/`；
     - 支持用户在 Studio 中一键回退到任一历史 Demo 试玩快照。
* **涉及核心文件**：
  - 新增：`daemon/supervisor/demo/demo-generator.ts`
  - 新增：`daemon/supervisor/demo/preview-server.ts`
  - 新增：`daemon/supervisor/demo/demo-evolution.ts`
  - 新增：`daemon/supervisor/demo/types.ts`
  - 测试：`tests/unit/supervisor-demo-generator.test.ts`
  - 测试：`tests/unit/supervisor-demo-server.test.ts`
  - 测试：`tests/e2e/demo-iframe-isolation.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：输入 Markdown 需求文档可稳定产出包含 Mock 数据的静态页面；本地预览服务在独立端口启动且在 2 秒内响应；Demo 嵌入 iframe 无法读取主应用 Cookie/LocalStorage，CSP 成功阻断向 Daemon 端口的 RPC 访问；单文件 > 2MB 被坚决拦截。
  - **FAIL**：iframe 配置了 `allow-same-origin`；Demo 页面能够调用 Daemon API；端口冲突未能自动回退。

---
#### 【Task S.5】Supervisor 质疑自查与根因分流归因引擎 `[v1.6.1 升级]`
* **任务编号**：`TASK-S.5`
* **前置依赖**：`TASK-S.1`, `TASK-S.2`, `TASK-D.2b`
* **任务状态**：**[COMPLETED]**（2026-10-23 交付于 `feat/task-s5-dispute-engine`：`a1469b7` 主体 + `a83f18a` 口径修正，经 `2bb1313`、`5748ad0` 合入 main。门禁：`npm run typecheck` 0 错；`tests/unit/requirements-store.test.ts` 7 通过、`tests/unit/dispute-triad.test.ts` 12 通过；main 上 4 个定向文件 60 例、集成 30 例全绿。落地清单：`daemon/supervisor/specs/requirements-store.ts`（`requirements.md` 读写、合同意图初始化、`specs/revisions/req-v*.md` 版本冻结、执行期锁定与 SHA-256 完整性校验）、`daemon/supervisor/dispute/evidence-triad.ts`（会话/规范/Worktree 三方抓取，终端与退出码取自最新 Evidence）、`classification.ts`（确定性归因 + 置信度 + 返工/变更提案）、`index.ts`（60s 看门狗与报告装配）、`types.ts`、`daemon/server.ts` 的 `POST /api/supervisor/dispute` 与 `DISPUTE_REPORT_READY` 广播。**口径说明**：① 文件命名按实际落地为 `classification.ts` / `index.ts` / `types.ts`（卡内设计期 `root-cause-analyzer.ts` / `rework-dispatcher.ts` / `dispute-types.ts` 未沿用）；② 需求快照按架构 §5.1 落在 `.stagent/specs/revisions/req-v<N>-<sha8>.md`，索引 `.stagent/specs/requirements.snapshots.json`；③ 归因是确定性规则而非模型打分，置信度由证据信号计算，`< 0.7` 强制降级；④ 越界返工以 `rejected_paths` + `requires_scope_expansion` 阻断并提示升版，未新增 `EXPANDED_SCOPE_REQUIRED` 错误码，避免扩充错误码目录。**残余口径差（不阻塞验收，需登记）**：① 路由级 401/404/超时降级未加集成用例（按交付指令仅两个单测文件）；② 终端日志取自最新 Evidence 的 stdout/stderr tail，无 Evidence 时为空且置信度下调；③ 返工提案与变更草案均为未落盘对象，执行/审批沿用既有链路）
* **v0.1 范围**：自然语言质疑入口 + 三方事实交叉核验管道 + 看门狗超时控制 + 置信度治理 + 严格 Scope 子集自动返工。
* **质疑入口路由**：右栏会话在真实试玩/验收阶段识别质疑意图时，提供转入 Studio 质疑自查的明确入口；该路由由本卡与 TASK-C.2 集成实现，不属于已完成 TASK-C.6 的交付内容。
* **核心目标**：
  1. **三方事实核验管道 (`daemon/supervisor/dispute/evidence-triad.ts`)**：
     - 响应用户的自然语言质疑（例如：“订单页面没有满减折扣功能”）；
     - 自动抓取三方物理事实：① 会话历史中用户原始提问与意图确认记录；② `.stagent/specs/requirements.md` 中的已批准规范条目；③ 当前 Worktree 实际代码 Diff、终端日志与测试退出码；
     - **自查对照源**：质疑分析时，必须对照触发本轮施工的**不可变需求快照**（`.stagent/specs/revisions/req-v*.md`），而非仅读取可能已被后续对话修改的 `requirements.md` 最新态；
     - 引入 60 秒自查看门狗：自查计算超过 60 秒触发超时兜底，安全降级。
  2. **确定性分流归因与置信度治理 (`daemon/supervisor/dispute/root-cause-analyzer.ts`)**：
     - 模型对归因结论输出评估置信度 `confidence`：
       - 当且仅当 `confidence >= 0.7` 时，输出确定性裁决：
         - **分支 A (实现偏差 Bug)**：需求文档已明文记载但代码实现缺失或抛错，裁决为 `IMPLEMENTATION_DEVIATION`，输出“系统实现偏差，本轮免费修复”，生成 `DefectFixTask`；
         - **分支 B (需求变更 Drift)**：代码完全符合已批准需求与 Demo，系用户提出新业务规则，裁决为 `REQUIREMENT_DRIFT`，输出“识别到新需求，开始增量演变”，引导用户进入需求文档增删与 Demo 迭代；
       - 当 `confidence < 0.7` 时，**坚决严禁模型武断下结论**，自动降级为 `UNCERTAIN`，仅并排呈现用户原话、规范条目与代码改动事实，由用户人工勾选确认是 Bug 还是新需求。
  3. **自动返工 Scope 严格子集检查 (`daemon/supervisor/dispute/rework-dispatcher.ts`)**：
     - 实现偏差派发的 `DefectFixTask`，其可修改文件范围必须严格限制在原已批准合同 `writable_paths` 的**真子集或全集**之内；
     - 若自查修复方案需要新增文件或引入新依赖，必须抛出 `EXPANDED_SCOPE_REQUIRED`，立即阻断自动返工并转入需求变更增量合同审批流程；
     - 资产关联贯通：在会话、草案与 Evidence 中贯穿统一关联键 `change_request_id`，实现全链路可审计溯源。
* **涉及核心文件（以实际落地为准）**：
  - 新增：`daemon/supervisor/specs/requirements-store.ts`
  - 新增：`daemon/supervisor/dispute/evidence-triad.ts`
  - 新增：`daemon/supervisor/dispute/classification.ts`
  - 新增：`daemon/supervisor/dispute/index.ts`
  - 新增：`daemon/supervisor/dispute/types.ts`
  - 修改：`daemon/server.ts`（`POST /api/supervisor/dispute` 与 `DISPUTE_REPORT_READY`）、`src/lib/ipc/frames.ts`、`src/lib/error-codes.ts`
  - 测试：`tests/unit/requirements-store.test.ts`（7 用例）
  - 测试：`tests/unit/dispute-triad.test.ts`（12 用例）
* **Pass/Fail 验收判定**：
  - **PASS**：对于需求已写但代码写漏的典型 Case，置信度高且 100% 裁决为实现偏差；低置信度案例自动降级为事实陈述并由用户裁决；自动返工超出原合同 Scope 时被坚决拦截并提示升版审批；60 秒内必出结果或安全超时。
  - **FAIL**：低置信度时向用户强加主观判定；自动返工越界修改了原合同未授权的文件。

#### 【Task S.6】非技术旅程串联（右侧唯一入口分流 + 确认原型开工）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-S.6`
* **前置依赖**：`TASK-S.4` (COMPLETED), `TASK-C.7` (COMPLETED), `TASK-S.5` (COMPLETED), `TASK-C.2` (COMPLETED), `TASK-S.2` (COMPLETED), `TASK-W.5a` (PASS)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，merge `6415fbd`；分支 `feat/task-s6-journey-orchestration` 功能提交 `bbab79e`。门禁：合后四件套全绿（1155 passed / 6 skipped）；tsc 0 错、eslint 0 错、build 通过。落地：`classifyJourneyIntent` / `orchestrateJourney` / `POST /api/supervisor/journey`；右侧 `onBeforeSend` 分流卡；`buildProposalFromContract` + `createTaskGraph` 真接线【确认原型】；需求 hint 刷新；Studio 视口建议切换；单测 `journey-intent-router` / `journey-orchestrate` / `journey-proposal-from-contract`。**S.6b 已收口 [COMPLETED]**：merge `024d2b8` / 功能 `613ff51`（分支 `feat/task-s6b-real-playtest`）；合后四件套 1165 passed / 6 skipped；真机预览服务 4200–4210、`RealPlaytestPane` iframe+外链、旅程 `REAL_PLAYTEST`→`START_REAL_PLAYTEST`、Origin 防线。不改架构规范；未做 W.5b/c / S.3 HUD / C.2 重做。）
* **对照白话验收**：`docs/reports/非技术用户旅程验收稿.md`（八步 + Fast Path + 右侧唯一入口）
* **v0.1 范围**：右侧唯一入口的白话分流路由器 +「确认原型 → 建全灰 TaskGraph → 进入可审批/开工链」主链粘合；聊完一段落后左侧需求说明可感知刷新；审批/开工后中栏图随真实 Evidence 点亮（复用既有 illumination verify）。底座（S.4 Demo、C.7 Graph、S.5 dispute、C.2 四视口、S.2 草案、W.5a Worker）只接线、不重砌。
* **明确不包含**：
  - `TASK-W.5b` / `TASK-W.5c`（第二/第三个 Agent）
  - UI 抛光与视觉重设计
  - `TASK-S.3` HUD / 成熟度徽章 / Snooze（仍 DEFERRED→v0.2+）
  - 重做 `TASK-C.2` 四视口壳（只补编排接线）
  - 修改《系统架构设计规范》或另开 ADR
* **核心目标**：
  1. **右侧白话分流（唯一入口）**：用户只跟右侧聊天；系统按意图静默路由——质疑纠错 → 调 `POST /api/supervisor/dispute` 并出白话摘要卡（可切质疑视口）；大事/提需求 → 出或更新草案与左侧需求说明；小事（字号/文案等）→ Fast Path 静默合同，**免强制整套 Demo**。
  2. **确认原型 → 建图开工主链**：中栏 Demo（S.4 独立端口）可试玩；用户点【确认原型并实施真实工程】后，必须真实创建初始**全灰** TaskGraph（C.7）并进入可审批/开工链；**禁止**只改预览 nonce / 假状态切换冒充开工。
  3. **Evidence 驱动点亮**：审批/开工后，中栏图随 Worker 真实写入产生的 Evidence，经既有 `illumination-verifier` / `POST /api/graph/verify` 逐节点点亮；不自报假绿。
  4. **可选 / S.6b（本卡可降级登记）**：当展示态进入代码事实态 `REAL_PLAYTEST`（勿写作 `PREVIEW_READY`）时，将真预览 URL 挂到中栏或外链；若本卡工期超范围，明确登记为后续子卡，不阻塞主链验收。
* **涉及核心文件（实施时以实际接线为准，本卡仅定范围）**：
  - 编排/分流：`daemon/supervisor/` 下会话意图路由与 Fast Path / dispute / 草案触发粘合（复用 S.1/S.2/S.5，不另起炉灶重写引擎）
  - 前端粘合：右侧会话 → 分流结果卡片；`DemoPreviewPane`【确认原型】→ Graph 建图 API；左侧规范资产区需求刷新；质疑卡与视口切换（复用 C.2 `StudioViewportShell`）
  - 既有复用：S.4 Demo 预览服务、C.7 `graph-engine` / verify、S.5 dispute API、C.2 四视口、W.5a 执行通道
* **Pass/Fail 验收断言（≤5，可测、白话）**：
  1. **右侧一句话分流**：质疑 → 调 dispute 并出白话卡（可切质疑视口）；大事 → 出/更新草案；小事 → Fast Path（免强制 Demo）。
  2. **聊到一段落**：左侧需求说明出现或更新（用户可感知刷新，不必手写技术规格）。
  3. **确认原型开工**：Demo 可进中栏试玩；点【确认原型并实施真实工程】→ 建全灰 TaskGraph 并进入可审批/开工链（**禁止只改 nonce**）。
  4. **点亮**：审批/开工后，中栏图可随真实 Evidence 点亮（复用现有 verify；空验证集仍不得假绿）。
  5. **可选/S.6b**：`REAL_PLAYTEST` 真预览 URL 挂中栏或外链；本项已由 S.6b 合入收口（merge `024d2b8`）。
* **Pass/Fail 验收判定**：
  - **PASS**：上述断言 1–4 均可在本地 main 上手测复现；断言 5 要么交付要么在卡内显式降级登记；无产品代码范围外改动混入本卡。
  - **FAIL**：确认原型只改 nonce/假态；分流把质疑当闲聊或把小事逼进全套 Demo；点亮不经 Evidence；把缺口塞回已完成的 C.2/S.3/S.5 卡而不立本卡。

---
### 3.3 受控 Coding Worker、安全策略、威胁守卫与成熟 Agent 适配（W.1/W.2 已完成；W.3/W.4 落 Sprint 2；W.5a 落 Sprint 1，绕过负例收尾落 Sprint 3）

#### 【Task W.1】Coding Worker 适配器抽象与任务指令装配
* **任务编号**：`TASK-W.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（2026-10-20 收尾：能力声明第 9 项 `known_limitations`、合同上下文装配、Worktree 边界校验与工具暴露收窄全部落地；专用用例 **34 个**全通过；用例总数以最新 CI 为准）
* **v1.3.3 定位调整**：自研 API Worker 由主线转为**保底运行基线与单元测试替身**；成熟 Agent 接入由 TASK-W.5a/b/c 承载。`AdapterCapabilityDeclaration` 增补字段：`billing_model`、`streaming_protocol`、`resume_mechanism`、`interrupt_supported`、`native_tools_disabled: string[]`、`verified_on`（实测 CLI 版本号与日期，空即「待实机验证」）。
* **核心目标**：
  1. 定义 `CodingWorkerAdapter` 接口，支持 Managed AI 与 CLI。
  2. **合同生效后的任务指令下发与装配 (Task Instruction Injection)**：
     - 当收到合同批准事件时，Session Router 组装标准任务指令卡片并推入**右侧 Worker 对话窗口**；
     - 注入最高优先级任务上下文（目标意图、文件白名单、禁止触碰目录、验收要求）；
     - 将 Worker 执行的工作目录强行锁定为生成的 Worktree 物理路径。
  3. **`AdapterCapabilityDeclaration` 补齐第 9 项 `known_limitations` (G-10)**：声明对象完整包含 9 项能力规范与平台矩阵。
  4. 注册中心默认拒绝未经能力证明的外部适配器进入 `GATEWAY_ENFORCED` 受控模式。
* **涉及核心文件**：
  - 新增：`daemon/worker/worker-adapter.interface.ts`
  - 新增：`daemon/worker/session-task-injector.ts`
  - 新增：`daemon/worker/adapter-registry.ts`
  - 修改：`daemon/worker/ai-worker.ts`（`prepare()` 装配 + 失败上下文回传）
  - 修改：`daemon/worker/openai-client.ts`（System Prompt 单一事实源）
  - 修改：`daemon/pipeline/orchestrator.ts`（传入宿主根强制 Worktree 隔离校验）
  - 测试：`tests/unit/worker-adapter.test.ts`
* **接口定义**：
  ```typescript
  export interface AdapterCapabilityDeclaration {
    adapter_id: string;
    protocol_version: string;
    model_metering_source: "PROVIDER" | "LOCAL_ESTIMATE";
    tool_interception_supported: boolean;
    filesystem_permissions: "GATEWAY_ONLY" | "DIRECT_UNCONTROLLED";
    command_permissions: "WHITELIST_ONLY" | "UNRESTRICTED_SHELL";
    cancellation_supported: boolean;
    session_recovery_supported: boolean;
    network_requirements: "NONE" | "EXPLICIT_ONLY" | "DIRECT_INTERNET";
    platform_support: ("darwin-arm64" | "darwin-x64" | "linux-x64" | "win32-x64")[];
    known_limitations: string[]; // 第 9 项必填已知限制 (G-10)
  }
  ```
* **Pass/Fail 验收判定**：
  - **PASS**：未声明 `known_limitations` 或声明直连 FS 的适配器，无法被注册为受控模式。
  - **FAIL**：未知黑盒适配器被登记为受控。
* **完成记录（2026-10-20）**：`tests/unit/worker-adapter.test.ts` 共 **34 个用例**全 PASS：
  | 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | A 合同上下文装配 | 8 | 目标/白名单/只读/禁区/验收/预算逐字段注入；Worktree 根与段落结构；known_limitations 默认注入与未声明告警；未批准合同拒绝装配 |
  | B 工具暴露 | 4 | 无命令授权时 exec 不暴露；有授权恢复；只能收窄子集；未授权显式请求被拒 |
  | C Worktree 边界 | 8 | 等于宿主根 / 祖先 / 非隔离目录 / 完全外部 / 相对路径 / 符号链接穿透 全部拒绝 |
  | D 能力声明与注册中心 | 8 | 空限制、直连 FS、无限制 Shell、无法拦截工具、空平台矩阵逐项拒绝；重复 ID 拒绝；黑盒仅可非受控登记 |
  | E AiWorker 集成 | 5 | Prompt 单一事实源；网关落盘；模型异常 `MODEL_CALL` 上下文；工具失败 `TOOL_WRITE` 上下文；越权 `SCOPE_VALIDATION` 零落盘 |
  | F 静态边界 | 1 | `daemon/worker/**` 零 `child_process` / 零原生执行 API（**v1.3.3 收窄**：唯一例外为 `daemon/worker/cli-host/` 专用子进程隔离模块，该模块允许 spawn 但强制结构化 argv + `shell:false` + 进程树托管回收；静态测试改为断言"cli-host 之外零 spawn"） |

---


---

#### 【Task W.2】Scoped Gateway 强制工具注入与执行拦截
* **任务编号**：`TASK-W.2`
* **前置依赖**：`TASK-W.1`, `TASK-A.2` (COMPLETED), `TASK-A.4` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-20 收尾：5 大工具注入、`expected_hash` 乐观锁、`delete_file`、别名 argv 执行与路径/命令拦截全部落地；专用用例 **29 个**全通过，全仓 55 文件 / 522 用例）
* **核心目标**：
  1. 注入 `stagent_*` 5 大标准工具。
  2. **`stagent_write_file` 的 `expected_hash?` 调整为可选 (G-03)**：
     - 若传入 `expected_hash`，执行严格乐观锁比对，哈希不符抛 `E_CONFLICT`；
     - 若未传入 `expected_hash`，视为新建文件，仅在合同 `writable_paths` 范围内放行。
  3. **强制结构化 argv 且 `shell:false` 调用 (G-04)**：
     - 命令执行必须以 `spawn(executable, args, { shell: false })` 执行；
     - 严密检查参数，包含未转义连接符（`;`, `&&`, `|`, `$()`）的参数作为字面量抛出 `E_UNAUTHORIZED_COMMAND`。
  4. 越界访问抛 `E_OUT_OF_SCOPE`，禁区抛 `E_FORBIDDEN_PATH`，违规后合同与证据标 `BLOCKED`。
  5. **网关物理先阻断与合同 v2 升版联动 (v1.4.0 新增)**：
     - Gateway 检测到未授权读写或非白名单命令时，必须物理拒绝执行，不可依赖 LLM 自觉停手；
     - 单次常规越界向 Worker 返回错误码由其自愈；若属于业务需求扩大导致的范围突破，触发生成 `Contract v2` 差异补丁，旧执行凭证立即停用，等待用户重新审批；
     - 代码发生新提交后，旧候选版本的测试与 Diff 证据自动标记为失效（STALE），禁止冒充通过。
* **涉及核心文件**：
  - 修改：`daemon/mcp/types.ts`（`expected_hash` / `command_alias` / `list_directory` / `delete_file` Schema）
  - 修改：`daemon/mcp/gateway.ts`（五工具分发、乐观锁、删除、别名 argv、Scope 码映射）
  - 新增：`daemon/worker/worker-toolset.ts`（按授权挂载的工具实例层）
  - 修改：`daemon/worker/session-task-injector.ts`（`WORKER_MCP_TOOLS` 五席位与 exec 暴露判定）
  - 修改：`daemon/worker/ai-worker.ts`（经 toolset 读写）
  - 测试：`tests/unit/worker-mcp-tools.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 未传 `expected_hash` 时新文件正常创建；传入错误 `expected_hash` 时被拒绝。
    - 包含注入符号（`;`, `&&`）的命令参数被字面量拦截，测试断言未进入系统 shell 执行。
    - 越界写入被阻断，合同与证据被标为 `BLOCKED`。
  - **FAIL**：使用 `shell: true` 执行命令；新文件因强制要求前值哈希而无法创建。
* **完成记录（2026-10-20）**：`tests/unit/worker-mcp-tools.test.ts` 共 **29 个用例**全 PASS：
  | 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | 五工具基本功能 | 9 | 读回内容+SHA-256；写入落盘；列举隐藏禁区/`.git`/`.stagent`；递归路径；历史别名等价；删除与 `ENOENT`；拒删目录 `E_NOT_A_FILE`；别名执行 exit 0；未知别名 `E_UNAUTHORIZED_COMMAND` |
  | 乐观锁 `expected_hash` | 4 | 命中写入；外部改动后 `E_CONFLICT` 且零覆盖；缺失文件传 hash 判冲突；非法 hash `INVALID_INPUT` |
  | 命令防注入 | 6 | `&&`/`\|`/`;`/`$()` 四类参数逐一拒绝且无副作用；旧式字符串拼接被拦；argv 字面量透传 |
  | 路径边界 | 6 | 穿越/绝对路径 `PATH_TRAVERSAL_DETECTED`；禁区 `E_FORBIDDEN_PATH`；越界 `E_OUT_OF_SCOPE`（写/删各一） |
  | 授权挂载 | 4 | 未授权 commands 时 exec 不挂载；授权后五工具全挂；收窄后未挂载即拒绝；AiWorker 经 toolset 落盘 |

---


---

#### 【Task W.2b】未跟踪文件 Scope 联合检查与越界阻断
* **任务编号**：`TASK-W.2b`
* **前置依赖**：`TASK-0.2c`, `TASK-W.2`
* **任务状态**：**[COMPLETED]**（2026-10-23 核验回写：提交 `87f909c`，经 `05f090f` 合入 main。落地 `daemon/pipeline/untracked-scope-guard.ts`，错误码 `E_OUT_OF_SCOPE_UNTRACKED` 已登记于 `src/lib/error-codes.ts`；执行后联合检查 tracked Diff 与 untracked，合同外未跟踪文件阻断并留 BLOCKED 证据。合并门禁由 TASK-D.2b 承接，不在本卡范围）
* **范围**：在执行后 Scope 校验中联合检查已跟踪 Diff 与未跟踪文件，新增统一错误码 `E_OUT_OF_SCOPE_UNTRACKED`；本卡只负责执行侧检测与阻断，不负责合并门禁。
* **涉及核心文件**：新增 `daemon/pipeline/untracked-scope-guard.ts`；修改 `daemon/pipeline/orchestrator.ts`、`src/lib/error-codes.ts`；配套执行侧越界测试。
* **Pass/Fail**：PASS：`git status --porcelain -uall` 覆盖未跟踪文件；合同内新文件可继续，合同外文件在执行后检查被阻断并留下可追溯 BLOCKED 证据；FAIL：仅检查 `git diff --name-only` 或错误码不一致。

#### 【Task W.3】测试环境、秘密脱敏与网络/端口策略守卫
* **任务编号**：`TASK-W.3`
* **前置依赖**：`TASK-W.2`
* **任务状态**：**[COMPLETED]**（2026-10-21 只读核验，状态校正：`daemon/worker/policy-guard.ts` 提供环境白名单 / `CI=true` / `env_file_grants` / 网络策略，接入 `daemon/mcp/gateway.ts`（`buildCommandEnvironment`）与 `daemon/runner/command-runner.ts`（`resolveEnvironment`）；秘密遮蔽由 `redactSecrets` 在双窗口截断**之前**执行；`GatewayCallCounters` 对工具调用与命令执行分列记账并独立熔断；专用用例 `tests/unit/policy-guard-env-network.test.ts` 5 个 + `tests/unit/w3-command-policy.test.ts` 9 个全绿）
* **核心目标**：
  1. 环境变量过滤：默认注入 `CI=true`，严禁继承宿主全部环境变量，仅放行合同 `allowed_environment_variable_names`。
  2. `env_file_grants` 授权：按命令 alias 注入对应的测试环境配置文件。
  3. **秘密遮蔽严密在截断之前执行**：对注入的秘密值做掩码替换，遮蔽必须早于输出双窗口截断，防止截断边界泄露。
  4. 网络与端口策略：`network_policy = "DENY"` 时拦截外部网络；动态端口冲突时给出可诊断错误，不误报为断言失败。
  5. **工具与命令预算分列记账断言 (闭环 G-09 第 3 子项)**：
     - 在命令执行器与 MCP 工具代理层实现独立记账；
     - `budget_limits` 中命令执行次数与工具调用次数分列记录并实时累加至账本；
     - 任何单项超限立即触发 `E_BUDGET_EXCEEDED` 熔断，断言不因模型 Token 未超标而放行违规工具调用。
* **涉及核心文件**：
  - 新增：`daemon/worker/policy-guard.ts`
  - 修改：`daemon/runner/command-runner.ts`
  - 测试：`tests/unit/policy-guard-env-network.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：宿主非白名单变量完全隔离；秘密遮蔽在截断前执行完毕；网络阻断生效；工具与命令分列记账超限时 100% 触发 E_BUDGET_EXCEEDED 熔断。
  - **FAIL**：环境变量泄露；秘密在截断边缘明文泄露。

---


---

#### 【Task W.4】高风险执行威胁守卫与运行时能力复检 (闭环 G-01 & G-20)
* **任务编号**：`TASK-W.4`
* **前置依赖**：`TASK-W.3`
* **任务状态**：**[COMPLETED]**（2026-10-21 只读核验，状态校正：`daemon/worker/threat-guard.ts`（argv 拆段/包装命令展开/特权命令/主机路径/仓库信任）与 `daemon/worker/runtime-interceptor.ts`（配置漂移降级 + 未知通道检测）已接入 `daemon/mcp/gateway.ts` 与 `daemon/pipeline/orchestrator.ts`；`tests/unit/threat-guard-runtime-check.test.ts` 26 个用例全绿，其中「4 类绕过负例全部阻断」为显式用例。**口径说明**：本卡证明为注入层 + Gateway 层；真实 CLI 版本的同口径负例归 `TASK-W.5a`）
* **核心目标 (闭环 A §4.2.3, §6.4.7, §7.3)**：
  1. **高风险执行威胁守卫 (产出 `E_UNSAFE_EXECUTION`)**：
     - 在命令启动前校验 argv 与仓库信任标记；
     - 命中不可信仓库、特权操作（`sudo`, `chown`, `insmod`）、访问任意主机路径或无法可靠限制子进程的高风险命令时，坚决拒绝执行；
     - 抛出 `E_UNSAFE_EXECUTION`，将 Evidence 置为 `status: "BLOCKED"` 且 `reason_code: "UNSAFE_EXECUTION"`，并在 UI 提示外置隔离。
  2. **运行时强制能力复检与降级**：
     - 在 Worker 会话期间，周期性或在每步工具调用前复检 Adapter 强制能力；
     - 若探测到启动配置被篡改、原生 FS/Shell 工具未被拦截或出现未知通道，立即将当前会话降级为 `UNCONTROLLED_EXTERNAL`，停止受控执行，阻断 Evidence 通过，并广播 `GATEWAY_VIOLATION`。
  3. **落实 4 类绕过路径不可用负例断言**：
     - 绕过 1：直接向 Worktree 外路径写入 ➔ 必然失败；
     - 绕过 2：执行未授权 Shell ➔ 必然失败；
     - 绕过 3：跨 Worktree 直接访问主工作树 ➔ 必然失败；
     - 绕过 4：跳过 Gateway 直接调用原生工具 ➔ 必然失败。
* **涉及核心文件**：
  - 新增：`daemon/worker/threat-guard.ts`
  - 新增：`daemon/worker/runtime-interceptor.ts`
  - 测试：`tests/unit/threat-guard-runtime-check.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 特权命令（如 `sudo ls`）被 Threat Guard 拦截，抛出 `E_UNSAFE_EXECUTION`，未产生子进程，Evidence 被标记为 `BLOCKED` + `UNSAFE_EXECUTION`。
    - 运行时注入未知工具通道后，Adapter 立即被降级为非受控状态，当前合同禁止生成通过证据。
    - 4 类绕过负例测试 100% 触发阻断。
  - **FAIL**：特权命令进入执行；绕过 Gateway 能够读写文件。

---


---

#### 【Task W.5a】Claude Code 适配器与 cli-host 黑盒实测 (v1.3.3 新增)
* **任务编号**：`TASK-W.5a`
* **前置依赖**：`TASK-W.2`, `TASK-C.6`（右栏会话通道）
* **任务状态**：**[PASS · verified_on: `Claude Code 2.1.296 (DeepSeek API 兼容模式) · 2026-10-21`]**（分支 `feat/w5a-claude-code`。cli-host 唯一 spawn（shell:false、进程组、SIGINT→SIGTERM→整树 SIGKILL）；一律 API Key；隔离启动见核心目标 2；真实 CLI 上流式输出、工具卡片、打断（约 0.5s）、跨 Daemon 重启 `--resume` 续接、4 类绕过负例均实测通过，证据见 `docs/reports/W5a-isolation-design.md`。**2026-10-21 步骤 D 实测收口**：以 `deepseek-chat` @ `https://api.deepseek.com/anthropic` 复跑真实 CLI 负例 **6/6 全绿**（48.58s），首次落盘 `PreToolUse hook` 的 `deny` 日志原文（含 symlink 逃逸判定）；并补测 `allowBash=true` 分支——Shell 命令触碰保护清单路径时，`shellProtectionVerdict` 按字面量拒绝并投递白话确认卡（`rm`/`mv` 均被拦，目标文件完好），证据归档 `docs/reports/W5a-真实CLI验证报告-2026-10-21.md` §4.4。**后续回归项（不阻塞）**：用官方 Anthropic 原装模型 + 官方 CLI 重跑负例；每次升级 CLI 重跑 `STAGENT_REAL_CLAUDE=1` 真实测试；Gateway MCP 端点依赖 W.4。**同轮发现并已加固（2026-10-22）**：`allowBash=true` 原先只做保护清单字面量匹配，缺「命令是否指向工作目录之外」的通用检查，`../` 越界写与 `rm -rf .stagent` 实测可绕；现 Bash 分支已串接 `reservedMetadataHit()`（`.stagent/.git/.claude/.cursor/.env` 按路径段拒绝）与 `shellEscapeVerdict()`（重定向目标与全部词元的越界判定，含 symlink 真实路径），同一攻击复测被拒且 `outside/` 为空；`/dev/null`、通配符前缀等常规用法保留，21 条命令矩阵零误伤；证据见报告 §4.5。）
* **核心目标**：
  1. 在 `daemon/worker/cli-host/` 专用子进程隔离模块中以 spawn 挂载 Claude Code CLI（结构化 argv、`shell:false`、进程树托管回收）；**全仓其余位置维持零 `child_process` 静态禁令**。
  2. **收敛策略（已实测，verified_on: `Claude Code 2.1.296 (DeepSeek API 兼容模式) · 2026-10-21`）**：优先保留 Claude Code 原生工具，通过官方 **Pre-tool hook** 配合 Stagent 网关拦截；辅以工具白名单/黑名单收窄内置 Edit/Write/Bash/WebFetch；避免粗暴剥离原生工具导致模型死循环。工作目录锁定 Worktree。**隔离启动（`[用户已确认 · 2026-10-20]`，替代 `--bare`——实测 2.1.296 的 `--bare` 会跳过 `--settings` 中的 hooks）**：
     - argv：`claude --setting-sources "" --tools Read,Glob,Grep,LS,Edit,Write,MultiEdit,TodoWrite -p <prompt> --output-format stream-json --verbose --include-partial-messages --settings <Stagent 生成> --mcp-config <Stagent 生成> --strict-mcp-config --permission-mode acceptEdits --allowedTools <同 --tools> --disallowedTools WebFetch,WebSearch,NotebookEdit,Task,Bash [--resume <session_id>]`（允许 Bash 时 `--tools`/`--allowedTools` 加 Bash、`--disallowedTools` 去掉 Bash）；永不 `--bare`、永不 bypassPermissions、永不 `--continue`。
     - `permissions.deny`：`WebFetch, WebSearch, NotebookEdit, Task, Bash, Edit/Write(./.git/**), Edit/Write(./.stagent/**), Edit/Write(./.claude/**), Read(./.stagent/claude-config/**), Read(./.stagent/session-token)`；PreToolUse hook `matcher:"*"`、`onFailure:"block"`。
     - 子进程 env 白名单：`PATH, HOME, LANG, STAGENT_HOOK_ROOT, STAGENT_HOOK_LOG, [STAGENT_HOOK_ALLOW_BASH], ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR`，另仅转发 `ANTHROPIC_BASE_URL, ANTHROPIC_MODEL, ANTHROPIC_SMALL_FAST_MODEL, ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL, API_TIMEOUT_MS, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`。
     - 专用配置目录：`CLAUDE_CONFIG_DIR=<repo>/.stagent/claude-config`（0700、gitignored、Agent 不可读写），会话记录不写用户 `~/.claude`。
     - 备选：`--restricted`（实测不跳过 hook，但不收窄工具、默认 auto 模式），仅在 `--setting-sources ""` 行为变化时启用。
  3. 接入其 Headless 模式与结构化输出（流式 JSON）对接右栏会话（TASK-C.6）；接入其会话续接能力实现 resume。
  4. 在 cli-host 中对**真实 CLI 版本**执行 W.4 的 4 类绕过负例实测，全部失败关闭后填写 `verified_on`（CLI 版本号 + 日期），方标记 `GATEWAY_ENFORCED`。
* **涉及核心文件**：
  - 新增：`daemon/worker/cli-host/claude-code-adapter.ts`
  - 新增：`daemon/worker/cli-host/process-host.ts`（spawn 托管与进程树回收）
  - 新增：`daemon/worker/cli-host/pretool-hook.mjs`（PreToolUse 门卫：越界/保留区/保护清单判定，含 2026-10-22 Shell 加固）
  - 测试：`tests/unit/cli-host-claude-code.test.ts`（确定性，含 hook 层 4 类绕过负例）；`tests/e2e/claude-code-isolation.real.test.ts`（真实 CLI，`STAGENT_REAL_CLAUDE=1` 时运行：配置注入负例、4 类绕过、专用配置目录续接）
* **Pass/Fail 验收判定**：
  - **PASS**：4 类绕过负例在真实 CLI 版本上 100% 失败关闭（2026-10-21/22 复测 **6/6 全绿**：4 类绕过 + `allowBash` 的保护清单字面量拦截 + `allowBash` 的越界/元数据加固；MCP 工具与 Read 越界读负例仍为空集合下的未测项，见 `docs/reports/W5a-isolation-design.md`）；`verified_on` 非空；流式输出与打断/续接实测达标。
  - **FAIL**：任一绕过路径可用；未实测即标记受控。


---

#### 【Task W.5b】cursor-agent 适配器黑盒实测 (v1.3.3 新增)
* **任务编号**：`TASK-W.5b`
* **前置依赖**：`TASK-W.5a`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：实测 cursor-agent 权限配置能否完全 deny shell/写文件并仅挂 Stagent MCP；凭证途径**仅限 API Key**（`[用户已确认 · 2026-10-20]` 所有 Worker 模式统一，不使用官方登录/订阅会话），注入规则见 架构 §0.6.6。**不能完全关闭原生写能力者只能登记为 `UNCONTROLLED_EXTERNAL`，仅 Vibe 模式可用，UI 显示"未受控"**。
* **Pass/Fail 验收判定**：同 W.5a 的实测纪律；`verified_on` 按实测结果填写或明确标注"未通过，仅 Vibe"。


---

#### 【Task W.5c】OpenHands 适配器（容器隔离，SANDBOX_ENFORCED）(v1.3.3 新增)
* **任务编号**：`TASK-W.5c`
* **前置依赖**：`TASK-W.5a`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：容器内仅挂载任务 Worktree，网络按合同策略；对应 `control_mode = "SANDBOX_ENFORCED"`，D.2 Gate 0 与 A §9.1 不变式承认该模式。
* **Pass/Fail 验收判定**：容器逃逸/越界挂载负例实测失败关闭；`verified_on` 填写实测版本与日期。

---


---

### 3.4 Cursor 式三栏 IDE 工作台与多维 Studio 视口（C.1/C.3 落 Sprint 1；C.2 落 Sprint 4 多维视口；C.8a/b/c 走查 Top3 已合；C.9a–C.9d 第二轮指挥权已合；C.10a/b 第三轮已合；C.10c 暗号清扫 NEW；C.4 推迟）

#### 【Task C.1】Cursor 式三栏 IDE 响应式工作台骨架与 Studio 视口
* **任务编号**：`TASK-C.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（分支 `feat/c1-three-column-layout` 提交 `e48f614`，**2026-10-21 核验：已合入 main**；当时门禁：tsc 0 错、eslint 0 错、npm test 53 文件 / 435 用例全过，其中 tests/ui/workspace-layout.test.tsx 7 用例；当前该套件 8 用例）
* **核心目标**：
  1. 构建左栏（文件树/雷达）、中栏（Monaco/Diff/Supervisor Studio 多标签与分屏）、右栏（Coding Agent 对话）的三栏 IDE 布局。
  2. **中栏多标签与分屏架构**：
     - 支持中栏多标签页切换，支持系统级 `SupervisorStudio` 标签页；
     - 支持 Split Pane（分屏）：左侧打开代码/Diff，右侧打开 Supervisor Studio，实现并排对照。
  3. **Header 补齐 5 项展示要素与 HUD 胶囊 (G-06)**：
     - 仓库名称；
     - **当前分支**（活动合同执行期展示 `task/{contract_id}`，平时展示 Base 分支）；
     - **运行模式**（v1.3.3：清晰展示 `VIBE` 自由模式（默认）vs `PROTECTED` 保护模式；是否有合同正在执行由合同信息与执行状态单独展示）；
     - 当前合同 ID 与绑定的 Worktree 物理绝对路径；
     - **Worker 受控状态徽标**（`GATEWAY_ENFORCED` 绿色受控 vs `UNCONTROLLED_EXTERNAL` 黄色非受控）；
     - **Supervisor 入口**（v0.1：一键打开 Studio 快捷入口；成熟度打分徽章、未决风险气泡推迟 v0.2+）。
  4. **工作区默认绑定与切换提示 (G-18)**：合同批准后编辑区默认绑定 Worktree；切回主工作树时给出显式切换提示与执行状态指示。
* **涉及核心文件**：
  - 新增：`src/components/WorkspaceLayout.tsx`
  - 新增：`src/components/FileTree.tsx`
  - 新增：`src/components/WorkspaceHeader.tsx`
  - 新增：`src/components/SplitPaneContainer.tsx`
  - 测试：`tests/ui/workspace-layout.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：Header 完整包含模式指示、受控徽标、Studio 入口；中栏支持 Supervisor 专属标签页与分屏布局；审批后工作区自动切换绑定 Worktree。
  - **FAIL**：缺少受控徽标或模式指示；中栏无法渲染分屏或系统标签页。

---


---

#### 【Task C.2】中栏 Supervisor Studio 多维视口（Demo / Graph / 质询 / 合同）`[v1.5.0 升级]`
* **任务编号**：`TASK-C.2`
* **前置依赖**：`TASK-C.1`, `TASK-S.2`, `TASK-S.4`, `TASK-C.7`, `TASK-S.5`
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，merge `51039aa`；分支 `feat/task-c2-four-viewports` 提交 `c1ad3be`。门禁：合后四件套全绿（1099 passed / 6 skipped）；tsc 0 错、eslint 0 错、build 通过（dist 33 文件 / 3.35 MB）。落地清单：`StudioViewportShell`（四视口 `hidden` 保活）、`DemoPreviewPane` / `TaskGraphPane` / `DisputeConsolePane`、`viewport-routing.ts`（展示态→默认视口）、`use-daemon-stream`/`daemon-api` 消费 `presentation_state`、`demo-origin.ts`、`tests/ui/studio-viewport-switching.test.tsx`（15）。**口径说明**：① 默认视口只跟 Daemon 展示态，手动 Tab 覆盖，展示态一变清覆盖；② Demo iframe 沙箱仅 `allow-scripts`，严禁 `allow-same-origin`；③ Graph 复用 C.7 `TaskGraphPanel`，质疑复用 S.5 API。**残余口径差（不阻塞验收，需登记）**：①【修改原型】/【确认原型并实施真实工程】按钮 UI 在位，旅程编排层仍为弱接线——**已转交 `TASK-S.6` 吸收**；② 矩阵旧注「水表」非本卡 Pass 项，未纳入本次交付）
* **核心目标**：
  1. **Studio 四重视口集成切换**：
     - **视口 1: Demo 原型试玩视口 (`DemoPreviewPane.tsx`)**：以 iframe/Webview 嵌入 TASK-S.4 启动的本地轻量预览服务，顶部配备【修改原型】与【确认原型并实施真实工程】大操作栏；
     - **视口 2: Task Graph 拓扑看板 (`TaskGraphPane.tsx`)**：挂载 TASK-C.7 的业务功能思维导图与任务执行 DAG，展现由灰变绿渐进点亮；
     - **视口 3: 质疑自查质询台 (`DisputeConsolePane.tsx`)**：呈现用户质疑输入框与 TASK-S.5 产出的三方比对自查报告卡片；
     - **视口 4: 合同与 Diff 审阅视口 (`SupervisorStudioPane.tsx`)**：保留结构化合同审阅、全局保护清单白话是/否卡片与 Monaco 代码编辑。
  2. **视口智能路由**：根据当前生命周期状态自动激活对应视口（如处于 `DEMO_PREVIEW` 自动切至 Demo 视口；处于 `EXECUTING` 自动切至 Task Graph 视口；处于 `DISPUTED_INSPECTING` 自动切至质询台）。
  3. **模式指示与保护清单兜底**：保留 Header 模式指示（自由模式 / 保护模式）与全局保护清单单项白话卡片。
* **涉及核心文件（以实际落地为准）**：
  - 新增：`src/components/studio/StudioViewportShell.tsx`、`DemoPreviewPane.tsx`、`TaskGraphPane.tsx`、`DisputeConsolePane.tsx`、`viewport-routing.ts`
  - 新增：`src/lib/ipc/demo-origin.ts`
  - 修改：`src/components/SupervisorStudioPane.tsx`、`src/routes/index.tsx`、`src/hooks/use-daemon-stream.ts`、`src/lib/daemon-api.ts`
  - 测试：`tests/ui/studio-viewport-switching.test.tsx`（+既有 route/admission/draft wiring 适配）
* **Pass/Fail 验收判定**：
  - **PASS**：用户可在 Demo 试玩、Task Graph 看板、质询自查台与合同代码之间平滑切换；状态流转自动切换主视口；保护清单命中白话卡片维持零弹窗/单卡标准。
  - **FAIL**：视口切换丢失已填表单或点亮状态；iframe 无法内嵌加载本地 Demo。

---

#### 【Task C.8a】老板模式文案与默认助手（消演示恐吓 / Key 向导）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.8a`
* **前置依赖**：`TASK-D.1d` (COMPLETED，main tip `b11d15b`；文档基线含 `fea44e2`)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `15ef8e6`，分支 `feat/task-c8a-boss-copy` 快进；合后四件套 **1213 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：练习沙箱可折叠、默认真助手、右栏 Key 三步向导 + 设置白话闭环；涉及 `AgentChatPane` / `pick-chat-adapter` / `WorkspaceLayout` / `SettingsTab` / `routes/index` 等。**不推翻**鉴权 / Demo Origin）
* **对照痛点（走查）**：默认「演示 Agent」+ 大黄字「不调用模型、不读文件」与右栏「说需求」打架；真助手显示未配 Key 却无一条龙向导——老板会以为「不能干活」。
* **v0.1 范围**：把工作台默认话术与助手选择收成**老板模式**：① 默认呈现不恐吓、与「可以提需求」一致；② 未配模型 Key 时给白话一步步向导（去哪配、配完怎么知道好了）；③ 演示/沙箱能力若仍保留，须降级为可折叠的次要说明，不得用整页黄条阻断心智。
* **明确不包含**：
  - 推翻 D.1 鉴权 / loopback / `#token=` / AUTH / Origin
  - 改变 Demo 独立 Origin 隔离（ADR-008）
  - 实现系统文件夹选择器或桌面壳（归 `TASK-D.1e`）
  - 改 Fast Path 准入规则或状态机边（归 `TASK-C.8b` 只做呈现）
* **核心目标**：
  1. **消恐吓**：首屏/右栏不再用「不调用模型、不读文件」大黄条否定「右侧说需求」；演示态若存在，须明确是可选沙箱且可一键切到真助手路径。
  2. **默认助手可预期**：默认选中的助手与文案一致（能干活或明确「还差一步」）；禁止「默认演示」与「请说需求」并存无解释。
  3. **Key 向导一条龙**：真助手未配 Key 时，UI 给出配置入口/粘贴位置提示与「配完如何验证」的短路径，不甩终端堆栈或工程师后台术语墙。
* **涉及核心文件（实施时以调查为准）**：右栏 Agent 选择器 / 欢迎或空态文案、Header 或会话横幅、Key/凭证配置入口相关组件与文案常量；测试以 UI 走查断言 + 组件快照/文案单测为主。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **不再恐吓**：冷开工作台后，主路径 10 秒内看不到「不调用模型 / 不读文件」级整页恐吓与「请说需求」并排打架；若演示态存在，须可折叠或明确次要。
  2. **默认一致**：默认助手名称/状态与右栏可操作提示一致（能提需求，或明确「差 Key」并给出按钮）。
  3. **Key 向导**：未配 Key 时，用户可不查 README，只靠 UI 完成「打开配置入口 → 填 Key（本卡不测真实云调用）→ 看见已就绪/可重试」白话闭环。
  4. **安全不回退**：日志/UI 不打印 Token 或 API Key 明文；鉴权与 Demo Origin 回归仍绿。
  5. **门禁**：四件套全绿；新增或扩展至少 1 条文案/空态 UI 回归（禁止恐吓文案与主 CTA 冲突）。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 本地可复现；老板模式只改呈现与向导，不弱化鉴权。
  - **FAIL**：仍默认演示恐吓却标完成；未配 Key 仍只有工程师报错无向导；打印密钥明文；夹带 D.1e 桌面壳冒充本卡。

---

#### 【Task C.8b】Fast Path 老板三步台（藏工程师合同细节）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.8b`
* **前置依赖**：`TASK-D.1d` (COMPLETED), `TASK-S.6` (COMPLETED)
* **任务状态**：**[COMPLETED]**（合入 main tip `6d16939`，分支 `feat/task-c8b-boss-fastpath` 快进；合后四件套 **1224 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`BossFastPathDesk` 默认三步；高级详情折叠 Scope/npm/Daemon；保护命中需勾选；大事仍完整合同台；**不改**准入规则/状态机边）
* **对照痛点（走查）**：右侧说一件小事后，中栏仍甩出合同台（`src/**`、npm、Daemon、保护解锁），像审批工单，不像「改哪里 → 确认开改」。
* **v0.1 范围**：在**不改变** Fast Path 准入规则与状态机边的前提下，把小事确认台改成老板三步默认视图：「① 改哪里（白话文件/位置）② 要不要动保护（是/否白话）③ 确认开改」。工程师细节（Scope glob、npm、Daemon、解锁暗号等）默认折叠，需要时再展开。
* **明确不包含**：
  - 放宽/收紧 Fast Path 准入条件或改 Contract Schema / lifecycle 边
  - 取消保护清单拦截或静默跳过保护区
  - 重做整套 Studio 四视口（C.2 已 COMPLETED）
  - 系统文件夹选择器（D.1e）
* **核心目标**：
  1. **三步默认**：小事 Fast Path 中栏默认只见三步白话卡，一眼能点「确认开改」。
  2. **细节可展开**：原合同工程字段仍可「高级/详情」展开，不得物理删除审计所需信息。
  3. **大事不变**：非 Fast Path / 大事草案仍可走既有合同/Graph 路径（S.6），本卡不把大事也强行三步化。
* **涉及核心文件（实施时以调查为准）**：Fast Path / 合同审阅中栏组件、S.6 journey 接线的确认台、文案与折叠控件；测试：UI 走查 + 组件测「默认三步可见 / 细节默认隐藏」。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **三步可见**：对一条合格小事（走查脚本固定文案），中栏默认出现「改哪里 / 要不要动保护 / 确认开改」三步，无需滚动才能找到主按钮。
  2. **细节默认藏**：`src/**`、npm、Daemon、保护解锁等工程字段默认不占主视线（折叠或次级区）；展开后仍可读。
  3. **保护不哑火**：若小事命中保护清单，第二步必须白话问清楚，不得因折叠而跳过确认。
  4. **大事不误伤**：非 Fast Path 路径仍可进入既有合同/Graph 体验（至少一条对照走查不过度三步化）。
  5. **门禁**：四件套全绿；至少 1 条 UI 回归锁定「默认三步 / 细节折叠」。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；准入规则与保护拦截行为与改前一致（仅呈现变化）。
  - **FAIL**：仍默认甩满工程师合同台却标完成；折叠导致保护区未确认即开改；借本卡改状态机却不另立卡。

---

#### 【Task C.8c】连接与打开死路自救（无钥匙一键重开 + 粘贴路径打开）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.8c`
* **前置依赖**：`TASK-D.1b` (COMPLETED), `TASK-D.1c` (COMPLETED), `TASK-D.1d` (COMPLETED)
* **任务状态**：**[COMPLETED]**（合入 main tip `950e53e`，分支 `feat/task-c8c-open-rescue` 快进；合后四件套 **1217 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`POST /api/session/relaunch` 无钥匙一键重开；粘贴绝对路径 `/api/recent-projects/open`；主路径少催终端/#token=；**不抢** D.1e）
* **对照痛点（走查）**：无 token 冷开锁死对话；开新文件夹仍大段催 `npx stagent open`（D.1e 已 DEFERRED，本卡**只做**文案 + 粘贴路径 / 一键重开，**不**实现系统选择器）。
* **v0.1 范围**：给「连不上 / 要开新夹」两条死路自救：① 无钥匙或 Unauthorized 时，一键唤起/重开带 `#token=` 的合法会话（复用 D.1b/D.1c 能力），不死锁在空对话；② 「打开项目」支持粘贴本机绝对路径并一键 open/重开，文案少催终端说明书。**明确不抢** `TASK-D.1e`。
* **明确不包含**：
  - 系统级文件夹选择器 / Electron / Tauri / 本机助手选夹（**整段归 `TASK-D.1e`，本卡 FAIL 若夹带并标完成**）
  - 取消 `#token=` / AUTH；把 Token 写入可分享 query 或长期明文 localStorage
  - 将 Demo 改为与控制台同源
* **核心目标**：
  1. **无钥匙可自救**：冷开无 token / 鉴权失败时，主按钮是「一键重开（带钥匙）」或等价，而不是只显示 Unauthorized 说明书。
  2. **粘贴路径可开**：打开项目面板可粘贴绝对路径 → 一点即走 open/唤起（成功则进已连接工作台）；失败给白话原因（如锁冲突）。
  3. **少催终端**：主路径文案不再把「去终端敲 `npx tsx bin/stagent.ts open …`」当唯一出路；终端命令可留在「高级/仍失败时」。
* **涉及核心文件（实施时以调查为准）**：`OpenProjectEntry`、无 AUTH/空态页、`daemon-api` 打开/最近项目接线、相关文案；测试：无 token 自救 UI、粘贴路径 open 冒烟（可用临时目录）、不打印 Token。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **无钥匙自救**：去掉 `#token=` 冷开后，可见一键重开/带钥匙入口；点后进入可聊会话（或明确正在唤起），不是永久锁死空输入框。
  2. **粘贴路径**：在「打开项目」粘贴合法绝对路径并确认，能复用/启动会话进入工作台（与 `stagent open` 同权结果）；无需先手拷 Token。
  3. **文案**：主路径不再把终端 `stagent open` 当唯一 CTA；终端说明可降级到高级区。
  4. **不抢 D.1e / 不回退安全**：无系统选夹冒充完成；无钥匙仍不能旁路 AUTH；日志无 Token 明文；Demo Origin 不回退。
  5. **门禁**：四件套全绿；至少 1 条打开/鉴权空态回归。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；D.1e 仍保持 DEFERRED 且本卡未伪称已交付系统选夹。
  - **FAIL**：无钥匙仍锁死无按钮；开新夹仍只催终端却标完成；夹带系统选择器却标本卡（应开 D.1e）；打印 Token 明文。

---

#### 【Task C.9a】首屏单一主路径（三态只留一个指挥信号）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.9a`
* **前置依赖**：`TASK-C.8a` (COMPLETED), `TASK-C.8b` (COMPLETED), `TASK-C.8c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `ef0e1a7`，分支 `feat/task-c9a-single-command-surface` 快进；合后四件套 **1231 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`resolveCommandSurface` 三态单一主 CTA；欢迎区/打开面板/顶栏徽标降级；涉及 `command-surface.ts` / `WorkspaceLayout` / `WelcomePane` / `AgentChatPane` / `OpenProjectEntry` 等。**不推翻**鉴权 / Demo Origin）
* **对照痛点（第二轮走查）**：冷开首屏同时出现——中栏欢迎教打开文件、右栏要你说话/配钥匙、顶栏 PROTECTED、左栏「打开项目」面板——4～5 个声音抢指挥，老板不知道先听谁。
* **v0.1 范围**：把工作台首屏收成**单一主路径**：按连接与会话态只保留一个主指挥信号——① **无钥匙**：只指挥「一键重开/配钥匙」；② **有钥匙空闲**：只指挥「右侧说需求」；③ **进行中**：只指挥当前对话/三步台/确认动作。其它面板与横幅降级为次要或默认收起，不得并排抢注意力。
* **明确不包含**：
  - 推翻 D.1 鉴权 / loopback / `#token=` / AUTH / Origin
  - 改变 Demo 独立 Origin（ADR-008）
  - 实现系统文件夹选择器或桌面壳（`TASK-D.1e`）
  - 重做助手模式互斥细则（归 `TASK-C.9b`）、打开面板生命周期细则（归 `TASK-C.9c`）、进行中中栏让路细则（归 `TASK-C.9d`）——本卡只定「同一时刻谁当指挥官」的呈现纪律
* **核心目标**：
  1. **三态互斥指挥**：无钥匙 / 有钥匙空闲 / 进行中，同一时刻主 CTA 与主说明只来自一个指挥源。
  2. **次要降噪**：打开项目面板、IDE 欢迎页、PROTECTED 工程师暗号、练习沙箱说明等不得与主 CTA 同级并排恐吓或抢焦点。
  3. **可走查**：给定三态脚本，10 秒内能指出「现在该点哪一个主按钮」，无需读多段互相打架的说明书。
* **涉及核心文件（实施时以调查为准）**：`WorkspaceLayout` / 首屏空态 / Header 横幅 / 右栏欢迎与向导入口 / 打开项目入口的默认可见性；测试以 UI 三态走查断言为主。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **无钥匙态**：主视线只有「一键重开/配钥匙」类单一指挥；中栏欢迎「打开文件」与「请说需求」不得同级并排争夺。
  2. **有钥匙空闲态**：主指挥是「右侧说需求」；打开项目面板默认不展开盖住左栏；恐吓级黄条不再与主 CTA 打架。
  3. **进行中态**：主指挥交给当前对话或三步台/确认；欢迎页/空页签堆叠不得继续当指挥官（细则落实可与 C.9d 联验）。
  4. **安全不回退**：不打印 Token/Key 明文；鉴权与 Demo Origin 回归仍绿。
  5. **门禁**：四件套全绿；至少 1 条「三态单一主 CTA」UI 回归。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；首屏指挥权清晰，不弱化鉴权。
  - **FAIL**：仍 4～5 个同级声音抢指挥却标完成；借本卡改鉴权或夹带 D.1e。

---

#### 【Task C.9b】助手模式互斥（练习 vs 真助手 vs 向导）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.9b`
* **前置依赖**：`TASK-C.9a` (COMPLETED), `TASK-C.8a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `c4818fa`，分支 `feat/task-c9b-assistant-mode-mutex` 快进；合后四件套 **1239 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`resolveAssistantMode` wizard/practice/real；向导发送禁用+去配置；练习横幅；中栏随模式；`src/lib/assistant-mode.ts` + `AgentChatPane` / `routes/index`；单元+UI 回归。**不推翻**鉴权 / 真实云调用门禁）
* **对照痛点（第二轮走查）**：一边提示「还差钥匙 / 练习沙箱」，一边发送键仍可点、中栏仍像在干活——信号互斥失败，老板以为系统在装忙或装坏。
* **v0.1 范围**：把右栏助手收成三态**互斥机**：① **练习沙箱**（明确不可当真干活）；② **真助手就绪**；③ **Key 向导**（未配钥匙）。发送键可用性、占位文案、中栏提示必须随模式切换，禁止「缺钥匙还能发消息假装干活」。
* **明确不包含**：
  - 放宽/绕过真实模型鉴权或把 API Key 写入可分享通道
  - 取消练习沙箱能力（可保留，但必须互斥且标明）
  - 重做首屏三态指挥纪律（归 C.9a）或设置深链回跳（归 C.9d，本卡只要求向导态有唯一「去配置」出口）
* **核心目标**：
  1. **三态互斥**：同一时刻只处于练习 / 真助手 / 向导之一；切换有可见反馈。
  2. **发送键随模式**：向导态与「不可当真」的练习态不得呈现「已在干活」的发送反馈；真助手就绪才是正常发送主路径。
  3. **中栏随模式**：模式切换时中栏提示与右栏一致（缺钥匙不装忙；练习不装生产）。
* **涉及核心文件（实施时以调查为准）**：`AgentChatPane` / `pick-chat-adapter` / Key 向导入口 / 发送按钮禁用逻辑；测试：三态互斥 UI + 发送键断言。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **互斥**：无法同时显示「请配钥匙」主向导与「真助手正在处理」级发送成功反馈。
  2. **向导态**：未配 Key 时发送键禁用或点击只导向配置，不得假装流式干活。
  3. **练习态**：若进入练习沙箱，文案明确「练习/不可当真」；切回真助手路径一键可达。
  4. **真助手态**：Key 就绪后主路径可发送；与 C.8a 向导闭环不回退。
  5. **门禁**：四件套全绿；至少 1 条模式互斥/发送键回归；不打印 Key 明文。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；三态信号一致。
  - **FAIL**：缺钥匙仍可装忙发送却标完成；练习与真助手文案并存无解释。

---

#### 【Task C.9c】打开项目面板生命周期（默认收 / 成功即关 / 已连接降级为切换）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.9c`
* **前置依赖**：`TASK-C.9a` (COMPLETED), `TASK-C.8c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `2f5d653`，分支 `feat/task-c9c-open-panel-lifecycle` 快进；合后四件套 **1246 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：默认收；成功即关；已连接「切换项目」；`src/lib/open-project-panel.ts` + `OpenProjectEntry`；单元+UI 回归。**不抢** D.1e；**不回退** C.8c）
* **对照痛点（第二轮走查）**：「打开项目」面板粘住不收，盖住左栏；选完/连上也不关；已连接时仍像冷开首屏再盖一层。
* **v0.1 范围**：规范打开项目面板生命周期——① 默认收起；② 打开或切换成功后自动关闭；③ 已连接会话中入口文案/行为降级为「切换项目」，不再以冷开全屏指挥官姿态盖住主路径。**不抢** `TASK-D.1e`（不做系统选夹）。
* **明确不包含**：
  - 系统级文件夹选择器 / Electron / Tauri（`TASK-D.1e`）
  - 取消 C.8c 的无钥匙一键重开与粘贴路径能力
  - 推翻 D.1/D.1b 鉴权与 `#token=`
* **核心目标**：
  1. **默认收**：有钥匙空闲/进行中冷开后，打开项目面板不默认展开挡左栏。
  2. **成功即关**：最近项目一点重开、粘贴路径打开、一键重开成功后，面板关闭并回到主路径。
  3. **已连接降级**：已鉴权连接下，入口是「切换项目」次要动作，不是再盖一层首屏指挥官。
* **涉及核心文件（实施时以调查为准）**：`OpenProjectEntry` / 左栏打开按钮状态 / 成功回调关面板；测试：默认收、成功关、已连接文案降级。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **默认收**：有钥匙空闲首屏，打开项目面板不默认展开盖住左栏主树。
  2. **成功即关**：完成一次打开/切换/重开成功后，面板关闭，主指挥回到 C.9a 对应态。
  3. **已连接降级**：已连接时入口不再以「你还没打开项目」级首屏指挥官姿态出现。
  4. **不抢 D.1e / 不回退 C.8c**：无系统选夹冒充；粘贴路径与一键重开仍可用；无 Token 明文。
  5. **门禁**：四件套全绿；至少 1 条面板生命周期 UI 回归。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立。
  - **FAIL**：面板仍粘住不关却标完成；夹带系统选夹冒充本卡。

---

#### 【Task C.9d】进行中中栏让路（收欢迎页 / 设置深链回跳）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.9d`
* **前置依赖**：`TASK-C.9a` (COMPLETED), `TASK-C.9b` (COMPLETED), `TASK-C.8b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `edc28ce`，分支 `feat/task-c9d-middle-yield-settings-return` 快进；合后四件套 **1254 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`middle-yield` 收欢迎页；三步台/保护确认自动开 Studio；设置深链模型钥匙 + 返回对话；PROTECTED 聊≠改白话；`src/lib/middle-yield.ts` + `WorkspaceLayout` / `SettingsTab` / `routes/index`；单元+UI 回归。**不含**重做 Studio 四视口路由）
* **对照痛点（第二轮走查）**：右侧已开聊或小事已走 Fast Path，中栏仍停在 IDE 欢迎页/空页签堆叠，C.8b 三步台接不上主视线；进设置配钥匙时其它面板叠罗汉，配完不知道回哪。另：锁着（PROTECTED）仍可聊时，须白话说清「先聊方案，动文件才要你点头」——与中栏让路同一「进行中指挥」闭环。
* **v0.1 范围**：① 对话进行中或小事三步台出现时，中栏收起 IDE 欢迎页与无意义空页签堆叠，让路给对话上下文或 `BossFastPathDesk`；② 从 Key 向导进入设置须深链到模型钥匙区，配完提供一键回跳右栏/主路径，避免设置叠罗汉；③ 进行中若仍可聊，一句白话说明「聊不等于改文件」。
* **明确不包含**：
  - 重做 Studio 四视口路由算法本体（C.2）或改 Fast Path 准入/状态机边（C.8b 已定呈现）
  - 取消 PROTECTED / 保护清单
  - 系统选夹（D.1e）
* **核心目标**：
  1. **让路**：进行中中栏主视线是对话结果或三步台，不是欢迎页。
  2. **深链回跳**：向导 → 设置（钥匙区）→ 配完回跳，不丢上下文、不叠多层面板。
  3. **聊改分离白话**：可聊但未批准改文件时，一句说清，不靠 PROTECTED 暗号。
* **涉及核心文件（实施时以调查为准）**：中栏 Tab/欢迎空态、`BossFastPathDesk` 挂载条件、Settings 深链与返回栈、Header/右栏进行中提示；测试：进行中让路、设置回跳、白话提示。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **让路**：发送一条小事进入 Fast Path 后，中栏默认可见三步台（或明确进行中主视图），IDE 欢迎页不再占主视线。
  2. **深链**：从 Key 向导一键进设置后落在模型钥匙相关区，而非无关总览叠罗汉。
  3. **回跳**：配钥匙流程结束后，一键回到右栏主路径（或等价），无需手动关多层面板。
  4. **聊改分离**：进行中可聊未批准改文件时，可见一句白话说明（不依赖工程师 PROTECTED 暗号）。
  5. **门禁**：四件套全绿；至少 1 条让路/回跳 UI 回归；不打印 Token/Key。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；C.8b 三步台真正接到主路径。
  - **FAIL**：聊起来中栏仍欢迎页却标完成；设置叠罗汉无回跳；借本卡改状态机不另立卡。

---

#### 【Task C.10a】进行中生命周期收口（退出 in_progress / 无空让路壳）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.10a`
* **前置依赖**：`TASK-C.9a` (COMPLETED), `TASK-C.9d` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `5207df2`，分支 `feat/task-c10a-in-progress-lifecycle` 快进；合后四件套 **1261 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`src/lib/in-progress-lifecycle.ts`（`resolveActiveInProgress` / `resolveInProgressCta` / `shouldRenderMiddleYieldShell`）；`routes/index` 不再用 `journeyCards.length` 粘住进行中；`WorkspaceLayout` 无空让路壳 + 三步台保持 Studio；单元+UI 回归。**不含**重做 Studio 四视口；改鉴权）
* **对照痛点（第三轮走查）**：说过一件事后「进行中」容易一直挂着；关掉中间台后中栏只剩「中栏已让路」空壳，不知道还要干什么。根因倾向：`journeyCards` 只增不减 → `inProgress` 粘住；C.9d 做了让路，没收进行中退出与空态。
* **v0.1 范围**：① 旅程卡 / 保护确认 / Fast Path 三步台结束后，退出 `in_progress`，主指挥回到 C.9a 的 idle（或 no_key）；② 中栏在无确认卡、无三步台、无其它进行中主视图时，**不要**渲染空的 `middle-yield` 让路壳；③ 与 C.9a 单一指挥信号、C.9d 让路纪律一致——有东西才让路，没事回到空闲主路径。
* **明确不包含**：
  - 重做 Studio 四视口路由本体（C.2）
  - 改鉴权 / Demo Origin / 状态机边 / Fast Path 准入规则
  - 系统选夹（D.1e）；界面暗号清扫（归 C.10c / 统一抛光）
* **核心目标**：
  1. **可退出**：进行中可结束；结束后不再假「进行中」。
  2. **无空壳**：让路只在有确认/三步台/进行中主视图时发生；关掉后不剩空 middle-yield。
  3. **指挥一致**：结束后主 CTA 回到 C.9a idle/no_key，不与设置/打开面板抢戏。
* **涉及核心文件（实施时以调查为准）**：`resolveCommandSurface` / `inProgress` 判定、`journeyCards` 生命周期、`middle-yield` / `WorkspaceLayout`、旅程/确认/BossFastPathDesk 结束钩子；测试：进行中退出、空让路壳不渲染、至少 1 条 UI 回归。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **退出**：旅程或 Fast Path/确认流程结束后，指挥面不再停留在 `in_progress`（回到 idle 或 no_key）。
  2. **无空壳**：中栏无确认卡且无三步台时，不出现仅含「中栏已让路」类空壳主视图。
  3. **有料才让路**：进行中且有三步台/确认时，仍遵守 C.9d 让路（欢迎页不抢主视线）。
  4. **不回退 C.9a**：结束后单一主 CTA 纪律仍成立（不突然恢复多指挥官堆叠）。
  5. **门禁**：四件套全绿；至少 1 条进行中退出 / 空壳 UI 回归；不打印 Token/Key。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立。
  - **FAIL**：结束后仍永久「进行中」却标完成；关台后空让路壳仍占中栏；借本卡改鉴权/Studio 路由不另立卡。

---

#### 【Task C.10b】设置页老板主路径（钥匙主视线 / 工程师项进高级）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.10b`
* **前置依赖**：`TASK-C.9d` (COMPLETED), `TASK-C.8a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `be33a26`，分支 `feat/task-c10b-settings-boss-path` 快进；合后四件套 **1265 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`SettingsTab` 模型钥匙置顶；`settings-advanced` 默认折叠收纳后台连接/诊断/工作区；C.9d 深链与返回对话保留；UI 回归 4 条。**不含**改鉴权语义；取消 token 能力）
* **对照痛点（第三轮走查）**：去配钥匙时，设置最上仍是 Daemon / Session Token / GATEWAY_ENFORCED 等后台词；虽能滚到钥匙区并回跳，仍像误入机房。C.9d 深链+回跳已有，未做老板可读化。
* **v0.1 范围**：① 设置页主视线是**模型钥匙**（老板能看懂的配钥匙主路径）；② Daemon / Session Token / GATEWAY 等工程师项收进可折叠「高级」；③ **保留** C.9d：从向导深链到钥匙区 +「配完了，返回对话」；④ 不改鉴权语义、不取消 token 能力——只调整文案与信息层级。
* **明确不包含**：
  - 改鉴权语义（loopback / `#token=` / AUTH）或取消 Session Token 能力
  - 重做整个设置信息架构以外的 Studio / 打开项目
  - 界面暗号清扫全集（归 C.10c）；系统选夹（D.1e）
* **核心目标**：
  1. **钥匙优先**：打开设置（含深链）第一眼是配模型钥匙，不是机房仪表盘。
  2. **高级折叠**：Daemon/Token/网关等默认不抢主视线，需要时再展开。
  3. **回跳仍在**：C.9d 深链与「配完了，返回对话」行为不回退。
* **涉及核心文件（实施时以调查为准）**：`SettingsTab` 区块顺序与折叠、深链滚动锚点、返回对话 CTA；测试：主视线钥匙、高级折叠、深链/回跳回归。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **主视线**：设置默认可见区以模型钥匙/老板配钥匙路径为主，不先堆 Daemon/Token 标题。
  2. **高级**：Daemon / Session Token / GATEWAY 类项在「高级」（或等价折叠）内，默认不抢首屏。
  3. **深链保留**：从 Key 向导进设置仍落到钥匙相关区（C.9d 不回退）。
  4. **回跳保留**：「配完了，返回对话」（或等价）仍可用。
  5. **门禁**：四件套全绿；至少 1 条设置主路径 UI 回归；不打印 Token/Key；鉴权行为不变。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立。
  - **FAIL**：首屏仍是机房词却标完成；借本卡取消 token/改 AUTH；深链或回跳回退。

---

#### 【Task C.10c】界面暗号/命名清扫（白话标签 + 图谱单入口）`[NEW_TASK · 2026-10-24]`
* **任务编号**：`TASK-C.10c`
* **前置依赖**：`TASK-C.10a` (COMPLETED), `TASK-C.10b` (COMPLETED)
* **任务状态**：**[NEW_TASK]**（2026-10-24 由 DEFERRED 升格正式立卡；Tina 对齐范围；对照走查报告 §6 别扭#4–7 + 页面分层说明）
* **对照痛点**：中栏「Supervisor / Supervisor Studio / 任务图谱」像三套产品；Studio Tab 与 ActivityBar / 底栏仍甩英文暗号；任务图谱左栏独立 Tab 与合同操作台内视口**双入口**；空闲「说需求 / 新建需求」像两条路；页脚 Daemon / Evidence-gated。
* **v0.1 范围（施工合同）**：
  1. **单壳多标签**：不拆多路由；不把打开项目升成独立欢迎站；不做「简洁 IDE」新产品模式。
  2. **白话改名**（与既有 C.8b「合同操作台」一致，不另造「干活台」）：
     - Supervisor → **项目审阅**
     - Supervisor Studio → **合同操作台**
     - SmartTerminal / 底栏工程师词 → **验证输出**
     - ActivityBar `title`/`aria-label` 去掉英文暗号（保留图标 + 白话）
  3. **任务图谱双入口收口**：日常只留合同操作台内「任务图谱」视口一扇门；左栏图谱入口改为打开/聚焦合同操作台并切到图谱视口（或等价弱化），不再新建独立中栏「任务图谱」系统 Tab 作为主路径。
  4. **可选轻量**：空闲「说需求 / 新建需求」文案弱化合并（次要入口措辞降噪，不改 C.9a 单一指挥纪律）。
* **明确不包含**：不重做 C.9 / C.10a / C.10b 指挥纪律与生命周期；不改鉴权 / Demo Origin；不抢 D.1e；不打印 token；不重做 Studio 四视口路由本体（只改命名与入口）。
* **涉及核心文件（预期）**：
  - `src/components/WorkspaceLayout.tsx`、`layout/ActivityBar.tsx`、`SupervisorStudioPane.tsx`、`layout/WelcomePane.tsx`
  - `src/routes/index.tsx`（页脚 / 可选双 CTA / 图谱→Studio 视口信号）
  - 相关 UI 回归：`tests/ui/ide-shell.test.tsx` 等
* **Pass/Fail 验收判定**（≤5）：
  1. **命名**：中栏系统 Tab / ActivityBar / 底栏抽屉对用户可见文案不再出现 `Supervisor Studio`、`SmartTerminal` 作主标签（测试用 `getByRole`/`aria-label` 可断言新白话名）。
  2. **项目审阅**：原 Supervisor 入口对用户显示为「项目审阅」（或等价白话），功能仍为审阅/确认，不改合同准入。
  3. **图谱单入口**：点击左栏图谱入口后，打开的是合同操作台内图谱视口（或等价单门），**不再**以独立「任务图谱」系统 Tab 作为日常主路径双开。
  4. **不回退指挥纪律**：C.9a 单一主 CTA、C.10a 进行中收口、C.10b 设置钥匙主路径行为不回退（抽测既有回归仍绿）。
  5. **四件套**：`npm test` / `typecheck` / `lint`（0 errors）/ `build` 全绿；至少 1 条命名/入口 UI 回归；不打印 token。
* **FAIL**：仍双开图谱 Tab+视口当日常主路径；Tab 名与 C.8b「合同操作台」打架；回退鉴权或指挥纪律。

---

#### 【Task C.3】Monaco 核心编辑器集成与受控 Worktree 读写
* **任务编号**：`TASK-C.3`
* **前置依赖**：`TASK-C.1`, `TASK-A.2` (COMPLETED)（v1.3.3：移除已删除的 `C.2→C.3` 串行边）
* **任务状态**：**[COMPLETED]**（分支 `feat/c3-monaco-editor` 提交 `88aec68`，**2026-10-21 核验：已合入 main**。Monaco（`@monaco-editor/react`，编辑器本体默认从 jsDelivr CDN 加载，离线不可用）可写/只读区分；保存只走 `POST /api/worktree/files`，越权 403 + `.stagent/audit/gateway-violations.jsonl` + `GATEWAY_VIOLATION` 帧，文件无改动；`EVIDENCE_STATUS_CHANGED=STALE` 时中栏顶部横幅；Agent 的 Edit/Write 完成后中栏自动打开并刷新该文件。无合同（Vibe）时根为主工作树，仅禁写 .git/.stagent（保护清单待 P.1）。）
* **核心目标**：
  1. Monaco Editor 嵌入，可写/只读视觉区分。
  2. **编辑器内 Evidence STALE 提示 (G-18)**：当关联合同 Evidence 变为 STALE 时，在中栏顶部弹出警告横幅，提示代码已被外部修改需重新验证。
  3. 服务端强制保存校验：保存必须调用 `POST /api/worktree/files`，越权保存由 Daemon 403 拒绝，记录 `GATEWAY_VIOLATION`，文件物理无改动。
* **涉及核心文件**：
  - 新增：`src/components/MonacoEditorPane.tsx`
  - 新增：`src/hooks/useWorktreeFile.ts`
  - 修改：`daemon/server.ts`
  - 测试：`tests/ui/monaco-editor-pane.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：越权写入请求返回 403 并在服务端留下违规记录；Evidence 失效时编辑器横幅即时展现。
  - **FAIL**：前端允许写入未授权路径；缺少 STALE 视觉指示。

---


---

### 3.5 架构感知、监听与差异审阅（C.5 落 Sprint 2；B.1/B.2/C.4 推迟至 v0.2+）

#### 【Task B.1】本地 AST 增量依赖图分析引擎
* **任务编号**：`TASK-B.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[DEFERRED → v0.2+]** `[用户已确认 D4 · 2026-10-20]`（2026-10-21 状态校正：与 §1.1 总表对齐，本卡不作 v0.1 验收项）
* **核心目标**：
  1. **统一路径前缀 (G-16)**：解析 `src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`，构建文件级依赖拓扑。
  2. 达成性能门槛：1000 节点冷启动 ≤ 1.5s，单文件增量修补 ≤ 20ms。
* **涉及核心文件**：
  - 新增：`daemon/arch/ast-parser.ts`
  - 新增：`daemon/arch/dependency-graph.ts`
  - 测试：`tests/unit/ast-dependency-graph.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：冷启动 ≤1500ms，增量 ≤20ms，支持 JSON/MJS/CJS。
  - **FAIL**：解析内存泄漏或循环依赖死锁。

---


---

#### 【Task B.2】多活跃 Worktree 监听与 Evidence 状态联动
* **任务编号**：`TASK-B.2`
* **前置依赖**：`TASK-B.1`, `TASK-A.1` (COMPLETED), `TASK-A.6` (COMPLETED)
* **任务状态**：**[DEFERRED → v0.2+]** `[用户已确认 D4 · 2026-10-20]`（2026-10-21 状态校正：原标 `[INCREMENTAL_UPGRADE]` 与总表 DEFERRED 冲突，按 D4 决议统一为推迟；本卡不作 v0.1 验收项）
* **核心目标**：
  1. 监听多个活跃 Worktree，排除 `.git/`, `.stagent/`, `node_modules/`, `dist/`, `build/`, `coverage/`。
  2. **工作树外部变更检测与失效联动**：外部文件修改后，在配置的 watcher debounce 窗口内（性能目标 ≤50ms）触发 Evidence `STALE`（携带错误码 `E_EVIDENCE_STALE`），置 `can_merge = false`，广播 `EVIDENCE_STATUS_CHANGED`；即使监听事件因系统负载丢包，合并前指纹复核兜底机制亦强制撤销 `can_merge`。
* **涉及核心文件**：
  - 修改：`daemon/watcher/fs-watcher.ts`
  - 修改：`daemon/watcher/invalidation-engine.ts`
  - 测试：`tests/unit/multi-worktree-watcher-stale.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：外部改动在 watcher debounce 窗口内（性能目标 ≤50ms）将 Evidence 标为 STALE（携带 `E_EVIDENCE_STALE`）且 `can_merge` 为 false，广播 `EVIDENCE_STATUS_CHANGED`；合并前指纹复核兜底有效；忽略目录写入不误报。
  - **FAIL**：外部改动后 Evidence 仍为 PASSED，或合并前绕过快照复核。

---


---

#### 【Task C.4】架构雷达视图与 Scope 圈选抽屉
* **任务编号**：`TASK-C.4`
* **前置依赖**：`TASK-C.3`, `TASK-B.1`
* **任务状态**：**[DEFERRED → v0.2+]** `[用户已确认 D4 · 2026-10-20]`（2026-10-21 状态校正：与 §1.1 总表对齐，本卡不作 v0.1 验收项）
* **核心目标**：
  1. Cytoscape 渲染架构雷达，1000 节点局部 patch ≤ 16ms (60 FPS)，内存 ≤ 30MB。
  2. 交互圈选 Scope；已批准合同圈选强制派生新版本并重新审批，禁止原地扩权。
* **涉及核心文件**：
  - 新增：`src/components/ArchitectureRadar.tsx`
  - 新增：`src/components/ScopeSelectorDrawer.tsx`
  - 测试：`tests/ui/architecture-radar.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：大图流畅；已批准合同修改 Scope 强制触发 Revision 递增与重新审批。
  - **FAIL**：允许在原合同上原地修改 Scope。

---


---

#### 【Task C.5】双栏 Diff 审阅器与结构化终端日志回放
* **任务编号**：`TASK-C.5`
* **前置依赖**：`TASK-C.1`, `TASK-A.4` (COMPLETED)（v1.3.3：移除已推迟的 `TASK-C.4`）
* **任务状态**：**[COMPLETED]**（2026-10-21 只读核验，状态校正：`src/components/diff/*` 双栏/内联 Diff + `src/components/StructuredTerminal.tsx` 结构化终端；服务端 `GET /api/contracts/:id/diff-files` 返回逐文件真实基线/当前内容（`daemon/server.ts:1347`）；超长输出经 `redactSecrets` 先脱敏、后头尾双窗口截断；`tests/ui/diff-terminal-viewer.test.tsx` 5 个用例全绿）
* **核心目标**：
  1. 双栏/内联展示真实 Git Diff。
  2. 结构化终端流式回放日志，ANSI 彩色，超长日志先脱敏后头尾截断 (保留各 200 行)。
* **涉及核心文件**：
  - 新增：`src/components/DiffViewer.tsx`
  - 新增：`src/components/StructuredTerminal.tsx`
  - 测试：`tests/ui/diff-terminal-viewer.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：Diff 准确匹配 git；敏感信息在截断前已被遮蔽；超大输出前端不崩溃。
  - **FAIL**：未脱敏即截断。

---


---

#### 【Task C.6】右栏 Agent 流式会话与打断续接 (v1.3.3 新增)
* **任务编号**：`TASK-C.6`
* **前置依赖**：`TASK-C.1`, `TASK-D.1`
* **任务状态**：**[COMPLETED]**（已合并主线 `43496c0`。已用假适配器 + 演示 Agent 测过：流式、工具卡片、排队、打断（门闩立即生效、适配器 <2s 停止）、`.stagent/sessions/` 持久化与重启续接；真实 Claude Code 的流式/打断/续接见 W.5a。Adapter：自研保底（OpenAI 兼容，只聊天）/ 演示 Agent（不调用模型）。打断会清空排队消息。）
* **核心目标**：
  1. 右栏会话流式渲染（逐 Token）、工具调用卡片、改动预览；
  2. Stop/打断：用户随时中断，Agent 进程 2s 内停止输出；排队追加消息；
  3. Adapter 切换（自研保底 Worker / Claude Code / 其他已验证 Adapter）；
  4. 会话列表与 resume：映射各 CLI 的原生会话 ID，持久化于 `.stagent/sessions/`；关闭浏览器与重启 Daemon 后可续接同一会话并保留上下文；
  5. 消费 `CHAT_EVENT` 子类型帧（`delta`/`tool_call`/`tool_result`/`turn_end`/`interrupted`/`error`，架构规范 §6.1）。
* **涉及核心文件**：
  - 新增：`src/components/AgentChatPane.tsx`
  - 新增：`src/hooks/use-agent-session.ts`
  - 测试：`tests/ui/agent-chat-pane.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：首 token 可见延迟 ≤1s（本地测量）；打断后 2s 内 Agent 进程停止输出；Daemon/UI 重启后会话可续接且上下文完整。
  - **FAIL**：打断后仍有输出；重启丢会话。

---


---

#### 【Task C.7】业务功能树与 Task Graph 渐进点亮视口 `[v1.6.1 升级]`
* **任务编号**：`TASK-C.7`
* **前置依赖**：`TASK-D.1`, `TASK-S.2`, `TASK-C.1`, `TASK-D.3`
* **任务状态**：**[COMPLETED]**（2026-10-23 合入 main，merge `5117b27`；原交付于 `feat/task-c7-graph-engine`，基线 `main@05f090f`。门禁：干净环境四件套全绿（1032 passed / 6 skipped）；`tests/unit/graph-engine-invariants.test.ts` 24 通过；`tests/ui/task-graph-illumination.test.tsx` 7 通过；`tests/ui/ide-shell.test.tsx` 12 通过（新增 Activity Bar 图谱入口后同步顺序断言）。落地清单：`daemon/graph/graph-engine.ts`（Daemon 独占内存权威 + 原子落盘 `.stagent/specs/task_graph.json`，`revision` 单调递增、对外只给快照）、`daemon/graph/illumination-verifier.ts`（三证充要条件 + C-04 空集拦截）、`daemon/graph/evidence-collector.ts`（目标文件 SHA-256 / 合同 Scope / `git rev-parse HEAD` 全部由 Daemon 现算）、`src/lib/graph/task-graph.ts`（七态、提案类型与 `TASK_GRAPH_UPDATED` 载荷）、`daemon/server.ts` 5 个 `/api/graph*` 端点与全量快照广播、`src/components/graph/{TaskGraphPanel,FunctionalTree,ExecutionDag}.tsx` + `graph-view-model.ts`、`src/components/FileTreeSpecsSection.tsx`、`src/routes/index.tsx` 接线。**口径说明**：① 视图文件名按实际实现落为 `TaskGraphPanel` / `FunctionalTree` / `ExecutionDag`（本卡设计期的 `TaskGraphViewer` / `FunctionalMindmap` / `GraphNodeCard` 命名未沿用）；② 空验证集按架构 §3.2.2 置 `FAILED` + `E_EMPTY_VERIFICATION_BLOCKED`，UI 以「警告灰」（`data-tone="warning"`）呈现，不新增第八个节点状态；③ 点亮同时绑定 Worktree HEAD 的 Commit SHA 与目标文件 SHA-256 指纹，兼容 ADR-009 的 `node_patch_fingerprint` 口径；④ 需求条目以合同 `intent` 呈现（仓库暂无 `.stagent/specs/requirements.md` 实体），Demo 仅在真实文件存在时标「就绪」，进度由 `TASK_GRAPH_UPDATED` 驱动（源头为真实写入与验证，不由模型自报）。**残余口径差（不阻塞验收，需登记）**：① 节点详情暂只展示目标文件/验证命令/Commit SHA/问题码，卡片要求的 Git Diff 摘要与测试报告抽屉未接入；② `POST /api/graph/verify` 的验证命令结果仍由执行器提交（文件写入、Scope、SHA 已不可自报）；③ 建图入口仅控制面 API，不提供「从合同自动拆节点」的伪造拓扑）
* **v0.1 范围**：在中栏呈现业务思维导图与任务执行 DAG 流程图；实现由灰变绿的渐进点亮动效与持久化状态渲染；Daemon 独占权威状态；提案类型剥离运行态；空验证集强拦截。
* **核心目标**：
  1. **Daemon 独占权威状态与提案类型安全 (`daemon/graph/graph-engine.ts`)**：
     - Task Graph 权威状态由 Daemon 单独维护并持久化于 `.stagent/specs/task_graph.json`，严禁前端或 Supervisor 自行篡改；
     - Supervisor 提交的 Graph 提案结构 `SupervisorProposalV1` 在类型层使用 `Omit<TaskNode, "state" | "executed_at" | "commit_sha">` 严格剥离所有运行态字段；
     - 节点七态维护（严格对齐架构 §3.2.1）：`PENDING`（未开始）、`RUNNING`（执行中）、`REPAIRING`（定向返工中）、`ILLUMINATED`（已点亮绿灯）、`FAILED`（失败红灯）、`BLOCKED`（上游失败级联阻断）、`STALE_REVERIFY`（失效待验灰灯）。
  2. **物理证据点亮与空验证集拦截 (`daemon/graph/illumination-verifier.ts`)**：
     - **物理点亮充要条件**：节点由灰变绿点亮，必须同时满足：① 对应受控 Worktree 产生了物理文件写入；② 关联的 `EvidenceBundle` 包含退出码为 0 的验证结果；③ 成功派生 Git Commit SHA 指纹；
     - **空验证集强拦截 (C-04)**：COMMAND 类型的节点若 `verification_commands` 为空或验证结果集为空，**坚决严禁全绿点亮**，状态保持为警告灰；
     - **外部改码级联失效**：当检测到外部文件修改使 Evidence 变为 `STALE` 时，相关任务节点由绿变灰并标记为 `STALE`，提示用户重新执行验证。
  3. **双重视图渲染与点亮动效 (`src/components/graph/TaskGraphViewer.tsx`)**：
     - **业务功能导图 (Functional Tree)**：树状/脑图展开展示一级模块与二级功能点；
     - **任务执行 DAG (Execution DAG)**：直观展示任务节点与依赖连线；
     - 监听 WebSocket 的 `TASK_GRAPH_UPDATED` 帧，当后台验证通过事件到达时，触发平滑翠绿过渡点亮动效（延迟 ≤ 100ms）；
     - 点击任何已点亮节点，可在抽屉中展开查看关联的 Git Diff 摘要与测试报告。
* **文件树规范资产专区**：左侧固定展示 `.stagent/specs/requirements.md`、`contract.json` 与 `.stagent/demo/` 原型入口；文件生成动效必须由真实文件系统变更事件驱动，不得由模型自报进度触发。
* **涉及核心文件（以实际落地为准）**：
  - 新增：`daemon/graph/graph-engine.ts`
  - 新增：`daemon/graph/illumination-verifier.ts`
  - 新增：`daemon/graph/evidence-collector.ts`（文件 / Scope / HEAD 现算，不接受调用方自报）
  - 新增：`src/lib/graph/task-graph.ts`（七态、提案类型、帧载荷与持久化守卫）
  - 新增：`src/components/graph/TaskGraphPanel.tsx`（双视图容器与 100ms 点亮动效）
  - 新增：`src/components/graph/FunctionalTree.tsx`
  - 新增：`src/components/graph/ExecutionDag.tsx`
  - 新增：`src/components/graph/graph-view-model.ts`
  - 新增：`src/components/FileTreeSpecsSection.tsx`（按 §5 路径映射约定落在 `src/components/`）
  - 修改：`daemon/server.ts`（`/api/graph*` 与 `TASK_GRAPH_UPDATED`）、`src/lib/ipc/frames.ts`、`src/lib/daemon-api.ts`、`src/hooks/use-daemon-stream.ts`、`src/routes/index.tsx`、`src/components/WorkspaceLayout.tsx`、`src/components/layout/ActivityBar.tsx`
  - 测试：`tests/unit/graph-engine-invariants.test.ts`（24 用例）
  - 测试：`tests/ui/task-graph-illumination.test.tsx`（7 用例）
* **Pass/Fail 验收判定**：
  - **PASS**：Supervisor 提案在 Schema 校验层成功剥离运行态；节点点亮严格绑定物理退出码 0 与 Commit SHA；空验证集的 COMMAND 节点无法被点亮；外部改码能触发节点变灰 STALE；页面刷新无损恢复点亮状态。
  - **FAIL**：前端通过 Mock 数据自行点亮节点；空验证集节点被显示为绿色已完成。

---
### 3.5b 全局保护清单与 Vibe 安全网 (Sprint 2)

#### 【Task P.1】全局保护清单与 Vibe 模式安全网 (v1.3.3 新增) `[用户已确认 D1 / D2 · 2026-10-20]`
* **任务编号**：`TASK-P.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（2026-10-21 只读核验，状态校正：提交 `08e95da`「feat(p1): 全局保护清单、Vibe 安全网与门卫拦截」已合入 main 且为 HEAD 祖先。落地清单：`daemon/protection/protection-list.ts`（清单读写/自锁/模式判定/匹配/授权卡/待审批持久化/推荐/失败关闭/Prompt 注入/hook 请求队列）、`daemon/protection/auto-checkpoint.ts`（快照与整轮撤销）、`src/components/ProtectionCard.tsx`（推荐卡 + 同意卡）、`daemon/server.ts` 9 个 `/api/protection*` 端点、`daemon/mcp/gateway.ts:815` 强制门卫、`daemon/chat/session-manager.ts:226` Prompt 注入、`src/lib/perf-guards.ts:75` 自适应轮询。用例：`protection-silent-contract` 13 + `protection-endpoint` 1 + `gateway-protection` 3 全绿。**残余口径差（不阻塞验收，需登记）**：①「静默合同」当前为 `.stagent/silent-contracts.jsonl` 备案形态，非 `SoftwareContract` 正式落盘——与《P1 白话设计稿》第 5 条一致，但与架构 §0.6.3「后台自动静默生成合同与快照」字面表述存在口径差；②【撤销本轮改动】按 checkpoint 存在与否条件渲染，设计稿写「顶栏常驻」；③ 保护命中后自动进入完整合同 + Evidence 链未实现，合同仍由 UI 手动创建）
* **核心目标**：
  1. `.stagent/protection.json` 全局保护清单（路径 glob + 白话名称），UI 一键加锁/解锁；
  2. 首导入推荐：Supervisor 以规则扫描识别核心模块，弹出白话推荐卡片（"为您推荐锁定【登录】与【支付】模块，一键保护"）；
  3. **Prompt 前置注入**：组装 Worker Prompt 时直接注入已锁定保护清单，引导 AI 主动规避；
  4. **静默合同（Silent Contract）**：Worker 改动未触碰保护清单时，Daemon 后台静默生成合同与快照，前端不弹窗；触碰保护清单时抛出极简白话是/否卡片；
  5. **Vibe 安全网**：Agent 执行改动前 Daemon 自动生成轻量 Git 快照（Auto-Checkpoint）；UI 顶层常驻白话按钮【撤销本轮改动】；
  6. **User-First Discard Rule**：合并冲突永远以用户主分支版本为准，丢弃 Worktree 冲突改动并提示 AI 重新修改；不向用户展示 Git 冲突界面。
  7. **命中行为（任何模式，见架构 §0.6.5）** `[用户已确认 · 2026-10-20]`：先拦后写；多路径合并为一张卡并列出文件清单；同意仅覆盖本轮清单内文件，超出清单才弹补充卡（超出清单时弹出的补充卡属于同一次是/否授权的**补充授权**，计入"≤2"规则内，不另算一次交互）；不同意则拒写并让 AI 换方案；待审批状态跨断线/重启持久化、永不自动放行；验证全绿后一键合并、无二次确认。总交互 ≤ 2。
  8. **保护清单自锁**：`.stagent/protection.json` 本身恒受保护，仅可经 UI 开关修改；快照失败则本轮不开工。
  9. **撤销范围（v0.1 定稿）**：v0.1 撤销 = 回滚整轮快照：本轮开始后这些文件的所有改动（**包括用户本轮的手动修改**）一并撤回；撤销确认文案必须白话写明这一点。细粒度撤销（只撤 Agent 改动、保留手改）推迟至后续版本。
  10. **范围外说明**：锁定 AI 配置文件（`.claude/`、`.mcp.json`、`.cursor/`）不属于本卡验收项，若要纳入须另行更新任务卡与路径规则。
  11. **网关级只读绝对防御 (v1.4.0 新增)**：全局保护清单中声明的敏感核心文件为底层 Scoped Gateway 的不可覆盖只读层；即使用户在对话中输入授权，系统依然阻断对绝对禁区的破坏性操作。
* **涉及核心文件**：
  - 新增：`daemon/protection/protection-list.ts`
  - 新增：`daemon/protection/auto-checkpoint.ts`
  - 新增：`src/components/ProtectionCard.tsx`
  - 测试：`tests/unit/protection-silent-contract.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：保护路径在 VIBE 与 PROTECTED 下写入均被规则拦截（零模型调用）；无保护清单全程零弹窗；撤销按钮一键恢复现场；冲突时主分支版本永远胜出；触保护区任务交互 ≤ 2（一张清单卡 + 一键合并），同轮清单内不重复弹窗；待审批断线/重启后不自动放行；门卫出错/超时按拒绝处理，且原生工具、Shell、改名/删除、符号链接四类绕过负例均失败关闭。
  - **FAIL**：保护路径被静默写入；出现 Git 冲突解决界面；弹窗超过一个是/否问题；同轮清单内文件重复弹窗；待审批被自动放行；合并出现二次确认。

---


---

### 3.6 控制面 API 补齐、快照持久化与合并核销（Sprint 3；前置 C.5/P.1/W.4 于 Sprint 2 完成）

#### 【Task D.2】控制面 API 补齐、合并门禁（一键合并）与 Git Trailer 审计
* **任务编号**：`TASK-D.2`
* **前置依赖**：`TASK-D.1`, `TASK-W.4`, `TASK-C.5`, `TASK-P.1`（v1.3.3：移除已推迟的 `TASK-B.2`）
* **任务状态**：**[COMPLETED]**（2026-10-21 步骤 D 收口。**已落地**——控制面 `approve` / `execute` / `run-worker` / `merge` / `resume` / `abort` / `diff-files` / `evidence` 端点（`daemon/server.ts` 中对应控制面路由处理器（以 handler 名称为锚点，行号易漂移））；`squashMerge` 门禁链 Gate 0~4（AUDITED、Evidence 快照存在且同合同、STALE 阻断、Worktree 指纹复核 `assertEvidenceIntegrity`、主树 clean、重复合并防御）；4 条标准 Git Trailer（`daemon/pipeline/merger.ts` 中 Trailer 构造常量/函数）；User-First Discard 冲突仲裁（`daemon/pipeline/merger.ts` 中 User-First Discard 处理器（以函数名为锚点），含 `nothingToMerge` 兜底）；前端一键合并无二次确认（`index.tsx:1014`）。**核心目标 1（原缺口 G-1）已闭环**（`9691b23`，合并 `742d27d`）：`daemon/protection/protection-list.ts` 新增 `intersectWithProtection()`（见证路径 `witnessPath()` + glob 双向覆盖判定 + 清单解析异常一律返回 `hit:true` 的失败关闭）；`daemon/pipeline/orchestrator.ts` 新增 `admit()`，产出 `AUTO_APPROVED` / `AUTO_APPROVAL_FAILED` / `NEEDS_APPROVAL` / `SKIPPED` 四态，无交集或本轮全部同意且无拒绝时自动 `approve()`（`approved_by: "stagent-auto"`）并写 `contract_auto_approved`，门卫异常写 `contract_admission_fail_closed` 阻断，**拒绝优先于同意**；`POST /api/contracts` 创建即准入（响应回传 `admission`），新增 `POST /api/contracts/:id/admit`（`NEEDS_APPROVAL` 返回 202）；并发撞状态机以 `SKIPPED` 兜底不误报失败。`tests/unit/contract-auto-approve.test.ts` 9 用例绿（空清单/无交集/glob×glob/具体路径/本轮同意/本轮拒绝/清单损坏/清单自锁/幂等），全量基线 **682 通过 / 4 跳过**。**残余（不阻塞 v0.1）**——`resume` 在"触碰保护清单时要求新审批版本"未实现：当前 `PENDING_RESUME → EXECUTING` 不区分是否触碰清单，即始终不重批（未触清单的"不重批"减负已满足，触碰清单的"应重批"缺失），与 P.1「静默合同」口径统一一并列为 v0.2+ 待办。）
* **核心目标**：
  1. `POST /api/contracts/:id/approve`：校验 `contract_revision` 与授权指纹（防 TOCTOU），原子推进双状态并创建 Worktree。**v1.3.3 减负**：合同 Scope 与全局保护清单**无交集时自动批准**（记录备案，无需用户点击）；有交集时向用户发**至多一个**白话是/否问题。
  2. `POST /api/contracts/:id/resume`：**双路径裁决负例断言 (G-14)**：
     - 安全违规类 (`SCOPE_VIOLATION`, `UNAUTHORIZED_COMMAND`, `UNSAFE_EXECUTION`) 调用 resume 返回 `409 Conflict`；
     - 预算类 resume：**v1.3.3 减负**——未触碰保护清单时不重批、只记录备案，恢复前后重试计数与累计开销保持连续；触碰保护清单时才要求新审批版本。
  3. `POST /api/contracts/:id/abort` 与 `reject` 接口。
  4. **并发互斥与工作区互斥锁守卫 (G-21)**：
     - 依据 A §6.4(2) 与互斥锁规范，同合同并发冲突返回 409 / `E_WORKSPACE_LOCKED` 并生成 BLOCKED 证据。
  5. **合同与证据快照持久化 (闭环 G-05)**：
     - 合并核销成功后，将合同快照写入 `.stagent/contracts/{contract_id}.json`，证据快照写入 `.stagent/evidence/{contract_id}-{evidence_id}.json`，文件模式严格设为 `0600`。
  6. 严格执行合并门禁（Gate 0 受控源 ➔ Gate 1 主树 Clean ➔ Gate 2 状态通过 ➔ Gate 3 实时指纹复核 ➔ Gate 4 测试完整性）。**v1.3.3 修订**：删除 Gate 5 二次确认弹窗，`can_merge=true` 时**一键合并**；Gate 3 实时指纹复核保留为 Daemon 后台兜底，用户不可见。**合并冲突仲裁（User-First Discard Rule）**：发生 Git 冲突时永远以用户主分支当前版本为准，直接丢弃 Worktree 冲突改动并提示 AI 重新基于最新代码修改，不向用户展示冲突解决界面。
  7. 写入 A §5.2 的 4 个标准 Git Trailer（`Audited-By`, `Stagent-Contract-ID`, `Stagent-Evidence-ID`, `Stagent-Verdict`），执行 Squash Merge 并清理 Worktree。
* **涉及核心文件**：
  - 修改：`daemon/server.ts`
  - 修改：`daemon/pipeline/merger.ts`
  - 修改：`daemon/pipeline/evidence-verifier.ts`
  - 修改：`daemon/pipeline/orchestrator.ts`（`admit()` 准入判定，步骤 D 新增）
  - 修改：`daemon/protection/protection-list.ts`（`intersectWithProtection()` / `witnessPath()`，步骤 D 新增）
  - 测试：`tests/unit/contract-auto-approve.test.ts`（步骤 D 新增，9 用例：无交集自动批准 / 拒绝优先 / Fail-Closed / 幂等）
  - 已存在的相关覆盖（按本轮代码对照报告核验）：`tests/integration/contract-api.test.ts`、`tests/integration/resume-abort.test.ts`、`tests/daemon/merger.test.ts`、`chaos-concurrency.test.ts`、`tests/unit/contract-auto-approve.test.ts`；后续新增测试必须确认仓库目录与文件名后再登记。
  - 本卡不再引用不存在的 `control-plane-approve/merge-gates/resume/concurrent-lock.test.ts` 文件名。
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 边界违规合同调用 resume 必然返回 409。
    - **双门禁合入门槛严格校验 (v1.4.0 新增)**：
      * 校验 EvidenceBundle 携带的 `target_commit_sha` 与 Worktree HEAD 的 Commit SHA 严格一致，防止代码变动后复用旧证据；
      * 合并执行瞬间执行目标分支基线漂移校验（`git merge-base --is-ancestor <base_sha> <target_branch_head>`），若目标分支已推进，跃迁至 `CONFLICT` 并安全阻断合并；
    - **异步停止端点 `/api/task/stop` (v1.4.0 新增)**：接收停止请求后立即置状态为 `STOPPING`，发送 SIGTERM 优雅退出并在 5 秒后 SIGKILL，释放工作区锁后置为 `ABORTED`；
    - 主树 Dirty、Evidence STALE 或 Agent 非受控时 Merge 坚决拒绝。
    - 合并成功后，Commit 包含 4 个标准 Trailer，且 `.stagent/contracts/` 与 `.stagent/evidence/` 快照文件完整落地。
  - **FAIL**：残留 `X-Stagent-*` 临时键；合并后未写入规范快照；SHA 不一致或基线漂移时仍允许合并。

---


---

#### 【Task D.2b】未跟踪文件合并门禁与 Contract v1.3 零静默迁移接入
* **任务编号**：`TASK-D.2b`
* **前置依赖**：`TASK-0.2c`, `TASK-D.2`, `TASK-W.2b`
* **任务状态**：**[COMPLETED]**（2026-10-23，提交 `150dc47`；`npm run typecheck` 0 error，新增 `tests/daemon/merger-d2b-gates.test.ts` 10 例全绿，定向回归 86 例与扩展回归 23 例全绿）
* **范围**：在合并前复核完整工作树范围，阻断合同外未跟踪文件；接入 `migrateContractToV13`，确保旧合同加载时不发生静默授权。该卡不重开 TASK-D.2 已完成的控制面主体。
* **Git Trailer 边界**：沿用已完成 D.2 的单条 ≤512B、合计 ≤4KB 限制；若仓库当前实现/测试事实不符，应先作为差异报告，不把既有完成声明当作新增实现。
* **交付事实与差异报告（2026-10-23）**：
  1. **D.2 并未实现该限制**：`merger.ts` 中不存在任何 Trailer 尺寸度量、常量或断言，D.2 交付的仅是「写入 4 个 Trailer 字段」。本卡新增 `measureTrailerBounds` / `assertTrailerBounds` 与常量 `MAX_TRAILER_LINE_BYTES = 512`、`MAX_TRAILER_BLOCK_BYTES = 4096`，属**新增实现**。
  2. **文档口径冲突**：架构规范 §5.2 写「单条 ≤1024B、合计 ≤4096B」，本卡与裁决写「单条 ≤512B、合计 ≤4KB」。经裁决取**更严格**的 512 并已在代码注释留痕；若后续对齐 §5.2，只需改一个常量。
  3. **旧合同的实际缺口不是「静默授权」而是「读不出来」**：原 `ContractStore.get()` 直接用 v1.3.0 Schema 解析 v1.2.0 文件，失败即返回 `null`，合并时报 `E_CONTRACT_NOT_FOUND`。本卡改为 `getWithMigration` 内存迁移（不写盘），并由 `migration.requiresReapproval` 派生 `E_CONTRACT_REQUIRES_REAPPROVAL` 阻断核销。
* **涉及核心文件**：修改 `daemon/pipeline/merger.ts`、合同加载/迁移调用点及相关测试；测试路径按仓库实存文件核定，避免引用未创建的文件名。
* **Pass/Fail**：PASS：已跟踪和未跟踪文件均参与 Scope 检查；超范围即拒绝合并并产生稳定错误码；DRAFT/PENDING_APPROVAL 历史合同绝不被迁移为 APPROVED；执行态历史合同按明确白名单迁移；FAIL：使用旧 Evidence 或未授权合同仍可合入。

### 3.7 端到端集成与自举发版（v0.1 基线已完成；后续扩展另开卡）

> v0.1 的 E.1/E.2 已由仓库历史与交付物核验为完成。若 v1.6.2 新增能力需要额外端到端覆盖，必须另建任务卡（例如未来 `TASK-E.3`），不得把已完成 E.1/E.2 改回待办。

#### 【Task E.1】双 Agent 协同与全流程 E2E 自动化测试
* **任务编号**：`TASK-E.1`
* **前置依赖**：`TASK-D.2`
* **任务状态**：**[COMPLETED]**（提交 `c82a7bb`；`tests/e2e/dual-agent-workflow.test.ts`、`tests/e2e/fault-injection-regression.test.ts` 已存在）
* **核心目标**：
  1. Happy Path 全生命周期无人值守自动化回归。
  2. **覆盖 8 类故障分支自动化拦截 (闭环 G-07)**：
     - 故障 1：超时重试熔断；
     - 故障 2：测试文件未经授权篡改阻断；
     - 故障 3：外部手动修改触发 Evidence STALE 阻断；
     - 故障 4：主树 Dirty 阻断合并；
     - **故障 5（v1.3.3 限定）：保护模式下，未批准合同尝试触碰保护资产必须被拒绝**（Vibe 模式下无合同门槛，不适用本条，但保护清单拦截恒生效）；
     - **故障 6：Supervisor 建议尝试直接触发执行必须被拒绝**；
     - **故障 7：Worker 完成声明不得直接改变状态为 PASSED**；
     - **故障 8：外部非受控 Agent 的输出严禁作为受控 Evidence 通过**。
  3. **Vibe 模式新增用例（v1.3.3）**：
     - 新项目、无保护清单、无合同：Agent 新建/修改文件并运行测试，全程零弹窗零审批，Header 显示"自由模式"；
     - Auto-Checkpoint 生成与【撤销本轮改动】一键恢复现场；
     - 保护路径在 VIBE 与 PROTECTED 下写入均被规则拦截；
     - 未触保护区任务用户交互次数 = 1（合并按钮）；触保护区 ≤ 2（一个是/否 + 合并）；
     - 合并冲突时 User-First Discard：以主分支为准丢弃 Worktree 冲突改动。
* **涉及核心文件**：
  - 新增：`tests/e2e/dual-agent-workflow.test.ts`
  - 新增：`tests/e2e/fault-injection-regression.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：全链路 E2E 退出码为 0；8 类故障分支全部断言成功触发阻断。
  - **FAIL**：出现任何安全越权或测试挂起。

---


---

#### 【Task E.2】Stagent 仓库自举 (Dogfooding) 与发版交付
* **任务编号**：`TASK-E.2`
* **前置依赖**：`TASK-E.1`
* **任务状态**：**[COMPLETED]**（提交 `9b15c20`、`178a8a6`；报告 `docs/reports/v0.1-dogfooding-report.md` 在位）
* **核心目标**：
  1. 在 Stagent 自身代码库中通过本地工作台完成真实自举演练。
  2. 输出演练报告 (`docs/reports/v0.1-dogfooding-report.md`)，客观披露实际开销与平台边界。
  3. 执行 `npm run build`，产出完整干净的生产发行包。
* **涉及核心文件**：
  - 新增：`docs/reports/v0.1-dogfooding-report.md`
  - 产出：`package.json`（v0.1.0）、生产 dist 目录
* **Pass/Fail 验收判定**：
  - **PASS**：自举 Commit 合规包含 4 个 Trailer，CLI 输出正常，生产构建 0 错误。
  - **FAIL**：生产构建失败或缺少依赖。

---


## 4. 单人串行排期与门禁实施指南 (Sprint Schedule，v1.6.2 对齐版)

> **v1.6.2 排期原则**：严守架构规范 §10 依赖次序，底层契约与状态机演进前置。Sprint 0 将 `TASK-0.2c` 作为当前代码实施第一优先级任务；Sprint 4 仅编排其依赖完成后的体验闭环任务，聚焦于「八步体验闭环与状态防死锁」，打通强类型契约、Demo 原型跨源隔离、Task Graph 物理点亮、质疑自查与多维 Studio。

| 迭代阶段 (Sprint) | 计划推进任务卡 | 阶段核心交付物 | 强制门禁检查点 (Gate Check) |
| :--- | :--- | :--- | :--- |
| **Sprint 0: 基础设施与契约演进** | `TASK-0.1` ➔ `TASK-0.2b` ➔ **`TASK-0.2c`**（Schema v1.3.0 与自愈迁移边） | 跨平台环境门禁、Schema v1.2.0 底座、**Schema v1.3.0 (`approval`/`authorization.git`) 与 Fast Path / 自愈迁移边** | `contract-schema-v13.test.ts` 全绿；9 态 lifecycle 迁移矩阵与 15 展示态投影测试通过（Fast Path、自愈、降级边全绿）；`migrateContractToV13` 零静默授权；全量 785+ 测试保持绿灯。 |
| **Sprint 1: 最小端到端（Vibe）** | `TASK-C.1`（三栏骨架）➔ `TASK-C.6`（右栏流式会话）➔ `TASK-W.5a`（Claude Code cli-host 挂载）➔ `TASK-C.3`（Monaco 读写） | 三栏布局、右栏流式/打断/续接、Claude Code 子进程挂载与 Headless 输出 | 右栏 Claude Code 改文件，中栏实时可见，可打断（≤2s）、可续接；全量既有测试以最新 CI 结果为准保持绿灯 |
| **Sprint 2: 保护清单 + 受控执行前置** | `TASK-P.1`（保护清单 + 快照撤销 + 静默合同）➔ `TASK-C.5`（Diff 与终端）➔ `TASK-W.3`（环境/秘密/网络守卫）➔ `TASK-W.4`（威胁守卫与能力复检） | `.stagent/protection.json`、Auto-Checkpoint、【撤销本轮改动】、Header 模式指示、Diff 审阅、环境与网络守卫、`threat-guard.ts` | 保护路径任意模式被拦截；撤销一键恢复；W.4 的 4 类绕过路径负例断言通过；**D.2 的三条前置（C.5、P.1、W.4）全部达成** |
| **Sprint 3: 受控执行实测 + 一键合并** | `TASK-W.5a` 绕过负例实测收尾 ➔ `TASK-D.2`（已完成基线）➔ `TASK-W.2b` ➔ `TASK-D.2b` | 保护模式合同（自动批准/单问）、Worktree 执行、Evidence 生成、增量 Scope 阻断与 Contract v1.3 合并门禁 | Claude Code 在 `GATEWAY_ENFORCED` 下 4 类绕过负例全部失败关闭；`verified_on` 填写实测版本与日期；未触保护区任务用户交互 = 1 次（合并按钮），触保护区 ≤ 2 次 |
| **Sprint 4: 原型试玩、Graph 点亮、质疑自查与防死锁闭环 (八步体验闭环)** | **`TASK-D.3`**（15 状态投影与防死锁）➔ `TASK-S.1` ➔ `TASK-S.2` ➔ `TASK-S.4`（Demo 原型与预览）➔ `TASK-C.7`（Task Graph 渐进点亮）➔ `TASK-S.5`（质疑自查引擎）➔ `TASK-C.2`（Studio 多维视口集成）➔ **`TASK-S.6`（非技术旅程串联，NEW）** | 本地独立端口 Mock 预览 (≤2MB / 独立 Origin / iframe sandbox 无 `allow-same-origin`)、业务脑图与任务 DAG 双重视图、物理指纹点亮动效、质疑自查三方比对报告与置信度治理、Studio 四视口流畅切换、五类防死锁引擎 (D-1~D-5) | 1. 静态 Demo 单文件受控落盘 ≤2MB，在独立随机端口 (4100~4110) 成功预览，iframe sandbox 与 CSP 阻断连接 Daemon 端口，负例 E2E 测试通过；<br>2. Task Graph 节点状态由 Daemon 权威持有，点亮动效延迟 ≤100ms 且严格绑定退出码 0 与 Commit SHA，空验证集 COMMAND 节点禁止全绿；<br>3. 质疑自查看门狗 60s 超时兜底，`confidence < 0.7` 自动降级呈现事实由用户裁决，自动返工严格受限原 Scope 子集；<br>4. 15 状态映射测试通过，D-1~D-5 故障注入测试 100% 成功解除死锁；<br>5. Studio 在 Demo/Graph/质询/代码四视口间流畅切换无状态丢失。 |
| **Sprint 5: 第二/第三个 Agent** | `TASK-W.5b` ➔ `TASK-W.5c` | cursor-agent / OpenHands（`SANDBOX_ENFORCED`）各自 cli-host 实测、计费模型分支 | 每个 Adapter 的 `verified_on` 如实填写；未通过者仅 Vibe 可用且 UI 显示"未受控" |
| **Sprint 6: E2E 与自举发版** | v0.1 基线 `TASK-E.1` / `TASK-E.2` 已完成；v1.6.2 不重开，新增覆盖另建卡 | 既有 E2E 与自举报告基线；新能力的回归范围须在独立 E.3（或后续任务）定义 | 核对历史报告与测试可复现；新增 E.3 另立验收门禁 |
| **v0.2+（推迟，另行立项）** `[用户已确认 D4 · 2026-10-20]` | `TASK-B.1` ➔ `TASK-B.2` ➔ `TASK-C.4` ➔ `TASK-S.3`（建议广播、成熟度评分与 HUD 徽章/Snooze）➔ RFC-2026-002（多子任务 DAG / 新鲜上下文 / Schema-First / 并行 Worktree） | 架构雷达、成熟度评分、多 Agent 编译流水线 | 另行立项评审 |

> **Sprint 0 / 2 / 3 / 4 实施基线核验**：
> - **当前工程物理起点**：本地代码仓库 `main`@`be33a26`（含 C.10b；此前 C.10a `5207df2`）；测试基线 **1265 passed / 6 skipped**；已交付至 C.9a–C.9d、C.10a/b；**C.10c 已正式立卡 [NEW_TASK]**。
> - **当前首要编码任务**：**`TASK-C.10c`**（界面暗号/命名清扫：白话标签 + 图谱单入口）。`TASK-D.1e` 仍 **`[DEFERRED → v0.2+]`（P5.8）**。对照走查报告 §6 别扭#4–7。不重做指挥纪律；不改鉴权；不抢 D.1e。
> - **Sprint 2 已达成**：`TASK-P.1`、`TASK-C.5`、`TASK-W.3`、`TASK-W.4` 四张卡均已落地并通过各自专用用例；保护路径在任意模式被门卫拦截、撤销一键恢复、4 类绕过负例失败关闭均已成立。
> - **Sprint 3 已达成**：`TASK-D.2` 主体已落地，无交集合同自动批准，交互收敛为 1 次合并按钮。
> - **Sprint 4 进展**：`TASK-D.3`（merge `9a19f4d`）、`TASK-C.2`（merge `51039aa`）与 `TASK-S.1`（merge `a9066dd`）已合入；底座与四视口主链收口完成。**体验最后一公里** `TASK-S.6` 已合入（merge `6415fbd`）；**S.6b REAL_PLAYTEST 真预览挂载已收口**（merge `024d2b8`）。
> - **Sprint 4 体验打磨**：`TASK-C.8a` / `C.8c` / `C.8b` 与 **第二轮** `C.9a`–`C.9d`、**第三轮** `C.10a`/`C.10b` 均已 **COMPLETED**（`5207df2` / `be33a26`）；**`TASK-C.10c` [NEW_TASK]** 为当前首要（暗号/命名清扫）；属非技术可用性打磨，不新开 Sprint 编号。

### 跨阶段门禁准则 (Gate Alignment)
根据 A §10 规定，阶段内任务支持依据 DAG 拓扑关系进行并行编码与单元验证；跨阶段进入联调前，必须以当前 Sprint 的 Gate Check 检查点为准绳，跑通：
```bash
node scripts/verify-env.mjs && npx tsc --noEmit && npm run lint && npm test
```
全部通过后方可推进下一阶段。

---
## 5. 路径映射约定（2026-10-20 核定）

仓库保留既有 `daemon/` 顶层结构，**不再新建平行的 `src/daemon/`**。各任务卡「涉及核心文件」已按下列映射逐条改写为仓库实际布局：

| 任务卡旧路径（v1.2.0 及更早） | 仓库实际路径 |
|---|---|
| `bin/stagent.mjs` / `src/cli/index.ts` | `bin/stagent.ts`（CLI 单一入口） |
| `src/daemon/ws-server.ts` / `src/daemon/http-router.ts` | `daemon/server.ts` |
| `src/daemon/ws-types.ts` | `src/lib/ipc/frames.ts`（协议为 Daemon 与浏览器共享，留在共享协议模块） |
| `src/daemon/scoped-mcp-gateway.ts` | `daemon/mcp/gateway.ts` |
| `src/daemon/process-runner.ts` | `daemon/runner/command-runner.ts` |
| `src/daemon/git-merger.ts` | `daemon/pipeline/merger.ts` |
| `src/daemon/evidence-stale-manager.ts` | `daemon/watcher/invalidation-engine.ts` |
| `src/daemon/evidence-verifier.ts` | `daemon/pipeline/evidence-verifier.ts`（待建） |
| `src/lib/contract-migration.ts`（旧任务草案路径） | `src/lib/migration.ts`（仓库现有迁移模块） |
| `src/supervisor/*` | `daemon/supervisor/*`（待建） |
| `src/worker/*` | `daemon/worker/*`（待建） |
| `src/architecture/*` | `daemon/arch/*`（既有 `graph.ts`/`parser.ts`） |
| `src/watcher/worktree-watcher.ts` | `daemon/watcher/fs-watcher.ts` |
| `src/ui/components/*` | `src/components/*` |
| `src/ui/hooks/*` | `src/hooks/*`（WS 客户端 Hook 既有 `use-daemon-stream.ts`） |

**v1.3.3 新增模块路径（成熟 Agent 与保护清单）**：

| 模块 | 路径 | 说明 |
|---|---|---|
| 成熟 Agent 子进程隔离 | `daemon/worker/cli-host/` | **全仓唯一允许 `child_process`/spawn 的位置**；强制结构化 argv + `shell:false` + 进程树托管回收 |
| Claude Code 适配器 | `daemon/worker/cli-host/claude-code-adapter.ts` | Headless 结构化输出、Pre-tool hook 拦截、会话续接；`verified_on`: Claude Code 2.1.296 (DeepSeek API 兼容模式) · 2026-10-21（真实 CLI 负例 4/4 全绿；官方 Anthropic 复测为后续回归项） |
| 全局保护清单 | `daemon/protection/protection-list.ts` + `.stagent/protection.json` | 路径 glob + 白话名称；任何模式下规则拦截 |
| Vibe 自动快照 | `daemon/protection/auto-checkpoint.ts` | Agent 改动前自动快照，支撑【撤销本轮改动】 |
| Supervisor 独立预算 | `.stagent/supervisor-budget.json` | 与合同/Worker 预算分账，不互相侵占 |

> **静态约束口径（v1.3.3 收窄）**：`daemon/worker/**` 维持零 `child_process` 静态禁令，唯一例外为 `daemon/worker/cli-host/**`；该例外的测试断言为"cli-host 之外零 spawn"。

测试文件统一归 `tests/{unit,daemon,integration,e2e}/`；浏览器 DOM 测试归 `src/tests/`、`src/hooks/`（vitest `dom` project）。


## 6. v1.6.2 修订记录与一致性核对

- **P-1**：TASK-E.1/E.2 更正为 `[COMPLETED]`，保留历史提交与实存交付物；Sprint 6 不再重复排期。
- **P-2**：从已完成卡剥离四个未交付的 v1.5.0 补齐块；状态投影/广播归 TASK-D.3，文件树动效归 TASK-C.7，质疑入口路由归 TASK-S.5 / Studio 集成。
- **P-3**：已完成 TASK-W.2/TASK-D.2 中的 v1.6.1 增补拆为 TASK-W.2b/TASK-D.2b，明确前置与验收。
- **P-4**：展示态统一为架构 §6.3.1 的 15 态；映射表每项采用 `(approval.status, lifecycle_state)` 顺序并附运行时判据。
- **P-5/P-6**：修正迁移模块路径为 `src/lib/migration.ts`，拆分 9 态生命周期迁移矩阵与 15 态展示投影，并写入 785 测试基线守护要求。
- **P-7**：补入 `TASK-C.1 → TASK-C.7`、`TASK-C.6 → TASK-W.5a` 及 W.2b/D.2b 依赖边；TASK-0.2c 只在 Sprint 0 排期。
- **P-8/P-9/P-10**：规范 Supervisor 新模块路径为 `daemon/supervisor/*`；将 D.2 测试引用改为本轮核验报告列出的真实覆盖文件，以函数/符号锚点取代漂移行号；更新基线至 `6d7fa59`，删除过时注记。
- **P-11（本轮修正）**：§2.1 ASCII 图恢复 `W.2 → W.3 → W.4` 主链，W.2b/D.2b 改绘为"增量门禁旁支"，消除图文暗示 `W.3` 依赖 `D.2b` 的矛盾；与 JSON 边清单保持一致。
- **P-12（本轮修正）**：TASK-W.2b 错误码模块路径更正为 `src/lib/error-codes.ts`（`daemon/pipeline/error-codes.ts` 不存在）。
- **P-13（本轮修正）**：TASK-D.3 映射表末行更正为 `(REJECTED 或 APPROVED, ABORTED)`；`(APPROVED, AUDITED)` 四分支补显式短路优先级（`CONFLICT` > `DISPUTED_INSPECTING` > `REAL_PLAYTEST` > `READY_TO_MERGE`），与架构 §6.3.1 同步。
- **P-14（本轮修正）**：TASK-C.7 节点口径由"四态"更正为架构 §3.2.1 的七态（补 `REPAIRING` / `BLOCKED`），并将点亮依据由"Git Commit SHA"更正为架构 §3.2.2/ADR-009 的 `node_patch_fingerprint`。
- **P-15（本轮增补，2026-10-23）**：TASK-S.5「三方事实核验管道」追加**自查对照源**实现要点，明确质疑分析以不可变需求快照 `.stagent/specs/revisions/req-v*.md` 为对照基准，而非 `requirements.md` 最新态（对齐架构 §5.1 需求快照机制与 RFC-2026-002 §7.3.3）。本条仅追加实现要点，不改动任务范围、前置依赖、验收判定与 Sprint 排期。
- **P-16（交付回写，2026-10-23）**：TASK-D.2b 状态由 `[NEW_TASK]` 回写为 `[COMPLETED]`，锁定提交 `150dc47`（分支 `feat/task-d2b-untracked-merge-guard`，基线 `05f090f`）。同步在卡内补「交付事实与差异报告」，登记三项与既有声明/文档不一致的事实：D.2 未实现 Trailer 尺寸边界、架构 §5.2 的 1024B 与卡片 512B 冲突（经裁决取 512）、旧合同加载缺口实为「读不出来」而非「静默授权」。本条仅回写交付事实，不改动任务范围、依赖边与 Sprint 排期。
- **P-17（交付回写，2026-10-23）**：TASK-D.3 状态由 `[PARTIAL]` 回写为 `[COMPLETED]`，锁定 merge `9a19f4d`（含 `c2fcb8a` / `83ec516`）。同步更新 §1.1 矩阵、详细卡文件清单与测试基线（`main`@`9a19f4d`，1084 passed / 6 skipped）。本条仅回写交付事实，不改动任务范围、依赖边与 Sprint 排期。
- **P-18（交付回写，2026-10-24）**：TASK-C.2 状态由 `[PARTIAL]` 回写为 `[COMPLETED]`，锁定 merge `51039aa`（功能 `c1ad3be`）。同步更新 §1.1 矩阵、详细卡文件清单与测试基线（`main`@`51039aa`，1099 passed / 6 skipped）。本条仅回写交付事实，不改动任务范围、依赖边与 Sprint 排期。
- **P-19（交付回写，2026-10-24）**：TASK-S.1 状态由 `[PARTIAL]` 回写为 `[COMPLETED]`，锁定 merge `a9066dd`（功能 `a7d7292`）。同步更新 §1.1 矩阵、详细卡文件清单与测试基线（`main`@`a9066dd`，1122 passed / 6 skipped）。本条仅回写交付事实，不改动任务范围、依赖边与 Sprint 排期。
- **P-20（立卡，2026-10-24）**：新增 `TASK-S.6` 非技术旅程串联（当时 `[NEW_TASK]`）。
- **P-21（合入，2026-10-24）**：`TASK-S.6` → `[COMPLETED]`（merge `6415fbd` / `bbab79e`；1155 passed / 6 skipped）。S.6b REAL_PLAYTEST 降级登记。同步：版本头第 11 条状态回写、§1.1 矩阵新行、§2.1 ASCII/JSON 依赖边（S.4/C.7/S.5/C.2/S.2/W.5a → S.6）、§3.2 详细卡、Sprint 4 链尾与「当前首要编码任务」指向 S.6；C.2 残余①注明已转交 S.6。S.4/C.7/S.5/C.2/S.1 已 COMPLETED 不重复改状态；S.3 仍 DEFERRED→v0.2+。**不改**架构规范与产品代码；对照 `docs/reports/非技术用户旅程验收稿.md`。
- **P-22（合入，2026-10-24）**：`TASK-S.6b` → `[COMPLETED]`（merge `024d2b8` / `613ff51`；1165 passed / 6 skipped）。同步：版本头第 13 条、§1.1 矩阵 S.6 行注明 S.6b 已收口、§3.2 详细卡、Sprint 4「当前首要」与进展。不改架构规范；未开 W.5b/c。
- **P-23（立卡，2026-10-24）**：新增 `TASK-D.1b` 一键打开项目（Daemon 托管控制台 + open CLI）（`[NEW_TASK]`）。同步：版本头第 14 条、§1.1 矩阵新行、§2.1 ASCII/JSON 依赖边（`TASK-D.1` → `TASK-D.1b`）、§3.1 详细卡、Sprint「当前首要」指向 D.1b。**不改**架构规范与产品代码；不含 Electron/Tauri/系统协议；不推翻 D.1 鉴权。
- **P-24（合入回写补记，2026-10-24）**：`TASK-D.1b` → `[COMPLETED]`（merge `d5b35e0` / `946e9fc`；1188 passed / 6 skipped）。对应版本头第 15 条；本条补 changelog 与矩阵/详细卡已 COMPLETED 口径一致。
- **P-25（立卡，2026-10-24）**：新增 `TASK-D.1c` 最近项目一键重开（控制台「打开项目」）（`[NEW_TASK]`）。同步：版本头第 16 条、§1.1 矩阵新行、§2.1 ASCII/JSON 依赖边（`TASK-D.1b` → `TASK-D.1c`）、§3.1 详细卡（D.1b 后）、Sprint「当前首要」指向 D.1c；D.1b 残余「最近项目列表」转交本卡。**不改**架构规范与产品代码；不含真·任意路径文件夹选择器 / Electron/Tauri；不推翻 D.1/D.1b 鉴权。
- **P-26（合入，2026-10-24）**：`TASK-D.1c` 标 `[COMPLETED]`（main tip `f3e371e` 快进合入；四件套 1204 passed / 6 skipped）。同步：版本头第 17 条、§1.1 矩阵/ASCII、§3.1 详细卡、Sprint「当前首要」。交付：本机最近列表 + 控制台一点重开带钥匙；不含任意路径选择器。
- **P-27（立卡，2026-10-24）**：新增 `TASK-D.1d` 修复同源控制台空白（生产可用单窗口）（`[NEW_TASK]`）与 `TASK-D.1e` 桌面壳/本机助手真·选文件夹（`[NEW_TASK]`，可 defer）。同步：版本头第 18 条、§1.1 矩阵、§2.1 ASCII/JSON（`D.1c→D.1d→D.1e`）、§3.1 详细卡、Sprint「当前首要」指向 D.1d；新增白话报告 `docs/reports/打开项目-愿景与现状.md`。**不改**产品代码；架构仅 §11 短注；不推翻 D.1；Demo 仍独立 Origin。


**一致性核验结果**：本版生成后以脚本校验 JSON DAG 无环、所有边端点均为已登记任务、每张任务卡的前置依赖均在 DAG 中存在直达边或可验证的传递路径（直达边缺失者如 `S.1→S.5` 经 `S.2` 传递，属显式豁免）、Sprint 0/4 不重复排入 TASK-0.2c、E.1/E.2 完成状态一致；TASK-D.3 的有效映射表采用架构定义的 15 态，且 `(APPROVED, AUDITED)` 四分支带显式短路优先级，旧词仅出现在明确禁止引入的说明中。该检查是文档结构校验，不代表本次重新运行代码测试、Schema 编译或端到端验证。
- **P-28（口径对齐，2026-10-24）**：Tina 施工合同对齐——`TASK-D.1e` → **`[DEFERRED → v0.2+]`（P5.8）**；`TASK-D.1d` 前置 `D.1b`+`C.2`、最高优先 DX、验收补 dist 静态可用性回归；Sprint 将 D.1d 定为非技术进门关键门禁（相对 S.6 优先修打开路径）。版本头第 19 条；架构仅轻量锚定。**不改**产品代码。
- **P-29（合入回写，2026-10-24）**：`TASK-D.1d` → **`[COMPLETED]`**（main tip `b11d15b` 快进合入；四件套 **1208 passed / 6 skipped**）。同步：版本头第 20 条、§1.1 矩阵、§2.1 ASCII、§3.1 详细卡、Sprint「当前首要」（打开路径无阻塞，按需选 W.5b/c 等）。交付要点：`tanstackStart.spa` + `_shell.html`→`index.html` + static-host 仅托管 `$_TSR` 壳 + dist 静态回归。**不改**产品代码（本条仅文档）；**不改**架构规范（已有注记 8）。
- **P-30（立卡，2026-10-24）**：新增 `TASK-C.8a`（老板模式文案与默认助手）、`TASK-C.8b`（Fast Path 老板三步台）、`TASK-C.8c`（连接与打开死路自救）三张 `[NEW_TASK]`。同步：版本头第 21 条、§1.1 矩阵三行、§2.1 ASCII/JSON（`D.1d→C.8a`；`D.1d+S.6→C.8b`；`D.1b/D.1c/D.1d→C.8c`）、§3.4 详细卡、Sprint「当前首要」→ **C.8a**，建议序 **C.8a→C.8c→C.8b**；白话报告 `docs/reports/工作台交互走查-2026-10-24.md`。**不改**产品代码；**不改**架构规范（文案层不改变鉴权/Demo Origin）；C.8c **不抢** 已 DEFERRED 的 D.1e。
- **P-31（合入回写，2026-10-24）**：`TASK-C.8a` → **`[COMPLETED]`**（main tip `15ef8e6` 快进合入；四件套 **1213 passed / 6 skipped**）。同步：版本头第 22 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ **C.8c**；走查报告状态回写。交付要点：练习沙箱可折叠、默认真助手、右栏 Key 三步向导 + 设置白话闭环。**不改**架构规范（文案层不改变鉴权/Demo Origin）。
- **P-32（合入回写，2026-10-24）**：`TASK-C.8c` → **`[COMPLETED]`**（main tip `950e53e` 快进合入；四件套 **1217 passed / 6 skipped**）。同步：版本头第 23 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ **C.8b**；走查报告状态回写。交付要点：无钥匙 `session/relaunch`、粘贴路径 `recent-projects/open`、主路径少催终端/#token=。**不抢** D.1e；**不改**架构规范（不改变鉴权/Demo Origin）。
- **P-33（合入回写，2026-10-24）**：`TASK-C.8b` → **`[COMPLETED]`**（main tip `6d16939` 快进合入；四件套 **1224 passed / 6 skipped**）。同步：版本头第 24 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ Top3 收口；走查报告状态回写。交付要点：`BossFastPathDesk` 三步台、高级详情折叠、保护命中需勾选、大事仍完整合同台。**不改**准入规则/状态机边；**不改**架构规范（不改变鉴权/Demo Origin）。
- **P-34（立卡，2026-10-24）**：新增 `TASK-C.9a`（首屏单一主路径）、`TASK-C.9b`（助手模式互斥）、`TASK-C.9c`（打开项目面板生命周期）、`TASK-C.9d`（进行中中栏让路）四张 `[NEW_TASK]`。同步：版本头第 25 条、§1.1 矩阵四行、§2.1 ASCII/JSON（`C.8a/b/c→C.9a`；`C.9a+C.8a→C.9b`；`C.9a+C.8c→C.9c`；`C.9a+C.9b+C.8b→C.9d`）、§3.4 详细卡、Sprint「当前首要」→ **C.9a**，建议序 **C.9a→C.9b→C.9c→C.9d**；走查报告续写 §5 第二轮。**不改**产品代码；**不改**架构规范（呈现/面板生命周期不改变鉴权/Demo Origin）；**不抢** D.1e。
- **P-35（合入回写，2026-10-24）**：`TASK-C.9a` → **`[COMPLETED]`**（main tip `ef0e1a7` 快进合入；四件套 **1231 passed / 6 skipped**）。同步：版本头第 26 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ **C.9b**；走查报告状态回写。交付要点：`resolveCommandSurface` 三态单一主 CTA、欢迎/打开面板/顶栏降噪。架构规范仅 §11 注记 9 轻量锚定（呈现层不改变鉴权/Demo Origin）。
- **P-36（合入回写，2026-10-24）**：`TASK-C.9b` → **`[COMPLETED]`**（main tip `c4818fa` 快进合入；四件套 **1239 passed / 6 skipped**）。同步：版本头第 27 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ **C.9c**；走查报告状态回写。交付要点：`resolveAssistantMode` 三态互斥、向导发送禁用、练习横幅、中栏随模式。架构规范仅 §11 注记 9 轻量锚定延续（呈现层）。
- **P-37（合入回写，2026-10-24）**：`TASK-C.9c` → **`[COMPLETED]`**（main tip `2f5d653` 快进合入；四件套 **1246 passed / 6 skipped**）。同步：版本头第 28 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ **C.9d**；走查报告状态回写。交付要点：默认收、成功即关、已连接「切换项目」。架构规范仅 §11 注记 9 轻量锚定延续；**不抢** D.1e。
- **P-38（合入回写，2026-10-24）**：`TASK-C.9d` → **`[COMPLETED]`**（main tip `edc28ce` 快进合入；四件套 **1254 passed / 6 skipped**）。同步：版本头第 29 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ 第二轮收口；走查报告状态回写。交付要点：`middle-yield`、自动开 Studio、设置深链/回跳、聊≠改白话。架构规范仅 §11 注记 9 轻量锚定延续。C.9a–d 收口。
- **P-39（立卡，2026-10-24）**：新增 `TASK-C.10a`（进行中生命周期收口）、`TASK-C.10b`（设置页老板主路径）两张 `[NEW_TASK]`，及 `TASK-C.10c`（界面暗号清扫）`[DEFERRED · 可并入统一抛光]`。同步：版本头第 30 条、§1.1 矩阵三行、§2.1 ASCII/JSON（`C.9a+C.9d→C.10a`；`C.9d+C.8a→C.10b`）、§3.4 详细卡、Sprint「当前首要」→ **C.10a**，建议序 **C.10a→C.10b**；走查报告 §6 第三轮正式写入。**不改**产品代码；架构规范仅 §11 注记 9 轻量续写（不改变鉴权/Demo Origin）；**不抢** D.1e；C.10c 不挡 C.10a/b。
- **P-40（合入回写，2026-10-24）**：`TASK-C.10a` → **`[COMPLETED]`**（main tip `5207df2` 快进合入；四件套 **1261 passed / 6 skipped**）。同步：版本头第 31 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ **C.10b**；走查报告状态回写。交付要点：`in-progress-lifecycle`、历史卡不粘、无空让路壳、Studio 保持。架构规范仅 §11 注记 9 轻量锚定延续。
- **P-41（合入回写，2026-10-24）**：`TASK-C.10b` → **`[COMPLETED]`**（main tip `be33a26` 快进合入；四件套 **1265 passed / 6 skipped**）。同步：版本头第 32 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ 第三轮体验卡收口；`TASK-C.10c` 仍 DEFERRED。交付要点：模型钥匙置顶、`settings-advanced` 默认折叠、C.9d 深链/返回对话保留。架构规范仅 §11 注记 9 轻量锚定延续。

- **P-42（立卡，2026-10-24）**：`TASK-C.10c` 由 DEFERRED 升为 **`[NEW_TASK]`**（界面暗号/命名清扫：白话标签 + 图谱单入口）。同步：版本头第 33 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10a+C.10b→C.10c`）、§3.4 详细卡、Sprint「当前首要」→ **C.10c**；走查报告 §6.5 状态回写。**不改**产品代码（本条仅文档）；架构规范仅 §11 注记 9 轻量续写；**不重做**指挥纪律；**不改**鉴权；**不抢** D.1e。
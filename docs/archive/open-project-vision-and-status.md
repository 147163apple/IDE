# 打开项目：产品愿景与现状（白话说明 · 生产级口径）

> 给谁看：产品 / 非技术验收 / 后续实现同学。  
> 日期：2026-10-24（Asia/Hong_Kong）。  
> 依据：对话中「像 Cursor 一样 Import / 打开项目」诉求；`TASK-D.1` / `D.1b` / `D.1c` / **`D.1d`** 已合入事实（同源空白已于 main tip `b11d15b` 修复）。  
> 对照：`docs/specs/development-tasks.md`（`TASK-D.1d` COMPLETED；`TASK-D.1e` DEFERRED→v0.2+）；架构规范 v1.6.1 §4.4 / ADR-008（Demo 独立 Origin）；`docs/archive/non-technical-journey-acceptance.md`。  
> **本说明只定口径，不改产品代码。**

---

## 0. 一句话

**愿景**：打开 Stagent → 选文件夹或点最近项目 → 同一个产品壳里进工作台聊天（像 Cursor 的 Open / Recent）。  
**今天**：第一次仍要终端 `stagent open <路径>`；控制台里能点「最近项目」重开；**D.1d 已合入 main tip `b11d15b`**——`npm run build && stagent open` 同源单窗口可出工作台（开发态仍可 Vite + `#token=` / `#base=`）。

---

## 1. 愿景（生产级目标体验）

| 用户想做什么 | 理想看见什么 | 成功标准 |
| --- | --- | --- |
| 第一次打开某个本地文件夹 | 产品壳里「打开项目 / Import」→ 系统对话框选文件夹 → 自动进工作台 | **Import / New Project 与右侧聊天、中栏 Studio 在同一产品壳**；不用自己开第二个终端、不用手拷钥匙 |
| 再打开以前用过的项目 | 「最近打开」列表一点即进 | 与 Cursor Recent 同级体感 |
| 新建空项目 | 「New Project」引导初始化 Git / `.stagent`（对齐架构 Alt-Flow A1） | 非技术用户不必先懂仓库初始化 |
| 全程安全 | 仍只连本机；没钥匙进不去 | **不推翻** `127.0.0.1` + `#token=` fragment + WS AUTH + Origin 校验（D.1）；**Demo 假页面仍独立 Origin**（4100~4110），绝不与控制台/Daemon 同源 |

说明：浏览器网页**本身选不了任意本地路径**（没有系统级文件夹选择器）。真·「浏览磁盘选文件夹」需要本机小助手或 Electron/Tauri 桌面壳（见 `TASK-D.1e`，可延后）。

---

## 2. 现状分层（别把三件事混成一件）

### 2.1 `TASK-D.1`（底座，已完成）

- Daemon 只听本机、动态端口 3001~3010、PID 锁、会话 Token、WS 首帧 AUTH。  
- 控制台与 Daemon 曾经是「两端」：一个起后台，一个起前端，再拷 Token。

### 2.2 `TASK-D.1b`「单窗口托管」——它是什么 / 不是什么

| 是 | 不是 |
| --- | --- |
| 一条 `stagent open <路径>`：起/复用 Daemon，尽量用**同一个浏览器标签**打开控制台，钥匙经 URL `#token=`（及必要时 `#base=`）自动带上 | **不是** Cursor 式 Import 与工作台同壳的完整产品首页 |
| 少开一个终端、少手拷 Token（DX） | **不是**系统文件夹选择器 / Electron |
| 有 `dist/public` 时尝试 Daemon **同源托管**静态控制台 | **不是**把 Demo 假页面也改成与 Daemon 同源（Demo 仍必须独立 Origin） |

**已修复（原阻断「生产级单窗口」）**：合入前 `dist/public/index.html` 曾是极简静态壳，TanStack Start 撑不起工作台 → 同源页空白。  
→ **`TASK-D.1d` 已 COMPLETED**（main tip `b11d15b`：SPA `$_TSR` 壳 + package-dist 提升 `_shell.html` + static-host 门禁）。

### 2.3 `TASK-D.1c`「最近项目一键重开」（已完成）

- 控制台「打开项目」展示本机 `~/.stagent/recent-projects.json` 列表；一点带钥匙重开。  
- **不含**任意路径选文件夹；新路径第一次仍走 `stagent open`。  
- 真·选文件夹留给 **`TASK-D.1e`（DEFERRED → v0.2+ / P5.8）**。

### 2.4 今天可用的绕路（与 README 一致）

1. **推荐生产手测**：`npm run build` 后 `npx tsx bin/stagent.ts open <项目>`——同源 `30xx/#token=` 应直接出三栏工作台。  
2. **开发态可选**：仍可 Vite + `#token=`；跨端口时带 `#base=http://127.0.0.1:<daemon端口>`。  
3. **最近重开**：须至少成功 open 过一次；同源壳已可 hydrate（D.1d）。若仍见空白，先清浏览器缓存再开。

---

## 3. 安全不变式（后续实现不得推翻）

1. Daemon / 控制台 API：**仅** `127.0.0.1`；WS 须 AUTH；Token 经 `#token=` fragment，客户端读后抹除；**日志不得打印 Token 明文**。  
2. **控制台**可以与 Daemon **同源托管**（D.1b 方向）——这只影响「谁提供 HTML/JS」，不降低鉴权。  
3. **Demo 预览**必须继续 **独立 Origin**（如 4100~4110）+ `iframe sandbox="allow-scripts"`（**禁止** `allow-same-origin`）+ CSP 阻断打 Daemon（架构 §4.4 / ADR-008）。控制台修好单窗口后，**仍不得**让 Demo iframe 获得 Daemon 同源权限。  
4. 工作区 PID 锁冲突：白话 `E_WORKSPACE_LOCKED`，不静默抢占。

---

## 4. 后续任务卡（摘要）

| 卡 | 目标 | 状态意向 |
| --- | --- | --- |
| **TASK-D.1d** | 修复同源控制台空白，使 `stagent open` 真·单窗口可聊（生产可用） | **`[COMPLETED]`**（main tip `b11d15b`；1208 passed / 6 skipped） |
| **TASK-D.1e** | 本机助手 / 桌面壳：真·系统文件夹选择器；Import/New 与工作台同壳 | **`[DEFERRED → v0.2+]`（P5.8）**；不阻塞 v0.1 / D.1d |

详细验收见任务规范 v1.6.2 §3.1。

---

## 5. 与非技术八步旅程的关系

「打开项目」是**进门**，八步旅程（聊需求 → Demo → 图 → 点亮 → 真机 → 质疑…）是**进门之后**。  
打开路径曾被空白壳阻断；**D.1d 已合入**后生产级顺序变为：**单窗口已通 → D.1e 桌面壳正式推迟 v0.2+**；八步串联已由 S.6 / S.6b 承接，不在本说明重开。

---

## 6. 验收自检（文档口径，非代码门禁）

- [ ] 读者能分清：愿景同壳 ≠ D.1b 单窗口托管 ≠ D.1c 最近列表 ≠ D.1e 真选文件夹  
- [ ] 读者知道同源空白已由 **D.1d / `b11d15b`** 修复；开发态仍可选 Vite + `#token=` / `#base=`  
- [ ] 读者知道 Demo 独立 Origin **不**因控制台同源托管而改变  

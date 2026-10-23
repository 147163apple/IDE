# Stagent v0.1

> 面向**非技术业务用户**、独立开发者与外包工程师的**本地受控编程工作台**。  
> 右侧用白话聊天；中间先试静态 Demo，再看任务图一块块点亮；改动进合同、进 Worktree、用真实命令出 Evidence，最后由人核准合并。

Stagent 不是通用云端 Agent 平台。它在本地启动 Daemon（**仅**监听 `127.0.0.1`），
用合同约束改动范围，在独立 Git Worktree 中执行，用验证命令产出 Evidence，最后由人核准合并。

---

## 快速开始

环境要求：**Node.js ≥ 20**、**Git ≥ 2.30**（macOS / Linux / Windows）。

```bash
git clone <repo> && cd <repo>          # 本仓示例路径：…/1020
npm ci
npm run build                          # 产出 dist/（含 dist/public）；发版/一键打开前需要
node scripts/verify-env.mjs            # 环境门槛 + typecheck + lint + 单测
```

### 打开一个业务项目（当前真实可用路径）

**重要（2026-10-24）**：`stagent open` 的「Daemon 同源单窗口」在修好 `TASK-D.1d` 之前存在**已知缺陷**——`dist/public/index.html` 静态壳撑不起 TanStack Start 控制台，浏览器常见**空白页**。  
生产级愿景与分层说明见：`docs/reports/打开项目-愿景与现状.md`。

#### 推荐：开发态双端（可聊、非空白）

```bash
# 终端 A：在本仓启动指向业务目录的 Daemon（端口常为 3001~3010）
npx tsx bin/stagent.ts start --repo /path/to/your-project

# 终端 B：本仓起控制台（Vite，默认 http://127.0.0.1:5173 或 8080，以实际打印为准）
npm run dev
```

浏览器打开控制台地址，并带上钥匙（Daemon 启动日志/状态里取 Token；**不要**把 Token 发到公开聊天）：

- 同机示例：`http://127.0.0.1:5173/#token=<TOKEN>&base=http://127.0.0.1:<DAEMON_PORT>`
- `#base=` 在控制台端口与 Daemon 端口不同时**必需**，否则前端会连错端口。

#### 一键 open（D.1b；同源壳修好前请慎用）

```bash
npx tsx bin/stagent.ts open /path/to/your-project
# 或：npm run stagent -- open /path/to/your-project
```

行为摘要：

- 启动或复用该工作区 Daemon；成功则写入本机「最近项目」列表（`TASK-D.1c`）。
- **若**同源托管可用：尝试只开一个浏览器窗口，URL 带 `#token=`（及必要时 `#base=`）。
- **当前**：同源页往往空白 → 请改用上方「开发态双端」，或等待 `TASK-D.1d`。
- 无 `dist/public` 时，open 可能回退 Vite 并注入 `#base=`（以 CLI 实际输出为准）。

#### 最近项目（D.1c）

控制台「打开项目」可列出曾经 `open`/`start` 成功过的路径，一点带钥匙重开。  
**没有**系统级「浏览磁盘选任意文件夹」（浏览器做不到）；真·选夹见可延后的 `TASK-D.1e`。

可选：配置 AI Worker（生成代码改动）

```bash
export OPENAI_API_KEY=sk-...
export STAGENT_MODEL=gpt-4o-mini          # 可选
export STAGENT_EDITOR="cursor {path}"     # 可选，外部编辑器模板
```

---

## 工作流（产品旅程摘要）

```text
打开项目 → 右侧聊需求 →（大事）静态 Demo 试玩 → 确认原型
      → 任务图全灰 → 施工点亮 → 真机试玩 → 合入
      → 不对就右侧质疑；改字号等小事可走 Fast Path（免强制 Demo）
```

工程约束（Schema 与运行时双重强制）：

- 生命周期 9 态：`DRAFT → PENDING_APPROVAL → PREPARING → EXECUTING → VERIFYING → AUDITED → MERGED`，异常分支 `PENDING_RESUME` / `ABORTED`；
- Evidence 结论 4 态：`PASSED / FAILED / BLOCKED / STALE`，`can_merge` 为派生字段，非 PASSED 必为 false；
- Fast Path / 质疑自查 / Demo 独立 Origin / 真机预览等见架构规范 v1.6.1 与任务规范 v1.6.2。

---

## 安全边界（务必阅读）

Stagent 的本地子进程与路径白名单**不是对抗性沙箱**，定位是「防误操作与失控成本」，而非防御恶意仓库：

| 边界            | 已实现                                                                     | 局限                                                              |
| --------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 网络            | 仅绑定 `127.0.0.1`；WS 握手需 AUTH；Origin 校验                            | Token 经 URL `#token=` fragment 注入；勿把带 Token 的链接发到公开场合 |
| 文件            | Worktree 内 realpath 校验；`strictly_forbidden_paths` 优先；1 MiB 读取上限 | 不防御内核级/提权攻击；不构成恶意代码隔离                         |
| 命令            | 结构化 argv、`shell:false`、白名单、双超时、SIGTERM→3s→SIGKILL             | 允许的验证命令本身仍以当前用户权限运行                            |
| 环境            | 敏感变量剥离；`env_file_grants` 受控注入                                   | 不保证覆盖所有第三方工具的隐式读取                                |
| 网络策略 `DENY` | 注入代理黑洞与离线变量                                                     | 尽力约束，非内核级网络隔离                                        |
| 凭据            | API Key 仅存在于 Daemon 进程环境；日志先脱敏后截断                         | 无法防止用户在合同中显式写入秘密                                  |
| Demo 隔离       | 独立 Origin（如 4100~4110）+ iframe `sandbox="allow-scripts"`（禁 same-origin） | 控制台可与 Daemon 同源托管；**Demo 绝不能**因此改成同源           |

**平台矩阵**：macOS（已实测）· Linux / Windows（CI 矩阵已配置，尚未完成真机验证）。  
高风险仓库（含生产凭据、不可信构建脚本）建议在容器/虚拟机中运行。

---

## 仓库结构

```text
bin/                  CLI 入口（stagent open / start / status）
daemon/
  core/               PID 锁、端口扫描、session-token、最近项目
  console/            同源静态托管（D.1b；空白壳修复见 D.1d）
  git/                Worktree 生命周期、分支保护
  mcp/                Scoped 工具网关
  runner/             结构化命令执行、环境脱敏
  guard/              循环熔断、费用硬上限
  recovery/           崩溃恢复与孤儿清理
  pipeline/           合同存储、编排、合并
  worker/             受控 AI Worker 适配
src/
  lib/                Schema、Daemon API、IPC
  components/         工作台 / Studio / Diff / 编辑器等
  routes/             控制台路由（TanStack Start）
tests/                unit / components / integration / e2e
docs/                 架构规范 v1.6.1、任务规范 v1.6.2、reports/
```

---

## 质量门禁

```bash
node scripts/verify-env.mjs     # 环境 + typecheck + lint + test（一键）
npm test                        # 仅测试
npm run build                   # 前端与装配 dist/
```

测试数量随合入变化：以最近一次四件套实跑为准（D.1c 合入后约为 **1204 passed / 6 skipped**）。README 不再写死过期「154 项」口径。

---

## v0.1 已知限制

1. **同源单窗口控制台空白（`TASK-D.1d`）**：`stagent open` 打开的 Daemon 端口页可能白屏；请用上文 Vite + `#token=` / `#base=` 绕路。
2. **无系统「选任意文件夹」**：浏览器做不到；最近列表可用（D.1c）；真·选夹见可延后的 `TASK-D.1e`。
3. **AI Worker / 真施工**：完整改码依赖可用模型 Key 与适配器；`TASK-W.5b` / `W.5c` 等仍按任务规范推进。
4. **架构雷达 1000 节点 60 FPS 未实测**（v0.2+）。
5. **单任务串行**：Daemon 当前并行度按 v0.1 约定为 1。
6. **跨平台**：仅 macOS 为主实测面；Linux/Windows 待加强真机验证。
7. **账单精度**：默认 `ESTIMATED`，`UNAVAILABLE` 时只作上限约束。

按规范 §10，上述关键体验与安全叙述未闭环前，**不得**把 v0.1 表述为「已验证的生产安全成品」。打开项目生产级目标以文档与 D.1d/D.1e 为准推进。

---

## 文档

- 架构规范：`docs/Stagent_System_Architecture_Specification_v1.6.1.md`
- 任务拆解：`docs/Stagent_v0.1_Development_Tasks_Specification_v1.6.2.md`
- 打开项目愿景/现状：`docs/reports/打开项目-愿景与现状.md`
- 非技术旅程验收：`docs/reports/非技术用户旅程验收稿.md`
- 自举报告：`docs/reports/v0.1-dogfooding-report.md`
- 阶段核对：`docs/reports/phase-checklist-M1.md` … `M8.md`

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

生产级愿景与分层说明见 `docs/specs/development-tasks.md` 中的 `TASK-D.1b`–`D.1d` 卡（原过程稿 `docs/archive/open-project-vision-and-status.md` 已随 archive 目录移除）。  
`TASK-D.1d` 已修复同源空白：先 `npm run build`，再用 `stagent open` 即可单窗口进入工作台（仍走 `#token=`；Demo 仍独立 Origin）。

#### 推荐：一键 open（D.1b + D.1d 同源单窗口）

```bash
# 本仓需有可 hydrate 的 dist/public（含 SPA $_TSR 壳）
npm run build
npx tsx bin/stagent.ts open /path/to/your-project
# 或：npm run stagent -- open /path/to/your-project
```

行为摘要：

- 启动或复用该工作区 Daemon；成功则写入本机「最近项目」列表（`TASK-D.1c`）。
- 有可 hydrate 的 `dist/public` 时：只开一个浏览器窗口，URL 带 `#token=`，渲染完整三栏工作台。
- 无可用同源壳时：open 回退 Vite 并注入 `#base=`（以 CLI 实际输出为准）。

#### 可选：开发态双端（Vite HMR）

```bash
# 终端 A：在本仓启动指向业务目录的 Daemon（端口常为 3001~3010）
npx tsx bin/stagent.ts start --repo /path/to/your-project

# 终端 B：本仓起控制台（Vite，默认 http://127.0.0.1:5173 或 8080，以实际打印为准）
npm run dev
```

浏览器打开控制台地址，并带上钥匙（Daemon 启动日志/状态里取 Token；**不要**把 Token 发到公开聊天）：

- 同机示例：`http://127.0.0.1:5173/#token=<TOKEN>&base=http://127.0.0.1:<DAEMON_PORT>`
- `#base=` 在控制台端口与 Daemon 端口不同时**必需**，否则前端会连错端口。

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

**平台矩阵**：macOS（已实测）· Linux / Windows（ CI 矩阵已配置，尚未完成真机验证）。  
高风险仓库（含生产凭据、不可信构建脚本）建议在容器/虚拟机中运行。

---

## 仓库结构

```text
bin/                  CLI 入口（stagent open / start / status）
daemon/
  core/               PID 锁、端口扫描、session-token、最近项目
  console/            同源静态托管（D.1b + D.1d 可 hydrate SPA 壳）
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
docs/                 specs/（规范四件套）· adr/ · rfc/ · reports/ · backlog/ · templates/
```

---

## 质量门禁

```bash
node scripts/verify-env.mjs     # 环境 + typecheck + lint + test（一键）
npm run test:mainline           # H.7 主链路回归（打开→归档 + 质疑/返工/porcelain）
npm test                        # 全量 Vitest
npm run build                   # 前端与装配 dist/
```

发布口径（2026-10-26 硬化收官）：`npm run test:mainline` **14 passed**；全量 `npm test` **1438 passed / 6 skipped**。Tag **`v0.1.0`**。详见 `docs/reports/v0.1-hardening-closure.md`。

---

## v0.1 已知限制

1. **无系统「选任意文件夹」**：浏览器做不到；最近列表可用（D.1c）；真·选夹见正式推迟的 `TASK-D.1e`（v0.2+ / P5.8）。
3. **AI Worker / 真施工**：完整改码依赖可用模型 Key 与内建适配器；`TASK-W.5b` / `W.5c` **封印至 v0.2+**（硬化收官不立卡）。
4. **架构雷达 1000 节点 60 FPS 未实测**（v0.2+）。
5. **单任务串行**：Daemon 当前并行度按 v0.1 约定为 1。
6. **跨平台**：仅 macOS 为主实测面；Linux/Windows 待加强真机验证。
7. **账单精度**：默认 `ESTIMATED`，`UNAVAILABLE` 时只作上限约束。

按规范 §10，上述关键体验与安全叙述未闭环前，**不得**把 v0.1 表述为「已验证的生产安全成品」。打开项目进门路径以 D.1d 同源单窗口为准；真·选夹见 D.1e（v0.2+）。**v0.1 周期以 Tag `v0.1.0` 收官**（主路径 + 硬化），不是「全功能 / 87 卡全绿」。

---

## 文档

**全局地图见 [`docs/README.md`](docs/README.md)。**（2026-10-27 文档治理重组：文件名已去除版本号与日期后缀，改为英文 kebab-case；版本流转交由 Git Tag 与 commit 历史承载。）

现行规范四件套：

- 架构宪法：[`docs/specs/system-architecture.md`](docs/specs/system-architecture.md)（定稿基线 v1.6.1）
- 任务拆解：[`docs/specs/development-tasks.md`](docs/specs/development-tasks.md)（定稿基线 v1.6.2）
- Supervisor SSOT：[`docs/specs/supervisor.md`](docs/specs/supervisor.md)（v2.0 正文 + v2.0.2 裁定层合流）
- 运行时硬契约：[`docs/specs/runtime-contract-and-safety.md`](docs/specs/runtime-contract-and-safety.md)

历史签收与封版：

- **v0.1 主路径里程碑**：[`docs/reports/v0.1-mainline-milestone.md`](docs/reports/v0.1-mainline-milestone.md)
- **v0.1 硬化收官**：[`docs/reports/v0.1-hardening-closure.md`](docs/reports/v0.1-hardening-closure.md)（Tag `v0.1.0`）
- **Spec Freeze 封版记录**：[`docs/reports/spec-freeze-record.md`](docs/reports/spec-freeze-record.md)

架构决策记录：[`docs/adr/`](docs/adr/)（ADR-0001～0013）。

> **已删除文档的说明（2026-10-27 更正）**：本 README 早期版本曾指向 `docs/reports/v0.1-dogfooding-report.md` 与 `docs/reports/phase-checklist-M1.md` … `M8.md`。这两类文件已于 **2026-10-25 `docs/reports/` 目录精简时删除**，当前仓库中不存在。自举（Dogfooding）结论以 [`docs/specs/development-tasks.md`](docs/specs/development-tasks.md) 中 `TASK-E.2` 卡与 git 历史为准；阶段核对以任务规范 §4 Sprint 门禁为准。

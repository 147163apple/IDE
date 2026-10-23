# Stagent v0.1

> 面向独立开发者与外包工程师的**本地任务副驾与验收控制台**。
> 把一次 AI 代码改动变成一份可审批、可执行、可验证、可追溯、可回滚的「任务合同」。

Stagent 不是代码编辑器，也不是通用 Agent 平台。它在本地启动一个 Daemon（仅监听 `127.0.0.1`），
用合同约束改动范围，在独立的 Git Worktree 中执行，用真实命令产出 Evidence，最后由人核准合并。

---

## 快速开始

环境要求：**Node.js ≥ 20**、**Git ≥ 2.30**（macOS / Linux / Windows）。

```bash
git clone <repo> && cd <repo>
npm ci
npm run build                      # 产出 dist/public，供一键打开同源托管
node scripts/verify-env.mjs        # 环境门槛 + typecheck + lint + 单测

# 推荐：一条命令打开项目（TASK-D.1b）
# - 自动启动/复用 Daemon（仅 127.0.0.1，端口 3001~3010）
# - 有 dist/public 时同源托管控制台，浏览器单窗口已连上（Token 经 #fragment，不手拷）
npx tsx bin/stagent.ts open /path/to/your-project

# 等价简写（本仓库已配 bin）：
#   npm run stagent -- open /path/to/your-project

# 开发态（可选）：无 dist/public 时 open 会回退 Vite；也可手动分两端：
#   npx tsx bin/stagent.ts start --repo /path/to/your-project
#   npm run dev
```

可选：配置 AI Worker（生成代码改动）

```bash
export OPENAI_API_KEY=sk-...
export STAGENT_MODEL=gpt-4o-mini          # 可选
export STAGENT_EDITOR="cursor {path}"     # 可选，外部编辑器模板
```

---

## 工作流

```text
意图/合同草案 → 人工审批 → 创建 Worktree（task/{contract_id}）
      → AI Worker 受限改码 → 真实验证命令 → Evidence Bundle
      → 人工核销 → git merge --squash + Git Trailer → 清理 Worktree
```

关键约束（由 Schema 与运行时双重强制）：

- 生命周期 9 态：`DRAFT → PENDING_APPROVAL → PREPARING → EXECUTING → VERIFYING → AUDITED → MERGED`，异常分支 `PENDING_RESUME` / `ABORTED`；
- Evidence 结论 4 态：`PASSED / FAILED / BLOCKED / STALE`，`can_merge` 为派生字段，非 PASSED 必为 false；
- 9 个原因码闭环（`SCOPE_VIOLATION` … `WORKTREE_LOST`），错误码对齐 §9.3；
- 连续验证失败 / 费用超限 → `PENDING_RESUME + BLOCKED`，必须重新审批或提高预算后恢复；
- 外部修改已验收的 Worktree → Evidence 立即 `STALE`，禁止合并。

---

## 安全边界（务必阅读）

Stagent 的本地子进程与路径白名单**不是对抗性沙箱**，定位是「防误操作与失控成本」，而非防御恶意仓库：

| 边界            | 已实现                                                                     | 局限                                                              |
| --------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 网络            | 仅绑定 `127.0.0.1`；WS 握手需 Bearer Token；Origin 校验                    | Token 仅经 URL `#token=` fragment 注入；WS 首帧 AUTH（浏览器无法设 Authorization 头） |
| 文件            | Worktree 内 realpath 校验；`strictly_forbidden_paths` 优先；1 MiB 读取上限 | 不防御内核级/提权攻击；不构成恶意代码隔离                         |
| 命令            | 结构化 argv、`shell:false`、白名单、双超时、SIGTERM→3s→SIGKILL             | 允许的验证命令本身仍以当前用户权限运行                            |
| 环境            | 敏感变量剥离；`env_file_grants` 受控注入                                   | 不保证覆盖所有第三方工具的隐式读取                                |
| 网络策略 `DENY` | 注入代理黑洞与离线变量                                                     | 尽力约束，非内核级网络隔离                                        |
| 凭据            | API Key 仅存在于 Daemon 进程环境；日志先脱敏后截断                         | 无法防止用户在合同中显式写入秘密                                  |

**平台矩阵**：macOS（已实测）· Linux / Windows（CI 矩阵已配置，尚未完成真机验证）。
高风险仓库（含生产凭据、不可信构建脚本）建议在容器/虚拟机中运行。

---

## 仓库结构

```text
bin/                  CLI 入口（stagent open / start / status）
daemon/
  core/               PID 锁、端口扫描、session-token
  git/                Worktree 生命周期、分支保护
  mcp/                Scoped 工具网关（read/write/exec/list/declare_complete）
  runner/             结构化命令执行、环境脱敏
  guard/              循环熔断、费用硬上限、状态持久化
  recovery/           崩溃恢复与孤儿清理
  arch/               AST 依赖图（Tarjan / 拓扑 / tsconfig paths）
  watcher/            chokidar 监听 + Evidence STALE 联动
  pipeline/           合同存储、编排器、Squash-Merge
  worker/             受控 AI Worker（成本预检 + 整批 Scope 校验）
  editor/             外部编辑器安全调起
src/
  lib/                合同/证据 Schema、Daemon API 客户端、IPC 帧与客户端
  components/         contract / radar / diff / editor / evidence 组件
  routes/             验收控制台
tests/                daemon / lib / components / integration / e2e
docs/reports/         审计报告与各阶段核对清单
```

---

## 质量门禁

```bash
node scripts/verify-env.mjs     # 环境 + typecheck + lint + test（一键）
npm test                        # 仅单测/组件/集成/E2E
npm run build                   # 前端与 Nitro 构建
```

当前基线：typecheck 0 error、lint 0 error、**154 项测试全通过**、构建成功。

---

## v0.1 已知限制

1. **AI Worker 未经真实模型端到端验证**（环境缺少 API Key 时仅能跑验证命令）；
2. **架构雷达 1000 节点 60 FPS 未实测**，已完成大图降级（>600 节点 grid 布局）与动画关闭；
3. **未在第三方真实项目试用**，自举演练基于本仓库副本（见 `docs/reports/v0.1-dogfooding-report.md`）；
4. **单任务串行**：Daemon 当前仅维护一个活跃 Worktree 监听器；
5. **跨平台**：仅 macOS 实测，Linux/Windows 待 CI 实跑；
6. **账单精度**：默认 `ESTIMATED`，`UNAVAILABLE` 时只作上限约束。

按规范 §10.1，上述限制未闭环前，v0.1 **不得**表述为「已验证的生产安全产品」。

---

## 文档

- 规范基线：`docs/Stagent_System_Architecture_Specification_v1.1.3 .md`
- 任务拆解：`docs/Stagent_v0.1_Development_Tasks_Specification .md`
- 合规审计：`docs/reports/spec-compliance-audit-v1.1.3.md`
- 阶段核对：`docs/reports/phase-checklist-M1.md` … `M7.md`
- 自举报告：`docs/reports/v0.1-dogfooding-report.md`

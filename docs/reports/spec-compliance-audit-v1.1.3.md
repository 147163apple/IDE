# Stagent 仓库 × 规范 v1.1.3 核对报告

> 核对日期：2026-10-19 · 仓库：`/Users/tina/Desktop/1020` · 基线：《架构规范 v1.1.3》+《任务拆解规范（终审闭环版）》
> 核对方式：对仓库全部源码与测试做只读取证，逐项比对两份规范的模块划分、任务清单、接口定义、命名与分层约定。

---

## 0. 总体结论

**仓库当前处于「双轨并存」状态，与规范的单一权威架构存在根本性差距：**

- **规范方向（Track A 部分落地）**：`daemon/` 下已有 Worktree 管理、MCP 网关、命令执行器、熔断器、HTTP Server 等基础设施，但**未接线**（无 CLI 入口、无 IPC、无合并器），仅被 `tests/daemon/` 引用，不构成产品闭环。
- **规范外的浏览器端实现（先行存在）**：`src/routes/index.tsx` + `src/lib/contract.functions.ts` + `src/lib/pipeline.ts` + `localStorage` 持久化构成一套 Lovable 生成的浏览器工作台，由它而非 Daemon 驱动当前产品流程。这与规范 §1「本地 Daemon 是本机文件、Git、命令执行、合同状态与 Evidence 的唯一权威」**直接冲突**，也触碰了 §0.5 的失败判据「浏览器存在可独立改文件的 Playground 路径」。

任务总览：**15 项任务中，已完成 0 项、部分完成 7 项、未开始 8 项**（详见 §3）。

---

## 1. 已符合项清单

| # | 规范要求 | 实现位置 | 说明 |
|---|---|---|---|
| 1 | 严格锁文件（TASK-0.1 部分） | `package-lock.json` | 存在且锁定 |
| 2 | Worktree 生命周期原语（TASK-A.1） | `daemon/git/worktree-manager.ts` | `git worktree add/remove/prune`、分支 `task/{contractId}`、`assertSafeContractId` 防路径逃逸、`ensureStagentExcluded()` 注册 `.git/info/exclude`、脏工作区检测（`git status --porcelain`）均已实现 |
| 3 | 分支保护（TASK-A.1） | `daemon/git/branch-guard.ts` | `PROTECTED_BRANCHES`（main/master/prod/production/release/staging）+ `task/` 前缀命名校验 |
| 4 | 路径防穿透（TASK-A.2 部分） | `daemon/mcp/path-resolver.ts` | `resolveSafeWorktreePath` 经 `realpathSync` 做符号链接边界校验；`src/lib/scope.ts` 实现 forbidden > writable > readonly 优先级 |
| 5 | 写入预算拦截（TASK-A.2 部分） | `daemon/mcp/gateway.ts` | `stagent_write_file` 校验 `max_file_modifications`，超限抛 `BUDGET_EXCEEDED` |
| 6 | 依赖符号链接复用与缓存隔离（TASK-A.3 部分） | `daemon/deps/resolver.ts`、`daemon/deps/cache-isolator.ts` | symlink/junction 零拷贝复用；`.vite/.turbo/.cache` 等重定向至 Worktree |
| 7 | 结构化命令执行（TASK-A.4 部分） | `daemon/runner/command-runner.ts` | `shell:false` + 参数数组、注入字符（`;`、`|`、`&&`、反引号等）拒绝、超时退出码 124、输出 100k 截断 |
| 8 | 环境变量脱敏（TASK-A.4 部分） | `daemon/runner/env-filter.ts` | 按前缀/关键词剔除敏感凭据（AWS_/GITHUB_/OPENAI_/ANTHROPIC_/SECRET/KEY/TOKEN 等），注入 `CI=true`、`NODE_ENV=test`、`TERM=dumb`，实现强度达到规范要求 |
| 9 | 连续失败熔断计数（TASK-A.5 部分） | `daemon/guard/loop-guard.ts` | 默认 3 次重试上限，达限 trip |
| 10 | 费用预检接口（TASK-A.5 部分） | `daemon/guard/cost-monitor.ts` | `assertCanConsume` 预检 + `recordUsage` 累计 |
| 11 | Loopback 绑定与 PID 锁（TASK-D.1 部分） | `daemon/server.ts`、`daemon/core/pid-lock.ts`、`port-finder.ts` | 默认 `127.0.0.1`、端口扫描、PID 锁含 stale 回收与原子写入 |
| 12 | Evidence verdict 四态 | `src/lib/contract.schema.ts` | `evidenceVerdictStatusSchema = PASSED/FAILED/BLOCKED/STALE`（符合 §9.2） |
| 13 | 对应测试套件 | `tests/daemon/`（11 个文件） | worktree-manager / mcp-gateway / deps-reuse / command-runner / guard / branch-guard / env-filter / path-resolver / pid-lock / port-finder / server 均有单测 |

---

## 2. 缺失（未实现）项清单

| # | 规范要求 | 期望位置 | 现状 |
|---|---|---|---|
| M1 | CI 流水线（TASK-0.1） | `.github/workflows/ci.yml` | **缺失**，无任何 CI 配置 |
| M2 | 跨平台环境检测脚本（TASK-0.1） | `scripts/verify-env.mjs` | **偏差性缺失**：实为 `scripts/verify-env.sh`（bash，非跨平台），且**不校验 Node≥20 / Git≥2.30 版本门槛** |
| M3 | 独立证据 Schema（TASK-0.2） | `src/lib/evidence.schema.ts` | **缺失**，Evidence schema 合并在 `contract.schema.ts` 内 |
| M4 | 第 5 个 MCP 工具（TASK-A.2） | `stagent_declare_complete` | **缺失**，gateway 仅实现 4 个工具 |
| M5 | 写保护前置探测（TASK-A.3） | `daemon/deps/write-protection-probe.ts` | **缺失**——ADR-002「不能证明写保护时禁用共享 node_modules」无实现支撑 |
| M6 | 崩溃恢复自愈引擎（TASK-A.6） | `daemon/recovery/crash-recovery.ts` | **整个 `daemon/recovery/` 缺失**；全库无 `PENDING_RESUME`/`WORKTREE_LOST` 逻辑 |
| M7 | AST 依赖图引擎（TASK-B.1） | `daemon/arch/parser.ts`、`daemon/arch/graph.ts` | **Daemon 端缺失**。仅有浏览器端 `src/lib/arch-map.ts`（DFS 环检测，非规范的 Tarjan；无 tsconfig paths 别名解析证据） |
| M8 | 文件监听与 Evidence STALE 联动（TASK-B.2） | `daemon/watcher/fs-watcher.ts`、`invalidation-engine.ts` | **缺失**；无 chokidar 依赖，全库无 `EVIDENCE_STALE` 机制 |
| M9 | Track C 规范组件（TASK-C.1/C.2/C.3） | `src/components/contract/`、`radar/`（Cytoscape）、`diff/`、`editor/`、`daemon/editor/launcher.ts` | **全部缺失**。近似物为扁平组件 `ContractActionCard.tsx`、`AmbientArchMap.tsx`（自绘图形，**无 cytoscape 依赖**）；无独立 DiffViewer、无外部编辑器调起 |
| M10 | CLI 入口（TASK-D.1） | `bin/stagent.ts` | **缺失**（无 bin 目录、package.json 无 `bin` 字段） |
| M11 | WebSocket 通信桥（TASK-D.1） | `daemon/server.ts`（WS）、`src/lib/ipc/client.ts` | **缺失**：server 为纯 HTTP（仅 `/health`、`/api/status`、`/api/shutdown`）；**无 session-token（0600）、无 Bearer 握手鉴权、无 Origin 校验、无 ws 依赖、无 PING/PONG 心跳、无 7 类消息帧** |
| M12 | 合并核销器（TASK-D.2） | `daemon/pipeline/merger.ts`、`src/components/evidence/EvidenceChecklist.tsx` | **缺失**：无 `git merge --squash`、无 `Stagent-Contract-ID/Stagent-Evidence-ID/Stagent-Verdict/Reviewed-By` Git Trailer（全库 0 命中）、无存证持久化 |
| M13 | E2E 与集成测试（TASK-E.1） | `tests/e2e/*.spec.ts`、`tests/integration/ipc-stream.test.ts` | **全部缺失**（无 e2e/integration 目录、无 Playwright 依赖） |
| M14 | Dogfooding 报告与发布包（TASK-E.2） | `docs/reports/v0.1-dogfooding-report.md`、`dist/` | **缺失** |
| M15 | README 安全边界声明（TASK-E.2 + ADR-003） | `README.md` | **缺失**——README 仍为 Lovable 模板原文，无威胁模型/平台矩阵/安全限制声明 |
| M16 | 组件测试（TASK-C.x） | `tests/components/{ContractCard,RadarGraph,DiffViewer}.test.tsx` | **缺失** |

---

## 3. 任务完成状态分类

| 任务 | 状态 | 关键差距 |
|---|---|---|
| TASK-0.1 工程基线 | **部分完成** | lockfile 有；CI、verify-env.mjs（跨平台+版本门槛）缺失 |
| TASK-0.2 合同/证据 Schema | **部分完成** | 文件存在但生命周期 8 态≠9 态、approval 3 态≠4 态、无 reason_code 枚举、单币种 USD、无双状态机联动校验、无独立 evidence.schema.ts |
| TASK-A.1 Worktree 隔离 | **部分完成**（接近完成） | 核心原语齐全；脏工作区仅检测未强制提示用户确认 |
| TASK-A.2 MCP 网关 | **部分完成** | 缺 `stagent_declare_complete`；`stagent_read_file` 无 1MiB 上限与二进制保护 |
| TASK-A.3 依赖复用 | **部分完成** | 缺 write-protection-probe，降级策略不可判定 |
| TASK-A.4 命令执行器 | **部分完成** | 宽限期 1s≠规范 3s；无输出脱敏（仅截断）；无网络策略实施证据 |
| TASK-A.5 双熔断 | **部分完成** | 计数器/预检存在，但与合同状态机零联动（无 PENDING_RESUME 迁移、无 BLOCKED Evidence、无持久化防重置）；错误码 `COST_CAP_EXCEEDED`/`MAX_VERIFICATION_RETRIES_EXCEEDED` 与规范 `E_BUDGET_EXCEEDED`/`E_RETRY_LIMIT_EXCEEDED` 不一致 |
| TASK-A.6 崩溃恢复 | **未开始** | 整体缺失 |
| TASK-B.1 AST 依赖图 | **未开始**（Daemon 端） | 仅有规范位置不符的浏览器端近似实现 |
| TASK-B.2 文件监听 | **未开始** | 整体缺失 |
| TASK-C.1 合同审批卡 | **未开始**（规范口径） | 存在规范外近似组件（ContractActionCard），无 ScopeList/BudgetVisualizer 拆分 |
| TASK-C.2 架构雷达 | **未开始**（规范口径） | AmbientArchMap 非 Cytoscape、无 Scope 圈选/折叠/搜索规范交互 |
| TASK-C.3 Diff + 编辑器调起 | **未开始** | 无独立组件与 launcher |
| TASK-D.1 CLI + IPC/WS | **未开始** | 仅 HTTP server 雏形，CLI/Token/WS/心跳全缺 |
| TASK-D.2 Evidence 核销合并 | **未开始** | 整体缺失 |
| TASK-E.1 E2E | **未开始** | — |
| TASK-E.2 Dogfooding | **未开始** | — |

---

## 4. 偏差项清单（已实现但与规范不一致）

| # | 偏差 | 位置 | 规范要求 vs 实际 |
|---|---|---|---|
| D1 | **架构权威错位（根本偏差）** | `src/routes/index.tsx`、`src/lib/contract.functions.ts`、`pipeline.ts`、`history.ts`、`agent-session.ts` | 规范 §1：Daemon 是唯一权威，浏览器不维护虚拟仓库。实际：产品流程由浏览器 localStorage + TanStack server function 驱动，文件存 localStorage，pipeline 在浏览器内存 staged copy 上评估——触碰 §0.5 失败判据「浏览器存在可独立改文件/伪造命令结果的 Playground 路径」 |
| D2 | 生命周期状态机 8 态≠9 态 | `src/lib/contract.schema.ts` | 规范 §9.1：`DRAFT/PENDING_APPROVAL/PREPARING/EXECUTING/VERIFYING/PENDING_RESUME/AUDITED/MERGED/ABORTED`。实际：`DRAFT/APPROVED/EXECUTING/VERIFYING/AWAITING_APPROVAL/MERGED/FAILED/BLOCKED`——`AWAITING_APPROVAL/FAILED/BLOCKED` 为自创态，`FAILED/BLOCKED` 本属 Evidence verdict 被混入合同生命周期（规范 FAIL 判据明令禁止） |
| D3 | reason_code 枚举缺失 | 全库 | 规范 §9.2 九个原因码（SCOPE_VIOLATION…WORKTREE_LOST）在代码中无任何枚举定义 |
| D4 | approval 状态机不完整 | `src/lib/contract.schema.ts` | 规范：4 态 + §9.1.1 联动规则（PENDING_APPROVAL↔PENDING_REVIEW 等非法组合须拒绝）。实际：3 态（DRAFT/APPROVED/REJECTED），无联动校验 |
| D5 | 费用模型单币种 | `costCapSchema` | 规范：`max_cost_minor_units + currency + pricing_version + accounting_mode(PROVIDER_REPORTED/ESTIMATED/UNAVAILABLE)`。实际：仅 `max_cost_usd`，无多币种与账单模式 |
| D6 | `can_merge` 不变式未落于 Schema | `contract.schema.ts`、`git-guard.ts` | 规范：`can_merge` 为纯派生字段，`status!==PASSED` 时必须为 false 且 Schema 级强制。实际：Schema 中只是普通 `z.boolean()`，派生逻辑在 `verifyScopeGate` 且判据不同（scope+tests+lint，未含 STALE/快照/预算门禁） |
| D7 | 双轨 MCP 网关并存 | `src/lib/mcp/gateway.ts` vs `daemon/mcp/gateway.ts` | 规范要求单一 Scoped MCP Server；实际浏览器内存版与真实文件系统版并存，`daemon/mcp/types.ts` 还 re-export 浏览器版类型，权威边界模糊 |
| D8 | 命令超时宽限期 1s | `daemon/runner/command-runner.ts` | 规范 §6.3：SIGTERM 后宽限 **3s** 再 SIGKILL |
| D9 | 输出无脱敏 | `command-runner.ts` | 规范 §4.3：stdout/stderr 保存展示前须先对已知秘密值遮蔽再截断。实际仅截断，`secret_redacted` 语义未实现 |
| D10 | 熔断器无持久化 | `daemon/guard/*.ts` | 规范 §4.2.1/§4.2.2：重启 Daemon、切换模型不得重置计数与累计费用。实际全部状态在内存，重启即归零（规范 FAIL 判据） |
| D11 | 错误码未对齐 §9.3 | `guard/cost-monitor.ts`、`loop-guard.ts` | 实际 `COST_CAP_EXCEEDED`、`MAX_VERIFICATION_RETRIES_EXCEEDED`；规范：`E_BUDGET_EXCEEDED`、`E_RETRY_LIMIT_EXCEEDED`。gateway 内另有字符串 `"BUDGET_EXCEEDED"`（reason_code 与 error_code 混用） |
| D12 | 测试文件位置不符 | `src/lib/contract.schema.test.ts` 等 | 规范：`tests/lib/`、`tests/components/`。实际测试散落于 `src/lib/` 与源文件同目录 |
| D13 | 命名与分层不符（Track C） | `src/components/*.tsx` 扁平结构 | 规范：`components/contract|radar|diff|editor/` 子目录与指定组件名 |
| D14 | 遗留 legacy schema | `src/lib/contract.functions.ts` | 存在一套旧版中文合同 schema（`kind/summary/risk/allowedFiles`），违反红线一「Schema 即宪法、严禁未经校验的私有字段」 |

---

## 5. 整改建议（按优先级）

### 高优先级（阻塞产品闭环与安全基线）

1. **消解双轨架构，确立 Daemon 唯一权威（对应 D1、D7、D14）**
   理由：这是规范 §0.5/§1 的根本判据，当前浏览器管线可绕过全部合同门禁，等于整个安全模型失效。建议：将 `src/lib/pipeline.ts`、`contract.functions.ts`、`localStorage` 持久化逐步迁移至 Daemon 侧；删除 legacy schema；`src/lib/mcp/gateway.ts` 与 `daemon/mcp/gateway.ts` 合并为一。此项应先于一切新功能开发。
2. **重建 Schema 宪法（对应 D2–D6，TASK-0.2 返工）**
   理由：9 态状态机、9 个原因码、双状态机联动、多币种、`can_merge` 派生不变式是后续所有 Track 的类型基线；当前枚举错位（FAILED/BLOCKED 混入生命周期）会直接破坏 A.5/A.6/D.2 的状态流转。拆出 `src/lib/evidence.schema.ts`，并让既有测试 `contract.schema.test.ts` 从「自证 8 态」改为「校验 9 态」。
3. **熔断器接入合同状态机并持久化（对应 D10、D11，TASK-A.5 收口）**
   理由：内存计数重启归零是规范明示的 FAIL 判据，且涉及费用安全。统一错误码至 §9.3 目录，计数与累计费用落盘 `.stagent/`。
4. **补齐 `stagent_read_file` 大小/二进制保护与 `stagent_declare_complete`（TASK-A.2 收口）**
   理由：缺大小限制可致内存耗尽（规范 FAIL 判据）；缺第 5 个工具则 Worker 无法声明完成，闭环断裂。
5. **实现合并核销器与 Git Trailer（TASK-D.2）**
   理由：无 merger 则 Evidence→合并的授权闭环不存在，§5.2 审计追溯为零。

### 中优先级（P0 里程碑所需能力）

6. **CLI + WebSocket 通信桥（TASK-D.1）**：补 session-token（0600）、Bearer 握手、Origin 校验、PING/PONG、7 类消息帧；引入 `ws` 依赖。这是 Daemon 与 UI 联通的唯一通道，当前 daemon 是孤岛。
7. **崩溃恢复引擎（TASK-A.6）**：实现 §6.3 异常 4 全部分支（PREPARING 回退、PENDING_RESUME、WORKTREE_LOST、孤儿 prune）。
8. **Track B 落地（B.1/B.2）**：Daemon 端 AST 引擎（Tarjan + tsconfig paths + `import type`）与 chokidar 监听 + Evidence STALE 联动。现有浏览器端 arch-map 可作为算法参考迁往 Daemon。
9. **CI 与跨平台 verify-env.mjs（TASK-0.1 收口）**：补 `.github/workflows/ci.yml`；将 `.sh` 重写为 `.mjs` 并强制 Node≥20/Git≥2.30 门槛。
10. **命令执行器补项（D8、D9）**：宽限期改 3s；输出先脱敏后截断；落实 network_policy=DENY 的断网约束。

### 低优先级（结构对齐与发布物）

11. **Track C 组件按规范重组**：建立 `components/contract|radar|diff|editor/` 分层，雷达迁移至 Cytoscape.js（含折叠/搜索/Scope 圈选），实现 EditorOpener + `daemon/editor/launcher.ts`（参数化模板、Worktree 绝对路径、复制降级）。
12. **TASK-A.3 补 write-protection-probe**：否则 ADR-002 降级判据不可执行。
13. **测试归位与补全**：`src/lib/*.test.ts` 迁往 `tests/lib/`；补 `tests/components/`、`tests/integration/ipc-stream.test.ts`、E2E 三套件。
14. **README 重写**：移除 Lovable 模板原文，补快速上手、非对抗性沙箱声明、平台支持矩阵（TASK-E.2 / ADR-003 的发布必备项）。

---

## 6. 收尾收据

- 核对范围：仓库全部源码、测试、配置、文档（排除 node_modules/.git）
- 仓库修改：**无**（全程只读）
- 任务状态汇总：已完成 0 / 部分完成 7 / 未开始 8（共 15 项，另有 TASK-0.1/0.2 计入部分完成）
- 偏差汇总：已符合 13 项 / 缺失 16 项 / 偏差 14 项

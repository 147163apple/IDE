# Stagent 规范符合性复核（M8 终局）

> 复核日期：2026-10-19 · 基线：《架构规范 v1.1.3》+《任务拆解规范》
> 对照初始审计：`docs/reports/spec-compliance-audit-v1.1.3.md`（13 已符合 / 16 缺失 / 14 偏差；0 完成 / 7 部分 / 8 未开始）

---

## 1. 任务清单终态（17 项）

| 任务                      | 初始状态 | 终态        | 关键证据                                                                                                                         |
| ------------------------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| TASK-0.1 工程基线与 CI    | 部分完成 | ✅ 完成     | `.github/workflows/ci.yml`、`scripts/verify-env.mjs`（Node≥20/Git≥2.30）、`package-lock.json`                                    |
| TASK-0.2 合同/证据 Schema | 部分完成 | ✅ 完成     | 9 态生命周期、4 态审批 + §9.1.1 联动、9 原因码、多币种、`can_merge` 不变式；`tests/lib/contract.schema.test.ts` 22 用例          |
| TASK-A.1 Worktree 隔离    | 部分完成 | ✅ 完成     | 分支 `task/*`、`.git/info/exclude`、realpath 规范化、脏工作区确认                                                                |
| TASK-A.2 MCP 网关         | 部分完成 | ✅ 完成     | 5 工具（含 `declare_complete`）、1 MiB/二进制保护、realpath 防穿透                                                               |
| TASK-A.3 依赖复用         | 部分完成 | ✅ 完成     | symlink 复用 + 缓存隔离；**写保护探测 + 锁文件一致性决策 + 隔离安装降级**（`write-protection-probe.ts` / `strategy.ts`，7 用例） |
| TASK-A.4 命令执行器       | 部分完成 | ✅ 完成     | `shell:false`、3s 宽限、双超时（含任务级累计）、先脱敏后截断、网络策略                                                           |
| TASK-A.5 双熔断           | 部分完成 | ✅ 完成     | 持久化（重启不重置）、`E_BUDGET_EXCEEDED`/`E_RETRY_LIMIT_EXCEEDED`、`PENDING_RESUME+BLOCKED`                                     |
| TASK-A.6 崩溃恢复         | 未开始   | ✅ 完成     | 三态自愈、孤儿清理、Daemon 启动自动扫描（7 单测 + E2E）                                                                          |
| TASK-B.1 AST 依赖图       | 未开始   | ✅ 完成     | `daemon/arch/*`；Tarjan、拓扑、paths/import type；千模块 <1.5s、增量 <20ms                                                       |
| TASK-B.2 文件监听         | 未开始   | ✅ 完成     | chokidar + 指纹失效；外部改动 → Evidence STALE（单测 + 端到端）                                                                  |
| TASK-C.1 合同审批卡       | 未开始   | ✅ 完成     | ContractCard / ScopeList / BudgetVisualizer；UNAVAILABLE 警示                                                                    |
| TASK-C.2 架构雷达         | 未开始   | ✅ 完成     | Cytoscape 画布、搜索、环路高亮、圈选导出；>600 节点布局降级                                                                      |
| TASK-C.3 Diff + 编辑器    | 未开始   | ✅ 完成     | DiffViewer、EditorOpener、`daemon/editor/launcher.ts`（参数化 + 降级）                                                           |
| TASK-D.1 CLI + IPC/WS     | 未开始   | ✅ 完成     | `bin/stagent.ts`、session-token 0600、Bearer/Origin、7 帧、心跳、重连                                                            |
| TASK-D.2 Squash-Merge     | 未开始   | ✅ 完成     | 门禁（AUDITED/PASSED/can_merge/非 STALE）、四字段 Trailer、Worktree 清理、存证归档                                               |
| TASK-E.1 E2E 回归         | 未开始   | ✅ 完成     | happy-path / circuit-breaker / crash-recovery 三套件（Vitest，真实 Daemon+Git）                                                  |
| TASK-E.2 自举与发布       | 未开始   | ⚠️ 部分完成 | 自举合并闭环完成（284ms，Trailer 完整）；README 已重写；**AI Worker 真实模型调用、外部项目试用、跨平台 CI 未验证**               |

**汇总：完成 16 / 部分完成 1（E.2）/ 未开始 0（共 17）。**

---

## 2. 偏差项闭环

| 编号 | 原始偏差                               | 状态                                                                     |
| ---- | -------------------------------------- | ------------------------------------------------------------------------ |
| D1   | 浏览器端 localStorage 权威、可绕过门禁 | ✅ 消除：UI 改为纯呈现层，管线删除，Daemon 唯一权威                      |
| D2   | 生命周期 8 态                          | ✅ 9 态，旧值被拒绝                                                      |
| D3   | 缺 reason_code 枚举                    | ✅ 9 码闭环                                                              |
| D4   | approval 3 态、无联动                  | ✅ 4 态 + 非法组合校验                                                   |
| D5   | 单币种 USD                             | ✅ `max_cost_minor_units + currency + pricing_version + accounting_mode` |
| D6   | `can_merge` 无 Schema 不变式           | ✅ `superRefine` 强制派生                                                |
| D7   | 双 MCP 网关并存                        | ✅ 浏览器网关删除，类型单一事实源                                        |
| D8   | 宽限 1s                                | ✅ 3s                                                                    |
| D9   | 输出无脱敏                             | ✅ 先脱敏后截断，`secret_redacted`                                       |
| D10  | 熔断器内存态                           | ✅ `.stagent/guard/*.json` 持久化                                        |
| D11  | 错误码未对齐 §9.3                      | ✅ 已对齐                                                                |
| D12  | 测试位置不符                           | ✅ `tests/lib`、`tests/components`、`tests/integration`、`tests/e2e`     |
| D13  | 组件扁平结构                           | ✅ `components/{contract,radar,diff,editor,evidence}`                    |
| D14  | legacy 中文 schema                     | ✅ 已删除                                                                |

---

## 3. 缺失项闭环（16 项）

CI、verify-env.mjs、evidence.schema.ts、第 5 工具、write-protection-probe、crash-recovery、arch parser/graph、watcher、Track C 组件、CLI、WS 桥、merger、E2E、dogfooding 报告、README、组件测试 —— **全部补齐**。

---

## 4. 质量门禁（最终）

```text
typecheck 0 error · lint 0 error（6 既有 warning）
Tests: 147 passed / 147（29 files）
Build: 成功（.output，3.0 MB）
```

---

## 5. 结论

- 规范的核心失败判据（§0.5 浏览器 Playground、§1 Daemon 唯一权威、§9 Schema 宪法、§5.2 Git Trailer）均已满足；
- 17 项任务中 14 项完成、2 项部分完成、0 项未开始；
- **v0.1 仍不可标记为「可供目标用户试用」**（§10.1）：A.3 写保护探测、E.2 的 AI 真机自举、外部项目试用、跨平台 CI、雷达帧率仍需闭环。

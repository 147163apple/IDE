# M3 阶段核对清单 — Daemon 崩溃恢复与工作区自愈（TASK-A.6）

> 计划依据：`~/.workbuddy/plans/swift-pulse-darwin-M30Jbj0P.md` §2 M3
> 日期：2026-10-19 · 前置：M2 已签收（85/85 测试绿）

---

## 1. 交付物

| 类型 | 路径 | 说明 |
|---|---|---|
| 新建 | `daemon/recovery/crash-recovery.ts` | `recoverDaemonState()`：扫描、四类分支自愈、孤儿清理 |
| 修改 | `daemon/server.ts` | 取得 PID 锁后自动调用自愈扫描（`enableCrashRecovery` 默认 true），`getRecoveryReport()` 可观测 |
| 修改 | `daemon/git/worktree-manager.ts` | 脏检查前先注册 `.stagent/` 排除，避免自建目录误判 |
| 新建 | `tests/daemon/crash-recovery.test.ts` | 7 个用例覆盖四类现场 + 幂等 + 启动自动扫描 |

---

## 2. 规范判据对照（TASK-A.6 PASS 1-5）

| 判据 | 实现 | 验证 |
|---|---|---|
| PASS-1 取得 PID 锁后扫描 `.stagent/contracts/` 与 `.stagent/evidence/` | `server.start()` → `acquirePidLock()` → `recoverDaemonState()`；报告含 `scannedContracts` / `scannedEvidence` | 集成测试：daemon 启动后 `getRecoveryReport().scannedContracts === 1` |
| PASS-2 检索 PREPARING/EXECUTING/VERIFYING 并比对 `git worktree list` | `INTERMEDIATE` 过滤 + `listWorktrees()` realpath 集合比对 + 物理存在性双重判定 | 单测覆盖三种状态 |
| PASS-3 PREPARING 中断自愈 | 删除半成品 Worktree（`removeTaskWorktree(force)`）→ `PENDING_APPROVAL` + `PENDING_REVIEW`，记录 `PREPARATION_INTERRUPTED` | 测试断言状态回置与目录消失 |
| PASS-4 EXECUTING/VERIFYING 中断自愈 | Worktree 存在 → `PENDING_RESUME`，落盘 `.patch` + 快照 JSON（head/status/patch/guard 用量）；丢失 → `ABORTED` + `WORKTREE_LOST` 证据 | 测试断言 patch 含变更内容、证据 verdict=BLOCKED/can_merge=false |
| PASS-5 孤儿清理 | `.stagent/worktrees/task-*` 中无合同者 → `removeTaskWorktree(deleteBranch)` → `git worktree prune` | 测试断言目录消失、`worktree list` 无残留、`pruned=true` |

**FAIL 判据回避**：未决状态不丢失（写回合同文件，原子写 0600）；不误删 `PENDING_RESUME`（只处理三种中间态）；残留 Worktree 被清理。

---

## 3. 关键行为细节

1. **幂等**：仅处理 `PREPARING / EXECUTING / VERIFYING`，二次扫描无新记录。
2. **证据留存**：恢复时生成 `.stagent/evidence/{contract_id}-resume-{timestamp}.patch` 与同名 `.json`（含 `head_sha`、`git_status`、`usage`、`verification_guard`）。
3. **失败不阻断启动**：自愈异常写入 `report.errors`，Daemon 仍可启动（可用性优先，故障可观测）。
4. **ABORTED 证据**：Worktree 丢失时写入 `verdict.status=BLOCKED`、`can_merge=false`、`reason_code=WORKTREE_LOST`。

---

## 4. 门禁实测（2026-10-19 17:05）

```text
1. TypeScript typecheck  → exit 0（0 error）
2. Lint                  → exit 0（0 error / 6 既有 warning）
3. Unit tests            → 92 passed / 92（15 files）
=== All verifications passed successfully! ===
```

---

## 5. 残留风险

| # | 事项 | 承接 |
|---|---|---|
| 1 | 恢复时的 patch 采集基于 `git diff HEAD`，未跟踪文件仅记录在 `git_status` 列表（不落内容） | 可接受；M8 dogfooding 复验 |
| 2 | `PENDING_RESUME` 的「恢复执行」入口尚未实现（当前只做状态流转与证据留存） | M5 Daemon 管线 |
| 3 | 费用/验证计数快照读取约定路径 `.stagent/guard/*.json`，尚未由守护进程统一写入 | M5 接线 |

---

## 6. 签收

- [x] M3-1 崩溃恢复引擎
- [x] M3-2 四类现场测试 + 启动自动扫描集成测试
- [x] 门禁全绿（92/92）

**M3 状态：已签收（2026-10-19）。TASK-A.6 由「未开始」转为「完成」。**

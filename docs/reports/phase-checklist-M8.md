# M8 阶段核对清单 — 核销闭环与发布【已签收（含遗留）】

> 计划依据：`~/.workbuddy/plans/swift-pulse-darwin-M30Jbj0P.md` §2 M8
> 日期：2026-10-19 · 前置：M7 已签收（138/138）

---

## 1. 交付物

| 类型 | 路径                                                                              | 说明                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新建 | `daemon/pipeline/merger.ts`                                                       | 门禁校验（AUDITED / PASSED / can_merge / 非 STALE / 证据快照存在）；`git merge --squash`；四字段 Trailer 提交；Worktree + 分支清理；合同转 `MERGED` |
| 新建 | `src/components/evidence/EvidenceChecklist.tsx`                                   | 终审清单：Scope 审计、Git 指纹、验证退出码、合并按钮（仅可合并时启用）                                                                              |
| 修改 | `daemon/server.ts`                                                                | `POST /api/contracts/:id/merge`（Bearer 保护）                                                                                                      |
| 修改 | `src/routes/index.tsx`                                                            | Evidence 终审 + 合并结果提示                                                                                                                        |
| 修改 | `daemon/pipeline/orchestrator.ts`                                                 | **验证前提交 Worktree 改动**（修复 `nothing to commit` 与 `task_commit_sha` 失真）                                                                  |
| 修改 | `daemon/runner/command-runner.ts`、`daemon/mcp/gateway.ts`、`daemon/mcp/types.ts` | 原生结构化 `argv` 执行，修复 `node -e "a;b"` 被误判为注入                                                                                           |
| 修改 | `daemon/recovery/crash-recovery.ts`                                               | `git add -A -N` 后再 diff，未跟踪文件进入恢复 Patch                                                                                                 |
| 新建 | `tests/daemon/merger.test.ts`                                                     | 5 用例：成功合并、未审计拒绝、STALE 拒绝、Trailer 顺序、错误码                                                                                      |
| 新建 | `tests/e2e/happy-path.spec.ts`                                                    | 创建→审批→执行→核销→Trailer→清理 全链路                                                                                                             |
| 新建 | `tests/e2e/circuit-breaker.spec.ts`                                               | 重试熔断 → PENDING_RESUME；越权 Worker 整批拒绝                                                                                                     |
| 新建 | `tests/e2e/crash-recovery.spec.ts`                                                | PREPARING 回退 + EXECUTING 恢复（含未跟踪文件 Patch）                                                                                               |
| 重写 | `README.md`                                                                       | 快速开始、工作流、安全边界、平台矩阵、已知限制                                                                                                      |
| 新建 | `docs/reports/v0.1-dogfooding-report.md`                                          | 自举演练实测（284ms / MERGED / Trailer 完整）与未覆盖项声明                                                                                         |
| 新建 | `docs/reports/spec-compliance-recheck-final.md`                                   | 17 项任务与 14 项偏差终局复核                                                                                                                       |

---

## 2. 规范判据对照

### TASK-D.2

| 判据                                              | 结果                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 仅 AUDITED + PASSED + can_merge + 非 STALE 可合并 | ✅ 以磁盘证据快照为准；三类拒绝均有测试                                                                       |
| Git Trailer 四字段结构                            | ✅ `Stagent-Contract-ID / Stagent-Evidence-ID / Stagent-Verdict / Reviewed-By`，顺序固定，实测 `git log` 命中 |
| 合并后清理 Worktree、留存合同/证据                | ✅ E2E 断言目录消失、`.stagent/{contracts,evidence}` 留存                                                     |
| 失败/STALE 禁止合并                               | ✅ `E_CANNOT_MERGE` / `E_EVIDENCE_STALE`                                                                      |

### TASK-E.1

| 判据                                  | 结果                                          |
| ------------------------------------- | --------------------------------------------- |
| 正常场景闭环 + 合规 Trailer           | ✅ `happy-path.spec.ts`                       |
| 可恢复熔断 → PENDING_RESUME + BLOCKED | ✅ `circuit-breaker.spec.ts`                  |
| 安全中止（越权）整批拒绝              | ✅ Worker 越权触发 `WorkerScopeError`，零落盘 |
| 崩溃恢复闭环                          | ✅ `crash-recovery.spec.ts`                   |

### TASK-E.2

| 判据                       | 结果                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| 自举完成一次真实变更与合并 | ⚠️ 部分：链路真实（284ms、MERGED、Trailer 完整），但**改动由脚本写入，非 AI 模型生成**（无 API Key） |
| 雷达呈现自身拓扑           | ✅ `GET /api/arch/graph` 可返回本仓库图                                                              |
| 合并含完整 Trailer         | ✅ 实测                                                                                              |
| 发布说明记录边界与平台矩阵 | ✅ README §安全边界                                                                                  |
| `dist/` 发布包             | ✅ `npm run build` 产出 `.output`（3.0 MB；Vite/Nitro 约定目录）                                     |

---

## 3. 门禁实测（2026-10-19 17:47）

```text
1. TypeScript typecheck  → exit 0（0 error）
2. Lint                  → exit 0（0 error / 6 既有 warning）
3. Unit+Component+Integration+E2E → 147 passed / 147（29 files）
4. Build                 → 成功（.output 3.0 MB）
```

---

## 4. 遗留事项（不阻塞 M8 签收，但阻塞 §10.1「可试用」）

| #   | 事项                                       | 说明                                                                                                                                                                               |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AI Worker 未经真实模型验证                 | 无 `OPENAI_API_KEY`；注入式测试已覆盖越权/预算，但真机生成未跑                                                                                                                     |
| 2   | ~~`write-protection-probe` 未实现（A.3）~~ | ✅ 已补齐：`write-protection-probe.ts`（chmod 0555 拒写探测，finally 恢复）+ `strategy.ts`（锁文件一致性 → 写保护证明 → 共享/隔离决策 + 隔离安装降级）；`approve()` 已接入，7 用例 |
| 3   | 雷达 60 FPS 未实测                         | 已做 >600 节点布局降级与动画关闭                                                                                                                                                   |
| 4   | 外部项目试用 / 跨平台 CI                   | 未执行                                                                                                                                                                             |
| 5   | `src/lib/scope.ts` 位置                    | 仍在前端目录，被 Daemon 复用，待迁移                                                                                                                                               |
| 6   | 单活跃 Worktree                            | 多任务并发未支持                                                                                                                                                                   |

---

## 5. 签收

- [x] M8-1 Squash-Merge + Trailer + 终审清单
- [x] M8-2 E2E 三套件
- [x] M8-3 README + 自举报告 + 终局复核
- [x] 门禁与构建全绿（154/154，build 成功）

**M8 状态：已签收（2026-10-19）。剩余遗留项已登记，v0.1 不宣称「生产可试用」。**

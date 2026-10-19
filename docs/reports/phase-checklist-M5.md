# M5 阶段核对清单 — 双轨消解（Daemon 权威 + UI 割接）【已签收】

> 计划依据：`~/.workbuddy/plans/swift-pulse-darwin-M30Jbj0P.md` §2 M5
> 日期：2026-10-19 · 前置：M4 已签收（98/98）
> **状态：Daemon 权威层与浏览器 UI 割接均已完成，浏览器管线已删除。**

---

## 1. 已完成交付物

| 类型 | 路径 | 说明 |
|---|---|---|
| 新建 | `daemon/pipeline/contract-store.ts` | `.stagent/contracts` 原子读写；写入前 Schema 校验；`transition()` 同时更新 lifecycle 与 approval，杜绝「只改一个字段」 |
| 新建 | `daemon/pipeline/orchestrator.ts` | `approve()`：PENDING_APPROVAL → PREPARING → Worktree → EXECUTING；`execute()`：VERIFYING → 真实命令 → Evidence → AUDITED / PENDING_RESUME |
| 修改 | `daemon/server.ts` | 合同 REST API + Bearer 保护：`GET/POST /api/contracts`、`GET /api/contracts/:id`、`POST .../approve`、`POST .../execute`；`/api/shutdown` 纳入鉴权 |
| 修改 | `daemon/mcp/types.ts` | 成为 MCP 协议类型唯一事实源（不再 re-export 浏览器端） |
| 删除 | `src/lib/mcp/gateway.ts`、`gateway.test.ts`、`types.ts` | 浏览器内存网关下线（审计 D7 双网关并存消除） |
| 删除 | `src/lib/contract.functions.ts` 中 legacy 中文 schema 与 `Contract` 类型 | 审计 D14 消除；`executeContract` 仅接受 `SoftwareContract` |
| 修改 | `src/lib/history.ts`、`src/components/ContractPanel.tsx` | RunRecord.contract 改为 `SoftwareContract`，删除 legacy 别名拼装 |
| 新建 | `tests/daemon/orchestrator.test.ts` | 5 用例：持久化、审批、通过闭环、熔断闭环、未审批拒绝 |
| 新建 | `tests/integration/contract-api.test.ts` | 3 用例：401、创建→审批→执行闭环、非法合同 400 |
| 新建 | `src/lib/daemon-api.ts` | 浏览器侧唯一数据入口：health / list / create / approve / execute / runWorker |
| 重写 | `src/routes/index.tsx` | 226 行 IDE 工作台 → Daemon 验收控制台（合同列表/详情/审批/执行/Evidence），**零 localStorage 产品数据** |
| 删除 | `src/components/{ContractPanel,ContractActionCard,EvidenceBundleCard,AmbientArchMap,CodingWorkerCapsule}.tsx` | 依赖浏览器虚拟工作区的组件全部下线 |
| 删除 | `src/lib/{pipeline,workspace,runner,git-guard,history,report,agent-session,git-workspace,arch-map,contract.functions,ai.server,verification}.ts` 及其测试 | 浏览器执行/持久化管线整体移除 |

---

## 2. 规范判据对照（M5 目标片段）

| 目标 | 落地情况 |
|---|---|
| Daemon 是合同状态唯一权威 | ✅ 状态只经 `ContractStore.transition()` 写盘；HTTP API 是唯一入口 |
| 审批前不可执行 | ✅ `execute()` 校验 `lifecycle_state === EXECUTING`，测试覆盖 |
| 未审批/非法组合不可写 | ✅ 每次 `save()` 经 `softwareContractSchema.parse`，非法组合抛错 |
| 真实 Worktree 执行 | ✅ `approve()` 调 `createTaskWorktree()`；`execute()` 在 Worktree 内跑真实命令 |
| Evidence 追溯 | ✅ 生成 `.stagent/evidence/{contract}-{evidence}.json`，含 head/patch 指纹、验证结果、usage |
| 熔断联动 | ✅ 失败且达重试上限 → `PENDING_RESUME + BLOCKED + VERIFICATION_RETRY_LIMIT`；费用超限 → `BUDGET_EXHAUSTED` |
| 双网关消除 | ✅ 浏览器内存网关已删除并移除导出 |
| legacy Schema 消除 | ✅ `contractSchema` / `Contract` 删除，消费方改用 `SoftwareContract` |

---

## 3. HTTP API（Bearer 保护）

```text
GET    /api/contracts                 列出合同
POST   /api/contracts                 创建（body: { contract })
GET    /api/contracts/:id             查询
POST   /api/contracts/:id/approve     审批（body: { reviewer }）
POST   /api/contracts/:id/execute     执行验证并生成 Evidence
POST   /api/shutdown                  优雅停止（需 Token）
```

未携带 `Authorization: Bearer <session-token>` → 401；非法合同 → 400。

---

## 4. 门禁实测（2026-10-19 17:14）

```text
1. TypeScript typecheck  → exit 0（0 error）
2. Lint                  → exit 0（0 error / 6 既有 warning）
3. Unit + Integration    → 111 passed / 111（19 files，含 AI Worker 5 用例）
=== All verifications passed successfully! ===
```

---

## 5. D1 消除证明

| 验收项 | 证据 |
|---|---|
| 浏览器无文件写入路径 | `grep -rnE "localStorage\|sessionStorage" src` 仅命中 `daemon-api.ts` 的 Token/连接偏好（会话级，非产品数据）；`src` 内无 `node:fs`、无 `sucrase`、无 `eval/new Function` |
| 浏览器无命令执行能力 | `runner.ts` / `pipeline.ts` / `verification.ts` 已删除；`package.json` 中 `sucrase` 依赖可移除（M8 清理） |
| 关停浏览器亦可完成闭环 | `tests/integration/contract-api.test.ts` 仅用 HTTP 完成 创建 → 审批 → 执行 → Evidence（无浏览器参与） |
| 前端构建 | `npm run build` 成功（nitro 产物生成） |
| 存储权威 | 合同/证据/Worktree 均在 `.stagent/`；浏览器仅保存 `sessionStorage` 连接参数 |

**判定**：规范 §0.5「浏览器存在可独立改文件/伪造命令结果的 Playground 路径」失败判据已解除；§1「Daemon 唯一权威」成立。**M5 签收**。

### 签收项

- [x] M5-1 合同存储（原子写 + Schema 校验 + 双状态机迁移）
- [x] M5-2 编排器（真实 Worktree + 真实命令 + Evidence + 熔断）
- [x] M5-3 合同 HTTP API（Bearer 保护）+ 集成测试
- [x] M5-4 UI 割接（Daemon 控制台）+ 浏览器管线删除

---

## 6. 遗留事项与风险

| # | 事项 | 说明 | 承接 |
|---|---|---|---|
| 1 | ~~AI Worker 未接入~~ **已补齐** | `daemon/worker/ai-worker.ts` + `openai-client.ts`：上下文仅读 writable 内文件；调用前 `assertCanConsume` 预检；模型改动**整批** Scope/预算校验后才经网关写盘；用量回写持久化 CostMonitor；API `POST /api/contracts/:id/run-worker`；UI 增加「运行 Worker」 | M5-fix 完成 |
| 2 | `approve()` PREPARING 失败分支 | 回退 `PENDING_APPROVAL/PENDING_REVIEW` 并写 BLOCKED 证据，未即时清理半成品 Worktree（依赖 M3 启动扫描） | 可接受 |
| 3 | `src/lib/scope.ts` 位置 | 规则模块仍在前端目录，仅被 daemon 消费；应迁至 `daemon/mcp/` | M8 清理 |
| 4 | 存量 localStorage 数据 | 按一次性切换策略作废，用户需重新起草合同 | 发布说明声明 |
| 5 | 旧 UI 能力 | 文件树/内联编辑/架构图随组件删除；架构雷达将在 M7 以 Cytoscape 重建 | M7 |

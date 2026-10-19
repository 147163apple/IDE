# Stagent 任务全流程梳理与同类产品对比（代码实证版）

> 生成日期：2026-10-19。Stagent 侧结论全部源自本仓库代码（附文件与行号）；竞品信息基于公开资料（2026 年检索），已在文中显式标注，非本仓库代码内容。

---

## 一、完整任务全流程（三列表格）

| # | 用户操作 | Daemon 自动动作 | Agent（AI Worker）动作 | 状态流转与触发结果 |
|---|---|---|---|---|
| 1 | 终端执行 `npx tsx bin/stagent.ts start --repo <路径>`；另开终端 `npm run dev`，在控制台顶栏填入 Daemon 地址与 Session Token（`README.md:20-27`） | 端口扫描（41792 起）、写入 `.stagent/session-token`（0600）、取得 PID 锁；**取锁后自动执行崩溃自愈**（`daemon/server.ts:145-164` → `daemon/recovery/crash-recovery.ts:131-348`）；仅绑定 `127.0.0.1`，WS 握手校验 Bearer Token 与 Origin | — | 自愈规则：PREPARING 中断→回退 PENDING_APPROVAL；EXECUTING/VERIFYING 且 Worktree 健康→PENDING_RESUME（留存快照 `crash-recovery.ts:291-309`）；Worktree 丢失→**ABORTED** + BLOCKED/WORKTREE_LOST 证据（`crash-recovery.ts:259-288`） |
| 2 | 控制台点「新建合同」，填写标题/描述/可写路径/验证命令（可用架构雷达圈选文件预填 Scope，`src/routes/index.tsx:370-387`），提交表单 | `POST /api/contracts`（`daemon/server.ts:677-692`）：`softwareContractSchema.parse` 校验 → 落盘 `.stagent/contracts/` → WS 广播。前端强制改写为 `PENDING_APPROVAL + PENDING_REVIEW`（`index.tsx:792-796`） | — | DRAFT（草案构造 `contract.schema.ts:236-327`）→ **PENDING_APPROVAL**。双状态机联动守卫：`contract.schema.ts:185-221`，非法 lifecycle×approval 组合被 Schema 拒绝 |
| 3 | 在合同卡片点「批准并开工」（`src/components/contract/ContractCard.tsx:101-115`，仅 PENDING_APPROVAL 可点） | `POST /:id/approve`（`server.ts:729-744`）→ `orchestrator.approve()`（`daemon/pipeline/orchestrator.ts:75-134`）：持合同排他锁 → 落审批事实 → **创建 Git Worktree** `task/{contractId}`（`daemon/git/worktree-manager.ts:196-287`）：保护分支检查（main/master/prod 等，`branch-guard.ts:1-8`）、主工作区脏检查需用户确认、路径逃逸防护 → 依赖策略决策（ADR-002，`orchestrator.ts:387-432`）→ 转 EXECUTING | — | PENDING_APPROVAL → PREPARING → **EXECUTING**。准备失败回滚：写 BLOCKED/PREPARATION_INTERRUPTED 证据，合同回退 PENDING_APPROVAL（`orchestrator.ts:115-131`） |
| 4 | 点「运行 Worker」（`index.tsx:436-458` → `POST /:id/run-worker`，`server.ts:746-758`） | 组装运行时三件套：ScopedWorktreeGateway + CostMonitor + LoopGuard（`orchestrator.ts:434-462`），状态持久化至 `.stagent/guard/`。费用/循环熔断时转 PENDING_RESUME 并写 BLOCKED/BUDGET_EXHAUSTED 证据（`orchestrator.ts:335-357`） | `AiWorker.run`（`daemon/worker/ai-worker.ts:86-136`）：① 收集上下文（仅 writable_paths，≤20 文件/100k 字符）；② **成本预检** `assertCanConsume`（`daemon/guard/cost-monitor.ts:178-231`）；③ 调 OpenAI `generateObject` 结构化输出 `{changes, log}`；④ **整批 Scope+预算预校验**（L164-199，任一越权抛 `WorkerScopeError`，不落半成品）；⑤ 逐文件经网关 `stagent_write_file` 落盘；⑥ 用量回写 | 状态保持 EXECUTING。Worker 可用 5 个工具（`daemon/mcp/gateway.ts:136-205`）：read_file / write_file / exec_command / list_dir / declare_complete。越权路径在 `src/lib/scope.ts:78-141` 与 `daemon/mcp/path-resolver.ts:35-70` 拦截 |
| 5 | 点「执行验证」（`index.tsx:459-480` → `POST /:id/execute`，`server.ts:842-861`） | `executeInternal`（`orchestrator.ts:188-300`）：先把 Worktree 改动 commit 到任务分支 → 逐条执行合同 `verification_spec.commands`（结构化 argv、`shell:false`、命令白名单 `daemon/runner/command-runner.ts:300-315`；超时退出码 124，SIGTERM→3s 宽限→SIGKILL，`process-tree.ts:122-149`）→ 生成 **Evidence Bundle**（`orchestrator.ts:478-606`，经 `evidenceBundleSchema` 校验，≤512 KiB） | — | EXECUTING → VERIFYING → 三分支：全部通过→**PASSED + AUDITED**；熔断（连续失败 ≥ `max_verification_retries`（默认 3）或费用超限）→**PENDING_RESUME + BLOCKED**（BUDGET_EXHAUSTED / VERIFICATION_RETRY_LIMIT）；普通失败→回 **EXECUTING**（UNSAFE_EXECUTION）。`can_merge` 为派生字段：`status==="PASSED" && scopePassed && forbiddenViolations.length===0`（`orchestrator.ts:549-552`），Schema 强制非 PASSED 必为 false（`evidence.schema.ts:149-158`） |
| 6 | —（无需操作） | 验证 PASSED 后**自动武装文件监听器**（`server.ts:518-558`，先停旧监听——单任务串行的体现）；chokidar 监听 Worktree（忽略 .git/node_modules 等，60ms 去抖，`daemon/watcher/fs-watcher.ts:49-72`）；指纹 ≠ 登记指纹即原子改写证据为 STALE（`daemon/watcher/invalidation-engine.ts:74-114`）并 WS 广播 SCOPE_ALERT | — | 外部修改已验收 Worktree → Evidence **PASSED→STALE**，`can_merge=false`，reason_code=EVIDENCE_STALE，禁止合并 |
| 7 | 在 Evidence 清单页点「核准并合并至主分支」（`src/components/evidence/EvidenceChecklist.tsx:107-114`，仅 PASSED && can_merge 可点），必传 `evidence_id` | `POST /:id/merge`（`server.ts:760-792`）→ `merger.squashMerge`（`daemon/pipeline/merger.ts:116-260`）门禁链：必须 AUDITED、证据归属本合同且非 STALE、PASSED+can_merge、指纹一致、主干无同 Evidence-ID 提交、主工作区干净 → `git merge --squash`（失败自动 `--abort`）→ 写入 Trailer（Stagent-Contract-ID / Evidence-ID / Verdict / Reviewed-By，L92-114）→ 清理 Worktree 与任务分支 → 终态 | — | AUDITED → **MERGED**。合并前指纹二次校验兜底（`daemon/guard/evidence-integrity.ts:135-147`，不符抛 E_EVIDENCE_FINGERPRINT_MISMATCH 并标 STALE） |
| 8 | 熔断后恢复：**代码中有 `orchestrator.resume()`（`orchestrator.ts:141-175`，要求 PENDING_RESUME 且 Worktree 健康 → 转回 EXECUTING），但未暴露 HTTP 端点与 UI 按钮**（`server.ts:694-696` 动作正则仅含 approve/execute/run-worker/open-editor/diff/merge/evidence）——当前仅能重启 Daemon 触发自愈或改代码调用 | 见步骤 1 自愈 | — | PENDING_RESUME →（resume，未接线）→ EXECUTING |

**代码实证的重要缺口（与文档/规范不一致处）**：
1. 规范中的「用户驳回 → REJECTED+ABORTED」「安全强行中止」在 daemon 与前端均无实现；ABORTED 仅由崩溃恢复的 WORKTREE_LOST 路径写入。
2. `stagent_declare_complete` 工具已在网关实现复核逻辑（`gateway.ts:420-511`：逐项复查写权限/预算/熔断/验证记录，返回 `ready_for_audit` 与 blockers），但**当前 AiWorker 是单轮「生成→整批校验→写盘」流程，并未调用它**——该工具为迭代式 Worker 预留。
3. 9 个原因码中 `SCOPE_VIOLATION / UNAUTHORIZED_COMMAND / WORKSPACE_LOCKED` 仅以工具/命令层错误码存在，运行时未写入 Evidence 的 `reason_code`。
4. 无中止（abort）按钮与端点（runner 层有 AbortSignal 但未接线到 UI）。
5. 跨合同串行：`armEvidenceWatcher` 仅维护单个活跃监听器（`server.ts:518-523`），新任务 PASSED 会顶替旧监听。

---

## 二、与同类产品对比

> Stagent 列全部基于代码事实；竞品列基于公开资料（2026 年检索），标注为「公开资料」，可能随版本变化。

| 维度 | Stagent v0.1（代码实证） | Claude Code（公开资料） | Codex CLI（公开资料） | Cursor（公开资料） | Cline（公开资料） | Devin / Copilot coding agent（公开资料） |
|---|---|---|---|---|---|---|
| 定位 | 本地「任务合同 + 验收控制台」：改动可审批、可验证、可追溯、可回滚 | 终端通用编码 Agent | 终端编码 Agent（Apache 2.0） | AI-first IDE | VS Code 插件 Agent | 云端异步任务 Agent（派 PR） |
| 任务发起 | 控制台表单提交结构化合同（路径白名单、验证命令、预算为合同字段） | 自然语言对话 | 自然语言对话 | 编辑器内对话 | 对话 + 每步批准 | Issue/任务描述，云端执行 |
| 工作流自动化 | **半自动流水线**：审批→建 Worktree→改码→验证→出证据自动衔接，但发起、审批、跑 Worker、执行验证、核销 5 个节点均需人点击 | 高：自主多轮工具循环 | 高：自主循环 + OS 沙箱 | 中-高 | 中（默认逐步确认） | 高：端到端自主，人审 PR |
| 协作模式（人在环路） | **强制两道人工闸门**：合同审批 + 证据核销；双状态机 Schema 级联动 | 权限分级（询问/自动），无强制审批态 | 沙箱 + 审批策略 | 逐 hunk 接受/拒绝 | 每动作确认 | PR review 一道闸门 |
| 隔离与安全 | Git Worktree 物理隔离 + 路径 realpath 校验 + 命令白名单 + 敏感环境变量剥离；README 明示「非对抗性沙箱」 | 权限分类器 | 工作区沙箱、默认断网 | 沙箱 shell | 无沙箱（逐条确认） | 云端容器/VM 隔离 |
| 验证与证据 | **Evidence Bundle 为一等公民**：指纹快照、diff_stat、验证结果、费用用量；PASSED/FAILED/BLOCKED/STALE 四态，STALE 由 watcher 自动失效联动 | 运行测试但无结构化证据制品 | 同左 | 同左 | 同左 | CI 检查结果依附 PR |
| 可追溯/回滚 | Git Trailer 记录 Contract/Evidence ID；不合并不写主干；Worktree 即天然回滚单元 | 依赖 git 历史/checkpoint | 同左 | checkpoint 恢复 | checkpoint | PR revert |
| 失控防护 | 代码内建：费用硬上限（预检+熔断）、连续失败熔断（默认 3 次）、任务总时长熔断、双超时+进程组强杀 | 依赖权限配置 | 沙箱边界 | 依赖用户监控 | 逐条确认 | 平台侧限额 |
| 扩展性 | MCP 式 Scoped 网关仅 5 工具；Worker 仅接 OpenAI（`openai-client.ts`）；单任务串行；无插件机制 | 丰富（MCP、hooks、subagents、skills） | MCP、AGENTS.md | 多模型 + 生态 | BYOK 30+ 提供商 | 平台生态集成 |
| 成熟度（代码实证） | v0.1：Worker 未经真实模型端到端验证；resume/reject/abort 未接线；仅 macOS 实测 | 生产成熟 | 生产成熟 | 生产成熟 | 生产成熟 | 生产成熟 |
| 适用场景 | 外包/验收交付、合规敏感的小步改动、需要「证据先行」的审计场景 | 日常全栈开发主力 | 日常开发、OpenAI 栈 | 日常 IDE 编码 | 预算敏感、需细粒度确认 | 异步批量任务、Issue 流转 |

### 结论与选型建议

1. **Stagent 的差异化不在「自主编码能力」，而在「合同 + 证据 + 双人闸门」的验收流水线**——这是代码中真实存在且主流工具均未内建的能力（结构化 Evidence、STALE 自动失效、Trailer 追溯、费用/循环双熔断）。
2. **论 Agent 自主性，Stagent 当前显著弱于 Claude Code / Codex CLI**：Worker 为单轮生成而非多轮工具循环，declare_complete 未接线，模型仅支持 OpenAI，且未经真实模型端到端验证（README 自认）。
3. **选型建议**：
   - 日常开发提效 → Claude Code / Codex CLI / Cursor（成熟度高、自主性强）；
   - 云端异步任务、Issue→PR → Devin 或 Copilot coding agent；
   - 细粒度逐步确认、自备 Key → Cline；
   - **需要对外包/协作方的改动做「先审批范围、后核销证据」的验收管理** → Stagent 的模型是合适的，但当前仅适合**低风险小步改动**的试点：单任务串行、恢复链路未接线、非对抗性沙箱、仅 macOS 实测，高风险仓库应按 README 建议在容器/虚拟机中运行。
4. **无法从代码确认的信息**：云端/多人协作能力（无，代码为纯本地单用户架构）；与 IM/项目管理工具集成（无相关代码）；计费实现精度（账单默认 ESTIMATED，README 明示限制）。

---

## 三、缺口闭环记录（2026-10-19 补齐）

针对第 8 项「resume 未接线」与第 1 项「中止/驳回无实现」的临门一脚：

| 缺口 | 补齐内容 | 代码位置 |
|---|---|---|
| resume 无 HTTP 端点 | 新增 `POST /api/contracts/:id/resume`，调用既有 `orchestrator.resume()`；非法状态映射 409，Worktree 丢失返回 400 | `daemon/server.ts`（动作正则新增 `resume`、新增 handler） |
| resume 无 UI 入口 | 控制台动作栏新增「恢复执行」，仅 `PENDING_RESUME` 可点 | `src/routes/index.tsx`、`src/lib/daemon-api.ts`（`resumeContract`） |
| 中止/驳回无实现 | 新增 `POST /api/contracts/:id/abort` + `ContractOrchestrator.abort()`：① 触发 AbortController → 在途命令整树 SIGTERM→3s→SIGKILL（exit 130）；② 网关 `E_TASK_ABORTED` 拒绝后续命令；③ 持锁合规流转 `ABORTED`（待审批态 → REJECTED 驳回语义，已批准任务保留 APPROVED）；④ 清理 Worktree 与 `task/` 分支 | `daemon/pipeline/orchestrator.ts`、`daemon/mcp/gateway.ts`、`daemon/server.ts` |
| 中止无 UI 入口 | 控制台动作栏新增「驳回合同 / 中止任务」（按状态显示不同文案，`window.confirm` 二次确认），终态 MERGED/ABORTED 禁用 | `src/routes/index.tsx`、`src/lib/daemon-api.ts`（`abortContract`） |
| 无测试覆盖 | 新增 `tests/integration/resume-abort.test.ts`（6 例）：resume 成功/重复恢复 409/Worktree 丢失拒绝；驳回 → ABORTED+REJECTED；执行中中止 → ABORTED 且 Worktree 与分支清理；**在途 30s 命令被强杀（exit 130，666ms 收尾）**；未鉴权 401 | `tests/integration/resume-abort.test.ts`（端口 3690–3695） |

验证结果：
- `npx tsc --noEmit`：0 error；ESLint（改动文件）：0 error。
- `npx vitest run --no-file-parallelism`：**38 文件 / 212 测试全通过**。
- 注意：默认并行的 `npm test` 在本机（18 核、沙箱环境）复现「vitest-pool-runner: Timeout waiting for worker to respond」，为**既有环境问题**（对照实验：仅跑与本次改动无关的 `tests/daemon` 同样出现 17 个 worker 超时，其中 41 项测试本身全通过）。串行模式可作为本机执行全量套件的等价方案。

# TASK-C.7 交付说明：业务功能树与 Task Graph 渐进点亮视口

- 工作分支：`feat/task-c7-graph-engine`（工作树 `/Users/tina/Desktop/1020-c7`）
- 基线：`main@05f090f`（已包含 TASK-0.2c、TASK-D.3、TASK-W.2b）
- 规范依据：《Stagent 系统架构设计规范 v1.6.1》§3.1 – §3.4；《研发任务拆解规范 v1.6.2》TASK-C.7
- 门禁结果：`npm run typecheck` 零错误；新增 31 个用例全绿（24 单元 + 7 UI）
- 合入主线：`main` merge `5117b27`（2026-10-23）

## 1. 交付清单

| 层 | 文件 | 内容 |
| :--- | :--- | :--- |
| 共享契约 | `src/lib/graph/task-graph.ts` | 节点七态、`TaskNode`、`SupervisorProposalV1`、指纹/问题/进度、拓扑排序与派生状态、持久化反序列化守卫、帧合并 |
| Daemon 权威 | `daemon/graph/graph-engine.ts` | 内存唯一权威 + 原子落盘 `.stagent/specs/task_graph.json`、提案消毒、七态流转、级联阻断/恢复、STALE 降级、变更广播 |
| Daemon 点亮 | `daemon/graph/illumination-verifier.ts` | 三证充要条件、`E_EMPTY_VERIFICATION_BLOCKED`、副作用/人工/Fast Path 分支、问题码 |
| Daemon 证据 | `daemon/graph/evidence-collector.ts` | 从真实 Worktree 读取目标文件、SHA-256、`git rev-parse HEAD`、`git status -uall` × 合同 Scope |
| 协议 | `src/lib/ipc/frames.ts` | 新增 `TASK_GRAPH_UPDATED` 帧与目录项（v1.4） |
| 控制面 | `daemon/server.ts` | `GET /api/graph`、`POST /api/graph/proposal`、`/nodes/start`、`/verify`、`/stale`；外部改码同时降级节点 |
| 客户端 | `src/lib/daemon-api.ts`、`src/hooks/use-daemon-stream.ts` | 图谱 REST + 帧回调 |
| 视图 | `src/components/graph/*` | 业务功能导图、执行 DAG、双视图面板、视图模型与 100ms 动效 |
| 左栏 | `src/components/FileTreeSpecsSection.tsx` | 【规范与资产】专区（需求 / 合同 / Demo）与生成进度 |
| 接线 | `WorkspaceLayout.tsx`、`ActivityBar.tsx`、`routes/index.tsx` | 图谱 Tab、左栏专区、真实数据注入与文件树跟随刷新 |
| 样式 | `src/styles.css` | `dag-illuminate` 100ms 关键帧（尊重 `prefers-reduced-motion`） |
| 测试 | `tests/unit/graph-engine-invariants.test.ts`（24）、`tests/ui/task-graph-illumination.test.tsx`（7） | 不变式与视口门禁 |
| 规范回写 | `docs/Stagent_v0.1_Development_Tasks_Specification_v1.6.2.md` | §1.1 矩阵与 §3.5 详细卡状态 `[NEW_TASK]` → `[COMPLETED]`，按实际落地校正文件清单，并在版本声明追加状态回写记录（合入 merge `5117b27`） |

## 2. 关键设计决策

### 2.1 运行态的 `Omit` 边界是"三个字段"，不是"三个字段左右"

`TaskNode` 的运行态被严格限定为 `state` / `executed_at` / `commit_sha`，因此
`SupervisorProposalNode = Omit<TaskNode, "state" | "executed_at" | "commit_sha">`
能真正剥掉**全部**运行态。指纹与问题记录放在图级 `fingerprints` / `issues`：
若把它们塞回节点类型，Omit 会名存实亡。

类型层之外还有运行期防线：提案 JSON 里出现任何未知字段（含被夹带的
`state: "ILLUMINATED"`）一律 `E_PROPOSAL_INVALID` 拒绝，而不是悄悄删掉——
悄悄删掉会让"上游以为提案能定状态"的 bug 长期潜伏。

### 2.2 证据必须由 Daemon 现算

`POST /api/graph/verify` **不接受** `files_written` / `file_hashes` / `scope_valid` /
`commit_sha`：这四项由 `collectWorktreeEvidence` 在真实 Worktree 上读取文件、
算 SHA-256、执行 `git rev-parse HEAD` 与 `git status --porcelain -uall` 后得出。
调用方只能提交执行器产生的命令结果与退出码。这样"前端自造绿灯"在接口层就不可表达。

### 2.3 空验证集：状态按规范 FAILED，视觉按诉求"警告灰"

规范 §3.2.2 规定 `COMMAND` 节点命令集为空时强制 `FAILED` 并报
`E_EMPTY_VERIFICATION_BLOCKED`；任务卡要求"保持警告灰"。二者落成两层：

- **状态层**：`FAILED` + `E_EMPTY_VERIFICATION_BLOCKED`（WARNING 级问题）；
- **视觉层**：`data-tone="warning"`（去饱和灰底、无红闪、无呼吸脉冲），
  文案"警告：验证集为空，已阻止点亮"。

`warning` 不是第八个节点状态，只是 `FAILED` 在"规格无效"原因下的视觉变体。
这样既没有假绿，也不会把"验收写空了"误报成"代码跑挂了"。

### 2.4 STALE：由绿变灰，但保留审计事实

外部改码命中 `target_files` 时，`ILLUMINATED -> STALE_REVERIFY`（唯一合法降级边），
同时撤销该节点指纹、保留 `commit_sha` / `executed_at` 供追溯，并记
`E_EVIDENCE_STALE`。视觉为灰底 + 琥珀描边 + `↻`，避免与 `FAILED` 红闪混淆。

证据监听复用既有 `WorktreeWatcher`：`armEvidenceWatcher` 的 `onChange` 同时调用
`graphEngine.markStale(changed)` 与 Evidence 失效，两级降级同源。

### 2.5 帧与乱序

`TASK_GRAPH_UPDATED` 携带全量图、`changed_node_ids`、`progress_percent`、`revision`。
前端 `applyTaskGraphFrame` 只接受同合同且 `revision` 不倒退的帧：重连补发旧帧时
进度条不会倒退。新点亮集合由前后快照差分得出，仅对这些节点播放 100ms 翠绿过渡。

## 3. 门禁结果

| 项目 | 结果 |
| :--- | :--- |
| `npm run typecheck` | 0 error |
| `tests/unit/graph-engine-invariants.test.ts` | 24 passed |
| `tests/ui/task-graph-illumination.test.tsx` | 7 passed |
| `tests/ui/ide-shell.test.tsx` | 12 passed（Activity Bar 新增图谱入口，同步更新顺序断言） |
| 全量套件（改动后首轮） | 99 文件 / 986 用例：976 passed、6 skipped、4 failed |

全量套件剩余 4 条失败的性质：

1. `tests/unit/git-cwd-isolation.test.ts`（3 条）：用例把宿主仓库写成
   `process.cwd()/.git/config`，而本任务按规范在 `git worktree` 中施工，worktree 的
   `.git` 是文本指针 → `ENOTDIR`。这是既有用例对工作树形态不兼容，与 C.7 代码无关；
   我尝试过兼容修复，但宿主安全策略拦截了对仓库内临时目录的递归删除，遂回退以免污染变更集。
2. `tests/ui/ide-shell.test.tsx`（1 条）：已修复（新增 `activity-graph`）。

后续复跑全量时，宿主的批量删除守卫开始拦截测试临时目录清理
（`SAFE_DELETE_BULK_GUARD_ERROR / state lock timeout`），导致大量与本改动无关的用例
在 `afterEach` 级联失败，故不再以该环境下的全量结果作为结论。新增两道门禁与类型检查
均独立复跑通过。

### 环境提示（需人工处理）

- `/Users/tina/Desktop/1020/.git/config.lock` 为历史测试残留，内容含
  `user.name = Stagent Test`，当前无 git 进程占用。它会持续让
  `git-cwd-isolation` 的"零锁残留"断言失败；宿主安全策略拦截了移走操作，
  建议手动删除或移出该文件。
- 本工作树 `node_modules` 为指向 `/Users/tina/Desktop/1020/node_modules` 的符号链接
  （未跟踪），仅为复用依赖，不影响源码。

## 4. 手工验收路径

```bash
# 1) 建图（Supervisor 提案 → 全 PENDING）
curl -s -X POST http://127.0.0.1:3001/api/graph/proposal \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"proposal":{"schema_version":"1.0","proposal_id":"p1","contract_id":"<id>",
       "functional_tree":[{"id":"auth","title":"用户登录","parent_id":null}],
       "nodes":[{"node_id":"n1","title":"迁移","kind":"CODE_MODIFICATION","depends_on":[],
                 "functional_area":"auth","target_files":["src/auth/migration.ts"],
                 "verification_mode":"COMMAND","verification_commands":["test"]}]}}'

# 2) 开工（前置未点亮会 409 E_UPSTREAM_NOT_ILLUMINATED）
curl -s -X POST http://127.0.0.1:3001/api/graph/nodes/start \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"node_id":"n1"}'

# 3) 提交验证（文件/SHA/Scope 由 Daemon 现算；空命令集必然 E_EMPTY_VERIFICATION_BLOCKED）
curl -s -X POST http://127.0.0.1:3001/api/graph/verify \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"node_id":"n1","command_results":[{"alias":"test","exit_code":0}]}'

# 4) 模拟外部改码（节点降级 + AUDITED 合同退回 VERIFYING）
curl -s -X POST http://127.0.0.1:3001/api/graph/stale \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"paths":["src/auth/migration.ts"]}'
```

界面：左栏 Activity Bar 第二个图标「任务图谱」→ 业务功能导图 / 执行拓扑切换；
左栏顶部【规范与资产】显示需求、合同、Demo 与点亮进度。

## 5. 已知限制

- 建图入口只有控制面 API：C.7 不伪造"从合同自动拆分节点"的拓扑，节点应由
  Supervisor 提案解构（§3.1 一对多映射）。
- 单活跃图：v0.1 并发度为 1，`task_graph.json` 保存当前活跃合同；多合同并行归档
  留待 v0.2。
- 命令结果仍由执行器提交（Daemon 内部链路），不是浏览器字段；文件、Scope、SHA
  三项已不可自报。
- `MANUAL_REVIEW` 仍要求 Commit SHA（比规范更严），用于满足任务卡"物理点亮三条件"。

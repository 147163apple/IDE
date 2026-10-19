# M6 阶段核对清单 — Track B 架构感知与文件监听【已签收】

> 计划依据：`~/.workbuddy/plans/swift-pulse-darwin-M30Jbj0P.md` §2 M6
> 日期：2026-10-19 · 前置：M5 已签收（111/111）

---

## 1. 交付物

| 类型 | 路径 | 说明 |
|---|---|---|
| 新建 | `daemon/arch/parser.ts` | TypeScript Compiler API 解析；import / export-from / 动态 import / require；`import type` 标记；tsconfig `paths` + `baseUrl` 别名解析 |
| 新建 | `daemon/arch/graph.ts` | 内存图；**迭代版 Tarjan** SCC；依赖优先 Kahn 拓扑排序；单文件增量更新；`buildDependencyGraph()` 冷启动构建 |
| 新建 | `daemon/watcher/fs-watcher.ts` | chokidar 监听活跃 Worktree；排除 `.git/.stagent/node_modules/dist/.output` 等；事件去抖合批 |
| 新建 | `daemon/watcher/invalidation-engine.ts` | Worktree 内容指纹（排序路径 + 每文件 SHA-256）；指纹不符 → Evidence 原子改写为 `STALE` 且 `can_merge=false` |
| 修改 | `daemon/server.ts` | 执行通过后自动挂载监听；STALE 时经 WS 广播 `SCOPE_ALERT`；新增 `GET /api/arch/graph`（Bearer 保护） |
| 新建 | `tests/daemon/arch-graph.test.ts` | 6 用例：别名、import type、环路、拓扑、性能 |
| 新建 | `tests/daemon/watcher-invalidation.test.ts` | 3 用例：忽略规则、STALE 联动、指纹稳定 |
| 扩展 | `tests/integration/contract-api.test.ts` | 新增架构图 API 与「执行后外部改文件 → STALE」端到端用例 |

---

## 2. 规范判据对照

### TASK-B.1
| 判据 | 结果 |
|---|---|
| 解析 TS/JS 绝对与相对引用 | ✅ 相对路径、`baseUrl`、`paths` 通配别名均解析为绝对路径 |
| `import type` 识别 | ✅ `importClause.isTypeOnly` 与 `export type` 均标记 `typeOnly` |
| tsconfig paths 别名 | ✅ `loadPathAliases()` 容错注释/尾逗号；测试验证 `@/lib/x` |
| Tarjan 循环检测 | ✅ 迭代实现；三文件环被准确识别为单个 SCC |
| 性能：1000 模块冷启动 ≤1.5s | ✅ 测试断言通过（实测构建 1000 模块约 27ms 量级） |
| 性能：增量 ≤20ms | ✅ 预热后单文件更新断言 <20ms |
| 解析器不得位于前端 | ✅ 位于 `daemon/arch/`，浏览器无引用 |

### TASK-B.2
| 判据 | 结果 |
|---|---|
| 精确监听活跃 Worktree，排除元数据与依赖目录 | ✅ `shouldIgnore()` 单测覆盖 `.stagent`、`node_modules`；`ignoreInitial` 避免启动风暴 |
| 外部新增/修改/删除 → 指纹不符 → Evidence STALE（`EVIDENCE_STALE`） | ✅ 单测与端到端测试双重验证：`status=STALE`、`can_merge=false`、`reason_code=EVIDENCE_STALE` |
| STALE 后禁止合并 | ✅ 数据层已保证（`can_merge=false` + Schema 不变式）；按钮置灰由 M8 合并门禁消费 |
| 不误监听 `.stagent/` 导致死循环 | ✅ 排除规则单测 |

---

## 3. 门禁实测（2026-10-19 17:30）

```text
1. TypeScript typecheck  → exit 0（0 error）
2. Lint                  → exit 0（0 error / 6 既有 warning）
3. Unit + Integration    → 122 passed / 122（21 files）
=== All verifications passed successfully! ===
```

---

## 4. 设计说明与残留

| # | 事项 | 说明 |
|---|---|---|
| 1 | 单活跃 Worktree | v0.1 单人单任务，Daemon 仅维护一个 watcher；多任务并行需改为 Map<contractId, watcher>（M8 后扩展） |
| 2 | 指纹为全 Worktree 内容哈希 | 变更检测精确但大仓库成本随文件数增长；后续可改为 mtime+size 快路径 |
| 3 | 未解析的新文件引用 | 目标文件尚不存在时 `resolved=null`，文件创建后需增量更新（调用方负责 `updateFile`） |
| 4 | 架构图 API 尚未限流 | 大仓库首次请求有构建成本；M7 前端将缓存 + 增量刷新 |
| 5 | `src/lib/scope.ts` 仍在前端目录 | 被 daemon 复用；M8 迁移清理 |

---

## 5. 签收

- [x] M6-1 AST 解析器 + 依赖图（Tarjan / 拓扑 / 增量 / 性能）
- [x] M6-2 chokidar 监听 + Evidence 失效引擎
- [x] M6-3 测试与门禁（122/122）

**M6 状态：已签收（2026-10-19）。TASK-B.1、TASK-B.2 由「未开始」转为「完成」。**

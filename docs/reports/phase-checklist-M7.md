# M7 阶段核对清单 — Track C 交互控制台【已签收】

> 计划依据：`~/.workbuddy/plans/swift-pulse-darwin-M30Jbj0P.md` §2 M7
> 日期：2026-10-19 · 前置：M6 已签收（122/122）

---

## 1. 交付物

| 类型 | 路径 | 说明 |
|---|---|---|
| 新建 | `src/components/contract/ContractCard.tsx` | 合同概览：状态、风险、Scope 计数、预算、命令、审批按钮（仅 PENDING_APPROVAL 可点） |
| 新建 | `src/components/contract/ScopeList.tsx` | 可写/只读/**严禁（🔒 锁定）** 三分区 |
| 新建 | `src/components/contract/BudgetVisualizer.tsx` | 费用进度条、多币种、文件/时长/重试上限；`UNAVAILABLE` 明确警示 |
| 新建 | `src/components/radar/RadarGraph.tsx` | Cytoscape 画布：点选圈定、环路红色高亮、搜索定位动画；>600 节点自动降级 grid 布局 |
| 新建 | `src/components/radar/FilterToolbar.tsx` | 文件名搜索、环路开关、节点/边/选中统计 |
| 新建 | `src/components/radar/ScopeSelector.tsx` | 圈选结果导出为合同 `writable_paths` |
| 新建 | `src/components/diff/DiffViewer.tsx` | 统一 diff 行内着色（增/删/hunk/meta），空变更提示 |
| 新建 | `src/components/editor/EditorOpener.tsx` | 调起失败时降级为「复制 Worktree 路径」 |
| 新建 | `daemon/editor/launcher.ts` | 路径沙箱校验、参数化模板 `{path}`、`shell:false`、ENOENT 降级 |
| 修改 | `daemon/server.ts` | 新增 `GET /api/contracts/:id/diff`、`POST /api/contracts/:id/open-editor` |
| 修改 | `src/routes/index.tsx` | 集成全部 Track C 组件：雷达侧栏、三分区 Scope、预算、Diff、编辑器调起 |
| 新建 | `tests/components/{ContractCard,DiffViewer,RadarGraph}.test.tsx` | 11 用例 |
| 新建 | `tests/daemon/editor-launcher.test.ts` | 5 用例 |

---

## 2. 规范判据对照

### TASK-C.1
| 判据 | 结果 |
|---|---|
| 严格区分 writable / readonly / strictly_forbidden 并对严禁显著警告 | ✅ ScopeList 三分区 + 🔒 标识；测试断言 |
| 费用控件绑定合同 `currency` 与 `max_cost_minor_units` | ✅ BudgetVisualizer 以最小货币单位展示并计算进度 |
| 支持 PROVIDER_REPORTED / ESTIMATED / **UNAVAILABLE** 并警示 | ✅ UNAVAILABLE 显示黄色警示条（类型层面显式扩展，合同 Schema 仍只允许前两者） |
| 批准后进入只读锁定态 | ✅ 仅 `PENDING_APPROVAL + PENDING_REVIEW` 可点击；批准后 Daemon 状态变更，按钮自动禁用 |

### TASK-C.2
| 判据 | 结果 |
|---|---|
| 按文件名模糊搜索并居中定位 | ✅ FilterToolbar + `focusPath` → `cy.animate({center, zoom})` |
| Cycles 开关使环路红色高亮 | ✅ `node[cycle=1]` 样式 |
| 圈选节点导出为 writable_paths | ✅ RadarGraph `select/unselect` → ScopeSelector → 新建合同表单预填 |
| 1000 节点 60 FPS | ⚠️ **无法在 jsdom/无 GPU 环境验证**；已做工程缓解：>600 节点降级 grid 布局、关闭动画、`wheelSensitivity` 调优。需在真实浏览器做一次性能复核（记入 M8 dogfooding） |

### TASK-C.3
| 判据 | 结果 |
|---|---|
| 目标严格指向 `.stagent/worktrees/task-{id}` 绝对路径 | ✅ `resolveTaskWorktree()` realpath + 前缀校验；拒绝不存在/越界路径 |
| 参数化模板、禁止 shell 拼接 | ✅ `buildEditorCommand()` 解析 argv，`shell:false`；缺 `{path}` 直接拒绝 |
| 未安装编辑器时降级复制路径 | ✅ `editor_not_found` → EditorOpener 展示路径 + 复制按钮 |
| 严禁打开主工作区根目录 | ✅ 路径必须位于 `.stagent/worktrees` 下 |

---

## 3. 门禁实测（2026-10-19 17:38）

```text
1. TypeScript typecheck  → exit 0（0 error）
2. Lint                  → exit 0（0 error / 6 既有 warning）
3. Unit + Component      → 138 passed / 138（25 files）
4. Frontend build        → 成功（nitro 产物）
```

---

## 4. 残留与风险

| # | 事项 | 说明 | 承接 |
|---|---|---|---|
| 1 | 60 FPS 未实测 | 无头环境无法测帧率；已做布局降级与动画关闭 | M8 dogfooding 用真实浏览器复核 |
| 2 | Cytoscape 包体积 | 约 400KB（gzip 后约 120KB），仅控制台加载 | 可接受 |
| 3 | Diff 为行内统一视图 | 规范允许「双栏/行内」，当前实现行内；双栏可在后续增强 | 非阻塞 |
| 4 | 编辑器模板来自合同 | 合同未配置时回退 `STAGENT_EDITOR` 或 `cursor {path}` | 运营说明 |
| 5 | 雷达 API 无缓存 | 每次连接构建一次；大仓库首次加载有延迟 | M8 可加 mtime 缓存 |

---

## 5. 签收

- [x] M7-1 合同审批组件（C.1）
- [x] M7-2 架构雷达组件（C.2）
- [x] M7-3 Diff + 编辑器调起（C.3）
- [x] 门禁与构建全绿（138/138）

**M7 状态：已签收（2026-10-19）。TASK-C.1、C.2、C.3 由「未开始」转为「完成」（C.2 帧率待真机复核）。**

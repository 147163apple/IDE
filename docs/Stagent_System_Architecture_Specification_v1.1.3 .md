# Stagent 系统架构设计规范 (v1.1.3 开发基线)

> **版本**：v1.1.3 (Verified Acceptance & Boundary Consistency)  
> **状态**：锁定为 v0.1 开发基线；实现须通过本文可验证验收标准  
> **前序版本**：v1.1.2 (首版产品收敛版)  
> **本次修订重点 (v1.1.3)**：
> 1. 将外部编辑器、外部文件变更同步、依赖复用、测试环境、费用熔断等产品决策补成可判定的通过/失败标准。
> 2. 移除不再实现的 Playground/Monaco 执行与测试描述，统一为单一 Local Daemon 文件监听、Diff 与外部编辑器流程。
> 3. 为外部编辑器路径、命令模板、连续验证失败熔断、Evidence 失效、费用预算累计补齐合同字段及组件/集成测试。
> 4. 明确本地子进程与路径白名单不是对抗性沙箱，定义高风险仓库的拒绝/外置隔离判据。

---

## 0. 产品定义、首版用户流程与功能边界 (Product Contract)

### 0.1 产品定位与目标用户

Stagent 是面向**独立开发者与外包工程师**的本地任务副驾与验收控制台。目标用户能够用自然语言驱动 AI 编码，也可能熟悉 Cursor 等工具，但当项目和改动规模超过个人可稳定掌握的范围时，需要重新获得系统全局感、变更边界和验收信心。

**核心价值承诺**：把一个难以掌握的大型 AI 软件项目，转化为一组用户能够理解、能够验收、能够追踪、能够维护的可控任务，让“一个人 + AI”在复杂度超过个人认知带宽后，仍能掌握系统。

Stagent 是“认知外骨骼”，不是另一款通用代码编辑器，也不承诺 AI 永不出错。它通过三项交付物落实价值：
- **架构雷达 (Scope Radar)**：展示文件级依赖关系、任务触及模块与潜在波及面，支持用户审查/调整范围。
- **任务合同 (Task Contract)**：将自然语言意图固定为可批准的文件边界、预算、验证命令和验收标准。
- **验收清单 (Evidence Sheet)**：呈现真实执行结果、越界检查、费用用量和 Diff，供用户决定是否核销合并。

### 0.2 v0.1 核心用户流程 (必须形成闭环)

1. **圈定范围 — Scope Discovery**：用户输入任务意图；Stagent 基于本地文件级 import/export 依赖索引，展示建议的可写文件 (Write Scope)、只读上下文 (Read Scope) 和可能受影响节点。用户能理解并编辑建议范围；范围未经用户确认不得进入执行。
2. **合同与预算确认 — Contract & Budget**：Tech Lead 生成合同卡，至少包含目标、验收标准、可写/只读/禁止路径、文件数与 diff 预算、验证命令、超时，以及该任务的 token/费用上限。用户确认或编辑后显式授权。涉及未允许的命令、依赖变更、网络访问或敏感环境变量时，必须在授权卡中单独说明并取得授权。
3. **隔离执行与熔断 — Isolated Execution**：本地 Daemon 在真实 Git Worktree 中执行任务，Coding Worker 通过受限工具访问文件并运行获准命令。越界写入、预算达到上限、超时、连续验证失败达到合同阈值或无法确认安全边界时，任务暂停/阻断，不得继续自动扩大权限。
4. **证据验收与合并 — Evidence & Merge**：呈现真实命令 stdout/stderr（可配置截断/脱敏）、退出码与耗时、实际变更文件与合同范围对照、token/费用、Diff 及相关架构节点。只有门禁通过且用户再次显式点击“核销并合并”才可 squash merge；合并后刷新本地架构索引。Evidence 通过不等于自动合并。

**主路径原则**：合同审批是执行授权，Evidence 审阅是合并授权，两者不可合并成一次自动批准。暂停、失败、取消和恢复均须保留合同与审计状态。

### 0.3 v0.1 功能边界 (In Scope / Out of Scope)

| 领域 | v0.1 必须交付 (In Scope) | v0.1 明确不做 (Out of Scope) |
|---|---|---|
| 运行形态 | Local-First CLI + localhost Web UI；本机真实仓库与真实文件系统 | 浏览器虚拟文件系统/Mock 历史 Playground；多租户远程托管产品 |
| 目标用户 | 单人开发者/外包工程师的单机工作流 | 企业组织管理、多人实时协作、复杂权限矩阵 |
| Git | 真实 Git Worktree、任务分支、Diff 审阅、显式 squash merge | 远程 Git 托管、自动 PR、复杂并发冲突调解 |
| 编辑 | 文件级 Diff；一键在用户配置的 Cursor/VS Code 等外部编辑器打开 | 自研 Web IDE、重型 Monaco 编辑能力 |
| 架构地图 | 文件级依赖图、搜索/缩放/折叠、Scope 与受影响节点高亮 | 3D Monorepo 可视化、深层运行时数据流/完整语义分析 |
| 执行 | 真实命令输出、退出码、超时、命令白名单/授权、可验证的路径边界 | 把普通本地子进程宣称为对抗性容器沙箱；任意 shell 权限 |
| 成本 | 合同级 token/费用上限、使用量显示、达到硬限额时挂起 | 后续团队/合规场景成本分摊、组织账单与复杂预算看板 |
| 环境 | 对测试凭据采用显式、最小权限授权；秘密不进入模型上下文/日志 | 默认把所有宿主环境变量交给 Agent；默认开放任意网络 |
| 持久化 | 本地 `.stagent/` 合同、状态、日志与 Evidence；支持备份/导出 | 企业 KMS、防篡改合规存证、云端审计服务 |

### 0.4 产品成功与首版验收原则

- 用户能在授权前看到并编辑 AI 建议的 Write Scope、Read Scope、预算和验证方式。
- 未经审批的任务不能启动；越权、达到费用/Token 硬上限或验证失败不能自动合并。
- Evidence 中的命令结果来自本机真实进程，包含退出码、耗时及执行命令标识，而非模拟结果。
- 主工作区在任务执行期间保持不变；任务工作树可单独检查、恢复、丢弃或经审批合并。
- UI 与 CLI 对同一任务状态、合同、预算及 Evidence 显示一致；Daemon 重启后可恢复可恢复状态并明确提示不可恢复状态。
- 所有涉及不可逆动作、环境秘密、网络和依赖安装的权限均采用最小化、明确、可撤销授权。

---

### 0.5 首版产品决策验收矩阵与失败判据

| 决策 | 可验证通过标准 | 失败判据 |
|---|---|---|
| Local-First 单一运行时 | 新建任务只由本地 Daemon 操作真实仓库；Web UI 重连后读回同一任务状态 | 浏览器存在可独立改文件/伪造命令结果的 Playground 路径；UI 状态与 Daemon 状态不一致仍可授权 |
| Scope 与双重审批 | 未批准不能执行；未审阅 PASSED Evidence 不能合并；写操作逐次校验合同范围 | 任一工具调用绕过合同；越权后合同自动扩大；失败/阻断任务可合并 |
| Worktree 与隔离 | 任务运行于独立任务 Worktree；主工作树状态保持原样；合并仅在用户确认后执行 | Worker/外部编辑器目标落在主工作树；未批准改动进入目标分支 |
| 依赖准备 | 使用的依赖来源、锁文件、缓存/安装动作可追踪；共享依赖的写保护与临时缓存隔离经测试 | 对共享目录存在未经授权写入；依赖状态未知仍静默继续；缓存写入污染主目录 |
| 本地命令/环境/网络 | 每命令有合同授权、超时与实际退出码；仅注入批准变量；高风险任务拒绝或外置隔离 | 未授权命令执行；秘密值进入 Prompt/保存日志；把普通子进程称为强沙箱 |
| 费用与重试熔断 | 用量跨重启/重试持久化；达到上限后没有新模型调用；失败重试达到合同限额后挂起 | 超限调用继续、用量归零、模型切换绕过预算或重试计数 |
| 外部编辑器 | 可配置模板只收到 Worktree 绝对路径；不可用时复制路径；外部写入使旧 Evidence 失效 | 编辑器指向主工作树；失败导致主流程不可用；外部改动后仍可用旧 Evidence 合并 |
| 架构地图 | 文件新增/修改/删除更新相关节点；验证前快照可纠正 watcher 丢事件 | 事件漏失后 Scope/ Diff /Evidence 使用过期图或旧文件快照 |
| Evidence 与核销 | Evidence 绑定合同版本、HEAD、Worktree 快照、命令结果与费用；合并前重新校验快照 | 证据不对应当前内容，或 PASSED 状态掩盖快照变化仍允许合并 |

测试必须在声明支持的平台矩阵中运行；任何未覆盖平台不得标记通过。对外发布时，应公开尚未通过的验收项及本地执行安全限制。

## 1. 系统总体架构与拓扑规范 (Local-First System Topology)

v0.1 采用**单一真实执行模式：本地 Daemon + localhost Web UI**。浏览器只承担交互呈现，不维护另一套虚拟仓库、不模拟测试结果。CLI 负责发现/启动 Daemon、选择仓库和提供诊断入口；Daemon 是本机文件、Git、命令执行、合同状态与 Evidence 的唯一权威。

```
+----------------------------------------------------------+
| Localhost Web UI                                         |
| Scope Radar | Contract & Budget | Diff | Evidence Sheet  |
| External editor launch (Cursor / VS Code, user-configured)|
+-------------------- WebSocket / localhost API -----------+
| Stagent CLI + Local Daemon                                |
| Contract state | Scope gateway | Cost guard | Audit store  |
| File dependency index | Process runner | Git Worktree     |
+----------------------------+-----------------------------+
                             |
       +---------------------+---------------------+
       |                                           |
       v                                           v
 Real local repository + Git              Approved local commands
 Task Worktree + shared dependency cache  Tests/build tools + explicit env
```

| 维度 | v0.1 决策 |
|---|---|
| 权威运行时 | 本地 Daemon；Web UI 断线不应导致任务授权状态丢失 |
| 文件/依赖模型 | 真实本地文件与文件级 import/export 索引；不提供浏览器虚拟文件系统 |
| Git | 真实 Git CLI 与独立 Worktree；不切换或直接修改用户当前主工作树 |
| 编辑体验 | Stagent 显示 Scope、合同、Diff、Evidence；代码编辑委托给外部编辑器 |
| 协议 | 默认仅绑定 loopback；WebSocket/API 校验本地会话令牌与来源，拒绝非本机访问 |
| 容错边界 | Daemon 重启后从 `.stagent/` 恢复合同状态；UI 可重连并重新读取权威状态 |

## 2. 核心模块与分层职责 (Layered Architecture)

### 2.1 UI 交互层 (Presentation Layer)
- **技术栈**：TanStack Start / React 19 + TypeScript + Tailwind CSS + shadcn/ui。
- **架构地图**：基于 **Cytoscape.js** 配合复合节点（Compound Nodes），支持搜索、缩放与按目录层级折叠。
- **变更审阅与外部编辑器**：提供文件级 Side-by-Side / Inline Diff、行号与变更定位；提供按用户配置模板启动外部编辑器的入口。代码编辑不在 Web UI 内完成。
- **三大主控视窗**：
  1. **左侧文件树与架构感知区**：上方为工作区物理树，下方为增量渲染的架构拓扑图。
  2. **中间变更审阅与审计区**：展示 Diff、门禁诊断和 Evidence；代码编辑由外部编辑器完成，审阅区域不提供内嵌 IDE。
  3. **右侧双 Agent 交互区**：
     - **主对话流**：人机协同主线（需求分析、合同草案签署、最终证据核销）。
     - **Worker 执行胶囊**：折叠/展开 Coding Worker 的实时工具调用轨迹、MCP 权限消耗统计与阶段性产出。

### 2.2 守护进程核心运行时 (Stagent Daemon Runtime)
- **Incremental Arch Engine（增量架构引擎）**：管理模块有向无环图（DAG），利用失效传播算法实现局部毫秒级拓扑重算。
- **Contract Engine（合同引擎）**：驱动合同生命周期状态机流转，负责 `.stagent/contracts/` 目录的持久化与长任务断点快照。
- **Scoped MCP Gateway（安全网关）**：Agent 与宿主环境唯一的 I/O 隔离屏障，强制执行路径作用域校验、修改预算限制与命令白名单。
- **Git Guard Engine（Git 卫士）**：控制 Task Worktree 生命周期、工作区脏状态检查、防污染独立隔离挂载以及原子核销合并。
- **受限进程执行器（Process Runner）**：按合同白名单执行构建命令、类型检查与自动化测试，并实施可用的超时、环境筛选与网络策略。它不构成对抗性沙箱，不能保证阻止任意子进程进行主机级操作。

---

### 2.3 外部编辑器启动与降级行为

- 用户可配置安全的编辑器启动模板（例如 `code --reuse-window {file}:{line}`、`cursor --reuse-window {file}:{line}`、`webstorm {project}`）；模板变量仅由 Stagent 对路径参数化替换，禁止经 shell 拼接执行未经校验的输入。
- 启动目标必须是当前任务 Worktree 的**规范化绝对路径**，不得默认为主工作树同名文件。UI 在任务视图持续展示仓库名、Contract ID 与 Worktree 路径/分支，避免误编辑主工作区。
- 如果命令未配置、可执行文件不存在、协议无法启动或操作系统不支持自动打开，显示“复制 Worktree 绝对路径”操作；复制失败时仍显示可选择文本路径。外部编辑器不是核心闭环的硬依赖。
- 启动成功仅表示进程/协议调用被操作系统接受，不代表文件已成功打开；不得把“成功打开编辑器”作为合并门禁。
- **验收**：测试目标路径严格指向任务 Worktree；覆盖 Cursor/VS Code 风格模板、自定义模板、未安装、路径含空格/Unicode、恶意模板输入、复制降级和主工作树同名文件场景。

## 3. 架构感知与增量拓扑引擎 (Ambient Architecture Engine)

### 3.1 本地文件变更监听机制 (Local File Watching)

v0.1 文件监听仅由本地 Daemon 的 OS 文件监听器承担（例如 Node `chokidar` 或 Rust `notify`）；浏览器 UI 不维护虚拟文件系统，也不触发独立的文件解析/依赖图计算。
- **监听范围**：仓库源码与活跃任务 Worktree 中的 `src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`；语言扩展列表由配置显式声明。
- **忽略范围**：`node_modules/`、`.git/`、`dist/`、`build/`、`.stagent/`、`coverage/`、临时文件及用户配置的忽略规则。
- **活跃 Worktree**：Daemon 必须监听当前任务 Worktree；收到 watcher 事件后做路径规范化、去重与防抖，再更新该 Worktree 的文件哈希、Diff 和依赖图。
- **外部编辑器写入**：Cursor/VS Code 等进程对活跃 Worktree 的写入与 Agent 写入走相同失效流程。 watcher 延迟或丢事件时，执行验收前必须通过文件系统快照与 Git 状态复核，不能依赖 watcher 单独保证一致性。
- **验收**：创建、修改、删除文件分别触发对应增量更新；活跃 Worktree 外部修改后一个配置的 watcher debounce 窗口内 UI 更新；即使 watcher 丢事件，验收前快照比较仍能发现差异并使旧 Evidence 失效。

### 3.2 失效传播规则与拓扑局部修补算法 (Invalidation Propagation)
拓扑图在内存中维护为有向图 $G = (V, E)$，其中节点 $V$ 为模块文件，边 $E = (u, v)$ 表示 $u$ 引用了 $v$（$u \to v$）。

```
        [C.ts] ──► [B.ts] ──► [A.ts] (Edited)
          │
          ▼
        [D.ts]
```

1. **叶子节点编辑（无导出签名变化）**：
   - 规则：文件 $A$ 内部实现修改，但其对外 `export` 符号签名集合保持不变。
   - 传播范围：**仅重算节点 $A$** 的语法状态与代码行指标，**不向调用方传播**。
2. **导出接口变化（Export Signatures Changed）**：
   - 规则：文件 $A$ 新增、删除或重命名了导出符号，或依赖路径发生修改。
   - 传播范围：触发直接依赖方（$B$）重新解析引用；若 $B$ 的对外导出也发生变化，顺沿依赖链递归向上失效（$B \to C$）。
3. **文件删除（File Deleted）**：
   - 从图 $G$ 中移除节点 $A$ 及关联边；所有直接引用 $A$ 的上游节点标记为 `UNRESOLVED_IMPORT` 告警态。
4. **文件新增（File Added）**：
   - 仅解析新节点 $A$ 及其引用的下游节点并在图上插入；上游已标记未解析引用的节点触发二次绑定检查。

### 3.3 增量更新验收指标 (Performance Metrics)
- **全量冷启动索引基线**：1000 个模块的全量初次 AST 依赖抽取耗时 $\le 1.5\text{s}$。
- **增量解析延迟**：单文件微调时，增量 AST 抽取与局部边关系更新耗时 $\le 20\text{ms}$。
- **图重渲染帧率**：局部更新拓扑时，Cytoscape 局部 patch 时间 $\le 16\text{ms}$（保持 60 FPS 无卡顿）。
- **内存占用**：1000 节点规模工程中，拓扑缓存内存常驻 $\le 30\text{MB}$。

### 3.4 搜索、缩放与分层折叠交互规范（辅助 Scope 划定）
1. **多级平滑缩放与 Mini-map**：支持滚轮无级缩放与一键居中（Fit Selection）；右下角展示迷你鹰眼图。
2. **按目录分层折叠（Compound Grouping）**：
   - 默认根据文件路径的前两层目录（如 `src/services/`, `src/components/`）进行物理包裹分组；
   - 点击文件夹图标折叠为“聚合节点（Compound Node）”，展示内部文件总数与跨模块出入度总和；双击展开子图。
3. **模糊搜索与动态高亮**：搜索框模糊匹配文件路径与导出函数名；命中节点高亮，其余节点降为 20% 透明度。
4. **辅助划定 Scope 交互机制**：
   - **一键圈定**：在拓扑图上框选一组节点或右键文件夹节点，选择“加入 Writable Scope”或“设为 Strictly Forbidden”；
   - **视觉对齐**：当前合同 `writable_paths` 范围内的节点高亮为翠绿色边框；`strictly_forbidden_paths` 节点覆盖醒目红色禁止斜纹；只读节点呈淡灰色；
   - **安全预览**：在合同审批前，用户一眼即可看清“此次 Coding Worker 是否触碰到了任何高风险/非预期的边界模块”。

---

## 4. Scoped MCP 安全网关与沙箱规范 (Security & MCP Protocol)

Coding Worker 无论由内置模型驱动还是外部 Agent 接入，**严禁直连宿主原生 Shell 与未受限文件系统**，必须通过 Stagent Scoped MCP Server。

### 4.1 MCP 工具集完备定义 (Tool Inventory)

```typescript
export interface ScopedMCPTools {
  // 1. 读取文件（受限）
  stagent_read_file(params: { path: string }): Promise<{ content: string; hash: string; truncated: boolean; binary: boolean }>; // 默认最多 1 MiB；二进制仅返回元数据，不解码为文本

  // 2. 写入文件（受限与预算管控）
  stagent_write_file(params: { 
    path: string; 
    content: string; 
    expected_hash?: string; // 乐观锁防止并发冲突
  }): Promise<{ success: boolean; bytes_written: number; budget_remaining: number }>;

  // 3. 列出目录（隐私路径自动脱敏）
  stagent_list_dir(params: { path: string; recursive?: boolean }): Promise<{ entries: DirEntry[] }>;

  // 4. 白名单受限命令执行
  stagent_exec_command(params: { 
    command_alias: string; // 仅接受合同中授权的命令别名，例如 "test:unit", "lint"
    args?: string[];
  }): Promise<{ exit_code: number; stdout_tail: string; stderr_tail: string; truncated: boolean; secret_redacted: boolean; duration_ms: number }>; // 有界尾部输出，先脱敏后截断

  // 5. 声明意图完成
  stagent_declare_complete(params: { summary: string }): Promise<{ ready_for_audit: boolean; blockers: Array<{ code: string; message: string }> }>; // Daemon 按 Scope、预算、验证结果与快照一致性判定
}
```

### 4.2 越界防御、预算熔断与 BLOCKED 判定
1. **路径规范化防穿透（Path Traversal Guard）**：
   - 所有传入 `path` 必须经过绝对路径解析与符号链接解析（`realpath`），禁止使用 `../` 跳出工程工作区。
   - 匹配优先级：`strictly_forbidden_paths`（匹配即绝杀）> `writable_paths`（精确/Glob 匹配）> 默认只读/拒绝。
2. **预算配额熔断（Budget Quotas）**：
   - `max_file_modifications`：每次任务允许修改的唯一文件总数（超过上限立即熔断，抛出 `E_BUDGET_EXCEEDED`）。
   - `max_total_diff_lines`：最大累计变更代码行数，防止大模型发生幻觉全仓重写。
   - `budget_limits.max_duration_seconds`：单个合同/Worker 任务的总运行时长上限；超时自动中断 Worker。各验证命令另有独立的 `verification_spec.commands[].timeout_seconds` 上限，任一单命令超时均立即终止该命令。
3. **Evidence `BLOCKED` 状态触发判定**：
   当任务在执行前或执行中发生下列安全违规时，网关立即强行中止执行，生成的证据包 `verdict.status` 标记为 `BLOCKED`（而非普通的测试失败 `FAILED`）：
   - 尝试修改命中了 `strictly_forbidden_paths` 的文件；
   - 累计修改文件数或行数耗尽了预算上限（`budget_exhausted: true`）；
   - 尝试执行未经白名单授权的命令别名；
   - 触发了仓库全局并发互斥锁冲突（错误码 `E_WORKSPACE_LOCKED`，Evidence 原因码 `WORKSPACE_LOCKED`）。

   对合同状态的处理：费用/Token 硬上限耗尽或验证重试达到上限时，合同进入 `PENDING_RESUME`，仅在用户修改预算或明确启动新验证轮次并重新批准后恢复；`SCOPE_VIOLATION`、`UNAUTHORIZED_COMMAND` 等授权/安全边界违规会中止当前执行并将合同置为 `ABORTED`，不可在原审批版本上直接 resume。用户需修订范围/命令并重新审批后创建新合同或新审批版本。所有上述安全门禁均生成 `BLOCKED` Evidence。

---

### 4.2.1 合同级 Token/费用预算熔断

任务授权必须展示 Token 上限与费用上限（默认值由产品配置提供，用户可降低或提高后重新批准）。供应商支持时，在每次模型调用前预留可能费用，并以实际 usage 回执结算；无法取得精确 usage 时采用明确标注的估算和保守预留。任一硬上限达到时，立即禁止新的模型调用、记录 `BUDGET_EXHAUSTED`、保存当前状态并转入 `PENDING_RESUME`/阻断状态。恢复必须由用户提高或重设预算并重新批准；不得因重试、Daemon 重启或供应商切换重置累计值。工具与命令预算也应分别记录，避免把模型费用上限误认为计算命令限制。

### 4.2.2 连续验证失败熔断 (Verification Loop Guard)

- 合同 `max_verification_retries` 表示验证失败后允许的自动修复重试次数；连续相同验证命令失败达到该值后，停止 Worker 自动修复并将合同置为 `PENDING_RESUME`，Evidence 标记 `BLOCKED`，原因码为 `VERIFICATION_RETRY_LIMIT`。
- 默认值为 3 次，可由用户在审批前调整；只有重新审批后的合同版本才能提高该值。重启、切换模型或重复执行同一失败命令不得重置计数。用户手动修改代码后，可由用户显式选择新一轮验证；审计记录保留前一轮失败计数与结果。
- 每次失败都以命令别名、命令/参数摘要、退出码和轮次记录；不得把不同验证命令的失败混算成同一个循环，也不得用重新命名命令绕过合同策略。
- **通过判据**：在配置上限内允许修复重试；达到上限后没有新的 Agent 工具/模型调用，状态与 Evidence 可恢复且计数不归零。
- **失败判据**：上限后仍发起自动修复/模型调用，或恢复/改名命令可重置计数。

### 4.2.3 本地执行威胁模型与拒绝条件

v0.1 的 Scoped MCP、路径校验、环境筛选和普通 OS 子进程限制主要防止意外越界，不构成对抗性代码的安全沙箱。以下场景必须拒绝自动执行，或要求用户明确选择独立 Docker/VM/外部隔离环境：不可信仓库或 Agent、需特权/内核操作的命令、需要访问任意主机路径/凭据的脚本、无法可靠限制子进程树/网络的高风险命令。

- **超时验收**：到时向进程组发送终止信号，宽限期后强制杀死进程树；确认无后代进程继续存活。Windows 使用对应 Job Object/进程树终止机制，不能只写 Unix `SIGKILL`。
- **路径验收**：写操作验证规范化路径和符号链接最终目标；使用可避免检查-使用竞态的文件操作方式或在操作后复核；路径检查只对 Stagent 工具写入有效，不能虚称能阻止绕过工具的任意子进程写文件。
- **失败判据**：界面或文档将本地进程限制描述为“彻底杜绝”攻击；高风险命令未拒绝/未外置隔离；超时后残留子进程。

### 4.3 测试环境、秘密与网络访问边界 (Local Test Environment)

- 默认命令环境不继承完整宿主环境；Daemon 只传递系统运行所需的最小变量，合同按命令显式声明允许的环境变量名。
- `.env.test` / `.env.local` 不是自动暴露给模型的上下文。若本地测试需要其中的变量，用户需按变量名或受控 env-file 显式授权给指定验证命令；秘密值不得写入 Prompt、合同正文、UI 日志或 Evidence 输出。
- stdout/stderr 在保存和展示前应对已知秘密值做遮蔽；遮蔽不等于可靠的秘密防泄露边界，因此不得把宿主密钥交给不可信代码或模型。
- 网络默认按命令策略关闭或限制；需要外网的集成测试必须在合同中声明用途、目标范围和授权方式。v0.1 不提供通用网络隔离保证，不得把本地进程封装表述为抵御恶意代码的强沙箱。
- 验证命令默认注入 `CI=true`；端口由命令合同显式策略控制。只有命令/测试框架确认支持时，才分配并注入动态空闲端口；不得盲目固定 `PORT=0`（部分服务不支持）或假定所有测试会读取 `PORT`。主机已占用端口必须使命令启动失败并给出可诊断结果，不能误报为测试断言失败。
- 对超出可信本地开发任务威胁模型的代码，应拒绝运行或要求用户在独立容器/虚拟机中执行；这是明确的安全限制，不可用路径巡检替代 OS 级隔离。

## 5. Git 真实分支生命周期与原子核销 (Git Workspace Guard)

### 5.1 Worktree 物理隔离拓扑
为了防止 Coding Worker 在并发修改或运行测试时污染用户当前的工作目录，Stagent 在工程模式下采用 **Git Worktree 隔离机制**：

```
[User Active Workspace] (On branch: main, clean or dirty)
           │
           │ (1) Contract Approved 触发
           ▼
[Git Guard Engine] ──► 从 `authorization.git.base_branch` 执行 `git worktree add -b task/{contract_id} <repo_root>/.stagent/worktrees/task-{contract_id} <base_branch>`；所有路径均先规范化为绝对路径
           │
           ▼
[.stagent/worktrees/task-{contract_id}] (独立物理目录，专供 Worker 修改与测试运行)
           │
           │ (2) 验证门禁全部通过，用户点击核销
           ▼
[Atomic Squash Merge] ──► 回到主工作区执行原子 Squash Commit 写入主干
           │
           ▼
[Cleanup] ──► 执行 `git worktree remove --force <repo_root>/.stagent/worktrees/task-{contract_id}`
```

### 5.2 Commit 元数据追溯规范 (Audit Traceability)
所有通过 Stagent 合入主干的 Commit 必须包含结构化 Trailer，以实现全生命周期安全审计追溯：

```
feat(order): add idempotency token check for checkout API

Closes #1024
Reviewed-By: Tech Lead Agent (Claude-3.7-Sonnet)
Stagent-Contract-ID: ctrt_9f82d1a4e0
Stagent-Evidence-ID: evid_3b819e07f2
Stagent-Verdict: PASSED (Test exit code: 0, Scope violations: 0)
```

合并核销完成后，系统安全注销并移除任务工作树，并在仓库中永久留存合同快照 `.stagent/contracts/{contract_id}.json` 与证据快照 `.stagent/evidence/{contract_id}-{evidence_id}.json`，确保全生命周期可追溯性与离线审计。

---

### 5.3 Worktree 依赖可用性与安全复用策略

依赖复用不能把“主目录 node_modules 只读”与“构建工具缓存可写”混为一谈。v0.1 按包管理器与平台执行可验证策略：
1. **首选内容寻址缓存**：pnpm store、npm cache、Yarn cache 等由包管理器管理的共享缓存可复用；执行前核对锁文件、包管理器版本和项目配置。
2. **node_modules 复用**：可为只读任务提供主目录依赖的只读视图/链接，但不得将写操作导向主目录 `node_modules`。Worktree 中 `.cache`、`.vite`、测试临时目录等可写缓存必须重定向到 Worktree 独立路径；若工具无法可靠重定向，则使用隔离安装目录。
3. **链接风险**：普通符号链接本身不提供只读边界；不能仅凭 `chmod` 宣称跨平台只读。若操作系统/文件系统不能保障写保护，需采用文件系统权限、只读挂载或独立副本，并验证链接目标写保护；无法证明则禁用共享 `node_modules`。
4. **安装和依赖变更**：新增/升级依赖必须获得单独授权并仅在任务隔离目录安装；不得改写主工作树的 manifest/lockfile。共享缓存可能被安装脚本写入时，改用隔离缓存或拒绝自动安装。
5. **验收**：覆盖至少一种支持平台与包管理器的构建/测试；验证缓存写入落在 Worktree；在受控测试中尝试写共享依赖应失败且主工作区校验和不变；策略不可用时出现可操作提示并能隔离安装/暂停。

## 6. 关键时序交互、异常分支与自愈机制 (Sequence & Error Recovery)

### 6.1 Client-Daemon 通信协议 (WebSocket Protocol)
- **传输层**：WebSocket（本地默认绑定 `ws://127.0.0.1:41792`），握手通过 `Authorization: Bearer <session_token>` 校验。Token 单独写入 `.stagent/session-token`（权限 `0600`，仅当前用户可读写）；`.stagent/stagent.pid` 仅保存 PID 与端口等非秘密运行元数据。Daemon 获得 PID 锁后轮换 Token；退出时尽力删除 Token 文件，崩溃残留的 Token 在下次成功启动后立即失效并轮换。未授权连接即刻断开并记入安全审计日志。
- **心跳机制**：每 5 秒发送一次 `PING`，Daemon 回 `PONG`；连续 3 次（约 15 秒）无回应后触发前端“断线重连”遮罩。此为预期最坏检测延迟，长任务仍通过独立 `WORKER_LOG`/状态帧保持可观测。鉴权在 WebSocket Upgrade 握手 HTTP Header 完成，不额外发送明文 Token 帧。
- **消息帧标准格式**：
  ```json
  {
    "trace_id": "trc_88a91c",
    "type": "CONTRACT_UPDATE" | "WORKER_LOG" | "SCOPE_ALERT" | "EVIDENCE_READY" | "PING" | "PONG" | "ERROR",
    "timestamp": 1776510000000,
    "payload": {}
  }
  ```
- `PING`、`PONG` 与 `ERROR` 均使用同一消息帧结构；握手鉴权失败由 HTTP Upgrade 拒绝（401/403），不进入已鉴权消息帧。`ERROR.payload` 至少包含稳定 `code` 与不含秘密的 `message`。

### 6.2 正常交互时序图 (Happy Path Sequence)

```
User (UI)             Tech Lead Agent        Stagent Daemon           Coding Worker       Git / Sandbox
   │                        │                       │                       │                   │
   │─── 1. 发起自然语言意图 ─►│                       │                       │                   │
   │                        │─── 2. 编译出合同草案 ──►│                       │                   │
   │◄── 3. 呈现合同审批卡片 ─│                       │                       │                   │
   │                        │                       │                       │                   │
   │─── 4. 点击 Approve ───────────────────────────►│                       │                   │
   │                                                │── 5. 创建 Worktree ──────────────────────►│
   │                                                │   git worktree add task/{contract_id}     │
   │                                                │── 6. 激活 Scoped MCP 网关                 │
   │                                                │── 7. 调度启动 ───────►│                   │
   │                                                │                       │── 8. 写代码 ─────►│ (受限隔离写)
   │                                                │                       │   (MCP Write)     │
   │                                                │                       │── 9. 执行测试 ───►│ (白名单命令)
   │                                                │◄── 10. 声明完成 ──────│                   │
   │                                                │── 11. 执行最终门禁 ──────────────────────►│
   │                                                │    (Verify Scope, Run Suite)              │
   │                                                │◄── 12. 捕获真实退出码与输出 ───────────────│
   │◄── 13. 呈现 Evidence Bundle 证据卡片 ──────────│                                           │
   │                                                │                                           │
   │─── 14. 用户点击 Squash Merge 核销 ────────────►│                                           │
   │                                                │── 15. 合并主干并打入审计 Commit ─────────►│
   │                                                │── 16. 清理 Worktree 与释放锁 ────────────►│
   │◄── 17. 提示合入成功，刷新架构地图 ─────────────│                                           │
```

### 6.3 异常分支详述与状态恢复 (Exception Branches & Recovery)

#### 异常 1：并发工作区锁竞争 (Repository Lock Contention)
- **场景**：用户在前一个任务尚未核销或正在执行时，尝试批准另一个影响相同分支的合同。
- **处理要求**：Daemon 内置内存互斥锁 `workspace_lock`。发现冲突立即返回 `E_WORKSPACE_LOCKED`，证据标记为 `BLOCKED`，前端弹窗提示“已有任务 task-xxx 正在执行中，请等待其核销或主动撤销”。

#### 异常 2：宿主工作区存在未提交改动 (Dirty Working Tree on Main)
- **场景**：主工作区存在未提交改动。`git worktree add` 从指定的已提交基准 HEAD 创建任务 Worktree；主工作区未提交改动不会自动带入任务 Worktree，也不会仅因此造成分支冲突。真实风险是用户误以为这些改动已包含在任务中。
- **处理要求**：创建前执行 `git status --porcelain`。若检测到未提交改动，明确提示“这些改动不会包含在任务 Worktree 中”，并允许用户在确认后继续；不得隐式复制改动或执行 `git reset`。若所需文件尚未提交，用户可自行提交或显式另行纳入合同基准。

#### 异常 3：验证命令或任务执行超时 (Command/Task Timeout)
- **场景**：Coding Worker 产生死循环，或测试命令持续等待网络响应。
- **处理要求**：
  1. 每条验证命令分别遵循 `verification_spec.commands[].timeout_seconds`（单命令上限）；合同整体执行还遵循 `authorization.budget_limits.max_duration_seconds`（任务总时长上限）。两者独立计时，任一达到即中止相应命令/任务；
  2. 单命令超时 `timeout_seconds` 默认 60s（合同未声明时）；任务总时长 `max_duration_seconds` 默认 1800s（30 分钟，若未另行显式配置），避免长时间编码与验证正常耗时被提前误杀。任一超时触发向进程组发送 `SIGTERM`，宽限 3s 后若未退出则终止整个进程树（Windows 使用 Job Object/等效机制）；
  3. 证据包 `verdict.status` 标记为 `FAILED`，命令退出码记录为 `124`，并记录 `E_TIMEOUT` 摘要及触发字段名，推送到前端卡片展示。

#### 异常 4：Daemon 崩溃或网络断连重启自愈 (Crash Recovery)
- **恢复状态机**：
  1. Daemon 启动并获取 PID 锁后，自动扫描 `.stagent/contracts/` 目录与 `.stagent/evidence/` 目录；
  2. 检索处于未决中间态（`PREPARING`、`EXECUTING`、`VERIFYING`）的悬空合同；
  3. 执行 `git worktree list`，比对是否存在对应的 `.stagent/worktrees/task-{contract_id}`；
  4. 若合同处于 `PREPARING`，说明工作树创建或依赖挂载中断：执行安全清理并注销半成品 Worktree，将合同回退为 `PENDING_APPROVAL` 或置为 `ABORTED`（原因码 `PREPARATION_INTERRUPTED`），供用户重新发起；
  5. 若合同处于 `EXECUTING` 或 `VERIFYING` 且 Worktree 存在，读取最新 Git Patch、执行日志快照与已累计费用，将合同状态机 `lifecycle_state` 置为 `PENDING_RESUME`，等待用户在控制台显式确认继续或放弃；若 Worktree 物理丢失，则安全置为 `ABORTED`（原因码 `WORKTREE_LOST`）；
  6. 自动扫描并执行 `git worktree prune`，清除无有效合同关联的孤儿工作树。

---

## 7. 前端交互与组件级质量测试规范 (Component Testing & Regression)

### 7.1 Scope / Active / Cycles 视图过滤测试用例矩阵

```typescript
describe("ArchitectureMap View Filters", () => {
  // 用例 1：Scope 过滤视图
  test("当勾选 Scope 过滤器时，仅渲染合同授权与禁止范围内的节点", async () => {
    // 渲染包含 10 个节点的拓扑图，当前合同仅包含 2 个 writable 和 1 个 forbidden
    render(<ArchitectureMap contract={mockContract} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Scope Only" }));

    // 断言：统一相对路径选择器，无关节点被隐藏
    expect(screen.queryByTestId("node-src/utils/unrelated.ts")).not.toBeInTheDocument();
    expect(screen.getByTestId("node-src/modules/order/OrderService.ts")).toHaveClass("border-green-500");
    expect(screen.getByTestId("node-src/modules/payment/PaymentClient.ts")).toHaveClass("pattern-forbidden-stripes");
  });

  // 用例 2：循环依赖 Cycles 过滤视图
  test("当勾选 Cycles 过滤器时，精准高亮成环路径并标记警示色", async () => {
    render(<ArchitectureMap initialFiles={filesWithCycle} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Cycles" }));

    expect(screen.getByTestId("badge-cycle-count")).toHaveTextContent("1 Cycle Detected");
    expect(screen.getByTestId("edge-src/A.ts->src/B.ts")).toHaveClass("stroke-red-500 animate-pulse");
    expect(screen.getByTestId("edge-src/C.ts->src/A.ts")).toHaveClass("stroke-red-500 animate-pulse");
  });

  // 用例 3：Active 变更节点高亮
  test("Active 过滤器正确仅呈现本次 Task 产生 Diff 的文件节点", async () => {
    render(<ArchitectureMap changedFiles={["src/modules/order/OrderService.ts"]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Active Only" }));

    expect(screen.getByTestId("node-src/modules/order/OrderService.ts")).toBeVisible();
    expect(screen.queryByTestId("node-src/common/Unchanged.ts")).not.toBeInTheDocument();
  });
});
```

### 7.2 拓扑节点、Diff 与外部编辑器联动测试

```typescript
describe("Architecture map and external editor handoff", () => {
  test("clicking a node shows its path and opens the matching Diff", async () => {
    // Given a task worktree node, selecting it shows the relative path and task Diff
    expect(screen.getByTestId("diff-file-src-orders-service.ts")).toBeVisible();
  });

  test("editor launch uses the active contract worktree absolute path", async () => {
    await user.click(screen.getByRole("button", { name: /open in editor/i }));
    expect(launchEditor).toHaveBeenCalledWith(expect.objectContaining({
      filePath: expect.stringContaining("/.stagent/worktrees/task-contract-123/src/"),
    }));
    expect(screen.getByText(/task-contract-123/i)).toBeVisible();
  });

  test("editor unavailable falls back to copying the absolute worktree path", async () => {
    launchEditor.mockRejectedValueOnce(new Error("editor unavailable"));
    await user.click(screen.getByRole("button", { name: /open in editor/i }));
    expect(writeClipboard).toHaveBeenCalledWith(expect.stringContaining("/.stagent/worktrees/task-contract-123/"));
    expect(screen.getByRole("status")).toHaveTextContent(/path copied|copy path/i);
  });

  test("external edit invalidates prior evidence and requires verification again", async () => {
    await emitWatcherEvent("change", "src/orders/service.ts");
    expect(contractStore.getEvidence().verdict.status).toBe("STALE");
    expect(contractStore.canMerge()).toBe(false);
    expect(screen.getByText(/verification required/i)).toBeVisible();
  });
});
```

**关键回归用例**：任务 Worktree 与主工作树存在同名文件时，编辑器只能收到 Worktree 绝对路径；未配置/未安装编辑器时仍可完成 Scope、Diff、Evidence 与合并流程；外部新增/删除/改动后旧 Evidence 不能通过核销门禁。

### 7.3 Scope、预算与执行失败门禁回归

- 未批准合同不得调用 `stagent_exec_command` 或模型工具。
- 越权写入/符号链接穿透、费用硬限额耗尽、连续验证失败达到上限，均阻止后续 Agent 调用并禁止合并。
- Daemon 重启、模型切换、命令别名变化不得重置累计费用或重试计数。
- 测试命令退出码非零、超时后进程树未清理、Evidence 与当前 Worktree 快照不一致，均不可核销。
- 预算来源无法提供精确账单时，界面须标记 ESTIMATED/UNAVAILABLE 并采用保守预留，不得显示为精确实际费用。

## 8. 架构决策记录 (Architecture Decision Records, ADR)

### ADR-001：首版运行形态与产品定位
- **状态**：ACCEPTED (v0.1)
- **背景**：目标用户为独立开发者/外包工程师；双模态增加重复维护。
- **决策**：Local-First CLI + localhost Web UI + 本地 Daemon；不实现浏览器虚拟文件系统/Mock 执行路径。
- **备选与取舍**：Playground 双模态降低初次试用门槛但引入执行差异；纯 CLI 缺少范围可视化；选择本地 Daemon 与 Web UI 的单一真实运行时。
- **后果**：安装 CLI 是 v0.1 前置条件；零安装 Playground 不在首版范围。

### ADR-002：真实 Git Worktree 与依赖复用
- **状态**：ACCEPTED (v0.1)
- **背景**：任务需隔离，但新 Worktree 可能缺少依赖；软链接不天然只读。
- **决策**：真实 Worktree；优先复用包管理器内容寻址缓存。仅在验证写保护与缓存隔离后允许只读依赖视图；不能证明写保护时禁用共享 node_modules，改用隔离安装或暂停。
- **备选与取舍**：直接改主工作树不安全；每次完整复制安装成本高；Worktree + 可验证缓存/只读策略在隔离和速度间折中。
- **后果**：不得声称所有系统上可零成本安全共享依赖；支持矩阵需按平台/包管理器验证。

### ADR-003：执行权限、测试秘密与本地安全边界
- **状态**：ACCEPTED (v0.1，非对抗性安全边界)
- **背景**：真实项目可能需要 `.env.test`、网络或安装脚本；普通本地子进程无法提供容器级隔离。
- **决策**：命令按合同授权，最小环境变量，测试秘密只按命令显式注入且不进入模型上下文；对不可信代码、主机级操作和无法限制的高风险任务拒绝自动执行或要求用户外置 Docker/VM 隔离。
- **备选与取舍**：继承所有权限风险过高；一律禁网会阻断部分测试；显式授权可用但必须标明信任边界，不能宣传为强沙箱。
- **后果**：秘密遮蔽不是隔离保证；本地威胁模型限制属于发布说明必备内容。

### ADR-004：成本上限与用量核算
- **状态**：ACCEPTED (v0.1)
- **决策**：调用前预算预留、供应商 usage 回执累计；任一硬上限达到即禁止新模型调用并暂停。供应商用量不精确时标明估算并保守预留。
- **验收/失败判据**：重启、重试、切换模型不清零；达到上限后不产生新调用；实际/估算/不可用状态明确区分。若仍继续调用则失败。

### ADR-005：代码编辑体验
- **状态**：ACCEPTED (v0.1)
- **决策**：控制台负责 Scope、Diff、Evidence；代码由用户配置的外部编辑器修改。启动目标必须是当前任务 Worktree 绝对路径；不可用时降级为复制路径。
- **备选与取舍**：自研 IDE 维护成本高；纯 CLI 缺少审计体验；外部编辑器链接保持熟悉编辑体验而不扩大首版职责。
- **验收/失败判据**：主工作树同名文件不得作为目标；路径含空格/Unicode 安全传递；编辑器不可用不阻断闭环。

### ADR-006：本地持久化与存证可信度
- **状态**：ACCEPTED (v0.1)
- **背景**：本地单人产品应易备份、可读、低依赖；本地 JSON 文件不能被视为防篡改企业审计存证。
- **决策**：合同、状态、审计事件和 Evidence 持久化至 `.stagent/` 结构化文件；记录 Git SHA、任务分支、验证命令和 Diff 指纹，以帮助追踪。明确这些摘要提供一致性检查，不构成防篡改签名。
- **备选方案**：A) 纯内存；B) 本地结构化文件；C) 数据库/远程签名审计服务。
- **取舍**：选择 B。A 无法恢复；C 对单人首版增加维护与部署负担；B 易检查、备份，但不能提供对抗本地篡改的合规保证。
- **后果**：用户应可备份/导出；企业合规签名与远程审计属于后续版本。

## 9. 数据模型增强定义 (Enhanced Schemas)

### 9.1 软件合同 Schema (v1.1.3)
```typescript
export interface SoftwareContractV11 {
  contract_id: string;
  schema_version: "1.1.3";
  created_at: string;
  creator: "user" | "tech_lead";
  
  // 顶层全生命周期状态机枚举（与第 6 章自愈时序严格对齐）
  lifecycle_state: 
    | "DRAFT"              // 草案生成中
    | "PENDING_APPROVAL"  // 等待用户审批
    | "PREPARING"         // 创建 Worktree、配置 Scoped MCP
    | "EXECUTING"         // Worker 编码执行中
    | "VERIFYING"         // 门禁测试与 Scope 校验中
    | "PENDING_RESUME"    // 异常断电/重启等待用户恢复断点
    | "AUDITED"           // 门禁通过，生成 Evidence Bundle 等待核销
    | "MERGED"            // 用户核销入主干，清理现场完成
    | "ABORTED";          // 用户驳回或安全熔断终止

  intent: {
    title: string;
    description: string;
    acceptance_criteria: string[];
    risk_level: "LOW" | "MEDIUM" | "HIGH";
  };

  authorization: {
    git: {
      base_branch: string;
      task_branch: string;
      target_branch: string;
      use_worktree: boolean;
    };
    file_system_scope: {
      writable_paths: string[];           // Glob 规则数组
      readonly_paths: string[];
      strictly_forbidden_paths: string[];
    };
    budget_limits: {
      max_file_modifications: number;
      max_total_diff_lines: number;
      max_duration_seconds: number; // 合同/Worker 总执行时长上限，与单命令 timeout_seconds 独立
      max_agent_turns?: number;
      max_verification_retries: number; // 连续相同验证失败后自动修复的最大重试数；默认 3
    };
    cost_limits: {
      max_input_tokens?: number;
      max_output_tokens?: number;
      max_cost_minor_units: number;
      currency: string;
      pricing_version: string;
      accounting_mode: "PROVIDER_REPORTED" | "ESTIMATED";
    };
    execution_permissions: {
      allowed_commands: string[];
      allowed_environment_variable_names: string[];
      network_policy: "DENY" | "EXPLICIT_TARGETS" | "USER_APPROVED";
      dependency_changes_allowed: boolean;
      editor_command_template?: string; // 用户配置；参数化替换，禁止不安全 shell 拼接
      env_file_grants?: Array<{
        file: string; // 受控的 env 文件路径，例如 .env.test 或 .env.local
        command_aliases: string[];
        variable_names: string[];
      }>;
      port_policy?: "NONE" | "DYNAMIC_IF_SUPPORTED" | "EXPLICIT";
    };
  };

  verification_spec: {
    commands: Array<{
      alias: string;
      executable: string;
      args: string[]; // 已分离 argv；禁止 shell 字符串解析/拼接
      expected_exit_code: number;
      timeout_seconds: number; // 单命令上限；与合同总时长 max_duration_seconds 独立
      working_directory?: string;
    }>;
  };

  approval: {
    status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
    approved_by?: string;
    approved_at?: string;
    rejection_reason?: string;
  };
}
```

### 9.1.1 合同生命周期与审批子状态联动规则

`lifecycle_state` 与 `approval.status` 是两个相关但不等价的状态机。Schema 校验必须拒绝违反下表的组合；状态变更必须由合同引擎原子写入，避免崩溃时只更新其中一个字段。

| 合同 `lifecycle_state` | 合同 `approval.status` | 迁移/含义 |
|---|---|---|
| `DRAFT` | `DRAFT` | 草案编辑；用户提交审批后进入 `PENDING_APPROVAL` / `PENDING_REVIEW` |
| `PENDING_APPROVAL` | `PENDING_REVIEW` | 等待审批；通过进入 `PREPARING` / `APPROVED`，拒绝进入 `ABORTED` / `REJECTED` |
| `PREPARING`, `EXECUTING`, `VERIFYING`, `PENDING_RESUME`, `AUDITED`, `MERGED` | `APPROVED` | 已批准合同的准备、执行、恢复、审计与合并阶段；`PENDING_RESUME` 恢复须保留原审批版本，任何授权/预算变更都必须重新审批 |
| `ABORTED` | `REJECTED` 或 `APPROVED` | 用户拒绝时为 `REJECTED`；已批准后发生安全中止/不可恢复故障时保留 `APPROVED` 作为历史审批事实，终态为 `ABORTED` |

合同被拒绝后不得原地回到 `DRAFT`；需基于新版本创建新合同。验证失败等非安全失败可保留 `APPROVED` 并按合同规则进入 `PENDING_RESUME`。若 `PREPARING` 初始化中断并清理后回退至 `PENDING_APPROVAL`，同时必须将 `approval.status` 回置为 `PENDING_REVIEW`，只有用户再次确认后才能重建 Worktree。`ABORTED` 为终态。

### 9.2 证据包 Schema (v1.1.3)
```typescript
export interface EvidenceBundleV11 {
  evidence_id: string;
  contract_id: string;
  generated_at: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    estimated_cost_minor_units?: number;
    reported_cost_minor_units?: number;
    currency: string;
    pricing_version: string;
    accounting_mode: "PROVIDER_REPORTED" | "ESTIMATED" | "UNAVAILABLE";
    limit_reached: boolean;
    reserved_cost_minor_units?: number;
    cumulative_cost_minor_units?: number;
  };

  worktree_snapshot: {
    head_sha: string;
    snapshot_fingerprint: string;
    captured_at: string;
  };

  verdict: {
    status: "PASSED" | "FAILED" | "BLOCKED" | "STALE"; // STALE: 生成后 Worktree 文件快照/HEAD 变化，须重新验证
    can_merge: boolean; // 派生字段：仅 status === PASSED 且快照/Scope/预算门禁全通过时为 true；其他状态必须为 false
    summary: string;
    reason_code?: "SCOPE_VIOLATION" | "BUDGET_EXHAUSTED" | "WORKSPACE_LOCKED" | "UNAUTHORIZED_COMMAND" | "VERIFICATION_RETRY_LIMIT" | "UNSAFE_EXECUTION" | "EVIDENCE_STALE" | "PREPARATION_INTERRUPTED" | "WORKTREE_LOST";
    verification_retry_count?: number;
  };

  scope_audit: {
    passed: boolean;
    files_changed: Array<{
      path: string;
      additions: number;
      deletions: number;
      binary: boolean;
    }>;
    forbidden_violations: string[];
    budget_exhausted: boolean;
  };

  verification_results: Array<{
    command_alias: string;
    exit_code: number;
    stdout_tail: string;
    stderr_tail: string;
    duration_ms: number;
    passed: boolean;
  }>;

  git_info: {
    base_commit_sha: string;
    task_commit_sha: string;
    diff_stat: string;
    patch_fingerprint: string; // SHA-256 一致性校验指纹；不构成防篡改签名或本地篡改防护
  };
}
```

**Schema 不变式**：`can_merge` 必须等于完整合并门禁的派生结果；`status !== "PASSED"` 时必须为 `false`。证据原因码包含 §6.3 崩溃恢复使用的 `PREPARATION_INTERRUPTED` 与 `WORKTREE_LOST`。

---

## 10. v0.1 实施路线与验收门槛 (Implementation Roadmap)

以下阶段按首版用户闭环排序。阶段通过标准是进入下一阶段的门槛，不代表单独某一阶段即可证明“工业级”或“生产安全”。

| 阶段 | 优先级 | 目标 | 验收标准 |
|---|---|---|---|
| **P0：可复现工程底座** | P0 | 依赖、测试与构建可复现 | 提交 lockfile；干净环境安装成功；CI 自动运行 Lint、TypeCheck、单元测试；失败阻止合并；提供本机支持平台矩阵 |
| **P1：Local Daemon 与真实 Git** | P0 | 本地仓库可被安全识别和隔离 | CLI 仅绑定 loopback 启动 UI/Daemon；可创建/恢复/清理真实 Worktree；主工作树不被任务写入；并发锁冲突可解释失败 |
| **P2：Scope 与合同审批** | P0 | 用户在执行前掌握变更范围 | 文件级依赖地图支持搜索/缩放/折叠；合同明确可写/只读范围、预算、命令和验收；未经显式批准不能执行；范围外写入被发现并阻断 |
| **P3：真实执行与成本/环境熔断** | P0 | 可跑本地真实验证并保护用户 | stdout/stderr、exit code、耗时真实采集；命令白名单/超时生效；秘密不进入模型上下文；token/费用硬上限会阻止后续调用并暂停；连续失败可熔断 |
| **P4：Evidence、Diff 与人工合并** | P0 | 以证据闭环交付一次变更 | Evidence 可追溯合同、基准 SHA、验证命令和 Diff；文件范围、预算和测试门禁通过；失败/阻断不可合并；只有用户显式核销才 squash merge |
| **P5：恢复、依赖复用与真实项目试用** | P1 | 对长任务和重启有可理解的恢复路径 | Daemon 崩溃/重启后状态可恢复或明确不可恢复原因；Worktree 依赖复用不污染主目录；至少在代表性真实仓库完成端到端 dogfood，记录性能、失败与成本偏差 |

### 10.1 v0.1 退出条件

只有 P0–P5 的验收项均通过，且至少完成真实项目端到端试用，才可将 v0.1 标记为可供目标用户试用。若尚无跨平台测试、恶意仓库威胁模型验证或供应商成本精度验证，必须在发布说明中明确限制；不得将其称为已验证的后续团队/合规场景生产安全产品。


### 9.3 运行时错误码与原因码映射表 (ErrorCode Catalog)

| 运行时错误码 (`error_code`) | 归属 `reason_code` | 触发组件 / 阶段 | 触发条件说明 |
| :--- | :--- | :--- | :--- |
| `E_OUT_OF_SCOPE` | `SCOPE_VIOLATION` | Scoped Gateway (Task 1.3) | 尝试读写未在合同 `writable_paths` 授权范围内的文件路径 |
| `PATH_TRAVERSAL_DETECTED` | `SCOPE_VIOLATION` | Path Resolver (Task 1.3) | 相对路径解析包含 `..` 试图逃逸至 Worktree 物理根目录之外 |
| `E_FORBIDDEN_PATH` | `SCOPE_VIOLATION` | Scoped Gateway (Task 1.3) | 试图触碰 `.git`、`.stagent`、生产凭据等强禁区路径 |
| `E_BUDGET_EXCEEDED` | `BUDGET_EXHAUSTED` | Cost & Loop Guard (Task 1.3) | 累积 Token 消耗或单轮任务模型开销达到 `budget_limits` 上限 |
| `E_COMMAND_TIMEOUT` | `BUDGET_EXHAUSTED` | Command Runner (Task 1.3) | 单命令执行时间超过 `timeout_seconds`（默认 60s） |
| `E_TASK_TIMEOUT` | `BUDGET_EXHAUSTED` | Command Runner (Task 1.3) | 任务总生命周期耗时超过 `max_duration_seconds`（默认 1800s） |
| `E_UNAUTHORIZED_COMMAND`| `UNAUTHORIZED_COMMAND` | Command Runner (Task 1.3) | 待执行命令的 `executable` 不在合同白名单中，拒绝执行 |
| `E_RETRY_LIMIT_EXCEEDED`| `VERIFICATION_RETRY_LIMIT` | Loop Guard (Task 1.3) | 任务在同版本合同下连续重试验证失败达到 `max_retries` 上限 |
| `E_WORKSPACE_LOCKED` | `WORKSPACE_LOCKED` | Daemon Lifecycle (Task 1.1) | 尝试获取已被其他进程占用的 PID 互斥锁 |
| `E_EVIDENCE_STALE` | `EVIDENCE_STALE` | FS Watcher (Task B.2) | 验证通过后工作树内文件被外部编辑器或进程二次修改 |
| `E_PREPARATION_FAILED` | `PREPARATION_INTERRUPTED` | Crash Recovery (Task A.6) | Worktree 创建或依赖准备阶段发生进程中断/异常退出 |
| `E_WORKTREE_LOST` | `WORKTREE_LOST` | Crash Recovery (Task A.6) | 处于中间态的合同在自愈重启时检测到磁盘物理 Worktree 丢失 |

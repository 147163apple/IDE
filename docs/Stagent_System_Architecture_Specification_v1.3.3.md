# Stagent 系统架构设计规范 (v1.3.3 Vibe 模式、全局保护清单与成熟 Agent 接入校准版)

> **版本**：v1.3.3 (Vibe Mode, Global Protection List & Mature-Agent Alignment)  
> **状态**：产品方向与工程执行统一事实源；实现须通过本文可验证验收标准（**本版为文档修订版，代码基线不变，所有测试数量一律以最新 CI 运行结果与提交哈希为准，不再写死**）  
> **前序版本**：v1.3.2 / v1.3.1 / v1.2.0 (Verified Baseline) / v1.1.3  
> **v1.3.3 第二轮修订（2026-10-20，依据文档审查意见）**：
> - §2.2/§7.2/ADR-007：区分「建议被采纳」「合同生成与 Schema 校验」「合同授权」三件事——合同授权一律按 §0.2 交集判定：Scope 与保护清单无交集自动批准（记录备案），命中时仅一次白话是/否；删除「任何采纳的建议必须显式审批签署」及基于成熟度分数的 v0.1 验收表述。
> - §2.1/§2.2/§10：成熟度评分、HUD 徽章、风险气泡、Snooze 与成熟度广播帧统一标注为 v0.2+，v0.1 的 Supervisor 只做按需合同草案（L0 规则 / L1 强模型）。
> - 配套任务规范：Sprint 按依赖重排（D.2 落在 C.5/P.1/W.4 之后），S.1/S.2/S.3 状态如实化；文件名待统一更名为 `*_v1.3.3.md`。
> **本次修订重点 (v1.3.3，依据《三份规范文档综合审查与修订指令》2026-10-20)**：
> 1. **新增运行模式与全局保护清单 (§0.6)**：引入 `VIBE`（默认，无合同门槛，但碰锁必问）与 `PROTECTED` 双模式；新增 `.stagent/protection.json` 全局保护清单、静默合同（Silent Contract）、Vibe 自动快照（Auto-Checkpoint）与【撤销本轮改动】一键恢复、确定性冲突仲裁（User-First Discard Rule）。`[用户已确认 D1 / D2 · 2026-10-20]`
> 2. **审批减负**：合同 Scope 与保护清单无交集时自动批准（记录备案）；合并改为一键合并，删除二次确认弹窗；未触碰保护清单的预算追加/resume 不再重批；主树 dirty 仅白话提示不阻塞。
> 3. **成熟 Agent 双轨接入 (§2.3/§2.7/§9.1)**：保留自研 API Worker 作为保底基线与测试替身；新增 `daemon/worker/cli-host/` 专用子进程隔离模块（全仓唯一允许 `child_process`/spawn 的位置，强制 `shell:false` + 进程树托管）；接入顺序 Claude Code → cursor-agent → OpenHands；`control_mode` 新增 `SANDBOX_ENFORCED`；能力声明新增 `billing_model`/`streaming_protocol`/`resume_mechanism`/`interrupt_supported`/`native_tools_disabled`/`verified_on`；**所有成熟 Agent 能力声明统一标记「待实机验证（verified_on: 空）」，通过 cli-host 黑盒实测后方可标记受控**。`[用户已确认 D3 · 2026-10-20]`
> 4. **Supervisor 规则优先与预算分账 (§2.2/§4.4)**：L0 确定性规则引擎零模型调用，L1 强模型按需调用；Supervisor 独立日预算，不再占用 Worker/合同预算；移除「对话停顿 3s 即评估」的默认轮询。
> 5. **契约与错误码修订 (§4.1/§9.1/§9.3)**：MCP 工具集补齐 `stagent_delete_file` 统一为 6 工具；`E_CONFLICT` 归属新增 `WRITE_CONFLICT` 并按「重读后重试」处理，不再导致合同 `ABORTED`。
> 6. **架构雷达与成熟度评分推迟**至 v0.2 之后（§3 保留为远期参考，不进入当前排期）。`[用户已确认 D4 · 2026-10-20]`

> **v1.3.2 历史修订要点（存档）**：
> 1. **彻底消除野错误码与闭环超时契约 (闭环 P1-N1)**：修正 §6.4(3) 历史残留的野错误码 `E_TIMEOUT`，明确按超时类型分别记录 `E_COMMAND_TIMEOUT` 或 `E_TASK_TIMEOUT`，与 §9.3 ErrorCode Catalog 15 ➔ 10 映射完全闭环。
> 2. **扩充预算上限 Schema 字段 (闭环 P1-N2)**：在 §9.1 `budget_limits` 增补 `max_command_executions?: number` 与 `max_tool_calls?: number` 可选预算字段，§9.3 `E_BUDGET_EXCEEDED` 触发条件同步纳入命令与工具调用计数熔断，为工程执行提供法典级契约支撑。
> 3. **完善工作区与合同互斥锁归属 (闭环 P2-R5)**：§9.3 明确 `E_WORKSPACE_LOCKED` 涵盖实例 PID 锁冲突 (`TASK-D.1`) 与同一合同并发操作互斥 (`TASK-D.2` G-21) 双触发场景，归属标注为 `(TASK-D.1 / D.2)`。
> 4. **巩固中栏 Supervisor Studio 与受控 Worker 装配链路**：保留中栏 Studio 标签页/分屏、Session Router 确定性装配、Monaco 服务端 403 校验与 3s Debounce 节流基线。
> 5. **双向锚定 18 项工程任务与 48 文件/377 用例基线**：锁定全量物理验收与测试基线，杜绝超纲字段与无锚点断言。

---

> **迁移说明**：v1.3.3 取代 v1.3.2/v1.3.1/v1.2.0/v1.1.3 作为产品方向与工程执行唯一定标基线；保留原有安全约束但扩展 UI/Agent 范围与运行模式。现有 v1.1.3 合同不得静默转换：按既有迁移策略备份后视为旧版本，不应自动批准或继续执行；需显式迁移并重新审批。

## 0. 产品定义、首版用户流程与功能边界 (Product Contract)

### 0.1 产品定位与目标用户

Stagent 是面向独立开发者与外包工程师的 **AI 开发工作台与工程监督控制面**。用户在 Stagent 内以类似 Cursor 的方式与 Coding Worker 对话、阅读和编辑代码；Supervisor Agent 在授权范围内观察任务上下文与执行事件，在需要时提出建议。Stagent 的价值不是替用户盯每一次代码生成，而是让复杂 AI 开发任务可理解、可授权、可追踪、可验收、可撤销。

产品包含三个核心职责面：
- **IDE Workspace**：以类 Cursor 为基础交互体验，包含左栏文件树与架构雷达、中栏 Monaco 代码阅读/编辑/双栏 Diff/内置终端，以及右栏 Coding Agent 交互会话窗口。
- **Supervisor Studio & HUD**：呈现状态并提出需求收敛、架构风险、范围约束、熔断和验收提示。平时在 Header 保持紧凑胶囊状态（HUD），随时可在中栏以专属 `Supervisor Studio` 标签页或与代码并排分屏（Split Pane）展开，供用户沉浸审阅与签署。
- **Daemon Control Plane**：合同状态机、Worktree 物理沙箱、Scoped MCP 网关、命令执行引擎、预算熔断、独立证据包（Evidence）与 Git 物理合并的唯一权威。模型和 UI 均受其严格管控。

### 0.2 v0.1 核心用户流程

1. **打开项目与自由澄清**：用户选择本地仓库，在三栏工作台与 Coding Worker 讨论需求；会话消息、当前仓库、分支和文件上下文按本地隐私设置管理。用户可随时停止或继续对话。首次导入项目时，Supervisor 以规则扫描主动识别核心模块，弹出白话推荐卡片（如「为您推荐锁定【登录】与【支付】模块，一键保护」），用户一键确认或忽略（详见 §0.6）。
2. **Supervisor 提议收敛**：Supervisor 可根据会话内容、用户显式标记和仓库索引，判断是否值得形成任务草案。规则或模型判断只能触发建议，不能作为客观事实或授权（成熟度评分推迟至 v0.2+）。用户可忽略、稍后处理或要求生成合同草案。
3. **合同审阅与批准（减负后）**：Daemon/模型生成结构化草案后执行**交集判定**：
   - 合同 Scope 与全局保护清单**无交集** → **自动批准**（记录备案，无需用户点击，前端不弹窗、不阻断）；
   - 与保护清单**有交集** → 向用户抛出**至多一个**白话是/否问题（一张卡列出本轮涉及的全部受保护文件，授权仅覆盖卡上清单，见 §0.6.5）（如「AI 想修改被保护的『登录』代码，同意吗？【是 / 否】」），并附一句白话后果说明。
   面向用户的文案一律白话，错误码与字段名不出现在界面主文案中。
4. **隔离执行**：Daemon 创建真实 Worktree 并绑定批准合同。Coding Worker 的文件与命令工具必须经过 Scoped Gateway；不具备强制受控工具通道的 Worker 不得标记为受控执行。Supervisor 仅接收经授权的会话上下文和运行事件，不取得更高 OS 权限。
5. **独立验证与证据**：Worker 声明完成后，Daemon 独立执行合同验证命令，核对 Scope、预算、测试完整性、Git 状态和 Worktree 快照，生成 Evidence。模型不得代替真实退出码、快照校验或合并门禁。
6. **一键合并**：证据全绿（`can_merge=true`）时用户点击一次合并按钮即完成核销，**不再二次确认弹窗**（Daemon 在后台保留实时指纹复核，对用户不可见）；Daemon 执行 squash merge、Git Trailer 与清理。失败、过期、阻断和放弃路径均可见并可追踪。

**授权不变式**：自然语言对话、Supervisor 的建议（含 v0.2+ 成熟度评分）、Worker 的完成声明均不是执行授权。保护模式下的授权决策收敛为：**未触碰保护清单的任务用户交互次数 = 1（合并按钮）；触碰保护清单的任务 ≤ 2（一个是/否 + 合并）**。`[用户已确认 · 2026-10-20]` 两次是不同阶段的确认：是/否 = 动手前按文件清单授权；合并 = 验证全绿后一键合并，**无二次确认弹窗**。同一轮内不得因清单内文件反复弹窗；超出清单时弹出的补充卡属于同一次是/否授权的**补充授权**，计入"≤2"规则内，不另算一次交互。`[用户已确认 · 2026-10-20]`

### 0.3 v0.1 功能边界 (In Scope / Out of Scope)

| 领域 | v0.1 必须交付 (In Scope) | v0.1 明确不做 (Out of Scope) |
|---|---|---|
| 运行形态 | Local-First 本地 Daemon + Stagent IDE Web UI；真实本地仓库与 Daemon 权威状态 | 浏览器虚拟文件系统/伪执行；多人远程协作；跨设备云同步 |
| IDE 工作台 | 三栏基础布局：文件树/项目导航、代码阅读与受控编辑/Diff、Worker 会话；基础终端/命令结果面板 | Cursor 全量功能或兼容性承诺；完整 VS Code 扩展生态；自研语言服务器矩阵 |
| Worker | 至少一个可审计的 Worker Adapter；工具调用必须经 Gateway 或明确显示为非受控模式 | 将任意第三方 CLI 宣称为已沙箱化；逆向私有协议；未经授权使用用户客户端凭证 |
| Supervisor | 读取授权的会话摘要/事件，生成合同建议、告警和验收提示；用户可关闭/延后建议 | 自动批准合同、静默扩权、自动合并；仅凭模型判断阻断或宣称测试通过 |
| Git | 真实 Git Worktree、任务分支、Diff、显式 squash merge | 远端 PR 自动化、复杂并发冲突调解 |
| 安全与执行 | Scoped Gateway、命令白名单、Worktree、进程回收、预算/时间/重试熔断、审计与 Evidence | 把普通本地子进程说成对抗性容器沙箱；任意 shell 权限 |
| HUD | Stagent Web 工作台内的非模态状态胶囊/通知卡与可访问的通知中心 | 浏览器页面跨应用置顶；未开发桌面壳却承诺系统级浮窗 |
| 成本与隐私 | 合同级模型/工具/命令预算；本地会话存储策略、秘密最小化与脱敏 | 企业账单分摊、远程审计/KMS |

### 0.4 产品成功与首版验收原则

- **代码物理基线**：以本地仓库当前测试基线为起点（测试文件与用例数量**以最新一次 CI 实际运行结果为准并附提交哈希**，本文不再写死数字），所有功能扩展与重构均不得破坏此基线。
- 用户无需离开 Stagent 即可完成最小的需求对话、代码阅读/修改、Diff 审阅和任务验收闭环。
- 文件树、编辑器、Worker、Daemon 的项目根目录与活动 Worktree 身份始终明确；获批执行中的 Worker 不得写入主工作树。
- Worker 文件写入、命令、网络、环境变量和依赖变更均受合同与 Gateway 约束；没有可强制约束能力的 Agent 不得显示“受控执行”。
- Supervisor 的每条建议均可忽略；建议不改变合同、Scope、预算或状态。用户必须明确批准合同。
- Evidence 的测试结果来自 Daemon 实际运行的命令及其退出码；`can_merge` 由确定性门禁派生，模型不得设置。
- UI/Daemon 断线、Worker 崩溃或 Supervisor 不可用不得导致静默授权、失去状态或绕过门禁。
- 保留 v1.1.3 的依赖复用/隔离、主树脏状态提示、测试完整性保护、输出脱敏截断、进程树清理、快照重核验与费用持久化约束。

### 0.5 产品决策验收矩阵与失败判据

| 决策 | 通过标准 | 失败判据 |
|---|---|---|
| 单一权威 | Daemon 是合同、状态、文件权限、执行、Evidence 与 Git 操作唯一权威 | UI/Agent 可独立伪造状态、执行结果或绕过门禁 |
| IDE 与项目身份 | 文件树、编辑区、Worker 与任务合同展示相同仓库/Worktree；修改动作落在当前授权工作区 | Worker 或 IDE 静默指向主树/错误仓库；项目根目录身份不清 |
| 双 Agent 分权 | Supervisor 只能建议/读取获准上下文；Worker 只能通过授权工具执行；Daemon 确定性检查 | Supervisor 可自行批准/合并；Worker 可取得主机任意 I/O；两个角色共享无边界权限 |
| 建议提示（成熟度提示为 v0.2+） | 可验证由提示触发，但始终允许忽略；不自动创建已批准合同 | 分数阈值自动开始执行或导致权限变化 |
| Worktree 与核销 | 执行期间主树不被 Worker 改动；合并前检查主树、Evidence 指纹、Scope、预算；`can_merge=true` 时一键合并（无二次确认弹窗，Daemon 后台保留实时指纹复核） | 未获批改动进入目标分支；Evidence 过期仍可合并 |
| 工具/Worker 集成 | 受控 Worker 的所有文件与命令工具均经 Gateway；适配器有绕过测试 | 原生工具可直接访问宿主文件/ shell，却仍显示为受控 |
| 费用与熔断 | 用量跨重启/重试持久化；任何 Agent 达到合同总上限后不得再发模型调用 | 模型切换/重启清零；Supervisor 在 Worker 预算外无限调用 |
| 本地安全边界 | 明示普通 OS 进程非强沙箱；危险或不可信任务拒绝/外置隔离 | 宣称路径白名单可约束恶意子进程或主机攻击 |
| HUD | Web HUD 仅在 Stagent 页面范围内工作；桌面浮窗作为独立可选后续能力 | 仅有浏览器却宣称跨应用置顶/全局监控 |

测试必须在声明支持的平台矩阵运行；任何未覆盖平台不得标记通过。

## 0.6 运行模式与全局保护清单 (Run Modes & Global Protection List) `[用户已确认 D1 / D2 · 2026-10-20]`

### 0.6.1 双运行模式

| 模式 | 定位 | 门禁强度 | 证据产出 |
|---|---|---|---|
| `VIBE`（默认，自由模式） | 自由聊天、原型、改代码，面向非开发者的零门槛体验 | **无合同门槛，但碰锁必问**：不要求合同；Gateway 做日志记录与保护清单规则检查，命中保护清单时一律拦截并询问（§0.6.5） | 不产出可合并 Evidence（改动即普通 Git 变更） |
| `PROTECTED`（保护模式） | 用户通过全局保护清单锁定核心资产（如登录、支付）后自动生效 | 仅当 Agent 改动**触碰保护清单**时介入，每次介入**最多一个白话"是/否"问题** | 触碰保护区时走完整合同 + Evidence 编译链 |

- Header 必须常驻白话模式指示（"自由模式" / "保护模式"），不得使用技术术语。
- 完整编译链（业务意图 → Software Contract → 架构约束 → 代码任务 → Evidence Bundle）**仅在保护模式触碰保护区、或用户主动要求"正式交付"时启用**。
- E2E 验收基线：新项目、无保护清单、无合同时，用户让 Agent 新建并修改文件、运行测试，全程零弹窗零审批，Header 显示"自由模式"。

### 0.6.2 Vibe 模式安全网（非开发者后悔药）

- **自动快照（Auto-Checkpoint）**：Vibe 模式下 Daemon 必须在 Agent 执行改动**之前**自动生成轻量 Git 快照（stash 或临时提交），用户无感知。
- **一键撤销**：UI 提供顶层常驻的白话按钮【撤销本轮改动】，非开发者随时可一键恢复现场，不暴露任何 Git 概念。
- **撤销范围（v0.1 定稿 `[用户已确认 · 2026-10-20]`）**：v0.1 撤销 = 回滚整轮快照：本轮开始后这些文件的所有改动（**包括用户本轮的手动修改**）一并撤回；撤销确认文案必须白话写明这一点。细粒度撤销（只撤 Agent 改动、保留手改）推迟至后续版本。
- **快照 ≠ 静默合同 ≠ Evidence**：快照只用于撤销；静默合同是后台范围备案；Evidence 只在保护模式完整编译链中产生。普通 VIBE 改动不产生正式合同或可合并 Evidence。

### 0.6.3 全局保护清单（Global Protection List）

- 存储于 `.stagent/protection.json`：路径 glob + 白话名称（如"登录"、"支付"），用户在 UI 一键加锁/解锁，一次锁定长期有效，取代"每份合同各写禁区"。
- **首次导入推荐**：项目首次导入时由 Supervisor 以规则扫描识别核心模块并弹出白话推荐卡片，用户一键确认或忽略。
- **Prompt 前置注入**：组装 Worker Prompt 时将已锁定的保护清单直接注入，引导 AI 主动规避（解决 L0 规则无法预判意图的问题）。
- **静默合同（Silent Contract）**：当 Worker 改动范围完全未触碰保护清单时，Daemon 在后台自动静默生成合同与快照，前端不弹窗、不阻断；**当且仅当** Worker 试图触碰保护清单时，向用户抛出极简白话卡片（"AI 想修改被保护的『登录』代码，同意吗？【是 / 否】"）。
- Gateway 在**任何模式**下对保护路径的写入/删除做确定性规则拦截（零模型调用）。

### 0.6.5 保护清单命中时的确定行为（v1.3.3 补充 `[用户已确认 · 2026-10-20]`）

- **模式判定**：清单为空 = 自由模式（VIBE）；清单非空 = 保护模式（PROTECTED），Header 据此显示。无论处于哪种模式，命中规则相同：
  1. **先拦后写**：写入/删除/改名/符号链接指向保护路径的操作在落盘前被拦下，Worker 暂停；
  2. **一张卡**：本轮涉及的多个受保护路径合并为一张白话是/否卡片，列出具体文件清单；
  3. **同意**：本轮内对卡上清单内文件的修改不再弹窗；Agent 试图改清单外的受保护文件时才弹补充卡（超出清单时弹出的补充卡属于同一次是/否授权的**补充授权**，计入"≤2"规则内，不另算一次交互）；授权不跨轮、不解锁；
  4. **不同意**：拒绝写入，Worker 收到"该路径受保护，请换方案"，任务继续其余部分；
  5. **无人响应/断线/重启**：待审批状态持久化，UI 或 Daemon 断线、重启后仍保持待审批，**永不自动放行**；
  6. **失败关闭（验收条件）**：门卫出错、超时、无回应一律按拒绝处理。这是实现与验收要求，须经 TASK-W.4/W.5a 绕过负例（原生工具、Shell、改名/删除、符号链接）实测证明，不视为已成立事实。
- 改完后：验证全绿 → 用户在顶栏点一次【合并】，无二次确认。

### 0.6.6 Worker 凭证注入规则（v1.3.3 补充 `[用户已确认 · 2026-10-20]`）

- 所有 Worker 模式（VIBE / PROTECTED）一律使用 API Key，不使用官方登录或订阅会话。
- Key 由 Stagent Daemon 在 cli-host 启动子进程时经环境变量注入；**不得**写入仓库文件、Agent 配置文件、`.stagent/protection.json`、日志、事件帧或 Git 提交。
- 各 Adapter 须实测自己的 Key 注入路径；Claude Code `--bare` 等隔离启动参数为**待实机验证方案**，未验证前不得视为已定。

### 0.6.4 确定性冲突仲裁（User-First Discard Rule）

- 不向非开发者抛出任何 Git 冲突解决界面。
- 硬性仲裁规则：合并时一旦发生 Git 冲突，**永远以用户当前主分支版本为绝对准则**，直接丢弃 Worker 在临时 Worktree 中的冲突改动，并向 AI 提示："主分支代码已更新发生冲突，请重新基于最新代码修改"。

## 1. 系统总体架构与拓扑规范 (Local-First System Topology)

Stagent v0.1 采用本地 Daemon 为唯一权威的控制面。用户在 Stagent IDE Workspace 与 Coding Worker 交互；Supervisor Agent 为可选的建议/审阅组件；二者均不得直接控制宿主文件系统。浏览器 UI 只呈现和提交用户意图，不维护独立虚拟仓库。

```text
┌──────────────────────── Stagent IDE Workspace (localhost) ───────────────────────┐
│ 左：文件树/架构雷达 │ 中：代码阅读/受控编辑/Diff/终端 │ 右：Coding Worker 会话     │
│                         Supervisor HUD（页面内提示/建议/状态/证据）                 │
└───────────────────────────────┬───────────────────────────────────────────────────┘
                                │ authenticated API / WebSocket
┌───────────────────────────────▼───────────────────────────────────────────────────┐
│ Stagent Daemon：合同与审批状态、Session Router、Agent Adapters、预算账本、审计       │
│   Supervisor Adapter ──只读授权上下文/提议──┐  Worker Adapter ──受控工具──┐        │
│                                            ▼                           ▼         │
│                                  Contract Engine             Scoped Tool Gateway   │
│                                  Evidence Verifier           Process Tree Runner   │
│                                  Git Guard / Recovery        Snapshot & Watcher     │
└───────────────────────┬──────────────────────────────────────────┬────────────────┘
                        ▼                                          ▼
             本地仓库 / Git Worktree                    经授权命令 / 测试 / 构建
```

| 维度 | v0.1 决策 |
|---|---|
| 权威运行时 | Daemon；UI 与所有 Agent 断线时状态仍由 Daemon 持久化 |
| Agent 角色 | Supervisor 提议/提示；Worker 执行；Daemon 执行确定性权限与状态门禁 |
| Worker 工具 | 受控文件/命令操作只能经 Scoped Gateway；无法代理的原生工具须禁用或显著标记为非受控 |
| IDE 文件操作 | 文件读写绑定当前仓库/Worktree 与合同；获批任务运行期间不向主树写入 |
| 通信 | 仅 loopback；浏览器 WebSocket 使用首帧认证，不依赖浏览器不支持的自定义 Upgrade Header；校验 Origin 与会话权限 |
| HUD 边界 | v0.1 是 Stagent 页面内浮层；跨应用系统级 HUD 需桌面壳与单独权限/平台验收 |
| 恢复 | Daemon 从 `.stagent/` 恢复合同、预算、会话引用、Evidence 与任务状态；不可信或无法恢复状态需明确阻断 |
| 威胁模型 | Local-First、可信本地代码的意外越界防护；不是针对恶意代码的强沙箱 |

**编辑策略（v1.3.3 对齐 §0.6）**：VIBE 模式下 Worker 可在主工作区或用户选择的草稿 Worktree 直接读写与执行命令，由 Auto-Checkpoint 快照兜底；PROTECTED 模式下合同批准后，任务执行视图必须显式绑定任务 Worktree，Worker 只可在 Worktree 授权路径中工作。主树是否干净仅以白话提示（"你未保存的改动不会被带走"），不阻塞；不自动复制或丢弃用户改动，唯一例外是 §0.6.4 的 User-First Discard 冲突仲裁。

## 2. 核心模块与分层职责 (Layered Architecture)

### 2.1 IDE Workspace 与 HUD (Presentation Layer)
- **基础布局**：
  - **左栏**：项目文件目录树、搜索入口、Git 状态与架构雷达（Architecture Radar）视图切换。
  - **中栏 (主编辑与审阅区)**：
    - 上方多标签页主视口：支持打开代码文件（采用 Monaco Editor 作为核心阅读与受控编辑内核）、双栏 Diff 审阅器，以及系统级 **`Supervisor Studio` 专属标签页**。
    - 并排分屏支持 (Split Pane)：支持中栏左右分屏，左半屏打开代码或 Diff，右半屏打开 Supervisor 架构建议与合同草案，实现沉浸式并排核对。
    - 下方可折叠抽屉：结构化命令执行日志与终端回放。
  - **右栏**：受控 Coding Worker 交互会话窗口。所有代码改动意图、工具调用过程与调试进度均透明呈现在此窗口中，并供 Supervisor 全程审计读取。
- **代码视图 (Monaco)**：采用 Monaco Editor 作为中栏代码阅读与编辑核心；所有文件保存均调用 `POST /api/worktree/files` 经 Daemon 强校验路径白名单。清晰显示只读/可写标识、Worktree 绑定状态以及 Evidence STALE 警告横幅。
- **终端**：默认展示 Daemon 执行命令的结构化脱敏日志；若提供交互式终端，必须使用独立权限策略，严禁绕过白名单。v0.1 严禁将未受控宿主 Shell 直接暴露给 Worker。
- **Supervisor 双模交互 (HUD 胶囊 + Studio 标签页)** `[用户已确认 D4 · 2026-10-20]`：
  - **v1.3.3 排期口径**：HUD 的成熟度徽章、10min Snooze 与高级气泡交互推迟至 v0.2+；v0.1 仅保留"保护清单命中时的白话是/否卡片"与 Header 模式指示（自由模式 / 保护模式）。
  - **HUD 常驻胶囊（远期）**：位于 Header 右侧，实时显示需求成熟度徽章、安全指示灯与未决风险气泡。支持点击快速呼出或静默（Snooze 10min）。
  - **Supervisor Studio 标签页**：点击 Header 入口或右侧对话框顶部快捷按钮时，在中栏以独立 Tab 打开（而非遮挡代码的浮动 Modal）。v0.1 展示草案理由、未决问题确认清单、结构化合同编辑器与执行期实时监控水表；长篇成熟度分析推迟 v0.2+。
- **Accessibility**：所有视口与标签页支持键盘访问、快捷键切换；错误与安全告警具备清晰的文字语义说明，不依赖单一颜色传达。

### 2.2 Supervisor Agent (建议与审阅角色)
- **输入感知与上下文流**：接收范围受限的右侧会话上下文、用户代码标记、架构 AST 索引与 Daemon 物理事实事件；上下文采集完全透明、可见、可配置，并支持清除本地会话。
- **核心职能**：按需生成（v0.1）架构影响摘要、结构化 Contract Draft（符合 `SoftwareContractV12`）、风险解释与验收建议（需求成熟度评分推迟 v0.2+）；输出必须通过 Schema 严格校验，并将所有不确定项（`unresolved_questions`）100% 显式保留在草案中供用户核对。
- **两层判断架构（规则优先，v1.3.3 修订）**：
  - **L0 规则引擎**：保护清单匹配、路径/命令白名单、预算与 diff 规模等确定性检查，**零模型调用**；
  - **L1 强模型**：仅在用户主动请求、或 L0 标记"需判断"时按需调用。
- **唤醒时机（v1.3.3 修订）**：① 用户显式请求；② Gateway 违规/熔断事件；③ Worker 回合结束且 diff 触及保护区。**移除"对话停顿 3s 即评估"的默认轮询**（throttler 代码可保留，默认关闭）；严禁伴随 Worker 逐 Token 生成进行盲目轮询调用；VIBE 模式下 30 分钟连续聊天 Supervisor 模型调用应为 0（除非用户点击）。
- **独立预算（v1.3.3 修订）**：Supervisor 拥有独立日预算（`.stagent/supervisor-budget.json`），与 Worker/合同预算**分账**，互不侵占；Supervisor 预算耗尽不影响 Worker 执行。
- （v0.2+）支持客户端响应 `SNOOZE`，自动静默 10 分钟不打扰用户编码；v0.1 默认不主动推送，无需 Snooze。
- **双层零执行权 (Strict Read-Only)**：
  - 静态 AST/Lint 校验确认零工具引用；运行时 Router 剥离所有 MCP 执行工具。
  - 绝对无权批准合同、修改授权、直接调用 Worker 工具、运行主机命令、写业务代码、修改 Evidence 为 PASSED 或触发 merge。**三件事区分（v1.3.3 第二轮修订）**：① *建议被采纳*——用户点击「生成草案」仅产生 `DRAFT`，不构成授权；② *合同生成与 Schema 校验*——由 Daemon 对草案做 `SoftwareContractV12` 校验，不合规不得进入授权；③ *合同授权*——由 Daemon 按 §0.2 交集判定：Scope 与保护清单无交集时自动批准并记录备案，命中保护清单时仅向用户发一次白话是/否。Supervisor 在三步中均无授权权。
- **降级保护**：Supervisor 评估不可用、超时或输出不合规时，产品平滑退化为用户在 Studio 标签页手动编辑创建合同；严禁阻塞用户浏览代码或静默以默认权限放行。

### 2.3 Coding Worker 与 Agent Adapter（双轨演进路线，v1.3.3 修订）
- **双轨制（保底与前瞻并存）**：
  - **保底轨**：自研 API Worker（`daemon/worker/ai-worker.ts`）保留为保底运行基线与单元测试替身，确保系统基础闭环不中断；
  - **前瞻轨**：成熟编码 Agent 接入顺序为 **Claude Code → cursor-agent CLI → OpenHands**（`[用户已确认 D3 · 2026-10-20]`），全部经由 `daemon/worker/cli-host/` 专用子进程隔离模块挂载。
- **cli-host 子进程隔离模块**：全仓**唯一**允许使用 `child_process`/spawn 的模块；强制结构化 argv + `shell:false` + 进程树托管回收（复用 command-runner 风格的进程组/Job Object 管理）。
- **Claude Code 收敛策略（待实机验证，verified_on: 空）**：优先**保留其原生工具**，通过官方 Pre-tool hook（动手前检查钩子）配合 Stagent 网关做拦截，辅以工具白名单/黑名单配置收窄内置 Edit/Write/Bash/WebFetch 等能力，**避免粗暴剥离原生工具导致模型死循环**；工作目录锁定 Worktree；利用其 Headless 模式与结构化输出接右栏流式会话；利用其会话续接能力实现 resume。以上行为以官方文档为依据，**具体能力必须在 cli-host 黑盒实测通过后**方可标记受控。
- **cursor-agent（待实机验证，verified_on: 空）**：实测其权限配置能否完全 deny shell/写文件并仅挂 Stagent MCP；凭证途径**仅限 API Key**（`[用户已确认 · 2026-10-20]` 所有 Worker 模式统一，不使用官方登录/订阅会话），注入规则见 §0.6.6。不能完全关闭原生写能力者只能登记为 `UNCONTROLLED_EXTERNAL`，仅 Vibe 模式可用，UI 显示"未受控"。
- **OpenHands（待实机验证，verified_on: 空）**：容器内仅挂载任务 Worktree，网络按合同策略；对应新增 `control_mode = "SANDBOX_ENFORCED"`（§9.1）。
- Worker 负责需求对话、代码变更与工具使用；其模型/运行时通过 Adapter 接入，Daemon 统一管理会话 ID、取消、超时、成本、工具权限、事件与恢复。
- Worker 的文件、命令、网络、环境和依赖工具只能使用合同授权的 Gateway 能力。未能禁用或代理其原生 filesystem/shell 工具的 CLI 不能作为“受控 Worker”。可将其限制为用户自行操作的外部编辑器/非受控助手，但需在 UI 持续标明边界，且不可把其输出作为受控执行证据。
- 外部 Agent 的 MCP 支持不等于其所有工具都自动受控。适配器必须验证启动参数、工具清单、工作目录、会话退出、进程树回收和工具调用路径；无法验证时拒绝受控模式。
- Worker 可提出“完成”声明；该声明只触发 Daemon 验证，不改变合同状态为已通过。

### 2.4 Daemon Control Plane
- **Contract Engine**：维护状态机与原子持久化，绑定合同版本、审批、Worker、Session 与 Evidence。
- **Agent Session Router**：将用户消息路由至选定 Worker；向 Supervisor 仅提供合同允许的上下文；归集会话事件并执行取消/预算策略。Agent 之间不能通过非审计通道共享任意数据。
- **Scoped MCP Gateway**：Agent 与文件/命令执行的唯一受控 I/O 屏障，强制执行路径、命令、预算和授权限制。
- **Process Runner**：结构化 argv、shell:false、超时、进程树回收、输出脱敏/头尾截断和网络/环境策略；仍非恶意代码沙箱。
- **Evidence Verifier**：独立执行验证命令，核对 Scope、测试文件完整性、Diff、Worktree 快照与成本；只由 Daemon 设置 verdict/can_merge。
- **Git Guard Engine**：Worktree 创建/恢复/删除、主树 dirty 检查、锁、squash merge 与 Trailer。

### 2.5 IDE 文件树、Watcher 与架构雷达
- Daemon 是文件状态与依赖图的权威来源；沿用第 3 章的 OS watcher、活跃 Worktree 显式监听、忽略规则、增量索引、性能阈值与验收前快照复核。
- 用户编辑器写入与 Worker 写入均触发 Evidence 失效流程。审批合同后，编辑区默认绑定合同 Worktree；主工作区编辑入口需要明显切换并提示执行状态。

### 2.6 外部编辑器兼容与降级
- 用户可配置安全启动模板；所有打开目标必须是规范化绝对路径。任务执行期间打开任务文件时默认指向当前 Worktree。
- 路径参数化替换，不经 shell 拼接；未安装/启动失败时提供复制路径。外部编辑器是可选能力，不影响核心闭环。
- 不把外部编辑器写入视为受控 Worker 工具；Watcher 与合并前快照必须发现修改并使旧 Evidence 失效。
- 验收沿用 v1.1.3：路径含空格/Unicode、恶意模板输入、主树与 Worktree 同名文件、启动降级与 Evidence stale。

### 2.7 Agent 供应商与能力声明
- “可接入某模型/CLI”必须区分模型 API、Agent Runtime/CLI、编辑器三种能力。可接入模型 API 不等于拥有代码 Agent；可在编辑器打开 Worktree 不等于 Stagent 控制其后台 Agent。
- 每个 Adapter 必须声明：输入/输出协议、模型调用计量来源、工具调用拦截能力、文件系统/命令权限、取消语义、会话恢复能力、网络需求、平台支持矩阵及已知限制。
- **能力声明扩展字段（v1.3.3 新增）**：`billing_model`（`PER_TOKEN | SUBSCRIPTION | QUOTA`）、`streaming_protocol`、`resume_mechanism`、`interrupt_supported`、`native_tools_disabled: string[]`、`verified_on`（实测 CLI 版本号与日期）。
- **接入前实机验证纪律（红线）**：所有成熟 Agent 适配器在实机黑盒验证前，能力声明（工具拦截、会话续接、流式事件等）必须标记为「待实机验证（`verified_on` 为空）」；验证统一在 `daemon/worker/cli-host/` 模块中以真实 CLI 版本进行，通过后填入版本号与日期方可标记受控；未通过验证的 Adapter 只能在 Vibe 模式使用，UI 显示"未受控"。
- 默认拒绝能力未知的 Adapter 进入受控执行；不得逆向私有协议或从用户 GUI 客户端窃取凭证。

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

### 3.3 增量更新验收指标 (Performance Metrics) `[用户已确认 D4：整体推迟至 v0.2+ · 2026-10-20]`

> **v1.3.3 排期说明**：本节指标（含架构雷达渲染与内存门槛）随 `TASK-B.1/B.2/C.4` 一并推迟至 v0.2+，**不构成本轮 v0.1 的验收阻碍**；保留全文作为远期设计参考。
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

  // 4. 删除文件（受限；拒绝删除目录）
  stagent_delete_file(params: { path: string; expected_hash?: string }): Promise<{ success: boolean }>;

  // 5. 白名单受限命令执行
  stagent_exec_command(params: { 
    command_alias: string; // 仅接受合同中授权的命令别名，例如 "test:unit", "lint"
    args?: string[];
  }): Promise<{ exit_code: number; stdout_tail: string; stderr_tail: string; truncated: boolean; secret_redacted: boolean; duration_ms: number }>; // 有界尾部输出，先脱敏后截断

  // 6. 声明意图完成
  stagent_declare_complete(params: { summary: string }): Promise<{ ready_for_audit: boolean; blockers: Array<{ code: string; message: string }> }>; // Daemon 按 Scope、预算、验证结果与快照一致性判定
}
```

> **工具集口径（v1.3.3 统一）**：`stagent_*` 标准工具恒为上述 **6 项**（read / write / list_dir / delete_file / exec_command / declare_complete），三份规范文档与本节保持一致。

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

任务授权必须展示 Token 上限与费用上限（默认值由产品配置提供，用户可降低或提高后重新批准）。供应商支持时，在每次模型调用前预留可能费用，并以实际 usage 回执结算；无法取得精确 usage 时采用明确标注的估算和保守预留。任一硬上限达到时，立即禁止新的模型调用、记录 `BUDGET_EXHAUSTED`、保存当前状态并转入 `PENDING_RESUME`/阻断状态。恢复必须由用户提高或重设预算并重新批准；不得因重试、Daemon 重启或供应商切换重置累计值。工具与命令预算也应分别记录（合同 `budget_limits` 可选配置 `max_command_executions` 与 `max_tool_calls` 上限，任何单项超限立即触发 `E_BUDGET_EXCEEDED` 熔断），避免把模型费用上限误认为计算命令限制。

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
- **成熟 CLI Agent 的子进程边界（v1.3.3）**：启动 Claude Code 等 CLI Agent 必然产生子进程，该能力**仅允许**存在于 `daemon/worker/cli-host/` 模块，且必须强制结构化 argv + `shell:false` + 进程树托管回收；此放宽不改变上述威胁模型结论——CLI Agent 的原生工具若未被钩子/配置拦截，则该 Adapter 只能登记为非受控（§2.3/§2.7）。


### 4.3 测试环境、秘密与网络访问边界 (Local Test Environment)

- 默认命令环境不继承完整宿主环境；Daemon 只传递系统运行所需的最小变量，合同按命令显式声明允许的环境变量名。
- `.env.test` / `.env.local` 不是自动暴露给模型的上下文。若本地测试需要其中的变量，用户需按变量名或受控 env-file 显式授权给指定验证命令；秘密值不得写入 Prompt、合同正文、UI 日志或 Evidence 输出。
- stdout/stderr 在保存和展示前应对已知秘密值做遮蔽；遮蔽不等于可靠的秘密防泄露边界，因此不得把宿主密钥交给不可信代码或模型。
- 网络默认按命令策略关闭或限制；需要外网的集成测试必须在合同中声明用途、目标范围和授权方式。v0.1 不提供通用网络隔离保证，不得把本地进程封装表述为抵御恶意代码的强沙箱。
- 验证命令默认注入 `CI=true`；端口由命令合同显式策略控制。只有命令/测试框架确认支持时，才分配并注入动态空闲端口；不得盲目固定 `PORT=0`（部分服务不支持）或假定所有测试会读取 `PORT`。主机已占用端口必须使命令启动失败并给出可诊断结果，不能误报为测试断言失败。
- 对超出可信本地开发任务威胁模型的代码，应拒绝运行或要求用户在独立容器/虚拟机中执行；这是明确的安全限制，不可用路径巡检替代 OS 级隔离。

### 4.4 双 Agent 工具权限与事件路由
- Gateway 以合同版本、Worker session、Worktree 根路径和命令白名单为每次调用上下文；拒绝缺少绑定或已撤销的会话。
- Worker 越界调用返回稳定错误码并发出 Daemon 事件；事件可在 HUD 呈现，但 UI 的“批准追加范围”必须生成新合同版本并重新审批，不能在当前批准合同上原地扩权。
- Supervisor 默认接收脱敏后的事件摘要，不接收秘密值、完整环境变量或未经用户授权的原始文件内容。会话上下文引用需记录来源与访问策略。
- Agent 之间的消息由 Session Router 记录为可审计事件；Supervisor 的建议不能直接变成 Worker 工具调用。由用户采纳后，仍需通过合同与 Gateway。
- Daemon 对模型请求实施预算账本；**v1.3.3 起 Supervisor 与 Worker 预算分账**：Supervisor 用量计入独立日预算（`.stagent/supervisor-budget.json`），不再计入合同/会话总额；Worker 合同账本不得包含 Supervisor 用量。若模型供应商无法报告精确用量，按 `ESTIMATED` 或 `UNAVAILABLE` 记录并保守预留。
- **计费模型分支（v1.3.3 新增）**：按 Adapter 声明的 `billing_model` 分别处理——`PER_TOKEN` 类保留调用前预留与 usage 回执机制；`SUBSCRIPTION`/`QUOTA` 类改用调用次数、时长与回合数上限（复用 `max_agent_turns`、`max_duration_seconds`），不做 Token 级预留。
- 受控 Adapter 验收：尝试直接写 Worktree 外路径、执行未授权 shell、访问主树、跳过 Gateway 均须失败或被证明不可调用；否则该 Adapter 只能处于非受控状态。**对成熟 CLI Agent，上述 4 类绕过负例必须在 cli-host 中以真实 CLI 版本实测通过**（§2.7 实机验证纪律）。

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
所有通过 Stagent 合入主干的 Commit 必须包含 4 个标准的结构化 Git Trailer，以实现全生命周期安全审计追溯：

```
feat(order): add idempotency token check for checkout API

Closes #1024
Audited-By: Stagent Daemon / Supervisor Agent
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
- **绑定与认证**：默认绑定 `127.0.0.1`。浏览器 WebSocket 不依赖自定义 Authorization Upgrade Header；连接建立后首帧必须为一次性/短时效 `AUTH` 帧，Daemon 校验本地 session token 后才接受其他消息。Token 单独存于 `.stagent/session-token`（权限 `0600`）；PID 文件只存非秘密运行元数据。校验失败立即关闭（应用关闭码 `4401`），不得进入自动无限重连。
- 校验 `Origin`、连接速率、帧大小和消息类型；只接受当前仓库 UI 的合法来源。首帧 AUTH 仅允许认证数据，日志不得记录 token。Daemon 获 PID 锁后轮换 token；崩溃残留 token 在下次成功启动后失效并轮换。
- 心跳每 5 秒发送一次 `PING`，连续 3 次无回应后显示重连遮罩。未认证连接不得订阅事件。
- 标准帧：`trace_id`, `type`, `timestamp`, `payload`。类型至少包括 `AUTH`, `AUTH_OK`, `PING`, `PONG`, `ERROR`, `CONTRACT_UPDATE`, `CHAT_EVENT`, `SUPERVISOR_SUGGESTION`, `WORKER_EVENT`, `GATEWAY_VIOLATION`, `EVIDENCE_READY`, `EVIDENCE_STATUS_CHANGED`, `TERMINAL_STREAM`。其中 `EVIDENCE_READY` 用于证据生成完成等待核销通知，`EVIDENCE_STATUS_CHANGED` 用于证据生命周期流转与外部文件修改导致的 STALE 失效通知，`TERMINAL_STREAM` 用于 Daemon 命令执行的实时结构化日志。每类帧定义 Schema、最大尺寸、发送/接收方和权限；未经认证不接受业务帧。错误 payload 含稳定 code 与脱敏 message。
- **`CHAT_EVENT` 子类型 Schema（v1.3.3 新增，支撑右栏流式会话 TASK-C.6）**：`payload.subtype` 枚举为 `delta`（逐 Token 流式增量）/ `tool_call`（工具调用发起）/ `tool_result`（工具结果）/ `turn_end`（回合结束）/ `interrupted`（用户打断）/ `error`（错误）；每种子类型定义独立 payload Schema 与最大尺寸。

### 6.2 正常双 Agent 交互时序 (Happy Path)

```text
User         IDE/UI        Session Router       Supervisor       Daemon/Gateway      Worker       Git/Verifier
 |              |                |                  |                   |               |               |
 |--需求/聊天-->|--message------>|--授权上下文----->|                   |               |               |
 |              |                |                  |--建议/草案------->|               |               |
 |<--可忽略 HUD 建议/草案；用户选择生成并审阅合同--------------------------------------|               |
 |--明确批准合同版本--------->|------------------------------->| create Worktree |               |
 |              |                |                  |                   |--启动受控----->|               |
 |              |<--流式聊天与工具事件，经 Router/Gateway 审核------------------------|               |
 |              |                |<--事件摘要-------|                   |<--工具调用----|               |
 |              |                |                  |                   |--校验Scope----|               |
 |              |                |                  |                   |<--完成声明----|               |
 |              |                |                  |                   |--独立验证-------------------->|
 |<--Diff + Evidence + 风险/费用/快照信息----------------------------------------------|               |
 |--用户明确核销并合并------------------------------------------------>|--门禁/merge------------------->|
 |<--成功状态、Trailer、刷新架构索引---------------------------------------------------|               |
```

### 6.3 状态与决策边界
- Supervisor 建议不会改变 `lifecycle_state`。只有 UI 用户动作经 Daemon 验证后，合同引擎才可迁移到审批/执行状态。
- Worker 的“完成”只触发 `VERIFYING`；只有 Daemon 独立验证成功、Scope/预算/快照门禁通过，才进入 `AUDITED`。
- HUD 告警不能自行扩大权限。用户请求追加路径/命令/预算时，生成新合同版本，旧执行暂停并要求重新审批。
- `can_merge` 由 Daemon 派生；只有用户对当前 Evidence 与当前 Worktree 快照再次确认时才执行合并。
- Supervisor 模型不可用、Worker 断线、适配器崩溃或 UI 断开时，状态保留；不自动批准、不自动合并。Worker 可恢复性必须由 Adapter 声明并按 Schema 验收；不能恢复时进入可解释的 `PENDING_RESUME` 或 `ABORTED`。

### 6.4 异常分支与恢复

沿用 v1.1.3 §6.3 已定义的仓库锁竞争、主工作区 dirty 提示、命令/任务双超时、进程树回收、Daemon 崩溃恢复与 Worktree 快照核验要求，具体如下：

1. **主树 dirty（v1.3.3 减负）**：创建 Worktree 前检查 `git status --porcelain -uall`；检测到未提交改动时**自动在新 Worktree 基于 HEAD 工作**，并以白话提示"你未保存的改动不会被带走"，**不再阻塞流程、不要求用户确认**。不执行隐式 stash/reset。
2. **并发操作**：同一合同的 execute/resume/abort/merge 必须以进程内与磁盘锁互斥；冲突返回 `E_WORKSPACE_LOCKED`/409，不重复启动 Worker。
3. **超时**：单条验证命令默认 60 秒；任务总时长默认 1800 秒。两者独立计时。超时先终止进程组，宽限后回收整棵进程树（Windows 使用 Job Object/等效机制），记录真实退出状态，并按超时类型分别记录 `E_COMMAND_TIMEOUT` 或 `E_TASK_TIMEOUT`。
4. **崩溃恢复**：扫描合同与 Evidence，核验 Worktree 是否存在及快照；`PREPARING` 中断时安全清理并同步修正审批子状态；执行中/验证中恢复为 `PENDING_RESUME`，继续前再次要求用户确认；Worktree 丢失则 `ABORTED/WORKTREE_LOST`。
5. **Evidence/TOCTOU**：Evidence 生成后任何文件、HEAD、Scope、测试文件或授权快照变化都使其 `STALE`；merge 前重新计算指纹并检查主树 clean、锁、合同版本与 can_merge。
6. **会话隐私**：会话正文按本地数据策略持久化；用户可删除/导出。默认不把未授权会话传给 Supervisor；提示中显示其使用的会话范围。敏感变量不进入对话或模型上下文。
7. **外部 Agent 非受控**：若 Adapter 失去 Gateway 强制能力、启动配置被修改或探测到未知工具通道，立即停止受控状态并阻止 Evidence 通过；不得仅显示警告后继续执行。

---

## 7. IDE/HUD 交互与组件级质量测试规范 (IDE Workspace & Regression)

### 7.1 工作台布局与项目身份
- **三栏与 Studio 视口规范**：
  - **左栏**：文件树、全局搜索、Git 状态与架构雷达切换；
  - **中栏**：Monaco 代码阅读/受控编辑、双栏 Diff、下方终端回放抽屉，以及系统级 **`Supervisor Studio` 标签页**（支持中栏左右分屏并排对照）；
  - **右栏**：受控 Coding Worker 交互对话流、实时工具调用回放卡片；
  - **Header / HUD**：常驻仓库名、当前分支、模式指示、Worktree 路径、Worker 受控徽标，以及 Supervisor 入口（状态胶囊与成熟度徽章为 v0.2+）。
- 页面持续显示仓库名称、当前分支、模式（探索 vs 合同执行）、合同 ID、Worktree 路径和 Worker 是否受控。切换仓库/Worktree 需要显式确认。
- 合同执行期编辑默认指向任务 Worktree；主工作区只读或需切换到独立的显式“主工作区编辑”模式，该模式不得被误认为合同执行内容。
- Web 版 HUD 不得使用“全局监控 Cursor/覆盖其他应用”等文案。未来桌面壳需单独定义权限、可访问性、平台兼容和遮挡/隐私策略。

### 7.2 Supervisor 建议与用户决策测试
- 建议卡有“生成草案/忽略/稍后”动作；忽略后聊天与编码流程仍可继续。
- 模型不可用或 JSON Schema 无效时，不生成可进入授权流程的合同，不阻止用户手动创建合同；Schema 校验通过的草案按 §0.2 交集判定授权（无交集自动批准，命中保护清单单问是/否）。v0.1 不存在基于成熟度分数的任何判定。
- Supervisor 不能调用 approve、merge、gateway write 或执行命令；测试通过 Mock/权限测试验证拒绝。
- 合同草案须显示目标、验收标准、Scope、命令、预算、Worker 类型与不确定项；修改任何授权字段后必须重新走交集判定（无交集自动批准，命中保护清单单问是/否）。

### 7.3 Worker/Gateway 安全与会话测试
- 受控 Worker 的全部读写/命令调用带有效合同 ID、版本、Session ID 和 Worktree ID；缺字段、过期合同、错误 Worktree 均拒绝。
- Adapter 若能绕开 Gateway 的原生文件或 shell 工具，不得进入受控模式；测试必须验证绕过路径不可用，而非仅测试 MCP 工具可调用。
- 会话取消、Worker 崩溃、超时、费用熔断、Supervisor 不可用和 Daemon 重启不丢失合同状态或累积用量。
- 对话消息、工具调用和 Supervisor 建议进行脱敏、大小限制与来源标记；秘密值不得进入持久化日志。

### 7.4 既有架构地图、Diff、Watcher 与编辑器回归

沿用 v1.1.3 §7.1–7.3 的 Scope/Active/Cycles 过滤、节点选择器 `node-{relative_path}`、编辑器 Worktree 绝对路径、不可用降级、外部写入导致 Evidence `STALE`、测试完整性和预算门禁测试。另增加：
- 文件树、编辑区与 Worker 工具对同一规范化相对路径的解析结果一致。
- 编辑区写入越权路径时被 Daemon 拒绝并留下事件；切换至 Worktree 后原有主树路径不发生变化。
- HUD 告警可键盘操作、可关闭/稍后处理；关闭提示不等于忽略安全门禁。
- Worker 会话事件乱序、重复、断线重连不会导致状态回退或重复命令。

### 7.5 合并门禁与失败判据
- **（v1.3.3 限定）在保护模式下**：未批准合同不得触碰保护资产、不得启动合同执行；Supervisor 建议不得启动执行；Worker 完成声明不得直接变成 PASSED。Vibe 模式下无合同门槛，但保护清单拦截与自动快照在任何模式下恒生效（§0.6）。
- 仅真实验证退出码为合同预期值、Scope/预算/测试完整性通过且 Evidence 快照当前有效时，Daemon 才可派生 `can_merge=true`。
- UI 不得根据模型文本、绿色图标或客户端缓存覆盖 Daemon verdict。
- `BLOCKED`、`FAILED`、`STALE`、`PENDING_RESUME`、主树 dirty、Agent 非受控等状态均不可合并。
- 测试平台矩阵须覆盖声明支持的 OS；无法覆盖时明确降级/不支持，不以单平台测试推断跨平台安全。

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

### ADR-005：代码编辑体验（由外部编辑器升级为基础 IDE Workspace）
- **状态**：ACCEPTED (v1.2.0)
- **背景**：目标旅程要求用户在同一工作台聊天、阅读/编辑代码并观察验收；仅外链编辑器造成上下文割裂。
- **决策**：实现范围受控的三栏 IDE Workspace 与基础代码编辑/Diff；编辑动作经 Daemon 路径与合同校验。Cursor/VS Code 等仍可作为可选外部编辑器打开 Worktree。
- **备选与取舍**：不复制 Cursor 全部 IDE/扩展/语言服务能力；优先交付可验证的任务闭环、路径身份和安全门禁。
- **验收/失败判据**：主树与 Worktree 身份清晰；执行期 Worker 写入仅落 Worktree；外部编辑器不可用不阻断核心闭环。

### ADR-006：本地持久化与存证可信度
- **状态**：ACCEPTED (v0.1)
- **背景**：本地单人产品应易备份、可读、低依赖；本地 JSON 文件不能被视为防篡改企业审计存证。
- **决策**：合同、状态、审计事件和 Evidence 持久化至 `.stagent/` 结构化文件；记录 Git SHA、任务分支、验证命令和 Diff 指纹，以帮助追踪。明确这些摘要提供一致性检查，不构成防篡改签名。
- **备选方案**：A) 纯内存；B) 本地结构化文件；C) 数据库/远程签名审计服务。
- **取舍**：选择 B。A 无法恢复；C 对单人首版增加维护与部署负担；B 易检查、备份，但不能提供对抗本地篡改的合规保证。
- **后果**：用户应可备份/导出；企业合规签名与远程审计属于后续版本。

### ADR-007：Supervisor-Worker 双 Agent 与执行权分离
- **状态**：ACCEPTED (v1.2.0)
- **背景**：用户需要在工作台内持续与编码 Agent 协作，同时希望有全局监督提示；单 Agent 自我授权/自我验收会混淆提议与执行事实。
- **决策**：Supervisor 负责建议、需求整理与风险解释；Worker 负责获批任务的代码工作；Daemon/Gateway/Verifier 负责确定性执行、状态、证据与合并门禁。Supervisor 不写业务代码、不批准、不执行命令、不合并。模型引擎通过 Adapter 接入，但只有能强制将全部文件/命令工具收敛到 Gateway 的 Worker 才可标记为受控。
- **备选与取舍**：单 Agent 更简单但职责和权限混杂；完全依赖外部 CLI 会失去可验证的工具控制；选择职责分离与能力声明，接受 Adapter 开发和维护成本。
- **后果**：Supervisor 识别只能生成建议（成熟度评分为 v0.2+）；所有权限由合同授权决定（v1.3.3：无交集自动批准，命中保护清单由用户单问是/否）；Agent 调用共享预算并可取消；非受控外部 Agent 不产生受控 Evidence。Web HUD 仅覆盖 Stagent 页面，跨应用悬浮能力另行立项。

## 9. 数据模型增强定义 (Enhanced Schemas)

### 9.1 软件合同 Schema (v1.2.0)

> **v1.3.3 兼容性说明**：本轮对 `worker_spec` 的扩展（`SANDBOX_ENFORCED`、`billing_model`、`verified_on`）与 `verdict.reason_code` 的扩展（`WRITE_CONFLICT`）**全部为可选增补**，`schema_version` 维持 `"1.2.0"`，不触发存量合同迁移；对应代码与测试改动另行排期（本轮仅修订文档）。

```typescript
export interface SoftwareContractV12 {
  contract_id: string;
  schema_version: "1.2.0";
  contract_revision: number;
  created_at: string;
  creator: "user" | "supervisor";
  conversation_ref?: {
    session_id: string;
    message_ids: string[];
    context_policy: "USER_SELECTED" | "SESSION_SUMMARY" | "NO_TRANSCRIPT";
  };
  supervisor_metadata?: {
    suggestion_id: string;
    maturity_assessment?: {
      score?: number; // 仅建议性信号，禁止作为授权或状态门禁
      rationale: string[];
      unresolved_questions: string[];
      model_id?: string;
      assessed_at: string;
    };
    suggested_scope?: { writable_paths: string[]; readonly_paths: string[]; strictly_forbidden_paths: string[] };
  };
  worker_spec: {
    adapter_id: string;
    runtime_kind: "MANAGED_TOOL_CALLING" | "EXTERNAL_CLI";
    model_id?: string;
    control_mode: "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED" | "UNCONTROLLED_EXTERNAL"; // v1.3.3 新增 SANDBOX_ENFORCED（如 OpenHands 容器隔离）
    adapter_version: string;
    billing_model?: "PER_TOKEN" | "SUBSCRIPTION" | "QUOTA"; // v1.3.3 新增：计费模型分支（§4.4）
    verified_on?: { cli_version: string; verified_at: string }; // v1.3.3 新增：实机验证记录；为空即「待实机验证」，不得标记受控
  };

  lifecycle_state:
    | "DRAFT" | "PENDING_APPROVAL" | "PREPARING" | "EXECUTING" | "VERIFYING"
    | "PENDING_RESUME" | "AUDITED" | "MERGED" | "ABORTED";

  intent: {
    title: string;
    description: string;
    acceptance_criteria: string[];
    risk_level: "LOW" | "MEDIUM" | "HIGH";
  };

  authorization: {
    git: { base_branch: string; task_branch: string; target_branch: string; use_worktree: true };
    file_system_scope: {
      writable_paths: string[];
      readonly_paths: string[];
      strictly_forbidden_paths: string[];
    };
    budget_limits: {
      max_file_modifications: number;
      max_total_diff_lines: number;
      max_duration_seconds: number;
      max_agent_turns?: number;
      max_verification_retries: number;
      max_command_executions?: number; // 最大命令执行次数上限 (可选，超限触发 E_BUDGET_EXCEEDED 熔断)
      max_tool_calls?: number;          // 最大工具调用次数上限 (可选，超限触发 E_BUDGET_EXCEEDED 熔断)
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
      editor_command_template?: string;
      env_file_grants?: Array<{ file: string; command_aliases: string[]; variable_names: string[] }>;
      port_policy?: "NONE" | "DYNAMIC_IF_SUPPORTED" | "EXPLICIT";
    };
  };

  verification_spec: {
    commands: Array<{
      alias: string;
      executable: string;
      args: string[]; // 结构化 argv；shell:false
      expected_exit_code: number;
      timeout_seconds: number;
      working_directory?: string;
    }>;
  };

  approval: {
    status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
    approved_by?: string;
    approved_at?: string;
    approved_revision?: number;
    rejection_reason?: string;
  };
}
```

**Schema 不变式**：`control_mode === "UNCONTROLLED_EXTERNAL"` 的 Worker 不得进入合同执行状态，不得生成可合并 Evidence；`GATEWAY_ENFORCED` 与 `SANDBOX_ENFORCED` 必须绑定经**实机验证**（`verified_on` 非空）的 Adapter 能力。任何 Scope、命令、预算、网络、环境、Worker 或验证命令变更均递增 `contract_revision` 并要求重新批准（**v1.3.3 减负**：未触碰保护清单的预算追加/resume 仅记录备案，不再重批，见 §0.2）。Supervisor maturity score 不参与 `approval.status` 或 `lifecycle_state` 计算。

### 9.1.1 合同生命周期与审批子状态联动规则

`lifecycle_state` 与 `approval.status` 是两个相关但不等价的状态机。Schema 校验必须拒绝违反下表的组合；状态变更必须由合同引擎原子写入，避免崩溃时只更新其中一个字段。

| 合同 `lifecycle_state` | 合同 `approval.status` | 迁移/含义 |
|---|---|---|
| `DRAFT` | `DRAFT` | 草案编辑；用户提交审批后进入 `PENDING_APPROVAL` / `PENDING_REVIEW` |
| `PENDING_APPROVAL` | `PENDING_REVIEW` | 等待审批；通过进入 `PREPARING` / `APPROVED`，拒绝进入 `ABORTED` / `REJECTED` |
| `PREPARING`, `EXECUTING`, `VERIFYING`, `PENDING_RESUME`, `AUDITED`, `MERGED` | `APPROVED` | 已批准合同的准备、执行、恢复、审计与合并阶段；`PENDING_RESUME` 恢复须保留原审批版本，任何授权/预算变更都必须重新审批 |
| `ABORTED` | `REJECTED` 或 `APPROVED` | 用户拒绝时为 `REJECTED`；已批准后发生安全中止/不可恢复故障时保留 `APPROVED` 作为历史审批事实，终态为 `ABORTED` |

合同被拒绝后不得原地回到 `DRAFT`；需基于新版本创建新合同。验证失败等非安全失败可保留 `APPROVED` 并按合同规则进入 `PENDING_RESUME`。若 `PREPARING` 初始化中断并清理后回退至 `PENDING_APPROVAL`，同时必须将 `approval.status` 回置为 `PENDING_REVIEW`，只有用户再次确认后才能重建 Worktree。`ABORTED` 为终态。

### 9.2 证据包 Schema (v1.2.0)
```typescript
export interface EvidenceBundleV11 {
  evidence_id: string;
  contract_id: string;
  contract_revision?: number;
  worker_session_id?: string;
  supervisor_suggestion_ids?: string[]; // 建议溯源，不构成验收依据
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
    reason_code?: "SCOPE_VIOLATION" | "BUDGET_EXHAUSTED" | "WORKSPACE_LOCKED" | "UNAUTHORIZED_COMMAND" | "VERIFICATION_RETRY_LIMIT" | "UNSAFE_EXECUTION" | "EVIDENCE_STALE" | "PREPARATION_INTERRUPTED" | "WORKTREE_LOST" | "PROTOCOL_VIOLATION" | "WRITE_CONFLICT"; // WRITE_CONFLICT (v1.3.3 新增): 乐观锁冲突，按"重读后重试"处理，不中止合同
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

### 9.3 运行时错误码与原因码映射表 (ErrorCode Catalog)

> **v1.3.3 变更**：`E_CONFLICT` 的归属由 `SCOPE_VIOLATION` 调整为新增原因码 `WRITE_CONFLICT`（映射关系由 15 ➔ 10 变为 **15 ➔ 11**）；`WRITE_CONFLICT` 不参与 `ABORTED` 判定，按「重读后重试」处理。

| 运行时错误码 (`error_code`) | 归属 `reason_code` | 触发组件 / 阶段 | 触发条件说明 |
| :--- | :--- | :--- | :--- |
| `E_UNSAFE_EXECUTION` | `UNSAFE_EXECUTION` | Threat Guard (`TASK-W.4`) | 命中不可信仓库、特权命令或无法可靠限制子进程/网络的高风险命令，拒绝执行并提示外置隔离 |
| `E_OUT_OF_SCOPE` | `SCOPE_VIOLATION` | Scoped Gateway (`TASK-W.2`) | 尝试读写未在合同 `writable_paths` 授权范围内的文件路径 |
| `PATH_TRAVERSAL_DETECTED` | `SCOPE_VIOLATION` | Path Resolver (`TASK-W.2`) | 相对路径解析包含 `..` 试图逃逸至 Worktree 物理根目录之外 |
| `E_FORBIDDEN_PATH` | `SCOPE_VIOLATION` | Scoped Gateway (`TASK-W.2`) | 试图触碰 `.git`、`.stagent`、生产凭据等强禁区路径 |
| `E_CONFLICT` | `WRITE_CONFLICT` | File Bridge (`TASK-W.2`) | 传入 `expected_hash` 写入文件时乐观锁校验失败（文件已被外部改动）。**v1.3.3 修订**：属常规并发事件，处理为"重读后重试"，同一合同可继续执行，**不再**归入 `SCOPE_VIOLATION` 导致合同 `ABORTED` |
| `E_BUDGET_EXCEEDED` | `BUDGET_EXHAUSTED` | Cost & Policy Guard (`TASK-A.5` / `W.2` / `W.3` / `D.2`) | 累积 Token 消耗、模型开销或命令/工具调用次数达到 `budget_limits` 硬上限 |
| `E_COMMAND_TIMEOUT` | `BUDGET_EXHAUSTED` | Command Runner (`TASK-A.5` / `W.3`) | 单命令执行时间超过 `timeout_seconds`（默认 60s） |
| `E_TASK_TIMEOUT` | `BUDGET_EXHAUSTED` | Command Runner (`TASK-A.5` / `W.3`) | 任务总生命周期耗时超过 `max_duration_seconds`（默认 1800s） |
| `E_UNAUTHORIZED_COMMAND`| `UNAUTHORIZED_COMMAND` | Command Runner (`TASK-W.2`) | 待执行命令的 `executable` 不在白名单中或包含未转义连接符（`;`, `&&`） |
| `E_RETRY_LIMIT_EXCEEDED`| `VERIFICATION_RETRY_LIMIT` | Loop Guard (`TASK-A.5` / `D.2`) | 任务在同版本合同下连续重试验证失败达到 `max_verification_retries` 上限 |
| `E_WORKSPACE_LOCKED` | `WORKSPACE_LOCKED` | Daemon Lifecycle / Control Plane (`TASK-D.1` / `D.2`) | 工作区已被其他进程占用（PID 互斥锁，`TASK-D.1`）或同一合同并发 execute/resume/abort/merge 互斥锁冲突（G-21，`TASK-D.2`） |
| `FRAME_DIRECTION_FORBIDDEN` | `PROTOCOL_VIOLATION` | WS Bridge (`TASK-D.1`) | 客户端伪造 server->client 下行帧，被通信协议门禁拦截 |
| `E_EVIDENCE_STALE` | `EVIDENCE_STALE` | FS Watcher (`TASK-B.2`) | 验证通过后工作树内文件被外部编辑器或进程二次修改，撤销合并权 |
| `E_PREPARATION_FAILED` | `PREPARATION_INTERRUPTED` | Worktree Guard (`TASK-A.6` / `D.2`) | Worktree 创建或依赖准备阶段发生进程中断/异常退出 |
| `E_WORKTREE_LOST` | `WORKTREE_LOST` | Worktree Guard (`TASK-A.6` / `D.2`) | 处于中间态的合同在自愈重启时检测到磁盘物理 Worktree 丢失 |


## 10. v0.1 实施路线与验收门槛 (Implementation Roadmap)

阶段需按依赖排序；IDE 与 Worker Adapter 不得绕过已有安全基线。阶段内各项任务支持依 DAG 有序并行开发与单元验证；跨阶段进入全链路集成联调前，必须以门槛通过标准完成上一阶段 Gate 校验。每阶段通过标准是下一阶段门槛，不代表单独证明生产安全。

| 阶段 | 目标 | 验收标准 |
|---|---|---|
| P0：工程底座与契约 | Schema v1.2.0、锁文件、CI、Agent/Worker/事件类型 | 干净安装；Lint/TypeCheck/测试 CI；状态/审批/版本不变式测试 |
| P1：Daemon 与真实 Worktree | CLI、loopback 服务、Worktree、恢复、锁、Watcher | 主树不被任务写入；崩溃/恢复/并发/清理与支持平台测试通过 |
| P2：Gateway 与 Adapter 安全 | 至少一个受控 Worker Adapter；路径/命令/预算/取消/脱敏/进程树 | 绕过文件系统与 shell 的测试失败关闭；不支持能力的 Adapter 不能标受控 |
| P3：IDE Workspace 最小闭环 | 文件树、代码阅读/受控编辑、Diff、右栏流式会话（TASK-C.6）、终端输出、Header 模式指示（HUD 徽章为 v0.2+） | 三栏操作一致指向仓库/Worktree；编辑越权拒绝；UI 断线不改 Daemon 状态；首 token ≤1s、打断 ≤2s、重启可续接 |
| P3.5：Vibe 模式与全局保护清单 | 运行模式切换、Auto-Checkpoint、一键撤销、`.stagent/protection.json`、静默合同、User-First 冲突仲裁 | 无保护清单全程零弹窗；保护路径任意模式被拦截；撤销按钮一键恢复现场 |
| P4：Supervisor 与合同审批 | 授权上下文、按需 Contract Draft（L0 规则 / L1 强模型）、交集判定自动批准 / 单问是/否 | Supervisor 不能审批/写代码/运行命令；忽略建议不阻断；不确定草案不可直接执行；未触保护区交互=1 次、触保护区 ≤2 次 |
| P5：独立 Evidence 与一键合并 | 验证命令、测试完整性、快照、费用、Trailer、Squash | Evidence 由 Daemon 生成；过期/失败/阻断不可合并；`can_merge=true` 一键合并无二次确认弹窗 |
| P5.5：成熟 Agent 受控实测 | Claude Code / cursor-agent / OpenHands 经 cli-host 黑盒实测 | 各 Adapter `verified_on` 填写真实版本与日期；4 类绕过负例在真实 CLI 上全部失败关闭；未通过者仅 Vibe 可用 |
| P6：集成 Dogfood | 真实仓库端到端与支持平台验证 | 记录真实模型费用、延迟、失败、恢复、隐私和 Adapter 限制；发布说明披露未验证边界 |
| v0.2+（推迟，另行立项）`[用户已确认 D4 · 2026-10-20]` | 架构雷达（B.1/B.2/C.4）、成熟度评分、多子任务 DAG、新鲜上下文、Schema-First、并行 Worktree（RFC-2026-002 远期附录） | 另行立项评审 |

### 10.1 v0.1 退出条件

只有 P0–P6 验收通过并完成真实仓库端到端试用，才可将 v0.1 标记为目标用户可试用。若仅单平台验证、Worker 缺少全工具 Gateway 强制、供应商费用仅估算、Supervisor 无法恢复或桌面 HUD 未实现，必须在发布说明中明确限制；不得宣传为 Cursor 全量替代或强对抗性安全产品。


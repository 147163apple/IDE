# Stagent 系统内部接口与通信契约清单 (API / IPC Contract Checklist)
**版本**: v1.0.0-draft  
**状态**: **讨论稿 / 已入库 reports**（对接看板；**API Top5 CLOSED**；Top5 Delta **已立卡** `TASK-C.12a`–`e`；**NEW_TASK ≠ 已实现**；正文仍非架构规范整份升格）  
**关联基准**:
- 《Stagent 系统架构设计规范 v1.6.1》
- 《Stagent 研发任务拆解与工程执行规范 v1.6.2》
- 《合同设计说明-2026-10-25》§7.5
- 《Supervisor运转机制-2026-10-25》§5.2 / §5.3
- 《工程决策拍板-Top7-2026-10-25》
- 《Supervisor右栏对话行为-设计-2026-10-26》（EO-01～10 CLOSED）
- 《Stagent_Clarification_and_Authorization_Specification_v1.0》（同目录讨论稿；§6 API Top5 CLOSED）
- 《Stagent_Documentation_Governance_Lifecycle_Chapter_v1.0》（同目录讨论稿）

> **收紧注记（2026-10-25 · 2026-10-26 Top5 定案）**  
> 1. 本表事件名多为**对接目标**；合入实现前须标注「**代码现状：已有 `/api` · 半有 · 无**」。**API Top5 五行**已完成现网对账（多为 **半有 / 无**）并收口为 **CLOSED 定案**（见 §3）；其余非 Top5 行仍可标字段细分，但**不得**再把 Top5 写成开放选择题。  
> 2. 拓扑中的独立 gRPC / 密码学 Token 等属目标叙述，**不得**写成 v0.1 已交付。**CLOSED ≠ 已实现**。  
> 3. **A-3 质疑超时**：以 Supervisor 定稿为准——**不静默放行**（暂停/标黄+审计；扩 Scope 须回用户）。下表 Pending 若仍写「放行」，视为过时选项。  
> 4. **API Top5（Token、重连、越界、Demo 门禁、无 Git 审计）已 CLOSED**（§3）；落地时映射为 **Delta 升级卡**，**不推翻**现网骨架；再立工程卡。

---

## 1. 概述与通信拓扑

本清单系统化汇总 **Daemon (状态中枢)**、**Supervisor (推理监理)**、**Gateway (执行拦截网关)** 与 **Frontend (前端交互界面)** 之间尚未完全定型的 API/IPC 协议、消息载荷（Payload Schema）、字段约束、通信方向与阻塞性待决事项。

### 1.1 系统通信拓扑与通信通道
```
                  ┌─────────────────────────────────────────┐
                  │          Frontend (Chat / UI)           │
                  └──────────────▲────────────▲─────────────┘
                                 │ HTTP/WS    │ SSE/IPC
                                 │            │ (状态推送/Graph)
                  ┌──────────────▼─────┐      │
                  │ Supervisor (监理)  │      │
                  └──────────────▲─────┘      │
                                 │ IPC / REST │
                  ┌──────────────▼────────────▼─────────────┐
                  │          Daemon (权威控制中枢)          │
                  └──────────────▲──────────────────────────┘
                                 │ IPC / gRPC / 双向 Token
                  ┌──────────────▼──────────────────────────┐
                  │        Gateway (物理拦截网关)           │
                  └─────────────────────────────────────────┘
```

---

## 1.2 代码现状列（整理约定）

入库时统一口径：实现层对照前，非 Top5 契约可暂标 **`代码现状: 待细分`**；对账后改为 `已有` / `半有` / `无`。**API Top5 五行（§3）已对账完毕**（半有/无）并 **CLOSED**，不得再写回「待对账开放题」。未对账行不得当作施工 Spec。

## 2. 接口契约清单矩阵

按子系统交互方向划分，本节列出 6 大通信通道的接口与消息契约。

### 通道 A: Supervisor ↔ Daemon (提案、质询与租约通道)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A-1** | `lease.readonly.request` / `lease.readonly.grant` | Sup → Dmn<br>Dmn → Sup | **Request**: `session_id`, `project_id`, `reason`, `requested_paths[]`<br>**Grant**: `lease_id`, `read_token`, `expires_at`, `allowed_root` | • 发起: Supervisor<br>• 裁决: Daemon | 1. 租约失效时间上限（默认 5m 还是按分析进度刷新？）；<br>2. 是否允许递归全仓 AST 扫描还是必须限定深度。 |
| **A-2** | `contract.proposal.submit` | Sup → Dmn | `proposal_id`, `contract_version`, `session_id`, `user_intent_summary`, `target_branch`, `impact_analysis`: { `writable_paths[]`, `read_only_paths[]`, `protected_paths[]`, `risk_level` }, `requirements_snapshot_ref`: { `snapshot_id`, `sha256` }, `test_plan`: { `unit_tests[]`, `regressions[]` } | • 提案: Supervisor<br>• 校验: Daemon | 1. Daemon 拒绝非法提案时的错误码细分（如 `E_SCOPE_WILDCARD`, `E_PROTECTED_VIOLATION`）；<br>2. 提案内是否允许携带伴生 Mock Demo 引用。 |
| **A-3** | `dispute.report.submit` (Task S.5) | Sup → Dmn | `dispute_id`, `contract_id`, `trigger_event`, `confidence_score` (0~100), `findings[]`: { `issue_type`, `severity`, `suspected_files[]`, `question_for_user` }, `rework_scope`: { `allowed_files[]` } (必须是已改动与合同交集) | • 发起: Supervisor<br>• 路由: Daemon | 1. 质疑超时 60s：定稿要求**不静默放行**（暂停/标黄+审计）；本行仅留「是否另有人工确认 UI」待决议。<br>2. 置信度评分低于多少分时静默转入后台日志。 |
| **A-4** | `prototype.register` | Sup → Dmn | `prototype_id`, `session_id`, `origin_host`, `sandbox_port`, `entrypoint_path`, `asset_digest`, `csp_policy`, **`demo_mode`** | • 生成: Supervisor<br>• 登记: Daemon | **Top5 #4 CLOSED**：活跃态 → `.stagent/prototypes/`（gitignore）；确认事件三态 + `can_sign`；合入后轻量拷贝 `records/`（EO-05/06）。端口回收仍可立卡细化，**不再**开「即弃 vs 进主干」选择题。 |

---

### 通道 B: Daemon ↔ Gateway (凭证、拦截与物理事件通道)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **B-1** | `token.issue` (Execution Token) | Dmn → Gtw | 见 §3 / 附录：`ExecToken` / `ResumeToken`（`jti`, `kind`, `contract_id`, `contract_hash`, `worktree_root`, `scope`, `egress_policy`, `issued_at`, `expires_at`, `session_epoch?`；resume 含 `replaces_jti`, `single_use`, `worktree_clean_ok`）；`hmac_signature` 可选 | • 签发: Daemon<br>• 验签: Gateway | **Top5 #1 CLOSED / EO-07**：通道 = Top7 §2（内存轻量 + IPC；v0.1 同进程校验 OK）；双层 session + `exec_token`；`PAUSED` 硬吊销；恢复一次性 `resume_token`+`jti`。**废止** JWT-only / 开放选型题。 |
| **B-2** | `intercept.violation.event` | Gtw → Dmn | `event_id`, `token_id`/`jti`, `timestamp`, `action: "WRITE"|"EXEC"|"EGRESS"`, `target_path`, `command`, `remote_host`, `violation_code: "E_OUT_OF_SCOPE"|"E_OUT_OF_SCOPE_UNTRACKED"|"E_EGRESS_BLOCKED"`, `process_pid`, `stack_trace` | • 拦截: Gateway<br>• 处理: Daemon | **Top5 #3 CLOSED / EO-02·07**：原子拦截 — 阻断当次 IO → `SIGINT` 软停 3s 释锁 → 超时 `SIGKILL` → 吊销 `exec_token` → 清锁文件 → `PAUSED` 问人；**禁止静默放行**。未跟踪文件漏网防护可立卡细化。 |
| **B-3** | `worktree.sync.status` | Gtw → Dmn | `worktree_id`, `base_commit_sha`, `current_tree_sha`, `untracked_files[]`, `modified_files[]`, `is_clean: boolean` | • 检测: Gateway<br>• 状态裁决: Daemon | 1. 沙盒环境限制下无法调用原生 `git` 时，Gateway 的文件 Diff 回退与指纹计算策略。 |

---

### 通道 C: Daemon ↔ Frontend (状态机广播与图谱流)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **C-1** | `STATE_CHANGED` (D.3 状态投影) | Dmn → UI | `project_id`, `timestamp`, **`session_epoch`**, **`state_seq`**, `delivery_state`（映射 **EO-01 `DeliveryState`**）, `control_plane_state`/`task_sub_state`, `active_contract_id`, `active_task_id`, `blocking_reason` | • 投影计算: Daemon<br>• 消费渲染: UI | **Top5 #2 CLOSED / EO-01**：重连按 `state_seq` 去重防倒流；广播须映射 EO-01 强类型枚举（废止模糊旧态冒充）。复合态展示优先级可立卡细化。 |
| **C-2** | `GRAPH_DELTA` (Task C.7) | Dmn → UI | `view_mode: "PANORAMA"|"CONSTRUCTION"`, `delta_type: "NODE_STATUS"|"EDGE_ADD"|"EVIDENCE_UPDATE"`, `node_id`, `new_status: "PENDING"|"RUNNING"|"VERIFIED"|"FAILED"|"STALE"`, `evidence_ref`: { `evidence_id`, `assertion_id`, `test_count`, `pass_count` } | • 裁决推送: Daemon<br>• 渲染点亮: UI | 1. 空测试集阻断逻辑中，UI 如何呈现“不可点亮”的警告提示？<br>2. 双视图切换时是全量快照刷新还是增量 Delta 补丁。 |
| **C-3** | `AUTHORIZATION_CARD_READY` | Dmn → UI | `contract_id`, `version`, `title`, `plain_language_summary`, `target_files_count`, `highlighted_files[]`, `safety_guarantees[]`, `test_assertions[]`, `contract_hash` | • 打包: Daemon<br>• 展示卡片: UI | 1. 白话卡片中复杂依赖的折叠展示规范；<br>2. 用户自定义微调参数（如排除某些可选文件）的回传协议。 |

---

### 通道 D: Frontend ↔ Daemon (用户显式控制与授权)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **D-1** | `contract.authorize` | UI → Dmn | `contract_id`, `contract_version`, `contract_hash`, `user_id`, `authorized_at`, `action: "APPROVE"|"REJECT"|"MODIFY"`, `user_feedback` (可选) | • 发起: UI<br>• 校验执行: Daemon | **拒签/改细节回退 CLOSED**（澄清稿 §5.4 / Top7 §5）：默认保留 Demo+上下文；草案递增 `v1.x-draft` / `SUPERSEDED`。防重放 Nonce 可立卡细化，**不再**开回退选择题。 |
| **D-2** | `execution.abort` | UI → Dmn | `project_id`, `contract_id`, `reason`, `cleanup_mode: "DISCARD_WORKTREE"|"PRESERVE_EVIDENCE"` | • 触发: UI<br>• 强制终止: Daemon | 1. 异步 Abort 时进程终止的心跳超时窗口（如 5s 软终止后强行 `SIGKILL`）；<br>2. 未保存文件的保护提示与工作区脏文件保留策略。 |
| **D-3** | `acceptance.submit` | UI → Dmn | `contract_id`, `candidate_tree_sha`, `result: "ACCEPT"|"DISPUTE"|"REWORK"`, `user_notes` | • 发起: UI<br>• 合并决策: Daemon | 1. 验收通过后是自动快进合并（Fast-Forward）还是生成显式 Merge Commit 并附加审计 Trailer。 |

---

### 通道 E: Frontend ↔ Supervisor (澄清会话与原型交互)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **E-1** | `clarification.message` | UI ↔ Sup | `session_id`, `role: "user"|"assistant"`, `content`, `intent_tags[]`, `options[]`: { `label`, `description`, `is_recommended` } | • 对话交互: Agent & UI | **轮次上限 CLOSED**（Top7 §4 / 澄清稿 §5.3）：主动澄清 ≤2 轮带唯一推荐项。Card Options 排版可立卡细化。 |
| **E-2** | `DEMO_PREVIEW_STATUS` (Task S.4) | Sup → UI | `session_id`, `prototype_id`, `status: "BUILDING"|"READY"|"ERROR"|"DESTROYED"`, `preview_url`, `isolated_origin`, `fallback_snapshot_url`, `error_message` | • 状态推送: Supervisor<br>• 渲染 Iframe: UI | 1. 前端 Iframe CSP 与跨源通信（`postMessage`）的白名单限制（严禁访问父级 Storage）；<br>2. 预览超时的重试与降级静态截图呈现机制。 |

---

### 通道 F: Daemon ↔ Storage/Git (资产持久化与基线管理)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **F-1** | `asset.freeze` | Dmn → Store | `asset_id`, `asset_type: "REQUIREMENTS"|"CONTRACT"|"EVIDENCE"`, `content_raw`, `sha256`, `metadata`: { `contract_id`, `base_commit_sha`, `author`, `frozen_at` } | • 冻结: Daemon<br>• 写入: Store | 1. 资产存储介质选型（本地 `.stagent/` 目录 vs 专用 SQLite/Postgres vs Git 对象库）；<br>2. 防止外部进程直接修改 `.stagent/` 文件的防篡改机制。 |
| **F-2** | `git.commit.trailer.bind` / `audit.manifest.write` | Dmn → Git / Store | Trailer：`Stagent-Contract-Id` 等；**无 Git 侧车**：`.stagent/records/{contract_id}/audit-manifest.json`（脱敏后快照+审计事件哈希） | • 绑定: Daemon<br>• 驱动: Git / records | **Top5 #5 CLOSED / EO-03·04·05**：无 Git 时以 `audit-manifest.json` **独立证明**完整性（不依赖 Git Trailer）。Trailer Key 长度规范可立卡细化。 |

---

## 3. API Top5 定案（CLOSED · 2026-10-26 · As-is → To-be → EO）

> **状态：CLOSED（规范定案）** — Tina 拍板。现网对账结论：五项均为 **半有** 或 **无**（通道/体感骨架多半有；EO 级硬核契约缺）。**不推翻**现网骨架，缺口映射为 **Delta 升级卡**。**CLOSED ≠ 已实现**；正文仍讨论稿；Top5→TASK-C.12a–e 已立卡。交叉正文见《Stagent_Clarification_and_Authorization_Specification_v1.0》§6。

| # | API Top5 | 代码现状 | 现网 As-is | 目标 To-be（定案） | 对应 EO | Delta 升级卡方针 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Token 凭证（B-1） | **半有** | 仅单层 `session-token`，同进程拦写 | 双层：外部 session + 内部 `exec_token`（绑定 `contract_id`+worktree）；`PAUSED` 硬吊销；恢复一次性 `resume_token`+`jti` | EO-07 | 升级卡，保留现网 session |
| 2 | 状态与重连（C-1） | **半有** | 粗粒度全量 `STATE` 广播回放 | `session_epoch` + `state_seq`；广播映射 EO-01 枚举；客户端 seq 去重**防倒流** | EO-01 | 升级卡，在 STATE 通道叠序列 |
| 3 | 越界与拦截（B-2） | **半有** | 抛错拦截 + UI 弹窗 | 原子拦截：SIGINT 软停 3s 释锁 → 超时 SIGKILL → 吊销 `exec_token` → 清锁文件；**禁静默放行** | EO-02, EO-07 | 升级卡，补进程/锁语义 |
| 4 | Demo 门禁（A-4 / E-2） | **半有** | prototypes 目录 + 布尔确认 | `demo_mode` 三态 + `can_sign` 硬谓词；合入后轻量拷贝 `.stagent/records/` | EO-05, EO-06 | 升级卡，不推翻 prototypes |
| 5 | 无 Git 审计（F-2） | **无** | 缺失 | `.stagent/records/{contract_id}/audit-manifest.json`（脱敏后快照+事件哈希；独立于 Git） | EO-03, EO-04, EO-05 | 新建侧车；不依赖 Trailer |

### 3.1 原「建议 / 开放焦点」→ 已定案指针

| 原 §3 开放题（历史） | 定案 |
| :--- | :--- |
| JWT 离线 vs IPC/Domain Socket | **CLOSED**：Top7 §2 内存轻量 + IPC；v0.1 同进程校验 OK；**非** JWT-only |
| epoch / sequence_id 是否引入 | **CLOSED**：必须 `session_epoch` + `state_seq`（Top5 #2） |
| 越界仅阻断 vs 杀进程 | **CLOSED**：原子拦截软停 3s→SIGKILL→吊销→清锁（Top5 #3） |
| Demo 即弃 vs 归档 / 是否进主干 | **CLOSED**：prototypes 活跃 + records 轻量拷贝；**不进主干**（Top5 #4） |
| 侧车清单路径 `.stagent/metadata/...` | **CLOSED**：改为 **`records/{contract_id}/audit-manifest.json`**（Top5 #5；废止旧 `metadata/` 建议路径） |

### 3.2 附录：Token Schema 草稿（定案目标 · 非已实现）

```ts
type ExecToken = {
  jti: string;
  kind: "exec";
  contract_id: string;
  contract_hash: string;
  worktree_root: string;
  scope: { writable_paths: string[]; allowed_commands: string[] };
  egress_policy: unknown;
  issued_at: string;
  expires_at: string;
  session_epoch?: number;
};

type ResumeToken = {
  jti: string;
  kind: "resume";
  contract_id: string;
  replaces_jti: string;
  issued_at: string;
  expires_at: string;
  single_use: true;
  worktree_clean_ok: boolean;
};
```

* `hmac_signature`：可选（IPC 需 Daemon 实时确认时再附）。  
* **落定句**：API Top5 五行 **CLOSED**；其余矩阵行的字段细分 / UI 排版等可继续立卡，但**不得**再把上表五题当作开放决议。

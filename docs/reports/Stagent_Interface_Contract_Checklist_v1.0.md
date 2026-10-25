# Stagent 系统内部接口与通信契约清单 (API / IPC Contract Checklist)
**版本**: v1.0.0-draft  
**状态**: **讨论稿 / 已入库 reports · 未升格为施工依据**（待决议看板，非已定型 Schema）  
**关联基准**:
- 《Stagent 系统架构设计规范 v1.6.1》
- 《Stagent 研发任务拆解与工程执行规范 v1.6.2》
- 《合同设计说明-2026-10-25》§7.5
- 《Supervisor运转机制-2026-10-25》§5.2 / §5.3
- 《Stagent_Clarification_and_Authorization_Specification_v1.0》（同目录讨论稿）
- 《Stagent_Documentation_Governance_Lifecycle_Chapter_v1.0》（同目录讨论稿）

> **收紧注记（2026-10-25）**  
> 1. 本表事件名多为**对接目标**；每条合入实现前须补「**代码现状：已有 `/api` · 半有 · 无 · 待对账**」——当前默认 **待对账**，勿照表一次性开干。  
> 2. 拓扑中的独立 gRPC / 密码学 Token 等属目标叙述，**不得**写成 v0.1 已交付。  
> 3. **A-3 质疑超时**：以 Supervisor 定稿为准——**不静默放行**（暂停/标黄+审计；扩 Scope 须回用户）。下表 Pending 若仍写「放行」，视为过时选项。  
> 4. 先拍 Top5（Token、重连、越界处置、Demo 归宿、无 Git 降级），再立工程卡。

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

入库时统一口径：实现层对照前，每条契约默认 **`代码现状: 待对账`**。对账后改为 `已有`（现网 `POST /api/...` 或等价 IPC）、`半有`、或 `无`。未对账不得当作施工 Spec。

## 2. 接口契约清单矩阵

按子系统交互方向划分，本节列出 6 大通信通道的接口与消息契约。

### 通道 A: Supervisor ↔ Daemon (提案、质询与租约通道)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A-1** | `lease.readonly.request` / `lease.readonly.grant` | Sup → Dmn<br>Dmn → Sup | **Request**: `session_id`, `project_id`, `reason`, `requested_paths[]`<br>**Grant**: `lease_id`, `read_token`, `expires_at`, `allowed_root` | • 发起: Supervisor<br>• 裁决: Daemon | 1. 租约失效时间上限（默认 5m 还是按分析进度刷新？）；<br>2. 是否允许递归全仓 AST 扫描还是必须限定深度。 |
| **A-2** | `contract.proposal.submit` | Sup → Dmn | `proposal_id`, `contract_version`, `session_id`, `user_intent_summary`, `target_branch`, `impact_analysis`: { `writable_paths[]`, `read_only_paths[]`, `protected_paths[]`, `risk_level` }, `requirements_snapshot_ref`: { `snapshot_id`, `sha256` }, `test_plan`: { `unit_tests[]`, `regressions[]` } | • 提案: Supervisor<br>• 校验: Daemon | 1. Daemon 拒绝非法提案时的错误码细分（如 `E_SCOPE_WILDCARD`, `E_PROTECTED_VIOLATION`）；<br>2. 提案内是否允许携带伴生 Mock Demo 引用。 |
| **A-3** | `dispute.report.submit` (Task S.5) | Sup → Dmn | `dispute_id`, `contract_id`, `trigger_event`, `confidence_score` (0~100), `findings[]`: { `issue_type`, `severity`, `suspected_files[]`, `question_for_user` }, `rework_scope`: { `allowed_files[]` } (必须是已改动与合同交集) | • 发起: Supervisor<br>• 路由: Daemon | 1. 质疑超时 60s：定稿要求**不静默放行**（暂停/标黄+审计）；本行仅留「是否另有人工确认 UI」待决议。<br>2. 置信度评分低于多少分时静默转入后台日志。 |
| **A-4** | `prototype.register` | Sup → Dmn | `prototype_id`, `session_id`, `origin_host`, `sandbox_port`, `entrypoint_path`, `asset_digest`, `csp_policy` | • 生成: Supervisor<br>• 登记: Daemon | 1. Demo 原型是即弃型还是归档型？沙盒生命周期与端口回收机制。 |

---

### 通道 B: Daemon ↔ Gateway (凭证、拦截与物理事件通道)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **B-1** | `token.issue` (Execution Token) | Dmn → Gtw | `token_id`, `contract_id`, `contract_hash`, `issued_at`, `expires_at`, `worktree_root`, `scope`: { `writable_paths[]` (精确匹配/禁止通配符), `allowed_commands[]` }, `egress_policy`: { `allowed_hosts[]`, `mode: "block"|"whitelist"` }, `hmac_signature` | • 签发: Daemon<br>• 验签: Gateway | 1. **认证协议选型**：JWT 离线验签 vs 本地 Domain Socket / IPC 实时问询；<br>2. 任务异常中断时，Token 的主动吊销（Revoke）与黑名单广播延迟。 |
| **B-2** | `intercept.violation.event` | Gtw → Dmn | `event_id`, `token_id`, `timestamp`, `action: "WRITE"|"EXEC"|"EGRESS"`, `target_path`, `command`, `remote_host`, `violation_code: "E_OUT_OF_SCOPE"|"E_OUT_OF_SCOPE_UNTRACKED"|"E_EGRESS_BLOCKED"`, `process_pid`, `stack_trace` | • 拦截: Gateway<br>• 处理: Daemon | 1. 触发越界时是否立即杀掉整组进程树（`SIGKILL`），还是仅拦截单次调用并挂起等待干预？<br>2. 未跟踪文件检测的时机与漏网防护。 |
| **B-3** | `worktree.sync.status` | Gtw → Dmn | `worktree_id`, `base_commit_sha`, `current_tree_sha`, `untracked_files[]`, `modified_files[]`, `is_clean: boolean` | • 检测: Gateway<br>• 状态裁决: Daemon | 1. 沙盒环境限制下无法调用原生 `git` 时，Gateway 的文件 Diff 回退与指纹计算策略。 |

---

### 通道 C: Daemon ↔ Frontend (状态机广播与图谱流)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **C-1** | `STATE_CHANGED` (D.3 状态投影) | Dmn → UI | `project_id`, `timestamp`, `presentation_state`: (15个枚举之一，如 `DISCUSSING`, `WAITING_CONTRACT`, `BUILDING`, `ABORTED`, `AUDITED`), `control_plane_state`, `active_contract_id`, `active_task_id`, `blocking_reason` | • 投影计算: Daemon<br>• 消费渲染: UI | 1. 历史事件幂等性与前端断线重连（Reconnect & Replay）的序列号（`seq_num`）定义；<br>2. 复合状态下的降级展示顺序（ABORTED 优先级 vs AUDITED 优先级）。 |
| **C-2** | `GRAPH_DELTA` (Task C.7) | Dmn → UI | `view_mode: "PANORAMA"|"CONSTRUCTION"`, `delta_type: "NODE_STATUS"|"EDGE_ADD"|"EVIDENCE_UPDATE"`, `node_id`, `new_status: "PENDING"|"RUNNING"|"VERIFIED"|"FAILED"|"STALE"`, `evidence_ref`: { `evidence_id`, `assertion_id`, `test_count`, `pass_count` } | • 裁决推送: Daemon<br>• 渲染点亮: UI | 1. 空测试集阻断逻辑中，UI 如何呈现“不可点亮”的警告提示？<br>2. 双视图切换时是全量快照刷新还是增量 Delta 补丁。 |
| **C-3** | `AUTHORIZATION_CARD_READY` | Dmn → UI | `contract_id`, `version`, `title`, `plain_language_summary`, `target_files_count`, `highlighted_files[]`, `safety_guarantees[]`, `test_assertions[]`, `contract_hash` | • 打包: Daemon<br>• 展示卡片: UI | 1. 白话卡片中复杂依赖的折叠展示规范；<br>2. 用户自定义微调参数（如排除某些可选文件）的回传协议。 |

---

### 通道 D: Frontend ↔ Daemon (用户显式控制与授权)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **D-1** | `contract.authorize` | UI → Dmn | `contract_id`, `contract_version`, `contract_hash`, `user_id`, `authorized_at`, `action: "APPROVE"|"REJECT"|"MODIFY"`, `user_feedback` (可选) | • 发起: UI<br>• 校验执行: Daemon | 1. 签名防重放机制：前端是否需要包含客户端时间戳与会话 Nonce；<br>2. 若用户选择“修改细节”，状态回退至 `DRAFT` 还是产生分支版本 `v1.1-draft`。 |
| **D-2** | `execution.abort` | UI → Dmn | `project_id`, `contract_id`, `reason`, `cleanup_mode: "DISCARD_WORKTREE"|"PRESERVE_EVIDENCE"` | • 触发: UI<br>• 强制终止: Daemon | 1. 异步 Abort 时进程终止的心跳超时窗口（如 5s 软终止后强行 `SIGKILL`）；<br>2. 未保存文件的保护提示与工作区脏文件保留策略。 |
| **D-3** | `acceptance.submit` | UI → Dmn | `contract_id`, `candidate_tree_sha`, `result: "ACCEPT"|"DISPUTE"|"REWORK"`, `user_notes` | • 发起: UI<br>• 合并决策: Daemon | 1. 验收通过后是自动快进合并（Fast-Forward）还是生成显式 Merge Commit 并附加审计 Trailer。 |

---

### 通道 E: Frontend ↔ Supervisor (澄清会话与原型交互)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **E-1** | `clarification.message` | UI ↔ Sup | `session_id`, `role: "user"|"assistant"`, `content`, `intent_tags[]`, `options[]`: { `label`, `description`, `is_recommended` } | • 对话交互: Agent & UI | 1. 澄清选项结构体（Card Options）与普通 Markdown 文本的混合排版协议；<br>2. 提问轮次上限控制（防止用户疲劳）。 |
| **E-2** | `DEMO_PREVIEW_STATUS` (Task S.4) | Sup → UI | `session_id`, `prototype_id`, `status: "BUILDING"|"READY"|"ERROR"|"DESTROYED"`, `preview_url`, `isolated_origin`, `fallback_snapshot_url`, `error_message` | • 状态推送: Supervisor<br>• 渲染 Iframe: UI | 1. 前端 Iframe CSP 与跨源通信（`postMessage`）的白名单限制（严禁访问父级 Storage）；<br>2. 预览超时的重试与降级静态截图呈现机制。 |

---

### 通道 F: Daemon ↔ Storage/Git (资产持久化与基线管理)

| 契约编号 | 接口 / 事件名称 | 通信方向 | 核心载荷字段 (Payload Schema) | 责任方 | 阻塞性待决事项 (Pending Decisions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **F-1** | `asset.freeze` | Dmn → Store | `asset_id`, `asset_type: "REQUIREMENTS"|"CONTRACT"|"EVIDENCE"`, `content_raw`, `sha256`, `metadata`: { `contract_id`, `base_commit_sha`, `author`, `frozen_at` } | • 冻结: Daemon<br>• 写入: Store | 1. 资产存储介质选型（本地 `.stagent/` 目录 vs 专用 SQLite/Postgres vs Git 对象库）；<br>2. 防止外部进程直接修改 `.stagent/` 文件的防篡改机制。 |
| **F-2** | `git.commit.trailer.bind` | Dmn → Git | `commit_sha`, `trailers`: { `Stagent-Contract-Id`, `Stagent-Contract-Hash`, `Stagent-Requirements-Snapshot`, `Stagent-Verified-Tree` } | • 绑定: Daemon<br>• 驱动: Git | 1. Trailer 格式长度上限（D.2b 已做单行限制，需统一字段 Key 规范）；<br>2. 无 Git 仓库或脏工作树时的元数据降级侧车文件（Sidecar Manifest）格式。 |

---

## 3. 阻塞性架构决议汇总 (Top 5 Architectural Blockers)

在正式编写各模块接口代码与自动化测试前，必须优先裁决以下 5 个核心机制：

1. **凭证分发与校验架构（契约 B-1）**
   * *决议焦点*: Gateway 拦截时是使用基于公私钥体系的独立 JWT Token 离线校验，还是通过 IPC/Domain Socket 实时向 Daemon 发起同步验证？
   * *建议*: 采用**内存级轻量 Token + 共享内存/IPC 校验**，既能实现微秒级本地文件拦截，又能在 Daemon 收到 Abort 时实现物理瞬时吊销。

2. **状态推送与重连一致性机制（契约 C-1）**
   * *决议焦点*: 前端 WebSocket 断线或刷新重连后，如何确保 15 个展示状态的绝对精准？
   * *建议*: 在 `STATE_CHANGED` 载荷中引入单调递增的 `epoch` 与 `sequence_id`，重连时前端发送最后接收的 `sequence_id`，Daemon 下发全量快照加增量事件。

3. **越界违规处置策略（契约 B-2）**
   * *决议焦点*: Gateway 拦截到 `E_OUT_OF_SCOPE` 或 `E_OUT_OF_SCOPE_UNTRACKED` 时，是仅阻断当次 IO，还是强制终止执行进程？
   * *建议*: **阻断当次 IO + 暂停任务执行并保留现场**，通知 Daemon 将状态置为 `PAUSED` 并向用户报出越界告警，由用户决定是终止回滚还是扩大授权。

4. **Mock Demo 资产治理归宿（契约 A-4 / E-2）**
   * *决议焦点*: 验证通过或合同拒绝后，Mock 原型代码是否保留在项目存储中？
   * *建议*: 存入 `.stagent/prototypes/<prototype_id>`，但不进入代码版本库主干（加入 `.gitignore`）。既可作为后续质询与实施的视觉参考，又不污染用户项目源码。

5. **无 Git 或异常环境下的审计降级（契约 F-2）**
   * *决议焦点*: 在无法依赖完整 Git 仓库的环境下，如何满足审计不可篡改要求？
   * *建议*: 采用**侧车清单文件 (`.stagent/metadata/audit-manifest.json`)**，记录物理文件 SHA-256 指纹列表与合同 Hash，作为 Git Trailer 缺失时的对等降级审计链。


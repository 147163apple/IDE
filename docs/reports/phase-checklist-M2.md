# M2 阶段核对清单 — Track A 收口（A.1 / A.2 / A.4 / A.5）

> 计划依据：`~/.workbuddy/plans/swift-pulse-darwin-M30Jbj0P.md` §2 M2
> 日期：2026-10-19 · 前置：M1 已签收（71/71 测试绿）

---

## 1. 任务完成度

| 编号 | 任务 | 状态 | 证据 |
|---|---|---|---|
| M2-1 | A.2 第 5 工具 + read_file 保护 | ✅ 完成 | `daemon/mcp/gateway.ts`：`stagent_declare_complete`（5 工具齐备）、1 MiB 截断 `truncated`、二进制仅返回 `{binary,size_bytes,sha256}` |
| M2-2 | A.4 3s 宽限 + 脱敏 + 网络策略 | ✅ 完成 | `KILL_GRACE_MS=3000`；`redactSecrets()` 先脱敏后截断，返回 `truncated/secretRedacted`；`networkPolicy=DENY` 注入离线变量；`E_UNAUTHORIZED_COMMAND` 对齐 §9.3 |
| M2-3 | A.5 持久化 + 错误码 + 状态联动 | ✅ 完成 | `daemon/guard/state-store.ts` 原子持久化；LoopGuard/CostMonitor 重启恢复；`E_BUDGET_EXCEEDED` / `E_RETRY_LIMIT_EXCEEDED`；`buildBreakerOutcome()` 产出 `PENDING_RESUME + BLOCKED + reason_code` |
| M2-4 | A.1 脏工作区确认 | ✅ 完成 | `inspectMainWorktree()` 返回文件清单与提示；未确认抛 `DirtyWorktreeConfirmationRequiredError`；确认后创建且不复制脏文件，`warnings` 随结果返回 |
| M2-5 | 测试 + 门禁 | ✅ 通过 | 新增 `tests/daemon/m2-hardening.test.ts`（14 用例）；全量 85/85 通过 |

---

## 2. 规范判据对照

### TASK-A.2
- [x] 5 个工具：read / write / exec / list_dir / **declare_complete**
- [x] read_file 默认 1 MiB 上限，超限截断并标记 `truncated`
- [x] 二进制仅返回元数据与 SHA-256，禁止文本解码
- [x] `declare_complete` 返回 `{ ready_for_audit, blockers[] }`，由服务端按真实 Scope/预算/验证结果判定
- [x] 路径穿越 realpath 防护（既有）、strictly_forbidden 优先（既有）

### TASK-A.4
- [x] `shell:false` + 结构化 argv（既有）
- [x] 命令白名单，越权返回 `E_UNAUTHORIZED_COMMAND`
- [x] 单命令超时 SIGTERM → **3s** 宽限 → SIGKILL，退出码 124
- [x] **任务级总时长独立累计**，超限返回 `E_TASK_TIMEOUT`（与单命令超时分离）
- [x] 输出先脱敏（sk-/ghp_/AKIA/xox/Bearer/KEY=VALUE + 显式 secretValues）后截断（100k）
- [x] 返回 `truncated` / `secretRedacted` 标志
- [x] `network_policy=DENY` 注入离线约束（代理黑洞 + `npm_config_offline` + `PIP_NO_INDEX`）

### TASK-A.5
- [x] 连续失败达 `max_verification_retries`（默认 3）熔断
- [x] 费用/Token 支持最小货币单位 + 币种，`assertCanConsume` 预检
- [x] 错误码对齐 §9.3：`E_BUDGET_EXCEEDED` / `E_RETRY_LIMIT_EXCEEDED`
- [x] 状态全量落盘（`.stagent/*.json`，0600 原子写），重启不重置
- [x] 熔断结果映射 `PENDING_RESUME` + `BLOCKED` + `BUDGET_EXHAUSTED` / `VERIFICATION_RETRY_LIMIT`

### TASK-A.1
- [x] 脏工作区检测返回文件清单 + 明确提示
- [x] 未确认时拒绝创建（可恢复：确认后重试），不做 `git reset`、不复制未提交内容
- [x] 确认创建后 `warnings` 回传，任务 Worktree 不含脏文件（测试断言）

---

## 3. 门禁实测（2026-10-19 17:01）

```text
Node v22.22.2 · npm 10.9.7 · Git 2.54.0 · darwin arm64
1. TypeScript typecheck  → exit 0（0 error）
2. Lint                  → exit 0（0 error / 6 既有 warning）
3. Unit tests            → 85 passed / 85（14 files）
=== All verifications passed successfully! ===
```

---

## 4. 残留风险与移交事项

| # | 事项 | 说明 | 承接阶段 |
|---|---|---|---|
| 1 | `network_policy=DENY` 为尽力约束 | 通过代理黑洞/离线变量实现，非内核级网络隔离；符合规范「非对抗性沙箱」定位，需在 README 声明（ADR-003） | M8 |
| 2 | 熔断状态机联动为「描述层」 | `buildBreakerOutcome()` 已产出标准三元组，但实际合同状态原子写入需由 Daemon 管线执行 | M5 |
| 3 | `declare_complete` 的验证结果来源 | 当前读取 LoopGuard 历史；接入真实验证器后应改为 Evidence 候选快照 | M5 |
| 4 | 旧错误码别名保留 | `E_LOOP_CIRCUIT_TRIPPED` / `E_COST_CAP_EXCEEDED` 仍导出，值已指向新码；M5 清理 | M5 |

---

## 5. 签收

- [x] M2-1 A.2 收口
- [x] M2-2 A.4 收口
- [x] M2-3 A.5 收口
- [x] M2-4 A.1 收口
- [x] M2-5 测试与门禁

**M2 状态：已签收（2026-10-19）。A.1 / A.2 / A.4 / A.5 由「部分完成」转为「完成」（A.5 状态机实际写入待 M5 接线）。**

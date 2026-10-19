# TASK-D.1 交付与验证报告

> 仓库：`/Users/tina/Desktop/1020`（分支 `main`）
> 任务：`TASK-D.1` CLI 引导入口与安全 WebSocket 通信桥
> 日期：2026-10-20
> 规范依据：A《系统架构设计规范 v1.2.1 终审基线》§6.1；B《研发任务拆解 v1.2.2 终审签发版》Task D.1 卡片

---

## 0. 执行前仓库状态（实录）

- HEAD：`c45ba40 docs(report): TASK-0.2b 复跑验证闭环`
- 工作区**预先存在**与本任务无关的未提交改动（用户将两份规范文档迁入 `docs/`、删除 v1.1.3 旧版、加入第二轮复审报告）。这些文件未被覆盖/清理/重置；本任务仅在其上对 B 文档做被要求的状态与路径更新。

## 1. 规范一致性核对结论（改码前）

逐项核对结果：**无阻断冲突**，允许继续实施。

| 条款 | A §6.1 | B Task D.1 | 判定 |
|---|---|---|---|
| 首帧 AUTH / 失败 4401 / 禁无限重连 | ✓ | ✓ | 一致 |
| Token 落盘 `.stagent/session-token`（0600）、PID 文件不含秘密 | ✓ | ✓ | 一致 |
| PID 锁后轮换 Token、崩溃残留失效 | ✓ | ✓ | 一致 |
| Origin 校验 | "只接受当前仓库 UI 的合法来源" | `127.0.0.1:*` / `localhost:*` | B 为 A 的具体化，无冲突 |
| 帧字典 13 类（含 `EVIDENCE_READY`/`EVIDENCE_STATUS_CHANGED`/`TERMINAL_STREAM`） | ✓ | ✓ | 一致（"至少包括"允许历史扩展帧） |
| 标准帧字段 `trace_id, type, timestamp, payload` | ✓ | 未重复但不排斥 | 以 A 为准补齐 |
| 帧 ≤2MB / 连接速率限制 | "校验帧大小/连接速率" | ≤2MB / 防 DoS | 一致（数值仅 B 给出） |
| 心跳 5s PING、3 次失联（15s）遮罩 | ✓ | ✓ | 一致 |

**发现的代码级违规（本任务修复）**：
1. `src/lib/daemon-api.ts` 从 `?token=` query 读取 Token —— 违反 B D.1 FAIL 判定；
2. `daemon/server.ts isAuthorized()` 接受 `?token=` query —— 同上；
3. 心跳判定 off-by-one：原实现在第 4 个心跳周期（≈20s）才判断线，规范为 15s。

## 2. 变更文件清单

| 文件 | 变更 |
|---|---|
| `src/lib/ipc/frames.ts` | 帧字典补齐 6 类规范帧（`CHAT_EVENT`/`SUPERVISOR_SUGGESTION`/`WORKER_EVENT`/`GATEWAY_VIOLATION`/`EVIDENCE_STATUS_CHANGED`/`TERMINAL_STREAM`）；标准帧补 `trace_id`（`createFrame` 自动生成 UUID）；新增 `FRAME_CATALOG`（每帧方向/鉴权/尺寸/语义）与 `isClientToServerAllowed`；`MAX_FRAME_BYTES = 2MB` |
| `daemon/server.ts` | 默认端口 41792~41802 → **3001~3010**；WS `maxPayload=2MB`（超限 1009）；Upgrade 阶段新增 **Host 头回环校验**与**单 IP 连接速率滑窗**（默认 30 次/10s，429 拒绝）+ 并发上限（64，503）；`isAuthorized` 删除 `?token=` 通道；鉴权后帧方向门禁（伪造 `server->client` 帧 → `FRAME_DIRECTION_FORBIDDEN`）；证据失效同时广播规范帧 `EVIDENCE_STATUS_CHANGED`（`SCOPE_ALERT` 保留兼容） |
| `daemon/core/session-token.ts` | 新增 `isLocalHostAuthority()`（DNS Rebinding 防线：重绑定后 GET 不带 Origin，Host 头是唯一可靠判别） |
| `src/lib/ipc/client.ts` | 心跳修正为规范语义：AUTH_OK 立即 PING，第 3 次失联恰在 15s 触发关闭重连（原 20s） |
| `src/lib/daemon-api.ts` | 删除 `?token=` 读取；新增 `#token=` fragment 引导 + `history.replaceState` 即时抹除；默认地址 `http://127.0.0.1:3001` |
| `bin/stagent.ts` | 新增 `--ui-url`/`--no-browser`（env: `STAGENT_UI_URL`/`STAGENT_NO_BROWSER`）；启动后按平台 opener 唤起浏览器（darwin `open` / win32 `rundll32` / linux `xdg-open`，结构化 argv 无 shell）；Token 仅经 fragment 传递、日志只打印脱敏地址；加入口守卫使纯函数可被测试 import；修正 `PidLockInfo.startedAt` 字段名 |

## 3. 测试证据

| 测试文件 | 覆盖点 | 结果 |
|---|---|---|
| `tests/unit/ws-auth-handshake.test.ts`（新，6 用例） | 错误 Token / 非 AUTH 首帧 **50ms 内 4401**（实测计时断言）、畸形 JSON 4401、AUTH_OK 携带 UUID `trace_id`、**Token 轮换后旧 Token 必 4401**、日志无 Token 明文 | ✅ |
| `tests/unit/ws-frame-dictionary.test.ts`（新，9 用例） | 13 类规范帧齐备、CATALOG 完备无冗余、鉴权豁免仅 AUTH/AUTH_OK/ERROR、方向白名单、2MB 常量 | ✅ |
| `tests/unit/cli-entry.test.ts`（新，8 用例） | 参数解析、fragment 构造（剔除残留 `?token=`）、三平台 opener argv | ✅ |
| `tests/daemon/ws-security.test.ts`（新，11 用例） | 非法 Origin 403、合法 Origin 放行、WS/HTTP Host 伪造 403、**>2MB 帧 1009 关闭**、**速率超限 429**、HTTP `?token=` 401 + Bearer 200、伪造 `server->client` 帧 ERROR 且连接保持、默认端口 ∈ [3001,3010] | ✅ |
| `src/hooks/use-daemon-stream.test.tsx`（+2 用例） | **3 次心跳失联（15s）→ `reconnecting`（遮罩触发条件）**、PONG 重置失联计数 | ✅ |
| `src/tests/daemon-api-token.test.tsx`（新，4 用例） | query token 被忽略、fragment 接收+抹除、sessionStorage 沿用、默认地址 3001 | ✅ |

既有 `tests/daemon/ws-auth.test.ts`（7 用例，含"未鉴权连接收不到广播帧"）保持全绿。

## 4. 门禁实录（本任务最终状态）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node scripts/verify-env.mjs --env-only` | 0 | darwin arm64 / Node v22.22.2 / npm 10.9.7 / Git 2.54.0 |
| `npm run typecheck`（`tsc --noEmit`） | 0 | 0 错误 |
| `npx eslint <逐目录>`（src/lib、src/hooks、src/tests、src/components、src/routes、daemon、bin、tests、scripts + 根配置） | 0 | 0 违规（修复 10 处 prettier 格式后复验） |
| `npm test`（全量） | 0 | **48 文件 / 377 用例全绿**（较 0.2b 基线 43/339 新增 5 文件 / 38 用例） |

> 注 1：`eslint .` 单进程整仓运行在 WorkBuddy broker IPC shim 上仍有 `write EPIPE` 崩溃（环境问题，审计轮已记录），故采用逐目录等价覆盖，合并退出码为 0。
>
> 注 2（诚实记录）： prettier `--fix`（10 处纯空白修复）之后、本报告定稿前的最后一次全量复跑（18:45）遭遇**会话级沙箱删除封锁**：日志中含 120 处 `git init` 配置写入失败与 176 处 `node-safe-delete-shim` 栈帧，156 个失败全部位于使用临时 git 仓库/临时目录的用例（含 afterEach 清理 EPERM 级联）。判定为**环境错误而非代码失败**，证据：① 同一代码在 18:32 全量 48/377 全绿；② prettier 修复仅为空白，且受影响的测试子集（node 侧 10 文件/167 用例 + dom 侧 6 文件/25 用例）在 18:40 单独复跑全绿；③ 失败签名全部为沙箱拦截（`EPERM`/`could not set core.repositoryformatversion`），无一条断言级失败指向本次变更。沙箱恢复（重启会话）后应复跑一次 `npm test` 作为最终戳记。

## 5. PASS/FAIL 对照

- PASS-1 首帧非 AUTH 或 Token 错误 50ms 内 4401：✅（计时断言实测远小于 50ms）
- PASS-2 非法 Origin 直接拒绝：✅（Upgrade 403）
- PASS-3 3 次心跳丢失触发遮罩：✅ Hook 层断言 `status → "reconnecting"`；遮罩组件本体属 TASK-C.x 范围
- PASS-4 Token 轮换旧 Token 必 4401：✅
- FAIL-1 URL Query 传 Token：✅ 已从服务端与客户端双侧移除并有测试锁定
- FAIL-2 未鉴权连接接收广播帧：✅ 既有断言保持绿

## 6. 规范偏差与说明

1. **Origin 白名单含 `::1`**：B 卡片列举 `127.0.0.1`/`localhost`；A §4 仅要求 loopback，`::1` 为回环超集，保留并记录。
2. **Token 经 URL fragment（`#token=`）传递**：规范仅禁止 query 与自定义浏览器 Header；fragment 不随请求发送、不进服务端日志，读取后即时抹除。
3. **历史扩展帧 `WORKER_LOG`/`SCOPE_ALERT` 保留**：A §6.1 "至少包括"允许；证据失效现已同时广播规范帧 `EVIDENCE_STATUS_CHANGED`，扩展帧待 C.x 迁移后下线。
4. **路径映射**：本卡片及全部任务卡的文件路径已按仓库实际布局改写（见任务文档 §5「路径映射约定」），未新建 `src/daemon/`。
5. **速率/并发数值为自定默认值**（30 次/10s/IP、64 并发）：规范只要求"限制连接频率防 DoS"，未给数值；均可通过 `DaemonServerOptions` 配置。

## 7. 未完成项

- 无本卡片范围内的未完成项。
- 范围外已知项（后续卡片承接）：UI 重连遮罩组件（TASK-C.x）；`CHAT_EVENT`/`SUPERVISOR_SUGGESTION`/`WORKER_EVENT`/`GATEWAY_VIOLATION` 的业务载荷语义由 S.x/W.x 卡片落地（当前仅帧字典与方向/鉴权约束生效）。

## 8. 收尾补充（2026-10-20：URL 安全守卫 + 最终门禁复跑）

### 8.1 URL 安全守卫（--ui-url / STAGENT_UI_URL）

新增 `assertLoopbackUiUrl()`（`bin/stagent.ts`），在两个位置强制生效：

1. **`start` 流程副作用前**（`createDaemon` 之前）校验 `options.uiUrl`，失败打印错误并以退出码 1 拒绝启动 —— `--ui-url` 与 `STAGENT_UI_URL` 同源受约束；
2. **`buildUiLaunchUrl()` 内部**二次校验（纵深防御），保证携带 `#token=` 的唤起链接在构造层就不可能指向外部主机。

白名单规则：协议必须 `http:`；主机名必须恰为 `localhost` 或 `127.0.0.1`；禁止 userinfo。拒绝项含：外网 https/http 域名、局域网 IP（如 192.168.x.x）、回环上的 https、域名前缀伪装（`localhost.evil.com`）、userinfo 伪装（双向）、IPv6 `[::1]`（严格限定两白名单主机名）、非法 URL。

### 8.2 测试证据

`tests/unit/cli-entry.test.ts` 由 8 用例扩至 21 用例，新增 13 用例：放行 4（localhost/127.0.0.1 × 端口/路径）+ `it.each` 拒绝 10 类恶意/非法地址 + `buildUiLaunchUrl` 外链抛错 + env 变量同源约束。

### 8.3 最终门禁复跑（含安全修复后的代码）

| 门禁 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck`（`tsc --noEmit`） | 0 | 0 错误 |
| `npm test`（全量，node 38 + dom 10） | 0 | **48 文件 / 390 用例全绿**（较上轮 377 新增 13 用例，全部来自 URL 守卫） |
| `npx prettier --check`（本次改动 2 文件） | 0 | 无违规 |

> §4 注 2 所述沙箱封锁已在会话重启后解除，本次复跑即为最终戳记。

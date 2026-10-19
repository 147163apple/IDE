# M4 阶段核对清单 — CLI 入口与 Local IPC / WebSocket 通信桥（TASK-D.1）

> 计划依据：`~/.workbuddy/plans/swift-pulse-darwin-M30Jbj0P.md` §2 M4
> 日期：2026-10-19 · 前置：M3 已签收（92/92 测试绿）

---

## 1. 交付物

| 类型 | 路径 | 说明 |
|---|---|---|
| 新建 | `daemon/core/session-token.ts` | Token 生成（32B 随机）/0600 落盘/常量时间校验/Origin 判定 |
| 新建 | `src/lib/ipc/frames.ts` | 7 类帧协议、类型守卫、`chunkWorkerLog` 分片截断 |
| 新建 | `src/lib/ipc/client.ts` | 浏览器客户端：5s PING、3 次丢失判定、指数退避重连、订阅 API |
| 新建 | `bin/stagent.ts` | `start` / `status` / `help` CLI；启动提示端口与 Token 路径 |
| 修改 | `daemon/server.ts` | WS Upgrade 鉴权、Origin 校验、心跳守护、广播与日志推送 |
| 修改 | `package.json` | `bin.stagent`、`stagent` script、新增 `ws` / `tsx` 依赖 |
| 新建 | `tests/integration/ipc-stream.test.ts` | 6 个集成用例 |

---

## 2. 规范判据对照（TASK-D.1 PASS 1-5）

| 判据 | 实现 | 验证 |
|---|---|---|
| PASS-1 仅绑定 `127.0.0.1`，默认 41792 或扫描可用端口 | `host` 默认 `127.0.0.1`；`startPort=41792 / endPort=41802`；`findAvailablePort` 扫描 | 集成测试实际连接 127.0.0.1 |
| PASS-2 Token 0600、与 PID 分离、Upgrade 阶段 Bearer 校验 | `createSessionToken()` 写 `.stagent/session-token`（0600）；`stagent.pid` 仅元数据；`handleUpgrade()` 校验通过后才 `handleUpgrade()` | 测试断言 mode=0600、PID 文件不含 token、无 token 返回 401 |
| PASS-3 Origin 校验（防 DNS Rebinding） | `isLocalOrigin()` 仅放行 127.0.0.1/localhost/::1，异源直接 403 | 测试用 `https://evil.example.com` 断言 403 |
| PASS-4 7 类帧 + 心跳 | 帧枚举固定 7 类；服务端 PING→PONG；客户端 5s 间隔、连续 3 次无 PONG 断开并重连；服务端 30s 无帧强制 terminate | 测试 PING→PONG、CONTRACT_UPDATE/WORKER_LOG 推送、未知帧 ERROR |
| PASS-5 日志流式非阻塞 + 有界截断 | `emitWorkerLog()` 分片（8k/帧），超长行截断并标记 `truncated` | 测试 20k 字符单行，断言 ≤8k+标记 |

**FAIL 判据回避**：不监听 0.0.0.0；无 Token 无法连接；Token 与 PID 不混存；端口冲突由 `findAvailablePort` 扫描规避；日志分片避免阻塞。

---

## 3. 端到端冒烟（CLI）

```text
$ npx tsx bin/stagent.ts start --repo <tmp> --port 3690
Stagent Daemon 已启动
  地址:  http://127.0.0.1:3690
  PID:   74793
  Token: <tmp>/.stagent/session-token (0600)

GET /health → 200 {"status":"ok"}
token 权限 → 600
SIGINT → 优雅退出，PID 锁与 Token 清理
```

---

## 4. 门禁实测（2026-10-19 17:09）

```text
1. TypeScript typecheck  → exit 0（0 error）
2. Lint                  → exit 0（0 error / 6 既有 warning）
3. Unit + Integration    → 98 passed / 98（16 files）
=== All verifications passed successfully! ===
```

---

## 5. 残留风险与决策记录

| # | 事项 | 说明 | 承接 |
|---|---|---|---|
| 1 | 浏览器 Token 传输方式 | 规范要求 `Authorization: Bearer`；浏览器 WebSocket API 无法设置请求头，实现为「Header 优先 + `?token=` 回退」，且强制 Origin 校验。已在代码注释声明 | 已在 checklist 留痕 |
| 2 | 重连遮罩 UI | 客户端已提供 `onStatusChange` 状态流（connected/reconnecting/closed），遮罩组件属 Track C | M7 |
| 3 | 心跳为应用层帧 | 未启用 WS 协议层 ping/pong，避免浏览器不暴露控制帧 | 设计取舍 |
| 4 | Token 为单次会话 | 每次 Daemon 启动重新生成，旧 Token 立即失效 | 符合规范 |

---

## 6. 签收

- [x] M4-1 WS + Token + Origin + 心跳
- [x] M4-2 CLI + 浏览器客户端
- [x] M4-3 集成测试（6 用例）
- [x] 门禁全绿（98/98）

**M4 状态：已签收（2026-10-19）。TASK-D.1 由「未开始」转为「完成」。**

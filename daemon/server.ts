import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { findAvailablePort, PortFinderOptions } from "./core/port-finder";
import {
  acquirePidLock,
  releasePidLock,
  readPidLock,
  PidLockInfo,
} from "./core/pid-lock";
import {
  createFrame,
  chunkWorkerLog,
  isClientToServerAllowed,
  isIpcFrame,
  MAX_FRAME_BYTES,
  WS_CLOSE_UNAUTHORIZED,
  type AuthPayload,
  type IpcFrame,
  type IpcFrameType,
} from "../src/lib/ipc/frames";
import {
  createSessionToken,
  clearSessionToken,
  verifySessionToken,
  isLocalOrigin,
  isLocalHostAuthority,
} from "./core/session-token";

import {
  recoverDaemonState,
  type RecoveryReport,
} from "./recovery/crash-recovery";
import { ContractOrchestrator } from "./pipeline/orchestrator";
import {
  loadEvidenceSnapshot,
  loadLatestEvidenceSnapshot,
  squashMerge,
} from "./pipeline/merger";
import {
  addProtectionEntry,
  closeRound,
  decideApproval,
  drainProtectionRequests,
  ensureRoundStarted,
  loadProtectionList,
  loadRoundState,
  protectionMode,
  recommendProtections,
  removeProtectionEntry,
} from "./protection/protection-list";
import {
  clearCheckpoint,
  ensureCheckpoint,
  getCheckpoint,
  undoLatestCheckpoint,
} from "./protection/auto-checkpoint";
import { softwareContractSchema } from "../src/lib/contract.schema";
import type { SoftwareContract } from "../src/lib/contract.schema";
import type { EvidenceBundle } from "../src/lib/evidence.schema";
import { WorktreeWatcher } from "./watcher/fs-watcher";
import { EvidenceInvalidationEngine } from "./watcher/invalidation-engine";
import { buildDependencyGraph } from "./arch/graph";
import { launchEditor } from "./editor/launcher";
import { getModelSettings, setRuntimeKey } from "./worker/key-store";
import { ChatSessionManager } from "./chat/session-manager";
import {
  decideWrite,
  readFileFor,
  recordViolation,
  type FileAccessContext,
} from "./editor/worktree-files";
import { getWorktreePath, execGit } from "./git/worktree-manager";
import type { ChatAdapter } from "./chat/types";
import { BaselineChatAdapter } from "./chat/baseline-adapter";
import { DemoChatAdapter } from "./chat/demo-adapter";
import {
  CLAUDE_CODE_VERIFIED_ON,
  ClaudeCodeAdapter,
} from "./worker/cli-host/claude-code-adapter";

export interface DaemonServerOptions extends PortFinderOptions {
  repoRoot: string;
  version?: string;
  autoShutdownSignals?: boolean;
  /** 启动取得 PID 锁后自动执行崩溃自愈扫描（TASK-A.6），默认开启 */
  enableCrashRecovery?: boolean;
  /** WebSocket 客户端首帧 AUTH 的超时毫秒数，超时未鉴权以 4401 断开（默认 5000） */
  authTimeoutMs?: number;
  /** 连接速率限制（TASK-D.1 G-12 防 DoS）：单 IP 在窗口内允许的新建连接数（默认 30） */
  maxConnectionsPerWindow?: number;
  /** 连接速率限制窗口毫秒数（默认 10_000） */
  connectionWindowMs?: number;
  /** 同时在线的最大 WS 客户端数（默认 64） */
  maxClients?: number;
  /** 右栏会话适配器（TASK-C.6）；缺省为 保底 + 演示 */
  chatAdapters?: ChatAdapter[];
}

export interface DaemonStatusResponse {
  status: "ok" | "stopping";
  version: string;
  pid: number;
  port: number;
  repoRoot: string;
  /** 主工作区真实检出的分支（P.1 顺手修：顶栏显示实际分支，不再硬编码 main） */
  currentBranch: string | null;
  uptime: number;
  activeContracts: string[];
}

export class StagentDaemon {
  readonly repoRoot: string;
  readonly host: string;
  readonly version: string;
  readonly startPort: number;
  readonly endPort: number;
  readonly autoShutdownSignals: boolean;
  readonly enableCrashRecovery: boolean;
  readonly authTimeoutMs: number;
  readonly maxConnectionsPerWindow: number;
  readonly connectionWindowMs: number;
  readonly maxClients: number;

  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private sessionToken: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  /** 单 IP 新建连接的时间戳滑窗（速率限制） */
  private connectionWindows: Map<string, number[]> = new Map();
  private currentPort: number | null = null;
  private running: boolean = false;
  private stopping: boolean = false;
  private activeContracts: string[] = [];
  private signalCleanupFn: (() => void) | null = null;
  private lastRecoveryReport: RecoveryReport | null = null;
  private readonly orchestrator: ContractOrchestrator;
  readonly chat: ChatSessionManager;
  private worktreeWatcher: WorktreeWatcher | null = null;
  private invalidationEngine: EvidenceInvalidationEngine | null = null;
  /** 当前武装监听的合同（用于 abort 时精确解除，避免误停其他任务的监听） */
  private armedContractId: string | null = null;

  constructor(options: DaemonServerOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.host = options.host ?? "127.0.0.1";
    this.version = options.version ?? "0.1.0";
    // 规范 TASK-D.1：动态端口探测范围 3001~3010
    this.startPort = options.startPort ?? 3001;
    this.endPort = options.endPort ?? 3010;
    this.autoShutdownSignals = options.autoShutdownSignals ?? false;
    this.enableCrashRecovery = options.enableCrashRecovery ?? true;
    this.authTimeoutMs = options.authTimeoutMs ?? 5_000;
    this.maxConnectionsPerWindow = options.maxConnectionsPerWindow ?? 30;
    this.connectionWindowMs = options.connectionWindowMs ?? 10_000;
    this.maxClients = options.maxClients ?? 64;
    this.orchestrator = new ContractOrchestrator({ repoRoot: this.repoRoot });
    this.chat = new ChatSessionManager({
      repoRoot: this.repoRoot,
      adapters: options.chatAdapters ?? defaultChatAdapters(this.repoRoot),
      publish: (event) => {
        this.broadcast("CHAT_EVENT", event);
      },
    });
  }

  /** 最近一次启动时的崩溃自愈报告（便于状态端点与测试观测） */
  getRecoveryReport(): RecoveryReport | null {
    return this.lastRecoveryReport;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get port(): number | null {
    return this.currentPort;
  }

  get pid(): number {
    return process.pid;
  }

  /**
   * Start the Stagent Daemon:
   * 1. Dynamically finds an available port in the specified range (3001..3010)
   * 2. Acquires single-instance repository PID lock
   * 3. Starts HTTP listener with health check and graceful shutdown endpoints
   */
  async start(): Promise<{ port: number; pid: number }> {
    if (this.running) {
      throw new Error(
        `Stagent daemon is already running on port ${this.currentPort}`,
      );
    }

    const port = await findAvailablePort({
      startPort: this.startPort,
      endPort: this.endPort,
      host: this.host,
    });

    await acquirePidLock(this.repoRoot, port, {
      version: this.version,
    });

    // 规范 TASK-A.6 PASS-1：取得 PID 锁后自动扫描并自愈悬空合同
    if (this.enableCrashRecovery) {
      try {
        this.lastRecoveryReport = await recoverDaemonState({
          repoRoot: this.repoRoot,
        });
      } catch (err) {
        // 自愈失败不得阻止 Daemon 启动；错误在报告中留痕
        this.lastRecoveryReport = {
          scannedContracts: 0,
          scannedEvidence: 0,
          records: [],
          orphanWorktrees: [],
          pruned: false,
          errors: [(err as Error).message],
          cleanedLocks: [],
          retainedLocks: [],
        };
      }
    }

    // 规范 TASK-D.1 PASS-2：单次随机会话 Token，独立于 PID 文件
    this.sessionToken = createSessionToken(this.repoRoot);
    // 规范 TASK-D.1 G-12：单连接帧大小硬上限 2MB（ws 超限自动以 1009 关闭）
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_FRAME_BYTES,
    });
    this.wss.on("connection", (ws) => {
      this.handleConnection(ws);
    });

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    // Upgrade 阶段仅校验 Origin；Token 校验移至连接后第一帧 AUTH
    // （浏览器 WebSocket API 无法设置 Authorization 头，query 传 Token 会泄漏进日志）
    this.server.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket as import("node:net").Socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        reject(new Error("Server instance missing"));
        return;
      }

      this.server.once("error", (err) => {
        reject(err);
      });

      this.server.listen(
        {
          port,
          host: this.host,
        },
        () => {
          resolve();
        },
      );
    });

    this.currentPort = port;
    this.running = true;
    this.stopping = false;

    // 服务端心跳守护：超过 30s 无任何帧的客户端强制断开
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        const lastSeen = (client as WebSocket & { lastSeen?: number }).lastSeen;
        if (lastSeen && Date.now() - lastSeen > 30_000) {
          client.terminate();
        }
      }
    }, 15_000);
    this.heartbeatTimer.unref?.();

    if (this.autoShutdownSignals) {
      this.installSignalHandlers();
    }

    return { port, pid: process.pid };
  }

  /**
   * Gracefully stop the daemon:
   * 1. Closes HTTP server
   * 2. Releases PID lock
   * 3. Cleans up OS signal handlers
   */
  async stop(): Promise<void> {
    if (!this.running || this.stopping) {
      return;
    }
    this.stopping = true;

    if (this.signalCleanupFn) {
      this.signalCleanupFn();
      this.signalCleanupFn = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    await this.stopEvidenceWatcher();
    await this.chat.shutdown();

    for (const client of this.clients) {
      try {
        client.close(1001, "daemon stopping");
      } catch {
        client.terminate();
      }
    }
    this.clients.clear();
    this.connectionWindows.clear();
    this.wss?.close();
    this.wss = null;
    clearSessionToken(this.repoRoot);
    this.sessionToken = null;

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => {
          resolve();
        });
      });
      this.server = null;
    }

    await releasePidLock(this.repoRoot);

    this.running = false;
    this.stopping = false;
    this.currentPort = null;
  }

  /** 供 CLI / 测试读取本次会话 Token（服务端内存值） */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  /** 广播任意协议帧（仅已鉴权客户端），返回成功发送的客户端数 */
  broadcast<T>(type: IpcFrameType, payload?: T): number {
    if (!this.wss) return 0;
    const frame = createFrame(type, payload);
    const serialized = JSON.stringify(frame);
    let sent = 0;
    for (const client of this.clients) {
      const tracked = client as WebSocket & { authenticated?: boolean };
      if (tracked.authenticated !== true) continue;
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
        sent += 1;
      }
    }
    return sent;
  }

  /** 日志流式推送（分片 + 有界截断，PASS-5） */
  emitWorkerLog(contractId: string, lines: string[]): number {
    let sent = 0;
    for (const chunk of chunkWorkerLog(contractId, lines)) {
      sent += this.broadcast("WORKER_LOG", chunk);
    }
    return sent;
  }

  /**
   * 合同状态变更广播（Track C）。
   * 客户端据此立即刷新，无需等待下一轮轮询 —— 状态机是推的，不是拉的。
   */
  emitContractUpdate(contract: SoftwareContract): number {
    return this.broadcast("CONTRACT_UPDATE", {
      contract_id: contract.contract_id,
      lifecycle_state: contract.lifecycle_state,
      approval_status: contract.approval?.status,
    });
  }

  /** Evidence 生成广播：携带结论，供控制台决定是否点亮「核销」 */
  emitEvidenceReady(contractId: string, evidence: EvidenceBundle): number {
    return this.broadcast("EVIDENCE_READY", {
      contract_id: contractId,
      evidence_id: evidence.evidence_id,
      verdict: evidence.verdict.status,
      can_merge: evidence.verdict.can_merge,
    });
  }

  private rejectUpgrade(
    socket: import("node:net").Socket,
    status: number,
    message: string,
  ): void {
    socket.write(
      `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  }

  private handleUpgrade(
    req: http.IncomingMessage,
    socket: import("node:net").Socket,
    head: Buffer,
  ): void {
    // Host 头必须是回环地址（DNS Rebinding 防线：重绑定后请求不带 Origin，
    // 唯一可靠的判别是 Host 头）
    if (!isLocalHostAuthority(req.headers.host)) {
      this.rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    // Origin 校验仍在 Upgrade 阶段硬阻断（防跨站 WS 劫持）
    const origin = req.headers.origin;
    if (!isLocalOrigin(origin)) {
      this.rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    // 连接速率限制（G-12 防 DoS）：单 IP 滑窗计数，超限拒绝
    const remote = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const windowStart = now - this.connectionWindowMs;
    const recent = (this.connectionWindows.get(remote) ?? []).filter(
      (t) => t >= windowStart,
    );
    if (recent.length >= this.maxConnectionsPerWindow) {
      this.connectionWindows.set(remote, recent);
      this.rejectUpgrade(socket, 429, "Too Many Requests");
      return;
    }
    recent.push(now);
    this.connectionWindows.set(remote, recent);

    // 并发客户端总数上限
    if (this.clients.size >= this.maxClients) {
      this.rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    // 注意：此处不再读取 Authorization 头或 ?token= query。
    // 浏览器原生 WebSocket 无法携带自定义头；query 中的 Token 会进入
    // 访问日志与历史记录。鉴权统一在连接建立后的第一帧 AUTH 完成，
    // 失败 / 超时均以 4401（WS_CLOSE_UNAUTHORIZED）断开。
    if (!this.wss) {
      this.rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss?.emit("connection", ws, req);
    });
  }

  private handleConnection(ws: WebSocket): void {
    type TrackedSocket = WebSocket & {
      lastSeen?: number;
      authenticated?: boolean;
    };
    const tracked = ws as TrackedSocket;
    this.clients.add(ws);
    tracked.lastSeen = Date.now();
    tracked.authenticated = false;

    const sendError = (code: string, message: string): void => {
      ws.send(JSON.stringify(createFrame("ERROR", { code, message })));
    };
    const rejectUnauthorized = (reason: string): void => {
      sendError("E_UNAUTHORIZED", reason);
      ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
    };

    // 首帧 AUTH 超时：未在时限内完成鉴权即断开
    const authTimer = setTimeout(() => {
      if (!tracked.authenticated) {
        rejectUnauthorized("AUTH frame required within auth timeout");
      }
    }, this.authTimeoutMs);
    authTimer.unref?.();

    ws.on("message", (raw) => {
      tracked.lastSeen = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        sendError("INVALID_FRAME", "Frame must be valid JSON");
        if (!tracked.authenticated) {
          ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
        }
        return;
      }

      if (!isIpcFrame(parsed)) {
        sendError("UNKNOWN_FRAME_TYPE", "Unsupported frame type");
        if (!tracked.authenticated) {
          ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
        }
        return;
      }

      // 未鉴权连接：唯一合法帧是 AUTH，其余一律以 4401 断开
      if (!tracked.authenticated) {
        if (parsed.type !== "AUTH") {
          rejectUnauthorized("First frame must be AUTH");
          return;
        }
        const payload = parsed.payload as Partial<AuthPayload> | undefined;
        const token = typeof payload?.token === "string" ? payload.token : null;
        if (!verifySessionToken(token, this.sessionToken)) {
          rejectUnauthorized("Invalid session token");
          return;
        }
        tracked.authenticated = true;
        clearTimeout(authTimer);
        ws.send(JSON.stringify(createFrame("AUTH_OK")));
        return;
      }

      // 已鉴权连接：帧方向门禁（§6.1 帧字典的收发方约束）。
      // 客户端只允许发送 direction 含 client->server 的帧（PING、CHAT_EVENT），
      // 伪造 server->client 帧（如 PONG / CONTRACT_UPDATE）拒绝并保持连接。
      if (!isClientToServerAllowed(parsed.type)) {
        sendError(
          "FRAME_DIRECTION_FORBIDDEN",
          `Frame type ${parsed.type} is server->client only`,
        );
        return;
      }

      // 规范 PASS-4：客户端每 5s 发送 PING，服务端立即回 PONG
      if (parsed.type === "PING") {
        ws.send(JSON.stringify(createFrame("PONG")));
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      this.clients.delete(ws);
    });
    ws.on("error", () => {
      clearTimeout(authTimer);
      this.clients.delete(ws);
    });
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    // HTTP API 仅接受 Authorization: Bearer（非浏览器客户端可用）。
    // 绝不接受 ?token= query（规范 TASK-D.1 FAIL：query 会进入访问日志与浏览器历史）
    const authHeader = req.headers.authorization;
    const headerToken =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : null;
    return verifySessionToken(headerToken, this.sessionToken);
  }

  private readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let raw = "";
      const limit = 1024 * 1024;
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf-8");
        if (raw.length > limit) {
          reject(new Error("Request body exceeds 1 MiB limit"));
          req.destroy();
        }
      });
      req.on("end", () => {
        if (!raw.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    body: unknown,
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  /**
   * 合同动作错误统一出口：并发/状态冲突映射 409（Conflict），
   * 其余仍为 400。错误码随响应回传，便于控制台区分「前置条件不足」与「手慢了」。
   */
  private sendActionError(res: http.ServerResponse, err: unknown): void {
    const error = err as Error & { code?: string };
    const conflict =
      error?.code === "E_INVALID_STATE_TRANSITION" ||
      error?.code === "E_CONCURRENT_OPERATION";
    this.sendJson(res, conflict ? 409 : 400, {
      error: error?.message ?? String(err),
      ...(error?.code === undefined ? {} : { code: error.code }),
    });
  }

  /**
   * 验证通过后启动活跃 Worktree 监听：外部改动 → Evidence STALE（TASK-B.2）。
   */
  private async armEvidenceWatcher(
    contractId: string,
    evidenceId: string,
  ): Promise<void> {
    await this.stopEvidenceWatcher();
    const worktreePath = path.join(
      this.repoRoot,
      ".stagent",
      "worktrees",
      `task-${contractId}`,
    );
    const evidencePath = path.join(
      this.repoRoot,
      ".stagent",
      "evidence",
      `${contractId}-${evidenceId}.json`,
    );
    if (!fs.existsSync(evidencePath)) return;

    const engine = new EvidenceInvalidationEngine(worktreePath);
    engine.register(contractId, evidencePath);
    this.invalidationEngine = engine;

    const watcher = new WorktreeWatcher({
      worktreePath,
      onChange: (changed) => {
        const results = engine.handleChanges(changed);
        for (const hit of results) {
          if (!hit.stale) continue;
          // 规范 §6.1 帧：证据失效的权威通知通道
          this.broadcast("EVIDENCE_STATUS_CHANGED", {
            contract_id: hit.contractId,
            evidence_id: evidenceId,
            status: "STALE",
            reason_code: "EVIDENCE_STALE",
            message:
              "Worktree changed after verification; evidence marked STALE and merge disabled",
          });
          // 历史扩展帧：保留至 C.x 完成迁移（协议"至少包括"允许扩展帧并存）
          this.broadcast("SCOPE_ALERT", {
            contract_id: hit.contractId,
            code: "E_EVIDENCE_STALE",
            message:
              "Worktree changed after verification; evidence marked STALE and merge disabled",
          });
        }
      },
    });
    watcher.start();
    this.worktreeWatcher = watcher;
    this.armedContractId = contractId;
  }

  private async stopEvidenceWatcher(): Promise<void> {
    await this.worktreeWatcher?.stop();
    this.worktreeWatcher = null;
    this.invalidationEngine = null;
    this.armedContractId = null;
  }

  private fileContext(
    contractId: string | null | undefined,
  ): FileAccessContext {
    if (!contractId) {
      return { repoRoot: this.repoRoot, contract: null, worktreePath: null };
    }
    const contract = this.orchestrator.getStore().get(contractId);
    if (!contract) throw new Error(`contract not found: ${contractId}`);
    const worktreePath = getWorktreePath(this.repoRoot, contractId);
    if (!fs.existsSync(worktreePath)) throw new Error("合同 Worktree 不存在");
    return { repoRoot: this.repoRoot, contract, worktreePath };
  }

  /** TASK-C.3 编辑器读写：保存必须经此端点，越权 403 + GATEWAY_VIOLATION */
  private async handleWorktreeFiles(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    url: URL,
  ): Promise<void> {
    try {
      if (method === "GET") {
        const ctx = this.fileContext(url.searchParams.get("contract_id"));
        this.sendJson(
          res,
          200,
          readFileFor(ctx, url.searchParams.get("path") ?? ""),
        );
        return;
      }
      if (method === "POST") {
        const body = (await this.readJsonBody(req)) as {
          path?: string;
          content?: string;
          contract_id?: string;
        };
        if (typeof body.content !== "string") {
          this.sendJson(res, 400, { error: "content is required" });
          return;
        }
        const ctx = this.fileContext(body.contract_id);
        const d = decideWrite(ctx, String(body.path ?? ""));
        if (!d.allowed || !d.absolutePath) {
          const violation = {
            at: new Date().toISOString(),
            source: "editor" as const,
            contract_id: body.contract_id ?? null,
            path: String(body.path ?? ""),
            reason: d.reason,
          };
          recordViolation(this.repoRoot, violation);
          this.broadcast("GATEWAY_VIOLATION", violation);
          this.sendJson(res, 403, {
            error: "GATEWAY_VIOLATION",
            reason: d.reason,
          });
          return;
        }
        fs.mkdirSync(path.dirname(d.absolutePath), { recursive: true });
        fs.writeFileSync(d.absolutePath, body.content);
        this.sendJson(res, 200, { path: d.relativePath, saved: true });
        return;
      }
      this.sendJson(res, 405, { error: "Method Not Allowed" });
    } catch (err) {
      this.sendJson(res, 400, { error: (err as Error).message });
    }
  }

  /**
   * TASK-P.1 保护清单与本轮授权的控制面 API。
   * 清单修改只走这里（UI 开关/推荐卡），AI 的任何写通道都被门卫挡住；
   * hook 通道投递的拦截请求在每次访问时并入待审批卡（文件队列，不新增 WS 帧）。
   */
  private async handleProtection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    pathname: string,
  ): Promise<void> {
    try {
      drainProtectionRequests(this.repoRoot);

      if (method === "GET" && pathname === "/api/protection") {
        let entries: unknown[] = [];
        let corrupt: string | null = null;
        try {
          entries = loadProtectionList(this.repoRoot).entries;
        } catch (err) {
          corrupt = (err as Error).message;
        }
        const state = loadRoundState(this.repoRoot);
        const cp = getCheckpoint(this.repoRoot);
        this.sendJson(res, 200, {
          mode: entries.length > 0 ? "PROTECTED" : "VIBE",
          entries,
          corrupt,
          round: {
            roundId: state.roundId,
            startedAt: state.startedAt,
            pending: state.pending,
            approvedFiles: state.approvedFiles,
          },
          checkpoint: cp ? { roundId: cp.roundId, at: cp.at } : null,
        });
        return;
      }

      if (method === "GET" && pathname === "/api/protection/recommendations") {
        this.sendJson(res, 200, {
          recommendations: recommendProtections(this.repoRoot),
        });
        return;
      }

      if (
        method === "POST" &&
        pathname === "/api/protection/recommendations/apply"
      ) {
        const body = (await this.readJsonBody(req)) as { names?: string[] };
        const wanted = new Set(body.names ?? []);
        const recs = recommendProtections(this.repoRoot);
        const added = recs
          .filter((r) => wanted.has(r.name))
          .map((r) => addProtectionEntry(this.repoRoot, r.name, r.patterns));
        this.sendJson(res, 200, {
          added,
          entries: loadProtectionList(this.repoRoot).entries,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/protection/entries") {
        const body = (await this.readJsonBody(req)) as {
          name?: string;
          patterns?: string[];
        };
        const name = (body.name ?? "").trim();
        const patterns = (body.patterns ?? []).filter(
          (p) => typeof p === "string" && p.trim().length > 0,
        );
        if (!name || patterns.length === 0) {
          this.sendJson(res, 400, { error: "name 与 patterns 均必填" });
          return;
        }
        const entry = addProtectionEntry(this.repoRoot, name, patterns);
        this.sendJson(res, 201, {
          entry,
          entries: loadProtectionList(this.repoRoot).entries,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/protection/entries/remove") {
        const body = (await this.readJsonBody(req)) as { id?: string };
        if (!body.id || !removeProtectionEntry(this.repoRoot, body.id)) {
          this.sendJson(res, 404, { error: "entry not found" });
          return;
        }
        this.sendJson(res, 200, {
          entries: loadProtectionList(this.repoRoot).entries,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/protection/decisions") {
        const body = (await this.readJsonBody(req)) as {
          cardId?: string;
          decision?: string;
        };
        if (
          !body.cardId ||
          (body.decision !== "approve" && body.decision !== "deny")
        ) {
          this.sendJson(res, 400, { error: "cardId 与 decision 必填" });
          return;
        }
        const card = decideApproval(this.repoRoot, body.cardId, body.decision);
        if (!card) {
          this.sendJson(res, 404, { error: "card not found" });
          return;
        }
        const state = loadRoundState(this.repoRoot);
        this.sendJson(res, 200, {
          card,
          pending: state.pending,
          approvedFiles: state.approvedFiles,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/protection/round/start") {
        try {
          const state = ensureRoundStarted(this.repoRoot, "manual");
          const cp = await ensureCheckpoint(this.repoRoot);
          this.sendJson(res, 200, {
            roundId: state.roundId,
            checkpointAt: cp.at,
          });
        } catch (err) {
          this.sendJson(res, 409, {
            error: "E_CHECKPOINT_FAILED",
            message: `快照失败，本轮不开工：${(err as Error).message}`,
          });
        }
        return;
      }

      if (method === "POST" && pathname === "/api/protection/undo") {
        try {
          const result = await undoLatestCheckpoint(this.repoRoot);
          this.sendJson(res, result.undone ? 200 : 404, result);
        } catch (err) {
          this.sendJson(res, 409, {
            error: "E_UNDO_FAILED",
            message: (err as Error).message,
          });
        }
        return;
      }

      if (method === "GET" && pathname === "/api/protection/pending") {
        const state = loadRoundState(this.repoRoot);
        this.sendJson(res, 200, {
          roundId: state.roundId,
          pending: state.pending,
          approvedFiles: state.approvedFiles,
        });
        return;
      }

      this.sendJson(res, 404, { error: "Not Found", path: pathname });
    } catch (err) {
      this.sendJson(res, 400, { error: (err as Error).message });
    }
  }

  /** TASK-C.6 右栏会话 REST；流式事件经 WS CHAT_EVENT 推送 */
  private async handleChat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    pathname: string,
  ): Promise<void> {
    try {
      if (method === "GET" && pathname === "/api/chat/adapters") {
        this.sendJson(res, 200, { adapters: this.chat.listAdapters() });
        return;
      }
      if (method === "GET" && pathname === "/api/chat/sessions") {
        this.sendJson(res, 200, { sessions: this.chat.listSessions() });
        return;
      }
      if (method === "POST" && pathname === "/api/chat/sessions") {
        const body = (await this.readJsonBody(req)) as { adapter_id?: string };
        const session = this.chat.createSession(body.adapter_id ?? "demo");
        this.sendJson(res, 201, { session });
        return;
      }
      const m = pathname.match(
        /^\/api\/chat\/sessions\/([A-Za-z0-9_-]+)(?:\/(messages|interrupt))?$/,
      );
      if (m) {
        const id = m[1] ?? "";
        const action = m[2];
        if (method === "GET" && !action) {
          const session = this.chat.getSession(id);
          if (!session) this.sendJson(res, 404, { error: "session not found" });
          else this.sendJson(res, 200, { session });
          return;
        }
        if (method === "POST" && action === "messages") {
          // P.1：本轮开工前必须有快照（快照失败则本轮不开工）
          try {
            ensureRoundStarted(this.repoRoot, "chat");
            await ensureCheckpoint(this.repoRoot);
          } catch (err) {
            this.sendJson(res, 409, {
              error: "E_CHECKPOINT_FAILED",
              message: `快照失败，本轮不开工：${(err as Error).message}`,
            });
            return;
          }
          const body = (await this.readJsonBody(req)) as { text?: string };
          const result = this.chat.send(id, String(body.text ?? ""));
          this.sendJson(res, 202, { result });
          return;
        }
        if (method === "POST" && action === "interrupt") {
          this.sendJson(res, 200, { interrupted: this.chat.interrupt(id) });
          return;
        }
      }
      this.sendJson(res, 404, { error: "Not Found", path: pathname });
    } catch (err) {
      this.sendJson(res, 400, { error: (err as Error).message });
    }
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // Host 头必须是回环地址（DNS Rebinding 防线，与 WS Upgrade 同理）
    if (!isLocalHostAuthority(req.headers.host)) {
      this.sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://${this.host}`);
    const pathname = parsedUrl.pathname;
    const method = req.method ?? "GET";

    // 本地控制台跨端口访问（Vite dev server）所需的 CORS；仅放行回环来源
    const origin = req.headers.origin;
    if (origin && isLocalOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "authorization,content-type",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (
      method === "GET" &&
      (pathname === "/health" || pathname === "/api/status")
    ) {
      const branchRes = await execGit(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        this.repoRoot,
      ).catch(() => null);
      const payload: DaemonStatusResponse = {
        status: this.stopping ? "stopping" : "ok",
        version: this.version,
        pid: process.pid,
        port: this.currentPort ?? 0,
        repoRoot: this.repoRoot,
        currentBranch:
          branchRes?.exitCode === 0 ? branchRes.stdout || null : null,
        uptime: process.uptime(),
        activeContracts: [...this.activeContracts],
      };
      this.sendJson(res, 200, payload);
      return;
    }

    if (method === "GET" && pathname === "/api/arch/graph") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const { graph, durationMs } = buildDependencyGraph({
          root: this.repoRoot,
        });
        this.sendJson(res, 200, {
          durationMs,
          stats: graph.getStats(),
          cycles: graph.detectCycles(),
          graph: graph.toJSON(),
        });
      } catch (err) {
        this.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/settings") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      this.sendJson(res, 200, { settings: getModelSettings() });
      return;
    }

    if (method === "POST" && pathname === "/api/settings/openai-key") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await this.readJsonBody(req)) as {
          api_key?: string;
          model?: string;
        };
        if (!body.api_key || body.api_key.trim().length < 8) {
          this.sendJson(res, 400, { error: "api_key is required" });
          return;
        }
        setRuntimeKey(body.api_key, body.model);
        // 绝不回显 Key
        this.sendJson(res, 200, { settings: getModelSettings() });
      } catch (err) {
        this.sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (pathname === "/api/worktree/files") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleWorktreeFiles(req, res, method, parsedUrl);
      return;
    }

    if (pathname.startsWith("/api/protection")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleProtection(req, res, method, pathname);
      return;
    }

    if (pathname.startsWith("/api/chat")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleChat(req, res, method, pathname);
      return;
    }

    if (pathname.startsWith("/api/contracts")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, {
          error: "Unauthorized",
          message: "Bearer session token required",
        });
        return;
      }

      const store = this.orchestrator.getStore();

      if (method === "GET" && pathname === "/api/contracts") {
        this.sendJson(res, 200, { contracts: store.list() });
        return;
      }

      if (method === "POST" && pathname === "/api/contracts") {
        try {
          const body = (await this.readJsonBody(req)) as { contract?: unknown };
          if (!body.contract) {
            this.sendJson(res, 400, { error: "contract is required" });
            return;
          }
          const contract = softwareContractSchema.parse(body.contract);
          const saved = store.save(contract);
          this.emitContractUpdate(saved);
          this.sendJson(res, 201, { contract: saved });
        } catch (err) {
          this.sendJson(res, 400, { error: (err as Error).message });
        }
        return;
      }

      const match = pathname.match(
        /^\/api\/contracts\/([^/]+)(?:\/(approve|execute|run-worker|open-editor|diff|merge|evidence|resume|abort)(?:\/([^/]+))?)?$/,
      );
      if (match) {
        const contractId = decodeURIComponent(match[1] as string);
        const action = match[2];
        const subId = match[3];

        if (method === "GET" && !action) {
          const contract = store.get(contractId);
          if (!contract) {
            this.sendJson(res, 404, { error: "Contract not found" });
            return;
          }
          this.sendJson(res, 200, { contract });
          return;
        }

        // Track C：EVIDENCE_READY 推送后，控制台据此拉取完整证据包，不必等用户点执行
        if (method === "GET" && action === "evidence") {
          const snapshot = subId
            ? loadEvidenceSnapshot(
                this.repoRoot,
                contractId,
                decodeURIComponent(subId),
              )
            : loadLatestEvidenceSnapshot(this.repoRoot, contractId);
          if (!snapshot) {
            this.sendJson(res, 404, { error: "Evidence not found" });
            return;
          }
          this.sendJson(res, 200, { evidence: snapshot });
          return;
        }

        if (method === "POST" && action === "approve") {
          try {
            const body = (await this.readJsonBody(req)) as {
              reviewer?: string;
            };
            const contract = await this.orchestrator.approve(
              contractId,
              body.reviewer ?? "local-user",
            );
            this.emitContractUpdate(contract);
            this.sendJson(res, 200, { contract });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "POST" && action === "run-worker") {
          try {
            const result = await this.orchestrator.runWorker(contractId);
            this.emitWorkerLog(contractId, result.log);
            // Worker 可能把状态推到 PENDING_RESUME（预算/循环熔断）
            const afterWorker = store.get(contractId);
            if (afterWorker) this.emitContractUpdate(afterWorker);
            this.sendJson(res, 200, { result });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "POST" && action === "merge") {
          try {
            const body = (await this.readJsonBody(req)) as {
              reviewer?: string;
              evidence_id?: string;
            };
            if (!body.evidence_id) {
              this.sendJson(res, 400, { error: "evidence_id is required" });
              return;
            }
            const snapshot = loadEvidenceSnapshot(
              this.repoRoot,
              contractId,
              body.evidence_id,
            );
            if (!snapshot) {
              this.sendJson(res, 404, { error: "Evidence not found" });
              return;
            }
            await this.stopEvidenceWatcher();
            const result = await squashMerge({
              repoRoot: this.repoRoot,
              contractId,
              evidence: snapshot,
              reviewer: body.reviewer ?? "local-user",
            });
            // P.1：真正产生提交才关轮（授权作废、快照不再可撤）；
            // AI 改动全部被用户版本覆盖时没有提交，保留本轮与 Worktree 供 AI 重做。
            if (!result.nothingToMerge) {
              closeRound(this.repoRoot, "MERGED");
              clearCheckpoint(this.repoRoot);
              this.emitContractUpdate(result.contract);
            }
            this.sendJson(res, 200, { result });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "GET" && action === "diff") {
          const worktreePath = path.join(
            this.repoRoot,
            ".stagent",
            "worktrees",
            `task-${contractId}`,
          );
          if (!fs.existsSync(worktreePath)) {
            this.sendJson(res, 404, { error: "Worktree not found" });
            return;
          }
          try {
            // 验证阶段会把 Worktree 改动 commit 到任务分支，`diff HEAD` 因此恒为空。
            // 以基线分支为参照：既包含已提交的任务改动，也包含尚未提交的现场改动。
            const baseBranch =
              store.get(contractId)?.authorization.git.base_branch ?? "main";
            const patch = execFileSync("git", ["diff", baseBranch], {
              cwd: worktreePath,
              encoding: "utf-8",
            });
            const stat = execFileSync("git", ["diff", "--stat", baseBranch], {
              cwd: worktreePath,
              encoding: "utf-8",
            });
            this.sendJson(res, 200, { patch, stat });
          } catch (err) {
            this.sendJson(res, 500, { error: (err as Error).message });
          }
          return;
        }

        if (method === "POST" && action === "open-editor") {
          try {
            const contract = store.get(contractId);
            const result = await launchEditor({
              repoRoot: this.repoRoot,
              contractId,
              template:
                contract?.authorization.execution_permissions
                  .editor_command_template,
            });
            this.sendJson(res, 200, { result });
          } catch (err) {
            this.sendJson(res, 400, { error: (err as Error).message });
          }
          return;
        }

        if (method === "POST" && action === "resume") {
          try {
            const contract = await this.orchestrator.resume(contractId);
            this.emitContractUpdate(contract);
            this.sendJson(res, 200, { contract });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "POST" && action === "abort") {
          try {
            const body = (await this.readJsonBody(req)) as {
              reviewer?: string;
              reason?: string;
            };
            const contract = await this.orchestrator.abort(contractId, {
              ...(body.reviewer === undefined
                ? {}
                : { reviewer: body.reviewer }),
              ...(body.reason === undefined ? {} : { reason: body.reason }),
            });
            // 中止的合同若正被证据监听武装，立即解除（其 Worktree 已清理）
            if (this.armedContractId === contractId) {
              await this.stopEvidenceWatcher();
            }
            this.emitContractUpdate(contract);
            this.sendJson(res, 200, { contract });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "POST" && action === "execute") {
          try {
            const outcome = await this.orchestrator.execute(contractId);
            if (outcome.evidence.verdict.status === "PASSED") {
              await this.armEvidenceWatcher(
                contractId,
                outcome.evidence.evidence_id,
              );
            }
            this.emitContractUpdate(outcome.contract);
            this.emitEvidenceReady(contractId, outcome.evidence);
            this.sendJson(res, 200, {
              contract: outcome.contract,
              evidence: outcome.evidence,
            });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }
      }

      this.sendJson(res, 404, { error: "Not Found", path: pathname });
      return;
    }

    if (method === "POST" && pathname === "/api/shutdown") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      this.sendJson(res, 200, { status: "shutting_down" });
      // Asynchronously initiate graceful shutdown without blocking response
      setImmediate(() => {
        this.stop().catch((err) => {
          console.error("[Stagent Daemon] Error during shutdown:", err);
        });
      });
      return;
    }

    this.sendJson(res, 404, {
      error: "Not Found",
      path: pathname,
    });
  }

  private installSignalHandlers(): void {
    const handleSignal = () => {
      this.stop().finally(() => {
        process.exit(0);
      });
    };

    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);

    this.signalCleanupFn = () => {
      process.removeListener("SIGINT", handleSignal);
      process.removeListener("SIGTERM", handleSignal);
    };
  }
}

function defaultChatAdapters(repoRoot: string): ChatAdapter[] {
  return [
    new ClaudeCodeAdapter({
      configDir: path.join(repoRoot, ".stagent", "claude-config"),
      verifiedOn: CLAUDE_CODE_VERIFIED_ON,
    }),
    new BaselineChatAdapter(),
    new DemoChatAdapter(),
  ];
}

export function createDaemon(options: DaemonServerOptions): StagentDaemon {
  return new StagentDaemon(options);
}

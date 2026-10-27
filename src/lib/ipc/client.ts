import {
  createFrame,
  isIpcFrame,
  WS_CLOSE_UNAUTHORIZED,
  type IpcFrame,
  type IpcFrameType,
} from "./frames";

/**
 * 浏览器侧 WebSocket 客户端（规范 TASK-D.1，协议 v1.1）。
 * - 浏览器原生 WebSocket API 无法设置 Authorization 头；URL query 携带
 *   Token 会泄漏进日志与历史记录。因此鉴权统一为「连接建立后的第一帧
 *   AUTH 消息」，服务端校验通过返回 AUTH_OK，失败立即以 4401 断开。
 * - 每 5s 发送 PING；连续 3 次未收到 PONG（约 15s）判定断线并重连
 * - 断线指数退避重连；4401（鉴权失败）不重连，需上层更换 Token 后重试
 */
export interface IpcClientOptions {
  port: number;
  token: string;
  host?: string;
  /**
   * 完整 Daemon Base URL（如 `https://8787-xxx.example.com` 或
   * `http://127.0.0.1:3001`）。提供时优先于 host/port 推导 WS 地址：
   * https → wss，并保留代理场景下省略的默认端口。不提供时沿用
   * `ws://${host}:${port}/ws`（本机同端口开发场景）。
   */
  baseUrl?: string;
  /** 测试注入用；默认使用全局 WebSocket */
  websocketImpl?: typeof WebSocket;
  pingIntervalMs?: number;
  maxMissedPongs?: number;
  onFrame?: (frame: IpcFrame) => void;
  onStatusChange?: (status: IpcClientStatus) => void;
}

export type IpcClientStatus =
  "connecting" | "connected" | "reconnecting" | "closed";

/**
 * 由 baseUrl（若提供）推导 WS 地址，否则回退 `ws://${host}:${port}/ws`。
 * 独立反向代理场景下，控制台与 Daemon 的公网 Origin 相同但协议是
 * https，端口折进子域名——这时固定 `ws://127.0.0.1:<port>` 连的是浏览器
 * 自己的回环地址而非 Daemon，必须跟随 baseUrl 的 scheme/host。
 */
export function deriveWsUrl(options: IpcClientOptions): string {
  if (options.baseUrl) {
    try {
      const u = new URL(options.baseUrl);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = "/ws";
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch {
      // 畸形 baseUrl：回退 host/port 推导
    }
  }
  const host = options.host ?? "127.0.0.1";
  return `ws://${host}:${options.port}/ws`;
}

export class StagentIpcClient {
  private readonly url: string;
  private readonly token: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly pingIntervalMs: number;
  private readonly maxMissedPongs: number;

  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private missedPongs = 0;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private status: IpcClientStatus = "closed";

  private readonly frameHandlers = new Set<(frame: IpcFrame) => void>();
  private readonly statusHandlers = new Set<(s: IpcClientStatus) => void>();
  private readonly onFrameOption?: ((frame: IpcFrame) => void) | undefined;
  private readonly onStatusOption?: ((s: IpcClientStatus) => void) | undefined;

  constructor(options: IpcClientOptions) {
    // Token 绝不进入 URL；连接建立后通过第一帧 AUTH 发送
    this.url = deriveWsUrl(options);
    this.token = options.token;
    this.WebSocketImpl = options.websocketImpl ?? WebSocket;
    this.pingIntervalMs = options.pingIntervalMs ?? 5_000;
    this.maxMissedPongs = options.maxMissedPongs ?? 3;
    this.onFrameOption = options.onFrame;
    this.onStatusOption = options.onStatusChange;
  }

  get currentStatus(): IpcClientStatus {
    return this.status;
  }

  get tokenValue(): string {
    return this.token;
  }

  onFrame(handler: (frame: IpcFrame) => void): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onStatusChange(handler: (s: IpcClientStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  connect(): void {
    this.manuallyClosed = false;
    this.openSocket();
  }

  send<T>(type: IpcFrameType, payload?: T): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify(createFrame(type, payload)));
    return true;
  }

  close(): void {
    this.manuallyClosed = true;
    this.stopTimers();
    this.socket?.close(1000, "client closed");
    this.socket = null;
    this.setStatus("closed");
  }

  private openSocket(): void {
    this.setStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    const socket = new this.WebSocketImpl(this.url);
    this.socket = socket;

    socket.onopen = () => {
      // 第一帧必须是 AUTH；服务端校验失败会以 4401 断开
      socket.send(JSON.stringify(createFrame("AUTH", { token: this.token })));
    };

    socket.onmessage = (event: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!isIpcFrame(parsed)) return;

      // 收到 AUTH_OK 才视为握手完成，此后才启动心跳
      if (parsed.type === "AUTH_OK") {
        this.reconnectAttempt = 0;
        this.missedPongs = 0;
        this.setStatus("connected");
        this.startPing();
        return;
      }

      if (parsed.type === "PONG") {
        this.missedPongs = 0;
        return;
      }

      this.onFrameOption?.(parsed);
      for (const handler of this.frameHandlers) handler(parsed);
    };

    socket.onclose = (event: CloseEvent) => {
      this.stopPing();
      this.socket = null;
      // 4401 = 鉴权失败：Token 不变时重连只会循环失败，停止重连等待上层处理
      if (event?.code === WS_CLOSE_UNAUTHORIZED) {
        this.manuallyClosed = true;
        this.setStatus("closed");
        return;
      }
      if (!this.manuallyClosed) this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private startPing(): void {
    this.stopPing();
    // 规范 §6.1 / TASK-D.1：每 5s 一次 PING，连续 3 次无 PONG（15s）判定断线。
    // AUTH_OK 后立即发第 1 次 PING，使第 3 次失联恰好落在 15s：
    //   t=0  ping#1 (miss=1)；t=5 ping#2 (miss=2)；t=10 ping#3 (miss=3)；
    //   t=15 检查：miss=3 ≥ maxMissedPongs → 关闭并进入重连。
    this.missedPongs = 1;
    this.send("PING");
    this.pingTimer = setInterval(() => {
      if (this.missedPongs >= this.maxMissedPongs) {
        // 连续 3 次无响应（15s）：判定断线，触发重连（上层据此呈现重连遮罩）
        this.socket?.close();
        return;
      }
      this.missedPongs += 1;
      this.send("PING");
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private stopTimers(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(1_000 * 2 ** (this.reconnectAttempt - 1), 15_000);
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private setStatus(next: IpcClientStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.onStatusOption?.(next);
    for (const handler of this.statusHandlers) handler(next);
  }
}

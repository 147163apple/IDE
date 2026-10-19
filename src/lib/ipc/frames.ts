/**
 * Local Daemon ↔ Web Console 消息帧协议（规范 TASK-D.1 PASS-4，协议 v1.1）
 * 帧类型固定为 9 类，禁止自定义扩展而不更新协议版本。
 *
 * v1.1 变更：新增 AUTH / AUTH_OK。
 * 浏览器原生 WebSocket API 不支持自定义 HTTP 头（无法发送
 * `Authorization: Bearer`），query 参数携带 Token 又会泄漏进 URL 日志，
 * 因此鉴权统一为「连接建立后的第一帧 AUTH 消息」：服务端校验失败立即以
 * WS_CLOSE_UNAUTHORIZED（4401）断开，超时未鉴权同样断开。
 */
export type IpcFrameType =
  | "CONTRACT_UPDATE"
  | "WORKER_LOG"
  | "SCOPE_ALERT"
  | "EVIDENCE_READY"
  | "AUTH"
  | "AUTH_OK"
  | "PING"
  | "PONG"
  | "ERROR";

/** 鉴权失败 / 未在时限内鉴权的 WebSocket 关闭码（私有区间 4000-4999） */
export const WS_CLOSE_UNAUTHORIZED = 4401;

/** AUTH 帧载荷：客户端连接后第一帧必须携带会话 Token */
export interface AuthPayload {
  token: string;
}

export interface IpcFrame<T = unknown> {
  type: IpcFrameType;
  payload?: T;
  timestamp: string;
}

export interface WorkerLogPayload {
  contract_id: string;
  lines: string[];
  /** 单帧超过传输上限时标记截断（规范 PASS-5） */
  truncated?: boolean;
}

export interface ContractUpdatePayload {
  contract_id: string;
  lifecycle_state: string;
  approval_status?: string;
}

export interface ScopeAlertPayload {
  contract_id: string;
  code: string;
  message: string;
}

export interface EvidenceReadyPayload {
  contract_id: string;
  evidence_id: string;
  verdict: string;
  can_merge: boolean;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export const IPC_FRAME_TYPES: readonly IpcFrameType[] = [
  "CONTRACT_UPDATE",
  "WORKER_LOG",
  "SCOPE_ALERT",
  "EVIDENCE_READY",
  "AUTH",
  "AUTH_OK",
  "PING",
  "PONG",
  "ERROR",
] as const;

export function isIpcFrame(value: unknown): value is IpcFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<IpcFrame>;
  return (
    typeof frame.type === "string" &&
    (IPC_FRAME_TYPES as readonly string[]).includes(frame.type)
  );
}

export function createFrame<T>(type: IpcFrameType, payload?: T): IpcFrame<T> {
  return {
    type,
    ...(payload === undefined ? {} : { payload }),
    timestamp: new Date().toISOString(),
  };
}

/** 单帧 WORKER_LOG 的字符上限，超出则截断并标记（PASS-5 有界截断） */
export const MAX_LOG_FRAME_CHARS = 8_000;

export function chunkWorkerLog(
  contractId: string,
  lines: string[],
): WorkerLogPayload[] {
  const frames: WorkerLogPayload[] = [];
  let buffer: string[] = [];
  let size = 0;

  const flush = (truncated = false) => {
    if (buffer.length === 0 && !truncated) return;
    frames.push({
      contract_id: contractId,
      lines: buffer,
      ...(truncated ? { truncated: true } : {}),
    });
    buffer = [];
    size = 0;
  };

  for (const line of lines) {
    const bounded =
      line.length > MAX_LOG_FRAME_CHARS
        ? line.slice(0, MAX_LOG_FRAME_CHARS) + " [truncated]"
        : line;
    if (size + bounded.length > MAX_LOG_FRAME_CHARS && buffer.length > 0) {
      flush();
    }
    buffer.push(bounded);
    size += bounded.length;
  }
  flush();
  return frames;
}

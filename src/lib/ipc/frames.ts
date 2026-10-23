/**
 * Local Daemon ↔ Web Console 消息帧协议（规范 TASK-D.1，协议 v1.2）。
 * 帧字典以《Stagent 系统架构设计规范 v1.2.1》§6.1 为唯一事实源：
 * 13 类规范帧 + 2 类历史扩展帧（WORKER_LOG / SCOPE_ALERT，§6.1 为"至少包括"，
 * 扩展帧只允许保留兼容，不允许再新增而不更新规范与协议版本）。
 *
 * v1.2 变更（TASK-D.1）：
 * - 标准帧结构补齐 `trace_id`（§6.1：trace_id, type, timestamp, payload）
 * - 帧字典补齐 6 类规范帧：CHAT_EVENT / SUPERVISOR_SUGGESTION / WORKER_EVENT /
 *   GATEWAY_VIOLATION / EVIDENCE_STATUS_CHANGED / TERMINAL_STREAM
 * - 新增 FRAME_CATALOG：每类帧的方向、鉴权要求、最大尺寸与语义说明
 * - 单帧上限 MAX_FRAME_BYTES = 2MB（TASK-D.1 G-12）
 *
 * v1.3 变更（TASK-D.3 / 架构 §6.1、§6.3.1 P-20）：
 * - 新增 `STATE_CHANGED` 广播帧：承载 Daemon 独占计算并持久化的
 *   `presentation_state`（15 态展示状态）与白话提示文本，前端零逻辑消费；
 * - `CONTRACT_UPDATE` 增加可选的 `presentation_state`，让尚未迁移到
 *   `STATE_CHANGED` 的客户端也能平滑读取（协议向后兼容）。
 *
 * v1.1 变更：新增 AUTH / AUTH_OK。
 * 浏览器原生 WebSocket API 不支持自定义 HTTP 头（无法发送
 * `Authorization: Bearer`），query 参数携带 Token 又会泄漏进 URL 日志，
 * 因此鉴权统一为「连接建立后的第一帧 AUTH 消息」：服务端校验失败立即以
 * WS_CLOSE_UNAUTHORIZED（4401）断开，超时未鉴权同样断开。
 */

import type { PresentationState } from "../state/presentation-state";

/** 规范 §6.1 帧类型字典（14 类规范帧 + 2 类历史扩展帧） */
export type IpcFrameType =
  // ---- 规范 §6.1 定义的 13 类 ----
  | "AUTH"
  | "AUTH_OK"
  | "PING"
  | "PONG"
  | "ERROR"
  | "CONTRACT_UPDATE"
  | "CHAT_EVENT"
  | "SUPERVISOR_SUGGESTION"
  | "WORKER_EVENT"
  | "GATEWAY_VIOLATION"
  | "EVIDENCE_READY"
  | "EVIDENCE_STATUS_CHANGED"
  | "TERMINAL_STREAM"
  // ---- v1.6.1 §6.1 / §6.3.1 新增的全量状态快照广播（TASK-D.3） ----
  | "STATE_CHANGED"
  // ---- 历史扩展帧（v1.1 协议遗留，仅保留兼容，禁止再新增） ----
  | "WORKER_LOG"
  | "SCOPE_ALERT";

/** 鉴权失败 / 未在时限内鉴权的 WebSocket 关闭码（私有区间 4000-4999） */
export const WS_CLOSE_UNAUTHORIZED = 4401;

/** 单帧字节上限（TASK-D.1：限制单连接帧大小 ≤ 2MB，防 DoS） */
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** AUTH 帧载荷：客户端连接后第一帧必须携带会话 Token */
export interface AuthPayload {
  token: string;
}

/**
 * 标准帧结构（§6.1）：trace_id, type, timestamp, payload。
 * - `trace_id` 由 createFrame 生成（UUID），贯穿一次广播/请求的全链路日志；
 *   对端解析时容忍缺失（历史客户端），但本实现发出的帧恒携带。
 */
export interface IpcFrame<T = unknown> {
  trace_id: string;
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
  /**
   * TASK-D.3：可选携带投影结果，供尚未消费 `STATE_CHANGED` 的客户端平滑读取。
   *
   * 为什么是可选：`CONTRACT_UPDATE` 是 v1.2.1 既有帧，历史 Daemon 不会填这个字段；
   * 把它设成必填会让旧版本广播直接不合法。真正的"必选"约束放在
   * `STATE_CHANGED` 上——那个帧的存在意义就是携带该字段。
   */
  presentation_state?: PresentationState;
}

/**
 * `STATE_CHANGED` 载荷（§6.1 / §6.3.1 P-20）。
 *
 * Daemon 状态机独占计算并写入持久化快照，每次流转全量推送；
 * 前端不解构 lifecycle × approval 自行推导，只消费 `presentation_state`。
 */
export interface StateChangedPayload {
  contract_id: string;
  /** 15 态展示状态，必填：本帧的核心载荷 */
  presentation_state: PresentationState;
  /** 面向非技术用户的白话提示文本（§6.3.1） */
  message?: string;
  /** 底层状态，仅用于诊断与日志，前端展示不应依赖 */
  lifecycle_state?: string;
  approval_status?: string;
  /** 该快照的生成时刻，便于断线重连后比对新鲜度 */
  persisted_at?: string;
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

/** EVIDENCE_STATUS_CHANGED 载荷（§6.1：证据生命周期流转与外部改动导致的 STALE 失效通知） */
export interface EvidenceStatusChangedPayload {
  contract_id: string;
  evidence_id: string;
  /** 证据新状态，如 "STALE" / "FRESH" */
  status: string;
  reason_code?: string;
  message?: string;
}

export interface TerminalStreamPayload {
  contract_id: string;
  /** 结构化日志行（命令执行实时输出） */
  stream: "stdout" | "stderr";
  line: string;
}

export interface GatewayViolationPayload {
  /** 违规来源（如 "supervisor" / "worker"） */
  source: string;
  /** 被拦截的越权动作（如 "approveContract" / "execCommand"） */
  action: string;
  contract_id?: string;
  message: string;
}

export interface ChatEventPayload {
  session_id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

export interface SupervisorSuggestionPayload {
  suggestion_id: string;
  session_id: string;
  kind: string;
  summary: string;
}

export interface WorkerEventPayload {
  contract_id: string;
  event: string;
  detail?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export const IPC_FRAME_TYPES: readonly IpcFrameType[] = [
  "AUTH",
  "AUTH_OK",
  "PING",
  "PONG",
  "ERROR",
  "CONTRACT_UPDATE",
  "CHAT_EVENT",
  "SUPERVISOR_SUGGESTION",
  "WORKER_EVENT",
  "GATEWAY_VIOLATION",
  "EVIDENCE_READY",
  "EVIDENCE_STATUS_CHANGED",
  "TERMINAL_STREAM",
  "STATE_CHANGED",
  "WORKER_LOG",
  "SCOPE_ALERT",
] as const;

/** 帧方向：client→server / server→client / 双向 */
export type FrameDirection =
  "client->server" | "server->client" | "bidirectional";

/**
 * 帧目录（§6.1：每类帧定义 Schema、最大尺寸、发送/接收方和权限）。
 * - direction：合法的发送方；服务端收到方向不符的帧应拒绝（FRAME_DIRECTION_FORBIDDEN）
 * - requiresAuth：未通过首帧 AUTH 的连接是否可收发该帧（仅 AUTH/AUTH_OK/ERROR 豁免）
 * - maxPayloadBytes：默认 2MB 上限（TASK-D.1 G-12）
 * - spec：v1.2.1 = 规范 §6.1 原始帧；v1.6.1 = v1.6.1 §6.1 新增广播帧；
 *   extension = 历史扩展帧（仅兼容保留）
 */
export interface FrameCatalogEntry {
  type: IpcFrameType;
  direction: FrameDirection;
  requiresAuth: boolean;
  maxPayloadBytes: number;
  spec: "v1.2.1" | "v1.6.1" | "extension";
  description: string;
}

export const FRAME_CATALOG: readonly FrameCatalogEntry[] = [
  {
    type: "AUTH",
    direction: "client->server",
    requiresAuth: false,
    maxPayloadBytes: MAX_FRAME_BYTES,
    spec: "v1.2.1",
    description: "连接后首帧鉴权，payload 仅允许认证数据 { token }",
  },
  {
    type: "AUTH_OK",
    direction: "server->client",
    requiresAuth: false,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "鉴权通过回执；收到后才允许发送业务帧与心跳",
  },
  {
    type: "PING",
    direction: "client->server",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "客户端 5s 心跳",
  },
  {
    type: "PONG",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "服务端心跳应答",
  },
  {
    type: "ERROR",
    direction: "server->client",
    requiresAuth: false,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "错误通知，payload 含稳定 code 与脱敏 message",
  },
  {
    type: "CONTRACT_UPDATE",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "合同状态机变更推送（可选携带 presentation_state）",
  },
  {
    type: "STATE_CHANGED",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.6.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description:
      "全量状态快照广播，必含 15 态 presentation_state 与白话提示（TASK-D.3）",
  },
  {
    type: "CHAT_EVENT",
    direction: "bidirectional",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "会话消息事件（S.x/C.x 任务落地语义）",
  },
  {
    type: "SUPERVISOR_SUGGESTION",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "Supervisor 建议推送（TASK-S.3）",
  },
  {
    type: "WORKER_EVENT",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "Worker 执行事件（TASK-W.x）",
  },
  {
    type: "GATEWAY_VIOLATION",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "越权调用审计事件（TASK-S.1/W.4）",
  },
  {
    type: "EVIDENCE_READY",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "证据生成完成、待核销通知",
  },
  {
    type: "EVIDENCE_STATUS_CHANGED",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "证据生命周期流转与外部文件修改导致的 STALE 失效通知",
  },
  {
    type: "TERMINAL_STREAM",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "命令执行实时结构化日志流",
  },
  // ---- 历史扩展帧（v1.1 协议遗留） ----
  {
    type: "WORKER_LOG",
    direction: "server->client",
    requiresAuth: true,
    spec: "extension",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description:
      "Worker 日志批量推送（TERMINAL_STREAM 前身；保留兼容，C.x 迁移后下线）",
  },
  {
    type: "SCOPE_ALERT",
    direction: "server->client",
    requiresAuth: true,
    spec: "extension",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "Scope/证据失效告警（EVIDENCE_STATUS_CHANGED 前身；保留兼容）",
  },
] as const;

const CATALOG_BY_TYPE: ReadonlyMap<IpcFrameType, FrameCatalogEntry> = new Map(
  FRAME_CATALOG.map((entry) => [entry.type, entry]),
);

export function getFrameSpec(type: IpcFrameType): FrameCatalogEntry {
  const entry = CATALOG_BY_TYPE.get(type);
  if (!entry) throw new Error(`Frame type not in catalog: ${type}`);
  return entry;
}

/** 该帧类型是否允许由客户端发往服务端（鉴权后） */
export function isClientToServerAllowed(type: IpcFrameType): boolean {
  const { direction } = getFrameSpec(type);
  return direction === "client->server" || direction === "bidirectional";
}

export function isIpcFrame(value: unknown): value is IpcFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<IpcFrame>;
  if (
    typeof frame.type !== "string" ||
    !(IPC_FRAME_TYPES as readonly string[]).includes(frame.type)
  ) {
    return false;
  }
  // trace_id 为规范必含字段；解析端容忍历史帧缺失，但若存在必须为字符串
  if (frame.trace_id !== undefined && typeof frame.trace_id !== "string") {
    return false;
  }
  return true;
}

export function createFrame<T>(type: IpcFrameType, payload?: T): IpcFrame<T> {
  return {
    // globalThis.crypto 在 Node ≥19 与浏览器均可用；不能 import node:crypto
    // （本模块同时被打包进浏览器客户端）
    trace_id: globalThis.crypto.randomUUID(),
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

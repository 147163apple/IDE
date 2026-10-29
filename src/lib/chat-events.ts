/**
 * TASK-C.6 会话事件（CHAT_EVENT 帧的 payload，架构规范 §6.1）。
 * 浏览器与 Daemon 共用；不得 import Node 模块。
 */
export type ChatEventKind =
  | "user"
  | "delta"
  | "tool_call"
  | "tool_result"
  | "turn_end"
  | "interrupted"
  | "error"
  | "queued";

export interface ChatEventBase {
  session_id: string;
  turn_id: string;
  seq: number;
  at: string;
}

export type ChatEventBody =
  | { kind: "user"; text: string }
  | { kind: "delta"; text: string }
  | { kind: "tool_call"; tool_id: string; name: string; input: unknown }
  | {
      kind: "tool_result";
      tool_id: string;
      output: string;
      is_error: boolean;
    }
  | { kind: "turn_end" }
  | { kind: "interrupted" }
  | { kind: "error"; message: string }
  | { kind: "queued"; text: string; position: number };

export type ChatEvent = ChatEventBase & ChatEventBody;

/**
 * TASK-J.1 适配器工具权限：
 * - `read_only`：只能读、搜、列目录（方案工作台右栏搭档的唯一合法形态）；
 * - `read_write`：能改文件 / 跑命令，只允许 Worker 路径使用，右栏永不选中。
 */
export type ChatToolMode = "read_only" | "read_write";

export interface ChatAdapterInfo {
  id: string;
  label: string;
  control_mode: "GATEWAY_ENFORCED" | "UNCONTROLLED_EXTERNAL";
  /** 黑盒实测通过的版本与日期；空字符串 = 未实测 */
  verified_on: string;
  available: boolean;
  /** 工具权限（必填：漏填会在编译期暴露，避免右栏误选可写适配器） */
  tool_mode: ChatToolMode;
  unavailable_reason?: string;
}

export interface ChatSessionSummary {
  id: string;
  adapter_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** 底层 CLI 的原生会话 ID（用于 resume），未知时为 null */
  native_session_id: string | null;
  busy: boolean;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  events: ChatEvent[];
}

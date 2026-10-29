import type { ChatAdapterInfo, ChatToolMode } from "../../src/lib/chat-events";

/** TASK-J.1：右栏适配器只读/可写能力（字段由共享的 ChatAdapterInfo 承载） */
export type { ChatToolMode };

/** 适配器向会话管理器报告的原始事件（不带 session/turn/seq） */
export type AdapterEvent =
  | { kind: "session"; native_session_id: string }
  | { kind: "delta"; text: string }
  | { kind: "tool_call"; tool_id: string; name: string; input: unknown }
  | { kind: "tool_result"; tool_id: string; output: string; is_error: boolean }
  | { kind: "error"; message: string };

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AdapterRunInput {
  prompt: string;
  cwd: string;
  /** 续接用的原生会话 ID（Claude Code `--resume`） */
  nativeSessionId: string | null;
  /** 无原生会话的适配器用它重建上下文 */
  history: HistoryTurn[];
  signal: AbortSignal;
}

export interface ChatAdapter {
  info(): ChatAdapterInfo;
  run(input: AdapterRunInput): AsyncIterable<AdapterEvent>;
}

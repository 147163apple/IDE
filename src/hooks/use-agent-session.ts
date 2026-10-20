import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatAdapterInfo,
  ChatEvent,
  ChatSessionDetail,
  ChatSessionSummary,
} from "@/lib/chat-events";

/** 会话传输层：生产用 daemon-api + WS，测试注入假实现 */
export interface AgentSessionTransport {
  listAdapters(): Promise<ChatAdapterInfo[]>;
  listSessions(): Promise<ChatSessionSummary[]>;
  createSession(adapterId: string): Promise<ChatSessionSummary>;
  getSession(id: string): Promise<ChatSessionDetail>;
  send(id: string, text: string): Promise<"started" | "queued">;
  interrupt(id: string): Promise<boolean>;
  /** 订阅 CHAT_EVENT；返回取消订阅 */
  subscribe(listener: (event: ChatEvent) => void): () => void;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  tool?: {
    name: string;
    input: unknown;
    output?: string;
    is_error?: boolean;
  };
  turnId: string;
}

const SELECTED_KEY = "stagent.chat.session";

/** 把事件流折叠成可渲染的消息列表（纯函数，便于测试） */
export function foldChatEvents(events: ChatEvent[]): {
  messages: AgentMessage[];
  busy: boolean;
} {
  const messages: AgentMessage[] = [];
  let busy = false;
  for (const e of events) {
    switch (e.kind) {
      case "user":
        messages.push({
          id: `${e.seq}`,
          role: "user",
          text: e.text,
          turnId: e.turn_id,
        });
        busy = true;
        break;
      case "delta": {
        const last = messages.at(-1);
        if (last && last.role === "assistant" && last.turnId === e.turn_id) {
          last.text += e.text;
        } else {
          messages.push({
            id: `${e.seq}`,
            role: "assistant",
            text: e.text,
            turnId: e.turn_id,
          });
        }
        break;
      }
      case "tool_call":
        messages.push({
          id: `tool-${e.tool_id}`,
          role: "tool",
          text: e.name,
          tool: { name: e.name, input: e.input },
          turnId: e.turn_id,
        });
        break;
      case "tool_result": {
        const card = messages.find((m) => m.id === `tool-${e.tool_id}`);
        if (card?.tool) {
          card.tool.output = e.output;
          card.tool.is_error = e.is_error;
        }
        break;
      }
      case "queued":
        messages.push({
          id: `${e.seq}`,
          role: "system",
          text: `已排队：${e.text}`,
          turnId: e.turn_id,
        });
        break;
      case "interrupted":
        messages.push({
          id: `${e.seq}`,
          role: "system",
          text: "已停止",
          turnId: e.turn_id,
        });
        busy = false;
        break;
      case "error":
        messages.push({
          id: `${e.seq}`,
          role: "system",
          text: `出错：${e.message}`,
          turnId: e.turn_id,
        });
        busy = false;
        break;
      case "turn_end":
        busy = false;
        break;
    }
  }
  return { messages, busy };
}

export interface UseAgentSession {
  adapters: ChatAdapterInfo[];
  sessions: ChatSessionSummary[];
  sessionId: string | null;
  events: ChatEvent[];
  messages: AgentMessage[];
  busy: boolean;
  error: string | null;
  /** 首个 token 可见耗时（ms），最近一轮 */
  firstTokenMs: number | null;
  selectSession(id: string): Promise<void>;
  newSession(adapterId: string): Promise<void>;
  send(text: string): Promise<void>;
  stop(): Promise<void>;
  refresh(): Promise<void>;
}

export function useAgentSession(
  transport: AgentSessionTransport | null,
): UseAgentSession {
  const [adapters, setAdapters] = useState<ChatAdapterInfo[]>([]);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const sentAt = useRef<number | null>(null);
  const idRef = useRef<string | null>(null);
  idRef.current = sessionId;

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const selectSession = useCallback(
    (id: string) =>
      guard(async () => {
        if (!transport) return;
        const detail = await transport.getSession(id);
        setSessionId(id);
        setEvents(detail.events);
        try {
          window.localStorage.setItem(SELECTED_KEY, id);
        } catch {
          // 无痕模式等
        }
      }),
    [transport, guard],
  );

  const refresh = useCallback(
    () =>
      guard(async () => {
        if (!transport) return;
        const [a, s] = await Promise.all([
          transport.listAdapters(),
          transport.listSessions(),
        ]);
        setAdapters(a);
        setSessions(s);
        if (!idRef.current) {
          let saved: string | null = null;
          try {
            saved = window.localStorage.getItem(SELECTED_KEY);
          } catch {
            saved = null;
          }
          const pick = s.find((x) => x.id === saved) ?? s[0];
          if (pick) await selectSession(pick.id);
        }
      }),
    [transport, guard, selectSession],
  );

  useEffect(() => {
    if (!transport) return;
    void refresh();
    return transport.subscribe((event) => {
      if (event.session_id !== idRef.current) return;
      if (event.kind === "delta" && sentAt.current !== null) {
        setFirstTokenMs(Date.now() - sentAt.current);
        sentAt.current = null;
      }
      setEvents((prev) =>
        prev.some(
          (p) =>
            p.seq === event.seq && p.kind === event.kind && p.kind !== "delta",
        )
          ? prev
          : [...prev, event],
      );
    });
  }, [transport, refresh]);

  const newSession = useCallback(
    (adapterId: string) =>
      guard(async () => {
        if (!transport) return;
        const s = await transport.createSession(adapterId);
        setSessions((prev) => [s, ...prev]);
        setSessionId(s.id);
        setEvents([]);
        try {
          window.localStorage.setItem(SELECTED_KEY, s.id);
        } catch {
          // ignore
        }
      }),
    [transport, guard],
  );

  const send = useCallback(
    (text: string) =>
      guard(async () => {
        if (!transport || !idRef.current || !text.trim()) return;
        sentAt.current = Date.now();
        await transport.send(idRef.current, text);
      }),
    [transport, guard],
  );

  const stop = useCallback(
    () =>
      guard(async () => {
        if (!transport || !idRef.current) return;
        await transport.interrupt(idRef.current);
      }),
    [transport, guard],
  );

  const { messages, busy } = foldChatEvents(events);
  return {
    adapters,
    sessions,
    sessionId,
    events,
    messages,
    busy,
    error,
    firstTokenMs,
    selectSession,
    newSession,
    send,
    stop,
    refresh,
  };
}

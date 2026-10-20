import { useEffect, useState } from "react";
import {
  useAgentSession,
  type AgentSessionTransport,
} from "@/hooks/use-agent-session";

export interface AgentChatPaneProps {
  transport: AgentSessionTransport | null;
}

/** TASK-C.6 右栏 Coding Agent 会话：流式输出、工具卡片、停止、排队、会话续接 */
export function AgentChatPane({ transport }: AgentChatPaneProps) {
  const chat = useAgentSession(transport);
  const [draft, setDraft] = useState("");
  const [adapterId, setAdapterId] = useState<string>("");
  const current = chat.sessions.find((s) => s.id === chat.sessionId);
  // 下拉框默认跟随「当前打开的会话」所用的助手，避免显示 Claude Code、实际却在演示会话里聊天
  const currentAdapterAvailable = chat.adapters.some(
    (a) => a.id === current?.adapter_id && a.available,
  );
  const adapterChoice =
    adapterId ||
    (currentAdapterAvailable ? (current?.adapter_id ?? "") : "") ||
    chat.adapters.find((a) => a.available)?.id ||
    "";
  const currentLabel =
    chat.adapters.find((a) => a.id === current?.adapter_id)?.label ??
    current?.adapter_id ??
    "";
  useEffect(() => {
    setAdapterId("");
  }, [chat.sessionId]);

  if (!transport) {
    return (
      <div
        data-testid="agent-chat"
        role="status"
        className="m-3 rounded border border-amber-500/60 bg-amber-500/10 p-3 text-sm leading-relaxed"
      >
        <p className="font-semibold">
          还没连上后台，所以这里暂时不能和 AI 助手对话。
        </p>
        <p className="mt-2">
          请用我发给你的「带钥匙的链接」打开本页（地址以 <code>#token=</code>{" "}
          结尾）。
        </p>
        <p className="mt-2 opacity-80">
          为了安全，钥匙只在当前这个浏览器标签页里有效；新开标签页或手动输入地址时需要重新用带钥匙的链接打开。也可以把钥匙粘贴到页面顶部的「Session
          Token」框里，再点「应用」。
        </p>
      </div>
    );
  }

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void chat.send(text);
  };

  return (
    <div
      data-testid="agent-chat"
      className="flex h-full flex-col gap-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-semibold">AI 助手：</span>
        <select
          aria-label="选择 Agent"
          value={adapterChoice}
          onChange={(e) => setAdapterId(e.target.value)}
          className="rounded border px-1"
        >
          {chat.adapters.map((a) => (
            <option key={a.id} value={a.id} disabled={!a.available}>
              {a.label}
              {a.control_mode === "UNCONTROLLED_EXTERNAL" ? "（未受控）" : ""}
              {a.available ? "" : `（${a.unavailable_reason ?? "不可用"}）`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded border px-2"
          disabled={!adapterChoice}
          onClick={() => void chat.newSession(adapterChoice)}
        >
          新会话
        </button>
        <span className="opacity-70">历史会话：</span>
        <select
          aria-label="历史会话"
          value={chat.sessionId ?? ""}
          onChange={(e) => void chat.selectSession(e.target.value)}
          className="min-w-0 flex-1 rounded border px-1"
        >
          {!chat.sessionId && <option value="">（无会话）</option>}
          {chat.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} · {s.adapter_id}
            </option>
          ))}
        </select>
      </div>
      {current && (
        <div
          data-testid="current-agent"
          className={
            current.adapter_id === "demo"
              ? "rounded border border-amber-500/60 bg-amber-500/10 p-1"
              : "font-semibold"
          }
        >
          当前对话使用：{currentLabel}
          {current.adapter_id === "demo" &&
            "。这是演示助手，不调用模型，也不会真的读文件；要测真实效果，请在上面「AI 助手：」选 Claude Code，再点「新会话」。"}
        </div>
      )}
      {current && (
        <div data-testid="chat-session-meta" className="text-[10px] opacity-60">
          {current.adapter_id}
          {current.native_session_id
            ? ` · 原生会话 ${current.native_session_id.slice(0, 12)}`
            : ""}
          {chat.firstTokenMs !== null ? ` · 首字 ${chat.firstTokenMs}ms` : ""}
        </div>
      )}
      <div
        data-testid="chat-messages"
        className="min-h-0 flex-1 space-y-2 overflow-auto"
      >
        {chat.messages.map((m) =>
          m.role === "tool" && m.tool ? (
            <div
              key={m.id}
              data-testid="tool-card"
              className="rounded border bg-muted/40 p-2"
            >
              <div className="font-semibold">🔧 {m.tool.name}</div>
              <pre className="whitespace-pre-wrap text-[10px] opacity-70">
                {JSON.stringify(m.tool.input).slice(0, 300)}
              </pre>
              {m.tool.output !== undefined && (
                <pre
                  className={`whitespace-pre-wrap text-[10px] ${m.tool.is_error ? "text-destructive" : ""}`}
                >
                  {m.tool.output.slice(0, 500)}
                </pre>
              )}
            </div>
          ) : (
            <div
              key={m.id}
              data-role={m.role}
              className={
                m.role === "user"
                  ? "ml-6 rounded bg-primary/10 p-2"
                  : m.role === "system"
                    ? "text-center text-[10px] opacity-60"
                    : "whitespace-pre-wrap p-1"
              }
            >
              {m.text}
            </div>
          ),
        )}
      </div>
      {chat.error && <div className="text-destructive">{chat.error}</div>}
      <div className="flex gap-1">
        <textarea
          aria-label="给 Agent 的消息"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            chat.busy ? "Agent 正在回答，可继续输入排队" : "输入消息，回车发送"
          }
          disabled={!chat.sessionId}
          className="min-h-[48px] flex-1 rounded border p-1"
        />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={submit}
            disabled={!chat.sessionId}
            className="rounded border px-2"
          >
            发送
          </button>
          <button
            type="button"
            onClick={() => void chat.stop()}
            disabled={!chat.busy}
            className="rounded border border-destructive/50 px-2 text-destructive disabled:opacity-40"
          >
            停止
          </button>
        </div>
      </div>
    </div>
  );
}

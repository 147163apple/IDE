import { useEffect, useState } from "react";
import {
  useAgentSession,
  type AgentSessionTransport,
} from "@/hooks/use-agent-session";
import {
  hasRealAssistantAvailable,
  pickPreferredAdapterId,
} from "@/lib/pick-chat-adapter";
import { relaunchCurrentSession } from "@/lib/daemon-api";

export interface JourneyChatCard {
  id: string;
  /** DISPUTE / FAST_PATH / MAJOR_DRAFT / SYSTEM */
  kind: string;
  text: string;
}

export interface AgentChatPaneProps {
  transport: AgentSessionTransport | null;
  /**
   * TASK-S.6：发送前分流。返回 `handled` 则不再发给 Worker；
   * 返回 `passthrough`（或未提供）则走原会话。
   */
  onBeforeSend?:
    ((text: string) => Promise<"handled" | "passthrough">) | undefined;
  /** 旅程系统卡（质疑白话摘要 / Fast Path 说明 / 草案就绪） */
  journeyCards?: JourneyChatCard[] | undefined;
  journeyBusy?: boolean | undefined;
  /**
   * TASK-C.8a：打开设置里的「模型钥匙」向导（由布局切到设置 Tab）。
   * 未配 Key 时右栏给一键入口，不甩工程师后台话术。
   */
  onConfigureKey?: (() => void) | undefined;
  /** 模型钥匙是否已就绪（用于向导状态文案） */
  keyConfigured?: boolean | undefined;
}

/** TASK-C.6 右栏 Coding Agent 会话：流式输出、工具卡片、停止、排队、会话续接 */
export function AgentChatPane({
  transport,
  onBeforeSend,
  journeyCards,
  journeyBusy,
  onConfigureKey,
  keyConfigured,
}: AgentChatPaneProps) {
  const chat = useAgentSession(transport);
  const [draft, setDraft] = useState("");
  const [adapterId, setAdapterId] = useState<string>("");
  const [routing, setRouting] = useState(false);
  const [relaunchBusy, setRelaunchBusy] = useState(false);
  const [relaunchError, setRelaunchError] = useState<string | null>(null);
  const current = chat.sessions.find((s) => s.id === chat.sessionId);
  // 下拉框默认跟随「当前打开的会话」所用的助手；否则优先真助手，演示仅兜底（C.8a）
  const currentAdapterAvailable = chat.adapters.some(
    (a) => a.id === current?.adapter_id && a.available,
  );
  const adapterChoice =
    adapterId ||
    pickPreferredAdapterId(
      chat.adapters,
      currentAdapterAvailable ? (current?.adapter_id ?? null) : null,
    );
  const currentLabel =
    chat.adapters.find((a) => a.id === current?.adapter_id)?.label ??
    current?.adapter_id ??
    "";
  const realReady = hasRealAssistantAvailable(chat.adapters);
  useEffect(() => {
    setAdapterId("");
  }, [chat.sessionId]);

  if (!transport) {
    const doRelaunch = () => {
      setRelaunchBusy(true);
      setRelaunchError(null);
      void relaunchCurrentSession()
        .then((result) => {
          window.location.assign(result.launchUrl);
        })
        .catch((err) => {
          setRelaunchError(
            (err as Error).message ||
              "一键重开失败。可点左栏「打开项目」，或到设置粘贴钥匙。",
          );
          setRelaunchBusy(false);
        });
    };
    return (
      <div
        data-testid="agent-chat"
        role="status"
        className="m-3 rounded border border-amber-500/60 bg-amber-500/10 p-3 text-sm leading-relaxed"
      >
        <p className="font-semibold">还没连上工作台，暂时不能和助手对话。</p>
        <p className="mt-2">
          多半是这个标签页没带上访问钥匙。先点下面一键重开——不必去终端，也不必手拷
          Token。
        </p>
        <button
          type="button"
          data-testid="chat-relaunch-with-token"
          disabled={relaunchBusy}
          onClick={doRelaunch}
          className="mt-3 w-full rounded border border-amber-700/50 bg-background px-3 py-2 text-left font-medium hover:bg-accent disabled:opacity-50"
        >
          {relaunchBusy ? "正在重开…" : "一键重开（带钥匙）"}
        </button>
        {relaunchError ? (
          <p
            role="alert"
            data-testid="chat-relaunch-error"
            className="mt-2 text-destructive"
          >
            {relaunchError}
          </p>
        ) : null}
        <p className="mt-3 opacity-80">
          若按钮失败：可点左栏「打开项目」自救；或点左下角 ⚙️
          设置，把钥匙粘贴进去再点「应用」。
        </p>
      </div>
    );
  }

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (routing || journeyBusy) return;
    setDraft("");
    if (onBeforeSend) {
      setRouting(true);
      void onBeforeSend(text)
        .then((decision) => {
          if (decision === "passthrough") {
            void chat.send(text);
          }
        })
        .finally(() => setRouting(false));
      return;
    }
    void chat.send(text);
  };

  const sendDisabled =
    routing || journeyBusy === true || (!onBeforeSend && !chat.sessionId);

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
      <p
        data-testid="journey-entry-hint"
        className="rounded border border-border/60 bg-muted/30 px-2 py-1 text-[10px] leading-relaxed text-muted-foreground"
      >
        你只跟这里说话就行：质疑「做错了」、提新功能、或说「标题字号大一点」这类小事——系统会在背后分流，不必自己找别的对话框。
      </p>
      {!realReady && (
        <div
          data-testid="key-need-wizard"
          className="rounded border border-sky-600/40 bg-sky-500/10 px-2 py-1.5 text-[11px] leading-relaxed"
        >
          <p className="font-semibold text-sky-950">
            {keyConfigured
              ? "钥匙已就绪：选一个可用助手，再点「新会话」即可开聊。"
              : "还差一步：配好模型钥匙，真助手就能干活。"}
          </p>
          {!keyConfigured && (
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-sky-950/90">
              <li>点下方按钮打开设置里的「模型钥匙」</li>
              <li>粘贴钥匙并保存（不会显示在聊天里）</li>
              <li>回到这里，看到助手可选后点「新会话」</li>
            </ol>
          )}
          {onConfigureKey && (
            <button
              type="button"
              data-testid="open-key-settings"
              className="mt-1.5 rounded border border-sky-700/50 bg-background px-2 py-0.5 text-sky-900 hover:bg-sky-500/10"
              onClick={onConfigureKey}
            >
              {keyConfigured ? "打开设置核对钥匙" : "去配置模型钥匙"}
            </button>
          )}
          <p className="mt-1 text-[10px] opacity-70">
            「练习沙箱」只是本地回声，用来试界面；要改项目请走真助手。
          </p>
        </div>
      )}
      {current && (
        <div
          data-testid="current-agent"
          className={
            current.adapter_id === "demo"
              ? "rounded border border-border/70 bg-muted/40 px-2 py-1 text-[11px] leading-relaxed text-muted-foreground"
              : "font-semibold"
          }
        >
          {current.adapter_id === "demo" ? (
            <details data-testid="demo-sandbox-note">
              <summary className="cursor-pointer select-none">
                当前：练习沙箱（可选）· 点开看说明
              </summary>
              <p className="mt-1">
                这是本地练习模式：方便试界面，不会改你的项目文件。要真干活，请
                {realReady
                  ? "在上面选可用助手并点「新会话」。"
                  : "先配置模型钥匙，再开新会话。"}
              </p>
              {!realReady && onConfigureKey && (
                <button
                  type="button"
                  className="mt-1 rounded border px-2 py-0.5"
                  onClick={onConfigureKey}
                >
                  去配置模型钥匙
                </button>
              )}
            </details>
          ) : (
            <>当前对话使用：{currentLabel}</>
          )}
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
        {(journeyCards ?? []).map((card) => (
          <div
            key={card.id}
            data-testid="journey-card"
            data-journey-kind={card.kind}
            className="rounded border border-sky-600/40 bg-sky-500/10 p-2 text-[11px] leading-relaxed"
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-900/80">
              {card.kind === "DISPUTE"
                ? "质疑自查"
                : card.kind === "FAST_PATH"
                  ? "小事快通道"
                  : card.kind === "MAJOR_DRAFT"
                    ? "需求草案"
                    : "系统"}
            </div>
            <div className="whitespace-pre-wrap">{card.text}</div>
          </div>
        ))}
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
            routing || journeyBusy
              ? "正在分流处理…"
              : chat.busy
                ? "Agent 正在回答，可继续输入排队"
                : "输入消息，回车发送（质疑 / 需求 / 小改都从这里说）"
          }
          disabled={sendDisabled}
          className="min-h-[48px] flex-1 rounded border p-1"
        />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={submit}
            disabled={sendDisabled}
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

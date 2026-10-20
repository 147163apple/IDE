// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AgentChatPane } from "../../src/components/AgentChatPane";
import type { AgentSessionTransport } from "../../src/hooks/use-agent-session";
import type { ChatEvent, ChatEventBody } from "../../src/lib/chat-events";

function fakeTransport(history: ChatEvent[] = []) {
  const listeners = new Set<(e: ChatEvent) => void>();
  let seq = history.length;
  const push = (body: ChatEventBody, turn = "t1") => {
    const e = {
      session_id: "s1",
      turn_id: turn,
      seq: seq++,
      at: new Date().toISOString(),
      ...body,
    } as ChatEvent;
    act(() => listeners.forEach((l) => l(e)));
  };
  const t: AgentSessionTransport = {
    listAdapters: vi.fn(async () => [
      {
        id: "claude-code",
        label: "Claude Code",
        control_mode: "UNCONTROLLED_EXTERNAL" as const,
        verified_on: "",
        available: true,
      },
    ]),
    listSessions: vi.fn(async () => [
      {
        id: "s1",
        adapter_id: "claude-code",
        title: "旧会话",
        created_at: "",
        updated_at: "",
        native_session_id: "abc-native",
        busy: false,
      },
    ]),
    createSession: vi.fn(),
    getSession: vi.fn(async () => ({
      id: "s1",
      adapter_id: "claude-code",
      title: "旧会话",
      created_at: "",
      updated_at: "",
      native_session_id: "abc-native",
      busy: false,
      events: history,
    })),
    send: vi.fn(async () => "started" as const),
    interrupt: vi.fn(async () => true),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { t, push };
}

describe("TASK-C.6 右栏 AgentChatPane", () => {
  it("续接：打开后自动加载上次会话与历史上下文", async () => {
    const { t } = fakeTransport([
      {
        session_id: "s1",
        turn_id: "t0",
        seq: 0,
        at: "",
        kind: "user",
        text: "之前的问题",
      },
      {
        session_id: "s1",
        turn_id: "t0",
        seq: 1,
        at: "",
        kind: "delta",
        text: "之前的回答",
      },
      { session_id: "s1", turn_id: "t0", seq: 2, at: "", kind: "turn_end" },
    ]);
    render(<AgentChatPane transport={t} />);
    expect(await screen.findByText("之前的回答")).toBeInTheDocument();
    expect(screen.getByTestId("chat-session-meta")).toHaveTextContent(
      "abc-native",
    );
    expect(
      screen.getByRole("option", { name: /Claude Code（未受控）/ }),
    ).toBeInTheDocument();
  });

  it("逐 token 流式渲染 + 工具卡片 + 停止", async () => {
    const { t, push } = fakeTransport();
    render(<AgentChatPane transport={t} />);
    await waitFor(() => expect(t.getSession).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("给 Agent 的消息"), {
      target: { value: "改 a.ts" },
    });
    fireEvent.click(screen.getByText("发送"));
    await waitFor(() => expect(t.send).toHaveBeenCalledWith("s1", "改 a.ts"));
    push({ kind: "user", text: "改 a.ts" });
    push({
      kind: "tool_call",
      tool_id: "x",
      name: "Edit",
      input: { file_path: "a.ts" },
    });
    push({
      kind: "tool_result",
      tool_id: "x",
      output: "已写入",
      is_error: false,
    });
    push({ kind: "delta", text: "好" });
    push({ kind: "delta", text: "的" });
    expect(screen.getByText("好的")).toBeInTheDocument();
    expect(screen.getByTestId("tool-card")).toHaveTextContent("Edit");
    expect(screen.getByTestId("tool-card")).toHaveTextContent("已写入");
    const stop = screen.getByText("停止");
    expect(stop).not.toBeDisabled();
    fireEvent.click(stop);
    await waitFor(() => expect(t.interrupt).toHaveBeenCalledWith("s1"));
    push({ kind: "interrupted" });
    expect(screen.getByText("已停止")).toBeInTheDocument();
    expect(screen.getByText("停止")).toBeDisabled();
  });

  it("排队消息显示", async () => {
    const { t, push } = fakeTransport();
    render(<AgentChatPane transport={t} />);
    await waitFor(() => expect(t.getSession).toHaveBeenCalled());
    push({ kind: "user", text: "一" });
    push({ kind: "queued", text: "二", position: 1 });
    expect(screen.getByText("已排队：二")).toBeInTheDocument();
  });

  it("未连接时显示提示", () => {
    render(<AgentChatPane transport={null} />);
    expect(screen.getByTestId("agent-chat")).toHaveTextContent("还没连上后台");
  });
});

describe("foldChatEvents", () => {
  it("不同轮次的相同 tool_id 各自成卡片、结果不串（浏览器实测发现的重复 key）", async () => {
    const { foldChatEvents } =
      await import("../../src/hooks/use-agent-session");
    const e = (turn: string, seq: number, body: object) =>
      ({ session_id: "s", turn_id: turn, seq, at: "", ...body }) as never;
    const { messages } = foldChatEvents([
      e("t1", 0, { kind: "tool_call", tool_id: "x", name: "Read", input: {} }),
      e("t1", 1, {
        kind: "tool_result",
        tool_id: "x",
        output: "一",
        is_error: false,
      }),
      e("t2", 2, { kind: "tool_call", tool_id: "x", name: "Read", input: {} }),
      e("t2", 3, {
        kind: "tool_result",
        tool_id: "x",
        output: "二",
        is_error: false,
      }),
    ]);
    const cards = messages.filter((m) => m.role === "tool");
    expect(new Set(cards.map((c) => c.id)).size).toBe(2);
    expect(cards.map((c) => c.tool?.output)).toEqual(["一", "二"]);
  });
});

describe("TASK-C.6 未连接与可见标签（白话）", () => {
  it("未连接时给出白话提示：用带钥匙的链接打开，或粘贴到 Session Token", () => {
    render(<AgentChatPane transport={null} />);
    const box = screen.getByRole("status");
    expect(box.textContent).toContain("还没连上后台");
    expect(box.textContent).toContain("#token=");
    expect(box.textContent).toContain("Session");
  });
  it("Agent 下拉框旁有可见文字「AI 助手：」", async () => {
    const { t } = fakeTransport();
    render(<AgentChatPane transport={t} />);
    expect(await screen.findByText("AI 助手：")).toBeTruthy();
    expect(screen.getByLabelText("选择 Agent")).toBeTruthy();
  });
});

describe("TASK-C.6 当前会话所用助手要说清楚", () => {
  it("打开演示会话时：下拉框跟随为演示助手，并显示白话提醒", async () => {
    const t: AgentSessionTransport = {
      listAdapters: vi.fn(async () => [
        {
          id: "claude-code",
          label: "Claude Code",
          control_mode: "GATEWAY_ENFORCED" as const,
          verified_on: "x",
          available: true,
        },
        {
          id: "demo",
          label: "演示 Agent（不调用模型）",
          control_mode: "UNCONTROLLED_EXTERNAL" as const,
          verified_on: "",
          available: true,
        },
      ]),
      listSessions: vi.fn(async () => [
        {
          id: "d1",
          adapter_id: "demo",
          title: "你好",
          created_at: "",
          updated_at: "",
          native_session_id: "demo-1",
          busy: false,
        },
      ]),
      createSession: vi.fn(),
      getSession: vi.fn(async () => ({
        id: "d1",
        adapter_id: "demo",
        title: "你好",
        created_at: "",
        updated_at: "",
        native_session_id: "demo-1",
        busy: false,
        events: [],
      })),
      send: vi.fn(async () => "started" as const),
      interrupt: vi.fn(async () => true),
      subscribe: () => () => undefined,
    };
    render(<AgentChatPane transport={t} />);
    const line = await screen.findByTestId("current-agent");
    expect(line.textContent).toContain(
      "当前对话使用：演示 Agent（不调用模型）",
    );
    expect(line.textContent).toContain("不会真的读文件");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("选择 Agent") as HTMLSelectElement).value,
      ).toBe("demo"),
    );
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentChatPane } from "../../src/components/AgentChatPane";
import type { AgentSessionTransport } from "../../src/hooks/use-agent-session";

function transportWith(opts: {
  realAvailable: boolean;
  sessions?: Array<{ id: string; adapter_id: string }>;
}): AgentSessionTransport {
  const sessions = opts.sessions ?? [];
  return {
    listAdapters: vi.fn(async () => [
      {
        id: "claude-code",
        label: "Claude Code",
        control_mode: "GATEWAY_ENFORCED" as const,
        verified_on: "x",
        tool_mode: "read_only" as const,
        available: opts.realAvailable,
        unavailable_reason: opts.realAvailable
          ? undefined
          : "还差一步：去设置里配模型钥匙",
      },
      {
        id: "demo",
        label: "练习沙箱（可选）",
        control_mode: "GATEWAY_ENFORCED" as const,
        verified_on: "",
        tool_mode: "read_only" as const,
        available: true,
      },
    ]),
    listSessions: vi.fn(async () =>
      sessions.map((s) => ({
        ...s,
        title: s.id,
        created_at: "",
        updated_at: "",
        native_session_id: null,
        busy: false,
      })),
    ),
    createSession: vi.fn(),
    getSession: vi.fn(async (id: string) => {
      const s = sessions.find((x) => x.id === id) ?? sessions[0];
      return {
        id: s?.id ?? id,
        adapter_id: s?.adapter_id ?? "demo",
        title: "t",
        created_at: "",
        updated_at: "",
        native_session_id: null,
        busy: false,
        events: [],
      };
    }),
    send: vi.fn(async () => "started" as const),
    interrupt: vi.fn(async () => true),
    subscribe: () => () => undefined,
  };
}

describe("TASK-C.9b 助手模式互斥", () => {
  it("向导态：显示配钥匙向导，发送键禁用，不得装忙", async () => {
    const onConfigureKey = vi.fn();
    const onMode = vi.fn();
    const t = transportWith({ realAvailable: false, sessions: [] });
    render(
      <AgentChatPane
        transport={t}
        keyConfigured={false}
        onConfigureKey={onConfigureKey}
        onAssistantModeChange={onMode}
      />,
    );
    await screen.findByTestId("key-need-wizard");
    expect(screen.getByTestId("agent-chat")).toHaveAttribute(
      "data-assistant-mode",
      "wizard",
    );
    expect(screen.queryByTestId("assistant-practice-banner")).toBeNull();
    const send = await screen.findByTestId("chat-send");
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("data-can-send", "false");
    expect(t.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("open-key-settings"));
    expect(onConfigureKey).toHaveBeenCalled();
  });

  it("练习态：与向导互斥；可练习发送且标明不可当真", async () => {
    const t = transportWith({
      realAvailable: false,
      sessions: [{ id: "d1", adapter_id: "demo" }],
    });
    render(
      <AgentChatPane
        transport={t}
        keyConfigured={false}
        onConfigureKey={() => {}}
      />,
    );
    await screen.findByTestId("assistant-practice-banner");
    expect(screen.getByTestId("agent-chat")).toHaveAttribute(
      "data-assistant-mode",
      "practice",
    );
    expect(screen.queryByTestId("key-need-wizard")).toBeNull();
    const send = await screen.findByTestId("chat-send");
    expect(send).not.toBeDisabled();
    expect(send.textContent).toContain("练习");
  });

  it("真助手态：可正常发送；不显示向导/练习主条", async () => {
    const t = transportWith({
      realAvailable: true,
      sessions: [{ id: "s1", adapter_id: "claude-code" }],
    });
    render(<AgentChatPane transport={t} keyConfigured={true} />);
    await waitFor(() =>
      expect(screen.getByTestId("agent-chat")).toHaveAttribute(
        "data-assistant-mode",
        "real",
      ),
    );
    expect(screen.queryByTestId("key-need-wizard")).toBeNull();
    expect(screen.queryByTestId("assistant-practice-banner")).toBeNull();
    const send = screen.getByTestId("chat-send");
    expect(send).toHaveAttribute("data-can-send", "true");
    expect(send.textContent).toBe("发送");
  });
});

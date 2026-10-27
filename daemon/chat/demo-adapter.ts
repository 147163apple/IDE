import type { ChatAdapterInfo } from "../../src/lib/chat-events";
import type { AdapterEvent, AdapterRunInput, ChatAdapter } from "./types";

/**
 * 练习沙箱（可选）：本地回声、不花钱、不改项目。
 * 仅用于试界面；真干活请配模型钥匙后切到真助手。
 */
export class DemoChatAdapter implements ChatAdapter {
  constructor(private readonly tickMs = 40) {}

  info(): ChatAdapterInfo {
    return {
      id: "demo",
      label: "练习沙箱（可选）",
      control_mode: "GATEWAY_ENFORCED",
      verified_on: "",
      available: true,
      // 演示：不发真实工具调用（TASK-J.1）
      tool_mode: "read_only",
    };
  }

  async *run(input: AdapterRunInput): AsyncIterable<AdapterEvent> {
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        input.signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });
    if (!input.nativeSessionId) {
      yield { kind: "session", native_session_id: `demo-${Date.now()}` };
    }
    const prior = input.history.filter((h) => h.role === "user").length;
    const reply = `收到第 ${prior + 1} 条消息：「${input.prompt}」。这是一段演示回复，用来测试逐字显示和停止按钮。`;
    yield {
      kind: "tool_call",
      tool_id: "demo-1",
      name: "Read",
      input: { file_path: "README.md" },
    };
    yield {
      kind: "tool_result",
      tool_id: "demo-1",
      output: "（演示）读取完成",
      is_error: false,
    };
    for (const ch of reply) {
      if (input.signal.aborted) return;
      yield { kind: "delta", text: ch };
      await sleep(this.tickMs);
    }
  }
}

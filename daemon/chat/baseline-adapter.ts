import type { ChatAdapterInfo } from "../../src/lib/chat-events";
import { getRuntimeKey, getRuntimeModel } from "../worker/key-store";
import type { AdapterEvent, AdapterRunInput, ChatAdapter } from "./types";

/**
 * 自研保底 Agent（对话版）：与 ai-worker.ts 共用同一套 OpenAI 兼容 Key，
 * 只做文字问答、不改文件；改文件仍走合同 + ai-worker。
 */
export class BaselineChatAdapter implements ChatAdapter {
  info(): ChatAdapterInfo {
    const key = getRuntimeKey();
    return {
      id: "baseline",
      label: "自研保底 Agent（OpenAI 兼容，只聊天）",
      control_mode: "GATEWAY_ENFORCED",
      verified_on: "",
      available: !!key,
      ...(key ? {} : { unavailable_reason: "未配置模型 Key" }),
    };
  }

  async *run(input: AdapterRunInput): AsyncIterable<AdapterEvent> {
    const apiKey = getRuntimeKey();
    if (!apiKey) throw new Error("未配置模型 Key（顶部「模型 Key」）");
    const [{ streamText }, { createOpenAI }] = await Promise.all([
      import("ai"),
      import("@ai-sdk/openai"),
    ]);
    const baseURL = process.env["OPENAI_BASE_URL"];
    const provider = createOpenAI({
      apiKey,
      ...(baseURL === undefined ? {} : { baseURL }),
    });
    const result = streamText({
      model: provider(getRuntimeModel()),
      system: "你是 Stagent 右栏助手，用简体中文简洁回答。",
      messages: [
        ...input.history.map((h) => ({ role: h.role, content: h.text })),
        { role: "user" as const, content: input.prompt },
      ],
      abortSignal: input.signal,
    });
    for await (const text of result.textStream) {
      if (input.signal.aborted) return;
      yield { kind: "delta", text };
    }
  }
}

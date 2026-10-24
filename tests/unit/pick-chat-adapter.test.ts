import { describe, expect, it } from "vitest";
import {
  hasRealAssistantAvailable,
  pickPreferredAdapterId,
} from "../../src/lib/pick-chat-adapter";

describe("TASK-C.8a pickPreferredAdapterId", () => {
  it("优先可用的非 demo 助手", () => {
    expect(
      pickPreferredAdapterId([
        { id: "claude-code", available: false },
        { id: "baseline", available: true },
        { id: "demo", available: true },
      ]),
    ).toBe("baseline");
  });

  it("没有真助手时才回落到 demo", () => {
    expect(
      pickPreferredAdapterId([
        { id: "claude-code", available: false },
        { id: "demo", available: true },
      ]),
    ).toBe("demo");
  });

  it("尊重当前会话偏好（若仍可用）", () => {
    expect(
      pickPreferredAdapterId(
        [
          { id: "claude-code", available: true },
          { id: "demo", available: true },
        ],
        "demo",
      ),
    ).toBe("demo");
  });

  it("hasRealAssistantAvailable 忽略 demo", () => {
    expect(
      hasRealAssistantAvailable([
        { id: "demo", available: true },
        { id: "baseline", available: false },
      ]),
    ).toBe(false);
    expect(
      hasRealAssistantAvailable([
        { id: "demo", available: true },
        { id: "baseline", available: true },
      ]),
    ).toBe(true);
  });
});

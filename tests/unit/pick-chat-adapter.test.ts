import { describe, expect, it } from "vitest";
import {
  hasRealAssistantAvailable,
  isRightPanelEligible,
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

describe("TASK-J.1 右栏拒绝 read_write 适配器", () => {
  it("唯一可用的真助手是 read_write 时，不会被选为右栏适配器", () => {
    expect(
      pickPreferredAdapterId([
        { id: "claude-code", available: true, tool_mode: "read_write" },
        { id: "demo", available: true, tool_mode: "read_only" },
      ]),
    ).toBe("demo");
  });

  it("read_write 适配器被全部过滤时返回空，而不是退回可写助手", () => {
    expect(
      pickPreferredAdapterId([
        { id: "claude-code", available: true, tool_mode: "read_write" },
      ]),
    ).toBe("");
  });

  it("显式偏好 read_write 也不放行；偏好 read_only 仍被尊重", () => {
    expect(
      pickPreferredAdapterId(
        [
          { id: "claude-code", available: true, tool_mode: "read_write" },
          { id: "baseline", available: true, tool_mode: "read_only" },
        ],
        "claude-code",
      ),
    ).toBe("baseline");
    expect(
      pickPreferredAdapterId(
        [
          { id: "claude-code", available: true, tool_mode: "read_only" },
          { id: "baseline", available: true, tool_mode: "read_only" },
        ],
        "claude-code",
      ),
    ).toBe("claude-code");
  });

  it("hasRealAssistantAvailable 把 read_write 视为右栏不可用", () => {
    expect(
      hasRealAssistantAvailable([
        { id: "claude-code", available: true, tool_mode: "read_write" },
        { id: "demo", available: true, tool_mode: "read_only" },
      ]),
    ).toBe(false);
  });

  it("缺 tool_mode 的历史载荷不误杀（向后兼容）", () => {
    expect(isRightPanelEligible({ id: "legacy", available: true })).toBe(true);
    expect(pickPreferredAdapterId([{ id: "legacy", available: true }])).toBe(
      "legacy",
    );
  });
});

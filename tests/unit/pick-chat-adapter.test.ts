import { describe, expect, it } from "vitest";
import {
  hasRealAssistantAvailable,
  isRightPaneAdapter,
  pickPreferredAdapterId,
  rightPaneRejectionReason,
} from "../../src/lib/pick-chat-adapter";

/** 右栏候选：只有明确声明 read_only 的适配器才允许被选中 */
const ro = (id: string, available = true) => ({
  id,
  available,
  tool_mode: "read_only" as const,
});
const rw = (id: string, available = true) => ({
  id,
  available,
  tool_mode: "read_write" as const,
});

describe("TASK-C.8a pickPreferredAdapterId", () => {
  it("优先可用的非 demo 助手", () => {
    expect(
      pickPreferredAdapterId([
        ro("claude-code", false),
        ro("baseline"),
        ro("demo"),
      ]),
    ).toBe("baseline");
  });

  it("没有真助手时才回落到 demo", () => {
    expect(pickPreferredAdapterId([ro("claude-code", false), ro("demo")])).toBe(
      "demo",
    );
  });

  it("尊重当前会话偏好（若仍可用）", () => {
    expect(
      pickPreferredAdapterId([ro("claude-code"), ro("demo")], "demo"),
    ).toBe("demo");
  });

  it("hasRealAssistantAvailable 忽略 demo", () => {
    expect(hasRealAssistantAvailable([ro("demo"), ro("baseline", false)])).toBe(
      false,
    );
    expect(hasRealAssistantAvailable([ro("demo"), ro("baseline")])).toBe(true);
  });
});

describe("TASK-J.1 右栏绝不选中 read_write 适配器", () => {
  it("read_write 适配器再「可用」也不进候选：偏好指向它时改选只读助手", () => {
    expect(
      pickPreferredAdapterId(
        [rw("claude-code-worker"), ro("baseline")],
        "claude-code-worker",
      ),
    ).toBe("baseline");
  });

  it("只有 read_write 与 demo 时落到 demo；只剩 read_write 时为空（宁可没有也不可写）", () => {
    expect(pickPreferredAdapterId([rw("claude-code-worker"), ro("demo")])).toBe(
      "demo",
    );
    expect(pickPreferredAdapterId([rw("claude-code-worker")])).toBe("");
  });

  it("read_write 不计入「真助手可用」，避免向导态判断被打穿", () => {
    expect(
      hasRealAssistantAvailable([rw("claude-code-worker"), ro("demo")]),
    ).toBe(false);
  });

  it("缺 tool_mode 按不可选处理（失败关闭）", () => {
    expect(isRightPaneAdapter({ id: "legacy", available: true })).toBe(false);
    expect(pickPreferredAdapterId([{ id: "legacy", available: true }])).toBe(
      "",
    );
  });

  it("设置页白话原因：只读助手无需解释，可写助手给出不含术语的一句人话", () => {
    expect(rightPaneRejectionReason(ro("baseline"))).toBeNull();
    const reason = rightPaneRejectionReason(rw("claude-code-worker"));
    expect(reason).toBeTruthy();
    expect(reason).not.toMatch(/read_write|tool_mode|适配器/);
    expect(reason).toContain("改你的文件");
  });
});

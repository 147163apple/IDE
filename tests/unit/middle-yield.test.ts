import { describe, it, expect } from "vitest";
import {
  CHAT_VS_EDIT_PLAIN,
  shouldAutoOpenStudioForProgress,
  shouldYieldMiddleWelcome,
} from "../../src/lib/middle-yield";

describe("middle-yield (TASK-C.9d)", () => {
  it("进行中才让路欢迎页", () => {
    expect(shouldYieldMiddleWelcome("in_progress")).toBe(true);
    expect(shouldYieldMiddleWelcome("idle")).toBe(false);
    expect(shouldYieldMiddleWelcome("no_key")).toBe(false);
  });

  it("三步台/保护确认自动开 Studio", () => {
    expect(shouldAutoOpenStudioForProgress("boss-fastpath-confirm")).toBe(true);
    expect(shouldAutoOpenStudioForProgress("protection-confirm-approve")).toBe(
      true,
    );
    expect(shouldAutoOpenStudioForProgress("journey-active")).toBe(false);
    expect(shouldAutoOpenStudioForProgress(undefined)).toBe(false);
  });

  it("聊改分离白话不含 PROTECTED 暗号", () => {
    expect(CHAT_VS_EDIT_PLAIN).toMatch(/聊/);
    expect(CHAT_VS_EDIT_PLAIN).not.toMatch(/PROTECTED/);
  });
});

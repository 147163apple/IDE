import { describe, expect, it } from "vitest";
import {
  LEFT_CHAT_HINT,
  resolveLeftProjectFilesDefaultOpen,
  shouldShowLeftChatHint,
} from "../../src/lib/left-panel-boss";

describe("left-panel-boss (TASK-C.10d)", () => {
  it("项目文件默认不展开", () => {
    expect(resolveLeftProjectFilesDefaultOpen()).toBe(false);
  });

  it("空闲时显示跟右侧说话提示；无钥匙/进行中不抢戏", () => {
    expect(shouldShowLeftChatHint("idle")).toBe(true);
    expect(shouldShowLeftChatHint(undefined)).toBe(true);
    expect(shouldShowLeftChatHint("no_key")).toBe(false);
    expect(shouldShowLeftChatHint("in_progress")).toBe(false);
  });

  it("提示文案点名右侧与项目文件，不另造主 CTA", () => {
    expect(LEFT_CHAT_HINT).toMatch(/右侧/);
    expect(LEFT_CHAT_HINT).toMatch(/项目文件/);
  });
});

import { describe, expect, it } from "vitest";
import {
  LEFT_CHAT_HINT,
  resolveLeftProjectFilesDefaultOpen,
  resolveLeftShowsOpenProject,
  resolveLeftShowsSpecs,
  shouldShowLeftChatHint,
} from "../../src/lib/left-panel-boss";

describe("left-panel-boss (TASK-C.10e / C.10f)", () => {
  it("IDE 左栏不再展示打开项目与规范资产", () => {
    expect(resolveLeftShowsOpenProject()).toBe(false);
    expect(resolveLeftShowsSpecs()).toBe(false);
  });

  it("遗留折叠默认仍为收起；左栏不再显示跟右侧说话提示", () => {
    expect(resolveLeftProjectFilesDefaultOpen()).toBe(false);
    expect(shouldShowLeftChatHint("idle")).toBe(false);
    expect(shouldShowLeftChatHint("no_key")).toBe(false);
    expect(shouldShowLeftChatHint("in_progress")).toBe(false);
  });

  it("提示文案仍点名右侧与欢迎页切换项目", () => {
    expect(LEFT_CHAT_HINT).toMatch(/右侧/);
    expect(LEFT_CHAT_HINT).toMatch(/切换项目|欢迎/);
  });
});

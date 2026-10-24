import { describe, it, expect } from "vitest";
import { resolveOpenProjectEntryPresentation } from "../../src/lib/open-project-panel";

describe("resolveOpenProjectEntryPresentation (TASK-C.9c)", () => {
  it("未连接：打开项目 + 默认收起", () => {
    const p = resolveOpenProjectEntryPresentation({ hasSession: false });
    expect(p.mode).toBe("open");
    expect(p.label).toBe("打开项目");
    expect(p.defaultExpanded).toBe(false);
  });

  it("已连接：切换项目 + 默认收起", () => {
    const p = resolveOpenProjectEntryPresentation({ hasSession: true });
    expect(p.mode).toBe("switch");
    expect(p.label).toBe("切换项目");
    expect(p.defaultExpanded).toBe(false);
  });
});

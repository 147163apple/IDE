import { describe, expect, it } from "vitest";
import { resolveAssistantMode } from "../../src/lib/assistant-mode";

describe("TASK-C.9b resolveAssistantMode", () => {
  it("真助手不可用且非练习：向导态，禁止当真发送", () => {
    const s = resolveAssistantMode({
      keyReady: false,
      hasRealAssistant: false,
      activeAdapterId: null,
    });
    expect(s.mode).toBe("wizard");
    expect(s.canSendAsWork).toBe(false);
    expect(s.sendOpensConfigure).toBe(true);
    expect(s.middleHint).toContain("钥匙");
  });

  it("练习沙箱会话：练习态，可发但标明不可当真；与向导互斥", () => {
    const s = resolveAssistantMode({
      keyReady: false,
      hasRealAssistant: false,
      activeAdapterId: "demo",
    });
    expect(s.mode).toBe("practice");
    expect(s.canSendAsWork).toBe(true);
    expect(s.sendOpensConfigure).toBe(false);
    expect(s.middleHint).toContain("练习");
  });

  it("真助手可用：真助手态（即使 keyReady 未注入也不误伤）", () => {
    const s = resolveAssistantMode({
      keyReady: false,
      hasRealAssistant: true,
      activeAdapterId: "claude-code",
    });
    expect(s.mode).toBe("real");
    expect(s.canSendAsWork).toBe(true);
    expect(s.sendOpensConfigure).toBe(false);
  });

  it("钥匙就绪且真助手：真助手态", () => {
    const s = resolveAssistantMode({
      keyReady: true,
      hasRealAssistant: true,
      activeAdapterId: "claude-code",
    });
    expect(s.mode).toBe("real");
    expect(s.canSendAsWork).toBe(true);
  });

  it("钥匙就绪但当前仍是练习：保持练习态（互斥，不装真助手）", () => {
    const s = resolveAssistantMode({
      keyReady: true,
      hasRealAssistant: true,
      activeAdapterId: "demo",
    });
    expect(s.mode).toBe("practice");
  });
});

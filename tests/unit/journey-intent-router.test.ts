import { describe, expect, it } from "vitest";
import { classifyJourneyIntent } from "../../src/lib/journey/intent-router";

describe("TASK-S.6 intent router（确定性分流）", () => {
  it("质疑 / 抱怨 → DISPUTE", () => {
    const r = classifyJourneyIntent("这里做错了，帮我查一下为什么按钮没反应");
    expect(r.kind).toBe("DISPUTE");
    expect(r.skip_demo).toBe(false);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("字号文案小事 → FAST_PATH 且 skip_demo", () => {
    const r = classifyJourneyIntent("把标题字号调大一点，再改一下文案颜色");
    expect(r.kind).toBe("FAST_PATH");
    expect(r.skip_demo).toBe(true);
  });

  it("保护域命中时 Fast Path 升格 MAJOR_DRAFT", () => {
    const r = classifyJourneyIntent("微调一下登录页的字号");
    expect(r.kind).toBe("MAJOR_DRAFT");
    expect(r.skip_demo).toBe(false);
    expect(r.reasons.some((x) => /保护|升格|Fast Path/.test(x))).toBe(true);
  });

  it("新功能 / 我要做 → MAJOR_DRAFT", () => {
    const r = classifyJourneyIntent("我想做一个订单满减功能，整套从零开始");
    expect(r.kind).toBe("MAJOR_DRAFT");
    expect(r.skip_demo).toBe(false);
  });

  it("短闲聊 → CHAT 透传", () => {
    const r = classifyJourneyIntent("你好");
    expect(r.kind).toBe("CHAT");
    expect(r.skip_demo).toBe(false);
  });

  it("打开真机预览 → REAL_PLAYTEST", () => {
    const r = classifyJourneyIntent("打开真机预览，我想看看真实页面");
    expect(r.kind).toBe("REAL_PLAYTEST");
    expect(r.skip_demo).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("空消息 → CHAT", () => {
    expect(classifyJourneyIntent("   ").kind).toBe("CHAT");
  });

  it("同一句话恒得同一结论", () => {
    const a = classifyJourneyIntent("这里有问题，质疑一下");
    const b = classifyJourneyIntent("这里有问题，质疑一下");
    expect(a).toEqual(b);
  });
});

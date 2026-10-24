import { describe, expect, it } from "vitest";
import { resolveCommandSurface } from "../../src/lib/command-surface";

describe("TASK-C.9a resolveCommandSurface", () => {
  it("无会话：主 CTA 为一键重开", () => {
    const s = resolveCommandSurface({
      hasSession: false,
      keyReady: false,
      inProgress: false,
    });
    expect(s.phase).toBe("no_key");
    expect(s.primaryCtaTestId).toBe("chat-relaunch-with-token");
    expect(s.welcomeVariant).toBe("connect");
    expect(s.openProjectDefaultExpanded).toBe(false);
  });

  it("有会话但没模型钥匙：主 CTA 为去配置钥匙", () => {
    const s = resolveCommandSurface({
      hasSession: true,
      keyReady: false,
      inProgress: false,
    });
    expect(s.phase).toBe("no_key");
    expect(s.primaryCtaTestId).toBe("open-key-settings");
    expect(s.welcomeVariant).toBe("connect");
  });

  it("有钥匙空闲：主 CTA 为右侧说需求", () => {
    const s = resolveCommandSurface({
      hasSession: true,
      keyReady: true,
      inProgress: false,
    });
    expect(s.phase).toBe("idle");
    expect(s.primaryCtaTestId).toBe("journey-entry-hint");
    expect(s.welcomeVariant).toBe("speak_right");
  });

  it("进行中：主 CTA 交给确认/三步台/旅程", () => {
    const s = resolveCommandSurface({
      hasSession: true,
      keyReady: true,
      inProgress: true,
      inProgressCta: "boss-fastpath-confirm",
    });
    expect(s.phase).toBe("in_progress");
    expect(s.primaryCtaTestId).toBe("boss-fastpath-confirm");
    expect(s.welcomeVariant).toBe("yield");
  });
});

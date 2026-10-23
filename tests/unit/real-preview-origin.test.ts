import { describe, expect, it } from "vitest";
import {
  REAL_ORIGIN_FORBIDDEN,
  REAL_PLAYTEST_IFRAME_SANDBOX,
  REAL_PREVIEW_PORT_END,
  REAL_PREVIEW_PORT_START,
  isRealPreviewOrigin,
  realPlaytestIframeProps,
} from "../../src/lib/ipc/real-preview-origin";

describe("real-preview-origin（TASK-S.6b）", () => {
  it("仅回环 4200–4210 判为真机预览 Origin", () => {
    expect(isRealPreviewOrigin("http://127.0.0.1:4200")).toBe(true);
    expect(isRealPreviewOrigin("http://localhost:4205")).toBe(true);
    expect(isRealPreviewOrigin("http://127.0.0.1:4210")).toBe(true);
    expect(isRealPreviewOrigin("null")).toBe(true);
    expect(isRealPreviewOrigin(undefined)).toBe(false);
    expect(isRealPreviewOrigin("http://127.0.0.1:4100")).toBe(false);
    expect(isRealPreviewOrigin("http://127.0.0.1:3001")).toBe(false);
    expect(isRealPreviewOrigin("https://evil.example")).toBe(false);
  });

  it("端口常量与沙箱策略固定", () => {
    expect(REAL_PREVIEW_PORT_START).toBe(4200);
    expect(REAL_PREVIEW_PORT_END).toBe(4210);
    expect(REAL_ORIGIN_FORBIDDEN).toBe("E_REAL_PREVIEW_ORIGIN_FORBIDDEN");
    expect(REAL_PLAYTEST_IFRAME_SANDBOX).toContain("allow-scripts");
    expect(REAL_PLAYTEST_IFRAME_SANDBOX).toContain("allow-same-origin");
    const props = realPlaytestIframeProps("http://127.0.0.1:4201/");
    expect(props.src).toBe("http://127.0.0.1:4201/");
    expect(props.sandbox).toBe(REAL_PLAYTEST_IFRAME_SANDBOX);
    expect(props.referrerPolicy).toBe("no-referrer");
  });
});

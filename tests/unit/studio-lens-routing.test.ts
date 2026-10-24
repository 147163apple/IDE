import { describe, expect, it } from "vitest";
import {
  resolveActiveLens,
  resolveDefaultLens,
} from "../../src/lib/studio/lens-routing";

describe("studio lens routing (TASK-C.10q)", () => {
  it("无图默认全景，有图默认施工", () => {
    expect(resolveDefaultLens({ hasGraph: false })).toBe("panorama");
    expect(resolveDefaultLens({ hasGraph: true })).toBe("construction");
  });

  it("刚建图（无→有）强制施工并清手动覆盖", () => {
    const r = resolveActiveLens({
      hasGraph: true,
      previousHasGraph: false,
      manualLens: "panorama",
    });
    expect(r).toEqual({ lens: "construction", clearManual: true });
  });

  it("展示态未变时保留手动选择", () => {
    const r = resolveActiveLens({
      hasGraph: false,
      previousHasGraph: false,
      manualLens: "construction",
    });
    expect(r).toEqual({ lens: "construction", clearManual: false });
  });
});

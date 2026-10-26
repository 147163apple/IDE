/**
 * TASK-C.14f：BASELINE_PROGRESS 帧契约 + 渐进扫回调广播形状。
 */
import { describe, expect, it } from "vitest";
import {
  IPC_FRAME_TYPES,
  FRAME_CATALOG,
  createFrame,
  isIpcFrame,
  type BaselineProgressPayload,
} from "../../src/lib/ipc/frames";

describe("TASK-C.14f BASELINE_PROGRESS frame", () => {
  it("列入 IPC_FRAME_TYPES 与 FRAME_CATALOG", () => {
    expect(IPC_FRAME_TYPES).toContain("BASELINE_PROGRESS");
    const entry = FRAME_CATALOG.find((e) => e.type === "BASELINE_PROGRESS");
    expect(entry?.direction).toBe("server->client");
    expect(entry?.requiresAuth).toBe(true);
  });

  it("createFrame 产出可解析帧", () => {
    const payload: BaselineProgressPayload = {
      phase: "p0",
      scanning: true,
      accept_label: "认可此基线作为后续参考",
      grants_construction: false,
      archive: { phase: "p0", scan_id: "scan_test" },
    };
    const frame = createFrame("BASELINE_PROGRESS", payload);
    expect(isIpcFrame(frame)).toBe(true);
    expect(frame.type).toBe("BASELINE_PROGRESS");
    expect(frame.payload?.phase).toBe("p0");
    expect(frame.payload?.grants_construction).toBe(false);
  });

  it("完成态 scanning=false 形状", () => {
    const payload: BaselineProgressPayload = {
      phase: "done",
      scanning: false,
      accept_label: "认可此基线作为后续参考",
      grants_construction: false,
      archive: { phase: "done" },
    };
    const frame = createFrame("BASELINE_PROGRESS", payload);
    expect(frame.payload?.scanning).toBe(false);
  });
});

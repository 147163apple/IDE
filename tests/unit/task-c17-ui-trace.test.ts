import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/daemon-api", () => ({
  postClientEvents: vi.fn(async () => ({ accepted: 1 })),
}));

import { postClientEvents } from "../../src/lib/daemon-api";
import {
  __resetUiTraceForTests,
  flushUiTrace,
  traceCtaClick,
  traceCtaDisabled,
  traceViewportChange,
} from "../../src/lib/ui-trace";

afterEach(() => {
  __resetUiTraceForTests();
  vi.clearAllMocks();
});

describe("TASK-C.17 ui-trace", () => {
  it("批量冲刷 CTA / viewport / disabled 到 client-events", async () => {
    traceCtaClick("authorize", { contractId: "ctr_1" });
    traceViewportChange("playtest");
    traceCtaDisabled("run-worker", "no_contract");
    await flushUiTrace();
    expect(postClientEvents).toHaveBeenCalled();
    const events = (postClientEvents as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(events.map((e) => e["kind"])).toEqual([
      "cta_click",
      "viewport_change",
      "cta_disabled",
    ]);
  });
});

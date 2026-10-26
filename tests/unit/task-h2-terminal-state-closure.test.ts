/**
 * TASK-H.2 方案 B：MERGED = 对外交付终态；无悬空 DELIVERED 承诺；
 * 归档失败不得标交付完成。
 */
import { describe, expect, it } from "vitest";
import {
  H2_TERMINAL_SCHEME,
  PUBLIC_DELIVERY_TERMINAL,
  collapseDeliveredAlias,
  hasHangingDeliveredPromise,
  isPublicDeliveryTerminal,
  publicDeliveryCopy,
} from "../../src/lib/state/terminal-delivery-closure";

describe("TASK-H.2 terminal state closure (scheme B)", () => {
  it("选定方案 B：MERGED 为对外终态，与代码枚举一致", () => {
    expect(H2_TERMINAL_SCHEME).toBe("B_MERGED_IS_TERMINAL");
    expect(PUBLIC_DELIVERY_TERMINAL).toBe("MERGED");
    expect(isPublicDeliveryTerminal("MERGED")).toBe(true);
    expect(isPublicDeliveryTerminal("DELIVERED")).toBe(false);
    expect(collapseDeliveredAlias("DELIVERED")).toBe("MERGED");
  });

  it("归档成功 → delivery_complete；归档失败不得伪造成功文案", () => {
    const ok = publicDeliveryCopy({
      lifecycle_state: "MERGED",
      archive_ok: true,
    });
    expect(ok.terminal).toBe(true);
    expect(ok.delivery_complete).toBe(true);
    expect(ok.label).toMatch(/交付|归档/);

    const fail = publicDeliveryCopy({
      lifecycle_state: "MERGED",
      archive_ok: false,
    });
    expect(fail.terminal).toBe(true);
    expect(fail.delivery_complete).toBe(false);
    expect(fail.label).toMatch(/未完成|尚未/);
    expect(fail.label).not.toBe("已交付归档");
  });

  it("对外文案不得悬空承诺独立 DELIVERED 终态", () => {
    expect(hasHangingDeliveredPromise("交付终态: DELIVERED")).toBe(true);
    expect(hasHangingDeliveredPromise("单独 DELIVERED")).toBe(true);
    expect(
      hasHangingDeliveredPromise(
        "MERGED 即为终态；DELIVERED 仅为 EO-01 投影别名",
      ),
    ).toBe(false);
    expect(hasHangingDeliveredPromise("已交付归档")).toBe(false);
  });
});

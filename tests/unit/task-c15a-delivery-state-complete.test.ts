/**
 * TASK-C.15a / EO-01：DeliveryState 完备 + 合法转移 DAG。
 */
import { describe, expect, it } from "vitest";
import {
  DELIVERY_STATES,
  canTransitionDelivery,
  assertDeliveryTransition,
  projectDeliveryState,
  projectDemoReadyEvent,
  assertNotMasqueradingAsDelivery,
} from "../../src/lib/state/delivery-state";

describe("TASK-C.15a EO-01 DeliveryState 完备", () => {
  it("含 PLAN_READY / VERIFYING / REWORK_REQUIRED / ESCALATED_HUMAN", () => {
    for (const s of [
      "PLAN_READY",
      "VERIFYING",
      "REWORK_REQUIRED",
      "ESCALATED_HUMAN",
      "DEMO_READY",
      "CONTRACT_SIGNED",
    ] as const) {
      expect(DELIVERY_STATES).toContain(s);
    }
  });

  it("REWORK 仅 MERGED 前合法；MERGED 后不得倒流 REWORK", () => {
    expect(canTransitionDelivery("VERIFYING", "REWORK_REQUIRED")).toBe(true);
    expect(canTransitionDelivery("MERGED", "REWORK_REQUIRED")).toBe(false);
    expect(canTransitionDelivery("MERGED", "DELIVERED")).toBe(true);
    expect(canTransitionDelivery("DELIVERED", "IMPLEMENTING")).toBe(false);
  });

  it("超限熔断 VERIFYING→…→ESCALATED_HUMAN", () => {
    expect(canTransitionDelivery("REWORK_REQUIRED", "ESCALATED_HUMAN")).toBe(
      true,
    );
    expect(() =>
      assertDeliveryTransition("DELIVERED", "ABORTED"),
    ).toThrow(/非法 DeliveryState/);
  });

  it("Demo 就绪事件投影到 DEMO_READY", () => {
    expect(projectDemoReadyEvent("DEMO_INTERACTIVE_READY")).toBe("DEMO_READY");
    expect(projectDemoReadyEvent("DEMO_DEGRADED_READY")).toBe("DEMO_READY");
    expect(projectDemoReadyEvent("NOPE")).toBeNull();
  });

  it("资产态不得冒充交付态", () => {
    expect(() => assertNotMasqueradingAsDelivery("FROZEN")).toThrow();
  });

  it("projectDeliveryState 识别 VERIFYING / escalated", () => {
    expect(
      projectDeliveryState({ lifecycle_state: "VERIFYING" }),
    ).toBe("VERIFYING");
    expect(
      projectDeliveryState({
        lifecycle_state: "EXECUTING",
        escalated: true,
      }),
    ).toBe("ESCALATED_HUMAN");
  });
});

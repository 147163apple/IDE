import { describe, expect, it } from "vitest";
import {
  resolveActiveInProgress,
  resolveInProgressCta,
  shouldRenderMiddleYieldShell,
} from "../../src/lib/in-progress-lifecycle";

describe("TASK-C.10a in-progress lifecycle", () => {
  it("历史旅程卡不单独构成进行中（调用方勿把 cards.length 传入）", () => {
    expect(
      resolveActiveInProgress({
        journeyBusy: false,
        bossMode: false,
        needsProtectionConfirm: false,
      }),
    ).toBe(false);
  });

  it("忙碌 / 三步台 / 保护确认 → 进行中", () => {
    expect(
      resolveActiveInProgress({
        journeyBusy: true,
        bossMode: false,
        needsProtectionConfirm: false,
      }),
    ).toBe(true);
    expect(
      resolveActiveInProgress({
        journeyBusy: false,
        bossMode: true,
        needsProtectionConfirm: false,
      }),
    ).toBe(true);
    expect(
      resolveActiveInProgress({
        journeyBusy: false,
        bossMode: false,
        needsProtectionConfirm: true,
      }),
    ).toBe(true);
  });

  it("结束后退出：全 false → 非进行中", () => {
    expect(
      resolveActiveInProgress({
        journeyBusy: false,
        bossMode: false,
        needsProtectionConfirm: false,
        confirmPrototypeBusy: false,
      }),
    ).toBe(false);
    expect(
      resolveInProgressCta({
        journeyBusy: false,
        bossMode: false,
        needsProtectionConfirm: false,
      }),
    ).toBeUndefined();
  });

  it("CTA 优先级：保护确认 > 三步台 > 旅程忙碌", () => {
    expect(
      resolveInProgressCta({
        journeyBusy: true,
        bossMode: true,
        needsProtectionConfirm: true,
      }),
    ).toBe("protection-confirm-approve");
    expect(
      resolveInProgressCta({
        journeyBusy: true,
        bossMode: true,
        needsProtectionConfirm: false,
      }),
    ).toBe("boss-fastpath-confirm");
    expect(
      resolveInProgressCta({
        journeyBusy: true,
        bossMode: false,
        needsProtectionConfirm: false,
      }),
    ).toBe("journey-active");
  });

  it("无确认/三步台 CTA 时不渲染空让路壳", () => {
    expect(
      shouldRenderMiddleYieldShell({
        phase: "in_progress",
        cta: "journey-active",
      }),
    ).toBe(false);
    expect(
      shouldRenderMiddleYieldShell({
        phase: "idle",
        cta: "boss-fastpath-confirm",
      }),
    ).toBe(false);
    expect(
      shouldRenderMiddleYieldShell({
        phase: "in_progress",
        cta: "boss-fastpath-confirm",
      }),
    ).toBe(true);
    expect(
      shouldRenderMiddleYieldShell({
        phase: "in_progress",
        cta: "protection-confirm-approve",
      }),
    ).toBe(true);
  });
});

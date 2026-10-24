/**
 * TASK-C.10a：进行中生命周期收口（呈现层）。
 *
 * - 旅程卡只增不减 ≠ 永远「进行中」；历史卡留在右栏，不粘住指挥面
 * - 有确认/三步台才让路；无料时不渲染空 middle-yield 壳
 * - 与 C.9a 单一指挥、C.9d 让路纪律一致
 *
 * 不含重做 Studio 四视口；不改鉴权。
 */

import type { CommandSurfacePhase, InProgressCta } from "./command-surface";
import { shouldAutoOpenStudioForProgress } from "./middle-yield";

export interface ActiveProgressInput {
  /** 旅程分流请求飞行中 */
  journeyBusy: boolean;
  /** Fast Path 老板三步台在场（有草案/待确认小事） */
  bossMode: boolean;
  /** 保护清单白话确认卡在场 */
  needsProtectionConfirm: boolean;
  /** 确认原型建图飞行中（可选） */
  confirmPrototypeBusy?: boolean;
}

/** 是否处于真正「进行中」（不含历史 journeyCards 堆叠） */
export function resolveActiveInProgress(input: ActiveProgressInput): boolean {
  return (
    input.journeyBusy ||
    input.bossMode ||
    input.needsProtectionConfirm ||
    input.confirmPrototypeBusy === true
  );
}

export function resolveInProgressCta(
  input: ActiveProgressInput,
): InProgressCta | undefined {
  if (input.needsProtectionConfirm) return "protection-confirm-approve";
  if (input.bossMode) return "boss-fastpath-confirm";
  if (input.journeyBusy || input.confirmPrototypeBusy === true) {
    return "journey-active";
  }
  return undefined;
}

/**
 * 是否渲染空「中栏已让路」壳。
 * 仅当进行中且 CTA 会接到确认/三步台（会自动开 Studio）时；
 * 纯 journey-active / 无料时 false，避免关台后空壳。
 */
export function shouldRenderMiddleYieldShell(opts: {
  phase: CommandSurfacePhase | undefined;
  cta: InProgressCta | string | undefined;
}): boolean {
  if (opts.phase !== "in_progress") return false;
  const cta =
    opts.cta === "boss-fastpath-confirm" ||
    opts.cta === "protection-confirm-approve" ||
    opts.cta === "journey-active"
      ? opts.cta
      : undefined;
  return shouldAutoOpenStudioForProgress(cta);
}

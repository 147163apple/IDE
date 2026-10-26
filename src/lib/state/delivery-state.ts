/**
 * TASK-C.12b / EO-01：交付主生命周期 DeliveryState（轨 A）
 * 与 DocumentAssetStatus（轨 B / DocGov）严格分轨，禁止资产 FROZEN 冒充开工主态。
 *
 * 现网 contract.lifecycle_state 仍是施工底座；本枚举是 Spec Freeze / Top5 广播口径。
 * CONTRACT_SIGNING 属于轨 C 瞬态，不得与轨 A 揉成假主态。
 */

/** 轨 A：交付主生命周期（EO-01） */
export const DELIVERY_STATES = [
  "PLAN_DRAFTING",
  "PLAN_CONFIRMED",
  "DEMO_READY",
  "CONTRACT_SIGNED",
  "IMPLEMENTING",
  "PAUSED",
  "CANDIDATE_VERIFIED",
  "MERGED",
  "DELIVERED",
  "ABORTED",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** 轨 C：活动瞬态（不冒充轨 A） */
export const ACTIVITY_TRANSIENTS = [
  "DEMO_BUILDING",
  "CONTRACT_SIGNING",
  "MERGING",
] as const;

export type ActivityTransient = (typeof ACTIVITY_TRANSIENTS)[number];

/** 轨 B：文档资产文件态（DocGov）——禁止当 DeliveryState 广播 */
export const DOCUMENT_ASSET_STATUSES = [
  "DRAFT",
  "PROPOSED",
  "FROZEN",
  "SUPERSEDED",
] as const;

export type DocumentAssetStatus = (typeof DOCUMENT_ASSET_STATUSES)[number];

/** Demo 三态（EO-06 / C.12d） */
export const DEMO_MODES = [
  "INTERACTIVE_DEMO",
  "NATIVE_FLOW_CARD",
  "DEGRADED_FLOW_CARD",
] as const;

export type DemoMode = (typeof DEMO_MODES)[number];

export function isDeliveryState(value: unknown): value is DeliveryState {
  return (
    typeof value === "string" &&
    (DELIVERY_STATES as readonly string[]).includes(value)
  );
}

export function isDocumentAssetStatus(
  value: unknown,
): value is DocumentAssetStatus {
  return (
    typeof value === "string" &&
    (DOCUMENT_ASSET_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * 资产态不得冒充交付主态。FROZEN/DRAFT/PROPOSED/SUPERSEDED 一律拒绝。
 */
export function assertNotMasqueradingAsDelivery(
  candidate: string,
): asserts candidate is DeliveryState {
  if (isDocumentAssetStatus(candidate)) {
    throw new Error(
      `DocumentAssetStatus '${candidate}' 不得冒充 DeliveryState（EO-01 / DocGov 分轨）`,
    );
  }
  if (!isDeliveryState(candidate)) {
    throw new Error(`未知 DeliveryState: ${candidate}`);
  }
}

/**
 * 从现网 lifecycle + 可选瞬态提示，投影到 EO-01 DeliveryState。
 * 不替换 presentation 15 态；仅叠加在 STATE_CHANGED 上供 Top5 对账。
 */
export function projectDeliveryState(input: {
  lifecycle_state: string;
  activity_transient?: ActivityTransient | null;
  demo_confirmed?: boolean;
  demo_mode?: DemoMode | null;
}): DeliveryState | ActivityTransient {
  if (input.activity_transient === "CONTRACT_SIGNING") {
    return "CONTRACT_SIGNING";
  }
  if (input.activity_transient === "DEMO_BUILDING") {
    return "DEMO_BUILDING";
  }
  if (input.activity_transient === "MERGING") {
    return "MERGING";
  }

  switch (input.lifecycle_state) {
    case "DRAFT":
      if (input.demo_confirmed) return "DEMO_READY";
      return "PLAN_DRAFTING";
    case "PENDING_APPROVAL":
      return "PLAN_CONFIRMED";
    case "PREPARING":
    case "EXECUTING":
      return "IMPLEMENTING";
    case "PENDING_RESUME":
      return "PAUSED";
    case "VERIFYING":
    case "AUDITED":
      return "CANDIDATE_VERIFIED";
    case "MERGED":
      return "MERGED";
    case "ABORTED":
      return "ABORTED";
    default:
      return "PLAN_DRAFTING";
  }
}

/**
 * can_sign 硬谓词（EO-06 / C.12d）：
 * - INTERACTIVE_DEMO + 已确认 → 可签
 * - 流程卡 / 降级卡必须显式 accept_degraded（带 ⚠️ 约定）才可签
 * - 未确认 / 冒充交互 → 失败
 */
export function canSign(input: {
  demo_mode: DemoMode | null | undefined;
  confirmed: boolean;
  accept_degraded?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.demo_mode) {
    return { ok: false, reason: "缺少 demo_mode，禁止签署" };
  }
  if (!input.confirmed) {
    return { ok: false, reason: "Demo 尚未确认，禁止签署" };
  }
  if (input.demo_mode === "INTERACTIVE_DEMO") {
    return { ok: true };
  }
  if (
    input.demo_mode === "NATIVE_FLOW_CARD" ||
    input.demo_mode === "DEGRADED_FLOW_CARD"
  ) {
    if (input.accept_degraded === true) {
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        "流程卡/降级卡不得冒充可交互 Demo 偷渡签署；须显式接受降级（accept_degraded）",
    };
  }
  return { ok: false, reason: `未知 demo_mode: ${String(input.demo_mode)}` };
}

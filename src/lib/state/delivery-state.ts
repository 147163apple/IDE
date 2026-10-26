/**
 * TASK-C.12b / C.15a / EO-01：交付主生命周期 DeliveryState（轨 A）
 * 与 DocumentAssetStatus（轨 B / DocGov）严格分轨，禁止资产 FROZEN 冒充开工主态。
 *
 * C.12b：主干简化枚举 + DEMO_READY+demo_mode。
 * C.15a：补齐 EO-01 缺口态与合法转移 DAG（PLAN_READY / VERIFYING /
 * REWORK_REQUIRED / ESCALATED_HUMAN；DEMO_*_READY 事件别名映射到 DEMO_READY）。
 * CONTRACT_SIGNING / MERGING / DEMO_BUILDING 仍属轨 C 瞬态。
 */

/** 轨 A：交付主生命周期（EO-01 / C.15a 完备） */
export const DELIVERY_STATES = [
  "PLAN_DRAFTING",
  "PLAN_READY",
  "PLAN_CONFIRMED",
  "DEMO_READY",
  "CONTRACT_SIGNED",
  "IMPLEMENTING",
  "PAUSED",
  "VERIFYING",
  "REWORK_REQUIRED",
  "CANDIDATE_VERIFIED",
  "MERGED",
  "DELIVERED",
  "ABORTED",
  "ESCALATED_HUMAN",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** 轨 C：活动瞬态（不冒充轨 A） */
export const ACTIVITY_TRANSIENTS = [
  "DEMO_BUILDING",
  "CONTRACT_SIGNING",
  "MERGING",
] as const;

export type ActivityTransient = (typeof ACTIVITY_TRANSIENTS)[number];

/** 对外 Demo 就绪事件别名（EO-01）；投影到主干 DEMO_READY + demo_mode */
export const DEMO_READY_EVENTS = [
  "DEMO_INTERACTIVE_READY",
  "DEMO_NATIVE_FLOW_READY",
  "DEMO_DEGRADED_READY",
] as const;

export type DemoReadyEvent = (typeof DEMO_READY_EVENTS)[number];

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
 * EO-01 合法转移 DAG（单向、不可跳步；REWORK 仅 MERGED 前）。
 * 键 = from；值 = 允许的 to（含同态 no-op 不列）。
 */
export const DELIVERY_TRANSITIONS: Readonly<
  Record<DeliveryState, readonly DeliveryState[]>
> = {
  PLAN_DRAFTING: ["PLAN_READY", "PLAN_CONFIRMED", "ABORTED"],
  PLAN_READY: ["PLAN_CONFIRMED", "PLAN_DRAFTING", "ABORTED"],
  PLAN_CONFIRMED: ["DEMO_READY", "ABORTED"],
  DEMO_READY: ["CONTRACT_SIGNED", "PLAN_CONFIRMED", "ABORTED"],
  CONTRACT_SIGNED: ["IMPLEMENTING", "PAUSED", "ABORTED"],
  IMPLEMENTING: ["PAUSED", "VERIFYING", "ABORTED"],
  PAUSED: ["IMPLEMENTING", "ABORTED"],
  VERIFYING: ["REWORK_REQUIRED", "CANDIDATE_VERIFIED", "ABORTED"],
  REWORK_REQUIRED: ["IMPLEMENTING", "ESCALATED_HUMAN", "ABORTED"],
  CANDIDATE_VERIFIED: ["MERGED", "ABORTED"],
  MERGED: ["DELIVERED"], // 失败则停 MERGED，不倒流
  DELIVERED: [],
  ABORTED: [],
  ESCALATED_HUMAN: ["ABORTED"],
};

export function canTransitionDelivery(
  from: DeliveryState,
  to: DeliveryState,
): boolean {
  if (from === to) return true;
  const allowed = DELIVERY_TRANSITIONS[from];
  return allowed.includes(to);
}

export function assertDeliveryTransition(
  from: DeliveryState,
  to: DeliveryState,
): void {
  if (!canTransitionDelivery(from, to)) {
    const err = new Error(
      `非法 DeliveryState 转移 ${from} → ${to}（EO-01 / C.15a）`,
    ) as Error & { code: string };
    err.code = "E_ILLEGAL_DELIVERY_TRANSITION";
    throw err;
  }
}

/** Demo 就绪事件 → 主干 DEMO_READY */
export function projectDemoReadyEvent(
  event: string,
): DeliveryState | null {
  if ((DEMO_READY_EVENTS as readonly string[]).includes(event)) {
    return "DEMO_READY";
  }
  return null;
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
  verifying?: boolean;
  rework_required?: boolean;
  escalated?: boolean;
}): DeliveryState | ActivityTransient {
  if (input.escalated) return "ESCALATED_HUMAN";
  if (input.activity_transient === "CONTRACT_SIGNING") {
    return "CONTRACT_SIGNING";
  }
  if (input.activity_transient === "DEMO_BUILDING") {
    return "DEMO_BUILDING";
  }
  if (input.activity_transient === "MERGING") {
    return "MERGING";
  }
  if (input.rework_required) return "REWORK_REQUIRED";
  if (input.verifying) return "VERIFYING";

  switch (input.lifecycle_state) {
    case "DRAFT":
      if (input.demo_confirmed) return "DEMO_READY";
      return "PLAN_DRAFTING";
    case "PENDING_APPROVAL":
      return "PLAN_CONFIRMED";
    case "PREPARING":
      return "CONTRACT_SIGNED";
    case "EXECUTING":
      return "IMPLEMENTING";
    case "PENDING_RESUME":
      return "PAUSED";
    case "VERIFYING":
      return "VERIFYING";
    case "AUDITED":
      return "CANDIDATE_VERIFIED";
    case "MERGED":
      return "MERGED";
    case "DELIVERED":
      return "DELIVERED";
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

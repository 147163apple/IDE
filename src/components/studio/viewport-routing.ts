import type { PresentationState } from "@/lib/state/presentation-state";

/**
 * Studio 视口标识（TASK-C.2 + TASK-S.6b 真机试玩）。
 * 顺序与顶栏 Tab 一致，便于测试与文案对照。
 */
export const STUDIO_VIEWPORT_IDS = [
  "demo",
  "graph",
  "dispute",
  "contract",
  "playtest",
] as const;

export type StudioViewportId = (typeof STUDIO_VIEWPORT_IDS)[number];

export const STUDIO_VIEWPORT_LABEL: Readonly<Record<StudioViewportId, string>> =
  {
    demo: "原型试玩",
    graph: "任务图谱",
    dispute: "质疑自查",
    contract: "合同审阅",
    playtest: "真机试玩",
  };

/**
 * 根据 Daemon 权威的 15 态展示状态，决定默认主视口。
 *
 * - DEMO_PREVIEW → 原型试玩
 * - EXECUTING 等 → 任务图谱
 * - DISPUTED_INSPECTING → 质疑自查
 * - REAL_PLAYTEST → 真机试玩（TASK-S.6b / 架构 §7.1）
 *
 * 前端**不**自行从 lifecycle × approval 推导——只消费 presentation_state。
 */
export function resolveDefaultViewport(
  presentationState: PresentationState | null | undefined,
): StudioViewportId {
  switch (presentationState) {
    case "DEMO_PREVIEW":
      return "demo";
    case "DISPUTED_INSPECTING":
      return "dispute";
    case "REAL_PLAYTEST":
      return "playtest";
    case "GRAPH_MAPPING":
    case "EXECUTING":
    case "STOPPING":
    case "PAUSED":
    case "VERIFYING":
    case "FAILED":
      return "graph";
    case "EXPLORING":
    case "NEEDS_APPROVAL":
    case "READY_TO_MERGE":
    case "CONFLICT":
    case "MERGED":
    case "ABORTED":
    case null:
    case undefined:
    default:
      return "contract";
  }
}

/**
 * 计算当前应展示的视口。
 *
 * - 展示态变化时：清除手动覆盖，回到该态默认视口（状态流转驱动切换）。
 * - 展示态未变时：若用户点过 Tab，保留手动选择。
 */
export function resolveActiveViewport(input: {
  presentationState: PresentationState | null | undefined;
  previousPresentationState: PresentationState | null | undefined;
  manualViewport: StudioViewportId | null;
}): { viewport: StudioViewportId; clearManual: boolean } {
  const auto = resolveDefaultViewport(input.presentationState);
  const stateChanged =
    input.presentationState !== input.previousPresentationState;

  if (stateChanged) {
    return { viewport: auto, clearManual: true };
  }
  if (input.manualViewport !== null) {
    return { viewport: input.manualViewport, clearManual: false };
  }
  return { viewport: auto, clearManual: false };
}

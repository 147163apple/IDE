import type { PresentationState } from "@/lib/state/presentation-state";

/**
 * Studio 视口（TASK-C.18：收敛为单页「方案审阅」）。
 *
 * 旧五 id 仍导出，供历史测试/旅程 suggest_viewport 映射到 scheme；
 * UI 外壳不再渲染多 Tab。
 */
export const STUDIO_VIEWPORT_IDS = ["scheme"] as const;

export type StudioViewportId =
  (typeof STUDIO_VIEWPORT_IDS)[number] | LegacyStudioViewportId;

/** @deprecated C.18 起 UI 不再切换；仅兼容旧调用 */
export type LegacyStudioViewportId =
  "demo" | "graph" | "dispute" | "contract" | "playtest";

export const STUDIO_VIEWPORT_LABEL: Readonly<Record<string, string>> = {
  scheme: "方案审阅",
  demo: "原型试玩",
  graph: "任务图谱",
  dispute: "质疑自查",
  contract: "合同审阅",
  playtest: "真机试玩",
};

/** C.18：任意展示态默认都落方案审阅单页 */
export function resolveDefaultViewport(
  _presentationState?: PresentationState | null | undefined,
): "scheme" {
  return "scheme";
}

export function resolveActiveViewport(input: {
  presentationState: PresentationState | null | undefined;
  previousPresentationState: PresentationState | null | undefined;
  manualViewport: StudioViewportId | null;
}): { viewport: "scheme"; clearManual: boolean } {
  void input;
  return { viewport: "scheme", clearManual: true };
}

/** 旧 suggest_viewport → 一律 scheme（单页） */
export function mapLegacyViewportToScheme(_legacy?: string | null): "scheme" {
  return "scheme";
}

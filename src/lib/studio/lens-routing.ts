/**
 * TASK-C.10q：Studio 中栏「全景 / 施工」双视角默认路由。
 *
 * - 无图 → 默认全景（进门看项目在干什么）
 * - 有图 → 默认施工（确认原型后的任务图谱）
 * 全景**禁止**展示施工绿灯（无 illumination 数据源）。
 */

export const STUDIO_LENS_IDS = ["panorama", "construction"] as const;

export type StudioLensId = (typeof STUDIO_LENS_IDS)[number];

export const STUDIO_LENS_LABEL: Readonly<Record<StudioLensId, string>> = {
  panorama: "全景",
  construction: "施工",
};

/**
 * 根据是否已有任务图决定默认视角。
 * 有图时偏向施工；无图时偏向全景。手动覆盖由外壳保留。
 */
export function resolveDefaultLens(input: { hasGraph: boolean }): StudioLensId {
  return input.hasGraph ? "construction" : "panorama";
}

/**
 * 图从无到有（例如刚确认原型）时强制切到施工，并清掉手动覆盖。
 */
export function resolveActiveLens(input: {
  hasGraph: boolean;
  previousHasGraph: boolean | null;
  manualLens: StudioLensId | null;
}): { lens: StudioLensId; clearManual: boolean } {
  const auto = resolveDefaultLens({ hasGraph: input.hasGraph });
  const gainedGraph =
    input.previousHasGraph === false && input.hasGraph === true;
  if (gainedGraph) {
    return { lens: "construction", clearManual: true };
  }
  if (input.manualLens !== null) {
    return { lens: input.manualLens, clearManual: false };
  }
  return { lens: auto, clearManual: false };
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  resolveActiveLens,
  STUDIO_LENS_IDS,
  STUDIO_LENS_LABEL,
  type StudioLensId,
} from "@/lib/studio/lens-routing";

/**
 * TASK-C.10q：Studio 中栏「全景 / 施工」双视角外壳。
 *
 * - 两视角始终挂载，非激活仅 hidden（与 StudioViewportShell 一致）；
 * - 无图默认全景；有图默认施工；刚建图（无→有）强制切施工；
 * - 全景侧不得接入点亮数据（由内容组件保证）。
 */
export interface StudioLensShellProps {
  hasGraph: boolean;
  panorama: ReactNode;
  construction: ReactNode;
  /** 受控：测试或外部门控 */
  activeLens?: StudioLensId | undefined;
  onLensChange?: ((lens: StudioLensId) => void) | undefined;
  /**
   * 外部轻推一次切换（如全景「去看施工」）。
   * 仅当 preferLensKey 变化时生效，避免卡住自动路由。
   */
  preferLens?: StudioLensId | undefined;
  preferLensKey?: number | undefined;
}

export function StudioLensShell(props: StudioLensShellProps) {
  const [manualLens, setManualLens] = useState<StudioLensId | null>(null);
  const previousHasGraph = useRef<boolean | null>(null);

  const resolved = resolveActiveLens({
    hasGraph: props.hasGraph,
    previousHasGraph: previousHasGraph.current,
    manualLens,
  });

  useEffect(() => {
    previousHasGraph.current = props.hasGraph;
  }, [props.hasGraph]);

  useEffect(() => {
    if (resolved.clearManual && manualLens !== null) {
      setManualLens(null);
    }
  }, [resolved.clearManual, manualLens]);

  const preferKey = props.preferLensKey;
  const preferLens = props.preferLens;
  useEffect(() => {
    if (preferKey === undefined || preferLens === undefined) return;
    setManualLens(preferLens);
    props.onLensChange?.(preferLens);
    // preferLensKey 是触发器；故意不把 preferLens/onLensChange 列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferKey]);

  const active: StudioLensId = props.activeLens ?? resolved.lens;

  const select = (id: StudioLensId) => {
    setManualLens(id);
    props.onLensChange?.(id);
  };

  const panes: Record<StudioLensId, ReactNode> = {
    panorama: props.panorama,
    construction: props.construction,
  };

  return (
    <div
      data-testid="studio-lens-shell"
      data-active-lens={active}
      data-has-graph={props.hasGraph ? "true" : "false"}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <div
        data-testid="studio-lens-tabs"
        role="tablist"
        aria-label="全景与施工"
        className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1"
      >
        {STUDIO_LENS_IDS.map((id) => {
          const selected = id === active;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`studio-lens-tab-${id}`}
              aria-selected={selected}
              data-testid={`studio-lens-tab-${id}`}
              data-active={selected ? "true" : "false"}
              onClick={() => select(id)}
              className={`rounded px-2.5 py-1 text-xs ${
                selected
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {STUDIO_LENS_LABEL[id]}
            </button>
          );
        })}
        <span
          data-testid="studio-lens-hint"
          className="ml-auto max-w-[60%] truncate text-[11px] text-muted-foreground"
        >
          {active === "panorama"
            ? "全景：看项目能干嘛（不含施工绿灯）"
            : "施工：本轮任务图谱，绿灯只认核销证据"}
        </span>
      </div>

      <div
        data-testid="studio-lens-content"
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {STUDIO_LENS_IDS.map((id) => {
          const selected = id === active;
          return (
            <div
              key={id}
              role="tabpanel"
              aria-labelledby={`studio-lens-tab-${id}`}
              data-testid={`studio-lens-panel-${id}`}
              data-active={selected ? "true" : "false"}
              hidden={!selected}
              className={
                selected
                  ? "absolute inset-0 flex min-h-0 flex-col overflow-auto"
                  : undefined
              }
            >
              {panes[id]}
            </div>
          );
        })}
      </div>
    </div>
  );
}

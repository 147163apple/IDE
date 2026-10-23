import { useEffect, useState, type ReactNode } from "react";
import type { PresentationState } from "@/lib/state/presentation-state";
import {
  resolveDefaultViewport,
  STUDIO_VIEWPORT_IDS,
  STUDIO_VIEWPORT_LABEL,
  type StudioViewportId,
} from "./viewport-routing";

/**
 * Studio 四视口外壳（TASK-C.2）。
 *
 * - 顶栏手动切换四个视口；
 * - 消费 Daemon 的 `presentation_state`：状态一变就回到该态默认视口；
 * - **四个面板始终挂载**，非激活仅 `hidden`——表单填写与 Graph 点亮不会因切换丢失。
 */
export interface StudioViewportShellProps {
  presentationState?: PresentationState | null | undefined;
  /** Daemon STATE_CHANGED 带来的白话提示；缺省不显示 */
  presentationMessage?: string | null | undefined;
  /** 受控：外部指定当前视口（测试或外部门控时用） */
  activeViewport?: StudioViewportId | undefined;
  onViewportChange?: ((viewport: StudioViewportId) => void) | undefined;
  demo: ReactNode;
  graph: ReactNode;
  dispute: ReactNode;
  contract: ReactNode;
}

export function StudioViewportShell(props: StudioViewportShellProps) {
  const presentationState = props.presentationState ?? null;
  const autoViewport = resolveDefaultViewport(presentationState);
  const [manualViewport, setManualViewport] = useState<StudioViewportId | null>(
    null,
  );

  // 展示态流转 → 清掉手动覆盖，回到该态默认视口（任务卡「状态自适应」）
  useEffect(() => {
    setManualViewport(null);
  }, [presentationState]);

  const active: StudioViewportId =
    props.activeViewport ?? manualViewport ?? autoViewport;

  const select = (id: StudioViewportId) => {
    setManualViewport(id);
    props.onViewportChange?.(id);
  };

  const panes: Record<StudioViewportId, ReactNode> = {
    demo: props.demo,
    graph: props.graph,
    dispute: props.dispute,
    contract: props.contract,
  };

  return (
    <div
      data-testid="studio-viewport-shell"
      data-active-viewport={active}
      data-presentation-state={presentationState ?? ""}
      className="flex h-full min-h-0 flex-col"
    >
      <div
        data-testid="studio-viewport-tabs"
        role="tablist"
        aria-label="Studio 视口"
        className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1"
      >
        {STUDIO_VIEWPORT_IDS.map((id) => {
          const selected = id === active;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`studio-tab-${id}`}
              aria-selected={selected}
              data-testid={`studio-viewport-tab-${id}`}
              data-active={selected ? "true" : "false"}
              onClick={() => select(id)}
              className={`rounded px-2 py-1 text-xs ${
                selected
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {STUDIO_VIEWPORT_LABEL[id]}
            </button>
          );
        })}
        {props.presentationMessage ? (
          <span
            data-testid="studio-presentation-message"
            className="ml-auto max-w-[50%] truncate text-[11px] text-muted-foreground"
            title={props.presentationMessage}
          >
            {props.presentationMessage}
          </span>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1">
        {STUDIO_VIEWPORT_IDS.map((id) => {
          const selected = id === active;
          return (
            <div
              key={id}
              role="tabpanel"
              aria-labelledby={`studio-tab-${id}`}
              data-testid={`studio-viewport-panel-${id}`}
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

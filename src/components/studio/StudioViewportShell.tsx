import { useEffect, useState, type ReactNode } from "react";
import type { PresentationState } from "@/lib/state/presentation-state";
import { traceViewportChange } from "@/lib/ui-trace";
import {
  resolveDefaultViewport,
  STUDIO_VIEWPORT_IDS,
  STUDIO_VIEWPORT_LABEL,
  type StudioViewportId,
} from "./viewport-routing";

/**
 * Studio 视口外壳（TASK-C.2 + S.6b 真机试玩 + C.16 单门列表栏）。
 *
 * - 顶栏手动切换视口；
 * - 消费 Daemon 的 `presentation_state`：状态一变就回到该态默认视口；
 * - **全部面板始终挂载**，非激活仅 `hidden`——表单填写与 Graph 点亮不会因切换丢失；
 * - C.16：可选左侧「选合同」栏（需求列表 + 规范与资产），不再另开 ActivityBar 门。
 */
export interface StudioViewportShellProps {
  presentationState?: PresentationState | null | undefined;
  /** Daemon STATE_CHANGED 带来的白话提示；缺省不显示 */
  presentationMessage?: string | null | undefined;
  /** 受控：外部指定当前视口（测试或外部门控时用） */
  activeViewport?: StudioViewportId | undefined;
  onViewportChange?: ((viewport: StudioViewportId) => void) | undefined;
  /** C.16：合同操作台左侧「选合同 / 规范与资产」 */
  contractRail?: ReactNode | undefined;
  demo: ReactNode;
  graph: ReactNode;
  dispute: ReactNode;
  contract: ReactNode;
  /** TASK-S.6b：真机试玩视口 */
  playtest: ReactNode;
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
    traceViewportChange(id);
  };

  const panes: Record<StudioViewportId, ReactNode> = {
    demo: props.demo,
    graph: props.graph,
    dispute: props.dispute,
    contract: props.contract,
    playtest: props.playtest,
  };

  const main = (
    <div
      data-testid="studio-viewport-shell"
      data-active-viewport={active}
      data-presentation-state={presentationState ?? ""}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <div
        data-testid="studio-viewport-tabs"
        role="tablist"
        aria-label="Studio 视口"
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1"
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

      <div
        data-testid="studio-viewport-content"
        className="relative min-h-0 flex-1 overflow-hidden"
      >
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

  if (!props.contractRail) {
    return main;
  }

  return (
    <div
      data-testid="studio-with-rail"
      className="flex h-full min-h-0 flex-1"
    >
      <aside
        data-testid="studio-contract-rail"
        className="flex w-56 shrink-0 flex-col overflow-auto border-r border-border bg-muted/20"
      >
        {props.contractRail}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</div>
    </div>
  );
}

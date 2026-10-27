import type { ReactNode } from "react";
import type { PresentationState } from "@/lib/state/presentation-state";

/**
 * Studio 工作台外壳（TASK-C.18：单页方案审阅）。
 *
 * - 去掉五视口 Tab（原型试玩 / 任务图谱 / 质疑自查 / 合同审阅 / 真机试玩）
 * - 中间只挂一个主工作页（方案审阅）
 * - 可选左侧「选合同 / 规范与资产」栏（C.16 保留）
 *
 * 旧五视口组件文件仍留在仓库（兼容单测/回溯），日常入口不再挂载。
 */
export interface StudioViewportShellProps {
  presentationState?: PresentationState | null | undefined;
  presentationMessage?: string | null | undefined;
  /** @deprecated C.18 单页后忽略；保留 prop 避免旧调用方崩 */
  activeViewport?: string | undefined;
  /** @deprecated C.18 */
  onViewportChange?: ((viewport: string) => void) | undefined;
  contractRail?: ReactNode | undefined;
  /**
   * C.18：唯一主内容。优先使用；未传时回退拼旧五插槽（兼容过渡测试）。
   */
  scheme?: ReactNode | undefined;
  /** @deprecated C.18 日常不再展示；仅 fallback */
  demo?: ReactNode | undefined;
  graph?: ReactNode | undefined;
  dispute?: ReactNode | undefined;
  contract?: ReactNode | undefined;
  playtest?: ReactNode | undefined;
}

export function StudioViewportShell(props: StudioViewportShellProps) {
  const presentationState = props.presentationState ?? null;
  const mainContent = props.scheme ?? props.contract ?? props.demo ?? (
    <div className="p-4 text-xs text-muted-foreground">暂无方案内容</div>
  );

  const main = (
    <div
      data-testid="studio-viewport-shell"
      data-single-pane="true"
      data-active-viewport="scheme"
      data-presentation-state={presentationState ?? ""}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <div
        data-testid="studio-viewport-header"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5"
      >
        <span className="text-xs font-medium text-foreground">方案审阅</span>
        {props.presentationMessage ? (
          <span
            data-testid="studio-presentation-message"
            className="ml-auto max-w-[60%] truncate text-[11px] text-muted-foreground"
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
        <div
          role="region"
          aria-label="方案审阅"
          data-testid="studio-viewport-panel-scheme"
          data-active="true"
          className="absolute inset-0 flex min-h-0 flex-col overflow-auto"
        >
          {mainContent}
        </div>
      </div>
    </div>
  );

  if (!props.contractRail) {
    return main;
  }

  return (
    <div data-testid="studio-with-rail" className="flex h-full min-h-0 flex-1">
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

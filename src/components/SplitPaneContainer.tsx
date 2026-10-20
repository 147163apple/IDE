import type { ReactNode } from "react";

export interface SplitPaneContainerProps {
  left: ReactNode;
  right?: ReactNode;
}

/** TASK-C.1 中栏分屏：左代码/Diff，右 Supervisor Studio；right 为空时单栏 */
export function SplitPaneContainer({ left, right }: SplitPaneContainerProps) {
  return (
    <div data-testid="split-pane" className="flex h-full min-h-0">
      <section
        data-testid="split-left"
        className="min-w-0 flex-1 overflow-auto"
      >
        {left}
      </section>
      {right && (
        <section
          data-testid="split-right"
          className="min-w-0 flex-1 overflow-auto border-l"
        >
          {right}
        </section>
      )}
    </div>
  );
}

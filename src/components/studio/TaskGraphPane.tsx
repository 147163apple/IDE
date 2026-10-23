import { TaskGraphPanel } from "@/components/graph/TaskGraphPanel";
import type { TaskGraph } from "@/lib/graph/task-graph";

/**
 * Studio 视口 2：Task Graph 拓扑看板（TASK-C.2 胶水层）。
 *
 * 不重写点亮逻辑——直接挂载 C.7 的 `TaskGraphPanel`。
 * 外壳用 CSS 隐藏而非卸载，点亮动效与视图选择在切走再切回时仍在。
 */
export interface TaskGraphPaneProps {
  graph: TaskGraph | null;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRefresh?: (() => void) | undefined;
}

export function TaskGraphPane(props: TaskGraphPaneProps) {
  return (
    <div data-testid="task-graph-pane" className="flex h-full min-h-0 flex-col">
      <TaskGraphPanel
        graph={props.graph}
        {...(props.loading === undefined ? {} : { loading: props.loading })}
        {...(props.error === undefined ? {} : { error: props.error })}
        {...(props.onRefresh === undefined
          ? {}
          : { onRefresh: props.onRefresh })}
      />
    </div>
  );
}

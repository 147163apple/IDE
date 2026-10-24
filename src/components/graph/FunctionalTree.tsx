import type { TaskGraph } from "@/lib/graph/task-graph";
import { layoutFunctionalTree, visualForState } from "./graph-view-model";

/**
 * 上层视图：本轮施工·功能汇总（非进门全仓脑图；全景见 C.10q）。
 *
 * 非技术用户先看这一层——"邮箱验证码登录"亮没亮，而不是先去读 DAG。
 * 每个功能的状态由 Daemon 图中的工程节点**汇总派生**（一对多映射），
 * 前端不重新计算单个节点状态。
 */
export interface FunctionalTreeProps {
  graph: TaskGraph;
  selectedAreaId?: string | null;
  onSelectArea?: (areaId: string) => void;
}

export function FunctionalTree({
  graph,
  selectedAreaId,
  onSelectArea,
}: FunctionalTreeProps) {
  const rows = layoutFunctionalTree(graph);

  return (
    <div data-testid="functional-tree" className="p-3">
      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
        本轮施工·功能汇总：每个功能汇总其下所有工程节点的真实状态，点亮只认物理证据。
      </p>
      <ul className="space-y-1">
        {rows.map((row) => {
          const visual = visualForState(row.state);
          const percent =
            row.total === 0
              ? 0
              : Math.round((row.illuminated / row.total) * 100);
          const selected = selectedAreaId === row.area.id;
          return (
            <li
              key={row.area.id}
              style={{ paddingLeft: row.depth * 18 }}
              className={
                row.depth > 0 ? "border-l border-border/60" : undefined
              }
            >
              <button
                type="button"
                data-testid={`functional-node-${row.area.id}`}
                data-state={row.state}
                data-tone={visual.tone}
                aria-pressed={selected}
                onClick={() => onSelectArea?.(row.area.id)}
                className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors duration-100 ${
                  selected
                    ? "border-primary bg-accent"
                    : "border-transparent hover:bg-accent/60"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${visual.dot}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {row.area.title}
                  </span>
                  {row.area.description ? (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {row.area.description}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${visual.badge}`}
                >
                  {visual.label}
                </span>
                <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                  {row.illuminated}/{row.total}
                </span>
                <span
                  aria-hidden
                  data-testid={`functional-progress-${row.area.id}`}
                  className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className="block h-full rounded-full bg-emerald-500 transition-[width] duration-100"
                    style={{ width: `${percent}%` }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          这份图还没有业务功能节点。
        </p>
      ) : null}
    </div>
  );
}

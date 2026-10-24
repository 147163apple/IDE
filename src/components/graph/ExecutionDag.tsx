import { useId, useMemo } from "react";
import { collectAreaIds, type TaskGraph } from "@/lib/graph/task-graph";
import {
  ILLUMINATION_TRANSITION_MS,
  issueForNode,
  layoutDag,
  visualForNode,
  visualForState,
} from "./graph-view-model";

/**
 * 下层视图：任务执行 DAG。
 *
 * 布局用"依赖深度分层 + 同层输入序"的确定性算法（见 graph-view-model），
 * 不用力导向：同一份图每次打开都在同一位置，用户才能记住"哪个节点在哪"。
 *
 * 点亮动效：新点亮节点带 `data-illuminating="true"` 与 100ms 的
 * 背景/边框/阴影过渡；CSS 关键帧见 src/styles.css。
 */
export interface ExecutionDagProps {
  graph: TaskGraph;
  /** 本次帧中新点亮的节点 id（由 TaskGraphPanel 做前后快照差分得出） */
  illuminatingIds?: ReadonlySet<string>;
  selectedAreaId?: string | null;
  /** C.10n：当前选中节点，用于高亮 */
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
}

export function ExecutionDag({
  graph,
  illuminatingIds,
  selectedAreaId,
  selectedNodeId = null,
  onSelectNode,
}: ExecutionDagProps) {
  const layout = useMemo(() => layoutDag(graph), [graph]);
  const markerId = `dag-arrow-${useId().replace(/[:]/g, "")}`;

  const selectedAreas = useMemo(() => {
    if (!selectedAreaId) return null;
    try {
      return new Set(collectAreaIds(graph.functional_tree, selectedAreaId));
    } catch {
      return null;
    }
  }, [graph.functional_tree, selectedAreaId]);

  return (
    <div className="overflow-auto p-3" data-testid="execution-dag-scroll">
      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
        任务执行拓扑：节点按依赖分层，绿色只代表"写入 + 退出码 0 + SHA
        指纹"三证齐备。
      </p>
      <div
        data-testid="execution-dag"
        data-transition-ms={ILLUMINATION_TRANSITION_MS}
        className="relative"
        style={{ width: layout.width, height: layout.height }}
      >
        <svg
          className="pointer-events-none absolute inset-0"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
            </marker>
          </defs>
          {layout.edges.map((edge) => {
            const target = graph.nodes.find((node) => node.node_id === edge.to);
            const stroke =
              target?.state === "ILLUMINATED" ? "#10b981" : "#cbd5e1";
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                data-testid={`dag-edge-${edge.from}-${edge.to}`}
                d={edge.path}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                markerEnd={`url(#${markerId})`}
                style={{
                  transition: `stroke ${ILLUMINATION_TRANSITION_MS}ms ease-out`,
                }}
              />
            );
          })}
        </svg>

        {layout.nodes.map((item) => {
          const { node } = item;
          const issue = issueForNode(graph, node.node_id);
          const visual = visualForNode(node, issue);
          const illuminating = illuminatingIds?.has(node.node_id) === true;
          const selected = selectedNodeId === node.node_id;
          const dimmed =
            selectedAreas !== null && !selectedAreas.has(node.functional_area);
          return (
            <button
              type="button"
              key={node.node_id}
              data-testid={`dag-node-${node.node_id}`}
              data-state={node.state}
              data-tone={visual.tone}
              data-illuminating={illuminating ? "true" : "false"}
              data-selected={selected ? "true" : "false"}
              aria-pressed={selected}
              aria-label={`${node.title} · ${visual.label}`}
              title={issue ? `${issue.code}: ${issue.message}` : node.title}
              onClick={() => onSelectNode?.(node.node_id)}
              className={`absolute flex flex-col items-start justify-center gap-0.5 overflow-hidden rounded-md border px-2 text-left shadow-sm ${
                visual.surface
              } ${visual.animation === "pulse" ? "animate-pulse" : ""} ${
                visual.animation === "blink" ? "animate-pulse" : ""
              } ${illuminating ? "dag-illuminate" : ""} ${
                selected ? "ring-2 ring-sky-400 border-sky-500 z-10" : ""
              }`}
              style={{
                left: item.x,
                top: item.y,
                width: item.width,
                height: item.height,
                opacity: dimmed ? 0.3 : 1,
                transition: `background-color ${ILLUMINATION_TRANSITION_MS}ms ease-out, border-color ${ILLUMINATION_TRANSITION_MS}ms ease-out, box-shadow ${ILLUMINATION_TRANSITION_MS}ms ease-out, opacity ${ILLUMINATION_TRANSITION_MS}ms ease-out`,
              }}
            >
              <span className="w-full truncate text-[11px] font-semibold">
                {node.title}
              </span>
              <span className="flex w-full items-center gap-1 truncate text-[10px]">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${visual.dot}`}
                />
                <span className="truncate">{visual.label}</span>
                {visual.tone === "stale" ? (
                  <span aria-hidden className="shrink-0">
                    ↻
                  </span>
                ) : null}
                {visual.tone === "blocked" ? (
                  <span aria-hidden className="shrink-0">
                    🔒
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {graph.nodes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          这份图还没有执行节点。
        </p>
      ) : (
        <ul
          data-testid="dag-legend"
          className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground"
        >
          {(
            [
              "PENDING",
              "RUNNING",
              "REPAIRING",
              "ILLUMINATED",
              "FAILED",
              "BLOCKED",
              "STALE_REVERIFY",
            ] as const
          ).map((state) => {
            const visual = visualForState(state);
            return (
              <li key={state} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${visual.dot}`}
                />
                {visual.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

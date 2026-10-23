import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskGraph } from "@/lib/graph/task-graph";
import { TASK_NODE_STATE_LABEL } from "@/lib/graph/task-graph";
import { ExecutionDag } from "./ExecutionDag";
import { FunctionalTree } from "./FunctionalTree";
import {
  ILLUMINATION_TRANSITION_MS,
  issueForNode,
  newlyIlluminatedNodeIds,
  stateCounts,
  visualForNode,
} from "./graph-view-model";

/**
 * Task Graph 双视图面板（TASK-C.7）。
 *
 * 数据边界：本组件**不取数**。权威快照由主页面通过 `graph` 注入
 * （首屏 GET + `TASK_GRAPH_UPDATED` 帧覆盖），这里只做两件事：
 * 1. 视图映射（业务功能树 / 执行 DAG）；
 * 2. 前后快照差分，给新点亮节点加 100ms 翠绿过渡。
 *
 * 这样组件既能在页面里消费真实帧，也能在 jsdom 测试里用两份快照
 * 直接验证动效，不需要伪造 WebSocket。
 */
export interface TaskGraphPanelProps {
  graph: TaskGraph | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: (() => void) | undefined;
}

type GraphView = "functional" | "dag";

export function TaskGraphPanel({
  graph,
  loading = false,
  error,
  onRefresh,
}: TaskGraphPanelProps) {
  const [view, setView] = useState<GraphView>("functional");
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [illuminating, setIlluminating] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const previousGraph = useRef<TaskGraph | null>(null);

  useEffect(() => {
    if (!graph) {
      previousGraph.current = null;
      setIlluminating((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const fresh = newlyIlluminatedNodeIds(previousGraph.current, graph);
    previousGraph.current = graph;
    if (fresh.length === 0) {
      setIlluminating((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    setIlluminating(new Set(fresh));
    const timer = setTimeout(() => {
      setIlluminating(new Set());
    }, ILLUMINATION_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [graph]);

  const selectedNode = useMemo(
    () => graph?.nodes.find((node) => node.node_id === selectedNodeId) ?? null,
    [graph, selectedNodeId],
  );

  const counts = graph ? stateCounts(graph) : [];

  return (
    <div data-testid="task-graph-panel" className="flex min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">任务图谱</h2>
        {graph ? (
          <>
            <span
              data-testid="graph-progress-label"
              className="text-xs text-muted-foreground"
            >
              {graph.progress.illuminated}/{graph.progress.total} 已点亮
            </span>
            <span
              role="progressbar"
              aria-label="点亮进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={graph.progress.percent}
              data-testid="graph-progress"
              className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full bg-emerald-500 transition-[width] duration-100"
                style={{ width: `${graph.progress.percent}%` }}
              />
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {graph.progress.percent}%
            </span>
            <span
              data-testid="graph-revision"
              className="text-[10px] text-muted-foreground"
            >
              rev {graph.revision} · {graph.updated_at}
            </span>
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            data-testid="graph-view-functional"
            aria-pressed={view === "functional"}
            onClick={() => setView("functional")}
            className={`rounded border px-2 py-0.5 text-xs ${
              view === "functional"
                ? "bg-accent font-medium"
                : "hover:bg-accent/60"
            }`}
          >
            业务功能导图
          </button>
          <button
            type="button"
            data-testid="graph-view-dag"
            aria-pressed={view === "dag"}
            onClick={() => setView("dag")}
            className={`rounded border px-2 py-0.5 text-xs ${
              view === "dag" ? "bg-accent font-medium" : "hover:bg-accent/60"
            }`}
          >
            执行拓扑
          </button>
          {onRefresh ? (
            <button
              type="button"
              data-testid="graph-refresh"
              onClick={onRefresh}
              className="rounded border px-2 py-0.5 text-xs hover:bg-accent/60"
            >
              刷新
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div
          data-testid="graph-error"
          role="alert"
          className="border-b border-amber-400/50 bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
        >
          {error}
        </div>
      ) : null}

      {counts.length > 0 ? (
        <ul
          data-testid="graph-state-counts"
          className="flex flex-wrap gap-1.5 border-b px-3 py-1.5 text-[10px]"
        >
          {counts.map(({ state, count, visual }) => (
            <li
              key={state}
              data-testid={`graph-count-${state}`}
              className={`rounded px-1.5 py-0.5 ${visual.badge}`}
            >
              {TASK_NODE_STATE_LABEL[state]} {count}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {graph === null ? (
          <div
            data-testid="graph-empty"
            className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground"
          >
            <p className="text-sm font-medium text-foreground">
              {loading ? "正在读取任务图谱…" : "尚未生成任务图谱"}
            </p>
            <p className="max-w-md leading-relaxed">
              {loading
                ? "等待 Daemon 返回权威快照。"
                : "合同进入执行阶段后，Daemon 会把 Supervisor 提案解构成「业务功能树 + 执行 DAG」。点亮只认三件物理证据：受控写入、退出码 0、Commit SHA 指纹。"}
            </p>
          </div>
        ) : view === "functional" ? (
          <FunctionalTree
            graph={graph}
            selectedAreaId={selectedAreaId}
            onSelectArea={(areaId) => {
              setSelectedAreaId((current) =>
                current === areaId ? null : areaId,
              );
              setView("dag");
            }}
          />
        ) : (
          <>
            <ExecutionDag
              graph={graph}
              illuminatingIds={illuminating}
              selectedAreaId={selectedAreaId}
              onSelectNode={(nodeId) =>
                setSelectedNodeId((current) =>
                  current === nodeId ? null : nodeId,
                )
              }
            />
            {selectedNode ? (
              <NodeDetail graph={graph} nodeId={selectedNode.node_id} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function NodeDetail({ graph, nodeId }: { graph: TaskGraph; nodeId: string }) {
  const node = graph.nodes.find((item) => item.node_id === nodeId);
  if (!node) return null;
  const issue = issueForNode(graph, nodeId);
  const visual = visualForNode(node, issue);
  return (
    <section
      data-testid="graph-node-detail"
      className="m-3 space-y-1 rounded border p-2 text-xs"
    >
      <header className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${visual.dot}`} aria-hidden />
        <span className="font-semibold">{node.title}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${visual.badge}`}>
          {visual.label}
        </span>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-muted-foreground">类型</dt>
        <dd>{node.kind}</dd>
        <dt className="text-muted-foreground">验证模式</dt>
        <dd>{node.verification_mode}</dd>
        <dt className="text-muted-foreground">验证命令</dt>
        <dd>
          {node.verification_commands.length === 0
            ? "（空：COMMAND 节点禁止点亮）"
            : node.verification_commands.join(" · ")}
        </dd>
        <dt className="text-muted-foreground">目标文件</dt>
        <dd>
          {node.target_files.length === 0
            ? "（无）"
            : node.target_files.join(", ")}
        </dd>
        <dt className="text-muted-foreground">Commit SHA</dt>
        <dd className="font-mono">{node.commit_sha ?? "（未点亮，无 SHA）"}</dd>
        <dt className="text-muted-foreground">执行时刻</dt>
        <dd>{node.executed_at ?? "（未执行）"}</dd>
      </dl>
      {issue ? (
        <p
          data-testid="graph-node-issue"
          className="rounded bg-stone-100 px-2 py-1 text-[11px] text-stone-700"
        >
          <span className="font-mono font-semibold">{issue.code}</span>{" "}
          {issue.message}
        </p>
      ) : null}
    </section>
  );
}

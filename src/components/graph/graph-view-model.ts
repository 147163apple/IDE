import {
  collectAreaIds,
  deriveFunctionalState,
  topologicalOrder,
  TASK_NODE_STATE_LABEL,
  type FunctionalTreeNode,
  type TaskGraph,
  type TaskGraphIssue,
  type TaskGraphUpdatedPayload,
  type TaskNode,
  type TaskNodeState,
} from "@/lib/graph/task-graph";

/**
 * 图谱视图模型（纯函数，零副作用）。
 *
 * UI 只做两件事：把七态映射成视觉、把拓扑映射成坐标。
 * 任何"这个节点大概算亮了吧"的判断都不在这里——状态来自 Daemon 快照。
 */

/**
 * 视觉色调。注意 `warning` 不是第八个节点状态：
 * 它是 FAILED 在"空验证集"这一特定原因下的视觉变体（警告灰）。
 * 规范要求此类节点 FAILED + `E_EMPTY_VERIFICATION_BLOCKED`，
 * 但把"规格写错了"画成"代码跑挂了"的红闪会误导用户去改代码。
 */
export type GraphTone =
  | "pending"
  | "running"
  | "repairing"
  | "illuminated"
  | "failed"
  | "blocked"
  | "stale"
  | "warning";

export interface NodeVisual {
  tone: GraphTone;
  label: string;
  /** 节点容器 class（HTML 视图） */
  surface: string;
  /** 状态圆点 class */
  dot: string;
  /** 徽标 class */
  badge: string;
  /** SVG/hover 用的主色 */
  accent: string;
  /** 是否呼吸/闪烁（CSS 动画名，none 表示静止） */
  animation: "none" | "pulse" | "blink" | "refresh";
}

const TONE_SURFACE: Record<GraphTone, NodeVisual> = {
  pending: {
    tone: "pending",
    label: TASK_NODE_STATE_LABEL.PENDING,
    surface: "border-slate-300 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
    badge: "bg-slate-200 text-slate-700",
    accent: "#94a3b8",
    animation: "none",
  },
  running: {
    tone: "running",
    label: TASK_NODE_STATE_LABEL.RUNNING,
    surface: "border-teal-400 bg-teal-50 text-teal-800",
    dot: "bg-teal-500",
    badge: "bg-teal-100 text-teal-800",
    accent: "#14b8a6",
    animation: "pulse",
  },
  repairing: {
    tone: "repairing",
    label: TASK_NODE_STATE_LABEL.REPAIRING,
    surface: "border-amber-400 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-800",
    accent: "#f59e0b",
    animation: "pulse",
  },
  illuminated: {
    tone: "illuminated",
    label: TASK_NODE_STATE_LABEL.ILLUMINATED,
    surface: "border-emerald-500 bg-emerald-50 text-emerald-900",
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-800",
    accent: "#10b981",
    animation: "none",
  },
  failed: {
    tone: "failed",
    label: TASK_NODE_STATE_LABEL.FAILED,
    surface: "border-red-400 bg-red-50 text-red-800",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-800",
    accent: "#ef4444",
    animation: "blink",
  },
  blocked: {
    tone: "blocked",
    label: TASK_NODE_STATE_LABEL.BLOCKED,
    surface: "border-slate-300 bg-slate-100 text-slate-500",
    dot: "bg-slate-400",
    badge: "bg-slate-200 text-slate-600",
    accent: "#cbd5e1",
    animation: "none",
  },
  // §3.2.1 规定 STALE_REVERIFY 为琥珀黄；用户诉求是"由绿变灰"。
  // 取"去饱和灰底 + 琥珀描边 + 刷新图标"：既不误报成绿，也不与
  // FAILED 的红闪混淆，语义仍是"证据过期"。
  stale: {
    tone: "stale",
    label: TASK_NODE_STATE_LABEL.STALE_REVERIFY,
    surface: "border-amber-300 bg-stone-100 text-stone-600",
    dot: "bg-amber-400",
    badge: "bg-amber-100 text-amber-800",
    accent: "#d6b26a",
    animation: "refresh",
  },
  // 空验证集的"警告灰"：FAILED 状态 + WARNING 问题码的专用视觉
  warning: {
    tone: "warning",
    label: "警告：验证集为空，已阻止点亮",
    surface: "border-stone-400 bg-stone-100 text-stone-700",
    dot: "bg-stone-500",
    badge: "bg-stone-200 text-stone-700",
    accent: "#78716c",
    animation: "none",
  },
};

/** 空验证集问题码：与 daemon/graph/illumination-verifier.ts 保持一致 */
export const E_EMPTY_VERIFICATION_BLOCKED = "E_EMPTY_VERIFICATION_BLOCKED";

export function issueForNode(
  graph: Pick<TaskGraph, "issues">,
  nodeId: string,
): TaskGraphIssue | undefined {
  // 同一节点可能有多条历史问题；最新的那条决定视觉提示
  return [...graph.issues].reverse().find((issue) => issue.node_id === nodeId);
}

export function visualForNode(
  node: TaskNode,
  issue?: TaskGraphIssue | undefined,
): NodeVisual {
  if (node.state === "FAILED" && issue?.code === E_EMPTY_VERIFICATION_BLOCKED) {
    return TONE_SURFACE.warning;
  }
  return TONE_SURFACE[STATE_TO_TONE[node.state]];
}

export function visualForState(state: TaskNodeState): NodeVisual {
  return TONE_SURFACE[STATE_TO_TONE[state]];
}

/** 七态 → 色调键（两者命名不同：状态是大写下划线，色调是短横线风格） */
const STATE_TO_TONE: Record<TaskNodeState, GraphTone> = {
  PENDING: "pending",
  RUNNING: "running",
  REPAIRING: "repairing",
  ILLUMINATED: "illuminated",
  FAILED: "failed",
  BLOCKED: "blocked",
  STALE_REVERIFY: "stale",
};

// ---------------------------------------------------------------------------
// 执行拓扑布局（分层 DAG）
// ---------------------------------------------------------------------------

export const DAG_NODE_WIDTH = 168;
export const DAG_NODE_HEIGHT = 64;
export const DAG_H_GAP = 64;
export const DAG_V_GAP = 26;
export const DAG_PADDING = 24;

export interface DagNodeLayout {
  node: TaskNode;
  depth: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DagEdgeLayout {
  from: string;
  to: string;
  path: string;
}

export interface DagLayout {
  nodes: DagNodeLayout[];
  edges: DagEdgeLayout[];
  width: number;
  height: number;
}

/**
 * 按依赖深度分层：根节点在左，依赖越深越靠右。
 * 拓扑排序失败（环/悬空依赖）时不抛给 React——降级为输入顺序单列布局，
 * 页面上仍能看到节点，具体错误由 Daemon 与诊断面板负责喊。
 */
export function layoutDag(graph: Pick<TaskGraph, "nodes">): DagLayout {
  let order: string[];
  try {
    order = topologicalOrder(graph.nodes);
  } catch {
    order = graph.nodes.map((node) => node.node_id);
  }
  const byId = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const depth = new Map<string, number>();

  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const parents = node.depends_on
      .map((dep) => depth.get(dep) ?? 0)
      .filter((value) => Number.isFinite(value));
    depth.set(id, parents.length === 0 ? 0 : Math.max(...parents) + 1);
  }

  const columns = new Map<number, TaskNode[]>();
  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const d = depth.get(id) ?? 0;
    const list = columns.get(d) ?? [];
    list.push(node);
    columns.set(d, list);
  }

  const nodes: DagNodeLayout[] = [];
  const position = new Map<string, DagNodeLayout>();
  for (const [d, list] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((node, row) => {
      const layout: DagNodeLayout = {
        node,
        depth: d,
        row,
        x: DAG_PADDING + d * (DAG_NODE_WIDTH + DAG_H_GAP),
        y: DAG_PADDING + row * (DAG_NODE_HEIGHT + DAG_V_GAP),
        width: DAG_NODE_WIDTH,
        height: DAG_NODE_HEIGHT,
      };
      nodes.push(layout);
      position.set(node.node_id, layout);
    });
  }

  const edges: DagEdgeLayout[] = [];
  for (const node of graph.nodes) {
    for (const dep of node.depends_on) {
      const from = position.get(dep);
      const to = position.get(node.node_id);
      if (!from || !to) continue;
      const x1 = from.x + from.width;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const mid = (x1 + x2) / 2;
      edges.push({
        from: dep,
        to: node.node_id,
        path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
      });
    }
  }

  const maxDepth = Math.max(0, ...nodes.map((item) => item.depth));
  const maxRows = Math.max(
    1,
    ...[...columns.values()].map((list) => list.length),
  );
  return {
    nodes,
    edges,
    width:
      DAG_PADDING * 2 + (maxDepth + 1) * DAG_NODE_WIDTH + maxDepth * DAG_H_GAP,
    height:
      DAG_PADDING * 2 + maxRows * DAG_NODE_HEIGHT + (maxRows - 1) * DAG_V_GAP,
  };
}

// ---------------------------------------------------------------------------
// 业务功能树
// ---------------------------------------------------------------------------

export interface FunctionalRow {
  area: FunctionalTreeNode;
  depth: number;
  state: TaskNodeState;
  total: number;
  illuminated: number;
}

export function layoutFunctionalTree(
  graph: Pick<TaskGraph, "functional_tree" | "nodes">,
): FunctionalRow[] {
  const rows: FunctionalRow[] = [];
  const children = new Map<string | null, FunctionalTreeNode[]>();
  for (const area of graph.functional_tree) {
    const list = children.get(area.parent_id) ?? [];
    list.push(area);
    children.set(area.parent_id, list);
  }

  const walk = (parentId: string | null, depth: number) => {
    for (const area of children.get(parentId) ?? []) {
      const areaIds = new Set(collectAreaIds(graph.functional_tree, area.id));
      const nodes = graph.nodes.filter((node) =>
        areaIds.has(node.functional_area),
      );
      rows.push({
        area,
        depth,
        state: safeDeriveState(graph, area.id),
        total: nodes.length,
        illuminated: nodes.filter((node) => node.state === "ILLUMINATED")
          .length,
      });
      walk(area.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function safeDeriveState(
  graph: Pick<TaskGraph, "functional_tree" | "nodes">,
  areaId: string,
): TaskNodeState {
  try {
    return deriveFunctionalState(graph, areaId);
  } catch {
    return "PENDING";
  }
}

// ---------------------------------------------------------------------------
// 帧合并与动效判定
// ---------------------------------------------------------------------------

/**
 * 应用 `TASK_GRAPH_UPDATED` 帧。
 *
 * 只接受同一合同、且 `revision` 不比本地旧的快照。WebSocket 在重连时可能
 * 先补发旧帧，若无条件覆盖，用户会看到进度条"倒退"。
 */
export function applyTaskGraphFrame(
  current: TaskGraph | null,
  payload: TaskGraphUpdatedPayload,
): TaskGraph {
  if (
    current &&
    current.contract_id === payload.contract_id &&
    payload.revision < current.revision
  ) {
    return current;
  }
  return payload.graph;
}

/** 本次快照中新点亮的节点（用于 ≤100ms 翠绿过渡） */
export function newlyIlluminatedNodeIds(
  previous: Pick<TaskGraph, "nodes"> | null,
  next: Pick<TaskGraph, "nodes">,
): string[] {
  if (!previous) return [];
  const before = new Map(
    previous.nodes.map((node) => [node.node_id, node.state]),
  );
  return next.nodes
    .filter(
      (node) =>
        node.state === "ILLUMINATED" &&
        before.get(node.node_id) !== undefined &&
        before.get(node.node_id) !== "ILLUMINATED",
    )
    .map((node) => node.node_id);
}

/** 点亮过渡时长（毫秒）。规范要求 ≤100ms，这里固定 100ms 便于测试与审计 */
export const ILLUMINATION_TRANSITION_MS = 100;

export function stateCounts(graph: Pick<TaskGraph, "nodes">): Array<{
  state: TaskNodeState;
  count: number;
  visual: NodeVisual;
}> {
  return (Object.keys(TASK_NODE_STATE_LABEL) as TaskNodeState[])
    .map((state) => ({
      state,
      count: graph.nodes.filter((node) => node.state === state).length,
      visual: TONE_SURFACE[STATE_TO_TONE[state]],
    }))
    .filter((item) => item.count > 0);
}

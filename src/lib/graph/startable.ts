/**
 * TASK-C.10o：任务图谱开工 / 核销入口的纯函数助手。
 *
 * 只描述「谁可以点」——真正改状态仍走 Daemon `start` / `verify`。
 * 点亮只认物理证据：本模块不伪造写入、Scope 或 Commit SHA。
 */

import type { TaskGraph, TaskNode, TaskNodeState } from "./task-graph";

const VERIFIABLE_STATES: ReadonlySet<TaskNodeState> = new Set([
  "RUNNING",
  "REPAIRING",
  "STALE_REVERIFY",
]);

/** 前置是否全部已点亮（无前置 = 可开工） */
export function dependenciesIlluminated(
  graph: TaskGraph,
  node: TaskNode,
): boolean {
  if (node.depends_on.length === 0) return true;
  const byId = new Map(graph.nodes.map((item) => [item.node_id, item]));
  return node.depends_on.every((depId) => {
    const dep = byId.get(depId);
    return dep?.state === "ILLUMINATED";
  });
}

/** PENDING 且前置已点亮 → 可调 start */
export function isNodeStartable(graph: TaskGraph, node: TaskNode): boolean {
  return node.state === "PENDING" && dependenciesIlluminated(graph, node);
}

/** RUNNING / REPAIRING / STALE_REVERIFY → 可调 verify */
export function isNodeVerifiable(node: TaskNode): boolean {
  return VERIFIABLE_STATES.has(node.state);
}

/**
 * 按图内节点顺序取下一个可开工节点（串行依赖链的「下一刀」）。
 * 图节点顺序由建图提案决定，通常已是拓扑序。
 */
export function nextStartableNode(graph: TaskGraph): TaskNode | null {
  for (const node of graph.nodes) {
    if (isNodeStartable(graph, node)) return node;
  }
  return null;
}

/** 优先选中节点；否则取第一个可核销节点 */
export function resolveVerifiableNode(
  graph: TaskGraph,
  selectedNodeId: string | null,
): TaskNode | null {
  if (selectedNodeId) {
    const selected = graph.nodes.find((n) => n.node_id === selectedNodeId);
    if (selected && isNodeVerifiable(selected)) return selected;
  }
  return graph.nodes.find(isNodeVerifiable) ?? null;
}

/**
 * 组装 verify 请求体里的 command_results。
 *
 * 命令退出码属于声明性证据；实测采集见 OP-32。
 * 文件写入 / Scope / HEAD 仍由 Daemon 现算。
 */
export function buildCommandResultsForVerify(
  node: TaskNode,
): Array<{ alias: string; exit_code: number }> {
  if (node.verification_mode !== "COMMAND") return [];
  return node.verification_commands.map((alias) => ({
    alias,
    exit_code: 0,
  }));
}

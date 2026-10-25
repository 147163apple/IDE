/**
 * TASK-C.11e：质疑自查失败 / 需求演进时，相关节点回灰（回 PENDING），禁止假绿。
 * 纯函数：不碰 Daemon；UI 本地先反映，下一帧 TASK_GRAPH_UPDATED 可覆盖。
 */
import {
  computeProgress,
  type TaskGraph,
  type TaskNode,
  type TaskNodeState,
} from "./task-graph";

const GRAYABLE: ReadonlySet<TaskNodeState> = new Set([
  "ILLUMINATED",
  "FAILED",
  "STALE_REVERIFY",
  "RUNNING",
  "REPAIRING",
]);

export function grayOutTaskGraphNodes(
  graph: TaskGraph,
  options: { nodeIds?: string[] | undefined; reason?: string | undefined } = {},
): TaskGraph {
  const filter = options.nodeIds ? new Set(options.nodeIds) : null;
  const nodes: TaskNode[] = graph.nodes.map((n) => {
    if (filter && !filter.has(n.node_id)) return n;
    if (!GRAYABLE.has(n.state)) return n;
    return {
      ...n,
      state: "PENDING",
      executed_at: null,
      commit_sha: null,
    };
  });
  const changed = nodes.filter((n, i) => n.state !== graph.nodes[i]!.state);
  const issues = [...graph.issues];
  if (options.reason && changed.length > 0) {
    const now = new Date().toISOString();
    for (const n of changed) {
      issues.push({
        node_id: n.node_id,
        code: "DISPUTE_GRAY",
        message: options.reason,
        severity: "WARNING",
        recorded_at: now,
      });
    }
  }
  return {
    ...graph,
    nodes,
    issues,
    progress: computeProgress(nodes),
    updated_at: new Date().toISOString(),
    revision: graph.revision + 1,
  };
}

/** 自查结论为失败或需求变更时，默认整图回灰待重做 */
export function shouldGrayAfterDispute(input: {
  userChoice?: "BUG_FIX" | "REQUIREMENT_CHANGE" | undefined;
  reportFailed?: boolean | undefined;
}): boolean {
  if (input.userChoice === "REQUIREMENT_CHANGE") return true;
  if (input.reportFailed === true) return true;
  return false;
}

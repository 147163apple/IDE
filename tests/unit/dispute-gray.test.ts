/**
 * TASK-C.11e：质疑回灰
 */
import { describe, expect, it } from "vitest";
import {
  grayOutTaskGraphNodes,
  shouldGrayAfterDispute,
} from "../../src/lib/graph/dispute-gray";
import {
  computeProgress,
  type TaskGraph,
  type TaskNode,
  type TaskNodeState,
} from "../../src/lib/graph/task-graph";

function node(
  id: string,
  state: TaskNodeState,
  dependsOn: string[] = [],
): TaskNode {
  return {
    node_id: id,
    title: id,
    kind: "CODE_MODIFICATION",
    depends_on: dependsOn,
    functional_area: "main",
    target_files: [`src/${id}.ts`],
    verification_mode: "COMMAND",
    verification_commands: ["verify"],
    state,
    executed_at: state === "ILLUMINATED" ? "2026-01-01T00:00:00.000Z" : null,
    commit_sha: state === "ILLUMINATED" ? "abc" : null,
  };
}

function graph(nodes: TaskNode[]): TaskGraph {
  return {
    schema_version: "1.0",
    graph_id: "g1",
    contract_id: "c1",
    generated_at: "2026-10-24T00:00:00.000Z",
    updated_at: "2026-10-24T00:00:00.000Z",
    revision: 1,
    functional_tree: [{ id: "main", title: "主功能", parent_id: null }],
    nodes,
    fingerprints: [],
    issues: [],
    progress: computeProgress(nodes),
  };
}

describe("TASK-C.11e dispute gray", () => {
  it("shouldGrayAfterDispute for requirement change or failed report", () => {
    expect(
      shouldGrayAfterDispute({ userChoice: "REQUIREMENT_CHANGE" }),
    ).toBe(true);
    expect(shouldGrayAfterDispute({ reportFailed: true })).toBe(true);
    expect(
      shouldGrayAfterDispute({ userChoice: "BUG_FIX", reportFailed: false }),
    ).toBe(false);
  });

  it("grays illuminated nodes back to PENDING", () => {
    const next = grayOutTaskGraphNodes(
      graph([node("n1", "ILLUMINATED"), node("n2", "PENDING", ["n1"])]),
      { reason: "质疑自查未通过" },
    );
    const n1 = next.nodes.find((n) => n.node_id === "n1")!;
    expect(n1.state).toBe("PENDING");
    expect(n1.commit_sha).toBeNull();
    expect(next.issues.some((i) => i.code === "DISPUTE_GRAY")).toBe(true);
    expect(next.revision).toBe(2);
  });
});

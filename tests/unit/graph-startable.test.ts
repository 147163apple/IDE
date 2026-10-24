import { describe, expect, it } from "vitest";
import {
  buildCommandResultsForVerify,
  dependenciesIlluminated,
  isNodeStartable,
  isNodeVerifiable,
  nextStartableNode,
  resolveVerifiableNode,
} from "../../src/lib/graph/startable";
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
    executed_at: null,
    commit_sha: null,
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

describe("graph startable helpers (C.10o)", () => {
  it("无前置的 PENDING 可开工；有未点亮前置则不可", () => {
    const g = graph([node("n1", "PENDING"), node("n2", "PENDING", ["n1"])]);
    expect(isNodeStartable(g, g.nodes[0]!)).toBe(true);
    expect(isNodeStartable(g, g.nodes[1]!)).toBe(false);
    expect(nextStartableNode(g)?.node_id).toBe("n1");
  });

  it("前置点亮后下游 PENDING 可开工", () => {
    const g = graph([node("n1", "ILLUMINATED"), node("n2", "PENDING", ["n1"])]);
    expect(dependenciesIlluminated(g, g.nodes[1]!)).toBe(true);
    expect(nextStartableNode(g)?.node_id).toBe("n2");
  });

  it("RUNNING/REPAIRING/STALE_REVERIFY 可核销", () => {
    expect(isNodeVerifiable(node("a", "RUNNING"))).toBe(true);
    expect(isNodeVerifiable(node("b", "REPAIRING"))).toBe(true);
    expect(isNodeVerifiable(node("c", "STALE_REVERIFY"))).toBe(true);
    expect(isNodeVerifiable(node("d", "PENDING"))).toBe(false);
    expect(isNodeVerifiable(node("e", "ILLUMINATED"))).toBe(false);
  });

  it("resolveVerifiableNode 优先选中，否则取第一个可核销", () => {
    const g = graph([
      node("n1", "ILLUMINATED"),
      node("n2", "RUNNING"),
      node("n3", "REPAIRING"),
    ]);
    expect(resolveVerifiableNode(g, "n3")?.node_id).toBe("n3");
    expect(resolveVerifiableNode(g, null)?.node_id).toBe("n2");
    expect(resolveVerifiableNode(g, "n1")?.node_id).toBe("n2");
  });

  it("COMMAND 核销组装声明别名 exit 0；其它模式不塞 command_results", () => {
    const command = node("n1", "RUNNING");
    expect(buildCommandResultsForVerify(command)).toEqual([
      { alias: "verify", exit_code: 0 },
    ]);
    const manual: TaskNode = {
      ...command,
      verification_mode: "MANUAL",
      verification_commands: [],
    };
    expect(buildCommandResultsForVerify(manual)).toEqual([]);
  });
});

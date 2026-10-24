// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanoramaPane } from "../../src/components/studio/PanoramaPane";
import { StudioLensShell } from "../../src/components/studio/StudioLensShell";
import { TaskGraphPane } from "../../src/components/studio/TaskGraphPane";
import {
  computeProgress,
  type TaskGraph,
  type TaskNode,
} from "../../src/lib/graph/task-graph";

function makeGraph(): TaskGraph {
  const nodes: TaskNode[] = [
    {
      node_id: "n1",
      title: "落实示例",
      kind: "CODE_MODIFICATION",
      depends_on: [],
      functional_area: "area",
      target_files: ["src/a.ts"],
      verification_mode: "COMMAND",
      verification_commands: ["test"],
      state: "PENDING",
      executed_at: null,
      commit_sha: null,
    },
  ];
  return {
    schema_version: "1.0.0",
    graph_id: "g1",
    contract_id: "c1",
    revision: 1,
    functional_tree: [{ id: "area", title: "示例功能", parent_id: null }],
    nodes,
    fingerprints: {},
    progress: computeProgress(nodes),
    issues: [],
    generated_at: "2026-10-24T00:00:00.000Z",
    updated_at: "2026-10-24T00:00:00.000Z",
  };
}

describe("StudioLensShell / PanoramaPane (TASK-C.10q)", () => {
  it("无图默认全景；可手动切到施工", () => {
    render(
      <StudioLensShell
        hasGraph={false}
        panorama={<div data-testid="pano-slot">全景内容</div>}
        construction={<div data-testid="build-slot">施工内容</div>}
      />,
    );
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "panorama",
    );
    expect(
      screen.getByTestId("studio-lens-panel-panorama"),
    ).not.toHaveAttribute("hidden");
    fireEvent.click(screen.getByTestId("studio-lens-tab-construction"));
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "construction",
    );
  });

  it("有图默认施工", () => {
    render(
      <StudioLensShell
        hasGraph
        panorama={<div>全景</div>}
        construction={<div data-testid="build-slot">施工</div>}
      />,
    );
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "construction",
    );
  });

  it("全景摘要可读合同；三张 v0.2 卡为占位；无施工绿灯节点", () => {
    render(
      <PanoramaPane
        summary={{
          contractTitle: "自举 CLI 版本",
          contractDescription: "统一读 package.json",
          acceptanceCriteria: ["version 子命令", "帮助抬头一致"],
          requirementsHint: "已写入 requirements",
          riskLevel: "low",
        }}
      />,
    );
    expect(screen.getByTestId("panorama-contract-title")).toHaveTextContent(
      "自举 CLI 版本",
    );
    expect(
      screen.getByTestId("panorama-acceptance-list").children,
    ).toHaveLength(2);
    expect(screen.getByTestId("panorama-card-capability")).toBeInTheDocument();
    expect(screen.getByTestId("panorama-card-journey")).toBeInTheDocument();
    expect(screen.getByTestId("panorama-card-domain")).toBeInTheDocument();
    expect(screen.queryByTestId("functional-tree")).toBeNull();
    expect(screen.queryByTestId("execution-dag")).toBeNull();
    expect(screen.getByText(/不会出现施工绿灯/)).toBeInTheDocument();
  });

  it("TaskGraphPane：无图进全景；施工侧改名为本轮施工·功能汇总", () => {
    const { rerender } = render(
      <TaskGraphPane
        graph={null}
        panoramaSummary={{ contractTitle: "演示合同" }}
      />,
    );
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "panorama",
    );
    expect(screen.getByTestId("panorama-contract-title")).toHaveTextContent(
      "演示合同",
    );

    rerender(<TaskGraphPane graph={makeGraph()} />);
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "construction",
    );
    expect(screen.getByTestId("graph-view-functional")).toHaveTextContent(
      "本轮施工·功能汇总",
    );
  });
});

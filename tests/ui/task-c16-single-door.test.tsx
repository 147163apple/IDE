// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";
import { StudioViewportShell } from "../../src/components/studio/StudioViewportShell";

/**
 * TASK-C.16：ActivityBar 单门「列表+操作台」。
 * 日常不再并列「项目审阅」与「合同操作台」两扇门。
 */
describe("TASK-C.16 单门：列表+操作台", () => {
  const base = {
    repoName: "1020",
    repoPath: "/Users/tina/Desktop/1020",
    baseBranch: "main",
    runMode: "VIBE" as const,
    files: [{ name: "src", path: "src" }],
  };

  it("ActivityBar 只有一扇工作台门，无项目审阅/图谱双图标", () => {
    render(<WorkspaceLayout {...base} />);
    expect(screen.getByTestId("activity-workbench")).toHaveAttribute(
      "aria-label",
      "合同操作台",
    );
    expect(screen.queryByTestId("activity-supervisor")).toBeNull();
    expect(screen.queryByTestId("activity-graph")).toBeNull();
  });

  it("点单门打开操作台，左侧栏可见需求列表；点需求仍在操作台", () => {
    render(
      <WorkspaceLayout
        {...base}
        studioContent={
          <StudioViewportShell
            contractRail={
              <div>
                <div data-testid="requirement-list">需求（合同 1）</div>
                <button type="button" data-testid="requirement-list-item">
                  示例需求
                </button>
              </div>
            }
            demo={<div data-testid="demo-pane">demo</div>}
            graph={<div>graph</div>}
            dispute={<div>dispute</div>}
            contract={<div>contract</div>}
            playtest={<div>playtest</div>}
          />
        }
      />,
    );
    fireEvent.click(screen.getByTestId("activity-workbench"));
    expect(screen.getByRole("tab", { name: "合同操作台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("studio-contract-rail")).toBeInTheDocument();
    expect(screen.getByTestId("requirement-list")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("requirement-list-item"));
    expect(screen.getByRole("tab", { name: "合同操作台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("demo-pane")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";
import type { ActiveContract } from "../../src/components/workspace-types";

const base = {
  repoName: "1020",
  repoPath: "/Users/tina/Desktop/1020",
  baseBranch: "main",
  runMode: "VIBE" as const,
  workerControl: "GATEWAY_ENFORCED" as const,
  files: [
    {
      name: "src",
      path: "src",
      children: [{ name: "a.ts", path: "src/a.ts" }],
    },
  ],
};
const approved: ActiveContract = {
  contractId: "c-42",
  worktreePath: "/Users/tina/.stagent/worktrees/c-42",
  approved: true,
  status: "EXECUTING",
};

describe("TASK-C.1 三栏工作台", () => {
  it("渲染三栏与 Header 要素", () => {
    render(<WorkspaceLayout {...base} />);
    expect(screen.getByTestId("left-column")).toBeInTheDocument();
    expect(screen.getByTestId("middle-column")).toBeInTheDocument();
    expect(screen.getByTestId("right-column")).toBeInTheDocument();
    expect(screen.getByTestId("repo-name")).toHaveTextContent("1020");
    expect(screen.getByTestId("current-branch")).toHaveTextContent("main");
    expect(screen.getByTestId("run-mode")).toHaveTextContent("VIBE");
    expect(screen.getByTestId("open-studio")).toBeInTheDocument();
  });

  it("模式指示显示 PROTECTED", () => {
    render(<WorkspaceLayout {...base} runMode="PROTECTED" />);
    expect(screen.getByTestId("run-mode")).toHaveAttribute(
      "data-mode",
      "PROTECTED",
    );
  });

  it("受控徽标两种状态", () => {
    const { rerender } = render(<WorkspaceLayout {...base} />);
    const b = () => screen.getByTestId("worker-control");
    expect(b()).toHaveTextContent("GATEWAY_ENFORCED");
    expect(b().className).toMatch(/green/);
    rerender(
      <WorkspaceLayout {...base} workerControl="UNCONTROLLED_EXTERNAL" />,
    );
    expect(b()).toHaveTextContent("UNCONTROLLED_EXTERNAL");
    expect(b().className).toMatch(/yellow/);
  });

  it("Supervisor 入口打开系统 Studio 标签", () => {
    render(<WorkspaceLayout {...base} />);
    fireEvent.click(screen.getByTestId("open-studio"));
    const tab = screen.getByRole("tab", { name: "Supervisor Studio" });
    expect(tab).toHaveAttribute("data-system", "true");
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("studio-pane")).toBeInTheDocument();
  });

  it("中栏分屏：左代码右 Studio", () => {
    render(<WorkspaceLayout {...base} />);
    fireEvent.click(screen.getByText("a.ts"));
    fireEvent.click(screen.getByTestId("toggle-split"));
    expect(screen.getByTestId("split-pane")).toBeInTheDocument();
    expect(screen.getByTestId("split-left")).toHaveTextContent("src/a.ts");
    expect(screen.getByTestId("split-right")).toContainElement(
      screen.getByTestId("studio-pane"),
    );
  });

  it("审批后绑定 Worktree，切回主工作树有提示与执行状态", () => {
    render(<WorkspaceLayout {...base} contract={approved} />);
    expect(screen.getByTestId("current-branch")).toHaveTextContent("task/c-42");
    expect(screen.getByTestId("contract-info")).toHaveTextContent(
      approved.worktreePath,
    );
    expect(screen.getByTestId("workspace-binding")).toHaveAttribute(
      "data-bound",
      "worktree",
    );
    expect(screen.getByTestId("file-tree-root")).toHaveTextContent(
      approved.worktreePath,
    );
    fireEvent.click(screen.getByTestId("switch-main-tree"));
    expect(screen.getByTestId("workspace-binding")).toHaveAttribute(
      "data-bound",
      "main",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("执行中");
    fireEvent.click(screen.getByText("回到 Worktree"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("未批准合同不绑定 Worktree", () => {
    render(
      <WorkspaceLayout
        {...base}
        contract={{ ...approved, approved: false, status: "IDLE" }}
      />,
    );
    expect(screen.getByTestId("workspace-binding")).toHaveAttribute(
      "data-bound",
      "main",
    );
    expect(screen.getByTestId("current-branch")).toHaveTextContent("main");
  });
});

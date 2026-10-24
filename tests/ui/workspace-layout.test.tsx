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
  onNewRequirement: () => {},
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
    expect(screen.getByTestId("run-mode")).toHaveTextContent("自由");
    expect(screen.getByTestId("run-mode")).toHaveAttribute("data-mode", "VIBE");
    // 顶栏收口后右侧只留一个最小操作点
    expect(screen.getByTestId("new-requirement")).toBeInTheDocument();
  });

  it("首屏是空编辑区：不自动打开 Studio，中央是欢迎区", () => {
    render(<WorkspaceLayout {...base} />);
    expect(screen.queryByRole("tab", { name: "合同操作台" })).toBeNull();
    expect(screen.getByTestId("welcome-pane")).toBeInTheDocument();
  });

  it("顶栏只留状态胶囊：连接/Token/实时流/受控状态不再占顶栏", () => {
    render(<WorkspaceLayout {...base} />);
    const header = screen.getByTestId("workspace-header");
    expect(header).not.toHaveTextContent("GATEWAY_ENFORCED");
    expect(header).not.toHaveTextContent("实时流");
    expect(header).not.toHaveTextContent("Session Token");
    expect(screen.queryByTestId("worker-control")).toBeNull();
    expect(screen.queryByTestId("contract-info")).toBeNull();
  });

  it("模式指示显示 PROTECTED", () => {
    render(<WorkspaceLayout {...base} runMode="PROTECTED" />);
    expect(screen.getByTestId("run-mode")).toHaveAttribute(
      "data-mode",
      "PROTECTED",
    );
  });

  it("受控徽标与断线语义已迁到设置页（布局不再渲染）", () => {
    // 原「受控徽标两种状态」「断开后台时徽章变暗」两例随组件一起搬到
    // settings-tab.test.tsx —— 顶栏收口后这里不再有 worker-control。
    render(<WorkspaceLayout {...base} />);
    expect(screen.queryByTestId("worker-control")).toBeNull();
  });

  it("Supervisor 入口（模式徽标）打开系统 Studio 标签", () => {
    render(<WorkspaceLayout {...base} />);
    fireEvent.click(screen.getByTestId("run-mode"));
    const tab = screen.getByRole("tab", { name: "合同操作台" });
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

  it("审批后绑定 Worktree，分支显示真实检出分支，切回主工作树有提示与执行状态", () => {
    render(<WorkspaceLayout {...base} contract={approved} />);
    // P.1 顺手修：顶栏显示主工作区真实分支，不再按合同拼 task/xxx
    expect(screen.getByTestId("current-branch")).toHaveTextContent("main");
    // Worktree 绝对路径不再占顶栏（已移入设置页），绑定关系由下面两处体现
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

  it("打开文件后可点 × 关闭标签（回到欢迎页）", () => {
    render(<WorkspaceLayout {...base} />);
    fireEvent.click(screen.getByText("a.ts"));
    expect(screen.getByRole("tab", { name: "a.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const close = screen.getByTestId("close-tab-src/a.ts");
    expect(close).toHaveAttribute("aria-label", "关闭 a.ts");
    fireEvent.click(close);
    expect(screen.queryByRole("tab", { name: "a.ts" })).toBeNull();
    expect(screen.getByTestId("welcome-pane")).toBeInTheDocument();
  });

  it("openRequest 打开的文件标签也可关闭", () => {
    const { rerender } = render(<WorkspaceLayout {...base} />);
    rerender(
      <WorkspaceLayout
        {...base}
        openRequest={{ path: "README.md", nonce: 1 }}
      />,
    );
    expect(screen.getByRole("tab", { name: "README.md" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("close-tab-README.md"));
    expect(screen.queryByRole("tab", { name: "README.md" })).toBeNull();
  });
});

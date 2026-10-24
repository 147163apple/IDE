// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";
import { SupervisorTab } from "../../src/components/supervisor/SupervisorTab";
import { FileTreeSpecsSection } from "../../src/components/FileTreeSpecsSection";
import type { CommandSurface } from "../../src/lib/command-surface";

const files = [
  {
    name: "src",
    path: "src",
    children: [{ name: "a.ts", path: "src/a.ts" }],
  },
];

const idleSurface: CommandSurface = {
  phase: "idle",
  primaryCtaTestId: "journey-entry-hint",
  welcomeVariant: "speak_right",
  openProjectDefaultExpanded: false,
  quietHeaderBadge: true,
};

const specs = (
  <FileTreeSpecsSection
    assets={[
      {
        id: "req",
        kind: "requirement",
        label: "需求说明",
        status: "READY",
        path: ".stagent/specs/requirements.md",
      },
    ]}
    open
    onToggle={() => {}}
  />
);

function renderWorkbench(
  over: { commandSurface?: CommandSurface; supervisor?: boolean } = {},
) {
  render(
    <WorkspaceLayout
      repoName="1020"
      repoPath="/Users/tina/Desktop/1020"
      baseBranch="main"
      runMode="VIBE"
      files={files}
      onNewRequirement={() => {}}
      commandSurface={over.commandSurface ?? idleSurface}
      supervisorContent={
        over.supervisor ? (
          <SupervisorTab
            repoName="1020"
            repoPath="/Users/tina/Desktop/1020"
            baseBranch="main"
            contractCount={0}
            contract={null}
            protection={{ mode: "VIBE", entries: 0, checkpoint: null }}
            admission={null}
            onOpenConsole={() => {}}
            specsSection={specs}
          />
        ) : undefined
      }
    />,
  );
}

describe("TASK-C.10e / C.10f 欢迎页开项目 + 纯文件树 + 资产进审阅", () => {
  it("欢迎页承载打开/切换项目（page 变体面板展开）；左栏无开项目入口", () => {
    renderWorkbench();
    expect(screen.getByTestId("project-welcome-page")).toBeInTheDocument();
    expect(screen.getByTestId("open-project")).toHaveAttribute(
      "data-variant",
      "page",
    );
    expect(screen.getByTestId("open-project-panel")).toBeInTheDocument();
    expect(screen.getByTestId("switch-project")).toBeInTheDocument();

    const left = screen.getByTestId("left-column");
    expect(left.querySelector('[data-testid="open-project"]')).toBeNull();
    expect(left.querySelector('[data-testid="left-chat-hint"]')).toBeNull();
    expect(left.querySelector('[data-testid="left-project-files"]')).toBeNull();
    expect(left.querySelector('[data-testid="file-tree-specs"]')).toBeNull();
  });

  it("资源管理器只展示纯文件树；可点开源码", () => {
    renderWorkbench();
    expect(screen.getByTestId("left-explorer")).toBeInTheDocument();
    expect(screen.getByTestId("left-explorer-heading")).toHaveTextContent(
      "文件",
    );
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
    fireEvent.click(screen.getByText("a.ts"));
    expect(screen.getByRole("tab", { name: "a.ts" })).toBeInTheDocument();
    // 开文件后欢迎让路；顶栏切换项目可回欢迎
    expect(screen.queryByTestId("project-welcome-page")).toBeNull();
    fireEvent.click(screen.getByTestId("switch-project"));
    expect(screen.getByTestId("project-welcome-page")).toBeInTheDocument();
    expect(screen.getByTestId("open-project-panel")).toBeInTheDocument();
  });

  it("规范与资产出现在项目审阅，不在左栏", () => {
    renderWorkbench({ supervisor: true });
    fireEvent.click(screen.getByTestId("activity-supervisor"));
    expect(screen.getByTestId("supervisor-tab")).toBeInTheDocument();
    expect(screen.getByTestId("supervisor-specs")).toBeInTheDocument();
    expect(screen.getByTestId("file-tree-specs")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("left-column")
        .querySelector('[data-testid="file-tree-specs"]'),
    ).toBeNull();
  });
});

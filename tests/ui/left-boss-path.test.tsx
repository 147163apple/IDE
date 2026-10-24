// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";
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

function renderLeft(
  over: {
    commandSurface?: CommandSurface;
    specsOpen?: boolean;
  } = {},
) {
  const specsOpen = over.specsOpen ?? false;
  render(
    <WorkspaceLayout
      repoName="1020"
      repoPath="/Users/tina/Desktop/1020"
      baseBranch="main"
      runMode="VIBE"
      files={files}
      onNewRequirement={() => {}}
      commandSurface={over.commandSurface ?? idleSurface}
      specsSection={
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
          open={specsOpen}
          onToggle={() => {}}
        />
      }
    />,
  );
}

describe("TASK-C.10d 左栏老板主路径", () => {
  it("默认主视线：打开/切换项目可见；项目文件折叠；提示跟右侧说话", () => {
    renderLeft();
    expect(screen.getByTestId("left-column")).toBeInTheDocument();
    // OpenProjectEntry 入口存在（切换项目 / 打开项目）
    expect(screen.getByTestId("open-project")).toBeInTheDocument();
    expect(screen.getByTestId("open-project")).toHaveTextContent(
      /打开项目|切换项目/,
    );
    const projectFiles = screen.getByTestId("left-project-files");
    expect(projectFiles).not.toHaveAttribute("open");
    expect(screen.getByTestId("left-project-files-summary")).toHaveTextContent(
      "项目文件",
    );
    expect(screen.getByTestId("left-chat-hint")).toHaveTextContent(/右侧/);
    // 文件树在折叠区内仍挂载（能力保留），但默认不铺开主视线
    expect(
      projectFiles.querySelector('[data-testid="file-tree"]'),
    ).not.toBeNull();
    expect(
      projectFiles.querySelector('[data-testid="file-tree-specs"]'),
    ).not.toBeNull();
  });

  it("展开项目文件后仍可点开源码文件", () => {
    renderLeft();
    fireEvent.click(screen.getByTestId("left-project-files-summary"));
    expect(screen.getByTestId("left-project-files")).toHaveAttribute("open");
    fireEvent.click(screen.getByText("a.ts"));
    expect(screen.getByRole("tab", { name: "a.ts" })).toBeInTheDocument();
  });

  it("进行中不显示跟右侧说话提示（不抢 C.9a）", () => {
    renderLeft({
      commandSurface: {
        ...idleSurface,
        phase: "in_progress",
        primaryCtaTestId: "journey-active",
        welcomeVariant: "yield",
      },
    });
    expect(screen.queryByTestId("left-chat-hint")).toBeNull();
  });
});

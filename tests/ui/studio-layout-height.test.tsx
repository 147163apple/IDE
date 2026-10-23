// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplitPaneContainer } from "../../src/components/SplitPaneContainer";
import { StudioViewportShell } from "../../src/components/studio/StudioViewportShell";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";

/**
 * 走查回归：Studio 中间内容区曾出现 boundingBox.height===0，
 * 出草案按钮叠在视口 tablist 下不可点。根因是高度链在
 * middle-content → studio-pane → StudioViewportShell 断裂。
 *
 * jsdom 不算真实布局，这里断言承高 class 链完整；并确认
 * 合同视口里的交互控件不在 hidden 面板、不被 tablist 遮挡语义。
 */

const base = {
  repoName: "1020",
  repoPath: "/Users/tina/Desktop/1020",
  baseBranch: "main",
  runMode: "VIBE" as const,
  files: [
    {
      name: "src",
      path: "src",
      children: [{ name: "a.ts", path: "src/a.ts" }],
    },
  ],
  onNewRequirement: () => {},
};

function classOf(el: HTMLElement): string {
  return el.getAttribute("class") ?? "";
}

function hasAll(el: HTMLElement, tokens: string[]) {
  const c = classOf(el);
  for (const t of tokens) {
    expect(c.split(/\s+/)).toContain(t);
  }
}

describe("Studio 高度链（走查回归）", () => {
  it("打开 Studio 后 middle-content → studio-pane → shell → content 承高 class 齐全", () => {
    render(
      <WorkspaceLayout
        {...base}
        defaultOpenStudio
        studioContent={
          <StudioViewportShell
            presentationState={null}
            demo={<div data-testid="demo-slot">demo</div>}
            graph={<div data-testid="graph-slot">graph</div>}
            dispute={<div data-testid="dispute-slot">dispute</div>}
            contract={
              <div data-testid="contract-slot">
                <button type="button" data-testid="request-draft">
                  让 Supervisor 出草案
                </button>
              </div>
            }
            playtest={<div data-testid="playtest-slot">playtest</div>}
          />
        }
      />,
    );

    const middle = screen.getByTestId("middle-content");
    hasAll(middle, [
      "flex",
      "min-h-0",
      "flex-1",
      "flex-col",
      "overflow-hidden",
    ]);

    const pane = screen.getByTestId("studio-pane");
    hasAll(pane, ["flex", "h-full", "min-h-0", "flex-1", "flex-col"]);

    const shell = screen.getByTestId("studio-viewport-shell");
    hasAll(shell, ["flex", "h-full", "min-h-0", "flex-1", "flex-col"]);

    const content = screen.getByTestId("studio-viewport-content");
    hasAll(content, ["relative", "min-h-0", "flex-1", "overflow-hidden"]);

    // 默认合同视口：出草案按钮在激活面板内，且面板未 hidden
    const contractPanel = screen.getByTestId("studio-viewport-panel-contract");
    expect(contractPanel).toHaveAttribute("data-active", "true");
    expect(contractPanel).not.toHaveAttribute("hidden");
    expect(contractPanel).toContainElement(screen.getByTestId("request-draft"));
    expect(screen.getByTestId("request-draft")).toBeVisible();
  });

  it("分屏时左右栏也带 min-h-0，右侧能承住 Studio", () => {
    render(
      <WorkspaceLayout
        {...base}
        studioContent={
          <StudioViewportShell
            demo={<div />}
            graph={<div />}
            dispute={<div />}
            contract={<div data-testid="contract-slot">合同</div>}
            playtest={<div />}
          />
        }
      />,
    );
    fireEvent.click(screen.getByText("a.ts"));
    fireEvent.click(screen.getByTestId("toggle-split"));

    const split = screen.getByTestId("split-pane");
    hasAll(split, ["flex", "h-full", "min-h-0", "flex-1"]);
    hasAll(screen.getByTestId("split-left"), ["min-h-0", "flex-1"]);
    hasAll(screen.getByTestId("split-right"), [
      "flex",
      "min-h-0",
      "flex-1",
      "flex-col",
    ]);
    expect(screen.getByTestId("split-right")).toContainElement(
      screen.getByTestId("studio-pane"),
    );
  });

  it("SplitPaneContainer 单独渲染时高度链 class 正确", () => {
    render(
      <div style={{ height: 400 }} className="flex flex-col">
        <SplitPaneContainer
          left={<div>L</div>}
          right={<div data-testid="r">R</div>}
        />
      </div>,
    );
    hasAll(screen.getByTestId("split-pane"), ["h-full", "min-h-0", "flex-1"]);
    hasAll(screen.getByTestId("split-right"), ["min-h-0", "flex-1", "flex"]);
  });

  it("切换到合同视口后出草案按钮仍可见可点（不在 hidden 面板）", () => {
    render(
      <StudioViewportShell
        presentationState="DEMO_PREVIEW"
        demo={<div data-testid="demo-slot">demo</div>}
        graph={<div />}
        dispute={<div />}
        contract={
          <button type="button" data-testid="request-draft">
            让 Supervisor 出草案
          </button>
        }
        playtest={<div />}
      />,
    );
    expect(screen.getByTestId("studio-viewport-shell")).toHaveAttribute(
      "data-active-viewport",
      "demo",
    );
    // 切到合同：按钮所在面板激活且无 hidden
    fireEvent.click(screen.getByTestId("studio-viewport-tab-contract"));
    const panel = screen.getByTestId("studio-viewport-panel-contract");
    expect(panel).toHaveAttribute("data-active", "true");
    expect(panel.hidden).toBe(false);
    const btn = screen.getByTestId("request-draft");
    expect(btn).toBeVisible();
    fireEvent.click(btn); // 不应抛错；证明不在被挡的 hidden 层
  });
});

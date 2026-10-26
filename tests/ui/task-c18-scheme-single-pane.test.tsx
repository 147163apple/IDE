// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SchemeReviewPane } from "../../src/components/studio/SchemeReviewPane";
import { StudioViewportShell } from "../../src/components/studio/StudioViewportShell";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";
import {
  rebuildSchemeFromCorpus,
  resolveSchemeConflict,
  confirmSchemeDecision,
} from "../../src/lib/journey/scheme-draft";
import { resolveDefaultViewport } from "../../src/components/studio/viewport-routing";

describe("TASK-C.18 单页方案审阅", () => {
  it("Studio 外壳无五视口 Tab，只有方案审阅", () => {
    render(
      <StudioViewportShell
        contractRail={<div data-testid="requirement-list">需求</div>}
        scheme={<div data-testid="scheme-slot">方案</div>}
      />,
    );
    expect(screen.queryByTestId("studio-viewport-tabs")).toBeNull();
    expect(screen.queryByRole("tab", { name: "原型试玩" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "任务图谱" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "质疑自查" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "合同审阅" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "真机试玩" })).toBeNull();
    expect(screen.getByTestId("studio-viewport-panel-scheme")).toBeInTheDocument();
    expect(screen.getByTestId("scheme-slot")).toBeInTheDocument();
    expect(screen.getByTestId("studio-viewport-shell")).toHaveAttribute(
      "data-single-pane",
      "true",
    );
  });

  it("ActivityBar 单门文案为方案工作台", () => {
    render(
      <WorkspaceLayout
        repoName="1020"
        repoPath="/tmp/x"
        baseBranch="main"
        runMode="VIBE"
        files={[{ name: "src", path: "src" }]}
      />,
    );
    expect(screen.getByTestId("activity-workbench")).toHaveAttribute(
      "aria-label",
      "方案工作台",
    );
  });

  it("方案够完整才出现生成 Demo；最底只有确认方案", () => {
    let scheme = rebuildSchemeFromCorpus(
      null,
      "工程进度管控，财务数据匹配，进度预警，财务预算预警，月度报表。先跑通也要界面一次到位。",
    );
    for (const c of scheme.conflicts) {
      scheme = resolveSchemeConflict(scheme, c.id, c.options[0]!.id);
    }
    for (const d of scheme.decisions) {
      scheme = confirmSchemeDecision(scheme, d.id);
    }
    const onGenerate = vi.fn();
    const onConfirm = vi.fn();
    render(
      <SchemeReviewPane
        scheme={scheme}
        onGenerateDemo={onGenerate}
        onConfirmScheme={onConfirm}
      />,
    );
    expect(screen.queryByText("继续澄清")).toBeNull();
    expect(screen.queryByText("继续讨论")).toBeNull();
    const demoBtn = screen.getByTestId("scheme-generate-demo");
    fireEvent.click(demoBtn);
    expect(onGenerate).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("scheme-confirm"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("空方案不显示生成 Demo / 确认不可用", () => {
    render(<SchemeReviewPane scheme={null} />);
    expect(screen.getByTestId("scheme-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("scheme-generate-demo")).toBeNull();
    expect(screen.queryByTestId("scheme-confirm")).toBeNull();
  });

  it("resolveDefaultViewport 恒为 scheme", () => {
    expect(resolveDefaultViewport("DEMO_PREVIEW")).toBe("scheme");
    expect(resolveDefaultViewport("EXECUTING")).toBe("scheme");
    expect(resolveDefaultViewport(null)).toBe("scheme");
  });
});

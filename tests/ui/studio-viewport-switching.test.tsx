// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StudioViewportShell } from "../../src/components/studio/StudioViewportShell";
import {
  resolveActiveViewport,
  resolveDefaultViewport,
  STUDIO_VIEWPORT_IDS,
} from "../../src/components/studio/viewport-routing";
import { PRESENTATION_STATES } from "../../src/lib/state/presentation-state";

/**
 * TASK-C.18：Studio 收敛为单页方案审阅；旧五视口 Tab 不再出现。
 */

describe("TASK-C.18 Studio 单页", () => {
  it("resolveDefaultViewport 恒为 scheme", () => {
    for (const state of PRESENTATION_STATES) {
      expect(resolveDefaultViewport(state)).toBe("scheme");
    }
    expect(resolveDefaultViewport(null)).toBe("scheme");
  });

  it("resolveActiveViewport 总是 scheme 并清手动", () => {
    const r = resolveActiveViewport({
      presentationState: "EXECUTING",
      previousPresentationState: "DEMO_PREVIEW",
      manualViewport: "demo",
    });
    expect(r.viewport).toBe("scheme");
    expect(r.clearManual).toBe(true);
  });

  it("STUDIO_VIEWPORT_IDS 仅 scheme", () => {
    expect([...STUDIO_VIEWPORT_IDS]).toEqual(["scheme"]);
  });

  it("外壳无五视口 Tab，渲染 scheme 插槽", () => {
    render(
      <StudioViewportShell
        presentationState="DEMO_PREVIEW"
        scheme={<div data-testid="only-scheme">方案</div>}
      />,
    );
    expect(screen.queryByTestId("studio-viewport-tabs")).toBeNull();
    expect(screen.queryByTestId("studio-viewport-tab-demo")).toBeNull();
    expect(screen.queryByTestId("studio-viewport-tab-graph")).toBeNull();
    expect(screen.queryByTestId("studio-viewport-tab-dispute")).toBeNull();
    expect(screen.queryByTestId("studio-viewport-tab-contract")).toBeNull();
    expect(screen.queryByTestId("studio-viewport-tab-playtest")).toBeNull();
    expect(screen.getByTestId("studio-viewport-panel-scheme")).toBeInTheDocument();
    expect(screen.getByTestId("only-scheme")).toBeInTheDocument();
    expect(screen.getByTestId("studio-viewport-shell")).toHaveAttribute(
      "data-single-pane",
      "true",
    );
  });
});

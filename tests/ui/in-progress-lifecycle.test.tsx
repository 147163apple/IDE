/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";
import { resolveCommandSurface } from "../../src/lib/command-surface";
import {
  resolveActiveInProgress,
  resolveInProgressCta,
} from "../../src/lib/in-progress-lifecycle";

const base = {
  repoName: "1020",
  repoPath: "/Users/tina/Desktop/1020",
  baseBranch: "main",
  runMode: "VIBE" as const,
  files: [] as { name: string; path: string }[],
};

describe("TASK-C.10a UI 回归", () => {
  it("结束后指挥面回到 idle（不因「曾经有过旅程卡」粘住）", () => {
    const active = resolveActiveInProgress({
      journeyBusy: false,
      bossMode: false,
      needsProtectionConfirm: false,
    });
    const surface = resolveCommandSurface({
      hasSession: true,
      keyReady: true,
      inProgress: active,
      inProgressCta: resolveInProgressCta({
        journeyBusy: false,
        bossMode: false,
        needsProtectionConfirm: false,
      }),
    });
    expect(surface.phase).toBe("idle");
    expect(surface.primaryCtaTestId).toBe("journey-entry-hint");
    render(<WorkspaceLayout {...base} commandSurface={surface} />);
    expect(screen.queryByTestId("middle-yield")).toBeNull();
    expect(screen.getByTestId("command-surface")).toHaveAttribute(
      "data-phase",
      "idle",
    );
  });

  it("三步台进行中仍让路并自动开 Studio（不回退 C.9d）", async () => {
    const surface = resolveCommandSurface({
      hasSession: true,
      keyReady: true,
      inProgress: true,
      inProgressCta: "boss-fastpath-confirm",
    });
    render(<WorkspaceLayout {...base} commandSurface={surface} />);
    await waitFor(() => {
      expect(screen.getByTestId("studio-pane")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("welcome-pane")).toBeNull();
  });
});

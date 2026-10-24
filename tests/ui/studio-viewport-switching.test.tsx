// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DemoPreviewPane } from "../../src/components/studio/DemoPreviewPane";
import { RealPlaytestPane } from "../../src/components/studio/RealPlaytestPane";
import { DisputeConsolePane } from "../../src/components/studio/DisputeConsolePane";
import { StudioViewportShell } from "../../src/components/studio/StudioViewportShell";
import { TaskGraphPane } from "../../src/components/studio/TaskGraphPane";
import { DEMO_IFRAME_SANDBOX } from "../../src/lib/ipc/demo-origin";
import type { PresentationState } from "../../src/lib/state/presentation-state";
import { PRESENTATION_STATES } from "../../src/lib/state/presentation-state";
import {
  resolveActiveViewport,
  resolveDefaultViewport,
  STUDIO_VIEWPORT_IDS,
} from "../../src/components/studio/viewport-routing";

/**
 * TASK-C.2 门禁：Studio 四视口切换与状态自适应。
 *
 * - 默认视口由 presentation_state 决定（不本地推导 lifecycle）；
 * - 手动 Tab 可覆盖；展示态一变就清覆盖；
 * - 非激活视口 hidden 但不卸载——表单/输入不丢；
 * - Demo iframe 仅 allow-scripts。
 */

function renderShell(opts: {
  presentationState?: PresentationState | null;
  presentationMessage?: string | null;
}) {
  const onRevise = vi.fn();
  const onConfirm = vi.fn();
  const onSubmit = vi.fn();
  const utils = render(
    <StudioViewportShell
      presentationState={opts.presentationState ?? null}
      presentationMessage={opts.presentationMessage ?? null}
      demo={
        <DemoPreviewPane
          previewUrl="http://127.0.0.1:4101/"
          status="RUNNING"
          onRevise={onRevise}
          onConfirm={onConfirm}
        />
      }
      graph={<TaskGraphPane graph={null} loading={false} error={null} />}
      dispute={<DisputeConsolePane contractId="ctr-1" onSubmit={onSubmit} />}
      contract={<div data-testid="contract-slot">合同内容</div>}
      playtest={<RealPlaytestPane status={null} />}
    />,
  );
  return { ...utils, onRevise, onConfirm, onSubmit };
}

describe("resolveDefaultViewport（展示态 → 默认视口）", () => {
  it("任务卡明示三例：DEMO_PREVIEW / EXECUTING / DISPUTED_INSPECTING / REAL_PLAYTEST", () => {
    expect(resolveDefaultViewport("DEMO_PREVIEW")).toBe("demo");
    expect(resolveDefaultViewport("EXECUTING")).toBe("graph");
    expect(resolveDefaultViewport("DISPUTED_INSPECTING")).toBe("dispute");
    expect(resolveDefaultViewport("REAL_PLAYTEST")).toBe("playtest");
  });

  it("施工相关态落图谱，审批/收口落合同", () => {
    for (const state of [
      "GRAPH_MAPPING",
      "STOPPING",
      "PAUSED",
      "VERIFYING",
      "FAILED",
    ] as const) {
      expect(resolveDefaultViewport(state)).toBe("graph");
    }
    for (const state of [
      "EXPLORING",
      "NEEDS_APPROVAL",
      "READY_TO_MERGE",
      "CONFLICT",
      "MERGED",
      "ABORTED",
    ] as const) {
      expect(resolveDefaultViewport(state)).toBe("contract");
    }
    expect(resolveDefaultViewport("REAL_PLAYTEST")).toBe("playtest");
    expect(resolveDefaultViewport(null)).toBe("contract");
    expect(resolveDefaultViewport(undefined)).toBe("contract");
  });

  it("15 态全部有明确映射（无漏网）", () => {
    for (const state of PRESENTATION_STATES) {
      const viewport = resolveDefaultViewport(state);
      expect(STUDIO_VIEWPORT_IDS).toContain(viewport);
    }
  });

  it("展示态变化清手动覆盖；未变则保留", () => {
    expect(
      resolveActiveViewport({
        presentationState: "EXECUTING",
        previousPresentationState: "DEMO_PREVIEW",
        manualViewport: "contract",
      }),
    ).toEqual({ viewport: "graph", clearManual: true });

    expect(
      resolveActiveViewport({
        presentationState: "EXECUTING",
        previousPresentationState: "EXECUTING",
        manualViewport: "contract",
      }),
    ).toEqual({ viewport: "contract", clearManual: false });
  });
});

describe("StudioViewportShell 切换与保活", () => {
  it("DEMO_PREVIEW 默认激活原型试玩，并可手动切到合同", () => {
    renderShell({ presentationState: "DEMO_PREVIEW" });
    const shell = screen.getByTestId("studio-viewport-shell");
    expect(shell).toHaveAttribute("data-active-viewport", "demo");
    expect(screen.getByTestId("studio-viewport-panel-demo")).toHaveAttribute(
      "data-active",
      "true",
    );

    fireEvent.click(screen.getByTestId("studio-viewport-tab-contract"));
    expect(shell).toHaveAttribute("data-active-viewport", "contract");
    expect(screen.getByTestId("contract-slot")).toBeVisible();
  });

  it("EXECUTING → 图谱；DISPUTED_INSPECTING → 质疑", () => {
    const { rerender } = renderShell({ presentationState: "EXECUTING" });
    expect(screen.getByTestId("studio-viewport-shell")).toHaveAttribute(
      "data-active-viewport",
      "graph",
    );

    rerender(
      <StudioViewportShell
        presentationState="DISPUTED_INSPECTING"
        demo={<div />}
        graph={<div />}
        dispute={<DisputeConsolePane contractId="ctr-1" />}
        contract={<div />}
        playtest={<div />}
      />,
    );
    expect(screen.getByTestId("studio-viewport-shell")).toHaveAttribute(
      "data-active-viewport",
      "dispute",
    );
  });

  it("展示态变化会清掉手动选择，回到新态默认视口", () => {
    const { rerender } = renderShell({ presentationState: "DEMO_PREVIEW" });
    fireEvent.click(screen.getByTestId("studio-viewport-tab-contract"));
    expect(screen.getByTestId("studio-viewport-shell")).toHaveAttribute(
      "data-active-viewport",
      "contract",
    );

    rerender(
      <StudioViewportShell
        presentationState="EXECUTING"
        demo={
          <DemoPreviewPane
            previewUrl="http://127.0.0.1:4101/"
            status="RUNNING"
          />
        }
        graph={<TaskGraphPane graph={null} />}
        dispute={<DisputeConsolePane contractId="ctr-1" />}
        contract={<div data-testid="contract-slot">合同内容</div>}
        playtest={<RealPlaytestPane status={null} />}
      />,
    );
    expect(screen.getByTestId("studio-viewport-shell")).toHaveAttribute(
      "data-active-viewport",
      "graph",
    );
  });

  it("切换视口不卸载：质疑输入在切走再切回后仍在", () => {
    renderShell({ presentationState: "DISPUTED_INSPECTING" });
    const input = screen.getByTestId(
      "dispute-challenge-input",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, {
      target: { value: "登录页少了记住我的勾选" },
    });
    expect(input.value).toContain("记住我");

    fireEvent.click(screen.getByTestId("studio-viewport-tab-graph"));
    // 面板仍在 DOM（hidden），不是卸载
    expect(
      screen.getByTestId("studio-viewport-panel-dispute"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dispute-challenge-input")).toHaveValue(
      "登录页少了记住我的勾选",
    );

    fireEvent.click(screen.getByTestId("studio-viewport-tab-dispute"));
    expect(screen.getByTestId("dispute-challenge-input")).toHaveValue(
      "登录页少了记住我的勾选",
    );
  });

  it("五个 Tab 与五个面板齐全（含真机试玩）", () => {
    renderShell({ presentationState: null });
    for (const id of STUDIO_VIEWPORT_IDS) {
      expect(
        screen.getByTestId(`studio-viewport-tab-${id}`),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`studio-viewport-panel-${id}`),
      ).toBeInTheDocument();
    }
  });

  it("展示态白话提示出现在顶栏", () => {
    renderShell({
      presentationState: "EXECUTING",
      presentationMessage: "正在按合同施工",
    });
    expect(screen.getByTestId("studio-presentation-message")).toHaveTextContent(
      "正在按合同施工",
    );
  });
});

describe("DemoPreviewPane iframe 沙箱", () => {
  it("RUNNING 时嵌入 iframe，sandbox 仅 allow-scripts", () => {
    render(
      <DemoPreviewPane previewUrl="http://127.0.0.1:4102/" status="RUNNING" />,
    );
    const iframe = screen.getByTestId("demo-preview-iframe");
    expect(iframe).toHaveAttribute("src", "http://127.0.0.1:4102/");
    expect(iframe).toHaveAttribute("sandbox", DEMO_IFRAME_SANDBOX);
    expect(DEMO_IFRAME_SANDBOX).toBe("allow-scripts");
    expect(DEMO_IFRAME_SANDBOX.includes("allow-same-origin")).toBe(false);
  });

  it("无 URL / STOPPED 显示空态，不渲染 iframe", () => {
    const { rerender } = render(<DemoPreviewPane status={null} />);
    expect(screen.getByTestId("demo-preview-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-preview-iframe")).toBeNull();

    rerender(
      <DemoPreviewPane previewUrl="http://127.0.0.1:4101/" status="STOPPED" />,
    );
    expect(screen.getByTestId("demo-preview-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-preview-iframe")).toBeNull();
  });

  it("大操作栏按钮可点", () => {
    const onRevise = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DemoPreviewPane
        previewUrl="http://127.0.0.1:4101/"
        status="RUNNING"
        onRevise={onRevise}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("demo-revise"));
    fireEvent.click(screen.getByTestId("demo-confirm"));
    expect(onRevise).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("DisputeConsolePane 表单与报告", () => {
  it("少于 4 字不可提交；提交把原文交给上层", async () => {
    const onSubmit = vi.fn();
    render(<DisputeConsolePane contractId="ctr-1" onSubmit={onSubmit} />);
    const input = screen.getByTestId("dispute-challenge-input");
    fireEvent.change(input, { target: { value: "短" } });
    expect(screen.getByTestId("dispute-submit")).toBeDisabled();

    fireEvent.change(input, {
      target: { value: "登录页没有记住我" },
    });
    expect(screen.getByTestId("dispute-submit")).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("dispute-submit"));
    });
    expect(onSubmit).toHaveBeenCalledWith("登录页没有记住我");
  });

  it("渲染三方比对报告与降级裁决按钮", () => {
    render(
      <DisputeConsolePane
        contractId="ctr-1"
        report={{
          report_id: "r1",
          contract_id: "ctr-1",
          challenge: "不对",
          classification: "UNATTRIBUTED",
          confidence: 0.4,
          degraded: true,
          plain_summary: "两边都说得通，请你拍板",
          facts: {
            prompt: {
              original_request: "做登录",
              matched_messages: 2,
              confirmations: 1,
            },
            spec: { matched_entries: ["登录页需记住我"], version: 1 },
            code: {
              worktree_available: true,
              changed_files: ["src/login.tsx"],
              evidence_id: "ev-1",
            },
          },
          next_action: {
            kind: "MANUAL_ARBITRATION",
            message: "请选择修复路径",
          },
        }}
      />,
    );
    expect(screen.getByTestId("dispute-summary")).toHaveTextContent(
      "两边都说得通",
    );
    expect(screen.getByTestId("dispute-fact-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("dispute-fact-spec")).toBeInTheDocument();
    expect(screen.getByTestId("dispute-fact-code")).toBeInTheDocument();
    expect(screen.getByTestId("dispute-arbitration")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("dispute-next-action")).getByText(/拍板|裁决/),
    ).toBeTruthy();
  });

  it("点按缺陷修复 / 按新需求演进会回调（不再空接线）", async () => {
    function Harness() {
      const [choice, setChoice] = useState("");
      return (
        <div>
          <div data-testid="choice-out">{choice}</div>
          <DisputeConsolePane
            contractId="ctr-1"
            report={{
              report_id: "r1",
              contract_id: "ctr-1",
              challenge: "登录页没有记住我",
              classification: "UNATTRIBUTED",
              confidence: 0.4,
              degraded: true,
              plain_summary: "两边都说得通，请你拍板",
              facts: {
                prompt: {
                  original_request: "做登录",
                  matched_messages: 2,
                  confirmations: 1,
                },
                spec: { matched_entries: ["登录页需记住我"], version: 1 },
                code: {
                  worktree_available: true,
                  changed_files: ["src/login.tsx"],
                  evidence_id: "ev-1",
                },
              },
              next_action: {
                kind: "MANUAL_ARBITRATION",
                message: "请选择修复路径",
              },
            }}
            onChooseBugFix={() => setChoice("bug")}
            onChooseRequirementChange={() => setChoice("req")}
          />
        </div>
      );
    }
    render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("dispute-choose-bugfix"));
    });
    expect(screen.getByTestId("choice-out")).toHaveTextContent("bug");
    await act(async () => {
      fireEvent.click(screen.getByTestId("dispute-choose-requirement"));
    });
    expect(screen.getByTestId("choice-out")).toHaveTextContent("req");
  });
});

describe("RealPlaytestPane 挂载与外链", () => {
  it("RUNNING 时嵌入 iframe，并提供外链打开", () => {
    render(
      <RealPlaytestPane previewUrl="http://127.0.0.1:4201/" status="RUNNING" />,
    );
    const iframe = screen.getByTestId("real-playtest-iframe");
    expect(iframe).toHaveAttribute("src", "http://127.0.0.1:4201/");
    const open = screen.getByTestId("real-playtest-open-external");
    expect(open).toHaveAttribute("href", "http://127.0.0.1:4201/");
    expect(open).toHaveAttribute("target", "_blank");
  });

  it("空态可点启动；无 iframe", () => {
    const onStart = vi.fn();
    render(<RealPlaytestPane status={null} onStart={onStart} />);
    expect(screen.getByTestId("real-playtest-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("real-playtest-iframe")).toBeNull();
    fireEvent.click(screen.getByTestId("real-playtest-start"));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("REAL_PLAYTEST 展示态默认激活真机试玩视口", () => {
    renderShell({ presentationState: "REAL_PLAYTEST" });
    expect(screen.getByTestId("studio-viewport-shell")).toHaveAttribute(
      "data-active-viewport",
      "playtest",
    );
  });
});

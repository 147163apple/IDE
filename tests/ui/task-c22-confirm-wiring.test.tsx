// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SchemeReviewPane } from "../../src/components/studio/SchemeReviewPane";
import { AgentChatPane } from "../../src/components/AgentChatPane";
import type {
  AgentSessionTransport,
  UseAgentSession,
} from "../../src/hooks/use-agent-session";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  evaluateSchemeConfirmation,
  type DemoGate,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";

/**
 * SSOT v2.0.2 §3 验收：前端接线。
 *
 * 这里只断言「组件确实按谓词渲染、按钮确实连到回调」——
 * 谓词本身的正确性由 tests/unit/scheme-confirmation-gate.test.ts 负责。
 */

function makeScheme(partial: Partial<SchemeDraft> = {}): SchemeDraft {
  return emptySchemeDraft({
    title: "工程项目进度管控台",
    summary: "按项目维度汇总进度与预算，并对超期节点发出预警。",
    modules: ["工程进度管控", "财务数据与预算"],
    mermaidFlow: "flowchart LR\n  A[录入进度] --> B[汇总]",
    business_input_rounds: 1,
    scheme_revision: 2,
    ...partial,
  });
}

function makeDemo(partial: Partial<DemoGate> = {}): DemoGate {
  return { ...EMPTY_DEMO_GATE, ...partial };
}

function renderPane(
  scheme: SchemeDraft,
  demo: DemoGate,
  handlers: {
    onConfirmScheme?: () => void;
    onConfirmDemo?: () => void;
    onRetryDemo?: () => void;
    onAcceptDegradedDemo?: () => void;
  } = {},
) {
  return render(
    <SchemeReviewPane
      scheme={scheme}
      demoUrl="http://127.0.0.1:4100/"
      demoGate={demo}
      confirmation={evaluateSchemeConfirmation(scheme, demo)}
      onConfirmScheme={handlers.onConfirmScheme}
      onConfirmDemo={handlers.onConfirmDemo}
      onRetryDemo={handlers.onRetryDemo}
      onAcceptDegradedDemo={handlers.onAcceptDegradedDemo}
    />,
  );
}

describe("T-UI-1 确认按钮由唯一谓词决定", () => {
  it("T-UI-001 未生成 Demo：确认按钮可用，且不显示阻断原因", () => {
    renderPane(makeScheme(), EMPTY_DEMO_GATE);
    expect(screen.getByTestId("scheme-confirm")).not.toBeDisabled();
    expect(screen.queryByTestId("scheme-confirm-blocked")).toBeNull();
  });

  it("T-UI-002 Demo 已生成未确认：确认按钮禁用并说明原因", () => {
    renderPane(
      makeScheme(),
      makeDemo({
        status: "ready",
        scheme_revision: 2,
        decision_revision: null,
        prototype_id: "proto-1",
      }),
    );
    const blocked = screen.getByTestId("scheme-confirm-blocked");
    expect(blocked.textContent ?? "").toContain("Demo");
    expect(screen.getByTestId("scheme-confirm")).toBeDisabled();
  });

  it("T-UI-003 有未决冲突：即使 Demo 已确认也不放行", () => {
    renderPane(
      makeScheme({
        conflicts: [
          {
            id: "c1",
            question: "预算口径？",
            options: [
              { id: "a", label: "合同额" },
              { id: "b", label: "实付" },
            ],
            chosenId: null,
          },
        ],
      }),
      makeDemo({
        status: "ready",
        scheme_revision: 2,
        decision_revision: 2,
        prototype_id: "proto-2",
      }),
    );
    expect(screen.getByTestId("scheme-confirm")).toBeDisabled();
    expect(
      screen.getByTestId("scheme-confirm-blocked").textContent ?? "",
    ).toContain("冲突");
  });

  it("T-UI-004 completeness 很低但四条件齐备：确认按钮仍然可用（分数不再拦）", () => {
    renderPane(makeScheme({ completeness: 5 }), EMPTY_DEMO_GATE);
    expect(screen.getByTestId("scheme-confirm")).not.toBeDisabled();
  });
});

describe("T-UI-2 Demo 三态的动作必须连到真实回调", () => {
  it("T-UI-005 点「确认此 Demo」触发 onConfirmDemo", () => {
    const onConfirmDemo = vi.fn();
    renderPane(
      makeScheme(),
      makeDemo({
        status: "ready",
        scheme_revision: 2,
        decision_revision: null,
        prototype_id: "proto-3",
      }),
      { onConfirmDemo },
    );
    fireEvent.click(screen.getByTestId("scheme-demo-confirm"));
    expect(onConfirmDemo).toHaveBeenCalledTimes(1);
  });

  it("T-UI-006 Demo 失败：同时给「重试」与「接受降级」两个动作", () => {
    const onRetryDemo = vi.fn();
    const onAcceptDegradedDemo = vi.fn();
    renderPane(
      makeScheme(),
      makeDemo({ status: "failed", scheme_revision: 2 }),
      { onRetryDemo, onAcceptDegradedDemo },
    );

    expect(screen.getByTestId("scheme-demo-failed")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("scheme-demo-retry"));
    fireEvent.click(screen.getByTestId("scheme-demo-accept-degraded"));
    expect(onRetryDemo).toHaveBeenCalledTimes(1);
    expect(onAcceptDegradedDemo).toHaveBeenCalledTimes(1);
  });

  it("T-UI-007 已接受降级：显示已确认条，确认按钮可用", () => {
    renderPane(
      makeScheme(),
      makeDemo({
        status: "degraded_flowcard",
        scheme_revision: 2,
        decision_revision: 2,
        risk_flags: ["NO_INTERACTIVE_DEMO"],
      }),
    );
    expect(screen.getByTestId("scheme-demo-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("scheme-confirm")).not.toBeDisabled();
  });

  it("T-UI-008 Demo 是旧修订：确认/降级入口不得可用（必须先重生成）", () => {
    renderPane(
      makeScheme({ scheme_revision: 5 }),
      makeDemo({
        status: "ready",
        scheme_revision: 4,
        decision_revision: 4,
        prototype_id: "proto-4",
      }),
    );
    expect(screen.getByTestId("scheme-demo-confirm")).toBeDisabled();
    expect(screen.getByTestId("scheme-confirm")).toBeDisabled();
  });
});

describe("T-UI-3 右栏锁定可见可验", () => {
  /**
   * 最小传输层桩：组件在 `!transport` 时会直接返回「还没连上工作台」，
   * 根本走不到聊天体。要用锁（锁定发生在一个已连上的会话里）就必须给 transport。
   */
  function stubTransport(): AgentSessionTransport {
    return {
      listAdapters: async () => [],
      listSessions: async () => [],
      createSession: async () => {
        throw new Error("not used");
      },
      getSession: async () => {
        throw new Error("not used");
      },
      send: async () => "started",
      interrupt: async () => true,
      subscribe: () => () => {},
    };
  }

  /** 最小可用会话桩：只为让聊天体渲染，断言锁定条是否存在。 */
  function stubSession(): UseAgentSession {
    return {
      adapters: [],
      sessions: [
        {
          id: "s1",
          adapter_id: "local",
          title: "方案讨论",
          created_at: new Date().toISOString(),
        },
      ],
      sessionId: "s1",
      events: [],
      messages: [],
      busy: false,
      error: null,
      firstTokenMs: null,
      selectSession: async () => {},
      newSession: async () => {},
      send: async () => {},
      stop: async () => {},
      refresh: async () => {},
    };
  }

  it("T-UI-009 locked=true：显示锁定条并说明原因", () => {
    render(
      <AgentChatPane
        transport={stubTransport()}
        session={stubSession()}
        locked
        lockedReason="方案已签署并冻结，右栏本轮已锁定。"
      />,
    );
    expect(screen.getByTestId("agent-chat-locked")).toBeInTheDocument();
    expect(screen.getByTestId("agent-chat-locked").textContent).toContain(
      "已签署",
    );
  });

  it("T-UI-010 未锁定时不出现锁定条", () => {
    render(
      <AgentChatPane transport={stubTransport()} session={stubSession()} />,
    );
    expect(screen.queryByTestId("agent-chat-locked")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  EMPTY_DEMO_GATE,
  canConfirmScheme,
  computeDemoReady,
  emptySchemeDraft,
  evaluateSchemeConfirmation,
  freezeScheme,
  type DemoGate,
  type SchemeConflict,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import { canTransitionDelivery } from "../../src/lib/state/delivery-state";

/**
 * SSOT v2.0.2 §3.5 / §2.2 验收：单一确认谓词与直接签署状态边。
 *
 * 本文件是「允许/拒绝矩阵」的唯一实现证据。规范里每条决策都指向
 * 这里的测试 ID（T-GATE-xxx / T-STATE-xxx），改谓词必须先改这里。
 */

function makeDraft(partial: Partial<SchemeDraft> = {}): SchemeDraft {
  return emptySchemeDraft({
    title: "工程项目进度管控台",
    summary:
      "按项目维度汇总进度与预算，并对超期节点发出预警，支持月度报表导出。",
    modules: ["工程进度管控", "财务数据与预算"],
    mermaidFlow: "flowchart LR\n  A[录入进度] --> B[汇总]",
    business_input_rounds: 1,
    ...partial,
  });
}

function makeDemo(partial: Partial<DemoGate> = {}): DemoGate {
  return { ...EMPTY_DEMO_GATE, ...partial };
}

function openConflict(): SchemeConflict {
  return {
    id: "c1",
    question: "预算口径按合同额还是实际付款？",
    options: [
      { id: "contract", label: "合同额" },
      { id: "paid", label: "实际付款" },
    ],
    chosenId: null,
  };
}

describe("T-GATE 单一确认谓词 evaluateSchemeConfirmation", () => {
  it("T-GATE-001 从未生成 Demo：允许按静态方案签署，demo_mode=none", () => {
    const decision = evaluateSchemeConfirmation(makeDraft(), EMPTY_DEMO_GATE);
    expect(decision.ok).toBe(true);
    expect(decision.code).toBe("OK");
    expect(decision.demo_mode).toBe("none");
    expect(decision.reasons).toEqual([]);
  });

  it("T-GATE-002 Demo 已就绪且对同一修订确认：允许签署", () => {
    const draft = makeDraft({ scheme_revision: 3 });
    const decision = evaluateSchemeConfirmation(
      draft,
      makeDemo({
        status: "ready",
        scheme_revision: 3,
        decision_revision: 3,
        prototype_id: "proto-a",
      }),
    );
    expect(decision.ok).toBe(true);
    expect(decision.demo_mode).toBe("interactive");
  });

  it("T-GATE-003 Demo 仍在生成：拒绝 E_DEMO_BUILDING", () => {
    const draft = makeDraft({ scheme_revision: 2 });
    const decision = evaluateSchemeConfirmation(
      draft,
      makeDemo({ status: "building", scheme_revision: 2 }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_BUILDING");
    expect(decision.reasons).toContain("Demo 仍在生成");
  });

  it("T-GATE-004 Demo 生成失败且未处置：拒绝 E_DEMO_FAILED", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft({ scheme_revision: 2 }),
      makeDemo({ status: "failed", scheme_revision: 2 }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_FAILED");
  });

  it("T-GATE-005 已生成但未确认（decision_revision=null）：拒绝 E_DEMO_CONFIRMATION_REQUIRED", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft({ scheme_revision: 4 }),
      makeDemo({
        status: "ready",
        scheme_revision: 4,
        decision_revision: null,
        prototype_id: "proto-b",
      }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_CONFIRMATION_REQUIRED");
  });

  it("T-GATE-006 Demo 基于旧修订：拒绝 E_DEMO_STALE（改过方案必须重生成）", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft({ scheme_revision: 5 }),
      makeDemo({
        status: "ready",
        scheme_revision: 4,
        decision_revision: 4,
        prototype_id: "proto-c",
      }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_STALE");
  });

  it("T-GATE-007 仍有未决冲突：拒绝 E_SCHEME_CONFLICTS_OPEN，且不因 Demo 就绪而放行", () => {
    const draft = makeDraft({
      scheme_revision: 1,
      conflicts: [openConflict()],
    });
    const decision = evaluateSchemeConfirmation(
      draft,
      makeDemo({
        status: "ready",
        scheme_revision: 1,
        decision_revision: 1,
        prototype_id: "proto-d",
      }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCHEME_CONFLICTS_OPEN");
    expect(decision.reasons).toContain("仍有 1 条未决冲突");
  });

  it("T-GATE-008 方案不可审阅（标题/摘要不足）：拒绝 E_SCHEME_NOT_REVIEWABLE", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft({ title: "", summary: "", modules: [] }),
      EMPTY_DEMO_GATE,
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCHEME_NOT_REVIEWABLE");
  });

  it("T-GATE-009 已冻结方案：拒绝 E_SCHEME_ALREADY_FROZEN（不重复签署）", () => {
    const decision = evaluateSchemeConfirmation(
      freezeScheme(makeDraft()),
      EMPTY_DEMO_GATE,
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCHEME_ALREADY_FROZEN");
  });

  it("T-GATE-010 降级流程卡：未显式接受拒绝；已接受则允许且 demo_mode=degraded", () => {
    const draft = makeDraft({ scheme_revision: 2 });
    const notAccepted = evaluateSchemeConfirmation(
      draft,
      makeDemo({
        status: "degraded_flowcard",
        scheme_revision: 2,
        decision_revision: null,
      }),
    );
    expect(notAccepted.ok).toBe(false);
    expect(notAccepted.code).toBe("E_DEMO_CONFIRMATION_REQUIRED");
    expect(notAccepted.message).toContain("降级");

    const accepted = evaluateSchemeConfirmation(
      draft,
      makeDemo({
        status: "degraded_flowcard",
        scheme_revision: 2,
        decision_revision: 2,
        risk_flags: ["NO_INTERACTIVE_DEMO"],
      }),
    );
    expect(accepted.ok).toBe(true);
    expect(accepted.demo_mode).toBe("degraded");
  });

  it("T-GATE-011 completeness 只是展示分：不参与 demoReady，也不参与确认判定", () => {
    // 满分方案但缺主流程 → demoReady 必须为 false
    const noFlow = makeDraft({
      completeness: 100,
      mermaidFlow: "",
      modules: ["工程进度管控", "财务数据与预算"],
    });
    expect(computeDemoReady(noFlow)).toBe(false);

    // 辅助分极低但四条底线齐备 → demoReady 必须为 true
    const lowScore = makeDraft({ completeness: 0 });
    expect(computeDemoReady(lowScore)).toBe(true);

    // 确认谓词只看可读性与 Demo 状态，与分数无关
    expect(
      evaluateSchemeConfirmation(
        { ...lowScore, completeness: 0 },
        EMPTY_DEMO_GATE,
      ).ok,
    ).toBe(true);
  });

  it("T-GATE-012 demoReady 四条件逐条落地：任一缺失即 false", () => {
    expect(computeDemoReady(makeDraft())).toBe(true);
    expect(computeDemoReady(makeDraft({ modules: ["仅一个模块"] }))).toBe(
      false,
    );
    expect(computeDemoReady(makeDraft({ mermaidFlow: "" }))).toBe(false);
    expect(computeDemoReady(makeDraft({ conflicts: [openConflict()] }))).toBe(
      false,
    );
    expect(computeDemoReady(makeDraft({ business_input_rounds: 0 }))).toBe(
      false,
    );
  });

  it("T-GATE-013 canConfirmScheme 只是兼容别名，与主谓词在无 Demo 时等价", () => {
    expect(canConfirmScheme(makeDraft())).toBe(
      evaluateSchemeConfirmation(makeDraft(), EMPTY_DEMO_GATE).ok,
    );
  });
});

describe("T-STATE 直接签署状态边 PLAN_CONFIRMED → CONTRACT_SIGNED", () => {
  it("T-STATE-001 允许从 PLAN_CONFIRMED 直接签署（不再强制经过 DEMO_READY）", () => {
    expect(canTransitionDelivery("PLAN_CONFIRMED", "CONTRACT_SIGNED")).toBe(
      true,
    );
  });

  it("T-STATE-002 Demo 先行的老链路仍然合法：PLAN_CONFIRMED → DEMO_READY → CONTRACT_SIGNED", () => {
    expect(canTransitionDelivery("PLAN_CONFIRMED", "DEMO_READY")).toBe(true);
    expect(canTransitionDelivery("DEMO_READY", "CONTRACT_SIGNED")).toBe(true);
  });

  it("T-STATE-003 不允许跳级：PLAN_READY 直接到 CONTRACT_SIGNED 仍被拒", () => {
    expect(canTransitionDelivery("PLAN_READY", "CONTRACT_SIGNED")).toBe(false);
  });
});

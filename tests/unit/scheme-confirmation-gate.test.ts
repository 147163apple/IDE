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
import type { ScopePlan } from "../../src/lib/journey/scope-plan";
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

function scopePlanFor(
  draft: SchemeDraft,
  partial: Partial<ScopePlan> = {},
): ScopePlan {
  return {
    scheme_revision: draft.scheme_revision,
    plan_digest: "fixture-digest",
    areas: [],
    never_touch: [],
    needs_approval: [],
    verification: { commands: [], plain: [], manual_only: true },
    budget: {
      limits: {
        max_file_modifications: 10,
        max_total_diff_lines: 2000,
        max_duration_seconds: 1800,
        max_verification_retries: 3,
      },
      plain: "最多改约 10 个文件，预计 15～30 分钟",
    },
    grade: { ok: true, rejected: [] },
    ...partial,
  };
}

/** J.3 起统一入口：合规 plan + 显式打开临时开关 */
function confirm(
  draft: SchemeDraft,
  demo: DemoGate = EMPTY_DEMO_GATE,
  plan: ScopePlan | null = scopePlanFor(draft),
) {
  return evaluateSchemeConfirmation(draft, demo, plan, { scope_gate: true });
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
    const decision = confirm(makeDraft(), EMPTY_DEMO_GATE);
    expect(decision.ok).toBe(true);
    expect(decision.code).toBe("OK");
    expect(decision.demo_mode).toBe("none");
    expect(decision.reasons).toEqual([]);
  });

  it("T-GATE-002 Demo 已就绪且对同一修订确认：允许签署", () => {
    const draft = makeDraft({ scheme_revision: 3 });
    const decision = confirm(
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
    const decision = confirm(
      draft,
      makeDemo({ status: "building", scheme_revision: 2 }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_BUILDING");
    expect(decision.reasons).toContain("Demo 仍在生成");
  });

  it("T-GATE-004 Demo 生成失败且未处置：拒绝 E_DEMO_FAILED", () => {
    const decision = confirm(
      makeDraft({ scheme_revision: 2 }),
      makeDemo({ status: "failed", scheme_revision: 2 }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_FAILED");
  });

  it("T-GATE-005 已生成但未确认（decision_revision=null）：拒绝 E_DEMO_CONFIRMATION_REQUIRED", () => {
    const decision = confirm(
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
    const decision = confirm(
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
    const decision = confirm(
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
    const decision = confirm(
      makeDraft({ title: "", summary: "", modules: [] }),
      EMPTY_DEMO_GATE,
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCHEME_NOT_REVIEWABLE");
  });

  it("T-GATE-009 已冻结方案：拒绝 E_SCHEME_ALREADY_FROZEN（不重复签署）", () => {
    const decision = confirm(freezeScheme(makeDraft()), EMPTY_DEMO_GATE);
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCHEME_ALREADY_FROZEN");
  });

  it("T-GATE-010 降级流程卡：未显式接受拒绝；已接受则允许且 demo_mode=degraded", () => {
    const draft = makeDraft({ scheme_revision: 2 });
    const notAccepted = confirm(
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

    const accepted = confirm(
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
    expect(confirm({ ...lowScore, completeness: 0 }, EMPTY_DEMO_GATE).ok).toBe(
      true,
    );
  });

  it("T-GATE-011a demoReady 四条件逐条落地：任一缺失即 false", () => {
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

  it("T-GATE-011b canConfirmScheme 已禁用：恒为 false（迫使遗留调用点暴露）", () => {
    expect(canConfirmScheme(makeDraft())).toBe(false);
  });
});

describe("T-GATE 范围门禁（TASK-J.3 / SSOT §15.5）", () => {
  const area = (label: string, path: string) => ({
    id: "area_1",
    label,
    why: "",
    module_ids: [],
    kind: "change_existing" as const,
    paths: [path],
    excluded_by_user: false,
  });

  it("T-GATE-012 修订号不一致 → E_SCOPE_NOT_READY；OPEN 冲突优先于范围", () => {
    const draft = makeDraft({ scheme_revision: 3 });
    const stale = confirm(
      draft,
      EMPTY_DEMO_GATE,
      scopePlanFor(draft, { scheme_revision: 2 }),
    );
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe("E_SCOPE_NOT_READY");
    expect(stale.message).toContain("正在核对要改哪些地方");

    // 判定顺序：冲突先于范围
    const conflicted = makeDraft({
      scheme_revision: 3,
      conflicts: [openConflict()],
    });
    const priority = confirm(conflicted, EMPTY_DEMO_GATE, null);
    expect(priority.code).toBe("E_SCHEME_CONFLICTS_OPEN");
  });

  it("T-GATE-013 scopePlan 为 null → E_SCOPE_NOT_READY", () => {
    const decision = confirm(makeDraft(), EMPTY_DEMO_GATE, null);
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCOPE_NOT_READY");
  });

  it("T-GATE-014 grade.ok=false → E_SCOPE_POLICY：文案含白话区域名，不含 **", () => {
    const draft = makeDraft();
    const plan = scopePlanFor(draft, {
      areas: [area("src 这一块", "src/**")],
      grade: {
        ok: false,
        rejected: [{ path: "src/**", kind: "bare_top_glob" }],
      },
    });
    const decision = confirm(draft, EMPTY_DEMO_GATE, plan);
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCOPE_POLICY");
    expect(decision.message).toContain("src 这一块");
    expect(decision.message).not.toContain("**");
    expect(decision.reasons.join("")).not.toContain("**");
  });

  it("T-GATE-015 有未表态敏感项 → E_SCOPE_APPROVAL_REQUIRED；表态后放行", () => {
    const draft = makeDraft();
    const pending = scopePlanFor(draft, {
      needs_approval: [
        {
          id: "ap_dependency_manifest",
          label: "项目依赖清单（package.json）",
          why: "要加依赖",
          paths: ["package.json"],
          approved: null,
        },
      ],
    });
    const decision = confirm(draft, EMPTY_DEMO_GATE, pending);
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCOPE_APPROVAL_REQUIRED");
    expect(decision.message).toContain("还有 1 处敏感改动等你点头");

    const approved = {
      ...pending,
      needs_approval: pending.needs_approval.map((item) => ({
        ...item,
        approved: true,
      })),
    };
    expect(confirm(draft, EMPTY_DEMO_GATE, approved).ok).toBe(true);
  });

  it("T-GATE-016 范围全部满足（Demo 已对同一修订确认）→ OK", () => {
    const draft = makeDraft({ scheme_revision: 2 });
    const decision = confirm(
      draft,
      makeDemo({
        status: "ready",
        scheme_revision: 2,
        decision_revision: 2,
        prototype_id: "proto-ok",
      }),
      scopePlanFor(draft),
    );
    expect(decision.ok).toBe(true);
    expect(decision.code).toBe("OK");
    expect(decision.demo_mode).toBe("interactive");
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

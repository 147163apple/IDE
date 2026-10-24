// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { BossFastPathDesk } from "../../src/components/studio/BossFastPathDesk";
import { SupervisorStudioPane } from "../../src/components/SupervisorStudioPane";
import {
  buildBossFastPathSummary,
  humanizePathForBoss,
  isBossFastPathPresentation,
  toStudioDraft,
} from "../../src/components/supervisor-view-model";

/**
 * TASK-C.8b：默认三步可见 / 细节折叠；保护命中必须确认；大事不误伤呈现判定。
 */

const lowDraft = softwareContractSchema.parse({
  ...createContractDraft({
    title: "把标题字号调大一点",
    description: "只改展示文案相关样式",
    acceptanceCriteria: ["页面字号变大"],
    writablePaths: ["src/styles/**", "src/components/Header.tsx"],
    commands: [
      { alias: "typecheck", executable: "npm", args: ["run", "typecheck"] },
    ],
    riskLevel: "LOW",
  }),
  lifecycle_state: "DRAFT",
  approval: { status: "DRAFT" },
});

const majorDraft = softwareContractSchema.parse({
  ...createContractDraft({
    title: "新做登录与支付流程",
    description: "大事",
    acceptanceCriteria: ["能登录"],
    writablePaths: ["src/auth/**", "src/pay/**"],
    commands: [{ alias: "test", executable: "npm", args: ["test"] }],
    riskLevel: "MEDIUM",
  }),
  lifecycle_state: "DRAFT",
  approval: { status: "DRAFT" },
});

describe("isBossFastPathPresentation", () => {
  it("低风险草案走老板三步", () => {
    expect(isBossFastPathPresentation(lowDraft)).toBe(true);
  });

  it("中风险大事不走老板三步（避免误伤）", () => {
    expect(isBossFastPathPresentation(majorDraft)).toBe(false);
  });
});

describe("buildBossFastPathSummary / humanizePathForBoss", () => {
  it("把 glob 收成白话叶子，并标清是否动保护", () => {
    expect(humanizePathForBoss("src/styles/**")).toBe("styles");
    const summary = buildBossFastPathSummary({
      title: lowDraft.intent.title,
      writablePaths: ["src/styles/**", "src/components/Header.tsx"],
      needsProtectionApproval: false,
    });
    expect(summary.wherePaths).toEqual(["styles", "Header.tsx"]);
    expect(summary.touchesProtection).toBe(false);
    expect(summary.confirmLabel).toBe("确认开改");
  });

  it("保护命中时第二步必须为是", () => {
    const summary = buildBossFastPathSummary({
      title: "改登录按钮文案",
      writablePaths: ["src/pages/login.tsx"],
      needsProtectionApproval: true,
      protectedEntryNames: ["登录"],
      protectedFiles: ["src/pages/login.tsx"],
    });
    expect(summary.touchesProtection).toBe(true);
    expect(summary.protectionNames).toContain("登录");
  });
});

describe("BossFastPathDesk UI", () => {
  it("默认三步可见，工程师细节（npm / Scope）默认隐藏", () => {
    const summary = buildBossFastPathSummary({
      title: lowDraft.intent.title,
      writablePaths: lowDraft.authorization.file_system_scope.writable_paths,
      needsProtectionApproval: false,
    });
    render(
      <BossFastPathDesk
        summary={summary}
        onConfirm={() => {}}
        advanced={
          <SupervisorStudioPane
            runMode="VIBE"
            draft={toStudioDraft(lowDraft)}
          />
        }
      />,
    );

    expect(screen.getByTestId("boss-fastpath-desk")).toBeTruthy();
    expect(screen.getByTestId("boss-fastpath-step-where")).toBeTruthy();
    expect(screen.getByTestId("boss-fastpath-step-protection")).toBeTruthy();
    expect(screen.getByTestId("boss-fastpath-step-confirm")).toBeTruthy();
    expect(screen.getByTestId("boss-fastpath-confirm").textContent).toContain(
      "确认开改",
    );
    expect(screen.queryByTestId("supervisor-studio")).toBeNull();
    expect(screen.queryByTestId("boss-fastpath-advanced-body")).toBeNull();
    expect(screen.queryByText(/npm run typecheck/)).toBeNull();

    fireEvent.click(screen.getByTestId("boss-fastpath-advanced-toggle"));
    expect(screen.getByTestId("boss-fastpath-advanced-body")).toBeTruthy();
    expect(screen.getByTestId("supervisor-studio")).toBeTruthy();
  });

  it("保护命中时未勾选不能确认；勾选后可确认", () => {
    const onConfirm = vi.fn();
    const summary = buildBossFastPathSummary({
      title: "改登录按钮文案",
      writablePaths: ["src/pages/login.tsx"],
      needsProtectionApproval: true,
      protectedEntryNames: ["登录"],
      protectedFiles: ["src/pages/login.tsx"],
    });
    render(<BossFastPathDesk summary={summary} onConfirm={onConfirm} />);

    const btn = screen.getByTestId("boss-fastpath-confirm");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("boss-fastpath-protection-ack"));
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("无保护时一步确认即可", () => {
    const onConfirm = vi.fn();
    const summary = buildBossFastPathSummary({
      title: lowDraft.intent.title,
      writablePaths: ["src/styles/**"],
      needsProtectionApproval: false,
    });
    render(<BossFastPathDesk summary={summary} onConfirm={onConfirm} />);
    expect(screen.getByTestId("boss-fastpath-protection-clear")).toBeTruthy();
    fireEvent.click(screen.getByTestId("boss-fastpath-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

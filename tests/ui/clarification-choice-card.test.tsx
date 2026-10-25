// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClarificationChoiceCard } from "../../src/components/supervisor/ClarificationChoiceCard";
import { PlainContractAuthorizeCard } from "../../src/components/supervisor/PlainContractAuthorizeCard";
import { ScopePausedDialog } from "../../src/components/supervisor/ScopePausedDialog";
import { buildClarificationRound } from "../../src/lib/journey/clarification";

describe("TASK-C.11a ClarificationChoiceCard", () => {
  it("renders 推荐 badge and fires onSelect", () => {
    const round = buildClarificationRound("加会员等级", 0);
    const q = round.questions[0]!;
    const onSelect = vi.fn();
    render(
      <ClarificationChoiceCard
        question={q}
        roundIndex={0}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByTestId("clarification-recommended-badge")).toBeTruthy();
    const recommended = screen
      .getAllByTestId("clarification-option")
      .find((el) => el.getAttribute("data-recommended") === "true")!;
    fireEvent.click(recommended);
    expect(onSelect).toHaveBeenCalledWith(q.id, recommended.getAttribute("data-option-id"));
  });
});

describe("TASK-C.11c PlainContractAuthorizeCard", () => {
  it("blocks authorize until demo confirmed", () => {
    const onAuthorize = vi.fn();
    const { rerender } = render(
      <PlainContractAuthorizeCard
        view={{
          contract_id: "c1",
          title: "会员",
          intent_summary: "加等级",
          scope_summary: "src/**",
          acceptance_summary: "能点",
          draft_version: "v1-draft",
          demo_confirmed: false,
        }}
        onAuthorize={onAuthorize}
        onReject={() => undefined}
        onRevise={() => undefined}
      />,
    );
    const btn = screen.getByTestId("plain-contract-authorize");
    expect(btn).toBeDisabled();
    rerender(
      <PlainContractAuthorizeCard
        view={{
          contract_id: "c1",
          title: "会员",
          intent_summary: "加等级",
          scope_summary: "src/**",
          acceptance_summary: "能点",
          draft_version: "v1-draft",
          demo_confirmed: true,
        }}
        onAuthorize={onAuthorize}
        onReject={() => undefined}
        onRevise={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId("plain-contract-authorize"));
    expect(onAuthorize).toHaveBeenCalled();
  });
});

describe("TASK-C.11d ScopePausedDialog", () => {
  it("shows expand and rollback actions", () => {
    const onExpand = vi.fn();
    const onRollback = vi.fn();
    render(
      <ScopePausedDialog
        view={{
          contract_id: "c1",
          code: "E_OUT_OF_SCOPE",
          message: "想写合同外路径",
          attempted_path: "secrets.env",
        }}
        onExpandScope={onExpand}
        onRollback={onRollback}
      />,
    );
    expect(screen.getByTestId("scope-paused-path").textContent).toContain(
      "secrets.env",
    );
    fireEvent.click(screen.getByTestId("scope-paused-expand"));
    fireEvent.click(screen.getByTestId("scope-paused-rollback"));
    expect(onExpand).toHaveBeenCalled();
    expect(onRollback).toHaveBeenCalled();
  });
});

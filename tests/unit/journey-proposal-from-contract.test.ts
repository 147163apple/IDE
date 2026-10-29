import { describe, expect, it } from "vitest";
import { createContractDraft } from "../../src/lib/contract.schema";
import { buildProposalFromContract } from "../../src/lib/journey/proposal-from-contract";

describe("TASK-S.6 buildProposalFromContract（全灰建图原料）", () => {
  it("按可写路径拆 CODE_MODIFICATION 节点，依赖成链", () => {
    const contract = createContractDraft({
      title: "订单满减",
      description: "满 100 减 20",
      acceptanceCriteria: ["可见优惠"],
      writablePaths: ["src/order.ts", "src/ui/badge.tsx"],
      commands: [
        {
          alias: "test",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
    });
    const proposal = buildProposalFromContract(contract, {
      now: () => new Date("2026-10-24T01:00:00.000Z"),
      proposalId: "proposal_fixed",
    });
    expect(proposal.schema_version).toBe("1.0");
    expect(proposal.proposal_id).toBe("proposal_fixed");
    expect(proposal.contract_id).toBe(contract.contract_id);
    expect(proposal.nodes.length).toBe(2);
    expect(proposal.nodes.every((n) => n.kind === "CODE_MODIFICATION")).toBe(
      true,
    );
    expect(proposal.nodes[0]!.depends_on).toEqual([]);
    expect(proposal.nodes[1]!.depends_on).toEqual(["n1"]);
    expect(proposal.nodes[0]!.verification_commands).toEqual(["test"]);
    expect(proposal.functional_tree[0]!.title).toContain("订单满减");
  });

  it("默认合同验证命令映射进节点；按路径建节点", () => {
    const contract = createContractDraft({
      title: "空白范围",
      description: "先出图",
      acceptanceCriteria: ["标准甲", "标准乙"],
      writablePaths: ["src/feature/a.ts"],
    });
    const proposal = buildProposalFromContract(contract);
    expect(proposal.nodes.length).toBe(1);
    expect(proposal.nodes[0]!.verification_commands).toEqual(["test"]);
    expect(proposal.nodes[0]!.target_files).toEqual(["src/feature/a.ts"]);
  });

  it("commands 为空时生成 MANUAL_REVIEW 节点（MANUAL 模式，无占位命令）", () => {
    const contract = createContractDraft({
      title: "人工确认需求",
      description: "兜底人工确认",
      acceptanceCriteria: ["人工验证界面"],
      writablePaths: ["src/ui/manual.tsx"],
      commands: [],
      manualConfirmation: {
        reason_required: true,
        capture_evidence: ["actor", "confirmed_at", "reason"],
      },
    });
    const proposal = buildProposalFromContract(contract);
    expect(proposal.nodes.length).toBe(1);
    expect(proposal.nodes[0]!.kind).toBe("MANUAL_REVIEW");
    expect(proposal.nodes[0]!.verification_mode).toBe("MANUAL");
    expect(proposal.nodes[0]!.verification_commands).toEqual([]);
  });
});

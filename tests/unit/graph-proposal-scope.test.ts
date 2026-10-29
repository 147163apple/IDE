import { describe, expect, it } from "vitest";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import type { SupervisorProposalV1 } from "../../src/lib/graph/task-graph";
import { ScopeViolationError } from "../../src/lib/scope";
import { assertProposalWithinContractScope } from "../../daemon/graph/graph-engine";

function contractWith(
  writablePaths: string[],
  strictlyForbiddenPaths?: string[],
): SoftwareContract {
  const draft = createContractDraft({
    title: "OP-25 scope fixture",
    description: "授权子集校验单测",
    acceptanceCriteria: ["ok"],
    writablePaths,
    strictlyForbiddenPaths,
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_at: new Date().toISOString(),
      approved_by: "test-user",
    },
  });
}

function proposalWithTargets(targets: string[][]): SupervisorProposalV1 {
  return {
    schema_version: "1.0",
    contract_id: "contract_scope",
    proposal_id: "prop-scope",
    functional_tree: [{ id: "main", title: "Main", parent_id: null }],
    nodes: targets.map((target_files, index) => ({
      node_id: `node-${index}`,
      title: `Node ${index}`,
      kind:
        target_files.length === 0 ? "COMMAND_EXECUTION" : "CODE_MODIFICATION",
      depends_on: [],
      functional_area: "main",
      target_files,
      verification_mode:
        target_files.length === 0 ? "IMPLICIT_SIDE_EFFECT" : "COMMAND",
      verification_commands: [],
    })),
  } as unknown as SupervisorProposalV1;
}

function expectScopeViolation(fn: () => void, reason: string) {
  let caught: unknown = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ScopeViolationError);
  const violation = caught as ScopeViolationError;
  expect(violation.code).toBe("E_SCOPE_VIOLATION");
  expect(violation.reason).toBe(reason);
}

describe("OP-25: DAG 装载期授权子集校验（§9.4 DAG 权限不变式）", () => {
  it("节点目标路径在合同 writable_paths 之内时放行", () => {
    const contract = contractWith(["src/**"]);
    expect(() =>
      assertProposalWithinContractScope(
        proposalWithTargets([["src/a.ts"], ["src/deep/b.tsx"]]),
        contract,
      ),
    ).not.toThrow();
  });

  it("任一节点声明超出授权路径即整图拒载（E_SCOPE_VIOLATION / NOT_WRITABLE）", () => {
    const contract = contractWith(["src/**"]);
    expectScopeViolation(
      () =>
        assertProposalWithinContractScope(
          proposalWithTargets([["src/a.ts"], ["secrets/key.ts"]]),
          contract,
        ),
      "NOT_WRITABLE",
    );
  });

  it("strictly_forbidden_paths 优先于 writable_paths（FORBIDDEN_PATH）", () => {
    const contract = contractWith(["src/**"], ["src/secret/**"]);
    expectScopeViolation(
      () =>
        assertProposalWithinContractScope(
          proposalWithTargets([["src/secret/token.ts"]]),
          contract,
        ),
      "FORBIDDEN_PATH",
    );
  });

  it("合同缺失或不可读时拒绝（按规格默认：无授权即拒绝）", () => {
    expectScopeViolation(
      () =>
        assertProposalWithinContractScope(
          proposalWithTargets([["src/a.ts"]]),
          null,
        ),
      "NOT_WRITABLE",
    );
  });

  it("路径穿越（含结尾 `..` 段）即使前缀匹配也拒绝", () => {
    const contract = contractWith(["src/**"]);
    expectScopeViolation(
      () =>
        assertProposalWithinContractScope(
          proposalWithTargets([["src/../../etc/passwd"]]),
          contract,
        ),
      "NOT_WRITABLE",
    );
    expectScopeViolation(
      () =>
        assertProposalWithinContractScope(
          proposalWithTargets([["src/.."]]),
          contract,
        ),
      "NOT_WRITABLE",
    );
    expectScopeViolation(
      () =>
        assertProposalWithinContractScope(
          proposalWithTargets([["/etc/hosts"]]),
          contract,
        ),
      "NOT_WRITABLE",
    );
  });

  it("不声明目标文件的节点（COMMAND_EXECUTION）不产生写入，放行", () => {
    const contract = contractWith(["src/**"]);
    expect(() =>
      assertProposalWithinContractScope(proposalWithTargets([[]]), contract),
    ).not.toThrow();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  addProtectionEntry,
  decideApproval,
  loadRoundState,
} from "../../daemon/protection/protection-list";
import { getWorktreePath } from "../../daemon/git/worktree-manager";
import { git } from "../helpers/git";

/**
 * TASK-D.2 核心目标 1 验收（合同 Scope × 全局保护清单 的审批准入裁决）：
 * - 无交集 → 自动批准，`.stagent/silent-contracts.jsonl` 留痕，零弹窗零阻塞；
 * - 有交集 → 停在 PENDING_APPROVAL，登记一张白话卡，等用户显式决策；
 * - 异常/清单损坏 → Fail-Closed，一律按冲突阻断，绝不静默放行；
 * - 幂等 → 已推进的合同再调用返回 SKIPPED，不重复建 Worktree。
 */

/** 读取静默合同备案（JSONL） */
function silentRecords(repo: string): Array<Record<string, unknown>> {
  const file = path.join(repo, ".stagent", "silent-contracts.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function pendingContract(writablePaths: string[]): SoftwareContract {
  const draft = createContractDraft({
    title: "自动准入测试",
    description: "TASK-D.2 admit()",
    acceptanceCriteria: ["验证命令通过"],
    writablePaths,
    commands: [
      {
        alias: "verify",
        executable: "node",
        args: ["-e", "process.exit(0)"],
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ],
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
  });
}

describe("TASK-D.2 合同 Scope × 保护清单 审批准入", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d2-admit-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src", "auth"), { recursive: true });
    fs.mkdirSync(path.join(repo, "src", "ui"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "auth", "login.ts"), "// login\n");
    fs.writeFileSync(path.join(repo, "src", "ui", "button.ts"), "// button\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("清单为空（自由模式）→ 自动批准并写入静默备案，零待审批卡", async () => {
    const contract = store.save(pendingContract(["src/auth/**"]));

    const result = await orchestrator.admit(contract.contract_id);

    expect(result.decision).toBe("AUTO_APPROVED");
    expect(result.contract.lifecycle_state).toBe("EXECUTING");
    expect(result.contract.approval.status).toBe("APPROVED");
    expect(result.contract.approval.approved_by).toBe("stagent-auto");
    expect(fs.existsSync(getWorktreePath(repo, contract.contract_id))).toBe(
      true,
    );

    const auto = silentRecords(repo).filter(
      (r) => r["kind"] === "contract_auto_approved",
    );
    expect(auto).toHaveLength(1);
    expect(auto[0]!["contract_id"]).toBe(contract.contract_id);
    expect(auto[0]!["mode"]).toBe("VIBE");
    expect(auto[0]!["scope"]).toEqual(["src/auth/**"]);
    expect(loadRoundState(repo).pending).toHaveLength(0);
  });

  it("清单非空但与本合同无交集 → 同样自动批准（零点击）", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    const contract = store.save(pendingContract(["src/ui/**"]));

    const result = await orchestrator.admit(contract.contract_id);

    expect(result.decision).toBe("AUTO_APPROVED");
    expect(result.contract.lifecycle_state).toBe("EXECUTING");
    expect(result.protectedFiles).toEqual([]);

    const auto = silentRecords(repo).find(
      (r) => r["kind"] === "contract_auto_approved",
    );
    expect(auto?.["mode"]).toBe("PROTECTED");
    // 无交集不得产生待审批卡
    expect(loadRoundState(repo).pending).toHaveLength(0);
  });

  it("glob 与 glob 交集（src/** × src/auth/**）→ 阻断在待审批，不建 Worktree", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    const contract = store.save(pendingContract(["src/**"]));

    const result = await orchestrator.admit(contract.contract_id);

    expect(result.decision).toBe("NEEDS_APPROVAL");
    expect(result.contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(result.contract.approval.status).toBe("PENDING_REVIEW");
    expect(result.protectedFiles).toContain("src/auth/**");
    expect(result.entryNames).toContain("登录");
    expect(result.cardId).toBeTruthy();
    expect(fs.existsSync(getWorktreePath(repo, contract.contract_id))).toBe(
      false,
    );

    const state = loadRoundState(repo);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]!.id).toBe(result.cardId);
    expect(state.pending[0]!.files).toEqual(["src/auth/**"]);

    const records = silentRecords(repo);
    expect(records.some((r) => r["kind"] === "contract_pending_user")).toBe(
      true,
    );
    expect(records.some((r) => r["kind"] === "contract_auto_approved")).toBe(
      false,
    );
  });

  it("具体路径交集（src/auth/login.ts × src/auth/**）→ 阻断并列出具体文件", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    const contract = store.save(pendingContract(["src/auth/login.ts"]));

    const result = await orchestrator.admit(contract.contract_id);

    expect(result.decision).toBe("NEEDS_APPROVAL");
    expect(result.protectedFiles).toEqual(["src/auth/login.ts"]);
  });

  it("本轮已同意同一受保护文件 → 自动批准（授权不跨轮但本轮复用）", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    const contract = store.save(pendingContract(["src/auth/login.ts"]));

    const first = await orchestrator.admit(contract.contract_id);
    expect(first.decision).toBe("NEEDS_APPROVAL");
    const decided = decideApproval(repo, first.cardId!, "approve");
    expect(decided).not.toBeNull();

    const second = await orchestrator.admit(contract.contract_id);

    expect(second.decision).toBe("AUTO_APPROVED");
    expect(second.contract.lifecycle_state).toBe("EXECUTING");
    const auto = silentRecords(repo)
      .filter((r) => r["kind"] === "contract_auto_approved")
      .pop();
    expect(auto?.["mode"]).toBe("PROTECTED_AUTHORIZED");
    expect(auto?.["approved_this_round"]).toEqual(["src/auth/login.ts"]);
  });

  it("本轮已拒绝 → 直接阻断，不重复弹卡", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    const contract = store.save(pendingContract(["src/auth/login.ts"]));

    const first = await orchestrator.admit(contract.contract_id);
    decideApproval(repo, first.cardId!, "deny");

    const second = await orchestrator.admit(contract.contract_id);

    expect(second.decision).toBe("NEEDS_APPROVAL");
    expect(second.contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(second.reason).toContain("已拒绝");
    expect(second.cardId).toBeUndefined();
  });

  it("保护清单损坏 → Fail-Closed 阻断，绝不自动放行", async () => {
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".stagent", "protection.json"),
      "{ this is not json",
      "utf8",
    );
    const contract = store.save(pendingContract(["src/ui/**"]));

    const result = await orchestrator.admit(contract.contract_id);

    expect(result.decision).toBe("NEEDS_APPROVAL");
    expect(result.contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(result.reason).toContain("保护清单");
    expect(fs.existsSync(getWorktreePath(repo, contract.contract_id))).toBe(
      false,
    );

    const records = silentRecords(repo);
    expect(
      records.some((r) => r["kind"] === "contract_admission_fail_closed"),
    ).toBe(true);
    expect(records.some((r) => r["kind"] === "contract_auto_approved")).toBe(
      false,
    );
  });

  it("保护清单自锁：合同把 .stagent/protection.json 列为可写 → 阻断", async () => {
    const contract = store.save(pendingContract([".stagent/protection.json"]));

    const result = await orchestrator.admit(contract.contract_id);

    expect(result.decision).toBe("NEEDS_APPROVAL");
    expect(result.protectedFiles).toContain(".stagent/protection.json");
    expect(result.entryNames).toContain("保护清单本身");
  });

  it("幂等：合同已推进后再次 admit 返回 SKIPPED，不重复建 Worktree", async () => {
    const contract = store.save(pendingContract(["src/ui/**"]));
    const first = await orchestrator.admit(contract.contract_id);
    expect(first.decision).toBe("AUTO_APPROVED");

    const second = await orchestrator.admit(contract.contract_id);

    expect(second.decision).toBe("SKIPPED");
    expect(second.contract.lifecycle_state).toBe("EXECUTING");
    const worktrees = fs.readdirSync(path.join(repo, ".stagent", "worktrees"));
    expect(worktrees).toHaveLength(1);
  });
});

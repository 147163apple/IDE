/**
 * TASK-H.6：未确认 → 409 白话建议；确认后脏路径进排除/禁写。
 */
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDirtyAckGuidance,
  classifyDirtyPath,
  loadAcknowledgedDirtyExclusions,
  recordAcknowledgedDirtyExclusions,
} from "../../daemon/baseline/dirty-guidance";
import { loadBaselineDirtyExclusions } from "../../daemon/baseline/scope-defaults";
import { DirtyWorktreeConfirmationRequiredError } from "../../daemon/git/worktree-manager";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-h6-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      safeRmSync(d);
    } catch {
      /* ignore */
    }
  }
});

describe("TASK-H.6 dirty guidance", () => {
  it("未 acknowledge_dirty → 409 结构含可执行排除建议", () => {
    const err = new DirtyWorktreeConfirmationRequiredError([
      ".env.local",
      "scratch.tmp",
    ]);
    expect(err.message).toContain("未提交");
    expect(err.message).not.toMatch(/stack|Confirm with the user/i);
    expect(err.guidance.exclusion_suggestions.length).toBeGreaterThanOrEqual(1);
    expect(err.guidance.exclusion_suggestions.some((s) => s.action.length > 0)).toBe(
      true,
    );
    expect(classifyDirtyPath(".env.local").kind).toBe("secret");
    const g = buildDirtyAckGuidance([".env"]);
    expect(g.plain_message).toMatch(/凭证|密钥|登录/);
  });

  it("确认后脏路径出现在排除/禁写集合", async () => {
    const repo = tmp();
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    fs.writeFileSync(path.join(repo, "docs", "a.md"), "# a\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    fs.writeFileSync(path.join(repo, ".env.local"), "SECRET=1\n");

    const store = new ContractStore(repo);
    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    const draft = createContractDraft({
      title: "h6",
      description: "dirty ack",
      acceptanceCriteria: ["noop"],
      writablePaths: ["docs/**"],
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 10,
        },
      ],
    });
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    store.save(contract);

    await expect(
      orchestrator.approve(contract.contract_id, "tina"),
    ).rejects.toBeInstanceOf(DirtyWorktreeConfirmationRequiredError);

    const approved = await orchestrator.approve(contract.contract_id, "tina", {
      acknowledgeDirty: true,
    });
    expect(approved.lifecycle_state).toBe("EXECUTING");

    const ack = loadAcknowledgedDirtyExclusions(repo);
    expect(ack).toContain(".env.local");
    const merged = loadBaselineDirtyExclusions(repo);
    expect(merged).toContain(".env.local");

    // 再次记录幂等
    const again = recordAcknowledgedDirtyExclusions(repo, [".env.local"]);
    expect(again).toContain(".env.local");
  });
});

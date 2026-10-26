/**
 * 脏主仓签署：无确认 → E_WORKTREE_DIRTY；acknowledgeDirty → EXECUTING
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { DirtyWorktreeConfirmationRequiredError } from "../../daemon/git/worktree-manager";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

describe("approve + acknowledgeDirty", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ack-dirty-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    fs.writeFileSync(path.join(repo, "docs", "a.md"), "# a\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    // 脏：未跟踪文件
    fs.writeFileSync(path.join(repo, ".env.local"), "SECRET=1\n");
    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  function savePending() {
    const draft = createContractDraft({
      title: "docs only",
      description: "ack dirty walk",
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
    return contract;
  }

  it("rejects approve on dirty main without acknowledgeDirty", async () => {
    const c = savePending();
    await expect(orchestrator.approve(c.contract_id, "tina")).rejects.toBeInstanceOf(
      DirtyWorktreeConfirmationRequiredError,
    );
    const after = store.get(c.contract_id);
    expect(after?.lifecycle_state).toBe("PENDING_APPROVAL");
  });

  it("approve with acknowledgeDirty reaches EXECUTING", async () => {
    const c = savePending();
    const approved = await orchestrator.approve(c.contract_id, "tina", {
      acknowledgeDirty: true,
    });
    expect(approved.lifecycle_state).toBe("EXECUTING");
    const wt = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${c.contract_id}`,
    );
    expect(fs.existsSync(wt)).toBe(true);
    // 脏文件留在主仓，不进任务树
    expect(fs.existsSync(path.join(wt, ".env.local"))).toBe(false);
    expect(fs.existsSync(path.join(repo, ".env.local"))).toBe(true);
  });
});

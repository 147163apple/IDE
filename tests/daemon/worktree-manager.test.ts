import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import path from "node:path";
import os from "node:os";
import {
  createTaskWorktree,
  removeTaskWorktree,
  listWorktrees,
  getWorktreePath,
  assertSafeContractId,
  isRepoClean,
  execGit,
  WorktreeError,
  ensureTaskWorktree,
  resolveExistingBaseBranch,
} from "../../daemon/git/worktree-manager";
import { assertIsolatedGitCwd } from "../../daemon/git/test-isolation";

describe("Task 1.2: Git Worktree Manager Lifecycle", () => {
  let tempRepo: string;

  beforeEach(async () => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-wt-test-"));
    // 宿主仓库隔离守卫：临时仓库必须在隔离根内，否则下面的 user.name 写入
    // 可能落到开发者真实仓库的 .git/config（见 daemon/git/test-isolation.ts）
    assertIsolatedGitCwd(tempRepo);
    // Initialize a real Git repository in temp directory
    await execGit(["init", "-b", "main"], tempRepo);
    await execGit(["config", "user.name", "Stagent Test"], tempRepo);
    await execGit(["config", "user.email", "test@stagent.local"], tempRepo);

    // Initial commit
    const readmePath = path.join(tempRepo, "README.md");
    fs.writeFileSync(readmePath, "# Root Project\nInitial content\n");
    await execGit(["add", "README.md"], tempRepo);
    await execGit(["commit", "-m", "chore: initial commit"], tempRepo);
  });

  afterEach(async () => {
    try {
      safeRmSync(tempRepo);
    } catch {
      // Ignore cleanup error
    }
  });

  it("should create an isolated worktree bound to task branch", async () => {
    const contractId = "contract-001";
    const info = await createTaskWorktree({
      repoRoot: tempRepo,
      contractId,
    });

    expect(info.contractId).toBe(contractId);
    expect(info.branch).toBe("task/contract-001");
    expect(info.worktreePath).toBe(getWorktreePath(tempRepo, contractId));
    expect(fs.existsSync(info.worktreePath)).toBe(true);

    // Verify worktree is on the task branch
    const branchCheck = await execGit(
      ["branch", "--show-current"],
      info.worktreePath,
    );
    expect(branchCheck.stdout).toBe("task/contract-001");

    // Verify main repository is still on main branch
    const mainBranch = await execGit(["branch", "--show-current"], tempRepo);
    expect(mainBranch.stdout).toBe("main");
  });

  it("should isolate file modifications between worktree and main repo", async () => {
    const contractId = "contract-002";
    const info = await createTaskWorktree({
      repoRoot: tempRepo,
      contractId,
    });

    // Write a new file inside the worktree
    const worktreeFile = path.join(info.worktreePath, "src_new_feature.ts");
    fs.writeFileSync(worktreeFile, "export const feature = true;");

    // Worktree should detect untracked file
    const wtStatus = await execGit(
      ["status", "--porcelain"],
      info.worktreePath,
    );
    expect(wtStatus.stdout).toContain("src_new_feature.ts");

    // Main repo must be completely unaffected and clean
    const mainClean = await isRepoClean(tempRepo);
    expect(mainClean).toBe(true);
    expect(fs.existsSync(path.join(tempRepo, "src_new_feature.ts"))).toBe(
      false,
    );
  });

  it("should reject contract IDs with path traversal attempts", () => {
    expect(() => assertSafeContractId("../escape")).toThrow(WorktreeError);
    expect(() => assertSafeContractId("/root/escape")).toThrow(WorktreeError);
    expect(() => assertSafeContractId("contract/nested")).toThrow(
      WorktreeError,
    );
    expect(() => assertSafeContractId("contract with spaces")).toThrow(
      WorktreeError,
    );
    expect(() => assertSafeContractId("safe-contract_123")).not.toThrow();
  });

  it("should list active worktrees accurately", async () => {
    const contractId = "contract-003";
    await createTaskWorktree({
      repoRoot: tempRepo,
      contractId,
    });

    const list = await listWorktrees(tempRepo);
    expect(list.length).toBeGreaterThanOrEqual(2);

    const taskEntry = list.find((e) => e.branch?.includes("task/contract-003"));
    expect(taskEntry).toBeDefined();
    expect(taskEntry?.worktree).toBe(getWorktreePath(tempRepo, contractId));
  });

  it("should remove task worktree and clean up git administrative references", async () => {
    const contractId = "contract-004";
    const info = await createTaskWorktree({
      repoRoot: tempRepo,
      contractId,
    });

    expect(fs.existsSync(info.worktreePath)).toBe(true);

    await removeTaskWorktree({
      repoRoot: tempRepo,
      contractId,
      deleteBranch: true,
    });

    expect(fs.existsSync(info.worktreePath)).toBe(false);

    // Verify branch was deleted
    const branchCheck = await execGit(
      ["rev-parse", "--verify", "refs/heads/task/contract-004"],
      tempRepo,
    );
    expect(branchCheck.exitCode).not.toBe(0);
  });

  it("should support rebuilding existing worktree with force: true", async () => {
    const contractId = "contract-005";
    await createTaskWorktree({
      repoRoot: tempRepo,
      contractId,
    });

    // Re-creating without force should throw
    await expect(
      createTaskWorktree({
        repoRoot: tempRepo,
        contractId,
        force: false,
      }),
    ).rejects.toThrow("already exists");

    // Re-creating with force should succeed
    const rebuilt = await createTaskWorktree({
      repoRoot: tempRepo,
      contractId,
      force: true,
    });
    expect(rebuilt.contractId).toBe(contractId);
  });
});

describe("TASK-C.10p: ensureTaskWorktree for graph start/verify", () => {
  let tempRepo: string;

  beforeEach(async () => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-wt-ensure-"));
    assertIsolatedGitCwd(tempRepo);
    await execGit(["init", "-b", "main"], tempRepo);
    await execGit(["config", "user.name", "Stagent Test"], tempRepo);
    await execGit(["config", "user.email", "test@stagent.local"], tempRepo);
    fs.writeFileSync(path.join(tempRepo, "README.md"), "# Root\n");
    await execGit(["add", "README.md"], tempRepo);
    await execGit(["commit", "-m", "chore: initial"], tempRepo);
  });

  afterEach(() => {
    try {
      safeRmSync(tempRepo);
    } catch {
      /* ignore */
    }
  });

  it("reuses an existing worktree without recreating", async () => {
    const contractId = "contract_ensure_reuse";
    const created = await createTaskWorktree({
      repoRoot: tempRepo,
      contractId,
    });
    const ensured = await ensureTaskWorktree({
      repoRoot: tempRepo,
      contractId,
    });
    expect(ensured.created).toBe(false);
    expect(ensured.worktreePath).toBe(created.worktreePath);
    expect(fs.existsSync(ensured.worktreePath)).toBe(true);
  });

  it("recreates after remove (simulates MERGED cleanup)", async () => {
    const contractId = "contract_ensure_rebuild";
    await createTaskWorktree({ repoRoot: tempRepo, contractId });
    await removeTaskWorktree({
      repoRoot: tempRepo,
      contractId,
      deleteBranch: true,
    });
    expect(fs.existsSync(getWorktreePath(tempRepo, contractId))).toBe(false);

    const ensured = await ensureTaskWorktree({
      repoRoot: tempRepo,
      contractId,
      preferredBaseBranch: "main",
    });
    expect(ensured.created).toBe(true);
    expect(fs.existsSync(ensured.worktreePath)).toBe(true);
    expect(ensured.baseBranch).toBe("main");
  });

  it("falls back when preferred base branch is gone", async () => {
    const contractId = "contract_ensure_fallback";
    const resolved = await resolveExistingBaseBranch(
      tempRepo,
      "feat/deleted-base-branch",
    );
    expect(resolved).toBe("main");

    const ensured = await ensureTaskWorktree({
      repoRoot: tempRepo,
      contractId,
      preferredBaseBranch: "feat/deleted-base-branch",
    });
    expect(ensured.created).toBe(true);
    expect(ensured.baseBranch).toBe("main");
    expect(fs.existsSync(ensured.worktreePath)).toBe(true);
  });

  it("does not block on dirty main (acknowledgeDirty)", async () => {
    const contractId = "contract_ensure_dirty";
    fs.writeFileSync(path.join(tempRepo, "dirty-note.txt"), "uncommitted\n");
    const ensured = await ensureTaskWorktree({
      repoRoot: tempRepo,
      contractId,
      preferredBaseBranch: "main",
    });
    expect(ensured.created).toBe(true);
    expect(fs.existsSync(ensured.worktreePath)).toBe(true);
    // dirty file stays on main, not copied into task tree
    expect(
      fs.existsSync(path.join(ensured.worktreePath, "dirty-note.txt")),
    ).toBe(false);
  });
});

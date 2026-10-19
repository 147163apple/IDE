import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  generateTaskBranch,
  validateTaskBranchOperation,
} from "./branch-guard";

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

export interface WorktreeInfo {
  contractId: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  createdAt: string;
  /** 创建过程中的用户提示（例如主工作区存在未提交变更） */
  warnings: string[];
}

/** 主工作区存在未提交变更，需用户显式确认后才能创建 Worktree（规范 A.1 PASS-3） */
export class DirtyWorktreeConfirmationRequiredError extends WorktreeError {
  readonly dirtyFiles: string[];
  constructor(dirtyFiles: string[]) {
    super(
      `Main worktree has ${dirtyFiles.length} uncommitted change(s), which will NOT be included in the task worktree: ` +
        `${dirtyFiles.slice(0, 5).join(", ")}${dirtyFiles.length > 5 ? ", ..." : ""}. ` +
        `Confirm with the user, then retry with acknowledgeDirty: true.`,
    );
    this.name = "DirtyWorktreeConfirmationRequiredError";
    this.dirtyFiles = dirtyFiles;
  }
}

export interface WorktreeListEntry {
  worktree: string;
  head: string;
  branch?: string;
  bare?: boolean;
}

/**
 * Execute Git command in target working directory.
 */
export function execGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
      });
    });
  });
}

/**
 * Validate contract ID safety: alphanumeric, hyphen, underscore only.
 * Strictly prevents path traversal attacks like '../' or leading slashes.
 */
export function assertSafeContractId(contractId: string): void {
  if (!contractId || !/^[a-zA-Z0-9_-]+$/.test(contractId)) {
    throw new WorktreeError(
      `Invalid contract ID '${contractId}'. Only alphanumeric characters, dashes, and underscores are permitted.`,
    );
  }
}

/**
 * Get standardized physical path for task worktree.
 * Guarantees that the resulting path is strictly confined within `<repoRoot>/.stagent/worktrees/`.
 */
export function getWorktreePath(repoRoot: string, contractId: string): string {
  assertSafeContractId(contractId);
  // 规范化绝对路径：macOS 上 /var 与 /private/var 为同一物理目录，
  // 必须与 `git worktree list` 输出的 realpath 保持一致（规范 A.1 PASS-1）。
  const resolvedRoot = fs.existsSync(repoRoot)
    ? fs.realpathSync(repoRoot)
    : path.resolve(repoRoot);
  const worktreesDir = path.resolve(resolvedRoot, ".stagent", "worktrees");
  const targetPath = path.resolve(worktreesDir, `task-${contractId}`);

  // Defense-in-depth path traversal verification
  if (!targetPath.startsWith(worktreesDir + path.sep)) {
    throw new WorktreeError(
      `Path traversal detected: worktree path '${targetPath}' escapes root directory.`,
    );
  }

  return targetPath;
}

/**
 * Check if the repository working tree has uncommitted dirty changes.
 */
export async function isRepoClean(repoRoot: string): Promise<boolean> {
  const { stdout, exitCode } = await execGit(
    ["status", "--porcelain"],
    repoRoot,
  );
  if (exitCode !== 0) {
    throw new WorktreeError(
      `Failed to inspect repository status in ${repoRoot}`,
    );
  }
  return stdout.length === 0;
}

/**
 * 检查主工作区未提交变更，返回可展示给用户的明确提示（不修改、不复制、不 reset）。
 */
export async function inspectMainWorktree(
  repoRoot: string,
): Promise<{ clean: boolean; files: string[]; warning?: string }> {
  const { stdout, exitCode } = await execGit(
    ["status", "--porcelain"],
    repoRoot,
  );
  if (exitCode !== 0) {
    throw new WorktreeError(
      `Failed to inspect repository status in ${repoRoot}`,
    );
  }
  const files = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[A-Z?!]{1,2}\s+/, ""));

  if (files.length === 0) return { clean: true, files: [] };
  return {
    clean: false,
    files,
    warning: `主工作区存在 ${files.length} 项未提交变更，这些修改不会包含在任务 Worktree 中；任务将基于合同 base_branch 的 HEAD 独立检出。`,
  };
}

/**
 * Create an isolated Git Worktree for a contract task.
 * 1. Checks host repository dirty status and requires explicit user acknowledgement.
 * 2. Prunes any stale worktree references.
 * 3. Creates worktree at `.stagent/worktrees/task-{contractId}` bound to `task/{contractId}` branch.
 */

/**
 * Ensure .stagent/ is registered in .git/info/exclude so it never dirties
 * the host repository git status, without modifying tracked .gitignore.
 */
export function ensureStagentExcluded(repoRoot: string): void {
  const resolvedRoot = path.resolve(repoRoot);
  const excludePath = path.resolve(resolvedRoot, ".git", "info", "exclude");
  if (fs.existsSync(path.dirname(excludePath))) {
    let content = "";
    if (fs.existsSync(excludePath)) {
      content = fs.readFileSync(excludePath, "utf-8");
    }
    if (!content.includes(".stagent")) {
      fs.appendFileSync(
        excludePath,
        "\n# Stagent runtime\n.stagent/\n",
        "utf-8",
      );
    }
  }
}

export async function createTaskWorktree(options: {
  repoRoot: string;
  contractId: string;
  baseBranch?: string;
  force?: boolean;
  /** 用户已确认「主工作区未提交变更不纳入任务」，才允许在脏工作区上继续 */
  acknowledgeDirty?: boolean;
}): Promise<WorktreeInfo> {
  const {
    repoRoot,
    contractId,
    baseBranch = "HEAD",
    force = false,
    acknowledgeDirty = false,
  } = options;
  const resolvedRoot = path.resolve(repoRoot);
  const worktreePath = getWorktreePath(resolvedRoot, contractId);
  const branch = generateTaskBranch(contractId);

  validateTaskBranchOperation(branch);
  // 先注册 .stagent/ 排除，再做脏检查，避免自建目录被误判为用户未提交变更
  ensureStagentExcluded(resolvedRoot);

  // 规范 A.1 PASS-3：脏工作区必须提示并等待用户确认，绝不静默复制或 reset
  const inspection = await inspectMainWorktree(resolvedRoot);
  if (!inspection.clean && !acknowledgeDirty) {
    throw new DirtyWorktreeConfirmationRequiredError(inspection.files);
  }
  const warnings = inspection.warning ? [inspection.warning] : [];

  const worktreesDir = path.dirname(worktreePath);
  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true });
  }

  // Prune any stale worktree references first
  await execGit(["worktree", "prune"], resolvedRoot);

  // If path already exists or is locked
  if (fs.existsSync(worktreePath)) {
    if (!force) {
      throw new WorktreeError(
        `Worktree path already exists at '${worktreePath}'. Use force=true to rebuild.`,
      );
    }
    // Force cleanup existing worktree
    await execGit(
      ["worktree", "remove", "--force", worktreePath],
      resolvedRoot,
    );
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    await execGit(["worktree", "prune"], resolvedRoot);
  }

  // Check if branch already exists
  const branchCheck = await execGit(
    ["rev-parse", "--verify", `refs/heads/${branch}`],
    resolvedRoot,
  );
  const branchExists = branchCheck.exitCode === 0;

  if (branchExists && force) {
    await execGit(["branch", "-D", branch], resolvedRoot);
  }

  const addArgs = ["worktree", "add"];
  if (branchExists && !force) {
    // Check out existing branch
    addArgs.push(worktreePath, branch);
  } else {
    // Create new task branch from baseBranch
    addArgs.push("-b", branch, worktreePath, baseBranch);
  }

  const result = await execGit(addArgs, resolvedRoot);
  if (result.exitCode !== 0) {
    throw new WorktreeError(
      `Failed to create git worktree at '${worktreePath}': ${result.stderr || result.stdout}`,
    );
  }

  return {
    contractId,
    worktreePath,
    branch,
    baseBranch,
    createdAt: new Date().toISOString(),
    warnings,
  };
}

/**
 * Remove task worktree and clean up references.
 */
export async function removeTaskWorktree(options: {
  repoRoot: string;
  contractId: string;
  force?: boolean;
  deleteBranch?: boolean;
}): Promise<void> {
  const { repoRoot, contractId, force = true, deleteBranch = false } = options;
  const resolvedRoot = path.resolve(repoRoot);
  const worktreePath = getWorktreePath(resolvedRoot, contractId);
  const branch = generateTaskBranch(contractId);

  const removeArgs = ["worktree", "remove"];
  if (force) {
    removeArgs.push("--force");
  }
  removeArgs.push(worktreePath);

  await execGit(removeArgs, resolvedRoot);

  if (fs.existsSync(worktreePath)) {
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // Ignore removal errors
    }
  }

  await execGit(["worktree", "prune"], resolvedRoot);

  if (deleteBranch) {
    await execGit(["branch", "-D", branch], resolvedRoot);
  }
}

/**
 * List all active worktrees registered with the repository.
 */
export async function listWorktrees(
  repoRoot: string,
): Promise<WorktreeListEntry[]> {
  const resolvedRoot = path.resolve(repoRoot);
  const { stdout, exitCode, stderr } = await execGit(
    ["worktree", "list", "--porcelain"],
    resolvedRoot,
  );

  if (exitCode !== 0) {
    throw new WorktreeError(`Failed to list worktrees: ${stderr}`);
  }

  const entries: WorktreeListEntry[] = [];
  const blocks = stdout.split("\n\n").filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    let currentWorktree = "";
    let currentHead = "";
    let currentBranch: string | undefined;
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        currentWorktree = line.substring("worktree ".length).trim();
      } else if (line.startsWith("HEAD ")) {
        currentHead = line.substring("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        currentBranch = line.substring("branch ".length).trim();
      } else if (line === "bare") {
        isBare = true;
      }
    }

    if (currentWorktree) {
      const entry: WorktreeListEntry = {
        worktree: currentWorktree,
        head: currentHead,
      };
      if (currentBranch) {
        entry.branch = currentBranch;
      }
      if (isBare) {
        entry.bare = true;
      }
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Run git worktree prune to discard stale administrative data.
 */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  const resolvedRoot = path.resolve(repoRoot);
  await execGit(["worktree", "prune"], resolvedRoot);
}

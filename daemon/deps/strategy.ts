import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  probeWriteProtection,
  type WriteProtectionProbe,
} from "./write-protection-probe";

/**
 * 依赖复用决策（规范 TASK-A.3 / ADR-002）。
 * 顺序：锁文件一致性 → 写保护可证明 → 才允许共享只读依赖视图；
 * 任一条件不满足则降级为 Worktree 独立安装，需要变更依赖时要求用户授权。
 */

export type DependencyStrategy = "SHARED_SYMLINK" | "ISOLATED_INSTALL";

export interface LockfileCheck {
  name: string | null;
  hostHash: string | null;
  worktreeHash: string | null;
  consistent: boolean;
}

export interface DependencyPlan {
  strategy: DependencyStrategy;
  reasons: string[];
  probe: WriteProtectionProbe;
  lockfile: LockfileCheck;
  hostNodeModulesExists: boolean;
  requiresAuthorization: boolean;
}

const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];

function firstLockfile(dir: string): string | null {
  for (const name of LOCKFILES) {
    if (fs.existsSync(path.join(dir, name))) return name;
  }
  return null;
}

function readFileOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

export async function planDependencyStrategy(options: {
  repoRoot: string;
  worktreePath: string;
  probeFn?: (dir: string) => Promise<WriteProtectionProbe>;
}): Promise<DependencyPlan> {
  const repoRoot = path.resolve(options.repoRoot);
  const worktreePath = path.resolve(options.worktreePath);
  const reasons: string[] = [];

  // 1. 锁文件一致性（主工作区 vs 任务 Worktree）
  const name = firstLockfile(repoRoot);
  const hostLock = name ? readFileOrNull(path.join(repoRoot, name)) : null;
  const worktreeLock = name
    ? readFileOrNull(path.join(worktreePath, name))
    : null;
  const consistent =
    name !== null &&
    hostLock !== null &&
    worktreeLock !== null &&
    hostLock === worktreeLock;

  if (!name) {
    reasons.push("No lockfile found in host repository");
  } else if (worktreeLock === null) {
    reasons.push(`Worktree is missing lockfile '${name}'`);
  } else if (!consistent) {
    reasons.push(`Lockfile '${name}' differs between host and worktree`);
  }

  // 2. 写保护可证明性
  const probeFn = options.probeFn ?? probeWriteProtection;
  const probe = await probeFn(path.join(repoRoot, ".stagent"));
  if (!probe.proven) {
    reasons.push(probe.reason ?? "Write protection could not be proven");
  }

  // 3. 主目录依赖是否存在
  const hostNodeModulesExists = fs.existsSync(
    path.join(repoRoot, "node_modules"),
  );
  if (!hostNodeModulesExists) {
    reasons.push("Host node_modules does not exist");
  }

  const strategy: DependencyStrategy =
    consistent && probe.proven && hostNodeModulesExists
      ? "SHARED_SYMLINK"
      : "ISOLATED_INSTALL";

  return {
    strategy,
    reasons,
    probe,
    lockfile: {
      name,
      hostHash: hostLock ? hash(hostLock) : null,
      worktreeHash: worktreeLock ? hash(worktreeLock) : null,
      consistent,
    },
    hostNodeModulesExists,
    // 需要变更依赖（锁文件不一致/缺失）时必须由用户显式授权
    requiresAuthorization: !consistent,
  };
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
export interface InstallResult {
  success: boolean;
  command: string;
  args: string[];
  durationMs: number;
  output?: string;
}

export type InstallRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<{ code: number; output?: string }>;

/**
 * 降级路径：在 Worktree 内执行隔离安装（不使用主目录缓存写入，不污染主工程）。
 * 调用方需先确认 plan.requiresAuthorization 的授权提示。
 */
export async function runIsolatedInstall(options: {
  worktreePath: string;
  runner: InstallRunner;
}): Promise<InstallResult> {
  const worktreePath = path.resolve(options.worktreePath);
  const manager = fs.existsSync(path.join(worktreePath, "pnpm-lock.yaml"))
    ? "pnpm"
    : fs.existsSync(path.join(worktreePath, "yarn.lock"))
      ? "yarn"
      : "npm";

  const command = manager;
  const args =
    manager === "npm"
      ? ["ci", "--no-audit", "--no-fund"]
      : manager === "pnpm"
        ? ["install", "--frozen-lockfile"]
        : ["install", "--immutable"];

  const start = performance.now();
  const result = await options.runner(command, args, worktreePath);
  return {
    success: result.code === 0,
    command,
    args,
    durationMs: Math.round(performance.now() - start),
    ...(result.output === undefined ? {} : { output: result.output }),
  };
}

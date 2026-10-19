import fs from "node:fs";
import path from "node:path";
import {
  probeWriteProtection,
  type WriteProtectionProbe,
} from "./write-protection-probe";

export interface DependencyMountResult {
  success: boolean;
  durationMs: number;
  targetPath: string;
  linkPath: string;
  warning?: string;
  /** 写保护探测结果（规范 TASK-A.3 PASS-2） */
  probe?: WriteProtectionProbe;
}

/**
 * Mount the host repository's node_modules into the task worktree via zero-copy symlink.
 * 规范 A.3 PASS-2：必须先证明文件系统会拦截对只读目录的写入，才允许建立共享视图。
 */
export async function mountDependencySymlink(options: {
  repoRoot: string;
  worktreePath: string;
  requireWriteProtectionProof?: boolean;
  probeFn?: (dir: string) => Promise<WriteProtectionProbe>;
}): Promise<DependencyMountResult> {
  const startTime = performance.now();
  const hostNodeModules = path.resolve(options.repoRoot, "node_modules");
  const worktreeNodeModules = path.resolve(
    options.worktreePath,
    "node_modules",
  );

  if (!fs.existsSync(hostNodeModules)) {
    const durationMs = Math.round(performance.now() - startTime);
    return {
      success: false,
      durationMs,
      targetPath: hostNodeModules,
      linkPath: worktreeNodeModules,
      warning: `Host node_modules does not exist at '${hostNodeModules}'. Cannot mount dependency symlink.`,
    };
  }

  // 写保护前置探测（默认强制）
  const requireProof = options.requireWriteProtectionProof ?? true;
  if (requireProof) {
    const probeFn = options.probeFn ?? probeWriteProtection;
    const probe = await probeFn(path.resolve(options.repoRoot, ".stagent"));
    if (!probe.proven) {
      const durationMs = Math.round(performance.now() - startTime);
      return {
        success: false,
        durationMs,
        targetPath: hostNodeModules,
        linkPath: worktreeNodeModules,
        probe,
        warning:
          `WRITE_PROTECTION_UNPROVEN: ${probe.reason ?? "cannot prove read-only enforcement"}. ` +
          "Fallback to isolated install required (ADR-002).",
      };
    }
  }

  // If worktree already has a node_modules entry (stale link or dir)
  if (
    fs.existsSync(worktreeNodeModules) ||
    fs.lstatSync(worktreeNodeModules, { throwIfNoEntry: false })
  ) {
    const stat = fs.lstatSync(worktreeNodeModules, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) {
      fs.unlinkSync(worktreeNodeModules);
    } else if (stat?.isDirectory()) {
      fs.rmSync(worktreeNodeModules, { recursive: true, force: true });
    }
  }

  // Create zero-copy symlink (junction on Windows, dir on Unix)
  const symlinkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(hostNodeModules, worktreeNodeModules, symlinkType);

  const durationMs = Math.round(performance.now() - startTime);

  return {
    success: true,
    durationMs,
    targetPath: hostNodeModules,
    linkPath: worktreeNodeModules,
  };
}

/**
 * Safely unmount/remove dependency symlink from the worktree.
 * Never touches the host repository's actual node_modules directory.
 */
export async function unmountDependencySymlink(
  worktreePath: string,
): Promise<boolean> {
  const worktreeNodeModules = path.resolve(worktreePath, "node_modules");
  const stat = fs.lstatSync(worktreeNodeModules, { throwIfNoEntry: false });

  if (!stat) {
    return true;
  }

  if (stat.isSymbolicLink()) {
    fs.unlinkSync(worktreeNodeModules);
    return true;
  }

  return false;
}

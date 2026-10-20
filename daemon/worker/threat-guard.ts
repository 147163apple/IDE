import fs from "node:fs";
import path from "node:path";

/**
 * TASK-W.4：执行前威胁守卫（G-01 / G-20）。
 *
 * 在**任何子进程创建之前**校验：
 * 1. 仓库信任标记（`.stagent/trust.json` 或 git worktree 的 `.git`）；
 * 2. 特权/系统管理命令（sudo/chown/mount/insmod…）；
 * 3. 访问 Worktree 之外的主机路径（绝对路径、`~`、`..` 逃逸）；
 * 4. 无法限制子进程的命令（nohup/setsid/daemon/tmux…）。
 *
 * 任一命中抛 `E_UNSAFE_EXECUTION`，调用方（orchestrator）据此跳过 gateway，
 * 因此不会产生任何子进程。
 */

export const E_UNSAFE_EXECUTION = "E_UNSAFE_EXECUTION";

export type ThreatCategory =
  | "UNTRUSTED_REPO"
  | "PRIVILEGED_COMMAND"
  | "HOST_PATH_ACCESS"
  | "UNBOUNDED_SUBPROCESS";

export interface ThreatAssessment {
  allowed: boolean;
  category?: ThreatCategory;
  reason: string;
}

export class ThreatGuardError extends Error {
  readonly code = E_UNSAFE_EXECUTION;
  readonly category: ThreatCategory;

  constructor(category: ThreatCategory, reason: string) {
    super(`[${E_UNSAFE_EXECUTION}] ${reason}`);
    this.name = "ThreatGuardError";
    this.category = category;
  }
}

/** 特权 / 系统管理命令：直接拒绝 */
const PRIVILEGED = new Set([
  "sudo",
  "su",
  "doas",
  "chown",
  "chgrp",
  "chmod",
  "insmod",
  "rmmod",
  "modprobe",
  "mount",
  "umount",
  "systemctl",
  "launchctl",
  "diskutil",
  "dd",
  "mkfs",
  "iptables",
  "pfctl",
  "nvram",
  "shutdown",
  "reboot",
]);

/** 无法限制子进程（自守护/脱离会话）的命令 */
const UNBOUNDED = new Set([
  "nohup",
  "setsid",
  "daemon",
  "daemonize",
  "screen",
  "tmux",
  "systemd-run",
  "start",
  "at",
  "batch",
]);

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** 仓库信任标记：显式 trust.json，或 git worktree 的 .git */
export function trustMarkerPath(repoRoot: string): string {
  return path.join(repoRoot, ".stagent", "trust.json");
}

export function isRepoTrusted(repoRoot: string): boolean {
  try {
    const raw = fs.readFileSync(trustMarkerPath(repoRoot), "utf-8");
    const parsed = JSON.parse(raw) as { trusted?: unknown };
    if (parsed.trusted === true) return true;
  } catch {
    // 没有显式标记时回退到 git 仓库标记
  }
  return fs.existsSync(path.join(repoRoot, ".git"));
}

function normalizeExecutable(executable: string): string {
  const base = executable.split(/[\\/]/).pop() ?? executable;
  return base.toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
}

const HOST_PATH_PREFIXES = ["/", "~", "C:\\", "c:\\", "\\\\"];

/**
 * 纯函数评估：不触碰子进程，可在执行前安全调用。
 * `repoTrusted` 由调用方用 `isRepoTrusted` 计算，便于测试与审计。
 */
export function assessCommandThreat(params: {
  executable: string;
  args: readonly string[];
  worktreeRoot: string;
  repoTrusted: boolean;
}): ThreatAssessment {
  if (!params.repoTrusted) {
    return {
      allowed: false,
      category: "UNTRUSTED_REPO",
      reason:
        "仓库缺少信任标记：请先在 Stagent 中确认信任该仓库，再允许执行验证命令",
    };
  }

  const name = normalizeExecutable(params.executable);
  if (PRIVILEGED.has(name)) {
    return {
      allowed: false,
      category: "PRIVILEGED_COMMAND",
      reason: `特权/系统管理命令被拒绝：${name} 不允许在合同执行中运行`,
    };
  }
  if (UNBOUNDED.has(name)) {
    return {
      allowed: false,
      category: "UNBOUNDED_SUBPROCESS",
      reason: `无法可靠回收子进程的命令被拒绝：${name} 会脱离受控进程树`,
    };
  }

  const root = path.resolve(params.worktreeRoot);
  for (const rawArg of params.args) {
    // 选项值也可能带主机路径（--prefix=/tmp），先取出 = 之后的部分
    const arg = rawArg.includes("=")
      ? (rawArg.split("=").slice(1).join("=") ?? rawArg)
      : rawArg;
    if (arg.startsWith("-") && !rawArg.includes("=")) continue;
    if (HOST_PATH_PREFIXES.some((prefix) => arg.startsWith(prefix))) {
      const target = path.resolve(root, arg);
      if (!isWithin(root, target)) {
        return {
          allowed: false,
          category: "HOST_PATH_ACCESS",
          reason: `命令参数试图访问 Worktree 之外的主机路径：${rawArg}`,
        };
      }
    }
    if (arg.split(/[\\/]/).includes("..")) {
      const target = path.resolve(root, arg);
      if (!isWithin(root, target)) {
        return {
          allowed: false,
          category: "HOST_PATH_ACCESS",
          reason: `命令参数试图通过 .. 逃逸 Worktree：${rawArg}`,
        };
      }
    }
  }

  return { allowed: true, reason: "ok" };
}

export function assertCommandSafe(params: {
  executable: string;
  args: readonly string[];
  worktreeRoot: string;
  repoTrusted: boolean;
}): void {
  const assessment = assessCommandThreat(params);
  if (!assessment.allowed) {
    throw new ThreatGuardError(
      assessment.category ?? "PRIVILEGED_COMMAND",
      assessment.reason,
    );
  }
}

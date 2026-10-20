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

/** 包装命令：真正的执行目标是后面的命令词 */
const WRAPPERS = new Set([
  "env",
  "xargs",
  "nice",
  "timeout",
  "caffeinate",
  "command",
]);

/** shell 的 -c 参数：后面第一个词同样要过特权检查 */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

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

/**
 * 取包装命令/shell -c 后面的真实命令词。
 * 支持 env/xargs/nice/timeout/caffeinate/command 的常见选项形态；
 * shell 的 `-c "sudo ls"` 取字符串里的第一个词。
 */
function effectiveExecutables(
  executable: string,
  args: readonly string[],
): string[] {
  const names: string[] = [];
  let current = normalizeExecutable(executable);
  let rest = [...args];
  const seen = new Set<string>();

  for (let depth = 0; depth < 5; depth += 1) {
    names.push(current);
    if (seen.has(current)) break;
    seen.add(current);

    if (SHELLS.has(current)) {
      const cIndex = rest.indexOf("-c");
      if (cIndex >= 0) {
        const script = rest[cIndex + 1] ?? "";
        const inner = script.trim().split(/\s+/)[0] ?? "";
        if (inner) {
          current = normalizeExecutable(inner);
          rest = [];
          continue;
        }
      }
      break;
    }

    if (!WRAPPERS.has(current)) break;

    // 跳过包装器自身选项与变长参数
    let index = 0;
    while (index < rest.length && rest[index]?.startsWith("-")) {
      index += 1;
    }
    if (current === "timeout") {
      // 第一个位置参数是时长，第二个才是命令
      index += 1;
    }
    if (current === "nice" && rest[index - 1] === "-n") {
      index += 1;
    }
    if (current === "env") {
      // 跳过 VAR=value
      while (index < rest.length && rest[index]?.includes("=")) index += 1;
    }
    const next = rest[index];
    if (!next) break;
    current = normalizeExecutable(next);
    rest = rest.slice(index + 1);
  }
  return names;
}

function isExistingOrFileLikePath(arg: string): boolean {
  if (!arg.startsWith("/")) return false;
  if (fs.existsSync(arg)) return true;
  const segments = arg.split("/").filter(Boolean);
  return segments.length >= 2 || arg.endsWith("/");
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

  const names = effectiveExecutables(params.executable, params.args);
  for (const name of names) {
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
  }

  const root = path.resolve(params.worktreeRoot);
  const hostPath = (candidate: string): ThreatAssessment | null => {
    const target = path.resolve(root, candidate);
    if (!isWithin(root, target)) {
      return {
        allowed: false,
        category: "HOST_PATH_ACCESS",
        reason: `命令参数试图访问 Worktree 之外的主机路径：${candidate}`,
      };
    }
    return null;
  };

  // chmod 只在目标位于 Worktree 外时拒绝（Worktree 内改权限是合法的）
  if (normalizeExecutable(params.executable) === "chmod") {
    const positional = params.args.filter((a) => !a.startsWith("-"));
    const modeLike = /^([0-7]{3,4}|[ugoa]*[+=,-][rwxXst]*)$/;
    const targets = positional.filter(
      (arg, index) => index > 0 || !modeLike.test(arg),
    );
    for (const target of targets) {
      const violation = hostPath(target);
      if (violation) return violation;
    }
    return { allowed: true, reason: "ok" };
  }

  for (const rawArg of params.args) {
    // 选项值也可能带主机路径（--prefix=/tmp），先取出 = 之后的部分
    const arg = rawArg.includes("=")
      ? (rawArg.split("=").slice(1).join("=") ?? rawArg)
      : rawArg;
    if (arg.startsWith("-") && !rawArg.includes("=")) continue;
    if (
      arg.startsWith("~") ||
      arg.startsWith("\\\\") ||
      /^[A-Za-z]:\\/.test(arg)
    ) {
      const violation = hostPath(arg);
      if (violation) return violation;
    }
    if (isExistingOrFileLikePath(arg)) {
      const violation = hostPath(arg);
      if (violation) return violation;
    }
    if (arg.split(/[\\/]/).includes("..")) {
      const violation = hostPath(arg);
      if (violation) return violation;
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

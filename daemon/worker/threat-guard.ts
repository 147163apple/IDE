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

function shellScriptIndex(args: readonly string[]): number {
  for (let i = 0; i < args.length; i += 1) {
    // -c / -lc / -ec 等合并短选项
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(args[i] as string)) return i + 1;
  }
  return -1;
}

/** 按 ; && || | 拆分，并跳过脚本开头的 VAR=value 赋值 */
function splitShellSegments(script: string): string[][] {
  const withoutAssignments = script.replace(
    /^(\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s;|&]+)\s*)+/,
    "",
  );
  return withoutAssignments
    .split(/(?:;|&&|\|\||\|)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.split(/\s+/));
}

/** 包装器自身需要吞掉值的选项 */
const OPTION_VALUE_FLAGS: Record<string, Set<string>> = {
  timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
  env: new Set(["-u", "--unset", "-C", "--chdir"]),
  nice: new Set(["-n", "--adjustment"]),
  xargs: new Set(["-I", "-n", "-P", "-L", "-s"]),
};

/**
 * 取包装命令/shell -c 后面的真实命令词。
 * 支持 env/xargs/nice/timeout/caffeinate/command 的常见选项形态；
 * shell 的 `-c`/`-lc`/`-ec` 会拆段并逐段检查，脚本内包装命令继续展开。
 */
function effectiveExecutables(
  executable: string,
  args: readonly string[],
  depth = 0,
): string[] {
  if (depth > 6) return [];
  const names: string[] = [];
  const current = normalizeExecutable(executable);
  names.push(current);

  if (SHELLS.has(current)) {
    const scriptIndex = shellScriptIndex(args);
    if (scriptIndex >= 0) {
      const script = args[scriptIndex] ?? "";
      for (const tokens of splitShellSegments(script)) {
        const [inner, ...rest] = tokens;
        if (!inner) continue;
        names.push(...effectiveExecutables(inner, rest, depth + 1));
      }
    }
    return names;
  }

  if (!WRAPPERS.has(current)) {
    // npx/bunx 后面的包名同样按可执行命令检查
    if (current === "npx" || current === "bunx") {
      const pkg = args.find((arg) => !arg.startsWith("-"));
      if (pkg) names.push(normalizeExecutable(pkg));
    }
    return names;
  }

  let index = 0;
  const valueFlags = OPTION_VALUE_FLAGS[current] ?? new Set<string>();
  while (index < args.length && args[index]?.startsWith("-")) {
    const flag = args[index] as string;
    index += valueFlags.has(flag) ? 2 : 1;
  }
  if (current === "timeout") {
    // timeout 的第一个位置参数是时长，之后才是命令
    index += 1;
  }
  if (current === "env") {
    while (index < args.length && (args[index] as string).includes("=")) {
      index += 1;
    }
  }
  const next = args[index];
  if (next) {
    names.push(...effectiveExecutables(next, args.slice(index + 1), depth + 1));
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
  const viaLauncher = names[0] === "npx" || names[0] === "bunx";
  for (const name of names) {
    if (PRIVILEGED.has(name) || (viaLauncher && name === "chmod")) {
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

  for (let index = 0; index < params.args.length; index += 1) {
    const rawArg = params.args[index] as string;
    // vitest -t / --grep 后紧跟的是测试名模式，不是路径
    if (rawArg === "-t" || rawArg === "--grep") {
      index += 1;
      continue;
    }
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

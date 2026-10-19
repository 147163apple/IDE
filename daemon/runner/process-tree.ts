import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 进程树彻底回收（规范 §6.3 异常 3 的加固实现）。
 *
 * 现实约束：
 * - 仅 kill(child.pid) 只能终结直接子进程。测试命令常会 fork 出 dev server、
 *   watcher、fixture 进程等后代；它们会脱离父进程被 init/launchd 托管，
 *   继续占用端口与文件锁，导致下一轮验证出现假性 EADDRINUSE。
 * - setsid / double-fork / detached 后代会逃离进程组，只能按「组」或
 *   「树」整体终结，且必须事后确认退出。
 *
 * 双方案：
 * - Unix（Linux/macOS）：spawn 时 detached: true 让子进程成为进程组组长
 *   （pgid === pid），随后 process.kill(-pid, SIGTERM|SIGKILL) 一次性覆盖
 *   该组内的所有后代（后代被托孤后 pgid 不变，仍可被组信号命中）。
 * - Windows：无进程组信号，使用 taskkill /pid <pid> /T [/F] 递归结束进程树。
 */

/** SIGTERM 后到 SIGKILL 的宽限期（与规范一致） */
export const DEFAULT_KILL_GRACE_MS = 3_000;
/** SIGKILL 后确认进程组消失的等待上限 */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 2_000;
const POLL_INTERVAL_MS = 100;

export interface ProcessTreeKillResult {
  /** 最终使用的信号（Windows 上为等价的 taskkill /F） */
  signal: "SIGTERM" | "SIGKILL";
  /** 是否在时限内确认整棵树已退出 */
  confirmed: boolean;
  elapsedMs: number;
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException)?.code === code;
}

/** 向整个进程树发送信号（UNIX 进程组 / Windows taskkill /T） */
function signalProcessTree(pid: number, force: boolean): void {
  if (process.platform === "win32") {
    const args = force
      ? ["/pid", String(pid), "/T", "/F"]
      : ["/pid", String(pid), "/T"];
    const taskkill = execFile("taskkill", args, () => {
      // taskkill 在目标已退出时返回非零，忽略
    });
    taskkill.unref?.();
    return;
  }

  const signal: NodeJS.Signals = force ? "SIGKILL" : "SIGTERM";
  try {
    // 负 pid = 整个进程组
    process.kill(-pid, signal);
  } catch (err) {
    if (isErrno(err, "ESRCH")) {
      // 进程组已不存在，退化为单进程信号
      try {
        process.kill(pid, signal);
      } catch {
        // 已退出
      }
    }
  }
}

/**
 * 进程树是否仍存活（以进程组为单位判定，含被托孤的后代进程）。
 */
export async function isProcessTreeAlive(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("tasklist", [
        "/FI",
        `PID eq ${pid}`,
        "/NH",
      ]);
      return stdout.includes(String(pid));
    } catch {
      return false;
    }
  }

  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    if (isErrno(err, "EPERM")) return true;
    if (isErrno(err, "ESRCH")) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/** 轮询等待进程树退出，返回是否已在时限内退出 */
export async function waitForProcessTreeExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const alive = await isProcessTreeAlive(pid);
    if (!alive) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * 彻底终结进程树：SIGTERM →（宽限后仍存活）SIGKILL → 确认退出。
 * Windows 上等价为 taskkill /T → taskkill /T /F。
 */
export async function killProcessTree(
  pid: number,
  options: {
    graceMs?: number;
    confirmTimeoutMs?: number;
  } = {},
): Promise<ProcessTreeKillResult> {
  const graceMs = options.graceMs ?? DEFAULT_KILL_GRACE_MS;
  const confirmTimeoutMs =
    options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  const start = Date.now();

  signalProcessTree(pid, false);
  let confirmed = await waitForProcessTreeExit(pid, graceMs);
  let signal: "SIGTERM" | "SIGKILL" = "SIGTERM";

  if (!confirmed) {
    signalProcessTree(pid, true);
    signal = "SIGKILL";
    confirmed = await waitForProcessTreeExit(pid, confirmTimeoutMs);
    if (!confirmed) {
      // 最后一次尝试并如实上报未确认（调用方应据此告警）
      signalProcessTree(pid, true);
    }
  }

  return { signal, confirmed, elapsedMs: Date.now() - start };
}

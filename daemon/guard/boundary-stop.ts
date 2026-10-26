/**
 * TASK-C.12c / EO-02·07：越界原子拦截序列。
 *
 * 触发越界 / 强制中断：
 * 1. 阻断当次 IO（由调用方先完成）
 * 2. 对施工子进程发 SIGINT，软停等待 softStopMs（默认 3s）释锁
 * 3. 超时未退出 → SIGKILL
 * 4. 吊销 exec_token
 * 5. 清理 .git/index.lock（及 worktree 等价锁）
 * 6. 任务进入 PAUSED（由调用方推进状态机 + 弹窗）
 *
 * 禁止静默放行；禁止把「默认立刻 kill -9 整树」当唯一路径。
 * 测试可注入 hooks（signal/wait/kill/clearLock/revoke）避免真 SIG。
 */
import fs from "node:fs";
import path from "node:path";
import type { ExecTokenStore } from "../core/exec-token";
import { cleanupStaleGitLocks } from "../recovery/git-lock";

export const BOUNDARY_SOFT_STOP_MS = 3_000;

export type BoundarySignal = "SIGINT" | "SIGKILL";

export interface BoundaryStopHooks {
  /** 向目标进程发信号；默认 process.kill */
  signalProcess?: (pid: number, signal: BoundarySignal) => void;
  /** 等待进程退出；返回是否已退出。测试可立刻返回 false/true */
  waitForExit?: (pid: number, timeoutMs: number) => Promise<boolean>;
  /** 清锁；默认清理 repo + worktree 的 index.lock */
  clearLocks?: (repoRoot: string, worktreePath?: string) => string[];
  /** 吊销；默认走 ExecTokenStore.revokeExecToken */
  revoke?: (contractId: string) => boolean;
  softStopMs?: number;
}

export interface BoundaryStopInput {
  contract_id: string;
  repoRoot: string;
  /** 施工子进程 pid；缺省则跳过信号步骤，仍吊销+清锁 */
  workerPid?: number | null;
  worktreePath?: string | undefined;
  tokenStore: ExecTokenStore;
  hooks?: BoundaryStopHooks;
}

export interface BoundaryStopResult {
  soft_signaled: boolean;
  hard_killed: boolean;
  exited_within_soft_stop: boolean;
  token_revoked: boolean;
  locks_cleared: string[];
  soft_stop_ms: number;
  /** 固定序列标记，便于断言「不是立刻 kill-only」 */
  sequence: readonly [
    "BLOCK_IO",
    "SIGINT_SOFT_STOP",
    "SIGKILL_IF_NEEDED",
    "REVOKE_EXEC_TOKEN",
    "CLEAR_INDEX_LOCK",
    "ENTER_PAUSED",
  ];
}

function defaultSignal(pid: number, signal: BoundarySignal): void {
  try {
    process.kill(pid, signal);
  } catch {
    // ESRCH 等：进程已不在
  }
}

async function defaultWait(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const poll = 50;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, poll));
  }
}

/** 强制清掉 index.lock（越界收尾；忽略「太新」保护） */
export function forceClearIndexLocks(
  repoRoot: string,
  worktreePath?: string,
): string[] {
  const removed: string[] = [];
  const candidates = [
    path.join(path.resolve(repoRoot), ".git", "index.lock"),
  ];
  if (worktreePath) {
    candidates.push(path.join(path.resolve(worktreePath), ".git", "index.lock"));
    // worktree 常见：主仓 .git/worktrees/<name>/index.lock
    const wtGit = path.join(path.resolve(worktreePath), ".git");
    try {
      if (fs.existsSync(wtGit) && fs.statSync(wtGit).isFile()) {
        const gitdir = fs.readFileSync(wtGit, "utf8").trim();
        const m = /^gitdir:\s*(.+)$/i.exec(gitdir);
        if (m?.[1]) {
          candidates.push(path.join(m[1].trim(), "index.lock"));
        }
      }
    } catch {
      // ignore
    }
  }
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        removed.push(file);
      }
    } catch {
      // ignore
    }
  }
  // 附带陈旧锁清理（minAgeMs=0：越界收尾立即清）
  try {
    const extra = cleanupStaleGitLocks(repoRoot, { minAgeMs: 0 });
    removed.push(...extra.removed);
  } catch {
    // ignore
  }
  return removed;
}

/**
 * 执行原子拦截序列。调用方须先阻断当次 IO，并在返回后把合同推入 PENDING_RESUME / PAUSED。
 */
export async function runBoundaryStop(
  input: BoundaryStopInput,
): Promise<BoundaryStopResult> {
  const softStopMs = input.hooks?.softStopMs ?? BOUNDARY_SOFT_STOP_MS;
  const signalFn = input.hooks?.signalProcess ?? defaultSignal;
  const waitFn = input.hooks?.waitForExit ?? defaultWait;
  const clearFn = input.hooks?.clearLocks ?? forceClearIndexLocks;
  const revokeFn =
    input.hooks?.revoke ??
    ((id: string) => input.tokenStore.revokeExecToken(id));

  let soft_signaled = false;
  let hard_killed = false;
  let exited_within_soft_stop = true;

  const pid = input.workerPid;
  if (typeof pid === "number" && pid > 0) {
    signalFn(pid, "SIGINT");
    soft_signaled = true;
    exited_within_soft_stop = await waitFn(pid, softStopMs);
    if (!exited_within_soft_stop) {
      signalFn(pid, "SIGKILL");
      hard_killed = true;
      await waitFn(pid, 1_000);
    }
  }

  const token_revoked = revokeFn(input.contract_id);
  const locks_cleared = clearFn(input.repoRoot, input.worktreePath);

  return {
    soft_signaled,
    hard_killed,
    exited_within_soft_stop,
    token_revoked,
    locks_cleared,
    soft_stop_ms: softStopMs,
    sequence: [
      "BLOCK_IO",
      "SIGINT_SOFT_STOP",
      "SIGKILL_IF_NEEDED",
      "REVOKE_EXEC_TOKEN",
      "CLEAR_INDEX_LOCK",
      "ENTER_PAUSED",
    ],
  };
}

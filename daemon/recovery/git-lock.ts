import fs from "node:fs";
import path from "node:path";
import { isProcessRunning } from "../core/pid-lock";

/**
 * 陈旧 Git 锁清理（Chaos 场景 1：中途拔线党）。
 *
 * Daemon 被 SIGKILL / 掉电打断时，git 自己创建的 `index.lock` 等锁文件不会被回收。
 * 残留后果是所有后续 git 写操作全部失败：
 *   fatal: Unable to create '.git/index.lock': File exists.
 *   If no other git process is currently running, this probably means a
 *   git process crashed in this repository earlier...
 * 这就是「幽灵占用」——Worktree 还在、分支还在，但整个仓库写不进去。
 *
 * 清理策略（保守 + 可判定）：
 * 1. 锁文件内容里能解析出 PID 且该进程仍存活 → 视为他人持有，跳过；
 * 2. 锁文件年龄小于 minAgeMs（默认 5s）→ 可能是一次正在进行的正常 git 操作，跳过；
 * 3. 其余一律视为崩溃残留，删除，并在报告中留痕。
 */

/** 崩溃后需要清理的非 .lock 运行态文件（中断的 merge 现场） */
const STALE_STATE_FILES = new Set(["MERGE_HEAD", "MERGE_MSG"]);

/** 遍历时不下钻的目录（体积大且不会产生锁） */
const SKIP_DIRS = new Set(["objects", "rr-cache", "pack", "hooks", "info"]);

export interface GitLockCleanupResult {
  /** 被删除的文件绝对路径 */
  removed: string[];
  /** 因「持有者存活 / 太新」而跳过的文件 */
  skipped: string[];
}

export interface GitLockCleanupOptions {
  /** 锁文件最小存活年龄，低于该值不清理；默认 5000ms */
  minAgeMs?: number;
  /** 是否同时清理中断的 merge 现场（MERGE_HEAD/MERGE_MSG） */
  cleanMergeState?: boolean;
}

function collectCandidates(
  gitDir: string,
  options: { cleanMergeState: boolean },
): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".lock") || entry.name === "gc.pid") {
        found.push(abs);
      } else if (options.cleanMergeState && STALE_STATE_FILES.has(entry.name)) {
        found.push(abs);
      }
    }
  };
  walk(gitDir, 0);
  return found;
}

/** 从锁文件内容里解析持有者 PID（git 的 gc.pid 直接写 PID；部分锁文件为空） */
function parseOwnerPid(filePath: string): number | null {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  const firstToken = raw.split(/\s+/)[0] ?? "";
  if (!/^\d+$/.test(firstToken)) return null;
  const pid = Number(firstToken);
  return pid > 0 ? pid : null;
}

export function cleanupStaleGitLocks(
  repoRoot: string,
  options: GitLockCleanupOptions = {},
): GitLockCleanupResult {
  const minAgeMs = options.minAgeMs ?? 5_000;
  const cleanMergeState = options.cleanMergeState ?? true;
  const result: GitLockCleanupResult = { removed: [], skipped: [] };

  const gitDir = path.join(path.resolve(repoRoot), ".git");
  if (!fs.existsSync(gitDir)) return result;

  const now = Date.now();
  for (const file of collectCandidates(gitDir, { cleanMergeState })) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }

    const pid = parseOwnerPid(file);
    if (pid !== null && pid !== process.pid && isProcessRunning(pid)) {
      result.skipped.push(file);
      continue;
    }
    // mtime 具有亚毫秒精度，可能出现「文件时间戳略晚于 Date.now()」的负年龄
    const ageMs = Math.max(0, now - stat.mtimeMs);
    if (ageMs < minAgeMs) {
      result.skipped.push(file);
      continue;
    }

    try {
      fs.unlinkSync(file);
      result.removed.push(file);
    } catch {
      result.skipped.push(file);
    }
  }

  return result;
}

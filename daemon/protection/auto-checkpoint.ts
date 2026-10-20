import fs from "node:fs";
import path from "node:path";
import { execGit } from "../git/worktree-manager";
import {
  appendSilentContractRecord,
  closeRound,
  loadRoundState,
} from "./protection-list";

/**
 * TASK-P.1 Vibe 安全网：Agent 改动前的轻量 Git 快照（架构规范 §0.6.2）。
 *
 * - 快照 = 记录 HEAD + 已跟踪文件的改动快照（git stash create，不动工作区/暂存区）
 *   + 当时已存在的未跟踪文件清单；
 * - 撤销 = 整轮回退：把这些文件恢复到快照时刻（包括本轮用户手动修改），
 *   并删除本轮新建的文件；确认文案由 UI 用白话写明「手改也会一起撤销」；
 * - 快照失败（git 不可用）→ 抛错，本轮不开工（P1 卡核心目标 8）。
 */

export const CHECKPOINT_FILE_REL = ".stagent/checkpoint.json";
/** git 空树对象：无 HEAD 的全新仓库用它作为「开始前」的还原源 */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface CheckpointRecord {
  roundId: string;
  at: string;
  /** 快照时刻的 HEAD；全新仓库（无提交）为 null */
  headCommit: string | null;
  /** git stash create 产生的 commit（仅已跟踪文件的改动）；干净工作区为 null */
  stashCommit: string | null;
  /** 快照时刻已存在的未跟踪文件（撤销时必须保留它们） */
  untracked: string[];
}

export class CheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckpointError";
  }
}

function checkpointPath(repoRoot: string): string {
  return path.join(repoRoot, CHECKPOINT_FILE_REL);
}

export function getCheckpoint(repoRoot: string): CheckpointRecord | null {
  const file = checkpointPath(repoRoot);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as CheckpointRecord;
  } catch {
    return null;
  }
}

async function gitOrThrow(args: string[], repoRoot: string): Promise<string> {
  const res = await execGit(args, repoRoot);
  if (res.exitCode !== 0) {
    throw new CheckpointError(
      `git ${args.join(" ")} 失败：${res.stderr || res.stdout}`,
    );
  }
  return res.stdout.trim();
}

/** 生成快照；任何 git 失败都抛 CheckpointError（快照失败则本轮不开工） */
export async function createCheckpoint(
  repoRoot: string,
  roundId: string,
): Promise<CheckpointRecord> {
  let headCommit: string | null = null;
  const head = await execGit(["rev-parse", "--verify", "HEAD"], repoRoot);
  if (head.exitCode === 0) headCommit = head.stdout.trim() || null;

  let stashCommit: string | null = null;
  if (headCommit) {
    // stash create：产出快照 commit 但不改动工作区/暂存区；干净工作区返回空
    const stash = await execGit(["stash", "create"], repoRoot);
    if (stash.exitCode !== 0) {
      throw new CheckpointError(
        `生成快照失败：${stash.stderr || stash.stdout}`,
      );
    }
    stashCommit = stash.stdout.trim() || null;
  }

  const untrackedRaw = await gitOrThrow(
    ["ls-files", "--others", "--exclude-standard"],
    repoRoot,
  );
  const untracked = untrackedRaw
    ? untrackedRaw.split("\n").filter(Boolean)
    : [];

  const record: CheckpointRecord = {
    roundId,
    at: new Date().toISOString(),
    headCommit,
    stashCommit,
    untracked,
  };
  const file = checkpointPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  appendSilentContractRecord(repoRoot, {
    kind: "checkpoint",
    roundId,
    headCommit,
    stashCommit,
    untrackedCount: untracked.length,
  });
  return record;
}

/** 本轮还没有快照就补一张（Agent 首次写之前必须已存在） */
export async function ensureCheckpoint(
  repoRoot: string,
): Promise<CheckpointRecord> {
  const existing = getCheckpoint(repoRoot);
  if (existing) return existing;
  const state = loadRoundState(repoRoot);
  return createCheckpoint(repoRoot, state.roundId);
}

export interface UndoResult {
  undone: boolean;
  roundId?: string;
  restoredFrom?: string;
  deletedFiles?: string[];
  reason?: string;
}

/**
 * 撤销本轮：把已跟踪文件恢复到快照时刻（含用户本轮手改），删除本轮新建的文件。
 * 结束后关闭本轮（授权作废，下一轮重新问）。
 */
export async function undoLatestCheckpoint(
  repoRoot: string,
): Promise<UndoResult> {
  const cp = getCheckpoint(repoRoot);
  if (!cp) {
    return { undone: false, reason: "没有可撤销的一轮改动" };
  }
  const source = cp.stashCommit ?? cp.headCommit ?? EMPTY_TREE;
  const restore = await execGit(
    ["restore", `--source=${source}`, "--worktree", "--", "."],
    repoRoot,
  );
  if (restore.exitCode !== 0) {
    throw new CheckpointError(
      `撤销失败（工作区未改动）：${restore.stderr || restore.stdout}`,
    );
  }

  // 删除本轮新建的文件（快照时刻不存在的未跟踪文件）
  const nowRaw = await gitOrThrow(
    ["ls-files", "--others", "--exclude-standard"],
    repoRoot,
  );
  const now = nowRaw ? nowRaw.split("\n").filter(Boolean) : [];
  const before = new Set(cp.untracked);
  const created = now.filter((f) => !before.has(f));
  const deleted: string[] = [];
  for (const rel of created) {
    const abs = path.join(repoRoot, rel);
    try {
      fs.unlinkSync(abs);
      deleted.push(rel);
    } catch {
      // 已被前一步恢复或本身不可删：跳过
    }
  }

  const state = loadRoundState(repoRoot);
  closeRound(repoRoot, "UNDONE");
  try {
    fs.unlinkSync(checkpointPath(repoRoot));
  } catch {
    // 已不存在
  }
  return {
    undone: true,
    roundId: state.roundId,
    restoredFrom: source,
    deletedFiles: deleted,
  };
}

export function clearCheckpoint(repoRoot: string): void {
  try {
    fs.unlinkSync(checkpointPath(repoRoot));
  } catch {
    // 已不存在
  }
}

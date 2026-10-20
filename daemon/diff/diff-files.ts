import fs from "node:fs";
import path from "node:path";
import { execGit } from "../git/worktree-manager";

/**
 * TASK-C.5 双栏 Diff 的数据源：为每个变更文件取「基线版本 / 当前版本」两段真实内容。
 * 比统一 patch 更适合并排审阅（Monaco DiffEditor 需要原文），且内容来自真实 git。
 *
 * 安全与体验边界：
 * - 单文件单侧最多 300KB，超出标记 truncated（避免前端卡死）；
 * - 二进制（含 NUL 字节）不返回内容，标记 binary；
 * - 最多返回 50 个文件，超出标记 truncatedList。
 */

export const MAX_DIFF_FILE_BYTES = 300 * 1024;
export const MAX_DIFF_FILES = 50;

export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFilePair {
  path: string;
  /** 重命名前的路径（仅 renamed 有值） */
  oldPath?: string;
  status: DiffFileStatus;
  before: string;
  after: string;
  binary: boolean;
  truncated: boolean;
}

export interface DiffFilesResult {
  files: DiffFilePair[];
  truncatedList: boolean;
}

interface NameStatusEntry {
  status: DiffFileStatus;
  path: string;
  oldPath?: string;
}

function parseNameStatus(raw: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0]?.trim() ?? "";
    if (code.startsWith("R") && parts.length >= 3) {
      entries.push({
        status: "renamed",
        oldPath: parts[1] as string,
        path: parts[2] as string,
      });
      continue;
    }
    const file = parts[1];
    if (!file) continue;
    const status: DiffFileStatus = code.startsWith("A")
      ? "added"
      : code.startsWith("D")
        ? "deleted"
        : "modified";
    entries.push({ status, path: file });
  }
  return entries;
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, Math.min(buf.length, 8192)).includes(0);
}

function clip(buf: Buffer): { text: string; truncated: boolean } {
  if (buf.length > MAX_DIFF_FILE_BYTES) {
    return {
      text: buf.subarray(0, MAX_DIFF_FILE_BYTES).toString("utf8"),
      truncated: true,
    };
  }
  return { text: buf.toString("utf8"), truncated: false };
}

async function showAtRef(
  worktreePath: string,
  ref: string,
  filePath: string,
): Promise<Buffer | null> {
  const res = await execGit(["show", `${ref}:${filePath}`], worktreePath, {
    raw: true,
  });
  if (res.exitCode !== 0) return null;
  return Buffer.from(res.stdout, "utf8");
}

/** 读取 worktree 相对 baseBranch 的全部文件级差异（真实 git 内容） */
export async function readDiffFiles(
  worktreePath: string,
  baseBranch: string,
): Promise<DiffFilesResult> {
  const status = await execGit(
    ["diff", "--name-status", baseBranch],
    worktreePath,
  );
  if (status.exitCode !== 0) {
    throw new Error(
      `git diff --name-status 失败：${status.stderr || status.stdout}`,
    );
  }
  const entries = parseNameStatus(status.stdout);
  const truncatedList = entries.length > MAX_DIFF_FILES;
  const selected = entries.slice(0, MAX_DIFF_FILES);

  const files: DiffFilePair[] = [];
  for (const entry of selected) {
    const abs = path.join(worktreePath, entry.path);
    let afterBuf: Buffer = Buffer.alloc(0);
    try {
      afterBuf = fs.readFileSync(abs);
    } catch {
      afterBuf = Buffer.alloc(0);
    }
    let beforeBuf: Buffer = Buffer.alloc(0);
    if (entry.status !== "added") {
      beforeBuf =
        (await showAtRef(
          worktreePath,
          baseBranch,
          entry.oldPath ?? entry.path,
        )) ?? Buffer.alloc(0);
    }
    const binary = isBinary(beforeBuf) || isBinary(afterBuf);
    if (binary) {
      files.push({
        path: entry.path,
        ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
        status: entry.status,
        before: "",
        after: "",
        binary: true,
        truncated: false,
      });
      continue;
    }
    const before = clip(beforeBuf);
    const after = clip(afterBuf);
    files.push({
      path: entry.path,
      ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
      status: entry.status,
      before: before.text,
      after: after.text,
      binary: false,
      truncated: before.truncated || after.truncated,
    });
  }
  return { files, truncatedList };
}

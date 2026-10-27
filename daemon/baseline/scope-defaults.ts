/**
 * TASK-C.14c / C.14d：首张微合同默认排除未跟踪/未提交路径。
 * dirty_exclusions → scope.strictly_forbidden_paths（物理白名单）。
 */
import { readBaselineArchive } from "./store";
import { loadAcknowledgedDirtyExclusions } from "./dirty-guidance";
import type { WorkspaceDirtyReport } from "./types";
import { matchesAnyPattern, normalizePath } from "../../src/lib/scope";

/**
 * 从最新基线取出脏区排除清单（优先 dirty_exclusions，回退 protect_paths）。
 */
export function loadBaselineDirtyExclusions(repoRoot: string): string[] {
  const archive = readBaselineArchive(repoRoot);
  const fromBaseline: string[] = archive?.dirty
    ? archive.dirty.dirty_exclusions?.length
      ? archive.dirty.dirty_exclusions
      : (archive.dirty.protect_paths ?? [])
    : [];
  // TASK-H.6：acknowledge_dirty 后写入的排除也并入禁写
  const fromAck = loadAcknowledgedDirtyExclusions(repoRoot);
  return [
    ...new Set(
      [...fromBaseline, ...fromAck].map(normalizePath).filter(Boolean),
    ),
  ].sort();
}

/** @deprecated 兼容旧名；请用 loadBaselineDirtyExclusions */
export function loadBaselineProtectPaths(repoRoot: string): string[] {
  return loadBaselineDirtyExclusions(repoRoot);
}

/**
 * 合并进合同禁写列表；脏路径优先精确排除。
 */
export function mergeBaselineProtectIntoForbidden(
  repoRoot: string,
  existingForbidden: readonly string[],
): string[] {
  const protect = loadBaselineDirtyExclusions(repoRoot);
  const set = new Set<string>([...existingForbidden, ...protect]);
  return [...set];
}

export function dirtyProtectFromReport(dirty: WorkspaceDirtyReport): string[] {
  const raw =
    dirty.dirty_exclusions?.length > 0
      ? dirty.dirty_exclusions
      : dirty.protect_paths;
  return [...new Set(raw.map(normalizePath).filter(Boolean))].sort();
}

/** 路径是否命中脏区排除清单（精确或 glob） */
export function pathMatchesDirtyExclusion(
  filePath: string,
  dirtyExclusions: readonly string[],
): boolean {
  if (!dirtyExclusions.length) return false;
  return matchesAnyPattern(filePath, [...dirtyExclusions]).matches;
}

/**
 * 白话「绝不触碰」名单（合同正文用）。
 * 超过 limit 条时截断并注明其余数量。
 */
export function formatDirtyExclusionsPlain(
  dirtyExclusions: readonly string[],
  limit = 12,
): string | null {
  const list = [...dirtyExclusions].map(normalizePath).filter(Boolean);
  if (list.length === 0) return null;
  const head = list.slice(0, limit);
  const more =
    list.length > limit ? `（另有 ${list.length - limit} 个未列出）` : "";
  return `绝不触碰（本地未保存/未跟踪，已列入禁写）：${head.join("、")}${more}`;
}

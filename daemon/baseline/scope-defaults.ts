/**
 * TASK-C.14c：首张微合同默认排除未跟踪/未提交路径。
 */
import { readBaselineArchive } from "./store";
import type { WorkspaceDirtyReport } from "./types";

/**
 * 从最新基线取出保护白名单路径（精确路径 → 可作为 strictly_forbidden）。
 */
export function loadBaselineProtectPaths(repoRoot: string): string[] {
  const archive = readBaselineArchive(repoRoot);
  if (!archive?.dirty?.protect_paths?.length) return [];
  return [...archive.dirty.protect_paths];
}

/**
 * 合并进合同禁写列表；脏路径优先精确排除。
 */
export function mergeBaselineProtectIntoForbidden(
  repoRoot: string,
  existingForbidden: readonly string[],
): string[] {
  const protect = loadBaselineProtectPaths(repoRoot);
  const set = new Set<string>([...existingForbidden, ...protect]);
  return [...set];
}

export function dirtyProtectFromReport(
  dirty: WorkspaceDirtyReport,
): string[] {
  return [...dirty.protect_paths];
}

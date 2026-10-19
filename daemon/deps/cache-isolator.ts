import fs from "node:fs";
import path from "node:path";

export interface CacheIsolationResult {
  isolatedDirs: string[];
  worktreePath: string;
}

export const ISOLATED_CACHE_DIRECTORIES = [
  ".vite",
  ".turbo",
  ".cache",
  ".next/cache",
  ".parcel-cache",
] as const;

/**
 * Ensure build tool caches (.vite, .turbo, .cache) are isolated inside the task worktree.
 * Prevents task builds from mutating or polluting host project cache and mtimes.
 */
export async function setupWorktreeCacheIsolation(options: {
  worktreePath: string;
}): Promise<CacheIsolationResult> {
  const { worktreePath } = options;
  const resolvedWorktree = path.resolve(worktreePath);
  const createdDirs: string[] = [];

  for (const relDir of ISOLATED_CACHE_DIRECTORIES) {
    const targetDir = path.resolve(resolvedWorktree, relDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      createdDirs.push(relDir);
    }
  }

  return {
    isolatedDirs: createdDirs,
    worktreePath: resolvedWorktree,
  };
}

/**
 * Clean up isolated build caches inside worktree.
 */
export async function cleanupWorktreeCaches(
  worktreePath: string,
): Promise<void> {
  const resolvedWorktree = path.resolve(worktreePath);

  for (const relDir of ISOLATED_CACHE_DIRECTORIES) {
    const targetDir = path.resolve(resolvedWorktree, relDir);
    if (fs.existsSync(targetDir)) {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore deletion errors
      }
    }
  }
}

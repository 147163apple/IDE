import path from "node:path";
import fs from "node:fs";

export const E_PATH_TRAVERSAL = "PATH_TRAVERSAL_DETECTED";

export class PathTraversalError extends Error {
  readonly code: string = E_PATH_TRAVERSAL;
  readonly targetPath: string;
  readonly worktreeRoot: string;

  constructor(message: string, targetPath: string, worktreeRoot: string) {
    super(
      `[${E_PATH_TRAVERSAL}] ${message} (path: '${targetPath}', worktree: '${worktreeRoot}')`,
    );
    this.name = "PathTraversalError";
    this.targetPath = targetPath;
    this.worktreeRoot = worktreeRoot;
  }
}

export interface SafePathResult {
  worktreeRoot: string;
  targetPath: string;
  relativePath: string;
  absolutePath: string;
}

/**
 * Normalizes and safely resolves a relative target path within a worktree root.
 * Enforces strict sandbox containment:
 * 1. Disallows leading slashes or Windows drive letters
 * 2. Disallows '..' path traversal segments
 * 3. Disallows symlinks pointing outside the worktree boundary
 */
export function resolveSafeWorktreePath(
  worktreeRoot: string,
  targetPath: string,
): SafePathResult {
  if (!targetPath || typeof targetPath !== "string") {
    throw new PathTraversalError(
      "Target path cannot be empty",
      targetPath ?? "",
      worktreeRoot,
    );
  }

  const trimmed = targetPath.trim();
  // Reject absolute paths
  if (
    path.isAbsolute(trimmed) ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\")
  ) {
    throw new PathTraversalError(
      "Absolute paths are forbidden in worktree sandbox",
      targetPath,
      worktreeRoot,
    );
  }

  // Normalize segments and check for .. escape
  const normalizedSegs = trimmed.replace(/\\/g, "/").split("/");
  if (normalizedSegs.some((seg) => seg === "..")) {
    throw new PathTraversalError(
      "Path traversal segment '..' detected",
      targetPath,
      worktreeRoot,
    );
  }

  const cleanRelative = normalizedSegs
    .filter((s) => s.length > 0 && s !== ".")
    .join("/");
  if (!cleanRelative) {
    return {
      worktreeRoot: path.resolve(worktreeRoot),
      targetPath,
      relativePath: ".",
      absolutePath: path.resolve(worktreeRoot),
    };
  }

  const resolvedRoot = path.resolve(worktreeRoot);
  const resolvedAbsolute = path.resolve(resolvedRoot, cleanRelative);

  // Boundary check: must be strictly inside worktreeRoot
  if (
    resolvedAbsolute !== resolvedRoot &&
    !resolvedAbsolute.startsWith(resolvedRoot + path.sep)
  ) {
    throw new PathTraversalError(
      "Path escapes worktree boundary",
      targetPath,
      worktreeRoot,
    );
  }

  // Symlink defense: check if existing path or its existing parent resolves outside the worktree root
  let probePath = resolvedAbsolute;
  while (
    !fs.existsSync(probePath) &&
    probePath !== resolvedRoot &&
    probePath !== path.dirname(probePath)
  ) {
    probePath = path.dirname(probePath);
  }

  if (fs.existsSync(probePath)) {
    try {
      const realProbe = fs.realpathSync(probePath);
      const realRoot = fs.realpathSync(resolvedRoot);
      if (
        realProbe !== realRoot &&
        !realProbe.startsWith(realRoot + path.sep)
      ) {
        throw new PathTraversalError(
          `Symlink resolution points outside worktree: '${realProbe}' is outside '${realRoot}'`,
          targetPath,
          worktreeRoot,
        );
      }
    } catch (err) {
      if (err instanceof PathTraversalError) throw err;
      // If error inspecting realpath, reject safely
      throw new PathTraversalError(
        `Failed to verify realpath for symlink boundary: ${(err as Error).message}`,
        targetPath,
        worktreeRoot,
      );
    }
  }

  return {
    worktreeRoot: resolvedRoot,
    targetPath,
    relativePath: cleanRelative,
    absolutePath: resolvedAbsolute,
  };
}

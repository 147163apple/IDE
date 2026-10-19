import picomatch from "picomatch";
import type { SoftwareContract } from "./contract.schema";

export type Change = { path: string; content: string };

export type ScopeViolationCode = "E_SCOPE_VIOLATION";
export const E_SCOPE_VIOLATION: ScopeViolationCode = "E_SCOPE_VIOLATION";

export type ScopeViolationReason =
  "FORBIDDEN_PATH" | "NOT_WRITABLE" | "NOT_READABLE" | "BUDGET_EXCEEDED";

export class ScopeViolationError extends Error {
  readonly code: ScopeViolationCode = E_SCOPE_VIOLATION;
  readonly reason: ScopeViolationReason;
  readonly path?: string | undefined;
  readonly matchedPattern?: string | undefined;

  constructor(
    message: string,
    reason: ScopeViolationReason,
    path?: string | undefined,
    matchedPattern?: string | undefined,
  ) {
    super(`[${E_SCOPE_VIOLATION}] ${message}`);
    this.name = "ScopeViolationError";
    this.reason = reason;
    this.path = path;
    this.matchedPattern = matchedPattern;
  }
}

/** Normalize file paths: strip leading slash or ./ and convert backslashes to forward slashes */
export function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^(\.\/|\/)+/, "")
    .replace(/\\/g, "/");
}

/** Match a normalized path against an array of glob patterns or exact paths */
export function matchesAnyPattern(
  filePath: string,
  patterns: string[],
): { matches: boolean; matchedPattern?: string | undefined } {
  const normalized = normalizePath(filePath);
  for (const rawPattern of patterns) {
    const pattern = normalizePath(rawPattern);
    if (!pattern) continue;

    // Exact match
    if (normalized === pattern) {
      return { matches: true, matchedPattern: rawPattern };
    }

    // Glob match via picomatch
    const isMatch = picomatch(pattern, { dot: true, posix: true });
    if (isMatch(normalized)) {
      return { matches: true, matchedPattern: rawPattern };
    }
  }
  return { matches: false };
}

export interface FileSystemScope {
  writable_paths: string[];
  readonly_paths?: string[];
  strictly_forbidden_paths?: string[];
}

export interface AccessCheckResult {
  allowed: boolean;
  reason?: ScopeViolationReason | undefined;
  pattern?: string | undefined;
  message?: string | undefined;
}

/** Check if reading a path is allowed */
export function checkReadAccess(
  filePath: string,
  scope: FileSystemScope,
): AccessCheckResult {
  const forbidden = scope.strictly_forbidden_paths ?? [];
  const forbiddenCheck = matchesAnyPattern(filePath, forbidden);
  if (forbiddenCheck.matches) {
    return {
      allowed: false,
      reason: "FORBIDDEN_PATH",
      pattern: forbiddenCheck.matchedPattern,
      message: `Path '${filePath}' matches strictly forbidden scope: ${forbiddenCheck.matchedPattern}`,
    };
  }

  // If writable or readonly paths are defined, path must be in either (unless both lists are empty/unrestricted)
  const writable = scope.writable_paths ?? [];
  const readonly = scope.readonly_paths ?? [];
  const allAllowed = [...writable, ...readonly];

  if (allAllowed.length > 0) {
    const allowedCheck = matchesAnyPattern(filePath, allAllowed);
    if (!allowedCheck.matches) {
      return {
        allowed: false,
        reason: "NOT_READABLE",
        message: `Path '${filePath}' is outside of declared readable/writable paths`,
      };
    }
  }

  return { allowed: true };
}

/** Check if writing to a path is allowed */
export function checkWriteAccess(
  filePath: string,
  scope: FileSystemScope,
): AccessCheckResult {
  // 1. Check strictly forbidden paths first (Hard Intercept)
  const forbidden = scope.strictly_forbidden_paths ?? [];
  const forbiddenCheck = matchesAnyPattern(filePath, forbidden);
  if (forbiddenCheck.matches) {
    return {
      allowed: false,
      reason: "FORBIDDEN_PATH",
      pattern: forbiddenCheck.matchedPattern,
      message: `Write rejected: '${filePath}' is strictly forbidden by pattern '${forbiddenCheck.matchedPattern}'`,
    };
  }

  // 2. Check writable paths (Must match at least one writable pattern)
  const writable = scope.writable_paths ?? [];
  const writableCheck = matchesAnyPattern(filePath, writable);
  if (!writableCheck.matches) {
    return {
      allowed: false,
      reason: "NOT_WRITABLE",
      message: `Write rejected: '${filePath}' is not in authorized writable_paths`,
    };
  }

  return { allowed: true };
}

/** Assert write permission or throw ScopeViolationError */
export function assertWriteAllowed(
  filePath: string,
  scope: FileSystemScope,
): void {
  const result = checkWriteAccess(filePath, scope);
  if (!result.allowed) {
    throw new ScopeViolationError(
      result.message || `Access denied for '${filePath}'`,
      result.reason || "NOT_WRITABLE",
      filePath,
      result.pattern,
    );
  }
}

/** Assert read permission or throw ScopeViolationError */
export function assertReadAllowed(
  filePath: string,
  scope: FileSystemScope,
): void {
  const result = checkReadAccess(filePath, scope);
  if (!result.allowed) {
    throw new ScopeViolationError(
      result.message || `Read access denied for '${filePath}'`,
      result.reason || "NOT_READABLE",
      filePath,
      result.pattern,
    );
  }
}

/** Backwards-compatible scope filter supporting both exact paths and glob patterns */
export function enforceScope(changes: Change[], allowedPatterns: string[]) {
  const applied: Change[] = [];
  const rejected: string[] = [];

  for (const c of changes) {
    const match = matchesAnyPattern(c.path, allowedPatterns);
    if (match.matches) {
      applied.push(c);
    } else {
      rejected.push(c.path);
    }
  }

  return { applied, rejected };
}

export interface ScopeAuditResult {
  passed: boolean;
  forbidden_violations: string[];
  out_of_scope_files: string[];
  files_changed: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
  budget_exceeded: boolean;
  reasons: string[];
}

/** Comprehensive verification of a batch of changes against a SoftwareContract */
export function auditChangesAgainstContract(
  changes: Change[],
  contract: SoftwareContract,
  originalFiles?: Record<string, string>,
): ScopeAuditResult {
  const scope = contract.authorization.file_system_scope;
  const budget = contract.authorization.budget_limits;

  const forbiddenViolations: string[] = [];
  const outOfScopeFiles: string[] = [];
  const filesChanged: Array<{
    path: string;
    additions: number;
    deletions: number;
  }> = [];
  const reasons: string[] = [];

  // Check budget limit
  const budgetExceeded = changes.length > budget.max_file_modifications;
  if (budgetExceeded) {
    reasons.push(
      `Budget exceeded: ${changes.length} files modified, maximum allowed is ${budget.max_file_modifications}`,
    );
  }

  for (const change of changes) {
    // 1. Strictly forbidden check
    const forbiddenCheck = matchesAnyPattern(
      change.path,
      scope.strictly_forbidden_paths,
    );
    if (forbiddenCheck.matches) {
      forbiddenViolations.push(change.path);
      reasons.push(
        `Forbidden path modified: '${change.path}' (matches '${forbiddenCheck.matchedPattern}')`,
      );
      continue;
    }

    // 2. Writable scope check
    const writableCheck = matchesAnyPattern(change.path, scope.writable_paths);
    if (!writableCheck.matches) {
      outOfScopeFiles.push(change.path);
      reasons.push(
        `Out of scope path modified: '${change.path}' is not declared in writable_paths`,
      );
    }

    // 3. Line additions / deletions calculation
    const originalContent = originalFiles?.[change.path] ?? "";
    const originalLines = originalContent
      ? originalContent.split("\n").length
      : 0;
    const newLines = change.content ? change.content.split("\n").length : 0;
    const diff = newLines - originalLines;

    filesChanged.push({
      path: change.path,
      additions: Math.max(0, diff),
      deletions: Math.max(0, -diff),
    });
  }

  const passed =
    !budgetExceeded &&
    forbiddenViolations.length === 0 &&
    outOfScopeFiles.length === 0;

  return {
    passed,
    forbidden_violations: forbiddenViolations,
    out_of_scope_files: outOfScopeFiles,
    files_changed: filesChanged,
    budget_exceeded: budgetExceeded,
    reasons,
  };
}

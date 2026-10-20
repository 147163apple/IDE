import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import { resolveSafeWorktreePath } from "../mcp/path-resolver";

/**
 * TASK-C.3 编辑器读写的服务端强制校验。
 * - 有合同：根 = 合同 Worktree；只允许写 writable_paths 内、且不在 readonly / 禁区内的文件；
 * - 无合同（Vibe）：根 = 仓库主工作树；禁止写 .git / .stagent 等系统目录
 *   （保护清单 P.1 落地后在此叠加）；
 * - 任何越权一律拒绝并写一条 GATEWAY_VIOLATION 审计，文件不改动。
 */
export const SYSTEM_SEGMENTS = [".git", ".stagent"];
export const MAX_EDITOR_FILE_BYTES = 1024 * 1024;

export interface FileAccessContext {
  repoRoot: string;
  contract: SoftwareContract | null;
  worktreePath: string | null;
}

export interface WriteDecision {
  allowed: boolean;
  reason: string;
  absolutePath: string | null;
  relativePath: string;
}

export function rootOf(ctx: FileAccessContext): string {
  return ctx.contract && ctx.worktreePath ? ctx.worktreePath : ctx.repoRoot;
}

export function decideWrite(
  ctx: FileAccessContext,
  target: string,
): WriteDecision {
  const root = rootOf(ctx);
  let rel = target;
  let abs: string;
  try {
    const r = resolveSafeWorktreePath(root, target);
    abs = r.absolutePath;
    rel = r.relativePath;
  } catch (err) {
    return {
      allowed: false,
      reason: (err as Error).message,
      absolutePath: null,
      relativePath: target,
    };
  }
  const segs = rel.split(/[\\/]/);
  if (segs.some((s) => SYSTEM_SEGMENTS.includes(s))) {
    return {
      allowed: false,
      reason: "系统目录不可写",
      absolutePath: abs,
      relativePath: rel,
    };
  }
  if (ctx.contract) {
    const scope = ctx.contract.authorization.file_system_scope;
    const m = (globs: string[]) =>
      globs.length > 0 && picomatch(globs, { dot: true })(rel);
    if (m(scope.strictly_forbidden_paths))
      return {
        allowed: false,
        reason: "合同强禁区",
        absolutePath: abs,
        relativePath: rel,
      };
    if (m(scope.readonly_paths))
      return {
        allowed: false,
        reason: "合同只读路径",
        absolutePath: abs,
        relativePath: rel,
      };
    if (!m(scope.writable_paths))
      return {
        allowed: false,
        reason: "不在合同可写范围内",
        absolutePath: abs,
        relativePath: rel,
      };
  }
  return { allowed: true, reason: "ok", absolutePath: abs, relativePath: rel };
}

export function readFileFor(ctx: FileAccessContext, target: string) {
  const root = rootOf(ctx);
  const r = resolveSafeWorktreePath(root, target);
  const stat = fs.statSync(r.absolutePath);
  if (stat.size > MAX_EDITOR_FILE_BYTES)
    throw new Error("文件过大，编辑器不打开（>1MB）");
  return {
    path: r.relativePath,
    root,
    content: fs.readFileSync(r.absolutePath, "utf8"),
    writable: decideWrite(ctx, target).allowed,
  };
}

export interface ViolationRecord {
  at: string;
  source: "editor";
  contract_id: string | null;
  path: string;
  reason: string;
}

export function recordViolation(repoRoot: string, v: ViolationRecord): void {
  const dir = path.join(repoRoot, ".stagent", "audit");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, "gateway-violations.jsonl"),
    JSON.stringify(v) + "\n",
  );
}

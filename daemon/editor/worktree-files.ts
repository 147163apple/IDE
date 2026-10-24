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

/**
 * C.10f 热修：资源管理器需要「纯文件树」路径列表。
 * 故意不做 AST——只 walk 磁盘，建连即可填充左栏；忽略常见大目录。
 */
export const TREE_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".stagent",
  "dist",
  ".output",
  "coverage",
  ".tmp",
  ".next",
  ".vite",
  ".turbo",
  ".cache",
]);

/** 被忽略目录里仍要探测的 Demo 候选（规范资产「就绪」判断） */
export const TREE_EXTRA_PROBES = [".stagent/demo/index.html"] as const;

export function listRepoTreePaths(
  root: string,
  options?: { maxFiles?: number },
): string[] {
  const maxFiles = options?.maxFiles ?? 5000;
  const rootAbs = path.resolve(root);
  const acc: string[] = [];

  const walk = (dirAbs: string): void => {
    if (acc.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (acc.length >= maxFiles) return;
      if (entry.name === "." || entry.name === "..") continue;
      const abs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || TREE_IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(rootAbs, abs).split(path.sep).join("/");
      if (rel && !rel.startsWith("..")) acc.push(rel);
    }
  };

  walk(rootAbs);

  for (const probe of TREE_EXTRA_PROBES) {
    if (acc.length >= maxFiles) break;
    const abs = path.resolve(rootAbs, probe);
    const rel = path.relative(rootAbs, abs).split(path.sep).join("/");
    if (
      rel &&
      !rel.startsWith("..") &&
      !path.isAbsolute(rel) &&
      fs.existsSync(abs) &&
      !acc.includes(rel)
    ) {
      acc.push(rel);
    }
  }

  return acc;
}

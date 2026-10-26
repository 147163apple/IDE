/**
 * TASK-C.15d / P0 AC-ISOL：草稿物理隔离在 `.stagent/drafts/`。
 * `.gitignore` 已忽略整个 `.stagent/`（≠ ACL；安全靠路径约定 + Daemon）。
 */
import fs from "node:fs";
import path from "node:path";

export const DRAFTS_ROOT = ".stagent/drafts" as const;

export function draftsDir(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), DRAFTS_ROOT);
}

export function ensureDraftsIsolated(repoRoot: string): string {
  const dir = draftsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 断言路径落在 drafts 内；越界抛 E_DRAFT_ESCAPE */
export function assertDraftPath(
  repoRoot: string,
  candidate: string,
): string {
  const root = draftsDir(repoRoot);
  const resolved = path.resolve(root, candidate);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    const err = new Error(
      `草稿路径越界：必须位于 ${DRAFTS_ROOT}/ 内（AC-ISOL P0）`,
    ) as Error & { code: string };
    err.code = "E_DRAFT_ESCAPE";
    throw err;
  }
  return resolved;
}

/**
 * 检查仓库根 `.gitignore` 是否包含 `.stagent/`（防误提交主干）。
 * 这是卫生检查，不是 ACL。
 */
export function assertStagentGitignored(repoRoot: string): {
  ok: boolean;
  reason?: string;
} {
  const gi = path.join(path.resolve(repoRoot), ".gitignore");
  if (!fs.existsSync(gi)) {
    return { ok: false, reason: "缺少 .gitignore" };
  }
  const text = fs.readFileSync(gi, "utf8");
  if (!/(^|\n)\.stagent\/?(\n|$)/.test(text) && !text.includes(".stagent/")) {
    return { ok: false, reason: ".gitignore 未忽略 .stagent/" };
  }
  return { ok: true };
}

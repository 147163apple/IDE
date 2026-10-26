/**
 * TASK-C.14c：Workspace Dirty Check（工作区洁净度）。
 * 只记录与警示；管家话术；首张微合同默认排除脏路径。
 */
import { execGit } from "../git/worktree-manager";
import {
  buildStewardDirtyMessage,
  type WorkspaceDirtyReport,
} from "./types";
import { unquoteGitPath } from "../pipeline/untracked-scope-guard";

function parsePorcelainPath(line: string): {
  code: string;
  path: string;
  untracked: boolean;
} | null {
  if (!line || line.length < 4) return null;
  // porcelain: XY<space>path ；兼容偶发多空格
  const m = /^(.{2})\s+(.*)$/.exec(line);
  if (!m) return null;
  const code = m[1] ?? "";
  let rest = m[2] ?? "";
  // rename: "R  old -> new"
  if (rest.includes(" -> ")) {
    rest = rest.split(" -> ").pop() ?? rest;
  }
  const filePath = unquoteGitPath(rest.trim());
  if (!filePath || filePath.startsWith(".stagent/")) return null;
  return {
    code,
    path: filePath,
    untracked: code === "??" || code.startsWith("?"),
  };
}

export async function inspectWorkspaceDirty(
  repoRoot: string,
): Promise<WorkspaceDirtyReport> {
  let stdout = "";
  try {
    const result = await execGit(
      ["status", "--porcelain", "-uall"],
      repoRoot,
    );
    if (result.exitCode !== 0) {
      return {
        clean: true,
        uncommitted: [],
        untracked: [],
        steward_message: null,
        protect_paths: [],
      };
    }
    stdout = result.stdout;
  } catch {
    // 非 git 仓库：视为洁净（无脏可保护）
    return {
      clean: true,
      uncommitted: [],
      untracked: [],
      steward_message: null,
      protect_paths: [],
    };
  }

  const uncommitted: string[] = [];
  const untracked: string[] = [];
  for (const line of stdout.split("\n")) {
    const parsed = parsePorcelainPath(line.trimEnd());
    if (!parsed) continue;
    if (parsed.untracked) untracked.push(parsed.path);
    else uncommitted.push(parsed.path);
  }

  const protect = [...new Set([...uncommitted, ...untracked])].sort();
  const n = protect.length;
  const clean = n === 0;
  return {
    clean,
    uncommitted,
    untracked,
    steward_message: clean ? null : buildStewardDirtyMessage(n),
    protect_paths: protect,
  };
}

/** 同步版：仅用已注入的 porcelain 文本（单测） */
export function dirtyReportFromPorcelain(stdout: string): WorkspaceDirtyReport {
  const uncommitted: string[] = [];
  const untracked: string[] = [];
  for (const line of stdout.split("\n")) {
    const parsed = parsePorcelainPath(line.trimEnd());
    if (!parsed) continue;
    if (parsed.untracked) untracked.push(parsed.path);
    else uncommitted.push(parsed.path);
  }
  const protect = [...new Set([...uncommitted, ...untracked])].sort();
  const n = protect.length;
  const clean = n === 0;
  return {
    clean,
    uncommitted,
    untracked,
    steward_message: clean ? null : buildStewardDirtyMessage(n),
    protect_paths: protect,
  };
}

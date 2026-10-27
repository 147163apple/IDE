/**
 * TASK-H.4：空目录 / 无 .git 目录的友好 git init 引导。
 * - 已有 .git → 幂等跳过，绝不再次 init 破坏历史
 * - 无 .git → 仅在 confirm/autoInit 为真时执行 git init
 * - 失败返回可理解错误，不静默吞掉
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const E_GIT_INIT_FAILED = "E_GIT_INIT_FAILED" as const;
export const E_GIT_INIT_UNCONFIRMED = "E_GIT_INIT_UNCONFIRMED" as const;

export interface GitRepoInspection {
  repoRoot: string;
  hasGit: boolean;
  /** 目录存在且（近似）空：无业务文件，或仅有隐藏项/.stagent */
  looksEmpty: boolean;
  gitDir: string;
}

export function inspectGitRepo(repoRoot: string): GitRepoInspection {
  const root = path.resolve(repoRoot);
  const gitDir = path.join(root, ".git");
  let hasGit = false;
  try {
    hasGit = fs.existsSync(gitDir);
  } catch {
    hasGit = false;
  }

  let looksEmpty = false;
  try {
    const entries = fs.readdirSync(root);
    const meaningful = entries.filter(
      (n) => n !== ".git" && n !== ".stagent" && n !== ".DS_Store",
    );
    looksEmpty = meaningful.length === 0;
  } catch {
    looksEmpty = false;
  }

  return { repoRoot: root, hasGit, looksEmpty, gitDir };
}

export interface EnsureGitInitOptions {
  /**
   * 必须显式确认才会 init（防静默破坏）。
   * CLI open 对「无 .git」可传 true 作为单键/自动引导。
   */
  confirm: boolean;
  /** 测试可注入 runner */
  runGitInit?: (cwd: string) => void;
}

export interface EnsureGitInitResult {
  ok: boolean;
  initialized: boolean;
  skipped: boolean;
  reason: "already_git" | "initialized" | "unconfirmed" | "failed";
  message: string;
  error?: string;
  code?: typeof E_GIT_INIT_FAILED | typeof E_GIT_INIT_UNCONFIRMED;
}

function defaultGitInit(cwd: string): void {
  execFileSync("git", ["init"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

/**
 * 确保目录是 git 仓库。已有 .git 则跳过；否则需 confirm。
 */
export function ensureGitInit(
  repoRoot: string,
  options: EnsureGitInitOptions,
): EnsureGitInitResult {
  const info = inspectGitRepo(repoRoot);
  if (info.hasGit) {
    return {
      ok: true,
      initialized: false,
      skipped: true,
      reason: "already_git",
      message: "已是 Git 仓库，跳过 init（不会改写历史）",
    };
  }

  if (!options.confirm) {
    return {
      ok: false,
      initialized: false,
      skipped: true,
      reason: "unconfirmed",
      message:
        "这个文件夹还不是 Git 仓库。确认后可一键初始化（git init），不会动已有文件。",
      code: E_GIT_INIT_UNCONFIRMED,
    };
  }

  if (!fs.existsSync(info.repoRoot)) {
    return {
      ok: false,
      initialized: false,
      skipped: false,
      reason: "failed",
      message: `找不到文件夹：${info.repoRoot}`,
      error: "ENOENT",
      code: E_GIT_INIT_FAILED,
    };
  }

  try {
    const runner = options.runGitInit ?? defaultGitInit;
    runner(info.repoRoot);
    const after = inspectGitRepo(info.repoRoot);
    if (!after.hasGit) {
      return {
        ok: false,
        initialized: false,
        skipped: false,
        reason: "failed",
        message: "git init 已执行但未检测到 .git",
        code: E_GIT_INIT_FAILED,
      };
    }
    return {
      ok: true,
      initialized: true,
      skipped: false,
      reason: "initialized",
      message: info.looksEmpty
        ? "已为空白文件夹初始化 Git，可以继续基线与合同。"
        : "已初始化 Git 仓库，可以继续基线与合同。",
    };
  } catch (err) {
    return {
      ok: false,
      initialized: false,
      skipped: false,
      reason: "failed",
      message: "初始化 Git 失败，请检查是否已安装 git 以及文件夹权限。",
      error: err instanceof Error ? err.message : String(err),
      code: E_GIT_INIT_FAILED,
    };
  }
}

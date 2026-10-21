import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 测试期 Git 操作的「宿主仓库隔离」守卫（fail-closed）。
 *
 * ## 为什么需要它
 *
 * 2026-10-21 03:22，本仓库根部留下了一个 `.git/config.lock`，其内容是把
 * `user.name` 改写成 `Stagent Test`——而真实 `.git/config` 里是 `Tina`。
 * 也就是说：确实有一次 `git config` 的写入，**目标是宿主仓库**，只是写到一半
 * 被中断（rename 失败 / 进程被 SIGTERM），才没真的污染用户身份。
 *
 * 这类事故的根因不是某一条测试写错，而是「测试里跑 git」这件事默认信任了调用方
 * 传来的 `cwd`：一旦 `cwd` 退化到 `process.cwd()`（例如临时目录创建失败、
 * `cwd` 传成 `undefined` 由 `spawn` 继承父进程目录），git 就会在开发者的真实仓库
 * 里执行写入，而且**没有任何提示**。
 *
 * ## 判定规则（任一不满足即抛错，绝不降级放行）
 *
 * 1. `cwd` 必须提供，且是已存在的目录；
 * 2. `path.resolve(cwd)` 不得等于宿主仓库根（`process.cwd()`）；
 * 3. 不得是宿主仓库根的**祖先目录**（否则 git 向上发现 `.git` 照样命中宿主仓库）；
 * 4. 必须落在允许的隔离根内：`os.tmpdir()` 或 `<repo>/.tmp/**`（仓库内已约定的
 *    临时工作区，如 `.tmp/unit-supervisor`）。
 *
 * 符号链接会先 `realpath` 再比较，避免 `ln -s` 绕回宿主仓库。
 */

export const GIT_CWD_ISOLATION_ERROR = "E_GIT_CWD_NOT_ISOLATED";

export interface GitCwdIsolationErrorDetails {
  cwd?: string | undefined;
  resolved?: string | undefined;
  hostRoot: string;
  allowedRoots: string[];
  reason:
    | "MISSING_CWD"
    | "NOT_A_DIRECTORY"
    | "HOST_ROOT"
    | "HOST_ANCESTOR"
    | "OUTSIDE_ISOLATED_ROOTS";
}

export class GitCwdIsolationError extends Error {
  readonly code = GIT_CWD_ISOLATION_ERROR;
  readonly details: GitCwdIsolationErrorDetails;

  constructor(message: string, details: GitCwdIsolationErrorDetails) {
    super(message);
    this.name = "GitCwdIsolationError";
    this.details = details;
  }
}

export interface IsolatedCwdOptions {
  /** 额外的允许根（默认自动包含 `<hostRoot>/.tmp`） */
  allowedRoots?: string[];
  /** 宿主仓库根，默认 `process.cwd()` */
  hostRoot?: string;
  /** 允许根之外是否放行 os.tmpdir()，默认 true */
  allowTmpdir?: boolean;
}

/** 尽量取真实路径；路径不存在时退回 resolve 结果（存在性由调用方另行校验） */
function realish(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function isSameOrInside(child: string, root: string): boolean {
  if (child === root) return true;
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  return child.startsWith(withSep);
}

export function allowedIsolatedRoots(
  options: IsolatedCwdOptions = {},
): string[] {
  const hostRoot = realish(options.hostRoot ?? process.cwd());
  const roots = [
    ...(options.allowTmpdir === false ? [] : [realish(os.tmpdir())]),
    path.join(hostRoot, ".tmp"),
    ...(options.allowedRoots ?? []).map(realish),
  ];
  return [...new Set(roots)];
}

/**
 * 校验 `cwd` 是否可安全用于测试期 git 写入；通过时返回规范化后的绝对路径。
 * 不通过一律抛 {@link GitCwdIsolationError}（fail-closed，无静默降级分支）。
 */
export function assertIsolatedGitCwd(
  cwd: string | undefined | null,
  options: IsolatedCwdOptions = {},
): string {
  const hostRoot = realish(options.hostRoot ?? process.cwd());
  const roots = allowedIsolatedRoots({ ...options, hostRoot });

  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new GitCwdIsolationError(
      `拒绝执行：git 操作未提供 cwd。测试必须在独立临时仓库内运行 git，` +
        `否则写入可能落到宿主仓库（${hostRoot}）。` +
        `请用 fs.mkdtempSync(path.join(os.tmpdir(), "stagent-test-")) 建仓库后再调用。`,
      {
        cwd: cwd ?? undefined,
        hostRoot,
        allowedRoots: roots,
        reason: "MISSING_CWD",
      },
    );
  }

  const resolved = realish(cwd);

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new GitCwdIsolationError(
      `拒绝执行：git 操作的 cwd 不是已存在的目录（${resolved}）。`,
      {
        cwd,
        resolved,
        hostRoot,
        allowedRoots: roots,
        reason: "NOT_A_DIRECTORY",
      },
    );
  }

  if (resolved === hostRoot) {
    throw new GitCwdIsolationError(
      `拒绝执行：git 操作指向宿主仓库根（${hostRoot}）。` +
        `测试绝不允许在开发者真实仓库里执行写操作——这正是 .git/config 被改写的成因。`,
      { cwd, resolved, hostRoot, allowedRoots: roots, reason: "HOST_ROOT" },
    );
  }

  if (isSameOrInside(hostRoot, resolved)) {
    throw new GitCwdIsolationError(
      `拒绝执行：cwd（${resolved}）是宿主仓库的祖先目录，git 会向上发现 ${hostRoot}/.git 并写入宿主仓库。`,
      { cwd, resolved, hostRoot, allowedRoots: roots, reason: "HOST_ANCESTOR" },
    );
  }

  if (!roots.some((root) => isSameOrInside(resolved, root))) {
    throw new GitCwdIsolationError(
      `拒绝执行：cwd（${resolved}）不在允许的隔离根内。` +
        `只允许 ${roots.join(" 或 ")} 下的目录，避免误伤宿主仓库。`,
      {
        cwd,
        resolved,
        hostRoot,
        allowedRoots: roots,
        reason: "OUTSIDE_ISOLATED_ROOTS",
      },
    );
  }

  return resolved;
}

/** 是否在测试运行器内（Vitest 会注入 VITEST） */
export function isTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env["VITEST"] !== undefined ||
    env["VITEST_POOL_ID"] !== undefined ||
    env["VITEST_WORKER_ID"] !== undefined ||
    env["NODE_ENV"] === "test"
  );
}

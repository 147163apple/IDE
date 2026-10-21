import { execFileSync } from "node:child_process";
import { assertSafeGitCwd } from "../../daemon/git/worktree-manager";

/**
 * 测试专用 `git` 辅助：**先过宿主仓库隔离守卫，再执行**。
 *
 * 全仓 17 个测试文件原先各自定义了一份
 * `function git(cwd, args) { return execFileSync("git", args, {cwd, encoding:"utf8"}); }`，
 * 完全绕过 `daemon/git` 里的 `execGit` 守卫——意味着任何一次 `cwd` 传错
 * （例如退化到 `process.cwd()`）都会直接写进开发者的真实仓库。
 * 2026-10-21 的 `.git/config.lock`（`user.name = Stagent Test`）就是这类写法
 * 在进程被中断时的残留。
 *
 * 现在统一走这里：`assertSafeGitCwd` 对 `git config` 写入无条件要求隔离目录，
 * 违背即抛 `E_GIT_CWD_NOT_ISOLATED`，绝不在宿主仓库执行。
 */
export function git(cwd: string, args: string[]): string {
  assertSafeGitCwd(args, cwd);
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

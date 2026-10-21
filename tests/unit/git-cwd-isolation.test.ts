import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GIT_CWD_ISOLATION_ERROR,
  GitCwdIsolationError,
  allowedIsolatedRoots,
  assertIsolatedGitCwd,
  isTestRuntime,
} from "../../daemon/git/test-isolation";
import {
  assertSafeGitCwd,
  execGit,
  isGitConfigWrite,
  isMutatingGitCommand,
} from "../../daemon/git/worktree-manager";

/**
 * 测试期 Git 写入的「宿主仓库隔离」守卫验收。
 *
 * 背景：2026-10-21 03:22 本仓库根部残留过 `.git/config.lock`，内容是
 * `user.name = Stagent Test`——一次 git config 写入指向了宿主仓库，
 * 只因中断才没真的改掉开发者身份。本套用例把"不许再发生"钉成可回归事实。
 */

const HOST = path.resolve(process.cwd());

function expectIsolationError(fn: () => unknown, reason: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GitCwdIsolationError);
    const guardErr = err as GitCwdIsolationError;
    expect(guardErr.code).toBe(GIT_CWD_ISOLATION_ERROR);
    expect(guardErr.details.reason).toBe(reason);
    return guardErr;
  }
  throw new Error(
    `expected GitCwdIsolationError(${reason}) but nothing thrown`,
  );
}

describe("守卫启用条件", () => {
  it("当前测试进程被识别为测试运行时（否则测试环境守卫形同虚设）", () => {
    expect(isTestRuntime()).toBe(true);
  });

  it("生产环境（无测试变量）不启用测试期守卫", () => {
    expect(isTestRuntime({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isTestRuntime({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(
      false,
    );
  });
});

describe("git 命令语义判定", () => {
  it("识别 git config 的写入形态", () => {
    expect(isGitConfigWrite(["config", "user.name", "X"])).toBe(true);
    expect(isGitConfigWrite(["config", "--local", "user.name", "X"])).toBe(
      true,
    );
    expect(isGitConfigWrite(["config", "--unset", "user.name"])).toBe(true);
    expect(isGitConfigWrite(["config", "--remove-section", "foo"])).toBe(true);
    expect(isGitConfigWrite(["config", "--add", "a.b", "v"])).toBe(true);
  });

  it("不把 git config 的读取当成写入（避免误伤）", () => {
    expect(isGitConfigWrite(["config", "user.name"])).toBe(false);
    expect(isGitConfigWrite(["config", "--get", "user.name"])).toBe(false);
    expect(isGitConfigWrite(["config", "--list"])).toBe(false);
    expect(isGitConfigWrite(["config", "-l"])).toBe(false);
  });

  it("区分变更型子命令与只读子命令", () => {
    expect(isMutatingGitCommand(["commit", "-m", "x"])).toBe(true);
    expect(isMutatingGitCommand(["worktree", "add", "p", "b"])).toBe(true);
    expect(isMutatingGitCommand(["init", "-b", "main"])).toBe(true);
    expect(isMutatingGitCommand(["status", "--porcelain"])).toBe(false);
    expect(isMutatingGitCommand(["log", "-1"])).toBe(false);
    expect(isMutatingGitCommand(["rev-parse", "HEAD"])).toBe(false);
  });
});

describe("assertIsolatedGitCwd：拒绝一切可疑 cwd", () => {
  it("cwd 未提供 → 抛错（missing）", () => {
    expectIsolationError(() => assertIsolatedGitCwd(undefined), "MISSING_CWD");
    expectIsolationError(() => assertIsolatedGitCwd(""), "MISSING_CWD");
    expectIsolationError(() => assertIsolatedGitCwd("   "), "MISSING_CWD");
  });

  it("cwd 不存在 / 不是目录 → 抛错", () => {
    expectIsolationError(
      () =>
        assertIsolatedGitCwd(path.join(os.tmpdir(), "definitely-not-here-x")),
      "NOT_A_DIRECTORY",
    );
    const file = path.join(os.tmpdir(), `stagent-guard-file-${process.pid}`);
    fs.writeFileSync(file, "x");
    try {
      expectIsolationError(() => assertIsolatedGitCwd(file), "NOT_A_DIRECTORY");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("宿主仓库根 → 抛错（host_root），这是事故现场", () => {
    const err = expectIsolationError(
      () => assertIsolatedGitCwd(HOST),
      "HOST_ROOT",
    );
    expect(err.details.hostRoot).toBe(HOST);
    expect(err.message).toContain("宿主仓库根");
  });

  it("宿主仓库的祖先目录 → 抛错（git 会向上发现 .git）", () => {
    const parent = path.dirname(HOST);
    expectIsolationError(() => assertIsolatedGitCwd(parent), "HOST_ANCESTOR");
  });

  it("宿主仓库内的普通子目录（非 .tmp）→ 抛错", () => {
    const inside = path.join(HOST, "daemon");
    expectIsolationError(
      () => assertIsolatedGitCwd(inside),
      "OUTSIDE_ISOLATED_ROOTS",
    );
  });

  it("系统其它目录（非临时、非仓库）→ 抛错", () => {
    expectIsolationError(
      () => assertIsolatedGitCwd("/usr"),
      "OUTSIDE_ISOLATED_ROOTS",
    );
  });
});

describe("assertIsolatedGitCwd：放行合法隔离目录", () => {
  it("os.tmpdir() 下的临时仓库通过，并返回规范化的绝对路径", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-guard-ok-"));
    try {
      expect(assertIsolatedGitCwd(repo)).toBe(fs.realpathSync(repo));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("仓库内 .tmp/** 工作区通过（既有测试的约定目录）", () => {
    const dir = path.join(HOST, ".tmp", "guard-test");
    fs.mkdirSync(dir, { recursive: true });
    try {
      expect(assertIsolatedGitCwd(dir)).toBe(fs.realpathSync(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("允许根清单同时包含 tmpdir 与仓库 .tmp", () => {
    const roots = allowedIsolatedRoots();
    expect(roots).toContain(fs.realpathSync(os.tmpdir()));
    expect(roots).toContain(path.join(HOST, ".tmp"));
  });
});

describe("execGit 集成：宿主 .git/config 零触碰、零锁残留", () => {
  /** 宿主仓库的可观测指纹：内容 + mtime + 是否出现 lock */
  function hostConfigFingerprint() {
    const configPath = path.join(HOST, ".git", "config");
    const lockPath = path.join(HOST, ".git", "config.lock");
    const stat = fs.statSync(configPath);
    return {
      content: fs.readFileSync(configPath, "utf-8"),
      mtimeMs: stat.mtimeMs,
      lockExists: fs.existsSync(lockPath),
    };
  }

  it("对 process.cwd() 执行 git config 写入被拒绝，且宿主动也没动", async () => {
    const before = hostConfigFingerprint();

    await expect(
      execGit(["config", "user.name", "Stagent Test"], HOST),
    ).rejects.toMatchObject({ code: GIT_CWD_ISOLATION_ERROR });

    const after = hostConfigFingerprint();
    expect(after.content).toBe(before.content);
    expect(after.content).not.toContain("Stagent Test");
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.lockExists).toBe(false);
  });

  it("对宿主仓库子目录写 config 同样被拒绝", async () => {
    const before = hostConfigFingerprint();
    await expect(
      execGit(
        ["config", "--local", "user.email", "x@y.z"],
        path.join(HOST, "daemon"),
      ),
    ).rejects.toMatchObject({ code: GIT_CWD_ISOLATION_ERROR });
    expect(hostConfigFingerprint().mtimeMs).toBe(before.mtimeMs);
    expect(hostConfigFingerprint().lockExists).toBe(false);
  });

  it("cwd 缺失（undefined）时不落到父进程目录，而是被拒绝", async () => {
    const before = hostConfigFingerprint();
    await expect(
      execGit(
        ["config", "user.name", "Stagent Test"],
        undefined as unknown as string,
      ),
    ).rejects.toMatchObject({ code: GIT_CWD_ISOLATION_ERROR });
    expect(hostConfigFingerprint().mtimeMs).toBe(before.mtimeMs);
    expect(hostConfigFingerprint().lockExists).toBe(false);
  });

  it("测试期对宿主仓库的其它写操作（commit / worktree add）也被拒绝", async () => {
    await expect(execGit(["commit", "-m", "x"], HOST)).rejects.toMatchObject({
      code: GIT_CWD_ISOLATION_ERROR,
    });
    await expect(
      execGit(
        ["worktree", "add", path.join(HOST, ".tmp", "leak"), "HEAD"],
        HOST,
      ),
    ).rejects.toMatchObject({ code: GIT_CWD_ISOLATION_ERROR });
  });

  it("不误伤：只读命令仍可在宿主仓库运行", async () => {
    const result = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], HOST);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("不误伤：临时仓库里写 config 正常生效", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-guard-write-"));
    try {
      await execGit(["init", "-b", "main"], repo);
      await execGit(["config", "user.name", "Stagent Test"], repo);
      const read = await execGit(["config", "user.name"], repo);
      expect(read.stdout).toBe("Stagent Test");
      expect(fs.existsSync(path.join(repo, ".git", "config.lock"))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("assertSafeGitCwd：两道守卫的分工", () => {
  it("读 config 不打守卫（否则连 --get 都要建临时仓库，荒谬）", () => {
    expect(() =>
      assertSafeGitCwd(["config", "--get", "user.name"], HOST),
    ).not.toThrow();
  });

  it("测试期的写操作打守卫", () => {
    expect(() => assertSafeGitCwd(["commit", "-m", "x"], HOST)).toThrow(
      GitCwdIsolationError,
    );
  });

  it("写 config 无条件打守卫（与是否测试环境无关）", () => {
    expect(() => assertSafeGitCwd(["config", "user.name", "X"], HOST)).toThrow(
      GitCwdIsolationError,
    );
  });
});

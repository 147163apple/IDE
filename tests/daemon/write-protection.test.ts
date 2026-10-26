import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";

import { probeWriteProtection } from "../../daemon/deps/write-protection-probe";
import {
  planDependencyStrategy,
  runIsolatedInstall,
} from "../../daemon/deps/strategy";
import { mountDependencySymlink } from "../../daemon/deps/resolver";

describe("M8-fix / TASK-A.3 写保护探测与依赖降级", () => {
  let repo: string;
  let worktree: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-wp-host-"));
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-wp-wt-"));
    fs.mkdirSync(path.join(repo, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "node_modules", "pkg", "index.js"),
      "module.exports = 1;",
    );
    fs.writeFileSync(
      path.join(repo, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3 }),
    );
    fs.writeFileSync(
      path.join(worktree, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3 }),
    );
  });

  afterEach(() => {
    safeRmSync(repo);
    safeRmSync(worktree);
  });

  it.skipIf(process.platform === "win32")(
    "探测能证明写保护，且不残留探针目录",
    async () => {
      const probe = await probeWriteProtection(path.join(repo, ".stagent"));
      expect(probe.proven).toBe(true);
      expect(probe.method).toBe("chmod-deny");

      const leftovers = fs
        .readdirSync(path.join(repo, ".stagent"))
        .filter((name) => name.startsWith(".stagent-wp-probe-"));
      expect(leftovers).toHaveLength(0);
    },
  );

  it("写保护不可证明时拒绝建立共享依赖视图", async () => {
    const result = await mountDependencySymlink({
      repoRoot: repo,
      worktreePath: worktree,
      probeFn: async (dir) => ({
        proven: false,
        method: "unavailable",
        checkedPath: dir,
        reason: "simulated root/Windows behavior",
      }),
    });

    expect(result.success).toBe(false);
    expect(result.warning).toContain("WRITE_PROTECTION_UNPROVEN");
    expect(result.probe?.proven).toBe(false);
    expect(fs.existsSync(path.join(worktree, "node_modules"))).toBe(false);
  });

  it("锁文件一致 + 探测通过 → SHARED_SYMLINK", async () => {
    const plan = await planDependencyStrategy({
      repoRoot: repo,
      worktreePath: worktree,
      probeFn: async (dir) => ({
        proven: true,
        method: "chmod-deny",
        checkedPath: dir,
      }),
    });

    expect(plan.strategy).toBe("SHARED_SYMLINK");
    expect(plan.lockfile.consistent).toBe(true);
    expect(plan.requiresAuthorization).toBe(false);
    expect(plan.reasons).toHaveLength(0);
  });

  it("锁文件不一致 → ISOLATED_INSTALL 且需用户授权", async () => {
    fs.writeFileSync(
      path.join(worktree, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, changed: true }),
    );
    const plan = await planDependencyStrategy({
      repoRoot: repo,
      worktreePath: worktree,
      probeFn: async (dir) => ({
        proven: true,
        method: "chmod-deny",
        checkedPath: dir,
      }),
    });

    expect(plan.strategy).toBe("ISOLATED_INSTALL");
    expect(plan.requiresAuthorization).toBe(true);
    expect(plan.reasons.join(" ")).toContain("differs");
  });

  it("写保护不可证明 → ISOLATED_INSTALL", async () => {
    const plan = await planDependencyStrategy({
      repoRoot: repo,
      worktreePath: worktree,
      probeFn: async (dir) => ({
        proven: false,
        method: "unavailable",
        checkedPath: dir,
        reason: "no enforced read-only",
      }),
    });
    expect(plan.strategy).toBe("ISOLATED_INSTALL");
    expect(plan.reasons.join(" ")).toContain("no enforced read-only");
  });

  it("隔离安装按包管理器选择冻结安装命令", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const result = await runIsolatedInstall({
      worktreePath: worktree,
      runner: async (cmd, args, cwd) => {
        calls.push({ cmd, args, cwd });
        return { code: 0 };
      },
    });
    expect(result.success).toBe(true);
    expect(calls[0]?.cmd).toBe("npm");
    expect(calls[0]?.args).toEqual(["ci", "--no-audit", "--no-fund"]);

    fs.writeFileSync(
      path.join(worktree, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'",
    );
    await runIsolatedInstall({
      worktreePath: worktree,
      runner: async (cmd, args, cwd) => {
        calls.push({ cmd, args, cwd });
        return { code: 0 };
      },
    });
    expect(calls[1]?.cmd).toBe("pnpm");
    expect(calls[1]?.args).toEqual(["install", "--frozen-lockfile"]);
  });

  it("隔离安装失败如实返回 success=false", async () => {
    const result = await runIsolatedInstall({
      worktreePath: worktree,
      runner: async () => ({ code: 1, output: "network down" }),
    });
    expect(result.success).toBe(false);
  });
});

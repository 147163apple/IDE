import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  mountDependencySymlink,
  unmountDependencySymlink,
} from "../../daemon/deps/resolver";
import {
  setupWorktreeCacheIsolation,
  cleanupWorktreeCaches,
  ISOLATED_CACHE_DIRECTORIES,
} from "../../daemon/deps/cache-isolator";
import { measureSchedulingStallMs } from "../helpers/load";

describe("Task 1.2: Dependency Reuse and Cache Isolation", () => {
  let tempHost: string;
  let tempWorktree: string;

  beforeEach(() => {
    tempHost = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-host-"));
    tempWorktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-wt-"));

    // Create fake host node_modules with sample package
    const hostNodeModules = path.join(tempHost, "node_modules");
    fs.mkdirSync(path.join(hostNodeModules, "sample-pkg"), { recursive: true });
    fs.writeFileSync(
      path.join(hostNodeModules, "sample-pkg", "package.json"),
      JSON.stringify({ name: "sample-pkg", version: "1.0.0" }),
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tempHost, { recursive: true, force: true });
      fs.rmSync(tempWorktree, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("should mount host node_modules into worktree via zero-copy symlink in under 500ms", async () => {
    // 零拷贝的**本质证据**是下面的 isSymbolicLink；500ms 只是「顺手用 symlink
    // 而不是 install」的性能旁证。并发下进程会被整段饿死，所以阈值随实测抖动放宽。
    const stall = await measureSchedulingStallMs();
    const result = await mountDependencySymlink({
      repoRoot: tempHost,
      worktreePath: tempWorktree,
    });

    expect(result.success).toBe(true);
    const budgetMs = 500 + stall * 3;
    expect(
      result.durationMs,
      `挂载耗时超出预算 ${Math.round(budgetMs)}ms（本机调度抖动 ${Math.round(stall)}ms）`,
    ).toBeLessThan(budgetMs);

    const wtNodeModules = path.join(tempWorktree, "node_modules");
    expect(fs.existsSync(wtNodeModules)).toBe(true);

    const lstat = fs.lstatSync(wtNodeModules);
    expect(lstat.isSymbolicLink()).toBe(true);

    // Verify content accessible through symlink
    const pkgPath = path.join(wtNodeModules, "sample-pkg", "package.json");
    expect(fs.existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("sample-pkg");
  });

  it("should gracefully handle missing host node_modules", async () => {
    const emptyHost = fs.mkdtempSync(path.join(os.tmpdir(), "empty-host-"));
    try {
      const result = await mountDependencySymlink({
        repoRoot: emptyHost,
        worktreePath: tempWorktree,
      });

      expect(result.success).toBe(false);
      expect(result.warning).toContain("does not exist");
    } finally {
      fs.rmSync(emptyHost, { recursive: true, force: true });
    }
  });

  it("should safely unmount dependency symlink without touching host node_modules", async () => {
    await mountDependencySymlink({
      repoRoot: tempHost,
      worktreePath: tempWorktree,
    });

    const unmounted = await unmountDependencySymlink(tempWorktree);
    expect(unmounted).toBe(true);

    const wtNodeModules = path.join(tempWorktree, "node_modules");
    expect(fs.existsSync(wtNodeModules)).toBe(false);

    // Host node_modules must remain intact
    const hostPkg = path.join(
      tempHost,
      "node_modules",
      "sample-pkg",
      "package.json",
    );
    expect(fs.existsSync(hostPkg)).toBe(true);
  });

  it("should isolate build tool cache directories inside the worktree", async () => {
    const isolation = await setupWorktreeCacheIsolation({
      worktreePath: tempWorktree,
    });

    expect(isolation.isolatedDirs.length).toBeGreaterThan(0);

    for (const relDir of ISOLATED_CACHE_DIRECTORIES) {
      const targetPath = path.join(tempWorktree, relDir);
      expect(fs.existsSync(targetPath)).toBe(true);
      // Host repo must not have been created
      expect(fs.existsSync(path.join(tempHost, relDir))).toBe(false);
    }

    await cleanupWorktreeCaches(tempWorktree);
  });
});

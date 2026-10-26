/**
 * TASK-H.4：无 .git 空目录引导后出现合法 .git；已有 .git 不得再 init。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureGitInit,
  inspectGitRepo,
} from "../../daemon/git/ensure-git-repo";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-h4-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("TASK-H.4 empty dir git init", () => {
  it("无 .git 的空目录经引导后出现合法 .git", () => {
    const root = tmp();
    expect(inspectGitRepo(root).hasGit).toBe(false);
    const unconfirmed = ensureGitInit(root, { confirm: false });
    expect(unconfirmed.ok).toBe(false);
    expect(unconfirmed.code).toBe("E_GIT_INIT_UNCONFIRMED");
    expect(fs.existsSync(path.join(root, ".git"))).toBe(false);

    const res = ensureGitInit(root, { confirm: true });
    expect(res.ok).toBe(true);
    expect(res.initialized).toBe(true);
    expect(inspectGitRepo(root).hasGit).toBe(true);
    expect(fs.existsSync(path.join(root, ".git"))).toBe(true);
  });

  it("已有 .git 目录不得被再次 init 破坏（幂等跳过）", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const run = vi.fn();
    const res = ensureGitInit(root, { confirm: true, runGitInit: run });
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("already_git");
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, ".git", "HEAD"), "utf8")).toContain(
      "ref: refs/heads/main",
    );
  });
});

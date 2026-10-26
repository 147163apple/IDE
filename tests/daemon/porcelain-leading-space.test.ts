/**
 * 回归：execGit/解析不得吞掉 porcelain 行首空格。
 * 症状：` M styles.css` → 漏计，或 slice(3) 后显示成 `tyles.css`。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dirtyReportFromPorcelain,
  inspectWorkspaceDirty,
} from "../../daemon/baseline/dirty-check";
import {
  execGit,
  inspectMainWorktree,
} from "../../daemon/git/worktree-manager";
import { parsePorcelainPath } from "../../daemon/graph/evidence-collector";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-porcelain-"));
  temps.push(root);
  fs.writeFileSync(path.join(root, "styles.css"), "body { color: red; }\n");
  fs.writeFileSync(path.join(root, "README.md"), "hello\n");
  return root;
}

async function gitInitWithCommit(root: string): Promise<void> {
  await execGit(["init", "-b", "main"], root);
  await execGit(["config", "user.name", "Stagent Test"], root);
  await execGit(["config", "user.email", "test@stagent.local"], root);
  await execGit(["add", "-A"], root);
  await execGit(["commit", "-m", "chore: init"], root);
}

describe("porcelain 行首空格（tracked unstaged）", () => {
  it("dirtyReportFromPorcelain：首行 ` M styles.css` 不得丢计/切名", () => {
    const report = dirtyReportFromPorcelain(" M styles.css\n?? scratch.tmp\n");
    expect(report.uncommitted).toEqual(["styles.css"]);
    expect(report.untracked).toEqual(["scratch.tmp"]);
    expect(report.protect_paths).toEqual(["scratch.tmp", "styles.css"]);
    expect(report.protect_paths.some((p) => p === "tyles.css")).toBe(false);
  });

  it("parsePorcelainPath（evidence）：slice(3) 在保留前导空格时正确", () => {
    expect(parsePorcelainPath(" M styles.css")).toBe("styles.css");
    expect(parsePorcelainPath("M styles.css")).not.toBe("styles.css");
    // 被 trim 后的坏输入会切成 tyles.css —— 本断言锁定该陷阱
    expect(parsePorcelainPath("M styles.css")).toBe("tyles.css");
  });

  it("execGit 默认 trimEnd：status porcelain 首行前导空格保留", async () => {
    const root = makeRepo();
    await gitInitWithCommit(root);
    fs.writeFileSync(path.join(root, "styles.css"), "body { color: blue; }\n");
    const status = await execGit(["status", "--porcelain", "-uall"], root);
    expect(status.stdout.startsWith(" ")).toBe(true);
    expect(status.stdout).toMatch(/^ M styles\.css/m);
    expect(status.stdout).not.toMatch(/^M styles\.css/m);
  });

  it("inspectWorkspaceDirty 经 execGit：计入 styles.css，不是 tyles.css", async () => {
    const root = makeRepo();
    await gitInitWithCommit(root);
    fs.writeFileSync(path.join(root, "styles.css"), "body { color: green; }\n");
    const report = await inspectWorkspaceDirty(root);
    expect(report.clean).toBe(false);
    expect(report.uncommitted).toContain("styles.css");
    expect(report.uncommitted).not.toContain("tyles.css");
    expect(report.protect_paths).toContain("styles.css");
    expect(report.protect_paths.some((p) => p === "tyles.css")).toBe(false);
  });

  it("inspectMainWorktree：tracked unstaged 文件名完整", async () => {
    const root = makeRepo();
    await gitInitWithCommit(root);
    fs.writeFileSync(path.join(root, "styles.css"), "body { color: black; }\n");
    const inspection = await inspectMainWorktree(root);
    expect(inspection.clean).toBe(false);
    expect(inspection.files).toContain("styles.css");
    expect(inspection.files).not.toContain("tyles.css");
  });
});

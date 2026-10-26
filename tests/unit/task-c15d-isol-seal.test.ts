/**
 * TASK-C.15d：P0 AC-ISOL drafts 隔离 + EO-09 worktree seal。
 */
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDraftsIsolated,
  assertDraftPath,
  assertStagentGitignored,
  draftsDir,
} from "../../daemon/guard/drafts-isolation";
import {
  acquireWorktreeLock,
  sealWorktree,
  releaseWorktreeLock,
  isWorktreeSealed,
  readWorktreeManifest,
} from "../../daemon/guard/worktree-seal";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c15d-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      safeRmSync(d);
    } catch {
      /* ignore */
    }
  }
});

describe("TASK-C.15d AC-ISOL + EO-09 seal", () => {
  it("drafts 落在 .stagent/drafts；越界拒绝", () => {
    const root = tmp();
    const dir = ensureDraftsIsolated(root);
    expect(dir).toBe(draftsDir(root));
    expect(dir.replace(/\\/g, "/")).toContain(".stagent/drafts");
    const ok = assertDraftPath(root, "plan.json");
    expect(ok.startsWith(dir)).toBe(true);
    expect(() => assertDraftPath(root, "../../etc/passwd")).toThrow(
      /越界/,
    );
  });

  it("本仓 .gitignore 含 .stagent/", () => {
    const repo = path.resolve(__dirname, "../..");
    const check = assertStagentGitignored(repo);
    expect(check.ok).toBe(true);
  });

  it("seal 成功后才可释放锁；未 seal 不释放", () => {
    const root = tmp();
    acquireWorktreeLock(root, "wt1");
    expect(releaseWorktreeLock(root, "wt1")).toBe(false);
    const seal = sealWorktree({ repoRoot: root, contract_id: "wt1" });
    expect(seal.ok).toBe(true);
    expect(isWorktreeSealed(root, "wt1")).toBe(true);
    expect(releaseWorktreeLock(root, "wt1")).toBe(true);
    const m = readWorktreeManifest(root, "wt1");
    expect(m?.sealed).toBe(true);
    expect(m?.lock_held).toBe(false);
  });
});

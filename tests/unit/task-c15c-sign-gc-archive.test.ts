/**
 * TASK-C.15c / EO-05：签署白名单 GC + MERGED→DELIVERED 失败停 MERGED。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runSignWhitelistGc,
  transitionMergedToDelivered,
} from "../../daemon/pipeline/sign-gc";
import { acquireWorktreeLock } from "../../daemon/guard/worktree-seal";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c15c-"));
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

describe("TASK-C.15c EO-05 sign GC + archive", () => {
  it("只清白名单 .cache / tmp；不动 drafts 与活跃 demo", () => {
    const root = tmp();
    const proto = path.join(root, ".stagent/prototypes/p1");
    const cache = path.join(proto, ".cache");
    const drafts = path.join(root, ".stagent/drafts/plan.md");
    const demo = path.join(proto, "index.html");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "x"), "junk");
    fs.mkdirSync(path.dirname(drafts), { recursive: true });
    fs.writeFileSync(drafts, "keep");
    fs.writeFileSync(demo, "<html/>");
    const tmpDiff = path.join(root, ".stagent/tmp/c1");
    fs.mkdirSync(tmpDiff, { recursive: true });
    fs.writeFileSync(path.join(tmpDiff, "patch"), "x");

    const res = runSignWhitelistGc({
      repoRoot: root,
      contract_id: "c1",
      prototype_id: "p1",
    });
    expect(res.ok).toBe(true);
    expect(fs.existsSync(cache)).toBe(false);
    expect(fs.existsSync(tmpDiff)).toBe(false);
    expect(fs.existsSync(drafts)).toBe(true);
    expect(fs.existsSync(demo)).toBe(true);
  });

  it("归档失败 → 停 MERGED，不标 DELIVERED", () => {
    const root = tmp();
    const result = transitionMergedToDelivered({
      repoRoot: root,
      contract_id: "c-fail",
      archiveFn: () => ({
        ok: false,
        records_dir: "x",
        copied: [],
        error: "injected fail",
      }),
    });
    expect(result.status).toBe("MERGED");
    if (result.status === "MERGED") {
      expect(result.reason).toMatch(/fail/);
    }
  });

  it("归档+seal 成功 → DELIVERED", () => {
    const root = tmp();
    acquireWorktreeLock(root, "c-ok");
    const result = transitionMergedToDelivered({
      repoRoot: root,
      contract_id: "c-ok",
      snapshot: { hello: "world" },
      assertion_ids: ["550e8400-e29b-41d4-a716-446655440000"],
    });
    expect(result.status).toBe("DELIVERED");
  });
});

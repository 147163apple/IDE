/**
 * TASK-C.14f：渐进扫回调按阶段触发（供 Daemon 广播 BASELINE_PROGRESS）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProgressiveBaselineScan } from "../../daemon/baseline/progressive";
import type { BaselineArchive } from "../../daemon/baseline/types";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("TASK-C.14f progressive callbacks", () => {
  it("onP0 → onDeep → onDone 顺序触发", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c14f-"));
    tmpDirs.push(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "cb-demo", version: "0.0.1" }),
    );
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const phases: string[] = [];
    await runProgressiveBaselineScan({
      repoRoot: root,
      toolVersion: "test",
      dirtyOverride: {
        clean: true,
        uncommitted: [],
        untracked: [],
        steward_message: null,
        protect_paths: [],
        dirty_exclusions: [],
      },
      callbacks: {
        onP0: (a: BaselineArchive) => {
          phases.push(`p0:${a.phase}`);
        },
        onDeep: (a: BaselineArchive) => {
          phases.push(`deep:${a.phase}`);
        },
        onDone: (a: BaselineArchive) => {
          phases.push(`done:${a.phase}`);
        },
      },
    });
    expect(phases[0]).toMatch(/^p0:/);
    expect(phases.some((p) => p.startsWith("deep:"))).toBe(true);
    expect(phases.at(-1)).toMatch(/^done:/);
  }, 30_000);
});

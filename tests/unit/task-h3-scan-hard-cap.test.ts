/**
 * TASK-H.3：超文件数上限 → 截断标志/白话；超时可测；只读证明不被绕过。
 */
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runCappedFileWalk,
  runDeepStaticScan,
  runP0SkeletonScan,
} from "../../daemon/baseline/sandbox-scanner";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-h3-"));
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

describe("TASK-H.3 scan hard cap + timeout", () => {
  it("fixture 超文件数上限 → 扫描停止且返回截断标志/文案", () => {
    const root = tmp();
    for (let i = 0; i < 12; i += 1) {
      fs.writeFileSync(path.join(root, `f${i}.txt`), "x");
    }
    const res = runCappedFileWalk({
      repoRoot: root,
      maxFiles: 5,
      maxDepth: 4,
      timeoutMs: 5_000,
    });
    expect(res.truncated).toBe(true);
    expect(res.truncate_reason).toBe("max_files");
    expect(res.files_scanned).toBeLessThanOrEqual(5);
    expect(res.truncate_plain).toMatch(/截断|上限/);
    expect(res.network_denied).toBe(true);
    expect(res.dynamic_exec_denied).toBe(true);
  });

  it("超时路径可测中断且只读证明不被绕过", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.ts"), "export {};");
    let t = 0;
    const deep = runDeepStaticScan({
      repoRoot: root,
      timeoutMs: 1,
      now: () => {
        t += 10;
        return t;
      },
      maxFiles: 100,
    });
    expect(deep.timed_out || deep.truncated).toBe(true);
    expect(deep.incomplete).toBe(true);

    const p0 = runP0SkeletonScan({
      repoRoot: root,
      timeoutMs: 1,
      now: () => 100,
      maxFiles: 3,
    });
    expect(p0.network_denied).toBe(true);
    expect(p0.dynamic_exec_denied).toBe(true);
  });
});

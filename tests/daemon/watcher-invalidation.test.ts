import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";

import { WorktreeWatcher, shouldIgnore } from "../../daemon/watcher/fs-watcher";
import { EvidenceInvalidationEngine } from "../../daemon/watcher/invalidation-engine";
import { evidenceBundleSchema } from "../../src/lib/evidence.schema";

function passedEvidence(contractId: string) {
  return evidenceBundleSchema.parse({
    evidence_id: "evi_m6",
    contract_id: contractId,
    generated_at: new Date().toISOString(),
    usage: {
      currency: "CNY",
      pricing_version: "v1",
      accounting_mode: "UNAVAILABLE",
      limit_reached: false,
    },
    worktree_snapshot: {
      head_sha: "abc",
      snapshot_fingerprint: "fp",
      captured_at: new Date().toISOString(),
    },
    verdict: { status: "PASSED", can_merge: true, summary: "all gates passed" },
    scope_audit: {
      passed: true,
      files_changed: [
        { path: "src/a.ts", additions: 1, deletions: 0, binary: false },
      ],
      forbidden_violations: [],
      budget_exhausted: false,
    },
    verification_results: [
      {
        command_alias: "test",
        exit_code: 0,
        stdout_tail: "ok",
        stderr_tail: "",
        duration_ms: 10,
        passed: true,
      },
    ],
    git_info: {
      base_commit_sha: "base",
      task_commit_sha: "task",
      diff_stat: "1 file changed",
      patch_fingerprint: "sha256",
    },
  });
}

describe("M6 / TASK-B.2 文件监听与 Evidence STALE 联动", () => {
  let worktree: string;
  let evidenceDir: string;
  let evidencePath: string;
  let engine: EvidenceInvalidationEngine;
  let watcher: WorktreeWatcher | null = null;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-watch-wt-"));
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-watch-ev-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 1;\n",
    );
    fs.mkdirSync(path.join(worktree, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, ".stagent", "session-token"),
      "secret",
    );

    evidencePath = path.join(evidenceDir, "evo.json");
    fs.writeFileSync(
      evidencePath,
      JSON.stringify(passedEvidence("c-watch"), null, 2),
    );

    engine = new EvidenceInvalidationEngine(worktree);
    engine.register("c-watch", evidencePath);
  });

  afterEach(async () => {
    await watcher?.stop();
    watcher = null;
    safeRmSync(worktree);
    safeRmSync(evidenceDir);
  });

  it("忽略 .stagent / .git / node_modules", () => {
    expect(
      shouldIgnore(path.join(worktree, ".stagent", "session-token"), worktree),
    ).toBe(true);
    expect(
      shouldIgnore(path.join(worktree, "node_modules", "x.js"), worktree),
    ).toBe(true);
    expect(shouldIgnore(path.join(worktree, "src", "a.ts"), worktree)).toBe(
      false,
    );
  });

  it("外部修改文件后 Evidence 立即变为 STALE 且禁止合并", async () => {
    const invalidated = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("watch timeout")), 4000);
      watcher = new WorktreeWatcher({
        worktreePath: worktree,
        onChange: (paths) => {
          const results = engine.handleChanges(paths);
          const hit = results.find((r) => r.stale);
          if (hit) {
            clearTimeout(timer);
            resolve(hit.evidencePath);
          }
        },
      });
      watcher.start();
    });

    // 等待 watcher 就绪
    await new Promise((r) => setTimeout(r, 150));
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 2;\n",
    );

    const changedEvidence = await invalidated;
    const updated = JSON.parse(fs.readFileSync(changedEvidence, "utf8")) as {
      verdict: { status: string; can_merge: boolean; reason_code: string };
    };

    expect(updated.verdict.status).toBe("STALE");
    expect(updated.verdict.can_merge).toBe(false);
    expect(updated.verdict.reason_code).toBe("EVIDENCE_STALE");
  });

  it("无变更时指纹稳定，不会误判 STALE", () => {
    const first = engine.computeFingerprint();
    const second = engine.computeFingerprint();
    expect(second).toBe(first);
  });
});

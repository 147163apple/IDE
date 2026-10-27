/**
 * TASK-C.14a/b/c：项目现状基线档案
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  assertBaselineNetworkDenied,
  assertNoDynamicProjectExec,
  BaselineNetworkDeniedError,
  runP0SkeletonScan,
  runDeepStaticScan,
  P0_TIMEOUT_MS,
} from "../../daemon/baseline/sandbox-scanner";
import {
  dirtyReportFromPorcelain,
  inspectWorkspaceDirty,
} from "../../daemon/baseline/dirty-check";
import {
  acceptBaselineAsReference,
  assertBaselineDoesNotGrantConstruction,
  baselineRoot,
  readBaselineArchive,
  writeBaselineArchive,
  newBaselineScanId,
} from "../../daemon/baseline/store";
import { runProgressiveBaselineScan } from "../../daemon/baseline/progressive";
import {
  guardSupervisorAgainstBaselineRace,
  prependBaselineGuardNotice,
} from "../../daemon/baseline/supervisor-guard";
import { mergeBaselineProtectIntoForbidden } from "../../daemon/baseline/scope-defaults";
import { buildStewardDirtyMessage } from "../../daemon/baseline/types";
import type { BaselineArchive } from "../../daemon/baseline/types";

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c14-"));
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "demo-app",
      version: "1.2.3",
      main: "src/index.ts",
    }),
  );
  fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "pages", "checkout.tsx"),
    `export default function Checkout(){ return null }\nconst path = "/checkout";\n`,
  );
  fs.writeFileSync(
    path.join(root, "src", "index.ts"),
    `import "./pages/checkout";\nexport const x = 1;\n`,
  );
  fs.writeFileSync(
    path.join(root, "src", "index.test.ts"),
    `import { x } from "./index";\n`,
  );
  // 副作用 fixture：若被 require 会留下标记文件
  fs.writeFileSync(
    path.join(root, "vite.config.ts"),
    `import fs from "node:fs";\nfs.writeFileSync("SIDE_EFFECT_RAN","1");\nexport default {};\n`,
  );
  fs.writeFileSync(path.join(root, ".env"), "SECRET_KEY=super-secret-value\n");
  execFileSync("git", ["add", "package.json", "src"], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  return root;
}

describe("TASK-C.14a sandbox scanner", () => {
  let root: string;
  beforeEach(() => {
    root = makeRepo();
  });
  afterEach(() => {
    safeRmSync(root);
  });

  it("不执行带副作用的项目配置（负例）", () => {
    runP0SkeletonScan({ repoRoot: root });
    expect(fs.existsSync(path.join(root, "SIDE_EFFECT_RAN"))).toBe(false);
    expect(() => assertNoDynamicProjectExec("vite.config.ts")).toThrow(
      /禁止动态执行/,
    );
  });

  it("出网探测被阻断", () => {
    expect(() => assertBaselineNetworkDenied("https://example.com")).toThrow(
      BaselineNetworkDeniedError,
    );
    const p0 = runP0SkeletonScan({ repoRoot: root });
    expect(p0.network_denied).toBe(true);
    expect(p0.dynamic_exec_denied).toBe(true);
  });

  it("超时熔断仍返回 P0 骨架字段", () => {
    // 人为把 now 推进到超时后
    let t = 1_000_000;
    const p0 = runP0SkeletonScan({
      repoRoot: root,
      timeoutMs: 5,
      now: () => {
        t += 100;
        return t;
      },
    });
    expect(p0.timed_out).toBe(true);
    expect(p0.package_name).toBe("demo-app");
    expect(p0.top_level_entries.length).toBeGreaterThan(0);
    expect(p0.duration_ms).toBeLessThanOrEqual(P0_TIMEOUT_MS + 50);
  });

  it("不写入用户业务树受测路径", () => {
    const before = fs.readdirSync(root).sort();
    runP0SkeletonScan({ repoRoot: root });
    runDeepStaticScan({ repoRoot: root, timeoutMs: 500 });
    const after = fs.readdirSync(root).sort();
    expect(after).toEqual(before);
    expect(fs.existsSync(path.join(root, "SIDE_EFFECT_RAN"))).toBe(false);
  });
});

describe("TASK-C.14b progressive + store", () => {
  let root: string;
  beforeEach(() => {
    root = makeRepo();
  });
  afterEach(() => {
    safeRmSync(root);
  });

  it("落盘在 .stagent/records/baseline/ 且无 contract_000", async () => {
    const phases: string[] = [];
    const archive = await runProgressiveBaselineScan({
      repoRoot: root,
      dirtyOverride: {
        clean: true,
        uncommitted: [],
        untracked: [],
        steward_message: null,
        protect_paths: [],
        dirty_exclusions: [],
      },
      callbacks: {
        onP0: (a) => phases.push(`p0:${a.phase}`),
        onDone: (a) => phases.push(`done:${a.phase}`),
      },
    });
    expect(archive.kind).toBe("project_baseline_archive");
    expect(archive.scan_id).not.toMatch(/contract_000/i);
    expect(archive.grants_construction).toBe(false);
    expect(archive.p0?.package_name).toBe("demo-app");
    const rootDir = baselineRoot(root);
    expect(rootDir.replace(/\\/g, "/")).toContain(".stagent/records/baseline");
    expect(fs.existsSync(path.join(rootDir, "latest.json"))).toBe(true);
    const disk = readBaselineArchive(root);
    expect(disk?.scan_id).toBe(archive.scan_id);
    expect(JSON.stringify(disk)).not.toMatch(/contract_000/);
    expect(phases.some((p) => p.startsWith("p0:"))).toBe(true);
  });

  it("认可此基线作为后续参考 ≠ 授权施工", async () => {
    await runProgressiveBaselineScan({
      repoRoot: root,
      dirtyOverride: {
        clean: true,
        uncommitted: [],
        untracked: [],
        steward_message: null,
        protect_paths: [],
        dirty_exclusions: [],
      },
    });
    const accepted = acceptBaselineAsReference(root);
    expect(accepted.review_status).toBe("accepted");
    expect(accepted.grants_construction).toBe(false);
    assertBaselineDoesNotGrantConstruction(accepted);
    expect(accepted.accepted_at).toBeTruthy();
  });

  it("禁止 scan_id 为 contract_000", () => {
    const bad: BaselineArchive = {
      schema_version: "1.0.0",
      kind: "project_baseline_archive",
      scan_id: "contract_000",
      scanned_at: new Date().toISOString(),
      tool_version: "t",
      review_status: "pending_review",
      accepted_at: null,
      grants_construction: false,
      phase: "done",
      progress_copy: "x",
      p0: null,
      deep: null,
      dirty: {
        clean: true,
        uncommitted: [],
        untracked: [],
        steward_message: null,
        protect_paths: [],
        dirty_exclusions: [],
      },
      os_sandbox: null,
      ignore_rules: [],
      incomplete: false,
      notes: [],
    };
    expect(() => writeBaselineArchive(root, bad)).toThrow(/contract_000/);
  });
});

describe("TASK-C.14c dirty + guard + scope", () => {
  it("管家话术黄标（非恐吓）", () => {
    const msg = buildStewardDirtyMessage(3);
    expect(msg).toContain("未保存的临时文件");
    expect(msg).toContain("保护白名单");
    expect(msg).not.toMatch(/损坏|中毒|错误/);
    const report = dirtyReportFromPorcelain(
      " M src/a.ts\n?? .env.local\n?? tmp.log\n",
    );
    expect(report.clean).toBe(false);
    expect(report.protect_paths).toEqual([".env.local", "src/a.ts", "tmp.log"]);
    expect(report.steward_message).toContain("3 个");
  });

  it("落盘 dirty_exclusions >200 时不被 redactDeep 截断，话术数字一致", () => {
    const root = makeRepo();
    try {
      const paths = Array.from({ length: 306 }, (_, i) => `tmp/file-${i}.txt`);
      const archive: BaselineArchive = {
        schema_version: "1.0.0",
        kind: "project_baseline_archive",
        scan_id: newBaselineScanId(),
        scanned_at: new Date().toISOString(),
        tool_version: "t",
        review_status: "pending_review",
        accepted_at: null,
        grants_construction: false,
        phase: "done",
        progress_copy: "x",
        p0: null,
        deep: null,
        dirty: {
          clean: false,
          uncommitted: paths.slice(0, 100),
          untracked: paths.slice(100),
          // 故意写成与清单不符的旧话术，落盘后必须纠正
          steward_message: buildStewardDirtyMessage(999),
          protect_paths: paths,
          dirty_exclusions: paths,
        },
        os_sandbox: null,
        ignore_rules: [],
        incomplete: false,
        notes: [],
      };
      writeBaselineArchive(root, archive);
      const loaded = readBaselineArchive(root);
      expect(loaded).not.toBeNull();
      expect(loaded!.dirty.dirty_exclusions).toHaveLength(306);
      expect(loaded!.dirty.protect_paths).toHaveLength(306);
      expect(loaded!.dirty.steward_message).toBe(buildStewardDirtyMessage(306));
      expect(loaded!.dirty.steward_message).toContain("306 个");
      const merged = mergeBaselineProtectIntoForbidden(root, [".git/"]);
      expect(merged.filter((p) => p.startsWith("tmp/"))).toHaveLength(306);
    } finally {
      safeRmSync(root);
    }
  });

  it("首张微合同默认排除脏路径", () => {
    const root = makeRepo();
    try {
      const archive: BaselineArchive = {
        schema_version: "1.0.0",
        kind: "project_baseline_archive",
        scan_id: newBaselineScanId(),
        scanned_at: new Date().toISOString(),
        tool_version: "t",
        review_status: "pending_review",
        accepted_at: null,
        grants_construction: false,
        phase: "done",
        progress_copy: "x",
        p0: null,
        deep: null,
        dirty: {
          clean: false,
          uncommitted: ["src/dirty.ts"],
          untracked: [".env.local"],
          steward_message: buildStewardDirtyMessage(2),
          protect_paths: [".env.local", "src/dirty.ts"],
          dirty_exclusions: [".env.local", "src/dirty.ts"],
        },
        os_sandbox: null,
        ignore_rules: [],
        incomplete: false,
        notes: [],
      };
      writeBaselineArchive(root, archive);
      const merged = mergeBaselineProtectIntoForbidden(root, [
        ".git/",
        ".stagent/",
      ]);
      expect(merged).toContain(".env.local");
      expect(merged).toContain("src/dirty.ts");
      expect(merged).toContain(".git/");
    } finally {
      safeRmSync(root);
    }
  });

  it("深度未完时 Supervisor 降级且不空白", () => {
    const waiting = guardSupervisorAgainstBaselineRace({
      schema_version: "1.0.0",
      kind: "project_baseline_archive",
      scan_id: "baseline-x",
      scanned_at: new Date().toISOString(),
      tool_version: "t",
      review_status: "pending_review",
      accepted_at: null,
      grants_construction: false,
      phase: "p2",
      progress_copy: "deep",
      p0: null,
      deep: null,
      dirty: {
        clean: true,
        uncommitted: [],
        untracked: [],
        steward_message: null,
        protect_paths: [],
        dirty_exclusions: [],
      },
      os_sandbox: null,
      ignore_rules: [],
      incomplete: false,
      notes: [],
    });
    expect(waiting.allow_full_impact).toBe(false);
    expect(waiting.mode).toBe("wait_deep");
    const text = prependBaselineGuardNotice("我按大事帮你出了草案。", waiting);
    expect(text.length).toBeGreaterThan(10);
    expect(text).toContain("我按大事帮你出了草案。");
  });

  it("图谱节点两行白话", async () => {
    const root = makeRepo();
    try {
      const archive = await runProgressiveBaselineScan({
        repoRoot: root,
        dirtyOverride: {
          clean: true,
          uncommitted: [],
          untracked: [],
          steward_message: null,
          protect_paths: [],
          dirty_exclusions: [],
        },
      });
      const nodes = [
        ...(archive.deep?.capability_nodes ?? []),
        ...(archive.deep?.structure_nodes ?? []),
      ];
      expect(nodes.length).toBeGreaterThan(0);
      for (const n of nodes.slice(0, 5)) {
        expect(n.provenance_plain).toMatch(/^来源线索：/);
        expect(n.status_plain).toContain("未经自动化测试验证");
      }
    } finally {
      safeRmSync(root);
    }
  });

  it("inspectWorkspaceDirty 在脏仓可读", async () => {
    const root = makeRepo();
    try {
      fs.writeFileSync(path.join(root, "scratch.tmp"), "x");
      const report = await inspectWorkspaceDirty(root);
      expect(report.clean).toBe(false);
      expect(report.untracked).toContain("scratch.tmp");
      expect(report.steward_message).toBeTruthy();
    } finally {
      safeRmSync(root);
    }
  });
});

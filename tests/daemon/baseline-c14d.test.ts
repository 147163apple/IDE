/**
 * TASK-C.14d：脏区 → Scope 真链路硬门禁
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  dirtyReportFromPorcelain,
  inspectWorkspaceDirty,
} from "../../daemon/baseline/dirty-check";
import {
  formatDirtyExclusionsPlain,
  loadBaselineDirtyExclusions,
  mergeBaselineProtectIntoForbidden,
  pathMatchesDirtyExclusion,
} from "../../daemon/baseline/scope-defaults";
import {
  newBaselineScanId,
  writeBaselineArchive,
} from "../../daemon/baseline/store";
import type { BaselineArchive } from "../../daemon/baseline/types";
import { buildStewardDirtyMessage } from "../../daemon/baseline/types";
import { buildL0Plan } from "../../daemon/supervisor/rules-l0";
import { generateContractDraft } from "../../daemon/supervisor/draft-generator";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import { runBoundaryStop } from "../../daemon/guard/boundary-stop";
import { ExecTokenStore } from "../../daemon/core/exec-token";

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c14d-"));
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const n = 1;\n");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "c14d-demo", version: "0.0.1" }),
  );
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  return root;
}

function writeBaselineWithDirty(
  root: string,
  dirtyExclusions: string[],
): BaselineArchive {
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
    progress_copy: "done",
    p0: null,
    deep: null,
    dirty: {
      clean: dirtyExclusions.length === 0,
      uncommitted: dirtyExclusions.filter((p) => !p.startsWith(".") || p === ".env.local"),
      untracked: dirtyExclusions,
      steward_message: buildStewardDirtyMessage(dirtyExclusions.length),
      protect_paths: dirtyExclusions,
      dirty_exclusions: dirtyExclusions,
    },
    os_sandbox: null,
    ignore_rules: [],
    incomplete: false,
    notes: [],
  };
  writeBaselineArchive(root, archive);
  return archive;
}

function fileHash(abs: string): string {
  return createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

describe("TASK-C.14d dirty_exclusions → forbidden_paths", () => {
  let root: string;
  beforeEach(() => {
    root = makeRepo();
  });
  afterEach(() => {
    safeRmSync(root);
  });

  it("Dirty Check 产出 dirty_exclusions 物理清单", async () => {
    fs.writeFileSync(path.join(root, ".env.local"), "SECRET=keep-me\n");
    fs.writeFileSync(path.join(root, "scratch-untracked.sh"), "#!/bin/sh\necho hi\n");
    const report = await inspectWorkspaceDirty(root);
    expect(report.dirty_exclusions).toEqual(
      expect.arrayContaining([".env.local", "scratch-untracked.sh"]),
    );
    expect(report.protect_paths).toEqual(report.dirty_exclusions);
    expect(report.clean).toBe(false);
  });

  it("首张微合同注入 dirty_exclusions 且白话列出绝不触碰", async () => {
    writeBaselineWithDirty(root, [".env.local", "scratch-untracked.sh"]);
    const plan = buildL0Plan({
      repoRoot: root,
      messages: [
        {
          message_id: "m1",
          role: "user",
          text: "给 src/app.ts 加一行注释",
          created_at: new Date().toISOString(),
          source: "ui",
        },
      ],
    });
    expect(plan.dirty_exclusions).toEqual(
      expect.arrayContaining([".env.local", "scratch-untracked.sh"]),
    );
    expect(plan.strictly_forbidden_paths).toEqual(
      expect.arrayContaining([".env.local", "scratch-untracked.sh"]),
    );
    const plain = formatDirtyExclusionsPlain(plan.dirty_exclusions);
    expect(plain).toContain("绝不触碰");
    expect(plain).toContain(".env.local");

    const outcome = await generateContractDraft({
      repoRoot: root,
      trigger: "USER_REQUEST",
      messages: [
        {
          message_id: "m1",
          role: "user",
          text: "给 src/app.ts 加一行注释",
          created_at: new Date().toISOString(),
          source: "ui",
        },
      ],
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;
    const forbidden =
      outcome.contract.authorization.file_system_scope.strictly_forbidden_paths;
    expect(forbidden).toEqual(
      expect.arrayContaining([".env.local", "scratch-untracked.sh"]),
    );
    const rationale = outcome.rationale.join("\n");
    expect(rationale).toContain("绝不触碰");
    expect(rationale).toMatch(/\.env\.local/);
  });

  it("Worker touch 脏区 → E_OUT_OF_SCOPE_UNTRACKED + C.12c 软停链；文件不变", async () => {
    const envLocal = path.join(root, ".env.local");
    const script = path.join(root, "scratch-untracked.sh");
    const envBody = "SECRET=do-not-overwrite\n";
    const scriptBody = "#!/bin/sh\necho original\n";
    fs.writeFileSync(envLocal, envBody);
    fs.writeFileSync(script, scriptBody);
    const envHash = fileHash(envLocal);
    const scriptHash = fileHash(script);
    const envMtime = fs.statSync(envLocal).mtimeMs;
    const scriptMtime = fs.statSync(script).mtimeMs;

    writeBaselineWithDirty(root, [".env.local", "scratch-untracked.sh"]);
    const dirty = loadBaselineDirtyExclusions(root);
    expect(dirty).toEqual(
      expect.arrayContaining([".env.local", "scratch-untracked.sh"]),
    );

    const forbidden = mergeBaselineProtectIntoForbidden(root, [
      "**/.git/**",
      "**/.stagent/**",
    ]);
    expect(forbidden).toEqual(
      expect.arrayContaining([".env.local", "scratch-untracked.sh"]),
    );

    const contract = {
      contract_id: "c14d-contract",
      schema_version: "1.2.0",
      contract_revision: 1,
      created_at: new Date().toISOString(),
      creator: "tina",
      worker_spec: {
        adapter_id: "stagent.builtin.ai-sdk",
        runtime_kind: "MANAGED_TOOL_CALLING",
        control_mode: "GATEWAY_ENFORCED",
        adapter_version: "0.1.0",
      },
      lifecycle_state: "EXECUTING",
      intent: {
        title: "c14d-e2e",
        description: "试写脏区应被拦截",
        acceptance_criteria: ["脏文件不变"],
        risk_level: "LOW",
      },
      authorization: {
        git: {
          base_branch: "main",
          task_branch: "task/c14d",
          target_branch: "main",
          use_worktree: true,
        },
        file_system_scope: {
          // 故意把脏路径放进 writable，验证 forbidden/dirty 仍硬拦
          writable_paths: ["src/**", ".env.local", "scratch-untracked.sh"],
          readonly_paths: [],
          strictly_forbidden_paths: forbidden,
        },
        budget_limits: {
          max_file_modifications: 10,
          max_total_diff_lines: 2000,
          max_duration_seconds: 60,
          max_verification_retries: 2,
        },
        cost_limits: {
          max_cost_minor_units: 100000,
          currency: "USD",
          pricing_version: "test",
          accounting_mode: "ESTIMATED",
        },
        execution_permissions: {
          allowed_commands: ["true"],
          allowed_environment_variable_names: [],
          network_policy: "DENY",
          dependency_changes_allowed: false,
        },
      },
      verification_spec: {
        commands: [
          {
            alias: "true",
            executable: "true",
            args: [],
            expected_exit_code: 0,
            timeout_seconds: 5,
          },
        ],
      },
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
      },
    } as unknown as SoftwareContract;

    const blocked: Array<{ code: string; path: string }> = [];
    const signals: string[] = [];
    const tokenStore = new ExecTokenStore();
    const boundaryPromises: Promise<unknown>[] = [];

    const gateway = new ScopedWorktreeGateway(root, contract, {
      dirtyExclusions: dirty,
      onScopeBlocked: (info) => {
        blocked.push({ code: info.code, path: info.path });
        boundaryPromises.push(
          runBoundaryStop({
            contract_id: contract.contract_id,
            repoRoot: root,
            worktreePath: root,
            tokenStore,
            workerPid: 424242,
            hooks: {
              softStopMs: 10,
              signalProcess: (_pid, signal) => {
                signals.push(signal);
              },
              waitForExit: async () => false,
              clearLocks: () => [],
              revoke: () => true,
            },
          }),
        );
      },
    });

    const writeEnv = await gateway.callTool("stagent_write_file", {
      path: ".env.local",
      content: "SECRET=hacked\n",
    });
    expect(writeEnv.isError).toBe(true);
    expect(writeEnv.error?.code).toBe("E_OUT_OF_SCOPE_UNTRACKED");

    const writeScript = await gateway.callTool("stagent_write_file", {
      path: "scratch-untracked.sh",
      content: "#!/bin/sh\necho hacked\n",
    });
    expect(writeScript.isError).toBe(true);
    expect(writeScript.error?.code).toBe("E_OUT_OF_SCOPE_UNTRACKED");

    const delEnv = await gateway.callTool("stagent_delete_file", {
      path: ".env.local",
    });
    expect(delEnv.isError).toBe(true);
    expect(delEnv.error?.code).toBe("E_OUT_OF_SCOPE_UNTRACKED");

    await Promise.all(boundaryPromises);

    expect(blocked.length).toBeGreaterThanOrEqual(2);
    expect(blocked.every((b) => b.code === "E_OUT_OF_SCOPE_UNTRACKED")).toBe(
      true,
    );
    expect(signals).toContain("SIGINT");
    expect(signals).toContain("SIGKILL");

    expect(fs.readFileSync(envLocal, "utf8")).toBe(envBody);
    expect(fs.readFileSync(script, "utf8")).toBe(scriptBody);
    expect(fileHash(envLocal)).toBe(envHash);
    expect(fileHash(script)).toBe(scriptHash);
    expect(fs.statSync(envLocal).mtimeMs).toBe(envMtime);
    expect(fs.statSync(script).mtimeMs).toBe(scriptMtime);
  });

  it("pathMatchesDirtyExclusion 精确命中", () => {
    const report = dirtyReportFromPorcelain(
      " M src/a.ts\n?? .env.local\n?? scripts/tmp.sh\n",
    );
    expect(report.dirty_exclusions).toEqual([
      ".env.local",
      "scripts/tmp.sh",
      "src/a.ts",
    ]);
    expect(pathMatchesDirtyExclusion(".env.local", report.dirty_exclusions)).toBe(
      true,
    );
    expect(pathMatchesDirtyExclusion("src/clean.ts", report.dirty_exclusions)).toBe(
      false,
    );
  });
});

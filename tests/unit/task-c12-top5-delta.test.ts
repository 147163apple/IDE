/**
 * TASK-C.12a～e：API Top5 Delta 验收单测（EO-07/01/02/05/06/03/04）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  E_EXEC_TOKEN_MISSING,
  E_EXEC_TOKEN_REVOKED,
  E_RESUME_TOKEN_REUSED,
  ExecTokenStore,
  tokenFingerprint,
  resetExecTokenStoreForTests,
} from "../../daemon/core/exec-token";
import { SessionSeqTracker, shouldAcceptStateSeq } from "../../daemon/state/session-seq";
import { shouldApplyStateChanged } from "../../src/lib/state/state-seq-filter";
import {
  assertNotMasqueradingAsDelivery,
  canSign,
  projectDeliveryState,
  isDeliveryState,
} from "../../src/lib/state/delivery-state";
import {
  BOUNDARY_SOFT_STOP_MS,
  runBoundaryStop,
  forceClearIndexLocks,
} from "../../daemon/guard/boundary-stop";
import {
  writeAuditManifest,
  readAuditManifest,
  auditManifestPath,
} from "../../daemon/guard/audit-manifest";
import {
  archiveContractRecords,
  assertRecordsReadyForDelivered,
} from "../../daemon/pipeline/records-archive";
import {
  buildMinimalPrototypeDemo,
  confirmDemoPrototype,
  evaluateCanSign,
  writePrototype,
} from "../../daemon/supervisor/demo/prototypes";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import { toStateChangedPayload } from "../../daemon/state/presentation-projector";
import type { PersistedPresentationRecord } from "../../daemon/state/presentation-store";

const tmpDirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c12-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetExecTokenStoreForTests();
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function sampleContract(): SoftwareContract {
  return {
    contract_id: "c12-contract",
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
      title: "C12",
      description: "delta",
      acceptance_criteria: ["ok"],
      risk_level: "LOW",
    },
    authorization: {
      git: {
        base_branch: "main",
        task_branch: "task/c12",
        target_branch: "main",
        use_worktree: true,
      },
      file_system_scope: {
        writable_paths: ["src/**"],
        readonly_paths: [],
        strictly_forbidden_paths: ["**/.git/**"],
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
          alias: "noop",
          executable: "true",
          args: [],
          expected_exit_code: 0,
          timeout_seconds: 10,
        },
      ],
    },
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: new Date().toISOString(),
    },
  } as SoftwareContract;
}

describe("TASK-C.12a exec_token / resume_token", () => {
  it("无 exec_token 时 Gateway 写被拒", async () => {
    const wt = tmp();
    fs.mkdirSync(path.join(wt, "src"), { recursive: true });
    const store = new ExecTokenStore();
    let token: string | null = null;
    const gw = new ScopedWorktreeGateway(wt, sampleContract(), {
      execToken: { store, getToken: () => token },
    });
    const res = await gw.callTool("stagent_write_file", {
      path: "src/a.ts",
      content: "x",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe(E_EXEC_TOKEN_MISSING);
    expect(fs.existsSync(path.join(wt, "src", "a.ts"))).toBe(false);
  });

  it("PAUSED 吊销后旧 exec 写失败；resume jti 一次性", async () => {
    const wt = path.resolve(tmp());
    fs.mkdirSync(path.join(wt, "src"), { recursive: true });
    const store = new ExecTokenStore();
    const issued = store.issueExecToken({
      contract_id: "c12-contract",
      worktree: wt,
      writable_paths: ["src/**"],
    });
    let token: string | null = issued.token;
    const gw = new ScopedWorktreeGateway(wt, sampleContract(), {
      execToken: { store, getToken: () => token },
    });
    const ok = await gw.callTool("stagent_write_file", {
      path: "src/ok.ts",
      content: "1",
    });
    expect(ok.isError).toBe(false);

    store.revokeExecToken("c12-contract");
    token = issued.token; // 旧明文仍在手上
    const denied = await gw.callTool("stagent_write_file", {
      path: "src/nope.ts",
      content: "2",
    });
    expect(denied.isError).toBe(true);
    expect(denied.error?.code).toBe(E_EXEC_TOKEN_REVOKED);

    const resume = store.issueResumeToken({ contract_id: "c12-contract" });
    const again = store.consumeResumeToken(resume.token, {
      worktree: wt,
      writable_paths: ["src/**"],
    });
    token = again.token;
    const after = await gw.callTool("stagent_write_file", {
      path: "src/after.ts",
      content: "3",
    });
    expect(after.isError).toBe(false);

    expect(() =>
      store.consumeResumeToken(resume.token, {
        worktree: wt,
        writable_paths: ["src/**"],
      }),
    ).toThrowError(/E_RESUME_TOKEN_REUSED|已使用/);

    // 指纹可观测；明文不出现在指纹里
    const fp = tokenFingerprint(again.token);
    expect(fp).toHaveLength(12);
    expect(again.token.includes(fp)).toBe(false);
  });
});

describe("TASK-C.12b epoch/seq + DeliveryState", () => {
  it("连续 STATE seq 递增；更小 seq 被客户端忽略", () => {
    const tracker = new SessionSeqTracker(1);
    const a = tracker.next();
    const b = tracker.next();
    expect(b.state_seq).toBe(a.state_seq + 1);
    expect(b.session_epoch).toBe(a.session_epoch);
    expect(shouldAcceptStateSeq(b, a)).toBe(true);
    expect(shouldAcceptStateSeq(a, b)).toBe(false);

    let cursor = shouldApplyStateChanged(a, null).next;
    const skip = shouldApplyStateChanged(a, cursor);
    expect(skip.apply).toBe(false);
    const apply = shouldApplyStateChanged(b, cursor);
    expect(apply.apply).toBe(true);
    cursor = apply.next;

    tracker.bumpEpoch();
    const c = tracker.next();
    expect(c.session_epoch).toBe(2);
    expect(c.state_seq).toBe(1);
    expect(shouldApplyStateChanged(c, cursor).apply).toBe(true);
  });

  it("载荷含 EO-01 delivery_state；资产 FROZEN 不得冒充", () => {
    const rec: PersistedPresentationRecord = {
      contract_id: "c12",
      presentation_state: "EXECUTING",
      lifecycle_state: "EXECUTING",
      approval_status: "APPROVED",
      message: "施工中",
      updated_at: new Date().toISOString(),
    };
    const payload = toStateChangedPayload(rec, {
      seq: { session_epoch: 1, state_seq: 3 },
    });
    expect(payload.session_epoch).toBe(1);
    expect(payload.state_seq).toBe(3);
    expect(payload.delivery_state).toBe("IMPLEMENTING");
    expect(isDeliveryState("IMPLEMENTING")).toBe(true);

    expect(() => assertNotMasqueradingAsDelivery("FROZEN")).toThrow(/不得冒充/);

    const signing = projectDeliveryState({
      lifecycle_state: "PENDING_APPROVAL",
      activity_transient: "CONTRACT_SIGNING",
    });
    expect(signing).toBe("CONTRACT_SIGNING");
  });
});

describe("TASK-C.12c boundary soft-stop sequence", () => {
  it("钩子可观测：先 SIGINT，超时再 SIGKILL，再吊销与清锁", async () => {
    const repo = tmp();
    const gitDir = path.join(repo, ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    const lock = path.join(gitDir, "index.lock");
    fs.writeFileSync(lock, "locked");

    const store = new ExecTokenStore();
    store.issueExecToken({
      contract_id: "c12-contract",
      worktree: repo,
      writable_paths: ["src/**"],
    });

    const signals: string[] = [];
    const result = await runBoundaryStop({
      contract_id: "c12-contract",
      repoRoot: repo,
      workerPid: 424242,
      tokenStore: store,
      hooks: {
        softStopMs: 30,
        signalProcess: (_pid, signal) => {
          signals.push(signal);
        },
        waitForExit: async () => false, // 强制走超时 SIGKILL
        clearLocks: (root) => forceClearIndexLocks(root),
      },
    });

    expect(signals).toEqual(["SIGINT", "SIGKILL"]);
    expect(result.soft_signaled).toBe(true);
    expect(result.hard_killed).toBe(true);
    expect(result.token_revoked).toBe(true);
    expect(store.peekExecToken("c12-contract")).toBeNull();
    expect(fs.existsSync(lock)).toBe(false);
    expect(result.sequence[0]).toBe("BLOCK_IO");
    expect(result.sequence).toContain("SIGINT_SOFT_STOP");
    expect(result.soft_stop_ms).toBe(30);
    expect(BOUNDARY_SOFT_STOP_MS).toBe(3000);
  });
});

describe("TASK-C.12d demo_mode + can_sign + records", () => {
  it("三态可写；流程卡冒充交互时 can_sign 失败", () => {
    const repo = tmp();
    const demo = buildMinimalPrototypeDemo("试玩");
    const written = writePrototype(repo, "proto-flow", demo);
    confirmDemoPrototype(repo, written.prototype_id, {
      demo_mode: "NATIVE_FLOW_CARD",
    });
    const denied = evaluateCanSign(repo, written.prototype_id);
    expect(denied.ok).toBe(false);

    confirmDemoPrototype(repo, written.prototype_id, {
      demo_mode: "NATIVE_FLOW_CARD",
      accept_degraded: true,
    });
    const ok = evaluateCanSign(repo, written.prototype_id);
    expect(ok.ok).toBe(true);

    expect(
      canSign({
        demo_mode: "INTERACTIVE_DEMO",
        confirmed: true,
      }).ok,
    ).toBe(true);
  });

  it("归档成功出现 records；缺 manifest 不得 DELIVERED", () => {
    const repo = tmp();
    const demo = buildMinimalPrototypeDemo("归档");
    const written = writePrototype(repo, "proto-arc", demo);
    confirmDemoPrototype(repo, written.prototype_id, {
      demo_mode: "INTERACTIVE_DEMO",
    });

    const archive = archiveContractRecords({
      repoRoot: repo,
      contract_id: "c12-contract",
      prototype_id: written.prototype_id,
      commit_sha: null,
    });
    expect(archive.ok).toBe(true);
    expect(
      fs.existsSync(
        path.join(repo, ".stagent", "records", "c12-contract", "audit-manifest.json"),
      ),
    ).toBe(true);
    expect(archive.copied).toContain("audit-manifest.json");

    expect(() =>
      assertRecordsReadyForDelivered(repo, "missing-contract"),
    ).toThrow(/E_RECORDS_ARCHIVE_REQUIRED|禁止标 DELIVERED/);
  });
});

describe("TASK-C.12e audit-manifest", () => {
  it("无 Git 仍可生成；含哈希与 contract_id；脱敏不含明文 token", () => {
    const repo = tmp();
    const manifest = writeAuditManifest(repo, {
      contract_id: "c12-contract",
      snapshot: {
        note: "secret token=sk-live-ABCDEFG0123456789",
        authorization: "Bearer super-secret-token-value",
      },
      events: [{ type: "TEST", token: "plain-token-should-redact" }],
      commit_sha: null,
      assertion_ids: ["550e8400-e29b-41d4-a716-446655440000"],
    });
    expect(manifest.git_required).toBe(false);
    expect(manifest.contract_id).toBe("c12-contract");
    expect(manifest.snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.events_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(auditManifestPath(repo, "c12-contract"))).toBe(true);

    const raw = fs.readFileSync(
      auditManifestPath(repo, "c12-contract"),
      "utf8",
    );
    expect(raw).not.toMatch(/sk-live-ABCDEFG0123456789/);
    expect(raw).not.toMatch(/super-secret-token-value/);
    expect(raw).not.toMatch(/plain-token-should-redact/);

    const loaded = readAuditManifest(repo, "c12-contract");
    expect(loaded?.contract_id).toBe("c12-contract");
  });
});

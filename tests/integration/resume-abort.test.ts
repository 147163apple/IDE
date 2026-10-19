import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/**
 * 临门一脚闭环：Resume 与 Abort 链路（此前 orchestrator.resume 无 HTTP 端点、
 * 中止/驳回完全无实现，见 docs/reports/stagent-task-flow-and-comparison.md）。
 */
describe("M8 / Resume 与 Abort 动作端点（Bearer 保护）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m8-actions-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3690,
      endPort: 3695,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  function makeContract(
    overrides: {
      executable?: string;
      args?: string[];
      timeoutSeconds?: number;
    } = {},
  ): SoftwareContract {
    const draft = createContractDraft({
      title: "resume-abort flow",
      description: "M8 action endpoints test",
      acceptanceCriteria: ["verify passes"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "verify",
          executable: overrides.executable ?? "node",
          args: overrides.args ?? ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: overrides.timeoutSeconds ?? 30,
        },
      ],
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
  }

  async function createAndApprove(contract: SoftwareContract): Promise<void> {
    const created = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract }),
    });
    expect(created.status).toBe(201);
    const approved = await fetch(
      `${base}/api/contracts/${contract.contract_id}/approve`,
      { method: "POST", headers: auth(), body: JSON.stringify({}) },
    );
    expect(approved.status).toBe(200);
  }

  /** 直接把合同落盘状态改写为 PENDING_RESUME（模拟熔断/崩溃自愈后的挂起态） */
  function suspendOnDisk(contractId: string): void {
    const file = path.join(repo, ".stagent", "contracts", `${contractId}.json`);
    const contract = JSON.parse(fs.readFileSync(file, "utf8")) as {
      lifecycle_state: string;
    };
    contract.lifecycle_state = "PENDING_RESUME";
    fs.writeFileSync(file, JSON.stringify(contract));
  }

  it("resume：PENDING_RESUME → EXECUTING；非挂起态恢复返回 409", async () => {
    const contract = makeContract();
    await createAndApprove(contract);
    suspendOnDisk(contract.contract_id);

    const resumed = await fetch(
      `${base}/api/contracts/${contract.contract_id}/resume`,
      { method: "POST", headers: auth() },
    );
    expect(resumed.status).toBe(200);
    const resumedBody = (await resumed.json()) as {
      contract: { lifecycle_state: string };
    };
    expect(resumedBody.contract.lifecycle_state).toBe("EXECUTING");

    // 已在 EXECUTING，再次恢复违反状态机 → 409（E_INVALID_STATE_TRANSITION）
    const again = await fetch(
      `${base}/api/contracts/${contract.contract_id}/resume`,
      { method: "POST", headers: auth() },
    );
    expect(again.status).toBe(409);
    const againBody = (await again.json()) as { code?: string };
    expect(againBody.code).toBe("E_INVALID_STATE_TRANSITION");
  });

  it("resume：Worktree 丢失时拒绝续跑（返回错误而非假恢复）", async () => {
    const contract = makeContract();
    await createAndApprove(contract);
    suspendOnDisk(contract.contract_id);
    fs.rmSync(
      path.join(repo, ".stagent", "worktrees", `task-${contract.contract_id}`),
      { recursive: true, force: true },
    );

    const res = await fetch(
      `${base}/api/contracts/${contract.contract_id}/resume`,
      { method: "POST", headers: auth() },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("worktree lost");
  });

  it("abort：待审批合同被驳回 → ABORTED + REJECTED + rejection_reason", async () => {
    const contract = makeContract();
    const created = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract }),
    });
    expect(created.status).toBe(201);

    const aborted = await fetch(
      `${base}/api/contracts/${contract.contract_id}/abort`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          reviewer: "reviewer-1",
          reason: "需求变更，驳回",
        }),
      },
    );
    expect(aborted.status).toBe(200);
    const body = (await aborted.json()) as {
      contract: {
        lifecycle_state: string;
        approval: { status: string; rejection_reason?: string };
      };
    };
    expect(body.contract.lifecycle_state).toBe("ABORTED");
    expect(body.contract.approval.status).toBe("REJECTED");
    expect(body.contract.approval.rejection_reason).toBe("需求变更，驳回");

    // 终态不可再次中止 → 409
    const twice = await fetch(
      `${base}/api/contracts/${contract.contract_id}/abort`,
      { method: "POST", headers: auth(), body: JSON.stringify({}) },
    );
    expect(twice.status).toBe(409);
  });

  it("abort：执行中任务被中止 → ABORTED（保留 APPROVED），Worktree 与任务分支被清理", async () => {
    const contract = makeContract();
    await createAndApprove(contract);

    const worktreePath = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    expect(fs.existsSync(worktreePath)).toBe(true);

    const aborted = await fetch(
      `${base}/api/contracts/${contract.contract_id}/abort`,
      { method: "POST", headers: auth(), body: JSON.stringify({}) },
    );
    expect(aborted.status).toBe(200);
    const body = (await aborted.json()) as {
      contract: {
        lifecycle_state: string;
        approval: { status: string; rejection_reason?: string };
      };
    };
    expect(body.contract.lifecycle_state).toBe("ABORTED");
    // 已批准任务中止后保留 APPROVED（§9.1.1 合法组合），驳回理由留痕
    expect(body.contract.approval.status).toBe("APPROVED");
    expect(body.contract.approval.rejection_reason).toContain("Aborted by");

    // 现场清理：Worktree 目录与 task/ 分支均不存在
    expect(fs.existsSync(worktreePath)).toBe(false);
    const branches = git(repo, ["branch", "--list", `task/*`]).trim();
    expect(branches).toBe("");

    // 中止后不可再执行验证 → 409
    const executed = await fetch(
      `${base}/api/contracts/${contract.contract_id}/execute`,
      { method: "POST", headers: auth() },
    );
    expect(executed.status).toBe(409);
  });

  it("abort：在途验证命令被 AbortSignal 整树强杀（exit 130），随后合同进入 ABORTED", async () => {
    // 长命令：先写就绪标记，再沉睡 30s。abort 到位时必须立即被杀而非等超时。
    const markerRel = path.join("src", "started.marker");
    const contract = makeContract({
      args: [
        "-e",
        `require("fs").writeFileSync(${JSON.stringify(markerRel)},"1");setTimeout(()=>{},30000)`,
      ],
      timeoutSeconds: 60,
    });
    await createAndApprove(contract);

    const worktreePath = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );

    // 异步发起验证（不等待），轮询标记文件确认子进程已真实启动
    const execPromise = fetch(
      `${base}/api/contracts/${contract.contract_id}/execute`,
      { method: "POST", headers: auth() },
    );
    const markerAbs = path.join(worktreePath, markerRel);
    const waitDeadline = Date.now() + 10_000;
    while (!fs.existsSync(markerAbs) && Date.now() < waitDeadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.existsSync(markerAbs)).toBe(true);

    const startedAt = Date.now();
    const aborted = await fetch(
      `${base}/api/contracts/${contract.contract_id}/abort`,
      { method: "POST", headers: auth(), body: JSON.stringify({}) },
    );
    expect(aborted.status).toBe(200);
    const abortBody = (await aborted.json()) as {
      contract: { lifecycle_state: string };
    };
    expect(abortBody.contract.lifecycle_state).toBe("ABORTED");
    // SIGTERM→3s 宽限→SIGKILL：整个 abort 必须远快于 30s 的沉睡命令
    expect(Date.now() - startedAt).toBeLessThan(15_000);

    const execRes = await execPromise;
    expect(execRes.status).toBe(200);
    const execBody = (await execRes.json()) as {
      evidence: {
        verdict: { status: string; can_merge: boolean };
        verification_results: Array<{ exit_code: number; passed: boolean }>;
      };
    };
    // 被中止的命令以 130 收尾，证据如实记录为 FAILED 且不可合并
    expect(execBody.evidence.verification_results[0]?.exit_code).toBe(130);
    expect(execBody.evidence.verdict.status).toBe("FAILED");
    expect(execBody.evidence.verdict.can_merge).toBe(false);

    expect(fs.existsSync(worktreePath)).toBe(false);
  }, 30_000);

  it("resume/abort 均要求鉴权", async () => {
    const contract = makeContract();
    const created = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract }),
    });
    expect(created.status).toBe(201);

    const resumeRes = await fetch(
      `${base}/api/contracts/${contract.contract_id}/resume`,
      { method: "POST" },
    );
    expect(resumeRes.status).toBe(401);
    const abortRes = await fetch(
      `${base}/api/contracts/${contract.contract_id}/abort`,
      { method: "POST" },
    );
    expect(abortRes.status).toBe(401);
  });
});

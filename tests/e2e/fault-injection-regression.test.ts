import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import path from "node:path";

import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { squashMerge } from "../../daemon/pipeline/merger";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import { AiWorker, WorkerScopeError } from "../../daemon/worker/ai-worker";
import { getWorktreePath } from "../../daemon/git/worktree-manager";
import {
  addProtectionEntry,
  decideApproval,
  guardAgentWrite,
  loadRoundState,
} from "../../daemon/protection/protection-list";
import {
  SUPERVISOR_PERMISSION_ERROR_CODE,
  SUPERVISOR_PRIVILEGED_ACTIONS,
  SupervisorPermissionDeniedError,
  createSupervisorControlPlane,
  type SupervisorViolationEvent,
} from "../../daemon/supervisor/permissions";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";
import {
  FAIL,
  PASS,
  TAMPERED_TEST,
  cmd,
  initRepo,
  pendingContract,
} from "../helpers/e2e-repo";

/**
 * TASK-E.1 / G-07：8 大故障分支回归（真实 Orchestrator + 状态机 + Git 临时仓库）。
 *
 * 与既有 `tests/e2e/*.spec.ts` 的差别：本套件不再是「快乐路径 + 单点熔断」，
 * 而是把 v1.3.3 §3.7 / G-07 点名的 8 类故障逐个跑成**完整闭环**——
 * 造现场 → 触发 → 断言拦截结论 → 断言「坏事确实没发生」（主分支零污染、
 * 零 Worktree 残留、证据不可复用），而不是只断言异常类型。
 *
 * 隔离约束（`daemon/git/test-isolation.ts` 守卫）：
 * 所有仓库一律 `fs.mkdtempSync(path.join(os.tmpdir(), ...))`，
 * 任何 `git config` / `git init` / `git worktree` 都不会触碰宿主仓库。
 *
 * 故障矩阵（与 `docs/` 报告中的覆盖矩阵一一对应）：
 *   ① 重试熔断          → PENDING_RESUME + BLOCKED/VERIFICATION_RETRY_LIMIT
 *   ② 测试篡改          → E_TEST_FILE_WRITE_BLOCKED / tests_modified=true
 *   ③ 外部篡改 STALE    → E_EVIDENCE_FINGERPRINT_MISMATCH → 落盘 STALE
 *   ④ 主树污染          → E_MAIN_TREE_DIRTY
 *   ⑤ 保护模式越权      → NEEDS_APPROVAL（零 Worktree）
 *   ⑥ Supervisor 越权   → E_UNAUTHORIZED_COMMAND + 审计留痕 + 零副作用
 *   ⑦ Worker 冒充通过   → 以真实退出码为准：FAILED + can_merge=false
 *   ⑧ 非受控 Agent 凭证 → Schema 不变式 + 宿主凭据不进入子进程
 */

let repo: string;

/** 把合同落盘，返回真实编排器（本套件一律用真编排器驱动，不走 HTTP 层） */
function seed(contract: SoftwareContract): ContractOrchestrator {
  new ContractStore(repo).save(contract);
  return new ContractOrchestrator({ repoRoot: repo });
}

function worktreeOf(contractId: string): string {
  return getWorktreePath(repo, contractId);
}

function evidencePathOf(contractId: string, evidenceId: string): string {
  return path.join(
    repo,
    ".stagent",
    "evidence",
    `${contractId}-${evidenceId}.json`,
  );
}

function readSilentRecords(): Array<Record<string, unknown>> {
  const file = path.join(repo, ".stagent", "silent-contracts.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  repo = initRepo();
});

afterEach(() => {
  safeRmSync(repo);
});

describe("E2E / G-07 故障注入回归（8 大分支）", () => {
  it("故障①｜验证连续失败触发重试熔断：PENDING_RESUME + BLOCKED，且不可合并", async () => {
    const contract = pendingContract({
      title: "重试熔断",
      writablePaths: ["src/**"],
      commands: [FAIL()],
      maxVerificationRetries: 1,
    });
    const orchestrator = seed(contract);

    // 准入正常（该合同不触碰保护清单）→ 真 Worktree 就位
    const admission = await orchestrator.admit(contract.contract_id);
    expect(admission.decision).toBe("AUTO_APPROVED");
    expect(admission.contract.lifecycle_state).toBe("EXECUTING");
    expect(fs.existsSync(worktreeOf(contract.contract_id))).toBe(true);

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("PENDING_RESUME");
    expect(outcome.evidence.verdict).toMatchObject({
      status: "BLOCKED",
      can_merge: false,
      reason_code: "VERIFICATION_RETRY_LIMIT",
    });
    // 熔断是「连续失败达上限」，因此失败次数必须已被记录，而不是空跑
    expect(outcome.evidence.verdict.verification_retry_count).toBe(1);
    expect(outcome.evidence.verification_results[0]!.passed).toBe(false);

    // 熔断态不可合并（状态门禁先于一切证据门禁）
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "e1",
      }),
    ).rejects.toMatchObject({ code: "E_NOT_AUDITED" });

    // 断点续跑：Worktree 健康 → 允许回到 EXECUTING，但计数不重置（再跑仍熔断）
    const resumed = await orchestrator.resume(contract.contract_id);
    expect(resumed.lifecycle_state).toBe("EXECUTING");
    const again = await orchestrator.execute(contract.contract_id);
    expect(again.contract.lifecycle_state).toBe("PENDING_RESUME");
    expect(again.evidence.verdict.reason_code).toBe("VERIFICATION_RETRY_LIMIT");

    // 收尾：中止清理现场，熔断不留 Worktree
    const aborted = await orchestrator.abort(contract.contract_id, {
      reviewer: "e1",
      reason: "E1 熔断收尾",
    });
    expect(aborted.lifecycle_state).toBe("ABORTED");
    expect(fs.existsSync(worktreeOf(contract.contract_id))).toBe(false);
    // 主分支零污染
    expect(git(repo, ["status", "--porcelain", "-uall"]).includes("src/")).toBe(
      false,
    );
  });

  it("故障②｜测试篡改：广义 glob 不构成测试授权，越权写入被硬拒；授权后必须留痕 tests_modified", async () => {
    // ---- ②-1 网关层硬拒：`**/*.ts` 覆盖得到 tests/，但不是「显式测试授权」----
    const broad = pendingContract({
      title: "测试篡改-广义glob",
      writablePaths: ["**/*.ts"],
    });
    const orchestrator = seed(broad);
    const broadAdmission = await orchestrator.admit(broad.contract_id);
    expect(broadAdmission.contract.lifecycle_state).toBe("EXECUTING");

    const broadGateway = new ScopedWorktreeGateway(
      worktreeOf(broad.contract_id),
      broadAdmission.contract,
      { costMonitor: new CostMonitor() },
    );
    const blocked = await broadGateway.callTool("stagent_write_file", {
      path: "tests/a.test.ts",
      content: TAMPERED_TEST,
    });
    expect(blocked.isError).toBe(true);
    expect(blocked.error?.code).toBe("E_TEST_FILE_WRITE_BLOCKED");
    // 原件一个字都没被改
    expect(
      fs.readFileSync(
        path.join(worktreeOf(broad.contract_id), "tests", "a.test.ts"),
        "utf8",
      ),
    ).toContain("expect(a).toBe(1)");

    // ---- ②-2 Worker 层整批拒绝：`src/**` 根本覆盖不到 tests/ ----
    const narrow = pendingContract({
      title: "测试篡改-Worker越界",
      writablePaths: ["src/**"],
    });
    const orchestrator2 = seed(narrow);
    const narrowAdmission = await orchestrator2.admit(narrow.contract_id);
    const narrowWorktree = worktreeOf(narrow.contract_id);
    const costMonitor = new CostMonitor();
    const narrowGateway = new ScopedWorktreeGateway(
      narrowWorktree,
      narrowAdmission.contract,
      { costMonitor },
    );
    const worker = new AiWorker({
      gateway: narrowGateway,
      costMonitor,
      modelClient: {
        generateChanges: async () => ({
          changes: [
            { path: "src/ok.ts", content: "export const ok = 1;\n" },
            { path: "tests/a.test.ts", content: TAMPERED_TEST },
          ],
          log: ["修改了测试断言，让它一定通过"],
          usage: { inputTokens: 10, outputTokens: 10 },
        }),
      },
    });
    await expect(worker.run()).rejects.toBeInstanceOf(WorkerScopeError);
    // 整批拒绝：合法的 src/ok.ts 也不得落盘（不留半成品）
    expect(fs.existsSync(path.join(narrowWorktree, "src", "ok.ts"))).toBe(
      false,
    );
    expect(
      fs.readFileSync(path.join(narrowWorktree, "tests", "a.test.ts"), "utf8"),
    ).toContain("expect(a).toBe(1)");

    // ---- ②-3 显式授权后允许写，但 Evidence 必须留痕 tests_modified ----
    const authorized = pendingContract({
      title: "测试篡改-显式授权",
      writablePaths: ["src/**", "tests/**"],
    });
    const orchestrator3 = seed(authorized);
    const authorizedAdmission = await orchestrator3.admit(
      authorized.contract_id,
    );
    const authorizedWorktree = worktreeOf(authorized.contract_id);
    const costMonitor3 = new CostMonitor();
    const gateway3 = new ScopedWorktreeGateway(
      authorizedWorktree,
      authorizedAdmission.contract,
      { costMonitor: costMonitor3 },
    );
    const worker3 = new AiWorker({
      gateway: gateway3,
      costMonitor: costMonitor3,
      modelClient: {
        generateChanges: async () => ({
          changes: [{ path: "tests/a.test.ts", content: TAMPERED_TEST }],
          log: ["调整了测试断言"],
          usage: { inputTokens: 10, outputTokens: 10 },
        }),
      },
    });
    const run = await worker3.run();
    expect(run.applied).toBe(true);

    const outcome = await orchestrator3.execute(authorized.contract_id);
    expect(outcome.evidence.verdict.status).toBe("PASSED");
    // 规范 §5.2：改了测试就必须在存证上留痕（can_merge 由退出码+范围派生，
    // 不因 tests_modified 变化；预警责任落在 4 字段 Trailer 上）
    expect(outcome.evidence.tests_modified).toBe(true);
    expect(outcome.evidence.verdict.can_merge).toBe(true);

    const merged = await squashMerge({
      repoRoot: repo,
      contractId: authorized.contract_id,
      evidence: outcome.evidence,
      reviewer: "e1",
    });
    expect(merged.nothingToMerge).toBe(false);
    expect(merged.commitMessage).toContain("Stagent-Tests-Modified: true");
  });

  it("故障③｜验证后外部篡改 Worktree：指纹不符先阻断，证据落盘 STALE 后二次合并被拒", async () => {
    const contract = pendingContract({
      title: "外部篡改",
      writablePaths: ["src/**"],
    });
    const orchestrator = seed(contract);
    const admission = await orchestrator.admit(contract.contract_id);
    const worktree = worktreeOf(contract.contract_id);
    // 合法改动（模拟 Worker 产出）
    fs.writeFileSync(
      path.join(worktree, "src", "b.ts"),
      "export const b = 2;\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.evidence.verdict).toMatchObject({
      status: "PASSED",
      can_merge: true,
    });
    const fingerprint = outcome.evidence.worktree_snapshot.snapshot_fingerprint;
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // 用户在验证通过后，用编辑器/脚本直接改了 Worktree（旁路写入）
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 999; // 未经验证的偷渡改动\n",
    );

    // 第一次核销：指纹不符 → 阻断，并顺手把磁盘证据标记 STALE
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "e1",
      }),
    ).rejects.toMatchObject({ code: "E_EVIDENCE_FINGERPRINT_MISMATCH" });

    const evidenceFile = evidencePathOf(
      contract.contract_id,
      outcome.evidence.evidence_id,
    );
    const staleSnapshot = JSON.parse(fs.readFileSync(evidenceFile, "utf8")) as {
      verdict: { status: string; can_merge: boolean; reason_code?: string };
      worktree_snapshot: { snapshot_fingerprint: string };
    };
    expect(staleSnapshot.verdict.status).toBe("STALE");
    expect(staleSnapshot.verdict.can_merge).toBe(false);
    expect(staleSnapshot.verdict.reason_code).toBe("EVIDENCE_STALE");
    // 指纹字段本身没被改写（改的是结论，不是历史事实）
    expect(staleSnapshot.worktree_snapshot.snapshot_fingerprint).toBe(
      fingerprint,
    );

    // 第二次核销：STALE 证据不可复用，被证据门禁直接拒绝
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "e1",
      }),
    ).rejects.toMatchObject({ code: "E_EVIDENCE_STALE" });

    // 主线零污染：没有任何 Stagent 审计提交
    expect(git(repo, ["log", "-1", "--format=%s"])).not.toContain("Stagent");
    expect(fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8")).toBe(
      "export const a = 1;\n",
    );
  });

  it("故障④｜主树污染：E_MAIN_TREE_DIRTY 阻断合并，清理后同一份证据放行", async () => {
    const contract = pendingContract({
      title: "主树污染",
      writablePaths: ["src/**"],
    });
    const orchestrator = seed(contract);
    await orchestrator.admit(contract.contract_id);
    fs.writeFileSync(
      path.join(worktreeOf(contract.contract_id), "src", "b.ts"),
      "export const b = 2;\n",
    );
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");

    // `.stagent/` 是 Daemon 自己的运行态目录：此时已落满合同/证据/Worktree，
    // 但它不进入 porcelain（仓库忽略规则挡掉），所以脏检查只盯业务代码
    expect(fs.existsSync(path.join(repo, ".stagent", "evidence"))).toBe(true);
    expect(git(repo, ["status", "--porcelain", "-uall"]).trim()).toBe("");

    // 用户在主树上留了未提交改动
    const dirtyFile = path.join(repo, "src", "dirty.ts");
    fs.writeFileSync(dirtyFile, "export const dirty = true;\n");
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "e1",
      }),
    ).rejects.toMatchObject({ code: "E_MAIN_TREE_DIRTY" });

    // 拦截必须发生在落盘之前：HEAD 未变、暂存区干净、脏文件原样还在
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(git(repo, ["status", "--porcelain", "-uall"])).toContain(
      "src/dirty.ts",
    );
    expect(git(repo, ["diff", "--cached", "--name-only"]).trim()).toBe("");

    // 用户清理主树 → 同一份证据可正常核销
    fs.rmSync(dirtyFile);
    const merged = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence: outcome.evidence,
      reviewer: "e1",
    });
    expect(merged.contract.lifecycle_state).toBe("MERGED");
    expect(merged.nothingToMerge).toBe(false);
    expect(merged.worktreeRemoved).toBe(true);
  });

  it("故障⑤｜保护模式越权：触碰锁定范围只登记一张卡，零 Worktree；拒绝后不再重复弹卡", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    const contract = pendingContract({
      title: "保护模式越权",
      writablePaths: ["src/auth/**"],
    });
    const orchestrator = seed(contract);

    const first = await orchestrator.admit(contract.contract_id);
    expect(first.decision).toBe("NEEDS_APPROVAL");
    expect(first.entryNames).toContain("登录");
    expect(first.protectedFiles.length).toBeGreaterThan(0);
    expect(first.cardId).toBeDefined();

    // 绝不自动开工：合同停在待审批，Worktree 不存在
    expect(orchestrator.getStore().get(contract.contract_id)).toMatchObject({
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    expect(fs.existsSync(worktreeOf(contract.contract_id))).toBe(false);
    // 本轮恰好一张白话卡（不是每碰一个文件弹一次）
    expect(loadRoundState(repo).pending).toHaveLength(1);
    // 静默合同备案里也必须是「等用户」而不是「已自动批准」
    expect(
      readSilentRecords().some(
        (r) =>
          r["kind"] === "contract_pending_user" &&
          r["contract_id"] === contract.contract_id,
      ),
    ).toBe(true);

    // 用户点「不同意」
    decideApproval(repo, first.cardId!, "deny");

    const second = await orchestrator.admit(contract.contract_id);
    expect(second.decision).toBe("NEEDS_APPROVAL");
    expect(second.reason).toContain("拒绝");
    // 拒绝后不重复弹卡，也不悄悄放行
    expect(loadRoundState(repo).pending).toHaveLength(0);
    expect(fs.existsSync(worktreeOf(contract.contract_id))).toBe(false);
    expect(orchestrator.getStore().get(contract.contract_id)).toMatchObject({
      lifecycle_state: "PENDING_APPROVAL",
    });

    // 与准入裁决同源的写闸门（网关每次逐文件写入都走它）同样拒绝落盘。
    // 注意粒度差异：本轮的授权/拒绝记录以**合同 scope 字符串**为键（此处是 `src/auth/**`），
    // 而闸门按**具体路径**精确匹配，所以这里会重新登记一张卡而不是命中「已拒绝」——
    // 结论仍是 Fail-Closed（allowed=false，一个字节都不写），代价只是多一次卡片交互。
    const gate = guardAgentWrite(repo, "src/auth/login.ts");
    expect(gate.allowed).toBe(false);
    expect(gate.cardId).toBeDefined();
  });

  it("故障⑥｜Supervisor 越权执行：4 类特权动作全部拒绝、审计留痕、合同与主树零副作用", async () => {
    const contract = pendingContract({
      title: "Supervisor 越权",
      writablePaths: ["src/**"],
    });
    const orchestrator = seed(contract);
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

    // Supervisor 只拿得到「只读视图」：真实控制面被 Proxy 包裹
    const controlPlane = {
      getContract: (id: string) => orchestrator.getStore().get(id),
      listContracts: () => orchestrator.getStore().list(),
      getEvidence: () => null,
      getSession: () => null,
      getStatus: () => "IDLE",
      approveContract: (id: string) => orchestrator.approve(id, "supervisor"),
      mergeContract: () => {
        throw new Error("mergeContract must never be reachable via supervisor");
      },
      setVerdict: () => {
        throw new Error("setVerdict must never be reachable via supervisor");
      },
      execCommand: () => {
        throw new Error("execCommand must never be reachable via supervisor");
      },
    };

    const events: SupervisorViolationEvent[] = [];
    const supervisor = createSupervisorControlPlane(controlPlane, {
      audit: (event) => events.push(event),
      contractId: contract.contract_id,
      sessionId: "sess-e1",
    });

    // 只读方法正常透传（Supervisor 需要看，但不需要动手）
    expect(supervisor.getContract(contract.contract_id)).toMatchObject({
      lifecycle_state: "PENDING_APPROVAL",
    });
    expect(supervisor.getStatus()).toBe("IDLE");
    expect(events).toHaveLength(0);

    // 4 类特权动作 100% 被拒
    type Caller = Record<string, (...args: unknown[]) => unknown>;
    const callable = supervisor as unknown as Caller;
    for (const action of SUPERVISOR_PRIVILEGED_ACTIONS) {
      // 每次只调用一次：一次越权 = 一条审计，不能因为断言写法翻倍
      let caught: unknown = null;
      try {
        callable[action]!(contract.contract_id);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SupervisorPermissionDeniedError);
      expect((caught as SupervisorPermissionDeniedError).code).toBe(
        SUPERVISOR_PERMISSION_ERROR_CODE,
      );
      expect((caught as SupervisorPermissionDeniedError).reason_code).toBe(
        "UNAUTHORIZED_COMMAND",
      );
    }

    // 即使调用方吞掉异常，越权尝试仍然留痕（先审计、后抛错）
    expect(events).toHaveLength(SUPERVISOR_PRIVILEGED_ACTIONS.length);
    expect(
      events.every(
        (e) =>
          e.type === "GATEWAY_VIOLATION" &&
          e.source === "supervisor" &&
          e.contract_id === contract.contract_id,
      ),
    ).toBe(true);

    // 写入尝试同样越权（只读视图不可被改写）
    expect(() => {
      (supervisor as unknown as { getStatus: () => string }).getStatus = () =>
        "HACKED";
    }).toThrow(SupervisorPermissionDeniedError);

    // 零副作用：合同没被批准、Worktree 没被创建、主树没被动过
    expect(orchestrator.getStore().get(contract.contract_id)).toMatchObject({
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    expect(fs.existsSync(worktreeOf(contract.contract_id))).toBe(false);
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(git(repo, ["status", "--porcelain", "-uall"])).not.toContain("src/");
  });

  it("故障⑦｜Worker 自称通过：判定只认真实退出码，Evidence=FAILED 且不可合并", async () => {
    const contract = pendingContract({
      title: "Worker 冒充通过",
      writablePaths: ["src/**"],
      commands: [FAIL()],
      // 不熔断（上限 3，只跑 1 次）→ 状态留在 EXECUTING，走 FAILED 而不是 PENDING_RESUME
      maxVerificationRetries: 3,
    });
    const orchestrator = seed(contract);
    const admission = await orchestrator.admit(contract.contract_id);
    const worktree = worktreeOf(contract.contract_id);

    const costMonitor = new CostMonitor();
    const gateway = new ScopedWorktreeGateway(worktree, admission.contract, {
      costMonitor,
    });
    const worker = new AiWorker({
      gateway,
      costMonitor,
      modelClient: {
        generateChanges: async () => ({
          changes: [{ path: "src/b.ts", content: "export const b = 2;\n" }],
          log: [
            "已实现需求",
            "本地测试全部通过 ✅",
            "结论：验证通过，可以直接合并",
          ],
          usage: { inputTokens: 10, outputTokens: 10 },
        }),
      },
    });
    const run = await worker.run();
    expect(run.applied).toBe(true);
    expect(run.log.join(" ")).toContain("全部通过");

    const outcome = await orchestrator.execute(contract.contract_id);

    // 语言层的「通过」不产生任何证据效力
    expect(outcome.evidence.verdict.status).toBe("FAILED");
    expect(outcome.evidence.verdict.can_merge).toBe(false);
    expect(outcome.evidence.verdict.reason_code).toBe("UNSAFE_EXECUTION");
    expect(outcome.evidence.verification_results[0]!.exit_code).toBe(1);
    expect(outcome.evidence.verification_results[0]!.passed).toBe(false);
    // Worker 的自述只活在日志里，不进入 verdict / summary
    expect(JSON.stringify(outcome.evidence.verdict)).not.toContain("通过");

    // 未审计 → 无法合并
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "e1",
      }),
    ).rejects.toMatchObject({ code: "E_NOT_AUDITED" });
    // 代码也确实没进主分支
    expect(fs.existsSync(path.join(repo, "src", "b.ts"))).toBe(false);
  });

  it("故障⑧｜非受控 Agent：Schema 不变式阻断执行态，且宿主凭据不进入验证子进程", async () => {
    // ---- ⑧-1 Schema 不变式：UNCONTROLLED_EXTERNAL 不得进入执行状态 ----
    const draft = createContractDraft({
      title: "非受控 Agent",
      description: "control_mode 不变式",
      acceptanceCriteria: ["x"],
      writablePaths: ["src/**"],
      commands: [PASS()],
    });
    const uncontrolledSpec = {
      ...draft.worker_spec,
      control_mode: "UNCONTROLLED_EXTERNAL" as const,
    };

    expect(() =>
      softwareContractSchema.parse({
        ...draft,
        worker_spec: uncontrolledSpec,
        lifecycle_state: "EXECUTING",
        approval: {
          status: "APPROVED",
          approved_by: "e1",
          approved_at: new Date().toISOString(),
        },
      }),
    ).toThrow(/UNCONTROLLED_EXTERNAL/);

    // DRAFT 允许存在（Schema 只禁执行态），但一旦尝试落盘成执行态就被拒
    const draftOnly = softwareContractSchema.parse({
      ...draft,
      worker_spec: uncontrolledSpec,
    });
    expect(draftOnly.lifecycle_state).toBe("DRAFT");
    expect(() =>
      new ContractStore(repo).save({
        ...draft,
        worker_spec: uncontrolledSpec,
        lifecycle_state: "PREPARING",
        approval: {
          status: "APPROVED",
          approved_by: "e1",
          approved_at: new Date().toISOString(),
        },
      }),
    ).toThrow(/UNCONTROLLED_EXTERNAL/);

    // ---- ⑧-2 凭证隔离：宿主 token 不得进入验证命令的子进程 ----
    process.env["OPENAI_API_KEY"] = "sk-e1-must-not-leak";
    process.env["STAGENT_E1_PROBE"] = "e1-probe-value";
    try {
      const contract = pendingContract({
        title: "凭证隔离",
        writablePaths: ["src/**"],
        // 只要子进程能看到任一宿主变量，退出码就是 1
        commands: [
          cmd(
            "verify",
            "const leaked = Boolean(process.env.OPENAI_API_KEY || process.env.STAGENT_E1_PROBE);" +
              "process.exit(leaked ? 1 : 0)",
          ),
        ],
      });
      const orchestrator = seed(contract);
      await orchestrator.admit(contract.contract_id);
      const outcome = await orchestrator.execute(contract.contract_id);

      // PASSED 即证明两个宿主变量都没进子进程（白名单 + 凭据硬拒绝）
      expect(outcome.evidence.verdict.status).toBe("PASSED");
      expect(outcome.evidence.verification_results[0]!.exit_code).toBe(0);
      expect(outcome.evidence.verdict.can_merge).toBe(true);
    } finally {
      delete process.env["OPENAI_API_KEY"];
      delete process.env["STAGENT_E1_PROBE"];
    }
  });
});

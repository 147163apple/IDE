import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import path from "node:path";

import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { squashMerge } from "../../daemon/pipeline/merger";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import { AiWorker } from "../../daemon/worker/ai-worker";
import { getWorktreePath } from "../../daemon/git/worktree-manager";
import {
  addProtectionEntry,
  decideApproval,
  loadRoundState,
  protectionMode,
} from "../../daemon/protection/protection-list";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import { git } from "../helpers/git";
import {
  PASS,
  TAMPERED_TEST,
  initRepo,
  pendingContract,
} from "../helpers/e2e-repo";

/**
 * TASK-E.1：双 Agent 协同 + Vibe / Protected 双模式全链路（真实编排器驱动）。
 *
 * 两条链路分别对应 v1.3.3 的两种用户体感：
 *
 * - **Vibe（自由模式）**：仓库没有锁定任何东西 → 零弹窗、零审批，改动自动落到
 *   任务分支（自动检查点），用户不满意就一键撤销，主分支全程不动；
 * - **Protected（保护模式）**：合同范围与保护清单有交集 → 至多一张白话卡、
 *   至多两次交互（弹卡 + 点击），同意后自动批准；核销时走 Gate 0~4 与
 *   4 字段 Git Trailer；与用户改动冲突时永远以用户版本为准（User-First Discard）。
 *
 * 全过程使用真实 `ContractOrchestrator` / `ContractStore` / `squashMerge` /
 * 真实 Git 临时仓库（`os.tmpdir()`，符合 test-isolation 守卫），不使用任何 mock。
 */

let repo: string;

function seed(contract: SoftwareContract): ContractOrchestrator {
  new ContractStore(repo).save(contract);
  return new ContractOrchestrator({ repoRoot: repo });
}

function worktreeOf(contractId: string): string {
  return getWorktreePath(repo, contractId);
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

/** 用真实网关 + 假模型客户端驱动一次 Worker 写入（网关/预算/范围校验都是真的） */
async function runWorkerOnce(
  contract: SoftwareContract,
  worktree: string,
  changes: Array<{ path: string; content: string }>,
  log: string[] = ["已完成改动"],
): Promise<void> {
  const costMonitor = new CostMonitor();
  const gateway = new ScopedWorktreeGateway(worktree, contract, {
    costMonitor,
  });
  const worker = new AiWorker({
    gateway,
    costMonitor,
    modelClient: {
      generateChanges: async () => ({
        changes,
        log,
        usage: { inputTokens: 12, outputTokens: 8 },
      }),
    },
  });
  const result = await worker.run();
  expect(result.applied).toBe(true);
}

beforeEach(() => {
  repo = initRepo();
});

afterEach(() => {
  safeRmSync(repo);
});

describe("E2E / Vibe 自由模式全链路（零弹窗 + 自动检查点 + 一键撤销）", () => {
  it("① 仓库无锁定 → admit 自动批准：零卡片、零审批，静默备案留痕且幂等", async () => {
    expect(protectionMode(repo)).toBe("VIBE");

    const contract = pendingContract({
      title: "Vibe 自动准入",
      writablePaths: ["src/**"],
    });
    const orchestrator = seed(contract);
    const admission = await orchestrator.admit(contract.contract_id);

    // 零弹窗零审批：合同直接进 EXECUTING，批准人是系统而不是人
    expect(admission.decision).toBe("AUTO_APPROVED");
    expect(admission.contract.lifecycle_state).toBe("EXECUTING");
    expect(admission.contract.approval.approved_by).toBe("stagent-auto");
    expect(admission.contract.approval.status).toBe("APPROVED");
    // 全程没有产生任何待审批卡
    expect(loadRoundState(repo).pending).toHaveLength(0);
    expect(fs.existsSync(worktreeOf(contract.contract_id))).toBe(true);

    // 后台静默备案（用户不感知，但事后可追溯）
    const record = readSilentRecords().find(
      (r) =>
        r["kind"] === "contract_auto_approved" &&
        r["contract_id"] === contract.contract_id,
    );
    expect(record).toBeDefined();
    expect(record!["mode"]).toBe("VIBE");
    expect(record!["protected_files"]).toEqual([]);

    // 幂等：重复准入返回 SKIPPED，不重建 Worktree、不重复批准
    const again = await orchestrator.admit(contract.contract_id);
    expect(again.decision).toBe("SKIPPED");
    expect(again.contract.lifecycle_state).toBe("EXECUTING");
    expect(
      readSilentRecords().filter(
        (r) => r["kind"] === "contract_preparing_failed",
      ),
    ).toHaveLength(0);
  });

  it("② 自动检查点：execute 把 Worktree 改动固化为任务分支提交，主分支原地不动", async () => {
    const contract = pendingContract({
      title: "Vibe 自动检查点",
      writablePaths: ["src/**"],
    });
    const orchestrator = seed(contract);
    const admission = await orchestrator.admit(contract.contract_id);
    const worktree = worktreeOf(contract.contract_id);

    await runWorkerOnce(admission.contract, worktree, [
      { path: "src/b.ts", content: "export const b = 2;\n" },
    ]);

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.evidence.verdict).toMatchObject({
      status: "PASSED",
      can_merge: true,
    });

    // v0.1 的「自动检查点」就是任务分支上的自动提交：不需要用户先 commit
    expect(git(worktree, ["log", "-1", "--format=%s"]).trim()).toBe(
      `chore(stagent): contract ${contract.contract_id} changes`,
    );
    expect(git(worktree, ["status", "--porcelain"]).trim()).toBe("");
    // 检查点落在任务分支，主分支仍是 init
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("init");
    expect(
      git(repo, [
        "rev-list",
        "--count",
        `main..task/${contract.contract_id}`,
      ]).trim(),
    ).toBe("1");
    // 证据锁定的提交 SHA 与检查点完全一致（可追溯、可回滚）
    expect(outcome.evidence.git_info.task_commit_sha).toBe(
      git(worktree, ["rev-parse", "HEAD"]).trim(),
    );
    expect(outcome.evidence.git_info.base_commit_sha).toBe(
      git(repo, ["rev-parse", "main"]).trim(),
    );
  });

  it("③ 一键撤销：abort 清 Worktree 与任务分支，主分支与工作树零残留", async () => {
    const contract = pendingContract({
      title: "Vibe 一键撤销",
      writablePaths: ["src/**"],
    });
    const orchestrator = seed(contract);
    const admission = await orchestrator.admit(contract.contract_id);
    const worktree = worktreeOf(contract.contract_id);

    await runWorkerOnce(admission.contract, worktree, [
      { path: "src/b.ts", content: "export const b = 2;\n" },
    ]);
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");

    const mainHeadBefore = git(repo, ["rev-parse", "HEAD"]).trim();
    // 用户看完结果点「撤销」：不需要理解 Git，也不需要在主树里手动 checkout
    const aborted = await orchestrator.abort(contract.contract_id, {
      reviewer: "local-user",
      reason: "E1 Vibe 一键撤销",
    });

    expect(aborted.lifecycle_state).toBe("ABORTED");
    // 已批准任务撤销后保留 APPROVED 事实，但终态是 ABORTED（§9.1.1 允许组合）
    expect(aborted.approval.status).toBe("APPROVED");
    // 现场彻底清空：Worktree 目录、任务分支、主分支指针
    expect(fs.existsSync(worktree)).toBe(false);
    expect(
      git(repo, ["branch", "--list", `task/${contract.contract_id}`]).trim(),
    ).toBe("");
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(mainHeadBefore);
    expect(fs.existsSync(path.join(repo, "src", "b.ts"))).toBe(false);
    expect(git(repo, ["status", "--porcelain", "-uall"]).trim()).toBe("");
  });
});

describe("E2E / Protected 保护模式全链路（1 张卡 + Gate 0~4 + Trailer + User-First）", () => {
  it("④ 触碰锁定范围 → 恰好 1 张白话卡；同意后第 2 次交互即自动批准（≤2 次不变式）", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    expect(protectionMode(repo)).toBe("PROTECTED");

    const contract = pendingContract({
      title: "Protected 准入",
      writablePaths: ["src/auth/login.ts"],
    });
    const orchestrator = seed(contract);

    // 第 1 次交互：一张白话卡，列出「登录」
    const first = await orchestrator.admit(contract.contract_id);
    expect(first.decision).toBe("NEEDS_APPROVAL");
    expect(first.entryNames).toEqual(["登录"]);
    expect(first.cardId).toBeDefined();
    expect(first.reason).toContain("确认");
    const round = loadRoundState(repo);
    expect(round.pending).toHaveLength(1);
    expect(round.approvedFiles).toHaveLength(0);
    // 尚未开工
    expect(fs.existsSync(worktreeOf(contract.contract_id))).toBe(false);
    expect(orchestrator.getStore().get(contract.contract_id)).toMatchObject({
      lifecycle_state: "PENDING_APPROVAL",
    });

    // 用户点「同意」
    decideApproval(repo, first.cardId!, "approve");

    // 第 2 次交互：不再弹卡，直接自动批准开工
    const second = await orchestrator.admit(contract.contract_id);
    expect(second.decision).toBe("AUTO_APPROVED");
    expect(second.contract.lifecycle_state).toBe("EXECUTING");
    expect(loadRoundState(repo).pending).toHaveLength(0);

    // 「至多 2 次交互」可被审计验证：本轮只有 1 次用户裁决记录
    expect(
      readSilentRecords().filter((r) => r["kind"] === "approval_decision"),
    ).toHaveLength(1);
    // 授权严格限定在卡上清单，不多给一分
    const approved = loadRoundState(repo).approvedFiles;
    expect(approved.sort()).toEqual([...first.protectedFiles].sort());
    // 静默备案标注为「本轮已授权」，与纯 Vibe 区分
    const authorized = readSilentRecords().find(
      (r) =>
        r["kind"] === "contract_auto_approved" &&
        r["contract_id"] === contract.contract_id,
    );
    expect(authorized!["mode"]).toBe("PROTECTED_AUTHORIZED");
  });

  it("⑤ 用户点「不同意」→ 合同 ABORTED 终态，零 Worktree，主分支零改动", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    const contract = pendingContract({
      title: "Protected 拒绝",
      writablePaths: ["src/auth/login.ts"],
    });
    const orchestrator = seed(contract);
    const mainHeadBefore = git(repo, ["rev-parse", "HEAD"]).trim();

    const admission = await orchestrator.admit(contract.contract_id);
    expect(admission.decision).toBe("NEEDS_APPROVAL");

    decideApproval(repo, admission.cardId!, "deny");
    const aborted = await orchestrator.abort(contract.contract_id, {
      reviewer: "local-user",
      reason: "用户在保护确认卡上选择「不同意」",
    });

    expect(aborted.lifecycle_state).toBe("ABORTED");
    // 待审批态中止 = 驳回语义（ABORTED × REJECTED 是 §9.1.1 合法组合）
    expect(aborted.approval.status).toBe("REJECTED");
    expect(JSON.stringify(aborted.approval)).toContain("不同意");
    // 什么都没发生：零 Worktree、零任务分支、主分支指针未变
    expect(fs.existsSync(worktreeOf(contract.contract_id))).toBe(false);
    expect(
      git(repo, ["branch", "--list", `task/${contract.contract_id}`]).trim(),
    ).toBe("");
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(mainHeadBefore);
    // 业务代码零改动（`.stagent/` 是 Daemon 运行态，不在业务审计范围内）
    expect(git(repo, ["status", "--porcelain", "-uall"])).not.toContain("src/");
  });

  it("⑥ 合并门禁 Gate 0→4 逐级拦截（缺合同/未审计/证据缺失/证据错配/不可合并），修复后一键合并带 4 字段 Trailer", async () => {
    const contract = pendingContract({
      title: "Protected 合并门禁",
      writablePaths: ["src/**"],
    });
    const orchestrator = seed(contract);
    const admission = await orchestrator.admit(contract.contract_id);
    const worktree = worktreeOf(contract.contract_id);
    await runWorkerOnce(admission.contract, worktree, [
      { path: "src/b.ts", content: "export const b = 2;\n" },
    ]);
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");

    const evidenceFile = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
    );
    const originalEvidence = fs.readFileSync(evidenceFile, "utf8");
    const mergeArgs = {
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence: outcome.evidence,
      reviewer: "local-user",
    };

    // Gate 0：合同不存在
    await expect(
      squashMerge({ ...mergeArgs, contractId: "contract_not_exists" }),
    ).rejects.toMatchObject({ code: "E_CONTRACT_NOT_FOUND" });

    // Gate 1：未审计（另建一张还停在待审批的合同）
    const pending = pendingContract({
      title: "Gate1 未审计",
      writablePaths: ["src/**"],
    });
    new ContractStore(repo).save(pending);
    await expect(
      squashMerge({ ...mergeArgs, contractId: pending.contract_id }),
    ).rejects.toMatchObject({ code: "E_NOT_AUDITED" });

    // Gate 2a：证据快照缺失（以磁盘为准，不信内存）
    fs.rmSync(evidenceFile);
    await expect(squashMerge(mergeArgs)).rejects.toMatchObject({
      code: "E_EVIDENCE_MISSING",
    });
    fs.writeFileSync(evidenceFile, originalEvidence, "utf8");

    // Gate 2b：证据不属于本合同
    fs.writeFileSync(
      evidenceFile,
      JSON.stringify({
        ...(JSON.parse(originalEvidence) as Record<string, unknown>),
        contract_id: "contract_other",
      }),
      "utf8",
    );
    await expect(squashMerge(mergeArgs)).rejects.toMatchObject({
      code: "E_EVIDENCE_MISMATCH",
    });
    fs.writeFileSync(evidenceFile, originalEvidence, "utf8");

    // Gate 2c：结论不可合并
    const blocked = JSON.parse(originalEvidence) as {
      verdict: Record<string, unknown>;
    };
    fs.writeFileSync(
      evidenceFile,
      JSON.stringify({
        ...blocked,
        verdict: {
          ...blocked.verdict,
          status: "BLOCKED",
          can_merge: false,
          reason_code: "UNSAFE_EXECUTION",
        },
      }),
      "utf8",
    );
    await expect(squashMerge(mergeArgs)).rejects.toMatchObject({
      code: "E_CANNOT_MERGE",
    });
    fs.writeFileSync(evidenceFile, originalEvidence, "utf8");

    // 五道门禁全部放行后：一键合并成功
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();
    const merged = await squashMerge(mergeArgs);
    expect(merged.contract.lifecycle_state).toBe("MERGED");
    expect(merged.nothingToMerge).toBe(false);
    expect(merged.conflictResolution).toBeNull();
    expect(merged.worktreeRemoved).toBe(true);

    // 4 字段 Git Trailer 逐项落地
    const message = merged.commitMessage;
    expect(message).toContain(`Stagent-Contract-ID: ${contract.contract_id}`);
    expect(message).toContain(
      `Stagent-Evidence-ID: ${outcome.evidence.evidence_id}`,
    );
    expect(message).toContain("Stagent-Verdict: PASSED");
    expect(message).toContain("Reviewed-By: local-user");
    // 本任务没改测试 → 条件 Trailer 必须缺席（不能恒真）
    expect(outcome.evidence.tests_modified).toBe(false);
    expect(message).not.toContain("Stagent-Tests-Modified");

    // 提交真的进了主分支，且 HEAD 前进了一格
    const realMessage = git(repo, ["log", "-1", "--format=%B"]);
    expect(realMessage).toContain("Reviewed-By: local-user");
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).not.toBe(headBefore);
    expect(fs.readFileSync(path.join(repo, "src", "b.ts"), "utf8")).toContain(
      "export const b = 2",
    );
    // 现场清理 + 存证留存
    expect(fs.existsSync(worktree)).toBe(false);
    expect(fs.existsSync(evidenceFile)).toBe(true);
  });

  it("⑦ User-First Discard：冲突处永远以用户版本为准，AI 冲突改动丢弃且不抛 Git 冲突界面", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    const contract = pendingContract({
      title: "Protected 冲突仲裁",
      writablePaths: ["src/auth/login.ts", "src/auth/session.ts"],
    });
    const orchestrator = seed(contract);

    const admission = await orchestrator.admit(contract.contract_id);
    expect(admission.decision).toBe("NEEDS_APPROVAL");
    decideApproval(repo, admission.cardId!, "approve");
    const approved = await orchestrator.admit(contract.contract_id);
    expect(approved.decision).toBe("AUTO_APPROVED");
    expect(approved.contract.lifecycle_state).toBe("EXECUTING");

    const worktree = worktreeOf(contract.contract_id);
    // AI 改了登录文件（与用户即将改的同一文件冲突），并新增一个不冲突文件
    await runWorkerOnce(approved.contract, worktree, [
      {
        path: "src/auth/login.ts",
        content: "export const login = () => 'AI';\n",
      },
      {
        path: "src/auth/session.ts",
        content: "export const session = 'AI';\n",
      },
    ]);

    // 用户在验证前自己改了同一个文件并提交——用户永远是对的。
    //
    // 顺序说明（TASK-D.3 / D-4）：主干一旦在**证据落盘之后**前进，合并会被
    // `E_TARGET_BRANCH_ADVANCED` 拦下并要求用户二选一（重演 / 放弃），
    // 这是刻意为之的防死锁语义。本用例验证的是 P.1 冲突仲裁本身，
    // 因此把用户改动放在验证之前：证据基线与主干一致，冲突交由 P.1 裁决。
    fs.writeFileSync(
      path.join(repo, "src", "auth", "login.ts"),
      "export const login = () => 'USER';\n",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "user: 我自己改了登录"]);

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.evidence.verdict.status).toBe("PASSED");

    // 核销：不向用户抛 Git 冲突界面，直接按「用户优先」仲裁
    const merged = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence: outcome.evidence,
      reviewer: "local-user",
    });
    expect(merged.conflictResolution).toBe("USER_FIRST_DISCARD");
    expect(merged.nothingToMerge).toBe(false);
    expect(merged.commitMessage).toContain("冲突处理：以用户主分支版本为准");
    expect(merged.commitMessage).toContain("Stagent-Verdict: PASSED");

    // 冲突处是用户版本，非冲突的 AI 改动正常进入主干
    expect(
      fs.readFileSync(path.join(repo, "src", "auth", "login.ts"), "utf8"),
    ).toContain("USER");
    expect(
      fs.readFileSync(path.join(repo, "src", "auth", "session.ts"), "utf8"),
    ).toContain("AI");
    // 冲突标记没有泄漏到用户代码里
    expect(
      fs.readFileSync(path.join(repo, "src", "auth", "login.ts"), "utf8"),
    ).not.toContain("<<<<<<<");
  });
});

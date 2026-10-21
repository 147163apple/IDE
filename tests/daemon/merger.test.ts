import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  MergeGateError,
  buildMergeCommitMessage,
  squashMerge,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

describe("M8 / TASK-D.2 Squash-Merge 与 Git Trailer", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  const makeContract = (title: string) => {
    const draft = createContractDraft({
      title,
      description: "merge flow",
      acceptanceCriteria: ["pass"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
  };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-merge-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("AUDITED + PASSED 时执行 squash merge，写入四字段 Trailer 并清理 Worktree", async () => {
    const contract = makeContract("merge happy");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    // 在 Worktree 内产生真实改动（由 execute 提交到任务分支）
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "b.ts"),
      "export const b = 2;\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");

    const result = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence: outcome.evidence,
      reviewer: "tina",
    });

    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(result.contract.lifecycle_state).toBe("MERGED");
    expect(result.worktreeRemoved).toBe(true);
    expect(fs.existsSync(path.join(repo, "src", "b.ts"))).toBe(true);
    expect(fs.existsSync(worktree)).toBe(false);

    const log = git(repo, ["log", "-1", "--format=%B"]);
    expect(log).toContain(`Stagent-Contract-ID: ${contract.contract_id}`);
    expect(log).toContain(
      `Stagent-Evidence-ID: ${outcome.evidence.evidence_id}`,
    );
    expect(log).toContain("Stagent-Verdict: PASSED");
    expect(log).toContain("Reviewed-By: tina");

    // TASK-E.2：合并时的审批事实与证据文件哈希必须进提交，且哈希可被独立复算
    expect(log).toContain("Stagent-Approval-Status: APPROVED");
    const evidenceFile = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
    );
    const expectedHash = createHash("sha256")
      .update(fs.readFileSync(evidenceFile))
      .digest("hex");
    expect(log).toContain(`Stagent-Evidence-Hash: ${expectedHash}`);

    // 存证归档仍在
    expect(
      fs.existsSync(
        path.join(
          repo,
          ".stagent",
          "evidence",
          `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
        ),
      ),
    ).toBe(true);
  });

  it("未审计合同拒绝合并", async () => {
    const contract = makeContract("not audited");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: {
          evidence_id: "evi_x",
          contract_id: contract.contract_id,
          generated_at: new Date().toISOString(),
          usage: {
            currency: "CNY",
            pricing_version: "v1",
            accounting_mode: "UNAVAILABLE",
            limit_reached: false,
          },
          worktree_snapshot: {
            head_sha: "a",
            snapshot_fingerprint: "b",
            captured_at: "",
          },
          verdict: { status: "PASSED", can_merge: true, summary: "" },
          scope_audit: {
            passed: true,
            files_changed: [],
            forbidden_violations: [],
            budget_exhausted: false,
          },
          verification_results: [],
          git_info: {
            base_commit_sha: "a",
            task_commit_sha: "b",
            diff_stat: "",
            patch_fingerprint: "c",
          },
        },
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_NOT_AUDITED" });
  });

  it("STALE 证据拒绝合并", async () => {
    const contract = makeContract("stale");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);

    const evidencePath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
    );
    const raw = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as {
      verdict: Record<string, unknown>;
    };
    raw.verdict["status"] = "STALE";
    raw.verdict["can_merge"] = false;
    raw.verdict["reason_code"] = "EVIDENCE_STALE";
    fs.writeFileSync(evidencePath, JSON.stringify(raw, null, 2));

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_EVIDENCE_STALE" });
  });

  it("主工作区存在未跟踪文件时阻断合并（E_MAIN_TREE_DIRTY），清理后可正常合并", async () => {
    const contract = makeContract("dirty untracked");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    // Worktree 内产生真实改动，确保任务分支领先 base
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "c.ts"),
      "export const c = 3;\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");

    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

    // 用户在主树留下未跟踪文件（不属于任何任务）
    fs.writeFileSync(path.join(repo, "local-notes.txt"), "wip\n");

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_MAIN_TREE_DIRTY" });

    // 主分支未被污染：HEAD 不变，用户文件原样保留，Worktree 未销毁
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(fs.readFileSync(path.join(repo, "local-notes.txt"), "utf8")).toBe(
      "wip\n",
    );
    expect(fs.existsSync(worktree)).toBe(true);

    // 用户清理主树后，合并可正常完成
    fs.rmSync(path.join(repo, "local-notes.txt"));
    const result = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence: outcome.evidence,
      reviewer: "tina",
    });
    expect(result.contract.lifecycle_state).toBe("MERGED");
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).not.toBe(headBefore);
  });

  it("主工作区存在未暂存修改时阻断合并（E_MAIN_TREE_DIRTY）", async () => {
    const contract = makeContract("dirty unstaged");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);

    // 已跟踪文件被就地修改但未 commit
    fs.appendFileSync(
      path.join(repo, "src", "a.ts"),
      "export const dirty = 1;\n",
    );

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_MAIN_TREE_DIRTY" });

    // 阻断后用户改动完好无损
    expect(fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8")).toContain(
      "dirty",
    );
  });

  it(".stagent/ 运行态目录不计入主树脏检查", async () => {
    // happy path 本身已隐含验证（合同/证据/Worktree 均位于 .stagent/ 下且未提交）；
    // 此处显式断言：仅 .stagent/ 存在未跟踪内容时不抛 E_MAIN_TREE_DIRTY
    const { assertMainTreeClean } =
      await import("../../daemon/pipeline/merger");
    await expect(assertMainTreeClean(repo)).resolves.toBeUndefined();
  });

  it("提交信息模板包含固定顺序的四个 Trailer", () => {
    const contract = makeContract("trailer");
    const message = buildMergeCommitMessage(
      contract,
      {
        evidence_id: "evi_1",
        contract_id: contract.contract_id,
        generated_at: "",
        usage: {
          currency: "CNY",
          pricing_version: "v1",
          accounting_mode: "UNAVAILABLE",
          limit_reached: false,
        },
        worktree_snapshot: {
          head_sha: "a",
          snapshot_fingerprint: "b",
          captured_at: "",
        },
        verdict: { status: "PASSED", can_merge: true, summary: "" },
        scope_audit: {
          passed: true,
          files_changed: [],
          forbidden_violations: [],
          budget_exhausted: false,
        },
        verification_results: [],
        git_info: {
          base_commit_sha: "a",
          task_commit_sha: "b",
          diff_stat: "",
          patch_fingerprint: "c",
        },
      },
      "reviewer-1",
    );
    const lines = message.split("\n");
    expect(lines).toContain(`Stagent-Contract-ID: ${contract.contract_id}`);
    expect(lines).toContain("Stagent-Evidence-ID: evi_1");
    expect(lines).toContain("Stagent-Verdict: PASSED");
    expect(lines).toContain("Reviewed-By: reviewer-1");
    expect(message).toContain("由 Stagent 受限执行并通过全部门禁验证。");
  });

  it("tests_modified=true 的证据在合并提交中追加 Stagent-Tests-Modified Trailer", () => {
    const contract = makeContract("trailer tests_modified");
    const baseEvidence = {
      evidence_id: "evi_2",
      contract_id: contract.contract_id,
      generated_at: "",
      usage: {
        currency: "CNY",
        pricing_version: "v1",
        accounting_mode: "UNAVAILABLE" as const,
        limit_reached: false,
      },
      worktree_snapshot: {
        head_sha: "a",
        snapshot_fingerprint: "b",
        captured_at: "",
      },
      verdict: { status: "PASSED" as const, can_merge: true, summary: "" },
      scope_audit: {
        passed: true,
        files_changed: [],
        forbidden_violations: [],
        budget_exhausted: false,
      },
      verification_results: [],
      git_info: {
        base_commit_sha: "a",
        task_commit_sha: "b",
        diff_stat: "",
        patch_fingerprint: "c",
      },
    };

    const cleanMessage = buildMergeCommitMessage(contract, baseEvidence, "r");
    expect(cleanMessage).not.toContain("Stagent-Tests-Modified");

    const tamperedMessage = buildMergeCommitMessage(
      contract,
      { ...baseEvidence, tests_modified: true },
      "r",
    );
    expect(tamperedMessage).toContain("Stagent-Tests-Modified: true");
  });

  it("审批状态恒写入；证据哈希仅在提供时写入（纯函数不伪造哈希）", () => {
    const contract = makeContract("trailer approval/hash");
    const evidence = {
      evidence_id: "evi_3",
      contract_id: contract.contract_id,
      generated_at: "",
      usage: {
        currency: "CNY",
        pricing_version: "v1",
        accounting_mode: "UNAVAILABLE" as const,
        limit_reached: false,
      },
      worktree_snapshot: {
        head_sha: "a",
        snapshot_fingerprint: "b",
        captured_at: "",
      },
      verdict: { status: "PASSED" as const, can_merge: true, summary: "" },
      scope_audit: {
        passed: true,
        files_changed: [],
        forbidden_violations: [],
        budget_exhausted: false,
      },
      verification_results: [],
      git_info: {
        base_commit_sha: "a",
        task_commit_sha: "b",
        diff_stat: "",
        patch_fingerprint: "c",
      },
    };

    // 未提供哈希：不能凭空造一个「看起来像哈希」的值
    const noHash = buildMergeCommitMessage(contract, evidence, "r");
    expect(noHash).toContain(
      `Stagent-Approval-Status: ${contract.approval.status}`,
    );
    expect(noHash).not.toContain("Stagent-Evidence-Hash");

    // 提供哈希：原样写入，且 Trailer 顺序稳定（Contract → Evidence → Hash → Verdict → Approval → Reviewer）
    const withHash = buildMergeCommitMessage(contract, evidence, "r", null, {
      evidenceHash: "f".repeat(64),
    });
    const trailerLines = withHash
      .split("\n")
      .filter((line) => /^(Stagent-|Reviewed-By)/.test(line));
    expect(trailerLines).toEqual([
      `Stagent-Contract-ID: ${contract.contract_id}`,
      "Stagent-Evidence-ID: evi_3",
      `Stagent-Evidence-Hash: ${"f".repeat(64)}`,
      "Stagent-Verdict: PASSED",
      `Stagent-Approval-Status: ${contract.approval.status}`,
      "Reviewed-By: r",
    ]);
  });

  it("MergeGateError 携带标准错误码", () => {
    const error = new MergeGateError("E_CANNOT_MERGE", "x");
    expect(error.code).toBe("E_CANNOT_MERGE");
    expect(error.message).toContain("[E_CANNOT_MERGE]");
  });

  /**
   * P.1 回归：`git merge --squash` 不产生 MERGE_HEAD，冲突后用 `merge --abort`
   * 必然失败（fatal: There is no merge to abort），冲突标记会留在 main。
   * 修复后必须用 `reset --merge` 清场，并保证最终文件是用户版本、无冲突标记。
   */
  async function setupWorkerChange(
    title: string,
    writeWorker: (worktree: string) => void,
  ) {
    const contract = makeContract(title);
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    writeWorker(worktree);
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    return { contract, worktree, evidence: outcome.evidence };
  }

  it("冲突后用 reset --merge 清场：部分冲突时保留用户版本且无冲突标记", async () => {
    const { contract, evidence } = await setupWorkerChange(
      "直改同一行 + 新增文件",
      (worktree) => {
        fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
        fs.writeFileSync(
          path.join(worktree, "src", "a.ts"),
          "export const a = 2; // worker\n",
        );
        fs.writeFileSync(
          path.join(worktree, "src", "b.ts"),
          "export const b = 2;\n",
        );
      },
    );

    // 用户在主分支提交了同一行的新版本（真实冲突）
    fs.writeFileSync(
      path.join(repo, "src", "a.ts"),
      "export const a = 3; // user\n",
    );
    git(repo, ["commit", "-q", "-am", "user change"]);

    const result = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence,
      reviewer: "tina",
    });

    expect(result.conflictResolution).toBe("USER_FIRST_DISCARD");
    expect(result.nothingToMerge).toBe(false);
    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);

    const merged = fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8");
    expect(merged).toBe("export const a = 3; // user\n");
    expect(merged).not.toContain("<<<<<<<");
    expect(merged).not.toContain(">>>>>>>");
    // 非冲突部分照常合入
    expect(fs.existsSync(path.join(repo, "src", "b.ts"))).toBe(true);
    // 工作区干净，没有遗留冲突状态
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("AI 改动全部被用户版本覆盖：不报错、不提交，白话告知以用户为准", async () => {
    const { contract, worktree, evidence } = await setupWorkerChange(
      "只改同一行",
      (wt) => {
        fs.writeFileSync(
          path.join(wt, "src", "a.ts"),
          "export const a = 2; // worker\n",
        );
      },
    );

    fs.writeFileSync(
      path.join(repo, "src", "a.ts"),
      "export const a = 3; // user\n",
    );
    git(repo, ["commit", "-q", "-am", "user change"]);
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

    const result = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence,
      reviewer: "tina",
    });

    expect(result.nothingToMerge).toBe(true);
    expect(result.conflictResolution).toBe("USER_FIRST_DISCARD");
    expect(result.commitSha).toBe("");
    expect(result.message).toContain("已全部以你为准");
    // 没有产生新提交，主分支内容 = 用户版本
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    const content = fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8");
    expect(content).toBe("export const a = 3; // user\n");
    expect(content).not.toContain("<<<<<<<");
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
    // 合同仍在 AUDITED，Worktree 保留供 AI 基于最新代码重做
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("AUDITED");
    expect(fs.existsSync(worktree)).toBe(true);
  });
});

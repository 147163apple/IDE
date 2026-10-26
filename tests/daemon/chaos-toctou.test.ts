import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";

import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  loadEvidenceSnapshot,
  squashMerge,
} from "../../daemon/pipeline/merger";
import { computeWorktreeFingerprint } from "../../daemon/guard/evidence-integrity";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

/**
 * Chaos 场景 2：手贱外挂党（TOCTOU / 外部物理篡改）
 * 子场景 A：验证通过后、合并前，主仓库被塞进未提交改动
 * 子场景 B：验证通过后，用户直接编辑 Worktree 里的代码，想用旧 PASSED 证据偷渡
 */

function makeContract(title: string): SoftwareContract {
  const draft = createContractDraft({
    title,
    description: "chaos toctou",
    acceptanceCriteria: ["verify passes"],
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
}

describe("Chaos 2 / 手贱外挂党：TOCTOU 与证据防篡改", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-chaos2-"));
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
    safeRmSync(repo);
  });

  const worktreeFor = (contractId: string) =>
    path.join(repo, ".stagent", "worktrees", `task-${contractId}`);

  /** 走完 approve →（写入真实改动）→ execute，返回 AUDITED 的合同与证据 */
  async function reachAudited(title: string) {
    const contract = makeContract(title);
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const worktree = worktreeFor(contract.contract_id);
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "feature.ts"),
      "export const feature = 1;\n",
    );
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.evidence.verdict.status).toBe("PASSED");
    return { contract, outcome, worktree };
  }

  it("子场景 A：验证通过后主仓库出现未跟踪文件，合并被 E_MAIN_TREE_DIRTY 拦截", async () => {
    const { contract, outcome } = await reachAudited("toctou main tree");
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

    // 用户/外部脚本在主仓库偷偷塞了一个文件
    fs.writeFileSync(
      path.join(repo, "secret-notes.md"),
      "todo: not reviewed\n",
    );

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_MAIN_TREE_DIRTY" });

    // 主干未被污染，用户改动原样保留
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(fs.existsSync(path.join(repo, "secret-notes.md"))).toBe(true);

    // 清理主树后可以正常合并
    fs.rmSync(path.join(repo, "secret-notes.md"));
    const result = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence: outcome.evidence,
      reviewer: "tina",
    });
    expect(result.contract.lifecycle_state).toBe("MERGED");
  });

  it("子场景 B：验证通过后外部篡改 Worktree 代码，旧 PASSED 证据无法偷渡合并", async () => {
    const { contract, outcome, worktree } = await reachAudited(
      "toctou worktree tamper",
    );
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();
    const evidencePath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
    );

    // 指纹此刻一致（基线自证）
    expect(await computeWorktreeFingerprint(worktree)).toBe(
      outcome.evidence.worktree_snapshot.snapshot_fingerprint,
    );

    // 用户在 VS Code 里直接打开 Worktree 改了代码（未经验证的偷渡内容）
    fs.writeFileSync(
      path.join(worktree, "src", "feature.ts"),
      "export const feature = 1;\nexport const backdoor = 'evil';\n",
    );

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_EVIDENCE_FINGERPRINT_MISMATCH" });

    // 主干未被污染
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    // 证据被就地标记 STALE，UI 与后续核销都看得到
    const stale = loadEvidenceSnapshot(
      repo,
      contract.contract_id,
      outcome.evidence.evidence_id,
    );
    expect(stale?.verdict.status).toBe("STALE");
    expect(stale?.verdict.can_merge).toBe(false);
    expect(stale?.verdict.reason_code).toBe("EVIDENCE_STALE");
    expect(fs.existsSync(evidencePath)).toBe(true);

    // 重新验证后（新指纹）可正常合并——用户改动被纳入验证而非静默偷渡
    store.transition({
      contractId: contract.contract_id,
      lifecycleState: "EXECUTING",
    });
    const reOutcome = await orchestrator.execute(contract.contract_id);
    expect(reOutcome.evidence.evidence_id).not.toBe(
      outcome.evidence.evidence_id,
    );
    const merged = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence: reOutcome.evidence,
      reviewer: "tina",
    });
    expect(merged.contract.lifecycle_state).toBe("MERGED");
    expect(
      fs.readFileSync(path.join(repo, "src", "feature.ts"), "utf8"),
    ).toContain("backdoor");
  });

  it("子场景 B 变体：Worktree 新增未跟踪文件同样被指纹门禁拦截", async () => {
    const { contract, outcome, worktree } =
      await reachAudited("toctou untracked");
    fs.writeFileSync(
      path.join(worktree, "src", "sneak.ts"),
      "export const sneak = 1;\n",
    );
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_EVIDENCE_FINGERPRINT_MISMATCH" });
  });

  it("子场景 B 变体：Worktree 删除已验证文件同样被拦截", async () => {
    const { contract, outcome, worktree } = await reachAudited("toctou delete");
    fs.rmSync(path.join(worktree, "src", "feature.ts"));
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_EVIDENCE_FINGERPRINT_MISMATCH" });
  });

  it("不误伤：Worktree 内 node_modules 抖动不触发指纹失效", async () => {
    const { contract, outcome, worktree } = await reachAudited(
      "toctou node_modules",
    );
    // 依赖安装/构建产物属于忽略表，不应该让证据假性 STALE
    fs.mkdirSync(path.join(worktree, "node_modules", "pkg"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(worktree, "node_modules", "pkg", "index.js"),
      "module.exports = 1;\n",
    );

    const result = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence: outcome.evidence,
      reviewer: "tina",
    });
    expect(result.contract.lifecycle_state).toBe("MERGED");
  });
});

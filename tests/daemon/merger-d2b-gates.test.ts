import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  MAX_TRAILER_BLOCK_BYTES,
  MAX_TRAILER_LINE_BYTES,
  MergeGateError,
  assertTrailerBounds,
  assertWorktreeUntrackedScope,
  buildMergeCommitMessage,
  measureTrailerBounds,
  squashMerge,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import type { EvidenceBundle } from "../../src/lib/evidence.schema";
import { git } from "../helpers/git";

/**
 * TASK-D.2b：合并前未跟踪文件门禁 + Contract v1.3 零静默迁移接入。
 *
 * 三个被测面：
 * 1. 合并侧未跟踪文件：越界即 `E_OUT_OF_SCOPE_UNTRACKED`，且不产生任何合并副作用；
 * 2. 存量合同加载：v1.2.0 内存迁移，DRAFT/PENDING_APPROVAL 绝不变 APPROVED；
 * 3. Trailer 尺寸红线：单条 ≤512B、合计 ≤4KB，越界拒绝提交。
 */

const SCOPE = {
  writable_paths: ["src/**"],
  readonly_paths: [] as string[],
  strictly_forbidden_paths: [".env*"],
};

describe("TASK-D.2b / 合并前未跟踪文件门禁", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  const makeContract = (title: string): SoftwareContract => {
    const draft = createContractDraft({
      title,
      description: "d2b merge gate",
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

  /** 走完 approve → 写入合同内改动 → execute，得到 AUDITED + PASSED 证据 */
  async function reachAudited(title: string) {
    const contract = makeContract(title);
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    fs.writeFileSync(
      path.join(worktree, "src", "feature.ts"),
      "export const feature = 1;\n",
    );
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    return { contract, worktree, evidence: outcome.evidence };
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d2b-"));
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

  it("合同外未跟踪文件阻断合并：抛 E_OUT_OF_SCOPE_UNTRACKED 且无任何合并副作用", async () => {
    const { contract, worktree, evidence } =
      await reachAudited("untracked block");
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

    // 证据生成之后，绕过网关在 Worktree 内新建合同外文件
    fs.mkdirSync(path.join(worktree, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "scripts", "hijack.js"),
      "// bypassed gateway\n",
    );

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_OUT_OF_SCOPE_UNTRACKED" });

    // 合并未发生：主分支 HEAD 不变、合同仍 AUDITED、Worktree 仍保留
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("AUDITED");
    expect(fs.existsSync(worktree)).toBe(true);
    // 越界文件没有进入任务分支
    expect(git(worktree, ["ls-files"])).not.toContain("scripts/hijack.js");
  });

  it("合同内未跟踪文件不触发该门禁（白名单内放行）", async () => {
    const contract = makeContract("in scope untracked");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    fs.writeFileSync(
      path.join(worktree, "src", "generated.ts"),
      "export const generated = 1;\n",
    );

    await expect(
      assertWorktreeUntrackedScope({ worktreePath: worktree, scope: SCOPE }),
    ).resolves.toBeUndefined();
  });

  it("多处越界时错误信息列出清单与数量，便于用户一次清理", async () => {
    const contract = makeContract("multi violation");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    fs.writeFileSync(path.join(worktree, "leak-a.txt"), "a\n");
    fs.writeFileSync(path.join(worktree, "leak-b.txt"), "b\n");

    const error = await assertWorktreeUntrackedScope({
      worktreePath: worktree,
      scope: SCOPE,
    }).then(
      () => null,
      (err: unknown) => err as MergeGateError,
    );
    expect(error).toBeInstanceOf(MergeGateError);
    expect(error?.code).toBe("E_OUT_OF_SCOPE_UNTRACKED");
    expect(error?.message).toContain("leak-a.txt");
    expect(error?.message).toContain("leak-b.txt");
    expect(error?.message).toContain("2");
  });
});

describe("TASK-D.2b / 存量合同零静默授权", () => {
  let repo: string;
  let store: ContractStore;

  /** 构造 v1.2.0 形态的原始合同（已剥离 v1.3.0 增量字段） */
  function v12Raw(
    lifecycle: string,
    approval: Record<string, unknown>,
  ): Record<string, unknown> {
    const raw = JSON.parse(
      JSON.stringify(
        createContractDraft({
          title: "D.2b 存量合同",
          description: "v1.2.0 存量",
          acceptanceCriteria: ["迁移后通过 v1.3.0 Schema"],
          writablePaths: ["src/**"],
        }),
      ),
    ) as Record<string, unknown>;

    raw["schema_version"] = "1.2.0";
    raw["created_at"] = "2026-01-02T03:04:05.000Z";
    raw["contract_revision"] = 2;

    const authorization = raw["authorization"] as Record<string, unknown>;
    const gitCfg = authorization["git"] as Record<string, unknown>;
    delete gitCfg["allowed_operations"];
    delete gitCfg["forbidden_flags"];
    delete gitCfg["enforce_clean_base"];
    delete gitCfg["task_worktree_branch"];

    raw["lifecycle_state"] = lifecycle;
    raw["approval"] = approval;
    return raw;
  }

  function writeRaw(raw: Record<string, unknown>, contractId: string): void {
    fs.writeFileSync(
      path.join(repo, ".stagent", "contracts", `${contractId}.json`),
      JSON.stringify(raw, null, 2),
    );
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d2b-legacy-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repo, "README.md"), "# base\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    store = new ContractStore(repo);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("v1.2.0 DRAFT 加载后仍为 DRAFT，绝不静默授权", () => {
    const raw = v12Raw("DRAFT", { status: "DRAFT" });
    writeRaw(raw, String(raw["contract_id"]));

    const loaded = store.getWithMigration(String(raw["contract_id"]));
    expect(loaded).not.toBeNull();
    expect(loaded?.contract.lifecycle_state).toBe("DRAFT");
    expect(loaded?.contract.approval.status).toBe("DRAFT");
    expect(loaded?.migration?.requiresReapproval).toBe(true);
  });

  it("v1.2.0 PENDING_APPROVAL 加载后为 PENDING_REVIEW，且抹掉旧审批戳记", () => {
    const raw = v12Raw("PENDING_APPROVAL", {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: "2026-01-01T00:00:00.000Z",
      approved_revision: 1,
    });
    writeRaw(raw, String(raw["contract_id"]));

    const contract = store.getWithMigration(
      String(raw["contract_id"]),
    )?.contract;
    expect(contract?.approval.status).toBe("PENDING_REVIEW");
    expect(contract?.approval.approved_by).toBeUndefined();
    expect(contract?.approval.approved_revision).toBeUndefined();
  });

  it("v1.2.0 执行态合同按白名单迁移为 APPROVED（历史事实，不需要重批）", () => {
    const raw = v12Raw("AUDITED", { status: "APPROVED" });
    writeRaw(raw, String(raw["contract_id"]));

    const loaded = store.getWithMigration(String(raw["contract_id"]));
    expect(loaded?.contract.approval.status).toBe("APPROVED");
    expect(loaded?.migration?.requiresReapproval).toBe(false);
  });

  it("v1.2.0 待审合同合并被拒：E_CONTRACT_REQUIRES_REAPPROVAL，而不是「合同不存在」", async () => {
    const raw = v12Raw("PENDING_APPROVAL", { status: "PENDING_REVIEW" });
    const contractId = String(raw["contract_id"]);
    writeRaw(raw, contractId);

    // 旧实现（store.get 直接 parse v1.3）在这里会报 E_CONTRACT_NOT_FOUND，
    // 等于用「找不到」掩盖了一场静默授权的尝试。
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId,
        evidence: { evidence_id: "evi_legacy" } as unknown as EvidenceBundle,
        reviewer: "tina",
      }),
    ).rejects.toMatchObject({ code: "E_CONTRACT_REQUIRES_REAPPROVAL" });
  });
});

describe("TASK-D.2b / Git Trailer 尺寸红线", () => {
  const makeContract = (): SoftwareContract => {
    const draft = createContractDraft({
      title: "trailer bounds",
      description: "trailer",
      acceptanceCriteria: ["pass"],
      writablePaths: ["src/**"],
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "AUDITED",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: "2026-01-02T03:04:05.000Z",
        approved_revision: draft.contract_revision,
      },
    });
  };

  const evidence = (): EvidenceBundle =>
    ({
      evidence_id: "evi_trailer",
      verdict: { status: "PASSED" },
      tests_modified: false,
    }) as unknown as EvidenceBundle;

  it("标准合并信息在 512B / 4KB 红线之内", () => {
    const message = buildMergeCommitMessage(
      makeContract(),
      evidence(),
      "tina",
      null,
      { evidenceHash: "a".repeat(64) },
    );
    const bounds = measureTrailerBounds(message);
    expect(bounds.lines.length).toBeGreaterThanOrEqual(4);
    expect(bounds.maxLineBytes).toBeLessThanOrEqual(MAX_TRAILER_LINE_BYTES);
    expect(bounds.totalBytes).toBeLessThanOrEqual(MAX_TRAILER_BLOCK_BYTES);
    expect(() => assertTrailerBounds(message)).not.toThrow();
  });

  it("单条 trailer 超过 512B 时拒绝提交（E_TRAILER_TOO_LARGE）", () => {
    const message = buildMergeCommitMessage(
      makeContract(),
      evidence(),
      "x".repeat(600),
    );
    const bounds = measureTrailerBounds(message);
    expect(bounds.maxLineBytes).toBeGreaterThan(MAX_TRAILER_LINE_BYTES);
    expect(() => assertTrailerBounds(message)).toThrow(/E_TRAILER_TOO_LARGE/);
  });

  it("trailer 块合计超过 4KB 时拒绝提交", () => {
    // 每条 ~500B（未超单条上限），9 条合计超 4KB
    const filler = Array.from(
      { length: 9 },
      (_, index) => `Stagent-Filler-${index}: ${"x".repeat(480)}`,
    ).join("\n");
    const message = `feat: demo\n\nbody\n\n${filler}`;
    const bounds = measureTrailerBounds(message);
    expect(bounds.maxLineBytes).toBeLessThanOrEqual(MAX_TRAILER_LINE_BYTES);
    expect(bounds.totalBytes).toBeGreaterThan(MAX_TRAILER_BLOCK_BYTES);
    expect(() => assertTrailerBounds(message)).toThrow(/E_TRAILER_TOO_LARGE/);
  });
});

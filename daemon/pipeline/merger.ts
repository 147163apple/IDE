import fs from "node:fs";
import path from "node:path";
import { ContractStore } from "./contract-store";
import { readStateFile } from "../guard/state-store";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import {
  evidenceBundleSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";
import {
  execGit,
  getWorktreePath,
  removeTaskWorktree,
} from "../git/worktree-manager";
import { assertEvidenceIntegrity } from "../guard/evidence-integrity";
import {
  contractLockPath,
  withContractLock,
  InvalidStateTransitionError,
} from "../core/contract-mutex";

/**
 * Evidence 核销与 Squash-Merge（规范 TASK-D.2 / §5.2）。
 * 门禁：合同 AUDITED + verdict PASSED + can_merge=true + 非 STALE + 证据快照存在。
 */
export interface MergeOptions {
  repoRoot: string;
  contractId: string;
  evidence: EvidenceBundle;
  reviewer: string;
}

export interface MergeResult {
  commitSha: string;
  commitMessage: string;
  contract: SoftwareContract;
  worktreeRemoved: boolean;
  /** P.1 User-First Discard：发生冲突时是否按「用户主分支永远胜出」自动仲裁 */
  conflictResolution: "USER_FIRST_DISCARD" | null;
}

export class MergeGateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "MergeGateError";
    this.code = code;
  }
}

/**
 * 合并前置检查：主工作区必须干净（E_MAIN_TREE_DIRTY）。
 *
 * squash merge 直接在主工作树上落盘并暂存；若主树存在未提交/未跟踪改动，
 * 这些无关改动会被卷入带 Stagent Trailer 的审计提交，或与任务分支冲突导致
 * 合并中断在现场。因此合并前强制 `git status --porcelain` 为空。
 *
 * 例外：`.stagent/` 是 Daemon 自身的运行态目录（合同/证据/Worktree 元数据），
 * 不参与业务代码审计，从脏检查中排除。
 */
export async function assertMainTreeClean(repoRoot: string): Promise<void> {
  // -uall：展开未跟踪目录内的具体文件，诊断信息更精确
  const status = await execGit(["status", "--porcelain", "-uall"], repoRoot);
  if (status.exitCode !== 0) {
    throw new MergeGateError(
      "E_GIT_STATUS_FAILED",
      `git status failed: ${status.stderr || status.stdout}`,
    );
  }
  const dirty = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // porcelain 行格式："XY <path>"（重命名为 "XY <orig> -> <new>"）
      let p = line.slice(3);
      const arrow = p.indexOf(" -> ");
      if (arrow >= 0) p = p.slice(arrow + 4);
      return p.replace(/^"|"$/g, "").replace(/\/$/, "");
    })
    .filter((p) => p !== "" && p !== ".stagent" && !p.startsWith(".stagent/"));

  if (dirty.length > 0) {
    throw new MergeGateError(
      "E_MAIN_TREE_DIRTY",
      `主工作区存在 ${dirty.length} 处未提交/未跟踪改动，已阻断合并：请先 commit 或 stash 主树后再核销（${dirty
        .slice(0, 5)
        .join(", ")}${dirty.length > 5 ? ", ..." : ""}）`,
    );
  }
}

/** 标准 Git Trailer（§5.2，字段顺序固定） */
export function buildMergeCommitMessage(
  contract: SoftwareContract,
  evidence: EvidenceBundle,
  reviewer: string,
  conflictResolution: "USER_FIRST_DISCARD" | null = null,
): string {
  const trailers = [
    `Stagent-Contract-ID: ${contract.contract_id}`,
    `Stagent-Evidence-ID: ${evidence.evidence_id}`,
    `Stagent-Verdict: ${evidence.verdict.status}`,
    `Reviewed-By: ${reviewer}`,
  ];
  // 测试完整性留痕：任务修改过测试文件时，审计提交中显式标记
  if (evidence.tests_modified === true) {
    trailers.push("Stagent-Tests-Modified: true");
  }
  return [
    `feat(${contract.contract_id.replace(/^contract_/, "")}): ${contract.intent.title}`,
    "",
    "由 Stagent 受限执行并通过全部门禁验证。",
    ...(conflictResolution
      ? [
          "冲突处理：以用户主分支版本为准，Worker 冲突改动已丢弃（User-First Discard）。",
        ]
      : []),
    "",
    ...trailers,
  ].join("\n");
}

export async function squashMerge(options: MergeOptions): Promise<MergeResult> {
  const repoRoot = path.resolve(options.repoRoot);
  // 合同排他锁：并发的两次核销串行执行，第二次在锁内看到 MERGED 立即失败
  return withContractLock(contractLockPath(repoRoot, options.contractId), () =>
    mergeInternal(repoRoot, options),
  );
}

async function mergeInternal(
  repoRoot: string,
  options: MergeOptions,
): Promise<MergeResult> {
  const store = new ContractStore(repoRoot);
  const contract = store.get(options.contractId);

  if (!contract) {
    throw new MergeGateError(
      "E_CONTRACT_NOT_FOUND",
      `Contract ${options.contractId} not found`,
    );
  }
  // 1. 状态门禁（已合并 → 并发冲突语义；未审计 → 前置条件不足）
  if (contract.lifecycle_state === "MERGED") {
    throw new InvalidStateTransitionError(
      contract.lifecycle_state,
      ["AUDITED"],
      "merge",
    );
  }
  if (contract.lifecycle_state !== "AUDITED") {
    throw new MergeGateError(
      "E_NOT_AUDITED",
      `Contract must be AUDITED before merge (state=${contract.lifecycle_state})`,
    );
  }

  // 2. Evidence 门禁（以磁盘快照为准，避免内存伪造）
  const evidencePath = path.join(
    repoRoot,
    ".stagent",
    "evidence",
    `${contract.contract_id}-${options.evidence.evidence_id}.json`,
  );
  if (!fs.existsSync(evidencePath)) {
    throw new MergeGateError(
      "E_EVIDENCE_MISSING",
      `Evidence snapshot not found: ${evidencePath}`,
    );
  }
  const snapshot = evidenceBundleSchema.parse(
    JSON.parse(fs.readFileSync(evidencePath, "utf-8")),
  );
  if (snapshot.contract_id !== contract.contract_id) {
    throw new MergeGateError(
      "E_EVIDENCE_MISMATCH",
      "Evidence does not belong to contract",
    );
  }
  if (snapshot.verdict.status === "STALE") {
    throw new MergeGateError(
      "E_EVIDENCE_STALE",
      "Evidence is STALE; re-run verification",
    );
  }
  if (snapshot.verdict.status !== "PASSED" || !snapshot.verdict.can_merge) {
    throw new MergeGateError(
      "E_CANNOT_MERGE",
      `Evidence verdict is ${snapshot.verdict.status} (can_merge=${snapshot.verdict.can_merge})`,
    );
  }

  // 3. Worktree 与分支必须存在
  const worktreePath = getWorktreePath(repoRoot, contract.contract_id);
  if (!fs.existsSync(worktreePath)) {
    throw new MergeGateError(
      "E_WORKTREE_LOST",
      `Worktree missing: ${worktreePath}`,
    );
  }
  const branch = contract.authorization.git.task_branch;

  // 3.6 防偷渡门禁：Worktree 指纹必须与 Evidence 记录一致。
  // 用户在验证通过后外部篡改 Worktree（VS Code 直改 / 脚本写入）→ 指纹不符 →
  // 证据落盘标记 STALE 并阻断合并，杜绝用旧 PASSED 证据合并未验证代码。
  await assertEvidenceIntegrity({
    worktreePath,
    evidencePath,
    snapshot,
  });

  // 3.7 重复合并防御：主干已存在携带同一 Evidence-ID 的审计提交则拒绝再合一次
  const headMessage = await execGit(["log", "-1", "--format=%B"], repoRoot);
  if (
    headMessage.stdout.includes(`Stagent-Evidence-ID: ${snapshot.evidence_id}`)
  ) {
    throw new MergeGateError(
      "E_ALREADY_MERGED",
      `Evidence ${snapshot.evidence_id} has already been merged into ${await currentBranchName(repoRoot)}`,
    );
  }

  // 3.5 主工作区脏状态门禁：脏树会污染审计提交，直接阻断
  await assertMainTreeClean(repoRoot);

  // 4. Squash merge（先确认主分支无未完成 merge 状态）
  let merge = await execGit(["merge", "--squash", branch], repoRoot);
  let conflictResolution: "USER_FIRST_DISCARD" | null = null;
  if (merge.exitCode !== 0) {
    await execGit(["merge", "--abort"], repoRoot);
    // P.1 User-First Discard Rule（架构 §0.6.4）：不向用户抛 Git 冲突界面，
    // 冲突处永远以用户当前主分支版本为准，丢弃 Worker 的冲突改动，AI 需基于最新代码重做。
    merge = await execGit(
      ["merge", "--squash", "-X", "ours", branch],
      repoRoot,
    );
    if (merge.exitCode === 0) {
      conflictResolution = "USER_FIRST_DISCARD";
    } else {
      await execGit(["merge", "--abort"], repoRoot);
      throw new MergeGateError(
        "E_MERGE_CONFLICT",
        `git merge --squash failed: ${merge.stderr || merge.stdout}`,
      );
    }
  }

  // 5. 生成 Trailer 提交
  const message = buildMergeCommitMessage(
    contract,
    snapshot,
    options.reviewer,
    conflictResolution,
  );
  const commit = await execGit(["commit", "-m", message], repoRoot);
  if (commit.exitCode !== 0) {
    throw new MergeGateError(
      "E_COMMIT_FAILED",
      `git commit failed: ${commit.stderr || commit.stdout}`,
    );
  }
  const shaResult = await execGit(["rev-parse", "HEAD"], repoRoot);
  const commitSha = shaResult.stdout.trim();

  // 6. 清理 Worktree 与任务分支
  let worktreeRemoved = false;
  try {
    await removeTaskWorktree({
      repoRoot,
      contractId: contract.contract_id,
      force: true,
      deleteBranch: true,
    });
    worktreeRemoved = true;
  } catch {
    worktreeRemoved = false;
  }

  // 7. 合同终态（存证与合同文件均保留在 .stagent/）
  const merged = store.transition({
    contractId: contract.contract_id,
    lifecycleState: "MERGED",
  });

  return {
    commitSha,
    commitMessage: message,
    contract: merged,
    worktreeRemoved,
    conflictResolution,
  };
}

/** 当前主干分支名（仅用于错误信息可读性） */
async function currentBranchName(repoRoot: string): Promise<string> {
  const res = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  return res.stdout.trim() || "HEAD";
}

/** 读取证据快照（供 UI/清单使用） */
/**
 * 取某合同最新一份 Evidence（控制台刷新后恢复「验收面板」用）。
 * Evidence 可以有多份（重试/恢复都会追加），按文件 mtime 取最新。
 */
export function loadLatestEvidenceSnapshot(
  repoRoot: string,
  contractId: string,
): EvidenceBundle | null {
  const dir = path.join(repoRoot, ".stagent", "evidence");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }

  const prefix = `${contractId}-`;
  const latest = names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => {
      const file = path.join(dir, name);
      try {
        return { file, mtime: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { file: string; mtime: number } => entry !== null)
    .sort((a, b) => b.mtime - a.mtime)[0];

  if (!latest) return null;
  const raw = readStateFile<unknown>(latest.file);
  if (!raw) return null;
  try {
    return evidenceBundleSchema.parse(raw);
  } catch {
    return null;
  }
}

export function loadEvidenceSnapshot(
  repoRoot: string,
  contractId: string,
  evidenceId: string,
): EvidenceBundle | null {
  const file = path.join(
    repoRoot,
    ".stagent",
    "evidence",
    `${contractId}-${evidenceId}.json`,
  );
  const raw = readStateFile<unknown>(file);
  if (!raw) return null;
  try {
    return evidenceBundleSchema.parse(raw);
  } catch {
    return null;
  }
}

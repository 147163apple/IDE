import fs from "node:fs";
import path from "node:path";
import {
  listWorktrees,
  removeTaskWorktree,
  pruneWorktrees,
  execGit,
  type WorktreeListEntry,
} from "../git/worktree-manager";
import { readStateFile, writeStateFile } from "../guard/state-store";
import { cleanupStaleGitLocks, type GitLockCleanupResult } from "./git-lock";

/**
 * Daemon 崩溃恢复与工作区自愈（规范 §6.3 异常 4 / TASK-A.6）
 *
 * 启动后（取得 PID 锁）扫描 `.stagent/contracts/` 与 `.stagent/evidence/`：
 * - PREPARING 中断：清理半成品 Worktree，合同回退 PENDING_APPROVAL + PENDING_REVIEW
 * - EXECUTING / VERIFYING：Worktree 存在 → PENDING_RESUME 并留存 patch/日志/费用快照
 * - Worktree 丢失 → ABORTED + WORKTREE_LOST
 * - 孤儿 Worktree（无对应合同）→ 安全 prune
 */

export type IntermediateState = "PREPARING" | "EXECUTING" | "VERIFYING";

export type RecoveryOutcome =
  "REVERTED_TO_PENDING_APPROVAL" | "RESUMED" | "ABORTED" | "SKIPPED";

export interface RecoveryRecord {
  contractId: string;
  from: IntermediateState;
  to: string;
  outcome: RecoveryOutcome;
  reasonCode?: "PREPARATION_INTERRUPTED" | "WORKTREE_LOST";
  worktreeExisted: boolean;
  patchPath?: string;
  evidencePath?: string;
}

export interface RecoveryReport {
  scannedContracts: number;
  scannedEvidence: number;
  records: RecoveryRecord[];
  orphanWorktrees: string[];
  pruned: boolean;
  errors: string[];
  /** 被判定为崩溃残留而删除的 git 锁文件（index.lock / gc.pid / MERGE_HEAD …） */
  cleanedLocks: string[];
  /** 因持有者存活或过新而保留的锁文件 */
  retainedLocks: string[];
}

interface RawContract {
  contract_id?: string;
  lifecycle_state?: string;
  approval?: { status?: string; approved_by?: string; approved_at?: string };
  authorization?: { git?: { task_branch?: string } };
  [key: string]: unknown;
}

const INTERMEDIATE: IntermediateState[] = [
  "PREPARING",
  "EXECUTING",
  "VERIFYING",
];

function listJsonFiles(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** 在 Worktree 内采集最新 patch 与工作区状态 */
async function captureWorktreeSnapshot(
  worktreePath: string,
  contractId: string,
  evidenceDir: string,
): Promise<{ patchPath: string; snapshotPath: string }> {
  // intent-to-add 让未跟踪文件也进入 diff（否则新增文件不会出现在 Patch 中）
  await execGit(["add", "-A", "-N"], worktreePath);
  const [diff, status, head] = await Promise.all([
    execGit(["diff", "HEAD"], worktreePath),
    execGit(["status", "--porcelain"], worktreePath),
    execGit(["rev-parse", "HEAD"], worktreePath),
  ]);

  const capturedAt = new Date().toISOString();
  const stamp = capturedAt.replace(/[:.]/g, "-");
  const patchPath = path.join(
    evidenceDir,
    `${contractId}-resume-${stamp}.patch`,
  );
  const snapshotPath = path.join(
    evidenceDir,
    `${contractId}-resume-${stamp}.json`,
  );

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(patchPath, diff.stdout || "", "utf-8");

  const costState = readStateFile<Record<string, unknown>>(
    path.join(path.dirname(evidenceDir), "guard", "cost.json"),
  );
  const loopState = readStateFile<Record<string, unknown>>(
    path.join(path.dirname(evidenceDir), "guard", "loop.json"),
  );

  writeStateFile(snapshotPath, {
    contract_id: contractId,
    captured_at: capturedAt,
    worktree_path: worktreePath,
    head_sha: head.stdout.trim(),
    git_status: status.stdout.trimEnd().split("\n").filter(Boolean),
    patch_file: path.basename(patchPath),
    usage: costState ?? null,
    verification_guard: loopState ?? null,
  });

  return { patchPath, snapshotPath };
}

/**
 * 主入口：扫描并自愈所有悬空合同与孤儿 Worktree。
 * 幂等：已处于非中间态的合同不会被再次修改。
 */
export async function recoverDaemonState(options: {
  repoRoot: string;
  stagentDir?: string;
  /** 锁文件清理的最小年龄阈值（测试可传 0 立即清理） */
  gitLockMinAgeMs?: number;
}): Promise<RecoveryReport> {
  const repoRoot = path.resolve(options.repoRoot);
  const stagentDir = options.stagentDir ?? path.join(repoRoot, ".stagent");
  const contractsDir = path.join(stagentDir, "contracts");
  const evidenceDir = path.join(stagentDir, "evidence");

  const report: RecoveryReport = {
    scannedContracts: 0,
    scannedEvidence: listJsonFiles(evidenceDir).length,
    records: [],
    orphanWorktrees: [],
    pruned: false,
    errors: [],
    cleanedLocks: [],
    retainedLocks: [],
  };

  // 第 0 步：清掉崩溃残留的 git 锁。必须先做——否则后续所有 git 写操作
  // 都会被 index.lock 挡在门外，整个自愈流程自己就先瘫痪。
  try {
    const lockCleanup: GitLockCleanupResult = cleanupStaleGitLocks(repoRoot, {
      ...(options.gitLockMinAgeMs === undefined
        ? {}
        : { minAgeMs: options.gitLockMinAgeMs }),
    });
    report.cleanedLocks = lockCleanup.removed;
    report.retainedLocks = lockCleanup.skipped;
  } catch (err) {
    report.errors.push(`git lock cleanup failed: ${(err as Error).message}`);
  }

  let worktrees: WorktreeListEntry[] = [];
  try {
    worktrees = await listWorktrees(repoRoot);
  } catch (err) {
    report.errors.push(`listWorktrees failed: ${(err as Error).message}`);
  }
  const registered = new Set(
    worktrees.map((w) => {
      try {
        return fs.realpathSync(w.worktree);
      } catch {
        return w.worktree;
      }
    }),
  );

  const contractFiles = listJsonFiles(contractsDir);
  const knownContractIds = new Set<string>();

  for (const file of contractFiles) {
    report.scannedContracts += 1;
    let contract: RawContract;
    try {
      contract = JSON.parse(fs.readFileSync(file, "utf-8")) as RawContract;
    } catch (err) {
      report.errors.push(
        `invalid contract json '${file}': ${(err as Error).message}`,
      );
      continue;
    }

    const contractId = contract.contract_id;
    const state = contract.lifecycle_state as IntermediateState | undefined;
    if (!contractId) {
      report.errors.push(`contract file missing contract_id: '${file}'`);
      continue;
    }
    knownContractIds.add(contractId);

    if (!state || !INTERMEDIATE.includes(state)) continue;

    const worktreePath = path.join(
      stagentDir,
      "worktrees",
      `task-${contractId}`,
    );
    const realWorktreePath = fs.existsSync(worktreePath)
      ? fs.realpathSync(worktreePath)
      : worktreePath;
    const worktreeExisted =
      fs.existsSync(worktreePath) &&
      (registered.size === 0 || registered.has(realWorktreePath));

    if (state === "PREPARING") {
      // 半成品清理：删除可能残留的 Worktree，回退等待重新审批
      if (fs.existsSync(worktreePath)) {
        try {
          await removeTaskWorktree({
            repoRoot,
            contractId,
            force: true,
            deleteBranch: false,
          });
        } catch (err) {
          report.errors.push(
            `cleanup PREPARING worktree '${contractId}' failed: ${(err as Error).message}`,
          );
        }
      }
      contract.lifecycle_state = "PENDING_APPROVAL";
      contract.approval = { status: "PENDING_REVIEW" };
      writeStateFile(file, contract);

      report.records.push({
        contractId,
        from: state,
        to: "PENDING_APPROVAL",
        outcome: "REVERTED_TO_PENDING_APPROVAL",
        reasonCode: "PREPARATION_INTERRUPTED",
        worktreeExisted,
      });
      continue;
    }

    // EXECUTING / VERIFYING
    // 物理目录存在但 git 元数据已被破坏（.git/worktrees/<name> 被删 / index 损坏）
    // 与「目录消失」等价：都只能判定 WORKTREE_LOST，不能假装可续跑。
    const head = worktreeExisted
      ? await execGit(["rev-parse", "HEAD"], worktreePath)
      : null;
    const worktreeHealthy = worktreeExisted && head?.exitCode === 0;

    if (!worktreeHealthy) {
      contract.lifecycle_state = "ABORTED";
      writeStateFile(file, contract);

      const evidencePath = path.join(
        evidenceDir,
        `${contractId}-recovery-${Date.now()}.json`,
      );
      writeStateFile(evidencePath, {
        contract_id: contractId,
        generated_at: new Date().toISOString(),
        verdict: {
          status: "BLOCKED",
          can_merge: false,
          summary: "Worktree lost during recovery",
          reason_code: "WORKTREE_LOST",
        },
        worktree_snapshot: null,
      });

      report.records.push({
        contractId,
        from: state,
        to: "ABORTED",
        outcome: "ABORTED",
        reasonCode: "WORKTREE_LOST",
        worktreeExisted,
        evidencePath,
      });
      continue;
    }

    // Worktree 物理存在：留存 patch 与快照，流转 PENDING_RESUME
    try {
      const snapshot = await captureWorktreeSnapshot(
        worktreePath,
        contractId,
        evidenceDir,
      );
      contract.lifecycle_state = "PENDING_RESUME";
      writeStateFile(file, contract);

      report.records.push({
        contractId,
        from: state,
        to: "PENDING_RESUME",
        outcome: "RESUMED",
        worktreeExisted: true,
        patchPath: snapshot.patchPath,
        evidencePath: snapshot.snapshotPath,
      });
    } catch (err) {
      report.errors.push(
        `resume capture '${contractId}' failed: ${(err as Error).message}`,
      );
    }
  }

  // 孤儿 Worktree：物理存在但无对应合同
  const worktreesRoot = path.join(stagentDir, "worktrees");
  if (fs.existsSync(worktreesRoot)) {
    for (const entry of fs.readdirSync(worktreesRoot)) {
      if (!entry.startsWith("task-")) continue;
      const contractId = entry.slice("task-".length);
      if (knownContractIds.has(contractId)) continue;
      report.orphanWorktrees.push(path.join(worktreesRoot, entry));
      try {
        await removeTaskWorktree({
          repoRoot,
          contractId,
          force: true,
          deleteBranch: true,
        });
      } catch (err) {
        report.errors.push(
          `orphan cleanup '${contractId}' failed: ${(err as Error).message}`,
        );
      }
    }
  }

  try {
    await pruneWorktrees(repoRoot);
    report.pruned = true;
  } catch (err) {
    report.errors.push(`prune failed: ${(err as Error).message}`);
  }

  return report;
}

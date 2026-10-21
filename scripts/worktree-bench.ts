/**
 * Worktree 创建 / 销毁微基准（TASK-E.2 报告用）。
 *
 * 主流程里的 Worktree 生命期被 `admit()` 与 `squashMerge()` 包住，无法在不改
 * 生产代码的前提下单独埋点。这里用「准入 → 立即中止」的极短合同做独立测量，
 * 只回答一个问题：本机这一档仓库上，建/销一个任务 Worktree 要多久。
 *
 * 注意：微基准与主流程共享同一台机器与同一份 node_modules（共享视图），
 * 数字只代表本机，报告中不得外推为通用性能承诺。
 *
 * 用法：npx tsx scripts/worktree-bench.ts [迭代次数]
 */
import fs from "node:fs";

import { ContractOrchestrator } from "../daemon/pipeline/orchestrator";
import { ContractStore } from "../daemon/pipeline/contract-store";
import { getWorktreePath } from "../daemon/git/worktree-manager";
import {
  createContractDraft,
  softwareContractSchema,
} from "../src/lib/contract.schema";

const REPO_ROOT = process.cwd();
const ITERATIONS = Math.max(1, Number(process.argv[2] ?? 3));

function ms(startedAt: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
}

function mean(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

async function main(): Promise<void> {
  const orchestrator = new ContractOrchestrator({ repoRoot: REPO_ROOT });
  const store = new ContractStore(REPO_ROOT);
  const created: number[] = [];
  const destroyed: number[] = [];

  for (let i = 0; i < ITERATIONS; i += 1) {
    const draft = createContractDraft({
      title: `Worktree 微基准 #${i + 1}`,
      description: "仅测量 Worktree 创建/销毁，不执行任何改动",
      acceptanceCriteria: ["不执行验证命令"],
      writablePaths: ["bin/stagent.ts"],
      commands: [
        {
          alias: "noop",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 10,
        },
      ],
    });
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    store.save(contract);

    const createStart = process.hrtime.bigint();
    const admission = await orchestrator.admit(contract.contract_id);
    created.push(ms(createStart));
    if (admission.decision !== "AUTO_APPROVED") {
      throw new Error(`微基准准入失败：${admission.decision}`);
    }
    if (!fs.existsSync(getWorktreePath(REPO_ROOT, contract.contract_id))) {
      throw new Error("微基准 Worktree 未创建");
    }

    const destroyStart = process.hrtime.bigint();
    await orchestrator.abort(contract.contract_id, {
      reviewer: "local-user",
      reason: "worktree 微基准收尾",
    });
    destroyed.push(ms(destroyStart));
    if (fs.existsSync(getWorktreePath(REPO_ROOT, contract.contract_id))) {
      throw new Error("微基准 Worktree 未清理");
    }
  }

  console.log(
    JSON.stringify(
      {
        iterations: ITERATIONS,
        worktree_create_ms: { samples: created, mean: mean(created) },
        worktree_destroy_ms: { samples: destroyed, mean: mean(destroyed) },
        note: "含依赖视图挂载（共享 node_modules symlink）与 PID 锁；未安装依赖",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(`[worktree-bench] 失败：${(err as Error).message}`);
  process.exit(1);
});

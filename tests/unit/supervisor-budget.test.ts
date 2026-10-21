import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CostMonitor,
  E_BUDGET_EXCEEDED,
} from "../../daemon/guard/cost-monitor";
import {
  DEFAULT_SUPERVISOR_DAILY_BUDGET,
  SUPERVISOR_BUDGET_ERROR_CODE,
  SUPERVISOR_BUDGET_FILE_REL,
  SupervisorBudgetLedger,
} from "../../daemon/supervisor/budget";
import type { CostLimits } from "../../src/lib/contract.schema";

/**
 * TASK-S.1 核心目标 4：Supervisor **独立**预算分账（v1.3.3 修订口径）。
 *
 * PASS 判据（A §2 / v1.3.3 §S.1）：
 * - Supervisor 用量写入 `.stagent/supervisor-budget.json`，**不计入** Worker 合同账本；
 * - Supervisor 预算耗尽只挡自己的模型调用，Worker 继续执行与记账；
 * - 累计值跨实例（同 statePath）保持，不因重启清零。
 *
 * 历史说明：v1.3.3 之前本套件断言的是"共享合同账本"（旧口径），
 * 与分账要求冲突，已随实现一并改为「Worker 账本零污染」口径。
 */

const tmpDirs: string[] = [];

function newRepoDir(): string {
  const root = path.join(process.cwd(), ".tmp", "unit-supervisor");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "budget-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 沙箱可能拦截 unlink
    }
  }
});

function workerLedger(repo: string, maxTotalTokens = 10_000): CostMonitor {
  return new CostMonitor({
    maxTotalTokens,
    statePath: path.join(repo, ".stagent", "guard", "cost.json"),
  });
}

describe("Supervisor 独立预算账本（分账）", () => {
  it("Supervisor 用量只进独立账本，Worker 合同账本零污染", async () => {
    const repo = newRepoDir();
    const worker = workerLedger(repo);
    worker.recordUsage(1_000, 500); // Worker 已用 1500

    const budget = SupervisorBudgetLedger.independent({
      repoRoot: repo,
      maxTotalTokens: 10_000,
    });
    const outcome = await budget.runModelCall({
      prospective: { input_tokens: 800, output_tokens: 400 },
      call: async () => ({
        result: { suggestions: [] },
        input_tokens: 700,
        output_tokens: 300,
      }),
    });

    expect(outcome.result).toEqual({ suggestions: [] });
    expect(outcome.usage.metadata).toMatchObject({ agent: "supervisor" });

    // 账本必须是两个不同实例
    expect(budget.costMonitor).not.toBe(worker);
    // Supervisor 自己的账本：1000
    expect(budget.snapshot().total_tokens).toBe(1_000);
    // Worker 账本：仍为 1500，没有被 Supervisor 的 1000 污染
    expect(worker.getTotals().totalTokens).toBe(1_500);
  });

  it("独立账本落盘到 .stagent/supervisor-budget.json，并跨实例保持累计", async () => {
    const repo = newRepoDir();
    const budget = SupervisorBudgetLedger.independent({ repoRoot: repo });
    await budget.runModelCall({
      call: async () => ({
        result: "ok",
        input_tokens: 120,
        output_tokens: 80,
      }),
    });

    const statePath = path.join(repo, ...SUPERVISOR_BUDGET_FILE_REL.split("/"));
    expect(fs.existsSync(statePath)).toBe(true);

    // 模拟 Daemon 重启：新实例读同一文件
    const restarted = SupervisorBudgetLedger.independent({ repoRoot: repo });
    expect(restarted.snapshot().total_tokens).toBe(200);
    expect(restarted.isBlocked()).toBe(false);
  });

  it("默认独立日预算按常量生效（不读取合同额度）", () => {
    const repo = newRepoDir();
    const snapshot = SupervisorBudgetLedger.independent({
      repoRoot: repo,
    }).snapshot();

    expect(snapshot.max_total_tokens).toBe(
      DEFAULT_SUPERVISOR_DAILY_BUDGET.maxTotalTokens,
    );
    expect(snapshot.max_cost_minor_units).toBe(
      DEFAULT_SUPERVISOR_DAILY_BUDGET.maxCostMinorUnits,
    );
    expect(snapshot.currency).toBe(DEFAULT_SUPERVISOR_DAILY_BUDGET.currency);
  });

  it("Supervisor 熔断只挡自己：模型调用被拒，Worker 仍可继续记账", async () => {
    const repo = newRepoDir();
    const budget = SupervisorBudgetLedger.independent({
      repoRoot: repo,
      maxTotalTokens: 100,
    });
    // 用满额度 → 熔断
    await budget.runModelCall({
      call: async () => ({
        result: "first",
        input_tokens: 60,
        output_tokens: 40,
      }),
    });
    expect(budget.isBlocked()).toBe(true);

    const call = vi.fn(async () => ({
      result: "never",
      input_tokens: 1,
      output_tokens: 1,
    }));
    await expect(budget.runModelCall({ call })).rejects.toMatchObject({
      code: E_BUDGET_EXCEEDED,
    });
    expect(call).not.toHaveBeenCalled();

    // Worker 侧完全不受影响：账本未熔断，还能继续累计
    const worker = workerLedger(repo, 10_000);
    expect(worker.isTripped()).toBe(false);
    worker.recordUsage(1_000, 1_000);
    expect(worker.getTotals().totalTokens).toBe(2_000);
    // 且 Worker 账本里没有 Supervisor 那 100
    expect(worker.getTotals().totalTokens).not.toBe(2_100);
  });

  it("前置校验对超额预估立即抛错，且不改变累计值", () => {
    const budget = new SupervisorBudgetLedger({
      ledger: new CostMonitor({ maxTotalTokens: 500 }),
    });
    budget.costMonitor.recordUsage(200, 100);

    expect(() => budget.assertCanCallModel(100, 100)).not.toThrow();
    expect(() => budget.assertCanCallModel(300, 100)).toThrow(
      expect.objectContaining({ code: E_BUDGET_EXCEEDED }),
    );
    expect(budget.snapshot().total_tokens).toBe(300);
  });

  it("按给定上限构造独立账本：分列上限折算为合计上限并按币种记账", () => {
    const repo = newRepoDir();
    const limits: CostLimits = {
      max_input_tokens: 120_000,
      max_output_tokens: 30_000,
      max_cost_minor_units: 20_000,
      currency: "CNY",
      pricing_version: "unpriced-v0",
      accounting_mode: "ESTIMATED",
    };

    const budget = SupervisorBudgetLedger.fromCostLimits(limits, {
      contractId: "c-limits",
      statePath: path.join(repo, ...SUPERVISOR_BUDGET_FILE_REL.split("/")),
    });
    const snapshot = budget.snapshot();

    expect(snapshot.max_total_tokens).toBe(150_000);
    expect(snapshot.max_cost_minor_units).toBe(20_000);
    expect(snapshot.currency).toBe("CNY");
    expect(snapshot.contract_id).toBe("c-limits");
    expect(snapshot.tripped).toBe(false);
    expect(snapshot.remaining_tokens).toBe(150_000);
  });

  it("缺一项 token 上限时只保留金额熔断（不臆造合计上限）", () => {
    const budget = SupervisorBudgetLedger.fromCostLimits({
      max_input_tokens: 10_000,
      max_cost_minor_units: 5_000,
      currency: "CNY",
      pricing_version: "unpriced-v0",
      accounting_mode: "ESTIMATED",
    });

    expect(budget.snapshot().max_total_tokens).toBeUndefined();
    expect(budget.snapshot().max_cost_minor_units).toBe(5_000);
    expect(SUPERVISOR_BUDGET_ERROR_CODE).toBe("E_BUDGET_EXCEEDED");
  });
});

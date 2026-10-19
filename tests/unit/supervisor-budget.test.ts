import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CostMonitor,
  E_BUDGET_EXCEEDED,
} from "../../daemon/guard/cost-monitor";
import {
  SUPERVISOR_BUDGET_ERROR_CODE,
  SupervisorBudgetLedger,
} from "../../daemon/supervisor/budget";
import type { CostLimits } from "../../src/lib/contract.schema";

/**
 * TASK-S.1 共享预算控制。
 *
 * PASS 判据：Supervisor 的 Token/开销计入**当前合同账本**；
 * 达到 `cost_limits` 后模型调用在发起前即被拒绝（E_BUDGET_EXCEEDED），
 * 且累计值跨实例（同 statePath）保持一致，不因重启清零。
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

describe("Supervisor 共享预算账本", () => {
  it("Worker 已用额度计入同一账本，Supervisor 预估超额时调用前即阻断", async () => {
    const repo = newRepoDir();
    const statePath = path.join(repo, ".stagent", "guard", "cost.json");
    const ledger = new CostMonitor({ maxTotalTokens: 1000, statePath });
    ledger.recordUsage(400, 400); // Worker 已消耗 800

    const budget = new SupervisorBudgetLedger({
      ledger,
      contractId: "c-shared",
    });
    const call = vi.fn(async () => ({
      result: "ok",
      input_tokens: 100,
      output_tokens: 100,
    }));

    await expect(
      budget.runModelCall({
        prospective: { input_tokens: 150, output_tokens: 100 },
        call,
      }),
    ).rejects.toMatchObject({ code: E_BUDGET_EXCEEDED });

    expect(call).not.toHaveBeenCalled();
    expect(ledger.getTotals().totalTokens).toBe(800);
  });

  it("预算内调用成功，并把 Supervisor 用量写回同一合同账本", async () => {
    const repo = newRepoDir();
    const statePath = path.join(repo, ".stagent", "guard", "cost.json");
    const ledger = new CostMonitor({ maxTotalTokens: 10_000, statePath });
    ledger.recordUsage(1_000, 500);

    const budget = new SupervisorBudgetLedger({
      ledger,
      contractId: "c-shared",
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
    expect(outcome.usage.inputTokens).toBe(700);
    expect(outcome.usage.metadata).toMatchObject({
      agent: "supervisor",
      contract_id: "c-shared",
    });
    // 合同账本 = Worker 1500 + Supervisor 1000
    expect(ledger.getTotals().totalTokens).toBe(2_500);

    // 同一 statePath 的新实例（模拟 Daemon 重启）读到同一累计值
    const restarted = new SupervisorBudgetLedger({
      ledger: new CostMonitor({ maxTotalTokens: 10_000, statePath }),
      contractId: "c-shared",
    });
    expect(restarted.snapshot().total_tokens).toBe(2_500);
    expect(restarted.isBlocked()).toBe(false);
  });

  it("金额上限触发熔断后拒绝模型调用，且异常码为 E_BUDGET_EXCEEDED", async () => {
    const repo = newRepoDir();
    const ledger = new CostMonitor({
      maxCostUsd: 0.001,
      statePath: path.join(repo, "cost.json"),
    });
    ledger.recordUsage(1_000, 1_000); // 约 $0.018，已超限

    const budget = new SupervisorBudgetLedger({
      ledger,
      contractId: "c-cost",
    });
    expect(budget.isBlocked()).toBe(true);

    const call = vi.fn(async () => ({
      result: "never",
      input_tokens: 1,
      output_tokens: 1,
    }));

    await expect(budget.runModelCall({ call })).rejects.toMatchObject({
      code: E_BUDGET_EXCEEDED,
      name: "CostCapExceededError",
    });
    expect(call).not.toHaveBeenCalled();
    expect(SUPERVISOR_BUDGET_ERROR_CODE).toBe("E_BUDGET_EXCEEDED");
  });

  it("前置校验 assertCanCallModel 对超额预估立即抛错（不改变累计值）", () => {
    const ledger = new CostMonitor({ maxTotalTokens: 500 });
    ledger.recordUsage(200, 100);
    const budget = new SupervisorBudgetLedger({ ledger });

    expect(() => budget.assertCanCallModel(100, 100)).not.toThrow();
    expect(() => budget.assertCanCallModel(300, 100)).toThrow(
      expect.objectContaining({ code: E_BUDGET_EXCEEDED }),
    );
    expect(ledger.getTotals().totalTokens).toBe(300);
  });

  it("由合同 cost_limits 构造账本：分列上限折算为合计上限并按币种记账", () => {
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
  });
});

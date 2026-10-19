import {
  CostMonitor,
  E_BUDGET_EXCEEDED,
  type CostRecord,
} from "../guard/cost-monitor";
import type { CostLimits } from "../../src/lib/contract.schema";

/**
 * Supervisor 共享预算账本（TASK-S.1 / G-09）。
 *
 * 规范 A §2：任何 Agent 达到合同总上限后不得再发模型调用；
 * 规范 A §9.1：Supervisor 的开销必须计入**当前合同**账本，不得游离在 Worker 预算之外。
 *
 * 因此本模块不自建账本，而是复用 `daemon/guard/cost-monitor.ts` 的 `CostMonitor`
 * 实例（与合同编排共用同一个累计值与持久化文件）：
 * - `assertCanCallModel()` 在调用模型前做前置校验（含「已熔断」快速失败）；
 * - `runModelCall()` 先校验、再执行、最后把实际用量写回同一账本，
 *   超额时在 `call` 之前抛 `E_BUDGET_EXCEEDED`，模型调用根本不会发生；
 * - 账本持久化由 `CostMonitor.statePath` 负责，重启不清零（G-09 断言）。
 */

export interface SupervisorBudgetOptions {
  /** 合同共享账本（同一实例 / 同一 statePath 即为同一账本） */
  ledger: CostMonitor;
  contractId?: string | undefined;
}

/** 一次模型调用的实际用量（由调用方回填） */
export interface SupervisorModelCall<T> {
  result: T;
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number | undefined;
}

export interface SupervisorCallOutcome<T> {
  result: T;
  usage: CostRecord;
}

export interface SupervisorBudgetSnapshot {
  contract_id?: string | undefined;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_minor_units: number;
  currency: string;
  max_total_tokens?: number | undefined;
  max_cost_minor_units?: number | undefined;
  tripped: boolean;
  remaining_tokens?: number | undefined;
}

export class SupervisorBudgetLedger {
  private readonly ledger: CostMonitor;
  private readonly contractId?: string | undefined;

  constructor(options: SupervisorBudgetOptions) {
    this.ledger = options.ledger;
    this.contractId = options.contractId;
  }

  /** 底层共享账本（合同编排可读取同一累计值） */
  get costMonitor(): CostMonitor {
    return this.ledger;
  }

  get contract_id(): string | undefined {
    return this.contractId;
  }

  isBlocked(): boolean {
    return this.ledger.isTripped();
  }

  snapshot(): SupervisorBudgetSnapshot {
    const totals = this.ledger.getTotals();
    const remaining =
      totals.maxTotalTokens === undefined
        ? undefined
        : Math.max(0, totals.maxTotalTokens - totals.totalTokens);
    return {
      total_tokens: totals.totalTokens,
      input_tokens: totals.inputTokens,
      output_tokens: totals.outputTokens,
      cost_minor_units: totals.totalCostMinorUnits,
      currency: totals.currency,
      tripped: totals.tripped,
      ...(this.contractId === undefined
        ? {}
        : { contract_id: this.contractId }),
      ...(totals.maxTotalTokens === undefined
        ? {}
        : { max_total_tokens: totals.maxTotalTokens }),
      ...(totals.maxCostMinorUnits === undefined
        ? {}
        : { max_cost_minor_units: totals.maxCostMinorUnits }),
      ...(remaining === undefined ? {} : { remaining_tokens: remaining }),
    };
  }

  /**
   * 模型调用前置校验：已熔断或本次预估将超额时抛 `E_BUDGET_EXCEEDED`。
   * 异常类型与 Worker 侧完全一致（`CostCapExceededError`），上层按 `code` 统一处理。
   */
  assertCanCallModel(
    prospectiveInputTokens = 0,
    prospectiveOutputTokens = 0,
  ): void {
    this.ledger.assertCanConsume(
      prospectiveInputTokens,
      prospectiveOutputTokens,
    );
  }

  /**
   * 受预算约束的模型调用：
   * 1. 调用前校验（超额 → 抛错，`call` 不会执行）；
   * 2. 执行模型调用；
   * 3. 把实际用量写回**同一**合同账本（metadata 标记 agent=supervisor）。
   */
  async runModelCall<T>(params: {
    call: () => Promise<SupervisorModelCall<T>> | SupervisorModelCall<T>;
    prospective?: { input_tokens?: number; output_tokens?: number } | undefined;
  }): Promise<SupervisorCallOutcome<T>> {
    this.assertCanCallModel(
      params.prospective?.input_tokens ?? 0,
      params.prospective?.output_tokens ?? 0,
    );

    const outcome = await params.call();

    const usage = this.ledger.recordUsage(
      outcome.input_tokens,
      outcome.output_tokens,
      outcome.cost_usd,
      {
        agent: "supervisor",
        ...(this.contractId === undefined
          ? {}
          : { contract_id: this.contractId }),
      },
    );

    return { result: outcome.result, usage };
  }

  /**
   * 由合同 `cost_limits` 构造独立账本（不指定 statePath 时为纯内存账本）。
   * 生产路径应传入与 Worker 相同的 `statePath`，从而共享同一份累计值。
   *
   * 说明：合同分别声明 input/output 上限，而 `CostMonitor` 只支持合计上限，
   * 因此仅在两者同时存在时取合计；缺一即不设 token 上限（金额上限仍然生效）。
   */
  static fromCostLimits(
    limits: CostLimits,
    options: {
      contractId?: string | undefined;
      statePath?: string | undefined;
    } = {},
  ): SupervisorBudgetLedger {
    const maxTotalTokens =
      limits.max_input_tokens !== undefined &&
      limits.max_output_tokens !== undefined
        ? limits.max_input_tokens + limits.max_output_tokens
        : undefined;

    const ledger = new CostMonitor({
      maxCostMinorUnits: limits.max_cost_minor_units,
      currency: limits.currency,
      ...(maxTotalTokens === undefined ? {} : { maxTotalTokens }),
      ...(options.statePath === undefined
        ? {}
        : { statePath: options.statePath }),
    });

    return new SupervisorBudgetLedger({
      ledger,
      ...(options.contractId === undefined
        ? {}
        : { contractId: options.contractId }),
    });
  }
}

/** 预算耗尽的标准错误码（与 §9.3 一致，便于上层统一判定） */
export const SUPERVISOR_BUDGET_ERROR_CODE = E_BUDGET_EXCEEDED;

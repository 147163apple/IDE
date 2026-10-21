import fs from "node:fs";
import path from "node:path";
import {
  CostMonitor,
  E_BUDGET_EXCEEDED,
  type CostRecord,
} from "../guard/cost-monitor";
import type { CostLimits } from "../../src/lib/contract.schema";

/**
 * Supervisor 独立预算账本（TASK-S.1 核心目标 4 / G-09 / v1.3.3 修订）。
 *
 * 规范 A §2 与 v1.3.3 §S.1：「Supervisor 拥有独立日预算
 * （`.stagent/supervisor-budget.json`），**不再计入当前合同账本**；
 * Supervisor 预算耗尽不影响 Worker 执行；Worker 合同账本不得含 Supervisor 用量。」
 *
 * 因此本模块**自建**一个 `CostMonitor`（独立 `statePath`），与合同编排用的
 * Worker 账本是两个不同实例、两份不同文件：
 * - `assertCanCallModel()` 在调用模型前做前置校验（含「已熔断」快速失败）；
 * - `runModelCall()` 先校验、再执行、最后把实际用量写回**本账本**；
 *   超额时在 `call` 之前抛 `E_BUDGET_EXCEEDED`，模型调用根本不会发生；
 * - 两个账本互不读写：Supervisor 熔断只挡 Supervisor 的模型调用，
 *   Worker 的合同执行与记账照常（反之亦然）。
 *
 * 历史说明：v1.3.3 之前本模块复用合同的同一个 `CostMonitor` 实例（"共享账本"），
 * 与修订后的分账要求冲突，已改为独立账本；`tests/unit/supervisor-budget.test.ts`
 * 以「Worker 账本零污染」为断言口径重写。
 */

/** Supervisor 独立日预算的落盘位置（仓库相对路径） */
export const SUPERVISOR_BUDGET_FILE_REL = ".stagent/supervisor-budget.json";

/**
 * 独立日预算默认额度（与合同额度完全解耦）。
 * 200k tokens / 50.00 CNY 对"按需生成草案"这一用途足够宽裕，
 * 又能在模型失控循环时及早熔断。
 */
export const DEFAULT_SUPERVISOR_DAILY_BUDGET = {
  maxTotalTokens: 200_000,
  maxCostMinorUnits: 5_000,
  currency: "CNY",
} as const;

export interface SupervisorBudgetOptions {
  /**
   * Supervisor 自己的账本（**不得**传入 Worker / 合同的账本实例，
   * 否则重新引入混账；需要自动创建时用 {@link SupervisorBudgetLedger.independent}）。
   */
  ledger: CostMonitor;
  /** 仅作标注（界面上归属哪个合同），不参与记账 */
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

  /**
   * 底层 `CostMonitor`（**Supervisor 自己的**那份，供只读快照/诊断使用）。
   * 切勿把它交给 Worker 的合同编排去记账，否则又变成混账。
   */
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
   * 3. 把实际用量写回**本 Supervisor 账本**（metadata 标记 agent=supervisor），
   *    不触碰 Worker 的合同账本。
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
   * 创建 Supervisor 的**独立**账本：落盘到 `<repoRoot>/.stagent/supervisor-budget.json`。
   * 这是生产路径唯一应当使用的入口——它保证与 Worker 账本（通常是
   * `.stagent/guard/cost.json`）是两个文件、两份累计值。
   *
   * 默认额度来自 {@link DEFAULT_SUPERVISOR_DAILY_BUDGET}（独立日预算），
   * 可按部署配置覆盖；**不读取合同 `cost_limits`**，避免"合同额度决定
   * Supervisor 能否思考"的反向耦合。
   */
  static independent(options: {
    repoRoot: string;
    maxTotalTokens?: number | undefined;
    maxCostMinorUnits?: number | undefined;
    currency?: string | undefined;
    contractId?: string | undefined;
  }): SupervisorBudgetLedger {
    const statePath = path.join(
      options.repoRoot,
      ...SUPERVISOR_BUDGET_FILE_REL.split("/"),
    );
    fs.mkdirSync(path.dirname(statePath), { recursive: true });

    const ledger = new CostMonitor({
      maxTotalTokens:
        options.maxTotalTokens ??
        DEFAULT_SUPERVISOR_DAILY_BUDGET.maxTotalTokens,
      maxCostMinorUnits:
        options.maxCostMinorUnits ??
        DEFAULT_SUPERVISOR_DAILY_BUDGET.maxCostMinorUnits,
      currency: options.currency ?? DEFAULT_SUPERVISOR_DAILY_BUDGET.currency,
      statePath,
    });

    return new SupervisorBudgetLedger({
      ledger,
      ...(options.contractId === undefined
        ? {}
        : { contractId: options.contractId }),
    });
  }

  /**
   * 按给定上限构造 Supervisor 独立账本（测试 / 自定义额度用）。
   * `statePath` 必须是 Supervisor 自己的文件；缺省时为纯内存账本。
   *
   * ⚠️ 生产路径请用 {@link SupervisorBudgetLedger.independent}：本方法接收
   * `CostLimits`（合同里的额度形状），若把合同 `cost_limits` 直接灌进来，
   * 就等于让"合同额度"决定"Supervisor 能不能思考"，是 v1.3.3 明确要避免的
   * 反向耦合。保留它是为了测试里方便指定上限。
   */
  static fromCostLimits(
    limits: CostLimits,
    options: {
      contractId?: string | undefined;
      statePath?: string | undefined;
    } = {},
  ): SupervisorBudgetLedger {
    // 合同分别声明 input/output 上限，而 `CostMonitor` 只支持合计上限，
    // 因此仅在两者同时存在时取合计；缺一即不设 token 上限（金额上限仍然生效），
    // 不臆造数字。
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

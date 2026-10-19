import { readStateFile, writeStateFile } from "./state-store";

/** §9.3：预算/费用熔断错误码 */
export const E_BUDGET_EXCEEDED = "E_BUDGET_EXCEEDED";
/** 兼容旧命名（v0.1 早期实现） */
export const E_COST_CAP_EXCEEDED = E_BUDGET_EXCEEDED;

export class CostCapExceededError extends Error {
  readonly code: string = E_BUDGET_EXCEEDED;
  readonly currentCostUsd: number;
  readonly maxCostUsd?: number | undefined;
  readonly currentTokens: number;
  readonly maxTokens?: number | undefined;

  constructor(
    message: string,
    currentCostUsd: number,
    maxCostUsd: number | undefined,
    currentTokens: number,
    maxTokens: number | undefined,
  ) {
    super(`[${E_BUDGET_EXCEEDED}] ${message}`);
    this.name = "CostCapExceededError";
    this.currentCostUsd = currentCostUsd;
    this.maxCostUsd = maxCostUsd;
    this.currentTokens = currentTokens;
    this.maxTokens = maxTokens;
  }
}

export interface ModelPricing {
  /** Cost in USD per 1M input tokens (default $3.00) */
  inputCostPerMillion: number;
  /** Cost in USD per 1M output tokens (default $15.00) */
  outputCostPerMillion: number;
}

export const DEFAULT_MODEL_PRICING: ModelPricing = {
  inputCostPerMillion: 3.0,
  outputCostPerMillion: 15.0,
};

export interface CostRecord {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface CostMonitorOptions {
  maxTotalTokens?: number | undefined;
  maxCostUsd?: number | undefined;
  /** 规范 §9.1：以最小货币单位定义的硬上限（优先于 maxCostUsd） */
  maxCostMinorUnits?: number | undefined;
  /** ISO 4217 币种，例如 CNY / USD */
  currency?: string | undefined;
  pricing?: ModelPricing | undefined;
  /** 持久化路径；提供后重启不重置累计（TASK-A.5 PASS-3） */
  statePath?: string | undefined;
}

interface PersistedCostState {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  records: CostRecord[];
  tripped: boolean;
}

/**
 * Tracks token and financial consumption for a contract run and enforces hard cost caps.
 * 支持多币种最小单位上限，并可持久化以防重启重置。
 */
export class CostMonitor {
  private readonly maxTotalTokens?: number | undefined;
  private readonly maxCostUsd?: number | undefined;
  private readonly maxCostMinorUnits?: number | undefined;
  private readonly currency: string;
  private readonly pricing: ModelPricing;
  private readonly statePath?: string | undefined;

  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCostUsd = 0;
  private records: CostRecord[] = [];
  private tripped = false;

  constructor(options: CostMonitorOptions = {}) {
    this.maxTotalTokens = options.maxTotalTokens;
    this.maxCostUsd = options.maxCostUsd;
    this.maxCostMinorUnits = options.maxCostMinorUnits;
    this.currency = options.currency ?? "USD";
    this.pricing = options.pricing ?? DEFAULT_MODEL_PRICING;
    this.statePath = options.statePath;

    const persisted = readStateFile<PersistedCostState>(this.statePath);
    if (persisted) {
      this.totalInputTokens = persisted.totalInputTokens ?? 0;
      this.totalOutputTokens = persisted.totalOutputTokens ?? 0;
      this.totalCostUsd = persisted.totalCostUsd ?? 0;
      this.records = persisted.records ?? [];
      this.tripped = persisted.tripped ?? false;
      // 重启后按恢复的累计值重新判定是否已超限
      this.evaluateTrip();
    }
  }

  public getTotals() {
    return {
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      totalCostUsd: this.totalCostUsd,
      totalCostMinorUnits: this.toMinorUnits(this.totalCostUsd),
      currency: this.currency,
      maxCostUsd: this.maxCostUsd,
      maxCostMinorUnits: this.maxCostMinorUnits,
      maxTotalTokens: this.maxTotalTokens,
      tripped: this.tripped,
    };
  }

  public isTripped(): boolean {
    return this.tripped;
  }

  public getRecords(): readonly CostRecord[] {
    return this.records;
  }

  /** 将美元计价的累计成本折算为最小货币单位（×100） */
  private toMinorUnits(costUsd: number): number {
    return Math.round(costUsd * 100);
  }

  private limitLabel(): string {
    if (this.maxCostMinorUnits !== undefined) {
      return `${this.maxCostMinorUnits} ${this.currency} minor units`;
    }
    return this.maxCostUsd !== undefined ? `$${this.maxCostUsd}` : "unlimited";
  }

  private evaluateTrip(): void {
    const totalTokens = this.totalInputTokens + this.totalOutputTokens;
    if (
      this.maxTotalTokens !== undefined &&
      totalTokens >= this.maxTotalTokens
    ) {
      this.tripped = true;
    }
    if (
      this.maxCostMinorUnits !== undefined &&
      this.toMinorUnits(this.totalCostUsd) >= this.maxCostMinorUnits
    ) {
      this.tripped = true;
    }
    if (this.maxCostUsd !== undefined && this.totalCostUsd >= this.maxCostUsd) {
      this.tripped = true;
    }
  }

  /**
   * Calculate cost in USD for a given number of input and output tokens.
   */
  public calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost =
      (inputTokens / 1_000_000) * this.pricing.inputCostPerMillion;
    const outputCost =
      (outputTokens / 1_000_000) * this.pricing.outputCostPerMillion;
    return Number((inputCost + outputCost).toFixed(6));
  }

  /**
   * Asserts whether a prospective usage would exceed the cost/token cap.
   */
  public assertCanConsume(
    prospectiveInputTokens = 0,
    prospectiveOutputTokens = 0,
  ): void {
    if (this.tripped) {
      throw new CostCapExceededError(
        `Cost cap already tripped: $${this.totalCostUsd.toFixed(4)} consumed (limit: ${this.limitLabel()})`,
        this.totalCostUsd,
        this.maxCostUsd,
        this.totalInputTokens + this.totalOutputTokens,
        this.maxTotalTokens,
      );
    }

    const nextTokens =
      this.totalInputTokens +
      this.totalOutputTokens +
      prospectiveInputTokens +
      prospectiveOutputTokens;
    if (this.maxTotalTokens !== undefined && nextTokens > this.maxTotalTokens) {
      throw new CostCapExceededError(
        `Token limit would be exceeded: ${nextTokens} tokens > limit of ${this.maxTotalTokens}`,
        this.totalCostUsd,
        this.maxCostUsd,
        nextTokens,
        this.maxTotalTokens,
      );
    }

    const nextCost =
      this.totalCostUsd +
      this.calculateCost(prospectiveInputTokens, prospectiveOutputTokens);
    if (
      this.maxCostMinorUnits !== undefined &&
      this.toMinorUnits(nextCost) > this.maxCostMinorUnits
    ) {
      throw new CostCapExceededError(
        `Financial cost cap would be exceeded: ${this.toMinorUnits(nextCost)} > max allowed ${this.maxCostMinorUnits} ${this.currency} minor units`,
        nextCost,
        this.maxCostUsd,
        nextTokens,
        this.maxTotalTokens,
      );
    }
    if (this.maxCostUsd !== undefined && nextCost > this.maxCostUsd) {
      throw new CostCapExceededError(
        `Financial cost cap would be exceeded: estimated $${nextCost.toFixed(4)} > max allowed $${this.maxCostUsd.toFixed(4)}`,
        nextCost,
        this.maxCostUsd,
        nextTokens,
        this.maxTotalTokens,
      );
    }
  }

  /**
   * Records actual token consumption and updates financial metrics.
   */
  public recordUsage(
    inputTokens: number,
    outputTokens: number,
    explicitCostUsd?: number,
    metadata?: Record<string, unknown> | undefined,
  ): CostRecord {
    const cost =
      explicitCostUsd !== undefined
        ? explicitCostUsd
        : this.calculateCost(inputTokens, outputTokens);
    const totalTokens = inputTokens + outputTokens;

    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalCostUsd = Number((this.totalCostUsd + cost).toFixed(6));

    const record: CostRecord = {
      timestamp: new Date().toISOString(),
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd: cost,
      metadata,
    };
    this.records.push(record);

    this.evaluateTrip();
    this.persist();

    return record;
  }

  private persist(): void {
    writeStateFile(this.statePath, {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCostUsd: this.totalCostUsd,
      records: this.records,
      tripped: this.tripped,
    } satisfies PersistedCostState);
  }
}

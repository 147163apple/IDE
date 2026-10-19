import type { SoftwareContract } from "@/lib/contract.schema";

export interface BudgetVisualizerProps {
  /** UI 需展示 UNAVAILABLE（账单不可用），故在合同枚举基础上扩展 */
  costLimits: Omit<
    SoftwareContract["authorization"]["cost_limits"],
    "accounting_mode"
  > & { accounting_mode: "PROVIDER_REPORTED" | "ESTIMATED" | "UNAVAILABLE" };
  budgetLimits: SoftwareContract["authorization"]["budget_limits"];
  /** 已消耗（最小货币单位）；未知时传 undefined */
  consumedMinorUnits?: number | undefined;
  consumedTokens?: number | undefined;
}

/**
 * C.1 预算展示：Token/文件/时长/多币种费用。
 * 账单模式为 UNAVAILABLE 时必须给出明确警示（规范 FAIL 判据）。
 */
export function BudgetVisualizer({
  costLimits,
  budgetLimits,
  consumedMinorUnits,
  consumedTokens,
}: BudgetVisualizerProps) {
  const max = costLimits.max_cost_minor_units;
  const consumed = consumedMinorUnits ?? 0;
  const pct = max > 0 ? Math.min(100, Math.round((consumed / max) * 100)) : 0;
  const unavailable = costLimits.accounting_mode === "UNAVAILABLE";

  return (
    <section
      className="space-y-2 rounded border border-border/60 p-2"
      data-testid="budget-visualizer"
    >
      <header className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold">预算与硬上限</h4>
        <span className="text-[10px] text-muted-foreground">
          {costLimits.accounting_mode} · {costLimits.pricing_version}
        </span>
      </header>

      {unavailable && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600">
          ⚠ 账单模式不可用（UNAVAILABLE）：费用仅作上限约束，无法提供准确账单。
        </div>
      )}

      <div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>费用</span>
          <span>
            {consumed} / {max} {costLimits.currency}（最小单位）
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
          <div
            className={`h-full ${pct >= 100 ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-1 text-[10px]">
        <div>
          <dt className="text-muted-foreground">最大文件数</dt>
          <dd>{budgetLimits.max_file_modifications}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">最大 diff 行数</dt>
          <dd>{budgetLimits.max_total_diff_lines}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">任务总时长</dt>
          <dd>{budgetLimits.max_duration_seconds}s</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">验证重试上限</dt>
          <dd>{budgetLimits.max_verification_retries}</dd>
        </div>
        {consumedTokens !== undefined && (
          <div>
            <dt className="text-muted-foreground">已用 tokens</dt>
            <dd>{consumedTokens}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

import { useState } from "react";
import type { BossFastPathStepSummary } from "@/components/supervisor-view-model";

/**
 * TASK-C.8b：小事 Fast Path 老板三步台。
 *
 * 默认只露三步：「改哪里 / 要不要动保护 / 确认开改」。
 * 工程师合同细节（Scope glob、npm、Daemon、解锁暗号）放进可折叠「高级详情」，
 * **不删除**审计字段。不改 Fast Path 准入规则与状态机边。
 */
export interface BossFastPathDeskProps {
  summary: BossFastPathStepSummary;
  /** 标题旁小字，例如「小事 · 快速通道」 */
  badge?: string | undefined;
  busy?: boolean | undefined;
  /** 命中保护时，必须勾选才能点确认（保护不哑火） */
  onConfirm: () => void;
  /** 折叠区内的工程师合同台 / Scope / npm / Worker 等 */
  advanced?: React.ReactNode | undefined;
}

export function BossFastPathDesk(props: BossFastPathDeskProps) {
  const { summary } = props;
  const [protectionAck, setProtectionAck] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const needsAck = summary.touchesProtection;
  const canConfirm =
    props.busy !== true && (!needsAck || protectionAck === true);

  return (
    <div
      data-testid="boss-fastpath-desk"
      className="space-y-3 border-b border-border bg-card p-4 text-sm"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2
          data-testid="boss-fastpath-title"
          className="text-sm font-semibold text-foreground"
        >
          小事确认
        </h2>
        <span className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
          {props.badge ?? "快速通道 · 免整套 Demo"}
        </span>
      </header>

      <ol className="space-y-3" data-testid="boss-fastpath-steps">
        <li
          data-testid="boss-fastpath-step-where"
          className="rounded-lg border border-border bg-background p-3"
        >
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
            ① 改哪里
          </div>
          <div className="text-sm font-medium">{summary.whereLabel}</div>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {summary.wherePaths.map((path) => (
              <li key={path}>· {path}</li>
            ))}
          </ul>
        </li>

        <li
          data-testid="boss-fastpath-step-protection"
          data-touches={summary.touchesProtection ? "yes" : "no"}
          className="rounded-lg border border-border bg-background p-3"
        >
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
            ② 要不要动保护
          </div>
          {summary.touchesProtection ? (
            <>
              <p className="text-sm text-amber-800">
                是——会碰到受保护的
                {summary.protectionNames.length > 0
                  ? `「${summary.protectionNames.join("、")}」`
                  : "代码"}
                。开改前请确认。
              </p>
              {summary.protectionFiles.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                  {summary.protectionFiles.slice(0, 8).map((file) => (
                    <li key={file}>· {file}</li>
                  ))}
                </ul>
              )}
              <label className="mt-2 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  data-testid="boss-fastpath-protection-ack"
                  checked={protectionAck}
                  onChange={(e) => setProtectionAck(e.target.checked)}
                />
                <span>我知道会动到保护清单，仍要开改</span>
              </label>
            </>
          ) : (
            <p
              data-testid="boss-fastpath-protection-clear"
              className="text-sm text-emerald-800"
            >
              否——这次不动保护清单里的内容。
            </p>
          )}
        </li>

        <li
          data-testid="boss-fastpath-step-confirm"
          className="rounded-lg border border-emerald-600/40 bg-emerald-500/5 p-3"
        >
          <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
            ③ 确认开改
          </div>
          <button
            type="button"
            data-testid="boss-fastpath-confirm"
            disabled={!canConfirm}
            onClick={() => props.onConfirm()}
            className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
          >
            {props.busy === true ? "处理中…" : summary.confirmLabel}
          </button>
          {!canConfirm && needsAck && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              请先勾选第 ② 步，确认了解会动到保护清单。
            </p>
          )}
        </li>
      </ol>

      <div data-testid="boss-fastpath-advanced">
        <button
          type="button"
          data-testid="boss-fastpath-advanced-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {advancedOpen
            ? "收起高级详情"
            : "高级详情（Scope / 命令 / 工程师合同）"}
        </button>
        {advancedOpen && (
          <div
            data-testid="boss-fastpath-advanced-body"
            className="mt-2 space-y-3 border-t border-border pt-3"
          >
            {props.advanced ?? (
              <p className="text-xs text-muted-foreground">
                （本轮没有可展开的工程师细节）
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

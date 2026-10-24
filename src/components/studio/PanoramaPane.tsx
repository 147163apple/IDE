/**
 * TASK-C.10q：全景视角极薄摘要（v0.1）。
 *
 * 诚实边界：三张真全景图（项目功能脑图 / 用户旅程 / 业务概念）进 v0.2，
 * 本面板只读合同 intent / requirements 提示，**不**渲染施工绿灯。
 */

export interface PanoramaSummary {
  contractTitle?: string | null | undefined;
  contractDescription?: string | null | undefined;
  acceptanceCriteria?: readonly string[] | null | undefined;
  requirementsHint?: string | null | undefined;
  riskLevel?: string | null | undefined;
}

export interface PanoramaPaneProps {
  summary?: PanoramaSummary | null | undefined;
  /** 无图时引导去施工侧建图 */
  onGoConstruction?: (() => void) | undefined;
  onConfirmPrototype?: (() => void) | undefined;
  confirmPrototypeBusy?: boolean | undefined;
  hasGraph?: boolean | undefined;
}

export function PanoramaPane(props: PanoramaPaneProps) {
  const summary = props.summary ?? null;
  const title = summary?.contractTitle?.trim() || null;
  const description = summary?.contractDescription?.trim() || null;
  const criteria = summary?.acceptanceCriteria ?? [];
  const hint = summary?.requirementsHint?.trim() || null;
  const hasAny =
    Boolean(title) ||
    Boolean(description) ||
    criteria.length > 0 ||
    Boolean(hint);

  return (
    <div
      data-testid="panorama-pane"
      data-has-summary={hasAny ? "true" : "false"}
      className="flex h-full min-h-0 flex-col overflow-auto p-4"
    >
      <header className="mb-3 space-y-1">
        <h2 className="text-sm font-semibold text-foreground">项目功能清单</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          全景只回答「这个项目能干嘛」。真·业务脑图、用户旅程、业务概念图排在
          v0.2；现在先看合同里的白话摘要。这里
          <strong className="font-medium text-foreground">
            不会出现施工绿灯
          </strong>
          ——绿只能来自施工视角的核销。
        </p>
      </header>

      {hasAny ? (
        <section
          data-testid="panorama-contract-summary"
          className="mb-4 rounded-md border border-border bg-muted/30 p-3"
        >
          {title ? (
            <h3
              data-testid="panorama-contract-title"
              className="text-sm font-medium text-foreground"
            >
              {title}
            </h3>
          ) : null}
          {summary?.riskLevel ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              风险：{summary.riskLevel}
            </p>
          ) : null}
          {description ? (
            <p
              data-testid="panorama-contract-description"
              className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90"
            >
              {description}
            </p>
          ) : null}
          {hint ? (
            <p
              data-testid="panorama-requirements-hint"
              className="mt-2 text-[11px] text-muted-foreground"
            >
              需求提示：{hint}
            </p>
          ) : null}
          {criteria.length > 0 ? (
            <ul
              data-testid="panorama-acceptance-list"
              className="mt-2 list-disc space-y-1 pl-4 text-xs text-foreground/90"
            >
              {criteria.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <div
          data-testid="panorama-empty"
          className="mb-4 rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground"
        >
          <p className="font-medium text-foreground">还没有可展示的项目摘要</p>
          <p className="mt-2 leading-relaxed">
            左侧选一份合同，或先在右侧把需求聊清楚。全景不会假装已经有完整功能脑图。
          </p>
        </div>
      )}

      <section
        data-testid="panorama-v02-placeholders"
        className="space-y-2"
        aria-label="v0.2 全景图占位"
      >
        <PlaceholderCard
          testId="panorama-card-capability"
          title="业务功能脑图"
          body="进门即有的白话功能树（禁止技术词）。v0.2 再做自动总结。"
        />
        <PlaceholderCard
          testId="panorama-card-journey"
          title="用户旅程"
          body="主线怎么走（泳道，不含底层函数）。v0.2 按需展开。"
        />
        <PlaceholderCard
          testId="panorama-card-domain"
          title="业务概念图"
          body="系统里管了哪些资产、谁跟谁有关。v0.2 按需查看。"
        />
      </section>

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {props.onGoConstruction ? (
          <button
            type="button"
            data-testid="panorama-go-construction"
            onClick={props.onGoConstruction}
            className="rounded border px-2.5 py-1 text-xs hover:bg-accent/60"
          >
            去看施工进度
          </button>
        ) : null}
        {!props.hasGraph && props.onConfirmPrototype ? (
          <button
            type="button"
            data-testid="panorama-confirm-cta"
            disabled={props.confirmPrototypeBusy}
            aria-busy={props.confirmPrototypeBusy}
            onClick={props.onConfirmPrototype}
            className="rounded border border-emerald-600/40 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-70"
          >
            {props.confirmPrototypeBusy ? "正在建图…" : "确认原型并建图"}
          </button>
        ) : null}
      </footer>
    </div>
  );
}

function PlaceholderCard(props: {
  testId: string;
  title: string;
  body: string;
}) {
  return (
    <div
      data-testid={props.testId}
      className="rounded-md border border-dashed border-border/80 bg-background px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          {props.title}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          v0.2
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {props.body}
      </p>
    </div>
  );
}

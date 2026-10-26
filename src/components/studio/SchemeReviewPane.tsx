/**
 * TASK-C.18：中间「方案审阅」单页。
 *
 * - 图表优先（mermaid 源码卡片；浏览器未接渲染器时仍可读）
 * - 冲突抉择 / AI 推荐决策确认
 * - 方案够完整才出现「生成 Demo」
 * - 最底只有「确认方案」（冻结 Spec → 开工）；无「继续澄清」按钮
 */

import type { SchemeDraft } from "@/lib/journey/scheme-draft";

export interface SchemeReviewPaneProps {
  scheme: SchemeDraft | null;
  demoUrl?: string | null | undefined;
  demoStatus?: string | null | undefined;
  demoBusy?: boolean | undefined;
  confirmBusy?: boolean | undefined;
  errorMessage?: string | null | undefined;
  onConfirmDecision?: ((decisionId: string) => void) | undefined;
  onResolveConflict?:
    | ((conflictId: string, optionId: string) => void)
    | undefined;
  onNotesChange?: ((notes: string) => void) | undefined;
  onGenerateDemo?: (() => void) | undefined;
  onConfirmScheme?: (() => void) | undefined;
}

function MermaidCard(props: { title: string; source: string; testId: string }) {
  if (!props.source.trim()) return null;
  return (
    <section
      data-testid={props.testId}
      className="rounded border border-border bg-card p-3"
    >
      <h3 className="mb-2 text-xs font-semibold text-foreground">
        {props.title}
      </h3>
      <pre className="overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-foreground">
        {props.source}
      </pre>
      <p className="mt-1 text-[10px] text-muted-foreground">
        （v0.1 先展示图表源码；后续可接 Mermaid 渲染）
      </p>
    </section>
  );
}

export function SchemeReviewPane(props: SchemeReviewPaneProps) {
  const scheme = props.scheme;
  const frozen = scheme?.frozen === true;
  const openConflicts =
    scheme?.conflicts.filter((c) => c.chosenId === null).length ?? 0;
  const canConfirm =
    Boolean(scheme) &&
    !frozen &&
    openConflicts === 0 &&
    (scheme?.completeness ?? 0) >= 40 &&
    props.confirmBusy !== true;

  if (!scheme || (!scheme.title && scheme.modules.length === 0)) {
    return (
      <div
        data-testid="scheme-review-pane"
        data-empty="true"
        className="flex h-full min-h-0 flex-col overflow-auto p-4 text-sm"
      >
        <h2 className="text-sm font-semibold">方案审阅</h2>
        <p
          data-testid="scheme-empty"
          className="mt-3 text-xs leading-relaxed text-muted-foreground"
        >
          在右侧自由聊需求。Supervisor
          旁观足够后，这里会陆续出现架构图、流程、模块脑图和待你拍板的决策——不用做选择题剧本。
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="scheme-review-pane"
      data-frozen={frozen ? "true" : "false"}
      data-completeness={scheme.completeness}
      data-demo-ready={scheme.demoReady ? "true" : "false"}
      className="flex h-full min-h-0 flex-col overflow-auto p-4 text-sm"
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">方案审阅</h2>
        <span
          data-testid="scheme-completeness"
          className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          完整度 {scheme.completeness}%
        </span>
        {frozen ? (
          <span className="rounded bg-emerald-600/15 px-2 py-0.5 text-[10px] text-emerald-800">
            已确认 · Spec 已冻结
          </span>
        ) : null}
      </header>

      <section className="mb-3 rounded border border-border p-3">
        <h3
          data-testid="scheme-title"
          className="text-sm font-semibold text-foreground"
        >
          {scheme.title}
        </h3>
        <p
          data-testid="scheme-summary"
          className="mt-1 text-xs leading-relaxed text-muted-foreground"
        >
          {scheme.summary}
        </p>
        {scheme.modules.length > 0 ? (
          <ul
            data-testid="scheme-modules"
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {scheme.modules.map((m) => (
              <li
                key={m}
                className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
              >
                {m}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <MermaidCard
          title="架构示意"
          source={scheme.mermaidArchitecture}
          testId="scheme-mermaid-architecture"
        />
        <MermaidCard
          title="主流程"
          source={scheme.mermaidFlow}
          testId="scheme-mermaid-flow"
        />
      </div>
      <div className="mb-3">
        <MermaidCard
          title="功能业务模块脑图"
          source={scheme.mermaidMindmap}
          testId="scheme-mermaid-mindmap"
        />
      </div>

      {scheme.conflicts.length > 0 ? (
        <section
          data-testid="scheme-conflicts"
          className="mb-3 rounded border border-amber-700/40 bg-amber-500/10 p-3"
        >
          <h3 className="mb-2 text-xs font-semibold text-amber-950">
            需要你抉择的冲突（{openConflicts} 条未决）
          </h3>
          <ul className="space-y-3">
            {scheme.conflicts.map((c) => (
              <li key={c.id} data-testid="scheme-conflict-item">
                <p className="text-xs">{c.question}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.options.map((o) => {
                    const selected = c.chosenId === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        data-testid="scheme-conflict-option"
                        disabled={frozen}
                        data-selected={selected ? "true" : "false"}
                        onClick={() =>
                          props.onResolveConflict?.(c.id, o.id)
                        }
                        className={`rounded border px-2 py-1 text-[11px] disabled:opacity-40 ${
                          selected
                            ? "border-amber-800 bg-amber-600/20 font-medium"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {scheme.decisions.length > 0 ? (
        <section
          data-testid="scheme-decisions"
          className="mb-3 rounded border border-border p-3"
        >
          <h3 className="mb-2 text-xs font-semibold">
            AI 推荐决策（对话未明说时的默认，请确认）
          </h3>
          <ul className="space-y-2">
            {scheme.decisions.map((d) => (
              <li
                key={d.id}
                data-testid="scheme-decision-item"
                data-confirmed={d.confirmed ? "true" : "false"}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="text-muted-foreground">{d.label}</span>
                <span className="font-medium">{d.recommended}</span>
                {d.confirmed ? (
                  <span className="text-[10px] text-emerald-700">已确认</span>
                ) : (
                  <button
                    type="button"
                    data-testid="scheme-decision-confirm"
                    disabled={frozen}
                    onClick={() => props.onConfirmDecision?.(d.id)}
                    className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-40"
                  >
                    采纳推荐
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-3 rounded border border-border p-3">
        <h3 className="mb-1.5 text-xs font-semibold">手改备注（可选）</h3>
        <textarea
          data-testid="scheme-notes"
          value={scheme.notes}
          disabled={frozen}
          onChange={(e) => props.onNotesChange?.(e.target.value)}
          rows={3}
          placeholder="可直接改方案细节；改完中间区会跟着更新。"
          className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs outline-none disabled:opacity-50"
        />
      </section>

      {props.errorMessage ? (
        <p
          data-testid="scheme-error"
          className="mb-2 text-xs text-destructive"
        >
          {props.errorMessage}
        </p>
      ) : null}

      {props.demoUrl ? (
        <section
          data-testid="scheme-demo-embed"
          className="mb-3 overflow-hidden rounded border border-border"
        >
          <div className="border-b border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
            Demo 预览 · {props.demoStatus ?? "READY"} · {props.demoUrl}
          </div>
          <iframe
            title="方案 Demo"
            src={props.demoUrl}
            className="h-56 w-full bg-background"
            sandbox="allow-scripts"
          />
        </section>
      ) : null}

      {/* Demo 是方案展示一部分：只在够完整时出现在方案区下方 */}
      {scheme.demoReady && !frozen ? (
        <div className="mb-3">
          <button
            type="button"
            data-testid="scheme-generate-demo"
            disabled={props.demoBusy === true}
            onClick={() => props.onGenerateDemo?.()}
            className="rounded border border-sky-700/50 bg-sky-600/90 px-3 py-1.5 text-xs text-white disabled:opacity-40"
          >
            {props.demoBusy ? "生成中…" : "生成 Demo"}
          </button>
        </div>
      ) : null}

      {/* 最底只有确认方案；无「继续澄清」 */}
      <div className="mt-auto border-t border-border pt-3">
        <button
          type="button"
          data-testid="scheme-confirm"
          disabled={!canConfirm}
          onClick={() => props.onConfirmScheme?.()}
          className="w-full rounded border border-emerald-800 bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {props.confirmBusy
            ? "冻结并开工中…"
            : frozen
              ? "方案已确认"
              : "确认方案"}
        </button>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          确认后冻结 Spec 并直接开工写代码。不满意请继续在右侧聊，或改上方备注——不会出现「继续澄清」按钮。
        </p>
      </div>
    </div>
  );
}

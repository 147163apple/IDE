/**
 * TASK-C.11c：白话合同卡——意图 / Scope 摘要 / 验收；一键授权、拒绝、改细节。
 * 签署前不得写真码（由上层门禁）；拒约默认留 Demo。
 */

export interface PlainContractAuthorizeView {
  contract_id: string;
  title: string;
  intent_summary: string;
  scope_summary: string;
  acceptance_summary: string;
  draft_version: string;
  /** 是否已感官确认 Demo（未确认时授权按钮可禁用） */
  demo_confirmed: boolean;
  lifecycle_hint?: string | undefined;
}

export interface PlainContractAuthorizeCardProps {
  view: PlainContractAuthorizeView;
  busy?: boolean | undefined;
  onAuthorize: () => void;
  onReject: () => void;
  onRevise: () => void;
}

export function PlainContractAuthorizeCard(
  props: PlainContractAuthorizeCardProps,
) {
  const { view, busy, onAuthorize, onReject, onRevise } = props;
  const canAuthorize = view.demo_confirmed && busy !== true;
  return (
    <section
      data-testid="plain-contract-authorize-card"
      data-contract-id={view.contract_id}
      data-draft-version={view.draft_version}
      className="rounded border border-emerald-700/40 bg-emerald-500/10 p-3 text-[11px] leading-relaxed"
    >
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-900/80">
          白话合同
        </span>
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {view.draft_version}
        </span>
        {view.lifecycle_hint ? (
          <span className="text-[10px] text-muted-foreground">
            {view.lifecycle_hint}
          </span>
        ) : null}
      </header>
      <h3 className="text-[13px] font-semibold text-foreground">
        {view.title}
      </h3>
      <dl className="mt-2 space-y-1.5">
        <div>
          <dt className="text-[10px] text-muted-foreground">要干什么</dt>
          <dd data-testid="plain-contract-intent">{view.intent_summary}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-muted-foreground">能改哪里</dt>
          <dd data-testid="plain-contract-scope">{view.scope_summary}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-muted-foreground">怎么算验收</dt>
          <dd data-testid="plain-contract-acceptance">
            {view.acceptance_summary}
          </dd>
        </div>
      </dl>
      {!view.demo_confirmed ? (
        <p
          data-testid="plain-contract-demo-gate"
          className="mt-2 text-[10px] text-amber-800"
        >
          请先在中间「原型试玩」点「确认 Demo」，感官对齐后再授权开工。
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="plain-contract-authorize"
          disabled={!canAuthorize}
          onClick={onAuthorize}
          className="rounded border border-emerald-700 bg-emerald-600/90 px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {busy ? "处理中…" : "一键授权"}
        </button>
        <button
          type="button"
          data-testid="plain-contract-reject"
          disabled={busy === true}
          onClick={onReject}
          className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-40"
        >
          拒绝（保留 Demo）
        </button>
        <button
          type="button"
          data-testid="plain-contract-revise"
          disabled={busy === true}
          onClick={onRevise}
          className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-40"
        >
          改细节
        </button>
      </div>
    </section>
  );
}

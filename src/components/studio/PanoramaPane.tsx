/**
 * TASK-C.10q + TASK-C.14b：全景视角。
 *
 * - 合同白话摘要（施工绿灯禁止出现在此）
 * - 项目现状基线档案（打开即扫 / 确认≠授权 / Dirty 管家黄标）
 * - v0.2 三卡占位
 */

import type { BaselineArchivePayload } from "@/lib/daemon-api";

export interface PanoramaSummary {
  contractTitle?: string | null | undefined;
  contractDescription?: string | null | undefined;
  acceptanceCriteria?: readonly string[] | null | undefined;
  requirementsHint?: string | null | undefined;
  riskLevel?: string | null | undefined;
}

export interface PanoramaPaneProps {
  summary?: PanoramaSummary | null | undefined;
  /** TASK-C.14：基线档案 */
  baseline?: BaselineArchivePayload | null | undefined;
  baselineBusy?: boolean | undefined;
  onAcceptBaseline?: (() => void) | undefined;
  onRescanBaseline?: (() => void) | undefined;
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

  const archive = props.baseline?.archive ?? null;
  const scanning =
    Boolean(props.baselineBusy) ||
    Boolean(props.baseline?.scanning) ||
    archive?.phase === "p0" ||
    archive?.phase === "p1" ||
    archive?.phase === "p2";
  const acceptLabel = props.baseline?.accept_label ?? "认可此基线作为后续参考";

  return (
    <div
      data-testid="panorama-pane"
      data-has-summary={hasAny ? "true" : "false"}
      data-baseline-phase={archive?.phase ?? "none"}
      className="flex h-full min-h-0 flex-col overflow-auto p-4"
    >
      <header className="mb-3 space-y-1">
        <h2 className="text-sm font-semibold text-foreground">项目功能清单</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          全景只回答「这个项目能干嘛」。真·业务脑图、用户旅程、业务概念图排在
          v0.2；现在先看合同里的白话摘要与项目现状基线。这里
          <strong className="font-medium text-foreground">
            不会出现施工绿灯
          </strong>
          ——绿只能来自施工视角的核销。
        </p>
      </header>

      <BaselineSection
        archive={archive}
        scanning={scanning}
        acceptLabel={acceptLabel}
        onAccept={props.onAcceptBaseline}
        onRescan={props.onRescanBaseline}
        acceptBusy={props.baselineBusy}
      />

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
      ) : !archive && !scanning ? (
        <div
          data-testid="panorama-empty"
          className="mb-4 rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground"
        >
          <p className="font-medium text-foreground">还没有可展示的项目摘要</p>
          <p className="mt-2 leading-relaxed">
            左侧选一份合同，或先在右侧把需求聊清楚。打开已有项目时会自动整理现状基线。
          </p>
        </div>
      ) : null}

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

type Archive = NonNullable<BaselineArchivePayload["archive"]>;

function BaselineSection(props: {
  archive: Archive | null;
  scanning: boolean;
  acceptLabel: string;
  onAccept?: (() => void) | undefined;
  onRescan?: (() => void) | undefined;
  acceptBusy?: boolean | undefined;
}) {
  const { archive } = props;
  if (!archive && !props.scanning) return null;

  const dirty = archive?.dirty;
  const showDirty = dirty && !dirty.clean && Boolean(dirty.steward_message);
  const nodes = [
    ...(archive?.deep?.capability_nodes ?? []),
    ...(archive?.deep?.structure_nodes ?? []).slice(0, 12),
  ];

  return (
    <section
      data-testid="panorama-baseline"
      data-review-status={archive?.review_status ?? "pending_review"}
      data-grants-construction="false"
      className="mb-4 rounded-md border border-border bg-background p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          项目现状基线档案
        </h3>
        <span
          data-testid="panorama-baseline-progress"
          className="text-[11px] text-muted-foreground"
        >
          {props.scanning
            ? archive?.progress_copy ||
              "正在为您安全探查项目结构（纯本地只读分析，不触碰线上业务）"
            : archive?.progress_copy ||
              "现状整理完成（观察结果，未经运行验证）"}
        </span>
      </div>

      <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
        观察 ≠ 质量结论；结构存在 ≠ 保证可用。认可基线
        <strong className="font-medium text-foreground">不会</strong>
        授权施工，也不会签发写权。
      </p>

      {showDirty ? (
        <div
          data-testid="panorama-baseline-dirty"
          role="status"
          className="mb-2 rounded border border-amber-400/50 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-950"
        >
          {dirty!.steward_message}
        </div>
      ) : null}

      {archive?.p0 ? (
        <div
          data-testid="panorama-baseline-p0"
          className="mb-2 space-y-1 text-xs text-foreground/90"
        >
          {archive.p0.package_name ? (
            <p>
              包名：{archive.p0.package_name}
              {archive.p0.package_version
                ? `@${archive.p0.package_version}`
                : ""}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            顶层：
            {(archive.p0.top_level_entries ?? []).slice(0, 12).join(" · ") ||
              "—"}
          </p>
          {(archive.p0.route_clues ?? []).length > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              路由线索：{archive.p0.route_clues.slice(0, 8).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : props.scanning ? (
        <p
          data-testid="panorama-baseline-scanning"
          className="mb-2 text-xs text-muted-foreground"
        >
          正在整理现状…
        </p>
      ) : null}

      {archive?.deep?.test_stat_note ? (
        <p
          data-testid="panorama-baseline-test-stat"
          className="mb-2 text-[11px] text-muted-foreground"
        >
          {archive.deep.test_stat_note}
        </p>
      ) : null}

      {nodes.length > 0 ? (
        <ul
          data-testid="panorama-baseline-nodes"
          className="mb-2 max-h-48 space-y-2 overflow-auto"
        >
          {nodes.slice(0, 24).map((node) => (
            <li
              key={node.id}
              data-testid="panorama-baseline-node"
              className="rounded border border-border/70 px-2 py-1.5"
            >
              <div className="text-xs font-medium text-foreground">
                {node.title}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                • {node.provenance_plain}
              </div>
              <div className="text-[11px] text-muted-foreground">
                • {node.status_plain}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {props.onAccept && archive && archive.review_status !== "accepted" ? (
          <button
            type="button"
            data-testid="panorama-baseline-accept"
            disabled={props.acceptBusy || props.scanning}
            onClick={props.onAccept}
            className="rounded border border-sky-600/40 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-950 hover:bg-sky-100 disabled:opacity-60"
          >
            {props.acceptLabel}
          </button>
        ) : null}
        {archive?.review_status === "accepted" ? (
          <span
            data-testid="panorama-baseline-accepted"
            className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground"
          >
            已认可为后续参考（未授权施工）
          </span>
        ) : null}
        {props.onRescan ? (
          <button
            type="button"
            data-testid="panorama-baseline-rescan"
            disabled={props.acceptBusy || props.scanning}
            onClick={props.onRescan}
            className="rounded border px-2.5 py-1 text-xs hover:bg-accent/60 disabled:opacity-60"
          >
            重新探查
          </button>
        ) : null}
      </div>
    </section>
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

import { realPlaytestIframeProps } from "@/lib/ipc/real-preview-origin";
import type { RealPlaytestLifecycleStatus } from "@/lib/ipc/frames";

/**
 * Studio 视口：真机预览（TASK-S.6b / 架构 §7.1 REAL_PLAYTEST）。
 *
 * 与 Demo 假页分离：这里挂真实预览 URL，并提供「在浏览器打开」外链。
 * 顶栏展示双门禁提示（主观试玩 + 客观证据），不替 Daemon 做合入判定。
 */
export interface RealPlaytestPaneProps {
  previewUrl?: string | null | undefined;
  status?: RealPlaytestLifecycleStatus | null | undefined;
  errorMessage?: string | null | undefined;
  /** 合同标题等白话上下文 */
  contractLabel?: string | null | undefined;
  busy?: boolean | undefined;
  onStart?: (() => void) | undefined;
  onStop?: (() => void) | undefined;
}

export function RealPlaytestPane(props: RealPlaytestPaneProps) {
  const url = props.previewUrl?.trim() || null;
  const status = props.status ?? null;
  const running = status === "RUNNING" && url !== null;

  return (
    <div
      data-testid="real-playtest-pane"
      data-status={status ?? "idle"}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-foreground">真机试玩</span>
        <span className="text-[11px] text-muted-foreground">
          {running
            ? "下面是真实跑起来的页面（不是假 Demo）"
            : status === "ERROR"
              ? "真机预览起不来"
              : status === "STOPPED"
                ? "真机预览已停止"
                : "还没有真机预览，点右侧启动即可"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {running && url ? (
            <a
              data-testid="real-playtest-open-external"
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              在浏览器打开
            </a>
          ) : null}
          {running ? (
            <button
              type="button"
              data-testid="real-playtest-stop"
              disabled={props.busy === true}
              onClick={() => props.onStop?.()}
              className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              停止预览
            </button>
          ) : (
            <button
              type="button"
              data-testid="real-playtest-start"
              disabled={props.busy === true}
              onClick={() => props.onStart?.()}
              className="rounded border border-emerald-600/50 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-800 disabled:opacity-40"
            >
              启动真机预览
            </button>
          )}
        </div>
      </div>

      <div
        data-testid="real-playtest-gates"
        className="border-b border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground"
      >
        <div>门禁 1 · 主观试玩：自己点点用用，确认符合预期且没有未决质疑</div>
        <div>门禁 2 · 客观证据：测试/检查通过后，才能安心点「确认合入」</div>
        {props.contractLabel ? (
          <div className="mt-1 text-foreground/80">
            当前：{props.contractLabel}
          </div>
        ) : null}
      </div>

      {status === "ERROR" && (
        <div
          data-testid="real-playtest-error"
          role="alert"
          className="border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {props.errorMessage?.trim() ||
            "真机预览启动失败。请检查端口 4200–4210，或换一个回环地址再试。"}
        </div>
      )}

      {running && url ? (
        <iframe
          data-testid="real-playtest-iframe"
          className="min-h-0 flex-1 border-0 bg-background"
          {...realPlaytestIframeProps(url)}
        />
      ) : (
        <div
          data-testid="real-playtest-empty"
          className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground"
        >
          <p>
            施工验收阶段这里会挂上真实页面。没有业务工程时，也可先启动一页试玩桩，确认中栏与外链都通。
          </p>
          <button
            type="button"
            data-testid="real-playtest-start-empty"
            disabled={props.busy === true}
            onClick={() => props.onStart?.()}
            className="rounded border border-emerald-600/50 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-800 disabled:opacity-40"
          >
            启动真机预览
          </button>
        </div>
      )}
    </div>
  );
}

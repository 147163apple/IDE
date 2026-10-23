import { demoIframeProps } from "@/lib/ipc/demo-origin";
import type { DemoPreviewLifecycleStatus } from "@/lib/ipc/frames";

/**
 * Studio 视口 1：Demo 原型试玩（TASK-C.2 / TASK-S.4）。
 *
 * 只消费 Daemon 广播的预览 URL，绝不自行拼端口或改写 sandbox。
 * iframe 仅 `allow-scripts`（无 `allow-same-origin`），与架构 §4.4 一致。
 */
export interface DemoPreviewPaneProps {
  /** 独立 Origin 地址；缺省时展示空态 */
  previewUrl?: string | null | undefined;
  status?: DemoPreviewLifecycleStatus | null | undefined;
  /** 预览失败时的白话原因 */
  errorMessage?: string | null | undefined;
  /** 【修改原型】——回到右栏继续聊；本组件不调 Daemon */
  onRevise?: (() => void) | undefined;
  /** 【确认原型并实施真实工程】——由上层推进旅程 */
  onConfirm?: (() => void) | undefined;
  busy?: boolean | undefined;
}

export function DemoPreviewPane(props: DemoPreviewPaneProps) {
  const url = props.previewUrl?.trim() || null;
  const status = props.status ?? null;
  const running = status === "RUNNING" && url !== null;

  return (
    <div
      data-testid="demo-preview-pane"
      data-status={status ?? "idle"}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-foreground">原型试玩</span>
        <span className="text-[11px] text-muted-foreground">
          {running
            ? "可在下方页面里点击、填写，体验组件联动"
            : status === "ERROR"
              ? "预览服务起不来"
              : status === "STOPPED"
                ? "预览已停止"
                : "还没有可试玩的原型"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="demo-revise"
            disabled={props.busy === true}
            onClick={() => props.onRevise?.()}
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            修改原型
          </button>
          <button
            type="button"
            data-testid="demo-confirm"
            disabled={props.busy === true || !running}
            onClick={() => props.onConfirm?.()}
            className="rounded border border-emerald-600/50 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-800 disabled:opacity-40"
          >
            确认原型并实施真实工程
          </button>
        </div>
      </div>

      {status === "ERROR" && (
        <div
          data-testid="demo-preview-error"
          role="alert"
          className="border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {props.errorMessage?.trim() ||
            "预览服务启动失败。请检查端口 4100–4110 是否被占用，或稍后重试。"}
        </div>
      )}

      {running ? (
        <iframe
          data-testid="demo-preview-iframe"
          className="min-h-0 flex-1 border-0 bg-background"
          {...demoIframeProps(url)}
        />
      ) : (
        <div
          data-testid="demo-preview-empty"
          className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground"
        >
          {status === "STOPPED"
            ? "原型预览已关闭。需要时让 Supervisor 重新生成并启动预览。"
            : "Supervisor 生成静态原型后，这里会出现可试玩的页面（独立端口，改不了你的项目）。"}
        </div>
      )}
    </div>
  );
}

/**
 * TASK-C.11d：越界挂起弹窗——拦当次 + PAUSED + 扩权 / 回滚（Top7#3）。
 * 禁止静默放行；禁止默认杀进程。
 */

export interface ScopePausedView {
  contract_id: string;
  code: string;
  message: string;
  attempted_path?: string | undefined;
}

export interface ScopePausedDialogProps {
  view: ScopePausedView | null | undefined;
  busy?: boolean | undefined;
  onExpandScope: () => void;
  onRollback: () => void;
  onDismiss?: (() => void) | undefined;
}

export function ScopePausedDialog(props: ScopePausedDialogProps) {
  const { view, busy, onExpandScope, onRollback, onDismiss } = props;
  if (!view) return null;
  return (
    <div
      data-testid="scope-paused-dialog"
      data-contract-id={view.contract_id}
      data-code={view.code}
      role="alertdialog"
      aria-label="任务已暂停：越界写入"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <section className="w-full max-w-md rounded-lg border border-amber-600/60 bg-background p-4 shadow-lg">
        <h2 className="text-sm font-semibold text-foreground">
          施工已暂停——想改合同外的地方
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">{view.message}</p>
        {view.attempted_path ? (
          <p
            data-testid="scope-paused-path"
            className="mt-1 font-mono text-[11px] text-amber-900"
          >
            {view.attempted_path}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground">
          现场已保留。请选择：扩权继续，或回滚本轮改动。不会静默放行，也不会直接杀掉整个进程。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="scope-paused-expand"
            disabled={busy === true}
            onClick={onExpandScope}
            className="rounded border border-amber-700 bg-amber-500/20 px-3 py-1.5 text-xs text-amber-950 disabled:opacity-40"
          >
            扩权继续
          </button>
          <button
            type="button"
            data-testid="scope-paused-rollback"
            disabled={busy === true}
            onClick={onRollback}
            className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            回滚本轮
          </button>
          {onDismiss ? (
            <button
              type="button"
              data-testid="scope-paused-dismiss"
              disabled={busy === true}
              onClick={onDismiss}
              className="ml-auto rounded border border-transparent px-2 py-1.5 text-xs text-muted-foreground"
            >
              稍后处理
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

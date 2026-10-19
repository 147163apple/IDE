import { useState } from "react";
import { openEditor } from "@/lib/daemon-api";
import type { DaemonConnection } from "@/lib/daemon-api";

export interface EditorOpenerProps {
  conn: DaemonConnection;
  contractId: string;
}

/**
 * C.3 外部编辑器调起：成功则提示命令，失败（未安装 cursor）降级为复制 Worktree 路径。
 */
export function EditorOpener({ conn, contractId }: EditorOpenerProps) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "opened"; command: string }
    | { kind: "fallback"; worktreePath: string; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  const handleOpen = async () => {
    setState({ kind: "busy" });
    try {
      const result = await openEditor(conn, contractId);
      if (result.launched) {
        setState({ kind: "opened", command: result.command ?? "已调起编辑器" });
      } else {
        setState({
          kind: "fallback",
          worktreePath: result.worktreePath,
          message: result.message ?? "未找到编辑器命令，请手动打开该路径",
        });
      }
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-1 text-[11px]" data-testid="editor-opener">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={state.kind === "busy"}
        className="rounded border border-border px-2 py-1 hover:bg-accent disabled:opacity-40"
      >
        {state.kind === "busy" ? "调起中…" : "在编辑器中检查"}
      </button>

      {state.kind === "opened" && (
        <p className="text-emerald-600">已调起：{state.command}</p>
      )}

      {state.kind === "fallback" && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-2 text-amber-700">
          <p>{state.message}</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="max-w-[70%] truncate">{state.worktreePath}</code>
            <button
              type="button"
              onClick={() => void handleCopy(state.worktreePath)}
              className="rounded border border-border px-2 py-0.5"
            >
              {copied ? "已复制" : "复制路径"}
            </button>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <p className="text-destructive">{state.message}</p>
      )}
    </div>
  );
}

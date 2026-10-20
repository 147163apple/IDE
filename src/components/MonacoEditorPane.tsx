import Editor from "@monaco-editor/react";
import { useWorktreeFile, type WorktreeFileIO } from "@/hooks/useWorktreeFile";

export interface MonacoEditorPaneProps {
  path: string;
  io: WorktreeFileIO | null;
  reloadKey?: number;
}

const LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
};

/** TASK-C.3 中栏 Monaco 编辑器：可写/只读视觉区分，保存走 Daemon 校验 */
export function MonacoEditorPane({
  path,
  io,
  reloadKey = 0,
}: MonacoEditorPaneProps) {
  const f = useWorktreeFile(io, path, reloadKey);
  const ext = path.split(".").pop() ?? "";
  return (
    <div
      data-testid="monaco-pane"
      className="flex h-full min-h-[360px] flex-col"
    >
      <div className="flex items-center gap-2 border-b px-2 py-1 text-xs">
        <span className="font-mono">{path}</span>
        <span
          data-testid="file-access"
          data-writable={f.writable ? "true" : "false"}
          className={
            f.writable
              ? "rounded bg-green-100 px-1 text-green-800"
              : "rounded bg-zinc-200 px-1 text-zinc-700"
          }
        >
          {f.writable ? "可写" : "只读"}
        </span>
        {f.dirty && <span className="text-amber-600">● 未保存</span>}
        <button
          type="button"
          className="ml-auto rounded border px-2 disabled:opacity-40"
          disabled={!f.writable || !f.dirty}
          onClick={() => void f.save()}
        >
          保存
        </button>
      </div>
      {f.error && (
        <div
          role="alert"
          className="bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          {f.error}
        </div>
      )}
      <div
        className={`relative min-h-[300px] flex-1 ${f.writable ? "" : "bg-zinc-50"}`}
      >
        {/* Monaco 需要确定高度：绝对定位铺满父容器（浏览器实测发现高度为 0） */}
        {!f.loading && (
          <div data-testid="monaco-host" className="absolute inset-0">
            <Editor
              height="100%"
              theme="vs-dark"
              path={path}
              language={LANG[ext] ?? "plaintext"}
              value={f.content}
              onChange={(v) => f.setContent(v ?? "")}
              options={{
                readOnly: !f.writable,
                minimap: { enabled: false },
                fontSize: 12,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

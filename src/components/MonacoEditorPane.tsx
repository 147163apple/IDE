import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { useWorktreeFile, type WorktreeFileIO } from "@/hooks/useWorktreeFile";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import {
  defaultMarkdownViewMode,
  isMarkdownPath,
  type MarkdownViewMode,
} from "@/lib/markdown-file";

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
  markdown: "markdown",
  mdx: "markdown",
  css: "css",
  html: "html",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
};

/** TASK-C.3 中栏 Monaco；TASK-C.10j：.md 默认好看预览，可切源码 */
export function MonacoEditorPane({
  path,
  io,
  reloadKey = 0,
}: MonacoEditorPaneProps) {
  const f = useWorktreeFile(io, path, reloadKey);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const markdown = isMarkdownPath(path);
  const [viewMode, setViewMode] = useState<MarkdownViewMode>(() =>
    defaultMarkdownViewMode(path),
  );

  useEffect(() => {
    setViewMode(defaultMarkdownViewMode(path));
  }, [path]);

  const showPreview = markdown && viewMode === "preview";

  return (
    <div
      data-testid="monaco-pane"
      data-markdown={markdown ? "true" : "false"}
      data-view-mode={markdown ? viewMode : "source"}
      className="flex h-full min-h-[360px] flex-col"
    >
      <div className="flex items-center gap-2 border-b px-2 py-1 text-xs">
        <span className="font-mono truncate" title={path}>
          {path}
        </span>
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
        {markdown ? (
          <div
            data-testid="markdown-view-toggle"
            className="ml-2 inline-flex overflow-hidden rounded border"
            role="group"
            aria-label="Markdown 阅读模式"
          >
            <button
              type="button"
              data-testid="markdown-view-preview"
              aria-pressed={viewMode === "preview"}
              className={
                viewMode === "preview"
                  ? "bg-primary px-2 py-0.5 text-primary-foreground"
                  : "bg-background px-2 py-0.5 text-muted-foreground hover:bg-muted"
              }
              onClick={() => setViewMode("preview")}
            >
              预览
            </button>
            <button
              type="button"
              data-testid="markdown-view-source"
              aria-pressed={viewMode === "source"}
              className={
                viewMode === "source"
                  ? "bg-primary px-2 py-0.5 text-primary-foreground"
                  : "bg-background px-2 py-0.5 text-muted-foreground hover:bg-muted"
              }
              onClick={() => setViewMode("source")}
            >
              源码
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="ml-auto rounded border px-2 disabled:opacity-40"
          disabled={!f.writable || !f.dirty || showPreview}
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
        className={`relative min-h-[300px] flex-1 ${f.writable && !showPreview ? "" : "bg-zinc-50"}`}
      >
        {!f.loading && showPreview ? (
          <MarkdownPreview content={f.content} path={path} />
        ) : null}
        {!f.loading && !showPreview ? (
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
        ) : null}
      </div>
    </div>
  );
}

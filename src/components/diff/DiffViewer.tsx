import { useMemo, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { DiffFilePairView } from "@/lib/daemon-api";

export interface DiffViewerProps {
  /** 统一 diff 文本（内联视图；来自 GET /diff） */
  patch: string;
  filePath?: string | undefined;
  /** 逐文件基线/当前内容（双栏视图；来自 GET /diff-files） */
  files?: DiffFilePairView[] | undefined;
  /** 文件数超过上限被截断 */
  truncatedList?: boolean | undefined;
}

type LineKind = "add" | "del" | "hunk" | "meta" | "context";

function classify(line: string): LineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

const LINE_STYLE: Record<LineKind, string> = {
  add: "bg-emerald-500/10 text-emerald-600",
  del: "bg-destructive/10 text-destructive",
  hunk: "bg-sky-500/10 text-sky-600",
  meta: "text-muted-foreground",
  context: "text-foreground",
};

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  py: "python",
  go: "go",
  rs: "rust",
  sh: "shell",
};

function languageOf(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXT[ext] ?? "plaintext";
}

/** TASK-C.5 双栏 Diff 审阅器：双栏（Monaco）与内联（统一 diff）可切换 */
export function DiffViewer({
  patch,
  filePath,
  files = [],
  truncatedList,
}: DiffViewerProps) {
  const hasFiles = files.length > 0;
  const [mode, setMode] = useState<"split" | "inline">(
    hasFiles ? "split" : "inline",
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(
    files.find((f) => !f.binary)?.path ?? files[0]?.path ?? null,
  );
  const selected = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? files[0] ?? null,
    [files, selectedPath],
  );
  const lines = useMemo(
    () => patch.replace(/\r\n/g, "\n").split("\n"),
    [patch],
  );

  if (!patch.trim() && !hasFiles) {
    return (
      <div
        data-testid="diff-empty"
        className="rounded border border-border bg-card p-4 text-center text-xs text-muted-foreground"
      >
        无代码变更（空 diff）
      </div>
    );
  }

  return (
    <section
      className="overflow-hidden rounded border border-border"
      data-testid="diff-viewer"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground">
        <span>{filePath ?? selected?.path ?? `${files.length} 个文件`}</span>
        <span className="flex gap-1">
          {hasFiles && (
            <button
              type="button"
              data-testid="diff-mode-split"
              data-active={mode === "split"}
              onClick={() => setMode("split")}
              className={`rounded border px-1.5 ${
                mode === "split" ? "border-sky-500 text-sky-600" : ""
              }`}
            >
              双栏
            </button>
          )}
          <button
            type="button"
            data-testid="diff-mode-inline"
            data-active={mode === "inline"}
            onClick={() => setMode("inline")}
            className={`rounded border px-1.5 ${
              mode === "inline" ? "border-sky-500 text-sky-600" : ""
            }`}
          >
            内联
          </button>
        </span>
        {truncatedList && (
          <span data-testid="diff-truncated-list" className="text-amber-600">
            文件太多，只显示前 50 个
          </span>
        )}
      </header>

      {hasFiles && mode === "split" ? (
        <div className="flex max-h-96 min-h-0">
          <ul
            data-testid="diff-file-list"
            className="w-56 shrink-0 overflow-auto border-r border-border text-[11px]"
          >
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  data-testid={`diff-file-${f.path}`}
                  onClick={() => setSelectedPath(f.path)}
                  title={f.path}
                  className={`block w-full truncate px-2 py-1 text-left ${
                    f.path === selected?.path
                      ? "bg-sky-500/10 text-sky-700"
                      : ""
                  }`}
                >
                  {f.status === "added"
                    ? "＋ "
                    : f.status === "deleted"
                      ? "－ "
                      : ""}
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1">
            {selected?.binary ? (
              <div
                data-testid="diff-binary"
                className="p-3 text-xs text-muted-foreground"
              >
                二进制文件，无法按文本对照（{selected.path}）
              </div>
            ) : (
              <>
                {selected?.truncated && (
                  <div
                    data-testid="diff-file-truncated"
                    className="px-3 py-1 text-[11px] text-amber-600"
                  >
                    文件超过 300KB，只展示前 300KB（{selected.path}）
                  </div>
                )}
                <DiffEditor
                  key={selected?.path ?? "empty"}
                  height="360px"
                  language={languageOf(selected?.path ?? filePath ?? "")}
                  original={selected?.before ?? ""}
                  modified={selected?.after ?? ""}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 11,
                  }}
                />
              </>
            )}
          </div>
        </div>
      ) : (
        <pre className="max-h-96 overflow-auto bg-background p-2 font-mono text-[11px] leading-5">
          {lines.map((line, index) => {
            const kind = classify(line);
            return (
              <div key={index} className={LINE_STYLE[kind]}>
                {line || " "}
              </div>
            );
          })}
        </pre>
      )}
    </section>
  );
}

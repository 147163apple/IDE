export interface DiffViewerProps {
  patch: string;
  filePath?: string;
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

/** C.3 双栏/行内 Diff 的行内视图（统一 diff 文本渲染） */
export function DiffViewer({ patch, filePath }: DiffViewerProps) {
  const lines = useMemoLines(patch);

  if (!patch.trim()) {
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
      {filePath && (
        <header className="border-b border-border bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground">
          {filePath}
        </header>
      )}
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
    </section>
  );
}

function useMemoLines(patch: string): string[] {
  return patch.replace(/\r\n/g, "\n").split("\n");
}

/** TASK-C.10j：判断路径是否按 Markdown 阅读（默认预览）。 */
export function isMarkdownPath(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  return ext === "md" || ext === "markdown" || ext === "mdx";
}

export type MarkdownViewMode = "preview" | "source";

/** .md 默认预览；其它文件无切换，等同源码。 */
export function defaultMarkdownViewMode(path: string): MarkdownViewMode {
  return isMarkdownPath(path) ? "preview" : "source";
}

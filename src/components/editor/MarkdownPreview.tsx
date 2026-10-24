import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

export interface MarkdownPreviewProps {
  content: string;
  /** 可选：文件路径，仅作无障碍标签 */
  path?: string;
}

/**
 * TASK-C.10j：中栏 Markdown 好看预览（标题 / 引用 / GFM / 代码高亮）。
 * 只读渲染；编辑走源码模式（Monaco）。
 */
export function MarkdownPreview({ content, path }: MarkdownPreviewProps) {
  return (
    <div
      data-testid="markdown-preview"
      data-path={path ?? ""}
      className="markdown-preview h-full overflow-auto px-6 py-5"
    >
      <article className="markdown-preview-body mx-auto max-w-3xl">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

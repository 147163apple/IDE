import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FileNode } from "./workspace-types";
import {
  initialExpandedDirPaths,
  toggleExpandedPath,
} from "../lib/file-tree-expand";

export interface FileTreeProps {
  nodes: FileNode[];
  rootLabel: string;
  onOpen?: ((path: string) => void) | undefined;
  /** 列表加载中（连上后拉树） */
  loading?: boolean | undefined;
}

function Node({
  node,
  onOpen,
  expanded,
  onToggleDir,
}: {
  node: FileNode;
  onOpen?: ((p: string) => void) | undefined;
  expanded: ReadonlySet<string>;
  onToggleDir: (path: string) => void;
}) {
  if (node.children) {
    const open = expanded.has(node.path);
    return (
      <li>
        <button
          type="button"
          data-testid={`file-tree-dir-${node.path}`}
          aria-expanded={open}
          onClick={() => onToggleDir(node.path)}
          className="flex w-full items-center gap-0.5 rounded px-0.5 text-left hover:bg-muted"
        >
          {open ? (
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 opacity-70"
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 opacity-70"
              aria-hidden
            />
          )}
          <span>{node.name}/</span>
        </button>
        {open ? (
          <ul className="pl-3">
            {node.children.map((c) => (
              <Node
                key={c.path}
                node={c}
                onOpen={onOpen}
                expanded={expanded}
                onToggleDir={onToggleDir}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        data-testid={`file-tree-file-${node.path}`}
        onClick={() => onOpen?.(node.path)}
        className="w-full rounded px-0.5 pl-4 text-left hover:bg-muted"
      >
        {node.name}
      </button>
    </li>
  );
}

/** TASK-C.1 左栏文件树；C.10g 可点文件夹展开/折叠，默认只展开第一层 */
export function FileTree({ nodes, rootLabel, onOpen, loading }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialExpandedDirPaths(nodes),
  );

  // 树数据换了（换项目 / 重新拉树）时按默认第一层重置
  useEffect(() => {
    setExpanded(initialExpandedDirPaths(nodes));
  }, [nodes]);

  const onToggleDir = (path: string) => {
    setExpanded((prev) => toggleExpandedPath(prev, path));
  };

  return (
    <nav data-testid="file-tree" className="overflow-auto p-2 text-sm">
      <div data-testid="file-tree-root" className="mb-1 text-xs opacity-70">
        {rootLabel}
      </div>
      {loading && nodes.length === 0 ? (
        <p
          data-testid="file-tree-loading"
          className="px-1 py-2 text-xs text-muted-foreground"
        >
          正在加载文件…
        </p>
      ) : null}
      {!loading && nodes.length === 0 ? (
        <p
          data-testid="file-tree-empty"
          className="px-1 py-2 text-xs text-muted-foreground"
        >
          还没有文件。确认已连接本机服务后会自动列出项目文件。
        </p>
      ) : null}
      <ul>
        {nodes.map((n) => (
          <Node
            key={n.path}
            node={n}
            onOpen={onOpen}
            expanded={expanded}
            onToggleDir={onToggleDir}
          />
        ))}
      </ul>
    </nav>
  );
}

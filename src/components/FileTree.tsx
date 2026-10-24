import type { FileNode } from "./workspace-types";

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
}: {
  node: FileNode;
  onOpen?: ((p: string) => void) | undefined;
}) {
  if (node.children) {
    return (
      <li>
        <span>{node.name}/</span>
        <ul className="pl-3">
          {node.children.map((c) => (
            <Node key={c.path} node={c} onOpen={onOpen} />
          ))}
        </ul>
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={() => onOpen?.(node.path)}>
        {node.name}
      </button>
    </li>
  );
}

/** TASK-C.1 左栏文件树（rootLabel 显示当前绑定的工作树根路径） */
export function FileTree({ nodes, rootLabel, onOpen, loading }: FileTreeProps) {
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
          <Node key={n.path} node={n} onOpen={onOpen} />
        ))}
      </ul>
    </nav>
  );
}

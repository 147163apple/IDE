import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FileNode } from "./workspace-types";
import {
  initialExpandedDirPaths,
  toggleExpandedPath,
} from "../lib/file-tree-expand";
import { deleteMenuLabel } from "../lib/file-tree-delete";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

export interface FileTreeProps {
  nodes: FileNode[];
  rootLabel: string;
  onOpen?: ((path: string) => void) | undefined;
  /** C.10h：确认后删除；抛错时展示白话 */
  onDelete?: ((path: string) => void | Promise<void>) | undefined;
  /** 列表加载中（连上后拉树） */
  loading?: boolean | undefined;
}

function Node({
  node,
  onOpen,
  onRequestDelete,
  expanded,
  onToggleDir,
}: {
  node: FileNode;
  onOpen?: ((p: string) => void) | undefined;
  onRequestDelete?: ((path: string, kind: "file" | "dir") => void) | undefined;
  expanded: ReadonlySet<string>;
  onToggleDir: (path: string) => void;
}) {
  const kind: "file" | "dir" = node.children ? "dir" : "file";
  const menuLabel = deleteMenuLabel();

  const trigger = node.children ? (
    <button
      type="button"
      data-testid={`file-tree-dir-${node.path}`}
      aria-expanded={expanded.has(node.path)}
      onClick={() => onToggleDir(node.path)}
      className="flex w-full items-center gap-0.5 rounded px-0.5 text-left hover:bg-muted"
    >
      {expanded.has(node.path) ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      )}
      <span>{node.name}/</span>
    </button>
  ) : (
    <button
      type="button"
      data-testid={`file-tree-file-${node.path}`}
      onClick={() => onOpen?.(node.path)}
      className="w-full rounded px-0.5 pl-4 text-left hover:bg-muted"
    >
      {node.name}
    </button>
  );

  const row = onRequestDelete ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
      <ContextMenuContent data-testid={`file-tree-menu-${node.path}`}>
        <ContextMenuItem
          data-testid={`file-tree-delete-${node.path}`}
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            // Radix ContextMenu 关闭时会短暂给 body 加 pointer-events:none；
            // 若同步打开 AlertDialog，确认/取消会点不了。延后一帧等菜单卸完。
            window.setTimeout(() => onRequestDelete(node.path, kind), 0);
          }}
        >
          {menuLabel}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ) : (
    trigger
  );

  if (node.children) {
    const open = expanded.has(node.path);
    return (
      <li>
        {row}
        {open ? (
          <ul className="pl-3">
            {node.children.map((c) => (
              <Node
                key={c.path}
                node={c}
                onOpen={onOpen}
                onRequestDelete={onRequestDelete}
                expanded={expanded}
                onToggleDir={onToggleDir}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }
  return <li>{row}</li>;
}

/** TASK-C.1 左栏文件树；C.10g 折叠；C.10h 右键删除 */
export function FileTree({
  nodes,
  rootLabel,
  onOpen,
  onDelete,
  loading,
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialExpandedDirPaths(nodes),
  );
  const [pending, setPending] = useState<{
    path: string;
    kind: "file" | "dir";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExpanded(initialExpandedDirPaths(nodes));
  }, [nodes]);

  const onToggleDir = (path: string) => {
    setExpanded((prev) => toggleExpandedPath(prev, path));
  };

  const confirmDelete = async () => {
    if (!pending || !onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(pending.path);
      setPending(null);
    } catch (err) {
      setError((err as Error).message || "删除失败");
    } finally {
      setBusy(false);
    }
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
            onRequestDelete={
              onDelete
                ? (path, kind) => {
                    setError(null);
                    setPending({ path, kind });
                  }
                : undefined
            }
            expanded={expanded}
            onToggleDir={onToggleDir}
          />
        ))}
      </ul>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPending(null);
            setError(null);
          }
        }}
      >
        <AlertDialogContent data-testid="file-tree-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  将删除「
                  <span className="font-medium text-foreground">
                    {pending?.path}
                  </span>
                  」{pending?.kind === "dir" ? "（文件夹）" : ""}。
                </p>
                <p>
                  会先尝试移到废纸篓；若本机不支持，普通文件会永久删除，文件夹则会拒绝并说明原因。受保护的文件删不掉。
                </p>
                {error ? (
                  <p
                    data-testid="file-tree-delete-error"
                    className="text-destructive"
                  >
                    {error}
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busy}
              data-testid="file-tree-delete-cancel"
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="file-tree-delete-confirm-btn"
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {busy ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </nav>
  );
}

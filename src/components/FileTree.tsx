import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FilePlus, FolderPlus } from "lucide-react";
import type { FileNode } from "./workspace-types";
import {
  collapseAllDirPaths,
  initialExpandedDirPaths,
  toggleExpandedPath,
} from "../lib/file-tree-expand";
import { deleteMenuLabel } from "../lib/file-tree-delete";
import {
  absoluteRepoPath,
  copyPathMenuLabel,
  createParentRel,
  renameMenuLabel,
  revealMenuLabel,
  siblingRenamePath,
} from "../lib/file-tree-ops";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface FileTreeProps {
  nodes: FileNode[];
  rootLabel: string;
  onOpen?: ((path: string) => void) | undefined;
  /** C.10h：确认后删除；抛错时展示白话 */
  onDelete?: ((path: string) => void | Promise<void>) | undefined;
  /** C.10i：新建；返回新建相对路径 */
  onCreate?:
    | ((args: {
        parent: string;
        name: string;
        kind: "file" | "dir";
      }) => void | Promise<string | void>)
    | undefined;
  /** C.10i：重命名 */
  onRename?:
    ((args: { from: string; to: string }) => void | Promise<void>) | undefined;
  /** C.10i：在 Finder / 文件管理器显示 */
  onReveal?: ((path: string) => void | Promise<void>) | undefined;
  /** 列表加载中（连上后拉树） */
  loading?: boolean | undefined;
}

type PendingDelete = { path: string; kind: "file" | "dir" };
type NameDialog =
  | { mode: "create"; kind: "file" | "dir"; parent: string }
  | { mode: "rename"; from: string; kind: "file" | "dir" };

function Node({
  node,
  onOpen,
  onSelect,
  selectedPath,
  onRequestDelete,
  onRequestRename,
  onRequestReveal,
  onRequestCopy,
  expanded,
  onToggleDir,
  hasOps,
}: {
  node: FileNode;
  onOpen?: ((p: string) => void) | undefined;
  onSelect: (path: string, kind: "file" | "dir") => void;
  selectedPath: string | null;
  onRequestDelete?: ((path: string, kind: "file" | "dir") => void) | undefined;
  onRequestRename?: ((path: string, kind: "file" | "dir") => void) | undefined;
  onRequestReveal?: ((path: string) => void) | undefined;
  onRequestCopy?: ((path: string) => void) | undefined;
  expanded: ReadonlySet<string>;
  onToggleDir: (path: string) => void;
  hasOps: boolean;
}) {
  const kind: "file" | "dir" = node.children ? "dir" : "file";
  const selected = selectedPath === node.path;

  const trigger = node.children ? (
    <button
      type="button"
      data-testid={`file-tree-dir-${node.path}`}
      data-selected={selected ? "true" : undefined}
      aria-expanded={expanded.has(node.path)}
      onClick={() => {
        onSelect(node.path, "dir");
        onToggleDir(node.path);
      }}
      className={`flex w-full items-center gap-0.5 rounded px-0.5 text-left hover:bg-muted ${
        selected ? "bg-muted" : ""
      }`}
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
      data-selected={selected ? "true" : undefined}
      onClick={() => {
        onSelect(node.path, "file");
        onOpen?.(node.path);
      }}
      className={`w-full rounded px-0.5 pl-4 text-left hover:bg-muted ${
        selected ? "bg-muted" : ""
      }`}
    >
      {node.name}
    </button>
  );

  const row = hasOps ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
      <ContextMenuContent data-testid={`file-tree-menu-${node.path}`}>
        {onRequestReveal ? (
          <ContextMenuItem
            data-testid={`file-tree-reveal-${node.path}`}
            onSelect={() => {
              window.setTimeout(() => onRequestReveal(node.path), 0);
            }}
          >
            {revealMenuLabel()}
          </ContextMenuItem>
        ) : null}
        {onRequestCopy ? (
          <ContextMenuItem
            data-testid={`file-tree-copy-${node.path}`}
            onSelect={() => {
              window.setTimeout(() => onRequestCopy(node.path), 0);
            }}
          >
            {copyPathMenuLabel()}
          </ContextMenuItem>
        ) : null}
        {onRequestRename ? (
          <ContextMenuItem
            data-testid={`file-tree-rename-${node.path}`}
            onSelect={() => {
              window.setTimeout(() => onRequestRename(node.path, kind), 0);
            }}
          >
            {renameMenuLabel()}
          </ContextMenuItem>
        ) : null}
        {onRequestDelete ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              data-testid={`file-tree-delete-${node.path}`}
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                // Radix ContextMenu 关闭时会短暂给 body 加 pointer-events:none；
                // 若同步打开 AlertDialog，确认/取消会点不了。延后一帧等菜单卸完。
                window.setTimeout(() => onRequestDelete(node.path, kind), 0);
              }}
            >
              {deleteMenuLabel()}
            </ContextMenuItem>
          </>
        ) : null}
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
                onSelect={onSelect}
                selectedPath={selectedPath}
                onRequestDelete={onRequestDelete}
                onRequestRename={onRequestRename}
                onRequestReveal={onRequestReveal}
                onRequestCopy={onRequestCopy}
                expanded={expanded}
                onToggleDir={onToggleDir}
                hasOps={hasOps}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }
  return <li>{row}</li>;
}

/** TASK-C.1 左栏文件树；C.10g 折叠；C.10h 右键删除；C.10i 新建/重命名/Finder/复制/顶栏折叠 */
export function FileTree({
  nodes,
  rootLabel,
  onOpen,
  onDelete,
  onCreate,
  onRename,
  onReveal,
  loading,
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialExpandedDirPaths(nodes),
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<"file" | "dir" | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setExpanded(initialExpandedDirPaths(nodes));
  }, [nodes]);

  const hasOps = Boolean(onDelete || onCreate || onRename || onReveal);

  const onToggleDir = (path: string) => {
    setExpanded((prev) => toggleExpandedPath(prev, path));
  };

  const collapseAll = () => {
    setExpanded(collapseAllDirPaths());
  };

  const openCreate = (kind: "file" | "dir") => {
    if (!onCreate) return;
    setError(null);
    setToast(null);
    const parent = createParentRel({ selectedPath, selectedKind });
    setNameValue(kind === "dir" ? "新建文件夹" : "untitled.txt");
    setNameDialog({ mode: "create", kind, parent });
  };

  const confirmDelete = async () => {
    if (!pending || !onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(pending.path);
      setPending(null);
      if (selectedPath === pending.path) {
        setSelectedPath(null);
        setSelectedKind(null);
      }
    } catch (err) {
      setError((err as Error).message || "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmNameDialog = async () => {
    if (!nameDialog) return;
    const name = nameValue.trim();
    if (!name) {
      setError("请输入名称。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (nameDialog.mode === "create") {
        if (!onCreate) return;
        const created = await onCreate({
          parent: nameDialog.parent,
          name,
          kind: nameDialog.kind,
        });
        const createdPath =
          typeof created === "string"
            ? created
            : nameDialog.parent
              ? `${nameDialog.parent}/${name}`
              : name;
        if (nameDialog.parent) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(nameDialog.parent);
            return next;
          });
        }
        setSelectedPath(createdPath);
        setSelectedKind(nameDialog.kind);
        if (nameDialog.kind === "file") onOpen?.(createdPath);
        setNameDialog(null);
      } else {
        if (!onRename) return;
        const to = siblingRenamePath(nameDialog.from, name);
        await onRename({ from: nameDialog.from, to });
        setSelectedPath(to);
        setSelectedKind(nameDialog.kind);
        setNameDialog(null);
      }
    } catch (err) {
      setError((err as Error).message || "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (relPath: string) => {
    const abs = absoluteRepoPath(rootLabel, relPath);
    try {
      await navigator.clipboard.writeText(abs);
      setToast(`已复制：${abs}`);
      window.setTimeout(() => setToast(null), 2500);
    } catch {
      setToast("复制失败，请手动选中路径复制。");
      window.setTimeout(() => setToast(null), 2500);
    }
  };

  const handleReveal = async (relPath: string) => {
    if (!onReveal) return;
    setError(null);
    try {
      await onReveal(relPath);
    } catch (err) {
      setToast((err as Error).message || "无法在 Finder 中显示");
      window.setTimeout(() => setToast(null), 3500);
    }
  };

  const rootContext = hasOps ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          data-testid="file-tree-root"
          title="点击折叠整棵文件树"
          onClick={collapseAll}
          className="min-w-0 flex-1 truncate text-left text-xs opacity-70 hover:opacity-100"
        >
          {rootLabel}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="file-tree-menu-root">
        {onReveal ? (
          <ContextMenuItem
            data-testid="file-tree-reveal-root"
            onSelect={() => {
              window.setTimeout(() => void handleReveal("."), 0);
            }}
          >
            {revealMenuLabel()}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          data-testid="file-tree-copy-root"
          onSelect={() => {
            window.setTimeout(() => void handleCopy("."), 0);
          }}
        >
          {copyPathMenuLabel()}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ) : (
    <button
      type="button"
      data-testid="file-tree-root"
      title="点击折叠整棵文件树"
      onClick={collapseAll}
      className="min-w-0 flex-1 truncate text-left text-xs opacity-70 hover:opacity-100"
    >
      {rootLabel}
    </button>
  );

  return (
    <nav data-testid="file-tree" className="flex h-full flex-col text-sm">
      <div className="mb-1 flex items-center gap-1 px-2 pt-2">
        {rootContext}
        {onCreate ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              data-testid="file-tree-new-file"
              title="新建文件"
              aria-label="新建文件"
              onClick={() => openCreate("file")}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <FilePlus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              data-testid="file-tree-new-folder"
              title="新建文件夹"
              aria-label="新建文件夹"
              onClick={() => openCreate("dir")}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
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
              onSelect={(path, kind) => {
                setSelectedPath(path);
                setSelectedKind(kind);
              }}
              selectedPath={selectedPath}
              onRequestDelete={
                onDelete
                  ? (path, kind) => {
                      setError(null);
                      setPending({ path, kind });
                    }
                  : undefined
              }
              onRequestRename={
                onRename
                  ? (path, kind) => {
                      setError(null);
                      setNameValue(path.split("/").pop() ?? path);
                      setNameDialog({ mode: "rename", from: path, kind });
                    }
                  : undefined
              }
              onRequestReveal={
                onReveal ? (p) => void handleReveal(p) : undefined
              }
              onRequestCopy={(p) => void handleCopy(p)}
              expanded={expanded}
              onToggleDir={onToggleDir}
              hasOps={hasOps}
            />
          ))}
        </ul>
      </div>

      {toast ? (
        <p
          data-testid="file-tree-toast"
          className="border-t px-2 py-1 text-xs text-muted-foreground"
        >
          {toast}
        </p>
      ) : null}

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

      <Dialog
        open={nameDialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setNameDialog(null);
            setError(null);
          }
        }}
      >
        <DialogContent data-testid="file-tree-name-dialog">
          <DialogHeader>
            <DialogTitle>
              {nameDialog?.mode === "rename"
                ? "重命名"
                : nameDialog?.kind === "dir"
                  ? "新建文件夹"
                  : "新建文件"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {nameDialog?.mode === "create" && nameDialog.parent ? (
              <p className="text-xs text-muted-foreground">
                位置：{nameDialog.parent}/
              </p>
            ) : null}
            <Input
              data-testid="file-tree-name-input"
              value={nameValue}
              autoFocus
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirmNameDialog();
                }
              }}
            />
            {error ? (
              <p
                data-testid="file-tree-name-error"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              data-testid="file-tree-name-cancel"
              onClick={() => {
                if (!busy) {
                  setNameDialog(null);
                  setError(null);
                }
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={busy}
              data-testid="file-tree-name-confirm"
              onClick={() => void confirmNameDialog()}
            >
              {busy ? "处理中…" : "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

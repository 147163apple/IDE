import type { FileNode } from "../components/workspace-types";

/**
 * TASK-C.10g：默认只展开第一层目录。
 * 根下带 children 的节点进入 expanded；更深层目录默认收起。
 */
export function initialExpandedDirPaths(nodes: FileNode[]): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if (Array.isArray(n.children)) {
      // 文件夹（含空目录）默认展开一层
      out.add(n.path);
    }
  }
  return out;
}

export function toggleExpandedPath(
  prev: ReadonlySet<string>,
  path: string,
): Set<string> {
  const next = new Set(prev);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** C.10i：点顶栏路径 → 折叠整棵树 */
export function collapseAllDirPaths(): Set<string> {
  return new Set();
}

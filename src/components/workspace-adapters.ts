import type { LifecycleState } from "@/lib/contract.schema";
import type { ExecutionStatus, FileNode } from "./workspace-types";

/** 已批准（Worktree 已建或在用）的生命周期状态：编辑区应绑定 Worktree */
export const APPROVED_STATES: ReadonlySet<LifecycleState> = new Set([
  "PREPARING",
  "EXECUTING",
  "VERIFYING",
  "PENDING_RESUME",
  "AUDITED",
]);

export function toExecutionStatus(state: LifecycleState): ExecutionStatus {
  switch (state) {
    case "PREPARING":
    case "EXECUTING":
    case "VERIFYING":
      return "EXECUTING";
    case "PENDING_RESUME":
      return "PAUSED";
    case "AUDITED":
    case "MERGED":
      return "DONE";
    default:
      return "IDLE";
  }
}

/** 把扁平路径列表（来自架构雷达）组装成文件树 */
export function buildFileTree(paths: string[]): FileNode[] {
  const root: FileNode[] = [];
  for (const full of [...paths].sort()) {
    const parts = full.split("/").filter(Boolean);
    let level = root;
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const isLeaf = i === parts.length - 1;
      let node = level.find((n) => n.name === name);
      if (!node) {
        node = isLeaf ? { name, path } : { name, path, children: [] };
        level.push(node);
      }
      if (!isLeaf) {
        if (!node.children) node.children = [];
        level = node.children;
      }
    });
  }
  return root;
}

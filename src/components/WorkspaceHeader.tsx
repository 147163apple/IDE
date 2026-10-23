import { GitBranch, Plus } from "lucide-react";
import type { RunMode } from "./workspace-types";

/**
 * 顶栏（极简）。
 *
 * 只回答三个问题：**在哪个项目 / 哪个分支 / 什么模式**，外加一个最小操作点。
 * 其余一切（连接地址、Token、实时流、网关受控、Worktree 绝对路径、刷新、
 * 模型 Key）都是「调试/控制项」，一律下沉到 ⚙️ 设置页 —— 那些东西常驻顶栏
 * 会把 IDE 变成运维后台，也会把 Token 输入框摆在视野里。
 *
 * 保留 `run-mode` 的点击行为：点模式徽标 = 打开合同操作台（模式真正按条目
 * 粒度调整在那边做，避免"点一下顶栏就全解锁"）。
 */
export interface WorkspaceHeaderProps {
  repoName: string;
  baseBranch: string;
  runMode: RunMode;
  /** 已锁定的保护条目数；只进 title 提示，不占顶栏文字 */
  protectedCount?: number | undefined;
  onOpenStudio: () => void;
  /** 右侧唯一操作点：新建需求（走真实合同创建流程） */
  onNewRequirement?: (() => void) | undefined;
}

export function WorkspaceHeader({
  repoName,
  baseBranch,
  runMode,
  protectedCount = 0,
  onOpenStudio,
  onNewRequirement,
}: WorkspaceHeaderProps) {
  const protectedMode = runMode === "PROTECTED";
  return (
    <header
      data-testid="workspace-header"
      className="flex items-center gap-2 border-b px-3 py-1.5 text-xs"
    >
      <span data-testid="repo-name" className="font-semibold">
        {repoName}
      </span>

      <span
        data-testid="current-branch"
        className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"
      >
        <GitBranch className="h-3 w-3" />
        {baseBranch}
      </span>

      <button
        type="button"
        data-testid="run-mode"
        data-mode={runMode}
        data-locked-count={protectedMode ? protectedCount : 0}
        onClick={onOpenStudio}
        title={
          protectedMode
            ? `保护模式：已锁 ${protectedCount} 处，点击打开合同操作台`
            : "自由模式，点击打开合同操作台"
        }
        className={`rounded-full border px-2 py-0.5 ${
          protectedMode
            ? "border-amber-500/50 bg-amber-500/10 text-amber-700"
            : "border-border text-muted-foreground"
        }`}
      >
        {protectedMode ? "🔒 PROTECTED" : "🔓 VIBE"}
      </button>

      {onNewRequirement ? (
        <button
          type="button"
          data-testid="new-requirement"
          onClick={onNewRequirement}
          className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> 新建需求
        </button>
      ) : null}
    </header>
  );
}

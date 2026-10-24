import { GitBranch, Plus } from "lucide-react";
import type { RunMode } from "./workspace-types";

/**
 * 顶栏（极简 · TASK-C.9a）。
 *
 * 只回答三个问题：**在哪个项目 / 哪个分支 / 什么模式**，外加一个最小操作点。
 * 模式徽标是**状态**，不是指挥官：PROTECTED 不再用工程师暗号抢视线，
 * 白话「保护中 / 自由」；完整语义进 title / data-mode。
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
  /** C.9a：顶栏徽标降噪（默认 true） */
  quietBadge?: boolean | undefined;
}

export function WorkspaceHeader({
  repoName,
  baseBranch,
  runMode,
  protectedCount = 0,
  onOpenStudio,
  onNewRequirement,
  quietBadge = true,
}: WorkspaceHeaderProps) {
  const protectedMode = runMode === "PROTECTED";
  const modeLabel = protectedMode
    ? quietBadge
      ? "保护中"
      : "🔒 PROTECTED"
    : quietBadge
      ? "自由"
      : "🔓 VIBE";
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
        data-quiet={quietBadge ? "true" : "false"}
        data-locked-count={protectedMode ? protectedCount : 0}
        onClick={onOpenStudio}
        title={
          protectedMode
            ? `保护模式：已锁 ${protectedCount} 处，点击打开合同操作台`
            : "自由模式，点击打开合同操作台"
        }
        className={`rounded-full border px-2 py-0.5 ${
          protectedMode
            ? "border-border bg-muted/60 text-muted-foreground"
            : "border-border text-muted-foreground"
        }`}
      >
        {modeLabel}
      </button>

      {onNewRequirement ? (
        <button
          type="button"
          data-testid="new-requirement"
          data-command-role="secondary"
          onClick={onNewRequirement}
          className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> 新建需求
        </button>
      ) : null}
    </header>
  );
}

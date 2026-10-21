import type { ReactNode } from "react";
import {
  EXECUTION_STATUS_LABEL,
  type ActiveContract,
  type RunMode,
  type WorkerControl,
} from "./workspace-types";

export interface WorkspaceHeaderProps {
  repoName: string;
  baseBranch: string;
  runMode: RunMode;
  contract?: ActiveContract | null | undefined;
  workerControl: WorkerControl;
  /** 与 Daemon 的连接状态；false 时受控徽章变暗（P.1 顺手修） */
  daemonConnected?: boolean;
  /** 已锁定的保护条目数（C.2 顶栏「已锁 N 处」） */
  protectedCount?: number | undefined;
  onOpenStudio: () => void;
  extra?: ReactNode;
}

/** TASK-C.1 Header：仓库 / 分支 / 模式 / 合同+Worktree / 受控徽标 / Supervisor 入口 */
export function WorkspaceHeader({
  repoName,
  baseBranch,
  runMode,
  contract,
  workerControl,
  daemonConnected = true,
  protectedCount = 0,
  onOpenStudio,
  extra,
}: WorkspaceHeaderProps) {
  // P.1 顺手修：显示主工作区真实分支（由 Daemon 读取），不再按合同拼字符串
  const branch = baseBranch;
  const enforced = workerControl === "GATEWAY_ENFORCED";
  const badgeClass = !daemonConnected
    ? "rounded bg-muted px-2 text-muted-foreground opacity-60"
    : enforced
      ? "rounded bg-green-100 px-2 text-green-800"
      : "rounded bg-yellow-100 px-2 text-yellow-800";
  return (
    <header
      data-testid="workspace-header"
      className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm"
    >
      <span data-testid="repo-name" className="font-semibold">
        {repoName}
      </span>
      <span data-testid="current-branch">分支：{branch}</span>
      {/*
        C.2 模式常驻指示：永远在顶栏，不藏在菜单里。
        点击 = 打开中栏的 Supervisor Studio（真实模式切换在那里按条目粒度做，
        避免"点一下顶栏就全解锁"这种误操作）。
      */}
      <button
        type="button"
        data-testid="run-mode"
        data-mode={runMode}
        data-locked-count={runMode === "PROTECTED" ? protectedCount : 0}
        onClick={onOpenStudio}
        title="打开 Supervisor Studio 查看/调整"
        className="rounded border border-border px-2 hover:bg-accent"
      >
        {runMode === "PROTECTED"
          ? `🔒 保护模式 PROTECTED (已锁 ${protectedCount} 处)`
          : "🔓 自由模式 VIBE"}
      </button>
      {contract && (
        <span data-testid="contract-info">
          合同 {contract.contractId} · {contract.worktreePath} ·{" "}
          {EXECUTION_STATUS_LABEL[contract.status]}
        </span>
      )}
      <span
        data-testid="worker-control"
        data-control={daemonConnected ? workerControl : "OFFLINE"}
        className={badgeClass}
      >
        {!daemonConnected
          ? "未连上后台 · 受控状态未知"
          : enforced
            ? "GATEWAY_ENFORCED 受控"
            : "UNCONTROLLED_EXTERNAL 非受控"}
      </span>
      {extra}
      <button
        type="button"
        data-testid="open-studio"
        onClick={onOpenStudio}
        className="ml-auto rounded border px-2"
      >
        Supervisor
      </button>
    </header>
  );
}

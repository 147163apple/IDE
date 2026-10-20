import {
  RUN_MODE_LABEL,
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
  onOpenStudio: () => void;
}

/** TASK-C.1 Header：仓库 / 分支 / 模式 / 合同+Worktree / 受控徽标 / Supervisor 入口 */
export function WorkspaceHeader({
  repoName,
  baseBranch,
  runMode,
  contract,
  workerControl,
  onOpenStudio,
}: WorkspaceHeaderProps) {
  const active = !!contract?.approved;
  const branch = active ? `task/${contract!.contractId}` : baseBranch;
  const enforced = workerControl === "GATEWAY_ENFORCED";
  return (
    <header
      data-testid="workspace-header"
      className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm"
    >
      <span data-testid="repo-name" className="font-semibold">
        {repoName}
      </span>
      <span data-testid="current-branch">分支：{branch}</span>
      <span
        data-testid="run-mode"
        data-mode={runMode}
        className="rounded border px-2"
      >
        {RUN_MODE_LABEL[runMode]}
      </span>
      {contract && (
        <span data-testid="contract-info">
          合同 {contract.contractId} · {contract.worktreePath} ·{" "}
          {EXECUTION_STATUS_LABEL[contract.status]}
        </span>
      )}
      <span
        data-testid="worker-control"
        data-control={workerControl}
        className={
          enforced
            ? "rounded bg-green-100 px-2 text-green-800"
            : "rounded bg-yellow-100 px-2 text-yellow-800"
        }
      >
        {enforced ? "GATEWAY_ENFORCED 受控" : "UNCONTROLLED_EXTERNAL 非受控"}
      </span>
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

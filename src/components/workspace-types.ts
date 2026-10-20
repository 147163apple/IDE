/** TASK-C.1 工作台共享类型（v1.3.3：运行模式为 VIBE / PROTECTED，见架构规范 §0.6） */
export type RunMode = "VIBE" | "PROTECTED";
export type WorkerControl = "GATEWAY_ENFORCED" | "UNCONTROLLED_EXTERNAL";
export type ExecutionStatus =
  "IDLE" | "APPROVED" | "EXECUTING" | "PAUSED" | "DONE";

export interface ActiveContract {
  contractId: string;
  worktreePath: string;
  approved: boolean;
  status: ExecutionStatus;
}

export interface FileNode {
  name: string;
  path: string;
  children?: FileNode[];
}

export const RUN_MODE_LABEL: Record<RunMode, string> = {
  VIBE: "自由模式 VIBE",
  PROTECTED: "保护模式 PROTECTED",
};

export const EXECUTION_STATUS_LABEL: Record<ExecutionStatus, string> = {
  IDLE: "空闲",
  APPROVED: "已批准，待执行",
  EXECUTING: "执行中",
  PAUSED: "已暂停",
  DONE: "已完成",
};

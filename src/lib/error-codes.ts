import type { ReasonCode } from "./evidence.schema";

/**
 * 运行时错误码目录 (ErrorCode Catalog) —— 《Stagent 系统架构设计规范 v1.2.1》§9.3。
 *
 * 关系：14 个 `error_code`（触发点事实，由具体组件抛出）
 *       → 9 个 `reason_code`（证据包结论归因，写入 EvidenceBundle.verdict.reason_code）。
 *
 * 多对一是规范刻意设计：同一个 reason_code 可由多个不同组件在不同阶段触发
 * （例如 BUDGET_EXHAUSTED 同时覆盖费用、单命令超时、任务总超时）。
 * 反向映射因此是**一对多**，任何把 reason_code 反推成唯一 error_code 的实现都是错的。
 *
 * 单一事实源：本文件的 `ERROR_CODE_CATALOG` 与 A §9.3 表格逐行对应；
 * `REASON_CODES` 与 evidence.schema.ts 的 `reasonCodeSchema` 在类型层对齐，
 * 并在 tests/unit/error-codes-mapping.test.ts 中断言二者集合相等。
 */

// --- 1. 错误码 ---

export const ERROR_CODES = [
  "E_UNSAFE_EXECUTION",
  "E_OUT_OF_SCOPE",
  "PATH_TRAVERSAL_DETECTED",
  "E_FORBIDDEN_PATH",
  "E_BUDGET_EXCEEDED",
  "E_COMMAND_TIMEOUT",
  "E_TASK_TIMEOUT",
  "E_UNAUTHORIZED_COMMAND",
  "E_RETRY_LIMIT_EXCEEDED",
  "E_WORKSPACE_LOCKED",
  "E_EVIDENCE_STALE",
  "E_PREPARATION_FAILED",
  "E_WORKTREE_LOST",
  "E_PORT_CONFLICT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// --- 2. 原因码（与 evidence.schema.ts 的 `reasonCodeSchema` 同集合） ---

export const REASON_CODES = [
  "SCOPE_VIOLATION",
  "BUDGET_EXHAUSTED",
  "WORKSPACE_LOCKED",
  "UNAUTHORIZED_COMMAND",
  "VERIFICATION_RETRY_LIMIT",
  "UNSAFE_EXECUTION",
  "EVIDENCE_STALE",
  "PREPARATION_INTERRUPTED",
  "WORKTREE_LOST",
] as const satisfies readonly ReasonCode[];

/**
 * 编译期断言：`REASON_CODES` 必须覆盖 `ReasonCode` 全集。
 * 若 evidence.schema.ts 新增原因码而此处遗漏，本行会报类型错误。
 */
type _ReasonCatalogueComplete = (typeof REASON_CODES)[number] extends ReasonCode
  ? true
  : never;
const _reasonCatalogueComplete: _ReasonCatalogueComplete = true;
void _reasonCatalogueComplete;

// --- 3. 目录表 ---

export interface ErrorCodeSpec {
  readonly code: ErrorCode;
  /** 归属原因码：写入 Evidence.verdict.reason_code */
  readonly reason_code: ReasonCode;
  /** 触发组件（规范 §9.3「触发组件 / 阶段」列） */
  readonly component: string;
  /** 承接任务卡，便于反向追溯「谁必须产出这个码」 */
  readonly task: string;
  /** 触发条件说明 */
  readonly condition: string;
}

export const ERROR_CODE_CATALOG: Readonly<Record<ErrorCode, ErrorCodeSpec>> = {
  E_UNSAFE_EXECUTION: {
    code: "E_UNSAFE_EXECUTION",
    reason_code: "UNSAFE_EXECUTION",
    component: "Threat Guard",
    task: "TASK-W.4",
    condition:
      "命中不可信仓库、特权命令或无法可靠限制子进程/网络的高风险命令，拒绝执行并提示外置隔离",
  },
  E_OUT_OF_SCOPE: {
    code: "E_OUT_OF_SCOPE",
    reason_code: "SCOPE_VIOLATION",
    component: "Scoped Gateway",
    task: "TASK-W.2",
    condition: "尝试读写未在合同 writable_paths 授权范围内的文件路径",
  },
  PATH_TRAVERSAL_DETECTED: {
    code: "PATH_TRAVERSAL_DETECTED",
    reason_code: "SCOPE_VIOLATION",
    component: "Path Resolver",
    task: "TASK-W.2",
    condition: "相对路径解析包含 `..`，试图逃逸至 Worktree 物理根目录之外",
  },
  E_FORBIDDEN_PATH: {
    code: "E_FORBIDDEN_PATH",
    reason_code: "SCOPE_VIOLATION",
    component: "Scoped Gateway",
    task: "TASK-W.2",
    condition: "试图触碰 .git、.stagent、生产凭据等强禁区路径",
  },
  E_BUDGET_EXCEEDED: {
    code: "E_BUDGET_EXCEEDED",
    reason_code: "BUDGET_EXHAUSTED",
    component: "Cost & Loop Guard",
    task: "TASK-W.3",
    condition: "累积 Token 消耗或单轮任务模型开销达到 budget_limits 上限",
  },
  E_COMMAND_TIMEOUT: {
    code: "E_COMMAND_TIMEOUT",
    reason_code: "BUDGET_EXHAUSTED",
    component: "Command Runner",
    task: "TASK-W.3",
    condition: "单命令执行时间超过 timeout_seconds（默认 60s）",
  },
  E_TASK_TIMEOUT: {
    code: "E_TASK_TIMEOUT",
    reason_code: "BUDGET_EXHAUSTED",
    component: "Command Runner",
    task: "TASK-W.3",
    condition: "任务总生命周期耗时超过 max_duration_seconds（默认 1800s）",
  },
  E_UNAUTHORIZED_COMMAND: {
    code: "E_UNAUTHORIZED_COMMAND",
    reason_code: "UNAUTHORIZED_COMMAND",
    component: "Command Runner",
    task: "TASK-W.3",
    condition: "待执行命令的 executable 不在合同白名单中，拒绝执行",
  },
  E_RETRY_LIMIT_EXCEEDED: {
    code: "E_RETRY_LIMIT_EXCEEDED",
    reason_code: "VERIFICATION_RETRY_LIMIT",
    component: "Loop Guard",
    task: "TASK-W.3",
    condition:
      "任务在同版本合同下连续重试验证失败达到 max_verification_retries 上限",
  },
  E_WORKSPACE_LOCKED: {
    code: "E_WORKSPACE_LOCKED",
    reason_code: "WORKSPACE_LOCKED",
    component: "Daemon Lifecycle",
    task: "TASK-A.1",
    condition: "尝试获取已被其他进程占用的 PID 互斥锁",
  },
  E_EVIDENCE_STALE: {
    code: "E_EVIDENCE_STALE",
    reason_code: "EVIDENCE_STALE",
    component: "FS Watcher",
    task: "TASK-B.2",
    condition: "验证通过后工作树内文件被外部编辑器或进程二次修改",
  },
  E_PREPARATION_FAILED: {
    code: "E_PREPARATION_FAILED",
    reason_code: "PREPARATION_INTERRUPTED",
    component: "Crash Recovery",
    task: "TASK-A.6",
    condition: "Worktree 创建或依赖准备阶段发生进程中断/异常退出",
  },
  E_WORKTREE_LOST: {
    code: "E_WORKTREE_LOST",
    reason_code: "WORKTREE_LOST",
    component: "Crash Recovery",
    task: "TASK-A.6",
    condition: "处于中间态的合同在自愈重启时检测到磁盘物理 Worktree 丢失",
  },
  E_PORT_CONFLICT: {
    code: "E_PORT_CONFLICT",
    reason_code: "UNSAFE_EXECUTION",
    component: "Scoped Gateway",
    task: "TASK-W.3",
    condition:
      "验证命令输出出现 EADDRINUSE / address already in use：环境端口冲突，不是断言失败，需清理占用后重试",
  },
};

// --- 4. 映射函数 ---

export function isKnownErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODE_CATALOG, value);
}

/** 单值正向映射：error_code → reason_code */
export function mapErrorToReasonCode(code: ErrorCode): ReasonCode {
  return ERROR_CODE_CATALOG[code].reason_code;
}

/**
 * 批量正向映射并去重，用于把一次执行中收集到的多个错误码归并为
 * Evidence.verdict.reason_code 的候选集（终选规则由合并门禁决定）。
 */
export function mapErrorsToReasonCodes(
  codes: readonly ErrorCode[],
): ReasonCode[] {
  const seen = new Set<ReasonCode>();
  for (const code of codes) seen.add(mapErrorToReasonCode(code));
  return REASON_CODES.filter((reason) => seen.has(reason));
}

/** 反向映射：reason_code → 全部可能产出该归因的 error_code（一对多） */
export function errorCodesForReasonCode(reason: ReasonCode): ErrorCode[] {
  return ERROR_CODES.filter(
    (code) => ERROR_CODE_CATALOG[code].reason_code === reason,
  );
}

/** 未在目录中的错误码按「未知归因」处理时使用的兜底 reason_code */
export const UNKNOWN_ERROR_REASON: ReasonCode = "UNSAFE_EXECUTION";

/**
 * 宽松映射：接受任意字符串。已知码走目录；未知码归入
 * `UNKNOWN_ERROR_REASON` 并标记 `known: false`，避免静默丢弃。
 */
export function normalizeErrorCode(value: string): {
  code: ErrorCode | null;
  reasonCode: ReasonCode;
  known: boolean;
} {
  if (isKnownErrorCode(value)) {
    return {
      code: value,
      reasonCode: mapErrorToReasonCode(value),
      known: true,
    };
  }
  return { code: null, reasonCode: UNKNOWN_ERROR_REASON, known: false };
}

// --- 5. 带码异常 ---

/**
 * 运行时错误：同时携带触发点 error_code 与归因 reason_code，
 * 便于在 Evidence 生成时无需二次查表。
 */
export class StagentRuntimeError extends Error {
  readonly code: ErrorCode;
  readonly reasonCode: ReasonCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StagentRuntimeError";
    this.code = code;
    this.reasonCode = mapErrorToReasonCode(code);
  }
}

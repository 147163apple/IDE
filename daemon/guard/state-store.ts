import fs from "node:fs";
import path from "node:path";

/**
 * 熔断状态持久化（规范 TASK-A.5 PASS-3：重启 Daemon / 切换模型不得重置计数与累计费用）。
 * 采用「临时文件 + rename」原子写入，避免进程中断产生半截 JSON。
 */
export function readStateFile<T>(filePath: string | undefined): T | null {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStateFile(
  filePath: string | undefined,
  value: unknown,
): void {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } catch {
    // 持久化失败不应中断执行主流程；计数仍在内存中生效
  }
}

/**
 * 熔断后的标准状态联动描述（规范 §4.2 / §9.1.1）：
 * 合同进入 PENDING_RESUME，Evidence 标记 BLOCKED，并携带固定原因码。
 */
export interface BreakerOutcome {
  lifecycle_state: "PENDING_RESUME";
  verdict: "BLOCKED";
  reason_code: "BUDGET_EXHAUSTED" | "VERIFICATION_RETRY_LIMIT";
  error_code: string;
}

export function buildBreakerOutcome(kind: "budget" | "retry"): BreakerOutcome {
  return kind === "budget"
    ? {
        lifecycle_state: "PENDING_RESUME",
        verdict: "BLOCKED",
        reason_code: "BUDGET_EXHAUSTED",
        error_code: "E_BUDGET_EXCEEDED",
      }
    : {
        lifecycle_state: "PENDING_RESUME",
        verdict: "BLOCKED",
        reason_code: "VERIFICATION_RETRY_LIMIT",
        error_code: "E_RETRY_LIMIT_EXCEEDED",
      };
}

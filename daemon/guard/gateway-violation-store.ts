import fs from "node:fs";
import path from "node:path";
import type { GatewayViolation } from "../worker/runtime-interceptor";

/**
 * TASK-W.4：运行时违规按合同隔离存放。
 *
 * 路径：`.stagent/guard/<contractId>/gateway-violation.json`
 * - 只影响该合同；
 * - 记录 contract_revision，新建合同或 revision 变化后旧记录自动失效；
 * - 清除只能走用户侧 API（daemon 端点），Worker 没有删除通道。
 */

export interface StoredGatewayViolation {
  contract_id: string;
  contract_revision: number;
  violation: GatewayViolation;
}

function violationDir(repoRoot: string, contractId: string): string {
  return path.join(repoRoot, ".stagent", "guard", contractId);
}

export function violationPath(repoRoot: string, contractId: string): string {
  return path.join(
    violationDir(repoRoot, contractId),
    "gateway-violation.json",
  );
}

export function saveGatewayViolation(
  repoRoot: string,
  contractId: string,
  contractRevision: number,
  violation: GatewayViolation,
): void {
  const dir = violationDir(repoRoot, contractId);
  fs.mkdirSync(dir, { recursive: true });
  const payload: StoredGatewayViolation = {
    contract_id: contractId,
    contract_revision: contractRevision,
    violation,
  };
  fs.writeFileSync(
    violationPath(repoRoot, contractId),
    JSON.stringify(payload, null, 2),
  );
}

/** 读取并校验 revision；不匹配视为无违规（旧记录失效） */
export function loadCurrentGatewayViolation(
  repoRoot: string,
  contractId: string,
  contractRevision: number,
): GatewayViolation | null {
  try {
    const raw = fs.readFileSync(violationPath(repoRoot, contractId), "utf-8");
    const parsed = JSON.parse(raw) as StoredGatewayViolation;
    if (
      parsed.contract_id !== contractId ||
      parsed.contract_revision !== contractRevision
    ) {
      return null;
    }
    return parsed.violation;
  } catch {
    return null;
  }
}

/** 用户显式清除（Worker 无此入口） */
export function clearGatewayViolation(
  repoRoot: string,
  contractId: string,
): boolean {
  const file = violationPath(repoRoot, contractId);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

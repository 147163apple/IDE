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

const SAFE_CONTRACT_ID = /^[A-Za-z0-9_-]+$/;

/** 合同 ID 白名单：拒绝路径分隔符、`..` 与任何非 [A-Za-z0-9_-] 字符 */
export function assertSafeContractId(contractId: string): void {
  if (!SAFE_CONTRACT_ID.test(contractId)) {
    throw new Error(`Unsafe contract id for violation store: ${contractId}`);
  }
}

function violationDir(repoRoot: string, contractId: string): string {
  assertSafeContractId(contractId);
  const base = path.resolve(repoRoot, ".stagent", "guard");
  const dir = path.resolve(base, contractId);
  // 双保险：即使白名单被放宽，也不允许解析结果跳出 guard 根
  if (dir === base || !dir.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Violation path escapes guard root: ${contractId}`);
  }
  return dir;
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
  const target = violationPath(repoRoot, contractId);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    // 原子替换：进程骤死时目标文件要么是旧完整 JSON，要么是新完整 JSON
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 清理尽力而为
    }
    throw err;
  }
}

/** 读取并校验 revision；不匹配视为无违规（旧记录失效） */
export function loadCurrentGatewayViolation(
  repoRoot: string,
  contractId: string,
  contractRevision: number,
): GatewayViolation | null {
  assertSafeContractId(contractId);
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
  assertSafeContractId(contractId);
  const file = violationPath(repoRoot, contractId);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

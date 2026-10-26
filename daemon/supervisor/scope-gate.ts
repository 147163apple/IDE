import {
  gradeWritableScope,
  type GradeWritableScopeResult,
} from "../../src/lib/writable-scope-grade";
import { isGreenfieldRepo } from "./rules-l0";

/**
 * TASK-C.22 / SSOT v2.0.2 §4.2：合同准入与签署共用的 Scope 策略门。
 *
 * 这是“策略门”，不是路径越界门；真正逐文件写入拦截仍在 Gateway。
 * 放在 Daemon HTTP 层，保证 UI、脚本与重试都不能绕过裸通配拒绝。
 */

export class WritableScopePolicyError extends Error {
  readonly code = "E_WRITABLE_SCOPE_POLICY";
  readonly rejected: GradeWritableScopeResult["rejected"];
  constructor(result: GradeWritableScopeResult) {
    super(
      `可写范围违反通配符分级：${result.rejected
        .map((item) => `${item.path} (${item.kind})`)
        .join("、")}`,
    );
    this.name = "WritableScopePolicyError";
    this.rejected = result.rejected;
  }
}

export function evaluateContractScope(
  repoRoot: string,
  writablePaths: readonly string[],
): GradeWritableScopeResult & { greenfield: boolean } {
  const greenfield = isGreenfieldRepo(repoRoot);
  const result = gradeWritableScope({
    writable_paths: writablePaths,
    greenfield,
  });
  return { ...result, greenfield };
}

export function assertContractScopeAllowed(
  repoRoot: string,
  writablePaths: readonly string[],
): GradeWritableScopeResult & { greenfield: boolean } {
  const result = evaluateContractScope(repoRoot, writablePaths);
  if (!result.ok) throw new WritableScopePolicyError(result);
  return result;
}

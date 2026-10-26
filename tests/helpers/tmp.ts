import fs from "node:fs";
import path from "node:path";

/**
 * 受限环境的 safe-delete 垫片：同一轮内累计删除超过阈值后，会用
 * `SAFE_DELETE_*`（例如 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`）拒绝后续删除。
 *
 * 这条错误不是仓库代码产生的（`git grep SAFE_DELETE -- src daemon` 为空），
 * 而是执行环境的配额策略。测试的临时目录清理属于「跑完就扔」，
 * 环境拒绝删除不该让用例变红；但**其它**删除错误必须照常抛出，
 * 否则真实的文件系统 bug 会被 `catch {}` 吞掉。
 */
const SAFE_DELETE_MARKER = "SAFE_DELETE_";

/**
 * 清理时偶尔会撞上「目录刚被删一半、子进程还在收尾」的瞬时错误（全量跑偶发）。
 * 这类不是环境配额，也不是代码 bug：短暂等待后重试即可；仍然失败就照常抛出。
 */
const TRANSIENT_RM_CODES = new Set(["EBUSY", "ENOTEMPTY"]);

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 删除临时目录 / 临时文件；被环境的 safe-delete 垫片拒绝时返回 `false`。
 *
 * 返回值给调用方一个判断依据：
 * - 绝大多数用例（断言日志内容、HTTP 响应等）直接忽略返回值，清理失败不影响结论；
 * - 只有断言本身就是「盘上文件已消失」的用例，才应该在 `false` 时降级为跳过，
 *   因为此时观测不到删除结果不是代码的问题（见 `diskDeleteBlocked()`）。
 */
export function safeRmSync(target: string): boolean {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(SAFE_DELETE_MARKER)) return false;
      const code = errorCode(error);
      if (attempt < 2 && code !== undefined && TRANSIENT_RM_CODES.has(code)) {
        sleepSync(20 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}

/**
 * 探测当前环境是否拒绝删除：写一个探针文件后尝试删除，删不掉即判定被拒。
 *
 * 不要缓存结果——垫片是按「本轮累计删除次数」触发的，同一轮里前半段能删、
 * 后半段被拒是正常现象（这正是全量跑才偶发的原因）。
 */
export function diskDeleteBlocked(): boolean {
  const base = path.join(process.cwd(), ".tmp", "unit-safe-delete-probe");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "probe-"));
  const probe = path.join(dir, "probe.lock");
  fs.writeFileSync(probe, "probe");
  try {
    fs.rmSync(probe, { force: true });
  } catch {
    /* 被环境拒绝：下面按 existsSync 判定 */
  }
  const blocked = fs.existsSync(probe);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 同上：清理探针本身失败不影响判定 */
  }
  return blocked;
}

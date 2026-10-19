import fs from "node:fs";
import path from "node:path";

/**
 * Vitest 全局 setup：把测试进程的临时目录重定向到仓库内 `.tmp/`。
 *
 * 原因（可复现的环境事实，非代码缺陷）：
 * 本仓库的 daemon/integration 测试大量使用 `os.tmpdir()` 建立临时 git 仓库与
 * Worktree（见 tests/daemon/*.test.ts 的 mkdtempSync(os.tmpdir())）。
 * 在受限执行环境（沙箱只允许删除工作区内文件）下，`fs.rmSync`/`git init` 会因
 * `EPERM: operation not permitted, unlink '/var/folders/...'` 而失败，
 * 表现为「断言全过但 afterEach 清理抛错」。把临时根目录搬到工作区内即可消除。
 *
 * 该设置同时带来两个工程收益：
 * 1. 测试不再污染系统临时目录，清理失败也不会残留跨用户可见文件；
 * 2. `.tmp/` 已在 .gitignore 中，不会污染工作树。
 *
 * 注意：这里只设置 `TMPDIR` 环境变量，不改写 `os.tmpdir` 实现，
 * 因此对所有子进程（含被测试代码 spawn 的 git / npm）同样生效。
 */
export default function setup(): void {
  const tmpRoot = path.join(process.cwd(), ".tmp", "vitest");
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env["TMPDIR"] = tmpRoot;
  process.env["TMP"] = tmpRoot;
  process.env["TEMP"] = tmpRoot;
}

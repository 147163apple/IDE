import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * TASK-P.1 新增的静态闸门（用户要求）：
 * 全仓只有 daemon/worker/cli-host 可以启动外部进程；cli-host 之外的历史遗留启动点
 * 逐一列白（后续逐步迁移，迁移完成一条就从白名单删一条）。
 *
 * 任何新文件一旦 import node:child_process 或调用 spawn/exec 系列，本测试直接失败。
 * 修复方式二选一：
 *  1. 把进程启动挪进 daemon/worker/cli-host/（推荐）；
 *  2. 确属受控例外：在下面 LEGACY_ALLOWLIST 增加一条并写明理由与迁移计划。
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["daemon", "src", "bin"];
const SOURCE_EXTS = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs"]);

interface LegacyAllowance {
  file: string;
  module: string;
  reason: string;
}

const LEGACY_ALLOWLIST: LegacyAllowance[] = [
  {
    file: "daemon/git/worktree-manager.ts",
    module: "daemon/git",
    reason: "git 命令封装 execGit（worktree/分支操作）",
  },
  {
    file: "daemon/editor/launcher.ts",
    module: "daemon/editor",
    reason: "调起外部编辑器",
  },
  {
    file: "daemon/server.ts",
    module: "daemon/server",
    reason: "Diff API 的 git diff（execFileSync）",
  },
  {
    file: "daemon/runner/process-tree.ts",
    module: "daemon/runner",
    reason: "Windows 进程树回收（taskkill/tasklist）",
  },
  {
    file: "daemon/runner/command-runner.ts",
    module: "daemon/runner",
    reason: "合同验证命令执行",
  },
  {
    file: "daemon/pipeline/orchestrator.ts",
    module: "daemon/pipeline",
    reason: "worktree 依赖安装与 git 同步",
  },
  {
    file: "bin/stagent.ts",
    module: "bin",
    reason: "CLI 唤起浏览器",
  },
];

const CLI_HOST_PREFIX = "daemon/worker/cli-host/";

const CHILD_PROCESS_PATTERN =
  /(?:from\s+["']node:child_process["']|require\(\s*["'](?:node:)?child_process["']\s*\))/;
/**
 * 无 import 的兜底检测：只认明确的进程启动 API，且排除 `xxx.exec(` 这类方法调用
 * （例如 RegExp.prototype.exec），否则正则、解析器会误报。
 */
const SPAWN_CALL_PATTERN =
  /(?<![.\w])(?:spawn|spawnSync|execFile|execFileSync|execSync|fork)\s*\(/;

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(abs, out);
    } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
      out.push(abs);
    }
  }
}

function relOf(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join("/");
}

describe("进程启动白名单（TASK-P.1）", () => {
  it("cli-host 与 6 个历史遗留模块之外，不得出现新的 child_process 用法", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(path.join(REPO_ROOT, dir), files);

    const allowed = new Set(LEGACY_ALLOWLIST.map((a) => a.file));
    const offenders: string[] = [];

    for (const abs of files) {
      const rel = relOf(abs);
      if (rel.startsWith(CLI_HOST_PREFIX) || allowed.has(rel)) continue;
      const content = fs.readFileSync(abs, "utf8");
      if (!CHILD_PROCESS_PATTERN.test(content)) {
        // 没有 import 但直接调用 spawn/exec 的，同样算违规
        if (SPAWN_CALL_PATTERN.test(content))
          offenders.push(`${rel}（未 import 但调用了 spawn/exec）`);
        continue;
      }
      offenders.push(rel);
    }

    expect(
      offenders,
      `只有 daemon/worker/cli-host 可以启动外部进程。以下文件是新增的启动点：\n` +
        offenders.map((f) => `  - ${f}`).join("\n") +
        `\n请挪进 cli-host，或在 tests/unit/spawn-whitelist.test.ts 的 LEGACY_ALLOWLIST 登记理由与迁移计划。`,
    ).toEqual([]);
  });

  it("白名单里的模块仍存在（迁移后请同步删除条目，避免白名单腐化）", () => {
    for (const item of LEGACY_ALLOWLIST) {
      expect(fs.existsSync(path.join(REPO_ROOT, item.file)), item.file).toBe(
        true,
      );
    }
  });

  it("保护清单模块自身不启动任何外部进程", () => {
    const dir = path.join(REPO_ROOT, "daemon", "protection");
    const files = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".ts"))
      .map((n) => fs.readFileSync(path.join(dir, n), "utf8"));
    for (const content of files) {
      expect(CHILD_PROCESS_PATTERN.test(content)).toBe(false);
    }
  });
});

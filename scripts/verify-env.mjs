#!/usr/bin/env node
/**
 * Stagent 跨平台环境检测与工程门禁脚本 (TASK-0.1)
 *
 * 用法:
 *   node scripts/verify-env.mjs             # 环境门槛校验 + typecheck + lint + test
 *   node scripts/verify-env.mjs --env-only  # 仅环境门槛校验（CI 安装依赖前使用）
 *
 * 验收判据 (规范 TASK-0.1 PASS-2):
 *   - 输出平台矩阵（操作系统、Node、Git 版本）
 *   - 强制 Node >= 20.x, Git >= 2.30，未达标退出码 1
 *   - 跨平台: Windows / macOS / Linux 均可运行（无 shell 依赖）
 */
import { execFileSync } from "node:child_process";
import { platform, arch } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_ONLY = process.argv.includes("--env-only");

const MIN_NODE_MAJOR = 20;
const MIN_GIT = [2, 30, 0];

function getVersion(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function parseSemver(text) {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function gte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

console.log("=== [Stagent] Environment Verification ===");
console.log(`Repo Root : ${REPO_ROOT}`);
console.log(`OS        : ${platform()} (${arch()})`);

const nodeVer = process.version;
const npmVer = getVersion("npm", ["-v"]) ?? "N/A";
const gitVerRaw = getVersion("git", ["--version"]);

console.log(`Node.js   : ${nodeVer}`);
console.log(`npm       : ${npmVer}`);
console.log(`Git       : ${gitVerRaw ?? "NOT FOUND"}`);

let failed = false;

const nodeMajor = Number(nodeVer.replace(/^v/, "").split(".")[0]);
if (nodeMajor < MIN_NODE_MAJOR) {
  console.error(
    `FAIL: Node.js >= ${MIN_NODE_MAJOR}.x required, got ${nodeVer}`,
  );
  failed = true;
}

const gitVer = gitVerRaw ? parseSemver(gitVerRaw) : null;
if (!gitVer) {
  console.error("FAIL: Git is not installed or not on PATH.");
  failed = true;
} else if (!gte(gitVer, MIN_GIT)) {
  console.error(
    `FAIL: Git >= ${MIN_GIT.join(".")} required, got ${gitVer.join(".")}`,
  );
  failed = true;
}

if (failed) {
  console.error("=== Environment verification FAILED ===");
  process.exit(1);
}
console.log("=== Environment OK ===");

if (!ENV_ONLY) {
  const run = (label, cmd, args) => {
    console.log(`--- ${label} ---`);
    execFileSync(cmd, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: platform() === "win32",
    });
  };
  run("1. TypeScript typecheck", "npx", ["tsc", "--noEmit"]);
  run("2. Lint", "npm", ["run", "lint"]);
  run("3. Unit tests", "npm", ["test"]);
  console.log("=== All verifications passed successfully! ===");
}

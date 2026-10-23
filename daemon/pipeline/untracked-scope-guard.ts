import { execGit } from "../git/worktree-manager";
import type { ErrorCode } from "../../src/lib/error-codes";
import {
  checkWriteAccess,
  type FileSystemScope,
  type ScopeViolationReason,
} from "../../src/lib/scope";

/**
 * TASK-W.2b：未跟踪文件（untracked）Scope 守卫。
 *
 * 为什么需要独立于网关：
 * 网关（ScopedWorktreeGateway）只能约束**经过它**的写入。成熟 CLI Agent、
 * 验证阶段跑起来的测试脚本、以及用户在外部编辑器的操作，都可能绕开网关
 * 直接在 Worktree 内落盘。这类产物 `git diff` 完全看不见（未跟踪文件不在
 * 索引里），却会随 `git add -A` 一起进入任务提交——这正是 P-18 指出的盲区。
 *
 * 判据（对齐架构规范 §3.2.2 / §7.2 的 D-2 门禁）：
 * 以 `git status --porcelain -uall` 枚举 Worktree 内全部未跟踪文件
 * （`-uall` 保证目录不折叠，`tests/` 不会被退化成一条 `tests/`），
 * 逐个比对合同 `authorization.file_system_scope`，任何越界即整轮阻断。
 *
 * 边界声明：本模块只做**执行侧**检测与阻断，合并门禁（TASK-D.2b）另司其职；
 * 执行侧阻断后合同不会进入 `AUDITED`，`can_merge` 因此天然为 false。
 */

/** 未跟踪文件越界错误码（编译期保证已登记进 §9.3 目录） */
export const E_OUT_OF_SCOPE_UNTRACKED =
  "E_OUT_OF_SCOPE_UNTRACKED" satisfies ErrorCode;

/** 检测点：执行前（提交前捕获）与验收后（验证命令副作用捕获） */
export type UntrackedScopePhase = "PRE_EXECUTION" | "POST_VERIFICATION";

export interface UntrackedViolation {
  /** Worktree 相对路径 */
  path: string;
  /** 复用 scope.ts 的拒绝原因，避免两套语义 */
  reason: ScopeViolationReason;
  message: string;
}

export interface UntrackedScopeReport {
  phase: UntrackedScopePhase;
  /** 实际参与 Scope 校验的路径（已排序、去重） */
  inspected: string[];
  /** Daemon 自身挂载的受控副产物，不计入 Worker 越权 */
  skipped: string[];
  violations: UntrackedViolation[];
  passed: boolean;
}

/**
 * Daemon 自己在 Worktree 内创建的受控副产物（ADR-002 依赖零拷贝挂载）。
 * 它们由 Daemon 而非 Worker 产生，若把它们算作越权会让每次执行都误报。
 * 注意：这是**极窄的白名单**，只含顶层目录前缀，不做任何通配。
 */
const DAEMON_MANAGED_PREFIXES: readonly string[] = [
  "node_modules/",
  ".stagent/",
];

function isDaemonManaged(relativePath: string): boolean {
  const probe = relativePath.endsWith("/") ? relativePath : `${relativePath}/`;
  return DAEMON_MANAGED_PREFIXES.some(
    (prefix) => probe === prefix || probe.startsWith(prefix),
  );
}

/** git 在 core.quotePath 下的 C 风格转义表 */
const C_ESCAPES: Readonly<Record<string, string>> = {
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  '"': '"',
  "\\": "\\",
};

/**
 * 还原 `git status` 中带引号的路径。
 *
 * git 会在路径含特殊字符（换行、制表、双引号）或非 ASCII（core.quotePath
 * 默认开启）时整体加引号，并用 `\t` 或三位八进制转义字节。八进制是按
 * **字节**编码 UTF-8 的，所以必须走 Buffer 还原，否则中文路径会变成乱码。
 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  let sawOctal = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      bytes.push(ch.charCodeAt(0) & 0xff);
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      bytes.push(0x5c);
      break;
    }
    const mapped = C_ESCAPES[next];
    if (mapped !== undefined) {
      for (const byte of Buffer.from(mapped, "utf8")) bytes.push(byte);
      i += 1;
      continue;
    }
    const octal = body.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      sawOctal = true;
      i += 3;
      continue;
    }
    for (const byte of Buffer.from(next, "utf8")) bytes.push(byte);
    i += 1;
  }

  // 无八进制转义时按字符还原即可，避免把字面 UTF-8 再做一次字节重解码
  if (!sawOctal) {
    return body.replace(/\\(.)/g, (_all, ch: string) => C_ESCAPES[ch] ?? ch);
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * 解析 `git status --porcelain -uall` 输出中的未跟踪文件路径。
 *
 * porcelain v1 的未跟踪行固定为 `?? <path>`；路径含空格时**不加引号**，
 * 因此必须整段取 `slice(3)`，绝不能按空白切分。
 */
export function parseUntrackedPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const rawLine of porcelain.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("?? ")) continue;
    const decoded = unquoteGitPath(line.slice(3)).replace(/\/+$/, "");
    if (decoded) paths.push(decoded);
  }
  return [...new Set(paths)];
}

/** 采集 Worktree 内全部未跟踪文件（目录不折叠） */
export async function captureUntrackedPaths(
  worktreePath: string,
): Promise<string[]> {
  const res = await execGit(["status", "--porcelain", "-uall"], worktreePath);
  if (res.exitCode !== 0) {
    // 采集失败必须显式失败：静默返回空数组会让门禁形同虚设
    throw new Error(
      `git status --porcelain -uall failed in '${worktreePath}': ${
        res.stderr.trim() || res.stdout.trim() || `exit ${res.exitCode}`
      }`,
    );
  }
  return parseUntrackedPaths(res.stdout);
}

/** 纯函数校验：把未跟踪路径逐个比对合同文件系统授权 */
export function auditUntrackedScope(
  paths: readonly string[],
  scope: FileSystemScope,
  phase: UntrackedScopePhase,
): UntrackedScopeReport {
  const inspected: string[] = [];
  const skipped: string[] = [];
  const violations: UntrackedViolation[] = [];

  for (const path of [...paths].sort()) {
    if (isDaemonManaged(path)) {
      skipped.push(path);
      continue;
    }
    inspected.push(path);
    const access = checkWriteAccess(path, scope);
    if (access.allowed) continue;
    violations.push({
      path,
      reason: access.reason ?? "NOT_WRITABLE",
      message:
        access.message ?? `Untracked path '${path}' is outside writable_paths`,
    });
  }

  return {
    phase,
    inspected,
    skipped,
    violations,
    passed: violations.length === 0,
  };
}

/** 采集 + 校验：执行侧的唯一入口 */
export async function enforceUntrackedScope(options: {
  worktreePath: string;
  scope: FileSystemScope;
  phase: UntrackedScopePhase;
}): Promise<UntrackedScopeReport> {
  const paths = await captureUntrackedPaths(options.worktreePath);
  return auditUntrackedScope(paths, options.scope, options.phase);
}

/** 面向非技术用户的白话摘要（写入 Evidence.verdict.summary） */
export function describeUntrackedViolations(
  report: UntrackedScopeReport,
): string {
  const head = report.phase === "PRE_EXECUTION" ? "执行前检查" : "验收前检查";
  const list = report.violations
    .slice(0, 5)
    .map((v) => v.path)
    .join("、");
  const more =
    report.violations.length > 5 ? ` 等 ${report.violations.length} 处` : "";
  return (
    `${head}发现 ${report.violations.length} 个未授权的新建文件：${list}${more}。` +
    "这些文件不在本次合同允许写入的范围内，可能绕过了受控写入通道；" +
    "已阻断本次验收结论，不会合入你的项目。请移除这些文件，或走合同升版重新授权。"
  );
}

/**
 * 未跟踪文件越界：不可恢复的执行侧阻断。
 * 携带完整清单，供控制面生成可追溯的 BLOCKED 证据。
 */
export class UntrackedScopeViolationError extends Error {
  readonly code: typeof E_OUT_OF_SCOPE_UNTRACKED = E_OUT_OF_SCOPE_UNTRACKED;
  readonly phase: UntrackedScopePhase;
  readonly violations: UntrackedViolation[];

  constructor(report: UntrackedScopeReport) {
    super(
      `[${E_OUT_OF_SCOPE_UNTRACKED}] ${describeUntrackedViolations(report)}`,
    );
    this.name = "UntrackedScopeViolationError";
    this.phase = report.phase;
    this.violations = report.violations;
  }
}

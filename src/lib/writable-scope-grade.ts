/**
 * TASK-C.22 / SSOT §4.2：通配符分级。
 *
 * - 老项目：禁顶层裸通配（形如 src 下一层通配、全仓通配）
 * - 绿野/新模块：允许模块级子目录通配（如 src/features/finance 下通配）
 * - 落盘后尽量收敛为具体文件 manifest
 */

import { normalizePath, matchesAnyPattern } from "./scope";

export type WritablePatternKind =
  "exact" | "module_subdir_glob" | "bare_top_glob" | "sensitive_forbidden";

const SENSITIVE_PREFIXES = [
  ".env",
  ".git/",
  ".stagent/",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

/** 顶层目录名（裸通配禁区） */
const TOP_LEVEL_DIRS = new Set([
  "src",
  "lib",
  "app",
  "apps",
  "packages",
  "tests",
  "test",
  "daemon",
  "bin",
  "docs",
  "scripts",
  "public",
  "assets",
]);

export function classifyWritablePattern(raw: string): WritablePatternKind {
  const p = normalizePath(raw);
  if (!p) return "exact";

  for (const s of SENSITIVE_PREFIXES) {
    if (
      p === s ||
      p.startsWith(s) ||
      p.includes(`/${s}`) ||
      p.startsWith("**/" + s.replace(/\/$/, ""))
    ) {
      // 敏感路径出现在 writable 里一律敏感禁写分类（由上层拒）
      if (
        p.startsWith(".env") ||
        p.includes(".git") ||
        p.includes(".stagent") ||
        /(?:^|\/)package-lock\.json$/.test(p) ||
        /(?:^|\/)pnpm-lock\.yaml$/.test(p) ||
        /(?:^|\/)yarn\.lock$/.test(p)
      ) {
        return "sensitive_forbidden";
      }
    }
  }

  const hasGlob = p.includes("*");
  if (!hasGlob) return "exact";

  // 裸：* / ** / **/* / *
  if (p === "*" || p === "**" || p === "**/*" || p === "*/**") {
    return "bare_top_glob";
  }

  // 顶层裸通配：src/**、src/*、tests/** 等（仅一段目录 + 通配）
  // 用 String#match 而非正则对象上的 exec 方法：后者会被进程启动扫描误判。
  const bareTop = p.match(/^([^/]+)\/\*\*?$/);
  if (bareTop) {
    const top = bareTop[1]!;
    if (TOP_LEVEL_DIRS.has(top) || top === "*") {
      return "bare_top_glob";
    }
  }
  // src/**/** 之类也算裸
  if (/^[^/]+\/\*\*(\/\*\*)?$/.test(p) && !p.split("/").length) {
    return "bare_top_glob";
  }

  // 模块级子目录：至少两级路径后再通配，如 src/features/finance/**
  const parts = p.split("/");
  const globIdx = parts.findIndex((x) => x.includes("*"));
  if (globIdx >= 2) {
    return "module_subdir_glob";
  }
  // src/components/** — 两段：src + components + ** → globIdx=2 → module
  // wait: ["src","components","**"] globIdx=2 >= 2 → module_subdir. Good.
  // ["src","**"] globIdx=1 → bare (handled above by bareTop). Good.

  if (globIdx === 1) {
    return "bare_top_glob";
  }

  return "module_subdir_glob";
}

export interface GradeWritableScopeInput {
  writable_paths: readonly string[];
  /**
   * 绿野 = 仓库里没有项目声明（Daemon 侧用 `package.json` 缺失判定，与 rules-l0 同一口径）。
   * 只有绿野才允许顶层裸通配作为脚手架种子。
   */
  greenfield?: boolean;
}

export interface GradeWritableScopeResult {
  ok: boolean;
  rejected: { path: string; kind: WritablePatternKind; reason: string }[];
  accepted: { path: string; kind: WritablePatternKind }[];
}

/** 全仓通配没有任何安全的顶层段，永远拒绝（即使绿野也不行）。 */
function isWholeRepoGlob(raw: string): boolean {
  const p = normalizePath(raw);
  return p === "*" || p === "**" || p === "**/*" || p === "*/**";
}

/**
 * 签署时的 Scope 分级校验。
 *
 * - `sensitive_forbidden`：任何形态、任何项目一律拒绝；
 * - `bare_top_glob`（`src/**`、`tests/**` 这类）：**老项目全拒**；绿野放行作为脚手架种子；
 *   全仓通配（`*`、`**`，以及 `**` 后接一层通配）即使在绿野也拒绝；
 * - `module_subdir_glob` / `exact`：接受（落盘后由 `convergeWritableManifest` 收敛）。
 *
 * 判据为什么是「有没有项目声明」而不是「目标目录是否存在」：
 * 本仓库 40+ 处夹具都以 `src/**` 为常规写法，非 npm 工程（Python/Go/纯脚本）同样如此；
 * 用目录存在性判会把这类工程一律判死。真正的风险面是「已有工程声明却仍要整目录可写」——
 * 那才是保护清单与 diff 审阅同时失效的场景。
 */
export function gradeWritableScope(
  input: GradeWritableScopeInput,
): GradeWritableScopeResult {
  const rejected: GradeWritableScopeResult["rejected"] = [];
  const accepted: GradeWritableScopeResult["accepted"] = [];
  const greenfield = input.greenfield === true;

  for (const raw of input.writable_paths) {
    const kind = classifyWritablePattern(raw);
    if (kind === "sensitive_forbidden") {
      rejected.push({
        path: raw,
        kind,
        reason: "敏感路径不得写入 writable_paths",
      });
      continue;
    }
    if (kind === "bare_top_glob") {
      if (isWholeRepoGlob(raw)) {
        rejected.push({
          path: raw,
          kind,
          reason:
            "禁止全仓通配（会覆盖 .stagent、锁文件与全部源码）；请收敛到具体模块目录",
        });
        continue;
      }
      if (greenfield) {
        accepted.push({ path: raw, kind });
        continue;
      }
      rejected.push({
        path: raw,
        kind,
        reason:
          "老项目禁止顶层裸通配（会覆盖既有代码）；请收敛到精确文件或模块级子目录（如 src/features/foo/**）",
      });
      continue;
    }
    accepted.push({ path: raw, kind });
  }

  return { ok: rejected.length === 0, rejected, accepted };
}

/**
 * 落盘收敛：用已写入的具体文件替换仍为 glob 的 writable 项。
 * 保留 exact；glob 被其匹配到的 writtenFiles 替换；无命中则保留原 glob（尚未创建）。
 */
export function convergeWritableManifest(
  writable_paths: readonly string[],
  writtenFiles: readonly string[],
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const pattern of writable_paths) {
    const kind = classifyWritablePattern(pattern);
    if (kind === "exact") {
      const n = normalizePath(pattern);
      if (!seen.has(n)) {
        seen.add(n);
        result.push(n);
      }
      continue;
    }
    const matched = writtenFiles
      .map(normalizePath)
      .filter((f) => matchesAnyPattern(f, [pattern]).matches);
    if (matched.length === 0) {
      // 尚无落盘文件：保留原通配种子
      if (!seen.has(pattern)) {
        seen.add(pattern);
        result.push(pattern);
      }
      continue;
    }
    for (const f of matched) {
      if (!seen.has(f)) {
        seen.add(f);
        result.push(f);
      }
    }
  }
  return result;
}

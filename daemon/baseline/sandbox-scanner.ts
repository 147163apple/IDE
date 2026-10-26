/**
 * TASK-C.14a：只读沙盒静态扫描器（P0 骨架）。
 *
 * 硬约束：
 * - 禁止动态执行用户项目脚本（不做 require/import 项目配置、不跑 Vite/Webpack）
 * - 不发起网络（network_denied）；扫描过程中若探测到出网意图则阻断
 * - 约 3s 超时熔断；P0 目标 T+0~2s
 * - 不写入用户业务树；侧车写入由 store 负责
 * - 输出经 redactDeep（EO-04）
 */
import fs from "node:fs";
import path from "node:path";
import { redactDeep } from "../../src/lib/ipc/redaction";
import type { BaselineP0Skeleton } from "./types";

export const P0_TIMEOUT_MS = 3_000 as const;
export const P0_TARGET_MS = 2_000 as const;

/** TASK-H.3：文件数硬上限（可测注入覆盖） */
export const SCAN_MAX_FILES = 5_000 as const;
/** TASK-H.3：目录深度硬上限（根=0） */
export const SCAN_MAX_DEPTH = 6 as const;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".stagent",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

/** 扫描器内部「断网」标记：任何出网探测应失败 */
export class BaselineNetworkDeniedError extends Error {
  readonly code = "E_BASELINE_NETWORK_DENIED" as const;
  constructor(message = "基线扫描沙盒禁止出网") {
    super(message);
    this.name = "BaselineNetworkDeniedError";
  }
}

/**
 * 沙盒出网探测钩子：生产扫描路径不得调用；单测用它证明「出网被阻断」。
 */
export function assertBaselineNetworkDenied(_url?: string): never {
  throw new BaselineNetworkDeniedError();
}

/**
 * 拒绝动态执行项目脚本。单测用副作用 fixture 证明不会走到这里。
 * 扫描实现不得 `require`/`import` 用户项目内的 vite/webpack/config。
 */
export function assertNoDynamicProjectExec(relPath: string): never {
  throw new Error(
    `基线扫描禁止动态执行项目脚本: ${relPath}`,
  );
}

function safeReadText(abs: string, maxBytes = 256_000): string | null {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > maxBytes) return null;
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function listTopLevel(repoRoot: string): string[] {
  try {
    return fs
      .readdirSync(repoRoot, { withFileTypes: true })
      .filter((d) => !SKIP_DIR_NAMES.has(d.name) && !d.name.startsWith("."))
      .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
      .sort()
      .slice(0, 80);
  } catch {
    return [];
  }
}

/** 静态文本抽取路由线索（不做 AST Program、不执行配置） */
function extractRouteClues(repoRoot: string, deadline: number): string[] {
  const clues = new Set<string>();
  const candidates = [
    "src/routes",
    "src/app",
    "app",
    "pages",
    "src/pages",
    "routes",
  ];
  const routeRe =
    /(?:path\s*:\s*['"`]([^'"`]+)['"`]|create(?:File|Root)?Route\(|Route\s*\(|['"`](\/[A-Za-z0-9_\-/*:]+)['"`])/g;

  for (const rel of candidates) {
    if (Date.now() > deadline) break;
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    walkFiles(abs, deadline, (file) => {
      if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(file)) return;
      const text = safeReadText(file, 120_000);
      if (!text) return;
      // 绝不 eval / new Function / require 此文件
      let m: RegExpExecArray | null;
      routeRe.lastIndex = 0;
      while ((m = routeRe.exec(text)) !== null) {
        const raw = m[1] ?? m[2];
        if (raw && raw.startsWith("/")) clues.add(raw);
        if (clues.size >= 40) return;
      }
      const base = path.basename(file).replace(/\.(tsx?|jsx?)$/, "");
      if (base && base !== "index" && base !== "routeTree.gen") {
        clues.add(`~/${rel}/${base}`);
      }
    });
  }
  return [...clues].slice(0, 40);
}

function extractModuleEntries(repoRoot: string): string[] {
  const out: string[] = [];
  const pkgPath = path.join(repoRoot, "package.json");
  const raw = safeReadText(pkgPath, 64_000);
  if (!raw) return out;
  try {
    const pkg = JSON.parse(raw) as {
      main?: string;
      module?: string;
      exports?: unknown;
      bin?: unknown;
    };
    if (typeof pkg.main === "string") out.push(pkg.main);
    if (typeof pkg.module === "string") out.push(pkg.module);
    if (typeof pkg.bin === "string") out.push(pkg.bin);
    else if (pkg.bin && typeof pkg.bin === "object") {
      for (const v of Object.values(pkg.bin as Record<string, string>)) {
        if (typeof v === "string") out.push(v);
      }
    }
  } catch {
    // JSON 坏了只记线索缺失，不抛
  }
  return out.slice(0, 20);
}

export type ScanTruncateReason =
  | "max_files"
  | "max_depth"
  | "timeout"
  | null;

export interface WalkCapState {
  filesSeen: number;
  truncated: boolean;
  truncateReason: ScanTruncateReason;
  maxFiles: number;
  maxDepth: number;
}

function createWalkCapState(options?: {
  maxFiles?: number | undefined;
  maxDepth?: number | undefined;
}): WalkCapState {
  return {
    filesSeen: 0,
    truncated: false,
    truncateReason: null,
    maxFiles: options?.maxFiles ?? SCAN_MAX_FILES,
    maxDepth: options?.maxDepth ?? SCAN_MAX_DEPTH,
  };
}

function walkFiles(
  dir: string,
  deadline: number,
  onFile: (abs: string) => void,
  depth = 0,
  cap?: WalkCapState,
  now: () => number = Date.now,
): void {
  const state = cap ?? createWalkCapState();
  if (now() > deadline) {
    state.truncated = true;
    state.truncateReason = state.truncateReason ?? "timeout";
    return;
  }
  if (depth > state.maxDepth) {
    state.truncated = true;
    state.truncateReason = state.truncateReason ?? "max_depth";
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (now() > deadline) {
      state.truncated = true;
      state.truncateReason = state.truncateReason ?? "timeout";
      return;
    }
    if (state.filesSeen >= state.maxFiles) {
      state.truncated = true;
      state.truncateReason = state.truncateReason ?? "max_files";
      return;
    }
    if (SKIP_DIR_NAMES.has(ent.name) || ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(abs, deadline, onFile, depth + 1, state, now);
      if (state.truncated && state.truncateReason === "max_files") return;
    } else if (ent.isFile()) {
      state.filesSeen += 1;
      if (state.filesSeen > state.maxFiles) {
        state.truncated = true;
        state.truncateReason = "max_files";
        return;
      }
      onFile(abs);
    }
  }
}

export function truncatePlainMessage(reason: ScanTruncateReason): string | null {
  if (reason === "max_files") {
    return "扫描已截断：文件数达到上限，仅保留已探查部分（项目过大时属正常保护）。";
  }
  if (reason === "max_depth") {
    return "扫描已截断：目录深度达到上限，深层文件夹未继续展开。";
  }
  if (reason === "timeout") {
    return "扫描已截断：探查超时，已保留超时前结果。";
  }
  return null;
}

export interface RunP0ScanOptions {
  repoRoot: string;
  /** 覆盖超时（测试） */
  timeoutMs?: number;
  now?: () => number;
  /** TASK-H.3 测试可注入更小上限 */
  maxFiles?: number;
  maxDepth?: number;
}

/**
 * 同步跑 P0 骨架。绝不动态执行项目脚本、不触网。
 */
export function runP0SkeletonScan(options: RunP0ScanOptions): BaselineP0Skeleton {
  const now = options.now ?? Date.now;
  const started = now();
  const timeoutMs = options.timeoutMs ?? P0_TIMEOUT_MS;
  const deadline = started + timeoutMs;
  const repoRoot = path.resolve(options.repoRoot);

  const scanned_paths_note = [
    "package.json",
    "顶层目录（跳过 node_modules/.git/.stagent 等）",
    "routes/pages 静态文本线索（若存在）",
  ];

  let package_name: string | null = null;
  let package_version: string | null = null;
  const pkgRaw = safeReadText(path.join(repoRoot, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string };
      package_name = typeof pkg.name === "string" ? pkg.name : null;
      package_version =
        typeof pkg.version === "string" ? pkg.version : null;
    } catch {
      package_name = null;
    }
  }

  // 故意不读取 / 不执行 vite.config.* / webpack.config.* —— 只记录「会读」清单
  for (const cfg of [
    "vite.config.ts",
    "vite.config.js",
    "webpack.config.js",
    ".env",
    ".env.local",
  ]) {
    if (fs.existsSync(path.join(repoRoot, cfg))) {
      scanned_paths_note.push(`${cfg}（仅检测存在，不执行、不加载）`);
    }
  }

  const top_level_entries = listTopLevel(repoRoot);
  const timed_out_before_routes = now() > deadline;
  const route_clues = timed_out_before_routes
    ? []
    : extractRouteClues(repoRoot, deadline);
  const module_entry_clues = extractModuleEntries(repoRoot);
  const timed_out = now() > deadline;
  const duration_ms = Math.max(0, now() - started);

  const cap = createWalkCapState({
    maxFiles: options.maxFiles,
    maxDepth: options.maxDepth,
  });
  walkFiles(
    repoRoot,
    deadline,
    () => {
      /* count only */
    },
    0,
    cap,
    now,
  );
  if (cap.truncated) {
    const plain = truncatePlainMessage(cap.truncateReason);
    if (plain) scanned_paths_note.push(plain);
  }

  const skeleton: BaselineP0Skeleton = {
    package_name,
    package_version,
    top_level_entries,
    route_clues,
    module_entry_clues,
    scanned_paths_note,
    duration_ms,
    timed_out: timed_out || cap.truncateReason === "timeout",
    network_denied: true,
    dynamic_exec_denied: true,
    truncated: cap.truncated,
    truncate_reason: cap.truncateReason,
    files_scanned: cap.filesSeen,
    truncate_plain: truncatePlainMessage(cap.truncateReason),
  };

  return redactDeep(skeleton).value as BaselineP0Skeleton;
}

/**
 * 深度层（P1/P2）静态加深：文件树扩展 + 测试声明计数 + 粗 import 边计数。
 * 仍禁止动态执行；带独立超时。
 */
export function runDeepStaticScan(options: {
  repoRoot: string;
  timeoutMs?: number;
  now?: () => number;
  maxFiles?: number;
  maxDepth?: number;
}): {
  structure_paths: string[];
  test_file_count: number;
  import_edge_count: number;
  duration_ms: number;
  timed_out: boolean;
  incomplete: boolean;
  /** TASK-H.3 */
  truncated: boolean;
  truncate_reason: ScanTruncateReason;
  files_scanned: number;
  truncate_plain: string | null;
} {
  const now = options.now ?? Date.now;
  const started = now();
  const timeoutMs = options.timeoutMs ?? 12_000;
  const deadline = started + timeoutMs;
  const repoRoot = path.resolve(options.repoRoot);
  const cap = createWalkCapState({
    maxFiles: options.maxFiles,
    maxDepth: options.maxDepth,
  });

  const structure_paths: string[] = [];
  let test_file_count = 0;
  let import_edge_count = 0;
  const importRe =
    /(?:import\s+[^;]+from\s+['"`]([^'"`]+)['"`]|require\s*\(\s*['"`]([^'"`]+)['"`]\s*\))/g;

  walkFiles(
    repoRoot,
    deadline,
    (file) => {
      const rel = path.relative(repoRoot, file).split(path.sep).join("/");
      if (structure_paths.length < 200) structure_paths.push(rel);
      if (/\.(test|spec)\.(tsx?|jsx?)$/.test(rel) || /\/__tests__\//.test(rel)) {
        test_file_count += 1;
      }
      if (/\.(tsx?|jsx?|mjs|cjs)$/.test(rel)) {
        const text = safeReadText(file, 80_000);
        if (!text) return;
        importRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = importRe.exec(text)) !== null) {
          import_edge_count += 1;
          if (import_edge_count > 5000) break;
        }
      }
    },
    0,
    cap,
    now,
  );

  const timed_out = now() > deadline || cap.truncateReason === "timeout";
  if (timed_out && !cap.truncated) {
    cap.truncated = true;
    cap.truncateReason = "timeout";
  }
  const incomplete = timed_out || cap.truncated;
  return {
    structure_paths,
    test_file_count,
    import_edge_count,
    duration_ms: Math.max(0, now() - started),
    timed_out,
    incomplete,
    truncated: cap.truncated,
    truncate_reason: cap.truncateReason,
    files_scanned: cap.filesSeen,
    truncate_plain: truncatePlainMessage(cap.truncateReason),
  };
}

/**
 * TASK-H.3：带硬上限的文件枚举（供 P0/单测直接断言截断）。
 */
export function runCappedFileWalk(options: {
  repoRoot: string;
  timeoutMs?: number;
  now?: () => number;
  maxFiles?: number;
  maxDepth?: number;
}): {
  files: string[];
  truncated: boolean;
  truncate_reason: ScanTruncateReason;
  files_scanned: number;
  timed_out: boolean;
  truncate_plain: string | null;
  network_denied: true;
  dynamic_exec_denied: true;
} {
  const now = options.now ?? Date.now;
  const started = now();
  const timeoutMs = options.timeoutMs ?? P0_TIMEOUT_MS;
  const deadline = started + timeoutMs;
  const repoRoot = path.resolve(options.repoRoot);
  const cap = createWalkCapState({
    maxFiles: options.maxFiles,
    maxDepth: options.maxDepth,
  });
  const files: string[] = [];
  walkFiles(
    repoRoot,
    deadline,
    (abs) => {
      files.push(path.relative(repoRoot, abs).split(path.sep).join("/"));
    },
    0,
    cap,
    now,
  );
  const timed_out = now() > deadline || cap.truncateReason === "timeout";
  if (timed_out && !cap.truncated) {
    cap.truncated = true;
    cap.truncateReason = "timeout";
  }
  return {
    files,
    truncated: cap.truncated,
    truncate_reason: cap.truncateReason,
    files_scanned: cap.filesSeen,
    timed_out,
    truncate_plain: truncatePlainMessage(cap.truncateReason),
    network_denied: true,
    dynamic_exec_denied: true,
  };
}

/**
 * TASK-J.2 / SSOT §15.3–§15.4：范围预检构建器（Daemon 侧，确定性、零模型）。
 *
 * 输入是「当前修订的方案」与用户已做的表态，输出与该修订绑定的 `ScopePlan`。
 * 设计纪律：
 * 1. **单一事实源**：可写范围的种子、禁区、脏区、保护清单全部复用既有规则
 *    （`buildL0Plan` / `gradeWritableScope`），不另起一套判定；
 * 2. **不编造路径**：自动收敛只接受仓库里**真实存在**的目录或文件；
 *    收敛不了就保留在 `grade.rejected` 里，交给 `E_SCOPE_POLICY` 说人话；
 * 3. **零模型、零时钟**：同输入必得同 `plan_digest`（SSOT S2-04）。
 */

import fs from "node:fs";
import path from "node:path";
import type {
  BudgetLimits,
  VerificationCommand,
} from "../../src/lib/contract.schema";
import type { SchemeDraft } from "../../src/lib/journey/scheme-draft";
import {
  applyScopeDecisions,
  type ScopeApprovalItem,
  type ScopeArea,
  type ScopeBudget,
  type ScopeGrade,
  type ScopeNeverTouch,
  type ScopePlan,
  type ScopePlanDecisions,
  type ScopeVerification,
} from "../../src/lib/journey/scope-plan";
import { gradeWritableScope } from "../../src/lib/writable-scope-grade";
import { intersectWithProtection } from "../protection/protection-list";
import {
  DEFAULT_DRAFT_BUDGET,
  DEFAULT_FORBIDDEN_PATHS,
  buildL0Plan,
  extractPathsFromText,
  inferIntentPaths,
  isGreenfieldRepo,
  isSafeContractPath,
} from "./rules-l0";
import type { SupervisorMessage } from "./types";

/** 方案里参与范围推断的字段（J.2 只依赖这些，不绑死整份 SchemeDraft） */
export type ScopePlanScheme = Pick<
  SchemeDraft,
  "scheme_revision" | "title" | "summary" | "modules" | "notes"
>;

export interface BuildScopePlanInput {
  repoRoot: string;
  scheme: ScopePlanScheme;
  decisions?: ScopePlanDecisions | undefined;
}

const GHOST_DIRS = new Set([
  "node_modules",
  ".git",
  ".stagent",
  "dist",
  "build",
]);

/**
 * 非 npm 的项目声明文件。`isGreenfieldRepo` 只认 package.json，
 * 对 Python / Go / Rust 工程会把「已有工程」误判成绿野，
 * 从而错误放行 `src/**` 这类裸通配。这里做一次收口：**只有完全没有项目声明**才算绿野。
 */
const NON_NPM_MANIFESTS = [
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
] as const;

function detectGreenfield(repoRoot: string): boolean {
  if (!isGreenfieldRepo(repoRoot)) return false;
  return !NON_NPM_MANIFESTS.some((name) =>
    fs.existsSync(path.join(repoRoot, name)),
  );
}

function dedupe(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

/** 方案 → 一段纯文本（标题 / 摘要 / 模块名 / 备注），只做确定性拼接 */
export function composeScopeText(scheme: ScopePlanScheme): string {
  return [
    scheme.title.trim(),
    scheme.summary.trim(),
    scheme.modules.length > 0 ? `模块：${scheme.modules.join("、")}` : "",
    scheme.notes.trim(),
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function synthMessages(text: string): SupervisorMessage[] {
  // created_at / message_id 不参与任何判定；固定值保证可复现
  return [
    {
      message_id: "scope-plan-input",
      role: "user",
      text,
      created_at: "1970-01-01T00:00:00.000Z",
      source: "ui",
    },
  ];
}

/** 仓库里真实存在的顶层目录下的子目录（排序后返回，保证确定性） */
function existingSubdirs(repoRoot: string, top: string): string[] {
  if (!top || top.includes("*") || GHOST_DIRS.has(top)) return [];
  const dir = path.join(repoRoot, top);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/** 英文目录名在文本里按「整词」出现（大小写不敏感）；中文模块名不会误命中 */
function tokenHit(text: string, token: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(token) || token.length < 2)
    return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(
    text,
  );
}

type PathState = "dir" | "file" | "missing";

function pathState(repoRoot: string, relPath: string): PathState {
  const rel = relPath.replace(/\/?\*\*$/, "").replace(/\/+$/, "");
  if (!rel) return "missing";
  try {
    const stat = fs.statSync(path.join(repoRoot, rel));
    if (stat.isDirectory()) return "dir";
    if (stat.isFile()) return "file";
    return "missing";
  } catch {
    return "missing";
  }
}

/**
 * 自动收敛：只把被分级拒绝的裸通配替换成**真实存在**的模块级路径。
 *
 * 顺序（与任务卡一致）：
 * ① 方案文本里出现的、仓库中真实存在的子目录名（英文整词、大小写不敏感）
 *    → `<top>/<dir>/**`；
 * ② 方案里显式写出的真实相对路径 → 目录补 `/**`，文件精确保留。
 *
 * 全部未命中返回空数组：调用方保留原 rejected，不编造任何路径。
 */
export function convergeRejectedPath(input: {
  repoRoot: string;
  rejectedPath: string;
  rejectedKind: string;
  text: string;
  mentionedPaths: readonly string[];
}): string[] {
  if (input.rejectedKind !== "bare_top_glob") return [];
  const top = input.rejectedPath.split("/")[0] ?? "";
  if (!top || top.includes("*")) return [];

  const matchedDirs = existingSubdirs(input.repoRoot, top).filter((dir) =>
    tokenHit(input.text, dir),
  );
  if (matchedDirs.length > 0) {
    return matchedDirs.map((dir) => `${top}/${dir}/**`);
  }

  const out: string[] = [];
  for (const candidate of input.mentionedPaths) {
    if (candidate !== top && !candidate.startsWith(`${top}/`)) continue;
    const state = pathState(input.repoRoot, candidate);
    if (state === "dir") out.push(`${candidate.replace(/\/+$/, "")}/**`);
    else if (state === "file") out.push(candidate);
  }
  return dedupe(out);
}

interface PackageScripts {
  typecheck: boolean;
  test: boolean;
}

function readPackageScripts(repoRoot: string): PackageScripts {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const scripts = parsed.scripts ?? {};
    return {
      typecheck: typeof scripts["typecheck"] === "string",
      test: typeof scripts["test"] === "string",
    };
  } catch {
    return { typecheck: false, test: false };
  }
}

/**
 * 验收方式只认 package.json 里**实际存在**的脚本：
 * 没有 `typecheck` / `test` 就一条命令都不生成，`manual_only = true`，
 * 由 J.5 把施工步骤落到 MANUAL_REVIEW。
 */
export function buildVerification(repoRoot: string): ScopeVerification {
  const scripts = readPackageScripts(repoRoot);
  const commands: VerificationCommand[] = [];
  const plain: string[] = [];
  if (scripts.typecheck) {
    commands.push({
      alias: "typecheck",
      executable: "npm",
      args: ["run", "typecheck"],
      expected_exit_code: 0,
      timeout_seconds: 120,
    });
    plain.push("代码能通过类型检查");
  }
  if (scripts.test) {
    commands.push({
      alias: "test",
      executable: "npm",
      args: ["test"],
      expected_exit_code: 0,
      timeout_seconds: 300,
    });
    plain.push("自动测试全部通过");
  }
  if (commands.length === 0) {
    plain.push("这个项目没有自动检查，完成后需要你试玩确认");
  }
  return { commands, plain, manual_only: commands.length === 0 };
}

/** 预算 → 白话（严禁出现 Token / tool calls / glob 等技术单位） */
export function plainBudget(limits: BudgetLimits): string {
  const files = limits.max_file_modifications;
  const totalMinutes = Math.max(
    1,
    Math.round(limits.max_duration_seconds / 60),
  );
  const lowMinutes = Math.max(1, Math.round(totalMinutes / 2));
  return `最多改约 ${files} 个文件，预计 ${lowMinutes}～${totalMinutes} 分钟`;
}

function buildNeverTouch(
  dirtyExclusions: readonly string[],
): ScopeNeverTouch[] {
  const fixed = [...DEFAULT_FORBIDDEN_PATHS];
  const secretPaths = fixed.filter((p) => p.startsWith(".env"));
  const repoPaths = fixed.filter((p) => !p.startsWith(".env"));
  const groups: ScopeNeverTouch[] = [];
  if (secretPaths.length > 0) {
    groups.push({ label: "密钥与钥匙文件", paths: secretPaths });
  }
  if (repoPaths.length > 0) {
    groups.push({ label: "版本库、Stagent 自身与锁文件", paths: repoPaths });
  }
  if (dirtyExclusions.length > 0) {
    groups.push({
      label: "你本地还没提交的改动",
      paths: [...dirtyExclusions],
    });
  }
  return groups;
}

function matchedModuleIds(
  pathPattern: string,
  modules: readonly string[],
): { ids: string[]; label: string | null } {
  const segment =
    pathPattern
      .replace(/\/?\*\*$/, "")
      .split("/")
      .at(-1) ?? "";
  for (let i = 0; i < modules.length; i += 1) {
    const module = modules[i]!;
    if (segment && tokenHit(module, segment)) {
      return { ids: [`mod_${i + 1}`], label: module };
    }
  }
  return { ids: [], label: null };
}

/** 区域白话名：不含 glob 通配、不含技术单位 */
function areaLabel(pathPattern: string, moduleLabel: string | null): string {
  if (moduleLabel) return moduleLabel;
  const trimmed = pathPattern.replace(/\/?\*\*$/, "");
  if (pathPattern.endsWith("/**")) return `${trimmed} 这一块`;
  return `${trimmed} 这个文件`;
}

function buildAreas(input: {
  repoRoot: string;
  title: string;
  modules: readonly string[];
  writablePaths: readonly string[];
  excludedIds: ReadonlySet<string>;
}): ScopeArea[] {
  return input.writablePaths.map((pathPattern, index) => {
    const matched = matchedModuleIds(pathPattern, input.modules);
    const label = areaLabel(pathPattern, matched.label);
    const id = `area_${index + 1}`;
    return {
      id,
      label,
      why: matched.label
        ? `方案里的「${matched.label}」要用到这里`
        : `方案「${input.title}」里这处需要改动`,
      module_ids: matched.ids,
      kind:
        pathState(input.repoRoot, pathPattern) === "missing"
          ? ("create_new" as const)
          : ("change_existing" as const),
      paths: [pathPattern],
      excluded_by_user: input.excludedIds.has(id),
    };
  });
}

function buildNeedsApproval(input: {
  repoRoot: string;
  writablePaths: readonly string[];
}): ScopeApprovalItem[] {
  const items: ScopeApprovalItem[] = [];
  const protection = intersectWithProtection(input.repoRoot, [
    ...input.writablePaths,
  ]);
  if (protection.error !== undefined) {
    // 失败关闭：清单读不出来也必须挡住签署
    items.push({
      id: "ap_protection_unavailable",
      label: "保护清单读不出来",
      why: protection.error,
      paths: [],
      approved: null,
    });
  } else if (protection.hit && protection.files.length > 0) {
    items.push({
      id: "ap_protected_files",
      label: `受保护的「${protection.entryNames.join("、")}」`,
      why: "这些文件在保护清单里，施工前要你点头",
      paths: [...protection.files],
      approved: null,
    });
  }

  if (input.writablePaths.includes("package.json")) {
    items.push({
      id: "ap_dependency_manifest",
      label: "项目依赖清单（package.json）",
      why: "新功能可能需要加一个依赖，会改到这里",
      paths: ["package.json"],
      approved: null,
    });
  }

  return items;
}

function combineGrade(input: {
  repoRoot: string;
  greenfield: boolean;
  writablePaths: readonly string[];
  unresolved: readonly { path: string; kind: string }[];
}): ScopeGrade {
  const regraded = gradeWritableScope({
    writable_paths: input.writablePaths,
    greenfield: input.greenfield,
  });
  const rejected = dedupe([
    ...input.unresolved.map((r) => `${r.path}\u0000${r.kind}`),
    ...regraded.rejected.map((r) => `${r.path}\u0000${r.kind}`),
  ]).map((entry) => {
    const [p, kind] = entry.split("\u0000");
    return { path: p ?? "", kind: kind ?? "" };
  });
  return { ok: rejected.length === 0, rejected };
}

function budgetOf(limits: BudgetLimits): ScopeBudget {
  return { limits: { ...limits }, plain: plainBudget(limits) };
}

/**
 * 构建与方案修订绑定的 `ScopePlan`。
 *
 * 纯规则：同一 `(repoRoot, scheme, decisions)` 两次构建必得同一 `plan_digest`。
 */
export function buildScopePlan(input: BuildScopePlanInput): ScopePlan {
  const { repoRoot, scheme } = input;
  const text = composeScopeText(scheme);
  const mentioned = extractPathsFromText(text).filter(isSafeContractPath);

  const rawSeed = mentioned.length > 0 ? mentioned : inferIntentPaths(text);
  const seed = dedupe(rawSeed.filter(isSafeContractPath));
  const seedPaths = seed.length > 0 ? seed : ["src/**"];

  const greenfield = detectGreenfield(repoRoot);
  const l0 = buildL0Plan({
    repoRoot,
    messages: synthMessages(text),
  });

  const seedGrade = gradeWritableScope({
    writable_paths: seedPaths,
    greenfield,
  });
  const converged: string[] = [];
  const unresolved: { path: string; kind: string }[] = [];
  for (const rejected of seedGrade.rejected) {
    const replacement = convergeRejectedPath({
      repoRoot,
      rejectedPath: rejected.path,
      rejectedKind: rejected.kind,
      text,
      mentionedPaths: mentioned,
    });
    if (replacement.length > 0) converged.push(...replacement);
    else unresolved.push({ path: rejected.path, kind: rejected.kind });
  }

  const writablePaths = dedupe([
    ...seedGrade.accepted.map((entry) => entry.path),
    ...converged,
  ]);
  const grade = combineGrade({
    repoRoot,
    greenfield,
    writablePaths,
    unresolved,
  });

  const dirtyExclusions = l0.dirty_exclusions;
  const areas = buildAreas({
    repoRoot,
    title: scheme.title.trim() || "当前方案",
    modules: scheme.modules,
    writablePaths,
    excludedIds: new Set<string>(),
  });
  const needsApproval = buildNeedsApproval({
    repoRoot,
    writablePaths,
  });

  const plan: ScopePlan = {
    scheme_revision: scheme.scheme_revision,
    plan_digest: "",
    areas,
    never_touch: buildNeverTouch(dirtyExclusions),
    needs_approval: needsApproval,
    verification: buildVerification(repoRoot),
    // 绿野（无任何项目声明）才给脚手架级别预算；Python/Go 等老工程按默认 10 个文件，
    // 否则 L0 的「绿野 + npm 验收」会把 40 个文件的上限错误地套到它们头上。
    budget: budgetOf(greenfield ? l0.budget : { ...DEFAULT_DRAFT_BUDGET }),
    grade,
  };
  return applyScopeDecisions(plan, input.decisions ?? {});
}

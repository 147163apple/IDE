import fs from "node:fs";
import path from "node:path";
import { intersectWithProtection } from "../protection/protection-list";
import {
  formatDirtyExclusionsPlain,
  loadBaselineDirtyExclusions,
  mergeBaselineProtectIntoForbidden,
} from "../baseline/scope-defaults";
import type {
  BudgetLimits,
  VerificationCommand,
} from "../../src/lib/contract.schema";
import type { SupervisorMessage } from "./types";

/**
 * L0 规则引擎（TASK-S.2 精简版 / v1.3.3 §S.2「L0 规则优先」）。
 *
 * 设计原则：
 * 1. **确定性、零模型调用**：同样的输入必然得到同样的计划，不联网、不读时钟、
 *    不依赖随机数——因此可以在 Worker 流式生成期间安全地反复调用而不烧钱；
 * 2. **先规则后模型**：可写路径、只读路径、默认验证命令、默认预算全部由这里
 *    算出来；L1 强模型只负责补白话理由与未决问题（见 `draft-generator.ts`）；
 * 3. **保护清单只做匹配、不做削减**：命中保护区的路径**仍留在** `writable_paths`
 *    里（那是用户的真实意图），同时单独回报 `protected_files`，交给 §0.2 的
 *    「一次白话是/否」授权流程；绝不静默删掉用户想改的东西。
 * 4. **失败关闭**：保护清单解析异常时 `protection_error` 非空且
 *    `needs_protection_approval = true`（宁可多问一次，也不默认放行）。
 */

/** 默认验证命令：先类型检查、再全量测试（与合同编排口径一致） */
export const DEFAULT_DRAFT_COMMANDS: readonly VerificationCommand[] = [
  {
    alias: "typecheck",
    executable: "npm",
    args: ["run", "typecheck"],
    expected_exit_code: 0,
    timeout_seconds: 120,
  },
  {
    alias: "test",
    executable: "npm",
    args: ["test"],
    expected_exit_code: 0,
    timeout_seconds: 300,
  },
];

/** 默认安全预算：包含 v1.3.2 的计数值上限（防止"跑飞"） */
export const DEFAULT_DRAFT_BUDGET: Readonly<
  Required<
    Pick<
      BudgetLimits,
      | "max_file_modifications"
      | "max_total_diff_lines"
      | "max_duration_seconds"
      | "max_verification_retries"
      | "max_command_executions"
      | "max_tool_calls"
    >
  >
> = {
  max_file_modifications: 10,
  max_total_diff_lines: 2000,
  max_duration_seconds: 1800,
  max_verification_retries: 3,
  max_command_executions: 40,
  max_tool_calls: 200,
};

/** 默认禁区：密钥、版本库元数据、Stagent 自身状态与锁文件 */
export const DEFAULT_FORBIDDEN_PATHS: readonly string[] = [
  ".env*",
  "**/.git/**",
  "**/.stagent/**",
  "package-lock.json",
  "pnpm-lock.yaml",
];

/**
 * 绿野仓库 + npm typecheck/test 验收时的默认可写范围补丁。
 * 仅 src/** 时 Worker 无法落 package.json / 测试文件，验收命令必然失败；
 * Gateway 的测试完整性门禁也要求显式 tests 目录或 *.test.ts 一类模式。
 */
export const GREENFIELD_NPM_WRITABLE_DEFAULTS: readonly string[] = [
  "src/**",
  "package.json",
  "tsconfig.json",
  "tsconfig.*.json",
  "vitest.config.*",
  "vite.config.*",
  "*.config.ts",
  "*.config.mjs",
  "*.config.js",
  "index.html",
  "tests/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
];

/** 绿野：仓库根尚无 package.json（无法直接跑 npm 验收） */
export function isGreenfieldRepo(repoRoot: string): boolean {
  try {
    return !fs.existsSync(path.join(repoRoot, "package.json"));
  } catch {
    return false;
  }
}

/** 验收命令是否依赖 npm typecheck / npm test */
export function commandsNeedNpmVerification(
  commands: readonly VerificationCommand[],
): boolean {
  return commands.some((cmd) => {
    if (cmd.executable !== "npm") return false;
    const args = cmd.args.map((a) => a.toLowerCase());
    if (args.includes("test")) return true;
    if (args.includes("typecheck")) return true;
    // npm run typecheck / npm run test
    const runIdx = args.indexOf("run");
    if (runIdx >= 0) {
      const script = args[runIdx + 1] ?? "";
      if (script === "typecheck" || script === "test") return true;
    }
    return false;
  });
}

/**
 * 绿野 + npm 验收：把脚手架/测试路径并入可写范围（去重保序）。
 * 非绿野或非 npm 验收原样返回。
 */
export function alignWritableWithNpmVerification(input: {
  repoRoot: string;
  writablePaths: readonly string[];
  commands: readonly VerificationCommand[];
}): string[] {
  const base = [...input.writablePaths];
  if (!isGreenfieldRepo(input.repoRoot)) return base;
  if (!commandsNeedNpmVerification(input.commands)) return base;
  const out: string[] = [];
  for (const p of [...base, ...GREENFIELD_NPM_WRITABLE_DEFAULTS]) {
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * 意图 → 目录的确定性映射（只在用户没提具体路径时兜底）。
 * 顺序即优先级：同时命中多条时按顺序合并去重，不做语义推断。
 */
const INTENT_DIRECTORY_RULES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly paths: readonly string[];
}> = [
  { pattern: /(测试|单测|用例|test|vitest|jest|spec)/i, paths: ["tests/**"] },
  { pattern: /(文档|报告|说明|readme|doc)/i, paths: ["docs/**"] },
  {
    pattern: /(界面|前端|样式|组件|ui|frontend|component|css)/i,
    paths: ["src/components/**", "src/routes/**"],
  },
  { pattern: /(守护|后端|服务端|daemon|backend)/i, paths: ["daemon/**"] },
  { pattern: /(脚本|命令行|cli|bin|script)/i, paths: ["bin/**", "scripts/**"] },
];

/** 文本里的路径候选：目录路径（a/b）与带扩展名的文件（a/b.ts） */
const PATH_TOKEN_PATTERN =
  /(?:[\w@.-]+\/)+[\w@.-]+|[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|py|go|rs|yml|yaml|toml|html)/g;

/**
 * 从自由文本里提取路径候选（纯规则，不做语义理解）。
 * 过滤掉绝对路径、`..` 穿越、Windows 反斜杠、URL 与依赖目录。
 */
export function extractPathsFromText(text: string): string[] {
  const found = text.match(PATH_TOKEN_PATTERN) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const candidate = raw
      .replace(/^[`'"（(【[]+/, "")
      .replace(/[`'"）)】\]，,。.；;：:]+$/, "");
    if (!isSafeContractPath(candidate)) continue;
    if (candidate.startsWith("node_modules/")) continue;
    if (!out.includes(candidate)) out.push(candidate);
    if (out.length >= 20) break;
  }
  return out;
}

/** 合同 `safePathString` 的同口径预判：相对路径、无 `..`、无反斜杠 */
export function isSafeContractPath(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > 200) return false;
  if (candidate.startsWith("/") || candidate.startsWith("~")) return false;
  if (candidate.includes("..") || candidate.includes("\\")) return false;
  if (/^[a-z]+:\/\//i.test(candidate)) return false;
  return true;
}

function userText(messages: readonly SupervisorMessage[]): string {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.text)
    .join("\n");
}

function dedupe(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

/** 依据意图关键词推断可写目录（无具体路径时的兜底） */
export function inferIntentPaths(text: string): string[] {
  const matched: string[] = [];
  for (const rule of INTENT_DIRECTORY_RULES) {
    if (rule.pattern.test(text)) matched.push(...rule.paths);
  }
  const deduped = dedupe(matched);
  return deduped.length > 0 ? deduped.slice(0, 4) : ["src/**"];
}

function firstMeaningfulLine(messages: readonly SupervisorMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const line = message.text
      .split(/\r?\n/)
      .find((part) => part.trim().length > 0);
    if (line) return line.trim();
  }
  return "";
}

/** 从文本里挑出"像验收标准"的行（规则命中，不做改写） */
export function extractAcceptanceCriteria(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) =>
      /(验收|通过|应当|必须|不得|typecheck|npm test|pytest|断言)/i.test(line),
    )
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .slice(0, 5);
  return [...new Set(lines)];
}

export interface L0ScopeInput {
  writablePaths?: string[] | undefined;
  readonlyPaths?: string[] | undefined;
  strictlyForbiddenPaths?: string[] | undefined;
}

export interface L0DraftInput {
  repoRoot: string;
  messages: readonly SupervisorMessage[];
  scope?: L0ScopeInput | undefined;
  commands?: VerificationCommand[] | undefined;
  /** 合同预算覆盖（与"预算账本"无关，账本是另一个概念） */
  budgetLimits?: Partial<BudgetLimits> | undefined;
}

export interface L0DraftPlan {
  title: string;
  description: string;
  acceptance_criteria: string[];
  writable_paths: string[];
  readonly_paths: string[];
  strictly_forbidden_paths: string[];
  /**
   * TASK-C.14d：基线 Dirty Check 物理排除清单（亦已并入 strictly_forbidden_paths）。
   * 白话合同需显式列出「绝不触碰」。
   */
  dirty_exclusions: string[];
  commands: VerificationCommand[];
  budget: BudgetLimits;
  /** 与保护清单相交的文件（驱动 §0.2 的一次白话是/否） */
  protected_files: string[];
  protected_entry_names: string[];
  /** 保护清单解析异常（非空即失败关闭，要求人工确认） */
  protection_error?: string | undefined;
  needs_protection_approval: boolean;
  /** L0 自身产出的未决问题（与 L1 的问题合并后 100% 保留，G-11） */
  unresolved_questions: string[];
}

/**
 * 装配 L0 计划。纯函数（除了读保护清单文件），零模型调用。
 */
export function buildL0Plan(input: L0DraftInput): L0DraftPlan {
  const text = userText(input.messages);
  const mentioned = extractPathsFromText(text);

  const writablePaths = dedupe(
    (input.scope?.writablePaths && input.scope.writablePaths.length > 0
      ? input.scope.writablePaths
      : mentioned.length > 0
        ? mentioned
        : inferIntentPaths(text)
    ).filter(isSafeContractPath),
  );
  // 兜底：过滤后为空（例如用户只写了绝对路径）说明意图无法落到仓库内
  const baseWritable = writablePaths.length > 0 ? writablePaths : ["src/**"];

  const readonlyPaths = dedupe(
    (input.scope?.readonlyPaths ?? ["docs/**"]).filter(isSafeContractPath),
  );
  const baseForbidden = dedupe(
    input.scope?.strictlyForbiddenPaths ?? [...DEFAULT_FORBIDDEN_PATHS],
  );
  // TASK-C.14c/d：首张微合同强制注入 dirty_exclusions → strictly_forbidden_paths
  const dirtyExclusions = loadBaselineDirtyExclusions(input.repoRoot);
  const forbiddenPaths = dedupe(
    mergeBaselineProtectIntoForbidden(input.repoRoot, baseForbidden),
  );

  const commands =
    input.commands !== undefined && input.commands.length > 0
      ? input.commands
      : [...DEFAULT_DRAFT_COMMANDS];

  // 绿野 + npm 验收：可写范围与 package.json / 测试路径对齐，避免验收要求写不了的文件
  const effectiveWritable = alignWritableWithNpmVerification({
    repoRoot: input.repoRoot,
    writablePaths: baseWritable,
    commands,
  });

  const greenfieldNpm =
    isGreenfieldRepo(input.repoRoot) && commandsNeedNpmVerification(commands);

  const budget: BudgetLimits = {
    ...DEFAULT_DRAFT_BUDGET,
    // 绿野脚手架通常超过默认 10 个文件；略抬高以免验收前被预算熔断
    ...(greenfieldNpm ? { max_file_modifications: 40 } : {}),
    ...(input.budgetLimits ?? {}),
  };

  const protection = intersectWithProtection(input.repoRoot, effectiveWritable);

  const unresolved: string[] = [];
  const dirtyPlain = formatDirtyExclusionsPlain(dirtyExclusions);
  if (dirtyPlain) {
    unresolved.push(
      `本地脏区已列入禁写（施工绝不覆盖）：${dirtyExclusions.slice(0, 8).join("、")}` +
        (dirtyExclusions.length > 8 ? ` 等 ${dirtyExclusions.length} 个` : ""),
    );
  }
  if (protection.hit && protection.files.length > 0) {
    const names = protection.entryNames.join("、");
    unresolved.push(
      `是否允许修改受保护的「${names}」？命中路径：${protection.files.join("、")}`,
    );
  }
  if (protection.error !== undefined) {
    unresolved.push(
      `保护清单无法解析（${protection.error}），请人工确认可写范围后再授权。`,
    );
  }

  const titleSource = firstMeaningfulLine(input.messages);
  const acceptance = extractAcceptanceCriteria(text);

  return {
    title:
      titleSource.length === 0
        ? "Supervisor 生成的合同草案"
        : titleSource.slice(0, 80),
    description:
      text.trim().length === 0
        ? "由 Supervisor 依据当前会话生成的合同草案；会话中尚未提供细节，请补充后签署。"
        : text.trim().slice(0, 2000),
    acceptance_criteria:
      acceptance.length > 0
        ? acceptance
        : ["`npm run typecheck` 与 `npm test` 全部通过"],
    writable_paths: effectiveWritable,
    readonly_paths: readonlyPaths,
    strictly_forbidden_paths: forbiddenPaths,
    dirty_exclusions: dirtyExclusions,
    commands,
    budget,
    protected_files: protection.files,
    protected_entry_names: protection.entryNames,
    ...(protection.error === undefined
      ? {}
      : { protection_error: protection.error }),
    needs_protection_approval: protection.hit,
    unresolved_questions: unresolved,
  };
}

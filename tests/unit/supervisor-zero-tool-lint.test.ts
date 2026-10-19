import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * TASK-S.1 静态依赖禁令（Zero-Tool Invariant）。
 *
 * 规范 A §2.2：Supervisor 无执行授权权；B TASK-S.1：禁止引入
 * Gateway / Merger / Verifier / ProcessRunner / child_process。
 *
 * 本测试用 TypeScript AST（而非正则）扫描 `daemon/supervisor/**` 的
 * import / export-from / require / 动态 import，并沿相对路径做**传递闭包**，
 * 确保「间接 import」同样被捕获。
 */

const REPO_ROOT = process.cwd();
const SUPERVISOR_DIR = path.join(REPO_ROOT, "daemon", "supervisor");

/** 禁止的裸模块（命令执行能力） */
const BANNED_BARE_MODULES = ["child_process", "node:child_process"] as const;

/** 禁止引入的特权写入 / 执行模块（仓库相对路径，不含扩展名） */
const BANNED_REPO_PATHS = [
  "daemon/mcp/gateway",
  "daemon/pipeline/merger",
  "daemon/pipeline/orchestrator",
  "daemon/pipeline/contract-store",
  "daemon/runner/command-runner",
  "daemon/git/worktree-manager",
  "daemon/git/branch-guard",
  "daemon/worker/ai-worker",
  "daemon/recovery/crash-recovery",
  "daemon/core/contract-mutex",
  "daemon/server",
] as const;

interface ImportRef {
  file: string;
  specifier: string;
  /** import / export-from / require / dynamic-import */
  kind: string;
}

function normalizeBare(specifier: string): string {
  return specifier.replace(/^node:/, "");
}

function isBannedBare(specifier: string): boolean {
  return (BANNED_BARE_MODULES as readonly string[]).includes(specifier);
}

function relativeNoExt(absolute: string): string {
  return path
    .relative(REPO_ROOT, absolute)
    .split(path.sep)
    .join("/")
    .replace(/\.(ts|tsx|js|mjs|cjs)$/, "");
}

function isBannedRepoPath(absolute: string): boolean {
  const normalized = relativeNoExt(absolute);
  return BANNED_REPO_PATHS.some(
    (banned) => normalized === banned || normalized.startsWith(`${banned}/`),
  );
}

/** 从一个 TS 源文件收集全部模块引用（含静态/动态/require/export-from） */
function collectSpecifiersFromSource(
  source: string,
  fileName: string,
): ImportRef[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const refs: ImportRef[] = [];

  const push = (specifier: string | undefined, kind: string): void => {
    if (specifier) refs.push({ file: fileName, specifier, kind });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        push(node.moduleSpecifier.text, "import");
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        push(node.moduleSpecifier.text, "export-from");
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        push(node.moduleReference.expression.text, "import-equals");
      }
    } else if (ts.isCallExpression(node)) {
      const [firstArg] = node.arguments;
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        firstArg &&
        ts.isStringLiteral(firstArg)
      ) {
        push(firstArg.text, "dynamic-import");
      }
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        firstArg &&
        ts.isStringLiteral(firstArg)
      ) {
        push(firstArg.text, "require");
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return refs;
}

function collectSpecifiers(file: string): ImportRef[] {
  return collectSpecifiersFromSource(fs.readFileSync(file, "utf-8"), file);
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null;
}

interface ScanResult {
  scanned: string[];
  violations: string[];
}

/** 以 supervisor 目录为根做传递闭包扫描 */
function scanSupervisorGraph(): ScanResult {
  const entries = fs
    .readdirSync(SUPERVISOR_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.join(SUPERVISOR_DIR, name));

  const queue = [...entries];
  const visited = new Set<string>();
  const violations: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (visited.has(file)) continue;
    visited.add(file);

    for (const ref of collectSpecifiers(file)) {
      if (isBannedBare(ref.specifier)) {
        violations.push(
          `${relativeNoExt(file)} -> ${ref.specifier} (${ref.kind})`,
        );
        continue;
      }
      const resolved = resolveRelative(file, ref.specifier);
      if (!resolved) {
        // 裸模块（zod 等）不进入仓库图；仅检查上面的黑名单
        continue;
      }
      if (isBannedRepoPath(resolved)) {
        violations.push(
          `${relativeNoExt(file)} -> ${relativeNoExt(resolved)} (${ref.kind})`,
        );
        continue;
      }
      if (!visited.has(resolved) && resolved.startsWith(REPO_ROOT)) {
        queue.push(resolved);
      }
    }
  }

  return {
    scanned: [...visited].map(relativeNoExt).sort(),
    violations,
  };
}

describe("Supervisor 零工具静态依赖禁令（AST + 传递闭包）", () => {
  it("daemon/supervisor/** 零引入命令执行与特权写入模块", () => {
    const { scanned, violations } = scanSupervisorGraph();

    expect(violations).toEqual([]);
    // 覆盖面自检：至少覆盖 5 个 supervisor 源文件
    expect(
      scanned.filter((file) => file.startsWith("daemon/supervisor")).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("传递闭包确实穿透到共享依赖（证明扫描不是只扫第一层）", () => {
    const { scanned } = scanSupervisorGraph();

    expect(scanned).toContain("src/lib/state-machine");
    expect(scanned).toContain("daemon/guard/cost-monitor");
  });

  it("源文件不出现命令执行 API 字面量（execSync/spawn/execFile/fork）", () => {
    const forbiddenCall =
      /\b(execSync|execFileSync|spawnSync|execFile|spawn|fork)\s*\(/;
    const sources = fs
      .readdirSync(SUPERVISOR_DIR)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({
        name,
        content: fs.readFileSync(path.join(SUPERVISOR_DIR, name), "utf-8"),
      }));

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.content).not.toMatch(forbiddenCall);
      expect(source.content).not.toContain("child_process");
    }
  });

  it("黑名单覆盖全部 4 类特权面（Gateway / Merger / ProcessRunner / Worktree）", () => {
    expect(BANNED_REPO_PATHS).toContain("daemon/mcp/gateway");
    expect(BANNED_REPO_PATHS).toContain("daemon/pipeline/merger");
    expect(BANNED_REPO_PATHS).toContain("daemon/runner/command-runner");
    expect(BANNED_REPO_PATHS).toContain("daemon/git/worktree-manager");
    expect(BANNED_BARE_MODULES).toContain("node:child_process");
  });

  it("负例控制：扫描器能识别被禁止的 import / require / 动态 import", () => {
    const fixture = [
      'import cp from "node:child_process";',
      'import { Gateway } from "../mcp/gateway";',
      'const merger = require("../pipeline/merger");',
      'const runner = await import("../runner/command-runner");',
      'export * from "../git/worktree-manager";',
    ].join("\n");

    const refs = collectSpecifiersFromSource(
      fixture,
      path.join(SUPERVISOR_DIR, "fixture.ts"),
    );
    const specifiers = refs.map((ref) => ref.specifier);

    expect(specifiers).toContain("node:child_process");
    expect(specifiers).toContain("../mcp/gateway");
    expect(specifiers).toContain("../pipeline/merger");
    expect(specifiers).toContain("../runner/command-runner");
    expect(specifiers).toContain("../git/worktree-manager");

    // 解析后应判定为违规
    const banned = refs.filter((ref) => {
      if (isBannedBare(ref.specifier)) return true;
      const resolved = resolveRelative(ref.file, ref.specifier);
      return resolved !== null && isBannedRepoPath(resolved);
    });
    expect(banned).toHaveLength(5);
  });
});

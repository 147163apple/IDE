import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyWritablePattern,
  convergeWritableManifest,
  gradeWritableScope,
} from "../../src/lib/writable-scope-grade";
import {
  WritableScopePolicyError,
  assertContractScopeAllowed,
  evaluateContractScope,
} from "../../daemon/supervisor/scope-gate";

/**
 * SSOT v2.0.2 §4.2 验收：通配符分级。
 *
 * 核心约束：顶层裸通配（src 下一层通配、全仓通配）一律拒绝——
 * 它等价于「整仓可写」，会让保护清单与 diff 审阅同时失效。
 * 模块级子目录通配（src/features/finance 下）是绿野与新模块的合法种子。
 */

const tempDirs: string[] = [];

function makeRepo(withPackageJson: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-scope-"));
  tempDirs.push(dir);
  if (withPackageJson) {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "legacy-app", version: "1.0.0" }),
      "utf8",
    );
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 受限执行环境可能禁止删除临时目录；清理失败不应把断言判成失败。
    }
  }
});

describe("T-SCOPE 分类器", () => {
  it("T-SCOPE-001 精确文件路径归为 exact", () => {
    expect(classifyWritablePattern("src/features/finance/report.ts")).toBe(
      "exact",
    );
    expect(classifyWritablePattern("./src/a.ts")).toBe("exact");
  });

  it("T-SCOPE-002 顶层裸通配归为 bare_top_glob", () => {
    expect(classifyWritablePattern("src/**")).toBe("bare_top_glob");
    expect(classifyWritablePattern("src/*")).toBe("bare_top_glob");
    expect(classifyWritablePattern("tests/**")).toBe("bare_top_glob");
  });

  it("T-SCOPE-003 全仓通配归为 bare_top_glob", () => {
    expect(classifyWritablePattern("**")).toBe("bare_top_glob");
    expect(classifyWritablePattern("**/*")).toBe("bare_top_glob");
    expect(classifyWritablePattern("*")).toBe("bare_top_glob");
  });

  it("T-SCOPE-004 模块级子目录通配归为 module_subdir_glob", () => {
    expect(classifyWritablePattern("src/features/finance/**")).toBe(
      "module_subdir_glob",
    );
    expect(classifyWritablePattern("src/components/studio/*.tsx")).toBe(
      "module_subdir_glob",
    );
  });

  it("T-SCOPE-005 敏感路径一律 sensitive_forbidden（即使写得再具体）", () => {
    expect(classifyWritablePattern(".env")).toBe("sensitive_forbidden");
    expect(classifyWritablePattern(".env.local")).toBe("sensitive_forbidden");
    expect(classifyWritablePattern(".git/config")).toBe("sensitive_forbidden");
    expect(classifyWritablePattern(".stagent/contracts")).toBe(
      "sensitive_forbidden",
    );
    expect(classifyWritablePattern("package-lock.json")).toBe(
      "sensitive_forbidden",
    );
  });
});

describe("T-SCOPE 分级裁决", () => {
  it("T-SCOPE-006 老项目：接受精确文件与模块级子目录，拒绝顶层裸通配", () => {
    const result = gradeWritableScope({
      writable_paths: [
        "src/features/finance/report.ts",
        "src/features/finance/**",
        "src/**",
      ],
      greenfield: false,
    });

    expect(result.ok).toBe(false);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.path).toBe("src/**");
    expect(result.rejected[0]?.reason).toContain("老项目禁止顶层裸通配");
    expect(result.accepted.map((a) => a.path)).toEqual([
      "src/features/finance/report.ts",
      "src/features/finance/**",
    ]);
  });

  it("T-SCOPE-007 绿野项目（无项目声明）：顶层裸通配可作为脚手架种子", () => {
    const ok = gradeWritableScope({
      writable_paths: ["src/**", "tests/**"],
      greenfield: true,
    });
    expect(ok.ok).toBe(true);
    expect(ok.accepted.map((a) => a.path)).toEqual(["src/**", "tests/**"]);
  });

  it("T-SCOPE-007b 同一份 src/** 在已存在的项目里被拒（判据是项目声明，不是目录是否存在）", () => {
    const denied = gradeWritableScope({
      writable_paths: ["src/**"],
      greenfield: false,
    });
    expect(denied.ok).toBe(false);
    expect(denied.rejected[0]?.kind).toBe("bare_top_glob");
    expect(denied.rejected[0]?.reason).toContain("老项目");
  });

  it("T-SCOPE-007c 全仓通配即使绿野也拒绝", () => {
    const denied = gradeWritableScope({
      writable_paths: ["**/*"],
      greenfield: true,
    });
    expect(denied.ok).toBe(false);
    expect(denied.rejected[0]?.reason).toContain("全仓通配");
  });

  it("T-SCOPE-008 敏感路径不因绿野而放行", () => {
    const result = gradeWritableScope({
      writable_paths: [".env", "src/features/finance/**"],
      greenfield: true,
    });
    expect(result.ok).toBe(false);
    expect(result.rejected[0]?.kind).toBe("sensitive_forbidden");
  });

  it("T-SCOPE-009 落盘收敛：glob 被已写文件替换，未命中的种子保留", () => {
    const converged = convergeWritableManifest(
      ["src/features/finance/**", "src/features/alert/**"],
      ["src/features/finance/report.ts", "src/features/finance/budget.ts"],
    );
    expect(converged).toEqual([
      "src/features/finance/report.ts",
      "src/features/finance/budget.ts",
      "src/features/alert/**",
    ]);
  });

  it("T-SCOPE-010 收敛去重：精确项已列的文件，不再被 glob 命中重复添加", () => {
    const converged = convergeWritableManifest(
      ["src/features/a.ts", "src/features/**"],
      ["src/features/a.ts"],
    );
    expect(converged).toEqual(["src/features/a.ts"]);
  });
});

describe("T-SCOPE Daemon 策略门", () => {
  it("T-SCOPE-011 老项目（有 package.json）裸通配：抛 WritableScopePolicyError", () => {
    const repo = makeRepo(true);
    expect(() => assertContractScopeAllowed(repo, ["src/**"])).toThrow(
      WritableScopePolicyError,
    );

    try {
      assertContractScopeAllowed(repo, ["src/**", "**/*"]);
      throw new Error("应当抛错");
    } catch (err) {
      expect(err).toBeInstanceOf(WritableScopePolicyError);
      const policyErr = err as WritableScopePolicyError;
      expect(policyErr.code).toBe("E_WRITABLE_SCOPE_POLICY");
      expect(policyErr.rejected.map((r) => r.path)).toEqual(["src/**", "**/*"]);
    }
  });

  it("T-SCOPE-012 老项目精确范围：通过且 greenfield=false", () => {
    const repo = makeRepo(true);
    const result = assertContractScopeAllowed(repo, [
      "src/features/finance/report.ts",
    ]);
    expect(result.ok).toBe(true);
    expect(result.greenfield).toBe(false);
  });

  it("T-SCOPE-013 绿野项目（无 package.json）：模块级子目录通过", () => {
    const repo = makeRepo(false);
    const result = evaluateContractScope(repo, ["src/features/finance/**"]);
    expect(result.greenfield).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("T-SCOPE-014 同一份范围在两种项目形态下裁决不同（老项目更严）", () => {
    const legacy = makeRepo(true);
    const greenfield = makeRepo(false);
    const paths = ["src/features/finance/**"];
    expect(evaluateContractScope(legacy, paths).ok).toBe(true);
    expect(evaluateContractScope(greenfield, paths).ok).toBe(true);
    // 差异点：无项目声明可种 src/**，一旦有 package.json 就必须收敛
    expect(evaluateContractScope(legacy, ["src/**"]).ok).toBe(false);
    expect(evaluateContractScope(greenfield, ["src/**"]).ok).toBe(true);
  });

  it("T-SCOPE-015 加一个 package.json 就足以让 src/** 失效（判据是声明，不是代码量）", () => {
    const repo = makeRepo(false);
    expect(evaluateContractScope(repo, ["src/**"]).ok).toBe(true);

    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({ name: "legacy-now", version: "1.0.0" }),
      "utf8",
    );

    const after = evaluateContractScope(repo, ["src/**"]);
    expect(after.ok).toBe(false);
    expect(after.greenfield).toBe(false);
    expect(after.rejected[0]?.path).toBe("src/**");
  });
});

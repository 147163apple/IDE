import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  buildScopePlan,
  type ScopePlanScheme,
} from "../../daemon/supervisor/scope-plan-builder";
import {
  applyScopeDecisions,
  scopePlanDigest,
  scopePlanToContractScope,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import { stableStringify } from "../../src/lib/stable-stringify";
import { gradeWritableScope } from "../../src/lib/writable-scope-grade";

/**
 * TASK-J.2 / SSOT §15.3–§15.4（S2-02、S2-04）：
 * 范围预检 `ScopePlan` 的单一事实源、三类仓库夹具、保护清单、白话文案。
 */

const BANNED_PLAIN = /token|tool|glob|\*\*/i;

const scheme = (patch: Partial<ScopePlanScheme> = {}): ScopePlanScheme => ({
  scheme_revision: 3,
  title: "库存管理",
  summary: "做一个库存管理的小工具",
  modules: ["库存清单", "桌面端壳"],
  notes: "",
  ...patch,
});

let repo: string;
beforeEach(() => {
  repo = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "stagent-scope-plan-")),
  );
});
afterEach(() => safeRmSync(repo));

const write = (rel: string, content = "") => {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const writePackageJson = (scripts: Record<string, string> = {}) =>
  write("package.json", JSON.stringify({ name: "fixture", scripts }, null, 2));

const writeProtection = (name: string, patterns: string[]) =>
  write(
    ".stagent/protection.json",
    JSON.stringify(
      {
        version: 1,
        entries: [
          {
            id: "pe-test-1",
            name,
            patterns,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      null,
      2,
    ),
  );

const contractGrade = (plan: ScopePlan, greenfield: boolean) =>
  gradeWritableScope({
    writable_paths: scopePlanToContractScope(plan).writable_paths,
    greenfield,
  });

describe("TASK-J.2 单一事实源与摘要（S2-04）", () => {
  it("同一 (repoRoot, scheme, decisions) 两次构建得到相同 plan_digest", () => {
    const a = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    const b = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    expect(a.plan_digest).toBe(b.plan_digest);
    expect(a.plan_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("摘要与 Node crypto 的 sha256(规范化 JSON) 逐字一致；不含 plan_digest 自身", () => {
    const plan = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    const { plan_digest: _ignored, ...payload } = plan;
    const expected = createHash("sha256")
      .update(stableStringify(payload))
      .digest("hex");
    expect(plan.plan_digest).toBe(expected);
    expect(scopePlanDigest({ ...plan, plan_digest: "deadbeef" })).toBe(
      plan.plan_digest,
    );
  });

  it("scopePlanToContractScope 的输出再过分级必为 ok（plan.grade.ok 时）", () => {
    const plan = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    expect(plan.grade.ok).toBe(true);
    expect(contractGrade(plan, true).ok).toBe(true);
  });

  it("绿野与老项目收敛两类夹具：合同范围再经 gradeWritableScope 均为 ok", () => {
    // 夹具一：绿野（无任何项目声明）→ src/** 种子
    const greenfield = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    expect(greenfield.grade.ok).toBe(true);
    expect(contractGrade(greenfield, true).ok).toBe(true);

    // 夹具二：老项目 + 意图命中真实子目录 → 收敛为 src/pages/**
    writePackageJson({ typecheck: "tsc --noEmit" });
    write("src/pages/home.tsx", "export const home = 1;\n");
    const converged = buildScopePlan({
      repoRoot: repo,
      scheme: scheme({
        summary: "整个 src 目录都想动，主要是 pages 这块",
        modules: ["pages"],
      }),
    });
    expect(converged.grade.ok).toBe(true);
    expect(contractGrade(converged, false).ok).toBe(true);
  });

  it("applyScopeDecisions 幂等；任何表态都会改变 digest", () => {
    const base = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    const once = applyScopeDecisions(base, {
      excluded_area_ids: [base.areas[0]!.id],
    });
    const twice = applyScopeDecisions(base, {
      excluded_area_ids: [base.areas[0]!.id],
    });
    expect(once.plan_digest).toBe(twice.plan_digest);
    expect(once.plan_digest).not.toBe(base.plan_digest);
  });
});

describe("TASK-J.2 三类仓库夹具（S2-02）", () => {
  it("绿野（无任何项目声明）→ src/** 作为种子放行", () => {
    const plan = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    expect(plan.grade).toEqual({ ok: true, rejected: [] });
    expect(scopePlanToContractScope(plan).writable_paths).toContain("src/**");
    for (const area of plan.areas) {
      expect(area.label).not.toMatch(BANNED_PLAIN);
    }
  });

  it("老项目 + 意图命中真实子目录 src/pages → 收敛为 src/pages/** 且 grade.ok", () => {
    writePackageJson({ typecheck: "tsc --noEmit" });
    write("src/pages/home.tsx", "export const home = 1;\n");
    write("src/index.ts", "export const index = 1;\n");
    const plan = buildScopePlan({
      repoRoot: repo,
      scheme: scheme({
        title: "首页调整",
        summary: "整个 src 目录都想动，但主要是 pages 这块",
        modules: ["pages"],
      }),
    });
    expect(plan.grade.ok).toBe(true);
    const writable = scopePlanToContractScope(plan).writable_paths;
    expect(writable).toContain("src/pages/**");
    expect(writable).not.toContain("src/**");
    // 收敛结果必须真实存在，不得编造
    expect(fs.existsSync(path.join(repo, "src/pages"))).toBe(true);
    // 单一事实源：同一 plan 转成合同范围后仍通过分级
    expect(contractGrade(plan, false).ok).toBe(true);
  });

  it("老项目 + 无可匹配目录 → 保留 rejected 里的 src/**，grade.ok=false，不编造路径", () => {
    writePackageJson();
    write("src/index.ts", "export const index = 1;\n");
    const plan = buildScopePlan({
      repoRoot: repo,
      scheme: scheme({
        title: "整理一下",
        summary: "把内容整理清楚",
        modules: ["整理"],
      }),
    });
    expect(plan.grade.ok).toBe(false);
    expect(plan.grade.rejected.map((r) => r.path)).toContain("src/**");
    const writable = scopePlanToContractScope(plan).writable_paths;
    expect(writable.some((p) => p.includes("src/"))).toBe(false);
  });

  it("非 npm（Python 布局）不因缺 package.json 被当成绿野", () => {
    write("pyproject.toml", "[project]\nname = 'fixture'\n");
    write("app/main.py", "print('hi')\n");
    // 显式路径：精确保留，不因缺少 package.json 被拒
    const explicit = buildScopePlan({
      repoRoot: repo,
      scheme: scheme({ summary: "改一下 app/main.py 里的入口" }),
    });
    expect(explicit.grade.ok).toBe(true);
    expect(scopePlanToContractScope(explicit).writable_paths).toContain(
      "app/main.py",
    );
    // 裸通配仍按老工程处理：不因缺 package.json 放行 src/**
    const bare = buildScopePlan({
      repoRoot: repo,
      scheme: scheme({ title: "随便改", summary: "改一下", modules: [] }),
    });
    expect(bare.grade.ok).toBe(false);
    expect(bare.grade.rejected.map((r) => r.path)).toContain("src/**");
  });
});

describe("TASK-J.2 保护清单与表态", () => {
  beforeEach(() => {
    writePackageJson();
    write("src/auth/login.ts", "export const login = 1;\n");
    writeProtection("登录", ["src/auth/**"]);
  });

  it("命中保护清单 → needs_approval 且 approved === null", () => {
    const plan = buildScopePlan({
      repoRoot: repo,
      scheme: scheme({ summary: "改一下 src/auth/login.ts 的登录逻辑" }),
    });
    const item = plan.needs_approval.find((entry) =>
      entry.paths.some((p) => p.includes("src/auth")),
    );
    expect(item).toBeDefined();
    expect(item!.approved).toBeNull();
    expect(item!.label).toContain("登录");
  });

  it("未表态 / 拒绝 → 合同不写该路径；批准后才进 writable", () => {
    const plan = buildScopePlan({
      repoRoot: repo,
      scheme: scheme({ summary: "改一下 src/auth/login.ts 的登录逻辑" }),
    });
    const item = plan.needs_approval.find((entry) =>
      entry.paths.some((p) => p.includes("src/auth")),
    )!;

    const pendingScope = scopePlanToContractScope(plan);
    expect(
      pendingScope.writable_paths.some((p) => p.includes("src/auth")),
    ).toBe(false);

    const denied = applyScopeDecisions(plan, {
      approvals: [{ id: item.id, approved: false }],
    });
    const deniedScope = scopePlanToContractScope(denied);
    expect(deniedScope.writable_paths.some((p) => p.includes("src/auth"))).toBe(
      false,
    );
    expect(
      deniedScope.forbidden_paths.some((p) => p.includes("src/auth")),
    ).toBe(true);

    const approved = applyScopeDecisions(plan, {
      approvals: [{ id: item.id, approved: true }],
    });
    expect(approved.plan_digest).not.toBe(plan.plan_digest);
    const approvedScope = scopePlanToContractScope(approved);
    expect(
      approvedScope.writable_paths.some((p) => p.includes("src/auth")),
    ).toBe(true);
    expect(
      approvedScope.forbidden_paths.some((p) => p.includes("src/auth")),
    ).toBe(false);
  });

  it("never_touch 分组：密钥与钥匙文件始终在列", () => {
    const plan = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    const secrets = plan.never_touch.find((g) => g.label.includes("密钥"));
    expect(secrets).toBeDefined();
    expect(secrets!.paths).toContain(".env*");
  });
});

describe("TASK-J.2 验收方式只认真实脚本", () => {
  it("typecheck + test 都存在 → 两条真实命令，manual_only=false", () => {
    writePackageJson({ typecheck: "tsc --noEmit", test: "vitest run" });
    const plan = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    expect(plan.verification.manual_only).toBe(false);
    expect(plan.verification.commands.map((c) => c.alias)).toEqual([
      "typecheck",
      "test",
    ]);
    expect(plan.verification.plain).toEqual([
      "代码能通过类型检查",
      "自动测试全部通过",
    ]);
  });

  it("只有 typecheck → 只生成一条；没有脚本 → manual_only=true", () => {
    writePackageJson({ typecheck: "tsc --noEmit" });
    const one = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    expect(one.verification.commands.map((c) => c.alias)).toEqual([
      "typecheck",
    ]);

    writePackageJson({});
    const none = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    expect(none.verification.commands).toEqual([]);
    expect(none.verification.manual_only).toBe(true);
    expect(none.verification.plain.join("")).toContain("没有自动检查");
  });
});

describe("TASK-J.2 白话文案（不含技术单位）", () => {
  it("budget.plain 只出现文件数与分钟数", () => {
    writePackageJson({ typecheck: "tsc --noEmit", test: "vitest run" });
    const plan = buildScopePlan({ repoRoot: repo, scheme: scheme() });
    expect(plan.budget.plain).toMatch(/最多改约 \d+ 个文件/);
    expect(plan.budget.plain).toMatch(/预计 \d+～\d+ 分钟/);
    expect(plan.budget.plain).not.toMatch(BANNED_PLAIN);
  });

  it("areas[].label 不含 token / tool / glob / **", () => {
    writePackageJson({ typecheck: "tsc --noEmit" });
    write("src/pages/home.tsx", "");
    write("src/components/button.tsx", "");
    const plan = buildScopePlan({
      repoRoot: repo,
      scheme: scheme({
        summary: "整个 src 目录都要动",
        modules: ["pages", "components"],
      }),
    });
    expect(plan.areas.length).toBeGreaterThan(1);
    for (const area of plan.areas) {
      expect(area.label).not.toMatch(BANNED_PLAIN);
    }
  });
});

describe("TASK-J.2 用户排除区域", () => {
  it("排除后 excluded_by_user=true，合同 writable 相应收敛，digest 变化", () => {
    writePackageJson();
    write("src/pages/home.tsx", "");
    write("src/components/button.tsx", "");
    const plan = buildScopePlan({
      repoRoot: repo,
      scheme: scheme({
        summary: "整个 src 目录都要动",
        modules: ["pages", "components"],
      }),
    });
    expect(plan.areas.length).toBe(2);
    const target = plan.areas[0]!;
    const next = applyScopeDecisions(plan, {
      excluded_area_ids: [target.id],
    });
    expect(next.areas[0]!.excluded_by_user).toBe(true);
    expect(scopePlanToContractScope(next).writable_paths).not.toContain(
      target.paths[0],
    );
    expect(next.plan_digest).not.toBe(plan.plan_digest);
  });
});

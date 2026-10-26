import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { softwareContractSchema } from "../../src/lib/contract.schema";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import { SupervisorBudgetLedger } from "../../daemon/supervisor/budget";
import {
  ContractDraftError,
  generateContractDraft,
  submitDraftForApproval,
} from "../../daemon/supervisor/draft-generator";
import {
  DEFAULT_DRAFT_BUDGET,
  DEFAULT_DRAFT_COMMANDS,
  extractPathsFromText,
  inferIntentPaths,
} from "../../daemon/supervisor/rules-l0";
import type { SupervisorMessage } from "../../daemon/supervisor/types";

/**
 * TASK-S.2 精简版：按需合同草案生成（L0 规则优先 / L1 按需补全）。
 *
 * 覆盖四类验收点：
 * - 按需触发纪律：定时/防抖触发零模型调用；
 * - L0 规则提取：路径、默认命令、默认预算、保护清单匹配；
 * - G-11：未决问题逐项保留，一条都不能少；
 * - 费用分账：L1 用量只进 Supervisor 独立账本。
 */

const tmpDirs: string[] = [];

/**
 * 常规项目仓库：**有** `package.json`。
 *
 * 必须显式造出来，否则 `isGreenfieldRepo()` 会把这些临时目录判成绿野，
 * `alignWritableWithNpmVerification` 就会把 14 条脚手架种子并入可写范围、
 * 把预算抬到 40——那测的就不是「默认值」和「显式 scope」了。
 * 绿野分支另有 `newGreenfieldRepo()` 专门覆盖。
 */
function newRepo(): string {
  const dir = newTempRepo();
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true }),
  );
  return dir;
}

/** 绿野仓库：无 `package.json`，用于覆盖 npm 验收对齐补丁。 */
function newGreenfieldRepo(): string {
  return newTempRepo();
}

function newTempRepo(): string {
  const root = path.join(process.cwd(), ".tmp", "unit-supervisor-draft");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "draft-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, ".stagent"), { recursive: true });
  return dir;
}

function writeProtection(
  repo: string,
  patterns: string[],
  name = "登录",
): void {
  fs.writeFileSync(
    path.join(repo, ".stagent", "protection.json"),
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: "prot-1",
          name,
          patterns,
          createdAt: "2026-10-21T00:00:00.000Z",
        },
      ],
    }),
  );
}

function msgs(...texts: string[]): SupervisorMessage[] {
  return texts.map((text, index) => ({
    message_id: `m-${index + 1}`,
    role: "user" as const,
    text,
    created_at: "2026-10-21T00:00:00.000Z",
    source: "ui" as const,
  }));
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      safeRmSync(dir);
    } catch {
      // 沙箱可能拦截 unlink
    }
  }
});

describe("按需触发纪律（零轮询）", () => {
  it("IDLE_TIMER / DEBOUNCE_TIMER 一律不生成，且一次模型调用都不发生", async () => {
    const repo = newRepo();
    const enrich = vi.fn(async () => ({
      rationale: ["不该被调用"],
      unresolved_questions: [],
      model_id: "model-x",
      input_tokens: 10,
      output_tokens: 10,
    }));
    const budget = SupervisorBudgetLedger.independent({ repoRoot: repo });

    for (const trigger of ["IDLE_TIMER", "DEBOUNCE_TIMER"] as const) {
      const outcome = await generateContractDraft({
        repoRoot: repo,
        messages: msgs("帮我把登录改好"),
        trigger,
        enrich,
        budgetLedger: budget,
      });
      expect(outcome.generated).toBe(false);
      if (!outcome.generated) {
        expect(outcome.reason).toBe("NOT_REQUESTED");
        expect(outcome.model_calls).toBe(0);
      }
    }

    expect(enrich).not.toHaveBeenCalled();
    expect(budget.snapshot().total_tokens).toBe(0);
  });

  it("USER_REQUEST 与 CONTROL_PLANE_EVENT 均可生成，纯 L0 时 model_calls = 0", async () => {
    const repo = newRepo();
    for (const trigger of ["USER_REQUEST", "CONTROL_PLANE_EVENT"] as const) {
      const outcome = await generateContractDraft({
        repoRoot: repo,
        messages: msgs("新增接口 `src/api/health.ts`，并补测试"),
        trigger,
      });
      expect(outcome.generated).toBe(true);
      if (outcome.generated) {
        expect(outcome.model_calls).toBe(0);
        expect(outcome.usage).toBeUndefined();
      }
    }
  });
});

describe("L0 规则提取", () => {
  it("从文本提取路径，并过滤绝对路径 / .. 穿越 / 依赖目录", () => {
    const paths = extractPathsFromText(
      "改 src/auth/login.ts 与 /etc/passwd，还有 ../outside.ts、node_modules/x/y.js，别忘了 docs/README.md",
    );
    expect(paths).toContain("src/auth/login.ts");
    expect(paths).toContain("docs/README.md");
    expect(paths).not.toContain("/etc/passwd");
    expect(paths).not.toContain("../outside.ts");
    expect(paths).not.toContain("node_modules/x/y.js");
  });

  it("未提具体路径时按意图关键词推断（确定性的目录映射）", () => {
    expect(inferIntentPaths("帮我补一版单元测试和用例")).toEqual(["tests/**"]);
    expect(inferIntentPaths("更新使用说明文档")).toEqual(["docs/**"]);
    expect(inferIntentPaths("把界面组件的样式调一下")).toEqual([
      "src/components/**",
      "src/routes/**",
    ]);
    // 没命中任何规则 → 最保守的源目录
    expect(inferIntentPaths("随便看看")).toEqual(["src/**"]);
  });

  it("草案使用默认验证命令与默认安全预算（含计数值上限）", async () => {
    const repo = newRepo();
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("改一下 `src/lib/x.ts`"),
      trigger: "USER_REQUEST",
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;

    const { contract } = outcome;
    expect(contract.verification_spec.commands).toHaveLength(
      DEFAULT_DRAFT_COMMANDS.length,
    );
    expect(
      contract.verification_spec.commands.map((command) => command.alias),
    ).toEqual(["typecheck", "test"]);
    expect(contract.authorization.budget_limits).toMatchObject({
      max_file_modifications: DEFAULT_DRAFT_BUDGET.max_file_modifications,
      max_command_executions: DEFAULT_DRAFT_BUDGET.max_command_executions,
      max_tool_calls: DEFAULT_DRAFT_BUDGET.max_tool_calls,
    });
  });

  it("绿野 + npm 验收：并入脚手架种子并把文件预算抬到 40（正常项目不受影响）", async () => {
    const reason = "给 `src/api/health.ts` 补一条健康检查";
    const greenfield = newGreenfieldRepo();
    const green = await generateContractDraft({
      repoRoot: greenfield,
      messages: msgs(reason),
      trigger: "USER_REQUEST",
    });
    expect(green.generated).toBe(true);
    if (!green.generated) return;

    const scope = green.contract.authorization.file_system_scope.writable_paths;
    // 用户提的路径仍排在最前，种子只做补齐
    expect(scope[0]).toBe("src/api/health.ts");
    expect(scope).toContain("package.json");
    expect(scope).toContain("tsconfig.json");
    expect(scope).toContain("tests/**");
    expect(green.contract.authorization.budget_limits.max_file_modifications).toBe(
      40,
    );

    // 对照组：仓库已有 package.json（非绿野）→ 不注入种子、预算保持默认
    const normal = newRepo();
    const plain = await generateContractDraft({
      repoRoot: normal,
      messages: msgs(reason),
      trigger: "USER_REQUEST",
    });
    expect(plain.generated).toBe(true);
    if (!plain.generated) return;
    expect(
      plain.contract.authorization.file_system_scope.writable_paths,
    ).toEqual(["src/api/health.ts"]);
    expect(
      plain.contract.authorization.budget_limits.max_file_modifications,
    ).toBe(DEFAULT_DRAFT_BUDGET.max_file_modifications);
  });

  it("草案 100% 通过 SoftwareContractV12 Schema，初始 DRAFT/DRAFT 且 worker_spec 齐备", async () => {
    const repo = newRepo();
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("为 `daemon/supervisor/rules-l0.ts` 补注释"),
      trigger: "USER_REQUEST",
      sessionId: "session-1",
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;

    expect(() => softwareContractSchema.parse(outcome.contract)).not.toThrow();
    expect(outcome.contract.lifecycle_state).toBe("DRAFT");
    expect(outcome.contract.approval.status).toBe("DRAFT");
    expect(outcome.contract.worker_spec.control_mode).toBe("GATEWAY_ENFORCED");
    expect(
      outcome.contract.authorization.file_system_scope.writable_paths,
    ).toEqual(["daemon/supervisor/rules-l0.ts"]);
    // 溯源：会话 id 与消息 id 全部保留
    expect(outcome.contract.conversation_ref).toEqual({
      session_id: "session-1",
      message_ids: ["m-1"],
      context_policy: "USER_SELECTED",
    });
  });

  it("显式 scope 覆盖自动提取；合同禁区默认收进 .stagent", async () => {
    const repo = newRepo();
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("改 `src/a.ts`"),
      trigger: "USER_REQUEST",
      scope: { writablePaths: ["daemon/x.ts"], readonlyPaths: ["docs/**"] },
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;

    const scope = outcome.contract.authorization.file_system_scope;
    expect(scope.writable_paths).toEqual(["daemon/x.ts"]);
    expect(scope.readonly_paths).toEqual(["docs/**"]);
    expect(scope.strictly_forbidden_paths).toContain("**/.stagent/**");
    expect(scope.strictly_forbidden_paths).toContain(".env*");
  });
});

describe("保护清单匹配（L0）", () => {
  it("命中保护区时：路径仍留在可写范围，同时标记需一次人工确认", async () => {
    const repo = newRepo();
    writeProtection(repo, ["src/auth/**"], "登录");

    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("把 `src/auth/login.ts` 的过期逻辑修掉"),
      trigger: "USER_REQUEST",
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;

    expect(outcome.plan.needs_protection_approval).toBe(true);
    expect(outcome.plan.protected_files).toContain("src/auth/login.ts");
    expect(outcome.plan.protected_entry_names).toContain("登录");
    // 不静默删掉用户想改的文件
    expect(
      outcome.contract.authorization.file_system_scope.writable_paths,
    ).toContain("src/auth/login.ts");
    // 白话说清"需要你确认一次"
    expect(outcome.unresolved_questions[0]).toContain("登录");
  });

  it("无交集时不需要保护审批", async () => {
    const repo = newRepo();
    writeProtection(repo, ["src/auth/**"], "登录");
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("改 `docs/guide.md`"),
      trigger: "USER_REQUEST",
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;
    expect(outcome.plan.needs_protection_approval).toBe(false);
    expect(outcome.plan.protected_files).toEqual([]);
  });

  it("保护清单损坏 → 失败关闭（报错并要求人工确认）", async () => {
    const repo = newRepo();
    fs.writeFileSync(path.join(repo, ".stagent", "protection.json"), "{oops");
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("改 `src/a.ts`"),
      trigger: "USER_REQUEST",
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;
    expect(outcome.plan.protection_error).toBeTruthy();
    expect(outcome.plan.needs_protection_approval).toBe(true);
    expect(
      outcome.unresolved_questions.some((q) => q.includes("保护清单无法解析")),
    ).toBe(true);
  });
});

describe("G-11：未决问题 100% 保留", () => {
  it("L0 与 L1 的问题全部进入草案元数据，逐项无遗漏", async () => {
    const repo = newRepo();
    writeProtection(repo, ["src/auth/**"], "登录");
    const budget = SupervisorBudgetLedger.independent({ repoRoot: repo });

    const l1Questions = ["失败重试策略要不要改？", "是否需要兼容旧 token？"];
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("把 `src/auth/login.ts` 改掉"),
      trigger: "USER_REQUEST",
      budgetLedger: budget,
      enrich: () => ({
        rationale: ["命中了登录区，范围合理。"],
        unresolved_questions: l1Questions,
        model_id: "deepseek-chat",
        input_tokens: 900,
        output_tokens: 120,
      }),
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;

    const stored =
      outcome.contract.supervisor_metadata?.maturity_assessment
        ?.unresolved_questions ?? [];
    // L0 的问题（保护清单）在前，L1 的两条在后，一条不少
    expect(stored).toHaveLength(3);
    expect(stored[0]).toContain("登录");
    expect(stored.slice(1)).toEqual(l1Questions);
    // 返回结果与元数据完全一致
    expect(outcome.unresolved_questions).toEqual(stored);
    // 白话理由同样落盘
    expect(
      outcome.contract.supervisor_metadata?.maturity_assessment?.rationale,
    ).toContain("命中了登录区，范围合理。");
  });

  it("未决问题为空时也保持为空数组（不塞占位、不臆造）", async () => {
    const repo = newRepo();
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("改 `docs/a.md`"),
      trigger: "USER_REQUEST",
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;
    expect(
      outcome.contract.supervisor_metadata?.maturity_assessment
        ?.unresolved_questions,
    ).toEqual([]);
  });
});

describe("费用分账与 v1.3.3 剔除项", () => {
  it("L1 用量只进 Supervisor 独立账本，Worker 账本零污染", async () => {
    const repo = newRepo();
    const worker = new CostMonitor({
      maxTotalTokens: 50_000,
      statePath: path.join(repo, ".stagent", "guard", "cost.json"),
    });
    worker.recordUsage(400, 100);

    const budget = SupervisorBudgetLedger.independent({ repoRoot: repo });
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("改 `src/a.ts`"),
      trigger: "USER_REQUEST",
      budgetLedger: budget,
      enrich: (prompt) => {
        // 提示词只给结构化事实，不含评分诱导
        expect(prompt).toContain("不要评分");
        return {
          rationale: ["范围来自你点名的文件。"],
          unresolved_questions: [],
          model_id: "deepseek-chat",
          input_tokens: 1_200,
          output_tokens: 300,
        };
      },
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;

    expect(outcome.model_calls).toBe(1);
    expect(outcome.usage?.inputTokens).toBe(1_200);
    // Supervisor 账本：1500；Worker 账本：仍 500
    expect(budget.snapshot().total_tokens).toBe(1_500);
    expect(worker.getTotals().totalTokens).toBe(500);
  });

  it("传了 enrich 却没传预算账本 → 拒绝生成（不能有免费调用）", async () => {
    const repo = newRepo();
    const enrich = vi.fn(() => ({
      rationale: [],
      unresolved_questions: [],
      model_id: "m",
      input_tokens: 1,
      output_tokens: 1,
    }));

    await expect(
      generateContractDraft({
        repoRoot: repo,
        messages: msgs("改 `src/a.ts`"),
        trigger: "USER_REQUEST",
        enrich,
      }),
    ).rejects.toBeInstanceOf(ContractDraftError);
    expect(enrich).not.toHaveBeenCalled();
  });

  it("v1.3.3 剔除项：草案不含成熟度评分，也不存在评估器模块", async () => {
    const repo = newRepo();
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("改 `src/a.ts`"),
      trigger: "USER_REQUEST",
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;

    const assessment =
      outcome.contract.supervisor_metadata?.maturity_assessment;
    expect(assessment).toBeDefined();
    // 有理由、有问题、有时间戳，就是没有分数
    expect(assessment?.rationale.length).toBeGreaterThan(0);
    expect(assessment?.assessed_at).toBeTruthy();
    expect("score" in (assessment ?? {})).toBe(false);

    // 成熟度评估器（v0.2+ 才做）不得出现在 v0.1 代码里
    expect(
      fs.existsSync(
        path.join(
          process.cwd(),
          "daemon",
          "supervisor",
          "maturity-evaluator.ts",
        ),
      ),
    ).toBe(false);
  });
});

describe("提交审阅（状态机联动）", () => {
  it("DRAFT → PENDING_APPROVAL/PENDING_REVIEW；非 DRAFT 拒绝", async () => {
    const repo = newRepo();
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("改 `src/a.ts`"),
      trigger: "USER_REQUEST",
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;

    const submitted = submitDraftForApproval(outcome.contract);
    expect(submitted.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(submitted.approval.status).toBe("PENDING_REVIEW");

    expect(() => submitDraftForApproval(submitted)).toThrow(
      expect.objectContaining({ name: "ContractDraftError" }),
    );
  });

  it("assessed_at 来自注入时钟（确定性）", async () => {
    const repo = newRepo();
    const fixed = new Date("2026-10-22T08:00:00.000Z");
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: msgs("改 `src/a.ts`"),
      trigger: "USER_REQUEST",
      now: () => fixed,
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;
    expect(
      outcome.contract.supervisor_metadata?.maturity_assessment?.assessed_at,
    ).toBe(fixed.toISOString());
  });
});

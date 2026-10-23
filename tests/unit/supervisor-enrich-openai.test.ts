import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSupervisorEnrich,
  EnrichError,
  isSupervisorEnrichConfigured,
  parseEnrichmentContent,
} from "../../daemon/supervisor/enrich-openai";
import { SupervisorBudgetLedger } from "../../daemon/supervisor/budget";
import { generateContractDraft } from "../../daemon/supervisor/draft-generator";
import type { SupervisorMessage } from "../../daemon/supervisor/types";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "STAGENT_MODEL",
] as const;
const saved: Record<string, string | undefined> = {};

function saveEnv(): void {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
}
function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const prev = saved[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

describe("parseEnrichmentContent", () => {
  it("解析 JSON 对象", () => {
    const out = parseEnrichmentContent(
      JSON.stringify({
        rationale: ["因为改的是按钮样式", "验证用现有测试"],
        unresolved_questions: ["要不要动移动端？"],
      }),
      "deepseek-chat",
      { input_tokens: 10, output_tokens: 20 },
    );
    expect(out.rationale).toHaveLength(2);
    expect(out.unresolved_questions).toEqual(["要不要动移动端？"]);
    expect(out.model_id).toBe("deepseek-chat");
    expect(out.input_tokens).toBe(10);
  });

  it("解析 fenced JSON", () => {
    const out = parseEnrichmentContent(
      '```json\n{"rationale":["a"],"unresolved_questions":[]}\n```',
      "m",
      { input_tokens: 1, output_tokens: 1 },
    );
    expect(out.rationale).toEqual(["a"]);
  });

  it("空内容 → ENRICH_EMPTY_RESPONSE", () => {
    expect(() =>
      parseEnrichmentContent("  ", "m", { input_tokens: 0, output_tokens: 0 }),
    ).toThrow(EnrichError);
  });
});

describe("createSupervisorEnrich", () => {
  it("未配置密钥 → ENRICH_MISSING_KEY", async () => {
    saveEnv();
    const enrich = createSupervisorEnrich({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(enrich("hello")).rejects.toMatchObject({
      enrichCode: "ENRICH_MISSING_KEY",
    });
  });

  it("成功调用 OpenAI 兼容口并记账字段齐全", async () => {
    saveEnv();
    process.env["OPENAI_API_KEY"] = "sk-test";
    process.env["OPENAI_BASE_URL"] = "https://example.invalid/v1";
    process.env["STAGENT_MODEL"] = "deepseek-chat";

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        model: string;
        messages: unknown[];
      };
      expect(body.model).toBe("deepseek-chat");
      expect(body.messages.length).toBe(2);
      return new Response(
        JSON.stringify({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  rationale: ["范围来自用户原话里的登录按钮"],
                  unresolved_questions: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 34 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const enrich = createSupervisorEnrich({ fetchImpl });
    const out = await enrich("【用户原话】\n- 改登录按钮");
    expect(out.rationale[0]).toContain("登录按钮");
    expect(out.input_tokens).toBe(12);
    expect(out.output_tokens).toBe(34);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const calledUrl = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(calledUrl).toBe("https://example.invalid/v1/chat/completions");
    // Authorization 头存在但不在断言里回显密钥值以外的结构
    const headers = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![1].headers as Record<string, string>;
    const auth = headers["authorization"] ?? "";
    expect(auth.startsWith("Bearer ")).toBe(true);
  });

  it("HTTP 非 2xx → ENRICH_HTTP_ERROR（可诊断、不含完整响应体灌水）", async () => {
    saveEnv();
    const enrich = createSupervisorEnrich({
      apiKey: "sk-test",
      baseURL: "https://example.invalid/v1",
      fetchImpl: (async () =>
        new Response("upstream boom ".repeat(50), {
          status: 500,
        })) as unknown as typeof fetch,
    });
    await expect(enrich("x")).rejects.toMatchObject({
      enrichCode: "ENRICH_HTTP_ERROR",
      status: 500,
    });
  });

  it("与 SupervisorBudgetLedger 联调：费用进独立账本", async () => {
    saveEnv();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-enrich-led-"));
    const enrich = createSupervisorEnrich({
      apiKey: "sk-test",
      baseURL: "https://example.invalid/v1",
      modelId: "deepseek-chat",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            model: "deepseek-chat",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    rationale: ["L1 理由"],
                    unresolved_questions: ["还要不要动 CSS？"],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 7 },
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });

    const message: SupervisorMessage = {
      message_id: "msg_1",
      role: "user",
      text: "修改登录按钮样式",
      created_at: new Date().toISOString(),
      source: "ui",
    };
    const ledger = SupervisorBudgetLedger.independent({ repoRoot: repo });
    const outcome = await generateContractDraft({
      repoRoot: repo,
      messages: [message],
      trigger: "USER_REQUEST",
      enrich,
      budgetLedger: ledger,
    });
    expect(outcome.generated).toBe(true);
    if (!outcome.generated) return;
    expect(outcome.model_calls).toBe(1);
    expect(outcome.rationale.some((l) => l.includes("L1 理由"))).toBe(true);
    expect(outcome.unresolved_questions).toContain("还要不要动 CSS？");
    expect(ledger.snapshot().total_tokens).toBeGreaterThan(0);
    expect(isSupervisorEnrichConfigured()).toBe(false); // 只用了 options.apiKey，环境仍空
  });
});

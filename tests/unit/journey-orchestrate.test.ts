import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContractDraft } from "../../src/lib/contract.schema";
import { RequirementsStore } from "../../daemon/supervisor/specs/requirements-store";
import { orchestrateJourney } from "../../daemon/supervisor/journey/orchestrate";
import type { DisputeReport } from "../../daemon/supervisor/dispute/types";
import type { ContractDraftGenerated } from "../../daemon/supervisor/draft-generator";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-s6-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, ".stagent"), { recursive: true });
  return dir;
}

function fakeDraft(
  title: string,
  risk: "LOW" | "MEDIUM",
): ContractDraftGenerated {
  const contract = createContractDraft({
    title,
    description: title,
    acceptanceCriteria: ["ok"],
    writablePaths: ["src/a.ts"],
    riskLevel: risk,
  });
  return {
    generated: true,
    contract,
    plan: {
      title,
      description: title,
      acceptance_criteria: ["ok"],
      writable_paths: ["src/a.ts"],
      readonly_paths: [],
      strictly_forbidden_paths: [],
      commands: [],
      budget: {
        max_file_modifications: 20,
        max_total_diff_lines: 500,
        max_duration_seconds: 600,
        max_verification_retries: 3,
      },
      protected_files: [],
      protected_entry_names: [],
      needs_protection_approval: false,
      unresolved_questions: [],
    },
    rationale: ["测试草案"],
    unresolved_questions: [],
    model_calls: 0,
  };
}

describe("TASK-S.6 orchestrateJourney", () => {
  it("CHAT 透传，不调引擎", async () => {
    const result = await orchestrateJourney({
      message: "你好",
      repoRoot: repo(),
      runDispute: async () => {
        throw new Error("should not dispute");
      },
      runDraft: async () => {
        throw new Error("should not draft");
      },
    });
    expect(result.route).toBe("CHAT");
    expect(result.dispute_report).toBeUndefined();
    expect(result.draft).toBeUndefined();
  });

  it("DISPUTE 无合同 → CONTRACT_REQUIRED 白话", async () => {
    const result = await orchestrateJourney({
      message: "这里做错了",
      repoRoot: repo(),
    });
    expect(result.route).toBe("DISPUTE");
    expect(result.code).toBe("CONTRACT_REQUIRED");
    expect(result.plain_summary).toMatch(/合同|草案/);
  });

  it("DISPUTE 有合同 → 调 runDispute 并建议 dispute 视口", async () => {
    const contract = createContractDraft({
      title: "满减",
      description: "d",
      acceptanceCriteria: ["a"],
      writablePaths: ["src/**"],
    });
    const report = {
      report_id: "r1",
      contract_id: contract.contract_id,
      plain_summary: "更像是实现漏了。",
    } as DisputeReport;
    const result = await orchestrateJourney({
      message: "这里做错了，帮我查",
      repoRoot: repo(),
      contract,
      runDispute: async () => report,
    });
    expect(result.route).toBe("DISPUTE");
    expect(result.dispute_report).toBe(report);
    expect(result.suggest_viewport).toBe("dispute");
    expect(result.plain_summary).toContain("实现漏了");
  });

  it("FAST_PATH → 草案 LOW + skip_demo + 刷新需求", async () => {
    const root = repo();
    const store = new RequirementsStore(root, {
      clock: () => new Date("2026-10-24T02:00:00.000Z"),
    });
    const result = await orchestrateJourney({
      message: "把标题字号调大一点",
      repoRoot: root,
      requirementsStore: store,
      runDraft: async (_intent, risk) => fakeDraft("字号微调", risk),
      now: () => new Date("2026-10-24T02:00:00.000Z"),
    });
    expect(result.route).toBe("FAST_PATH");
    expect(result.skip_demo).toBe(true);
    expect(result.draft?.contract.intent.risk_level).toBe("LOW");
    expect(result.requirements_updated).toBe(true);
    expect(result.requirements_hint).toMatch(/需求说明已更新/);
    expect(result.suggest_viewport).toBe("contract");
  });

  it("MAJOR_DRAFT → 草案 + demo 视口建议", async () => {
    const result = await orchestrateJourney({
      message: "我想做一个完整的订单满减功能",
      repoRoot: repo(),
      runDraft: async (_intent, risk) => fakeDraft("订单满减", risk),
    });
    expect(result.route).toBe("MAJOR_DRAFT");
    expect(result.draft).toBeTruthy();
    expect(result.suggest_viewport).toBe("demo");
    expect(result.plain_summary).toMatch(/草案/);
  });
});

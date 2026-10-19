import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  AiWorker,
  WorkerScopeError,
  type WorkerModelClient,
} from "../../daemon/worker/ai-worker";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const fakeClient = (
  changes: Array<{ path: string; content: string }>,
): WorkerModelClient => ({
  generateChanges: async () => ({
    changes,
    log: ["生成改动"],
    usage: { inputTokens: 120, outputTokens: 80 },
  }),
});

describe("M5-fix / 受控 AI Worker", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-worker-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const makeContract = (overrides: { maxCostMinorUnits?: number } = {}) => {
    const draft = createContractDraft({
      title: "worker task",
      description: "add b",
      acceptanceCriteria: ["build passes"],
      writablePaths: ["src/**"],
      ...(overrides.maxCostMinorUnits === undefined
        ? {}
        : { maxCostMinorUnits: overrides.maxCostMinorUnits }),
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "tester",
        approved_at: new Date().toISOString(),
      },
    });
  };

  it("授权范围内改动：经网关写入并记录用量", async () => {
    const contract = makeContract();
    const costMonitor = new CostMonitor({
      maxCostMinorUnits: 10_000,
      currency: "CNY",
      statePath: path.join(root, ".stagent", "guard", "cost.json"),
    });
    const gateway = new ScopedWorktreeGateway(root, contract, { costMonitor });
    const worker = new AiWorker({
      gateway,
      costMonitor,
      modelClient: fakeClient([
        { path: "src/b.ts", content: "export const b = 2;\n" },
      ]),
    });

    const result = await worker.run();
    expect(result.applied).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(fs.readFileSync(path.join(root, "src", "b.ts"), "utf8")).toContain(
      "export const b = 2",
    );
    expect(costMonitor.getTotals().totalTokens).toBe(200);
    expect(
      fs.existsSync(path.join(root, ".stagent", "guard", "cost.json")),
    ).toBe(true);
  });

  it("越权路径整批拒绝，且不落任何文件", async () => {
    const contract = makeContract();
    const costMonitor = new CostMonitor();
    const gateway = new ScopedWorktreeGateway(root, contract, { costMonitor });
    const worker = new AiWorker({
      gateway,
      costMonitor,
      modelClient: fakeClient([
        { path: "src/b.ts", content: "ok" },
        { path: "package.json", content: "{}" },
      ]),
    });

    await expect(worker.run()).rejects.toBeInstanceOf(WorkerScopeError);
    expect(fs.existsSync(path.join(root, "src", "b.ts"))).toBe(false);
  });

  it("超出文件数预算整批拒绝", async () => {
    const contract = makeContract();
    const limited = softwareContractSchema.parse({
      ...contract,
      authorization: {
        ...contract.authorization,
        budget_limits: {
          ...contract.authorization.budget_limits,
          max_file_modifications: 1,
        },
      },
    });
    const costMonitor = new CostMonitor();
    const gateway = new ScopedWorktreeGateway(root, limited, { costMonitor });
    const worker = new AiWorker({
      gateway,
      costMonitor,
      modelClient: fakeClient([
        { path: "src/b.ts", content: "1" },
        { path: "src/c.ts", content: "2" },
      ]),
    });

    await expect(worker.run()).rejects.toBeInstanceOf(WorkerScopeError);
    expect(fs.existsSync(path.join(root, "src", "b.ts"))).toBe(false);
  });

  it("费用预检失败时不调用模型（E_BUDGET_EXCEEDED）", async () => {
    const contract = makeContract({ maxCostMinorUnits: 0 });
    let called = false;
    const costMonitor = new CostMonitor({
      maxCostMinorUnits: 0,
      currency: "CNY",
    });
    const gateway = new ScopedWorktreeGateway(root, contract, { costMonitor });
    const worker = new AiWorker({
      gateway,
      costMonitor,
      modelClient: {
        generateChanges: async () => {
          called = true;
          return {
            changes: [],
            log: [],
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
      },
    });

    await expect(worker.run()).rejects.toMatchObject({
      code: "E_BUDGET_EXCEEDED",
    });
    expect(called).toBe(false);
  });
});

describe("M5-fix / 编排器 runWorker", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-worker-flow-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("审批后运行 Worker，改动落入 Worktree，随后验证通过进入 AUDITED", async () => {
    const draft = createContractDraft({
      title: "flow",
      description: "add b",
      acceptanceCriteria: ["pass"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    new ContractStore(repo).save(contract);

    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    await orchestrator.approve(contract.contract_id, "tina");

    const result = await orchestrator.runWorker(contract.contract_id, {
      modelClient: fakeClient([
        { path: "src/b.ts", content: "export const b = 2;\n" },
      ]),
    });
    expect(result.applied).toBe(true);

    const worktreeFile = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
      "src",
      "b.ts",
    );
    expect(fs.existsSync(worktreeFile)).toBe(true);

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.evidence.verdict.status).toBe("PASSED");
  });
});

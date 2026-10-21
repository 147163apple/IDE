import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import type { RuntimeInterceptor } from "../../daemon/worker/runtime-interceptor";
import type { GatewayViolation } from "../../daemon/worker/runtime-interceptor";
import type { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  loadCurrentGatewayViolation,
  saveGatewayViolation,
} from "../../daemon/guard/gateway-violation-store";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";

vi.mock("../../daemon/runner/command-runner", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../daemon/runner/command-runner")>();
  return { ...actual, runCommand: vi.fn(actual.runCommand) };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

import { runCommand } from "../../daemon/runner/command-runner";
import { git } from "../helpers/git";

function makeContract(
  title: string,
  command: { executable: string; args: string[] },
): SoftwareContract {
  const draft = createContractDraft({
    title,
    description: "W.4 orchestrator guard",
    acceptanceCriteria: ["命令受控"],
    writablePaths: ["src/**"],
    commands: [
      {
        alias: "verify",
        executable: command.executable,
        args: command.args,
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ],
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
  });
}

describe("W.4 / 编排器威胁守卫与证据门禁", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w4-orch-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
    vi.mocked(runCommand).mockClear();
  });

  afterEach(() => {
    try {
      fs.rmSync(repo, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  });

  it("sudo 验证命令不产生子进程，Evidence 为 BLOCKED + UNSAFE_EXECUTION", async () => {
    const contract = makeContract("sudo guard", {
      executable: "sudo",
      args: ["ls"],
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    vi.mocked(runCommand).mockClear();
    vi.mocked(spawn).mockClear();

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.evidence.verdict.status).toBe("BLOCKED");
    expect(outcome.evidence.verdict.reason_code).toBe("UNSAFE_EXECUTION");
    expect(runCommand).toHaveBeenCalledTimes(0);
    const sudoSpawns = vi
      .mocked(spawn)
      .mock.calls.filter((call) => String(call[0]).includes("sudo"));
    expect(sudoSpawns).toHaveLength(0);
  });

  it("未知工具触发 GATEWAY_VIOLATION，随后 Evidence 不是 PASSED", async () => {
    const contract = makeContract("unknown tool", {
      executable: "node",
      args: ["-e", "process.exit(0)"],
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    const events: GatewayViolation[] = [];
    orchestrator = new ContractOrchestrator({
      repoRoot: repo,
      onGatewayViolation: (v) => events.push(v),
    });

    const current = store.get(contract.contract_id) as SoftwareContract;
    const runtime = (
      orchestrator as unknown as {
        buildRuntime: (c: SoftwareContract) => {
          gateway: ScopedWorktreeGateway;
          interceptor: RuntimeInterceptor;
        };
      }
    ).buildRuntime(current);

    const res = await runtime.gateway.callTool("native_fs_write", {
      path: "src/a.ts",
      content: "hacked",
    });
    expect(res.isError).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("GATEWAY_VIOLATION");
    expect(runtime.interceptor.canProduceEvidence()).toBe(false);

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.evidence.verdict.status).toBe("BLOCKED");
    expect(outcome.evidence.verdict.reason_code).toBe("UNSAFE_EXECUTION");
    expect(outcome.evidence.worker_control_mode).toBe("UNCONTROLLED_EXTERNAL");
  });

  it("违规按合同隔离：合同 A 违规不影响合同 B 通过", async () => {
    const a = makeContract("A", {
      executable: "node",
      args: ["-e", "process.exit(0)"],
    });
    const b = makeContract("B", {
      executable: "node",
      args: ["-e", "process.exit(0)"],
    });
    store.save(a);
    store.save(b);
    await orchestrator.approve(a.contract_id, "tina");
    await orchestrator.approve(b.contract_id, "tina");

    const events: GatewayViolation[] = [];
    const watching = new ContractOrchestrator({
      repoRoot: repo,
      onGatewayViolation: (v) => events.push(v),
    });
    const runtime = (
      watching as unknown as {
        buildRuntime: (c: SoftwareContract) => {
          gateway: ScopedWorktreeGateway;
        };
      }
    ).buildRuntime(store.get(a.contract_id) as SoftwareContract);
    await runtime.gateway.callTool("native_fs_write", { path: "src/a.ts" });
    expect(events).toHaveLength(1);

    const outcomeB = await orchestrator.execute(b.contract_id);
    expect(outcomeB.evidence.verdict.status).toBe("PASSED");

    const outcomeA = await orchestrator.execute(a.contract_id);
    expect(outcomeA.evidence.verdict.status).toBe("BLOCKED");
  });

  it("revision 变化后旧违规记录不再生效", () => {
    const violation: GatewayViolation = {
      type: "GATEWAY_VIOLATION",
      code: "UNKNOWN_CHANNEL",
      reason: "test",
      adapter_id: "a",
      at: new Date().toISOString(),
    };
    saveGatewayViolation(repo, "c1", 1, violation);
    expect(loadCurrentGatewayViolation(repo, "c1", 1)?.code).toBe(
      "UNKNOWN_CHANNEL",
    );
    expect(loadCurrentGatewayViolation(repo, "c1", 2)).toBeNull();
  });
});

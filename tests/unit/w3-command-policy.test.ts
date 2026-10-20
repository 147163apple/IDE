import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  E_UNAUTHORIZED_COMMAND,
  runCommand,
  CommandSecurityError,
} from "../../daemon/runner/command-runner";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

/**
 * TASK-W.3：命令白名单与参数策略。
 * - 对外工具定义只留 command_alias（旧 command/executable 仅内部验证可用）；
 * - 白名单精确匹配，禁止「前缀 + 空格」放行；
 * - 追加参数统一过 assertAliasExtraArgsAllowed；
 * - 裸解释器模板拒绝任何追加位置参数。
 */

interface CommandSpec {
  alias: string;
  executable: string;
  args: string[];
  expected_exit_code: number;
  timeout_seconds: number;
}

const COMMANDS: CommandSpec[] = [
  {
    alias: "noop",
    executable: "node",
    args: ["-e", "process.exit(0)"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "test",
    executable: "npx",
    args: ["vitest", "run"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "bare",
    executable: "node",
    args: [],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "port",
    executable: "node",
    args: [
      "-e",
      "console.error('Error: listen EADDRINUSE: address already in use :::3000'); process.exit(1);",
    ],
    expected_exit_code: 1,
    timeout_seconds: 30,
  },
  {
    alias: "npmExec",
    executable: "npm",
    args: ["exec", "--", "echo"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
];

function makeContract() {
  const draft = createContractDraft({
    title: "W.3 命令策略",
    description: "命令白名单与追加参数",
    acceptanceCriteria: ["追加参数必须过策略"],
    writablePaths: ["src/**"],
    commands: COMMANDS,
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: new Date().toISOString(),
    },
  });
}

describe("W.3 命令白名单与参数策略", () => {
  let worktree: string;
  let gateway: ScopedWorktreeGateway;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w3-cmd-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    gateway = new ScopedWorktreeGateway(worktree, makeContract());
  });

  afterEach(() => {
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  });

  it("对外工具定义不再暴露 command / executable", () => {
    const exec = gateway
      .getToolDefinitions()
      .find((tool) => tool.name === "stagent_exec_command");
    const props = exec?.inputSchema["properties"] as Record<string, unknown>;
    expect(props).toHaveProperty("command_alias");
    expect(props).toHaveProperty("args");
    expect(props).not.toHaveProperty("command");
    expect(props).not.toHaveProperty("executable");
  });

  it("Worker 走旧 executable 入口被拒；内部验证仍可使用", async () => {
    const workerCall = await gateway.callTool("stagent_exec_command", {
      executable: "node",
      args: ["-e", "process.exit(0)"],
    });
    expect(workerCall.isError).toBe(true);
    expect(workerCall.error?.code).toBe(E_UNAUTHORIZED_COMMAND);

    const legacyCommand = await gateway.callTool("stagent_exec_command", {
      command: "node -e process.exit(0)",
    });
    expect(legacyCommand.isError).toBe(true);
    expect(legacyCommand.error?.code).toBe(E_UNAUTHORIZED_COMMAND);

    const internalCall = await gateway.callTool(
      "stagent_exec_command",
      { executable: "node", args: ["-e", "process.exit(0)"] },
      { internal: true },
    );
    expect(internalCall.isError).toBe(false);
  });

  it("已授权 npx vitest run，追加 --config x 必须被拒", async () => {
    const res = await gateway.callTool("stagent_exec_command", {
      command_alias: "test",
      args: ["--config", "x"],
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe(E_UNAUTHORIZED_COMMAND);
    expect(
      (res.error?.details as { violation?: string } | undefined)?.violation,
    ).toBe("OPTION_INJECTION");
  });

  it("裸解释器模板拒绝任何追加位置参数", async () => {
    const res = await gateway.callTool("stagent_exec_command", {
      command_alias: "bare",
      args: ["evil.js"],
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe(E_UNAUTHORIZED_COMMAND);
    expect(
      (res.error?.details as { violation?: string } | undefined)?.violation,
    ).toBe("BARE_INTERPRETER");
  });

  it("端口被占用时返回 E_PORT_CONFLICT 与白话说明", async () => {
    const res = await gateway.callTool(
      "stagent_exec_command",
      { command_alias: "port" },
      { internal: true },
    );
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_PORT_CONFLICT");
    expect(res.error?.message).toContain("端口被占用");
    expect(res.error?.message).toContain("不是测试断言失败");
  });

  it("包启动器（npx/npm exec 等）拒绝追加位置参数", async () => {
    const npxRes = await gateway.callTool("stagent_exec_command", {
      command_alias: "test",
      args: ["extra.spec.ts"],
    });
    expect(npxRes.isError).toBe(true);
    expect(
      (npxRes.error?.details as { violation?: string } | undefined)?.violation,
    ).toBe("LAUNCHER_POSITIONAL_ARGS");

    const npmRes = await gateway.callTool("stagent_exec_command", {
      command_alias: "npmExec",
      args: ["some-package"],
    });
    expect(npmRes.isError).toBe(true);
    expect(
      (npmRes.error?.details as { violation?: string } | undefined)?.violation,
    ).toBe("LAUNCHER_POSITIONAL_ARGS");
  });

  it("runCommand 白名单只做精确匹配，不再按前缀放行", async () => {
    const allowedCommands = ["node -e process.exit(0)"];
    const ok = await runCommand("node", {
      cwd: worktree,
      argv: { executable: "node", args: ["-e", "process.exit(0)"] },
      allowedCommands,
      timeoutMs: 20_000,
    });
    expect(ok.exitCode).toBe(0);

    await expect(
      runCommand("node", {
        cwd: worktree,
        argv: {
          executable: "node",
          args: ["-e", "process.exit(0)", "--config", "x"],
        },
        allowedCommands,
        timeoutMs: 20_000,
      }),
    ).rejects.toBeInstanceOf(CommandSecurityError);
  });
});

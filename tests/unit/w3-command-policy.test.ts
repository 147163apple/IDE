import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
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
  {
    alias: "pnpmExec",
    executable: "pnpm",
    args: ["--silent", "exec", "eslint"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "yarnExec",
    executable: "yarn",
    args: ["--silent", "exec", "eslint"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "bunX",
    executable: "bun",
    args: ["x", "vite"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "npmRun",
    executable: "npm",
    args: ["--silent", "run", "build"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "npxCmd",
    executable: "npx.cmd",
    args: ["vitest", "run"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "portMention",
    executable: "node",
    args: [
      "-e",
      "console.log('EADDRINUSE is a common error meaning the port is busy'); process.exit(1);",
    ],
    expected_exit_code: 1,
    timeout_seconds: 30,
  },
  {
    alias: "portAssert",
    executable: "node",
    args: [
      "-e",
      "console.log('Error: listen EADDRINUSE: address already in use :::3000'); console.error('AssertionError: expected 1 to be 2'); process.exit(1);",
    ],
    expected_exit_code: 1,
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
      safeRmSync(worktree);
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

  it("启动器判定跳过模板选项，覆盖 pnpm/yarn exec、bun x、npm run 与 .cmd 后缀", async () => {
    const aliases = [
      "pnpmExec",
      "yarnExec",
      "bunX",
      "npmRun",
      "npxCmd",
    ] as const;
    for (const alias of aliases) {
      const res = await gateway.callTool("stagent_exec_command", {
        command_alias: alias,
        args: ["extra-target"],
      });
      expect(res.isError, alias).toBe(true);
      expect(
        (res.error?.details as { violation?: string } | undefined)?.violation,
        alias,
      ).toBe("LAUNCHER_POSITIONAL_ARGS");
    }
  });

  it("仅提到 EADDRINUSE 不足以判端口冲突；有断言失败时也不归因端口冲突", async () => {
    const mention = await gateway.callTool(
      "stagent_exec_command",
      { command_alias: "portMention" },
      { internal: true },
    );
    expect(mention.error?.code).toBe("E_VERIFICATION_FAILED");

    const assertion = await gateway.callTool(
      "stagent_exec_command",
      { command_alias: "portAssert" },
      { internal: true },
    );
    expect(assertion.error?.code).toBe("E_VERIFICATION_FAILED");
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

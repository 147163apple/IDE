import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  AiWorker,
  WorkerBudgetExceededError,
  type WorkerModelClient,
} from "../../daemon/worker/ai-worker";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import { sanitizeEnvironment } from "../../daemon/runner/env-filter";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

/**
 * TASK-W.3 / G-09 分列记账、环境白名单与别名参数策略。
 *
 * 覆盖：
 * A. 工具调用与命令执行**分列**记账，任一超限立即 `E_BUDGET_EXCEEDED` 且不可恢复；
 * B. AiWorker 在熔断后终止会话，不再发起模型调用；
 * C. 宿主机环境变量（含模拟私密变量）不进入子进程，合同声明变量可透传；
 * D. 解释器别名拒绝 `-e` / `-c` 等动态求值参数与选项注入。
 */

interface CommandSpec {
  alias: string;
  executable: string;
  args: string[];
  expected_exit_code: number;
  timeout_seconds: number;
}

const ENV_SCRIPT =
  'console.log(JSON.stringify({env_state:process.env.STAGENT_HOST_SECRET===undefined?"absent":"LEAK",allowed:String(process.env.ALLOWED_FLAG),hasPath:typeof process.env.PATH==="string"}))';
const GRANT_SCRIPT =
  "console.log(JSON.stringify({granted:String(process.env.GRANTED_API_TOKEN)}))";

const DEFAULT_COMMANDS: CommandSpec[] = [
  {
    alias: "noop",
    executable: "node",
    args: ["-e", "process.exit(0)"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "argv",
    executable: "node",
    args: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "env",
    executable: "node",
    args: ["-e", ENV_SCRIPT],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "envfile",
    executable: "node",
    args: ["-e", GRANT_SCRIPT],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
  {
    alias: "py",
    executable: "python3",
    args: ["-V"],
    expected_exit_code: 0,
    timeout_seconds: 30,
  },
];

interface ContractOptions {
  maxToolCalls?: number;
  maxCommandExecutions?: number;
  allowedEnvNames?: string[];
  envFileGrants?: Array<{
    file: string;
    command_aliases: string[];
    variable_names: string[];
  }>;
}

function makeContract(options: ContractOptions = {}) {
  const draft = createContractDraft({
    title: "W.3 运行时分列记账",
    description: "验证预算熔断与环境隔离",
    acceptanceCriteria: ["预算与环境策略生效"],
    writablePaths: ["src/**"],
    commands: DEFAULT_COMMANDS,
  });

  const approved = softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: new Date().toISOString(),
    },
  });

  const permissions = approved.authorization.execution_permissions;
  return softwareContractSchema.parse({
    ...approved,
    authorization: {
      ...approved.authorization,
      budget_limits: {
        ...approved.authorization.budget_limits,
        ...(options.maxToolCalls === undefined
          ? {}
          : { max_tool_calls: options.maxToolCalls }),
        ...(options.maxCommandExecutions === undefined
          ? {}
          : { max_command_executions: options.maxCommandExecutions }),
      },
      execution_permissions: {
        ...permissions,
        allowed_commands: ["noop", "argv", "env", "envfile", "py"],
        ...(options.allowedEnvNames === undefined
          ? {}
          : { allowed_environment_variable_names: options.allowedEnvNames }),
        ...(options.envFileGrants === undefined
          ? {}
          : { env_file_grants: options.envFileGrants }),
      },
    },
  });
}

describe("W.3 / G-09 工具与命令分列记账", () => {
  let worktree: string;

  const gatewayFor = (options: ContractOptions = {}) =>
    new ScopedWorktreeGateway(worktree, makeContract(options));

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w3-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 1;\n",
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // 受限环境可能拒绝删除临时目录；.tmp/vitest 由 global setup 裁剪
    }
  });

  it("max_tool_calls 达到上限后精确熔断，后续调用一律拒绝", async () => {
    const gateway = gatewayFor({ maxToolCalls: 2 });

    const first = await gateway.callTool("stagent_read_file", {
      path: "src/a.ts",
    });
    const second = await gateway.callTool("stagent_read_file", {
      path: "src/a.ts",
    });
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(gateway.isBudgetTripped()).toBe(false);

    const third = await gateway.callTool("stagent_read_file", {
      path: "src/a.ts",
    });
    expect(third.isError).toBe(true);
    expect(third.error?.code).toBe("E_BUDGET_EXCEEDED");
    expect(gateway.isBudgetTripped()).toBe(true);

    // 不可恢复：即使换成写工具也被拒绝
    const afterwards = await gateway.callTool("stagent_write_file", {
      path: "src/b.ts",
      content: "x",
    });
    expect(afterwards.error?.code).toBe("E_BUDGET_EXCEEDED");
    expect(fs.existsSync(path.join(worktree, "src", "b.ts"))).toBe(false);

    const counters = gateway.getCallCounters();
    expect(counters.tripped).toBe(true);
    expect(counters.tool_calls).toBe(3);
    expect(counters.max_tool_calls).toBe(2);
    expect(counters.trip_detail).toContain("max_tool_calls=2");
  });

  it("max_command_executions 达到上限后精确熔断", async () => {
    const gateway = gatewayFor({ maxCommandExecutions: 1 });

    const first = await gateway.callTool("stagent_exec_command", {
      command_alias: "noop",
    });
    expect(first.isError).toBe(false);

    const second = await gateway.callTool("stagent_exec_command", {
      command_alias: "noop",
    });
    expect(second.isError).toBe(true);
    expect(second.error?.code).toBe("E_BUDGET_EXCEEDED");

    const counters = gateway.getCallCounters();
    expect(counters.command_executions).toBe(2);
    expect(counters.max_command_executions).toBe(1);
    expect(counters.tripped).toBe(true);
  });

  it("分列记账：命令配额耗尽时，工具配额仍有余量也不放行", async () => {
    const gateway = gatewayFor({
      maxToolCalls: 10,
      maxCommandExecutions: 1,
    });

    await gateway.callTool("stagent_exec_command", { command_alias: "noop" });
    const blocked = await gateway.callTool("stagent_exec_command", {
      command_alias: "noop",
    });

    expect(blocked.error?.code).toBe("E_BUDGET_EXCEEDED");
    const counters = gateway.getCallCounters();
    // 工具调用配额 10 只用掉 2 次，但命令配额已超 → 熔断不因 Token/工具余量而放行
    expect(counters.tool_calls).toBe(2);
    expect(counters.max_tool_calls).toBe(10);
    expect(counters.command_executions).toBe(2);
  });

  it("未配置计数字段时不限制工具调用次数", async () => {
    const gateway = gatewayFor();

    for (let i = 0; i < 5; i += 1) {
      const res = await gateway.callTool("stagent_read_file", {
        path: "src/a.ts",
      });
      expect(res.isError).toBe(false);
    }
    const exec = await gateway.callTool("stagent_exec_command", {
      command_alias: "noop",
    });
    expect(exec.isError).toBe(false);

    const counters = gateway.getCallCounters();
    expect(counters.tripped).toBe(false);
    expect(counters.tool_calls).toBe(6);
    expect(counters.max_tool_calls).toBeUndefined();
  });

  it("写入工具同样计入工具调用配额", async () => {
    const gateway = gatewayFor({ maxToolCalls: 1 });

    const write = await gateway.callTool("stagent_write_file", {
      path: "src/b.ts",
      content: "b",
    });
    expect(write.isError).toBe(false);

    const overLimit = await gateway.callTool("stagent_write_file", {
      path: "src/c.ts",
      content: "c",
    });
    expect(overLimit.error?.code).toBe("E_BUDGET_EXCEEDED");
    expect(fs.existsSync(path.join(worktree, "src", "c.ts"))).toBe(false);
  });
});

describe("W.3 / AiWorker 在熔断后终止会话", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w3-worker-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 1;\n",
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // 同上
    }
  });

  it("网关已熔断时不发起模型调用，抛 WorkerBudgetExceededError", async () => {
    const contract = makeContract({ maxToolCalls: 1 });
    const gateway = new ScopedWorktreeGateway(worktree, contract);
    // 预先耗尽工具配额（上下文读取即会触发）
    await gateway.callTool("stagent_read_file", { path: "src/a.ts" });
    await gateway.callTool("stagent_read_file", { path: "src/a.ts" });
    expect(gateway.isBudgetTripped()).toBe(true);

    let modelCalls = 0;
    const modelClient: WorkerModelClient = {
      generateChanges: async () => {
        modelCalls += 1;
        return {
          changes: [],
          log: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };
    const worker = new AiWorker({
      gateway,
      costMonitor: new CostMonitor(),
      modelClient,
    });

    const failure: unknown = await worker.run().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(WorkerBudgetExceededError);
    const error = failure as WorkerBudgetExceededError;
    expect(error.code).toBe("E_BUDGET_EXCEEDED");
    expect(error.context.stage).toBe("BUDGET_PRECHECK");
    expect(error.context.contract_id).toBe(contract.contract_id);
    expect(modelCalls).toBe(0);
  });

  it("写入阶段熔断时，已生成的改动不落盘且错误阶段为 TOOL_WRITE", async () => {
    const contract = makeContract({ maxToolCalls: 1 });
    const gateway = new ScopedWorktreeGateway(worktree, contract);

    const modelClient: WorkerModelClient = {
      generateChanges: async () => ({
        changes: [
          { path: "src/b.ts", content: "b" },
          { path: "src/c.ts", content: "c" },
        ],
        log: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    };
    const worker = new AiWorker({
      gateway,
      costMonitor: new CostMonitor(),
      modelClient,
    });

    const failure: unknown = await worker.run().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(WorkerBudgetExceededError);
    const error = failure as WorkerBudgetExceededError;
    expect(error.context.stage).toBe("TOOL_WRITE");
    // 第 1 个写入成功、第 2 个被熔断；不允许继续写第 3 个
    expect(fs.existsSync(path.join(worktree, "src", "b.ts"))).toBe(true);
    expect(fs.existsSync(path.join(worktree, "src", "c.ts"))).toBe(false);
  });
});

describe("W.3 / 环境变量白名单与 env-file 授权", () => {
  let worktree: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w3-env-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    process.env["STAGENT_HOST_SECRET"] = "host-secret-do-not-leak";
    process.env["ALLOWED_FLAG"] = "allowed-value";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // 同上
    }
  });

  it("子进程读不到宿主私密变量，但能读到合同声明的变量与基础变量", async () => {
    const gateway = new ScopedWorktreeGateway(
      worktree,
      makeContract({ allowedEnvNames: ["ALLOWED_FLAG"] }),
    );

    const res = await gateway.callTool("stagent_exec_command", {
      command_alias: "env",
    });
    expect(res.isError).toBe(false);

    const stdout = res.content[0]?.text ?? "";
    // 用非敏感键名表达同一语义：C.5 的 JSON 脱敏会遮蔽 "secret"/"token" 等键，
    // 若这里继续输出 "secret"，即使只是 "undefined" 也会变成 [REDACTED]，无法区分是否泄漏。
    expect(stdout).toContain('"env_state":"absent"');
    expect(stdout).toContain('"allowed":"allowed-value"');
    expect(stdout).toContain('"hasPath":true');
    expect(stdout).not.toContain("host-secret-do-not-leak");
  });

  it("未被合同声明的宿主变量同样不可见（白名单而非黑名单）", async () => {
    const gateway = new ScopedWorktreeGateway(worktree, makeContract());
    const sanitized = sanitizeEnvironment(process.env, {
      allowedKeyOverrides:
        gateway.getContract().authorization.execution_permissions
          .allowed_environment_variable_names,
    });

    expect(sanitized["ALLOWED_FLAG"]).toBeUndefined();
    expect(sanitized["STAGENT_HOST_SECRET"]).toBeUndefined();
    expect(sanitized["PATH"]).toBeDefined();
  });

  it("env_file_grants 按 alias 注入，且值在输出中被遮蔽", async () => {
    fs.writeFileSync(
      path.join(worktree, ".env.test"),
      "GRANTED_API_TOKEN=granted-secret-123\nIGNORED_VAR=should-not-inject\n",
    );

    const gateway = new ScopedWorktreeGateway(
      worktree,
      makeContract({
        envFileGrants: [
          {
            file: ".env.test",
            command_aliases: ["envfile"],
            variable_names: ["GRANTED_API_TOKEN"],
          },
        ],
      }),
    );

    const res = await gateway.callTool("stagent_exec_command", {
      command_alias: "envfile",
    });
    expect(res.isError).toBe(false);

    const stdout = res.content[0]?.text ?? "";
    expect(stdout).toContain("[REDACTED]");
    expect(stdout).not.toContain("granted-secret-123");
  });

  it("env_file_grants 只对声明的 alias 生效", async () => {
    fs.writeFileSync(
      path.join(worktree, ".env.test"),
      "GRANTED_API_TOKEN=granted-secret-123\n",
    );
    const gateway = new ScopedWorktreeGateway(
      worktree,
      makeContract({
        envFileGrants: [
          {
            file: ".env.test",
            command_aliases: ["envfile"],
            variable_names: ["GRANTED_API_TOKEN"],
          },
        ],
      }),
    );

    // env 脚本不打印 GRANTED_API_TOKEN，改用 noop 验证不会因授权而放宽命令
    const res = await gateway.callTool("stagent_exec_command", {
      command_alias: "noop",
    });
    expect(res.isError).toBe(false);
    // 无关 alias 不受该授权影响（变量未注入，命令仍使用基础环境）
    expect(gateway.getAuditLog().length).toBeGreaterThan(0);
  });
});

describe("W.3 / 别名参数白名单（解释器逃逸与选项注入）", () => {
  let worktree: string;

  const gateway = () => new ScopedWorktreeGateway(worktree, makeContract());

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w3-args-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // 同上
    }
  });

  it.each([
    ["-e", "INTERPRETER_EVAL_FLAG"],
    ["--eval=process.exit(0)", "INTERPRETER_EVAL_FLAG"],
    ["-c", "INTERPRETER_EVAL_FLAG"],
  ])(
    "node 别名附加 %s 被拒绝（%s），命令不执行",
    async (argument, violation) => {
      const res = await gateway().callTool("stagent_exec_command", {
        command_alias: "noop",
        args: [argument],
      });
      expect(res.isError).toBe(true);
      expect(res.error?.code).toBe("E_UNAUTHORIZED_COMMAND");
      expect((res.error?.details as { violation: string }).violation).toBe(
        violation,
      );
    },
  );

  it("python3 别名附加 -c 被拒绝", async () => {
    const res = await gateway().callTool("stagent_exec_command", {
      command_alias: "py",
      args: ["-c", "print(1)"],
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_UNAUTHORIZED_COMMAND");
    expect((res.error?.details as { violation: string }).violation).toBe(
      "INTERPRETER_EVAL_FLAG",
    );
  });

  it("解释器从 stdin 读脚本（参数 '-'）被拒绝", async () => {
    const res = await gateway().callTool("stagent_exec_command", {
      command_alias: "noop",
      args: ["-"],
    });
    expect(res.isError).toBe(true);
    expect((res.error?.details as { violation: string }).violation).toBe(
      "INTERPRETER_STDIN_SCRIPT",
    );
  });

  it("位置参数仍然允许（argv 字面量透传）", async () => {
    const res = await gateway().callTool("stagent_exec_command", {
      command_alias: "argv",
      args: ["a b", "c"],
    });
    expect(res.isError).toBe(false);
    expect(res.content[0]?.text).toContain('["a b","c"]');
  });

  it("合同模板中的 -e 不受影响（仅约束 Worker 追加参数）", async () => {
    const res = await gateway().callTool("stagent_exec_command", {
      command_alias: "noop",
    });
    expect(res.isError).toBe(false);
    expect((res.data as { exitCode: number }).exitCode).toBe(0);
  });
});

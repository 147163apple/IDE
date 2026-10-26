import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";

import {
  MANAGED_AI_CAPABILITY,
  validateAdapterCapability,
  type AdapterCapabilityDeclaration,
  type CodingWorkerAdapter,
} from "../../daemon/worker/worker-adapter.interface";
import {
  AdapterRegistry,
  AdapterRegistrationError,
} from "../../daemon/worker/adapter-registry";
import {
  WORKER_STANDARD_TOOLS,
  WorkerBoundaryError,
  WorkerInstructionError,
  assertWorkerWorkspace,
  buildWorkerTaskInstruction,
  resolveExposedTools,
} from "../../daemon/worker/session-task-injector";
import {
  AiWorker,
  WorkerAdapterError,
  WorkerScopeError,
  type WorkerGenerationInput,
  type WorkerModelClient,
} from "../../daemon/worker/ai-worker";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

/**
 * TASK-W.1 / 受控 Worker 适配器与指令装配。
 *
 * 覆盖四组不变式：
 * A. 合同上下文无遗漏装配（目标 / 白名单 / 只读 / 禁区 / 验收 / 预算 / 已知限制）；
 * B. 未授权工具不暴露给 Worker；
 * C. Worktree 绑定不可穿透宿主项目根；
 * D. 适配器能力声明第 9 项 known_limitations 与注册中心默认拒绝。
 */

/**
 * macOS 上 `/var` 是指向 `/private/var` 的符号链接；实现侧用 realpath 规范化
 * Worktree 路径，断言必须采用同一口径，否则临时根不同就会产生假红。
 */
function canonicalPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function approvedContract(
  overrides: Parameters<typeof createContractDraft>[0] = {
    title: "worker 装配",
    description: "实现 b",
    acceptanceCriteria: ["npm test 通过"],
    writablePaths: ["src/**"],
  },
) {
  const draft = createContractDraft(overrides);
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

const WORKTREE = path.resolve("/tmp/stagent-w1/worktrees/task-contract_1");

/** 覆写命令白名单（默认草案会注入 test/lint/typecheck） */
function withAllowedCommands(
  contract: ReturnType<typeof approvedContract>,
  allowedCommands: string[],
) {
  return softwareContractSchema.parse({
    ...contract,
    authorization: {
      ...contract.authorization,
      execution_permissions: {
        ...contract.authorization.execution_permissions,
        allowed_commands: allowedCommands,
      },
    },
  });
}

describe("A. 合同上下文装配：逐字段无遗漏", () => {
  const contract = withAllowedCommands(
    approvedContract({
      title: "补齐 Worker 装配链路",
      description: "把合同字段注入 System Prompt",
      acceptanceCriteria: ["typecheck 通过", "lint 0 错误"],
      writablePaths: ["src/lib/**", "tests/unit/**"],
      readonlyPaths: ["docs/**"],
      strictlyForbiddenPaths: [".env*", "package-lock.json"],
      maxFileModifications: 7,
      maxDurationSeconds: 900,
      maxVerificationRetries: 2,
      maxCostMinorUnits: 5_000,
      commands: [
        {
          alias: "verify",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
    }),
    ["verify"],
  );

  const instruction = buildWorkerTaskInstruction({
    contract,
    worktreeRoot: WORKTREE,
    declaration: MANAGED_AI_CAPABILITY,
  });

  it("目标（objective）完整注入", () => {
    expect(instruction.objective.title).toBe("补齐 Worker 装配链路");
    expect(instruction.objective.description).toBe(
      "把合同字段注入 System Prompt",
    );
    expect(instruction.system_prompt).toContain("补齐 Worker 装配链路");
    expect(instruction.system_prompt).toContain("把合同字段注入 System Prompt");
  });

  it("可写白名单 / 只读路径 / 严格禁区全部出现在指令中", () => {
    expect(instruction.allowed_paths).toEqual(["src/lib/**", "tests/unit/**"]);
    expect(instruction.readonly_paths).toEqual(["docs/**"]);
    expect(instruction.forbidden_paths).toEqual([".env*", "package-lock.json"]);

    for (const pattern of ["src/lib/**", "tests/unit/**"]) {
      expect(instruction.system_prompt).toContain(pattern);
    }
    expect(instruction.system_prompt).toContain("docs/**");
    expect(instruction.system_prompt).toContain(".env*");
    expect(instruction.system_prompt).toContain("package-lock.json");
  });

  it("验收标准逐条注入且保持顺序", () => {
    expect(instruction.acceptance_criteria).toEqual([
      "typecheck 通过",
      "lint 0 错误",
    ]);
    const first = instruction.system_prompt.indexOf("1. typecheck 通过");
    const second = instruction.system_prompt.indexOf("2. lint 0 错误");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it("命令白名单与全部预算上限注入", () => {
    expect(instruction.command_budget.allowed_commands).toEqual(["verify"]);
    expect(instruction.command_budget.max_file_modifications).toBe(7);
    expect(instruction.command_budget.max_duration_seconds).toBe(900);
    expect(instruction.command_budget.max_verification_retries).toBe(2);
    expect(instruction.command_budget.max_cost_minor_units).toBe(5_000);

    expect(instruction.system_prompt).toContain("verify");
    expect(instruction.system_prompt).toContain("最大修改文件数：7");
    expect(instruction.system_prompt).toContain("任务总时长上限：900s");
    expect(instruction.system_prompt).toContain("最大验证重试次数：2");
    expect(instruction.system_prompt).toContain("5000 CNY");
  });

  it("Worktree 根注入且规范化，段落结构可被 UI 复用", () => {
    expect(instruction.worktree_root).toBe(WORKTREE);
    expect(instruction.system_prompt).toContain(WORKTREE);
    expect(instruction.sections.map((section) => section.title)).toContain(
      "角色与边界",
    );
    expect(instruction.sections.length).toBeGreaterThanOrEqual(8);
  });

  it("第 9 项 known_limitations 默认注入内置声明", () => {
    expect(instruction.known_limitations).toEqual(
      MANAGED_AI_CAPABILITY.known_limitations,
    );
    expect(instruction.known_limitations.length).toBeGreaterThan(0);
    for (const limitation of MANAGED_AI_CAPABILITY.known_limitations) {
      expect(instruction.system_prompt).toContain(limitation);
    }
  });

  it("未提供声明时明确标注「未声明已知限制」", () => {
    const bare = buildWorkerTaskInstruction({
      contract,
      worktreeRoot: WORKTREE,
    });
    expect(bare.known_limitations).toEqual([]);
    expect(bare.system_prompt).toContain("适配器未声明已知限制");
  });

  it("未批准的合同拒绝装配（审批前置）", () => {
    const draft = createContractDraft({
      title: "draft",
      description: "x",
      acceptanceCriteria: ["y"],
      writablePaths: ["src/**"],
    });
    const pending = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    expect(() =>
      buildWorkerTaskInstruction({
        contract: pending,
        worktreeRoot: WORKTREE,
      }),
    ).toThrowError(WorkerInstructionError);
  });
});

describe("B. 工具暴露：未配置 / 未授权的工具不出现在上下文中", () => {
  it("合同未授权任何命令别名时，exec 工具不暴露", () => {
    const contract = withAllowedCommands(approvedContract(), []);
    expect(
      contract.authorization.execution_permissions.allowed_commands,
    ).toEqual([]);

    const instruction = buildWorkerTaskInstruction({
      contract,
      worktreeRoot: WORKTREE,
      declaration: MANAGED_AI_CAPABILITY,
    });
    expect(instruction.exposed_tools).not.toContain("stagent_exec_command");
    expect(instruction.exposed_tools).toHaveLength(
      WORKER_STANDARD_TOOLS.length - 1,
    );
    expect(instruction.system_prompt).not.toContain("stagent_exec_command：");
    expect(instruction.system_prompt).toContain("禁止执行任何命令");
  });

  it("合同授权命令后 exec 工具恢复暴露", () => {
    const contract = withAllowedCommands(
      approvedContract({
        title: "with commands",
        description: "x",
        acceptanceCriteria: ["y"],
        writablePaths: ["src/**"],
        commands: [
          {
            alias: "verify",
            executable: "npm",
            args: ["test"],
            expected_exit_code: 0,
            timeout_seconds: 60,
          },
        ],
      }),
      ["verify"],
    );
    const tools = resolveExposedTools(contract);
    expect(tools).toContain("stagent_exec_command");
    expect(tools).toHaveLength(WORKER_STANDARD_TOOLS.length);
  });

  it("调用方只能收窄工具子集，不能凭空扩大", () => {
    const contract = withAllowedCommands(
      approvedContract({
        title: "subset",
        description: "x",
        acceptanceCriteria: ["y"],
        writablePaths: ["src/**"],
      }),
      ["verify"],
    );

    expect(
      resolveExposedTools(contract, [
        "stagent_read_file",
        "stagent_write_file",
      ]),
    ).toEqual(["stagent_read_file", "stagent_write_file"]);

    expect(() => resolveExposedTools(contract, ["shell_exec"])).toThrowError(
      /unknown worker tool/,
    );
  });

  it("合同未授权命令时，显式请求 exec 工具被拒绝", () => {
    const contract = withAllowedCommands(approvedContract(), []);
    expect(() =>
      resolveExposedTools(contract, ["stagent_exec_command"]),
    ).toThrowError(/not authorized/);
  });
});

describe("C. Worktree 边界：不可穿透至宿主项目根", () => {
  const repoRoot = path.resolve("/tmp/stagent-w1/repo");
  const validWorktree = path.join(repoRoot, ".stagent", "worktrees", "task-1");

  it("合法隔离目录通过校验并返回绝对路径", () => {
    expect(
      assertWorkerWorkspace({ worktreeRoot: validWorktree, repoRoot }),
    ).toBe(validWorktree);
  });

  it("Worktree 等于宿主根 → 拒绝", () => {
    expect(() =>
      assertWorkerWorkspace({ worktreeRoot: repoRoot, repoRoot }),
    ).toThrowError(WorkerBoundaryError);
  });

  it("Worktree 是宿主根的祖先 → 拒绝", () => {
    expect(() =>
      assertWorkerWorkspace({ worktreeRoot: path.dirname(repoRoot), repoRoot }),
    ).toThrowError(WorkerBoundaryError);
  });

  it("Worktree 在宿主根内但不在 .stagent/worktrees 下 → 拒绝", () => {
    expect(() =>
      assertWorkerWorkspace({
        worktreeRoot: path.join(repoRoot, "src"),
        repoRoot,
      }),
    ).toThrowError(/must live under/);
  });

  it("Worktree 完全在宿主根之外 → 拒绝", () => {
    expect(() =>
      assertWorkerWorkspace({
        worktreeRoot: path.resolve("/tmp/elsewhere/worktree"),
        repoRoot,
      }),
    ).toThrowError(WorkerBoundaryError);
  });

  it("相对路径 → 拒绝（工作目录必须绝对）", () => {
    expect(() =>
      assertWorkerWorkspace({ worktreeRoot: "./worktrees/task-1" }),
    ).toThrowError(/must be absolute/);
  });

  it("未提供宿主根时只要求绝对路径（单元/离线场景）", () => {
    expect(assertWorkerWorkspace({ worktreeRoot: "/tmp/any/worktree" })).toBe(
      "/tmp/any/worktree",
    );
  });

  it("Worktree 是指向宿主根的符号链接 → realpath 复核后拒绝", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w1-link-"));
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(path.join(repo, ".stagent", "worktrees"), { recursive: true });
    const link = path.join(repo, ".stagent", "worktrees", "task-link");
    fs.symlinkSync(repo, link, "dir");
    try {
      expect(() =>
        assertWorkerWorkspace({ worktreeRoot: link, repoRoot: repo }),
      ).toThrowError(WorkerBoundaryError);
    } finally {
      try {
        safeRmSync(tmp);
      } catch {
        // 同上：清理失败不影响断言结论
      }
    }
  });
});

describe("D. 适配器能力声明与注册中心默认拒绝", () => {
  const adapterWith = (
    overrides: Partial<AdapterCapabilityDeclaration> = {},
  ): CodingWorkerAdapter => ({
    declaration: { ...MANAGED_AI_CAPABILITY, ...overrides },
    kind: "MANAGED_AI",
    run: async () => ({
      changes: [],
      log: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  });

  it("内置声明通过 GATEWAY_ENFORCED 校验，且 known_limitations 非空", () => {
    expect(validateAdapterCapability(MANAGED_AI_CAPABILITY)).toEqual({
      ok: true,
    });
    expect(MANAGED_AI_CAPABILITY.known_limitations.length).toBeGreaterThan(0);
  });

  it("缺失 / 空 known_limitations → 拒绝受控注册（G-10）", () => {
    const empty = adapterWith({ known_limitations: [] });
    expect(validateAdapterCapability(empty.declaration)).toMatchObject({
      ok: false,
      code: "KNOWN_LIMITATIONS_UNDECLARED",
    });
  });

  it("声明直连文件系统 → 拒绝受控注册", () => {
    expect(
      validateAdapterCapability({
        ...MANAGED_AI_CAPABILITY,
        filesystem_permissions: "DIRECT_UNCONTROLLED",
      }),
    ).toMatchObject({ ok: false, code: "FILESYSTEM_DIRECT_UNCONTROLLED" });
  });

  it("声明无限制 Shell → 拒绝受控注册", () => {
    expect(
      validateAdapterCapability({
        ...MANAGED_AI_CAPABILITY,
        command_permissions: "UNRESTRICTED_SHELL",
      }),
    ).toMatchObject({ ok: false, code: "COMMAND_UNRESTRICTED_SHELL" });
  });

  it("无法拦截工具调用 → 拒绝受控注册", () => {
    expect(
      validateAdapterCapability({
        ...MANAGED_AI_CAPABILITY,
        tool_interception_supported: false,
      }),
    ).toMatchObject({ ok: false, code: "TOOL_INTERCEPTION_UNSUPPORTED" });
  });

  it("空平台矩阵 → 拒绝受控注册", () => {
    expect(
      validateAdapterCapability({
        ...MANAGED_AI_CAPABILITY,
        platform_support: [],
      }),
    ).toMatchObject({ ok: false, code: "PLATFORM_MATRIX_EMPTY" });
  });

  it("注册中心：合法适配器可注册为受控；重复 id 拒绝", () => {
    const registry = new AdapterRegistry();
    const adapter = adapterWith();
    const entry = registry.register(adapter);
    expect(entry.control_mode).toBe("GATEWAY_ENFORCED");
    expect(registry.requireControlled(adapter.declaration.adapter_id)).toBe(
      adapter,
    );

    expect(() => registry.register(adapter)).toThrowError(
      AdapterRegistrationError,
    );
  });

  it("注册中心：黑盒适配器只能登记为 UNCONTROLLED_EXTERNAL，且不可用于受控执行", () => {
    const registry = new AdapterRegistry();
    const blackBox = adapterWith({
      adapter_id: "vendor.blackbox",
      known_limitations: [],
      filesystem_permissions: "DIRECT_UNCONTROLLED",
    });

    const entry = registry.register(blackBox, "UNCONTROLLED_EXTERNAL");
    expect(entry.control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(() => registry.requireControlled("vendor.blackbox")).toThrowError(
      /cannot be used for controlled execution/,
    );

    // 同一适配器不允许再以受控模式登记
    const second = new AdapterRegistry();
    expect(() => second.register(blackBox)).toThrowError(
      /KNOWN_LIMITATIONS_UNDECLARED/,
    );
  });
});

describe("E. AiWorker 集成：装配 → 调用 → 网关落盘 → 崩溃上下文回传", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w1-worker-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 1;\n",
    );
  });

  afterEach(() => {
    try {
      safeRmSync(worktree);
    } catch {
      // 受限执行环境可能拒绝删除临时目录；.tmp/vitest 由 global setup 定期裁剪
    }
  });

  const baseContract = () =>
    approvedContract({
      title: "worker 集成",
      description: "新增 b.ts",
      acceptanceCriteria: ["build passes"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "verify",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
    });

  function makeWorker(
    modelClient: WorkerModelClient,
    contract = baseContract(),
  ): { worker: AiWorker; costMonitor: CostMonitor } {
    const costMonitor = new CostMonitor();
    const gateway = new ScopedWorktreeGateway(worktree, contract, {
      costMonitor,
    });
    const worker = new AiWorker({ gateway, costMonitor, modelClient });
    return { worker, costMonitor };
  }

  it("装配后的 System Prompt 原样传给模型客户端（单一事实源）", async () => {
    let captured: WorkerGenerationInput | null = null;
    const { worker } = makeWorker({
      generateChanges: async (input) => {
        captured = input;
        return {
          changes: [],
          log: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    });

    await worker.run();

    expect(captured).not.toBeNull();
    const input = captured as unknown as WorkerGenerationInput;
    expect(input.task.system_prompt).toContain("worker 集成");
    expect(input.task.system_prompt).toContain("src/**");
    expect(input.task.worktree_root).toBe(canonicalPath(worktree));
    expect(input.task.known_limitations).toEqual(
      MANAGED_AI_CAPABILITY.known_limitations,
    );
  });

  it("改动经网关落盘，且网关记录的修改文件与模型输出一致", async () => {
    const { worker } = makeWorker({
      generateChanges: async () => ({
        changes: [{ path: "src/b.ts", content: "export const b = 2;\n" }],
        log: ["新增 b"],
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    });

    const result = await worker.run();
    expect(result.applied).toBe(true);
    expect(
      fs.readFileSync(path.join(worktree, "src", "b.ts"), "utf8"),
    ).toContain("export const b = 2");
  });

  it("模型调用异常 → WorkerAdapterError 携带合同 / Worktree / 阶段上下文", async () => {
    const contract = baseContract();
    const { worker } = makeWorker(
      {
        generateChanges: async () => {
          throw new Error("provider timeout");
        },
      },
      contract,
    );

    const failure: unknown = await worker.run().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(WorkerAdapterError);
    const error = failure as WorkerAdapterError;
    expect(error.stage).toBe("MODEL_CALL");
    expect(error.context.contract_id).toBe(contract.contract_id);
    expect(error.context.worktree_root).toBe(canonicalPath(worktree));
    expect(error.context.stage).toBe("MODEL_CALL");
    expect((error.cause as Error).message).toBe("provider timeout");
  });

  it("网关拒绝写入 → WorkerScopeError 携带 TOOL_WRITE 上下文（测试文件未授权）", async () => {
    const contract = baseContract();
    const { worker } = makeWorker(
      {
        generateChanges: async () => ({
          changes: [{ path: "src/b.test.ts", content: "it('x', () => {});\n" }],
          log: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      },
      contract,
    );

    const failure: unknown = await worker.run().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(WorkerScopeError);
    const error = failure as WorkerScopeError;
    expect(error.code).toBe("E_OUT_OF_SCOPE");
    expect(error.context?.stage).toBe("TOOL_WRITE");
    expect(error.context?.contract_id).toBe(contract.contract_id);
    expect(error.blockers[0]?.code).toBe("E_TEST_FILE_WRITE_BLOCKED");
  });

  it("越权改动 → SCOPE_VALIDATION 上下文，且不落任何文件", async () => {
    const contract = baseContract();
    const { worker } = makeWorker(
      {
        generateChanges: async () => ({
          changes: [
            { path: "src/b.ts", content: "ok" },
            { path: "package.json", content: "{}" },
          ],
          log: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      },
      contract,
    );

    const failure: unknown = await worker.run().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(WorkerScopeError);
    expect((failure as WorkerScopeError).context?.stage).toBe(
      "SCOPE_VALIDATION",
    );
    expect(fs.existsSync(path.join(worktree, "src", "b.ts"))).toBe(false);
  });
});

describe("F. 静态边界：Worker 目录零原生执行能力", () => {
  const workerDir = path.join(process.cwd(), "daemon", "worker");

  it("daemon/worker/** 不出现 child_process 与原生执行 API", () => {
    const forbiddenCall =
      /\b(execSync|execFileSync|spawnSync|execFile|spawn|fork)\s*\(/;
    const files = fs
      .readdirSync(workerDir)
      .filter((name) => name.endsWith(".ts"));

    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = fs.readFileSync(path.join(workerDir, name), "utf-8");
      expect(source, `${name} must not import child_process`).not.toContain(
        "child_process",
      );
      expect(source, `${name} must not call native execution APIs`).not.toMatch(
        forbiddenCall,
      );
    }
  });
});

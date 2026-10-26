import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import {
  AiWorker,
  type WorkerModelClient,
} from "../../daemon/worker/ai-worker";
import {
  WORKER_MCP_TOOLS,
  resolveExposedTools,
} from "../../daemon/worker/session-task-injector";
import {
  WorkerToolNotMountedError,
  mountWorkerTools,
} from "../../daemon/worker/worker-toolset";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

/**
 * TASK-W.2 / 五大受控 MCP 工具与乐观锁守卫。
 *
 * 覆盖：
 * A. 读写 / 遍历 / 删除 / 命令执行的正常路径；
 * B. `stagent_write_file` 的 `expected_hash` 乐观锁（失配 → E_CONFLICT）；
 * C. `stagent_exec_command` 的 argv 直传与 shell 注入拦截；
 * D. 路径越界 / 禁区 / 路径穿越的强制阻断；
 * E. 工具按合同授权挂载（未授权 exec 不实例化）。
 */

interface CommandSpec {
  alias: string;
  executable: string;
  args: string[];
  expected_exit_code: number;
  timeout_seconds: number;
}

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
];

function makeContract(
  options: {
    allowedCommands?: string[];
    commands?: CommandSpec[];
    maxFileModifications?: number;
  } = {},
) {
  const draft = createContractDraft({
    title: "W.2 工具契约",
    description: "验证受控 MCP 工具",
    acceptanceCriteria: ["工具行为符合规范"],
    writablePaths: ["src/**"],
    readonlyPaths: ["docs/**"],
    strictlyForbiddenPaths: [".env*", "package-lock.json"],
    commands: options.commands ?? DEFAULT_COMMANDS,
    ...(options.maxFileModifications === undefined
      ? {}
      : { maxFileModifications: options.maxFileModifications }),
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

  const allowed = options.allowedCommands ?? ["noop", "argv"];
  return softwareContractSchema.parse({
    ...approved,
    authorization: {
      ...approved.authorization,
      execution_permissions: {
        ...approved.authorization.execution_permissions,
        allowed_commands: allowed,
      },
    },
  });
}

describe("W.2 / 五大受控 MCP 工具", () => {
  let worktree: string;
  let gateway: ScopedWorktreeGateway;

  const buildGateway = (options?: Parameters<typeof makeContract>[0]) => {
    gateway = new ScopedWorktreeGateway(worktree, makeContract(options));
    return gateway;
  };

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w2-"));
    fs.mkdirSync(path.join(worktree, "src", "nested"), { recursive: true });
    fs.mkdirSync(path.join(worktree, ".git"), { recursive: true });
    fs.mkdirSync(path.join(worktree, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 1;\n",
    );
    fs.writeFileSync(
      path.join(worktree, "src", "nested", "b.ts"),
      "export const b = 2;\n",
    );
    fs.writeFileSync(path.join(worktree, ".env"), "SECRET=1\n");
    fs.writeFileSync(path.join(worktree, "package.json"), "{}\n");
    buildGateway();
  });

  afterEach(() => {
    try {
      safeRmSync(worktree);
    } catch {
      // 受限环境可能拒绝删除临时目录；.tmp/vitest 由 global setup 裁剪
    }
  });

  // --- A. 基本功能 ---

  it("read_file 返回内容与 SHA-256 元数据", async () => {
    const res = await gateway.callTool("stagent_read_file", {
      path: "src/a.ts",
    });
    expect(res.isError).toBe(false);
    expect(res.content[0]?.text).toContain("export const a = 1;");
    const data = res.data as { sha256: string; binary: boolean };
    expect(data.binary).toBe(false);
    expect(data.sha256).toBe(
      createHash("sha256")
        .update(fs.readFileSync(path.join(worktree, "src", "a.ts")))
        .digest("hex"),
    );
  });

  it("write_file 新建文件并可被读回", async () => {
    const res = await gateway.callTool("stagent_write_file", {
      path: "src/new.ts",
      content: "export const n = 3;\n",
    });
    expect(res.isError).toBe(false);
    expect(fs.readFileSync(path.join(worktree, "src", "new.ts"), "utf8")).toBe(
      "export const n = 3;\n",
    );
  });

  it("list_directory 列出目录但隐藏禁区与运行态目录", async () => {
    const res = await gateway.callTool("stagent_list_directory", { path: "." });
    expect(res.isError).toBe(false);
    const entries = res.data as Array<{ name: string }>;
    const names = entries.map((entry) => entry.name);
    expect(names).toContain("src");
    expect(names).not.toContain(".git");
    expect(names).not.toContain(".stagent");
    expect(names).not.toContain(".env");
  });

  it("list_directory recursive 返回嵌套路径", async () => {
    const res = await gateway.callTool("stagent_list_directory", {
      path: ".",
      recursive: true,
    });
    expect(res.isError).toBe(false);
    const entries = res.data as Array<{ path: string }>;
    expect(entries.map((entry) => entry.path)).toContain("src/nested/b.ts");
  });

  it("stagent_list_dir 历史命名与 list_directory 行为一致", async () => {
    const legacy = await gateway.callTool("stagent_list_dir", { path: "src" });
    const current = await gateway.callTool("stagent_list_directory", {
      path: "src",
    });
    expect(legacy.isError).toBe(false);
    expect(legacy.data).toEqual(current.data);
  });

  it("delete_file 删除普通文件；重复删除返回 ENOENT", async () => {
    const first = await gateway.callTool("stagent_delete_file", {
      path: "src/a.ts",
    });
    expect(first.isError).toBe(false);
    expect(fs.existsSync(path.join(worktree, "src", "a.ts"))).toBe(false);

    const second = await gateway.callTool("stagent_delete_file", {
      path: "src/a.ts",
    });
    expect(second.isError).toBe(true);
    expect(second.error?.code).toBe("ENOENT");
  });

  it("delete_file 拒绝删除目录（E_NOT_A_FILE）", async () => {
    const res = await gateway.callTool("stagent_delete_file", {
      path: "src/nested",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_NOT_A_FILE");
    expect(fs.existsSync(path.join(worktree, "src", "nested", "b.ts"))).toBe(
      true,
    );
  });

  it("exec_command 按合同别名执行（exit 0）", async () => {
    const res = await gateway.callTool("stagent_exec_command", {
      command_alias: "noop",
    });
    expect(res.isError).toBe(false);
    const data = res.data as { exitCode: number };
    expect(data.exitCode).toBe(0);
  });

  it("exec_command 未知别名返回 E_UNAUTHORIZED_COMMAND 并列出可用别名", async () => {
    const res = await gateway.callTool("stagent_exec_command", {
      command_alias: "rm-rf",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_UNAUTHORIZED_COMMAND");
    expect(
      (res.error?.details as { allowed_aliases: string[] }).allowed_aliases,
    ).toEqual(["noop", "argv"]);
  });

  // --- B. 乐观锁 ---

  it("expected_hash 命中时写入成功", async () => {
    const current = fs.readFileSync(path.join(worktree, "src", "a.ts"));
    const hash = createHash("sha256").update(current).digest("hex");

    const res = await gateway.callTool("stagent_write_file", {
      path: "src/a.ts",
      content: "export const a = 2;\n",
      expected_hash: hash,
    });
    expect(res.isError).toBe(false);
    expect(fs.readFileSync(path.join(worktree, "src", "a.ts"), "utf8")).toBe(
      "export const a = 2;\n",
    );
  });

  it("文件被外部修改后 expected_hash 失配 → E_CONFLICT 且不覆盖磁盘内容", async () => {
    const original = fs.readFileSync(path.join(worktree, "src", "a.ts"));
    const staleHash = createHash("sha256").update(original).digest("hex");

    // 模拟用户/编辑器在写入前改动文件
    fs.writeFileSync(path.join(worktree, "src", "a.ts"), "// external edit\n");

    const res = await gateway.callTool("stagent_write_file", {
      path: "src/a.ts",
      content: "export const a = 999;\n",
      expected_hash: staleHash,
    });

    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_CONFLICT");
    const details = res.error?.details as {
      expected_hash: string;
      current_hash: string;
    };
    expect(details.expected_hash).toBe(staleHash);
    expect(details.current_hash).not.toBe(staleHash);
    expect(fs.readFileSync(path.join(worktree, "src", "a.ts"), "utf8")).toBe(
      "// external edit\n",
    );
  });

  it("目标文件不存在但传入 expected_hash → E_CONFLICT（不静默新建）", async () => {
    const res = await gateway.callTool("stagent_write_file", {
      path: "src/missing.ts",
      content: "x",
      expected_hash: "a".repeat(64),
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_CONFLICT");
    expect(fs.existsSync(path.join(worktree, "src", "missing.ts"))).toBe(false);
  });

  it("expected_hash 非 SHA-256 格式 → INVALID_INPUT", async () => {
    const res = await gateway.callTool("stagent_write_file", {
      path: "src/a.ts",
      content: "x",
      expected_hash: "not-a-hash",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("INVALID_INPUT");
  });

  // --- C. 命令防注入 ---

  it.each([["&&"], ["|"], [";"], ["$(whoami)"]])(
    "args 含 shell 元字符 %s → E_UNAUTHORIZED_COMMAND，且命令未执行",
    async (metachar) => {
      const res = await gateway.callTool("stagent_exec_command", {
        command_alias: "noop",
        args: [metachar, "touch", "src/pwned"],
      });
      expect(res.isError).toBe(true);
      expect(res.error?.code).toBe("E_UNAUTHORIZED_COMMAND");
      expect(fs.existsSync(path.join(worktree, "src", "pwned"))).toBe(false);
    },
  );

  it("旧式 command 字符串拼接被命令安全校验拦截（E_UNAUTHORIZED_COMMAND）", async () => {
    const res = await gateway.callTool("stagent_exec_command", {
      command: "node -e process.exit(0); touch src/pwned",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_UNAUTHORIZED_COMMAND");
    expect(fs.existsSync(path.join(worktree, "src", "pwned"))).toBe(false);
  });

  it("额外 args 以字面量整体透传，不被 shell 拆分", async () => {
    const res = await gateway.callTool("stagent_exec_command", {
      command_alias: "argv",
      args: ["a b", "c"],
    });
    expect(res.isError).toBe(false);
    expect(res.content[0]?.text).toContain('["a b","c"]');
  });

  // --- D. 路径边界 ---

  it("read_file 路径穿越 → PATH_TRAVERSAL_DETECTED", async () => {
    const res = await gateway.callTool("stagent_read_file", {
      path: "../outside.txt",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("PATH_TRAVERSAL_DETECTED");
  });

  it("write_file 绝对路径 → PATH_TRAVERSAL_DETECTED", async () => {
    const res = await gateway.callTool("stagent_write_file", {
      path: "/etc/passwd",
      content: "evil",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("PATH_TRAVERSAL_DETECTED");
  });

  it("write_file 命中禁区 → E_FORBIDDEN_PATH", async () => {
    const res = await gateway.callTool("stagent_write_file", {
      path: ".env",
      content: "LEAK=1",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_FORBIDDEN_PATH");
  });

  it("write_file 越出可写范围 → E_OUT_OF_SCOPE", async () => {
    const res = await gateway.callTool("stagent_write_file", {
      path: "package.json",
      content: "{}",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_OUT_OF_SCOPE");
  });

  it("delete_file 命中禁区 → E_FORBIDDEN_PATH", async () => {
    const res = await gateway.callTool("stagent_delete_file", { path: ".env" });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_FORBIDDEN_PATH");
    expect(fs.existsSync(path.join(worktree, ".env"))).toBe(true);
  });

  it("delete_file 越出可写范围 → E_OUT_OF_SCOPE", async () => {
    const res = await gateway.callTool("stagent_delete_file", {
      path: "package.json",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("E_OUT_OF_SCOPE");
    expect(fs.existsSync(path.join(worktree, "package.json"))).toBe(true);
  });
});

describe("W.2 / 工具按合同授权挂载（与 W.1 resolveExposedTools 对接）", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w2-mount-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  });

  afterEach(() => {
    try {
      safeRmSync(worktree);
    } catch {
      // 同上
    }
  });

  const gatewayFor = (options?: Parameters<typeof makeContract>[0]) => {
    const contract = makeContract(options);
    return new ScopedWorktreeGateway(worktree, contract);
  };

  it("合同未授权命令执行 → exec 工具不挂载，调用抛错", async () => {
    const gateway = gatewayFor({ allowedCommands: [] });
    const tools = mountWorkerTools({
      gateway,
      exposedTools: resolveExposedTools(gateway.getContract()),
    });

    expect(tools.mounted_core_tools).toEqual([
      "stagent_read_file",
      "stagent_write_file",
      "stagent_list_directory",
      "stagent_delete_file",
    ]);
    expect(tools.has("stagent_exec_command")).toBe(false);

    await expect(tools.execCommand("noop")).rejects.toBeInstanceOf(
      WorkerToolNotMountedError,
    );
  });

  it("合同授权命令后五大核心工具全部挂载", () => {
    const gateway = gatewayFor();
    const tools = mountWorkerTools({
      gateway,
      exposedTools: resolveExposedTools(gateway.getContract()),
    });
    expect(tools.mounted_core_tools).toEqual([...WORKER_MCP_TOOLS]);
    expect(tools.exposed).toContain("stagent_exec_command");
  });

  it("调用方收窄工具集后，未挂载工具调用被拒绝", async () => {
    const gateway = gatewayFor();
    const tools = mountWorkerTools({
      gateway,
      exposedTools: ["stagent_read_file"],
    });

    const read = await tools.readFile("src/a.ts");
    expect(read.isError).toBe(true); // 文件不存在，但调用已成功到达网关
    await expect(tools.writeFile("src/b.ts", "x")).rejects.toBeInstanceOf(
      WorkerToolNotMountedError,
    );
  });

  it("AiWorker 通过挂载的 toolset 落盘（不直连文件系统）", async () => {
    const gateway = gatewayFor();
    const modelClient: WorkerModelClient = {
      generateChanges: async () => ({
        changes: [{ path: "src/c.ts", content: "export const c = 3;\n" }],
        log: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    };
    const worker = new AiWorker({
      gateway,
      costMonitor: new CostMonitor(),
      modelClient,
    });

    expect(worker.tools.mounted_core_tools).toContain("stagent_write_file");
    const result = await worker.run();

    expect(result.applied).toBe(true);
    expect(fs.readFileSync(path.join(worktree, "src", "c.ts"), "utf8")).toBe(
      "export const c = 3;\n",
    );
  });
});

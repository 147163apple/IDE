import fs from "node:fs";
import path from "node:path";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import {
  checkReadAccess,
  checkWriteAccess,
  matchesAnyPattern,
} from "../../src/lib/scope";
import {
  StagentReadFileSchema,
  StagentWriteFileSchema,
  StagentExecCommandSchema,
  StagentListDirSchema,
  StagentDeclareCompleteSchema,
  type AuditLogEntry,
  type MCPToolCallResult,
  type MCPToolDefinition,
  type DeclareCompleteBlocker,
  type DeclareCompleteResult,
} from "./types";
import { createHash } from "node:crypto";
import {
  resolveSafeWorktreePath,
  PathTraversalError,
  E_PATH_TRAVERSAL,
} from "./path-resolver";
import { runCommand, CommandSecurityError } from "../runner/command-runner";
import { CostMonitor, E_COST_CAP_EXCEEDED } from "../guard/cost-monitor";
import { LoopGuard, E_LOOP_CIRCUIT_TRIPPED } from "../guard/loop-guard";
import {
  guardAgentFileOperation,
  ensureRoundStarted,
} from "../protection/protection-list";
import { ensureCheckpoint } from "../protection/auto-checkpoint";

/** 从 Worktree 路径反推主仓库根（保护清单/快照始终归属主仓库） */
function mainRepoRootOf(worktreeRoot: string): string {
  const marker = `${path.sep}.stagent${path.sep}worktrees${path.sep}`;
  const idx = worktreeRoot.indexOf(marker);
  return idx > 0 ? worktreeRoot.slice(0, idx) : worktreeRoot;
}
import {
  isTestPath,
  scopeExplicitlyIncludesTests,
} from "../guard/test-integrity";

/** 单文件读取上限（规范 TASK-A.2 PASS-2） */
export const MAX_READ_BYTES = 1024 * 1024;

/** 测试文件写入被拦截（合同未显式授权测试模式） */
export const E_TEST_FILE_WRITE_BLOCKED = "E_TEST_FILE_WRITE_BLOCKED";

/** 任务已被用户主动中止（AbortSignal 已触发） */
export const E_TASK_ABORTED = "E_TASK_ABORTED";

/** 二进制探测：前 8 KiB 出现 NUL 字节即判定为二进制 */
function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

export interface ScopedGatewayOptions {
  costMonitor?: CostMonitor | undefined;
  loopGuard?: LoopGuard | undefined;
  /** 用户主动中止信号：在途命令整树强杀，后续命令一律拒绝执行 */
  signal?: AbortSignal | undefined;
}

/**
 * Scoped MCP Tool Gateway executing within a real Git Worktree environment.
 * Enforces SoftwareContract boundaries, path sandbox constraints, command whitelists,
 * and cost/loop circuit breakers.
 */
export class ScopedWorktreeGateway {
  private readonly worktreeRoot: string;
  private readonly contract: SoftwareContract;
  private readonly costMonitor?: CostMonitor | undefined;
  private readonly loopGuard?: LoopGuard | undefined;
  private readonly signal?: AbortSignal | undefined;

  private auditLog: AuditLogEntry[] = [];
  private modifiedFiles: Set<string> = new Set();
  /** 本次任务实际写入过的测试文件（用于 Evidence tests_modified 留痕） */
  private modifiedTestFiles: Set<string> = new Set();
  /** 任务级累计运行时长（规范 §9.1：与单命令 timeout_seconds 独立） */
  private cumulativeDurationMs = 0;

  constructor(
    worktreeRoot: string,
    contract: SoftwareContract,
    options: ScopedGatewayOptions = {},
  ) {
    this.worktreeRoot = path.resolve(worktreeRoot);
    this.contract = contract;
    this.costMonitor = options.costMonitor;
    this.loopGuard = options.loopGuard;
    this.signal = options.signal;
  }

  public getWorktreeRoot(): string {
    return this.worktreeRoot;
  }

  public getContract(): SoftwareContract {
    return this.contract;
  }

  public getAuditLog(): readonly AuditLogEntry[] {
    return this.auditLog;
  }

  public getModifiedFiles(): readonly string[] {
    return Array.from(this.modifiedFiles);
  }

  public getModifiedTestFiles(): readonly string[] {
    return Array.from(this.modifiedTestFiles);
  }

  /** 本任务是否修改过测试文件（验证结论可信度预警） */
  public wasTestsModified(): boolean {
    return this.modifiedTestFiles.size > 0;
  }

  public getCostMonitor(): CostMonitor | undefined {
    return this.costMonitor;
  }

  public getLoopGuard(): LoopGuard | undefined {
    return this.loopGuard;
  }

  private logAudit(entry: {
    tool: string;
    input: unknown;
    outcome: "SUCCESS" | "BLOCKED" | "FAILED";
    violationCode?: string | undefined;
    details?: string | undefined;
  }): void {
    const record: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      input: entry.input,
      outcome: entry.outcome,
    };
    if (entry.violationCode !== undefined) {
      record.violationCode = entry.violationCode;
    }
    if (entry.details !== undefined) {
      record.details = entry.details;
    }
    this.auditLog.push(record);
  }

  public getToolDefinitions(): MCPToolDefinition[] {
    return [
      {
        name: "stagent_read_file",
        description:
          "Read file contents within authorized contract scope. Paths outside readable/writable scope or matching forbidden patterns are strictly rejected.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Project-relative file path" },
          },
          required: ["path"],
        },
      },
      {
        name: "stagent_write_file",
        description:
          "Write or modify file contents strictly within authorized writable_paths. Strictly forbidden paths and budget limits are enforced.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Target file path" },
            content: { type: "string", description: "Full content to write" },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "stagent_exec_command",
        description:
          "Execute an authorized verification command (e.g. build, test, lint) in the worktree. Enforces command whitelist, timeout, and environment sanitization.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "Command to execute" },
          },
          required: ["command"],
        },
      },
      {
        name: "stagent_list_dir",
        description: "List files and directories in the worktree sandbox.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative directory path (defaults to root .)",
            },
          },
        },
      },
      {
        name: "stagent_declare_complete",
        description:
          "Declare the coding task complete. The server verifies actual scope, budget and verification results, then returns { ready_for_audit, blockers }.",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Optional change summary" },
            touched_paths: {
              type: "array",
              items: { type: "string" },
              description: "Paths the worker claims to have touched",
            },
          },
        },
      },
    ];
  }

  /**
   * Main dispatch entry point for MCP tool invocations.
   */
  public async callTool(
    name: string,
    rawInput: unknown,
  ): Promise<MCPToolCallResult> {
    switch (name) {
      case "stagent_read_file":
        return this.handleReadFile(rawInput);
      case "stagent_write_file":
        return this.handleWriteFile(rawInput);
      case "stagent_exec_command":
        return this.handleExecCommand(rawInput);
      case "stagent_list_dir":
        return this.handleListDir(rawInput);
      case "stagent_declare_complete":
        return this.handleDeclareComplete(rawInput);
      default:
        this.logAudit({
          tool: name,
          input: rawInput,
          outcome: "FAILED",
          violationCode: "UNKNOWN_TOOL",
          details: `Unrecognized MCP tool name: '${name}'`,
        });
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: '${name}'` }],
          error: {
            code: "UNKNOWN_TOOL",
            message: `Tool '${name}' not supported`,
          },
        };
    }
  }

  private async handleReadFile(rawInput: unknown): Promise<MCPToolCallResult> {
    const parsed = StagentReadFileSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: "text", text: "Invalid read_file input: path is required." },
        ],
        error: { code: "INVALID_INPUT", message: "Path cannot be empty" },
      };
    }

    const { path: rawPath } = parsed.data;

    // 1. Path safety resolution
    let safe;
    try {
      safe = resolveSafeWorktreePath(this.worktreeRoot, rawPath);
    } catch (err) {
      const code =
        err instanceof PathTraversalError ? err.code : E_PATH_TRAVERSAL;
      this.logAudit({
        tool: "stagent_read_file",
        input: rawInput,
        outcome: "BLOCKED",
        violationCode: code,
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: `[${code}] ${(err as Error).message}` },
        ],
        error: { code, message: (err as Error).message },
      };
    }

    // 2. Scope verification
    const access = checkReadAccess(
      safe.relativePath,
      this.contract.authorization.file_system_scope,
    );
    if (!access.allowed) {
      this.logAudit({
        tool: "stagent_read_file",
        input: rawInput,
        outcome: "BLOCKED",
        violationCode: access.reason ?? "NOT_READABLE",
        details: access.message ?? undefined,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: access.message || "Read permission denied" },
        ],
        error: {
          code: access.reason || "NOT_READABLE",
          message: access.message || "Read permission denied",
          details: { path: safe.relativePath, pattern: access.pattern },
        },
      };
    }

    // 3. Read from disk
    try {
      if (!fs.existsSync(safe.absolutePath)) {
        return {
          isError: true,
          content: [
            { type: "text", text: `File not found: '${safe.relativePath}'` },
          ],
          error: {
            code: "ENOENT",
            message: `File not found: '${safe.relativePath}'`,
          },
        };
      }

      const stat = await fs.promises.stat(safe.absolutePath);
      if (!stat.isFile()) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Not a regular file: '${safe.relativePath}'`,
            },
          ],
          error: { code: "EISDIR", message: "Target is not a regular file" },
        };
      }

      // 规范 PASS-2：默认上限 1 MiB，超出截断并标记 truncated
      const sizeBytes = stat.size;
      const readBytes = Math.min(sizeBytes, MAX_READ_BYTES);
      const buffer = Buffer.alloc(readBytes);
      const handle = await fs.promises.open(safe.absolutePath, "r");
      try {
        await handle.read(buffer, 0, readBytes, 0);
      } finally {
        await handle.close();
      }

      const truncated = sizeBytes > MAX_READ_BYTES;
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const binary = isBinaryBuffer(buffer);

      this.logAudit({
        tool: "stagent_read_file",
        input: rawInput,
        outcome: "SUCCESS",
        ...(truncated
          ? { details: `truncated at ${MAX_READ_BYTES} of ${sizeBytes} bytes` }
          : {}),
      });

      if (binary) {
        // 二进制文件仅返回元数据与哈希，禁止文本解码
        const meta = {
          path: safe.relativePath,
          binary: true,
          truncated: false,
          size_bytes: sizeBytes,
          sha256,
        };
        return {
          isError: false,
          content: [{ type: "text", text: JSON.stringify(meta) }],
          data: meta,
        };
      }

      const content = buffer.toString("utf-8");
      const meta = {
        path: safe.relativePath,
        binary: false,
        truncated,
        size_bytes: sizeBytes,
        sha256,
      };
      return {
        isError: false,
        content: [
          {
            type: "text",
            text: truncated
              ? `${content}\n[... truncated at ${MAX_READ_BYTES} of ${sizeBytes} bytes ...]`
              : content,
          },
        ],
        data: meta,
      };
    } catch (err) {
      this.logAudit({
        tool: "stagent_read_file",
        input: rawInput,
        outcome: "FAILED",
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to read file: ${(err as Error).message}`,
          },
        ],
        error: { code: "EIO", message: (err as Error).message },
      };
    }
  }

  /**
   * 第 5 个工具：服务端依据真实 Scope、预算与验证结果判定是否可进入审计。
   * 规范 TASK-A.2 PASS-4：返回 { ready_for_audit, blockers }。
   */
  private async handleDeclareComplete(
    rawInput: unknown,
  ): Promise<MCPToolCallResult> {
    const parsed = StagentDeclareCompleteSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: "Invalid declare_complete input." }],
        error: { code: "INVALID_INPUT", message: parsed.error.message },
      };
    }

    const blockers: DeclareCompleteBlocker[] = [];
    const scope = this.contract.authorization.file_system_scope;
    const touched = parsed.data.touched_paths ?? [];

    // 1. Scope 校验：实际修改文件 + 声明的 touched_paths 均须在 writable 内
    for (const file of new Set([...this.modifiedFiles, ...touched])) {
      const access = checkWriteAccess(file, scope);
      if (!access.allowed) {
        blockers.push({
          code: access.reason ?? "E_OUT_OF_SCOPE",
          message:
            `Path '${file}' is outside authorized writable scope: ${access.message ?? ""}`.trim(),
        });
      }
    }

    // 2. 文件数预算
    const maxFiles =
      this.contract.authorization.budget_limits.max_file_modifications;
    if (this.modifiedFiles.size > maxFiles) {
      blockers.push({
        code: "E_BUDGET_EXCEEDED",
        message: `Modified ${this.modifiedFiles.size} files, exceeding budget of ${maxFiles}`,
      });
    }

    // 3. 费用 / Token 熔断
    if (this.costMonitor?.isTripped()) {
      blockers.push({
        code: "E_BUDGET_EXCEEDED",
        message:
          "Cost/token budget exhausted; resume requires a new approval round",
      });
    }

    // 4. 验证重试熔断
    if (this.loopGuard?.isTripped()) {
      blockers.push({
        code: "E_RETRY_LIMIT_EXCEEDED",
        message: `Verification retry limit reached (${this.loopGuard.getConsecutiveFailures()} consecutive failures)`,
      });
    }

    // 5. 验证结果：必须至少有一次通过的验证记录
    const history = this.loopGuard?.getHistory() ?? [];
    if (this.contract.verification_spec.commands.length > 0) {
      const last = history[history.length - 1];
      if (!last) {
        blockers.push({
          code: "VERIFICATION_NOT_RUN",
          message:
            "No verification command has been executed; run the contract verification suite first",
        });
      } else if (!last.passed) {
        blockers.push({
          code: "VERIFICATION_FAILED",
          message: `Latest verification failed (exit code ${last.exitCode ?? "unknown"})`,
        });
      }
    }

    const result: DeclareCompleteResult = {
      ready_for_audit: blockers.length === 0,
      blockers,
    };

    this.logAudit({
      tool: "stagent_declare_complete",
      input: parsed.data,
      outcome: blockers.length === 0 ? "SUCCESS" : "BLOCKED",
      ...(blockers[0] ? { violationCode: blockers[0].code } : {}),
      details: blockers.map((b) => b.message).join("; "),
    });

    return {
      isError: false,
      content: [{ type: "text", text: JSON.stringify(result) }],
      data: result,
    };
  }

  private async handleWriteFile(rawInput: unknown): Promise<MCPToolCallResult> {
    const parsed = StagentWriteFileSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Invalid write_file input: path and content are required.",
          },
        ],
        error: {
          code: "INVALID_INPUT",
          message: "Path and content are required",
        },
      };
    }

    const { path: rawPath, content } = parsed.data;

    // 1. Cost cap check
    if (this.costMonitor?.isTripped()) {
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: E_COST_CAP_EXCEEDED,
        details: "Cost cap has been reached for this contract run",
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `[${E_COST_CAP_EXCEEDED}] Cost cap has been reached`,
          },
        ],
        error: { code: E_COST_CAP_EXCEEDED, message: "Cost cap reached" },
      };
    }

    // 2. Path safety resolution
    let safe;
    try {
      safe = resolveSafeWorktreePath(this.worktreeRoot, rawPath);
    } catch (err) {
      const code =
        err instanceof PathTraversalError ? err.code : E_PATH_TRAVERSAL;
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: code,
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: `[${code}] ${(err as Error).message}` },
        ],
        error: { code, message: (err as Error).message },
      };
    }

    // 3. Scope verification (Write access)
    const access = checkWriteAccess(
      safe.relativePath,
      this.contract.authorization.file_system_scope,
    );
    if (!access.allowed) {
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: access.reason ?? "NOT_WRITABLE",
        details: access.message ?? undefined,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: access.message || "Write permission denied" },
        ],
        error: {
          code: access.reason || "NOT_WRITABLE",
          message: access.message || "Write permission denied",
          details: { path: safe.relativePath, pattern: access.pattern },
        },
      };
    }

    // 3.5 测试完整性门禁：测试文件写入要求 writable_paths 中存在显式测试
    // 模式（tests/**、**/*.test.ts 等）。仅被 src/** 这类宽泛模式覆盖时坚决
    // 阻断——否则 Agent 可修改断言伪造验证通过（Test Integrity Guard）。
    if (isTestPath(safe.relativePath)) {
      const writable =
        this.contract.authorization.file_system_scope.writable_paths;
      if (!scopeExplicitlyIncludesTests(writable)) {
        const msg =
          `Write rejected: '${safe.relativePath}' is a test file, but writable_paths ` +
          `does not explicitly include test patterns (e.g. 'tests/**' or '**/*.test.ts'); ` +
          `modifying tests to fake a passing verdict is not allowed`;
        this.logAudit({
          tool: "stagent_write_file",
          input: { path: rawPath },
          outcome: "BLOCKED",
          violationCode: E_TEST_FILE_WRITE_BLOCKED,
          details: msg,
        });
        return {
          isError: true,
          content: [
            { type: "text", text: `[${E_TEST_FILE_WRITE_BLOCKED}] ${msg}` },
          ],
          error: { code: E_TEST_FILE_WRITE_BLOCKED, message: msg },
        };
      }
    }

    // 3.7 P.1 保护清单门禁（任何模式）：命中保护区先拦后写，拒绝即登记待审批卡。
    // 清单读取出错/路径解析失败一律按拒绝处理（失败关闭），不静默放行。
    {
      const protectionRoot = mainRepoRootOf(this.worktreeRoot);
      let gate: {
        allowed: boolean;
        reason: string;
        cardId?: string | undefined;
        entryName?: string | undefined;
      };
      try {
        ensureRoundStarted(protectionRoot, "mcp-write");
        await ensureCheckpoint(protectionRoot);
        gate = guardAgentFileOperation(protectionRoot, safe.relativePath);
      } catch (err) {
        gate = {
          allowed: false,
          reason: `保护门卫不可用，按拒绝处理：${(err as Error).message}`,
        };
      }
      if (!gate.allowed) {
        this.logAudit({
          tool: "stagent_write_file",
          input: { path: safe.relativePath },
          outcome: "BLOCKED",
          violationCode: "PROTECTED_PATH",
          details: gate.reason,
        });
        return {
          isError: true,
          content: [{ type: "text", text: gate.reason }],
          error: {
            code: "PROTECTED_PATH",
            message: gate.reason,
            details: { path: safe.relativePath, cardId: gate.cardId },
          },
        };
      }
    }

    // 4. Budget limits verification (Max file modifications)
    const maxFiles =
      this.contract.authorization.budget_limits.max_file_modifications;
    const isNewFileMod = !this.modifiedFiles.has(safe.relativePath);
    if (isNewFileMod && this.modifiedFiles.size >= maxFiles) {
      const msg = `Budget exceeded: modification limit of ${maxFiles} files reached`;
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: "BUDGET_EXCEEDED",
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[BUDGET_EXCEEDED] ${msg}` }],
        error: { code: "BUDGET_EXCEEDED", message: msg },
      };
    }

    // 5. Write to disk
    try {
      const parentDir = path.dirname(safe.absolutePath);
      if (!fs.existsSync(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true });
      }

      await fs.promises.writeFile(safe.absolutePath, content, "utf-8");
      this.modifiedFiles.add(safe.relativePath);
      if (isTestPath(safe.relativePath)) {
        this.modifiedTestFiles.add(safe.relativePath);
      }

      this.logAudit({
        tool: "stagent_write_file",
        input: {
          path: safe.relativePath,
          bytesWritten: Buffer.byteLength(content, "utf-8"),
        },
        outcome: "SUCCESS",
      });

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `File '${safe.relativePath}' written successfully.`,
          },
        ],
      };
    } catch (err) {
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: safe.relativePath },
        outcome: "FAILED",
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to write file: ${(err as Error).message}`,
          },
        ],
        error: { code: "EIO", message: (err as Error).message },
      };
    }
  }

  private async handleExecCommand(
    rawInput: unknown,
  ): Promise<MCPToolCallResult> {
    const parsed = StagentExecCommandSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Invalid exec_command input: command is required.",
          },
        ],
        error: { code: "INVALID_INPUT", message: "Command cannot be empty" },
      };
    }

    // 结构化 argv 优先（§9.1）；字符串形式仅用于兼容既有调用
    const structured =
      parsed.data.executable !== undefined
        ? {
            executable: parsed.data.executable,
            args: parsed.data.args ?? [],
          }
        : undefined;
    const command = structured
      ? [structured.executable, ...structured.args].join(" ")
      : (parsed.data.command ?? "");

    // 0. 主动中止检查：abort 之后在途命令已被整树强杀，后续命令一律拒绝，
    //    保证 execute 的命令循环立刻收尾而不是继续跑剩余验证
    if (this.signal?.aborted) {
      const msg = "Task aborted by user; command execution refused";
      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: "BLOCKED",
        violationCode: E_TASK_ABORTED,
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[${E_TASK_ABORTED}] ${msg}` }],
        error: { code: E_TASK_ABORTED, message: msg },
      };
    }

    // 1. Loop guard check
    if (this.loopGuard?.isTripped()) {
      const msg =
        "Verification loop circuit breaker tripped: max consecutive retries reached";
      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: "BLOCKED",
        violationCode: E_LOOP_CIRCUIT_TRIPPED,
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[${E_LOOP_CIRCUIT_TRIPPED}] ${msg}` }],
        error: { code: E_LOOP_CIRCUIT_TRIPPED, message: msg },
      };
    }

    // 2. Whitelist compilation from contract (§9.1 structured commands)
    const vSpec = this.contract.verification_spec;
    const allowedCommands: string[] = vSpec.commands.map((c) =>
      [c.executable, ...c.args].join(" "),
    );

    // 3. Execution
    const taskBudgetMs =
      (this.contract.authorization.budget_limits.max_duration_seconds ?? 1800) *
      1000;

    // 任务级总时长熔断（§6.3 异常 3 / §9.3 E_TASK_TIMEOUT）
    if (this.cumulativeDurationMs >= taskBudgetMs) {
      const msg = `Task total duration budget exhausted: ${this.cumulativeDurationMs}ms >= ${taskBudgetMs}ms`;
      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: "BLOCKED",
        violationCode: "E_TASK_TIMEOUT",
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[E_TASK_TIMEOUT] ${msg}` }],
        error: { code: "E_TASK_TIMEOUT", message: msg },
      };
    }

    try {
      const result = await runCommand(command, {
        cwd: this.worktreeRoot,
        allowedCommands,
        timeoutMs: Math.max(1, taskBudgetMs - this.cumulativeDurationMs),
        networkPolicy:
          this.contract.authorization.execution_permissions.network_policy,
        ...(structured === undefined ? {} : { argv: structured }),
        ...(this.signal === undefined ? {} : { signal: this.signal }),
      });

      // Update loop guard if this matches a verification test command
      const isTestCommand = allowedCommands.some(
        (tc) => command === tc || command.startsWith(tc + " "),
      );
      // 用户主动中止（exit 130）不算验证失败，避免误触连续失败熔断
      if (this.loopGuard && isTestCommand && !result.aborted) {
        this.loopGuard.recordAttempt({
          passed: result.exitCode === 0,
          exitCode: result.exitCode,
          summary: result.exitCode === 0 ? "Test passed" : "Test failed",
        });
      }

      this.cumulativeDurationMs += result.durationMs;
      const taskBudgetExhausted = this.cumulativeDurationMs >= taskBudgetMs;

      const errorCode = taskBudgetExhausted
        ? "E_TASK_TIMEOUT"
        : result.timedOut
          ? "E_COMMAND_TIMEOUT"
          : result.exitCode === 0
            ? undefined
            : "E_VERIFICATION_FAILED";

      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: result.exitCode === 0 ? "SUCCESS" : "FAILED",
        ...(errorCode ? { violationCode: errorCode } : {}),
        details: `Exit code ${result.exitCode}, duration ${result.durationMs}ms, truncated=${result.truncated}, redacted=${result.secretRedacted}`,
      });

      return {
        isError: result.exitCode !== 0,
        content: [
          {
            type: "text",
            text: `Command executed with exit code ${result.exitCode}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`,
          },
        ],
        data: result,
        ...(errorCode
          ? {
              error: {
                code: errorCode,
                message: taskBudgetExhausted
                  ? "Task total duration budget exhausted (max_duration_seconds)"
                  : result.timedOut
                    ? "Command exceeded timeout_seconds and was terminated (124)"
                    : "Verification command returned a non-zero exit code",
              },
            }
          : {}),
      };
    } catch (err) {
      const code =
        err instanceof CommandSecurityError ? err.code : "EXEC_ERROR";
      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: "BLOCKED",
        violationCode: code,
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: `[${code}] ${(err as Error).message}` },
        ],
        error: { code, message: (err as Error).message },
      };
    }
  }

  private async handleListDir(rawInput: unknown): Promise<MCPToolCallResult> {
    const parsed = StagentListDirSchema.safeParse(rawInput ?? {});
    const targetRel = parsed.success ? parsed.data.path : ".";

    let safe;
    try {
      safe = resolveSafeWorktreePath(this.worktreeRoot, targetRel);
    } catch (err) {
      const code =
        err instanceof PathTraversalError ? err.code : E_PATH_TRAVERSAL;
      return {
        isError: true,
        content: [
          { type: "text", text: `[${code}] ${(err as Error).message}` },
        ],
        error: { code, message: (err as Error).message },
      };
    }

    try {
      if (!fs.existsSync(safe.absolutePath)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Directory not found: '${safe.relativePath}'`,
            },
          ],
          error: { code: "ENOENT", message: "Directory not found" },
        };
      }

      const entries = await fs.promises.readdir(safe.absolutePath, {
        withFileTypes: true,
      });
      const forbidden =
        this.contract.authorization.file_system_scope.strictly_forbidden_paths;

      const filtered = entries
        .filter((entry) => {
          if (entry.name === ".git" || entry.name === ".stagent") return false;
          const entryRel =
            safe.relativePath === "."
              ? entry.name
              : `${safe.relativePath}/${entry.name}`;
          const isForbidden = matchesAnyPattern(entryRel, forbidden).matches;
          return !isForbidden;
        })
        .map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
        }));

      this.logAudit({
        tool: "stagent_list_dir",
        input: rawInput,
        outcome: "SUCCESS",
      });

      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
        data: filtered,
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to list directory: ${(err as Error).message}`,
          },
        ],
        error: { code: "EIO", message: (err as Error).message },
      };
    }
  }
}

import type { SoftwareContract } from "../../src/lib/contract.schema";
import { checkWriteAccess } from "../../src/lib/scope";
import type { ScopedWorktreeGateway } from "../mcp/gateway";
import type { CostMonitor } from "../guard/cost-monitor";

/**
 * 受控 AI Worker（Daemon 侧，替代已删除的浏览器 Worker）。
 *
 * 安全边界：
 * 1. 只读取合同 writable_paths 内的现有文件作为上下文（不读 .env / 严禁路径）
 * 2. 调用模型前执行费用预检（assertCanConsume）
 * 3. 模型返回的全部改动先做 Scope + 预算整体校验，任一越权则整批拒绝（不落半成品）
 * 4. 实际写盘一律经 ScopedWorktreeGateway（并发锁、文件数预算、审计日志）
 * 5. 模型用量回写 CostMonitor（持久化，重启不重置）
 */

export interface WorkerChange {
  path: string;
  content: string;
}

export interface WorkerUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface WorkerGenerationInput {
  contract: SoftwareContract;
  files: Array<{ path: string; content: string }>;
  signal?: AbortSignal;
}

export interface WorkerGenerationResult {
  changes: WorkerChange[];
  log: string[];
  usage: WorkerUsage;
}

/** 可注入的模型客户端（测试使用 fake，生产使用 OpenAI） */
export interface WorkerModelClient {
  generateChanges(
    input: WorkerGenerationInput,
  ): Promise<WorkerGenerationResult>;
}

export interface WorkerRunResult {
  applied: boolean;
  changes: WorkerChange[];
  log: string[];
  usage: WorkerUsage;
  blockers: Array<{ code: string; message: string }>;
}

export class WorkerScopeError extends Error {
  readonly code = "E_OUT_OF_SCOPE";
  readonly blockers: Array<{ code: string; message: string }>;
  constructor(blockers: Array<{ code: string; message: string }>) {
    super(
      `[E_OUT_OF_SCOPE] Worker changes rejected: ${blockers.map((b) => b.message).join("; ")}`,
    );
    this.name = "WorkerScopeError";
    this.blockers = blockers;
  }
}

const MAX_CONTEXT_FILES = 20;
const MAX_CONTEXT_CHARS = 100_000;
/** 粗估：1 token ≈ 4 字符 */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export class AiWorker {
  private readonly gateway: ScopedWorktreeGateway;
  private readonly costMonitor: CostMonitor;
  private readonly modelClient: WorkerModelClient;

  constructor(options: {
    gateway: ScopedWorktreeGateway;
    costMonitor: CostMonitor;
    modelClient: WorkerModelClient;
  }) {
    this.gateway = options.gateway;
    this.costMonitor = options.costMonitor;
    this.modelClient = options.modelClient;
  }

  async run(signal?: AbortSignal): Promise<WorkerRunResult> {
    const contract = this.gateway.getContract();
    const context = await this.collectContext(contract);

    // 费用预检：输入上下文 + 预期输出上限
    const estimatedInput = estimateTokens(
      context.map((f) => f.content).join("\n"),
    );
    this.costMonitor.assertCanConsume(estimatedInput, 4_000);

    const generated = await this.modelClient.generateChanges({
      contract,
      files: context,
      ...(signal === undefined ? {} : { signal }),
    });

    const blockers = this.validateChanges(contract, generated.changes);
    if (blockers.length > 0) {
      throw new WorkerScopeError(blockers);
    }

    for (const change of generated.changes) {
      const res = await this.gateway.callTool("stagent_write_file", {
        path: change.path,
        content: change.content,
      });
      if (res.isError) {
        throw new WorkerScopeError([
          {
            code: res.error?.code ?? "WRITE_FAILED",
            message: res.error?.message ?? `Failed to write ${change.path}`,
          },
        ]);
      }
    }

    this.costMonitor.recordUsage(
      generated.usage.inputTokens,
      generated.usage.outputTokens,
      undefined,
      { source: "ai-worker", contract_id: contract.contract_id },
    );

    return {
      applied: generated.changes.length > 0,
      changes: generated.changes,
      log: generated.log,
      usage: generated.usage,
      blockers: [],
    };
  }

  /** 仅读取 writable_paths 内已存在的文件，且总量有界 */
  private async collectContext(
    contract: SoftwareContract,
  ): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    let totalChars = 0;

    for (const pattern of contract.authorization.file_system_scope
      .writable_paths) {
      // 仅处理具体路径（含通配符的声明无法枚举，交给模型按需新建）
      if (pattern.includes("*")) continue;
      const res = await this.gateway.callTool("stagent_read_file", {
        path: pattern,
      });
      if (res.isError) continue;
      const content = res.content[0]?.text ?? "";
      if (totalChars + content.length > MAX_CONTEXT_CHARS) break;
      files.push({ path: pattern, content });
      totalChars += content.length;
      if (files.length >= MAX_CONTEXT_FILES) break;
    }

    return files;
  }

  /** 整批预校验：任一越权 → 全部拒绝，绝不写半成品 */
  private validateChanges(
    contract: SoftwareContract,
    changes: WorkerChange[],
  ): Array<{ code: string; message: string }> {
    const blockers: Array<{ code: string; message: string }> = [];
    const scope = contract.authorization.file_system_scope;
    const budget = contract.authorization.budget_limits.max_file_modifications;

    if (changes.length > budget) {
      blockers.push({
        code: "E_BUDGET_EXCEEDED",
        message: `Worker proposed ${changes.length} file changes, exceeding budget of ${budget}`,
      });
    }

    const seen = new Set<string>();
    for (const change of changes) {
      if (seen.has(change.path)) {
        blockers.push({
          code: "DUPLICATE_CHANGE",
          message: `Duplicate change for '${change.path}'`,
        });
        continue;
      }
      seen.add(change.path);
      const access = checkWriteAccess(change.path, scope);
      if (!access.allowed) {
        blockers.push({
          code: access.reason ?? "E_OUT_OF_SCOPE",
          message: `Path '${change.path}' is outside authorized writable scope`,
        });
      }
    }

    return blockers;
  }
}

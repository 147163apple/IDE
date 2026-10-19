import { z } from "zod";
import { getRuntimeKey, getRuntimeModel } from "./key-store";
import type {
  WorkerGenerationInput,
  WorkerGenerationResult,
  WorkerModelClient,
} from "./ai-worker";

const workerOutputSchema = z.object({
  changes: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
    )
    .describe("需要在授权范围内创建或覆盖的文件完整内容"),
  log: z.array(z.string()).describe("按步骤描述的中文改动说明"),
});

/**
 * OpenAI 兼容模型客户端（Daemon 侧）。
 * 密钥仅从 Daemon 进程环境读取，绝不下发给浏览器或写入合同。
 */
export class OpenAiWorkerClient implements WorkerModelClient {
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly baseURL?: string | undefined;

  constructor(
    options: {
      apiKey?: string | undefined;
      modelId?: string | undefined;
      baseURL?: string | undefined;
    } = {},
  ) {
    const key = options.apiKey ?? getRuntimeKey();
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not configured; set it via the console settings or the Daemon environment.",
      );
    }
    this.apiKey = key;
    this.modelId = options.modelId ?? getRuntimeModel();
    this.baseURL = options.baseURL ?? process.env["OPENAI_BASE_URL"];
  }

  async generateChanges(
    input: WorkerGenerationInput,
  ): Promise<WorkerGenerationResult> {
    const [{ generateObject }, { createOpenAI }] = await Promise.all([
      import("ai"),
      import("@ai-sdk/openai"),
    ]);

    const provider = createOpenAI({
      apiKey: this.apiKey,
      ...(this.baseURL === undefined ? {} : { baseURL: this.baseURL }),
    });

    const contract = input.contract;
    const scope = contract.authorization.file_system_scope;

    const system = [
      "你是 Stagent 的 Coding Worker，在受控 Git Worktree 中工作。",
      "只能修改 writable_paths 内的文件；严禁触碰 strictly_forbidden_paths。",
      "返回完整文件内容，不要输出 diff、不要引入未安装依赖、不要执行命令。",
      "若无需改动，返回空 changes 数组。",
    ].join("\n");

    const prompt = [
      `任务：${contract.intent.title}`,
      `方案：${contract.intent.description}`,
      `验收标准：\n${contract.intent.acceptance_criteria.map((c) => `- ${c}`).join("\n")}`,
      `可写路径：${scope.writable_paths.join(", ")}`,
      `严禁路径：${scope.strictly_forbidden_paths.join(", ")}`,
      `现有文件：\n${input.files
        .map((f) => `=== ${f.path} ===\n${f.content}`)
        .join("\n\n")}`,
    ].join("\n\n");

    const result = await generateObject({
      model: provider(this.modelId),
      schema: workerOutputSchema,
      system,
      prompt,
      ...(input.signal === undefined ? {} : { abortSignal: input.signal }),
    });

    const usage = result.usage as
      { inputTokens?: number; outputTokens?: number } | undefined;

    return {
      changes: result.object.changes,
      log: result.object.log,
      usage: {
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      },
    };
  }
}

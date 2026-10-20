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
    const task = input.task;

    // System Prompt 的唯一来源：session-task-injector 依据已批准合同装配。
    // 此处不再自行拼接范围/验收规则，避免「提示词与合同各说一套」。
    const system = task.system_prompt;

    const prompt = [
      `合同：${contract.contract_id}（revision ${task.contract_revision}）`,
      `工作目录：${task.worktree_root}`,
      `现有文件：\n${input.files
        .map((f) => `=== ${f.path} ===\n${f.content}`)
        .join("\n\n")}`,
      "请按输出契约返回 changes 数组（完整文件内容）；若无需改动返回空数组。",
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

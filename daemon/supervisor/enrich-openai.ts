/**
 * Supervisor L1 白话补全 —— DeepSeek / OpenAI 兼容 Chat Completions。
 *
 * 由 `bin/stagent.ts` 在 createDaemon 时注入；密钥只读进程环境
 * （`.tmp/deepseek.env` 经 local-env 注入），绝不落盘、不回显。
 *
 * 本文件遵守 Zero-Tool：不拉起子进程、无 Gateway/Merger/Runner 依赖。
 */
import { getRuntimeKey, getRuntimeModel } from "../worker/key-store";
import { appendLlmMeta } from "../core/debug-log";
import type { DraftEnrichment } from "./draft-generator";

/** 可诊断错误码（进入 HTTP 响应的 `error` 字段，不含密钥） */
export type EnrichErrorCode =
  | "ENRICH_MISSING_KEY"
  | "ENRICH_HTTP_ERROR"
  | "ENRICH_EMPTY_RESPONSE"
  | "ENRICH_PARSE_ERROR"
  | "ENRICH_TIMEOUT";

export class EnrichError extends Error {
  readonly code: EnrichErrorCode;
  readonly enrichCode: EnrichErrorCode;
  readonly status?: number | undefined;

  constructor(
    code: EnrichErrorCode,
    message: string,
    options: { status?: number | undefined } = {},
  ) {
    super(`[${code}] ${message}`);
    this.name = "EnrichError";
    this.code = code;
    this.enrichCode = code;
    this.status = options.status;
  }
}

export interface SupervisorEnrichOptions {
  /** 覆盖环境中的 API Key（测试用；生产勿传入明文到日志） */
  apiKey?: string | undefined;
  baseURL?: string | undefined;
  modelId?: string | undefined;
  /** 默认 45s */
  timeoutMs?: number | undefined;
  /** 可注入 fetch，便于单测 */
  fetchImpl?: typeof fetch | undefined;
  /** TASK-C.17：写入 `.stagent/logs/daemon.jsonl` 的 LLM 元数据（禁密钥） */
  repoRoot?: string | undefined;
}

const SYSTEM_PROMPT = [
  "你在为一次编码任务补全「软件合同」草案的白话说明。",
  "只输出一个 JSON 对象，不要 Markdown 围栏，不要其它文字：",
  '{"rationale":["...最多3条中文白话..."],"unresolved_questions":["...没有就空数组..."]}',
  "不要评分、不要成熟度、不要优先级、不要给出可执行命令。",
].join("\n");

function resolveApiKey(override?: string): string {
  const key =
    override?.trim() ||
    getRuntimeKey() ||
    process.env["ANTHROPIC_API_KEY"]?.trim() ||
    "";
  if (!key) {
    throw new EnrichError(
      "ENRICH_MISSING_KEY",
      "未配置模型密钥：请放置 .tmp/deepseek.env，或在控制台设置 OPENAI_API_KEY / ANTHROPIC_API_KEY。",
    );
  }
  return key;
}

function resolveBaseURL(override?: string): string {
  const raw =
    override?.trim() ||
    process.env["OPENAI_BASE_URL"]?.trim() ||
    "https://api.deepseek.com/v1";
  return raw.replace(/\/+$/, "");
}

function resolveModel(override?: string): string {
  return (
    override?.trim() ||
    process.env["STAGENT_SUPERVISOR_MODEL"]?.trim() ||
    process.env["ANTHROPIC_MODEL"]?.trim() ||
    getRuntimeModel()
  );
}

/** 进程里是否已具备 L1 所需密钥（不读文件、不打日志） */
export function isSupervisorEnrichConfigured(): boolean {
  return Boolean(getRuntimeKey() || process.env["ANTHROPIC_API_KEY"]?.trim());
}

interface ChatCompletionsResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } | null } | null>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * 把模型回复解析成 DraftEnrichment 字段。
 * 优先 JSON；失败再按「1)/2)」分段，保证可诊断而不是静默空结果。
 */
export function parseEnrichmentContent(
  content: string,
  modelId: string,
  usage: { input_tokens: number; output_tokens: number },
): DraftEnrichment {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new EnrichError("ENRICH_EMPTY_RESPONSE", "模型返回空内容");
  }

  const jsonCandidate = extractJsonObject(trimmed);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as {
        rationale?: unknown;
        unresolved_questions?: unknown;
      };
      const rationale = asStringList(parsed.rationale).slice(0, 3);
      const unresolved_questions = asStringList(parsed.unresolved_questions);
      if (rationale.length === 0 && unresolved_questions.length === 0) {
        throw new EnrichError(
          "ENRICH_PARSE_ERROR",
          "JSON 里 rationale 与 unresolved_questions 都为空",
        );
      }
      return {
        rationale:
          rationale.length > 0
            ? rationale
            : ["（模型未给出范围理由，请人工核对草案。）"],
        unresolved_questions,
        model_id: modelId,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      };
    } catch (err) {
      if (err instanceof EnrichError) throw err;
      // 继续走分段解析
    }
  }

  const sections = splitNumberedSections(trimmed);
  const rationale = (sections[0] ?? [])
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 3);
  const unresolved_questions = (sections[1] ?? [])
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0 && line !== "（无）" && line !== "无");

  if (rationale.length === 0) {
    throw new EnrichError(
      "ENRICH_PARSE_ERROR",
      "无法从模型回复中解析出白话理由（既非 JSON 也不含分段）",
    );
  }

  return {
    rationale,
    unresolved_questions,
    model_id: modelId,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
  };
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** 按「1)」/「2)」或「1.'/'2.'」切开两段 */
function splitNumberedSections(text: string): string[][] {
  const parts = text.split(/\n(?=\s*[12][).、]\s*)/);
  if (parts.length < 2) {
    // 整段当作理由
    return [
      text
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean),
      [],
    ];
  }
  return parts.map((part) =>
    part
      .replace(/^\s*[12][).、]\s*/, "")
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

/**
 * 构造注入给 Daemon 的 `supervisorEnrich(prompt) → DraftEnrichment`。
 */
export function createSupervisorEnrich(
  options: SupervisorEnrichOptions = {},
): (prompt: string) => Promise<DraftEnrichment> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (prompt: string): Promise<DraftEnrichment> => {
    const apiKey = resolveApiKey(options.apiKey);
    const baseURL = resolveBaseURL(options.baseURL);
    const modelId = resolveModel(options.modelId);
    const url = `${baseURL}/chat/completions`;
    const startedAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          // DeepSeek / 多数兼容口支持；不支持时服务端会忽略或 400，下方有降级解析
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        if (options.repoRoot) {
          try {
            appendLlmMeta(options.repoRoot, {
              source: "enrich",
              duration_ms: Date.now() - startedAt,
              model: modelId,
              enrichCode: "ENRICH_TIMEOUT",
            });
          } catch {
            /* ignore */
          }
        }
        throw new EnrichError(
          "ENRICH_TIMEOUT",
          `L1 补全超时（>${timeoutMs}ms），请稍后重试或先用不带 enrich 的纯 L0。`,
        );
      }
      if (options.repoRoot) {
        try {
          appendLlmMeta(options.repoRoot, {
            source: "enrich",
            duration_ms: Date.now() - startedAt,
            model: modelId,
            enrichCode: "ENRICH_HTTP_ERROR",
          });
        } catch {
          /* ignore */
        }
      }
      throw new EnrichError(
        "ENRICH_HTTP_ERROR",
        `L1 补全网络失败：${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const rawText = await response.text();
    if (!response.ok) {
      // 绝不把响应体全文（可能含回显）塞进错误；只留状态与截断摘要
      const summary = rawText.replace(/\s+/g, " ").slice(0, 160);
      throw new EnrichError(
        "ENRICH_HTTP_ERROR",
        `L1 补全 HTTP ${response.status}${summary ? `：${summary}` : ""}`,
        { status: response.status },
      );
    }

    let parsed: ChatCompletionsResponse;
    try {
      parsed = JSON.parse(rawText) as ChatCompletionsResponse;
    } catch {
      throw new EnrichError(
        "ENRICH_PARSE_ERROR",
        "L1 补全返回的不是合法 JSON（chat/completions 外壳）",
      );
    }

    const content = parsed.choices?.[0]?.message?.content ?? "";
    const usage = {
      input_tokens: parsed.usage?.prompt_tokens ?? 0,
      output_tokens: parsed.usage?.completion_tokens ?? 0,
    };
    const model = parsed.model?.trim() || modelId;
    if (options.repoRoot) {
      try {
        appendLlmMeta(options.repoRoot, {
          source: "enrich",
          duration_ms: Date.now() - startedAt,
          model,
          enrichCode: "OK",
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        });
      } catch {
        /* ignore */
      }
    }
    return parseEnrichmentContent(content, model, usage);
  };
}

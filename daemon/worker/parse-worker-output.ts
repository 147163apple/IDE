/**
 * TASK-H.1：Worker JSON/Patch 格式校验 + ≤1 次轻量本地重试。
 * 非法 JSON / 缺必填 patch 字段 → 明确错误码，不挂起、不无限重试。
 */
import { z } from "zod";

export const E_WORKER_PARSE = "E_WORKER_PARSE" as const;
/** 同轮最多额外重试次数（总调用 ≤ 2） */
export const WORKER_PARSE_MAX_RETRIES = 1 as const;

const changeSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const workerPatchSchema = z.object({
  changes: z.array(changeSchema),
  log: z.array(z.string()).default([]),
});

export type WorkerPatch = z.infer<typeof workerPatchSchema>;

export class WorkerParseError extends Error {
  readonly code = E_WORKER_PARSE;
  readonly retriesUsed: number;

  constructor(message: string, retriesUsed = 0) {
    super(`[${E_WORKER_PARSE}] ${message}`);
    this.name = "WorkerParseError";
    this.retriesUsed = retriesUsed;
  }
}

/** 剥掉 ```json ... ``` 围栏，便于模型偶发包 markdown */
export function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const m = fence.exec(trimmed);
  return m?.[1]?.trim() ?? trimmed;
}

/**
 * 校验 Worker 模型输出（对象或 JSON 字符串）。
 * 成功返回规范化 patch；失败抛 WorkerParseError（可识别、不挂起）。
 */
export function parseWorkerPatch(
  input: unknown,
  options: { retriesUsed?: number } = {},
): WorkerPatch {
  const retriesUsed = options.retriesUsed ?? 0;
  let value: unknown = input;

  if (typeof input === "string") {
    const text = stripMarkdownFence(input);
    if (!text) {
      throw new WorkerParseError("模型输出为空，无法解析 patch", retriesUsed);
    }
    try {
      value = JSON.parse(text);
    } catch (err) {
      throw new WorkerParseError(
        `非法 JSON：${err instanceof Error ? err.message : String(err)}`,
        retriesUsed,
      );
    }
  }

  if (value === null || typeof value !== "object") {
    throw new WorkerParseError(
      "模型输出不是对象（缺 changes/log 结构）",
      retriesUsed,
    );
  }

  const parsed = workerPatchSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new WorkerParseError(
      `patch 字段校验失败：${detail || "缺必填字段"}`,
      retriesUsed,
    );
  }
  return parsed.data;
}

export function isWorkerParseError(err: unknown): err is WorkerParseError {
  return (
    err instanceof WorkerParseError ||
    (err instanceof Error &&
      (err as Error & { code?: string }).code === E_WORKER_PARSE)
  );
}

/** generateObject / SDK 抛出的「像解析失败」的错误 */
export function looksLikeParseFailure(err: unknown): boolean {
  if (isWorkerParseError(err)) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("did not match schema") ||
    msg.includes("no object generated") ||
    msg.includes("invalid json") ||
    msg.includes("json parse") ||
    msg.includes("failed to parse") ||
    msg.includes(" Zod") ||
    msg.includes("zod") ||
    /parse/i.test(err.name)
  );
}

export interface ParseRetryHooks {
  /** 每次准备重试时回调（测试断言正好 1 次） */
  onRetry?: (attempt: number, cause: unknown) => void;
}

/**
 * 对异步「产出 raw → parse」管线做 ≤1 次本地重试。
 * producer(attempt) 中 attempt=0 首次，attempt=1 为唯一一次重试。
 */
export async function withParseRetry<T>(
  producer: (attempt: number) => Promise<unknown>,
  parse: (raw: unknown, retriesUsed: number) => T,
  hooks: ParseRetryHooks = {},
): Promise<{ value: T; retriesUsed: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= WORKER_PARSE_MAX_RETRIES; attempt += 1) {
    try {
      const raw = await producer(attempt);
      const value = parse(raw, attempt);
      return { value, retriesUsed: attempt };
    } catch (err) {
      lastErr = err;
      const canRetry =
        attempt < WORKER_PARSE_MAX_RETRIES && looksLikeParseFailure(err);
      if (!canRetry) {
        if (isWorkerParseError(err)) throw err;
        throw new WorkerParseError(
          err instanceof Error ? err.message : String(err),
          attempt,
        );
      }
      hooks.onRetry?.(attempt + 1, err);
    }
  }
  throw new WorkerParseError(
    lastErr instanceof Error ? lastErr.message : String(lastErr),
    WORKER_PARSE_MAX_RETRIES,
  );
}

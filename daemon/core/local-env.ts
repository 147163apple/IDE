/**
 * 本机临时环境注入（绝不入库、绝不把值打进日志）。
 *
 * 约定：密钥只放在 `<repo>/.tmp/deepseek.env`（已在 .gitignore），
 * Daemon / CLI 启动时读入 `process.env`，供 Worker（Anthropic 兼容）与
 * Supervisor L1（OpenAI 兼容）共用同一份 DeepSeek 凭据。
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_LOCAL_ENV_REL = ".tmp/deepseek.env";

export interface LoadLocalEnvResult {
  loaded: boolean;
  /** 本次新写入 process.env 的键名（不含值） */
  injectedKeys: string[];
  /** 文件里出现但已被环境变量抢先占用、因而跳过的键名 */
  skippedKeys: string[];
  path: string;
}

/**
 * 把 `export KEY=value` / `KEY=value` 行注入 `process.env`。
 * - 已存在的键不覆盖（显式环境优先）；
 * - 不返回、不记录任何 value。
 */
export function loadLocalEnvFile(
  repoRoot: string,
  relativePath: string = DEFAULT_LOCAL_ENV_REL,
): LoadLocalEnvResult {
  const fullPath = path.resolve(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    return {
      loaded: false,
      injectedKeys: [],
      skippedKeys: [],
      path: fullPath,
    };
  }

  const text = fs.readFileSync(fullPath, "utf8");
  const injectedKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] !== undefined) {
      skippedKeys.push(key);
      continue;
    }
    process.env[key] = value;
    injectedKeys.push(key);
  }

  return {
    loaded: true,
    injectedKeys,
    skippedKeys,
    path: fullPath,
  };
}

/**
 * 把 DeepSeek 的 Anthropic 兼容地址换成 OpenAI 兼容基址。
 * 例：`https://api.deepseek.com/anthropic` → `https://api.deepseek.com/v1`
 */
export function deriveOpenAiCompatibleBaseUrl(
  anthropicBaseUrl: string,
): string {
  let base = anthropicBaseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/anthropic")) {
    base = base.slice(0, -"/anthropic".length);
  }
  if (!base.endsWith("/v1")) {
    base = `${base}/v1`;
  }
  return base;
}

export interface OpenAiCompatMappingResult {
  /** 本次新写入的 OpenAI 兼容键名（不含值） */
  mappedKeys: string[];
}

/**
 * 若缺少 `OPENAI_*`，从已加载的 `ANTHROPIC_*` 推导（同一把 DeepSeek 钥）。
 * 不覆盖已有 `OPENAI_*` / `STAGENT_MODEL`。
 */
export function applyDeepSeekOpenAiCompatMapping(
  env: NodeJS.ProcessEnv = process.env,
): OpenAiCompatMappingResult {
  const mappedKeys: string[] = [];

  if (env["OPENAI_API_KEY"] === undefined && env["ANTHROPIC_API_KEY"]) {
    env["OPENAI_API_KEY"] = env["ANTHROPIC_API_KEY"];
    mappedKeys.push("OPENAI_API_KEY");
  }

  if (env["OPENAI_BASE_URL"] === undefined && env["ANTHROPIC_BASE_URL"]) {
    env["OPENAI_BASE_URL"] = deriveOpenAiCompatibleBaseUrl(
      env["ANTHROPIC_BASE_URL"],
    );
    mappedKeys.push("OPENAI_BASE_URL");
  }

  if (env["STAGENT_MODEL"] === undefined && env["ANTHROPIC_MODEL"]) {
    env["STAGENT_MODEL"] = env["ANTHROPIC_MODEL"];
    mappedKeys.push("STAGENT_MODEL");
  }

  return { mappedKeys };
}

/**
 * 启动时一次性注入：读 `.tmp/deepseek.env` + 做 OpenAI 兼容映射。
 * 返回值只含键名与是否加载成功，便于诊断日志（绝不含密钥）。
 */
export function injectLocalModelEnv(repoRoot: string): {
  envFile: LoadLocalEnvResult;
  mappedKeys: string[];
  enrichReady: boolean;
} {
  const envFile = loadLocalEnvFile(repoRoot);
  const { mappedKeys } = applyDeepSeekOpenAiCompatMapping();
  const enrichReady = Boolean(
    process.env["OPENAI_API_KEY"] || process.env["ANTHROPIC_API_KEY"],
  );
  return { envFile, mappedKeys, enrichReady };
}

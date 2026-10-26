/**
 * 共享深度脱敏（v1.3.3 保留范围：原属 TASK-S.3，随 TASK-S.2 精简版移植）。
 *
 * 适用面：一切要离开 Daemon 进程、可能被前端日志 / 浏览器缓存 / 截图 / 用户上报
 * 二次传播的文本与结构化 payload（Supervisor 草案、广播帧、错误详情）。
 *
 * 三层防线（由内到外）：
 * 1. **键名判定**：命中 `TOKEN` / `SECRET` / `PASSWORD` / `PRIVATE_KEY` /
 *    `CREDENTIAL` / `AWS_*` / `OPENAI_*` 等键的**值**整体替换为 `[REDACTED]`，
 *    不论值类型（字符串 / 数组 / 对象）；
 * 2. **值指纹**：调用方登记的真实秘密值（如 `env_file_grants` 注入值）按
 *    子串精确抹除；长度 < 6 的值不参与，避免把 `"1"`、`"true"` 这类短值误伤；
 * 3. **形态识别**：`sk-` / `ghp_` / `AKIA` / `xoxb-` / `Bearer` / PEM 私钥块 /
 *    `SECRET=...` 赋值形态，即使键名无害也会被抹除。
 *
 * 两条不可让步的顺序约定：
 * - **先脱敏、后截断**：反过来会把秘密切出半截留在文本里（截断点之前的碎片仍可识别）；
 * - **不修改入参**：返回新对象，避免调用方在脱敏后继续使用被污染的数据。
 *
 * 本模块为纯函数、无 `node:*` 依赖（同一份代码会进入浏览器侧打包），
 * 因此不得在此引入文件系统、进程或网络能力。
 */

/** 键名命中即整体脱敏（大小写不敏感） */
const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?key|session[_-]?key)($|[_-])|^(aws|github|openai|anthropic|ssh|npm)_|authorization|cookie/i;

/** 值形态识别（与 daemon/runner/command-runner 的 SECRET_PATTERNS 同源口径） */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(sk|rk)-[A-Za-z0-9_-]{16,}\b/g, // OpenAI / Anthropic 风格
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub token
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PAT
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack token
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, // Bearer token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*\S+/g,
];

export const REDACTED_PLACEHOLDER = "[REDACTED]";

/** 单字段最大字符数：超出截断并标记，防止单帧撑爆传输上限 */
export const REDACTION_MAX_STRING_LENGTH = 8_000;

/**
 * C.14d：脏区/禁写路径清单是施工门禁物理白名单，脱敏不得截断长度，
 * 否则管家话术计数与落盘白名单不一致，且超额路径失去保护。
 * 元素字符串仍走 redactText。
 */
export const NEVER_TRUNCATE_ARRAY_KEYS = new Set<string>([
  "dirty_exclusions",
  "protect_paths",
  "uncommitted",
  "untracked",
  "strictly_forbidden_paths",
  "forbidden_paths",
]);

export interface RedactionOptions {
  /** 已知真实秘密值（≥6 字符才参与精确抹除） */
  secretValues?: readonly string[];
  /** 单字符串上限，默认 {@link REDACTION_MAX_STRING_LENGTH} */
  maxStringLength?: number;
  /** 递归深度上限，默认 12（超出替换为 "[Truncated]"） */
  maxDepth?: number;
  /** 单数组元素上限，默认 200（防止超长列表把帧撑爆） */
  maxArrayLength?: number;
  /**
   * 额外永不截断长度的数组键（并入 {@link NEVER_TRUNCATE_ARRAY_KEYS}）。
   * 元素仍脱敏。
   */
  neverTruncateArrayKeys?: readonly string[];
}

export interface RedactionResult<T = unknown> {
  value: T;
  /** 是否发生过任一替换 */
  redacted: boolean;
  /** 是否发生过长度截断 */
  truncated: boolean;
  /** 被替换的字段/片段计数（用于广播统计与审计） */
  redactions: number;
}

/**
 * 从宿主环境收集「看起来是秘密」的值，作为精确抹除的候选集。
 * 只读取变量名与值，不记录来源；返回值仅用于比对，调用方不得落盘。
 */
export function collectEnvironmentSecrets(
  env: Record<string, string | undefined> = typeof process === "undefined"
    ? {}
    : (process.env as Record<string, string | undefined>),
): string[] {
  const secrets: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length < 8) continue;
    if (!SENSITIVE_KEY_PATTERN.test(key)) continue;
    // 只有长度足够的真实值才参与，避免把 PATH/HOME 之类误判值抹得到处都是
    secrets.push(value);
  }
  return secrets;
}

/** 单字符串脱敏（先抹除、后截断：截断不能把秘密切成半截留在文本里） */
export function redactText(
  text: string,
  options: RedactionOptions = {},
): { text: string; redacted: boolean; truncated: boolean; count: number } {
  const maxLength = options.maxStringLength ?? REDACTION_MAX_STRING_LENGTH;
  let out = text;
  let count = 0;

  for (const secret of options.secretValues ?? []) {
    if (secret.length < 6) continue;
    const parts = out.split(secret);
    if (parts.length < 2) continue;
    // 按**出现次数**计数（审计要能回答"抹掉了几处"，不是"匹配了几个值"）
    count += parts.length - 1;
    out = parts.join(REDACTED_PLACEHOLDER);
  }

  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, (match) => {
      count += 1;
      const eq = match.indexOf("=");
      // 保留 `KEY=` 前缀，只遮蔽值，便于排障时知道是哪个变量
      return eq > 0 && eq < 64
        ? `${match.slice(0, eq + 1)}${REDACTED_PLACEHOLDER}`
        : REDACTED_PLACEHOLDER;
    });
  }

  let truncated = false;
  if (out.length > maxLength) {
    out = `${out.slice(0, maxLength)} [truncated]`;
    truncated = true;
  }

  return { text: out, redacted: count > 0, truncated, count };
}

/**
 * 深度脱敏：对象 / 数组 / 字符串全部走三层防线。
 * 循环引用替换为 `"[Circular]"`，不抛错（脱敏路径绝不能因脏数据中断）。
 */
export function redactDeep<T = unknown>(
  input: T,
  options: RedactionOptions = {},
): RedactionResult<T> {
  const maxDepth = options.maxDepth ?? 12;
  const maxArrayLength = options.maxArrayLength ?? 200;
  const neverTruncate = new Set<string>([
    ...NEVER_TRUNCATE_ARRAY_KEYS,
    ...(options.neverTruncateArrayKeys ?? []),
  ]);
  let redacted = false;
  let truncated = false;
  let redactions = 0;
  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number, keyHint: string): unknown => {
    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
      const result = redactText(value, options);
      if (result.redacted) redacted = true;
      if (result.truncated) truncated = true;
      redactions += result.count;
      return result.text;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      // 数值/布尔本身不构成秘密；命中敏感键时由上层整体替换
      return value;
    }

    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function" || typeof value === "symbol") {
      return `[${typeof value}]`;
    }

    if (depth >= maxDepth) {
      truncated = true;
      return "[Truncated]";
    }

    if (value instanceof Date) return value.toISOString();

    if (Array.isArray(value)) {
      const preserveFull = neverTruncate.has(keyHint);
      const bounded =
        !preserveFull && value.length > maxArrayLength
          ? value.slice(0, maxArrayLength)
          : value;
      if (bounded.length !== value.length) truncated = true;
      return bounded.map((item) => walk(item, depth + 1, keyHint));
    }

    if (typeof value === "object") {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);

      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(source)) {
        // `authorization` / `cookie` 在 HTTP 语义下是字符串凭据；但合同里的
        // `authorization` 是**权限块对象**（git / scope / budget / cost）。
        // 仅当值不是对象时才整体脱敏，避免把结构字段误伤成字符串而破坏 Schema。
        const structuralContainer =
          (key === "authorization" || key === "cookie") &&
          typeof child === "object" &&
          child !== null;
        if (SENSITIVE_KEY_PATTERN.test(key) && !structuralContainer) {
          out[key] = REDACTED_PLACEHOLDER;
          redacted = true;
          redactions += 1;
          continue;
        }
        out[key] = walk(child, depth + 1, key);
      }
      seen.delete(value);
      return out;
    }

    return String(value);
  };

  const value = walk(input, 0, "") as T;
  return { value, redacted, truncated, redactions };
}

/**
 * Environment variable sanitizer for subprocess execution.
 * Strips sensitive system credentials, cloud keys, and API tokens,
 * while preserving safe execution environment variables.
 */

const SENSITIVE_PATTERNS = [
  /^AWS_/i,
  /^GITHUB_/i,
  /^OPENAI_/i,
  /^ANTHROPIC_/i,
  /^LOVABLE_/i,
  /SECRET/i,
  /KEY/i,
  /TOKEN/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /AUTH/i,
  /PRIVATE/i,
];

const PRESERVED_KEYS = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "NODE_PATH",
  "SYSTEMROOT",
  "COMSPEC",
]);

export interface EnvSanitizerOptions {
  /** Optional extra safe environment variables to pass through */
  extraEnv?: Record<string, string>;
  /** Explicitly allow specific keys that would otherwise be filtered */
  allowedKeyOverrides?: string[];
}

/**
 * Strips secrets and returns a sanitized environment dictionary for child process execution.
 */
export function sanitizeEnvironment(
  rawEnv: NodeJS.ProcessEnv = process.env,
  options: EnvSanitizerOptions = {},
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const overrides = new Set(options.allowedKeyOverrides ?? []);

  for (const [key, value] of Object.entries(rawEnv)) {
    if (value === undefined) continue;

    // Check if key is explicitly overridden
    if (overrides.has(key)) {
      sanitized[key] = value;
      continue;
    }

    // Filter out sensitive patterns
    const isSensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      continue;
    }

    // Allow preserved keys or safe keys (not matching sensitive patterns)
    if (PRESERVED_KEYS.has(key) || !isSensitive) {
      sanitized[key] = value;
    }
  }

  // Inject standard task testing & CI flags
  sanitized["CI"] = "true";
  if (!sanitized["NODE_ENV"]) {
    sanitized["NODE_ENV"] = "test";
  }
  sanitized["TERM"] = "dumb";

  // Merge extra explicitly provided envs
  if (options.extraEnv) {
    for (const [k, v] of Object.entries(options.extraEnv)) {
      sanitized[k] = v;
    }
  }

  return sanitized;
}

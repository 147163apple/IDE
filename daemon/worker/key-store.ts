/**
 * 模型凭据运行时配置（仅内存，不落盘、不回显）。
 * 规范安全边界：Key 只存在于 Daemon 进程内，浏览器仅在提交时短暂持有。
 */
export interface ModelSettings {
  configured: boolean;
  model: string;
  source: "runtime" | "environment" | "none";
}

let runtimeKey: string | null = null;
let runtimeModel: string | null = null;

export function setRuntimeKey(apiKey: string, model?: string): void {
  runtimeKey = apiKey.trim();
  if (model && model.trim()) runtimeModel = model.trim();
}

export function clearRuntimeKey(): void {
  runtimeKey = null;
}

export function getRuntimeKey(): string | null {
  return runtimeKey ?? process.env["OPENAI_API_KEY"] ?? null;
}

export function getRuntimeModel(): string {
  return runtimeModel ?? process.env["STAGENT_MODEL"] ?? "gpt-4o-mini";
}

export function getModelSettings(): ModelSettings {
  const source = runtimeKey
    ? "runtime"
    : process.env["OPENAI_API_KEY"]
      ? "environment"
      : "none";
  return {
    configured: source !== "none",
    model: getRuntimeModel(),
    source,
  };
}

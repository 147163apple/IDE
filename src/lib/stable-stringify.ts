/**
 * 规范化 JSON 序列化（TASK-J.2 抽出共享模块）。
 *
 * 用途：摘要 / 哈希的**唯一**序列化口径。键按字典序排序、无空白，
 * 因此「同一份对象、不同插入顺序」必得同一字符串。
 *
 * 约束：纯函数、零 Node 依赖，浏览器与 Daemon 共用。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

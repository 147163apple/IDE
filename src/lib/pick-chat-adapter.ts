/**
 * TASK-C.8a：挑默认助手时优先「能干活」的真助手，演示/练习沙箱只作兜底。
 * UI 与 Daemon 共用同一规则，避免「下拉显示真助手、实际却落演示」打架。
 */
export function pickPreferredAdapterId(
  adapters: ReadonlyArray<{ id: string; available: boolean }>,
  preferred?: string | null,
): string {
  if (preferred && adapters.some((a) => a.id === preferred && a.available)) {
    return preferred;
  }
  const real = adapters.find((a) => a.available && a.id !== "demo");
  if (real) return real.id;
  return adapters.find((a) => a.available)?.id ?? "";
}

/** 是否还有「非演示」的可用助手（有 Key / 环境就绪） */
export function hasRealAssistantAvailable(
  adapters: ReadonlyArray<{ id: string; available: boolean }>,
): boolean {
  return adapters.some((a) => a.available && a.id !== "demo");
}

import type { ChatToolMode } from "./chat-events";

/**
 * TASK-C.8a：挑默认助手时优先「能干活」的真助手，演示/练习沙箱只作兜底。
 * TASK-J.1（P0 安全）：右栏是搭档不是工人——**只读**适配器才允许被选中。
 * UI 与 Daemon 共用同一规则，避免「下拉显示真助手、实际却落演示」打架。
 */

/** 右栏只接受这类适配器；缺 `tool_mode` 一律按不可选处理（失败关闭） */
export type RightPaneAdapter = {
  id: string;
  available: boolean;
  tool_mode?: ChatToolMode;
};

/** 右栏能否用这个适配器：可用 **且** 明确声明只读 */
export function isRightPaneAdapter(adapter: RightPaneAdapter): boolean {
  return adapter.available && adapter.tool_mode === "read_only";
}

/**
 * 设置页用的白话原因：为什么这个助手不在右栏候选里。
 * 返回 null 表示它本来就是只读助手，无需解释。
 */
export function rightPaneRejectionReason(
  adapter: RightPaneAdapter,
): string | null {
  return adapter.tool_mode === "read_write"
    ? "会直接改你的文件，右栏只允许只看不改的助手"
    : null;
}

export function pickPreferredAdapterId(
  adapters: ReadonlyArray<RightPaneAdapter>,
  preferred?: string | null,
): string {
  const eligible = adapters.filter(isRightPaneAdapter);
  if (preferred && eligible.some((a) => a.id === preferred)) {
    return preferred;
  }
  const real = eligible.find((a) => a.id !== "demo");
  if (real) return real.id;
  return eligible[0]?.id ?? "";
}

/** 是否还有「非演示」且只读的可用助手（有 Key / 环境就绪） */
export function hasRealAssistantAvailable(
  adapters: ReadonlyArray<RightPaneAdapter>,
): boolean {
  return adapters.some((a) => isRightPaneAdapter(a) && a.id !== "demo");
}

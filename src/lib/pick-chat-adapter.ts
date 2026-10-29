import type { ChatToolMode } from "./chat-events";

/**
 * TASK-C.8a：挑默认助手时优先「能干活」的真助手，演示/练习沙箱只作兜底。
 * UI 与 Daemon 共用同一规则，避免「下拉显示真助手、实际却落演示」打架。
 *
 * TASK-J.1：方案工作台的右栏只允许只读搭档。带 `tool_mode: "read_write"`
 * （能写文件 / 跑 Shell）的适配器即使可用，也不得被选为右栏助手；
 * 历史载荷缺这个字段时按未知处理（不误杀）。
 */
export interface RightPanelAdapterCandidate {
  id: string;
  available: boolean;
  tool_mode?: ChatToolMode;
}

/** 该适配器是否允许出现在右栏（只读搭档） */
export function isRightPanelEligible(
  adapter: RightPanelAdapterCandidate,
): boolean {
  return adapter.tool_mode !== "read_write";
}

/** 给设置页用的白话原因（UI 只展示文案，不自行推导规则） */
export const READ_WRITE_NOT_ALLOWED_REASON =
  "这个助手能改文件、能跑命令，右栏只允许只读搭档。请换一个只读助手，或让它在施工区里干活。";

export function pickPreferredAdapterId(
  adapters: ReadonlyArray<RightPanelAdapterCandidate>,
  preferred?: string | null,
): string {
  const eligible = adapters.filter(isRightPanelEligible);
  if (preferred && eligible.some((a) => a.id === preferred && a.available)) {
    return preferred;
  }
  const real = eligible.find((a) => a.available && a.id !== "demo");
  if (real) return real.id;
  return eligible.find((a) => a.available)?.id ?? "";
}

/** 是否还有「非演示」的只读可用助手（有 Key / 环境就绪） */
export function hasRealAssistantAvailable(
  adapters: ReadonlyArray<RightPanelAdapterCandidate>,
): boolean {
  return adapters.some(
    (a) => a.available && a.id !== "demo" && isRightPanelEligible(a),
  );
}

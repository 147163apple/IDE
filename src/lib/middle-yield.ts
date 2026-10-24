/**
 * TASK-C.9d：进行中中栏让路 + 设置深链回跳（呈现层）。
 *
 * - 进行中：中栏收 IDE 欢迎页，让路给对话/三步台
 * - 向导→设置：深链模型钥匙区，配完可一键回跳
 * - 聊≠改：PROTECTED 下白话一句
 *
 * 不含重做 Studio 四视口路由；不改 Fast Path 准入/状态机边。
 * C.10a：空让路壳与 in_progress 退出见 `in-progress-lifecycle.ts`。
 */

import type { CommandSurfacePhase, InProgressCta } from "./command-surface";

/** 进行中时中栏不应再把 IDE 欢迎页当主视线 */
export function shouldYieldMiddleWelcome(
  phase: CommandSurfacePhase | undefined,
): boolean {
  return phase === "in_progress";
}

/** 三步台/保护确认出现时，自动打开 Studio 接到主视线 */
export function shouldAutoOpenStudioForProgress(
  cta: InProgressCta | undefined,
): boolean {
  return (
    cta === "boss-fastpath-confirm" || cta === "protection-confirm-approve"
  );
}

export type SettingsDeepFocus = "model-key";

export const SETTINGS_MODEL_KEY_TEST_ID = "settings-model-key";

/** 锁着仍可聊时的白话（不依赖 PROTECTED 暗号） */
export const CHAT_VS_EDIT_PLAIN =
  "可以先聊方案；真要改文件时，会再请你点头确认。";

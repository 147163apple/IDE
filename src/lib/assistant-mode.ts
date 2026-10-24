/**
 * TASK-C.9b：助手模式互斥（练习 vs 真助手 vs 向导）。
 *
 * 同一时刻只处于其一：
 * - wizard：真助手不可用（通常还差模型钥匙）→ 唯一出口「去配置」
 * - practice：练习沙箱会话（可发，但不可当真）
 * - real：真助手就绪，正常发送主路径
 *
 * 禁止「一边说还差钥匙、一边还能发消息假装干活」。
 * 不含改鉴权 / 真实云调用门禁；设置深链回跳细则归 C.9d。
 *
 * 判定以「真助手是否 available」为主信号（与 C.8a 适配器列表一致）；
 * keyReady 仅作文案补充，避免未注入 settings 时误伤已可用真助手。
 */

export type AssistantMode = "wizard" | "practice" | "real";

export interface AssistantModeInput {
  /** 模型钥匙已配置（settings.configured）；可选，文案用 */
  keyReady: boolean;
  /** 是否存在非 demo 且 available 的助手 */
  hasRealAssistant: boolean;
  /** 当前会话所用 adapter；无会话为 null */
  activeAdapterId: string | null | undefined;
}

export interface AssistantModeSurface {
  mode: AssistantMode;
  /** 发送键是否允许当真发送（practice 允许练习发送；wizard 禁止） */
  canSendAsWork: boolean;
  /** 向导态点击发送时是否只导向配置 */
  sendOpensConfigure: boolean;
  /** 中栏提示文案（与右栏一致） */
  middleHint: string;
  /** 主出口 test id（向导） */
  configureCtaTestId: "open-key-settings";
}

export function resolveAssistantMode(
  input: AssistantModeInput,
): AssistantModeSurface {
  const active = input.activeAdapterId ?? null;
  const inPractice = active === "demo";

  if (inPractice) {
    return {
      mode: "practice",
      canSendAsWork: true, // 练习可发，但 UI 必须标明不可当真
      sendOpensConfigure: false,
      middleHint:
        "练习沙箱：可以试界面，不会改你的项目。要真干活请切回真助手或先配钥匙。",
      configureCtaTestId: "open-key-settings",
    };
  }

  // 真助手不可用 → 向导（C.8a：没钥匙时 real adapters available=false）
  if (!input.hasRealAssistant) {
    return {
      mode: "wizard",
      canSendAsWork: false,
      sendOpensConfigure: true,
      middleHint: input.keyReady
        ? "真助手暂不可用：请到设置核对模型钥匙，或稍后再试。这里不会假装在干活。"
        : "还差模型钥匙：请先去配置，配好再回来说话。这里不会假装在干活。",
      configureCtaTestId: "open-key-settings",
    };
  }

  return {
    mode: "real",
    canSendAsWork: true,
    sendOpensConfigure: false,
    middleHint: "真助手就绪：在右侧说需求即可。",
    configureCtaTestId: "open-key-settings",
  };
}

/**
 * TASK-C.10d / C.10e / C.10f：左栏与欢迎页呈现辅助。
 *
 * C.10e：打开/切换项目迁到欢迎页（类似 Cursor），不再塞 IDE 左栏。
 * C.10f：资源管理器只展示纯文件树；规范与资产进合同操作台左侧栏（C.16）。
 * 不改变鉴权、文件能力或指挥纪律——只改呈现位置与层级。
 */

export type LeftBossPhase = "no_key" | "idle" | "in_progress" | undefined;

/** IDE 左栏是否仍渲染「打开/切换项目」（C.10e 起为 false） */
export function resolveLeftShowsOpenProject(): boolean {
  return false;
}

/** IDE 左栏是否仍渲染「规范与资产」（C.10f 起为 false） */
export function resolveLeftShowsSpecs(): boolean {
  return false;
}

/** 「项目文件」折叠区默认是否展开（C.10d 遗留；C.10f 后左栏不再用该折叠） */
export function resolveLeftProjectFilesDefaultOpen(): boolean {
  return false;
}

/**
 * 是否显示左栏「跟右侧说话」次要提示。
 * C.10e 起开项目已在欢迎页，左栏不再需要这条提示（避免与欢迎页重复）。
 */
export function shouldShowLeftChatHint(_phase: LeftBossPhase): boolean {
  return false;
}

export const LEFT_CHAT_HINT =
  "日常请在右侧跟助手说话；要换项目请回欢迎页或点顶栏「切换项目」。";

/**
 * TASK-C.10d：左栏老板主路径呈现辅助。
 *
 * 默认主视线只留「打开/切换项目」；规范与资产、完整文件树收进折叠「项目文件」。
 * 不改变鉴权、文件能力或指挥纪律——只改默认层级。
 */

export type LeftBossPhase = "no_key" | "idle" | "in_progress" | undefined;

/** 「项目文件」折叠区默认是否展开（老板路径：默认收） */
export function resolveLeftProjectFilesDefaultOpen(): boolean {
  return false;
}

/**
 * 是否显示「跟右侧说话」次要提示。
 * 有钥匙空闲时给一句提示；无钥匙/进行中不抢 C.9a 主指挥。
 */
export function shouldShowLeftChatHint(phase: LeftBossPhase): boolean {
  return phase === "idle" || phase === undefined;
}

export const LEFT_CHAT_HINT =
  "日常请在右侧跟助手说话；要看文件或本轮依据时，再展开下方「项目文件」。";

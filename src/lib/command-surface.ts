/**
 * TASK-C.9a：首屏单一主路径（指挥权）。
 *
 * 同一时刻只允许一个主指挥信号：
 * - no_key：一键重开 / 配模型钥匙
 * - idle：右侧说需求
 * - in_progress：当前对话 / 三步台 / 确认卡
 *
 * 其它面板与横幅降为次要，不得同级抢注意力。
 * 不含 C.9b/c/d 全量细则；本模块只定「谁当指挥官」。
 */

export type CommandSurfacePhase = "no_key" | "idle" | "in_progress";

export type CommandWelcomeVariant = "connect" | "speak_right" | "yield";

export type InProgressCta =
  "protection-confirm-approve" | "boss-fastpath-confirm" | "journey-active";

export interface CommandSurfaceInput {
  /** Daemon 会话已连上（有 session token / transport） */
  hasSession: boolean;
  /** 模型钥匙已配置（C.8a settings.configured） */
  keyReady: boolean;
  /** 旅程忙碌 / 确认卡 / 三步台 / 进行中对话 */
  inProgress: boolean;
  /** 进行中时具体主 CTA（可测） */
  inProgressCta?: InProgressCta | undefined;
}

export interface CommandSurface {
  phase: CommandSurfacePhase;
  /** 主 CTA 的 data-testid，走查时 10 秒内应能指出 */
  primaryCtaTestId: string;
  welcomeVariant: CommandWelcomeVariant;
  /** 顶栏模式徽标降为状态、不作指挥官 */
  quietHeaderBadge: true;
  /** 打开项目面板默认不展开（C.9a 纪律；生命周期细则归 C.9c） */
  openProjectDefaultExpanded: false;
}

export function resolveCommandSurface(
  input: CommandSurfaceInput,
): CommandSurface {
  if (!input.hasSession) {
    return {
      phase: "no_key",
      primaryCtaTestId: "chat-relaunch-with-token",
      welcomeVariant: "connect",
      quietHeaderBadge: true,
      openProjectDefaultExpanded: false,
    };
  }
  if (!input.keyReady) {
    return {
      phase: "no_key",
      primaryCtaTestId: "open-key-settings",
      welcomeVariant: "connect",
      quietHeaderBadge: true,
      openProjectDefaultExpanded: false,
    };
  }
  if (input.inProgress) {
    return {
      phase: "in_progress",
      primaryCtaTestId: input.inProgressCta ?? "journey-active",
      welcomeVariant: "yield",
      quietHeaderBadge: true,
      openProjectDefaultExpanded: false,
    };
  }
  return {
    phase: "idle",
    primaryCtaTestId: "journey-entry-hint",
    welcomeVariant: "speak_right",
    quietHeaderBadge: true,
    openProjectDefaultExpanded: false,
  };
}

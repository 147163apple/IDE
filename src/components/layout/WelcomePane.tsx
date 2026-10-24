import { ArrowRight, MessageSquare, KeyRound, Sparkles } from "lucide-react";
import type { CommandWelcomeVariant } from "../../lib/command-surface";

/**
 * 首屏欢迎区（Welcome / Empty Editor）—— TASK-C.9a 三态单一指挥。
 *
 * 不再并排甩出「打开文件 / 终端 / Supervisor / 说需求」四条同级提示。
 * 按指挥面变体只留一个主说明（+ 至多一个主 CTA）。
 */
export interface WelcomePaneProps {
  repoName: string;
  baseBranch: string;
  /** 有则显示「新建需求」按钮；仅 idle 且非指挥冲突时露出为次要 */
  onNewRequirement?: (() => void) | undefined;
  onOpenSupervisor: () => void;
  /** C.9a：由指挥面决定欢迎区话术 */
  welcomeVariant?: CommandWelcomeVariant | undefined;
}

export function WelcomePane({
  repoName,
  baseBranch,
  onNewRequirement,
  onOpenSupervisor: _onOpenSupervisor,
  welcomeVariant = "speak_right",
}: WelcomePaneProps) {
  void _onOpenSupervisor;
  return (
    <div
      data-testid="welcome-pane"
      data-welcome-variant={welcomeVariant}
      className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4 p-8"
    >
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Stagent</h1>
        <p className="text-xs opacity-70">
          {repoName} · {baseBranch}
        </p>
      </header>

      {welcomeVariant === "connect" ? (
        <div
          data-testid="welcome-command"
          data-command-role="secondary"
          className="space-y-2 rounded border border-border/70 bg-muted/20 px-4 py-3 text-sm leading-relaxed"
        >
          <p className="flex items-center gap-2 font-medium">
            <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
            先连上，再开始
          </p>
          <p className="text-xs opacity-80">
            主按钮在<strong>右侧</strong>
            ：一键重开，或去配置模型钥匙。这里不抢指挥。
          </p>
        </div>
      ) : null}

      {welcomeVariant === "speak_right" ? (
        <div
          data-testid="welcome-command"
          className="space-y-2 rounded border border-sky-600/30 bg-sky-500/5 px-4 py-3 text-sm leading-relaxed"
        >
          <p className="flex items-center gap-2 font-medium">
            <MessageSquare className="h-4 w-4 shrink-0 text-sky-800" />
            下一步：在右侧说出你的需求
          </p>
          <p className="text-xs opacity-80">
            质疑、新功能、小改都可以直接说。打开文件、终端、审阅都是次要入口，需要时再点左边图标。
          </p>
          {onNewRequirement ? (
            <button
              type="button"
              data-testid="welcome-new-requirement"
              data-command-role="secondary"
              onClick={onNewRequirement}
              className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/80 underline-offset-2 hover:underline hover:text-muted-foreground"
            >
              也可以用顶栏「新建需求」打开表单{" "}
              <ArrowRight className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ) : null}

      {welcomeVariant === "yield" ? (
        <div
          data-testid="welcome-command"
          className="space-y-2 rounded border border-border/60 px-4 py-3 text-sm leading-relaxed"
        >
          <p className="flex items-center gap-2 font-medium">
            <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
            进行中：请看右侧对话或中间确认
          </p>
          <p className="text-xs opacity-80">
            欢迎页已让路，不再当指挥官。确认开改、三步台或回复都在当前主路径上。
          </p>
        </div>
      ) : null}
    </div>
  );
}

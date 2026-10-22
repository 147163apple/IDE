import {
  ArrowRight,
  Files,
  FolderOpen,
  Sparkles,
  Terminal,
} from "lucide-react";

/**
 * 首屏欢迎区（Welcome / Empty Editor）。
 *
 * 定位：**不假装有内容**。没有打开文件时，中央就是一块空编辑区，
 * 只摆三个真实可点的下一步，而不是塞一个默认打开的面板占住视野。
 *
 * 这里不写快捷键提示：当前并没有实现命令面板/快捷键注册，
 * 写了就是教用户按了没反应。
 */
export interface WelcomePaneProps {
  repoName: string;
  baseBranch: string;
  /** 有则显示「新建需求」按钮（走真实的合同创建流程） */
  onNewRequirement?: (() => void) | undefined;
  onOpenSupervisor: () => void;
}

function Hint({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2 rounded border border-border/60 px-3 py-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-70">{children}</p>
      </div>
    </li>
  );
}

export function WelcomePane({
  repoName,
  baseBranch,
  onNewRequirement,
  onOpenSupervisor,
}: WelcomePaneProps) {
  return (
    <div
      data-testid="welcome-pane"
      className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-5 p-8"
    >
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Stagent</h1>
        <p className="text-xs opacity-70">
          {repoName} · {baseBranch} · 空编辑区
        </p>
      </header>

      <ul className="space-y-2 text-sm">
        <Hint icon={<Files className="h-4 w-4" />} title="打开文件">
          左栏资源管理器点任意文件，就在这里以标签页打开，可并排多开。
        </Hint>
        <Hint icon={<Terminal className="h-4 w-4" />} title="看命令输出">
          左下角终端图标展开 SmartTerminal，验证命令的原始输出都在那儿。
        </Hint>
        <Hint
          icon={<Sparkles className="h-4 w-4" />}
          title="先让 Supervisor 审一遍"
        >
          点左下角 ✦ 打开 Supervisor：项目概览、影响范围、验证计划，
          决定开工前都摆在同一页。
        </Hint>
        <Hint icon={<FolderOpen className="h-4 w-4" />} title="或者直接说需求">
          在右侧对话里描述目标；生成的合同会出现在左栏， 点开即进合同操作台。
        </Hint>
      </ul>

      <div className="flex flex-wrap gap-2">
        {onNewRequirement ? (
          <button
            type="button"
            data-testid="welcome-new-requirement"
            onClick={onNewRequirement}
            className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          >
            新建需求 <ArrowRight className="h-3 w-3" />
          </button>
        ) : null}
        <button
          type="button"
          data-testid="welcome-open-supervisor"
          onClick={onOpenSupervisor}
          className="rounded border px-3 py-1.5 text-xs hover:bg-accent"
        >
          打开 Supervisor
        </button>
      </div>
    </div>
  );
}

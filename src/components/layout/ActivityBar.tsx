import {
  Files,
  Network,
  Settings,
  Sparkles,
  TerminalSquare,
} from "lucide-react";

/**
 * Activity Bar（Cursor / VS Code 式左窄条）。
 *
 * 只放**真实可用**的入口，不放装饰图标：
 * - 上：文件树开关；
 * - 上：任务图谱（业务功能导图 / 执行 DAG，TASK-C.7）；
 * - 下：Supervisor（常驻左下角，点开在中央打开可关闭的 Tab）；
 * - 下：设置（紧挨 Supervisor，连接/诊断/开关全在那一页）；
 * - 下：SmartTerminal 抽屉开关。
 *
 * 没有搜索 / 源码管理 / 扩展入口——这些能力当前不存在，画成图标就是假入口。
 */
export interface ActivityBarProps {
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  graphOpen: boolean;
  onOpenGraph: () => void;
  supervisorOpen: boolean;
  onOpenSupervisor: () => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
}

function BarButton({
  label,
  testId,
  active,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function ActivityBar({
  explorerOpen,
  onToggleExplorer,
  graphOpen,
  onOpenGraph,
  supervisorOpen,
  onOpenSupervisor,
  settingsOpen,
  onOpenSettings,
  terminalOpen,
  onToggleTerminal,
}: ActivityBarProps) {
  return (
    <nav
      data-testid="activity-bar"
      aria-label="活动栏"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-muted/30 py-2"
    >
      <BarButton
        label="资源管理器（文件树）"
        testId="activity-explorer"
        active={explorerOpen}
        onClick={onToggleExplorer}
      >
        <Files className="h-5 w-5" />
      </BarButton>
      <BarButton
        label="任务图谱（业务功能 / 执行拓扑）"
        testId="activity-graph"
        active={graphOpen}
        onClick={onOpenGraph}
      >
        <Network className="h-5 w-5" />
      </BarButton>
      <div className="mt-auto flex flex-col items-center gap-1">
        <BarButton
          label="Supervisor（工程审阅）"
          testId="activity-supervisor"
          active={supervisorOpen}
          onClick={onOpenSupervisor}
        >
          <Sparkles className="h-5 w-5" />
        </BarButton>
        <BarButton
          label="设置（连接 / 诊断 / 开关）"
          testId="activity-settings"
          active={settingsOpen}
          onClick={onOpenSettings}
        >
          <Settings className="h-5 w-5" />
        </BarButton>
        <BarButton
          label="SmartTerminal（命令输出）"
          testId="activity-terminal"
          active={terminalOpen}
          onClick={onToggleTerminal}
        >
          <TerminalSquare className="h-5 w-5" />
        </BarButton>
      </div>
    </nav>
  );
}

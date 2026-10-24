import {
  Files,
  Network,
  Settings,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { WORKBENCH_LABEL } from "../../lib/workbench-labels";

/**
 * Activity Bar（Cursor / VS Code 式左窄条）。
 *
 * TASK-C.10c：title / aria-label 只用白话，不甩英文暗号。
 * 图谱入口打开合同操作台内「任务图谱」视口（由布局转发），不再独立系统 Tab 主路径。
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
        label={WORKBENCH_LABEL.explorer}
        testId="activity-explorer"
        active={explorerOpen}
        onClick={onToggleExplorer}
      >
        <Files className="h-5 w-5" />
      </BarButton>
      <BarButton
        label={`${WORKBENCH_LABEL.graph}（在${WORKBENCH_LABEL.studio}里看）`}
        testId="activity-graph"
        active={graphOpen}
        onClick={onOpenGraph}
      >
        <Network className="h-5 w-5" />
      </BarButton>
      <div className="mt-auto flex flex-col items-center gap-1">
        <BarButton
          label={WORKBENCH_LABEL.supervisor}
          testId="activity-supervisor"
          active={supervisorOpen}
          onClick={onOpenSupervisor}
        >
          <Sparkles className="h-5 w-5" />
        </BarButton>
        <BarButton
          label={WORKBENCH_LABEL.settings}
          testId="activity-settings"
          active={settingsOpen}
          onClick={onOpenSettings}
        >
          <Settings className="h-5 w-5" />
        </BarButton>
        <BarButton
          label={WORKBENCH_LABEL.terminal}
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

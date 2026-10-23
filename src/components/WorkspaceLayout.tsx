import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { FileTree } from "./FileTree";
import { SplitPaneContainer } from "./SplitPaneContainer";
import { CollapsibleSection } from "./layout/CollapsibleSection";
import { ActivityBar } from "./layout/ActivityBar";
import { OpenProjectEntry } from "./layout/OpenProjectEntry";
import { WelcomePane } from "./layout/WelcomePane";
import { useResizablePanel } from "./layout/useResizablePanel";
import {
  EXECUTION_STATUS_LABEL,
  type ActiveContract,
  type FileNode,
  type RunMode,
} from "./workspace-types";

export const STUDIO_TAB_ID = "system:supervisor-studio";
/** Supervisor 审阅 Tab（左下角图标入口打开；中央阅读区，可关闭） */
export const SUPERVISOR_TAB_ID = "system:supervisor";
/** 设置 Tab（⚙️ 图标入口；连接/诊断/开关全在这一页） */
export const SETTINGS_TAB_ID = "system:settings";
/** Task Graph Tab（业务功能导图 / 执行 DAG，TASK-C.7） */
export const GRAPH_TAB_ID = "system:task-graph";

interface Tab {
  id: string;
  title: string;
  system?: boolean;
  closable?: boolean;
}

export interface WorkspaceLayoutProps {
  repoName: string;
  repoPath: string;
  baseBranch: string;
  runMode: RunMode;
  contract?: ActiveContract | null | undefined;
  files: FileNode[];
  /** 以下为接入主页面用的插槽，均可选 */
  banner?: ReactNode;
  leftExtra?: ReactNode;
  studioContent?: ReactNode;
  /** Supervisor Tab 内容（由主页面注入，数据全部来自合同/保护清单） */
  supervisorContent?: ReactNode;
  /** 设置 Tab 内容（由主页面注入，连接与模型 Key 面板在那里） */
  settingsContent?: ReactNode;
  /** Task Graph Tab 内容（业务功能导图 / 执行 DAG，TASK-C.7） */
  graphContent?: ReactNode;
  /** 左栏文件树上方的【规范与资产】专区（需求文档 / 合同 / Demo 原型） */
  specsSection?: ReactNode;
  /** 右栏：AI 对话（主要需求沟通入口） */
  rightPanel?: ReactNode;
  /** 底栏 SmartTerminal 抽屉内容 */
  terminalPanel?: ReactNode;
  footer?: ReactNode;
  /** 首屏欢迎区；不传则用内置极简版（仍然只有真实入口） */
  welcome?: ReactNode;
  /** 顶栏右侧唯一操作点：新建需求 */
  onNewRequirement?: (() => void) | undefined;
  /** 渲染某个文件的编辑器（C.3）；缺省为占位 */
  renderFile?: (path: string, boundToWorktree: boolean) => ReactNode;
  /** 外部请求打开文件（例如 Agent 刚改了它）；nonce 变化即触发 */
  openRequest?: { path: string; nonce: number } | null;
  /**
   * 外部请求切到 Supervisor Studio 标签；nonce 变化即触发。
   * 供 Supervisor Tab 里的「打开合同操作台」使用——Tab 由布局自己持有，
   * 页面无法直接 setActiveTab，所以用信号替代共享状态。
   */
  openStudioRequest?: number;
  /** 中栏顶部横幅（Evidence STALE 等） */
  middleBanner?: ReactNode;
  /**
   * 中栏顶部的白话确认卡插槽（C.2）。
   * 放在 Tab 栏之上、不遮挡代码：切换文件时确认卡仍可见，不会"关掉标签就丢了问题"。
   */
  confirmSlot?: ReactNode;
  /** 顶栏「已锁 N 处」（C.2） */
  protectedCount?: number | undefined;
  /**
   * 首次打开即显示 Supervisor Studio。
   * **页面已不再传它**：首屏必须是空编辑区/欢迎页，Studio 由用户点合同或点模式徽标才开。
   * 保留这个 prop 只为显式 opt-in 的测试与并行对照场景。
   */
  defaultOpenStudio?: boolean;
}

/**
 * Cursor / VS Code 式 IDE 骨架：
 *
 *   顶栏（项目 / 分支 / 模式 + 一个「新建需求」）
 *   ├ Activity Bar │ 文件树（可折叠 / 可拖宽） │ 代码标签页（中） │ AI 对话（可折叠 / 可拖宽）
 *   └ 底栏：抽屉式 SmartTerminal（可收起）
 *
 * 四条边界（本轮）：
 * 1. 对话在**右侧**，是主要需求沟通入口；不搬去左栏；
 * 2. 顶栏只留状态胶囊，连接/Token/流诊断/网关受控全部下沉到 ⚙️ 设置 Tab；
 * 3. 首屏是**空编辑区**，Supervisor / 设置只在用户主动点击时开成可关闭 Tab；
 * 4. D4：无中心 Hub、无顶部 HUD、无成熟度气泡（本文件零相关实现）。
 */
export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  const { contract } = props;
  const bound = !!contract?.approved;
  // 用户手动切回主工作树的标记（仅在有已批准合同时有意义）
  const [onMainTree, setOnMainTree] = useState(false);
  const useWorktree = bound && !onMainTree;
  const root = useWorktree ? contract!.worktreePath : props.repoPath;

  const [tabs, setTabs] = useState<Tab[]>(() =>
    props.defaultOpenStudio
      ? [
          {
            id: STUDIO_TAB_ID,
            title: "Supervisor Studio",
            system: true,
            closable: true,
          },
        ]
      : [],
  );
  const [activeTab, setActiveTab] = useState<string | null>(() =>
    props.defaultOpenStudio ? STUDIO_TAB_ID : null,
  );
  const [split, setSplit] = useState(false);
  // 面板折叠状态（默认：左开、右开、终端收起）
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const left = useResizablePanel({ initial: 260, side: "left" });
  const right = useResizablePanel({ initial: 340, side: "right", min: 280 });

  const openTab = (tab: Tab) => {
    setTabs((t) => (t.some((x) => x.id === tab.id) ? t : [...t, tab]));
    setActiveTab(tab.id);
  };
  const closeTab = (id: string) => {
    setTabs((t) => {
      const next = t.filter((x) => x.id !== id);
      setActiveTab((cur) => (cur === id ? (next.at(-1)?.id ?? null) : cur));
      return next;
    });
  };

  const req = props.openRequest;
  useEffect(() => {
    if (!req) return;
    const p = req.path;
    setTabs((t) =>
      t.some((x) => x.id === p)
        ? t
        : [...t, { id: p, title: p.split("/").pop() ?? p }],
    );
    setActiveTab(p);
  }, [req?.path, req?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const openStudio = () =>
    openTab({
      id: STUDIO_TAB_ID,
      title: "Supervisor Studio",
      system: true,
      closable: true,
    });

  const studioReq = props.openStudioRequest;
  useEffect(() => {
    if (!studioReq) return;
    openStudio();
    // openStudio 每次渲染都是新函数，只在外部信号变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioReq]);

  /** 左下角 Supervisor 图标：未打开则打开，已打开则聚焦（不做 toggle 关闭，避免误触丢状态） */
  const focusSupervisor = () => {
    setTabs((t) =>
      t.some((x) => x.id === SUPERVISOR_TAB_ID)
        ? t
        : [
            ...t,
            {
              id: SUPERVISOR_TAB_ID,
              title: "Supervisor",
              system: true,
              closable: true,
            },
          ],
    );
    setActiveTab(SUPERVISOR_TAB_ID);
  };
  /** 任务图谱图标：打开/聚焦 Graph Tab（与 Supervisor 一样不 toggle） */
  const openGraph = () => {
    setTabs((t) =>
      t.some((x) => x.id === GRAPH_TAB_ID)
        ? t
        : [
            ...t,
            {
              id: GRAPH_TAB_ID,
              title: "任务图谱",
              system: true,
              closable: true,
            },
          ],
    );
    setActiveTab(GRAPH_TAB_ID);
  };
  /** 左下角齿轮：打开设置 Tab（同样不做 toggle，避免误触关掉正在填的表单） */
  const openSettings = () => {
    setTabs((t) =>
      t.some((x) => x.id === SETTINGS_TAB_ID)
        ? t
        : [
            ...t,
            {
              id: SETTINGS_TAB_ID,
              title: "设置",
              system: true,
              closable: true,
            },
          ],
    );
    setActiveTab(SETTINGS_TAB_ID);
  };

  const studio = (
    <div data-testid="studio-pane" className="min-h-0 text-sm">
      {props.studioContent ?? (
        <div className="p-3">
          Supervisor Studio（合同审阅区，TASK-C.2 实装）
        </div>
      )}
    </div>
  );
  const supervisor = (
    <div data-testid="supervisor-pane" className="min-h-0 overflow-auto">
      {props.supervisorContent ?? (
        <div className="p-3 text-sm opacity-60">
          Supervisor 需要主页面注入合同与保护清单数据。
        </div>
      )}
    </div>
  );
  const settings = (
    <div data-testid="settings-pane" className="min-h-0 overflow-auto">
      {props.settingsContent ?? (
        <div className="p-3 text-sm opacity-60">
          设置页需要主页面注入连接与模型 Key 面板。
        </div>
      )}
    </div>
  );
  const graphPane = (
    <div data-testid="graph-pane" className="flex min-h-0 flex-col">
      {props.graphContent ?? (
        <div className="p-3 text-sm opacity-60">
          任务图谱需要主页面注入权威快照（TASK-C.7）。
        </div>
      )}
    </div>
  );
  const welcome = (
    <div data-testid="welcome-surface" className="h-full overflow-auto">
      {props.welcome ?? (
        <WelcomePane
          repoName={props.repoName}
          baseBranch={props.baseBranch}
          onNewRequirement={props.onNewRequirement}
          onOpenSupervisor={focusSupervisor}
        />
      )}
    </div>
  );
  const editorFor = (id: string | null) =>
    id &&
    id !== STUDIO_TAB_ID &&
    id !== SUPERVISOR_TAB_ID &&
    id !== SETTINGS_TAB_ID &&
    id !== GRAPH_TAB_ID ? (
      props.renderFile ? (
        props.renderFile(id, useWorktree)
      ) : (
        <div data-testid="editor-placeholder" className="p-3 text-sm">
          {id}（代码编辑器占位，TASK-C.3 接入 Monaco）
        </div>
      )
    ) : (
      <div className="p-3 text-sm opacity-60">从左侧打开文件</div>
    );

  const isStudio = activeTab === STUDIO_TAB_ID;
  const isSupervisor = activeTab === SUPERVISOR_TAB_ID;
  const isSettings = activeTab === SETTINGS_TAB_ID;
  const isGraph = activeTab === GRAPH_TAB_ID;
  /** 没有打开任何标签 = 空编辑区（首屏默认就是这个） */
  const showWelcome = tabs.length === 0 || activeTab === null;
  const lastFile = [...tabs].reverse().find((t) => !t.system)?.id ?? null;

  return (
    <div data-testid="workspace-layout" className="flex h-screen flex-col">
      <WorkspaceHeader
        repoName={props.repoName}
        baseBranch={props.baseBranch}
        runMode={props.runMode}
        protectedCount={props.protectedCount ?? 0}
        onOpenStudio={openStudio}
        onNewRequirement={props.onNewRequirement}
      />
      {props.banner}
      {bound && onMainTree && (
        <div
          data-testid="main-tree-warning"
          role="alert"
          className="bg-yellow-50 px-3 py-1 text-sm text-yellow-900"
        >
          你正在查看主工作树，合同 {contract!.contractId} 的改动在 Worktree 里（
          {EXECUTION_STATUS_LABEL[contract!.status]}）。
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => setOnMainTree(false)}
          >
            回到 Worktree
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ActivityBar
          explorerOpen={leftOpen}
          onToggleExplorer={() => setLeftOpen((v) => !v)}
          supervisorOpen={isSupervisor}
          onOpenSupervisor={focusSupervisor}
          graphOpen={isGraph}
          onOpenGraph={openGraph}
          settingsOpen={isSettings}
          onOpenSettings={openSettings}
          terminalOpen={terminalOpen}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
        />

        {leftOpen ? (
          <>
            <aside
              data-testid="left-column"
              style={{ width: left.width }}
              className="flex shrink-0 flex-col border-r"
            >
              {bound && !onMainTree && (
                <button
                  type="button"
                  data-testid="switch-main-tree"
                  className="m-2 self-start text-xs underline"
                  onClick={() => setOnMainTree(true)}
                >
                  切换到主工作树
                </button>
              )}
              <div
                data-testid="workspace-binding"
                data-bound={useWorktree ? "worktree" : "main"}
                hidden
              />
              <OpenProjectEntry
                repoName={props.repoName}
                repoPath={props.repoPath}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                {props.specsSection}
                <FileTree
                  nodes={props.files}
                  rootLabel={root}
                  onOpen={(p) =>
                    openTab({ id: p, title: p.split("/").pop() ?? p })
                  }
                />
                {props.leftExtra}
              </div>
            </aside>
            <div
              data-testid="resizer-left"
              {...left.resizerProps}
              className={`w-1 shrink-0 cursor-col-resize bg-border/60 hover:bg-primary/40 ${
                left.dragging ? "bg-primary/60" : ""
              }`}
            />
          </>
        ) : null}

        <main
          data-testid="middle-column"
          className="flex min-w-0 flex-1 flex-col"
        >
          {props.middleBanner}
          {props.confirmSlot}
          <div role="tablist" className="flex gap-1 border-b px-2 text-sm">
            {tabs.map((t) => (
              <span key={t.id} className="flex items-center">
                <button
                  role="tab"
                  aria-selected={t.id === activeTab}
                  data-system={t.system ? "true" : undefined}
                  onClick={() => setActiveTab(t.id)}
                  className={t.id === activeTab ? "font-medium" : "opacity-70"}
                >
                  {t.title}
                </button>
                {t.closable ? (
                  <button
                    type="button"
                    data-testid={`close-tab-${t.id}`}
                    aria-label={`关闭 ${t.title}`}
                    title={`关闭 ${t.title}`}
                    onClick={() => closeTab(t.id)}
                    className="ml-1 rounded px-1 text-xs opacity-50 hover:bg-accent hover:opacity-100"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            <button
              type="button"
              data-testid="toggle-split"
              className="ml-auto"
              onClick={() => {
                setSplit((s) => !s);
                openStudio();
                if (lastFile) setActiveTab(lastFile);
              }}
            >
              {split ? "取消分屏" : "分屏对照"}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {showWelcome ? (
              welcome
            ) : split ? (
              <SplitPaneContainer left={editorFor(lastFile)} right={studio} />
            ) : isStudio ? (
              studio
            ) : isSupervisor ? (
              supervisor
            ) : isSettings ? (
              settings
            ) : isGraph ? (
              graphPane
            ) : (
              editorFor(activeTab)
            )}
          </div>
        </main>

        {rightOpen ? (
          <>
            <div
              data-testid="resizer-right"
              {...right.resizerProps}
              className={`w-1 shrink-0 cursor-col-resize bg-border/60 hover:bg-primary/40 ${
                right.dragging ? "bg-primary/60" : ""
              }`}
            />
            <aside
              data-testid="right-column"
              style={{ width: right.width }}
              className="flex shrink-0 flex-col border-l"
            >
              <header className="flex items-center gap-2 border-b px-2 py-1 text-xs">
                <span className="font-semibold">AI 对话</span>
                <button
                  type="button"
                  data-testid="collapse-right"
                  aria-label="收起 AI 对话"
                  onClick={() => setRightOpen(false)}
                  className="ml-auto rounded border px-1.5 py-0.5 hover:bg-accent"
                >
                  收起
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto">
                {props.rightPanel ?? "Coding Agent 对话（TASK-C.6 实装）"}
              </div>
            </aside>
          </>
        ) : (
          <button
            type="button"
            data-testid="expand-right"
            aria-label="展开 AI 对话"
            title="展开 AI 对话"
            onClick={() => setRightOpen(true)}
            className="w-8 shrink-0 border-l text-xs text-muted-foreground hover:bg-accent"
          >
            AI
          </button>
        )}
      </div>

      {/* 底栏：抽屉式 SmartTerminal，默认收起，只有要看退出码时才占高度 */}
      <CollapsibleSection
        testId="terminal-drawer"
        title="SmartTerminal"
        open={terminalOpen}
        onToggle={() => setTerminalOpen((v) => !v)}
        summary="验证命令原始输出（点开看退出码）"
        toggleLabel={{ open: "收起终端", closed: "展开终端" }}
        className="max-h-64 shrink-0 border-t"
      >
        <div data-testid="terminal-drawer-body" className="h-56 overflow-auto">
          {props.terminalPanel ?? (
            <p className="p-3 text-xs leading-relaxed opacity-60">
              这里回放本轮验证命令的原始输出（先脱敏后截断）。失败时先看退出码，
              再看证据。
            </p>
          )}
        </div>
      </CollapsibleSection>
      {props.footer}
    </div>
  );
}

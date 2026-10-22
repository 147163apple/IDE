import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { FileTree } from "./FileTree";
import { SplitPaneContainer } from "./SplitPaneContainer";
import { CollapsibleSection } from "./layout/CollapsibleSection";
import {
  EXECUTION_STATUS_LABEL,
  type ActiveContract,
  type FileNode,
  type RunMode,
  type WorkerControl,
} from "./workspace-types";

export const STUDIO_TAB_ID = "system:supervisor-studio";

interface Tab {
  id: string;
  title: string;
  system?: boolean;
}

export interface WorkspaceLayoutProps {
  repoName: string;
  repoPath: string;
  baseBranch: string;
  runMode: RunMode;
  workerControl: WorkerControl;
  /** Daemon 连接状态；断线时徽章变暗（P.1 顺手修） */
  daemonConnected?: boolean;
  contract?: ActiveContract | null | undefined;
  files: FileNode[];
  /** 以下为接入主页面用的插槽，均可选 */
  headerExtra?: ReactNode;
  banner?: ReactNode;
  leftExtra?: ReactNode;
  studioContent?: ReactNode;
  /**
   * 右栏内容。布局重构后右栏改为「任务与证据」摘要位；
   * 意图对话改走 `intentPanel`（左栏）。
   */
  rightPanel?: ReactNode;
  /** 左栏意图对话区（布局重构新增；缺省显示使用说明） */
  intentPanel?: ReactNode;
  /** 底栏 SmartTerminal 抽屉内容（布局重构新增） */
  terminalPanel?: ReactNode;
  footer?: ReactNode;
  /** 渲染某个文件的编辑器（C.3）；缺省为占位 */
  renderFile?: (path: string, boundToWorktree: boolean) => ReactNode;
  /** 外部请求打开文件（例如 Agent 刚改了它）；nonce 变化即触发 */
  openRequest?: { path: string; nonce: number } | null;
  /** 中栏顶部横幅（Evidence STALE 等） */
  middleBanner?: ReactNode;
  /**
   * 中栏顶部的白话确认卡插槽（C.2）。
   * 放在 Tab 栏之上、不遮挡代码：切换文件时确认卡仍可见，不会"关掉标签就丢了问题"。
   */
  confirmSlot?: ReactNode;
  /** 顶栏「已锁 N 处」（C.2） */
  protectedCount?: number | undefined;
  /** 首次打开即显示 Supervisor Studio 标签 */
  defaultOpenStudio?: boolean;
}

/**
 * 三栏工作台 + 底栏终端抽屉（布局重构后）。
 *
 * 布局重构（UI 体验）要解决的问题：面板一多就"不知道从哪儿开始、也不知道哪个能收"。
 * 因此把信息按"意图 → 审阅 → 证据"排布，并给三处面板统一的收拢语义：
 * - 左栏：意图对话（先说清要改什么）+ 可收拢的文件树；
 * - 中栏：代码标签页；Studio 审阅以可收拢 dock 呈现，不占死中栏；
 * - 底栏：抽屉式 SmartTerminal，默认收起，需要看退出码时再拉开；
 * - 右栏：任务与证据摘要（原 Coding Agent 对话已迁至左栏意图区）。
 *
 * D4 决议：不引入中心 Hub、顶部 HUD 与成熟度气泡（当前 Layout 内零相关实现）。
 * 合同批准后默认绑定 Worktree（G-18）；切回主工作树时显式提示并显示执行状态。
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
      ? [{ id: STUDIO_TAB_ID, title: "Supervisor Studio", system: true }]
      : [],
  );
  const [activeTab, setActiveTab] = useState<string | null>(() =>
    props.defaultOpenStudio ? STUDIO_TAB_ID : null,
  );
  const [split, setSplit] = useState(false);
  // 布局重构：三处可收拢面板的本地状态（默认只收起终端，其余展开）
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [studioCollapsed, setStudioCollapsed] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  const openTab = (tab: Tab) => {
    setTabs((t) => (t.some((x) => x.id === tab.id) ? t : [...t, tab]));
    setActiveTab(tab.id);
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
    openTab({ id: STUDIO_TAB_ID, title: "Supervisor Studio", system: true });

  const studio = (
    <div data-testid="studio-pane" className="min-h-0 text-sm">
      {props.studioContent ?? (
        <div className="p-3">
          Supervisor Studio（合同审阅区，TASK-C.2 实装）
        </div>
      )}
    </div>
  );
  const editorFor = (id: string | null) =>
    id && id !== STUDIO_TAB_ID ? (
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
  const lastFile = [...tabs].reverse().find((t) => !t.system)?.id ?? null;

  return (
    <div data-testid="workspace-layout" className="flex h-screen flex-col">
      <WorkspaceHeader
        repoName={props.repoName}
        baseBranch={props.baseBranch}
        runMode={props.runMode}
        contract={contract}
        workerControl={props.workerControl}
        daemonConnected={props.daemonConnected ?? true}
        protectedCount={props.protectedCount ?? 0}
        onOpenStudio={openStudio}
        extra={props.headerExtra}
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
        <aside
          data-testid="left-column"
          className="flex w-80 shrink-0 flex-col border-r"
        >
          {bound && !onMainTree && (
            <button
              type="button"
              data-testid="switch-main-tree"
              className="mx-2 mt-2 self-start text-xs underline"
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
          {/* 意图对话：先讲清目标，再进代码 */}
          <section
            data-testid="intent-rail"
            data-state="open"
            className="flex min-h-0 flex-1 flex-col"
          >
            <header className="border-b px-2 py-1 text-xs">
              <span className="font-semibold">意图对话</span>
              <span className="ml-1 opacity-60">要改什么、为什么改</span>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {props.intentPanel ?? (
                <p className="p-3 text-xs leading-relaxed opacity-60">
                  在这里说清「改哪儿、为什么」。需要动代码时，Supervisor 会据此生成合同草案，
                  再走准入与隔离执行——不会直接改你正在看的代码。
                </p>
              )}
            </div>
          </section>
          {/* 文件树：可收拢，收起后仍显示根路径 */}
          <CollapsibleSection
            testId="explorer-section"
            title="文件树"
            open={explorerOpen}
            onToggle={() => setExplorerOpen((v) => !v)}
            summary={root}
            toggleLabel={{ open: "收起文件树", closed: "展开文件树" }}
            className="max-h-[45%] shrink-0 border-t"
          >
            <FileTree
              nodes={props.files}
              rootLabel={root}
              onOpen={(p) => openTab({ id: p, title: p.split("/").pop() ?? p })}
            />
            {props.leftExtra}
          </CollapsibleSection>
        </aside>
        <main
          data-testid="middle-column"
          className="flex min-w-0 flex-1 flex-col"
        >
          {props.middleBanner}
          {props.confirmSlot}
          <div role="tablist" className="flex gap-1 border-b px-2 text-sm">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.id === activeTab}
                data-system={t.system ? "true" : undefined}
                onClick={() => setActiveTab(t.id)}
              >
                {t.title}
              </button>
            ))}
            <button
              type="button"
              data-testid="toggle-split"
              className="ml-auto"
              onClick={() => {
                setSplit((s) => !s);
                openTab({
                  id: STUDIO_TAB_ID,
                  title: "Supervisor Studio",
                  system: true,
                });
                if (lastFile) setActiveTab(lastFile);
              }}
            >
              {split ? "取消分屏" : "分屏对照"}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {split ? (
              <SplitPaneContainer left={editorFor(lastFile)} right={studio} />
            ) : isStudio ? (
              <section
                data-testid="studio-dock"
                data-state={studioCollapsed ? "collapsed" : "expanded"}
                className="flex h-full min-h-0 flex-col"
              >
                <div className="flex items-center gap-2 border-b px-2 py-1 text-xs">
                  <span className="opacity-60">
                    Studio 审阅（只读；改范围请新建合同）
                  </span>
                  <button
                    type="button"
                    data-testid="toggle-studio-dock"
                    aria-expanded={!studioCollapsed}
                    onClick={() => setStudioCollapsed((v) => !v)}
                    className="ml-auto rounded border px-2 py-0.5 hover:bg-muted"
                  >
                    {studioCollapsed ? "展开 Studio" : "收拢 Studio"}
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {studioCollapsed ? (
                    <p className="p-3 text-xs opacity-60">
                      Studio 已收拢：代码区回到全宽。审批卡与门禁结果不会因此丢失，
                      需要时再拉开。
                    </p>
                  ) : (
                    studio
                  )}
                </div>
              </section>
            ) : (
              editorFor(activeTab)
            )}
          </div>
        </main>
        <aside
          data-testid="right-column"
          className="w-72 shrink-0 border-l p-3 text-xs"
        >
          {props.rightPanel ?? (
            <div
              data-testid="context-placeholder"
              className="space-y-2 leading-relaxed opacity-70"
            >
              <p className="font-semibold">任务与证据</p>
              <p>
                合同状态、验证结论与 STALE 提醒在这里汇总；详细审阅内容在 Studio。
              </p>
              <p className="opacity-70">需要和 Agent 说话？左栏意图对话。</p>
            </div>
          )}
        </aside>
      </div>
      {/* 底栏：抽屉式 SmartTerminal，默认收起，只有需要看退出码时才占高度 */}
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
              再翻 Studio 里的 Evidence。
            </p>
          )}
        </div>
      </CollapsibleSection>
      {props.footer}
    </div>
  );
}

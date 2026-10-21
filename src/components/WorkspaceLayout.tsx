import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { FileTree } from "./FileTree";
import { SplitPaneContainer } from "./SplitPaneContainer";
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
  rightPanel?: ReactNode;
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
 * TASK-C.1 三栏工作台：左文件树 / 中多标签+分屏 / 右 Coding Agent 对话（占位，C.6 实装）。
 * 合同批准后默认绑定 Worktree（G-18）；切回主工作树时显式提示并显示执行状态。
 * 成熟度徽章、风险气泡按 D4 推迟 v0.2+，此处不实现。
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
          className="flex w-72 shrink-0 flex-col overflow-auto border-r"
        >
          {bound && !onMainTree && (
            <button
              type="button"
              data-testid="switch-main-tree"
              className="m-2 text-xs underline"
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
          <FileTree
            nodes={props.files}
            rootLabel={root}
            onOpen={(p) => openTab({ id: p, title: p.split("/").pop() ?? p })}
          />
          {props.leftExtra}
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
              studio
            ) : (
              editorFor(activeTab)
            )}
          </div>
        </main>
        <aside data-testid="right-column" className="w-80 border-l p-3 text-sm">
          {props.rightPanel ?? "Coding Agent 对话（TASK-C.6 实装）"}
        </aside>
      </div>
      {props.footer}
    </div>
  );
}

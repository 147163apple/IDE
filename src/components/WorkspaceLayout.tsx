import { useState } from "react";
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
  contract?: ActiveContract | null | undefined;
  files: FileNode[];
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

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [split, setSplit] = useState(false);

  const openTab = (tab: Tab) => {
    setTabs((t) => (t.some((x) => x.id === tab.id) ? t : [...t, tab]));
    setActiveTab(tab.id);
  };
  const openStudio = () =>
    openTab({ id: STUDIO_TAB_ID, title: "Supervisor Studio", system: true });

  const studio = (
    <div data-testid="studio-pane" className="p-3 text-sm">
      Supervisor Studio（合同审阅区，TASK-C.2 实装）
    </div>
  );
  const editorFor = (id: string | null) =>
    id && id !== STUDIO_TAB_ID ? (
      <div data-testid="editor-placeholder" className="p-3 text-sm">
        {id}（代码编辑器占位，TASK-C.3 接入 Monaco）
      </div>
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
        onOpenStudio={openStudio}
      />
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
        <aside data-testid="left-column" className="w-60 border-r">
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
        </aside>
        <main
          data-testid="middle-column"
          className="flex min-w-0 flex-1 flex-col"
        >
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
          <div className="min-h-0 flex-1">
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
          Coding Agent 对话（TASK-C.6 实装）
        </aside>
      </div>
    </div>
  );
}

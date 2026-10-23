import { useState } from "react";
import { FolderOpen } from "lucide-react";

/**
 * 「打开 / 导入项目」入口（TASK-D.1b 如实版）。
 *
 * Daemon 在启动时绑定单一 `repoRoot`，控制面没有切换仓库的接口。
 * 换项目请在终端执行 `stagent open <路径>`：一条命令启动/复用 Daemon，
 * 并自动打开已带上 Token 的单窗口工作台（无需手拷 Token、无需第二终端）。
 */
export interface OpenProjectEntryProps {
  repoPath: string;
  repoName: string;
}

export function OpenProjectEntry({
  repoPath,
  repoName,
}: OpenProjectEntryProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const command = `npx stagent open <新项目路径>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="border-b px-2 py-2 text-xs">
      <button
        type="button"
        data-testid="open-project"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded border border-border px-2 py-1 text-left hover:bg-accent"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="truncate">打开项目</span>
        <span className="ml-auto truncate opacity-60">{repoName}</span>
      </button>

      {open ? (
        <div
          data-testid="open-project-panel"
          className="mt-1 space-y-1.5 rounded border border-dashed p-2 leading-relaxed"
        >
          <p className="opacity-80">
            当前 Daemon 已绑定：
            <code className="ml-1 break-all rounded bg-muted px-1">
              {repoPath}
            </code>
          </p>
          <p className="opacity-70">
            应用内暂不能切换项目。换一个文件夹请在终端执行（一条命令、单窗口即可聊）：
          </p>
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-1 py-0.5">
              {command}
            </code>
            <button
              type="button"
              data-testid="copy-open-project-command"
              onClick={() => void copy()}
              className="shrink-0 rounded border px-1.5 py-0.5 hover:bg-accent"
            >
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

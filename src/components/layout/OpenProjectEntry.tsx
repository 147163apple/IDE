import { useState } from "react";
import { FolderOpen } from "lucide-react";

/**
 * 「打开 / 导入项目」入口（如实版）。
 *
 * 现状核查：Daemon 在启动时绑定单一 `repoRoot`（`bin/stagent.ts` 的 `--repo`），
 * 控制面**没有**切换仓库的接口（`daemon/server.ts` 里 repoRoot 只读）。
 * 因此这里不做假文件选择器，而是把真实机制摆出来：
 * - 展示当前已绑定仓库；
 * - 给出切换到另一个项目需要执行的确切命令（可一键复制）。
 *
 * 这样用户点开能立刻知道"为什么不能直接选文件夹"以及"下一步该做什么"，
 * 而不是点一个毫无反应的按钮。
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
  const command = `npx stagent start --repo <新项目路径>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 无剪贴板权限时不假装成功
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
            暂不支持在应用内切换项目：控制面没有换仓库接口，Daemon
            的仓库根在启动时固定。 换项目请用新路径重启 Daemon：
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

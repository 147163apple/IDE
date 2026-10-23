import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import {
  fetchRecentProjects,
  loadConnection,
  openRecentProject,
  type RecentProjectItem,
} from "../../lib/daemon-api";

/**
 * 「打开项目」入口（TASK-D.1c）：展示本机最近工作区，一点带钥匙重开。
 *
 * 不含任意路径文件夹选择器；新路径首次仍用 `stagent open <路径>`。
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
  const [items, setItems] = useState<RecentProjectItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const command = `npx stagent open <新项目路径>`;

  const loadRecent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const conn = loadConnection();
      if (!conn.token) {
        setItems([]);
        setError(
          "还没连上工作台。请用带钥匙的地址打开，或终端执行 stagent open。",
        );
        return;
      }
      const list = await fetchRecentProjects(conn);
      setItems(list);
    } catch (err) {
      setItems([]);
      setError((err as Error).message || "读最近项目失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadRecent();
    }
  }, [open, loadRecent]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const reopen = async (targetPath: string) => {
    setOpeningPath(targetPath);
    setError(null);
    try {
      const conn = loadConnection();
      const result = await openRecentProject(conn, targetPath);
      // 同源或跨端口：整页跳到带 #token= 的地址，由 loadConnection 注入会话
      window.location.assign(result.launchUrl);
    } catch (err) {
      setError((err as Error).message || "重开失败");
      setOpeningPath(null);
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
            当前：
            <code className="ml-1 break-all rounded bg-muted px-1">
              {repoPath}
            </code>
          </p>

          <div data-testid="recent-projects">
            <p className="mb-1 font-medium opacity-90">最近项目</p>
            {loading ? (
              <p className="opacity-60" data-testid="recent-projects-loading">
                加载中…
              </p>
            ) : null}
            {!loading && items && items.length === 0 ? (
              <p className="opacity-70" data-testid="recent-projects-empty">
                还没有最近项目。先在终端执行{" "}
                <code className="rounded bg-muted px-1">
                  npx stagent open &lt;路径&gt;
                </code>{" "}
                ，成功打开后会出现在这里。
              </p>
            ) : null}
            {!loading && items && items.length > 0 ? (
              <ul className="space-y-1" data-testid="recent-projects-list">
                {items.map((item) => {
                  const isCurrent = item.path === repoPath;
                  const busy = openingPath === item.path;
                  return (
                    <li key={item.path}>
                      <button
                        type="button"
                        data-testid="recent-project-item"
                        data-path={item.path}
                        data-current={isCurrent ? "true" : "false"}
                        disabled={busy || openingPath !== null}
                        onClick={() => void reopen(item.path)}
                        className="flex w-full flex-col rounded border border-border px-2 py-1 text-left hover:bg-accent disabled:opacity-50"
                      >
                        <span className="truncate font-medium">
                          {item.name}
                          {isCurrent ? (
                            <span className="ml-1 opacity-50">（当前）</span>
                          ) : null}
                        </span>
                        <span className="truncate opacity-60">{item.path}</span>
                        <span className="opacity-50">
                          {busy ? "正在打开…" : "一点重开（自动带钥匙）"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {error ? (
            <p
              role="alert"
              data-testid="recent-projects-error"
              className="text-destructive"
            >
              {error}
            </p>
          ) : null}

          <p className="opacity-70">新文件夹（不在最近列表）请在终端执行：</p>
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
          {/* 明确不含任意路径选择器：无 file input / webkitdirectory */}
        </div>
      ) : null}
    </div>
  );
}

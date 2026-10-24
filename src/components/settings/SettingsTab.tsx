import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronDown,
  KeyRound,
  Plug,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { DaemonConnection } from "@/lib/daemon-api";
import { normalizeSessionToken } from "@/lib/daemon-api";
import type { RunMode, WorkerControl } from "@/components/workspace-types";
import {
  SETTINGS_MODEL_KEY_TEST_ID,
  type SettingsDeepFocus,
} from "@/lib/middle-yield";

/**
 * 设置页（中央 Tab）。
 *
 * C.10b：主视线是「模型钥匙」；Daemon / Session Token / 运行诊断 / 工作区
 * 收进默认折叠的「高级」。C.9d 深链到钥匙区与「配完了，返回对话」保留。
 * 不改鉴权语义，也不取消 token 能力——只调文案层级。
 */
export interface SettingsTabProps {
  conn: DaemonConnection;
  onConnChange: (next: DaemonConnection) => void;
  connected: boolean;
  daemonPort: number | null;
  repoPath: string;
  baseBranch: string;
  runMode: RunMode;
  protectedCount: number;
  workerControl: WorkerControl;
  streamStatus: "closed" | "connecting" | "connected" | "reconnecting";
  /** 已绑定合同的 Worktree 绝对路径（诊断用，顶栏不再展示） */
  worktreePath?: string | null;
  executionStatus?: string | null;
  /** 模型 Key 面板（页面注入，避免这里反向依赖页面状态） */
  modelKeySlot?: ReactNode;
  /** 本轮快照是否存在（存在才给「撤销本轮」） */
  checkpoint?: string | null;
  onUndoRound?: (() => void) | undefined;
  undoBusy?: boolean;
  onRefresh?: (() => void) | undefined;
  /** C.9d：从 Key 向导深链到模型钥匙区 */
  focusSection?: SettingsDeepFocus | null | undefined;
  /** C.9d：配完钥匙一键回跳右栏主路径 */
  onReturnToChat?: (() => void) | undefined;
}

function Section({
  title,
  icon,
  testId,
  children,
}: {
  title: string;
  icon: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-lg border border-border bg-card p-3"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      <div className="space-y-2 text-xs leading-relaxed">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-2">
      <span className="opacity-60">{label}</span>
      <span className="min-w-0 break-all">{children}</span>
    </div>
  );
}

export function SettingsTab({
  conn,
  onConnChange,
  connected,
  daemonPort,
  repoPath,
  baseBranch,
  runMode,
  protectedCount,
  workerControl,
  streamStatus,
  worktreePath = null,
  executionStatus = null,
  modelKeySlot,
  checkpoint = null,
  onUndoRound,
  undoBusy = false,
  onRefresh,
  focusSection = null,
  onReturnToChat,
}: SettingsTabProps) {
  const [draft, setDraft] = useState(conn);
  // 外部连接被换掉（例如 Token 从 URL fragment 注入）时同步草稿
  useEffect(() => setDraft(conn), [conn]);

  useEffect(() => {
    if (focusSection !== "model-key") return;
    const el = document.querySelector(
      `[data-testid="${SETTINGS_MODEL_KEY_TEST_ID}"]`,
    );
    if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
      (el as HTMLElement).scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [focusSection]);

  const enforced = workerControl === "GATEWAY_ENFORCED";
  const dirty = draft.baseUrl !== conn.baseUrl || draft.token !== conn.token;
  /**
   * 粘贴 Token 时混进中文/全角符号，会让 fetch 在入口抛
   * `String contains non ISO-8859-1 code point`——请求根本发不出去，
   * 而错误里看不出是 Token 脏了。这里提前在输入框下面把人话讲清楚。
   */
  const tokenHasNonAscii = /[^\x20-\x7E]/.test(
    normalizeSessionToken(draft.token),
  );

  return (
    <div
      data-testid="settings-tab"
      className="mx-auto max-w-3xl space-y-3 p-4 text-sm"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">设置</h2>
        <p className="text-xs opacity-70">
          先配好模型钥匙，就能继续对话。后台连接等工程师项在下方「高级」。
        </p>
        {onReturnToChat ? (
          <button
            type="button"
            data-testid="settings-return-to-chat"
            onClick={onReturnToChat}
            className="mt-1 rounded border border-border bg-background px-2 py-1 text-xs hover:bg-accent"
          >
            配完了，返回对话
          </button>
        ) : null}
      </header>

      {/* C.10b：主视线 —— 模型钥匙置顶 */}
      <Section
        title="模型钥匙"
        icon={<KeyRound className="h-4 w-4" />}
        testId="settings-model-key"
      >
        {modelKeySlot ?? (
          <p className="opacity-60">当前页面没有注入模型钥匙面板。</p>
        )}
      </Section>

      {/* C.10b：工程师项默认折叠 */}
      <details
        data-testid="settings-advanced"
        className="rounded-lg border border-border bg-card open:bg-card"
      >
        <summary
          data-testid="settings-advanced-summary"
          className="flex cursor-pointer list-none items-center gap-1.5 p-3 text-sm font-semibold [&::-webkit-details-marker]:hidden"
        >
          <ChevronDown className="h-4 w-4 opacity-60 [[open]_&]:rotate-180" />
          高级
          <span className="ml-1 text-xs font-normal opacity-60">
            后台连接 · 诊断 · 工作区
          </span>
        </summary>
        <div className="space-y-3 border-t border-border p-3 pt-3">
          <Section
            title="后台连接"
            icon={<Plug className="h-4 w-4" />}
            testId="settings-connection"
          >
            <Row label="地址">
              <input
                data-testid="daemon-url"
                value={draft.baseUrl}
                onChange={(e) =>
                  setDraft({ ...draft, baseUrl: e.target.value })
                }
                className="w-full rounded border border-border bg-background px-2 py-1 outline-none"
              />
            </Row>
            <Row label="会话凭证">
              <input
                data-testid="session-token"
                type="password"
                value={draft.token}
                // 边输边归一：换行/全角空格/零宽字符/多余的 "Bearer " 前缀立刻消失，
                // 输入框里显示什么，发出去的就是什么
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    token: normalizeSessionToken(e.target.value),
                  })
                }
                placeholder=".stagent/session-token"
                className="w-full rounded border border-border bg-background px-2 py-1 outline-none"
              />
              {tokenHasNonAscii ? (
                <span
                  data-testid="token-non-ascii-warning"
                  role="alert"
                  className="mt-1 block text-[11px] text-destructive"
                >
                  这一段里有中文或全角符号，浏览器不允许写进请求头（会直接报 non
                  ISO-8859-1）。请重新复制 .stagent/session-token
                  的内容——只要那一串十六进制，不要带注释、说明或换行。
                </span>
              ) : null}
            </Row>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="apply-connection"
                disabled={!dirty}
                onClick={() => onConnChange(draft)}
                className="rounded border border-border px-2 py-1 hover:bg-accent disabled:opacity-50"
              >
                应用
              </button>
              <span className="opacity-60">
                会话凭证也可通过启动地址注入，页面读完即从地址栏抹除。
              </span>
            </div>
          </Section>

          <Section
            title="运行诊断"
            icon={<Activity className="h-4 w-4" />}
            testId="settings-diagnostics"
          >
            <Row label="后台">
              <span
                data-testid="daemon-connection-state"
                className={connected ? "text-emerald-600" : "text-destructive"}
              >
                {connected
                  ? `已连接${daemonPort ? ` · 端口 ${daemonPort}` : ""}`
                  : "未连接"}
              </span>
            </Row>
            <Row label="实时流">
              <span
                data-testid="stream-status"
                className={
                  streamStatus === "connected"
                    ? "text-emerald-600"
                    : streamStatus === "closed"
                      ? "opacity-60"
                      : "text-amber-600"
                }
              >
                {streamStatus === "connected"
                  ? "已通"
                  : streamStatus === "connecting"
                    ? "连接中"
                    : streamStatus === "reconnecting"
                      ? "重连中"
                      : "未开"}
              </span>
            </Row>
            <Row label="网关受控">
              {/*
                P.1 顺手修：断线时不再假装受控 —— 徽章变暗并写明"未知"。
                这块原本在顶栏，现在收进设置；状态读数与断线语义完全一致。
                C.10b：仍保留 GATEWAY_ENFORCED 字样供诊断，但段落在「高级」内。
              */}
              <span
                data-testid="worker-control"
                data-control={connected ? workerControl : "OFFLINE"}
                className={
                  !connected
                    ? "rounded bg-muted px-2 text-muted-foreground opacity-60"
                    : enforced
                      ? "rounded bg-green-100 px-2 text-green-800"
                      : "rounded bg-yellow-100 px-2 text-yellow-800"
                }
              >
                {!connected
                  ? "未连上后台 · 受控状态未知"
                  : enforced
                    ? "GATEWAY_ENFORCED 受控"
                    : "UNCONTROLLED_EXTERNAL 非受控"}
              </span>
            </Row>
            {onRefresh ? (
              <button
                type="button"
                data-testid="refresh-state"
                onClick={onRefresh}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-accent"
              >
                <RefreshCw className="h-3 w-3" /> 重新拉取状态
              </button>
            ) : null}
          </Section>

          <Section
            title="工作区"
            icon={<ShieldCheck className="h-4 w-4" />}
            testId="settings-workspace"
          >
            <Row label="仓库路径">
              <code>{repoPath}</code>
            </Row>
            <Row label="主分支">
              <code>{baseBranch}</code>
            </Row>
            <Row label="模式">
              <span data-testid="settings-run-mode" data-mode={runMode}>
                {runMode === "PROTECTED"
                  ? `🔒 保护模式 · 已锁 ${protectedCount} 处`
                  : "🔓 自由模式 VIBE"}
              </span>
            </Row>
            {worktreePath ? (
              <Row label="Worktree">
                <span data-testid="contract-info">
                  <code>{worktreePath}</code>
                  {executionStatus ? ` · ${executionStatus}` : ""}
                </span>
              </Row>
            ) : (
              <Row label="Worktree">
                <span className="opacity-60">
                  当前没有已批准合同绑定的 Worktree
                </span>
              </Row>
            )}
            {checkpoint && onUndoRound ? (
              <button
                type="button"
                data-testid="undo-round"
                disabled={undoBusy}
                onClick={onUndoRound}
                className="flex items-center gap-1 rounded border border-amber-500/50 px-2 py-1 text-amber-700 hover:bg-amber-500/10 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" /> 撤销本轮改动
              </button>
            ) : null}
          </Section>
        </div>
      </details>

      <p className="flex items-center gap-1 px-1 text-[11px] opacity-50">
        <Radio className="h-3 w-3" />
        这一页只有上面这些真实开关；没有"自动优化""智能评分"之类不存在的选项。
      </p>
    </div>
  );
}

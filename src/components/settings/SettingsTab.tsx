import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
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

/**
 * 设置页（中央 Tab）。
 *
 * 为什么要有这一页：顶栏原来堆了连接地址、Session Token、实时流、网关受控、
 * 模型 Key、刷新、新建合同……看起来像运维调试后台，而且 Token 明文输入框
 * 常驻在视野里。现在这些**控制项**全部下沉到这里，顶栏只留状态胶囊。
 *
 * 分成五段，都是真实存在的开关/读数，没有"点一下没反应"的假设置项。
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
}: SettingsTabProps) {
  const [draft, setDraft] = useState(conn);
  // 外部连接被换掉（例如 Token 从 URL fragment 注入）时同步草稿
  useEffect(() => setDraft(conn), [conn]);

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
          连接、诊断与开关都在这里；顶栏只保留项目名、分支与模式。
        </p>
      </header>

      <Section
        title="Daemon 连接"
        icon={<Plug className="h-4 w-4" />}
        testId="settings-connection"
      >
        <Row label="地址">
          <input
            data-testid="daemon-url"
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            className="w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </Row>
        <Row label="Session Token">
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
            Token 也可通过启动 URL 的 #fragment 注入，页面读完即从地址栏抹除。
          </span>
        </div>
      </Section>

      <Section
        title="运行诊断"
        icon={<Activity className="h-4 w-4" />}
        testId="settings-diagnostics"
      >
        <Row label="Daemon">
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

      <Section
        title="模型 Key"
        icon={<KeyRound className="h-4 w-4" />}
        testId="settings-model-key"
      >
        {modelKeySlot ?? (
          <p className="opacity-60">当前页面没有注入模型 Key 面板。</p>
        )}
      </Section>

      <p className="flex items-center gap-1 px-1 text-[11px] opacity-50">
        <Radio className="h-3 w-3" />
        这一页只有上面这些真实开关；没有"自动优化""智能评分"之类不存在的选项。
      </p>
    </div>
  );
}

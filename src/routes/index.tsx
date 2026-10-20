import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  GitCompare,
  Loader2,
  Play,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "@/lib/contract.schema";
import type { EvidenceBundle } from "@/lib/evidence.schema";
import {
  abortContract,
  applyProtectionRecommendations,
  createChatSession,
  decideProtectionCard,
  fetchProtection,
  fetchProtectionRecommendations,
  getChatSession,
  interruptChat,
  listChatAdapters,
  listChatSessions,
  sendChatMessage,
  readWorktreeFile,
  saveWorktreeFile,
  approveContract,
  createContract,
  executeContract,
  fetchArchGraph,
  fetchDiff,
  fetchEvidence,
  fetchHealth,
  fetchSettings,
  listContracts,
  loadConnection,
  mergeContract,
  resumeContract,
  runWorker,
  saveConnection,
  saveOpenAiKey,
  undoProtectionRound,
  type ArchGraphPayload,
  type DaemonConnection,
  type ModelSettings,
  type ProtectionRecommendationView,
  type ProtectionStateView,
  type WorkerRunResult,
} from "@/lib/daemon-api";
import { ContractCard } from "@/components/contract/ContractCard";
import { ScopeList } from "@/components/contract/ScopeList";
import { BudgetVisualizer } from "@/components/contract/BudgetVisualizer";
import { RadarGraph } from "@/components/radar/RadarGraph";
import { FilterToolbar } from "@/components/radar/FilterToolbar";
import { ScopeSelector } from "@/components/radar/ScopeSelector";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { EditorOpener } from "@/components/editor/EditorOpener";
import { EvidenceChecklist } from "@/components/evidence/EvidenceChecklist";
import { useDaemonStream } from "@/hooks/use-daemon-stream";
import { WorkspaceLayout } from "@/components/WorkspaceLayout";
import { AgentChatPane } from "@/components/AgentChatPane";
import { MonacoEditorPane } from "@/components/MonacoEditorPane";
import {
  ProtectionApprovalCard,
  ProtectionRecommendationCard,
} from "@/components/ProtectionCard";
import type { WorktreeFileIO } from "@/hooks/useWorktreeFile";
import type { AgentSessionTransport } from "@/hooks/use-agent-session";
import type { ChatEvent } from "@/lib/chat-events";
import {
  APPROVED_STATES,
  buildFileTree,
  toExecutionStatus,
} from "@/components/workspace-adapters";
import type { ActiveContract } from "@/components/workspace-types";
import type {
  ContractUpdatePayload,
  EvidenceReadyPayload,
} from "@/lib/ipc/frames";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stagent — 工作台" },
      {
        name: "description",
        content:
          "Stagent 本地任务副驾：架构雷达、合同审批、受限执行与 Evidence 验收。",
      },
    ],
  }),
  component: Console,
});

function Console() {
  const [conn, setConn] = useState<DaemonConnection>(() => loadConnection());
  const [connected, setConnected] = useState(false);
  const [daemonPort, setDaemonPort] = useState<number | null>(null);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [contracts, setContracts] = useState<SoftwareContract[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceBundle | null>(null);
  const [workerResult, setWorkerResult] = useState<WorkerRunResult | null>(
    null,
  );
  const [showForm, setShowForm] = useState(false);
  const [scopeDraft, setScopeDraft] = useState<string[]>([]);

  const [graph, setGraph] = useState<ArchGraphPayload | null>(null);
  const [query, setQuery] = useState("");
  const [showCycles, setShowCycles] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);

  const [diff, setDiff] = useState<{ patch: string; stat: string } | null>(
    null,
  );
  const [mergeInfo, setMergeInfo] = useState<string | null>(null);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [currentBranch, setCurrentBranch] = useState("main");
  const [protection, setProtection] = useState<ProtectionStateView | null>(
    null,
  );
  const [recommendations, setRecommendations] = useState<
    ProtectionRecommendationView[]
  >([]);
  const [protectionBusy, setProtectionBusy] = useState(false);
  const [undoInfo, setUndoInfo] = useState<string | null>(null);
  const [recDismissed, setRecDismissed] = useState(false);

  const fileTree = useMemo(
    () =>
      buildFileTree(
        (graph?.graph.nodes.map((n) => n.filePath) ?? []).map((p) =>
          // 架构图给的是绝对路径；文件树与编辑器统一用仓库相对路径
          repoRoot && p.startsWith(repoRoot + "/")
            ? p.slice(repoRoot.length + 1)
            : p,
        ),
      ),
    [graph, repoRoot],
  );

  const selected = useMemo(
    () => contracts.find((c) => c.contract_id === selectedId) ?? null,
    [contracts, selectedId],
  );

  const matches = useMemo(() => {
    if (!graph || !query.trim()) return 0;
    const needle = query.toLowerCase();
    return graph.graph.nodes.filter((n) =>
      n.filePath.toLowerCase().includes(needle),
    ).length;
  }, [graph, query]);

  const focusPath = useMemo(() => {
    if (!graph || !query.trim()) return undefined;
    const needle = query.toLowerCase();
    return graph.graph.nodes.find((n) =>
      n.filePath.toLowerCase().includes(needle),
    )?.filePath;
  }, [graph, query]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const health = await fetchHealth(conn);
      setConnected(health.status === "ok");
      setDaemonPort(health.port);
      setRepoRoot(health.repoRoot);
      setCurrentBranch(health.currentBranch || "main");
      setContracts(await listContracts(conn));
      // P.1：保护清单/本轮授权/快照状态（轮询兜底；卡片靠它出现）
      try {
        const p = await fetchProtection(conn);
        setProtection(p);
        if (p.entries.length === 0 && !p.corrupt) {
          setRecommendations(await fetchProtectionRecommendations(conn));
        } else {
          setRecommendations([]);
        }
      } catch {
        // 保护接口异常不阻断主流程；门卫在后台仍按失败关闭运行
      }
    } catch (err) {
      setConnected(false);
      setDaemonPort(null);
      setError((err as Error).message);
    }
  }, [conn]);

  // P.1：推荐卡「以后再说」按仓库记住，不反复打扰
  useEffect(() => {
    if (!repoRoot) return;
    try {
      setRecDismissed(
        localStorage.getItem(`stagent.protectionRecDismissed:${repoRoot}`) ===
          "1",
      );
    } catch {
      setRecDismissed(false);
    }
  }, [repoRoot]);

  const dismissRecommendations = useCallback(() => {
    setRecDismissed(true);
    try {
      if (repoRoot)
        localStorage.setItem(`stagent.protectionRecDismissed:${repoRoot}`, "1");
    } catch {
      // 隐私模式下写不了，只影响本次会话
    }
  }, [repoRoot]);

  const onDecideProtection = useCallback(
    async (cardId: string, decision: "approve" | "deny") => {
      setProtectionBusy(true);
      try {
        await decideProtectionCard(conn, cardId, decision);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setProtectionBusy(false);
      }
    },
    [conn, refresh],
  );

  const onApplyRecommendations = useCallback(
    async (names: string[]) => {
      setProtectionBusy(true);
      try {
        await applyProtectionRecommendations(conn, names);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setProtectionBusy(false);
      }
    },
    [conn, refresh],
  );

  const onUndoRound = useCallback(async () => {
    // 白话确认：必须写明「这期间你手动改的也会一起撤销」（P1 卡核心目标 9）
    const ok = window.confirm(
      "回到这轮开始前的样子？这轮改过的文件会恢复；这期间你自己手动改的部分也会一起撤销。（只撤 AI、保留手改的能力以后再做）",
    );
    if (!ok) return;
    setProtectionBusy(true);
    try {
      const result = await undoProtectionRound(conn);
      setUndoInfo(
        result.undone
          ? `已回到本轮开始前${result.deletedFiles?.length ? `，并删除本轮新建的 ${result.deletedFiles.length} 个文件` : ""}。`
          : (result.reason ?? "没有可撤销的一轮改动"),
      );
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProtectionBusy(false);
    }
  }, [conn, refresh]);

  // 右栏会话：CHAT_EVENT 经同一条 WS 推送，这里做一个简单的订阅分发
  const chatListeners = useRef(new Set<(e: ChatEvent) => void>());
  const chatTransport = useMemo<AgentSessionTransport | null>(
    () =>
      connected
        ? {
            listAdapters: () => listChatAdapters(conn),
            listSessions: () => listChatSessions(conn),
            createSession: (a) => createChatSession(conn, a),
            getSession: (id) => getChatSession(conn, id),
            send: (id, text) => sendChatMessage(conn, id, text),
            interrupt: (id) => interruptChat(conn, id),
            subscribe: (listener) => {
              chatListeners.current.add(listener);
              return () => chatListeners.current.delete(listener);
            },
          }
        : null,
    [connected, conn],
  );

  // C.3：Agent 改完文件 → 中栏自动打开并刷新（Sprint 1 门禁「中栏实时可见」）
  const [openRequest, setOpenRequest] = useState<{
    path: string;
    nonce: number;
  } | null>(null);
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const pendingEdits = useRef(new Map<string, string>());
  const [staleContracts, setStaleContracts] = useState<Set<string>>(new Set());
  const toRepoRelative = useCallback(
    (p: string) => {
      if (repoRoot && p.startsWith(repoRoot + "/"))
        return p.slice(repoRoot.length + 1);
      const wt = p.match(/\/\.stagent\/worktrees\/task-[^/]+\/(.+)$/);
      return wt?.[1] ?? p.replace(/^\.\//, "");
    },
    [repoRoot],
  );
  const onAgentFileEvent = useCallback(
    (e: ChatEvent) => {
      if (e.kind === "tool_call" && /^(Edit|Write|MultiEdit)$/.test(e.name)) {
        const fp = (e.input as { file_path?: unknown } | null)?.file_path;
        if (typeof fp === "string") pendingEdits.current.set(e.tool_id, fp);
      }
      if (e.kind === "tool_result") {
        const fp = pendingEdits.current.get(e.tool_id);
        pendingEdits.current.delete(e.tool_id);
        if (!fp || e.is_error) return;
        const rel = toRepoRelative(fp);
        setReloadKeys((k) => ({ ...k, [rel]: (k[rel] ?? 0) + 1 }));
        setOpenRequest({ path: rel, nonce: Date.now() });
      }
    },
    [toRepoRelative],
  );

  // 编辑器 IO 必须稳定（否则每次渲染都会重新读文件）
  const fileIoFor = useMemo(() => {
    const cache = new Map<string, WorktreeFileIO>();
    return (contractId: string | null): WorktreeFileIO | null => {
      if (!connected) return null;
      const key = contractId ?? "";
      let io = cache.get(key);
      if (!io) {
        io = {
          read: (fp) => readWorktreeFile(conn, fp, contractId),
          save: (fp, content) =>
            saveWorktreeFile(conn, fp, content, contractId),
        };
        cache.set(key, io);
      }
      return io;
    };
  }, [connected, conn]);

  // 实时流（WebSocket）：状态/日志/告警由 Daemon 推送，轮询退化为兜底
  const stream = useDaemonStream({
    port: daemonPort,
    token: conn.token,
    enabled: connected,
    onContractUpdate: (_p: ContractUpdatePayload) => {
      void refresh();
    },
    onChatEvent: (e: ChatEvent) => {
      onAgentFileEvent(e);
      for (const l of chatListeners.current) l(e);
    },
    onEvidenceStatus: (p) => {
      setStaleContracts((prev) => {
        const next = new Set(prev);
        if (p.status === "STALE") next.add(p.contract_id);
        else next.delete(p.contract_id);
        return next;
      });
    },
    onEvidenceReady: (p: EvidenceReadyPayload) => {
      if (p.contract_id !== selectedId) return;
      void fetchEvidence(conn, p.contract_id, p.evidence_id)
        .then(setEvidence)
        .catch(() => {
          // 证据拉取失败不阻断：用户仍可手动执行验证
        });
    },
  });

  const selectedLogs = useMemo(
    () => stream.logs.filter((l) => l.contractId === selectedId),
    [stream.logs, selectedId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // WebSocket 已连接时轮询只是兜底，降到 60s；未连接时 15s 保持可用
  useEffect(() => {
    const interval = stream.status === "connected" ? 60_000 : 15_000;
    const timer = setInterval(() => void refresh(), interval);
    return () => clearInterval(timer);
  }, [refresh, stream.status]);

  // P.1：待审批卡要“立刻”出现（AI 被拦在原地），保护状态单独 3s 轮询
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          setProtection(await fetchProtection(conn));
        } catch {
          // 单次取不到不影响；下一轮再试，门卫仍在后台拦截
        }
      })();
    }, 3_000);
    return () => clearInterval(timer);
  }, [connected, conn]);

  // 选中已验收合同时自动恢复 Evidence：否则刷新页面后结论与「核销」按钮都消失
  useEffect(() => {
    if (!selectedId || selected?.lifecycle_state !== "AUDITED") return;
    let cancelled = false;
    void fetchEvidence(conn, selectedId)
      .then((restored) => {
        if (!cancelled) setEvidence(restored);
      })
      .catch(() => {
        // 无落盘证据时保持空态，用户仍可重新执行验证
      });
    return () => {
      cancelled = true;
    };
  }, [conn, selectedId, selected?.lifecycle_state]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchArchGraph(conn);
        if (!cancelled) setGraph(payload);
      } catch {
        // 架构图失败不阻断主流程
      }
      try {
        const modelSettings = await fetchSettings(conn);
        if (!cancelled) setSettings(modelSettings);
      } catch {
        // 设置读取失败不阻断主流程
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, conn]);

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const repoName = repoRoot
    ? (repoRoot.split("/").filter(Boolean).pop() ?? "stagent")
    : "stagent";
  const workspaceContract: ActiveContract | null = selected
    ? {
        contractId: selected.contract_id,
        worktreePath: `${repoRoot ?? "."}/.stagent/worktrees/task-${selected.contract_id}`,
        approved: APPROVED_STATES.has(selected.lifecycle_state),
        status: toExecutionStatus(selected.lifecycle_state),
      }
    : null;

  return (
    <div className="flex h-screen flex-col bg-background font-mono text-sm text-foreground">
      <WorkspaceLayout
        repoName={repoName}
        repoPath={repoRoot ?? "（连接 Daemon 后显示仓库路径）"}
        baseBranch={currentBranch}
        runMode={
          protection && protection.mode !== "VIBE" ? "PROTECTED" : "VIBE"
        }
        workerControl={selected?.worker_spec.control_mode ?? "GATEWAY_ENFORCED"}
        daemonConnected={connected}
        contract={workspaceContract}
        files={fileTree}
        defaultOpenStudio
        rightPanel={<AgentChatPane transport={chatTransport} />}
        openRequest={openRequest}
        renderFile={(filePath, bound) => {
          const contractId = bound
            ? (workspaceContract?.contractId ?? null)
            : null;
          const io = fileIoFor(contractId);
          return (
            <MonacoEditorPane
              key={`${contractId ?? "main"}:${filePath}`}
              path={filePath}
              io={io}
              reloadKey={reloadKeys[filePath] ?? 0}
            />
          );
        }}
        middleBanner={
          selected && staleContracts.has(selected.contract_id) ? (
            <div
              data-testid="evidence-stale-banner"
              role="alert"
              className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-800"
            >
              ⚠
              代码在验证之后被改动过，之前的验收证据已失效（STALE），请重新「执行验证」后再合并。
            </div>
          ) : null
        }
        headerExtra={
          <>
            {protection?.checkpoint && (
              <button
                type="button"
                data-testid="undo-round"
                disabled={protectionBusy}
                onClick={() => void onUndoRound()}
                className="ml-2 flex items-center gap-1 rounded border border-amber-500/50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-500/10 disabled:opacity-50"
              >
                ↶ 撤销本轮改动
              </button>
            )}
            <span
              className={`ml-2 flex items-center gap-1 text-xs ${connected ? "text-emerald-500" : "text-destructive"}`}
            >
              <Activity className="h-3 w-3" />
              {connected ? "Daemon 已连接" : "未连接"}
            </span>
            <span
              data-testid="stream-status"
              className={`flex items-center gap-1 text-xs ${
                stream.status === "connected"
                  ? "text-emerald-500"
                  : stream.status === "closed"
                    ? "text-muted-foreground"
                    : "text-amber-500"
              }`}
            >
              <Radio className="h-3 w-3" />
              {stream.status === "connected"
                ? "实时流已通"
                : stream.status === "connecting"
                  ? "实时流连接中"
                  : stream.status === "reconnecting"
                    ? "实时流重连中"
                    : "实时流未开"}
            </span>
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${settings?.configured ? "bg-emerald-500" : "bg-amber-500"}`}
              />
              模型 Key
            </button>
            <button
              onClick={() => void refresh()}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" /> 刷新
            </button>
            <button
              onClick={() => {
                setScopeDraft(selectedPaths);
                setShowForm((v) => !v);
              }}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> 新建合同
            </button>
          </>
        }
        banner={
          <>
            {protection?.corrupt && (
              <div
                data-testid="protection-corrupt-banner"
                role="alert"
                className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
              >
                保护清单损坏，AI 所有改动暂时被拦。请修复或删除{" "}
                <code>.stagent/protection.json</code> 后刷新页面（原因：
                {protection.corrupt}）
              </div>
            )}
            {protection?.round.pending[0] && (
              <ProtectionApprovalCard
                card={protection.round.pending[0]}
                busy={protectionBusy}
                onDecide={(id, d) => void onDecideProtection(id, d)}
              />
            )}
            {!recDismissed &&
              recommendations.length > 0 &&
              (protection?.entries.length ?? 0) === 0 && (
                <ProtectionRecommendationCard
                  recommendations={recommendations}
                  busy={protectionBusy}
                  onApply={(names) => void onApplyRecommendations(names)}
                  onDismiss={dismissRecommendations}
                />
              )}
            {undoInfo && (
              <div
                data-testid="undo-info"
                className="border-b border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700"
              >
                {undoInfo}
              </div>
            )}
            <ConnectionBar
              conn={conn}
              onChange={(next) => {
                setConn(next);
                saveConnection(next);
              }}
            />

            {showSettings && (
              <ModelKeyPanel
                conn={conn}
                settings={settings}
                onSaved={(next) => setSettings(next)}
              />
            )}

            {error && (
              <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                {error}
              </div>
            )}

            {stream.alerts.length > 0 && (
              <div
                data-testid="scope-alerts"
                className="space-y-1 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700"
              >
                {stream.alerts.map((alert) => (
                  <div key={alert.id} className="flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span className="font-mono font-semibold">
                      {alert.code}
                    </span>
                    <span className="truncate">{alert.message}</span>
                    <span className="text-[10px] opacity-70">
                      {alert.contractId.slice(-8)}
                    </span>
                    <button
                      onClick={() => stream.dismissAlert(alert.id)}
                      className="ml-auto shrink-0 px-1 text-amber-700/70 hover:text-amber-900"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        }
        leftExtra={
          <>
            <div className="min-h-[180px] flex-1 overflow-auto">
              <div className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">
                Contracts ({contracts.length})
              </div>
              {contracts.length === 0 && (
                <div className="px-3 py-4 text-xs text-muted-foreground">
                  暂无合同。点击「新建合同」由 Daemon 持久化。
                </div>
              )}
              {contracts.map((contract) => (
                <button
                  key={contract.contract_id}
                  onClick={() => {
                    setSelectedId(contract.contract_id);
                    setEvidence(null);
                    setWorkerResult(null);
                    setDiff(null);
                  }}
                  className={`block w-full border-b border-border/50 px-3 py-2 text-left hover:bg-sidebar-accent ${
                    selectedId === contract.contract_id
                      ? "bg-sidebar-accent"
                      : ""
                  }`}
                >
                  <div className="truncate text-xs">
                    {contract.intent.title}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {contract.lifecycle_state} ·{" "}
                    {contract.contract_id.slice(-8)}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex h-[320px] flex-col border-t border-border">
              <div className="px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                架构雷达 {graph ? `· ${graph.stats.nodes} 节点` : ""}
              </div>
              {graph ? (
                <>
                  <FilterToolbar
                    query={query}
                    onQueryChange={setQuery}
                    showCycles={showCycles}
                    onToggleCycles={setShowCycles}
                    nodeCount={graph.stats.nodes}
                    edgeCount={graph.stats.edges}
                    selectedCount={selectedPaths.length}
                    matches={matches}
                  />
                  <RadarGraph
                    nodes={graph.graph.nodes}
                    edges={graph.graph.edges}
                    cycles={graph.cycles}
                    selected={selectedPaths}
                    onSelectionChange={setSelectedPaths}
                    focusPath={focusPath}
                    showCycles={showCycles}
                    className="min-h-0 flex-1"
                  />
                  <ScopeSelector
                    selected={selectedPaths}
                    onApply={(paths) => {
                      setScopeDraft(paths);
                      setShowForm(true);
                    }}
                    onClear={() => setSelectedPaths([])}
                  />
                </>
              ) : (
                <div className="px-2 py-4 text-[11px] text-muted-foreground">
                  连接 Daemon 后加载依赖图
                </div>
              )}
            </div>
          </>
        }
        studioContent={
          <div className="flex min-w-0 flex-1 flex-col">
            {showForm && (
              <ContractForm
                busy={busy === "create"}
                initialPaths={scopeDraft}
                onCreate={(contract) =>
                  runAction("create", async () => {
                    const saved = await createContract(conn, contract);
                    setSelectedId(saved.contract_id);
                    setShowForm(false);
                  })
                }
              />
            )}

            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                选择左侧合同查看详情，或在雷达中圈选文件后新建合同
              </div>
            ) : (
              <div className="space-y-4 p-4">
                <ContractCard
                  contract={selected}
                  busy={busy === "approve"}
                  onApprove={(id) =>
                    void runAction("approve", async () => {
                      await approveContract(conn, id, "local-user");
                    })
                  }
                />

                <div className="grid gap-3 md:grid-cols-2">
                  <ScopeList scope={selected.authorization.file_system_scope} />
                  <BudgetVisualizer
                    costLimits={selected.authorization.cost_limits}
                    budgetLimits={selected.authorization.budget_limits}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={
                      busy !== null || selected.lifecycle_state !== "EXECUTING"
                    }
                    onClick={() =>
                      runAction("worker", async () => {
                        const result = await runWorker(
                          conn,
                          selected.contract_id,
                        );
                        setWorkerResult(result);
                      })
                    }
                    className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
                  >
                    {busy === "worker" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    运行 Worker
                  </button>
                  <button
                    disabled={
                      busy !== null || selected.lifecycle_state !== "EXECUTING"
                    }
                    onClick={() =>
                      runAction("execute", async () => {
                        const outcome = await executeContract(
                          conn,
                          selected.contract_id,
                        );
                        setEvidence(outcome.evidence);
                      })
                    }
                    className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
                  >
                    {busy === "execute" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    执行验证
                  </button>
                  <button
                    disabled={
                      busy !== null ||
                      selected.lifecycle_state !== "PENDING_RESUME"
                    }
                    onClick={() =>
                      void runAction("resume", async () => {
                        await resumeContract(conn, selected.contract_id);
                      })
                    }
                    className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
                  >
                    {busy === "resume" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    恢复执行
                  </button>
                  <button
                    disabled={
                      busy !== null ||
                      selected.lifecycle_state === "MERGED" ||
                      selected.lifecycle_state === "ABORTED"
                    }
                    onClick={() => {
                      const confirmed = window.confirm(
                        `确认中止合同 ${selected.contract_id}？\n` +
                          "在途进程将被强杀，Worktree 与任务分支会被清理，合同进入终态 ABORTED，不可撤销。",
                      );
                      if (!confirmed) return;
                      void runAction("abort", async () => {
                        await abortContract(
                          conn,
                          selected.contract_id,
                          "local-user",
                        );
                        setEvidence(null);
                      });
                    }}
                    className="flex items-center gap-1 rounded border border-destructive/50 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
                  >
                    {busy === "abort" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
                    )}
                    {selected.lifecycle_state === "PENDING_APPROVAL"
                      ? "驳回合同"
                      : "中止任务"}
                  </button>
                  <button
                    onClick={() =>
                      void runAction("diff", async () => {
                        setDiff(await fetchDiff(conn, selected.contract_id));
                      })
                    }
                    className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    <GitCompare className="h-3.5 w-3.5" /> 查看 Diff
                  </button>
                  <EditorOpener conn={conn} contractId={selected.contract_id} />
                  {busy && (
                    <span className="text-[10px] text-muted-foreground">
                      正在{busy}…
                    </span>
                  )}
                </div>

                {workerResult && (
                  <section className="rounded border border-border bg-card p-3">
                    <h3 className="text-sm font-semibold">Worker 执行记录</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      应用 {workerResult.changes.length} 个文件 · tokens{" "}
                      {workerResult.usage.inputTokens}↑ /{" "}
                      {workerResult.usage.outputTokens}↓
                    </p>
                    <ul className="mt-2 space-y-0.5 text-[11px]">
                      {workerResult.log.map((line) => (
                        <li key={line} className="text-chart-2">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {selectedLogs.length > 0 && (
                  <section
                    data-testid="live-log"
                    className="rounded border border-border bg-card p-3"
                  >
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">实时日志</h3>
                      <span className="text-[10px] text-muted-foreground">
                        {selectedLogs.length} 行 · WebSocket 推送（保留最近 500
                        行）
                      </span>
                      <button
                        onClick={stream.clearLogs}
                        className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        清空
                      </button>
                    </div>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/80 p-2 text-[10px] leading-relaxed text-zinc-300">
                      {selectedLogs.map((line, i) => (
                        <div key={`${line.at}-${i}`}>
                          <span className="text-zinc-500">
                            {line.at.slice(11, 19)}{" "}
                          </span>
                          {line.line}
                        </div>
                      ))}
                    </pre>
                  </section>
                )}

                {diff && <DiffViewer patch={diff.patch} />}
                {evidence && (
                  <>
                    <EvidenceChecklist
                      evidence={evidence}
                      busy={busy === "merge"}
                      onMerge={() =>
                        void runAction("merge", async () => {
                          const result = await mergeContract(
                            conn,
                            selected.contract_id,
                            evidence.evidence_id,
                            "local-user",
                          );
                          setMergeInfo(
                            result.nothingToMerge
                              ? (result.message ??
                                  "本轮改动与你的修改冲突，已全部以你为准")
                              : `已合并 ${result.commitSha.slice(0, 8)} · worktree ${
                                  result.worktreeRemoved ? "已清理" : "保留"
                                }${
                                  result.conflictResolution ===
                                  "USER_FIRST_DISCARD"
                                    ? " · 有冲突：已保留你的版本，AI 需基于最新代码重做冲突部分"
                                    : ""
                                }`,
                          );
                        })
                      }
                    />
                    {mergeInfo && (
                      <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700">
                        {mergeInfo}
                      </div>
                    )}
                    <EvidenceView evidence={evidence} />
                  </>
                )}
              </div>
            )}
          </div>
        }
        footer={
          <footer className="flex h-6 items-center gap-4 bg-primary px-3 text-xs text-primary-foreground">
            <span>Daemon: {conn.baseUrl}</span>
            <span className="ml-auto">v0.1 · Evidence-gated</span>
          </footer>
        }
      />
    </div>
  );
}

function ModelKeyPanel({
  conn,
  settings,
  onSaved,
}: {
  conn: DaemonConnection;
  settings: ModelSettings | null;
  onSaved: (next: ModelSettings) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(settings?.model ?? "gpt-4o-mini");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setState("saving");
    setMessage(null);
    try {
      const next = await saveOpenAiKey(conn, apiKey.trim(), model.trim());
      onSaved(next);
      setApiKey("");
      setState("saved");
      setMessage("已配置：Key 仅保存在 Daemon 进程内存，不写入磁盘、不回显。");
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  };

  return (
    <section className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 text-[11px]">
      <span className="text-muted-foreground">OpenAI API Key</span>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={
          settings?.configured ? "已配置（重新输入可覆盖）" : "sk-..."
        }
        className="w-64 rounded border border-border bg-background px-2 py-1 outline-none"
      />
      <span className="text-muted-foreground">模型</span>
      <input
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="w-40 rounded border border-border bg-background px-2 py-1 outline-none"
      />
      <button
        onClick={() => void save()}
        disabled={state === "saving" || apiKey.trim().length < 8}
        className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40"
      >
        {state === "saving" ? "保存中…" : "保存到 Daemon"}
      </button>
      <span className="text-muted-foreground">
        当前：
        {settings?.configured ? `已配置（来源 ${settings.source}）` : "未配置"}
      </span>
      {message && (
        <span
          className={
            state === "error" ? "text-destructive" : "text-emerald-600"
          }
        >
          {message}
        </span>
      )}
    </section>
  );
}

function ConnectionBar({
  conn,
  onChange,
}: {
  conn: DaemonConnection;
  onChange: (next: DaemonConnection) => void;
}) {
  const [draft, setDraft] = useState(conn);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-1.5 text-[11px]">
      <span className="text-muted-foreground">Daemon</span>
      <input
        value={draft.baseUrl}
        onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
        className="w-64 rounded border border-border bg-background px-2 py-1 outline-none"
      />
      <span className="text-muted-foreground">Session Token</span>
      <input
        type="password"
        value={draft.token}
        onChange={(e) => setDraft({ ...draft, token: e.target.value })}
        placeholder=".stagent/session-token"
        className="w-64 rounded border border-border bg-background px-2 py-1 outline-none"
      />
      <button
        onClick={() => onChange(draft)}
        className="rounded border border-border px-2 py-1 text-muted-foreground hover:text-foreground"
      >
        应用
      </button>
    </div>
  );
}

function EvidenceView({ evidence }: { evidence: EvidenceBundle }) {
  const passed =
    evidence.verdict.status === "PASSED" && evidence.verdict.can_merge;
  return (
    <section className="rounded border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        {passed ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
        <h3 className="text-sm font-semibold">
          Evidence {evidence.evidence_id}
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {evidence.verdict.status} · can_merge=
          {String(evidence.verdict.can_merge)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {evidence.verdict.summary}
        {evidence.verdict.reason_code
          ? ` · reason: ${evidence.verdict.reason_code}`
          : ""}
      </p>
      <div className="mt-2 space-y-1">
        {evidence.verification_results.map((result) => (
          <div
            key={result.command_alias}
            className="flex items-center gap-2 text-[11px]"
          >
            <span>{result.command_alias}</span>
            <span
              className={
                result.passed ? "text-emerald-500" : "text-destructive"
              }
            >
              exit={result.exit_code}
            </span>
            <span className="text-muted-foreground">
              {result.duration_ms}ms
            </span>
          </div>
        ))}
      </div>
      <pre className="mt-2 max-h-56 overflow-auto rounded bg-black/80 p-2 text-[10px] text-zinc-300">
        {JSON.stringify(evidence, null, 2)}
      </pre>
    </section>
  );
}

function ContractForm({
  busy,
  initialPaths,
  onCreate,
}: {
  busy: boolean;
  initialPaths: string[];
  onCreate: (contract: SoftwareContract) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [paths, setPaths] = useState(initialPaths.join(", ") || "src/**");
  const [command, setCommand] = useState("npm test");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPaths.length > 0) setPaths(initialPaths.join(", "));
  }, [initialPaths]);

  const submit = () => {
    setFormError(null);
    try {
      const parts = command.trim().split(/\s+/);
      const draft = createContractDraft({
        title: title.trim() || "未命名任务",
        description: description.trim() || "（无描述）",
        acceptanceCriteria: ["验证命令通过"],
        writablePaths: paths
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        commands: [
          {
            alias: "verify",
            executable: parts[0] ?? "npm",
            args: parts.slice(1),
            expected_exit_code: 0,
            timeout_seconds: 60,
          },
        ],
      });
      onCreate(
        softwareContractSchema.parse({
          ...draft,
          lifecycle_state: "PENDING_APPROVAL",
          approval: { status: "PENDING_REVIEW" },
        }),
      );
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  return (
    <section className="border-b border-border bg-card p-3">
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-[11px]">
          标题
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <label className="text-[11px]">
          可写路径（逗号分隔）
          <input
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <label className="text-[11px] md:col-span-2">
          描述
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <label className="text-[11px] md:col-span-2">
          验证命令
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
      </div>
      {formError && (
        <div className="mt-2 text-[11px] text-destructive">{formError}</div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40"
        >
          {busy ? "创建中…" : "提交给 Daemon"}
        </button>
        <span className="text-[10px] text-muted-foreground">
          合同由 Daemon 校验并写入 .stagent/contracts
        </span>
      </div>
    </section>
  );
}

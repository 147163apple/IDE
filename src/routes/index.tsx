import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitCompare,
  Loader2,
  Play,
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
  createContractWithAdmission,
  admitContract,
  executeContract,
  fetchArchGraph,
  fetchDiff,
  fetchDiffFiles,
  fetchEvidence,
  fetchHealth,
  fetchSettings,
  fetchTaskGraph,
  generateSupervisorDraft,
  submitDisputeSelfCheck,
  fetchPresentationSnapshot,
  listContracts,
  loadConnection,
  mergeContract,
  resumeContract,
  runWorker,
  saveConnection,
  saveOpenAiKey,
  undoProtectionRound,
  unlockProtectionEntry,
  type ArchGraphPayload,
  type AdmissionView,
  type DaemonConnection,
  type DiffFilesView,
  type ModelSettings,
  type ProtectionRecommendationView,
  type ProtectionStateView,
  type SupervisorDraftResult,
  type WorkerRunResult,
} from "@/lib/daemon-api";
import { ContractCard } from "@/components/contract/ContractCard";
import { ScopeList } from "@/components/contract/ScopeList";
import { BudgetVisualizer } from "@/components/contract/BudgetVisualizer";
import { RadarGraph } from "@/components/radar/RadarGraph";
import { FilterToolbar } from "@/components/radar/FilterToolbar";
import { ScopeSelector } from "@/components/radar/ScopeSelector";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { StructuredTerminal } from "@/components/StructuredTerminal";
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
import { ProtectionConfirmCard } from "@/components/ProtectionConfirmCard";
import { SupervisorStudioPane } from "@/components/SupervisorStudioPane";
import { StudioViewportShell } from "@/components/studio/StudioViewportShell";
import { DemoPreviewPane } from "@/components/studio/DemoPreviewPane";
import { TaskGraphPane } from "@/components/studio/TaskGraphPane";
import {
  DisputeConsolePane,
  type DisputeReportView,
} from "@/components/studio/DisputeConsolePane";
import { SupervisorTab } from "@/components/supervisor/SupervisorTab";
import { SettingsTab } from "@/components/settings/SettingsTab";
import { TaskGraphPanel } from "@/components/graph/TaskGraphPanel";
import { applyTaskGraphFrame } from "@/components/graph/graph-view-model";
import {
  FileTreeSpecsSection,
  type SpecAsset,
} from "@/components/FileTreeSpecsSection";
import type { TaskGraph } from "@/lib/graph/task-graph";
import {
  shouldConfirmAdmission,
  seedDraftForm,
  toStudioDraft,
  toSupervisorContractView,
} from "@/components/supervisor-view-model";
import type { WorktreeFileIO } from "@/hooks/useWorktreeFile";
import type { AgentSessionTransport } from "@/hooks/use-agent-session";
import type { ChatEvent } from "@/lib/chat-events";
import {
  APPROVED_STATES,
  buildFileTree,
  toExecutionStatus,
} from "@/components/workspace-adapters";
import {
  EXECUTION_STATUS_LABEL,
  type ActiveContract,
} from "@/components/workspace-types";
import { createProtectionPoller } from "@/lib/perf-guards";
import type {
  ContractUpdatePayload,
  DemoPreviewStatusPayload,
  EvidenceReadyPayload,
  StateChangedPayload,
  TaskGraphUpdatedPayload,
} from "@/lib/ipc/frames";
import type { PresentationState } from "@/lib/state/presentation-state";
import { PRESENTATION_STATES } from "@/lib/state/presentation-state";

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
  /**
   * `POST /api/supervisor/draft` 刚返回的**未落盘草案**。
   *
   * 为什么要有这个状态：草案在用户点「提交给 Daemon」之前根本不存在于仓库里，
   * 却又必须让 Supervisor Tab / Studio 显示它的白话理由与未决问题——
   * 不能伪造一个假合同塞进 contracts 列表，那会让"已落盘"和"未提交"混为一谈。
   */
  const [draft, setDraft] = useState<SupervisorDraftResult | null>(null);

  const [graph, setGraph] = useState<ArchGraphPayload | null>(null);
  const [query, setQuery] = useState("");
  const [showCycles, setShowCycles] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);

  /**
   * Task Graph 权威快照（TASK-C.7）。
   * 首屏 GET 一次，之后全部由 `TASK_GRAPH_UPDATED` 帧覆盖；
   * 页面不读 `.stagent/specs/task_graph.json`，也不自行推导节点状态。
   */
  const [taskGraph, setTaskGraph] = useState<TaskGraph | null>(null);
  const [taskGraphLoading, setTaskGraphLoading] = useState(false);
  const [taskGraphError, setTaskGraphError] = useState<string | null>(null);
  const [specsOpen, setSpecsOpen] = useState(true);

  /** TASK-C.2：Daemon 权威展示态（STATE_CHANGED），驱动 Studio 默认视口 */
  const [presentationByContract, setPresentationByContract] = useState<
    Record<string, { state: PresentationState; message: string }>
  >({});
  const [demoPreview, setDemoPreview] =
    useState<DemoPreviewStatusPayload | null>(null);
  const [disputeReport, setDisputeReport] = useState<DisputeReportView | null>(
    null,
  );
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);

  const [diff, setDiff] = useState<{ patch: string; stat: string } | null>(
    null,
  );
  const [diffFiles, setDiffFiles] = useState<DiffFilesView | null>(null);
  const [mergeInfo, setMergeInfo] = useState<string | null>(null);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
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
  /**
   * C.2 准入裁决结果。只保存"需要人看的那一次"：
   * AUTO_APPROVED / SKIPPED 一律置 null → 确认卡结构性不渲染（无交集 0 弹窗）。
   */
  const [admission, setAdmission] = useState<AdmissionView | null>(null);
  /**
   * 布局持有 Tab 状态，「打开合同操作台」这类外部跳转用递增信号驱动
   * （与 openRequest 的 nonce 同一套路，避免把 Tab 状态提到页面上）。
   */
  const [studioNonce, setStudioNonce] = useState(0);
  /**
   * 打开「新建需求」：带上草稿范围、展开创建表单、并切到合同操作台。
   * 必须一起做——首屏不再默认打开 Studio，只 setShowForm 会让表单渲染在看不见的标签里。
   * 同时丢弃上一份未提交草案：换需求就该重新生成，不能让旧理由挂在新意图上。
   */
  const openNewRequirement = useCallback((paths: string[]) => {
    setScopeDraft(paths);
    setDraft(null);
    setShowForm(true);
    setStudioNonce((n) => n + 1);
  }, []);

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

  /** 架构图里的真实文件路径（仓库相对），用于判断 Demo 资产是否已生成 */
  const repoRelativePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const node of graph?.graph.nodes ?? []) {
      const relative =
        repoRoot && node.filePath.startsWith(repoRoot + "/")
          ? node.filePath.slice(repoRoot.length + 1)
          : node.filePath;
      paths.add(relative);
    }
    return paths;
  }, [graph, repoRoot]);

  /**
   * 左栏【规范与资产】的数据。只列真实存在或真实缺失的东西：
   * 需求标题来自合同、合同路径来自 `.stagent/contracts`，
   * Demo 只在文件树里真出现时才标「就绪」。
   */
  const specAssets = useMemo<SpecAsset[]>(() => {
    if (!selected) return [];
    const assets: SpecAsset[] = [
      {
        id: "requirement",
        kind: "requirement",
        label: selected.intent.title,
        status: "READY",
        hint: `${selected.intent.acceptance_criteria.length} 条验收标准 · ${selected.intent.risk_level} 风险`,
      },
      {
        id: "contract",
        kind: "contract",
        label: `合同 ${selected.contract_id.slice(-8)}.json`,
        path: `.stagent/contracts/${selected.contract_id}.json`,
        status: "READY",
        hint: `${selected.lifecycle_state} · rev ${selected.contract_revision}`,
      },
    ];

    const demoCandidates = [
      "demo/index.html",
      "prototype/index.html",
      ".stagent/demo/index.html",
    ];
    const demoPath = demoCandidates.find((path) => repoRelativePaths.has(path));
    assets.push(
      demoPath
        ? {
            id: "demo",
            kind: "demo",
            label: demoPath.split("/").pop() ?? demoPath,
            path: demoPath,
            status: "READY" as const,
            hint: demoPath,
          }
        : {
            id: "demo",
            kind: "demo",
            label: "Demo 原型",
            status: "MISSING" as const,
            hint: "尚未生成原型；生成后会自动出现在这里",
          },
    );
    return assets;
  }, [selected, repoRelativePaths]);

  /** 本轮生成进度：只认当前合同自己的图，别把 A 的进度显示在 B 上 */
  const specsGeneration = useMemo(() => {
    if (
      !taskGraph ||
      !selected ||
      taskGraph.contract_id !== selected.contract_id
    ) {
      return null;
    }
    return {
      percent: taskGraph.progress.percent,
      illuminated: taskGraph.progress.illuminated,
      total: taskGraph.progress.total,
      updatedAt: taskGraph.updated_at.slice(11, 19),
    };
  }, [taskGraph, selected]);

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
      // TASK-C.2：展示态快照与保护清单解耦——失败/挂起不得挡住 P.1 横幅
      void fetchPresentationSnapshot(conn)
        .then((snap) => {
          const next: Record<
            string,
            { state: PresentationState; message: string }
          > = {};
          for (const [id, rec] of Object.entries(snap.contracts)) {
            if (
              (PRESENTATION_STATES as readonly string[]).includes(
                rec.presentation_state,
              )
            ) {
              next[id] = {
                state: rec.presentation_state as PresentationState,
                message: rec.message?.trim() || "",
              };
            }
          }
          setPresentationByContract(next);
        })
        .catch(() => {
          // 投影文件缺失不阻断主流程；保持内存态或空
        });
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

  /** C.2：Studio 内逐条解锁保护条目（不提供"一键全解"，安全网不该被一次误点清空） */
  const onUnlockProtection = useCallback(
    async (id: string) => {
      setProtectionBusy(true);
      try {
        await unlockProtectionEntry(conn, id);
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
    onTaskGraphUpdate: (p: TaskGraphUpdatedPayload) => {
      // 帧按合同隔离：正在看 B 时收到 A 的快照，不覆盖当前视图
      if (selectedId !== null && p.contract_id !== selectedId) return;
      setTaskGraph((prev) => applyTaskGraphFrame(prev, p));
      setTaskGraphError(null);
      setTaskGraphLoading(false);
    },
    onStateChanged: (p: StateChangedPayload) => {
      const state = p.presentation_state;
      if (!(PRESENTATION_STATES as readonly string[]).includes(state)) {
        return;
      }
      setPresentationByContract((prev) => ({
        ...prev,
        [p.contract_id]: {
          state: state as PresentationState,
          message: p.message?.trim() || "",
        },
      }));
    },
    onDemoPreviewStatus: (p: DemoPreviewStatusPayload) => {
      setDemoPreview(p);
    },
    onDisputeReportReady: (p) => {
      // 完整报告仍以 HTTP 响应为准；这里只在切合同后避免错挂摘要
      if (selectedId !== null && p.contract_id !== selectedId) return;
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
    const timer = setInterval(() => {
      // 页面隐藏时不发起任何后台刷新（含 protection），避免空转
      if (document.hidden) return;
      void refresh();
    }, interval);
    return () => clearInterval(timer);
  }, [refresh, stream.status]);

  // 缺口 4.4：有活跃合同/待审批时 3s，否则 60s；隐藏页暂停、回前台补偿一次
  const hasActiveWork =
    (protection?.round.pending.length ?? 0) > 0 ||
    contracts.some((contract) =>
      ["PREPARING", "EXECUTING", "VERIFYING", "PENDING_RESUME"].includes(
        contract.lifecycle_state,
      ),
    );

  useEffect(() => {
    if (!connected) return;
    const poller = createProtectionPoller({
      fetchProtection: async () => {
        setProtection(await fetchProtection(conn));
      },
      hasActiveWork: () => hasActiveWork,
    });
    poller.start();
    return () => poller.stop();
  }, [connected, conn, hasActiveWork]);

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

  // 缺口 4.2：建连不再自动拉取架构图；仅在用户显式点击时按需加载。
  // 设置读取与架构图解耦，避免一次建连触发全仓 AST 计算。
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
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

  const loadArchGraph = useCallback(async () => {
    try {
      const payload = await fetchArchGraph(conn);
      setGraph(payload);
    } catch {
      // 架构图失败不阻断主流程
    }
  }, [conn]);

  /**
   * 拉取 Task Graph 权威快照。切合同立即重拉：图谱属于合同，
   * 把 A 的图挂在 B 的页面上比空态更危险。
   */
  const loadTaskGraph = useCallback(
    async (contractId?: string) => {
      setTaskGraphLoading(true);
      setTaskGraphError(null);
      try {
        setTaskGraph(await fetchTaskGraph(conn, contractId));
      } catch (err) {
        setTaskGraphError((err as Error).message);
      } finally {
        setTaskGraphLoading(false);
      }
    },
    [conn],
  );

  // 合同切换/首次连上时拉一次图谱；后续靠 TASK_GRAPH_UPDATED 帧
  useEffect(() => {
    if (!connected) return;
    void loadTaskGraph(selectedId ?? undefined);
  }, [connected, loadTaskGraph, selectedId]);

  /**
   * 文件树跟随真实变更：Task Graph 每次更新都意味着 Worktree 里发生了
   * 写入/验证，重新拉一次架构图，左栏文件树与【规范与资产】的 Demo 条目
   * 就会随真实文件出现。`lastTreeSync` 防止"刷新文件树 → 触发渲染 → 再刷新"
   * 的循环。
   */
  const lastTreeSync = useRef<string | null>(null);
  useEffect(() => {
    if (!connected || !taskGraph || !graph) return;
    if (lastTreeSync.current === taskGraph.updated_at) return;
    lastTreeSync.current = taskGraph.updated_at;
    void loadArchGraph();
  }, [connected, taskGraph, graph, loadArchGraph]);

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

  /**
   * C.2：只有"确实需要人看"的裁决才进状态。
   * 无交集（AUTO_APPROVED）与已推进（SKIPPED）一律置 null，
   * 于是 `ProtectionConfirmCard` 结构性不渲染——这就是"0 弹窗"的实现方式。
   */
  const applyAdmission = (next: AdmissionView | null) => {
    setAdmission(shouldConfirmAdmission(next) ? next : null);
  };

  /** 点「同意」：先记本轮放行（这张卡上的文件），再请求 Daemon 重跑准入裁决 */
  const onApproveAdmission = (view: AdmissionView) => {
    void runAction("admit", async () => {
      if (view.cardId) {
        await decideProtectionCard(conn, view.cardId, "approve");
      }
      const next = await admitContract(conn, view.contract.contract_id);
      applyAdmission(next);
    });
  };

  /** 点「不同意」：记拒绝并直接中止合同——"坚决取消"，不留半开状态 */
  const onDenyAdmission = (view: AdmissionView) => {
    void runAction("deny-admission", async () => {
      if (view.cardId) {
        await decideProtectionCard(conn, view.cardId, "deny");
      }
      await abortContract(
        conn,
        view.contract.contract_id,
        "local-user",
        "用户在保护确认卡上选择「不同意」",
      );
      applyAdmission(null);
    });
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

  /**
   * 提意图 → 草案：只调 `POST /api/supervisor/draft`（Zero-Tool 只读），
   * 不创建合同、不写入 `.stagent/contracts`。失败（402 预算耗尽 / 409 未配模型）
   * 由 `runAction` 统一落到页面 error 条，不做静默降级。
   */
  const requestDraft = (intent: string) => {
    void runAction("draft", async () => {
      const outcome = await generateSupervisorDraft(conn, {
        intent,
        context_paths: scopeDraft,
      });
      setDraft(outcome.draft);
    });
  };

  /**
   * Supervisor Tab 的视图数据：只做字段搬运，不做推断。
   * 合同里没有的东西（健康度 / 成熟度 / 风险分 / 用例通过率）这里一律不补。
   *
   * 草案优先于选中合同：草案代表"刚刚这个意图"的最新推导结果；
   * 用户点左侧合同列表时会清掉 draft，因此两者不会互相遮挡。
   */
  const supervisorContract = draft
    ? toSupervisorContractView(draft.contract, { isDraft: true })
    : selected
      ? toSupervisorContractView(selected)
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
        contract={workspaceContract}
        protectedCount={protection?.entries.length ?? 0}
        files={fileTree}
        specsSection={
          <FileTreeSpecsSection
            assets={specAssets}
            open={specsOpen}
            onToggle={() => setSpecsOpen((v) => !v)}
            onOpen={(path) => setOpenRequest({ path, nonce: Date.now() })}
            generation={specsGeneration}
          />
        }
        confirmSlot={
          // C.2：至多一张白话是/否卡；无交集时 applyAdmission 已置 null，此处不渲染
          <ProtectionConfirmCard
            admission={admission}
            busy={busy === "admit" || busy === "deny-admission"}
            onApprove={onApproveAdmission}
            onDeny={onDenyAdmission}
          />
        }
        rightPanel={
          // 恢复 Cursor 式骨架：AI 对话回到右栏，是主要的需求沟通入口
          <AgentChatPane transport={chatTransport} />
        }
        supervisorContent={
          // 左下角 Supervisor 图标 → 中央可关闭 Tab；数据全部来自合同/保护清单
          <SupervisorTab
            repoName={repoName}
            repoPath={repoRoot ?? "（连接 Daemon 后显示仓库路径）"}
            baseBranch={currentBranch}
            contractCount={contracts.length}
            contract={supervisorContract}
            architecture={
              // 架构总览：原来挤在左栏 260px 里，现在在中央宽屏铺开
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="opacity-60">
                    {graph
                      ? `${graph.stats.nodes} 节点 · ${graph.stats.edges} 条依赖 · ${graph.cycles.length} 处环`
                      : "尚未加载依赖拓扑"}
                  </span>
                  <button
                    type="button"
                    data-testid="load-arch-graph"
                    onClick={() => void loadArchGraph()}
                    className="shrink-0 rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                  >
                    {graph ? "刷新依赖拓扑" : "加载架构图"}
                  </button>
                </div>
                {graph ? (
                  <div className="flex h-[520px] flex-col overflow-hidden rounded border border-border">
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
                      onApply={(paths) => openNewRequirement(paths)}
                      onClear={() => setSelectedPaths([])}
                    />
                  </div>
                ) : (
                  <p className="opacity-70">
                    连接 Daemon
                    后可加载依赖拓扑；圈选出的文件会直接带进新建需求的范围。
                  </p>
                )}
              </div>
            }
            protection={{
              mode: protection?.mode ?? "VIBE",
              entries: protection?.entries.length ?? 0,
              checkpoint: protection?.checkpoint?.at ?? null,
            }}
            admission={
              admission
                ? {
                    decision: admission.decision,
                    reason: admission.reason ?? null,
                    cardId: admission.cardId ?? null,
                  }
                : null
            }
            busy={busy === "admit" || busy === "deny-admission"}
            onApprove={
              admission ? () => onApproveAdmission(admission) : undefined
            }
            onDeny={admission ? () => onDenyAdmission(admission) : undefined}
            onOpenConsole={() => setStudioNonce((n) => n + 1)}
          />
        }
        openStudioRequest={studioNonce}
        terminalPanel={
          // 底栏抽屉式 SmartTerminal，数据源与 Studio 内终端一致
          <StructuredTerminal
            lines={stream.terminal
              .filter((t) => !selected || t.contractId === selected.contract_id)
              .map((t) => ({ stream: t.stream, line: t.line, at: t.at }))}
          />
        }
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
        graphContent={
          /*
            Task Graph Tab（TASK-C.7）：业务功能导图与执行 DAG 双视图。
            数据全部来自 Daemon 快照：首屏 GET + TASK_GRAPH_UPDATED 帧。
          */
          <TaskGraphPanel
            graph={taskGraph}
            loading={taskGraphLoading}
            error={taskGraphError}
            onRefresh={() => void loadTaskGraph(selectedId ?? undefined)}
          />
        }
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
        onNewRequirement={() => openNewRequirement(selectedPaths)}
        settingsContent={
          /*
            设置 Tab：连接地址、Session Token、实时流、网关受控、模型 Key、
            Worktree 绝对路径、撤销本轮——原来全堆在顶栏，现在只在这里。
          */
          <SettingsTab
            conn={conn}
            onConnChange={(next) => {
              // 先落盘（saveConnection 会归一 Token/地址），再回读进内存：
              // 界面上看到的连接，必须与实际发出去的 header 完全一致
              saveConnection(next);
              setConn(loadConnection());
            }}
            connected={connected}
            daemonPort={daemonPort}
            repoPath={repoRoot ?? "（连接 Daemon 后显示仓库路径）"}
            baseBranch={currentBranch}
            runMode={
              protection && protection.mode !== "VIBE" ? "PROTECTED" : "VIBE"
            }
            protectedCount={protection?.entries.length ?? 0}
            workerControl={
              selected?.worker_spec.control_mode ?? "GATEWAY_ENFORCED"
            }
            streamStatus={stream.status}
            worktreePath={workspaceContract?.worktreePath ?? null}
            executionStatus={
              selected
                ? EXECUTION_STATUS_LABEL[
                    toExecutionStatus(selected.lifecycle_state)
                  ]
                : null
            }
            modelKeySlot={
              <ModelKeyPanel
                conn={conn}
                settings={settings}
                onSaved={(next) => setSettings(next)}
              />
            }
            checkpoint={protection?.checkpoint?.roundId ?? null}
            onUndoRound={
              protection?.checkpoint ? () => void onUndoRound() : undefined
            }
            undoBusy={protectionBusy}
            onRefresh={() => void refresh()}
          />
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
            {/* 至多一张卡：合同准入正在等用户决策时，不再叠加 P.1 的通用命中卡 */}
            {!shouldConfirmAdmission(admission) &&
              protection?.round.pending[0] && (
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
          /*
            左栏只做资源管理器：文件树（布局自带）+ 需求/合同列表。
            架构雷达已挪到 Supervisor 的「项目全景解读 · 架构总览」——260px 的
            窄栏根本放不下拓扑图，圈选和筛选都被挤变形。
          */
          <div className="min-h-[120px]">
            <div className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">
              需求（合同 {contracts.length}）
            </div>
            {contracts.length === 0 && (
              <div className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                暂无需求。点右上角「新建需求」，或在右侧对话里说清目标。
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
                  setDiffFiles(null);
                  // 切换合同时丢弃上一份合同的准入裁决，避免把 A 的白话卡挂到 B 上
                  setAdmission(null);
                  // 同上：未提交草案是"另一个意图"的产物，选中真实合同后必须让位
                  setDraft(null);
                  setDisputeReport(null);
                  setDisputeError(null);
                  // 首屏不再默认打开操作台，点需求才把它拉起来（否则点了没反应）
                  setStudioNonce((n) => n + 1);
                }}
                className={`block w-full border-b border-border/50 px-3 py-2 text-left hover:bg-sidebar-accent ${
                  selectedId === contract.contract_id ? "bg-sidebar-accent" : ""
                }`}
              >
                <div className="truncate text-xs">{contract.intent.title}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {contract.lifecycle_state} · {contract.contract_id.slice(-8)}
                </div>
              </button>
            ))}
          </div>
        }
        studioContent={
          <StudioViewportShell
            presentationState={
              selectedId
                ? (presentationByContract[selectedId]?.state ?? null)
                : null
            }
            presentationMessage={
              selectedId
                ? presentationByContract[selectedId]?.message || null
                : null
            }
            demo={
              <DemoPreviewPane
                previewUrl={demoPreview?.url ?? null}
                status={demoPreview?.status ?? null}
                errorMessage={demoPreview?.message ?? null}
                onRevise={() => {
                  // 回到右栏继续聊原型——不关 Studio，用户能对照着改
                }}
                onConfirm={() => {
                  // 旅程推进（建图/施工）由 Supervisor 会话承担；此处仅确认入口可见
                  setStudioNonce((n) => n + 1);
                }}
              />
            }
            graph={
              <TaskGraphPane
                graph={taskGraph}
                loading={taskGraphLoading}
                error={taskGraphError}
                onRefresh={() => void loadTaskGraph(selectedId ?? undefined)}
              />
            }
            dispute={
              <DisputeConsolePane
                contractId={selected?.contract_id ?? null}
                report={disputeReport}
                busy={disputeBusy}
                error={disputeError}
                onSubmit={async (challenge) => {
                  if (!selected) return;
                  setDisputeBusy(true);
                  setDisputeError(null);
                  try {
                    const result = await submitDisputeSelfCheck(conn, {
                      contract_id: selected.contract_id,
                      challenge,
                    });
                    const report = result.report;
                    setDisputeReport({
                      report_id: report.report_id,
                      contract_id: report.contract_id,
                      challenge: report.challenge,
                      classification: report.classification,
                      suggested_classification: report.suggested_classification,
                      confidence: report.confidence,
                      degraded: report.degraded || result.degraded === true,
                      plain_summary: report.plain_summary,
                      rationale: report.rationale,
                      facts: {
                        prompt: {
                          original_request:
                            report.facts.prompt.original_request,
                          matched_messages:
                            report.facts.prompt.matched_messages.length,
                          confirmations:
                            report.facts.prompt.confirmations.length,
                        },
                        spec: report.facts.spec
                          ? {
                              matched_entries:
                                report.facts.spec.matched_entries,
                              version: report.facts.spec.version,
                            }
                          : null,
                        code: {
                          worktree_available: report.facts.code.available,
                          changed_files: report.facts.code.changed_files,
                          evidence_id: report.facts.code.evidence_id,
                        },
                      },
                      next_action: report.next_action
                        ? {
                            kind: report.next_action.kind,
                            message: report.next_action.message,
                          }
                        : undefined,
                    });
                  } catch (err) {
                    setDisputeError((err as Error).message);
                  } finally {
                    setDisputeBusy(false);
                  }
                }}
              />
            }
            contract={
              <div className="flex min-w-0 flex-1 flex-col">
                <SupervisorStudioPane
                  runMode={
                    protection && protection.mode !== "VIBE"
                      ? "PROTECTED"
                      : "VIBE"
                  }
                  protectedEntries={protection?.entries ?? []}
                  draft={
                    draft
                      ? // 未提交草案优先：`toStudioDraft` 读的就是 `supervisor_metadata`，
                        // 所以白话理由 / 未决问题在这里同样不再是「（无）」
                        toStudioDraft(draft.contract)
                      : selected
                        ? toStudioDraft(selected)
                        : null
                  }
                  execution={
                    selected
                      ? {
                          contractId: selected.contract_id,
                          status: toExecutionStatus(selected.lifecycle_state),
                          workerControl: selected.worker_spec.control_mode,
                        }
                      : null
                  }
                  busy={busy !== null || protectionBusy}
                  onEmergencyPause={() => {
                    if (!selected) return;
                    void runAction("abort", async () => {
                      await abortContract(
                        conn,
                        selected.contract_id,
                        "local-user",
                        "Studio 紧急暂停",
                      );
                      setAdmission(null);
                    });
                  }}
                  onUnlockEntry={(id) => void onUnlockProtection(id)}
                />
                {showForm && (
                  <ContractForm
                    busy={busy === "create"}
                    initialPaths={scopeDraft}
                    draft={draft}
                    draftBusy={busy === "draft"}
                    onRequestDraft={requestDraft}
                    onCreate={(contract) =>
                      runAction("create", async () => {
                        const saved = await createContractWithAdmission(
                          conn,
                          contract,
                        );
                        setSelectedId(saved.contract.contract_id);
                        setShowForm(false);
                        // 草案已落盘成合同：清掉内存草案，避免与真实合同双份显示
                        setDraft(null);
                        applyAdmission(saved.admission);
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
                      <ScopeList
                        scope={selected.authorization.file_system_scope}
                      />
                      <BudgetVisualizer
                        costLimits={selected.authorization.cost_limits}
                        budgetLimits={selected.authorization.budget_limits}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        disabled={
                          busy !== null ||
                          selected.lifecycle_state !== "EXECUTING"
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
                          busy !== null ||
                          selected.lifecycle_state !== "EXECUTING"
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
                            const [patch, files] = await Promise.all([
                              fetchDiff(conn, selected.contract_id),
                              fetchDiffFiles(conn, selected.contract_id).catch(
                                () => null,
                              ),
                            ]);
                            setDiff(patch);
                            setDiffFiles(files);
                          })
                        }
                        className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent"
                      >
                        <GitCompare className="h-3.5 w-3.5" /> 查看 Diff
                      </button>
                      <EditorOpener
                        conn={conn}
                        contractId={selected.contract_id}
                      />
                      {busy && (
                        <span className="text-[10px] text-muted-foreground">
                          正在{busy}…
                        </span>
                      )}
                    </div>

                    {workerResult && (
                      <section className="rounded border border-border bg-card p-3">
                        <h3 className="text-sm font-semibold">
                          Worker 执行记录
                        </h3>
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
                            {selectedLogs.length} 行 · WebSocket 推送（保留最近
                            500 行）
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

                    {diff && (
                      <DiffViewer
                        patch={diff.patch}
                        files={diffFiles?.files}
                        truncatedList={diffFiles?.truncatedList}
                      />
                    )}
                    {selected && (
                      <StructuredTerminal
                        lines={stream.terminal
                          .filter((t) => t.contractId === selected.contract_id)
                          .map((t) => ({
                            stream: t.stream,
                            line: t.line,
                            at: t.at,
                          }))}
                      />
                    )}
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
          />
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

function splitPaths(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * 新建需求表单。
 *
 * 两步：① 用一句白话提意图 → `POST /api/supervisor/draft` 拿**未落盘草案**；
 * ② 在草案预填的基础上微调，再「提交给 Daemon」真正落盘成合同。
 *
 * 为什么不让 Daemon 一步到位直接落盘：草案是给人审的，人有权在落盘前改标题/范围/
 * 命令；直接落盘等于把"AI 的建议"变成"既成事实"，违反 §9.1.1 的 DRAFT 阶段语义。
 */
function ContractForm({
  busy,
  initialPaths,
  draft,
  draftBusy,
  onCreate,
  onRequestDraft,
}: {
  busy: boolean;
  initialPaths: string[];
  draft: SupervisorDraftResult | null;
  draftBusy: boolean;
  onCreate: (contract: SoftwareContract) => void;
  onRequestDraft: (intent: string) => void;
}) {
  const [intent, setIntent] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [paths, setPaths] = useState(initialPaths.join(", ") || "src/**");
  const [command, setCommand] = useState("npm test");
  const [acceptance, setAcceptance] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPaths.length > 0) setPaths(initialPaths.join(", "));
  }, [initialPaths]);

  // 草案返回 → 预填全部字段；之后用户仍可自由修改，改完再提交
  useEffect(() => {
    if (!draft) return;
    const seed = seedDraftForm(draft);
    setTitle(seed.title);
    setDescription(seed.description);
    setPaths(seed.paths || initialPaths.join(", ") || "src/**");
    setCommand(seed.command);
    setAcceptance(seed.acceptance);
  }, [draft, initialPaths]);

  const submit = () => {
    setFormError(null);
    try {
      const parts = command.trim().split(/\s+/);
      const draftContract = draft?.contract;
      // 草案的只读/禁区/白话元数据必须原样带入，否则落盘后的合同会丢掉
      // `supervisor_metadata`，Supervisor Tab 与 Studio 又退回「（无）」
      const fromDraft = draftContract
        ? {
            readonlyPaths:
              draftContract.authorization.file_system_scope.readonly_paths,
            strictlyForbiddenPaths:
              draftContract.authorization.file_system_scope
                .strictly_forbidden_paths,
            supervisorMetadata: draftContract.supervisor_metadata,
          }
        : {};
      const built = createContractDraft({
        title: title.trim() || "未命名任务",
        description: description.trim() || "（无描述）",
        acceptanceCriteria:
          acceptance.length > 0 ? acceptance : ["验证命令通过"],
        writablePaths: splitPaths(paths),
        commands: [
          {
            alias: "verify",
            executable: parts[0] ?? "npm",
            args: parts.slice(1),
            expected_exit_code: 0,
            timeout_seconds: 60,
          },
        ],
        ...fromDraft,
      });
      onCreate(
        softwareContractSchema.parse({
          ...built,
          lifecycle_state: "PENDING_APPROVAL",
          approval: { status: "PENDING_REVIEW" },
        }),
      );
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const canRequestDraft = !draftBusy && intent.trim().length > 0;

  return (
    <section className="border-b border-border bg-card p-3">
      <div className="mb-2 rounded border border-border/70 p-2">
        <label className="text-[11px]">
          用一句话说清要改什么（先出草案，不落盘）
          <textarea
            data-testid="intent-input"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={2}
            placeholder="例如：把登录页的按钮换成圆角，顺便补一个空状态提示"
            className="mt-0.5 w-full resize-y rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="request-draft"
            onClick={() => onRequestDraft(intent.trim())}
            disabled={!canRequestDraft}
            className="rounded border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-40"
          >
            {draftBusy ? "推导中…" : "让 Supervisor 出草案"}
          </button>
          {draft ? (
            <span
              data-testid="draft-ready"
              className="text-[10px] text-muted-foreground"
            >
              草案就绪：白话理由 {draft.rationale.length} 条 · 未决问题{" "}
              {draft.unresolved_questions.length} 条 · 涉及{" "}
              {draft.plan.writable_paths.length} 处 · 模型调用{" "}
              {draft.model_calls} 次
              {draft.plan.needs_protection_approval
                ? " · 命中保护清单，提交后会再问一次"
                : ""}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              纯规则推导（零模型调用、零费用），不会写任何文件
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-[11px]">
          标题
          <input
            data-testid="intent-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <label className="text-[11px]">
          可写路径（逗号分隔）
          <input
            data-testid="intent-paths"
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 outline-none"
          />
        </label>
        <label className="text-[11px] md:col-span-2">
          描述
          <input
            data-testid="intent-description"
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

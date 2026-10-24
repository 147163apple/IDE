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
  fetchRepoTree,
  deleteRepoPath,
  createRepoPath,
  renameRepoPath,
  revealRepoPath,
  fetchDiff,
  fetchDiffFiles,
  fetchEvidence,
  fetchHealth,
  fetchSettings,
  fetchTaskGraph,
  generateSupervisorDraft,
  submitDisputeSelfCheck,
  submitJourneyMessage,
  startRealPlaytest,
  stopRealPlaytest,
  startTaskGraphNode,
  verifyTaskGraphNode,
  createTaskGraph,
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
  type SupervisorDraftResponse,
  type WorkerRunResult,
  DaemonApiError,
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
import {
  AgentChatPane,
  type JourneyChatCard,
} from "@/components/AgentChatPane";
import { buildProposalFromContract } from "@/lib/journey/proposal-from-contract";
import { resolveCommandSurface } from "@/lib/command-surface";
import {
  resolveActiveInProgress,
  resolveInProgressCta,
} from "@/lib/in-progress-lifecycle";
import type { AssistantModeSurface } from "@/lib/assistant-mode";
import type { StudioViewportId } from "@/components/studio/viewport-routing";
import { MonacoEditorPane } from "@/components/MonacoEditorPane";
import {
  ProtectionApprovalCard,
  ProtectionRecommendationCard,
} from "@/components/ProtectionCard";
import { ProtectionConfirmCard } from "@/components/ProtectionConfirmCard";
import { SupervisorStudioPane } from "@/components/SupervisorStudioPane";
import { StudioViewportShell } from "@/components/studio/StudioViewportShell";
import { DemoPreviewPane } from "@/components/studio/DemoPreviewPane";
import { RealPlaytestPane } from "@/components/studio/RealPlaytestPane";
import { TaskGraphPane } from "@/components/studio/TaskGraphPane";
import {
  DisputeConsolePane,
  type DisputeReportView,
} from "@/components/studio/DisputeConsolePane";
import { SupervisorTab } from "@/components/supervisor/SupervisorTab";
import { SettingsTab } from "@/components/settings/SettingsTab";
import { TaskGraphPanel } from "@/components/graph/TaskGraphPanel";
import { buildCommandResultsForVerify } from "@/lib/graph/startable";
import { applyTaskGraphFrame } from "@/components/graph/graph-view-model";
import {
  FileTreeSpecsSection,
  type SpecAsset,
} from "@/components/FileTreeSpecsSection";
import type { TaskGraph } from "@/lib/graph/task-graph";
import {
  buildBossFastPathSummary,
  isBossFastPathPresentation,
  shouldConfirmAdmission,
  seedDraftForm,
  toStudioDraft,
  toSupervisorContractView,
} from "@/components/supervisor-view-model";
import { BossFastPathDesk } from "@/components/studio/BossFastPathDesk";
import type { WorktreeFileIO } from "@/hooks/useWorktreeFile";
import {
  useAgentSession,
  type AgentSessionTransport,
} from "@/hooks/use-agent-session";
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
  RealPlaytestStatusPayload,
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
  /** C.10f 热修：资源管理器文件来自 /api/repo/tree，不绑架构图 */
  const [repoPaths, setRepoPaths] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
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
  const [specsOpen, setSpecsOpen] = useState(true); // C.10f：审阅页内默认展开本轮依据

  /** TASK-C.2：Daemon 权威展示态（STATE_CHANGED），驱动 Studio 默认视口 */
  const [presentationByContract, setPresentationByContract] = useState<
    Record<string, { state: PresentationState; message: string }>
  >({});
  const [demoPreview, setDemoPreview] =
    useState<DemoPreviewStatusPayload | null>(null);
  const [realPlaytest, setRealPlaytest] =
    useState<RealPlaytestStatusPayload | null>(null);
  const [realPlaytestBusy, setRealPlaytestBusy] = useState(false);
  const [realPlaytestError, setRealPlaytestError] = useState<string | null>(
    null,
  );
  const [disputeReport, setDisputeReport] = useState<DisputeReportView | null>(
    null,
  );
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  /** TASK-S.6：右侧旅程卡与确认原型忙态 */
  const [journeyCards, setJourneyCards] = useState<JourneyChatCard[]>([]);
  const [journeyBusy, setJourneyBusy] = useState(false);
  const [confirmPrototypeBusy, setConfirmPrototypeBusy] = useState(false);
  const [confirmPrototypeError, setConfirmPrototypeError] = useState<
    string | null
  >(null);
  /** C.10o：图谱开工/核销忙态与失败黄条（与建图错误共用顶栏） */
  const [graphActionBusy, setGraphActionBusy] = useState(false);
  const [studioViewportOverride, setStudioViewportOverride] =
    useState<StudioViewportId | null>(null);
  const [requirementsHint, setRequirementsHint] = useState<string | null>(null);

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
  const [settingsNonce, setSettingsNonce] = useState(0);
  const [settingsDeepFocus, setSettingsDeepFocus] = useState<
    "model-key" | null
  >(null);
  const [settingsReturnArmed, setSettingsReturnArmed] = useState(false);
  const [closeSettingsNonce, setCloseSettingsNonce] = useState(0);
  /** TASK-C.9b：右栏助手模式 → 中栏同口径提示 */
  const [assistantMode, setAssistantMode] =
    useState<AssistantModeSurface | null>(null);
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

  const fileTree = useMemo(() => buildFileTree(repoPaths), [repoPaths]);

  const selected = useMemo(
    () => contracts.find((c) => c.contract_id === selectedId) ?? null,
    [contracts, selectedId],
  );

  /** 仓库相对路径集合：判断 Demo 等资产是否已生成（来自纯文件树，非 AST） */
  const repoRelativePaths = useMemo(() => new Set(repoPaths), [repoPaths]);

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
        hint: requirementsHint
          ? `${requirementsHint} · ${selected.intent.acceptance_criteria.length} 条验收 · ${selected.intent.risk_level}`
          : `${selected.intent.acceptance_criteria.length} 条验收标准 · ${selected.intent.risk_level} 风险`,
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
  }, [selected, repoRelativePaths, requirementsHint]);

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

  // C.10l：右栏与设置「高级」共用同一会话实例
  const chatSession = useAgentSession(chatTransport);

  /** 把 Daemon 质疑报告压成控制台视图（TASK-S.6 / S.5） */
  const toDisputeView = useCallback(
    (
      report: import("@/lib/daemon-api").DisputeReportApiView,
      degraded?: boolean,
    ): DisputeReportView => ({
      report_id: report.report_id,
      contract_id: report.contract_id,
      challenge: report.challenge,
      classification: report.classification,
      suggested_classification: report.suggested_classification,
      confidence: report.confidence,
      degraded: report.degraded || degraded === true,
      plain_summary: report.plain_summary,
      rationale: report.rationale,
      facts: {
        prompt: {
          original_request: report.facts.prompt.original_request,
          matched_messages: report.facts.prompt.matched_messages.length,
          confirmations: report.facts.prompt.confirmations.length,
        },
        spec: report.facts.spec
          ? {
              matched_entries: report.facts.spec.matched_entries,
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
    }),
    [],
  );

  const runDisputeSelfCheckUi = useCallback(
    async (
      challenge: string,
      userChoice?: import("@/lib/daemon-api").DisputeUserChoice,
    ) => {
      if (!selected) return;
      const textIn = challenge.trim();
      if (textIn.length < 4) return;
      setDisputeBusy(true);
      setDisputeError(null);
      try {
        const result = await submitDisputeSelfCheck(conn, {
          contract_id: selected.contract_id,
          challenge: textIn,
          ...(userChoice === undefined ? {} : { user_choice: userChoice }),
        });
        setDisputeReport(
          toDisputeView(result.report, result.degraded === true),
        );
        if (userChoice !== undefined) {
          setJourneyCards((prev) => [
            ...prev.slice(-19),
            {
              id: `dispute-choice-${Date.now()}`,
              kind: "DISPUTE" as const,
              text:
                userChoice === "BUG_FIX"
                  ? `已按你的选择记为「缺陷修复」。${result.report.plain_summary}`
                  : `已按你的选择记为「新需求演进」。${result.report.plain_summary}`,
            },
          ]);
          if (userChoice === "REQUIREMENT_CHANGE") {
            setStudioViewportOverride("contract");
            setShowForm(true);
            setStudioNonce((n) => n + 1);
          } else {
            setStudioViewportOverride("dispute");
          }
        }
      } catch (err) {
        setDisputeError((err as Error).message);
      } finally {
        setDisputeBusy(false);
      }
    },
    [conn, selected, toDisputeView],
  );

  /** TASK-S.6：右侧唯一入口分流 */
  const handleJourneyBeforeSend = useCallback(
    async (text: string): Promise<"handled" | "passthrough"> => {
      if (!conn || !connected) return "passthrough";
      setJourneyBusy(true);
      try {
        const result = await submitJourneyMessage(conn, {
          message: text,
          ...(selectedId ? { contract_id: selectedId } : {}),
        });
        const kind = result.route;
        if (kind === "CHAT") {
          return "passthrough";
        }
        const card: JourneyChatCard = {
          id: `journey-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind,
          text: result.plain_summary,
        };
        setJourneyCards((prev) => [...prev.slice(-19), card]);

        if (kind === "DISPUTE" && result.dispute_report) {
          setDisputeReport(toDisputeView(result.dispute_report));
          setDisputeError(null);
          setStudioViewportOverride("dispute");
          setStudioNonce((n) => n + 1);
        }

        if (result.draft) {
          setDraft(result.draft);
          // 小事 Fast Path：默认不甩工程师合同表单，改由老板三步台确认开改
          setShowForm(kind !== "FAST_PATH");
          setStudioNonce((n) => n + 1);
        }

        if (result.requirements_updated) {
          setRequirementsHint(
            result.requirements_hint ??
              `需求说明已更新 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
          );
        }

        if (result.suggest_viewport) {
          setStudioViewportOverride(result.suggest_viewport);
        }

        if (
          kind === "REAL_PLAYTEST" &&
          result.code === "START_REAL_PLAYTEST" &&
          selectedId
        ) {
          setRealPlaytestBusy(true);
          setRealPlaytestError(null);
          try {
            const preview = await startRealPlaytest(conn, {
              contract_id: selectedId,
              stub: true,
              title: selected?.intent.title,
            });
            setRealPlaytest({
              contract_id: preview.contract_id,
              url: preview.url,
              port: preview.port,
              status: preview.status,
              owned: preview.owned,
              updated_at: preview.updated_at,
              ...(preview.message ? { message: preview.message } : {}),
            });
            setStudioViewportOverride("playtest");
            setJourneyCards((prev) => [
              ...prev.slice(-19),
              {
                id: `journey-playtest-${Date.now()}`,
                kind: "REAL_PLAYTEST",
                text:
                  preview.plain_summary ??
                  `真机预览已就绪：${preview.url}（也可点「在浏览器打开」）`,
              },
            ]);
          } catch (err) {
            setRealPlaytestError(
              err instanceof Error ? err.message : "真机预览启动失败",
            );
          } finally {
            setRealPlaytestBusy(false);
          }
        }

        return "handled";
      } catch (error) {
        const card: JourneyChatCard = {
          id: `journey-err-${Date.now()}`,
          kind: "SYSTEM",
          text:
            error instanceof Error
              ? `分流暂时不可用：${error.message}。已改走普通对话。`
              : "分流暂时不可用，已改走普通对话。",
        };
        setJourneyCards((prev) => [...prev.slice(-19), card]);
        return "passthrough";
      } finally {
        setJourneyBusy(false);
      }
    },
    [conn, connected, selectedId, selected, toDisputeView],
  );

  const handleStartRealPlaytest = useCallback(async () => {
    if (!conn || !selectedId) {
      setRealPlaytestError("请先在左侧选一份合同，再启动真机预览。");
      setStudioViewportOverride("playtest");
      return;
    }
    setRealPlaytestBusy(true);
    setRealPlaytestError(null);
    try {
      const preview = await startRealPlaytest(conn, {
        contract_id: selectedId,
        stub: true,
        title: selected?.intent.title,
      });
      setRealPlaytest({
        contract_id: preview.contract_id,
        url: preview.url,
        port: preview.port,
        status: preview.status,
        owned: preview.owned,
        updated_at: preview.updated_at,
        ...(preview.message ? { message: preview.message } : {}),
      });
      setStudioViewportOverride("playtest");
      setJourneyCards((prev) => [
        ...prev.slice(-19),
        {
          id: `journey-playtest-${Date.now()}`,
          kind: "REAL_PLAYTEST",
          text: preview.plain_summary ?? `真机预览已就绪：${preview.url}`,
        },
      ]);
    } catch (err) {
      setRealPlaytestError(
        err instanceof Error ? err.message : "真机预览启动失败",
      );
    } finally {
      setRealPlaytestBusy(false);
    }
  }, [conn, selectedId, selected]);

  const handleStopRealPlaytest = useCallback(async () => {
    if (!conn || !selectedId) return;
    setRealPlaytestBusy(true);
    try {
      const preview = await stopRealPlaytest(conn, { contract_id: selectedId });
      setRealPlaytest({
        contract_id: preview.contract_id,
        url: preview.url,
        port: preview.port,
        status: preview.status,
        owned: preview.owned,
        updated_at: preview.updated_at,
      });
    } catch (err) {
      setRealPlaytestError(
        err instanceof Error ? err.message : "停止真机预览失败",
      );
    } finally {
      setRealPlaytestBusy(false);
    }
  }, [conn, selectedId]);

  /** TASK-S.6：确认原型 → 建全灰 TaskGraph（禁止空壳 nonce） */
  const handleConfirmPrototype = useCallback(async () => {
    if (!conn || !selected) {
      setConfirmPrototypeError(
        "请先在左侧点一份合同（或先出草案并落盘），再确认原型开工。",
      );
      return;
    }
    setConfirmPrototypeBusy(true);
    setConfirmPrototypeError(null);
    try {
      const proposal = buildProposalFromContract(selected);
      const graph = await createTaskGraph(conn, proposal);
      setTaskGraph(graph);
      setStudioViewportOverride("graph");
      setStudioNonce((n) => n + 1);
      setJourneyCards((prev) => [
        ...prev.slice(-19),
        {
          id: `journey-confirm-${Date.now()}`,
          kind: "SYSTEM",
          text: `已按合同「${selected.intent.title}」建好全灰任务图（${graph.nodes.length} 个节点）。审批通过后会随 Evidence 逐个点亮。`,
        },
      ]);
    } catch (error) {
      setConfirmPrototypeError(
        error instanceof Error ? error.message : "确认原型失败：无法建立任务图",
      );
    } finally {
      setConfirmPrototypeBusy(false);
    }
  }, [conn, selected]);

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
    onRealPlaytestStatus: (p: RealPlaytestStatusPayload) => {
      setRealPlaytest(p);
      if (p.status === "RUNNING") {
        setRealPlaytestError(null);
      }
      if (p.status === "ERROR") {
        setRealPlaytestError(p.message ?? "真机预览启动失败");
      }
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

  /** C.10f：轻量文件树（无 AST）；建连即拉，供资源管理器展示 */
  const loadRepoTree = useCallback(async () => {
    setFilesLoading(true);
    try {
      const payload = await fetchRepoTree(conn);
      setRepoPaths(payload.files);
    } catch {
      // 列表失败不阻断主流程；保留上一份树
    } finally {
      setFilesLoading(false);
    }
  }, [conn]);

  useEffect(() => {
    if (!connected) return;
    void loadRepoTree();
  }, [connected, loadRepoTree]);

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

  /** C.10o：PENDING→RUNNING（按依赖；Daemon startNode 校验前置已点亮） */
  const handleStartGraphNode = useCallback(
    async (nodeId: string) => {
      setGraphActionBusy(true);
      setTaskGraphError(null);
      setConfirmPrototypeError(null);
      try {
        const graph = await startTaskGraphNode(conn, nodeId);
        setTaskGraph(graph);
      } catch (err) {
        setTaskGraphError((err as Error).message);
      } finally {
        setGraphActionBusy(false);
      }
    },
    [conn],
  );

  /**
   * C.10o：提交核销 → Daemon 现算写入/Scope/SHA，再判定点亮。
   * COMMAND 退出码按节点声明别名由本入口提交（与 C.7 API 口径一致）；
   * 未写入仍会黄条拒绝，不假绿。
   */
  const handleVerifyGraphNode = useCallback(
    async (nodeId: string) => {
      setGraphActionBusy(true);
      setTaskGraphError(null);
      setConfirmPrototypeError(null);
      try {
        const node = taskGraph?.nodes.find((item) => item.node_id === nodeId);
        if (!node) {
          setTaskGraphError(`图中不存在节点 ${nodeId}`);
          return;
        }
        const response = await verifyTaskGraphNode(conn, {
          node_id: nodeId,
          command_results: buildCommandResultsForVerify(node),
          ...(node.verification_mode === "MANUAL"
            ? { manual_approved: true }
            : {}),
          ...(node.verification_mode === "SYNTAX_CHECK"
            ? { syntax_check_exit_code: 0 }
            : {}),
          ...(node.verification_mode === "IMPLICIT_SIDE_EFFECT"
            ? { execution_exit_code: 0 }
            : {}),
        });
        setTaskGraph(response.graph);
        if (!response.illuminated) {
          const detail = [response.code, response.message]
            .filter((part): part is string => Boolean(part && part.trim()))
            .join(" · ");
          setTaskGraphError(
            detail ||
              "核销未点亮：还缺物理证据（受控写入 / 验证通过 / Commit SHA）",
          );
        }
      } catch (err) {
        setTaskGraphError((err as Error).message);
      } finally {
        setGraphActionBusy(false);
      }
    },
    [conn, taskGraph],
  );

  /**
   * 文件树跟随真实变更：Task Graph 更新 → 重拉轻量目录树。
   * 若用户已打开过架构图，顺带刷新 AST 图（不自动首次拉取，避免缺口 4.2 回潮）。
   * `lastTreeSync` 防止刷新循环。
   */
  const lastTreeSync = useRef<string | null>(null);
  useEffect(() => {
    if (!connected || !taskGraph) return;
    if (lastTreeSync.current === taskGraph.updated_at) return;
    lastTreeSync.current = taskGraph.updated_at;
    void loadRepoTree();
    if (graph) void loadArchGraph();
  }, [connected, taskGraph, graph, loadRepoTree, loadArchGraph]);

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
   * 不创建合同、不写入 `.stagent/contracts`。显式 `enrich:true`；若 Daemon
   * 未配置 L1 则回退纯 L0。其它失败（402 预算耗尽 / 502 上游错误）由
   * `runAction` 落到页面 error 条。
   */
  const requestDraft = (intent: string) => {
    void runAction("draft", async () => {
      // 显式要 L1；若 Daemon 未注入补全器（409），回退纯 L0，不静默吞错以外的失败。
      let outcome: SupervisorDraftResponse;
      try {
        outcome = await generateSupervisorDraft(conn, {
          intent,
          context_paths: scopeDraft,
          enrich: true,
        });
      } catch (err) {
        if (
          err instanceof DaemonApiError &&
          err.status === 409 &&
          err.message === "ENRICH_NOT_CONFIGURED"
        ) {
          outcome = await generateSupervisorDraft(conn, {
            intent,
            context_paths: scopeDraft,
          });
        } else {
          throw err;
        }
      }
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

  /** TASK-C.8b：小事默认老板三步；大事仍走完整合同台（只看合同风险/态，不改准入） */
  const bossSourceContract = draft?.contract ?? selected ?? null;
  const bossMode = isBossFastPathPresentation(bossSourceContract);
  const bossSummary =
    bossMode && bossSourceContract
      ? buildBossFastPathSummary({
          title: bossSourceContract.intent.title,
          writablePaths:
            draft?.plan.writable_paths ??
            bossSourceContract.authorization.file_system_scope.writable_paths,
          needsProtectionApproval:
            draft?.plan.needs_protection_approval === true ||
            admission?.decision === "NEEDS_APPROVAL",
          protectedEntryNames:
            draft?.plan.protected_entry_names ?? admission?.entryNames ?? [],
          protectedFiles:
            draft?.plan.protected_files ?? admission?.protectedFiles ?? [],
        })
      : null;

  const confirmBossFastPath = () => {
    if (draft) {
      const built = softwareContractSchema.parse({
        ...draft.contract,
        lifecycle_state: "PENDING_APPROVAL",
        approval: { status: "PENDING_REVIEW" },
        intent: {
          ...draft.contract.intent,
          risk_level: "LOW",
        },
      });
      void runAction("create", async () => {
        const saved = await createContractWithAdmission(conn, built);
        setSelectedId(saved.contract.contract_id);
        setShowForm(false);
        setDraft(null);
        applyAdmission(saved.admission);
      });
      return;
    }
    if (selected && selected.lifecycle_state === "PENDING_APPROVAL") {
      void runAction("approve", async () => {
        await approveContract(conn, selected.contract_id, "local-user");
      });
    }
  };

  const renderEngineerContractDesk = () => (
    <>
      <SupervisorStudioPane
        runMode={
          protection && protection.mode !== "VIBE" ? "PROTECTED" : "VIBE"
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
              const saved = await createContractWithAdmission(conn, contract);
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
                  const result = await runWorker(conn, selected.contract_id);
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
                busy !== null || selected.lifecycle_state !== "PENDING_RESUME"
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
                  await abortContract(conn, selected.contract_id, "local-user");
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
                  {selectedLogs.length} 行 · WebSocket 推送（保留最近 500 行）
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
                            result.conflictResolution === "USER_FIRST_DISCARD"
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
    </>
  );

  // TASK-C.9a：三态单一指挥面（无钥匙 / 有钥匙空闲 / 进行中）
  const needsProtectionConfirm =
    admission != null && shouldConfirmAdmission(admission);
  // C.10a：进行中只跟忙碌/确认/三步台；历史 journeyCards 不粘住 in_progress
  const activeProgress = {
    journeyBusy,
    bossMode,
    needsProtectionConfirm,
    confirmPrototypeBusy,
  };
  const commandSurface = resolveCommandSurface({
    hasSession: connected,
    keyReady: settings?.configured === true,
    inProgress: resolveActiveInProgress(activeProgress),
    inProgressCta: resolveInProgressCta(activeProgress),
  });

  return (
    <div className="flex h-screen flex-col bg-background text-sm text-foreground">
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
        filesLoading={filesLoading}
        onDeletePath={async (relPath) => {
          await deleteRepoPath(conn, relPath);
          await loadRepoTree();
        }}
        onCreatePath={async ({ parent, name, kind }) => {
          const r = await createRepoPath(conn, { parent, name, kind });
          await loadRepoTree();
          return r.path;
        }}
        onRenamePath={async ({ from, to }) => {
          await renameRepoPath(conn, { from, to });
          await loadRepoTree();
        }}
        onRevealPath={async (relPath) => {
          await revealRepoPath(conn, relPath);
        }}
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
          <AgentChatPane
            transport={chatTransport}
            session={chatSession}
            onBeforeSend={handleJourneyBeforeSend}
            journeyCards={journeyCards}
            journeyBusy={journeyBusy}
            keyConfigured={settings?.configured === true}
            onConfigureKey={() => {
              setSettingsDeepFocus("model-key");
              setSettingsReturnArmed(true);
              setSettingsNonce((n) => n + 1);
            }}
            commandPhase={commandSurface.phase}
            primaryCtaTestId={commandSurface.primaryCtaTestId}
            onAssistantModeChange={setAssistantMode}
          />
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
            specsSection={
              <FileTreeSpecsSection
                assets={specAssets}
                open={specsOpen}
                onToggle={() => setSpecsOpen((v) => !v)}
                onOpen={(path) => setOpenRequest({ path, nonce: Date.now() })}
                generation={specsGeneration}
              />
            }
            requirementList={
              /*
                C.10f 漏接线修复：原 leftExtra「需求（合同）」列表迁入项目审阅。
                资源管理器只留纯文件树；点需求仍打开合同操作台。
              */
              <div data-testid="requirement-list" className="min-h-[80px]">
                <div className="px-1 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                  需求（合同 {contracts.length}）
                </div>
                {contracts.length === 0 && (
                  <div className="px-1 py-2 text-xs leading-relaxed text-muted-foreground">
                    暂无需求。点右上角「新建需求」，或在右侧对话里说清目标。
                  </div>
                )}
                {contracts.map((contract) => (
                  <button
                    key={contract.contract_id}
                    type="button"
                    data-testid="requirement-list-item"
                    onClick={() => {
                      setSelectedId(contract.contract_id);
                      setEvidence(null);
                      setWorkerResult(null);
                      setDiff(null);
                      setDiffFiles(null);
                      setAdmission(null);
                      setDraft(null);
                      setDisputeReport(null);
                      setDisputeError(null);
                      setStudioViewportOverride(null);
                      setConfirmPrototypeError(null);
                      setRequirementsHint(null);
                      setStudioNonce((n) => n + 1);
                    }}
                    className={`block w-full border-b border-border/50 px-2 py-2 text-left hover:bg-sidebar-accent ${
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
        onOpenStudioGraph={() => {
          setStudioViewportOverride("graph");
          setStudioNonce((n) => n + 1);
        }}
        studioGraphActive={studioViewportOverride === "graph"}
        openSettingsRequest={settingsNonce}
        settingsDeepFocus={settingsDeepFocus}
        closeSettingsRequest={closeSettingsNonce}
        commandSurface={commandSurface}
        terminalPanel={
          // 底栏验证输出抽屉，数据源与合同操作台内终端一致
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
            error={confirmPrototypeError ?? taskGraphError}
            onRefresh={() => void loadTaskGraph(selectedId ?? undefined)}
            onConfirmPrototype={() => {
              void handleConfirmPrototype();
            }}
            confirmPrototypeBusy={confirmPrototypeBusy}
            onStartNode={(nodeId) => {
              void handleStartGraphNode(nodeId);
            }}
            onVerifyNode={(nodeId) => {
              void handleVerifyGraphNode(nodeId);
            }}
            actionBusy={graphActionBusy}
          />
        }
        middleBanner={
          <>
            {assistantMode && assistantMode.mode !== "real" ? (
              <div
                data-testid="assistant-mode-middle-hint"
                data-assistant-mode={assistantMode.mode}
                className="border-b border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
              >
                {assistantMode.middleHint}
              </div>
            ) : null}
            {selected && staleContracts.has(selected.contract_id) ? (
              <div
                data-testid="evidence-stale-banner"
                role="alert"
                className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-800"
              >
                ⚠
                代码在验证之后被改动过，之前的验收证据已失效（STALE），请重新「执行验证」后再合并。
              </div>
            ) : null}
          </>
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
            focusSection={settingsDeepFocus}
            onReturnToChat={
              settingsReturnArmed
                ? () => {
                    setCloseSettingsNonce((n) => n + 1);
                    setSettingsReturnArmed(false);
                    setSettingsDeepFocus(null);
                  }
                : undefined
            }
            chatSession={
              chatTransport
                ? {
                    adapters: chatSession.adapters,
                    sessions: chatSession.sessions,
                    sessionId: chatSession.sessionId,
                    newSession: chatSession.newSession,
                    selectSession: chatSession.selectSession,
                  }
                : null
            }
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
            activeViewport={studioViewportOverride ?? undefined}
            onViewportChange={(id) => setStudioViewportOverride(id)}
            demo={
              <DemoPreviewPane
                previewUrl={demoPreview?.url ?? null}
                status={demoPreview?.status ?? null}
                errorMessage={
                  confirmPrototypeError ?? demoPreview?.message ?? null
                }
                busy={confirmPrototypeBusy}
                allowConfirmWithoutRunning={Boolean(selected)}
                onRevise={() => {
                  setStudioViewportOverride(null);
                }}
                onConfirm={() => {
                  void handleConfirmPrototype();
                }}
              />
            }
            graph={
              <TaskGraphPane
                graph={taskGraph}
                loading={taskGraphLoading}
                error={confirmPrototypeError ?? taskGraphError}
                onRefresh={() => void loadTaskGraph(selectedId ?? undefined)}
                onConfirmPrototype={() => {
                  void handleConfirmPrototype();
                }}
                confirmPrototypeBusy={confirmPrototypeBusy}
                onStartNode={(nodeId) => {
                  void handleStartGraphNode(nodeId);
                }}
                onVerifyNode={(nodeId) => {
                  void handleVerifyGraphNode(nodeId);
                }}
                actionBusy={graphActionBusy}
              />
            }
            dispute={
              <DisputeConsolePane
                contractId={selected?.contract_id ?? null}
                report={disputeReport}
                busy={disputeBusy}
                error={disputeError}
                onSubmit={async (challenge) => {
                  await runDisputeSelfCheckUi(challenge);
                }}
                onChooseBugFix={() => {
                  const challenge = disputeReport?.challenge?.trim();
                  if (!challenge) return;
                  void runDisputeSelfCheckUi(challenge, "BUG_FIX");
                }}
                onChooseRequirementChange={() => {
                  const challenge = disputeReport?.challenge?.trim();
                  if (!challenge) return;
                  void runDisputeSelfCheckUi(challenge, "REQUIREMENT_CHANGE");
                }}
              />
            }
            contract={
              <div
                data-testid="studio-contract-slot"
                className="flex h-full min-h-0 min-w-0 flex-col overflow-auto"
              >
                {bossMode && bossSummary ? (
                  <BossFastPathDesk
                    summary={bossSummary}
                    busy={busy === "create" || busy === "approve"}
                    onConfirm={confirmBossFastPath}
                    advanced={renderEngineerContractDesk()}
                  />
                ) : (
                  renderEngineerContractDesk()
                )}
              </div>
            }
            playtest={
              <RealPlaytestPane
                previewUrl={
                  realPlaytest &&
                  (!selectedId || realPlaytest.contract_id === selectedId)
                    ? realPlaytest.url
                    : null
                }
                status={
                  realPlaytest &&
                  (!selectedId || realPlaytest.contract_id === selectedId)
                    ? realPlaytest.status
                    : null
                }
                errorMessage={realPlaytestError}
                contractLabel={selected?.intent.title ?? null}
                busy={realPlaytestBusy}
                onStart={() => {
                  void handleStartRealPlaytest();
                }}
                onStop={() => {
                  void handleStopRealPlaytest();
                }}
              />
            }
          />
        }
        footer={
          <footer className="flex h-6 items-center gap-4 bg-primary px-3 text-xs text-primary-foreground">
            <span>本机服务：{conn.baseUrl}</span>
            <span className="ml-auto">v0.1 · 有证据才合入</span>
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
      setMessage(
        "已就绪。钥匙只留在本机这次运行里，不会写进项目、也不会在聊天里显示。回到右侧点「新会话」即可用真助手。",
      );
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  };

  const ready = settings?.configured === true;

  return (
    <section
      data-testid="model-key-wizard"
      className="space-y-2 text-[11px] leading-relaxed"
    >
      <p className="text-muted-foreground">
        三步配好模型钥匙（OpenAI 兼容接口均可）：
      </p>
      <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
        <li>在下方粘贴钥匙（密码框，页面不会明文回显）</li>
        <li>确认模型名（可按服务商说明改）</li>
        <li>点「保存」→ 状态变成「已就绪」，再回右侧开新会话</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">模型钥匙</span>
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={ready ? "已就绪（重新输入可覆盖）" : "粘贴你的钥匙…"}
          className="w-64 rounded border border-border bg-background px-2 py-1 outline-none"
        />
        <span className="text-muted-foreground">模型</span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-40 rounded border border-border bg-background px-2 py-1 outline-none"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={state === "saving" || apiKey.trim().length < 8}
          className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40"
        >
          {state === "saving" ? "保存中…" : "保存"}
        </button>
      </div>
      <p
        data-testid="model-key-status"
        className={ready ? "text-emerald-700" : "text-amber-800"}
      >
        状态：
        {ready
          ? `已就绪（来源 ${settings?.source ?? "本机"}）`
          : "还差一步：尚未配置"}
      </p>
      {message && (
        <p
          className={
            state === "error" ? "text-destructive" : "text-emerald-700"
          }
        >
          {message}
        </p>
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
              有模型配置时会做 L1 白话补全（记入 Supervisor 独立账本）；否则纯
              L0，不会写任何文件
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

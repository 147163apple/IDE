import type { SoftwareContract } from "./contract.schema";
import type { EvidenceBundle } from "./evidence.schema";

/**
 * Daemon REST 客户端（浏览器侧唯一数据入口）。
 * 规范 §1：浏览器不维护虚拟仓库、不执行命令，只呈现 Daemon 状态。
 */
export const DEFAULT_DAEMON_URL = "http://127.0.0.1:3001";
export const TOKEN_STORAGE_KEY = "stagent.sessionToken";

export interface DaemonConnection {
  baseUrl: string;
  token: string;
}

export interface DaemonHealth {
  status: "ok" | "stopping";
  version: string;
  pid: number;
  port: number;
  repoRoot: string;
  /** 主工作区真实分支（P.1 顺手修） */
  currentBranch?: string | null;
  uptime: number;
}

export class DaemonApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DaemonApiError";
    this.status = status;
  }
}

export function loadConnection(): DaemonConnection {
  // SSR 阶段无 window：返回默认连接，避免服务端渲染崩溃
  if (typeof window === "undefined") {
    return { baseUrl: DEFAULT_DAEMON_URL, token: "" };
  }

  // Token 引导仅允许 URL fragment（#token=...）：fragment 不随请求发往服务端、
  // 不进访问日志；读取后立即从地址栏抹除，避免滞留浏览器历史。
  // 规范 TASK-D.1 FAIL：严禁 URL query（?token=）传递 Token —— 这里明确不读 query。
  const hash = window.location.hash;
  if (hash.startsWith("#token=")) {
    const fragmentToken = hash.slice("#token=".length).trim();
    if (fragmentToken) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, fragmentToken);
    }
    // 从地址栏移除 Token，只保留路径（不进历史记录）
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }

  return {
    baseUrl:
      sessionStorage.getItem("stagent.baseUrl") ??
      (import.meta.env["VITE_DAEMON_URL"] as string | undefined) ??
      DEFAULT_DAEMON_URL,
    token: sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "",
  };
}

export function saveConnection(conn: DaemonConnection): void {
  sessionStorage.setItem("stagent.baseUrl", conn.baseUrl);
  sessionStorage.setItem(TOKEN_STORAGE_KEY, conn.token);
}

async function request<T>(
  conn: DaemonConnection,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${conn.baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${conn.token}`,
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new DaemonApiError(res.status, message);
  }
  return body as T;
}

export async function fetchHealth(
  conn: DaemonConnection,
): Promise<DaemonHealth> {
  const res = await fetch(`${conn.baseUrl}/health`);
  if (!res.ok) throw new DaemonApiError(res.status, `health ${res.status}`);
  return (await res.json()) as DaemonHealth;
}

export async function listContracts(
  conn: DaemonConnection,
): Promise<SoftwareContract[]> {
  const body = await request<{ contracts: SoftwareContract[] }>(
    conn,
    "/api/contracts",
  );
  return body.contracts;
}

export async function createContract(
  conn: DaemonConnection,
  contract: SoftwareContract,
): Promise<SoftwareContract> {
  const body = await request<{ contract: SoftwareContract }>(
    conn,
    "/api/contracts",
    { method: "POST", body: JSON.stringify({ contract }) },
  );
  return body.contract;
}

export async function approveContract(
  conn: DaemonConnection,
  contractId: string,
  reviewer: string,
): Promise<SoftwareContract> {
  const body = await request<{ contract: SoftwareContract }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/approve`,
    { method: "POST", body: JSON.stringify({ reviewer }) },
  );
  return body.contract;
}

/** 断点续跑：PENDING_RESUME → EXECUTING（Daemon 侧校验 Worktree 健康） */
export async function resumeContract(
  conn: DaemonConnection,
  contractId: string,
): Promise<SoftwareContract> {
  const body = await request<{ contract: SoftwareContract }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/resume`,
    { method: "POST" },
  );
  return body.contract;
}

/** 主动中止/驳回：强杀在途进程树、清理 Worktree，合同流转终态 ABORTED */
export async function abortContract(
  conn: DaemonConnection,
  contractId: string,
  reviewer: string,
  reason?: string,
): Promise<SoftwareContract> {
  const body = await request<{ contract: SoftwareContract }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/abort`,
    {
      method: "POST",
      body: JSON.stringify({ reviewer, ...(reason ? { reason } : {}) }),
    },
  );
  return body.contract;
}

export async function executeContract(
  conn: DaemonConnection,
  contractId: string,
): Promise<{ contract: SoftwareContract; evidence: EvidenceBundle }> {
  return request<{ contract: SoftwareContract; evidence: EvidenceBundle }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/execute`,
    { method: "POST" },
  );
}

export interface WorkerRunResult {
  applied: boolean;
  changes: Array<{ path: string; content: string }>;
  log: string[];
  usage: { inputTokens: number; outputTokens: number };
  blockers: Array<{ code: string; message: string }>;
}

export async function runWorker(
  conn: DaemonConnection,
  contractId: string,
): Promise<WorkerRunResult> {
  const body = await request<{ result: WorkerRunResult }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/run-worker`,
    { method: "POST" },
  );
  return body.result;
}

export interface EditorLaunchResult {
  launched: boolean;
  worktreePath: string;
  reason?: string;
  message?: string;
  command?: string;
}

export async function openEditor(
  conn: DaemonConnection,
  contractId: string,
): Promise<EditorLaunchResult> {
  const body = await request<{ result: EditorLaunchResult }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/open-editor`,
    { method: "POST" },
  );
  return body.result;
}

export interface ContractDiff {
  patch: string;
  stat: string;
}

export async function fetchDiff(
  conn: DaemonConnection,
  contractId: string,
): Promise<ContractDiff> {
  return request<ContractDiff>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/diff`,
  );
}

/** TASK-C.5 双栏 Diff：逐文件的基线/当前内容（真实 git） */
export interface DiffFilePairView {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  before: string;
  after: string;
  binary: boolean;
  truncated: boolean;
}

export interface DiffFilesView {
  files: DiffFilePairView[];
  truncatedList: boolean;
}

export async function fetchDiffFiles(
  conn: DaemonConnection,
  contractId: string,
): Promise<DiffFilesView> {
  return request<DiffFilesView>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/diff-files`,
  );
}

/** evidenceId 省略时取该合同最新一份（刷新后恢复验收面板） */
export async function fetchEvidence(
  conn: DaemonConnection,
  contractId: string,
  evidenceId?: string,
): Promise<EvidenceBundle> {
  const suffix = evidenceId ? `/${encodeURIComponent(evidenceId)}` : "";
  const body = await request<{ evidence: EvidenceBundle }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/evidence${suffix}`,
  );
  return body.evidence;
}

export interface ArchGraphPayload {
  durationMs: number;
  stats: { nodes: number; edges: number; cycles: number };
  cycles: string[][];
  graph: {
    nodes: Array<{ filePath: string; exports: string[] }>;
    edges: Array<{ from: string; to: string }>;
  };
}

export async function fetchArchGraph(
  conn: DaemonConnection,
): Promise<ArchGraphPayload> {
  return request<ArchGraphPayload>(conn, "/api/arch/graph");
}

export interface ModelSettings {
  configured: boolean;
  model: string;
  source: "runtime" | "environment" | "none";
}

export async function fetchSettings(
  conn: DaemonConnection,
): Promise<ModelSettings> {
  const body = await request<{ settings: ModelSettings }>(
    conn,
    "/api/settings",
  );
  return body.settings;
}

export async function saveOpenAiKey(
  conn: DaemonConnection,
  apiKey: string,
  model?: string,
): Promise<ModelSettings> {
  const body = await request<{ settings: ModelSettings }>(
    conn,
    "/api/settings/openai-key",
    {
      method: "POST",
      body: JSON.stringify({
        api_key: apiKey,
        ...(model ? { model } : {}),
      }),
    },
  );
  return body.settings;
}

export interface MergeResult {
  commitSha: string;
  commitMessage: string;
  contract: SoftwareContract;
  worktreeRemoved: boolean;
  /** P.1 User-First Discard：发生冲突时是否以用户主分支版本为准自动仲裁 */
  conflictResolution?: "USER_FIRST_DISCARD" | null;
  /** AI 改动全部被用户版本覆盖，没有可提交内容（不是错误） */
  nothingToMerge?: boolean;
  /** nothingToMerge 时的白话提示 */
  message?: string;
}

export async function mergeContract(
  conn: DaemonConnection,
  contractId: string,
  evidenceId: string,
  reviewer: string,
): Promise<MergeResult> {
  const body = await request<{ result: MergeResult }>(
    conn,
    `/api/contracts/${encodeURIComponent(contractId)}/merge`,
    {
      method: "POST",
      body: JSON.stringify({ evidence_id: evidenceId, reviewer }),
    },
  );
  return body.result;
}

// ---- TASK-C.6 右栏会话 ----
import type {
  ChatAdapterInfo,
  ChatSessionDetail,
  ChatSessionSummary,
} from "./chat-events";

export async function listChatAdapters(
  conn: DaemonConnection,
): Promise<ChatAdapterInfo[]> {
  return (
    await request<{ adapters: ChatAdapterInfo[] }>(conn, "/api/chat/adapters")
  ).adapters;
}

export async function listChatSessions(
  conn: DaemonConnection,
): Promise<ChatSessionSummary[]> {
  return (
    await request<{ sessions: ChatSessionSummary[] }>(
      conn,
      "/api/chat/sessions",
    )
  ).sessions;
}

export async function createChatSession(
  conn: DaemonConnection,
  adapterId: string,
): Promise<ChatSessionSummary> {
  return (
    await request<{ session: ChatSessionSummary }>(conn, "/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify({ adapter_id: adapterId }),
    })
  ).session;
}

export async function getChatSession(
  conn: DaemonConnection,
  id: string,
): Promise<ChatSessionDetail> {
  return (
    await request<{ session: ChatSessionDetail }>(
      conn,
      `/api/chat/sessions/${encodeURIComponent(id)}`,
    )
  ).session;
}

export async function sendChatMessage(
  conn: DaemonConnection,
  id: string,
  text: string,
): Promise<"started" | "queued"> {
  return (
    await request<{ result: "started" | "queued" }>(
      conn,
      `/api/chat/sessions/${encodeURIComponent(id)}/messages`,
      { method: "POST", body: JSON.stringify({ text }) },
    )
  ).result;
}

export async function interruptChat(
  conn: DaemonConnection,
  id: string,
): Promise<boolean> {
  return (
    await request<{ interrupted: boolean }>(
      conn,
      `/api/chat/sessions/${encodeURIComponent(id)}/interrupt`,
      { method: "POST" },
    )
  ).interrupted;
}

// ---- TASK-C.3 编辑器读写（服务端强制校验） ----
export interface WorktreeFile {
  path: string;
  root: string;
  content: string;
  writable: boolean;
}

export async function readWorktreeFile(
  conn: DaemonConnection,
  filePath: string,
  contractId?: string | null,
): Promise<WorktreeFile> {
  const q = new URLSearchParams({ path: filePath });
  if (contractId) q.set("contract_id", contractId);
  return request<WorktreeFile>(conn, `/api/worktree/files?${q.toString()}`);
}

export async function saveWorktreeFile(
  conn: DaemonConnection,
  filePath: string,
  content: string,
  contractId?: string | null,
): Promise<void> {
  await request(conn, "/api/worktree/files", {
    method: "POST",
    body: JSON.stringify({
      path: filePath,
      content,
      ...(contractId ? { contract_id: contractId } : {}),
    }),
  });
}

// ---------------------------------------------------------------------------
// TASK-P.1 保护清单 / 本轮授权 / 撤销
// ---------------------------------------------------------------------------

export interface ProtectionEntryView {
  id: string;
  name: string;
  patterns: string[];
  createdAt: string;
}

export interface ProtectionCardView {
  id: string;
  files: string[];
  entryNames: string[];
  createdAt: string;
}

export interface ProtectionStateView {
  /** CORRUPT：清单损坏，门卫按全拦截运行（不能显示为自由模式） */
  mode: "VIBE" | "PROTECTED" | "CORRUPT";
  entries: ProtectionEntryView[];
  corrupt: string | null;
  round: {
    roundId: string;
    startedAt: string;
    pending: ProtectionCardView[];
    approvedFiles: string[];
  };
  checkpoint: { roundId: string; at: string } | null;
}

export interface ProtectionRecommendationView {
  name: string;
  patterns: string[];
  reason: string;
}

export async function fetchProtection(
  conn: DaemonConnection,
): Promise<ProtectionStateView> {
  return request<ProtectionStateView>(conn, "/api/protection");
}

export async function fetchProtectionRecommendations(
  conn: DaemonConnection,
): Promise<ProtectionRecommendationView[]> {
  const body = await request<{
    recommendations: ProtectionRecommendationView[];
  }>(conn, "/api/protection/recommendations");
  return body.recommendations;
}

export async function applyProtectionRecommendations(
  conn: DaemonConnection,
  names: string[],
): Promise<void> {
  await request(conn, "/api/protection/recommendations/apply", {
    method: "POST",
    body: JSON.stringify({ names }),
  });
}

export async function lockProtectionPath(
  conn: DaemonConnection,
  name: string,
  patterns: string[],
): Promise<void> {
  await request(conn, "/api/protection/entries", {
    method: "POST",
    body: JSON.stringify({ name, patterns }),
  });
}

export async function unlockProtectionEntry(
  conn: DaemonConnection,
  id: string,
): Promise<void> {
  await request(conn, "/api/protection/entries/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export async function decideProtectionCard(
  conn: DaemonConnection,
  cardId: string,
  decision: "approve" | "deny",
): Promise<void> {
  await request(conn, "/api/protection/decisions", {
    method: "POST",
    body: JSON.stringify({ cardId, decision }),
  });
}

export interface UndoRoundResult {
  undone: boolean;
  roundId?: string;
  restoredFrom?: string;
  deletedFiles?: string[];
  reason?: string;
}

export async function undoProtectionRound(
  conn: DaemonConnection,
): Promise<UndoRoundResult> {
  return request<UndoRoundResult>(conn, "/api/protection/undo", {
    method: "POST",
  });
}

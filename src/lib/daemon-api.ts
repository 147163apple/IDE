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

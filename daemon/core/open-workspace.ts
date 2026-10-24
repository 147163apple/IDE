/**
 * TASK-D.1c：复用/唤起工作区 Daemon，并构造带 #token= 的控制台唤起地址。
 * 底座复用 D.1 / D.1b（PID 锁、session-token、同源托管、fragment 钥匙）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isProcessRunning,
  PidLockError,
  readPidLock,
  releasePidLock,
} from "./pid-lock";
import { readSessionToken } from "./session-token";
import {
  canHostConsoleLocally,
  resolvePackageRoot,
} from "../console/static-host";

export interface WorkspaceSession {
  port: number;
  token: string;
  reused: boolean;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<Response>;

/**
 * C.10h 热修：若 Daemon 源码比进程启动时间新，复用会把旧进程留下的缺口
 * （例如缺 POST /api/repo/delete）暴露成前端「Not Found」。
 * 探针选关键路由文件；mtime > startedAt 则视为需退役。
 */
export const DAEMON_CODE_SKEW_PROBE_FILES = [
  "daemon/server.ts",
  "daemon/editor/repo-delete.ts",
] as const;

export function isDaemonCodeStale(args: {
  packageRoot: string;
  startedAt: string;
}): boolean {
  const startedMs = Date.parse(args.startedAt);
  if (!Number.isFinite(startedMs)) return false;
  for (const rel of DAEMON_CODE_SKEW_PROBE_FILES) {
    const abs = path.join(args.packageRoot, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      if (fs.statSync(abs).mtimeMs > startedMs) return true;
    } catch {
      // ignore unreadable probe
    }
  }
  return false;
}

async function retireStaleDaemon(args: {
  repo: string;
  port: number;
  pid: number;
  token: string;
  fetchImpl: FetchLike;
}): Promise<void> {
  try {
    await args.fetchImpl(`http://127.0.0.1:${args.port}/api/shutdown`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.token}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // 关机请求失败仍继续 SIGTERM
  }
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline && isProcessRunning(args.pid)) {
    await sleep(200);
  }
  if (isProcessRunning(args.pid)) {
    try {
      process.kill(args.pid, "SIGTERM");
    } catch {
      // ignore
    }
    await sleep(500);
  }
  if (isProcessRunning(args.pid)) {
    try {
      process.kill(args.pid, "SIGKILL");
    } catch {
      // ignore
    }
    await sleep(200);
  }
  await releasePidLock(args.repo, true);
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: {
    detached?: boolean;
    stdio?: "ignore" | "inherit";
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
) => ChildProcess;

/**
 * 若本工作区已有存活且健康的 Daemon，复用其 port/token。
 */
export async function tryReuseRunningDaemon(
  repo: string,
  fetchImpl: FetchLike = fetch,
  options: { packageRoot?: string } = {},
): Promise<{ port: number; token: string } | null> {
  const lock = readPidLock(repo);
  if (!lock || !isProcessRunning(lock.pid)) {
    return null;
  }
  const token = readSessionToken(repo);
  if (!token) {
    return null;
  }

  const packageRoot = options.packageRoot ?? resolvePackageRoot();
  if (
    isDaemonCodeStale({
      packageRoot,
      startedAt: lock.startedAt,
    })
  ) {
    await retireStaleDaemon({
      repo,
      port: lock.port,
      pid: lock.pid,
      token,
      fetchImpl,
    });
    return null;
  }

  try {
    const res = await fetchImpl(`http://127.0.0.1:${lock.port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return { port: lock.port, token };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTsxCli(packageRoot: string): string | null {
  const candidates = [
    path.join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(packageRoot, "node_modules", "tsx", "dist", "cli.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * 确保目标工作区有可用会话：优先复用健康 Daemon；否则后台唤起 `stagent start`。
 * 锁冲突（进程在跑但不可用）抛 PidLockError，由调用方白话提示。
 */
export async function ensureWorkspaceSession(
  repoRoot: string,
  options: {
    packageRoot?: string;
    fetchImpl?: FetchLike;
    spawnImpl?: SpawnLike;
    waitTimeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<WorkspaceSession> {
  const resolved = path.resolve(repoRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`找不到这个文件夹：${resolved}`);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const packageRoot = options.packageRoot ?? resolvePackageRoot();
  const reused = await tryReuseRunningDaemon(resolved, fetchImpl, {
    packageRoot,
  });
  if (reused) {
    return { port: reused.port, token: reused.token, reused: true };
  }

  const lock = readPidLock(resolved);
  if (lock && isProcessRunning(lock.pid)) {
    // 进程在跑但健康检查失败 / 无 Token —— 不静默抢占
    throw new PidLockError({
      pid: lock.pid,
      port: lock.port,
      repoRoot: lock.repoRoot,
    });
  }
  const entry = path.join(packageRoot, "bin", "stagent.ts");
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到 Stagent 入口：${entry}`);
  }

  const tsxCli = resolveTsxCli(packageRoot);
  const spawnCmd = tsxCli ? process.execPath : "tsx";
  const spawnArgs = tsxCli
    ? [tsxCli, entry, "start", "--repo", resolved, "--no-browser"]
    : [entry, "start", "--repo", resolved, "--no-browser"];

  const spawnImpl = options.spawnImpl ?? spawn;
  const child = spawnImpl(spawnCmd, spawnArgs, {
    detached: true,
    stdio: "ignore",
    cwd: packageRoot,
    env: { ...process.env, STAGENT_NO_BROWSER: "1" },
  });
  child.unref?.();

  const deadline = Date.now() + (options.waitTimeoutMs ?? 20_000);
  const interval = options.pollIntervalMs ?? 250;
  while (Date.now() < deadline) {
    const session = await tryReuseRunningDaemon(resolved, fetchImpl, {
      packageRoot,
    });
    if (session) {
      return { port: session.port, token: session.token, reused: false };
    }
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(
        `启动工作台失败（退出码 ${child.exitCode}）：${resolved}`,
      );
    }
    await sleep(interval);
  }
  throw new Error(`启动工作台超时：${resolved}`);
}

export function assertLoopbackUiUrl(uiUrl: string): URL {
  let url: URL;
  try {
    url = new URL(uiUrl);
  } catch {
    throw new Error(`拒绝启动：--ui-url 不是合法 URL：${uiUrl}`);
  }
  if (url.protocol !== "http:") {
    throw new Error(
      `拒绝启动：--ui-url 仅允许 http 协议（收到 ${url.protocol}）：${uiUrl}`,
    );
  }
  const host = url.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(
      `拒绝启动：--ui-url 只能指向本地回环地址（localhost / 127.0.0.1），` +
        `收到主机 ${url.hostname}：${uiUrl}`,
    );
  }
  if (url.username || url.password) {
    throw new Error(`拒绝启动：--ui-url 不允许携带 userinfo：${uiUrl}`);
  }
  return url;
}

export function buildUiLaunchUrl(
  uiBase: string,
  token: string,
  options: { daemonBaseUrl?: string } = {},
): string {
  const url = assertLoopbackUiUrl(uiBase);
  url.searchParams.delete("token");
  const parts = [`token=${token}`];
  if (options.daemonBaseUrl) {
    const daemon = assertLoopbackUiUrl(options.daemonBaseUrl);
    parts.push(`base=${encodeURIComponent(daemon.origin)}`);
  }
  url.hash = parts.join("&");
  return url.toString();
}

export function resolveConsoleUiTarget(options: {
  daemonPort: number;
  uiUrl?: string;
  packageRoot?: string;
  forceUiUrl?: boolean;
}): {
  uiUrl: string;
  sameOrigin: boolean;
  daemonBaseUrl: string;
} {
  const daemonBaseUrl = `http://127.0.0.1:${options.daemonPort}`;
  const packageRoot = options.packageRoot ?? resolvePackageRoot();
  const canHost = !options.forceUiUrl && canHostConsoleLocally(packageRoot);
  if (canHost) {
    return { uiUrl: daemonBaseUrl, sameOrigin: true, daemonBaseUrl };
  }
  return {
    uiUrl: options.uiUrl ?? "http://localhost:5173",
    sameOrigin: false,
    daemonBaseUrl,
  };
}

/**
 * 为已有会话构造控制台唤起 URL（Token 仅在 fragment）。
 */
export function buildWorkspaceLaunchUrl(
  session: Pick<WorkspaceSession, "port" | "token">,
  options: { packageRoot?: string; forceUiUrl?: boolean; uiUrl?: string } = {},
): { launchUrl: string; uiUrl: string; sameOrigin: boolean } {
  const target = resolveConsoleUiTarget({
    daemonPort: session.port,
    ...(options.packageRoot !== undefined
      ? { packageRoot: options.packageRoot }
      : {}),
    ...(options.forceUiUrl !== undefined
      ? { forceUiUrl: options.forceUiUrl }
      : {}),
    ...(options.uiUrl !== undefined ? { uiUrl: options.uiUrl } : {}),
  });
  const launchUrl = buildUiLaunchUrl(target.uiUrl, session.token, {
    ...(target.sameOrigin ? {} : { daemonBaseUrl: target.daemonBaseUrl }),
  });
  return {
    launchUrl,
    uiUrl: target.uiUrl,
    sameOrigin: target.sameOrigin,
  };
}

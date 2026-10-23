#!/usr/bin/env -S npx tsx
/**
 * Stagent CLI 入口（规范 TASK-D.1 / TASK-D.1b）
 *
 * 用法:
 *   stagent open  [路径] [--port <n>] [--ui-url <url>] [--no-browser]
 *   stagent start [--repo <path>] [--port <n>] [--ui-url <url>] [--no-browser]
 *   stagent status [--repo <path>]
 *
 * 安全约定（A §6.1 / B TASK-D.1 / D.1b）：
 * - Daemon 仅绑定 127.0.0.1，动态端口 3001~3010；
 * - Token 落盘 <repo>/.stagent/session-token（0600），绝不打印明文；
 * - 唤起浏览器时 Token 仅通过 URL fragment（#token=）传递 —— fragment 不随
 *   HTTP 请求发送、不进服务端日志；严禁使用 ?token= query（规范 FAIL 项）。
 * - URL 安全守卫：--ui-url / STAGENT_UI_URL 仅允许 http://localhost:* 或
 *   http://127.0.0.1:*；外网地址一律报错拒绝启动。
 * - TASK-D.1b：`open` 在有 dist/public 时同源托管控制台，单窗口即可聊；
 *   无构建产物时回退 Vite，并把真实 Daemon 地址写入 fragment `base=`，
 *   避免前端死认 3001。
 */
import path from "node:path";
import { formatVersion, readCliVersion } from "./version";
import process from "node:process";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createDaemon } from "../daemon/server";
import { injectLocalModelEnv } from "../daemon/core/local-env";
import {
  createSupervisorEnrich,
  isSupervisorEnrichConfigured,
} from "../daemon/supervisor/enrich-openai";
import {
  readPidLock,
  isProcessRunning,
  PidLockError,
} from "../daemon/core/pid-lock";
import {
  sessionTokenPath,
  readSessionToken,
} from "../daemon/core/session-token";
import {
  canHostConsoleLocally,
  resolvePackageRoot,
} from "../daemon/console/static-host";

export type CliCommand = "open" | "start" | "status" | "help" | "version";

export interface CliOptions {
  command: CliCommand;
  repo: string;
  port?: number;
  /** Web UI 地址（默认 http://localhost:5173，可用 STAGENT_UI_URL 覆盖） */
  uiUrl: string;
  /** 启动后不唤起浏览器（或 STAGENT_NO_BROWSER=1） */
  noBrowser: boolean;
}

export const DEFAULT_UI_URL = "http://localhost:5173";

export function parseArgs(argv: string[]): CliOptions {
  const rawCommand = argv[0];
  let command: CliCommand;
  let cursor = 0;
  if (
    rawCommand === "open" ||
    rawCommand === "start" ||
    rawCommand === "status" ||
    rawCommand === "help" ||
    rawCommand === "version"
  ) {
    command = rawCommand;
    cursor = 1;
  } else if (rawCommand === undefined) {
    command = "help";
    cursor = 0;
  } else if (rawCommand.startsWith("-")) {
    // 无子命令时的旗标：回退 help（保持 D.1 行为）
    command = "help";
    cursor = 0;
  } else {
    command = "help";
    cursor = 0;
  }

  let repo = process.cwd();
  let port: number | undefined;
  let uiUrl = process.env["STAGENT_UI_URL"] ?? DEFAULT_UI_URL;
  let noBrowser = process.env["STAGENT_NO_BROWSER"] === "1";
  let positionalRepo: string | undefined;

  for (let i = cursor; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo" && argv[i + 1]) {
      repo = path.resolve(argv[i + 1] as string);
      i += 1;
    } else if (arg === "--port" && argv[i + 1]) {
      port = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--ui-url" && argv[i + 1]) {
      uiUrl = argv[i + 1] as string;
      i += 1;
    } else if (arg === "--no-browser") {
      noBrowser = true;
    } else if (arg && !arg.startsWith("-") && positionalRepo === undefined) {
      // `stagent open <路径>` 位置参数
      positionalRepo = path.resolve(arg);
    }
  }

  if (positionalRepo !== undefined) {
    repo = positionalRepo;
  }

  const base: Omit<CliOptions, "command"> = {
    repo,
    uiUrl,
    noBrowser,
    ...(port === undefined ? {} : { port }),
  };
  return { command, ...base };
}

/**
 * URL 安全守卫：Web UI 目标只允许本地回环地址。
 */
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

export interface BuildUiLaunchUrlOptions {
  /** 跨端口（Vite）时把真实 Daemon 地址写入 fragment，避免死认 3001 */
  daemonBaseUrl?: string;
}

/**
 * 构造浏览器唤起地址：Token 只放 fragment；可选附带 base=。
 */
export function buildUiLaunchUrl(
  uiBase: string,
  token: string,
  options: BuildUiLaunchUrlOptions = {},
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

/**
 * 各平台的浏览器唤起命令（结构化 argv，绝无 shell 拼接）。
 */
export function resolveBrowserOpener(
  url: string,
  platform: NodeJS.Platform = process.platform,
): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") {
    return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  }
  return ["xdg-open", [url]];
}

/** 唤起浏览器（fire-and-forget；失败不阻断 Daemon，仅提示手动打开） */
export function openBrowser(url: string): Promise<boolean> {
  const [cmd, args] = resolveBrowserOpener(url);
  return new Promise((resolve) => {
    const child = execFile(cmd, args, (err) => {
      resolve(!err);
    });
    child.on("error", () => resolve(false));
  });
}

/**
 * TASK-D.1b：若本工作区已有存活且健康的 Daemon，复用其 port/token。
 */
export async function tryReuseRunningDaemon(
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ port: number; token: string } | null> {
  const lock = readPidLock(repo);
  if (!lock || !isProcessRunning(lock.pid)) {
    return null;
  }
  const token = readSessionToken(repo);
  if (!token) {
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

/**
 * 选择控制台 URL：有 dist/public 时用 Daemon 同源；否则回退 uiUrl（Vite）。
 */
export function resolveConsoleUiTarget(options: {
  daemonPort: number;
  uiUrl: string;
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
    uiUrl: options.uiUrl,
    sameOrigin: false,
    daemonBaseUrl,
  };
}

function printHelp(): void {
  console.log(`${formatVersion(readCliVersion())} — 本地任务副驾与验收控制台

用法:
  stagent open  [路径] [--port <n>] [--ui-url <url>] [--no-browser]
                                   一键打开项目：启动/复用 Daemon，自动打开已连上的工作台
  stagent start [--repo <path>] [--port <n>] [--ui-url <url>] [--no-browser]
                                   启动本地 Daemon（仅绑定 127.0.0.1，端口 3001~3010）
  stagent status [--repo <path>]   查看当前仓库 Daemon 状态
  stagent version                  显示版本号
  stagent help                     显示帮助

安全说明:
  - 服务仅监听回环地址；WebSocket 连接建立后首帧 AUTH 鉴权，失败以 4401 断开
  - Token 位于 <repo>/.stagent/session-token（权限 0600），日志不打印明文
  - 唤起浏览器时 Token 经 URL fragment 传递，绝不使用 ?token= query
  - --ui-url / STAGENT_UI_URL 仅允许 http://localhost:* 或 http://127.0.0.1:*，
    外网地址一律拒绝启动（防止 #token= 外泄）
  - 有 dist/public 时 open 同源托管控制台（单窗口）；Demo 仍独立 Origin（4100~4110）
`);
}

function formatLockConflict(err: unknown): string {
  if (err instanceof PidLockError) {
    return err.message;
  }
  return (err as Error).message;
}

async function launchConsole(options: {
  uiUrl: string;
  token: string;
  daemonBaseUrl: string;
  sameOrigin: boolean;
  noBrowser: boolean;
}): Promise<void> {
  if (options.noBrowser || !options.token) {
    console.log(
      `  控制台: ${options.uiUrl}（未自动唤起；请手动打开并按页面提示连接）`,
    );
    return;
  }
  const launchUrl = buildUiLaunchUrl(options.uiUrl, options.token, {
    ...(options.sameOrigin ? {} : { daemonBaseUrl: options.daemonBaseUrl }),
  });
  const opened = await openBrowser(launchUrl);
  const mode = options.sameOrigin ? "同源托管" : "跨端口（已写入 base=）";
  console.log(
    opened
      ? `  控制台: ${options.uiUrl}（已在浏览器打开，Token 经 #fragment 注入，${mode}）`
      : `  控制台: ${options.uiUrl}（浏览器唤起失败，请手动打开带 #token= 的地址）`,
  );
}

async function runOpenOrStart(
  options: CliOptions,
  mode: "open" | "start",
): Promise<void> {
  // open：优先复用已有健康 Daemon（无需第二终端、无需手拷 Token）
  if (mode === "open") {
    const reused = await tryReuseRunningDaemon(options.repo);
    if (reused) {
      console.log(`Stagent Daemon 已在运行，复用中`);
      console.log(`  地址:  http://127.0.0.1:${reused.port}`);
      console.log(`  Token: ${sessionTokenPath(options.repo)} (0600)`);
      const target = resolveConsoleUiTarget({
        daemonPort: reused.port,
        uiUrl: options.uiUrl,
        forceUiUrl: process.env["STAGENT_UI_URL"] !== undefined,
      });
      if (!target.sameOrigin) {
        console.log(
          `  提示: 未找到 dist/public，回退 ${target.uiUrl}（可先 npm run build 启用单窗口同源）`,
        );
      }
      await launchConsole({
        uiUrl: target.uiUrl,
        token: reused.token,
        daemonBaseUrl: target.daemonBaseUrl,
        sameOrigin: target.sameOrigin,
        noBrowser: options.noBrowser,
      });
      // 复用场景：CLI 打开浏览器后退出，Daemon 由原进程托管
      return;
    }
  }

  // URL 安全守卫：在任何副作用之前校验（仅当会用到外部 uiUrl 时）
  try {
    assertLoopbackUiUrl(options.uiUrl);
  } catch (err) {
    console.error(`[stagent] ${(err as Error).message}`);
    process.exit(1);
  }

  const envInject = injectLocalModelEnv(options.repo);
  if (envInject.envFile.loaded) {
    console.log(
      `  环境: 已加载 ${envInject.envFile.injectedKeys.length} 项本机变量` +
        (envInject.mappedKeys.length > 0
          ? `（并映射 ${envInject.mappedKeys.length} 项 OpenAI 兼容键）`
          : ""),
    );
  } else {
    console.log(
      `  环境: 未找到 ${envInject.envFile.path}（L1 补全将不可用，草案仍可走纯 L0）`,
    );
  }

  const supervisorEnrich = isSupervisorEnrichConfigured()
    ? createSupervisorEnrich()
    : undefined;
  if (supervisorEnrich) {
    console.log(`  L1 补全: 已启用（DeepSeek / OpenAI 兼容口）`);
  } else {
    console.log(`  L1 补全: 未配置密钥（出草案默认纯 L0）`);
  }

  let daemon;
  try {
    daemon = createDaemon({
      repoRoot: options.repo,
      ...(options.port === undefined
        ? {}
        : { startPort: options.port, endPort: options.port }),
      autoShutdownSignals: true,
      ...(supervisorEnrich === undefined ? {} : { supervisorEnrich }),
    });
  } catch (err) {
    console.error(`[stagent] ${formatLockConflict(err)}`);
    process.exit(1);
  }

  let info: { port: number; pid: number };
  try {
    info = await daemon.start();
  } catch (err) {
    console.error(`[stagent] ${formatLockConflict(err)}`);
    process.exit(1);
  }

  console.log(`Stagent Daemon 已启动`);
  console.log(`  地址:  http://127.0.0.1:${info.port}`);
  console.log(`  PID:   ${info.pid}`);
  console.log(`  Token: ${sessionTokenPath(options.repo)} (0600)`);

  const token = daemon.getSessionToken() ?? "";
  const target = resolveConsoleUiTarget({
    daemonPort: info.port,
    uiUrl: options.uiUrl,
    forceUiUrl: mode === "start" || process.env["STAGENT_UI_URL"] !== undefined,
  });
  // start 保持旧行为：默认走 --ui-url / Vite；open 优先同源
  const effective =
    mode === "open"
      ? target
      : {
          uiUrl: options.uiUrl,
          sameOrigin: false,
          daemonBaseUrl: `http://127.0.0.1:${info.port}`,
        };

  if (mode === "open" && !effective.sameOrigin) {
    console.log(
      `  提示: 未找到 dist/public，回退 ${effective.uiUrl}（可先 npm run build 启用单窗口同源）`,
    );
  }

  await launchConsole({
    uiUrl: effective.uiUrl,
    token,
    daemonBaseUrl: effective.daemonBaseUrl,
    sameOrigin: effective.sameOrigin,
    noBrowser: options.noBrowser,
  });

  console.log(`按下 Ctrl+C 停止`);

  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "help") {
    printHelp();
    return;
  }

  if (options.command === "version") {
    console.log(formatVersion(readCliVersion()));
    return;
  }

  if (options.command === "status") {
    const lock = readPidLock(options.repo);
    if (!lock) {
      console.log(`Stagent Daemon 未运行（repo: ${options.repo}）`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Stagent Daemon 运行中: pid=${lock.pid} port=${lock.port} started_at=${lock.startedAt}`,
    );
    return;
  }

  if (options.command === "open" || options.command === "start") {
    await runOpenOrStart(options, options.command);
    return;
  }
}

// 入口守卫：仅当作为主程序执行时运行，允许测试 import 纯函数
const invokedAsMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsMain) {
  void main().catch((err) => {
    console.error("[stagent] 启动失败:", formatLockConflict(err));
    process.exit(1);
  });
}

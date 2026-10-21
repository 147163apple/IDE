#!/usr/bin/env -S npx tsx
/**
 * Stagent CLI 入口（规范 TASK-D.1）
 *
 * 用法:
 *   stagent start [--repo <path>] [--port <n>] [--ui-url <url>] [--no-browser]
 *   stagent status [--repo <path>]
 *
 * 安全约定（A §6.1 / B TASK-D.1）：
 * - Daemon 仅绑定 127.0.0.1，动态端口 3001~3010；
 * - Token 落盘 <repo>/.stagent/session-token（0600），绝不打印明文；
 * - 唤起浏览器时 Token 仅通过 URL fragment（#token=）传递 —— fragment 不随
 *   HTTP 请求发送、不进服务端日志；严禁使用 ?token= query（规范 FAIL 项）。
 * - URL 安全守卫：--ui-url / STAGENT_UI_URL 仅允许 http://localhost:* 或
 *   http://127.0.0.1:*；外网地址（https://...、非回环域名/IP、userinfo 伪装）
 *   一律报错拒绝启动，防止携带 #token= 的链接外泄会话令牌。
 */
import path from "node:path";
import { formatVersion, readCliVersion } from "./version";
import process from "node:process";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createDaemon } from "../daemon/server";
import { readPidLock } from "../daemon/core/pid-lock";
import { sessionTokenPath } from "../daemon/core/session-token";

export interface CliOptions {
  command: "start" | "status" | "help" | "version";
  repo: string;
  port?: number;
  /** Web UI 地址（默认 http://localhost:5173，可用 STAGENT_UI_URL 覆盖） */
  uiUrl: string;
  /** 启动后不唤起浏览器（或 STAGENT_NO_BROWSER=1） */
  noBrowser: boolean;
}

export const DEFAULT_UI_URL = "http://localhost:5173";

export function parseArgs(argv: string[]): CliOptions {
  const command = (argv[0] ?? "help") as CliOptions["command"];
  let repo = process.cwd();
  let port: number | undefined;
  let uiUrl = process.env["STAGENT_UI_URL"] ?? DEFAULT_UI_URL;
  let noBrowser = process.env["STAGENT_NO_BROWSER"] === "1";

  for (let i = 1; i < argv.length; i += 1) {
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
    }
  }

  const base: Omit<CliOptions, "command"> = {
    repo,
    uiUrl,
    noBrowser,
    ...(port === undefined ? {} : { port }),
  };
  if (!["start", "status", "help", "version"].includes(command)) {
    return { command: "help", ...base };
  }
  return { command, ...base };
}

/**
 * URL 安全守卫：Web UI 目标只允许本地回环地址。
 *
 * 白名单：协议必须 http:，主机名必须恰为 localhost 或 127.0.0.1。
 * 拒绝项：非 http 协议（含 https）、外网域名/IP（含局域网）、
 * 域名前缀伪装（localhost.evil.com）、userinfo 伪装
 * （http://evil.com@localhost/）、非法 URL。
 * 防止携带 #token= 的唤起链接被指向外部站点而泄露会话令牌。
 * 校验通过时返回解析后的 URL。
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

/**
 * 构造浏览器唤起地址：Token 只放 fragment。
 * 先经 URL 安全守卫校验（纵深防御），再防御性地剔除目标 URL 上
 * 已存在的 ?token= query（若用户粘贴过旧链接）。
 */
export function buildUiLaunchUrl(uiBase: string, token: string): string {
  const url = assertLoopbackUiUrl(uiBase);
  url.searchParams.delete("token");
  url.hash = `token=${token}`;
  return url.toString();
}

/**
 * 各平台的浏览器唤起命令（结构化 argv，绝无 shell 拼接）。
 * 返回 [executable, args]；测试可按 platform 参数断言而不真正执行。
 */
export function resolveBrowserOpener(
  url: string,
  platform: NodeJS.Platform = process.platform,
): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") {
    // start 是 cmd 内建命令；rundll32 可脱离 shell 直接唤起默认浏览器
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

function printHelp(): void {
  console.log(`${formatVersion(readCliVersion())} — 本地任务副驾与验收控制台

用法:
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
`);
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

  // URL 安全守卫：在任何副作用（Daemon 启动、Token 生成）之前校验。
  // --ui-url 与 STAGENT_UI_URL 同源约束：只允许本地回环地址。
  try {
    assertLoopbackUiUrl(options.uiUrl);
  } catch (err) {
    console.error(`[stagent] ${(err as Error).message}`);
    process.exit(1);
  }

  const daemon = createDaemon({
    repoRoot: options.repo,
    ...(options.port === undefined
      ? {}
      : { startPort: options.port, endPort: options.port }),
    autoShutdownSignals: true,
  });

  const info = await daemon.start();
  console.log(`Stagent Daemon 已启动`);
  console.log(`  地址:  http://127.0.0.1:${info.port}`);
  console.log(`  PID:   ${info.pid}`);
  console.log(`  Token: ${sessionTokenPath(options.repo)} (0600)`);

  // TASK-D.1：启动后唤起浏览器。Token 经 fragment 传递，日志只打印脱敏地址。
  const token = daemon.getSessionToken();
  if (options.noBrowser || !token) {
    console.log(
      `  控制台: ${options.uiUrl}（未自动唤起；请手动打开并按页面提示连接）`,
    );
  } else {
    const launchUrl = buildUiLaunchUrl(options.uiUrl, token);
    const opened = await openBrowser(launchUrl);
    console.log(
      opened
        ? `  控制台: ${options.uiUrl}（已在浏览器打开，Token 经 #fragment 注入）`
        : `  控制台: ${options.uiUrl}（浏览器唤起失败，请手动打开）`,
    );
  }

  console.log(`按下 Ctrl+C 停止`);

  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

// 入口守卫：仅当作为主程序执行时运行，允许测试 import 纯函数
const invokedAsMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsMain) {
  void main().catch((err) => {
    console.error("[stagent] 启动失败:", (err as Error).message);
    process.exit(1);
  });
}

#!/usr/bin/env -S npx tsx
/**
 * Stagent CLI 入口（规范 TASK-D.1）
 *
 * 用法:
 *   stagent start [--repo <path>] [--port <n>]
 *   stagent status
 */
import path from "node:path";
import process from "node:process";
import { createDaemon } from "../daemon/server";
import { readPidLock } from "../daemon/core/pid-lock";
import { sessionTokenPath } from "../daemon/core/session-token";

interface CliOptions {
  command: "start" | "status" | "help";
  repo: string;
  port?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const command = (argv[0] ?? "help") as CliOptions["command"];
  let repo = process.cwd();
  let port: number | undefined;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo" && argv[i + 1]) {
      repo = path.resolve(argv[i + 1] as string);
      i += 1;
    } else if (arg === "--port" && argv[i + 1]) {
      port = Number(argv[i + 1]);
      i += 1;
    }
  }

  if (!["start", "status", "help"].includes(command)) {
    return { command: "help", repo, ...(port === undefined ? {} : { port }) };
  }
  return { command, repo, ...(port === undefined ? {} : { port }) };
}

function printHelp(): void {
  console.log(`Stagent v0.1 — 本地任务副驾与验收控制台

用法:
  stagent start [--repo <path>] [--port <n>]   启动本地 Daemon（仅绑定 127.0.0.1）
  stagent status [--repo <path>]               查看当前仓库 Daemon 状态
  stagent help                                 显示帮助

安全说明:
  - 服务仅监听回环地址，WebSocket 握手需 Bearer Token
  - Token 位于 <repo>/.stagent/session-token（权限 0600）
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "help") {
    printHelp();
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
      `Stagent Daemon 运行中: pid=${lock.pid} port=${lock.port} started_at=${lock.started_at}`,
    );
    return;
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
  console.log(`按下 Ctrl+C 停止`);

  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((err) => {
  console.error("[stagent] 启动失败:", (err as Error).message);
  process.exit(1);
});

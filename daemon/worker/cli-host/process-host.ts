import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { killProcessTree } from "../../runner/process-tree";

/**
 * TASK-W.5a cli-host：外部 Agent CLI 的唯一 spawn 入口。
 * - 结构化 argv、`shell:false`；
 * - detached 让子进程成为进程组组长，便于整树回收；
 * - 打断分三级：SIGINT（让 CLI 干净结束本轮）→ SIGTERM → 整树 SIGKILL，
 *   总预算默认 1.8s（C.6 / W.5a 要求 ≤2s）。
 */
export interface ManagedProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** SIGINT 后等待毫秒数，默认 700 */
  sigintGraceMs?: number;
  /** SIGTERM 后等待毫秒数，默认 600 */
  sigtermGraceMs?: number;
}

export interface ManagedProcess {
  pid: number | undefined;
  /** stdout 逐行 */
  lines: AsyncIterable<string>;
  /** 进程退出 */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stderr(): string;
  /** 分级停止；返回最终使用的手段与耗时 */
  stop(): Promise<{
    via: "exit" | "SIGINT" | "SIGTERM" | "SIGKILL";
    ms: number;
  }>;
}

export function spawnManaged(opts: ManagedProcessOptions): ManagedProcess {
  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrBuf = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (d: string) => {
    stderrBuf = (stderrBuf + d).slice(-16_000);
  });
  let done = false;
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.on("error", (err) => {
      stderrBuf += `\n${err.message}`;
      done = true;
      resolve({ code: -1, signal: null });
    });
    child.on("close", (code, signal) => {
      done = true;
      resolve({ code, signal });
    });
  });

  const sendGroup = (sig: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        // 已退出
      }
    }
  };
  const waitExit = (ms: number) =>
    Promise.race([
      exited.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(done), ms)),
    ]);

  let stopping: ReturnType<ManagedProcess["stop"]> | null = null;
  const stop: ManagedProcess["stop"] = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      const t0 = Date.now();
      if (done) return { via: "exit" as const, ms: 0 };
      sendGroup("SIGINT");
      if (await waitExit(opts.sigintGraceMs ?? 700))
        return { via: "SIGINT" as const, ms: Date.now() - t0 };
      sendGroup("SIGTERM");
      if (await waitExit(opts.sigtermGraceMs ?? 600))
        return { via: "SIGTERM" as const, ms: Date.now() - t0 };
      if (child.pid)
        await killProcessTree(child.pid, { graceMs: 0, confirmTimeoutMs: 400 });
      return { via: "SIGKILL" as const, ms: Date.now() - t0 };
    })();
    return stopping;
  };

  if (opts.signal) {
    if (opts.signal.aborted) void stop();
    else
      opts.signal.addEventListener("abort", () => void stop(), { once: true });
  }

  const rl = createInterface({ input: child.stdout! });
  return {
    pid: child.pid,
    lines: rl,
    exited,
    stderr: () => stderrBuf,
    stop,
  };
}

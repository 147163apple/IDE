import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeCodeAdapter,
  HOOK_SCRIPT,
} from "../../daemon/worker/cli-host/claude-code-adapter";
import { spawnManaged } from "../../daemon/worker/cli-host/process-host";
import type { AdapterEvent } from "../../daemon/chat/types";
import { safeRmSync } from "../helpers/tmp";

/**
 * TASK-J.1 / SSOT P-01：方案工作台右栏搭档只读。
 *
 * 验收不是「某个函数返回了 read_only」，而是三层同时成立：
 * 1. CLI 参数层：`--tools` / `--allowedTools` 只有 Read/Glob/Grep，
 *    `--disallowedTools` 覆盖写类与 Shell，`--permission-mode` 不是 acceptEdits；
 * 2. hook 层：即便 CLI 参数被绕过，partner 角色的 PreToolUse 也直接 block；
 * 3. 物理结果：被拦的写目标在仓库里不存在。
 *
 * 本条用替身 spawn 捕获真实启动参数（不调模型），再把同一次 Write 工具调用
 * 喂给真实 hook 脚本，按 hook 结论决定是否落盘——落盘与否就是最终断言。
 */
const KEY = "sk-ant-test-0123456789abcdef";

let repo: string;
let repoReal: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j1-"));
  repoReal = fs.realpathSync(repo);
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "hello.txt"), "HELLO-J1\n");
});
afterEach(() => safeRmSync(repo));

interface CapturedSpawn {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function withSpawnCapture(
  lines: string[],
  captured: CapturedSpawn[],
): typeof spawnManaged {
  return ((opts: CapturedSpawn) => {
    captured.push(opts);
    return {
      pid: undefined,
      lines: (async function* () {
        for (const line of lines) yield line;
      })(),
      exited: Promise.resolve({ code: 0, signal: null }),
      stderr: () => "",
      stop: async () => ({ via: "exit" as const, ms: 0 }),
    };
  }) as unknown as typeof spawnManaged;
}

async function collect(it: AsyncIterable<AdapterEvent>) {
  const out: AdapterEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

interface HookVerdict {
  status: number | null;
  decision: string | undefined;
  reason: string | undefined;
}

/** 真实执行 PreToolUse hook；role 省略即 Worker 口径 */
function runHook(
  payload: unknown,
  extraEnv: Record<string, string> = {},
): HookVerdict {
  const r = spawnSync(process.execPath, [HOOK_SCRIPT], {
    input: JSON.stringify(payload),
    env: {
      PATH: process.env["PATH"] ?? "",
      STAGENT_HOOK_ROOT: repo,
      ...extraEnv,
    },
    encoding: "utf8",
  });
  let decision: string | undefined;
  let reason: string | undefined;
  try {
    const out = JSON.parse(r.stdout || "{}") as {
      hookSpecificOutput?: {
        permissionDecision?: string;
        permissionDecisionReason?: string;
      };
    };
    decision = out.hookSpecificOutput?.permissionDecision;
    reason = out.hookSpecificOutput?.permissionDecisionReason;
  } catch {
    // 非 JSON 输出按拒绝结论为空处理
  }
  return { status: r.status, decision, reason };
}

/** 只有 hook 放行才真的落盘——模拟 CLI 在 hook 结论之后的实际写入 */
function writeThroughGuard(
  rel: string,
  content: string,
  extraEnv: Record<string, string> = {},
): HookVerdict {
  const verdict = runHook(
    { tool_name: "Write", tool_input: { file_path: rel, content } },
    extraEnv,
  );
  if (verdict.status === 0) fs.writeFileSync(path.join(repo, rel), content);
  return verdict;
}

describe("TASK-J.1 右栏搭档只读（P-01）", () => {
  it("partner 启动参数：CLI 层只给 Read/Glob/Grep，写类与 Shell 进 disallowedTools", async () => {
    const captured: CapturedSpawn[] = [];
    const lines = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "sess-j1",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-write",
              name: "Write",
              input: { file_path: "hacked.txt", content: "SHOULD NOT EXIST" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "sess-j1",
        is_error: false,
      }),
    ];
    const adapter = new ClaudeCodeAdapter({
      apiKey: () => KEY,
      role: "partner",
      spawn: withSpawnCapture(lines, captured),
    });
    expect(adapter.info().tool_mode).toBe("read_only");

    const events = await collect(
      adapter.run({
        prompt: "写一个文件",
        cwd: repo,
        nativeSessionId: null,
        history: [],
        signal: new AbortController().signal,
      }),
    );

    // 替身 spawn 让这次 Write 真的进到适配器事件流里（模拟 CLI 层失效的最坏情况）
    const writeCall = events.find(
      (e) => e.kind === "tool_call" && e.name === "Write",
    );
    expect(writeCall).toBeDefined();

    const spawn = captured[0];
    expect(spawn).toBeDefined();
    const args = spawn!.args;
    expect((args[args.indexOf("--tools") + 1] ?? "").split(",")).toEqual([
      "Read",
      "Glob",
      "Grep",
    ]);
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read,Glob,Grep");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
    const disallowed = (
      args[args.indexOf("--disallowedTools") + 1] ?? ""
    ).split(",");
    for (const tool of ["Edit", "Write", "MultiEdit", "Bash", "WebFetch"]) {
      expect(disallowed).toContain(tool);
    }
    // spawn 的 cwd 与 hook root 必须是同一个收窄后的真实路径
    expect(spawn!.cwd).toBe(repoReal);
    expect(spawn!.env["STAGENT_HOOK_ROOT"]).toBe(repoReal);
    expect(spawn!.env["STAGENT_HOOK_ROLE"]).toBe("partner");
    expect(spawn!.env["STAGENT_HOOK_ALLOW_BASH"]).toBeUndefined();
  });

  it("同一次 Write 经 hook：partner 角色 block，仓库内目标文件不存在", async () => {
    const verdict = writeThroughGuard("hacked.txt", "SHOULD NOT EXIST", {
      STAGENT_HOOK_ROLE: "partner",
    });
    expect(verdict.status).toBe(2);
    expect(verdict.decision).toBe("deny");
    expect(verdict.reason).toContain("右栏搭档只读");
    expect(fs.existsSync(path.join(repo, "hacked.txt"))).toBe(false);
  });

  it("Bash 在 partner 角色恒被拦（即使误开 STAGENT_HOOK_ALLOW_BASH）", () => {
    const verdict = runHook(
      { tool_name: "Bash", tool_input: { command: "echo pwn > hacked.txt" } },
      { STAGENT_HOOK_ROLE: "partner", STAGENT_HOOK_ALLOW_BASH: "1" },
    );
    expect(verdict.status).toBe(2);
    expect(verdict.reason).toContain("右栏搭档只读");
    expect(fs.existsSync(path.join(repo, "hacked.txt"))).toBe(false);
  });

  it("TodoWrite / Task / WebFetch 等非只读工具在 partner 角色被拦；Read/Glob/Grep 放行", () => {
    for (const tool of ["TodoWrite", "Task", "WebFetch", "WebSearch"]) {
      const v = runHook(
        { tool_name: tool, tool_input: {} },
        { STAGENT_HOOK_ROLE: "partner" },
      );
      expect(v.status, `${tool} 应被拦`).toBe(2);
    }
    for (const tool of ["Read", "Glob", "Grep"]) {
      const v = runHook(
        {
          tool_name: tool,
          tool_input:
            tool === "Glob"
              ? { pattern: "**/*.txt" }
              : { file_path: "hello.txt" },
        },
        { STAGENT_HOOK_ROLE: "partner" },
      );
      expect(v.status, `${tool} 应放行`).toBe(0);
    }
  });

  it("worker 角色不回归：仓库内 Write 仍放行；已删除的 LS 不再被当作只读工具", () => {
    const v = writeThroughGuard("worker-ok.txt", "worker can write");
    expect(v.status).toBe(0);
    expect(fs.readFileSync(path.join(repo, "worker-ok.txt"), "utf8")).toBe(
      "worker can write",
    );

    const ls = runHook({ tool_name: "LS", tool_input: { path: "." } });
    expect(ls.status).toBe(2);
    expect(ls.reason).toContain("未在白名单内的工具");
  });
});

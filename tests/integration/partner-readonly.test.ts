import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  ClaudeCodeAdapter,
  HOOK_COMMAND_PATH,
  HOOK_SCRIPT,
  PARTNER_DENIED_TOOLS,
  PARTNER_TOOLS,
} from "../../daemon/worker/cli-host/claude-code-adapter";
import type {
  ManagedProcess,
  ManagedProcessOptions,
} from "../../daemon/worker/cli-host/process-host";
import type { AdapterEvent } from "../../daemon/chat/types";
import { createDaemon, type StagentDaemon } from "../../daemon/server";

/**
 * TASK-J.1 / SSOT P-01「AI 搭档只读是硬约束」（集成层）。
 *
 * 断言两段串联的双保险，缺一即 FAIL：
 *  1. **CLI 参数层**：用替身 spawn 捕获真实启动参数（不跑真模型），
 *     证明 --tools 是精确只读白名单、permission-mode 不是 acceptEdits；
 *  2. **hook 层**：把一次 Write 工具调用喂给同一个 PreToolUse hook，
 *     证明被 block，且仓库内目标文件确实不存在 / 既有文件字节不变。
 *
 * 只靠 hook 或只靠参数都不算通过（规范明确禁止单靠 hook）。
 */
const KEY = "sk-ant-partner-test-0123456789";

/** 替身 spawn：不启动真实 CLI，只记录参数并按 stream-json 吐一轮 */
function stubSpawn(captured: ManagedProcessOptions[]) {
  return (opts: ManagedProcessOptions): ManagedProcess => {
    captured.push(opts);
    const lines = (async function* () {
      yield JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "sess-partner",
      });
      yield JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-write",
              name: "Write",
              input: { file_path: "src/hacked.ts", content: "pwn" },
            },
          ],
        },
      });
      yield JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-write",
              content: "右栏只读，已拦截",
              is_error: true,
            },
          ],
        },
      });
      yield JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "sess-partner",
        is_error: false,
      });
    })();
    return {
      pid: 424_242,
      lines,
      exited: Promise.resolve({ code: 0, signal: null }),
      stderr: () => "",
      stop: async () => ({ via: "exit" as const, ms: 0 }),
    };
  };
}

describe("TASK-J.1 右栏搭档只读（P-01）", () => {
  let repo: string;
  const existing = "export const a = 1;\n";

  beforeEach(() => {
    repo = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-partner-")),
    );
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), existing);
  });
  afterEach(() => safeRmSync(repo));

  /** 右栏适配器（与 daemon/server.ts::defaultChatAdapters 同构） */
  const partnerAdapter = (captured: ManagedProcessOptions[] = []) =>
    new ClaudeCodeAdapter({
      apiKey: () => KEY,
      role: "partner",
      tmpRoot: repo,
      spawn: stubSpawn(captured),
    });

  const hook = (
    env: NodeJS.ProcessEnv,
    tool: string,
    toolInput: Record<string, unknown>,
  ) =>
    spawnSync(process.execPath, [HOOK_SCRIPT], {
      input: JSON.stringify({ tool_name: tool, tool_input: toolInput }),
      env,
      encoding: "utf8",
    });

  /** 从适配器事件里取出唯一的（也必须是唯一的）Write 调用 */
  const onlyWriteCall = (events: AdapterEvent[]) => {
    const calls = events.filter(
      (e): e is Extract<AdapterEvent, { kind: "tool_call" }> =>
        e.kind === "tool_call",
    );
    expect(calls, "替身 CLI 必须恰好发起一次工具调用").toHaveLength(1);
    const call = calls[0]!;
    expect(call.name, "这次调用必须是 Write（写类）").toBe("Write");
    return call;
  };

  it("参数层：替身 spawn 捕获的 argv 里工具集恰为只读四项，写类与联网工具均不可用", async () => {
    const captured: ManagedProcessOptions[] = [];
    const adapter = partnerAdapter(captured);
    const events: AdapterEvent[] = [];
    for await (const e of adapter.run({
      prompt: "帮我看下这个仓库",
      cwd: repo,
      nativeSessionId: null,
      history: [],
      signal: new AbortController().signal,
    })) {
      events.push(e);
    }
    // 替身 CLI 真的发起了 Write，而不是空跑一轮
    onlyWriteCall(events);

    expect(captured).toHaveLength(1);
    const spawnOpts = captured[0]!;
    const argOf = (flag: string) =>
      spawnOpts.args[spawnOpts.args.indexOf(flag) + 1] ?? "";

    expect(argOf("--tools")).toBe(PARTNER_TOOLS.join(","));
    expect(argOf("--allowedTools")).toBe(PARTNER_TOOLS.join(","));
    expect(argOf("--permission-mode")).toBe("default");
    expect(spawnOpts.args.join(" ")).not.toContain("acceptEdits");
    const disallowed = argOf("--disallowedTools").split(",");
    for (const tool of PARTNER_DENIED_TOOLS) {
      expect(disallowed, `应封禁 ${tool}`).toContain(tool);
    }
    // 联网工具显式不可用：既不在工具集里，也在禁止清单里
    for (const netTool of ["WebFetch", "WebSearch"]) {
      expect(argOf("--tools").split(",")).not.toContain(netTool);
      expect(argOf("--allowedTools").split(",")).not.toContain(netTool);
      expect(disallowed, `应封禁 ${netTool}`).toContain(netTool);
    }
    // 工作目录就是用户仓库（不是 Worktree），所以参数层必须自己扛住
    expect(spawnOpts.cwd).toBe(repo);
    expect(spawnOpts.env?.["STAGENT_HOOK_ROOT"]).toBe(repo);
    expect(spawnOpts.env?.["STAGENT_HOOK_ROLE"]).toBe("partner");
    expect(spawnOpts.env?.["STAGENT_HOOK_ALLOW_BASH"]).toBeUndefined();
  });

  it("双层串联：替身发起的 Write 交给本适配器 settings 注册的 hook → deny + 退出码 2，文件未写入", async () => {
    // 第一层：替身 spawn 捕获真实启动参数，并从事件流里取出它发起的 Write 调用
    const captured: ManagedProcessOptions[] = [];
    const events: AdapterEvent[] = [];
    for await (const e of partnerAdapter(captured).run({
      prompt: "把这个仓库里的版本号改成 2",
      cwd: repo,
      nativeSessionId: null,
      history: [],
      signal: new AbortController().signal,
    })) {
      events.push(e);
    }
    const writeCall = onlyWriteCall(events);
    expect(writeCall.input).toMatchObject({
      file_path: "src/hacked.ts",
      content: "pwn",
    });

    // 第二层：同一角色配置的 hook 收到这次 Write（工具名与入参都来自上面的真实事件）
    const launch = partnerAdapter().buildLaunch({
      prompt: "把这个仓库里的版本号改成 2",
      cwd: repo,
      nativeSessionId: null,
    });
    const target = path.join(repo, "src", "hacked.ts");
    const r = hook(
      launch.env,
      writeCall.name,
      writeCall.input as Record<string, unknown>,
    );

    expect(r.status, "hook 必须用退出码 2 表示 block").toBe(2);
    const decision = JSON.parse(r.stdout).hookSpecificOutput;
    expect(decision.permissionDecision).toBe("deny");
    expect(decision.permissionDecisionReason).toContain("只读");
    expect(fs.existsSync(target)).toBe(false);

    // hook 不是外部脚本：它就是这份 settings 里注册的 PreToolUse
    const settings = JSON.parse(fs.readFileSync(launch.settingsPath, "utf8"));
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain(
      HOOK_COMMAND_PATH,
    );
    expect(settings.hooks.PreToolUse[0].hooks[0].onFailure).toBe("block");

    // 拒绝理由与日志都要能复盘（hook.log 由适配器 env 指定）
    const log = fs.readFileSync(launch.env["STAGENT_HOOK_LOG"]!, "utf8");
    expect(log).toContain('"decision":"deny"');
    expect(log).toContain("Write");
  });

  it("既有文件也不许改：Write/Edit 被 block 后内容逐字节不变", () => {
    const launch = partnerAdapter().buildLaunch({
      prompt: "改一行",
      cwd: repo,
      nativeSessionId: null,
    });
    for (const [tool, input] of [
      ["Write", { file_path: "src/a.ts", content: "pwn" }],
      [
        "Edit",
        { file_path: "src/a.ts", old_string: "a = 1", new_string: "a = 2" },
      ],
      ["MultiEdit", { file_path: "src/a.ts", edits: [] }],
    ] as const) {
      const r = hook(launch.env, tool, input as Record<string, unknown>);
      expect(r.status, `应拦截 ${tool}`).toBe(2);
    }
    expect(fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8")).toBe(
      existing,
    );
  });

  it("Shell 与 todo 同为写类通道：即便注入 ALLOW_BASH 也 block", () => {
    const launch = partnerAdapter().buildLaunch({
      prompt: "跑个命令",
      cwd: repo,
      nativeSessionId: null,
    });
    const env = { ...launch.env, STAGENT_HOOK_ALLOW_BASH: "1" };
    for (const [tool, input] of [
      ["Bash", { command: "rm -rf src" }],
      ["TodoWrite", { todos: [] }],
    ] as const) {
      const r = hook(env, tool, input as Record<string, unknown>);
      expect(r.status, `应拦截 ${tool}`).toBe(2);
      expect(r.stdout).toContain("只读");
    }
    expect(fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8")).toBe(
      existing,
    );
  });

  it("右栏仍可读：Read / Glob / Grep 不被误伤（Glob 模式承担列目录）", () => {
    const launch = partnerAdapter().buildLaunch({
      prompt: "看下代码",
      cwd: repo,
      nativeSessionId: null,
    });
    for (const [tool, input] of [
      ["Read", { file_path: "src/a.ts" }],
      ["Glob", { pattern: "src/**/*.ts" }],
      ["Grep", { pattern: "export" }],
      ["Glob", { pattern: "src/*" }],
    ] as const) {
      expect(
        hook(launch.env, tool, input as Record<string, unknown>).status,
        `应放行 ${tool}`,
      ).toBe(0);
    }
  });
});

/**
 * daemon 停机后，Windows 上目录句柄可能晚于 stop() 才释放：删除遇到 EBUSY / ENOTEMPTY / EPERM 时
 * 异步退避重试（最长约 5 秒），等句柄释放后再删；超时仍失败则原样抛出。
 */
async function removeWhenReleased(
  dir: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      safeRmSync(dir);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient =
        code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
      if (!transient || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * Daemon 实际注册的右栏集合（不是本文件自建的适配器）：
 * GET /api/chat/adapters 返回的每个候选都必须是 read_only，
 * 否则「标签只读、实际可写」的适配器仍会进右栏。
 * 端口按团队约定只用 3940–3949。
 */
describe("TASK-J.1 右栏注册集合（Daemon）：全部只读", () => {
  let daemon: StagentDaemon | null = null;
  let repo: string;

  beforeEach(() => {
    repo = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-partner-daemon-")),
    );
  });
  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    await removeWhenReleased(repo);
  });

  it("adapters 接口里没有任何 read_write 适配器", async () => {
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3940,
      endPort: 3949,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    const res = await fetch(`http://127.0.0.1:${info.port}/api/chat/adapters`, {
      headers: { authorization: `Bearer ${daemon.getSessionToken()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      adapters: Array<{ id: string; tool_mode: string }>;
    };
    expect(body.adapters.map((a) => a.id)).toEqual(
      expect.arrayContaining(["claude-code", "baseline", "demo"]),
    );
    for (const adapter of body.adapters) {
      expect(adapter.tool_mode, `${adapter.id} 必须是只读`).toBe("read_only");
    }
  });
});

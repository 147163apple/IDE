import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeCodeAdapter,
  HOOK_SCRIPT,
  redactSecret,
  translate,
} from "../../daemon/worker/cli-host/claude-code-adapter";
import { spawnManaged } from "../../daemon/worker/cli-host/process-host";
import type { AdapterEvent } from "../../daemon/chat/types";

const KEY = "sk-ant-test-0123456789abcdef";
let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w5a-")));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** 假 claude：忽略参数，按 stream-json 吐行；FAKE_IGNORE_SIGINT=1 时不理 SIGINT */
function fakeCli(script: string): string {
  const f = path.join(tmp, "fake-claude.mjs");
  fs.writeFileSync(f, `#!${process.execPath}\n${script}`);
  fs.chmodSync(f, 0o755);
  return f;
}
const STREAMING = `
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (process.env.FAKE_IGNORE_SIGINT) process.on("SIGINT", () => {});
out({ type: "system", subtype: "init", session_id: "sess-abc" });
out({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "a.ts" } }] } });
out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }] } });
let i = 0;
const n = Number(process.env.FAKE_TOKENS || 3);
const t = setInterval(() => {
  if (i >= n) { clearInterval(t); out({ type: "result", subtype: "success", session_id: "sess-abc", is_error: false }); return; }
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "t" + i++ } } });
}, 20);
`;

async function collect(it: AsyncIterable<AdapterEvent>) {
  const out: AdapterEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("TASK-W.5a 启动参数（配置隔离 / 续接）", () => {
  const adapter = new ClaudeCodeAdapter({
    apiKey: () => KEY,
    tmpRoot: os.tmpdir(),
  });
  const launch = adapter.buildLaunch({
    prompt: "hi",
    cwd: "/repo",
    nativeSessionId: "sid-1",
  });
  const settings = JSON.parse(fs.readFileSync(launch.settingsPath, "utf8"));
  afterEach(() => undefined);

  it("不用 --bare（会跳过 hooks）；--setting-sources 为空，只加载 Stagent 生成的 settings 与 mcp-config（strict）", () => {
    expect(launch.args).not.toContain("--bare");
    expect(launch.args.slice(0, 2)).toEqual(["--setting-sources", ""]);
    const tools = launch.args[launch.args.indexOf("--tools") + 1] ?? "";
    expect(tools.split(",")).toEqual(
      expect.arrayContaining(["Read", "Edit", "Write"]),
    );
    expect(tools.split(",")).not.toContain("Bash");
    expect(launch.args).toContain("--strict-mcp-config");
    expect(launch.args[launch.args.indexOf("--settings") + 1]).toBe(
      launch.settingsPath,
    );
    expect(launch.args[launch.args.indexOf("--mcp-config") + 1]).toBe(
      launch.mcpPath,
    );
    expect(launch.args).toEqual(
      expect.arrayContaining([
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
      ]),
    );
  });
  it("永不 bypassPermissions，永不 --continue；续接用 --resume <id>", () => {
    const joined = launch.args.join(" ") + JSON.stringify(settings);
    expect(joined).not.toMatch(/bypassPermissions|dangerously/);
    expect(launch.args).not.toContain("--continue");
    expect(launch.args[launch.args.indexOf("--resume") + 1]).toBe("sid-1");
    const fresh = adapter.buildLaunch({
      prompt: "x",
      cwd: "/repo",
      nativeSessionId: null,
    });
    expect(fresh.args).not.toContain("--resume");
  });
  it("硬限制不只靠 hook：permissions.deny + --disallowedTools 拒绝 Bash/WebFetch；hook onFailure=block", () => {
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(["Bash", "WebFetch"]),
    );
    expect(launch.args[launch.args.indexOf("--disallowedTools") + 1]).toMatch(
      /Bash/,
    );
    expect(settings.hooks.PreToolUse[0].hooks[0].onFailure).toBe("block");
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain(
      "pretool-hook.mjs",
    );
  });
  it("API Key 只进子进程 env，且最小化 env（不继承 Daemon 其他变量）", () => {
    expect(launch.env["ANTHROPIC_API_KEY"]).toBe(KEY);
    expect(launch.args.join(" ")).not.toContain(KEY);
    expect(fs.readFileSync(launch.settingsPath, "utf8")).not.toContain(KEY);
    expect(Object.keys(launch.env).sort()).toEqual(
      [
        "ANTHROPIC_API_KEY",
        "HOME",
        "LANG",
        "PATH",
        "STAGENT_HOOK_LOG",
        "STAGENT_HOOK_ROOT",
      ].sort(),
    );
    expect(redactSecret(`boom ${KEY} x`, KEY)).toBe("boom [REDACTED] x");
  });
  it("未实测：control_mode=UNCONTROLLED_EXTERNAL，verified_on 为空；无 Key 时不可用", () => {
    expect(adapter.info()).toMatchObject({
      control_mode: "UNCONTROLLED_EXTERNAL",
      verified_on: "",
      available: true,
    });
    expect(
      new ClaudeCodeAdapter({ apiKey: () => undefined }).info().available,
    ).toBe(false);
  });
});

describe("TASK-W.5a stream-json 解析", () => {
  it("init/result → session；text_delta → delta；tool_use/tool_result → 卡片；非 partial 时才用整段 text", () => {
    expect(
      translate({ type: "system", subtype: "init", session_id: "s" }, false),
    ).toEqual([{ kind: "session", native_session_id: "s" }]);
    expect(
      translate(
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "a" },
          },
        },
        false,
      ),
    ).toEqual([{ kind: "delta", text: "a" }]);
    const asst = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "全文" },
          { type: "tool_use", id: "1", name: "Write", input: {} },
        ],
      },
    };
    expect(translate(asst, true).map((e) => e.kind)).toEqual(["tool_call"]);
    expect(translate(asst, false).map((e) => e.kind)).toEqual([
      "delta",
      "tool_call",
    ]);
    expect(
      translate(
        { type: "result", is_error: true, result: "quota", session_id: "s" },
        false,
      ).map((e) => e.kind),
    ).toEqual(["session", "error"]);
  });
});

describe("TASK-W.5a PreToolUse hook：4 类绕过在 hook 层失败关闭（确定性，不调模型）", () => {
  const runHook = (payload: unknown, extraEnv: Record<string, string> = {}) =>
    spawnSync(process.execPath, [HOOK_SCRIPT], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      env: {
        PATH: process.env["PATH"] ?? "",
        STAGENT_HOOK_ROOT: tmp,
        ...extraEnv,
      },
      encoding: "utf8",
    });
  it("绕过 1：写 Worktree 外路径 → exit 2 + deny", () => {
    const r = runHook({
      tool_name: "Write",
      tool_input: { file_path: "/etc/evil.txt", content: "x" },
    });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe(
      "deny",
    );
  });
  it("绕过 2：未授权 Shell → 拒绝", () => {
    expect(
      runHook({ tool_name: "Bash", tool_input: { command: "ls" } }).status,
    ).toBe(2);
  });
  it("绕过 3：经 ../ 或 symlink 访问主工作树 → 拒绝", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-main-"));
    fs.symlinkSync(outside, path.join(tmp, "link"));
    expect(
      runHook({ tool_name: "Edit", tool_input: { file_path: "../main/a.ts" } })
        .status,
    ).toBe(2);
    expect(
      runHook({ tool_name: "Write", tool_input: { file_path: "link/a.ts" } })
        .status,
    ).toBe(2);
    expect(
      runHook({
        tool_name: "Read",
        tool_input: { file_path: path.join(outside, "x") },
      }).status,
    ).toBe(2);
    fs.rmSync(outside, { recursive: true, force: true });
  });
  it("绕过 4：非白名单原生/MCP 工具、写 .git/.claude → 拒绝；hook 输入异常 → 拒绝", () => {
    expect(
      runHook({ tool_name: "mcp__other__write", tool_input: {} }).status,
    ).toBe(2);
    expect(
      runHook({ tool_name: "Write", tool_input: { file_path: ".git/config" } })
        .status,
    ).toBe(2);
    expect(
      runHook({
        tool_name: "Edit",
        tool_input: { file_path: ".claude/settings.json" },
      }).status,
    ).toBe(2);
    expect(runHook("not json").status).toBe(2);
    expect(
      runHook(
        { tool_name: "Write", tool_input: { file_path: "a.ts" } },
        { STAGENT_HOOK_ROOT: "" },
      ).status,
    ).toBe(2);
  });
  it("正常写入 Worktree 内文件 → 放行", () => {
    expect(
      runHook({
        tool_name: "Write",
        tool_input: { file_path: path.join(tmp, "src", "a.ts") },
      }).status,
    ).toBe(0); // 父目录尚不存在（新建子目录）仍在根内 → 放行
    fs.mkdirSync(path.join(tmp, "src"));
    expect(
      runHook({ tool_name: "Write", tool_input: { file_path: "src/a.ts" } })
        .status,
    ).toBe(0);
    expect(
      runHook({ tool_name: "Read", tool_input: { file_path: "src/a.ts" } })
        .status,
    ).toBe(0);
  });
});

describe("TASK-W.5a cli-host 进程托管与打断 ≤2s（假 CLI）", () => {
  it("适配器跑通假 CLI：session / tool_call / tool_result / delta", async () => {
    const cmd = fakeCli(STREAMING);
    const a = new ClaudeCodeAdapter({ apiKey: () => KEY, command: cmd });
    const ev = await collect(
      a.run({
        prompt: "p",
        cwd: tmp,
        nativeSessionId: null,
        history: [],
        signal: new AbortController().signal,
      }),
    );
    expect(ev.map((e) => e.kind)).toEqual([
      "session",
      "tool_call",
      "tool_result",
      "delta",
      "delta",
      "delta",
      "session",
    ]);
  });
  it("打断：听 SIGINT 的 CLI 在 SIGINT 阶段停", async () => {
    const p = spawnManaged({
      command: fakeCli(STREAMING),
      args: [],
      cwd: tmp,
      env: { ...process.env, FAKE_TOKENS: "10000" },
    });
    await new Promise((r) => setTimeout(r, 150));
    const r = await p.stop();
    expect(r.via).toBe("SIGINT");
    expect(r.ms).toBeLessThan(2000);
  });
  it("打断：不理 SIGINT 的 CLI 被升级到 SIGTERM，总耗时 <2s", async () => {
    const p = spawnManaged({
      command: fakeCli(STREAMING),
      args: [],
      cwd: tmp,
      env: { ...process.env, FAKE_TOKENS: "10000", FAKE_IGNORE_SIGINT: "1" },
    });
    // 等假 CLI 吐出第一行（此时它已装好忽略 SIGINT 的处理器），避免固定等待在慢机器上偶发失败
    const it0 = p.lines[Symbol.asyncIterator]();
    await it0.next();
    const r = await p.stop();
    expect(["SIGTERM", "SIGKILL"]).toContain(r.via);
    expect(r.ms).toBeLessThan(2000);
  });
  it("通过 AbortSignal 打断适配器：2s 内迭代结束", async () => {
    const ac = new AbortController();
    const a = new ClaudeCodeAdapter({
      apiKey: () => KEY,
      command: fakeCli(STREAMING),
    });
    process.env["FAKE_TOKENS"] = "10000"; // 适配器最小化 env，此值不会传入 → 用 3 token 版也可
    const run = collect(
      a.run({
        prompt: "p",
        cwd: tmp,
        nativeSessionId: null,
        history: [],
        signal: ac.signal,
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    const t = Date.now();
    ac.abort();
    await run;
    expect(Date.now() - t).toBeLessThan(2000);
    delete process.env["FAKE_TOKENS"];
  });
  it("CLI 失败时错误信息里的 Key 被抹掉", async () => {
    const cmd = fakeCli(
      `process.stderr.write("auth failed for " + process.env.ANTHROPIC_API_KEY); process.exit(1);`,
    );
    const a = new ClaudeCodeAdapter({ apiKey: () => KEY, command: cmd });
    await expect(
      collect(
        a.run({
          prompt: "p",
          cwd: tmp,
          nativeSessionId: null,
          history: [],
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow(/\[REDACTED\]/);
    await expect(
      collect(
        a.run({
          prompt: "p",
          cwd: tmp,
          nativeSessionId: null,
          history: [],
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.not.toThrow(KEY);
  });
});

describe("TASK-W.5a spawn 静态禁令", () => {
  it("新代码中只有 cli-host 允许 import child_process（其余为既有模块白名单）", () => {
    const LEGACY = new Set([
      "daemon/pipeline/orchestrator.ts",
      "daemon/runner/command-runner.ts",
      "daemon/runner/process-tree.ts",
      "daemon/server.ts",
      "daemon/editor/launcher.ts",
      "daemon/git/worktree-manager.ts",
    ]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, n.name);
        if (n.isDirectory()) walk(p);
        else if (
          /\.(ts|tsx|mjs)$/.test(n.name) &&
          /from\s+["'](node:)?child_process["']|require\(["'](node:)?child_process/.test(
            fs.readFileSync(p, "utf8"),
          )
        )
          hits.push(path.relative(process.cwd(), p));
      }
    };
    walk(path.join(process.cwd(), "daemon"));
    walk(path.join(process.cwd(), "src"));
    const unexpected = hits.filter(
      (h) => !LEGACY.has(h) && !h.startsWith("daemon/worker/cli-host/"),
    );
    expect(unexpected).toEqual([]);
  });
});

describe("TASK-W.5a 兼容端点环境转发", () => {
  it("只转发 ANTHROPIC_BASE_URL/MODEL 等白名单变量，不泄漏其它环境", () => {
    const saved = { ...process.env };
    process.env["ANTHROPIC_BASE_URL"] = "https://example.invalid/anthropic";
    process.env["ANTHROPIC_MODEL"] = "m-1";
    process.env["SOME_OTHER_SECRET"] = "nope";
    try {
      const a = new ClaudeCodeAdapter({
        apiKey: () => "k",
        tmpRoot: os.tmpdir(),
      });
      const l = a.buildLaunch({
        prompt: "x",
        cwd: "/repo",
        nativeSessionId: null,
      });
      expect(l.env["ANTHROPIC_BASE_URL"]).toBe(
        "https://example.invalid/anthropic",
      );
      expect(l.env["ANTHROPIC_MODEL"]).toBe("m-1");
      expect(l.env["SOME_OTHER_SECRET"]).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });
});

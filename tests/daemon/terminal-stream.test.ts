import { describe, it, expect } from "vitest";
import {
  runCommand,
  MAX_STREAM_LINE_CHARS,
} from "../../daemon/runner/command-runner";

/**
 * TASK-C.5：终端回放必须「先脱敏、后截断」，且逐行实时回调。
 * 这里验证 runner 层：敏感值在离开进程前已变成 [REDACTED]，
 * 前端只做显示层头尾折叠，永远不会先截断再脱敏。
 */

const collect = () => {
  const lines: Array<{ stream: string; line: string }> = [];
  return {
    lines,
    onLine: (stream: "stdout" | "stderr", line: string) =>
      lines.push({ stream, line }),
  };
};

describe("TASK-C.5 终端流式回放（runner 层）", () => {
  it("逐行回调，且每行在发射前已脱敏", async () => {
    const sink = collect();
    const result = await runCommand("node", {
      argv: {
        executable: "node",
        args: [
          "-e",
          "console.log('API_KEY=sk-live-abcdef1234567890');console.log('普通输出')",
        ],
      },
      cwd: process.cwd(),
      timeoutMs: 30_000,
      onLine: sink.onLine,
    });
    expect(result.exitCode).toBe(0);
    const text = sink.lines.map((l) => l.line).join("\n");
    expect(text).toContain("API_KEY=[REDACTED]");
    expect(text).not.toContain("sk-live-abcdef1234567890");
    expect(text).toContain("普通输出");
    expect(sink.lines.every((l) => l.stream === "stdout")).toBe(true);
  });

  it("结尾无换行的最后一行也会被冲出（不丢日志）", async () => {
    const sink = collect();
    await runCommand("node", {
      argv: {
        executable: "node",
        args: ["-e", "process.stdout.write('tail-no-newline')"],
      },
      cwd: process.cwd(),
      timeoutMs: 30_000,
      onLine: sink.onLine,
    });
    expect(sink.lines.map((l) => l.line)).toContain("tail-no-newline");
  });

  it("单行超长时按上限截断并标注（脱敏后）", async () => {
    const sink = collect();
    const longTail = "x".repeat(MAX_STREAM_LINE_CHARS + 500);
    await runCommand("node", {
      argv: {
        executable: "node",
        args: ["-e", `console.log('${longTail}')`],
      },
      cwd: process.cwd(),
      timeoutMs: 30_000,
      onLine: sink.onLine,
    });
    const emitted = sink.lines[0]?.line ?? "";
    expect(emitted).toContain("[本行已截断]");
    expect(emitted.length).toBeLessThanOrEqual(MAX_STREAM_LINE_CHARS + 20);
  });

  it("JSON 形式的小写键（api_key / token）也会在发射前脱敏", async () => {
    const sink = collect();
    await runCommand("node", {
      argv: {
        executable: "node",
        args: [
          "-e",
          'console.log(JSON.stringify({api_key:"abc123secret",token:"tok-999",note:"ok"}))',
        ],
      },
      cwd: process.cwd(),
      timeoutMs: 30_000,
      onLine: sink.onLine,
    });
    const emitted = sink.lines[0]?.line ?? "";
    expect(emitted).not.toContain("abc123secret");
    expect(emitted).not.toContain("tok-999");
    const parsed = JSON.parse(emitted) as Record<string, string>;
    expect(parsed["api_key"]).toBe("[REDACTED]");
    expect(parsed["token"]).toBe("[REDACTED]");
    expect(parsed["note"]).toBe("ok");
  });

  it("敏感值即使与超长内容同行也先整体遮蔽，绝不露出片段", async () => {
    const sink = collect();
    const longTail = "y".repeat(MAX_STREAM_LINE_CHARS + 500);
    await runCommand("node", {
      argv: {
        executable: "node",
        args: ["-e", `console.log('TOKEN=abcdef1234567890${longTail}')`],
      },
      cwd: process.cwd(),
      timeoutMs: 30_000,
      onLine: sink.onLine,
    });
    const emitted = sink.lines[0]?.line ?? "";
    expect(emitted).toContain("TOKEN=[REDACTED]");
    expect(emitted).not.toContain("abcdef1234567890");
  });
});

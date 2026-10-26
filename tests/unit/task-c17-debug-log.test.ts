import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEBUG_LOG_ROTATE_BYTES,
  appendClientTrace,
  appendDaemonLog,
  appendJourneyTurn,
  appendLlmMeta,
  appendWorkerTerminalLog,
  daemonLogPath,
  journeyLogPath,
  newRequestId,
  readJourneyTurns,
  redactSecrets,
  sanitizeId,
  workerLogPath,
} from "../../daemon/core/debug-log";

const tmpDirs: string[] = [];

function newRepo(): string {
  const root = path.join(process.cwd(), ".tmp", "unit-c17-debug");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "repo-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("TASK-C.17 debug-log JSONL", () => {
  it("daemon.jsonl 写入含 ts/requestId/route/duration_ms，并轮转", () => {
    const repo = newRepo();
    const rid = newRequestId();
    appendDaemonLog(repo, {
      kind: "http",
      requestId: rid,
      route: "POST /api/supervisor/journey",
      code: "200",
      duration_ms: 12,
      contractId: "ctr_demo",
    });
    const file = daemonLogPath(repo);
    expect(fs.existsSync(file)).toBe(true);
    const line = fs.readFileSync(file, "utf8").trim().split("\n").at(-1)!;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed["level"]).toBe("info");
    expect(parsed["kind"]).toBe("http");
    expect(parsed["requestId"]).toBe(rid);
    expect(parsed["route"]).toBe("POST /api/supervisor/journey");
    expect(parsed["duration_ms"]).toBe(12);
    expect(typeof parsed["ts"]).toBe("string");

    // 简单轮转：塞满后再写一行应出现 .1
    const big = "x".repeat(64 * 1024);
    const target = DEBUG_LOG_ROTATE_BYTES;
    let written = fs.statSync(file).size;
    let guard = 0;
    while (written < target && guard < 500) {
      appendDaemonLog(repo, { kind: "http", route: "GET /pad", detail: { big } });
      written = fs.statSync(file).size;
      guard += 1;
      if (fs.existsSync(`${file}.1`)) break;
    }
    // 越过阈值后再写一次，触发 rotate-before-append
    if (!fs.existsSync(`${file}.1`)) {
      appendDaemonLog(repo, { kind: "http", route: "GET /pad", detail: { big } });
    }
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    // 这条要写满轮转阈值（每次 64KB + stat），并发下实测会顶到 30s 默认超时；
    // 超时是「等待预算」，给它 120s，避免把慢机器误判成轮转坏了。
  }, 120_000);

  it("journey 落盘可按合同读回（刷新还原）", () => {
    const repo = newRepo();
    appendJourneyTurn(repo, {
      role: "user",
      text: "我想做进度管控",
      contractId: "ctr_j1",
      sessionId: "ses_abcdefgh",
    });
    appendJourneyTurn(repo, {
      role: "assistant",
      text: "收到，先确认两件小事。",
      contractId: "ctr_j1",
      route: "MAJOR_DRAFT",
    });
    const turns = readJourneyTurns(repo, "ctr_j1");
    expect(turns).toHaveLength(2);
    expect(turns[0]?.role).toBe("user");
    expect(turns[1]?.role).toBe("assistant");
    expect(fs.existsSync(journeyLogPath(repo, "ctr_j1"))).toBe(true);
  });

  it("WORKER_LOG / TERMINAL_STREAM 有界落盘且脱敏", () => {
    const repo = newRepo();
    appendWorkerTerminalLog(repo, "ctr_w1", {
      source: "TERMINAL_STREAM",
      stream: "stdout",
      lines: ["API_KEY=sk-live-abcdef1234567890", "ok"],
    });
    appendWorkerTerminalLog(repo, "ctr_w1", {
      source: "WORKER_LOG",
      stream: "worker",
      lines: ["step 1 done"],
    });
    const raw = fs.readFileSync(workerLogPath(repo, "ctr_w1"), "utf8");
    expect(raw).toContain("TERMINAL_STREAM");
    expect(raw).toContain("WORKER_LOG");
    expect(raw).not.toContain("sk-live-abcdef1234567890");
    expect(raw).toContain("[REDACTED]");
  });

  it("client-events 写入同日志体系；LLM 元数据无密钥", () => {
    const repo = newRepo();
    appendClientTrace(repo, {
      kind: "cta_click",
      cta: "authorize",
      contractId: "ctr_c1",
    });
    appendClientTrace(repo, {
      kind: "viewport_change",
      viewport: "playtest",
    });
    appendClientTrace(repo, {
      kind: "cta_disabled",
      cta: "run-worker",
      disabled_reason: "no_contract",
    });
    appendLlmMeta(repo, {
      source: "enrich",
      duration_ms: 321,
      model: "deepseek-chat",
      enrichCode: "OK",
      input_tokens: 10,
      output_tokens: 20,
    });
    const text = fs.readFileSync(daemonLogPath(repo), "utf8");
    expect(text).toContain('"kind":"client"');
    expect(text).toContain("authorize");
    expect(text).toContain("playtest");
    expect(text).toContain("no_contract");
    expect(text).toContain('"kind":"llm"');
    expect(text).toContain("deepseek-chat");
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });

  it("sanitize / redact 护栏", () => {
    expect(sanitizeId("../evil/id")).toBe(".._evil_id");
    expect(redactSecrets("Authorization: Bearer abc.def.ghi")).toContain(
      "[REDACTED]",
    );
  });
});

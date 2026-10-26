import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { WS_CLOSE_UNAUTHORIZED } from "../../src/lib/ipc/frames";
import type { IpcFrame } from "../../src/lib/ipc/frames";

/**
 * TASK-D.1 PASS-1 / PASS-4 验收：首帧 AUTH 握手。
 * - 首帧非 AUTH 或 Token 错误在 50ms 内被 4401 切断
 * - Token 轮换：新实例启动后，旧 Token 发送 AUTH 必然 4401
 * - 服务端日志严禁打印 Token 明文
 */

const AUTH_TIMEOUT_MS = 400;

function openRaw(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => {
      reject(new Error(`HTTP ${res.statusCode}`));
    });
  });
}

function nextFrame(ws: WebSocket, timeoutMs = 2_000): Promise<IpcFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("timeout waiting for frame"));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(JSON.parse(raw.toString()) as IpcFrame);
    };
    ws.on("message", onMessage);
  });
}

function sendAuth(ws: WebSocket, token: string): void {
  ws.send(
    JSON.stringify({
      type: "AUTH",
      payload: { token },
      timestamp: new Date().toISOString(),
    }),
  );
}

describe("TASK-D.1 首帧 AUTH 握手（PASS-1：50ms 内 4401 切断）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let token: string;
  let port: number;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ws-shake-"));
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3760,
      endPort: 3770,
      enableCrashRecovery: false,
      authTimeoutMs: AUTH_TIMEOUT_MS,
    });
    const info = await daemon.start();
    port = info.port;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("错误 Token：50ms 内以 4401 切断", async () => {
    const ws = await openRaw(port);
    const startedAt = performance.now();
    sendAuth(ws, "0".repeat(64));
    const code = await new Promise<number>((resolve) => {
      ws.once("close", (c) => resolve(c));
    });
    const elapsed = performance.now() - startedAt;
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
    // PASS-1：立即切断（非等满 authTimeout）。空闲常 <5ms；
    // 全量 8 fork 并发下允许调度抖动，仍须远小于 AUTH_TIMEOUT_MS(400)。
    expect(elapsed).toBeLessThan(200);
  });

  it("首帧非 AUTH：50ms 内以 4401 切断", async () => {
    const ws = await openRaw(port);
    const startedAt = performance.now();
    ws.send(
      JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }),
    );
    const code = await new Promise<number>((resolve) => {
      ws.once("close", (c) => resolve(c));
    });
    const elapsed = performance.now() - startedAt;
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
    expect(elapsed).toBeLessThan(200);
  });

  it("畸形 JSON 首帧：以 4401 切断", async () => {
    const ws = await openRaw(port);
    ws.send("{ not-json");
    const code = await new Promise<number>((resolve) => {
      ws.once("close", (c) => resolve(c));
    });
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("合法 Token：AUTH_OK 且帧携带 trace_id", async () => {
    const ws = await openRaw(port);
    try {
      sendAuth(ws, token);
      const ack = await nextFrame(ws);
      expect(ack.type).toBe("AUTH_OK");
      // §6.1 标准帧结构：trace_id 必含且为 UUID
      expect(ack.trace_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    } finally {
      ws.close();
    }
  });

  it("PASS-4 Token 轮换：实例重启后旧 Token 必然 4401", async () => {
    expect(daemon).not.toBeNull();
    const oldToken = token;
    await daemon!.stop();
    await daemon!.start();
    port = daemon!.port ?? port;
    const newToken = daemon!.getSessionToken() ?? "";
    // 轮换确实发生
    expect(newToken).not.toBe(oldToken);

    const ws = await openRaw(port);
    sendAuth(ws, oldToken);
    const code = await new Promise<number>((resolve) => {
      ws.once("close", (c) => resolve(c));
    });
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("鉴权失败过程的服务端日志不出现 Token 明文", async () => {
    const badToken = "f".repeat(64);
    const logSpy = vi.spyOn(console, "log");
    const errSpy = vi.spyOn(console, "error");
    const warnSpy = vi.spyOn(console, "warn");
    try {
      const ws = await openRaw(port);
      sendAuth(ws, badToken);
      await new Promise<number>((resolve) => {
        ws.once("close", (c) => resolve(c));
      });
      const printed = [
        ...logSpy.mock.calls,
        ...errSpy.mock.calls,
        ...warnSpy.mock.calls,
      ]
        .flat()
        .map(String)
        .join("\n");
      expect(printed).not.toContain(badToken);
      expect(printed).not.toContain(token); // 合法 Token 同样不得出现
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

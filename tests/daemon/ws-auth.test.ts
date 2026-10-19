import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { WS_CLOSE_UNAUTHORIZED } from "../../src/lib/ipc/frames";
import type { IpcFrame } from "../../src/lib/ipc/frames";
import { StagentIpcClient } from "../../src/lib/ipc/client";

/**
 * WebSocket 鉴权专项（协议 v1.1：连接后第一帧 AUTH）。
 * 背景：浏览器原生 WebSocket 无法设置 Authorization 头，query 传 Token
 * 会泄漏进日志；统一为第一帧 AUTH + 失败 4401 断开。
 */

const AUTH_TIMEOUT_MS = 400;

function openRaw(
  port: number,
  url = `ws://127.0.0.1:${port}/ws`,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => {
      reject(new Error(`HTTP ${res.statusCode}`));
    });
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

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once("close", (code) => resolve(code));
  });
}

describe("WebSocket 第一帧 AUTH 鉴权（协议 v1.1）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let token: string;
  let port: number;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ws-auth-"));
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3740,
      endPort: 3750,
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

  it("合法 Token 的首帧 AUTH：收到 AUTH_OK，随后 PING/PONG 正常", async () => {
    const ws = await openRaw(port);
    try {
      sendAuth(ws, token);
      const ack = await nextFrame(ws);
      expect(ack.type).toBe("AUTH_OK");

      ws.send(
        JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }),
      );
      const pong = await nextFrame(ws);
      expect(pong.type).toBe("PONG");
      expect(daemon?.getClientCount()).toBe(1);
    } finally {
      ws.close();
    }
  });

  it("非法 Token：收到 E_UNAUTHORIZED 错误帧并以 4401 断开", async () => {
    const ws = await openRaw(port);
    sendAuth(ws, "0".repeat(64));
    const frame = await nextFrame(ws);
    expect(frame.type).toBe("ERROR");
    expect((frame.payload as { code: string }).code).toBe("E_UNAUTHORIZED");
    const code = await waitClose(ws);
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("首帧不是 AUTH（直接 PING）：立即以 4401 断开", async () => {
    const ws = await openRaw(port);
    ws.send(
      JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }),
    );
    const code = await waitClose(ws);
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("完全不发帧：AUTH 超时后以 4401 断开", async () => {
    const ws = await openRaw(port);
    const code = await waitClose(ws);
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("URL query 携带正确 Token 但不做 AUTH：不再豁免，超时 4401", async () => {
    const ws = await openRaw(
      port,
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`,
    );
    const code = await waitClose(ws);
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("未鉴权连接收不到广播帧", async () => {
    const ws = await openRaw(port);
    try {
      await new Promise((r) => setTimeout(r, 50));
      const sent = daemon?.broadcast("CONTRACT_UPDATE", {
        contract_id: "c1",
        lifecycle_state: "EXECUTING",
      });
      expect(sent).toBe(0);
    } finally {
      ws.close();
    }
  });

  it("StagentIpcClient 合法 Token 完整握手并收发 PING/PONG", async () => {
    const statuses: string[] = [];
    const client = new StagentIpcClient({
      port,
      token,
      websocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      onStatusChange: (s) => statuses.push(s),
    });
    client.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("connect timeout")),
        2000,
      );
      client.onStatusChange((s) => {
        if (s === "connected") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(statuses).toContain("connected");
    expect(client.send("PING")).toBe(true);
    client.close();
    expect(client.currentStatus).toBe("closed");
  });

  it("StagentIpcClient 非法 Token：收到 4401 后进入 closed 且不再重连", async () => {
    const client = new StagentIpcClient({
      port,
      token: "f".repeat(64),
      websocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
    });
    client.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("expected closed status")),
        2000,
      );
      client.onStatusChange((s) => {
        if (s === "closed") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(client.currentStatus).toBe("closed");
    // 4401 不应触发指数退避重连：等待 2 个退避周期确认无新连接
    await new Promise((r) => setTimeout(r, 300));
    expect(daemon?.getClientCount()).toBe(0);
  });
});

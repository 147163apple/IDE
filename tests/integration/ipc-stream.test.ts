import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  readSessionToken,
  SESSION_TOKEN_FILENAME,
} from "../../daemon/core/session-token";
import type { IpcFrame } from "../../src/lib/ipc/frames";

function connect(
  port: number,
  options: { token?: string; origin?: string; skipAuth?: boolean } = {},
): Promise<WebSocket> {
  const headers: Record<string, string> = {};
  if (options.origin) headers["origin"] = options.origin;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.once("open", () => {
      if (options.skipAuth || !options.token) {
        resolve(ws);
        return;
      }
      // 协议 v1.1：鉴权统一为连接后第一帧 AUTH，等待 AUTH_OK 才算握手成功
      ws.once("message", (raw: Buffer) => {
        const frame = JSON.parse(raw.toString()) as IpcFrame;
        if (frame.type === "AUTH_OK") resolve(ws);
        else reject(new Error(`unexpected first frame: ${frame.type}`));
      });
      ws.send(
        JSON.stringify({
          type: "AUTH",
          payload: { token: options.token },
          timestamp: new Date().toISOString(),
        }),
      );
    });
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

/** 跳过基线进度等旁路广播，等到指定类型（全量并发下防竞态）。 */
function waitForFrameType(
  ws: WebSocket,
  type: IpcFrame["type"],
  timeoutMs = 3_000,
): Promise<IpcFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`timeout waiting for ${type}`));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as IpcFrame;
      if (frame.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(frame);
    };
    ws.on("message", onMessage);
  });
}

describe("M4 / TASK-D.1 Local IPC / WebSocket 通信桥", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let token: string;
  let port: number;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m4-"));
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3660,
      endPort: 3670,
      enableCrashRecovery: false,
      authTimeoutMs: 400,
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

  it("session-token 落盘为 0600，PID 文件仅存元数据", () => {
    const tokenPath = path.join(repo, ".stagent", SESSION_TOKEN_FILENAME);
    expect(fs.existsSync(tokenPath)).toBe(true);
    expect(readSessionToken(repo)).toBe(token);

    const mode = fs.statSync(tokenPath).mode & 0o777;
    expect(mode).toBe(0o600);

    const pidRaw = fs.readFileSync(
      path.join(repo, ".stagent", "stagent.pid"),
      "utf-8",
    );
    expect(pidRaw).not.toContain(token);
  });

  it("未发送 AUTH 帧的连接在超时后以 4401 断开", async () => {
    const ws = await connect(port, { skipAuth: true });
    try {
      const code = await new Promise<number>((resolve) => {
        ws.once("close", (closeCode) => resolve(closeCode));
      });
      expect(code).toBe(4401);
    } finally {
      ws.close();
    }
  });

  it("非本地 Origin 被拒绝（403），即使 Token 正确", async () => {
    await expect(
      connect(port, { token, origin: "https://evil.example.com" }),
    ).rejects.toThrow(/403/);
  });

  it("本地 Origin + 首帧 AUTH 握手成功，PING 返回 PONG", async () => {
    const ws = await connect(port, {
      token,
      origin: "http://localhost:5173",
    });
    try {
      ws.send(
        JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }),
      );
      const frame = await nextFrame(ws);
      expect(frame.type).toBe("PONG");
    } finally {
      ws.close();
    }
  });

  it("服务端可主动推送 CONTRACT_UPDATE 与 WORKER_LOG（长日志截断）", async () => {
    const ws = await connect(port, { token });
    try {
      // 等待连接注册
      await new Promise((r) => setTimeout(r, 50));
      expect(daemon?.getClientCount()).toBe(1);

      daemon?.broadcast("CONTRACT_UPDATE", {
        contract_id: "c1",
        lifecycle_state: "EXECUTING",
      });
      const update = await waitForFrameType(ws, "CONTRACT_UPDATE");
      expect(update.payload).toMatchObject({ contract_id: "c1" });

      daemon?.emitWorkerLog("c1", ["x".repeat(20_000)]);
      const logFrame = await waitForFrameType(ws, "WORKER_LOG");
      const payload = logFrame.payload as {
        lines: string[];
        truncated?: boolean;
      };
      expect(payload.lines[0]?.length).toBeLessThanOrEqual(8_000 + 20);
      expect(payload.lines[0]).toContain("[truncated]");
    } finally {
      ws.close();
    }
  });

  it("未知帧类型返回 ERROR，非法 JSON 返回 ERROR", async () => {
    const ws = await connect(port, { token });
    try {
      ws.send(JSON.stringify({ type: "CUSTOM_FRAME", timestamp: "" }));
      const first = await nextFrame(ws);
      expect(first.type).toBe("ERROR");

      ws.send("not-json");
      const second = await nextFrame(ws);
      expect(second.type).toBe("ERROR");
    } finally {
      ws.close();
    }
  });
});

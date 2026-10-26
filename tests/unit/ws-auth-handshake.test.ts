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
 * - 首帧非 AUTH 或 Token 错误立即被 4401 切断（不等满 authTimeout）
 * - Token 轮换：新实例启动后，旧 Token 发送 AUTH 必然 4401
 * - 服务端日志严禁打印 Token 明文
 */

/**
 * 鉴权预算分两档：
 * - AUTH_TIMEOUT_MS 短档：拒绝/超时用例的被测参数，标尺要快才能做差；
 * - RELAXED_AUTH_TIMEOUT_MS 宽档：成功路径只要求「别误伤」——短档在 8 fork
 *   抢 CPU 时会把 AUTH 帧的处理拖过预算，服务端按配置先行 4401，
 *   合法 Token 也拿不到 AUTH_OK（表现为「服务端没反应」）。
 */
const AUTH_TIMEOUT_MS = 1_000;
const RELAXED_AUTH_TIMEOUT_MS = 10_000;

/**
 * 与 daemon/server.ts 里 rejectUnauthorized(reason) 的文案一致。
 * 两条路径都会发 4401，靠 reason 才能区分「为什么被切断」——
 * 这比计时可靠：帧可能在对端先 close 时丢失，但一旦拿到就能定性。
 */
const REASON_TOKEN_INVALID = "Invalid session token";
const REASON_FIRST_FRAME = "First frame must be AUTH";
const REASON_TIMEOUT = "AUTH frame required within auth timeout";

/** 关闭结论：close code + 服务端在 ERROR 帧里给出的原因（可能丢失，故可空） */
interface CloseOutcome {
  code: number;
  reason: string | null;
}

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

/**
 * 等连接关闭，顺带把服务端 ERROR 帧里的 message 捞出来。
 *
 * 注意 reason 允许为 null：服务端是先 send 再 close，客户端若被调度饿死，
 * 读缓冲里的 ERROR 可能随 socket 拆除一起丢掉。丢掉不等于没拒绝，
 * 所以上层用「不等于超时文案」而不是「等于某个文案」来断言。
 */
function closeOutcome(ws: WebSocket, timeoutMs = 5_000): Promise<CloseOutcome> {
  return new Promise((resolve, reject) => {
    let reason: string | null = null;
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", onClose);
      ws.off("error", onError);
    };
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ code, reason });
    };
    const onMessage = (raw: Buffer): void => {
      try {
        const frame = JSON.parse(raw.toString()) as {
          type?: string;
          payload?: { message?: unknown };
        };
        if (frame.type === "ERROR" && typeof frame.payload?.message === "string") {
          reason = frame.payload.message;
        }
      } catch {
        /* 非 JSON 帧与本题无关 */
      }
    };
    const onClose = (code: number): void => finish(code);
    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("timeout waiting for close"));
    }, timeoutMs);

    ws.on("message", onMessage);
    ws.once("close", onClose);
    ws.once("error", onError);
  });
}

/**
 * 等下一帧。超时是「等待预算」而不是延迟断言，所以给足 5s；
 * 连接先被关掉时立刻失败并报出 close code——否则只能干等 2s 再报
 * 「没等到帧」，把「服务端 4401 了」误诊成「服务端没反应」。
 */
function nextFrame(ws: WebSocket, timeoutMs = 5_000): Promise<IpcFrame> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", onClose);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout waiting for frame"));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      cleanup();
      resolve(JSON.parse(raw.toString()) as IpcFrame);
    };
    const onClose = (code: number) => {
      cleanup();
      reject(new Error(`socket closed before frame (code ${code})`));
    };
    ws.on("message", onMessage);
    ws.once("close", onClose);
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

describe("TASK-D.1 首帧 AUTH 握手（PASS-1：立即 4401 切断）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let token: string;
  let port: number;
  // 「等满 authTimeout 才切断」的实测耗时，作为拒绝延迟的标尺。
  let timeoutBaselineMs: number | null = null;

  /**
   * 延迟断言的标尺：连上但不发首帧，服务端必然等满 authTimeout 才 4401。
   *
   * 为什么不写死毫秒：8 fork 争 CPU 时事件循环会被整段顶住，拒绝路径的绝对
   * 耗时会被负载整体抬高（实测抖到 400ms 以上），任何硬编码阈值都在赌调度
   * 公平性。这里改成「与同一时刻的超时路径做差」——负载把两条路径同向推后，
   * 相减后只剩真实行为差，剩下的才是被测语义：拒绝了，而不是等到超时。
   */
  async function measureTimeoutBaseline(): Promise<number> {
    if (timeoutBaselineMs !== null) return timeoutBaselineMs;
    // 计时起点在「发起连接」之前：服务端的 authTimeout 只在连接建立后起算，
    // 所以这个下界恒定成立。若从 open 起量，握手期间被调度延迟吃掉的那段
    // 会让标尺缩水，差值断言随之失真。
    const startedAt = performance.now();
    const ws = await openRaw(port);
    const outcome = await closeOutcome(ws);
    const elapsed = performance.now() - startedAt;
    // 标尺自身要成立：真的等满了超时，而不是提前被别的原因踢掉
    expect(outcome.code).toBe(WS_CLOSE_UNAUTHORIZED);
    expect(elapsed).toBeGreaterThanOrEqual(AUTH_TIMEOUT_MS * 0.9);
    timeoutBaselineMs = elapsed;
    return elapsed;
  }

  // 端口段：与其余套件不重叠（原 3760–3770 与 chaos-concurrency 的 3770 撞车），
  // 登记表见 tests/unit/test-port-map.test.ts
  const PORT_RANGE = { startPort: 3830, endPort: 3839 } as const;

  /** 起（或重起）daemon；超时预算由用例选择，理由见文件顶部的两档说明 */
  async function startDaemon(authTimeoutMs: number): Promise<void> {
    if (daemon?.isRunning) await daemon.stop();
    daemon = createDaemon({
      repoRoot: repo,
      ...PORT_RANGE,
      enableCrashRecovery: false,
      authTimeoutMs,
    });
    const info = await daemon.start();
    port = info.port;
    token = daemon.getSessionToken() ?? "";
  }

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ws-shake-"));
    timeoutBaselineMs = null;
    await startDaemon(AUTH_TIMEOUT_MS);
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("错误 Token：以 4401 切断，且不是等满超时才断的", async () => {
    const baseline = await measureTimeoutBaseline();
    const startedAt = performance.now();
    const ws = await openRaw(port);
    sendAuth(ws, "0".repeat(64));
    const outcome = await closeOutcome(ws);
    const elapsed = performance.now() - startedAt;

    expect(outcome.code).toBe(WS_CLOSE_UNAUTHORIZED);
    // 行为判别（与负载无关）：只要不是被超时踢掉的就算对。
    // 帧可能因对端先 close 而丢失（reason 为 null），那种情况不构成反例。
    expect(outcome.reason).not.toBe(REASON_TIMEOUT);
    if (outcome.reason !== null) {
      expect(outcome.reason).toBe(REASON_TOKEN_INVALID);
    }
    // 相对测量：拒绝路径要比同机同刻测出的超时路径快出大半个预算。
    expect(baseline - elapsed).toBeGreaterThan(AUTH_TIMEOUT_MS / 2);
  });

  it("首帧非 AUTH：以 4401 切断，且不是等满超时才断的", async () => {
    const baseline = await measureTimeoutBaseline();
    const startedAt = performance.now();
    const ws = await openRaw(port);
    ws.send(
      JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }),
    );
    const outcome = await closeOutcome(ws);
    const elapsed = performance.now() - startedAt;

    expect(outcome.code).toBe(WS_CLOSE_UNAUTHORIZED);
    expect(outcome.reason).not.toBe(REASON_TIMEOUT);
    if (outcome.reason !== null) {
      expect(outcome.reason).toBe(REASON_FIRST_FRAME);
    }
    expect(baseline - elapsed).toBeGreaterThan(AUTH_TIMEOUT_MS / 2);
  });

  it("超时兜底：不发首帧则等满 authTimeout 才 4401（相对测量的标尺）", async () => {
    const elapsed = await measureTimeoutBaseline();
    // 这条不断言「快」，只确认标尺不是退化的：确实发生了 authTimeout 等待。
    // 若哪天服务端把超时改成立即切断，上面两条相对断言的差值会归零、
    // 以「快得可疑」的方式失效，这条会先拦住。
    expect(elapsed).toBeGreaterThanOrEqual(AUTH_TIMEOUT_MS * 0.9);
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
    // 成功路径换宽预算：它不该被「超时用例需要短预算」绑架
    await startDaemon(RELAXED_AUTH_TIMEOUT_MS);
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

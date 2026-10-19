import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDaemonStream } from "./use-daemon-stream";

/**
 * 用假的 WebSocket 替代网络，验证控制台实时流的接线（Track C）：
 * 鉴权帧顺序、状态机、日志/告警归集、有界缓冲、4401 不重连。
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  // ---- 测试辅助 ----
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(frame: Record<string, unknown>): void {
    this.onmessage?.({
      data: JSON.stringify({
        timestamp: new Date().toISOString(),
        ...frame,
      }),
    });
  }

  lastSent(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1] ?? "{}");
  }
}

function stubWebSocket(): void {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
}

describe("useDaemonStream：控制台实时流", () => {
  beforeEach(() => {
    stubWebSocket();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("连接后第一帧是 AUTH，且 URL 不携带 Token", () => {
    renderHook(() =>
      useDaemonStream({ port: 41792, token: "secret-token", enabled: true }),
    );

    const socket = FakeWebSocket.instances[0] as FakeWebSocket;
    expect(socket.url).toBe("ws://127.0.0.1:41792/ws");
    expect(socket.url).not.toContain("secret-token");

    act(() => socket.open());
    expect(socket.lastSent()).toMatchObject({
      type: "AUTH",
      payload: { token: "secret-token" },
    });
  });

  it("AUTH_OK 之前不置为 connected", () => {
    const { result } = renderHook(() =>
      useDaemonStream({ port: 41792, token: "t", enabled: true }),
    );
    const socket = FakeWebSocket.instances[0] as FakeWebSocket;

    act(() => socket.open());
    expect(result.current.status).toBe("connecting");

    act(() => socket.receive({ type: "AUTH_OK" }));
    expect(result.current.status).toBe("connected");
  });

  it("WORKER_LOG 累积为日志行，并受 500 行上限约束", () => {
    const { result } = renderHook(() =>
      useDaemonStream({ port: 41792, token: "t", enabled: true }),
    );
    const socket = FakeWebSocket.instances[0] as FakeWebSocket;
    act(() => {
      socket.open();
      socket.receive({ type: "AUTH_OK" });
    });

    act(() => {
      socket.receive({
        type: "WORKER_LOG",
        payload: { contract_id: "c1", lines: ["line-1", "line-2"] },
      });
    });
    expect(result.current.logs).toHaveLength(2);
    expect(result.current.logs[1]?.line).toBe("line-2");

    act(() => {
      socket.receive({
        type: "WORKER_LOG",
        payload: {
          contract_id: "c1",
          lines: Array.from({ length: 600 }, (_, i) => `bulk-${i}`),
        },
      });
    });
    expect(result.current.logs).toHaveLength(500);
    // 保留的是最近的日志
    expect(result.current.logs.at(-1)?.line).toBe("bulk-599");
  });

  it("SCOPE_ALERT 进入告警队列，可逐条关闭", () => {
    const { result } = renderHook(() =>
      useDaemonStream({ port: 41792, token: "t", enabled: true }),
    );
    const socket = FakeWebSocket.instances[0] as FakeWebSocket;
    act(() => {
      socket.open();
      socket.receive({ type: "AUTH_OK" });
      socket.receive({
        type: "SCOPE_ALERT",
        payload: {
          contract_id: "c1",
          code: "E_EVIDENCE_STALE",
          message: "evidence marked STALE",
        },
      });
    });

    expect(result.current.alerts).toHaveLength(1);
    expect(result.current.alerts[0]?.code).toBe("E_EVIDENCE_STALE");

    act(() => result.current.dismissAlert(result.current.alerts[0]!.id));
    expect(result.current.alerts).toHaveLength(0);
  });

  it("CONTRACT_UPDATE / EVIDENCE_READY 触发上层回调", () => {
    const onContractUpdate = vi.fn();
    const onEvidenceReady = vi.fn();
    renderHook(() =>
      useDaemonStream({
        port: 41792,
        token: "t",
        enabled: true,
        onContractUpdate,
        onEvidenceReady,
      }),
    );
    const socket = FakeWebSocket.instances[0] as FakeWebSocket;
    act(() => {
      socket.open();
      socket.receive({ type: "AUTH_OK" });
      socket.receive({
        type: "CONTRACT_UPDATE",
        payload: { contract_id: "c1", lifecycle_state: "AUDITED" },
      });
      socket.receive({
        type: "EVIDENCE_READY",
        payload: {
          contract_id: "c1",
          evidence_id: "evi_1",
          verdict: "PASSED",
          can_merge: true,
        },
      });
    });

    expect(onContractUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle_state: "AUDITED" }),
    );
    expect(onEvidenceReady).toHaveBeenCalledWith(
      expect.objectContaining({ evidence_id: "evi_1", can_merge: true }),
    );
  });

  it("4401 鉴权失败后保持 closed，不无限重连", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useDaemonStream({ port: 41792, token: "bad", enabled: true }),
      );
      const socket = FakeWebSocket.instances[0] as FakeWebSocket;

      act(() => socket.open());
      act(() => socket.close(4401));
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(result.current.status).toBe("closed");
      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("未启用或端口未知时不建立连接", () => {
    renderHook(() => useDaemonStream({ port: null, token: "t" }));
    expect(FakeWebSocket.instances).toHaveLength(0);

    renderHook(() =>
      useDaemonStream({ port: 41792, token: "t", enabled: false }),
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

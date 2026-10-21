import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  IDLE_PROTECTION_POLL_MS,
  ACTIVE_PROTECTION_POLL_MS,
  createArchGraphLoader,
  createProtectionPoller,
  protectionPollInterval,
  shouldFetchArchGraph,
  type VisibilityDocument,
} from "../../src/lib/perf-guards";

/** 缺口 4.2 / 4.4 前端性能守卫回归断言 */

class FakeDocument implements VisibilityDocument {
  hidden = false;
  private listeners = new Set<() => void>();

  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  emitVisibility(): void {
    for (const listener of this.listeners) listener();
  }
}

describe("4.2 架构图：建连不自动请求，仅手动触发", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("建连 30 秒内请求计数严格为 0，手动点击才 +1", async () => {
    const fetchGraph = vi.fn(async () => ({ nodes: [] }));
    const loader = createArchGraphLoader(fetchGraph);

    loader.onConnected();
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(fetchGraph).toHaveBeenCalledTimes(0);
    expect(loader.callCount()).toBe(0);
    expect(shouldFetchArchGraph("connected")).toBe(false);

    await loader.load();
    expect(fetchGraph).toHaveBeenCalledTimes(1);
    expect(loader.callCount()).toBe(1);
    expect(shouldFetchArchGraph("manual")).toBe(true);
  });
});

describe("4.4 protection 轮询：可见性与活跃状态自适应", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("隐藏页 0 请求；回前台 1 秒内补偿 1 次", async () => {
    const doc = new FakeDocument();
    doc.hidden = true;
    const fetchProtection = vi.fn(async () => undefined);
    const poller = createProtectionPoller({
      fetchProtection,
      hasActiveWork: () => true,
      doc,
    });
    poller.start();

    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(fetchProtection).toHaveBeenCalledTimes(0);

    doc.hidden = false;
    doc.emitVisibility();
    await Promise.resolve();
    expect(fetchProtection).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ACTIVE_PROTECTION_POLL_MS);
    await Promise.resolve();
    expect(fetchProtection).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("无活跃工作时轮询间隔 ≥ 60s；有活跃工作时 3s", () => {
    expect(protectionPollInterval(false)).toBe(IDLE_PROTECTION_POLL_MS);
    expect(protectionPollInterval(true)).toBe(ACTIVE_PROTECTION_POLL_MS);
    expect(IDLE_PROTECTION_POLL_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("空闲间隔实测：59.999s 前不发请求，60s 才发一次", async () => {
    const doc = new FakeDocument();
    const fetchProtection = vi.fn(async () => undefined);
    const poller = createProtectionPoller({
      fetchProtection,
      hasActiveWork: () => false,
      doc,
    });
    poller.start();

    vi.advanceTimersByTime(59_999);
    await Promise.resolve();
    expect(fetchProtection).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(fetchProtection).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("stop 后不再轮询，避免卸载后空转", async () => {
    const doc = new FakeDocument();
    const fetchProtection = vi.fn(async () => undefined);
    const poller = createProtectionPoller({
      fetchProtection,
      hasActiveWork: () => false,
      doc,
    });
    poller.start();
    poller.stop();

    vi.advanceTimersByTime(120_000);
    await Promise.resolve();
    expect(fetchProtection).toHaveBeenCalledTimes(0);
    expect(poller.isRunning()).toBe(false);
  });
});

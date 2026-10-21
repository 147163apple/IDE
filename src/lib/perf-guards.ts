/**
 * 前端性能守卫（缺口 4.2 / 4.4）。
 *
 * 4.2：架构图只允许用户显式触发；WebSocket 建连不得自动请求 `/api/arch/graph`。
 * 4.4：protection 轮询按页面可见性与活跃状态自适应：
 *      - 隐藏页暂停；
 *      - 恢复可见立即补偿一次；
 *      - 无活跃工作 60s，有活跃工作 3s。
 */

export const ACTIVE_PROTECTION_POLL_MS = 3_000;
export const IDLE_PROTECTION_POLL_MS = 60_000;

export type ArchGraphTrigger = "connected" | "manual";

/** 只有显式手动触发才允许请求架构图 */
export function shouldFetchArchGraph(trigger: ArchGraphTrigger): boolean {
  return trigger === "manual";
}

export function protectionPollInterval(hasActiveWork: boolean): number {
  return hasActiveWork ? ACTIVE_PROTECTION_POLL_MS : IDLE_PROTECTION_POLL_MS;
}

export interface ArchGraphLoader<T> {
  /** WebSocket 建连事件：明确空实现，不触发请求 */
  onConnected(): void;
  /** 用户点击「查看架构图 / 依赖拓扑」时调用 */
  load(): Promise<T>;
  callCount(): number;
}

export function createArchGraphLoader<T>(
  fetchGraph: () => Promise<T>,
): ArchGraphLoader<T> {
  let calls = 0;
  return {
    onConnected(): void {
      // 缺口 4.2：建连不再自动拉取；保留方法便于接线时显式表达“无动作”
    },
    async load(): Promise<T> {
      calls += 1;
      return fetchGraph();
    },
    callCount(): number {
      return calls;
    },
  };
}

export interface VisibilityDocument {
  hidden: boolean;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}

export interface ProtectionPollerOptions {
  fetchProtection: () => Promise<void>;
  hasActiveWork: () => boolean;
  doc?: VisibilityDocument;
}

export interface ProtectionPoller {
  start(): void;
  stop(): void;
  /** 立即拉取一次（切回前台补偿 / 手动刷新） */
  refreshNow(): Promise<void>;
  isRunning(): boolean;
}

/**
 * 可见性感知 + 状态自适应轮询器。
 * 隐藏时销毁定时器；恢复可见先补偿刷新一次，再按当前活跃状态重置间隔。
 */
export function createProtectionPoller(
  options: ProtectionPollerOptions,
): ProtectionPoller {
  const doc = options.doc ?? (globalThis.document as VisibilityDocument);
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const clear = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = async (): Promise<void> => {
    try {
      await options.fetchProtection();
    } catch {
      // 单次失败不终止轮询；门卫在后台仍按失败关闭运行
    }
  };

  const schedule = (): void => {
    clear();
    if (!running || doc.hidden) return;
    timer = setInterval(
      () => void tick(),
      protectionPollInterval(options.hasActiveWork()),
    );
  };

  const onVisibilityChange = (): void => {
    if (doc.hidden) {
      clear();
      return;
    }
    // 恢复可见：立刻补偿一次，再重置定时器
    void tick();
    schedule();
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      doc.addEventListener("visibilitychange", onVisibilityChange);
      schedule();
    },
    stop(): void {
      running = false;
      clear();
      doc.removeEventListener("visibilitychange", onVisibilityChange);
    },
    async refreshNow(): Promise<void> {
      await tick();
    },
    isRunning(): boolean {
      return running && timer !== null;
    },
  };
}

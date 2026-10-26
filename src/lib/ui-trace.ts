/**
 * TASK-C.17：前端轻量 UI trace（CTA / viewport / disabled）
 * 批量 POST /api/client-events → Daemon `.stagent/logs/daemon.jsonl`
 * 失败静默；刷新不丢（已落盘）。
 */
import { postClientEvents, type ClientTraceEventInput } from "./daemon-api";

const queue: ClientTraceEventInput[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

const FLUSH_MS = 400;
const MAX_BATCH = 20;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushUiTrace();
  }, FLUSH_MS);
}

export function traceUiEvent(event: ClientTraceEventInput): void {
  queue.push({
    ...event,
    ts: event.ts ?? new Date().toISOString(),
  });
  if (queue.length >= MAX_BATCH) {
    void flushUiTrace();
    return;
  }
  scheduleFlush();
}

export function traceCtaClick(
  cta: string,
  extra: Omit<ClientTraceEventInput, "kind" | "cta"> = {},
): void {
  traceUiEvent({ kind: "cta_click", cta, ...extra });
}

export function traceViewportChange(
  viewport: string,
  extra: Omit<ClientTraceEventInput, "kind" | "viewport"> = {},
): void {
  traceUiEvent({ kind: "viewport_change", viewport, ...extra });
}

export function traceCtaDisabled(
  cta: string,
  disabled_reason: string,
  extra: Omit<ClientTraceEventInput, "kind" | "cta" | "disabled_reason"> = {},
): void {
  traceUiEvent({ kind: "cta_disabled", cta, disabled_reason, ...extra });
}

export async function flushUiTrace(): Promise<void> {
  if (flushing) return;
  if (queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await postClientEvents(batch);
  } catch {
    // 放回队头，下次再试（有界）
    queue.unshift(...batch.slice(0, MAX_BATCH));
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

/** 测试用：清空队列 */
export function __resetUiTraceForTests(): void {
  queue.length = 0;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushing = false;
}

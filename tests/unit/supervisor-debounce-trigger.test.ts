import { describe, expect, it } from "vitest";
import {
  mapWakeTriggerToDraftTrigger,
  SNOOZE_DEFAULT_MS,
  SupervisorWakeupThrottler,
  WAKEUP_DEBOUNCE_MS,
  type ThrottleScheduler,
  type WakeupEvaluationContext,
} from "../../daemon/supervisor/throttler";

/**
 * TASK-S.1 目标 5：唤醒节流器（A §2.2 Debounce & Event-driven / v1.3.3）。
 *
 * 对应 B 文档 PASS 判据：
 * - Worker 流式生成期间 Supervisor 模型调用次数**严格为 0**；
 * - UI 显式请求与控制面异常事件 100% 正确触发；
 * - 3s 防抖开关**关闭**时打字零触发；**开启**时按既有 18 用例通过。
 *
 * 时间源为注入的 `FakeScheduler`，测试无需真实等待，且能精确断言 3s 边界
 * （2999ms 不触发 / 3000ms 触发），避免 CI 抖动导致的假绿或假红。
 */

/** 可手工推进的确定性调度器 */
class FakeScheduler implements ThrottleScheduler {
  private current = 0;
  private nextId = 1;
  private readonly timers = new Map<
    number,
    { at: number; handler: () => void }
  >();

  now(): number {
    return this.current;
  }

  setTimeout(handler: () => void, delayMs: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.current + delayMs, handler });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.timers.delete(handle);
  }

  /** 推进时钟并按到期顺序同步执行回调（回调内新排的定时器同样参与） */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      let due: { id: number; at: number; handler: () => void } | null = null;
      for (const [id, timer] of this.timers) {
        if (timer.at > target) continue;
        if (due === null || timer.at < due.at) {
          due = { id, at: timer.at, handler: timer.handler };
        }
      }
      if (due === null) break;
      this.timers.delete(due.id);
      this.current = due.at;
      due.handler();
    }
    this.current = target;
  }

  get pendingTimers(): number {
    return this.timers.size;
  }
}

interface Harness {
  throttler: SupervisorWakeupThrottler;
  calls: WakeupEvaluationContext[];
  scheduler: FakeScheduler;
}

function makeHarness(
  options: {
    debounceMs?: number;
    snoozeMs?: number;
    /** 既有 18 例默认开启；默认关闭用例显式传 false / 省略 */
    idleDebounceEnabled?: boolean;
  } = {},
): Harness {
  const calls: WakeupEvaluationContext[] = [];
  const scheduler = new FakeScheduler();
  const throttler = new SupervisorWakeupThrottler({
    evaluate: (context) => {
      calls.push(context);
    },
    scheduler,
    // 历史 18 例需要开启防抖；未显式传入时由用例自己决定
    ...options,
  });
  return { throttler, calls, scheduler };
}

/** 开启 3s 防抖的 harness（覆盖历史 18 例） */
function makeDebounceOnHarness(
  options: { debounceMs?: number; snoozeMs?: number } = {},
): Harness {
  return makeHarness({ ...options, idleDebounceEnabled: true });
}

describe("v1.3.3 默认关闭：对话停顿 3s 不评估", () => {
  it("构造时未传 idleDebounceEnabled → 默认为 false", () => {
    const { throttler } = makeHarness();
    expect(throttler.idleDebounceEnabled).toBe(false);
    expect(throttler.state.idle_debounce_enabled).toBe(false);
  });

  it("开关关闭时连续打字 + 推进远超 3s → model_calls 严格为 0", async () => {
    const { throttler, calls, scheduler } = makeHarness();

    for (let i = 0; i < 20; i += 1) {
      const decision = throttler.notifyUserTyping();
      expect(decision.allowed).toBe(false);
      expect(decision.blocked_by).toBe("DEBOUNCE_DISABLED");
      expect(decision.trigger).toBe("IDLE_DEBOUNCE");
    }

    scheduler.advance(WAKEUP_DEBOUNCE_MS * 10);
    await throttler.drain();

    expect(calls).toHaveLength(0);
    expect(throttler.stats.model_calls).toBe(0);
    expect(throttler.stats.allowed).toBe(0);
    expect(throttler.hasPendingDebounce).toBe(false);
    expect(scheduler.pendingTimers).toBe(0);
    expect(throttler.stats.suppressed_inputs).toBe(20);
  });

  it("开关关闭不影响显式点击与控制面阻断（实测启用路径）", async () => {
    const { throttler, calls } = makeHarness();

    expect(throttler.notifyUserExplicit().allowed).toBe(true);
    expect(throttler.notifyWorkerBlocked("BUDGET_ALERT").allowed).toBe(true);
    await throttler.drain();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.trigger).toBe("USER_EXPLICIT");
    expect(calls[1]?.trigger).toBe("WORKER_BLOCKED");
    expect(throttler.stats.model_calls).toBe(2);
  });

  it("运行中开启防抖后打字可按 3s 触发；再关闭会取消待触发窗口", async () => {
    const { throttler, calls, scheduler } = makeHarness();

    throttler.setIdleDebounceEnabled(true);
    expect(throttler.idleDebounceEnabled).toBe(true);

    throttler.notifyUserTyping();
    expect(throttler.hasPendingDebounce).toBe(true);

    throttler.setIdleDebounceEnabled(false);
    expect(throttler.hasPendingDebounce).toBe(false);
    expect(throttler.stats.suppressed_inputs).toBe(1);

    scheduler.advance(WAKEUP_DEBOUNCE_MS * 2);
    await throttler.drain();
    expect(calls).toHaveLength(0);
    expect(throttler.stats.model_calls).toBe(0);
  });

  it("mapWakeTriggerToDraftTrigger 与 draft-generator 枚举对齐", () => {
    expect(mapWakeTriggerToDraftTrigger("USER_EXPLICIT")).toBe("USER_REQUEST");
    expect(mapWakeTriggerToDraftTrigger("WORKER_BLOCKED")).toBe(
      "CONTROL_PLANE_EVENT",
    );
    expect(mapWakeTriggerToDraftTrigger("WORKER_TURN_END")).toBe(
      "CONTROL_PLANE_EVENT",
    );
    expect(mapWakeTriggerToDraftTrigger("IDLE_DEBOUNCE")).toBe(
      "DEBOUNCE_TIMER",
    );
  });
});

describe("防抖窗口：3 秒内连续输入只评估一次", () => {
  it("连续 5 次输入（间隔 400ms）→ 仅 1 次模型调用，且合并计数为 5", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    for (let i = 0; i < 5; i += 1) {
      throttler.notifyUserTyping();
      scheduler.advance(400);
    }
    // 第 5 次输入后窗口尚未到期
    expect(calls).toHaveLength(0);
    expect(throttler.hasPendingDebounce).toBe(true);

    scheduler.advance(WAKEUP_DEBOUNCE_MS);
    await throttler.drain();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.trigger).toBe("IDLE_DEBOUNCE");
    expect(calls[0]?.coalesced_inputs).toBe(5);

    const stats = throttler.stats;
    expect(stats.model_calls).toBe(1);
    expect(stats.allowed).toBe(1);
    expect(stats.blocked).toBe(5);
    expect(stats.coalesced_inputs).toBe(5);
  });

  it("窗口边界：2999ms 不触发，3000ms 触发（严格 3s 防抖）", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.notifyUserTyping();
    scheduler.advance(WAKEUP_DEBOUNCE_MS - 1);
    await throttler.drain();
    expect(calls).toHaveLength(0);

    scheduler.advance(1);
    await throttler.drain();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.coalesced_inputs).toBe(1);
  });

  it("输入持续到来会重置窗口，不会在第一次输入后固定触发", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.notifyUserTyping();
    scheduler.advance(2_500);
    throttler.notifyUserTyping(); // 重置窗口
    scheduler.advance(2_500);
    await throttler.drain();
    expect(calls).toHaveLength(0);

    scheduler.advance(500);
    await throttler.drain();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.coalesced_inputs).toBe(2);
  });
});

describe("显式唤醒：优先于防抖窗口且不重复触发", () => {
  it("打字后点击建议卡 → 立即评估一次，合并已输入内容，窗口被取消", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.notifyUserTyping();
    throttler.notifyUserTyping();
    const decision = throttler.notifyUserExplicit();
    await throttler.drain();

    expect(decision.allowed).toBe(true);
    expect(decision.trigger).toBe("USER_EXPLICIT");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.trigger).toBe("USER_EXPLICIT");
    expect(calls[0]?.coalesced_inputs).toBe(2);

    // 原窗口已取消，不得再次触发
    scheduler.advance(WAKEUP_DEBOUNCE_MS * 2);
    await throttler.drain();
    expect(calls).toHaveLength(1);
    expect(throttler.hasPendingDebounce).toBe(false);
  });

  it("静默期外的重复显式点击各自触发（显式意图不被防抖吞掉）", async () => {
    const { throttler, calls } = makeDebounceOnHarness();

    throttler.notifyUserExplicit();
    throttler.notifyUserExplicit();
    await throttler.drain();

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.trigger === "USER_EXPLICIT")).toBe(true);
  });
});

describe("Worker 静默：流式生成 / 工具连续执行期间零模型调用", () => {
  it("STREAMING 期间 5 次输入 + 显式点击 + 阻断事件 → model_calls 严格为 0", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.setWorkerActivity("STREAMING");
    for (let i = 0; i < 5; i += 1) {
      const decision = throttler.notifyUserTyping();
      expect(decision.allowed).toBe(false);
      expect(decision.blocked_by).toBe("WORKER_MUTED");
    }
    expect(throttler.notifyUserExplicit().blocked_by).toBe("WORKER_MUTED");
    expect(throttler.notifyWorkerBlocked("BLOCKED").blocked_by).toBe(
      "WORKER_MUTED",
    );

    scheduler.advance(WAKEUP_DEBOUNCE_MS * 3);
    await throttler.drain();

    expect(calls).toHaveLength(0);
    expect(throttler.stats.model_calls).toBe(0);
    expect(throttler.stats.allowed).toBe(0);
  });

  it("TOOL_RUNNING（工具连续执行）同样 100% 拦截", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.setWorkerActivity("TOOL_RUNNING");
    throttler.notifyUserTyping();
    throttler.notifyUserExplicit();
    scheduler.advance(WAKEUP_DEBOUNCE_MS * 2);
    await throttler.drain();

    expect(calls).toHaveLength(0);
    expect(throttler.stats.model_calls).toBe(0);
    expect(throttler.isMuted).toBe(true);
  });

  it("静默开始时取消已排队的防抖窗口（杜绝流式期间延迟引爆）", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.notifyUserTyping(); // 3s 后本会触发
    throttler.setWorkerActivity("STREAMING");

    scheduler.advance(WAKEUP_DEBOUNCE_MS * 2);
    await throttler.drain();

    expect(calls).toHaveLength(0);
    expect(throttler.stats.model_calls).toBe(0);
    expect(throttler.stats.suppressed_inputs).toBe(1);
    expect(throttler.hasPendingDebounce).toBe(false);
  });
});

describe("静默解除：Worker 轮次结束后恢复评估", () => {
  it("turn end 解除静默，并以 WORKER_TURN_END 触发一次评估", async () => {
    const { throttler, calls } = makeDebounceOnHarness();

    throttler.setWorkerActivity("STREAMING");
    throttler.notifyUserTyping();
    expect(throttler.isMuted).toBe(true);

    const decision = throttler.notifyWorkerTurnEnd();
    await throttler.drain();

    expect(decision.allowed).toBe(true);
    expect(decision.trigger).toBe("WORKER_TURN_END");
    expect(throttler.isMuted).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.trigger).toBe("WORKER_TURN_END");
    expect(throttler.stats.model_calls).toBe(1);
  });

  it("静默期间的阻断事件在 turn end 合并为 WORKER_BLOCKED（信号不丢失）", async () => {
    const { throttler, calls } = makeDebounceOnHarness();

    throttler.setWorkerActivity("STREAMING");
    throttler.notifyWorkerBlocked("E_BUDGET_EXCEEDED");
    throttler.notifyWorkerBlocked("consecutive test failures");
    expect(throttler.stats.model_calls).toBe(0);

    throttler.notifyWorkerTurnEnd();
    await throttler.drain();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.trigger).toBe("WORKER_BLOCKED");
    expect(throttler.stats.model_calls).toBe(1);
  });

  it("轮次结束后恢复常规防抖能力（解除静默不是一次性开关）", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.setWorkerActivity("STREAMING");
    throttler.notifyWorkerTurnEnd();
    await throttler.drain();
    expect(calls).toHaveLength(1);

    throttler.notifyUserTyping();
    scheduler.advance(WAKEUP_DEBOUNCE_MS);
    await throttler.drain();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.trigger).toBe("IDLE_DEBOUNCE");
  });

  it("turn end 会合并待触发的输入窗口，不会重复评估", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.notifyUserTyping();
    throttler.notifyUserTyping();
    throttler.notifyWorkerTurnEnd();
    await throttler.drain();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.trigger).toBe("WORKER_TURN_END");
    expect(calls[0]?.coalesced_inputs).toBe(2);

    scheduler.advance(WAKEUP_DEBOUNCE_MS * 2);
    await throttler.drain();
    expect(calls).toHaveLength(1);
    expect(throttler.hasPendingDebounce).toBe(false);
  });
});

describe("控制面阻断事件（BLOCKED / 预算报警）立即唤醒", () => {
  it("空闲态收到阻断事件 → 立即触发一次 WORKER_BLOCKED", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    const decision = throttler.notifyWorkerBlocked("BUDGET_ALERT");
    await throttler.drain();

    expect(decision.allowed).toBe(true);
    expect(decision.trigger).toBe("WORKER_BLOCKED");
    expect(calls).toHaveLength(1);
    expect(scheduler.pendingTimers).toBe(0);
  });
});

describe("SNOOZE：静默 10 分钟不打扰", () => {
  it("默认静默期为 10 分钟，期内所有唤醒被拒绝", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.snooze();
    expect(SNOOZE_DEFAULT_MS).toBe(10 * 60 * 1_000);

    expect(throttler.notifyUserExplicit().blocked_by).toBe("SNOOZED");
    expect(throttler.notifyUserTyping().blocked_by).toBe("SNOOZED");
    scheduler.advance(SNOOZE_DEFAULT_MS - 1);
    await throttler.drain();
    expect(calls).toHaveLength(0);
    expect(throttler.stats.model_calls).toBe(0);
  });

  it("静默期届满后自动恢复，无需显式 resume", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.snooze(1_000);
    scheduler.advance(1_000);

    const decision = throttler.notifyUserExplicit();
    await throttler.drain();

    expect(decision.allowed).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("生命周期与可观测性", () => {
  it("dispose 清除待触发窗口，不再产生评估", async () => {
    const { throttler, calls, scheduler } = makeDebounceOnHarness();

    throttler.notifyUserTyping();
    throttler.dispose();
    scheduler.advance(WAKEUP_DEBOUNCE_MS * 2);
    await throttler.drain();

    expect(calls).toHaveLength(0);
    expect(throttler.hasPendingDebounce).toBe(false);
  });

  it("评估回调抛错被捕获并记录，不打断后续唤醒", async () => {
    const scheduler = new FakeScheduler();
    const calls: WakeupEvaluationContext[] = [];
    const throttler = new SupervisorWakeupThrottler({
      evaluate: (context) => {
        calls.push(context);
        if (calls.length === 1) throw new Error("model unavailable");
      },
      scheduler,
      idleDebounceEnabled: true,
    });

    throttler.notifyUserExplicit();
    await throttler.drain();
    expect(throttler.lastEvaluationError?.message).toBe("model unavailable");

    throttler.notifyUserExplicit();
    await throttler.drain();

    expect(calls).toHaveLength(2);
    expect(throttler.lastEvaluationError?.message).toBe("model unavailable");
  });

  it("统计口径：仅放行递增 model_calls，被拦截的请求只计入 blocked", () => {
    const { throttler } = makeDebounceOnHarness();

    throttler.notifyUserTyping();
    throttler.setWorkerActivity("STREAMING");
    throttler.notifyUserExplicit();

    const stats = throttler.stats;
    expect(stats.model_calls).toBe(0);
    expect(stats.allowed).toBe(0);
    expect(stats.blocked).toBe(2);
    expect(stats.suppressed_inputs).toBe(1);
  });
});

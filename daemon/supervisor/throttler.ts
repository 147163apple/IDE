/**
 * Supervisor 唤醒节流器（TASK-S.1 目标 5 / 规范 A §2.2 / v1.3.3）。
 *
 * 法条要点（A §2.2「唤醒与节流策略 (Debounce & Event-driven)」+ v1.3.3 修订）：
 * - 严禁伴随 Worker 逐 Token 生成进行盲目轮询调用；
 * - 实测启用的唤醒时机：① 用户显式点击审阅或主动提问；
 *   ② Gateway 违规 / 熔断 / 连续测试失败 / 预算报警等控制面事件；
 *   ③ Worker 回合结束（可与触及保护区的 diff 联动，由宿主决定是否评估）。
 * - 「对话停顿 3s 即评估」（`IDLE_DEBOUNCE`）**默认关闭**，仅保留代码与
 *   `idleDebounceEnabled` 配置开关；关闭时 VIBE 下连续聊天 Supervisor
 *   模型调用应为 0（除非用户点击或控制面事件）。
 * - 支持客户端 `SNOOZE`，自动静默 10 分钟不打扰用户编码。
 *
 * 本模块是「唤醒决策的唯一出口」：宿主（会话路由 / Daemon）只通过它决定
 * 是否发起模型调用。下列不变式在类型与实现层同时成立：
 *
 * 1. **Worker 静默不变式**：`activity !== "IDLE"`（流式生成 / 工具连续执行）
 *    期间，任何唤醒请求都被拒绝，并且**不排队、不补发**——模型调用计数严格为 0。
 *    静默开始时若存在待触发的防抖窗口，窗口被直接取消。
 * 2. **单次唤醒不变式**：防抖窗口内的 N 次输入只产生 1 次评估，`coalesced_inputs`
 *    如实记录被合并的输入条数。
 * 3. **信号不丢失**：静默期间到达的阻断事件记入 `pending_blocked`，在轮次结束
 *    时合并为一次 `WORKER_BLOCKED` 唤醒。
 * 4. **默认关闭不变式**：`idleDebounceEnabled === false`（默认）时，
 *    `notifyUserTyping` 不排程、不评估；显式 / 控制面 / 回合结束路径不受影响。
 *
 * 依赖纪律（B TASK-S.1 目标 2）：本文件不引入任何 I/O、子进程或特权执行模块，
 * 时间源与定时器均可注入，测试无需真实等待 3 秒。
 *
 * 与 `draft-generator` 的对齐：宿主在 `evaluate` 回调里应把
 * {@link mapWakeTriggerToDraftTrigger} 的结果作为 `trigger` 传入
 * `generateContractDraft`——`IDLE_DEBOUNCE` 会映射为 `DEBOUNCE_TIMER`，
 * 被草案生成器硬拒绝，形成「节流器开关 + 生成器硬门」双保险。
 */

/** 防抖窗口：右侧对话停顿 3 秒后才允许一次空闲唤醒（A §2.2 ①；默认关闭） */
export const WAKEUP_DEBOUNCE_MS = 3_000;

/** `SNOOZE` 默认静默时长：10 分钟（A §2.2） */
export const SNOOZE_DEFAULT_MS = 10 * 60 * 1_000;

/**
 * 合法唤醒时机（B TASK-S.1 目标 5）：
 * - `USER_EXPLICIT`：用户显式点击建议卡 / 主动请求分析（实测启用）；
 * - `WORKER_TURN_END`：Worker 执行轮次正常结束（实测启用）；
 * - `WORKER_BLOCKED`：Daemon 抛出 BLOCKED / 连续测试失败 / 预算报警（实测启用）；
 * - `IDLE_DEBOUNCE`：对话流停顿达到防抖窗口（v1.3.3 **默认关闭**）。
 */
export type SupervisorWakeTrigger =
  "USER_EXPLICIT" | "WORKER_TURN_END" | "WORKER_BLOCKED" | "IDLE_DEBOUNCE";

/** Worker 活动状态：非 IDLE 即触发硬性静默（零模型调用） */
export type SupervisorWorkerActivity = "IDLE" | "STREAMING" | "TOOL_RUNNING";

/** 状态快照变更原因（S.3 广播的 `reason` 字段同源） */
export type SupervisorThrottleStateReason =
  | "WORKER_ACTIVITY"
  | "SNOOZE"
  | "RESUME"
  | "EVALUATION_STARTED"
  | "EVALUATION_FINISHED"
  | "IDLE_DEBOUNCE_TOGGLE";

/**
 * 节流器对外可观测状态（TASK-S.3：HUD 胶囊的唯一状态源）。
 * 只描述「是否可被唤醒」，不携带任何执行能力。
 */
export interface SupervisorThrottleState {
  activity: SupervisorWorkerActivity;
  muted: boolean;
  snoozed: boolean;
  /** epoch ms；未静默时为 null */
  snoozed_until: number | null;
  /** 是否有评估在途 */
  evaluating: boolean;
  /** 当前防抖窗口内累计的待合并输入数 */
  pending_inputs: number;
  /** v1.3.3：3s 空闲防抖是否开启（默认 false） */
  idle_debounce_enabled: boolean;
}

export type SupervisorThrottleStateListener = (
  state: SupervisorThrottleState,
  reason: SupervisorThrottleStateReason,
) => void;

/** 唤醒被拒绝的机器可读原因 */
export type WakeupBlockedReason =
  /** Worker 正在流式生成或连续执行工具（A §2.2 硬性禁令） */
  | "WORKER_MUTED"
  /** 用户 `SNOOZE` 静默期内（A §2.2） */
  | "SNOOZED"
  /** 同一防抖窗口内的非末次输入，已被合并 */
  | "DEBOUNCED"
  /** v1.3.3：空闲防抖开关关闭，打字不触发评估 */
  | "DEBOUNCE_DISABLED";

/** 一次唤醒判定结果（无论放行还是拒绝都会产出，便于审计与 UI 提示） */
export interface WakeupDecision {
  allowed: boolean;
  trigger: SupervisorWakeTrigger;
  /** 仅 `allowed === false` 时存在 */
  blocked_by?: WakeupBlockedReason;
  /** 本次判定合并的输入条数（放行时为实际折叠进这次评估的条数） */
  coalesced_inputs: number;
  /** 判定时刻（epoch ms，来自注入时钟） */
  at: number;
}

/** 传给评估回调的上下文（不含任何执行能力） */
export interface WakeupEvaluationContext {
  trigger: SupervisorWakeTrigger;
  coalesced_inputs: number;
  at: number;
}

/** 可注入的定时/时钟源：测试用假调度器即可精确推进 3 秒窗口 */
export interface ThrottleScheduler {
  now(): number;
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultScheduler: ThrottleScheduler = {
  now: () => Date.now(),
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface SupervisorWakeupThrottlerOptions {
  /**
   * 评估回调：**唯一**允许发起 Supervisor 模型调用的位置。
   * 回调抛错会被捕获并记录，不会打断节流器状态机。
   */
  evaluate: (context: WakeupEvaluationContext) => void | Promise<void>;
  /** 防抖窗口毫秒数，默认 {@link WAKEUP_DEBOUNCE_MS} */
  debounceMs?: number | undefined;
  /** `SNOOZE` 默认时长，默认 {@link SNOOZE_DEFAULT_MS} */
  snoozeMs?: number | undefined;
  /**
   * 是否启用「对话停顿 3s → IDLE_DEBOUNCE」路径。
   * **v1.3.3 默认 `false`**：关闭时 `notifyUserTyping` 不排程、不评估。
   * 既有 18 例防抖用例在测试里显式传 `true`。
   */
  idleDebounceEnabled?: boolean | undefined;
  /** 时间源（测试注入） */
  scheduler?: ThrottleScheduler | undefined;
  /** 判定结果旁路监听（审计/UI），不影响放行结果 */
  onDecision?: ((decision: WakeupDecision) => void) | undefined;
  /**
   * 状态变更监听（TASK-S.3）：活动状态、SNOOZE / RESUME、评估起止各触发一次。
   * 监听器抛错会被吞掉——广播通道故障绝不能反向阻断节流决策。
   */
  onStateChange?: SupervisorThrottleStateListener | undefined;
}

export interface WakeupThrottlerStats {
  /** 收到的唤醒请求总数（含被拒绝的） */
  requests: number;
  allowed: number;
  blocked: number;
  /** 实际发起的模型调用次数：仅放行时递增，静默期恒不增长 */
  model_calls: number;
  /** 被防抖窗口合并的输入总数 */
  coalesced_inputs: number;
  /** 静默 / snooze / 开关关闭期间被丢弃的输入总数 */
  suppressed_inputs: number;
}

/**
 * 把节流器唤醒时机映射到 `draft-generator` 的 `DraftTriggerKind`。
 * 宿主在 `evaluate` 回调里使用，避免两套枚举各说各话。
 *
 * - `USER_EXPLICIT` → `USER_REQUEST`（按需，可生成）
 * - `WORKER_BLOCKED` / `WORKER_TURN_END` → `CONTROL_PLANE_EVENT`（按需，可生成）
 * - `IDLE_DEBOUNCE` → `DEBOUNCE_TIMER`（生成器硬拒绝，双保险）
 */
export function mapWakeTriggerToDraftTrigger(
  trigger: SupervisorWakeTrigger,
): "USER_REQUEST" | "CONTROL_PLANE_EVENT" | "DEBOUNCE_TIMER" {
  switch (trigger) {
    case "USER_EXPLICIT":
      return "USER_REQUEST";
    case "WORKER_BLOCKED":
    case "WORKER_TURN_END":
      return "CONTROL_PLANE_EVENT";
    case "IDLE_DEBOUNCE":
      return "DEBOUNCE_TIMER";
  }
}

/**
 * Supervisor 唤醒节流器。
 *
 * 典型接线（Daemon 侧）：
 * ```ts
 * const throttler = new SupervisorWakeupThrottler({
 *   // 默认 idleDebounceEnabled=false：打字不唤醒
 *   evaluate: async ({ trigger }) => {
 *     await generateContractDraft({
 *       trigger: mapWakeTriggerToDraftTrigger(trigger),
 *       // ...messages / protection / enrich
 *     });
 *   },
 * });
 * throttler.notifyUserTyping();             // 默认关闭 → 零评估
 * throttler.notifyUserExplicit();           // 点击建议卡 → 立即评估
 * throttler.setWorkerActivity("STREAMING"); // Worker 流式 → 硬静默
 * throttler.notifyWorkerTurnEnd();          // 轮次结束 → 评估一次
 * throttler.notifyWorkerBlocked("BLOCKED"); // 控制面异常 → 评估一次
 * ```
 */
export class SupervisorWakeupThrottler {
  private readonly evaluate: SupervisorWakeupThrottlerOptions["evaluate"];
  private readonly debounceMs: number;
  private readonly snoozeMs: number;
  private readonly scheduler: ThrottleScheduler;
  private readonly onDecision: ((decision: WakeupDecision) => void) | undefined;
  private stateListener: SupervisorThrottleStateListener | undefined;

  private activity: SupervisorWorkerActivity = "IDLE";
  private debounceHandle: unknown = null;
  private pendingInputs = 0;
  private pendingBlocked: string | null = null;
  private snoozeUntil: number | null = null;
  private inFlight: Promise<void> = Promise.resolve();
  private evaluatingCount = 0;
  private lastError: Error | null = null;
  /** v1.3.3：默认关闭 3s 空闲防抖 */
  private idleDebounceOn = false;

  private readonly counters: WakeupThrottlerStats = {
    requests: 0,
    allowed: 0,
    blocked: 0,
    model_calls: 0,
    coalesced_inputs: 0,
    suppressed_inputs: 0,
  };

  constructor(options: SupervisorWakeupThrottlerOptions) {
    this.evaluate = options.evaluate;
    this.debounceMs = options.debounceMs ?? WAKEUP_DEBOUNCE_MS;
    this.snoozeMs = options.snoozeMs ?? SNOOZE_DEFAULT_MS;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.onDecision = options.onDecision;
    this.stateListener = options.onStateChange;
    // 显式 `?? false`：未传 / undefined 一律默认关闭
    this.idleDebounceOn = options.idleDebounceEnabled ?? false;
  }

  get workerActivity(): SupervisorWorkerActivity {
    return this.activity;
  }

  /** 当前是否启用 3s 空闲防抖（v1.3.3 默认 false） */
  get idleDebounceEnabled(): boolean {
    return this.idleDebounceOn;
  }

  /** 当前状态快照（读取时会顺带结算已到期的 SNOOZE） */
  get state(): SupervisorThrottleState {
    return {
      activity: this.activity,
      muted: this.activity !== "IDLE",
      snoozed: this.isSnoozed,
      snoozed_until: this.snoozeUntil,
      evaluating: this.evaluatingCount > 0,
      pending_inputs: this.pendingInputs,
      idle_debounce_enabled: this.idleDebounceOn,
    };
  }

  /**
   * 注册/替换状态监听器（S.3 广播接线）。
   * 返回解绑函数，便于 Daemon 停止时断开，避免悬挂引用。
   */
  setStateListener(
    listener: SupervisorThrottleStateListener | undefined,
  ): () => void {
    this.stateListener = listener;
    return () => {
      if (this.stateListener === listener) this.stateListener = undefined;
    };
  }

  /**
   * 运行时切换 3s 空闲防抖开关。
   * 关闭时立即取消待触发窗口并把待合并输入记入 `suppressed_inputs`，
   * 杜绝「关开关后延迟引爆」。
   */
  setIdleDebounceEnabled(enabled: boolean): void {
    if (this.idleDebounceOn === enabled) return;
    this.idleDebounceOn = enabled;
    if (!enabled && this.debounceHandle !== null) {
      this.scheduler.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
      this.counters.suppressed_inputs += this.pendingInputs;
      this.pendingInputs = 0;
    }
    this.emitState("IDLE_DEBOUNCE_TOGGLE");
  }

  /** Worker 静默期（流式生成 / 工具连续执行）：任何唤醒都不得发起模型调用 */
  get isMuted(): boolean {
    return this.activity !== "IDLE";
  }

  get isSnoozed(): boolean {
    if (this.snoozeUntil === null) return false;
    if (this.scheduler.now() < this.snoozeUntil) return true;
    // 到期自动解除，避免调用方必须精确唤醒
    this.snoozeUntil = null;
    return false;
  }

  /** 是否存在未触发的防抖窗口（排障/UI 用） */
  get hasPendingDebounce(): boolean {
    return this.debounceHandle !== null;
  }

  get stats(): WakeupThrottlerStats {
    return { ...this.counters };
  }

  get lastEvaluationError(): Error | null {
    return this.lastError;
  }

  /**
   * 更新 Worker 活动状态。
   *
   * 进入静默（STREAMING / TOOL_RUNNING）时立即取消待触发的防抖窗口：
   * 该窗口内的输入被记为 `suppressed_inputs`，绝不延迟到流式过程中触发调用。
   * 解除静默本身**不**触发评估——那必须由 `notifyWorkerTurnEnd()` 显式表达。
   */
  setWorkerActivity(activity: SupervisorWorkerActivity): void {
    const changed = this.activity !== activity;
    this.activity = activity;
    if (activity !== "IDLE" && this.debounceHandle !== null) {
      this.scheduler.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
      this.counters.suppressed_inputs += this.pendingInputs;
      this.pendingInputs = 0;
    }
    if (changed) this.emitState("WORKER_ACTIVITY");
  }

  /**
   * 右侧输入框变更（防抖输入源）。
   *
   * - 开关关闭（默认）：立即以 `DEBOUNCE_DISABLED` 拒绝，**不排程**。
   * - 开关开启：每次调用重置 3 秒窗口；窗口内只有最后一次真正触发评估。
   */
  notifyUserTyping(): WakeupDecision {
    if (!this.idleDebounceOn) {
      this.counters.suppressed_inputs += 1;
      return this.record({
        allowed: false,
        trigger: "IDLE_DEBOUNCE",
        blocked_by: "DEBOUNCE_DISABLED",
        coalesced_inputs: 0,
        at: this.scheduler.now(),
      });
    }

    const denied = this.denyIfGated("IDLE_DEBOUNCE", 1);
    if (denied) return denied;

    this.pendingInputs += 1;
    if (this.debounceHandle !== null) {
      this.scheduler.clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = this.scheduler.setTimeout(() => {
      this.flushDebounceWindow();
    }, this.debounceMs);

    return this.record({
      allowed: false,
      trigger: "IDLE_DEBOUNCE",
      blocked_by: "DEBOUNCED",
      coalesced_inputs: this.pendingInputs,
      at: this.scheduler.now(),
    });
  }

  /**
   * 用户显式唤醒：点击建议卡、点击「请求分析」或直接提问。
   * 显式意图优先于尚未到期的防抖窗口——窗口被合并进本次评估，不重复触发。
   */
  notifyUserExplicit(): WakeupDecision {
    const denied = this.denyIfGated("USER_EXPLICIT", 0);
    if (denied) return denied;
    this.cancelDebounceWindow();
    return this.dispatch("USER_EXPLICIT", this.takePendingInputs());
  }

  /**
   * Worker 轮次结束（或阻断异常恢复后的轮次终止）。
   * 这是解除静默的唯一入口：先回到 IDLE，再评估一次。
   * 静默期间积压的阻断事件在这里合并为 `WORKER_BLOCKED`，信号不丢失。
   */
  notifyWorkerTurnEnd(): WakeupDecision {
    const hadBlocked = this.pendingBlocked !== null;
    const wasMuted = this.activity !== "IDLE";
    this.pendingBlocked = null;
    this.activity = "IDLE";
    // 轮次结束本身就构成一次唤醒：待触发的输入窗口并入本次，避免重复评估
    this.cancelDebounceWindow();

    const denied = this.denyIfSnoozed(
      hadBlocked ? "WORKER_BLOCKED" : "WORKER_TURN_END",
      this.pendingInputs,
    );
    if (denied) {
      // SNOOZE 期内不打扰，但阻断信号必须保留到下次解除静默
      if (hadBlocked) this.pendingBlocked = "deferred worker blocked";
      // 被 SNOOZE 吞掉的那次唤醒不会经过 dispatch，需要在这里补一次状态变更，
      // 否则 HUD 会一直停在 WORKER_MUTED。
      if (wasMuted) this.emitState("WORKER_ACTIVITY");
      return denied;
    }

    return this.dispatch(
      hadBlocked ? "WORKER_BLOCKED" : "WORKER_TURN_END",
      this.takePendingInputs(),
    );
  }

  /**
   * 控制面阻断事件：BLOCKED、连续测试失败、预算报警。
   * 静默期间只登记不调用；解除静默后被合并进轮次结束的那一次评估。
   */
  notifyWorkerBlocked(detail = "worker blocked"): WakeupDecision {
    if (this.isMuted) {
      this.pendingBlocked = detail;
      return this.record({
        allowed: false,
        trigger: "WORKER_BLOCKED",
        blocked_by: "WORKER_MUTED",
        coalesced_inputs: 0,
        at: this.scheduler.now(),
      });
    }
    const denied = this.denyIfSnoozed("WORKER_BLOCKED", 0);
    if (denied) {
      this.pendingBlocked = detail;
      return denied;
    }
    this.cancelDebounceWindow();
    return this.dispatch("WORKER_BLOCKED", this.takePendingInputs());
  }

  /** 用户 SNOOZE：静默期内不打扰；到期或 `resume()` 后恢复 */
  snooze(durationMs = this.snoozeMs): void {
    this.snoozeUntil = this.scheduler.now() + Math.max(0, durationMs);
    this.cancelDebounceWindow();
    this.pendingInputs = 0;
    this.emitState("SNOOZE");
  }

  /** 提前结束 SNOOZE */
  resume(): void {
    this.snoozeUntil = null;
    this.emitState("RESUME");
  }

  /** 等待当前已放行的评估完成（测试与优雅停机用） */
  async drain(): Promise<void> {
    await this.inFlight;
  }

  /** 释放定时器与状态监听（测试 afterEach / 进程退出） */
  dispose(): void {
    this.cancelDebounceWindow();
    this.pendingInputs = 0;
    this.pendingBlocked = null;
    this.snoozeUntil = null;
    this.stateListener = undefined;
  }

  // --- 内部：定时窗口 ---

  private flushDebounceWindow(): void {
    this.debounceHandle = null;
    const coalesced = this.takePendingInputs();

    // 窗口到期瞬间若开关已被关掉，同样不得评估
    if (!this.idleDebounceOn) {
      this.counters.suppressed_inputs += coalesced;
      this.record({
        allowed: false,
        trigger: "IDLE_DEBOUNCE",
        blocked_by: "DEBOUNCE_DISABLED",
        coalesced_inputs: coalesced,
        at: this.scheduler.now(),
      });
      return;
    }

    if (this.isMuted) {
      // 兜底：窗口在静默开始后才到期（正常路径已被 setWorkerActivity 取消）
      this.counters.suppressed_inputs += coalesced;
      this.record({
        allowed: false,
        trigger: "IDLE_DEBOUNCE",
        blocked_by: "WORKER_MUTED",
        coalesced_inputs: coalesced,
        at: this.scheduler.now(),
      });
      return;
    }
    const denied = this.denyIfSnoozed("IDLE_DEBOUNCE", coalesced);
    if (denied) return;
    this.dispatch("IDLE_DEBOUNCE", coalesced);
  }

  private cancelDebounceWindow(): void {
    if (this.debounceHandle === null) return;
    this.scheduler.clearTimeout(this.debounceHandle);
    this.debounceHandle = null;
  }

  private takePendingInputs(): number {
    const count = this.pendingInputs;
    this.pendingInputs = 0;
    return count;
  }

  // --- 内部：门禁与派发 ---

  /**
   * 静默 / SNOOZE 门禁。
   * `suppressed` 为该请求自带的待丢弃输入数（防抖输入 1 条，显式/事件为 0）。
   */
  private denyIfGated(
    trigger: SupervisorWakeTrigger,
    suppressed: number,
  ): WakeupDecision | null {
    if (this.isMuted) {
      this.counters.suppressed_inputs += suppressed;
      return this.record({
        allowed: false,
        trigger,
        blocked_by: "WORKER_MUTED",
        coalesced_inputs: 0,
        at: this.scheduler.now(),
      });
    }
    return this.denyIfSnoozed(trigger, suppressed);
  }

  private denyIfSnoozed(
    trigger: SupervisorWakeTrigger,
    suppressed: number,
  ): WakeupDecision | null {
    if (!this.isSnoozed) return null;
    this.counters.suppressed_inputs += suppressed;
    return this.record({
      allowed: false,
      trigger,
      blocked_by: "SNOOZED",
      coalesced_inputs: 0,
      at: this.scheduler.now(),
    });
  }

  /** 放行一次评估：递增 model_calls 并串行执行回调 */
  private dispatch(
    trigger: SupervisorWakeTrigger,
    coalescedInputs: number,
  ): WakeupDecision {
    const at = this.scheduler.now();
    this.counters.model_calls += 1;
    this.counters.coalesced_inputs += coalescedInputs;
    this.evaluatingCount += 1;
    this.emitState("EVALUATION_STARTED");

    const run = async (): Promise<void> => {
      try {
        await this.evaluate({
          trigger,
          coalesced_inputs: coalescedInputs,
          at,
        });
      } catch (err) {
        // 评估失败不得反向触发重试风暴；保留最后一次错误供排障
        this.lastError = err instanceof Error ? err : new Error(String(err));
      } finally {
        this.evaluatingCount = Math.max(0, this.evaluatingCount - 1);
        this.emitState("EVALUATION_FINISHED");
      }
    };
    // 串行化：上一次评估结束后再执行下一次，避免并发模型调用放大成本
    this.inFlight = this.inFlight.then(run, run);

    return this.record({
      allowed: true,
      trigger,
      coalesced_inputs: coalescedInputs,
      at,
    });
  }

  private record(decision: WakeupDecision): WakeupDecision {
    this.counters.requests += 1;
    if (decision.allowed) this.counters.allowed += 1;
    else this.counters.blocked += 1;
    try {
      this.onDecision?.(decision);
    } catch {
      // 旁路监听失败不得影响节流决策
    }
    return decision;
  }

  /**
   * 状态变更外发（S.3）。监听器抛错一律吞掉：
   * HUD 广播通道异常绝不能反向阻断节流状态机。
   */
  private emitState(reason: SupervisorThrottleStateReason): void {
    if (!this.stateListener) return;
    try {
      this.stateListener(this.state, reason);
    } catch {
      // 广播失败不影响节流决策
    }
  }
}

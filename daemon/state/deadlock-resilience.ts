import type { LifecycleState } from "../../src/lib/contract.schema";

/**
 * TASK-D.3（续）/ 架构 §6.4：五类状态死锁的自愈引擎（D-1 ~ D-5）。
 *
 * 设计选择：**不用 setTimeout 定时器，改用可注入时钟 + 显式 sweep()**。
 * 理由有三：
 * 1. 死锁判据本质是"某个时刻仍未完成"，用时间戳比较表达最直接；
 * 2. 定时器在进程崩溃/挂起时恰是最不可靠的东西——它们和被测进程一起挂掉，
 *    而 sweep 由 Daemon 心跳驱动，能在恢复后一次性补齐所有过期项；
 * 3. 测试可以精确推进到边界毫秒（14_999 / 15_000），无需依赖 fake timer 与真实等待。
 *
 * 另一个刻意的取舍：**每个看门狗都先"摘除条目"再执行副作用**。
 * 若先杀进程再标记，杀进程抛错会导致条目留在表里，下一秒重复触发，
 * 反而把一次故障放大成无限重试。摘除后即使副作用失败，也只是少做一次而不是做很多次。
 */

// --- 常量（与架构 §6.4 表格逐项对应） ---

/** D-1：STOPPING 超过 15s 强杀 */
export const STOP_TIMEOUT_MS = 15_000;
/** D-2：互斥锁租约 60s */
export const LEASE_TTL_MS = 60_000;
/** D-2：Daemon 心跳 15s 续租 */
export const LEASE_HEARTBEAT_INTERVAL_MS = 15_000;
/** D-2：超过 90s 无心跳判定为崩溃死锁并回收 */
export const LEASE_DEAD_MS = 90_000;
/** D-3：Worktree 重建失败后的重试间隔与次数上限 */
export const RESUME_HEAL_RETRY_MS = 5_000;
export const RESUME_HEAL_MAX_ATTEMPTS = 3;

export type CommandTimeoutTier = "SHORT" | "MEDIUM" | "LONG";

/** D-5：命令超时分层（60s / 300s / 600s） */
export const COMMAND_TIMEOUT_MS: Readonly<Record<CommandTimeoutTier, number>> =
  {
    SHORT: 60_000,
    MEDIUM: 300_000,
    LONG: 600_000,
  };

export type DeadlockEventCode =
  | "D1_STOP_TIMEOUT"
  | "D2_LEASE_RECLAIMED"
  | "D3_WORKTREE_HEALED"
  | "D3_HEAL_FAILED"
  | "D5_COMMAND_TIMEOUT";

export interface DeadlockEvent {
  readonly code: DeadlockEventCode;
  readonly contract_id?: string;
  readonly at: number;
  readonly detail: string;
}

/**
 * 副作用钩子。全部可选：单元测试只注入关心的那几个，
 * 生产环境由 Daemon 绑定到真实实现（杀进程 / 状态流转 / 证据落盘）。
 */
export interface DeadlockHooks {
  /** 回收进程树（D-1 / D-5）。杀失败不得阻断后续的状态流转 */
  killProcessTree?:
    | ((contractId: string, pid: number | null) => Promise<void> | void)
    | undefined;
  /** 强制把合同转入 ABORTED（D-1） */
  abortContract?:
    ((contractId: string, reason: string) => Promise<void> | void) | undefined;
  /** 探测任务工作树是否物理存活（D-3） */
  isWorktreeAlive?:
    ((contractId: string) => Promise<boolean> | boolean) | undefined;
  /** 重建工作树并把合同从 PENDING_RESUME 推回 PREPARING（D-3） */
  healResume?: ((contractId: string) => Promise<void> | void) | undefined;
  /** 回收过期租约对应的真实锁资源（D-2） */
  releaseResource?: ((resource: string) => Promise<void> | void) | undefined;
  /** 写一条 TIMEOUT 证据（D-5） */
  writeTimeoutEvidence?:
    | ((
        contractId: string,
        info: {
          readonly command: string;
          readonly tier: CommandTimeoutTier;
          readonly timeout_ms: number;
        },
      ) => Promise<void> | void)
    | undefined;
  /** 事件出口（日志 / 广播 / 指标） */
  onEvent?: ((event: DeadlockEvent) => void) | undefined;
}

export interface StopRecord {
  readonly contract_id: string;
  readonly pid: number | null;
  readonly started_at: number;
}

export interface LeaseRecord {
  readonly resource: string;
  readonly owner: string;
  readonly acquired_at: number;
  readonly last_heartbeat: number;
  readonly ttl_ms: number;
}

export interface CommandRecord {
  readonly id: string;
  readonly contract_id: string;
  readonly command: string;
  readonly tier: CommandTimeoutTier;
  readonly pid: number | null;
  readonly started_at: number;
  readonly timeout_ms: number;
}

/** D-4 的裁决结果：二选一，且必定给出可执行的下一步，绝不返回"等待中" */
export type MergeDecision =
  | { readonly kind: "TARGET_UNCHANGED"; readonly target_head: string }
  | {
      readonly kind: "TARGET_ADVANCED";
      readonly target_head: string;
      readonly merge_base_head: string;
      readonly options: readonly [
        "REPLAY_ON_CURRENT_BASELINE",
        "ABANDON_CANDIDATE",
      ];
      readonly message: string;
    };

interface ResumeWatch {
  contract_id: string;
  attempts: number;
  next_attempt_at: number;
}

const TERMINAL_HEAL_MESSAGE =
  "工作树重建连续失败，已停止自动重试；请人工确认磁盘状态后重新发起";

export class DeadlockResilience {
  private readonly hooks: DeadlockHooks;
  private readonly now: () => number;

  private readonly stops = new Map<string, StopRecord>();
  private readonly leases = new Map<string, LeaseRecord>();
  private readonly resumeWatches = new Map<string, ResumeWatch>();
  private readonly commands = new Map<string, CommandRecord>();
  private commandSeq = 0;

  constructor(
    hooks: DeadlockHooks = {},
    options: { readonly now?: () => number } = {},
  ) {
    this.hooks = hooks;
    this.now = options.now ?? (() => Date.now());
  }

  // --- D-1：停止超时 ---

  /** 用户/编排层发起停止时登记；重复登记保留最早的时间戳（不刷新截止时间） */
  beginStop(contractId: string, pid: number | null = null): void {
    if (this.stops.has(contractId)) return;
    this.stops.set(contractId, {
      contract_id: contractId,
      pid,
      started_at: this.now(),
    });
  }

  /** 停止流程正常完成，撤销看门狗 */
  completeStop(contractId: string): void {
    this.stops.delete(contractId);
  }

  isStopping(contractId: string): boolean {
    return this.stops.has(contractId);
  }

  // --- D-2：租约与心跳 ---

  acquireLease(
    resource: string,
    owner: string,
    options: { ttlMs?: number } = {},
  ): LeaseRecord {
    const at = this.now();
    const record: LeaseRecord = {
      resource,
      owner,
      acquired_at: at,
      last_heartbeat: at,
      ttl_ms: options.ttlMs ?? LEASE_TTL_MS,
    };
    this.leases.set(resource, record);
    return record;
  }

  /** 续租；返回 false 表示租约已不属于该持有者（不应继续工作） */
  renewLease(resource: string, owner: string): boolean {
    const current = this.leases.get(resource);
    if (!current || current.owner !== owner) return false;
    this.leases.set(resource, { ...current, last_heartbeat: this.now() });
    return true;
  }

  releaseLease(resource: string, owner?: string): boolean {
    const current = this.leases.get(resource);
    if (!current) return false;
    if (owner !== undefined && current.owner !== owner) return false;
    this.leases.delete(resource);
    return true;
  }

  getLease(resource: string): LeaseRecord | null {
    return this.leases.get(resource) ?? null;
  }

  /** 租约是否已过 TTL（60s 未续租即视为失效，但 90s 才回收） */
  isLeaseExpired(resource: string): boolean {
    const current = this.leases.get(resource);
    if (!current) return false;
    return this.now() - current.last_heartbeat >= current.ttl_ms;
  }

  // --- D-3：恢复自愈 ---

  /** 合同进入 PENDING_RESUME 时登记；同一合同重复登记不会重置重试计数 */
  watchResume(contractId: string): void {
    if (this.resumeWatches.has(contractId)) return;
    this.resumeWatches.set(contractId, {
      contract_id: contractId,
      attempts: 0,
      next_attempt_at: this.now(),
    });
  }

  unwatchResume(contractId: string): void {
    this.resumeWatches.delete(contractId);
  }

  isWatchingResume(contractId: string): boolean {
    return this.resumeWatches.has(contractId);
  }

  // --- D-5：命令超时 ---

  trackCommand(input: {
    contractId: string;
    command: string;
    tier: CommandTimeoutTier;
    pid?: number | null;
    timeoutMs?: number;
  }): CommandRecord {
    const id = `cmd_${++this.commandSeq}`;
    const record: CommandRecord = {
      id,
      contract_id: input.contractId,
      command: input.command,
      tier: input.tier,
      pid: input.pid ?? null,
      started_at: this.now(),
      timeout_ms: input.timeoutMs ?? COMMAND_TIMEOUT_MS[input.tier],
    };
    this.commands.set(id, record);
    return record;
  }

  settleCommand(id: string): void {
    this.commands.delete(id);
  }

  // --- D-4：合并前目标分支仲裁 ---

  /**
   * 判定目标分支是否在候选分支开工后前进。
   *
   * 返回结构永远是"可执行决策"，不是异常也不是空值：
   * 目标未动 → 可直接合并；目标已动 → 必须二选一（重演 / 放弃）。
   * 这样前端不会出现"点了合并没反应"的死锁观感。
   */
  assessMerge(input: {
    readonly targetHead: string;
    readonly mergeBaseHead: string;
  }): MergeDecision {
    if (input.targetHead === input.mergeBaseHead) {
      return { kind: "TARGET_UNCHANGED", target_head: input.targetHead };
    }
    return {
      kind: "TARGET_ADVANCED",
      target_head: input.targetHead,
      merge_base_head: input.mergeBaseHead,
      options: ["REPLAY_ON_CURRENT_BASELINE", "ABANDON_CANDIDATE"],
      message:
        "目标分支在你施工期间有了新的改动，需要选择：以当前分支为基线重演本轮改动，或放弃这次候选成果。",
    };
  }

  // --- 统一定时扫描 ---

  /**
   * 推进一次扫描。由 Daemon 心跳（建议 1s）调用，测试可直接给定时刻。
   * 返回本次触发的事件，便于断言与日志。
   */
  async sweep(now: number = this.now()): Promise<DeadlockEvent[]> {
    const events: DeadlockEvent[] = [];
    const emit = (event: DeadlockEvent): void => {
      events.push(event);
      this.hooks.onEvent?.(event);
    };

    await this.sweepStops(now, emit);
    await this.sweepCommands(now, emit);
    await this.sweepResumes(now, emit);
    this.sweepLeases(now, emit);

    return events;
  }

  private async sweepStops(
    now: number,
    emit: (event: DeadlockEvent) => void,
  ): Promise<void> {
    for (const [contractId, record] of [...this.stops.entries()]) {
      if (now - record.started_at < STOP_TIMEOUT_MS) continue;

      // 先摘除：即使后续副作用抛错，也不会在同一秒内重复触发
      this.stops.delete(contractId);

      let killError: unknown = null;
      try {
        await this.hooks.killProcessTree?.(contractId, record.pid);
      } catch (err) {
        killError = err;
      }
      // 杀进程失败也必须推进状态：否则合同永远卡在 STOPPING，
      // 这正是 D-1 要消除的死锁形态。
      try {
        await this.hooks.abortContract?.(contractId, "STOP_TIMEOUT");
      } catch {
        // 状态流转失败留给上层告警；看门狗不能因此崩溃
      }

      emit({
        code: "D1_STOP_TIMEOUT",
        contract_id: contractId,
        at: now,
        detail:
          `STOPPING 超过 ${STOP_TIMEOUT_MS}ms，已强杀并转入 ABORTED` +
          (killError instanceof Error
            ? `（杀进程告警：${killError.message}）`
            : ""),
      });
    }
  }

  private async sweepCommands(
    now: number,
    emit: (event: DeadlockEvent) => void,
  ): Promise<void> {
    for (const [id, record] of [...this.commands.entries()]) {
      if (now - record.started_at < record.timeout_ms) continue;
      this.commands.delete(id);

      try {
        await this.hooks.killProcessTree?.(record.contract_id, record.pid);
      } catch {
        // 同上：回收失败不阻断证据落盘
      }
      try {
        await this.hooks.writeTimeoutEvidence?.(record.contract_id, {
          command: record.command,
          tier: record.tier,
          timeout_ms: record.timeout_ms,
        });
      } catch {
        // 证据写入失败不应让看门狗停摆
      }

      emit({
        code: "D5_COMMAND_TIMEOUT",
        contract_id: record.contract_id,
        at: now,
        detail: `命令「${record.command}」超过 ${record.tier} 层 ${record.timeout_ms}ms，已回收并记录超时证据`,
      });
    }
  }

  private async sweepResumes(
    now: number,
    emit: (event: DeadlockEvent) => void,
  ): Promise<void> {
    for (const [contractId, watch] of [...this.resumeWatches.entries()]) {
      if (now < watch.next_attempt_at) continue;

      let alive: boolean;
      try {
        alive = (await this.hooks.isWorktreeAlive?.(contractId)) ?? true;
      } catch {
        alive = false; // 探测失败按"已丢失"处理：宁可重建也不把合同卡死
      }

      if (alive) {
        this.resumeWatches.delete(contractId);
        continue;
      }

      watch.attempts += 1;
      try {
        await this.hooks.healResume?.(contractId);
        this.resumeWatches.delete(contractId);
        emit({
          code: "D3_WORKTREE_HEALED",
          contract_id: contractId,
          at: now,
          detail: "检测到工作树丢失，已重建并推回 PREPARING",
        });
      } catch (err) {
        if (watch.attempts >= RESUME_HEAL_MAX_ATTEMPTS) {
          this.resumeWatches.delete(contractId);
          emit({
            code: "D3_HEAL_FAILED",
            contract_id: contractId,
            at: now,
            detail: `${TERMINAL_HEAL_MESSAGE}：${err instanceof Error ? err.message : String(err)}`,
          });
        } else {
          this.resumeWatches.set(contractId, {
            ...watch,
            next_attempt_at: now + RESUME_HEAL_RETRY_MS,
          });
        }
      }
    }
  }

  private sweepLeases(now: number, emit: (event: DeadlockEvent) => void): void {
    for (const [resource, lease] of [...this.leases.entries()]) {
      if (now - lease.last_heartbeat < LEASE_DEAD_MS) continue;
      this.leases.delete(resource);

      // 钩子是同步语义（释放锁文件），失败只影响一次回收，不影响后续扫描
      try {
        void this.hooks.releaseResource?.(resource);
      } catch {
        // ignore
      }

      emit({
        code: "D2_LEASE_RECLAIMED",
        contract_id: lease.resource,
        at: now,
        detail: `租约 ${resource} 已超过 ${LEASE_DEAD_MS}ms 无心跳，判定为崩溃死锁并回收`,
      });
    }
  }

  // --- 观测 ---

  pendingCounts(): {
    stops: number;
    leases: number;
    resumeWatches: number;
    commands: number;
  } {
    return {
      stops: this.stops.size,
      leases: this.leases.size,
      resumeWatches: this.resumeWatches.size,
      commands: this.commands.size,
    };
  }

  /**
   * 启动自动扫描（Daemon 使用）。返回停止函数，便于 stop() 时清理。
   * 单元测试不要用它——直接调用 `sweep(t)` 才能精确控制时刻。
   */
  startAutoSweep(intervalMs = 1_000): () => void {
    const timer = setInterval(() => {
      void this.sweep().catch(() => undefined);
    }, intervalMs);
    // 不阻止进程退出：Daemon 关闭时本来就会调用返回的停止函数
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

/** 便于调用方判断某 lifecycle 是否属于"可能卡住"的中间态 */
export const DEADLOCK_PRONE_STATES: readonly LifecycleState[] = [
  "PREPARING",
  "EXECUTING",
  "VERIFYING",
  "PENDING_RESUME",
  "AUDITED",
];

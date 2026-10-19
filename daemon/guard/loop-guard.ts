import { readStateFile, writeStateFile } from "./state-store";

/** §9.3：验证重试熔断错误码 */
export const E_RETRY_LIMIT_EXCEEDED = "E_RETRY_LIMIT_EXCEEDED";
/** 兼容旧命名（v0.1 早期实现） */
export const E_LOOP_CIRCUIT_TRIPPED = E_RETRY_LIMIT_EXCEEDED;

export class LoopCircuitBreakerError extends Error {
  readonly code: string = E_RETRY_LIMIT_EXCEEDED;
  readonly retriesUsed: number;
  readonly maxRetries: number;

  constructor(message: string, retriesUsed: number, maxRetries: number) {
    super(
      `[${E_RETRY_LIMIT_EXCEEDED}] ${message} (used: ${retriesUsed}, max: ${maxRetries})`,
    );
    this.name = "LoopCircuitBreakerError";
    this.retriesUsed = retriesUsed;
    this.maxRetries = maxRetries;
  }
}

export interface VerificationAttemptRecord {
  attemptNumber: number;
  timestamp: string;
  passed: boolean;
  exitCode?: number | undefined;
  summary?: string | undefined;
}

export interface LoopGuardOptions {
  maxRetries?: number | undefined; // default 3
  /** 持久化路径；提供后重启不重置计数（TASK-A.5 PASS-3） */
  statePath?: string | undefined;
}

interface PersistedLoopState {
  consecutiveFailures: number;
  totalAttempts: number;
  history: VerificationAttemptRecord[];
  tripped: boolean;
}

/**
 * Guard preventing infinite AI repair loops by tracking consecutive verification failures.
 * 状态可持久化，重启 Daemon、切换模型或变更命令别名均不得重置。
 */
export class LoopGuard {
  private readonly maxRetries: number;
  private readonly statePath?: string | undefined;
  private consecutiveFailures = 0;
  private totalAttempts = 0;
  private history: VerificationAttemptRecord[] = [];
  private tripped = false;

  constructor(options: LoopGuardOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.statePath = options.statePath;
    const persisted = readStateFile<PersistedLoopState>(this.statePath);
    if (persisted) {
      this.consecutiveFailures = persisted.consecutiveFailures ?? 0;
      this.totalAttempts = persisted.totalAttempts ?? 0;
      this.history = persisted.history ?? [];
      this.tripped = persisted.tripped ?? false;
    }
  }

  public getMaxRetries(): number {
    return this.maxRetries;
  }

  public isTripped(): boolean {
    return this.tripped;
  }

  public getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  public getTotalAttempts(): number {
    return this.totalAttempts;
  }

  public getHistory(): readonly VerificationAttemptRecord[] {
    return this.history;
  }

  /**
   * Records a verification attempt outcome.
   * If verification fails and consecutive failures reach maxRetries, trips circuit breaker.
   */
  public recordAttempt(result: {
    passed: boolean;
    exitCode?: number | undefined;
    summary?: string | undefined;
  }): {
    tripped: boolean;
    consecutiveFailures: number;
    totalAttempts: number;
  } {
    this.totalAttempts += 1;
    const record: VerificationAttemptRecord = {
      attemptNumber: this.totalAttempts,
      timestamp: new Date().toISOString(),
      passed: result.passed,
      exitCode: result.exitCode,
      summary: result.summary,
    };
    this.history.push(record);

    if (result.passed) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.maxRetries) {
        this.tripped = true;
      }
    }

    this.persist();

    return {
      tripped: this.tripped,
      consecutiveFailures: this.consecutiveFailures,
      totalAttempts: this.totalAttempts,
    };
  }

  /**
   * Asserts that the loop circuit breaker is not tripped, otherwise throws.
   */
  public assertNotTripped(): void {
    if (this.tripped) {
      throw new LoopCircuitBreakerError(
        `Verification loop halted: reached maximum limit of ${this.maxRetries} consecutive verification failures`,
        this.consecutiveFailures,
        this.maxRetries,
      );
    }
  }

  /** 显式重置仅用于「新验证轮次 + 重新审批」后的合法恢复（不得被自动调用） */
  public reset(): void {
    this.consecutiveFailures = 0;
    this.totalAttempts = 0;
    this.history = [];
    this.tripped = false;
    this.persist();
  }

  private persist(): void {
    writeStateFile(this.statePath, {
      consecutiveFailures: this.consecutiveFailures,
      totalAttempts: this.totalAttempts,
      history: this.history,
      tripped: this.tripped,
    } satisfies PersistedLoopState);
  }
}

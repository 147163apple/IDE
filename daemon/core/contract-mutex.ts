import fs from "node:fs";
import path from "node:path";
import { isProcessRunning } from "./pid-lock";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "../state/deadlock-resilience";

/**
 * 合同级排他锁（Chaos 场景 3：双开并发抢占）。
 *
 * 两层防护：
 * 1. 进程内串行链：同一合同的操作严格排队，避免 read-modify-write 竞态
 *    （两个 execute() 同时读到 EXECUTING 并各自建 Worktree/提交是致命的）。
 * 2. 磁盘 advisory 锁（O_EXCL）：跨进程（多开 Daemon / CLI）同样互斥；
 *    持有者进程已死或超时则判定为陈旧锁并回收，杜绝崩溃后的永久死锁。
 */

export const E_CONCURRENT_OPERATION = "E_CONCURRENT_OPERATION";
export const E_INVALID_STATE_TRANSITION = "E_INVALID_STATE_TRANSITION";

/** 磁盘锁陈旧阈值：超过该时长且持有者已死即回收 */
export const CONTRACT_LOCK_TTL_MS = 60_000;

export class ConcurrencyError extends Error {
  readonly code = E_CONCURRENT_OPERATION;
  constructor(message: string) {
    super(`[${E_CONCURRENT_OPERATION}] ${message}`);
    this.name = "ConcurrencyError";
  }
}

export class InvalidStateTransitionError extends Error {
  readonly code = E_INVALID_STATE_TRANSITION;
  readonly current: string;
  readonly expected: readonly string[];
  constructor(current: string, expected: readonly string[], action: string) {
    super(
      `[${E_INVALID_STATE_TRANSITION}] Cannot ${action}: contract is in state ${current}, expected ${expected.join(" | ")}`,
    );
    this.name = "InvalidStateTransitionError";
    this.current = current;
    this.expected = expected;
  }
}

/** 进程内串行链：key → 当前持锁者的 release Promise */
const chains = new Map<string, Promise<void>>();

/**
 * TASK-D.3 / D-2：租约观察者。
 *
 * 用"注册一次、全局复用"的注入方式，而不是给每个 `withContractLock` 调用点加参数：
 * 调用点有十余处（execute / runWorker / abort / merge…），逐个透传既啰嗦又容易漏；
 * 而这里必须保证**同一个 Daemon 只有一张租约表**，否则 D-2 会各自判各自的。
 * 观察者为 null 时（单测、CLI 薄调用）退化为原有的 60s TTL 行为。
 */
export interface ContractLockLeaseObserver {
  acquireLease(resource: string, owner: string): unknown;
  renewLease(resource: string, owner: string): boolean;
  releaseLease(resource: string, owner?: string): boolean;
}

let leaseObserver: ContractLockLeaseObserver | null = null;

export function setContractLockLeaseObserver(
  observer: ContractLockLeaseObserver | null,
): void {
  leaseObserver = observer;
}

interface DiskLockPayload {
  pid: number;
  acquiredAt: number;
  host?: string;
}

function readDiskLock(lockPath: string): DiskLockPayload | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as DiskLockPayload).pid === "number"
    ) {
      return parsed as DiskLockPayload;
    }
  } catch {
    // 残缺锁文件视为陈旧
  }
  return null;
}

function isDiskLockLive(lockPath: string, ttlMs: number): boolean {
  const payload = readDiskLock(lockPath);
  if (!payload) return false;
  const { pid, acquiredAt } = payload;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  // 自己持有（同进程重入）不算冲突
  if (pid === process.pid) return false;
  const age = Date.now() - (Number.isFinite(acquiredAt) ? acquiredAt : 0);
  if (!isProcessRunning(pid)) return false;
  return age < ttlMs;
}

function acquireDiskLock(lockPath: string, ttlMs: number): boolean {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload: DiskLockPayload = {
    pid: process.pid,
    acquiredAt: Date.now(),
  };
  try {
    fs.writeFileSync(lockPath, JSON.stringify(payload), {
      flag: "wx",
      encoding: "utf-8",
    });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") return false;
  }

  // 已存在：判定是否陈旧（持有者已死 / 超 TTL）→ 回收后重试一次
  if (isDiskLockLive(lockPath, ttlMs)) return false;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // 竞争中被他人删除，重试再定
  }
  try {
    fs.writeFileSync(lockPath, JSON.stringify(payload), {
      flag: "wx",
      encoding: "utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 在同一合同的排他锁内执行 fn。
 * - 先排进程内队列，再抢磁盘锁；
 * - 磁盘锁被其他活进程持有时抛 ConcurrencyError（对应 HTTP 409）；
 * - fn 结束后释放两层锁（异常路径同样释放，绝不留下幽灵占用）。
 */
export async function withContractLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  options: { ttlMs?: number; heartbeatMs?: number } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? CONTRACT_LOCK_TTL_MS;
  const heartbeatMs = options.heartbeatMs ?? LEASE_HEARTBEAT_INTERVAL_MS;
  const previous = chains.get(lockKey) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 后继者等待 current（即本操作结束）而非 previous，保证严格串行
  const gate = previous.then(() => current);
  chains.set(lockKey, gate);

  await previous;

  let acquired = false;
  let heartbeat: NodeJS.Timeout | null = null;
  const leaseOwner = `pid:${process.pid}`;
  try {
    acquired = acquireDiskLock(lockKey, ttlMs);
    if (!acquired) {
      throw new ConcurrencyError(
        `Contract operation is already in progress (lock: ${lockKey})`,
      );
    }

    // D-2：持有期间 15s 续租一次。租约只影响"崩溃后能否被回收"，
    // 不参与授权判定——回收锁绝不等于批准合同或推进状态。
    leaseObserver?.acquireLease(lockKey, leaseOwner);
    heartbeat = setInterval(() => {
      leaseObserver?.renewLease(lockKey, leaseOwner);
    }, heartbeatMs);
    heartbeat.unref?.();

    return await fn();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    leaseObserver?.releaseLease(lockKey, leaseOwner);
    if (acquired) {
      try {
        fs.unlinkSync(lockKey);
      } catch {
        // 已被清理
      }
    }
    // 先放行后继者，再在无新等待者时清理链（顺序颠倒会产生并发空档）
    release();
    if (chains.get(lockKey) === gate) chains.delete(lockKey);
  }
}

/** 合同锁文件路径：`<repoRoot>/.stagent/locks/<contractId>.lock` */
/**
 * TASK-D.3 / D-2：看门狗回收锁文件的白名单判定。
 *
 * 为什么单独成一个纯函数：D-2 的处置是"删文件"，是五类看门狗里唯一带破坏性的
 * 动作。判定必须与 `contractLockPath` 同源、且可被单测直接覆盖，绝不允许因为
 * 一条异常记录就把合同、证据或 Worktree 当成"陈旧资源"删掉。
 */
export function isContractLockResource(
  repoRoot: string,
  resource: string,
): boolean {
  const locksDir = path.join(path.resolve(repoRoot), ".stagent", "locks");
  const target = path.resolve(resource);
  return path.dirname(target) === locksDir && target.endsWith(".lock");
}

export function contractLockPath(repoRoot: string, contractId: string): string {
  return path.join(
    path.resolve(repoRoot),
    ".stagent",
    "locks",
    `${contractId}.lock`,
  );
}

/** 仅供测试：清空进程内串行链与磁盘锁目录 */
export function resetContractLocks(repoRoot?: string): void {
  chains.clear();
  if (!repoRoot) return;
  try {
    fs.rmSync(path.join(path.resolve(repoRoot), ".stagent", "locks"), {
      recursive: true,
      force: true,
    });
  } catch {
    // 忽略
  }
}

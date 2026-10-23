import { describe, expect, it } from "vitest";
import {
  COMMAND_TIMEOUT_MS,
  DeadlockResilience,
  LEASE_DEAD_MS,
  LEASE_TTL_MS,
  RESUME_HEAL_MAX_ATTEMPTS,
  RESUME_HEAL_RETRY_MS,
  STOP_TIMEOUT_MS,
  type DeadlockEvent,
  type DeadlockHooks,
} from "../../daemon/state/deadlock-resilience";

/**
 * TASK-D.3 / 架构 §6.4：五类死锁自愈的故障注入验收。
 *
 * 判据统一为「注入死锁条件 → 推进到临界时刻 → 断言解除」，
 * 且每个用例都验证**边界前一毫秒不动作**，避免"只要扫描就触发"的假绿。
 */

const T0 = 1_000_000;

interface Harness {
  engine: DeadlockResilience;
  events: DeadlockEvent[];
  calls: {
    kill: Array<[string, number | null]>;
    abort: Array<[string, string]>;
    release: string[];
    heal: string[];
    evidence: Array<
      [string, { command: string; tier: string; timeout_ms: number }]
    >;
  };
  advance(ms: number): number;
  at(): number;
}

function makeHarness(hooks: DeadlockHooks = {}): Harness {
  let now = T0;
  const events: DeadlockEvent[] = [];
  const calls: Harness["calls"] = {
    kill: [],
    abort: [],
    release: [],
    heal: [],
    evidence: [],
  };

  const engine = new DeadlockResilience(
    {
      killProcessTree: (contractId, pid) => {
        calls.kill.push([contractId, pid]);
      },
      abortContract: (contractId, reason) => {
        calls.abort.push([contractId, reason]);
      },
      releaseResource: (resource) => {
        calls.release.push(resource);
      },
      isWorktreeAlive: () => false,
      healResume: (contractId) => {
        calls.heal.push(contractId);
      },
      writeTimeoutEvidence: (contractId, info) => {
        calls.evidence.push([contractId, info]);
      },
      onEvent: (event) => events.push(event),
      ...hooks,
    },
    { now: () => now },
  );

  return {
    engine,
    events,
    calls,
    advance(ms: number) {
      now += ms;
      return now;
    },
    at: () => now,
  };
}

describe("D-1 停止超时：15s 未完成即强杀并转 ABORTED", () => {
  it("14.999s 不动，15s 触发；杀进程失败也必须完成 ABORTED", async () => {
    const harness = makeHarness({
      killProcessTree: () => {
        throw new Error("EPERM: 无法回收进程树");
      },
    });

    harness.engine.beginStop("contract_1", 4242);
    expect(harness.engine.isStopping("contract_1")).toBe(true);

    const before = await harness.engine.sweep(
      harness.advance(STOP_TIMEOUT_MS - 1),
    );
    expect(before).toHaveLength(0);
    expect(harness.calls.abort).toHaveLength(0);

    const atDeadline = await harness.engine.sweep(harness.advance(1));
    expect(atDeadline).toHaveLength(1);
    expect(atDeadline[0]?.code).toBe("D1_STOP_TIMEOUT");
    // 关键：杀进程抛错不阻断状态流转，否则合同永远停在 STOPPING
    expect(harness.calls.abort).toEqual([["contract_1", "STOP_TIMEOUT"]]);
    expect(harness.engine.isStopping("contract_1")).toBe(false);
  });

  it("幂等：同一合同不会重复触发，也不会重复杀进程", async () => {
    const harness = makeHarness();
    harness.engine.beginStop("contract_2", 100);

    await harness.engine.sweep(harness.advance(STOP_TIMEOUT_MS));
    await harness.engine.sweep(harness.advance(5_000));

    expect(harness.calls.kill).toHaveLength(1);
    expect(
      harness.events.filter((e) => e.code === "D1_STOP_TIMEOUT"),
    ).toHaveLength(1);
  });

  it("正常完成停止后撤销看门狗，不再误杀", async () => {
    const harness = makeHarness();
    harness.engine.beginStop("contract_3", 200);
    harness.engine.completeStop("contract_3");

    const events = await harness.engine.sweep(
      harness.advance(STOP_TIMEOUT_MS * 2),
    );
    expect(events).toHaveLength(0);
    expect(harness.calls.kill).toHaveLength(0);
  });
});

describe("D-2 租约心跳：60s TTL / 90s 判死回收", () => {
  it("持续心跳则租约存活；停止心跳 90s 后回收并释放真实资源", async () => {
    const harness = makeHarness();
    harness.engine.acquireLease("lock:contract_1", "daemon-pid-1");

    // 每 15s 续租一次，持续 80s：不应被判死
    for (let i = 0; i < 5; i++) {
      harness.advance(15_000);
      expect(harness.engine.renewLease("lock:contract_1", "daemon-pid-1")).toBe(
        true,
      );
    }
    // 最后一次心跳在 t=75s；再走 89.999s（距心跳）仍不动
    await harness.engine.sweep(harness.advance(LEASE_DEAD_MS - 1));
    expect(harness.calls.release).toHaveLength(0);

    // 跨过 90s：回收
    const events = await harness.engine.sweep(harness.advance(1));
    expect(events.map((e) => e.code)).toEqual(["D2_LEASE_RECLAIMED"]);
    expect(harness.calls.release).toEqual(["lock:contract_1"]);
    expect(harness.engine.getLease("lock:contract_1")).toBeNull();
  });

  it("TTL 与判死阈值分离：60s 失效但 90s 才回收", () => {
    const harness = makeHarness();
    harness.engine.acquireLease("lock:x", "owner");
    expect(harness.engine.isLeaseExpired("lock:x")).toBe(false);

    harness.advance(LEASE_TTL_MS);
    expect(harness.engine.isLeaseExpired("lock:x")).toBe(true);
    // 失效 ≠ 立刻回收：给持有者留 30s 的续租窗口
    expect(harness.engine.getLease("lock:x")).not.toBeNull();
  });

  it("非持有者不能续租或释放（防止误伤他人租约）", () => {
    const harness = makeHarness();
    harness.engine.acquireLease("lock:y", "owner-a");
    expect(harness.engine.renewLease("lock:y", "owner-b")).toBe(false);
    expect(harness.engine.releaseLease("lock:y", "owner-b")).toBe(false);
    expect(harness.engine.releaseLease("lock:y", "owner-a")).toBe(true);
  });
});

describe("D-3 恢复自愈：工作树丢失 → 重建并推回 PREPARING", () => {
  it("探测到丢失即自愈一次，并撤销监听", async () => {
    const harness = makeHarness({ isWorktreeAlive: () => false });
    harness.engine.watchResume("contract_1");

    const events = await harness.engine.sweep(harness.advance(1));
    expect(events.map((e) => e.code)).toEqual(["D3_WORKTREE_HEALED"]);
    expect(harness.calls.heal).toEqual(["contract_1"]);
    expect(harness.engine.isWatchingResume("contract_1")).toBe(false);

    // 已解除监听，再扫也不会重复重建
    await harness.engine.sweep(harness.advance(1_000));
    expect(harness.calls.heal).toHaveLength(1);
  });

  it("工作树仍在时不做无谓重建", async () => {
    const harness = makeHarness({ isWorktreeAlive: () => true });
    harness.engine.watchResume("contract_2");
    const events = await harness.engine.sweep(harness.advance(1));
    expect(events).toHaveLength(0);
    expect(harness.calls.heal).toHaveLength(0);
    expect(harness.engine.isWatchingResume("contract_2")).toBe(false);
  });

  it("重建失败按 5s 退避重试，达上限后放弃并告警（不再无限重试）", async () => {
    let attempts = 0;
    const harness = makeHarness({
      isWorktreeAlive: () => false,
      healResume: () => {
        attempts += 1;
        throw new Error("磁盘只读");
      },
    });
    harness.engine.watchResume("contract_3");

    await harness.engine.sweep(harness.advance(1)); // 第 1 次失败
    expect(attempts).toBe(1);

    await harness.engine.sweep(harness.advance(RESUME_HEAL_RETRY_MS - 1));
    expect(attempts).toBe(1); // 未到退避时刻，不重试

    await harness.engine.sweep(harness.advance(1)); // 第 2 次
    await harness.engine.sweep(harness.advance(RESUME_HEAL_RETRY_MS)); // 第 3 次
    expect(attempts).toBe(RESUME_HEAL_MAX_ATTEMPTS);

    const events = harness.events.filter((e) => e.code === "D3_HEAL_FAILED");
    expect(events).toHaveLength(1);
    expect(harness.engine.isWatchingResume("contract_3")).toBe(false);
  });

  it("探测钩子抛错时按丢失处理（宁可重建，不可卡死）", async () => {
    const harness = makeHarness({
      isWorktreeAlive: () => {
        throw new Error("stat ENOENT");
      },
    });
    harness.engine.watchResume("contract_4");
    const events = await harness.engine.sweep(harness.advance(1));
    expect(events.map((e) => e.code)).toEqual(["D3_WORKTREE_HEALED"]);
  });
});

describe("D-4 合并前目标分支仲裁：永远给出二选一，不返回死锁态", () => {
  it("目标未前进 → 可直接合并", () => {
    const harness = makeHarness();
    const decision = harness.engine.assessMerge({
      targetHead: "abc123",
      mergeBaseHead: "abc123",
    });
    expect(decision.kind).toBe("TARGET_UNCHANGED");
  });

  it("目标已前进 → 返回两个可执行选项，且附带白话说明", () => {
    const harness = makeHarness();
    const decision = harness.engine.assessMerge({
      targetHead: "def456",
      mergeBaseHead: "abc123",
    });

    expect(decision.kind).toBe("TARGET_ADVANCED");
    if (decision.kind !== "TARGET_ADVANCED") return;
    expect([...decision.options]).toEqual([
      "REPLAY_ON_CURRENT_BASELINE",
      "ABANDON_CANDIDATE",
    ]);
    expect(decision.message).toContain("重演");
    expect(decision.message).toContain("放弃");
  });
});

describe("D-5 命令超时分层：60s / 300s / 600s 回收并落超时证据", () => {
  it("SHORT 层边界：59.999s 不动，60s 回收并写证据", async () => {
    const harness = makeHarness();
    harness.engine.trackCommand({
      contractId: "contract_1",
      command: "npm run build",
      tier: "SHORT",
      pid: 9001,
    });

    const early = await harness.engine.sweep(
      harness.advance(COMMAND_TIMEOUT_MS.SHORT - 1),
    );
    expect(early).toHaveLength(0);

    const events = await harness.engine.sweep(harness.advance(1));
    expect(events.map((e) => e.code)).toEqual(["D5_COMMAND_TIMEOUT"]);
    expect(harness.calls.kill).toEqual([["contract_1", 9001]]);
    expect(harness.calls.evidence).toEqual([
      [
        "contract_1",
        { command: "npm run build", tier: "SHORT", timeout_ms: 60_000 },
      ],
    ]);
  });

  it("三层各按自身阈值触发，互不串档", async () => {
    const harness = makeHarness();
    harness.engine.trackCommand({
      contractId: "c-short",
      command: "lint",
      tier: "SHORT",
    });
    harness.engine.trackCommand({
      contractId: "c-medium",
      command: "test",
      tier: "MEDIUM",
    });
    harness.engine.trackCommand({
      contractId: "c-long",
      command: "build",
      tier: "LONG",
    });

    const at60 = await harness.engine.sweep(harness.advance(60_000));
    expect(at60.map((e) => e.contract_id)).toEqual(["c-short"]);

    const at300 = await harness.engine.sweep(harness.advance(240_000));
    expect(at300.map((e) => e.contract_id)).toEqual(["c-medium"]);

    const at600 = await harness.engine.sweep(harness.advance(300_000));
    expect(at600.map((e) => e.contract_id)).toEqual(["c-long"]);
  });

  it("命令正常结束则撤销监控，不会再被当作超时", async () => {
    const harness = makeHarness();
    const record = harness.engine.trackCommand({
      contractId: "contract_2",
      command: "npm test",
      tier: "SHORT",
    });
    harness.engine.settleCommand(record.id);

    const events = await harness.engine.sweep(harness.advance(120_000));
    expect(events).toHaveLength(0);
    expect(harness.calls.evidence).toHaveLength(0);
  });

  it("回收失败也要落证据：证据是事后追责的唯一凭据", async () => {
    const harness = makeHarness({
      killProcessTree: () => {
        throw new Error("kill EPERM");
      },
    });
    harness.engine.trackCommand({
      contractId: "contract_3",
      command: "npm run e2e",
      tier: "SHORT",
    });

    const events = await harness.engine.sweep(harness.advance(60_000));
    expect(events.map((e) => e.code)).toEqual(["D5_COMMAND_TIMEOUT"]);
    expect(harness.calls.evidence).toHaveLength(1);
  });
});

describe("扫描整体：一次 sweep 解除多类死锁", () => {
  it("四类同时过期时全部处置，且各自只触发一次", async () => {
    const harness = makeHarness();
    harness.engine.beginStop("c-stop", 1);
    harness.engine.acquireLease("lock:c", "daemon");
    harness.engine.watchResume("c-resume");
    harness.engine.trackCommand({
      contractId: "c-cmd",
      command: "npm test",
      tier: "SHORT",
    });

    const events = await harness.engine.sweep(harness.advance(90_000));
    expect(events.map((e) => e.code).sort()).toEqual(
      [
        "D1_STOP_TIMEOUT",
        "D2_LEASE_RECLAIMED",
        "D3_WORKTREE_HEALED",
        "D5_COMMAND_TIMEOUT",
      ].sort(),
    );
    expect(harness.engine.pendingCounts()).toEqual({
      stops: 0,
      leases: 0,
      resumeWatches: 0,
      commands: 0,
    });

    const second = await harness.engine.sweep(harness.advance(1_000));
    expect(second).toHaveLength(0);
  });
});

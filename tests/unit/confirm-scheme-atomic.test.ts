import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  type DemoGate,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import {
  CONFIRM_SCHEME_STEPS,
  newSchemeConfirmationId,
  resetConfirmSchemeTransactionsForTest,
  runConfirmSchemeAtomic,
  type ConfirmSchemeAtomicInput,
} from "../../src/lib/journey/confirm-scheme-atomic";

/**
 * SSOT v2.0.2 §5.2.1 验收：确认方案事务、幂等与补偿。
 *
 * 每条用例都是「可注入的故障点」：把失败塞进某个阶段，断言
 * 1) 失败前不产生签署副作用；2) 失败后右栏是否恢复/保持锁定；
 * 3) 同一 confirmation_id 重放不会签第二份合同。
 */

const CONFIRMATION_ID = "scheme-confirm-test-0001";

function makeScheme(partial: Partial<SchemeDraft> = {}): SchemeDraft {
  return emptySchemeDraft({
    title: "工程项目进度管控台",
    summary:
      "按项目维度汇总进度与预算，并对超期节点发出预警，支持月度报表导出。",
    modules: ["工程进度管控", "财务数据与预算"],
    mermaidFlow: "flowchart LR\n  A[录入进度] --> B[汇总]",
    business_input_rounds: 1,
    scheme_revision: 2,
    ...partial,
  });
}

function makeDemo(partial: Partial<DemoGate> = {}): DemoGate {
  return { ...EMPTY_DEMO_GATE, ...partial };
}

interface Harness {
  input: ConfirmSchemeAtomicInput;
  calls: string[];
  snapshotWrites: number;
  signs: number;
  compensations: { cause: string; failed_at: string }[];
  restores: number;
}

function makeHarness(
  overrides: {
    scheme?: Partial<SchemeDraft>;
    demo?: DemoGate;
    expectedRevision?: number;
    failQuiesce?: boolean;
    failSnapshot?: boolean;
    failSign?: boolean;
    failCompensate?: boolean;
    confirmationId?: string;
  } = {},
): Harness {
  const scheme = makeScheme(overrides.scheme);
  const calls: string[] = [];
  const harness: Harness = {
    calls,
    snapshotWrites: 0,
    signs: 0,
    compensations: [],
    restores: 0,
    input: {
      confirmationId: overrides.confirmationId ?? CONFIRMATION_ID,
      scheme,
      demo: overrides.demo ?? EMPTY_DEMO_GATE,
      expectedRevision: overrides.expectedRevision ?? scheme.scheme_revision,
      quiesceRightChat: async () => {
        calls.push("quiesce");
        if (overrides.failQuiesce) throw new Error("流式中断超时");
      },
      persistSnapshot: async ({ confirmation_id }) => {
        calls.push("snapshot");
        if (overrides.failSnapshot) throw new Error("磁盘只读");
        harness.snapshotWrites += 1;
        return {
          snapshot_id: confirmation_id,
          digest: `digest-${harness.snapshotWrites}`,
        };
      },
      signAndPrepare: async ({ confirmation_id }) => {
        calls.push("sign");
        if (overrides.failSign) throw new Error("Daemon 拒绝签署");
        harness.signs += 1;
        return { contract_id: `contract-${confirmation_id}` };
      },
      compensate: async ({ cause, failed_at }) => {
        calls.push("compensate");
        harness.compensations.push({ cause, failed_at });
        if (overrides.failCompensate) throw new Error("吊销 token 失败");
      },
      restoreRightChat: () => {
        calls.push("restore");
        harness.restores += 1;
      },
    },
  };
  return harness;
}

beforeEach(() => {
  resetConfirmSchemeTransactionsForTest();
});

describe("T-ATOM 五阶段事务", () => {
  it("T-ATOM-001 成功路径严格按五阶段顺序执行，且只在最后提交", async () => {
    const h = makeHarness();
    const result = await runConfirmSchemeAtomic(h.input);

    expect(result.ok).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(result.contract_id).toBe(`contract-${CONFIRMATION_ID}`);
    expect(result.steps.map((s) => s.step)).toEqual([...CONFIRM_SCHEME_STEPS]);
    expect(result.steps.every((s) => s.ok)).toBe(true);
    // 先冻结（quiesce）→ 再求值 → 再快照 → 再签署
    expect(h.calls).toEqual(["quiesce", "snapshot", "sign"]);
    // 提交成功后不主动解锁：已签署态不允许再聊改本轮
    expect(h.restores).toBe(0);
    expect(result.frozen?.frozen).toBe(true);
  });

  it("T-ATOM-002 同 confirmation_id + 同修订重放：幂等返回，不重复签署", async () => {
    const h = makeHarness();
    const first = await runConfirmSchemeAtomic(h.input);
    const second = await runConfirmSchemeAtomic(h.input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(h.signs).toBe(1);
    expect(h.snapshotWrites).toBe(1);
    expect(second.contract_id).toBe(first.contract_id);
  });

  it("T-ATOM-003 同 confirmation_id 换了修订：拒绝 E_CONFIRMATION_ID_REUSED", async () => {
    const h = makeHarness();
    await runConfirmSchemeAtomic(h.input);

    const changed = makeHarness({ scheme: { scheme_revision: 3 } });
    changed.input.confirmationId = CONFIRMATION_ID;
    const result = await runConfirmSchemeAtomic(changed.input);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("E_CONFIRMATION_ID_REUSED");
    expect(changed.signs).toBe(0);
  });

  it("T-ATOM-004 调用方看到的修订已过期：拒绝 E_SCHEME_REVISION_MISMATCH 并解锁", async () => {
    const h = makeHarness({
      expectedRevision: 1,
      scheme: { scheme_revision: 2 },
    });
    const result = await runConfirmSchemeAtomic(h.input);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe("VALIDATE_CONFIRMATION");
    expect(result.code).toBe("E_SCHEME_REVISION_MISMATCH");
    expect(h.snapshotWrites).toBe(0);
    expect(h.signs).toBe(0);
    expect(h.restores).toBe(1);
  });
});

describe("T-ATOM 故障注入与补偿", () => {
  it("T-ATOM-005 右栏未能静默：在 CLAIM 阶段即失败，不写快照不签署", async () => {
    const h = makeHarness({ failQuiesce: true });
    const result = await runConfirmSchemeAtomic(h.input);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe("CLAIM_AND_QUIESCE");
    expect(result.code).toBe("E_QUIESCE_FAILED");
    expect(h.calls).toEqual(["quiesce"]);
    expect(h.snapshotWrites).toBe(0);
    expect(h.signs).toBe(0);
    // quiesce 自身失败时右栏从未锁定，因此不需要恢复
    expect(h.restores).toBe(0);
  });

  it("T-ATOM-006 谓词拒绝（Demo 生成中）：在 VALIDATE 阶段失败，不写快照", async () => {
    const h = makeHarness({
      scheme: { scheme_revision: 2 },
      demo: makeDemo({ status: "building", scheme_revision: 2 }),
    });
    const result = await runConfirmSchemeAtomic(h.input);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe("VALIDATE_CONFIRMATION");
    expect(result.code).toBe("E_DEMO_BUILDING");
    expect(h.snapshotWrites).toBe(0);
    expect(h.signs).toBe(0);
    expect(h.restores).toBe(1);
  });

  it("T-ATOM-007 快照落盘失败：不进入签署，解锁可重试", async () => {
    const h = makeHarness({ failSnapshot: true });
    const result = await runConfirmSchemeAtomic(h.input);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe("FREEZE_SNAPSHOT");
    expect(result.code).toBe("E_SCHEME_SNAPSHOT_FAILED");
    expect(h.signs).toBe(0);
    expect(h.compensations).toHaveLength(0);
    expect(h.restores).toBe(1);
  });

  it("T-ATOM-008 签署失败但补偿成功：返回 E_SIGN_AND_PREPARE_FAILED 并解锁", async () => {
    const h = makeHarness({ failSign: true });
    const result = await runConfirmSchemeAtomic(h.input);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe("SIGN_AND_PREPARE");
    expect(result.code).toBe("E_SIGN_AND_PREPARE_FAILED");
    expect(h.compensations).toHaveLength(1);
    expect(h.compensations[0]?.failed_at).toBe("SIGN_AND_PREPARE");
    expect(h.restores).toBe(1);
    expect(result.snapshot?.snapshot_id).toBe(CONFIRMATION_ID);
  });

  it("T-ATOM-009 签署失败且补偿也失败：E_COMPENSATION_FAILED 且保持锁定", async () => {
    const h = makeHarness({ failSign: true, failCompensate: true });
    const result = await runConfirmSchemeAtomic(h.input);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("E_COMPENSATION_FAILED");
    expect(result.reason).toContain("补偿未完成");
    // 关键：补偿没成功就不许解锁，否则用户可以再点一次确认
    expect(h.restores).toBe(0);
  });

  it("T-ATOM-010 confirmation_id 非法：直接拒绝，不触碰右栏", async () => {
    const h = makeHarness({ confirmationId: "短" });
    const result = await runConfirmSchemeAtomic(h.input);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("E_CONFIRMATION_ID_INVALID");
    expect(result.steps).toHaveLength(0);
    expect(h.calls).toEqual([]);
  });

  it("T-ATOM-011 只有成功签署才记录幂等结果：失败不污染后续同 id 重试", async () => {
    const failing = makeHarness({ failSign: true });
    const failed = await runConfirmSchemeAtomic(failing.input);
    expect(failed.ok).toBe(false);

    resetConfirmSchemeTransactionsForTest();
    const retry = makeHarness();
    const ok = await runConfirmSchemeAtomic(retry.input);
    expect(ok.ok).toBe(true);
    expect(ok.idempotent).toBe(false);
    expect(retry.signs).toBe(1);
  });
});

describe("T-ATOM confirmation_id 生成", () => {
  it("T-ATOM-012 生成器产物满足 8–96 位字符集且两次不重复", () => {
    const a = newSchemeConfirmationId();
    const b = newSchemeConfirmationId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9._-]{8,96}$/);
  });

  it("T-ATOM-013 生成的 id 可被事务接受（端到端一小步）", async () => {
    const spy = vi.fn(async () => ({ contract_id: "contract-x" }));
    const h = makeHarness({ confirmationId: newSchemeConfirmationId() });
    h.input.signAndPrepare = spy;
    const result = await runConfirmSchemeAtomic(h.input);
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

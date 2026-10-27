import type { DemoMode } from "../../../src/lib/state/delivery-state";
import { canSign } from "../../../src/lib/state/delivery-state";
import type { SchemeSnapshot } from "../../pipeline/scheme-snapshot-store";
import { readDemoConfirm, type DemoConfirmRecord } from "./prototypes";

/**
 * Daemon 权威签署门禁（SSOT v2.0.2 §3.5 / §4.6）。
 *
 * 两类输入：
 * - 有确认快照：按快照中的冻结事实核对，允许“从未生成 Demo”直接签署；
 * - 无快照（旧路径）：回退到最新 Demo 确认记录，保守拦截未确认原型。
 *
 * 关键修复：旧实现只在“已有确认记录”时才校验，导致
 * `writePrototype` 写入的 `confirmed:false` 记录被跳过。本函数对
 * `confirmed:false` 明确拒绝。
 */

export type DemoSignMode = "none" | DemoMode;

export type DemoSignGateDecision =
  | {
      ok: true;
      mode: DemoSignMode;
      prototype_id?: string;
      source: "snapshot" | "latest" | "never_generated";
    }
  | {
      ok: false;
      code: string;
      message: string;
      prototype_id?: string;
      source: "snapshot" | "latest";
    };

function modeOf(record: DemoConfirmRecord | null): DemoMode {
  return record?.demo_mode ?? "INTERACTIVE_DEMO";
}

function evaluateConfirmRecord(
  record: DemoConfirmRecord | null,
  source: "snapshot" | "latest",
): DemoSignGateDecision {
  if (!record) {
    return {
      ok: false,
      code: "E_DEMO_NOT_CONFIRMED",
      message: "Demo 已生成但缺少确认记录，禁止签署",
      source,
    };
  }
  if (!record.confirmed) {
    return {
      ok: false,
      code: "E_DEMO_NOT_CONFIRMED",
      message: "Demo 已生成但尚未确认，禁止签署",
      prototype_id: record.prototype_id,
      source,
    };
  }
  const mode = modeOf(record);
  const verdict = canSign({
    demo_mode: mode,
    confirmed: true,
    accept_degraded: record.accept_degraded === true,
  });
  if (!verdict.ok) {
    return {
      ok: false,
      code: "E_CAN_SIGN_DENIED",
      message: verdict.reason,
      prototype_id: record.prototype_id,
      source,
    };
  }
  return {
    ok: true,
    mode,
    prototype_id: record.prototype_id,
    source,
  };
}

/** 旧路径兜底：只认最新一条 Demo 记录；没有记录视为从未生成。 */
export function evaluateLatestDemoGate(repoRoot: string): DemoSignGateDecision {
  const latest = readDemoConfirm(repoRoot);
  if (!latest) {
    return { ok: true, mode: "none", source: "never_generated" };
  }
  return evaluateConfirmRecord(latest, "latest");
}

/** 新主路径：按不可变确认快照判定，禁止用“没传 snapshot”绕过。 */
export function evaluateSnapshotDemoGate(
  snapshot: SchemeSnapshot,
  lookup: (prototypeId: string) => DemoConfirmRecord | null = () => null,
): DemoSignGateDecision {
  const { demo } = snapshot;
  if (demo.status === "none") {
    return { ok: true, mode: "none", source: "snapshot" };
  }
  if (demo.status === "building") {
    return {
      ok: false,
      code: "E_DEMO_BUILDING",
      message: "Demo 仍在生成，禁止签署",
      source: "snapshot",
    };
  }
  if (demo.status === "failed") {
    return {
      ok: false,
      code: "E_DEMO_FAILED",
      message: "Demo 生成失败，须重试或显式接受流程图降级",
      source: "snapshot",
    };
  }
  if (
    demo.scheme_revision !== snapshot.scheme_revision ||
    demo.decision_revision !== snapshot.scheme_revision
  ) {
    return {
      ok: false,
      code: "E_DEMO_STALE",
      message: "Demo 与当前冻结方案不是同一修订，禁止签署",
      source: "snapshot",
    };
  }

  if (demo.status === "degraded_flowcard") {
    const verdict = canSign({
      demo_mode: "DEGRADED_FLOW_CARD",
      confirmed: true,
      accept_degraded: true,
    });
    if (!verdict.ok) {
      return {
        ok: false,
        code: "E_CAN_SIGN_DENIED",
        message: verdict.reason,
        source: "snapshot",
      };
    }
    return {
      ok: true,
      mode: "DEGRADED_FLOW_CARD",
      ...(demo.prototype_id ? { prototype_id: demo.prototype_id } : {}),
      source: "snapshot",
    };
  }

  if (!demo.prototype_id) {
    return {
      ok: false,
      code: "E_DEMO_NOT_CONFIRMED",
      message: "快照声称 Demo 已生成但缺少 prototype_id，禁止签署",
      source: "snapshot",
    };
  }
  const record = lookup(demo.prototype_id);
  if (!record) {
    return {
      ok: false,
      code: "E_DEMO_NOT_CONFIRMED",
      message: "找不到 Demo 确认记录，禁止签署",
      prototype_id: demo.prototype_id,
      source: "snapshot",
    };
  }
  return evaluateConfirmRecord(record, "snapshot");
}

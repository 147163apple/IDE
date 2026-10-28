import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { DemoGate, SchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";
import { stableStringify } from "../../src/lib/stable-stringify";
import { writeJsonAtomic } from "../../src/lib/state-machine";

/**
 * TASK-C.22 / SSOT v2.0.2 §5.2.1：确认方案不可变快照。
 *
 * 只负责“冻结事实”，不负责签署。相同 confirmation_id + 相同内容幂等返回；
 * 同一 id 对应不同内容则拒绝，避免前端重试时悄悄替换用户已确认的方案。
 */

export const SCHEME_SNAPSHOT_DIR = ".stagent/drafts/schemes" as const;
/** 1.1 起快照携带完整 ScopePlan（TASK-J.4）；1.0 旧快照仍可读，但 scope_plan 视为缺失 */
export const SCHEME_SNAPSHOT_SCHEMA_VERSION = "1.1" as const;
export type SchemeSnapshotSchemaVersion = "1.0" | "1.1";

export interface SchemeSnapshot {
  schema_version: SchemeSnapshotSchemaVersion;
  snapshot_id: string;
  confirmation_id: string;
  status: "FROZEN";
  created_at: string;
  scheme_revision: number;
  scheme: SchemeDraft;
  demo: DemoGate;
  decision: {
    code: string;
    message: string;
    demo_mode: "none" | "interactive" | "degraded";
  };
  /** 1.1 必填；1.0 旧快照没有该字段 */
  scope_plan?: ScopePlan;
  digest: string;
}

export class SchemeSnapshotConflictError extends Error {
  readonly code = "E_SCHEME_CONFIRMATION_CONFLICT";
  constructor(confirmationId: string) {
    super(
      `confirmation_id=${confirmationId} 已冻结另一版方案；拒绝覆盖不可变快照`,
    );
    this.name = "SchemeSnapshotConflictError";
  }
}

function assertConfirmationId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9._-]{8,96}$/.test(id)) {
    const err = new Error("confirmation_id 格式非法") as Error & {
      code?: string;
    };
    err.code = "E_CONFIRMATION_ID_INVALID";
    throw err;
  }
  return id;
}

/**
 * 方案内容的稳定摘要。
 *
 * 刻意剔除 `updatedAt`：它只是本地写入时间戳，不承载任何用户决策；
 * 纳入摘要会让“同一份方案重放”被误判成“另一版方案”。其余字段
 * （含 scheme_id / scheme_revision / 模块 / 链路 / 抉择）全部参与，
 * 任何实质改动都必须改变 digest。
 */
function decisionBearingScheme(
  scheme: SchemeDraft,
): Omit<SchemeDraft, "updatedAt"> {
  const { updatedAt: _ignored, ...rest } = scheme;
  return rest;
}

export function schemeSnapshotDigest(input: {
  scheme_revision: number;
  scheme: SchemeDraft;
  demo: DemoGate;
  /** TASK-J.4：快照摘要纳入 ScopePlan 的 plan_digest（不含白话文案，避免措辞变动改摘要） */
  scope_plan?: ScopePlan | undefined;
}): string {
  const payload = stableStringify({
    scheme_revision: input.scheme_revision,
    scheme: decisionBearingScheme(input.scheme),
    demo: input.demo,
    scope_plan_digest: input.scope_plan?.plan_digest ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/** 1.0 时代的摘要口径：不含 scope_plan。仅用于旧快照的幂等比对。 */
function legacySnapshotDigest(input: {
  scheme_revision: number;
  scheme: SchemeDraft;
  demo: DemoGate;
}): string {
  const payload = stableStringify({
    scheme_revision: input.scheme_revision,
    scheme: decisionBearingScheme(input.scheme),
    demo: input.demo,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function schemeSnapshotPath(
  repoRoot: string,
  confirmationId: string,
): string {
  const id = assertConfirmationId(confirmationId);
  return path.join(path.resolve(repoRoot), SCHEME_SNAPSHOT_DIR, `${id}.json`);
}

export function readSchemeSnapshot(
  repoRoot: string,
  confirmationId: string,
): SchemeSnapshot | null {
  let file: string;
  try {
    file = schemeSnapshotPath(repoRoot, confirmationId);
  } catch {
    return null;
  }
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SchemeSnapshot;
    const version = parsed.schema_version;
    if (
      (version !== "1.0" && version !== "1.1") ||
      parsed.status !== "FROZEN" ||
      typeof parsed.digest !== "string" ||
      parsed.confirmation_id !== confirmationId
    ) {
      return null;
    }
    // 1.1 必须带范围；缺失说明文件损坏或写入中断，按不可用处理
    if (version === "1.1" && !parsed.scope_plan) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSchemeSnapshot(
  repoRoot: string,
  input: {
    confirmation_id: string;
    scheme: SchemeDraft;
    demo: DemoGate;
    decision: SchemeSnapshot["decision"];
    /** TASK-J.4：冻结时必须带上与当前修订绑定的 ScopePlan */
    scope_plan: ScopePlan;
    now?: () => Date;
  },
): { snapshot: SchemeSnapshot; idempotent: boolean } {
  const confirmationId = assertConfirmationId(input.confirmation_id);
  const digest = schemeSnapshotDigest({
    scheme_revision: input.scheme.scheme_revision,
    scheme: input.scheme,
    demo: input.demo,
    scope_plan: input.scope_plan,
  });
  const existing = readSchemeSnapshot(repoRoot, confirmationId);
  if (existing) {
    const comparableDigest =
      existing.schema_version === "1.0"
        ? legacySnapshotDigest({
            scheme_revision: input.scheme.scheme_revision,
            scheme: input.scheme,
            demo: input.demo,
          })
        : digest;
    if (existing.digest !== comparableDigest) {
      throw new SchemeSnapshotConflictError(confirmationId);
    }
    return { snapshot: existing, idempotent: true };
  }

  const now = input.now ?? (() => new Date());
  const snapshot: SchemeSnapshot = {
    schema_version: SCHEME_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: confirmationId,
    confirmation_id: confirmationId,
    status: "FROZEN",
    created_at: now().toISOString(),
    scheme_revision: input.scheme.scheme_revision,
    scheme: input.scheme,
    demo: input.demo,
    decision: input.decision,
    scope_plan: input.scope_plan,
    digest,
  };
  writeJsonAtomic(schemeSnapshotPath(repoRoot, confirmationId), snapshot);
  return { snapshot, idempotent: false };
}

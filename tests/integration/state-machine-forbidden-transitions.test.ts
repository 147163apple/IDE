import { describe, expect, it } from "vitest";
import type { EvidenceBundleV11 } from "../../src/lib/evidence.schema";
import { evidenceBundleSchema } from "../../src/lib/evidence.schema";
import type { ContractStatePair } from "../../src/lib/state-machine";
import {
  ALL_LIFECYCLE_STATES,
  validateStatePair,
  validateTransition,
} from "../../src/lib/state-machine";

/**
 * Target Contract Draft §5 — Forbidden Transitions.
 *
 * These are integration-level boundary checks: state-pair validation and Evidence
 * parsing are exercised together as the same public contract used by Daemon code.
 * FT-12 deliberately includes the target fail-closed rule for uncontrolled
 * evidence; it is expected to turn red until the Evidence admission boundary
 * rejects that source.
 */

const pair = (
  lifecycle_state: ContractStatePair["lifecycle_state"],
  approval_status: ContractStatePair["approval_status"],
): ContractStatePair => ({ lifecycle_state, approval_status });

const approved = (lifecycle_state: ContractStatePair["lifecycle_state"]) =>
  pair(lifecycle_state, "APPROVED");

const legalPairFor = (
  lifecycle_state: ContractStatePair["lifecycle_state"],
): ContractStatePair => {
  switch (lifecycle_state) {
    case "DRAFT":
      return pair("DRAFT", "DRAFT");
    case "PENDING_APPROVAL":
      return pair("PENDING_APPROVAL", "PENDING_REVIEW");
    case "ABORTED":
      return pair("ABORTED", "REJECTED");
    default:
      return approved(lifecycle_state);
  }
};

function validEvidence(
  overrides: Partial<EvidenceBundleV11> = {},
): EvidenceBundleV11 {
  return {
    evidence_id: "evidence_ft",
    contract_id: "contract_ft",
    generated_at: new Date().toISOString(),
    usage: {
      currency: "CNY",
      pricing_version: "test",
      accounting_mode: "ESTIMATED",
      estimated_cost_minor_units: 1,
      limit_reached: false,
    },
    worktree_snapshot: {
      head_sha: "head_ft",
      snapshot_fingerprint: "fingerprint_ft",
      captured_at: new Date().toISOString(),
    },
    verdict: { status: "PASSED", can_merge: true, summary: "all gates pass" },
    scope_audit: {
      passed: true,
      files_changed: [],
      forbidden_violations: [],
      budget_exhausted: false,
    },
    verification_results: [
      {
        command_alias: "test",
        exit_code: 0,
        stdout_tail: "ok",
        stderr_tail: "",
        duration_ms: 1,
        passed: true,
      },
    ],
    git_info: {
      base_commit_sha: "base_ft",
      task_commit_sha: "task_ft",
      diff_stat: "0 files",
      patch_fingerprint: "sha256_ft",
    },
    ...overrides,
  };
}

describe("Negative integration: state-machine forbidden transitions", () => {
  it("FT-01 rejects any lifecycle rollback to DRAFT, including ABORTED -> DRAFT", () => {
    for (const fromState of ALL_LIFECYCLE_STATES.filter(
      (state) => state !== "DRAFT",
    )) {
      const result = validateTransition(
        legalPairFor(fromState),
        pair("DRAFT", "DRAFT"),
      );
      expect(result.ok, `${fromState} -> DRAFT must fail closed`).toBe(false);
    }
  });

  it("FT-02 rejects rollback to PENDING_APPROVAL except from DRAFT or PREPARING", () => {
    for (const fromState of ALL_LIFECYCLE_STATES.filter(
      (state) => state !== "DRAFT" && state !== "PREPARING",
    )) {
      const result = validateTransition(
        legalPairFor(fromState),
        pair("PENDING_APPROVAL", "PENDING_REVIEW"),
      );
      expect(
        result.ok,
        `${fromState} -> PENDING_APPROVAL must fail closed`,
      ).toBe(false);
    }
  });

  it("FT-03 rejects DRAFT skipping approval into execution, verification, audit, or merge", () => {
    for (const target of [
      "EXECUTING",
      "VERIFYING",
      "AUDITED",
      "MERGED",
    ] as const) {
      const result = validateTransition(
        pair("DRAFT", "DRAFT"),
        approved(target),
      );
      expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
    }
  });

  it("FT-04 rejects PENDING_APPROVAL direct entry to execution, verification, audit, or merge", () => {
    for (const target of [
      "EXECUTING",
      "VERIFYING",
      "AUDITED",
      "MERGED",
    ] as const) {
      const result = validateTransition(
        pair("PENDING_APPROVAL", "PENDING_REVIEW"),
        approved(target),
      );
      expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
    }
  });

  it("FT-05 rejects PREPARING direct entry to verifying, audited, or merged", () => {
    for (const target of ["VERIFYING", "AUDITED", "MERGED"] as const) {
      const result = validateTransition(
        approved("PREPARING"),
        approved(target),
      );
      expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
    }
  });

  it("FT-06 rejects EXECUTING direct entry to audited or merged", () => {
    for (const target of ["AUDITED", "MERGED"] as const) {
      const result = validateTransition(
        approved("EXECUTING"),
        approved(target),
      );
      expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
    }
  });

  it("FT-07 rejects VERIFYING -> MERGED without AUDITED evidence gate", () => {
    expect(
      validateTransition(approved("VERIFYING"), approved("MERGED")),
    ).toMatchObject({
      ok: false,
      code: "ILLEGAL_TRANSITION",
    });
  });

  it("FT-08 rejects PENDING_RESUME direct entry to verifying, audited, or merged", () => {
    for (const target of ["VERIFYING", "AUDITED", "MERGED"] as const) {
      const result = validateTransition(
        approved("PENDING_RESUME"),
        approved(target),
      );
      expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
    }
  });

  it("FT-09 rejects AUDITED -> PENDING_APPROVAL contract rollback", () => {
    expect(
      validateTransition(
        approved("AUDITED"),
        pair("PENDING_APPROVAL", "PENDING_REVIEW"),
      ),
    ).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
  });

  it("FT-10 rejects all outbound transitions from MERGED and ABORTED", () => {
    for (const terminal of ["MERGED", "ABORTED"] as const) {
      for (const target of ALL_LIFECYCLE_STATES) {
        const result = validateTransition(
          legalPairFor(terminal),
          legalPairFor(target),
        );
        expect(result).toMatchObject({ ok: false, code: "TERMINAL_STATE" });
      }
    }
  });

  it("FT-11 rejects illegal lifecycle / approval pairs", () => {
    for (const invalidPair of [
      pair("DRAFT", "APPROVED"),
      pair("PENDING_APPROVAL", "APPROVED"),
      pair("EXECUTING", "PENDING_REVIEW"),
      pair("MERGED", "REJECTED"),
      pair("ABORTED", "DRAFT"),
    ]) {
      expect(validateStatePair(invalidPair)).toMatchObject({
        ok: false,
        code: "ILLEGAL_STATE_PAIR",
      });
    }
  });

  it("FT-12 rejects mergeable non-PASSED Evidence and uncontrolled forged Evidence", () => {
    for (const status of ["FAILED", "BLOCKED", "STALE"] as const) {
      const result = evidenceBundleSchema.safeParse(
        validEvidence({
          verdict: {
            status,
            can_merge: true,
            summary: `${status} cannot merge`,
          },
        }),
      );
      expect(result.success, `${status} evidence must not merge`).toBe(false);
    }

    const forged = evidenceBundleSchema.safeParse(
      validEvidence({ worker_control_mode: "UNCONTROLLED_EXTERNAL" }),
    );
    expect(
      forged.success,
      "uncontrolled evidence must be rejected before it can claim can_merge=true",
    ).toBe(false);
  });
});

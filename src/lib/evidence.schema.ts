import { z } from "zod";

/**
 * 证据包 Schema (v1.1.3)
 * 严格对齐《Stagent 系统架构设计规范 v1.1.3》§9.2。
 * 结论状态（PASSED/FAILED/BLOCKED/STALE）仅归属于 Evidence，严禁混入合同生命周期。
 */

// --- 1. 证据结论状态 (§9.2 verdict.status) ---

export const evidenceVerdictStatusSchema = z.enum([
  "PASSED",
  "FAILED",
  "BLOCKED",
  "STALE", // 生成后 Worktree 文件快照/HEAD 变化，须重新验证
]);
export type EvidenceVerdictStatus = z.infer<typeof evidenceVerdictStatusSchema>;

// --- 2. 原因码 (§9.2 reason_code 完整闭环，含崩溃恢复两码) ---

export const reasonCodeSchema = z.enum([
  "SCOPE_VIOLATION",
  "BUDGET_EXHAUSTED",
  "WORKSPACE_LOCKED",
  "UNAUTHORIZED_COMMAND",
  "VERIFICATION_RETRY_LIMIT",
  "UNSAFE_EXECUTION",
  "EVIDENCE_STALE",
  "PREPARATION_INTERRUPTED",
  "WORKTREE_LOST",
]);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

// --- 3. 用量与账单 (§9.2 usage) ---

export const usageAccountingModeSchema = z.enum([
  "PROVIDER_REPORTED",
  "ESTIMATED",
  "UNAVAILABLE",
]);
export type UsageAccountingMode = z.infer<typeof usageAccountingModeSchema>;

export const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    estimated_cost_minor_units: z.number().int().nonnegative().optional(),
    reported_cost_minor_units: z.number().int().nonnegative().optional(),
    currency: z.string().min(1),
    pricing_version: z.string().min(1),
    accounting_mode: usageAccountingModeSchema,
    limit_reached: z.boolean(),
    reserved_cost_minor_units: z.number().int().nonnegative().optional(),
    cumulative_cost_minor_units: z.number().int().nonnegative().optional(),
  })
  .superRefine((usage, ctx) => {
    // 账单模式一致性：PROVIDER_REPORTED 必须有 reported 值；ESTIMATED 必须有 estimated 值
    if (
      usage.accounting_mode === "PROVIDER_REPORTED" &&
      usage.reported_cost_minor_units === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "accounting_mode=PROVIDER_REPORTED requires reported_cost_minor_units",
      });
    }
    if (
      usage.accounting_mode === "ESTIMATED" &&
      usage.estimated_cost_minor_units === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "accounting_mode=ESTIMATED requires estimated_cost_minor_units",
      });
    }
  });
export type Usage = z.infer<typeof usageSchema>;

// --- 4. 工作树快照 / Scope 审计 / 验证结果 / Git 信息 (§9.2) ---

export const worktreeSnapshotSchema = z.object({
  head_sha: z.string().min(1),
  snapshot_fingerprint: z.string().min(1),
  captured_at: z.string(),
});
export type WorktreeSnapshot = z.infer<typeof worktreeSnapshotSchema>;

export const scopeAuditSchema = z.object({
  passed: z.boolean(),
  files_changed: z.array(
    z.object({
      path: z.string().min(1),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      binary: z.boolean(),
    }),
  ),
  forbidden_violations: z.array(z.string()),
  budget_exhausted: z.boolean(),
});
export type ScopeAudit = z.infer<typeof scopeAuditSchema>;

export const verificationResultSchema = z.object({
  command_alias: z.string().min(1),
  exit_code: z.number().int(),
  stdout_tail: z.string(),
  stderr_tail: z.string(),
  duration_ms: z.number().nonnegative(),
  passed: z.boolean(),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const gitInfoSchema = z.object({
  base_commit_sha: z.string().min(1),
  task_commit_sha: z.string().min(1),
  diff_stat: z.string(),
  patch_fingerprint: z.string().min(1), // SHA-256 一致性校验指纹（非防篡改签名）
});
export type GitInfo = z.infer<typeof gitInfoSchema>;

// --- 5. 证据包 (§9.2 EvidenceBundleV11) ---

export const evidenceBundleSchema = z
  .object({
    evidence_id: z.string().min(1),
    contract_id: z.string().min(1),
    generated_at: z.string(),
    usage: usageSchema,
    worktree_snapshot: worktreeSnapshotSchema,
    verdict: z.object({
      status: evidenceVerdictStatusSchema,
      can_merge: z.boolean(), // 派生字段：仅 status===PASSED 且快照/Scope/预算门禁全通过时为 true
      summary: z.string(),
      reason_code: reasonCodeSchema.optional(),
      verification_retry_count: z.number().int().nonnegative().optional(),
    }),
    scope_audit: scopeAuditSchema,
    verification_results: z.array(verificationResultSchema),
    git_info: gitInfoSchema,
    /**
     * 测试完整性留痕（Test Integrity Guard）：本任务是否修改过测试文件。
     * true 时控制台必须高亮预警——验证退出码可能由 Agent 自证，核销人
     * 须人工核对测试改动后再合并。可选字段以保持旧证据包向后兼容。
     */
    tests_modified: z.boolean().optional(),
  })
  .superRefine((bundle, ctx) => {
    // §9.2 Schema 不变式：status !== "PASSED" 时 can_merge 必须为 false
    if (bundle.verdict.status !== "PASSED" && bundle.verdict.can_merge) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "can_merge must be false when verdict.status is not PASSED (§9.2 invariant)",
      });
    }
  });
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

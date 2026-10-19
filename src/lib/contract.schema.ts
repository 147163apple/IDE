import { z } from "zod";

/**
 * 软件合同 Schema (v1.1.3)
 * 严格对齐《Stagent 系统架构设计规范 v1.1.3》§9.1 与 §9.1.1。
 * 本文件是全工程唯一合同契约（红线一：Schema 即宪法）。
 */

// --- 1. 生命周期与状态模型 (§9.1 9 态枚举) ---

export const lifecycleStateSchema = z.enum([
  "DRAFT", // 草案生成中
  "PENDING_APPROVAL", // 等待用户审批
  "PREPARING", // 创建 Worktree、配置 Scoped MCP
  "EXECUTING", // Worker 编码执行中
  "VERIFYING", // 门禁测试与 Scope 校验中
  "PENDING_RESUME", // 异常断电/重启等待用户恢复断点
  "AUDITED", // 门禁通过，生成 Evidence Bundle 等待核销
  "MERGED", // 用户核销入主干，清理现场完成
  "ABORTED", // 用户驳回或安全熔断终止（终态）
]);
export type LifecycleState = z.infer<typeof lifecycleStateSchema>;

export const approvalStatusSchema = z.enum([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const creatorSchema = z.enum(["user", "tech_lead"]);
export type Creator = z.infer<typeof creatorSchema>;

// --- 2. 预算与成本硬上限 (§9.1) ---

// 安全路径校验：禁止路径逃逸 (../) 或绝对路径开头 (/)
export const safePathString = z
  .string()
  .min(1)
  .refine(
    (p) => !p.startsWith("/") && !p.includes("../") && !p.includes("..\\"),
    {
      message:
        "Path traversal detected: paths must be relative and cannot contain '..'",
    },
  );

export const budgetLimitsSchema = z.object({
  max_file_modifications: z.number().int().positive().default(10),
  max_total_diff_lines: z.number().int().positive().default(2000),
  max_duration_seconds: z.number().int().positive().default(1800), // 任务级总时长，默认 1800s
  max_agent_turns: z.number().int().positive().optional(),
  max_verification_retries: z.number().int().nonnegative().default(3), // 默认 3
});
export type BudgetLimits = z.infer<typeof budgetLimitsSchema>;

export const contractAccountingModeSchema = z.enum([
  "PROVIDER_REPORTED",
  "ESTIMATED",
]);
export type ContractAccountingMode = z.infer<
  typeof contractAccountingModeSchema
>;

export const costLimitsSchema = z.object({
  max_input_tokens: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  max_cost_minor_units: z.number().int().nonnegative(), // 最小货币单位（如分），整数
  currency: z.string().min(1), // ISO 4217，如 "CNY" | "USD"
  pricing_version: z.string().min(1),
  accounting_mode: contractAccountingModeSchema,
});
export type CostLimits = z.infer<typeof costLimitsSchema>;

// --- 3. 执行权限 (§9.1 execution_permissions) ---

export const networkPolicySchema = z.enum([
  "DENY",
  "EXPLICIT_TARGETS",
  "USER_APPROVED",
]);
export type NetworkPolicy = z.infer<typeof networkPolicySchema>;

export const portPolicySchema = z.enum([
  "NONE",
  "DYNAMIC_IF_SUPPORTED",
  "EXPLICIT",
]);
export type PortPolicy = z.infer<typeof portPolicySchema>;

export const envFileGrantSchema = z.object({
  file: safePathString, // 受控 env 文件，例如 .env.test
  command_aliases: z.array(z.string().min(1)),
  variable_names: z.array(z.string().min(1)),
});
export type EnvFileGrant = z.infer<typeof envFileGrantSchema>;

export const executionPermissionsSchema = z.object({
  allowed_commands: z.array(z.string().min(1)).default([]),
  allowed_environment_variable_names: z.array(z.string().min(1)).default([]),
  network_policy: networkPolicySchema.default("DENY"),
  dependency_changes_allowed: z.boolean().default(false),
  editor_command_template: z.string().optional(), // 参数化模板，禁止 shell 拼接
  env_file_grants: z.array(envFileGrantSchema).optional(),
  port_policy: portPolicySchema.optional(),
});
export type ExecutionPermissions = z.infer<typeof executionPermissionsSchema>;

// --- 4. 结构化验证命令 (§9.1 verification_spec，杜绝 shell 注入歧义) ---

export const verificationCommandSchema = z.object({
  alias: z.string().min(1),
  executable: z.string().min(1),
  args: z.array(z.string()), // 已分离 argv；禁止 shell 字符串解析/拼接
  expected_exit_code: z.number().int().default(0),
  timeout_seconds: z.number().int().positive().default(60), // 单命令上限，默认 60s
  working_directory: safePathString.optional(),
});
export type VerificationCommand = z.infer<typeof verificationCommandSchema>;

// --- 5. 软件合同模式 (§9.1 SoftwareContractV11) ---

const approvalSchema = z
  .object({
    status: approvalStatusSchema,
    approved_by: z.string().min(1).optional(),
    approved_at: z.string().optional(),
    rejection_reason: z.string().optional(),
  })
  .superRefine((approval, ctx) => {
    // §9.1.1：当且仅当 APPROVED 时 approved_by / approved_at 必填
    if (approval.status === "APPROVED") {
      if (!approval.approved_by || !approval.approved_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "approval.status is APPROVED but approved_by/approved_at are missing",
        });
      }
    }
  });

export const softwareContractSchema = z
  .object({
    contract_id: z.string().min(1),
    schema_version: z.literal("1.1.3"),
    created_at: z.string(),
    creator: creatorSchema,
    lifecycle_state: lifecycleStateSchema,
    intent: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000),
      acceptance_criteria: z.array(z.string().min(1)).min(1),
      risk_level: riskLevelSchema,
    }),
    authorization: z.object({
      git: z.object({
        base_branch: z.string().min(1).default("main"),
        task_branch: z
          .string()
          .regex(/^task\//, "task_branch must use 'task/' prefix"),
        target_branch: z.string().min(1).default("main"),
        use_worktree: z.literal(true), // v0.1 强制 Worktree 物理隔离
      }),
      file_system_scope: z.object({
        writable_paths: z.array(safePathString).min(1, "empty scope rejected"),
        readonly_paths: z.array(safePathString).default([]),
        strictly_forbidden_paths: z.array(z.string()).default([]),
      }),
      budget_limits: budgetLimitsSchema.default({}),
      cost_limits: costLimitsSchema,
      execution_permissions: executionPermissionsSchema.default({}),
    }),
    verification_spec: z.object({
      commands: z
        .array(verificationCommandSchema)
        .min(1, "At least one verification command is required"),
    }),
    approval: approvalSchema,
  })
  .superRefine((contract, ctx) => {
    // §9.1.1 双状态机联动规则：拒绝非法的 lifecycle × approval 组合
    const ls = contract.lifecycle_state;
    const as = contract.approval.status;
    const legal =
      (ls === "DRAFT" && as === "DRAFT") ||
      (ls === "PENDING_APPROVAL" && as === "PENDING_REVIEW") ||
      (
        [
          "PREPARING",
          "EXECUTING",
          "VERIFYING",
          "PENDING_RESUME",
          "AUDITED",
          "MERGED",
        ] as LifecycleState[]
      ).includes(ls) ||
      (ls === "ABORTED" && (as === "REJECTED" || as === "APPROVED"));
    // 注意：中间态要求 approval 为 APPROVED
    const middleStates: LifecycleState[] = [
      "PREPARING",
      "EXECUTING",
      "VERIFYING",
      "PENDING_RESUME",
      "AUDITED",
      "MERGED",
    ];
    const legalCombination = middleStates.includes(ls)
      ? as === "APPROVED"
      : legal;
    if (!legalCombination) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Illegal state combination: lifecycle_state=${ls} with approval.status=${as} violates §9.1.1`,
      });
    }
  });

export type SoftwareContract = z.infer<typeof softwareContractSchema>;

// 兼容导出：Evidence 定义已迁至 evidence.schema.ts（红线五：单一事实源）
export {
  evidenceVerdictStatusSchema,
  type EvidenceVerdictStatus,
  evidenceBundleSchema,
  reasonCodeSchema,
  type ReasonCode,
  type EvidenceBundle,
} from "./evidence.schema";

// Helper to create a new Contract Draft adhering to v1.1.3
export function createContractDraft(params: {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  riskLevel?: RiskLevel | undefined;
  writablePaths: string[];
  readonlyPaths?: string[] | undefined;
  strictlyForbiddenPaths?: string[] | undefined;
  baseBranch?: string | undefined;
  targetBranch?: string | undefined;
  commands?: VerificationCommand[] | undefined;
  maxFileModifications?: number | undefined;
  maxVerificationRetries?: number | undefined;
  maxDurationSeconds?: number | undefined;
  maxCostMinorUnits?: number | undefined;
  currency?: string | undefined;
  pricingVersion?: string | undefined;
  accountingMode?: ContractAccountingMode | undefined;
  creator?: Creator | undefined;
}): SoftwareContract {
  const contractId = `contract_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const baseBranch = params.baseBranch ?? "main";

  const raw = {
    contract_id: contractId,
    schema_version: "1.1.3" as const,
    created_at: new Date().toISOString(),
    creator: params.creator ?? ("user" as const),
    lifecycle_state: "DRAFT" as const,
    intent: {
      title: params.title,
      description: params.description,
      acceptance_criteria: params.acceptanceCriteria,
      risk_level: params.riskLevel ?? ("MEDIUM" as const),
    },
    authorization: {
      git: {
        base_branch: baseBranch,
        task_branch: `task/${contractId}`,
        target_branch: params.targetBranch ?? baseBranch,
        use_worktree: true as const,
      },
      file_system_scope: {
        writable_paths: params.writablePaths,
        readonly_paths: params.readonlyPaths ?? [],
        strictly_forbidden_paths: params.strictlyForbiddenPaths ?? [
          ".env*",
          "**/.git/**",
          "package-lock.json",
          "pnpm-lock.yaml",
        ],
      },
      budget_limits: {
        max_file_modifications: params.maxFileModifications ?? 10,
        max_total_diff_lines: 2000,
        max_duration_seconds: params.maxDurationSeconds ?? 1800,
        max_verification_retries: params.maxVerificationRetries ?? 3,
      },
      cost_limits: {
        max_cost_minor_units: params.maxCostMinorUnits ?? 200_00, // 默认 200.00（最小货币单位）
        currency: params.currency ?? "CNY",
        pricing_version: params.pricingVersion ?? "unpriced-v0",
        accounting_mode: params.accountingMode ?? ("ESTIMATED" as const),
      },
      execution_permissions: {
        allowed_commands: ["test", "lint", "typecheck"],
        allowed_environment_variable_names: [],
        network_policy: "DENY" as const,
        dependency_changes_allowed: false,
      },
    },
    verification_spec: {
      commands:
        params.commands && params.commands.length > 0
          ? params.commands
          : [
              {
                alias: "test",
                executable: "npm",
                args: ["test"],
                expected_exit_code: 0,
                timeout_seconds: 60,
              },
            ],
    },
    approval: {
      status: "DRAFT" as const,
    },
  };

  return softwareContractSchema.parse(raw);
}

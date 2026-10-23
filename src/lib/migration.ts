import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_CONTRACT_SCHEMA_VERSION_V12,
  MANDATORY_GIT_FORBIDDEN_FLAGS,
  DEFAULT_ALLOWED_GIT_OPERATIONS,
  SOFTWARE_CONTRACT_SCHEMA_VERSION,
  softwareContractSchema,
  type SoftwareContractV13,
  type WorkerSpec,
} from "./contract.schema";
import { writeJsonAtomic } from "./state-machine";

/**
 * 存量合同迁移：v1.1.3 → v1.2.0（TASK-0.2b 第 7 项）。
 *
 * 三条硬约束（规范要求，缺一不可）：
 * 1. **必须备份**：迁移前把原文件原样复制到 `<repoRoot>/.stagent/migrations/<timestamp>/`；
 * 2. **禁止静默执行**：调用方必须显式传 `apply: true`，否则直接抛错；
 * 3. **标记需显式重批**：任何 `approval.status === "APPROVED"` 的非终态合同，
 *    迁移后一律回退为 `PENDING_APPROVAL / PENDING_REVIEW`，由用户重新确认
 *    `worker_spec` 与授权范围后才能继续执行。
 *
 * 为什么必须重新审批：v1.1.3 合同没有 `worker_spec`，因此无法证明其 Worker
 * 受 Gateway 强制管辖（§9.1 不变式）。迁移只能补一个占位声明，占位声明
 * 不构成「经测试的 Adapter 能力」，所以不能被视为已批准。
 */

export const LEGACY_SCHEMA_VERSION = "1.1.3" as const;

/** 迁移期占位 Worker 声明：明确标记为遗留，等待用户在重新审批时替换 */
export const LEGACY_WORKER_SPEC: WorkerSpec = {
  adapter_id: "stagent.legacy.v113",
  runtime_kind: "MANAGED_TOOL_CALLING",
  control_mode: "GATEWAY_ENFORCED",
  adapter_version: "1.1.3-migrated",
};

export const E_MIGRATION_REQUIRES_EXPLICIT_APPLY =
  "E_MIGRATION_REQUIRES_EXPLICIT_APPLY";

export class MigrationRequiresExplicitApplyError extends Error {
  readonly code = E_MIGRATION_REQUIRES_EXPLICIT_APPLY;
  constructor() {
    super(
      `[${E_MIGRATION_REQUIRES_EXPLICIT_APPLY}] Contract migration must be invoked ` +
        `with { apply: true }; silent migration is forbidden (TASK-0.2b)`,
    );
    this.name = "MigrationRequiresExplicitApplyError";
  }
}

export interface MigrationResult {
  contractId: string;
  from: typeof LEGACY_SCHEMA_VERSION;
  /**
   * v1.1.3 迁移的**终点是 v1.2.0**，不是当前签发版本。
   * v1.2.0 → v1.3.0 由 `migrateContractToV13` 承担，两段迁移职责分离：
   * 前者补齐 v1.2.0 的必填结构，后者补齐审批/授权凭证与版本号。
   */
  to: typeof LEGACY_CONTRACT_SCHEMA_VERSION_V12;
  /** 发生变更的字段路径，便于审计与测试断言 */
  changedFields: string[];
  /** 是否需要用户重新审批 */
  requiresReapproval: boolean;
  /** 备份文件路径（apply 模式下写入后填充） */
  backupPath?: string;
  contract: SoftwareContractV13;
}

type RawContract = Record<string, unknown>;

function isRecord(value: unknown): value is RawContract {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断一份原始 JSON 是否是需要迁移的 v1.1.3 合同 */
export function needsMigration(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return raw["schema_version"] === LEGACY_SCHEMA_VERSION;
}

/** 终态合同：已完成或已作废，不再参与执行，迁移不改变其生命周期 */
const TERMINAL_LIFECYCLE = ["MERGED", "ABORTED"] as const;

/**
 * 纯转换函数（不做任何 IO）：把 v1.1.3 合同对象转换为 v1.2.0 合同对象。
 * 转换后立即用 v1.2.0 Schema 校验，任何不合规都直接抛错而不是写入半成品。
 */
export function migrateV113Contract(raw: unknown): MigrationResult {
  if (!isRecord(raw)) {
    throw new Error("Contract migration failed: payload is not a JSON object");
  }
  if (raw["schema_version"] !== LEGACY_SCHEMA_VERSION) {
    throw new Error(
      `Contract migration failed: expected schema_version ${LEGACY_SCHEMA_VERSION}, ` +
        `got ${String(raw["schema_version"])}`,
    );
  }

  const changedFields: string[] = [];
  const migrated: RawContract = { ...raw };

  // 1. schema_version
  migrated["schema_version"] = LEGACY_CONTRACT_SCHEMA_VERSION_V12;
  changedFields.push("schema_version");

  // 2. contract_revision：v1.1.3 无此字段，历史合同固定落为 1
  migrated["contract_revision"] = 1;
  changedFields.push("contract_revision");

  // 3. creator：tech_lead → supervisor（ADR-007 术语归一）
  if (migrated["creator"] === "tech_lead") {
    migrated["creator"] = "supervisor";
    changedFields.push("creator");
  }

  // 4. worker_spec：v1.1.3 无此字段，补遗留占位声明
  migrated["worker_spec"] = LEGACY_WORKER_SPEC;
  changedFields.push("worker_spec");

  // 5. approval.approved_revision 缺省（未知的批准版本不能凭空断言）
  const approval: RawContract = isRecord(migrated["approval"])
    ? { ...migrated["approval"] }
    : { status: "DRAFT" };
  const wasApproved = approval["status"] === "APPROVED";
  const lifecycle = migrated["lifecycle_state"];
  const isTerminal = (TERMINAL_LIFECYCLE as readonly unknown[]).includes(
    lifecycle,
  );

  // 6. 非终态且已批准的合同 → 强制回退等待重新审批
  const requiresReapproval = wasApproved && !isTerminal;
  if (requiresReapproval) {
    migrated["lifecycle_state"] = "PENDING_APPROVAL";
    approval["status"] = "PENDING_REVIEW";
    delete approval["approved_by"];
    delete approval["approved_at"];
    delete approval["approved_revision"];
    changedFields.push(
      "lifecycle_state",
      "approval.status",
      "approval.approved_by",
      "approval.approved_at",
    );
  }

  // 7. 终态合同保留历史审批事实，但仍标注迁移来源（不伪造 approved_revision）
  if (isTerminal && wasApproved) {
    changedFields.push("worker_spec(migrated)");
  }

  migrated["approval"] = approval;

  const contract = softwareContractSchema.parse(migrated);

  return {
    contractId: contract.contract_id,
    from: LEGACY_SCHEMA_VERSION,
    to: LEGACY_CONTRACT_SCHEMA_VERSION_V12,
    changedFields,
    requiresReapproval,
    contract,
  };
}

export interface MigrateFileOptions {
  /** 必须显式为 true 才会落盘；否则抛 MigrationRequiresExplicitApplyError */
  readonly apply: boolean;
  /** 备份根目录，默认 `<repoRoot>/.stagent/migrations` */
  readonly backupRoot?: string;
}

/**
 * 迁移单个合同文件：检查 → 备份 → 原子写入。
 * 若文件已是 v1.2.0，返回 `null`（幂等，可重复调用）。
 */
export function migrateContractFile(
  filePath: string,
  options: MigrateFileOptions,
): MigrationResult | null {
  if (options.apply !== true) {
    throw new MigrationRequiresExplicitApplyError();
  }

  const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!needsMigration(raw)) return null;

  const result = migrateV113Contract(raw);

  // 备份：原样保留 v1.1.3 文件，目录按时间戳隔离，便于回滚
  // 默认落在 `<repoRoot>/.stagent/migrations/<timestamp>/`
  const backupRoot =
    options.backupRoot ??
    path.join(path.dirname(path.dirname(filePath)), "migrations");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, path.basename(filePath));
  fs.copyFileSync(filePath, backupPath);
  // 备份也必须落盘完成后再覆盖原文件
  const fd = fs.openSync(backupPath, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  writeJsonAtomic(filePath, result.contract);

  return { ...result, backupPath };
}

/** 批量迁移目录下所有合同文件；返回实际发生迁移的结果列表 */
export function migrateContractDirectory(
  contractsDir: string,
  options: MigrateFileOptions,
): MigrationResult[] {
  if (options.apply !== true) {
    throw new MigrationRequiresExplicitApplyError();
  }
  if (!fs.existsSync(contractsDir)) return [];

  const results: MigrationResult[] = [];
  for (const entry of fs.readdirSync(contractsDir)) {
    if (!entry.endsWith(".json")) continue;
    const migrated = migrateContractFile(
      path.join(contractsDir, entry),
      options,
    );
    if (migrated) results.push(migrated);
  }
  return results;
}

// --- v1.2.0 → v1.3.0（TASK-0.2c / 架构 §9.1） ---

export const E_MIGRATION_V13_UNSUPPORTED_VERSION =
  "E_MIGRATION_V13_UNSUPPORTED_VERSION";

/**
 * 执行态族白名单（卡片 §3）：这些历史状态说明合同**确实已经被批准过**，
 * 迁移时可以回填审批事实；其余状态一律不得回填为 APPROVED。
 */
export const V13_APPROVED_LEGACY_STATES = [
  "PREPARING",
  "EXECUTING",
  "VERIFYING",
  "PENDING_RESUME",
  "AUDITED",
  "MERGED",
] as const;

/** 迁移合成的历史审批人凭证（标明"不是我批的，是历史事实"） */
export const LEGACY_APPROVER = "user:legacy" as const;
/** 中止态迁移的驳回者凭证 */
export const ABORTED_REJECTER = "system:aborted" as const;

export interface MigrationResultV13 {
  contractId: string;
  from: typeof LEGACY_CONTRACT_SCHEMA_VERSION_V12;
  to: typeof SOFTWARE_CONTRACT_SCHEMA_VERSION;
  changedFields: string[];
  /** 迁移后是否仍需用户批准（DRAFT / PENDING_APPROVAL 为 true） */
  requiresReapproval: boolean;
  contract: SoftwareContractV13;
}

/** 判断一份原始 JSON 是否为待升级的 v1.2.0 合同 */
export function needsV13Migration(raw: unknown): boolean {
  return (
    isRecord(raw) &&
    raw["schema_version"] === LEGACY_CONTRACT_SCHEMA_VERSION_V12
  );
}

/**
 * v1.2.0 → v1.3.0 纯转换（不做任何 IO）：补齐 `authorization.git` 授权凭证、
 * 升级版本号，并按生命周期回填审批事实。
 *
 * **零静默授权**（本卡红线）：
 * - `DRAFT` → 保持 `DRAFT`；
 * - `PENDING_APPROVAL` → 保持 `PENDING_REVIEW`；
 * - 仅执行态族（白名单）回填 `APPROVED`，且审批人固定为 `user:legacy`，
 *   表示"这是历史既成事实"，不是本次迁移给出的新授权；
 * - `ABORTED` → `REJECTED`，驳回者 `system:aborted`，保留原有终止原因。
 *
 * 函数末尾有后置断言兜底：任何路径都不可能把未审批合同输出为 APPROVED。
 */
export function migrateContractToV13(raw: unknown): MigrationResultV13 {
  if (!isRecord(raw)) {
    throw new Error(
      "Contract v1.3 migration failed: payload is not a JSON object",
    );
  }

  const version = raw["schema_version"];
  if (version !== LEGACY_CONTRACT_SCHEMA_VERSION_V12) {
    throw new Error(
      `[${E_MIGRATION_V13_UNSUPPORTED_VERSION}] Contract v1.3 migration expects ` +
        `schema_version ${LEGACY_CONTRACT_SCHEMA_VERSION_V12}, got ${String(version)}` +
        (version === LEGACY_SCHEMA_VERSION
          ? " (run migrateV113Contract first)"
          : ""),
    );
  }

  const changedFields: string[] = [];
  const migrated: RawContract = { ...raw };

  // 1. 版本号
  migrated["schema_version"] = SOFTWARE_CONTRACT_SCHEMA_VERSION;
  changedFields.push("schema_version");

  // 2. authorization.git：补齐显式授权凭证，禁用参数只增不减
  const authorization: RawContract = isRecord(migrated["authorization"])
    ? { ...migrated["authorization"] }
    : {};
  const git: RawContract = isRecord(authorization["git"])
    ? { ...authorization["git"] }
    : {};

  if (!Array.isArray(git["allowed_operations"])) {
    git["allowed_operations"] = [...DEFAULT_ALLOWED_GIT_OPERATIONS];
    changedFields.push("authorization.git.allowed_operations");
  }

  const existingFlags = Array.isArray(git["forbidden_flags"])
    ? git["forbidden_flags"].filter(
        (flag): flag is string => typeof flag === "string",
      )
    : [];
  const mergedFlags = [...existingFlags];
  for (const flag of MANDATORY_GIT_FORBIDDEN_FLAGS) {
    if (!mergedFlags.includes(flag)) mergedFlags.push(flag);
  }
  if (
    !Array.isArray(git["forbidden_flags"]) ||
    mergedFlags.length !== existingFlags.length
  ) {
    changedFields.push("authorization.git.forbidden_flags");
  }
  git["forbidden_flags"] = mergedFlags;

  if (typeof git["enforce_clean_base"] !== "boolean") {
    git["enforce_clean_base"] = true;
    changedFields.push("authorization.git.enforce_clean_base");
  }

  if (
    typeof git["task_worktree_branch"] !== "string" &&
    typeof git["task_branch"] === "string"
  ) {
    git["task_worktree_branch"] = git["task_branch"];
    changedFields.push("authorization.git.task_worktree_branch");
  }

  authorization["git"] = git;
  migrated["authorization"] = authorization;

  // 3. approval：按生命周期回填，绝不对草稿/待审静默授权
  const approval: RawContract = isRecord(migrated["approval"])
    ? { ...migrated["approval"] }
    : {};
  const originalStatus = approval["status"];
  const lifecycle = migrated["lifecycle_state"];
  const createdAt =
    typeof migrated["created_at"] === "string"
      ? migrated["created_at"]
      : new Date().toISOString();
  const revision =
    typeof migrated["contract_revision"] === "number"
      ? migrated["contract_revision"]
      : 1;

  let requiresReapproval = false;

  if ((V13_APPROVED_LEGACY_STATES as readonly unknown[]).includes(lifecycle)) {
    approval["status"] = "APPROVED";
    if (typeof approval["approved_by"] !== "string") {
      approval["approved_by"] = LEGACY_APPROVER;
      changedFields.push("approval.approved_by");
    }
    if (typeof approval["approved_at"] !== "string") {
      // 用合同创建时间作为历史审批时间：迁移不得凭空造一个"刚刚批准"的时刻
      approval["approved_at"] = createdAt;
      changedFields.push("approval.approved_at");
    }
    if (typeof approval["approved_revision"] !== "number") {
      approval["approved_revision"] = revision;
      changedFields.push("approval.approved_revision");
    }
  } else if (lifecycle === "DRAFT") {
    approval["status"] = "DRAFT";
    requiresReapproval = true;
  } else if (lifecycle === "PENDING_APPROVAL") {
    approval["status"] = "PENDING_REVIEW";
    requiresReapproval = true;
  } else if (lifecycle === "ABORTED") {
    // §9.1.1 允许 ABORTED × {REJECTED, APPROVED}：已批准后安全中止的合同
    // 保留 APPROVED 才是历史事实，改写成 REJECTED 等于抹掉"批过又停"的经过。
    // 只有本就没有批准记录的终止，才回填驳回凭证。
    if (approval["status"] !== "APPROVED") {
      approval["status"] = "REJECTED";
      if (typeof approval["rejected_by"] !== "string") {
        approval["rejected_by"] = ABORTED_REJECTER;
        changedFields.push("approval.rejected_by");
      }
    }
  } else {
    throw new Error(
      `Contract v1.3 migration failed: unknown lifecycle_state ${String(lifecycle)}`,
    );
  }

  // 脏数据保护：被拉回草稿/待审的合同不得残留旧审批戳记，
  // 否则下游读到 approved_by 会误以为"这份合同已经批过"。
  if (
    (lifecycle === "DRAFT" || lifecycle === "PENDING_APPROVAL") &&
    originalStatus === "APPROVED"
  ) {
    for (const field of ["approved_by", "approved_at", "approved_revision"]) {
      delete approval[field];
      changedFields.push(`approval.${field}`);
    }
  }

  if (originalStatus !== approval["status"]) {
    changedFields.push("approval.status");
  }
  migrated["approval"] = approval;

  // 4. 迁移结果必须能通过 v1.3.0 Schema（不合规就抛错，不写半成品）
  const contract = softwareContractSchema.parse(migrated);

  // 5. 零静默授权后置断言：即使上面的分支未来被改错，也不会放行
  if (
    (contract.lifecycle_state === "DRAFT" ||
      contract.lifecycle_state === "PENDING_APPROVAL") &&
    contract.approval.status === "APPROVED"
  ) {
    throw new Error(
      "Contract v1.3 migration violated zero-silent-authorization: " +
        `lifecycle_state=${contract.lifecycle_state} must not become APPROVED`,
    );
  }

  return {
    contractId: contract.contract_id,
    from: LEGACY_CONTRACT_SCHEMA_VERSION_V12,
    to: SOFTWARE_CONTRACT_SCHEMA_VERSION,
    changedFields,
    requiresReapproval,
    contract,
  };
}

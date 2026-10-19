import fs from "node:fs";
import path from "node:path";
import {
  SOFTWARE_CONTRACT_SCHEMA_VERSION,
  softwareContractSchema,
  type SoftwareContractV12,
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
  to: typeof SOFTWARE_CONTRACT_SCHEMA_VERSION;
  /** 发生变更的字段路径，便于审计与测试断言 */
  changedFields: string[];
  /** 是否需要用户重新审批 */
  requiresReapproval: boolean;
  /** 备份文件路径（apply 模式下写入后填充） */
  backupPath?: string;
  contract: SoftwareContractV12;
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
  migrated["schema_version"] = SOFTWARE_CONTRACT_SCHEMA_VERSION;
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
    to: SOFTWARE_CONTRACT_SCHEMA_VERSION,
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

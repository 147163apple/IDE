import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { softwareContractSchema } from "../../src/lib/contract.schema";
import {
  E_MIGRATION_REQUIRES_EXPLICIT_APPLY,
  LEGACY_SCHEMA_VERSION,
  MigrationRequiresExplicitApplyError,
  migrateContractDirectory,
  migrateContractFile,
  migrateV113Contract,
  needsMigration,
} from "../../src/lib/migration";

/**
 * TASK-0.2b 第 7 项：存量 v1.1.3 合同迁移。
 * 判据：必须备份、禁止静默执行、已批准合同必须标记需重新审批。
 */

interface LegacyContract extends Record<string, unknown> {
  contract_id: string;
  schema_version: string;
  creator: string;
  lifecycle_state: string;
  approval: Record<string, unknown>;
}

function legacyContract(
  overrides: Partial<LegacyContract> = {},
): LegacyContract {
  const base: LegacyContract = {
    contract_id: "contract_legacy_001",
    schema_version: LEGACY_SCHEMA_VERSION,
    created_at: "2026-01-01T00:00:00.000Z",
    creator: "tech_lead",
    lifecycle_state: "PENDING_APPROVAL",
    intent: {
      title: "遗留任务",
      description: "v1.1.3 时代的合同",
      acceptance_criteria: ["通过"],
      risk_level: "LOW",
    },
    authorization: {
      git: {
        base_branch: "main",
        task_branch: "task/contract_legacy_001",
        target_branch: "main",
        use_worktree: true,
      },
      file_system_scope: {
        writable_paths: ["src/legacy.ts"],
        readonly_paths: [],
        strictly_forbidden_paths: [".env*"],
      },
      budget_limits: {
        max_file_modifications: 5,
        max_total_diff_lines: 100,
        max_duration_seconds: 600,
        max_verification_retries: 3,
      },
      cost_limits: {
        max_cost_minor_units: 100,
        currency: "CNY",
        pricing_version: "v0",
        accounting_mode: "ESTIMATED",
      },
      execution_permissions: {
        allowed_commands: ["test"],
        allowed_environment_variable_names: [],
        network_policy: "DENY",
        dependency_changes_allowed: false,
      },
    },
    verification_spec: {
      commands: [
        {
          alias: "test",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
    },
    approval: { status: "PENDING_REVIEW" },
  };
  return { ...base, ...overrides };
}

describe("needsMigration", () => {
  it("仅识别 schema_version=1.1.3 的对象", () => {
    expect(needsMigration(legacyContract())).toBe(true);
    expect(
      needsMigration({ ...legacyContract(), schema_version: "1.2.0" }),
    ).toBe(false);
    expect(needsMigration(null)).toBe(false);
    expect(needsMigration("1.1.3")).toBe(false);
    expect(needsMigration([])).toBe(false);
  });
});

describe("纯转换 migrateV113Contract", () => {
  it("补齐 schema_version / contract_revision / worker_spec", () => {
    const result = migrateV113Contract(legacyContract());
    expect(result.from).toBe("1.1.3");
    expect(result.to).toBe("1.2.0");
    expect(result.contract.schema_version).toBe("1.2.0");
    expect(result.contract.contract_revision).toBe(1);
    expect(result.contract.worker_spec.control_mode).toBe("GATEWAY_ENFORCED");
    expect(result.contract.worker_spec.adapter_id).toContain("legacy");
    expect(result.changedFields).toContain("worker_spec");
  });

  it("creator: tech_lead → supervisor", () => {
    const result = migrateV113Contract(legacyContract());
    expect(result.contract.creator).toBe("supervisor");
    expect(result.changedFields).toContain("creator");
  });

  it("转换结果必须通过 v1.2.0 Schema 校验", () => {
    const result = migrateV113Contract(legacyContract());
    expect(softwareContractSchema.safeParse(result.contract).success).toBe(
      true,
    );
  });

  it("已批准的中间态合同被回退为待审批，并要求重新审批", () => {
    const result = migrateV113Contract(
      legacyContract({
        lifecycle_state: "EXECUTING",
        approval: {
          status: "APPROVED",
          approved_by: "tina",
          approved_at: "2026-01-02T00:00:00.000Z",
        },
      }),
    );

    expect(result.requiresReapproval).toBe(true);
    expect(result.contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(result.contract.approval.status).toBe("PENDING_REVIEW");
    // 旧审批事实不得被带入新版本
    expect(result.contract.approval.approved_by).toBeUndefined();
    expect(result.contract.approval.approved_at).toBeUndefined();
    expect(result.contract.approval.approved_revision).toBeUndefined();
  });

  it("终态合同保留生命周期与历史审批事实", () => {
    const merged = migrateV113Contract(
      legacyContract({
        lifecycle_state: "MERGED",
        approval: {
          status: "APPROVED",
          approved_by: "tina",
          approved_at: "2026-01-02T00:00:00.000Z",
        },
      }),
    );
    expect(merged.requiresReapproval).toBe(false);
    expect(merged.contract.lifecycle_state).toBe("MERGED");
    expect(merged.contract.approval.approved_by).toBe("tina");
    // 不伪造 approved_revision
    expect(merged.contract.approval.approved_revision).toBeUndefined();
  });

  it("拒绝非 1.1.3 输入", () => {
    expect(() =>
      migrateV113Contract({ ...legacyContract(), schema_version: "1.2.0" }),
    ).toThrow();
    expect(() => migrateV113Contract(null)).toThrow();
  });
});

describe("文件级迁移：必须显式 apply 且必须备份", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      // 清理失败不得影响断言结论（沙箱可能拦截 TMPDIR 的 unlink）
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  /** 构造 <root>/.stagent/contracts 目录结构 */
  function fixtureRepo(): { root: string; contractsDir: string; file: string } {
    const tmpRoot = path.join(process.cwd(), ".tmp", "unit-migrate");
    fs.mkdirSync(tmpRoot, { recursive: true });
    const root = fs.mkdtempSync(path.join(tmpRoot, "repo-"));
    dirs.push(root);
    const contractsDir = path.join(root, ".stagent", "contracts");
    fs.mkdirSync(contractsDir, { recursive: true });
    const file = path.join(contractsDir, "contract_legacy_001.json");
    fs.writeFileSync(file, JSON.stringify(legacyContract(), null, 2));
    return { root, contractsDir, file };
  }

  it("未显式 apply 时抛错且不修改任何文件", () => {
    const { file } = fixtureRepo();
    const before = fs.readFileSync(file, "utf-8");

    expect(() => migrateContractFile(file, { apply: false })).toThrow(
      MigrationRequiresExplicitApplyError,
    );
    try {
      migrateContractFile(file, { apply: false });
    } catch (err) {
      expect((err as { code?: string }).code).toBe(
        E_MIGRATION_REQUIRES_EXPLICIT_APPLY,
      );
    }

    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });

  it("apply 时写入 .stagent/migrations/<timestamp>/ 备份，原文件被升级", () => {
    const { root, file } = fixtureRepo();
    const before = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      schema_version: string;
    };

    const result = migrateContractFile(file, { apply: true });
    expect(result).not.toBeNull();
    expect(result?.backupPath).toBeDefined();

    // 备份在 .stagent/migrations 下
    const migrationsRoot = path.join(root, ".stagent", "migrations");
    expect(result?.backupPath?.startsWith(migrationsRoot)).toBe(true);

    // 备份内容与迁移前完全一致
    const backupRaw = fs.readFileSync(result!.backupPath!, "utf-8");
    expect(JSON.parse(backupRaw)).toEqual(before);

    // 原文件已升级且通过 Schema
    const after = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      schema_version: string;
    };
    expect(after.schema_version).toBe("1.2.0");
    expect(softwareContractSchema.safeParse(after).success).toBe(true);
  });

  it("幂等：已是 1.2.0 的文件返回 null 且不产生备份", () => {
    const { root, file } = fixtureRepo();
    migrateContractFile(file, { apply: true });

    const again = migrateContractFile(file, { apply: true });
    expect(again).toBeNull();

    const migrationsRoot = path.join(root, ".stagent", "migrations");
    const entries = fs.existsSync(migrationsRoot)
      ? fs.readdirSync(migrationsRoot)
      : [];
    // 第二次不新增备份目录
    expect(entries).toHaveLength(1);
  });

  it("目录批量迁移只处理需要迁移的文件", () => {
    const { contractsDir, file } = fixtureRepo();
    // 再放一份已是 v1.2.0 的合同
    const upgraded = migrateV113Contract(legacyContract()).contract;
    fs.writeFileSync(
      path.join(contractsDir, "contract_new.json"),
      JSON.stringify(upgraded, null, 2),
    );

    const results = migrateContractDirectory(contractsDir, { apply: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.contractId).toBe("contract_legacy_001");
    expect(fs.existsSync(file)).toBe(true);
  });
});

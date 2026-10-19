import fs from "node:fs";
import path from "node:path";
import {
  softwareContractSchema,
  type LifecycleState,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { writeStateFile } from "../guard/state-store";

/**
 * 合同权威存储（Daemon 侧，规范 §1：Daemon 是合同状态唯一权威）。
 * 所有写入均经过 Schema 校验，保证 §9.1.1 双状态机不变式不被破坏。
 */
export class ContractStore {
  private readonly contractsDir: string;

  constructor(repoRoot: string) {
    this.contractsDir = path.join(
      path.resolve(repoRoot),
      ".stagent",
      "contracts",
    );
    fs.mkdirSync(this.contractsDir, { recursive: true });
  }

  get directory(): string {
    return this.contractsDir;
  }

  filePath(contractId: string): string {
    return path.join(this.contractsDir, `${contractId}.json`);
  }

  save(contract: SoftwareContract): SoftwareContract {
    const validated = softwareContractSchema.parse(contract);
    writeStateFile(this.filePath(validated.contract_id), validated);
    return validated;
  }

  get(contractId: string): SoftwareContract | null {
    const file = this.filePath(contractId);
    if (!fs.existsSync(file)) return null;
    try {
      return softwareContractSchema.parse(
        JSON.parse(fs.readFileSync(file, "utf-8")),
      );
    } catch {
      return null;
    }
  }

  list(): SoftwareContract[] {
    if (!fs.existsSync(this.contractsDir)) return [];
    const contracts: SoftwareContract[] = [];
    for (const entry of fs.readdirSync(this.contractsDir)) {
      if (!entry.endsWith(".json")) continue;
      const parsed = this.get(entry.slice(0, -".json".length));
      if (parsed) contracts.push(parsed);
    }
    return contracts.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /**
   * 原子状态迁移：同时更新 lifecycle_state 与 approval.status，
   * 由 Schema 兜底拒绝非法组合（规范 §9.1.1「避免只更新其中一个字段」）。
   */
  transition(params: {
    contractId: string;
    lifecycleState: LifecycleState;
    approvalStatus?: SoftwareContract["approval"]["status"];
    approvedBy?: string;
    approvedAt?: string;
    rejectionReason?: string;
  }): SoftwareContract {
    const current = this.get(params.contractId);
    if (!current) {
      throw new Error(`Contract not found: ${params.contractId}`);
    }

    const approval = {
      ...current.approval,
      ...(params.approvalStatus === undefined
        ? {}
        : { status: params.approvalStatus }),
      ...(params.approvedBy === undefined
        ? {}
        : { approved_by: params.approvedBy }),
      ...(params.approvedAt === undefined
        ? {}
        : { approved_at: params.approvedAt }),
      ...(params.rejectionReason === undefined
        ? {}
        : { rejection_reason: params.rejectionReason }),
    };

    return this.save({
      ...current,
      lifecycle_state: params.lifecycleState,
      approval,
    });
  }
}

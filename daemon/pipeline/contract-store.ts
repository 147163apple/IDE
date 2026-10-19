import fs from "node:fs";
import path from "node:path";
import {
  softwareContractSchema,
  type ApprovalStatus,
  type LifecycleState,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  LIFECYCLE_TRANSITIONS,
  validateTransition,
  writeJsonAtomic,
  type ContractStatePair,
} from "../../src/lib/state-machine";

/**
 * 合同权威存储（Daemon 侧，规范 §1：Daemon 是合同状态唯一权威）。
 * 所有写入均经过 Schema 校验，保证 §9.1.1 双状态机不变式不被破坏。
 *
 * TASK-0.2b：
 *  - 落盘改为 `writeTemp + fsync + rename`（writeJsonAtomic），避免半截 JSON 与掉电丢更新
 *  - 状态迁移前调用 `validateTransition`（4 维：from 组合 → to 组合），
 *    拒绝非法跃迁边与「边合法但落点组合非法」的情形
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
    writeJsonAtomic(this.filePath(validated.contract_id), validated);
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
   * 迁移前后均按 §9.1.1 校验（§9.1.1「避免只更新其中一个字段」）。
   *
   * 非法跃迁抛出 `IllegalContractTransitionError`，其 `code` 为
   * `E_INVALID_STATE_TRANSITION`，与编排层既有约定一致。
   */
  transition(params: {
    contractId: string;
    lifecycleState: LifecycleState;
    approvalStatus?: ApprovalStatus;
    approvedBy?: string;
    approvedAt?: string;
    approvedRevision?: number;
    rejectionReason?: string;
  }): SoftwareContract {
    const current = this.get(params.contractId);
    if (!current) {
      throw new Error(`Contract not found: ${params.contractId}`);
    }

    const nextApprovalStatus = params.approvalStatus ?? current.approval.status;

    const from: ContractStatePair = {
      lifecycle_state: current.lifecycle_state,
      approval_status: current.approval.status,
    };
    const to: ContractStatePair = {
      lifecycle_state: params.lifecycleState,
      approval_status: nextApprovalStatus,
    };

    const verdict = validateTransition(from, to);
    if (!verdict.ok) {
      throw new IllegalContractTransitionError(
        current.lifecycle_state,
        LIFECYCLE_TRANSITIONS[current.lifecycle_state],
        `${params.lifecycleState} (${verdict.message})`,
      );
    }

    const approval = {
      ...current.approval,
      status: nextApprovalStatus,
      ...(params.approvedBy === undefined
        ? {}
        : { approved_by: params.approvedBy }),
      ...(params.approvedAt === undefined
        ? {}
        : { approved_at: params.approvedAt }),
      // 审批版本绑定：记录被批准时的 contract_revision（防 TOCTOU）
      ...(params.approvedRevision === undefined
        ? {}
        : { approved_revision: params.approvedRevision }),
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

export const E_INVALID_STATE_TRANSITION = "E_INVALID_STATE_TRANSITION";

/**
 * 合同状态跃迁非法。
 * 与 `daemon/core/contract-mutex.ts` 的同名语义错误保持相同 `code`，
 * 使上层统一按 `err.code` 判定，而不必区分抛错模块。
 */
export class IllegalContractTransitionError extends Error {
  readonly code = E_INVALID_STATE_TRANSITION;
  readonly current: string;
  readonly expected: readonly string[];

  constructor(current: string, expected: readonly string[], detail: string) {
    super(
      `[${E_INVALID_STATE_TRANSITION}] Illegal transition from ${current}: ${detail}`,
    );
    this.name = "IllegalContractTransitionError";
    this.current = current;
    this.expected = expected;
  }
}

import fs from "node:fs";
import path from "node:path";
import type {
  ApprovalStatus,
  LifecycleState,
} from "../../src/lib/contract.schema";
import type { PresentationState } from "../../src/lib/state/presentation-state";
import { writeJsonAtomic } from "../../src/lib/state-machine";

/**
 * TASK-D.3（续）：`presentation_state` 的持久化快照。
 *
 * 为什么单独一份文件而不是写回合同：合同是**授权契约**，`presentation_state`
 * 是**展示投影**。把投影写进合同会让"投影变化"被误读为"合同变更"，
 * 进而触发 contract_revision 递增与重新审批——那是灾难性的语义污染。
 * 因此单独维护 `.stagent/state.json`，与 `.stagent/contracts/` 并列。
 *
 * 三条硬约束：
 * 1. 原子写：复用 `writeJsonAtomic`（tmp + fsync + rename），崩溃不留半截 JSON；
 * 2. 可恢复：文件缺失或损坏时返回空快照而不是抛错——Daemon 必须能起来；
 * 3. 可追溯：每条记录带 `lifecycle_state` / `approval_status` / `updated_at`，
 *    便于断线重连后前端直接渲染，也便于事后核对投影是否与合同一致。
 */

export const PRESENTATION_STATE_FILE_VERSION = 1 as const;

export interface PersistedPresentationRecord {
  readonly contract_id: string;
  readonly presentation_state: PresentationState;
  readonly lifecycle_state: LifecycleState;
  readonly approval_status: ApprovalStatus;
  /** 面向非技术用户的白话提示（STATE_CHANGED 与快照共用同一文案） */
  readonly message: string;
  readonly updated_at: string;
}

export interface PresentationStateSnapshot {
  readonly version: typeof PRESENTATION_STATE_FILE_VERSION;
  /** 最近一次写入时间；空快照为 null */
  readonly updated_at: string | null;
  readonly contracts: Readonly<Record<string, PersistedPresentationRecord>>;
}

export const EMPTY_PRESENTATION_SNAPSHOT: PresentationStateSnapshot = {
  version: PRESENTATION_STATE_FILE_VERSION,
  updated_at: null,
  contracts: {},
};

/** `<repoRoot>/.stagent/state.json` */
export function presentationStatePath(repoRoot: string): string {
  return path.join(repoRoot, ".stagent", "state.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPersistedRecord(
  value: unknown,
): value is PersistedPresentationRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value["contract_id"] === "string" &&
    typeof value["presentation_state"] === "string" &&
    typeof value["lifecycle_state"] === "string" &&
    typeof value["approval_status"] === "string" &&
    typeof value["message"] === "string" &&
    typeof value["updated_at"] === "string"
  );
}

/**
 * 读取持久化快照。
 *
 * 容错策略：文件不存在、JSON 损坏、结构不符——一律返回空快照。
 * 理由：这是"展示层缓存"，不是授权事实；为了它让 Daemon 起不来是本末倒置。
 * 损坏的文件不会被删除，便于人工排查。
 */
export function loadPresentationSnapshot(
  repoRoot: string,
): PresentationStateSnapshot {
  const filePath = presentationStatePath(repoRoot);
  if (!fs.existsSync(filePath)) return EMPTY_PRESENTATION_SNAPSHOT;

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed["contracts"])) {
      return EMPTY_PRESENTATION_SNAPSHOT;
    }

    const contracts: Record<string, PersistedPresentationRecord> = {};
    for (const [contractId, raw] of Object.entries(parsed["contracts"])) {
      if (isPersistedRecord(raw) && raw.contract_id === contractId) {
        contracts[contractId] = raw;
      }
    }

    return {
      version: PRESENTATION_STATE_FILE_VERSION,
      updated_at:
        typeof parsed["updated_at"] === "string" ? parsed["updated_at"] : null,
      contracts,
    };
  } catch {
    return EMPTY_PRESENTATION_SNAPSHOT;
  }
}

/** 读取单个合同的持久化投影（重连/重启后的还原入口） */
export function getPersistedPresentation(
  repoRoot: string,
  contractId: string,
): PersistedPresentationRecord | null {
  return loadPresentationSnapshot(repoRoot).contracts[contractId] ?? null;
}

/**
 * 写入/更新一条投影记录（读-合并-原子写）。
 *
 * 同步写：调用方是状态流转路径，必须保证"广播前已落盘"，
 * 否则前端重连时读到的快照会落后于最后一次广播。
 */
export function persistPresentation(
  repoRoot: string,
  record: PersistedPresentationRecord,
): PresentationStateSnapshot {
  const current = loadPresentationSnapshot(repoRoot);
  const next: PresentationStateSnapshot = {
    version: PRESENTATION_STATE_FILE_VERSION,
    updated_at: record.updated_at,
    contracts: { ...current.contracts, [record.contract_id]: record },
  };
  writeJsonAtomic(presentationStatePath(repoRoot), next);
  return next;
}

/** 批量覆盖（用于启动时按合同全量重建，或测试准备） */
export function replacePresentationSnapshot(
  repoRoot: string,
  contracts: Readonly<Record<string, PersistedPresentationRecord>>,
): PresentationStateSnapshot {
  const next: PresentationStateSnapshot = {
    version: PRESENTATION_STATE_FILE_VERSION,
    updated_at: new Date().toISOString(),
    contracts: { ...contracts },
  };
  writeJsonAtomic(presentationStatePath(repoRoot), next);
  return next;
}

/** 移除某合同的投影（合同被彻底删除时使用，避免快照无限膨胀） */
export function forgetPersistedPresentation(
  repoRoot: string,
  contractId: string,
): PresentationStateSnapshot {
  const current = loadPresentationSnapshot(repoRoot);
  if (!(contractId in current.contracts)) return current;

  const contracts = { ...current.contracts };
  delete contracts[contractId];
  const next: PresentationStateSnapshot = {
    version: PRESENTATION_STATE_FILE_VERSION,
    updated_at: new Date().toISOString(),
    contracts,
  };
  writeJsonAtomic(presentationStatePath(repoRoot), next);
  return next;
}

/**
 * TASK-C.15c / EO-05：签署期白名单 GC + MERGED→DELIVERED 事务硬化。
 *
 * 签署期：仅清当前 contract 白名单临时缓存；禁止清 drafts / 活跃 Demo / 已校验收快照。
 * 归档期：任一步失败 → 停 MERGED，严禁标 DELIVERED。
 */
import fs from "node:fs";
import path from "node:path";
import {
  archiveContractRecords,
  assertRecordsReadyForDelivered,
  type RecordsArchiveResult,
} from "./records-archive";
import {
  sealWorktree,
  releaseWorktreeLock,
  type SealResult,
} from "../guard/worktree-seal";

/** 允许 GC 的相对路径后缀（相对 .stagent/） */
export const SIGN_GC_WHITELIST_SUFFIXES = [
  ".cache/",
  "tmp/",
  "tmp-diff/",
] as const;

export interface SignGcResult {
  ok: boolean;
  removed: string[];
  skipped: string[];
  error?: string;
}

/**
 * 签署期 GC：只删白名单临时碎片；黑名单路径一律跳过。
 */
export function runSignWhitelistGc(input: {
  repoRoot: string;
  contract_id: string;
  prototype_id?: string | null;
}): SignGcResult {
  const removed: string[] = [];
  const skipped: string[] = [];
  const root = path.resolve(input.repoRoot);
  const stagent = path.join(root, ".stagent");

  // 黑名单：drafts、records、活跃 demo 根、contract snapshot
  const blacklistPrefixes = [
    path.join(stagent, "drafts"),
    path.join(stagent, "records"),
    path.join(stagent, "worktrees"),
  ];
  if (input.prototype_id) {
    blacklistPrefixes.push(
      path.join(stagent, "prototypes", input.prototype_id),
    );
  }

  const candidates: string[] = [];
  // prototypes/{id}/.cache
  if (input.prototype_id) {
    candidates.push(
      path.join(stagent, "prototypes", input.prototype_id, ".cache"),
    );
  }
  // 合同级临时 diff
  candidates.push(
    path.join(stagent, "tmp", input.contract_id),
    path.join(stagent, "tmp-diff", input.contract_id),
  );

  try {
    for (const target of candidates) {
      const resolved = path.resolve(target);
      if (!resolved.startsWith(stagent + path.sep) && resolved !== stagent) {
        skipped.push(resolved);
        continue;
      }
      // 不得落在黑名单「内容根」本身（但 .cache 子目录允许）
      const isBlacklistedRoot = blacklistPrefixes.some(
        (b) => resolved === b || resolved === path.resolve(b),
      );
      if (isBlacklistedRoot) {
        skipped.push(resolved);
        continue;
      }
      // 必须匹配白名单特征：.cache / tmp / tmp-diff
      const rel = resolved.slice(stagent.length).split(path.sep).join("/");
      const allowed =
        rel.includes(".cache") ||
        rel.includes("/tmp/") ||
        rel.includes("/tmp-diff/") ||
        rel.endsWith("/tmp") ||
        rel.endsWith("/tmp-diff");
      if (!allowed) {
        skipped.push(resolved);
        continue;
      }
      if (fs.existsSync(resolved)) {
        fs.rmSync(resolved, { recursive: true, force: true });
        removed.push(resolved);
      }
    }
    return { ok: true, removed, skipped };
  } catch (err) {
    return {
      ok: false,
      removed,
      skipped,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type MergedToDeliveredStatus =
  | { status: "DELIVERED"; archive: RecordsArchiveResult; seal: SealResult }
  | {
      status: "MERGED";
      reason: string;
      archive?: RecordsArchiveResult;
      seal?: SealResult;
    };

/**
 * MERGED → DELIVERED 事务：归档 → seal worktree → 校验 manifest。
 * 任一步失败返回 status:"MERGED"（停住），绝不返回 DELIVERED。
 */
export function transitionMergedToDelivered(input: {
  repoRoot: string;
  contract_id: string;
  prototype_id?: string | null;
  snapshot?: unknown;
  assertion_ids?: readonly string[];
  commit_sha?: string | null;
  events?: unknown[];
  /** 测试可注入归档失败 */
  archiveFn?: typeof archiveContractRecords;
}): MergedToDeliveredStatus {
  const archiveFn = input.archiveFn ?? archiveContractRecords;
  const archive = archiveFn({
    repoRoot: input.repoRoot,
    contract_id: input.contract_id,
    snapshot: input.snapshot ?? { contract_id: input.contract_id },
    // exactOptionalPropertyTypes：可选字段省略而非传 undefined，
    // 让 archiveContractRecords 的「未提供」语义保持可区分
    ...(input.prototype_id !== undefined
      ? { prototype_id: input.prototype_id }
      : {}),
    ...(input.assertion_ids !== undefined
      ? { assertion_ids: input.assertion_ids }
      : {}),
    ...(input.commit_sha !== undefined ? { commit_sha: input.commit_sha } : {}),
    ...(input.events !== undefined ? { events: input.events } : {}),
  });
  if (!archive.ok) {
    return {
      status: "MERGED",
      reason: archive.error ?? "records 归档失败",
      archive,
    };
  }

  let seal: SealResult;
  try {
    seal = sealWorktree({
      repoRoot: input.repoRoot,
      contract_id: input.contract_id,
    });
  } catch (err) {
    return {
      status: "MERGED",
      reason: err instanceof Error ? err.message : String(err),
      archive,
    };
  }
  if (!seal.ok || !seal.sealed) {
    return {
      status: "MERGED",
      reason: seal.error ?? "worktree seal 失败",
      archive,
      seal,
    };
  }

  try {
    assertRecordsReadyForDelivered(input.repoRoot, input.contract_id);
  } catch (err) {
    return {
      status: "MERGED",
      reason: err instanceof Error ? err.message : String(err),
      archive,
      seal,
    };
  }

  // seal 成功后才释放排他锁（EO-09）
  releaseWorktreeLock(input.repoRoot, input.contract_id);

  return { status: "DELIVERED", archive, seal };
}

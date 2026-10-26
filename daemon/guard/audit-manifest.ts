/**
 * TASK-C.12e / EO-03·04·05：无 Git 审计侧车 audit-manifest.json。
 * 经脱敏管道后落盘；无 remote / 无 Trailer 仍可生成；与 D.2 Trailer 并存不拆台。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { redactDeep } from "../../src/lib/ipc/redaction";

export const RECORDS_ROOT = ".stagent/records" as const;
export const AUDIT_MANIFEST_FILENAME = "audit-manifest.json" as const;

export interface AuditManifestInput {
  contract_id: string;
  /** 任意快照对象（合同摘要 / Demo meta / 断言等）；会先脱敏 */
  snapshot: unknown;
  /** 审计事件列表（同样脱敏） */
  events?: unknown[];
  /** 可选 commit SHA；无 Git 时可省略 */
  commit_sha?: string | null;
  /** UUIDv5 等断言标识 */
  assertion_ids?: readonly string[];
  now?: () => Date;
}

export interface AuditManifest {
  schema_version: "1.0.0";
  contract_id: string;
  created_at: string;
  snapshot_hash: string;
  events_hash: string;
  assertion_ids: string[];
  commit_sha: string | null;
  /** 明示：不依赖 Git remote */
  git_required: false;
  note: string;
}

export function recordsDir(repoRoot: string, contractId: string): string {
  return path.join(
    path.resolve(repoRoot),
    RECORDS_ROOT,
    sanitizeContractId(contractId),
  );
}

export function auditManifestPath(repoRoot: string, contractId: string): string {
  return path.join(recordsDir(repoRoot, contractId), AUDIT_MANIFEST_FILENAME);
}

function sanitizeContractId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  return cleaned || "unknown-contract";
}

function sha256Stable(value: unknown): string {
  const json = JSON.stringify(value, (_k, v) => v);
  return createHash("sha256").update(json ?? "null").digest("hex");
}

/**
 * 写入 audit-manifest.json。无 Git 环境不抛错。
 * 返回清单对象；调用方可用其字段做断言。
 */
export function writeAuditManifest(
  repoRoot: string,
  input: AuditManifestInput,
): AuditManifest {
  const now = input.now ?? (() => new Date());
  const redactedSnapshot = redactDeep(input.snapshot).value;
  const redactedEvents = redactDeep(input.events ?? []).value;

  const manifest: AuditManifest = {
    schema_version: "1.0.0",
    contract_id: input.contract_id,
    created_at: now().toISOString(),
    snapshot_hash: sha256Stable(redactedSnapshot),
    events_hash: sha256Stable(redactedEvents),
    assertion_ids: [...(input.assertion_ids ?? [])],
    commit_sha: input.commit_sha ?? null,
    git_required: false,
    note: "Local audit sidecar; independent of Git Trailer / remote (EO-03/04/05)",
  };

  // 二次保险：清单自身不得含明文 token/secret 键值
  const safe = redactDeep(manifest).value as AuditManifest;

  const dir = recordsDir(repoRoot, input.contract_id);
  fs.mkdirSync(dir, { recursive: true });
  const target = auditManifestPath(repoRoot, input.contract_id);
  fs.writeFileSync(target, JSON.stringify(safe, null, 2), "utf8");
  return safe;
}

export function readAuditManifest(
  repoRoot: string,
  contractId: string,
): AuditManifest | null {
  const target = auditManifestPath(repoRoot, contractId);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, "utf8")) as AuditManifest;
  } catch {
    return null;
  }
}

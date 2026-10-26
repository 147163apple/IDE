/**
 * TASK-C.15d / EO-09：Worktree 路径稳定封存（禁止裸 mv）。
 * 在 `.stagent/worktrees/{contract_id}/.stagent_manifest.json` 标记 sealed。
 */
import fs from "node:fs";
import path from "node:path";

export const WORKTREE_MANIFEST = ".stagent_manifest.json" as const;

export interface WorktreeManifest {
  schema_version: "1.0.0";
  contract_id: string;
  sealed: boolean;
  sealed_at: string | null;
  lock_held: boolean;
  note: string;
}

export interface SealResult {
  ok: boolean;
  sealed: boolean;
  manifest_path: string;
  error?: string;
}

function worktreeDir(repoRoot: string, contractId: string): string {
  return path.join(
    path.resolve(repoRoot),
    ".stagent",
    "worktrees",
    contractId.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 128) || "unknown",
  );
}

export function worktreeManifestPath(
  repoRoot: string,
  contractId: string,
): string {
  return path.join(worktreeDir(repoRoot, contractId), WORKTREE_MANIFEST);
}

export function readWorktreeManifest(
  repoRoot: string,
  contractId: string,
): WorktreeManifest | null {
  const p = worktreeManifestPath(repoRoot, contractId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as WorktreeManifest;
  } catch {
    return null;
  }
}

/** 取得排他锁标记（封存前） */
export function acquireWorktreeLock(
  repoRoot: string,
  contractId: string,
): WorktreeManifest {
  const dir = worktreeDir(repoRoot, contractId);
  fs.mkdirSync(dir, { recursive: true });
  const manifest: WorktreeManifest = {
    schema_version: "1.0.0",
    contract_id: contractId,
    sealed: false,
    sealed_at: null,
    lock_held: true,
    note: "EO-09 lock acquired; path stable (no bare mv)",
  };
  fs.writeFileSync(
    worktreeManifestPath(repoRoot, contractId),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  return manifest;
}

/**
 * 封存：路径不变，仅写 sealed:true。
 * 失败则保持 lock_held，绝不释放。
 */
export function sealWorktree(input: {
  repoRoot: string;
  contract_id: string;
  now?: () => Date;
}): SealResult {
  const dir = worktreeDir(input.repoRoot, input.contract_id);
  const manifestPath = worktreeManifestPath(
    input.repoRoot,
    input.contract_id,
  );
  try {
    fs.mkdirSync(dir, { recursive: true });
    const now = (input.now ?? (() => new Date()))().toISOString();
    const prev = readWorktreeManifest(input.repoRoot, input.contract_id);
    const manifest: WorktreeManifest = {
      schema_version: "1.0.0",
      contract_id: input.contract_id,
      sealed: true,
      sealed_at: now,
      lock_held: true, // 仍持锁直至 releaseWorktreeLock
      note: prev?.note ?? "EO-09 sealed in place",
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    // 校验回读
    const check = readWorktreeManifest(input.repoRoot, input.contract_id);
    if (!check?.sealed) {
      return {
        ok: false,
        sealed: false,
        manifest_path: manifestPath,
        error: "seal 回读校验失败，锁未释放",
      };
    }
    return { ok: true, sealed: true, manifest_path: manifestPath };
  } catch (err) {
    return {
      ok: false,
      sealed: false,
      manifest_path: manifestPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 仅在 sealed 成功后释放锁。未封存调用则拒绝。
 */
export function releaseWorktreeLock(
  repoRoot: string,
  contractId: string,
): boolean {
  const prev = readWorktreeManifest(repoRoot, contractId);
  if (!prev?.sealed) {
    return false;
  }
  const next: WorktreeManifest = {
    ...prev,
    lock_held: false,
    note: "EO-09 lock released after successful seal",
  };
  fs.writeFileSync(
    worktreeManifestPath(repoRoot, contractId),
    JSON.stringify(next, null, 2),
    "utf8",
  );
  return true;
}

export function isWorktreeSealed(
  repoRoot: string,
  contractId: string,
): boolean {
  return readWorktreeManifest(repoRoot, contractId)?.sealed === true;
}

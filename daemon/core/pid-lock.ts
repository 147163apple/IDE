import fs from "node:fs";
import path from "node:path";

export interface PidLockInfo {
  pid: number;
  port: number;
  repoRoot: string;
  startedAt: string;
  version: string;
}

export class PidLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PidLockError";
  }
}

/**
 * Get the standardized path to the daemon PID file.
 */
export function getPidLockPath(repoRoot: string): string {
  return path.resolve(repoRoot, ".stagent", "stagent.pid");
}

/**
 * Check whether a process with the given PID is currently alive on the system.
 */
export function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "EPERM"
    ) {
      // Process exists but current process lacks permission to signal it
      return true;
    }
    return false;
  }
}

/**
 * Read and parse the PID lock file for the given repository.
 * Returns null if file does not exist, cannot be read, or contains invalid data.
 */
export function readPidLock(repoRoot: string): PidLockInfo | null {
  const lockPath = getPidLockPath(repoRoot);
  if (!fs.existsSync(lockPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.pid === "number" &&
      typeof parsed.port === "number" &&
      typeof parsed.repoRoot === "string"
    ) {
      return {
        pid: parsed.pid,
        port: parsed.port,
        repoRoot: parsed.repoRoot,
        startedAt:
          typeof parsed.startedAt === "string"
            ? parsed.startedAt
            : new Date().toISOString(),
        version: typeof parsed.version === "string" ? parsed.version : "0.1.0",
      };
    }
  } catch {
    // Malformed lock file
  }
  return null;
}

/**
 * Acquire a PID lock for this repository and port.
 * If a running daemon is detected, throws PidLockError.
 * Stale or dead locks are automatically reclaimed.
 */
export async function acquirePidLock(
  repoRoot: string,
  port: number,
  options: { version?: string; force?: boolean } = {},
): Promise<PidLockInfo> {
  const resolvedRoot = path.resolve(repoRoot);
  const lockDir = path.resolve(resolvedRoot, ".stagent");
  const lockPath = getPidLockPath(resolvedRoot);

  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  const existing = readPidLock(resolvedRoot);
  if (existing) {
    const alive = isProcessRunning(existing.pid);
    if (alive && existing.pid !== process.pid && !options.force) {
      throw new PidLockError(
        `Stagent daemon is already running (PID: ${existing.pid}, Port: ${existing.port}, Repo: ${existing.repoRoot}). Stop the existing instance before starting a new one.`,
      );
    }

    // If lock is stale (process dead) or force flag set, clean up previous lock file
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore unlink errors
    }
  }

  const lockInfo: PidLockInfo = {
    pid: process.pid,
    port,
    repoRoot: resolvedRoot,
    startedAt: new Date().toISOString(),
    version: options.version ?? "0.1.0",
  };

  // Write atomically via temporary file to prevent partial reads
  const tmpPath = `${lockPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(lockInfo, null, 2), "utf-8");
  fs.renameSync(tmpPath, lockPath);

  return lockInfo;
}

/**
 * Release the PID lock if owned by the current process, or unconditionally if forced.
 */
export async function releasePidLock(
  repoRoot: string,
  force: boolean = false,
): Promise<boolean> {
  const lockPath = getPidLockPath(repoRoot);
  if (!fs.existsSync(lockPath)) {
    return true;
  }

  const existing = readPidLock(repoRoot);
  if (!existing || existing.pid === process.pid || force) {
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch {
      return false;
    }
  }

  // Not owned by current process and not forced
  return false;
}

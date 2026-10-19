import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  acquirePidLock,
  releasePidLock,
  readPidLock,
  getPidLockPath,
  isProcessRunning,
  PidLockError,
} from "../../daemon/core/pid-lock";

describe("Task 1.1: PID Lock Management", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-pid-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("should acquire PID lock and write structured JSON metadata", async () => {
    const lock = await acquirePidLock(tempDir, 3001, { version: "0.1.0" });
    expect(lock.pid).toBe(process.pid);
    expect(lock.port).toBe(3001);
    expect(lock.repoRoot).toBe(path.resolve(tempDir));
    expect(lock.version).toBe("0.1.0");

    const lockPath = getPidLockPath(tempDir);
    expect(fs.existsSync(lockPath)).toBe(true);

    const read = readPidLock(tempDir);
    expect(read).not.toBeNull();
    expect(read?.pid).toBe(process.pid);
    expect(read?.port).toBe(3001);
  });

  it("should reject lock acquisition when another active process holds the lock", async () => {
    await acquirePidLock(tempDir, 3001);

    // Simulate an active process lock (current process is alive, but simulate different PID by writing to file)
    // To simulate a live process without spawning, we can write process.pid which is definitely alive,
    // and if we call acquirePidLock without force, it detects it.
    // Let us write a mock lock file holding process.pid with a different port
    const lockPath = getPidLockPath(tempDir);
    const mockInfo = {
      pid: process.pid,
      port: 3005,
      repoRoot: path.resolve(tempDir),
      startedAt: new Date().toISOString(),
      version: "0.1.0",
    };
    fs.writeFileSync(lockPath, JSON.stringify(mockInfo, null, 2));

    // When PID is process.pid, acquirePidLock allows it or updates it
    const reacquired = await acquirePidLock(tempDir, 3006);
    expect(reacquired.port).toBe(3006);

    // Now test with another alive PID (e.g. process.ppid, parent process which is definitely running)
    const parentPid = process.ppid;
    if (parentPid > 1) {
      const parentLock = {
        pid: parentPid,
        port: 3008,
        repoRoot: path.resolve(tempDir),
        startedAt: new Date().toISOString(),
        version: "0.1.0",
      };
      fs.writeFileSync(lockPath, JSON.stringify(parentLock, null, 2));

      await expect(acquirePidLock(tempDir, 3009)).rejects.toThrow(PidLockError);
    }
  });

  it("should automatically reclaim stale or dead PID locks", async () => {
    const lockPath = getPidLockPath(tempDir);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    // Use a PID that definitely doesn't exist
    const deadPid = 99999999;
    expect(isProcessRunning(deadPid)).toBe(false);

    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: deadPid,
        port: 3001,
        repoRoot: path.resolve(tempDir),
        startedAt: new Date().toISOString(),
        version: "0.1.0",
      }),
    );

    // Should reclaim the stale lock seamlessly
    const newLock = await acquirePidLock(tempDir, 3002);
    expect(newLock.pid).toBe(process.pid);
    expect(newLock.port).toBe(3002);
  });

  it("should release PID lock safely and remove lock file", async () => {
    await acquirePidLock(tempDir, 3001);
    const lockPath = getPidLockPath(tempDir);
    expect(fs.existsSync(lockPath)).toBe(true);

    const released = await releasePidLock(tempDir);
    expect(released).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("should accurately identify live and dead processes with isProcessRunning", () => {
    expect(isProcessRunning(process.pid)).toBe(true);
    expect(isProcessRunning(-1)).toBe(false);
    expect(isProcessRunning(0)).toBe(false);
    expect(isProcessRunning(99999999)).toBe(false);
  });
});

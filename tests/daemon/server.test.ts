import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {
  createDaemon,
  StagentDaemon,
  DaemonStatusResponse,
} from "../../daemon/server";
import { readPidLock } from "../../daemon/core/pid-lock";

function httpGet<T = Record<string, unknown>>(
  url: string,
): Promise<{ statusCode: number; body: T }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: JSON.parse(raw) as T,
            });
          } catch {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: raw as unknown as T,
            });
          }
        });
      })
      .on("error", reject);
  });
}

function httpPost<T = Record<string, unknown>>(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: T }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: "POST",
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: JSON.parse(raw) as T,
            });
          } catch {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: raw as unknown as T,
            });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Task 1.1: Stagent Daemon Server Lifecycle", () => {
  let tempDir: string;
  let daemon: StagentDaemon | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-server-test-"));
  });

  afterEach(async () => {
    if (daemon && daemon.isRunning) {
      await daemon.stop();
    }
    daemon = null;
    try {
      safeRmSync(tempDir);
    } catch {
      // Ignore cleanup error
    }
  });

  it("should start daemon, listen on dynamic port, and serve health check", async () => {
    daemon = createDaemon({
      repoRoot: tempDir,
      startPort: 3510,
      endPort: 3520,
    });

    const info = await daemon.start();
    expect(daemon.isRunning).toBe(true);
    expect(info.port).toBeGreaterThanOrEqual(3510);
    expect(info.pid).toBe(process.pid);

    // Verify PID lock was created
    const lock = readPidLock(tempDir);
    expect(lock).not.toBeNull();
    expect(lock?.port).toBe(info.port);

    // Test GET /health
    const health = await httpGet<DaemonStatusResponse>(
      `http://127.0.0.1:${info.port}/health`,
    );
    expect(health.statusCode).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(health.body.pid).toBe(process.pid);
    expect(health.body.port).toBe(info.port);
    expect(health.body.repoRoot).toBe(path.resolve(tempDir));

    // Test GET /api/status
    const status = await httpGet<DaemonStatusResponse>(
      `http://127.0.0.1:${info.port}/api/status`,
    );
    expect(status.statusCode).toBe(200);
    expect(status.body.status).toBe("ok");
    expect(status.body.version).toBe("0.1.0");

    // Test 404 for unknown endpoint
    const notFound = await httpGet(
      `http://127.0.0.1:${info.port}/unknown-path`,
    );
    expect(notFound.statusCode).toBe(404);

    // Graceful stop
    await daemon.stop();
    expect(daemon.isRunning).toBe(false);

    // Verify PID lock was cleaned up
    const lockAfter = readPidLock(tempDir);
    expect(lockAfter).toBeNull();
  });

  it("should handle graceful shutdown via POST /api/shutdown", async () => {
    daemon = createDaemon({
      repoRoot: tempDir,
      startPort: 3525,
      endPort: 3530,
    });

    const info = await daemon.start();
    const shutdownRes = await httpPost<{ status: string }>(
      `http://127.0.0.1:${info.port}/api/shutdown`,
      { authorization: `Bearer ${daemon.getSessionToken() ?? ""}` },
    );
    expect(shutdownRes.statusCode).toBe(200);
    expect(shutdownRes.body.status).toBe("shutting_down");

    // Allow time for async graceful shutdown
    await new Promise((r) => setTimeout(r, 100));

    expect(daemon.isRunning).toBe(false);
    expect(readPidLock(tempDir)).toBeNull();
  });

  it("should prevent starting twice on the same instance", async () => {
    daemon = createDaemon({
      repoRoot: tempDir,
      startPort: 3535,
      endPort: 3540,
    });

    await daemon.start();
    await expect(daemon.start()).rejects.toThrow("already running");
  });
});

/**
 * TASK-C.14e：OS 级只读 + 断网沙盒反向证伪。
 * Darwin：写拒 EPERM（平台等价 EROFS）；断网 ENOTFOUND 等。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  proveScanWriteDenied,
  proveScanNetworkDenied,
  proveOsSandbox,
  osSandboxFullyProven,
  detectPreferredOsSandboxMode,
  buildDarwinSeatbeltProfile,
  runProgressiveBaselineScan,
} from "../../daemon/baseline/index";

function mkRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c14e-"));
  execSync("git init", { cwd: root });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "c14e-fixture", version: "0.0.1" }),
  );
  fs.writeFileSync(path.join(root, "README.md"), "# c14e\n");
  execSync('git add . && git -c user.email=t@t -c user.name=t commit -m init', {
    cwd: root,
  });
  return root;
}

describe("TASK-C.14e OS sandbox", () => {
  let root = "";

  beforeEach(() => {
    root = mkRepo();
  });

  afterEach(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("detects sandbox-exec on Darwin", () => {
    const mode = detectPreferredOsSandboxMode();
    if (process.platform === "darwin") {
      expect(mode).toBe("sandbox-exec");
    }
  });

  it("Darwin seatbelt profile denies network and repo writes", () => {
    if (process.platform !== "darwin") return;
    const profile = buildDarwinSeatbeltProfile(root);
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain(
      `(deny file-write* (subpath "${path.resolve(root)}")`,
    );
    expect(profile).toContain('(subpath "/private/tmp")');
  });

  it("test_scan_fails_on_write: sandbox write to repo is denied (EPERM/EROFS)", () => {
    if (process.platform !== "darwin") {
      const r = proveScanWriteDenied(root);
      expect(r).toHaveProperty("denied");
      expect(r).toHaveProperty("mode");
      return;
    }
    const r = proveScanWriteDenied(root);
    expect(r.denied).toBe(true);
    expect(r.mode).toBe("sandbox-exec");
    // Darwin 平台等价：EPERM（非 Linux EROFS）
    expect(["EPERM", "EROFS", "EACCES"]).toContain(r.code);
    const probe = path.join(
      root,
      `.stagent-c14e-write-probe-${process.pid}.tmp`,
    );
    expect(fs.existsSync(probe)).toBe(false);
  });

  it("test_scan_fails_on_outbound_network: sandbox outbound fails", () => {
    if (process.platform !== "darwin") {
      const r = proveScanNetworkDenied(root);
      expect(r).toHaveProperty("denied");
      return;
    }
    const r = proveScanNetworkDenied(root);
    expect(r.denied).toBe(true);
    expect(r.mode).toBe("sandbox-exec");
    expect(r.code).not.toBe("CONNECTED");
    expect(r.code).toBeTruthy();
  });

  it("proveOsSandbox aggregates write+network on Darwin", () => {
    if (process.platform !== "darwin") return;
    const proof = proveOsSandbox(root);
    expect(proof.platform).toBe("darwin");
    expect(proof.write_denied).toBe(true);
    expect(proof.network_denied).toBe(true);
    expect(proof.mode).toBe("sandbox-exec");
    expect(osSandboxFullyProven(proof)).toBe(true);
    expect(proof.notes.some((n) => n.includes("EPERM"))).toBe(true);
  });

  it("progressive scan attaches os_sandbox proof to archive", async () => {
    const archive = await runProgressiveBaselineScan({
      repoRoot: root,
      toolVersion: "0.1.0-c14e-test",
      p0TimeoutMs: 5_000,
      deepTimeoutMs: 5_000,
    });
    expect(archive.os_sandbox).toBeTruthy();
    expect(archive.os_sandbox!.platform).toBe(process.platform);
    if (process.platform === "darwin") {
      expect(archive.os_sandbox!.write_denied).toBe(true);
      expect(archive.os_sandbox!.network_denied).toBe(true);
      expect(archive.os_sandbox!.mode).toBe("sandbox-exec");
      expect(archive.notes.some((n) => n.includes("OS 沙盒已证明"))).toBe(true);
    }
  });
});

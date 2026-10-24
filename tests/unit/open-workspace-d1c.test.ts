import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  buildUiLaunchUrl,
  buildWorkspaceLaunchUrl,
  ensureWorkspaceSession,
  resolveConsoleUiTarget,
  tryReuseRunningDaemon,
} from "../../daemon/core/open-workspace";

function writeHydratableDist(root: string, jsName: string) {
  const assets = path.join(root, "dist", "public", "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, jsName), "console.log(1)");
  fs.writeFileSync(
    path.join(root, "dist", "public", "index.html"),
    `<!DOCTYPE html><html><head></head><body>
<script>self.$_TSR={h(){},e(){},c(){},p(){},buffer:[]};$_TSR.e();</script>
<script type="module" async src="/assets/${jsName}"></script>
</body></html>`,
  );
}

describe("TASK-D.1c open-workspace", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("tryReuse：无锁返回 null", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ow-"));
    expect(await tryReuseRunningDaemon(tmp)).toBeNull();
  });

  it("buildUiLaunchUrl 不写 query token", () => {
    const url = buildUiLaunchUrl("http://127.0.0.1:3005/", "abc", {
      daemonBaseUrl: "http://127.0.0.1:3008",
    });
    expect(url).toContain("#token=abc");
    expect(url).toContain("base=");
    expect(url).not.toContain("?token=");
  });

  it("resolveConsoleUiTarget 无 dist 回退", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ow-dist-"));
    const target = resolveConsoleUiTarget({
      daemonPort: 3004,
      uiUrl: "http://localhost:5173",
      packageRoot: tmp,
    });
    expect(target.sameOrigin).toBe(false);
    expect(target.daemonBaseUrl).toBe("http://127.0.0.1:3004");
  });

  it("ensureWorkspaceSession：复用健康 Daemon", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ow-reuse-"));
    const stagentDir = path.join(tmp, ".stagent");
    fs.mkdirSync(stagentDir, { recursive: true });
    fs.writeFileSync(
      path.join(stagentDir, "stagent.pid"),
      JSON.stringify({
        pid: process.pid,
        port: 3009,
        repoRoot: tmp,
        startedAt: new Date().toISOString(),
        version: "0.1.0",
      }),
    );
    const token = "c".repeat(64);
    fs.writeFileSync(path.join(stagentDir, "session-token"), token, {
      mode: 0o600,
    });
    const session = await ensureWorkspaceSession(tmp, {
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
      spawnImpl: () => {
        throw new Error("should not spawn when reusable");
      },
    });
    expect(session).toEqual({ port: 3009, token, reused: true });
  });

  it("ensureWorkspaceSession：无会话时 spawn 并等待就绪", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ow-spawn-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-pkg-"));
    try {
      fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
      fs.writeFileSync(path.join(packageRoot, "bin", "stagent.ts"), "// stub");
      fs.mkdirSync(path.join(packageRoot, "node_modules", "tsx", "dist"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        "export {}",
      );

      let spawned = false;
      const child = new EventEmitter() as EventEmitter & {
        unref: () => void;
        exitCode: number | null;
      };
      child.unref = () => undefined;
      child.exitCode = null;

      const session = await ensureWorkspaceSession(tmp, {
        packageRoot,
        waitTimeoutMs: 2000,
        pollIntervalMs: 30,
        spawnImpl: (cmd, args) => {
          spawned = true;
          expect(cmd).toBe(process.execPath);
          expect(args.join(" ")).toContain("start");
          expect(args.join(" ")).toContain(tmp);
          // 模拟子进程稍后写出 PID 锁与 Token
          setTimeout(() => {
            const stagentDir = path.join(tmp, ".stagent");
            fs.mkdirSync(stagentDir, { recursive: true });
            fs.writeFileSync(
              path.join(stagentDir, "stagent.pid"),
              JSON.stringify({
                pid: process.pid,
                port: 3007,
                repoRoot: tmp,
                startedAt: new Date().toISOString(),
                version: "0.1.0",
              }),
            );
            fs.writeFileSync(
              path.join(stagentDir, "session-token"),
              "d".repeat(64),
              { mode: 0o600 },
            );
          }, 60);
          return child as unknown as ReturnType<
            typeof import("node:child_process").spawn
          >;
        },
        fetchImpl: async () =>
          new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
      });
      expect(spawned).toBe(true);
      expect(session.reused).toBe(false);
      expect(session.port).toBe(3007);
      expect(session.token).toBe("d".repeat(64));
    } finally {
      fs.rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it("buildWorkspaceLaunchUrl 同源不写 base", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ow-launch-"));
    writeHydratableDist(tmp, "index-hash.js");
    const launch = buildWorkspaceLaunchUrl(
      { port: 3006, token: "tok" },
      { packageRoot: tmp },
    );
    expect(launch.sameOrigin).toBe(true);
    expect(launch.launchUrl).toContain("#token=tok");
    expect(launch.launchUrl).not.toContain("base=");
  });
});

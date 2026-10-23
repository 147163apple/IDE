import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  parseArgs,
  buildUiLaunchUrl,
  resolveConsoleUiTarget,
  tryReuseRunningDaemon,
} from "../../bin/stagent";

/**
 * TASK-D.1b：一键打开项目 CLI 单元测试。
 */

describe("stagent open 参数解析（TASK-D.1b）", () => {
  it("识别 open 子命令与位置路径", () => {
    const opts = parseArgs(["open", "/tmp/demo-project"]);
    expect(opts.command).toBe("open");
    expect(opts.repo).toBe(path.resolve("/tmp/demo-project"));
    expect(opts.noBrowser).toBe(false);
  });

  it("open 支持 --repo / --port / --no-browser（与 start 同旗标）", () => {
    const opts = parseArgs([
      "open",
      "--repo",
      ".",
      "--port",
      "3007",
      "--no-browser",
    ]);
    expect(opts.command).toBe("open");
    expect(opts.port).toBe(3007);
    expect(opts.noBrowser).toBe(true);
  });

  it("位置路径优先于默认 cwd", () => {
    const opts = parseArgs(["open", "../elsewhere"]);
    expect(opts.repo).toBe(path.resolve("../elsewhere"));
  });
});

describe("buildUiLaunchUrl 写入 base=（避免死认 3001）", () => {
  it("同源场景不强制写 base", () => {
    const url = buildUiLaunchUrl("http://127.0.0.1:3005/", "abc");
    expect(url).toContain("#token=abc");
    expect(url).not.toContain("base=");
  });

  it("跨端口场景把 daemonBaseUrl 写入 fragment", () => {
    const url = buildUiLaunchUrl("http://localhost:5173/", "tok", {
      daemonBaseUrl: "http://127.0.0.1:3008",
    });
    const hash = new URL(url).hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    expect(params.get("token")).toBe("tok");
    expect(params.get("base")).toBe("http://127.0.0.1:3008");
    expect(url).not.toContain("?token=");
  });
});

describe("resolveConsoleUiTarget", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("无 dist/public 时回退 uiUrl，并给出 daemonBaseUrl", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1b-no-dist-"));
    const target = resolveConsoleUiTarget({
      daemonPort: 3004,
      uiUrl: "http://localhost:5173",
      packageRoot: tmp,
    });
    expect(target.sameOrigin).toBe(false);
    expect(target.uiUrl).toBe("http://localhost:5173");
    expect(target.daemonBaseUrl).toBe("http://127.0.0.1:3004");
  });

  it("有 dist/public/assets/index-*.js 时走同源", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1b-dist-"));
    const assets = path.join(tmp, "dist", "public", "assets");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, "index-testhash.js"), "console.log(1)");
    const target = resolveConsoleUiTarget({
      daemonPort: 3006,
      uiUrl: "http://localhost:5173",
      packageRoot: tmp,
    });
    expect(target.sameOrigin).toBe(true);
    expect(target.uiUrl).toBe("http://127.0.0.1:3006");
  });

  it("forceUiUrl 时即使有 dist 也回退", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1b-force-"));
    const assets = path.join(tmp, "dist", "public", "assets");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, "index-x.js"), "x");
    const target = resolveConsoleUiTarget({
      daemonPort: 3003,
      uiUrl: "http://localhost:5173",
      packageRoot: tmp,
      forceUiUrl: true,
    });
    expect(target.sameOrigin).toBe(false);
    expect(target.uiUrl).toBe("http://localhost:5173");
  });
});

describe("tryReuseRunningDaemon", () => {
  it("无 PID 锁时返回 null", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1b-reuse-"));
    try {
      const result = await tryReuseRunningDaemon(tmp);
      expect(result).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("健康检查失败时返回 null", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1b-reuse2-"));
    try {
      const stagentDir = path.join(tmp, ".stagent");
      fs.mkdirSync(stagentDir, { recursive: true });
      fs.writeFileSync(
        path.join(stagentDir, "stagent.pid"),
        JSON.stringify({
          pid: process.pid,
          port: 65534,
          repoRoot: tmp,
          startedAt: new Date().toISOString(),
          version: "0.1.0",
        }),
      );
      fs.writeFileSync(path.join(stagentDir, "session-token"), "a".repeat(64), {
        mode: 0o600,
      });
      const result = await tryReuseRunningDaemon(tmp, async () => {
        throw new Error("ECONNREFUSED");
      });
      expect(result).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("健康且有 Token 时复用 port/token", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1b-reuse3-"));
    try {
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
      const token = "b".repeat(64);
      fs.writeFileSync(path.join(stagentDir, "session-token"), token, {
        mode: 0o600,
      });
      const result = await tryReuseRunningDaemon(tmp, async () => {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      });
      expect(result).toEqual({ port: 3009, token });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

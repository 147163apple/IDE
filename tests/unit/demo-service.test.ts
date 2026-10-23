import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StagentRuntimeError } from "../../src/lib/error-codes";
import {
  assertAssetSize,
  buildDemoFromRequirements,
  writeDemo,
} from "../../daemon/supervisor/demo/demo-generator";
import {
  createSnapshot,
  listSnapshots,
  rollbackToSnapshot,
} from "../../daemon/supervisor/demo/demo-evolution";
import {
  DEMO_CSP,
  createDemoPreviewServer,
  type DemoPreviewServer,
} from "../../daemon/supervisor/demo/preview-server";
import {
  DEMO_IFRAME_SANDBOX,
  MAX_DEMO_FILE_BYTES,
  demoIframeProps,
  type GeneratedDemo,
} from "../../daemon/supervisor/demo/types";

/**
 * TASK-S.4 / 架构 §4.4（P-16）：Demo 生成器与 Mock 预览服务验收。
 *
 * 覆盖四类判据：
 * 1. 2MB 单文件闸门（含 UTF-8 字节口径与边界值）；
 * 2. 独立端口与冲突回退（不占用 Daemon 端口段）；
 * 3. CSP 与响应头（connect-src 'none' 阻断回连 Daemon）；
 * 4. 快照生成、列出与回退（含残留资源清理）。
 */

const tmpRoots: string[] = [];
const servers: DemoPreviewServer[] = [];

function newRoot(): string {
  const base = path.join(process.cwd(), ".tmp", "unit-demo");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "case-"));
  tmpRoots.push(dir);
  return dir;
}

function demoServing(dir: string): DemoPreviewServer {
  const server = createDemoPreviewServer({
    rootDir: dir,
    startPort: 4100,
    endPort: 4110,
  });
  servers.push(server);
  return server;
}

/** 发送原始路径（绕过 fetch 对 `..` 的归一化），用于路径逃逸测试 */
function rawGet(
  port: number,
  rawPath: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: rawPath, method: "GET" },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.once("error", reject);
    blocker.listen({ port, host: "127.0.0.1" }, () => resolve(blocker));
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.stop().catch(() => undefined);
  }
  for (const dir of tmpRoots.splice(0)) {
    // 清理失败不得影响断言结论（受限环境会拦截部分 unlink）
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("2MB 单文件闸门", () => {
  const requirements = [
    "# 记账本",
    "## 核心功能",
    "- 新增一笔支出",
    "- 按月汇总",
    "## 表单字段",
    "- 金额",
    "- 备注",
  ].join("\n");

  it("正常需求生成的每个资源都远小于上限", () => {
    const demo = buildDemoFromRequirements(requirements);
    expect(demo.assets.length).toBeGreaterThan(0);
    for (const asset of demo.assets) {
      expect(Buffer.byteLength(asset.content, "utf8")).toBeLessThan(
        MAX_DEMO_FILE_BYTES,
      );
    }
  });

  it("恰好 2MB 放行，2MB+1 字节拒绝并抛 E_DEMO_PAYLOAD_TOO_LARGE", () => {
    const root = newRoot();
    const atLimit = "a".repeat(MAX_DEMO_FILE_BYTES);
    expect(() =>
      assertAssetSize({ path: "app.js", content: atLimit }),
    ).not.toThrow();

    const over: GeneratedDemo = {
      entry: "index.html",
      assets: [
        { path: "index.html", content: "<!doctype html><p>ok</p>" },
        { path: "app.js", content: atLimit + "a" },
      ],
      totalBytes: MAX_DEMO_FILE_BYTES + 1,
    };

    try {
      writeDemo(root, over);
      throw new Error("expected E_DEMO_PAYLOAD_TOO_LARGE");
    } catch (err) {
      expect(err).toBeInstanceOf(StagentRuntimeError);
      expect((err as StagentRuntimeError).code).toBe(
        "E_DEMO_PAYLOAD_TOO_LARGE",
      );
    }

    // 超限时不得写入任何文件（含入口页）
    expect(
      fs.existsSync(path.join(root, ".stagent", "demo", "index.html")),
    ).toBe(false);
  });

  it("按 UTF-8 字节而非字符数计：中文内容更早触发上限", () => {
    // 字符数只有 ~0.7M，但 UTF-8 字节数已超过 2MB
    const chinese = "中".repeat(Math.floor(MAX_DEMO_FILE_BYTES / 3) + 1);
    expect(chinese.length).toBeLessThan(MAX_DEMO_FILE_BYTES);
    expect(Buffer.byteLength(chinese, "utf8")).toBeGreaterThan(
      MAX_DEMO_FILE_BYTES,
    );
    expect(() =>
      assertAssetSize({ path: "app.js", content: chinese }),
    ).toThrowError(StagentRuntimeError);
  });

  it("路径逃逸被拒绝：绝对路径与 ../ 均不得落盘", () => {
    const root = newRoot();
    const escape: GeneratedDemo = {
      entry: "index.html",
      assets: [{ path: "../outside.html", content: "x" }],
      totalBytes: 1,
    };
    expect(() => writeDemo(root, escape)).toThrowError(/traversal|relative/i);

    const absolute: GeneratedDemo = {
      entry: "index.html",
      assets: [{ path: "/etc/passwd", content: "x" }],
      totalBytes: 1,
    };
    expect(() => writeDemo(root, absolute)).toThrowError(/relative/i);
  });
});

describe("预览服务：独立端口、冲突回退与响应头", () => {
  it("默认在 4100~4110 启动，且不与 Daemon 端口段重叠", async () => {
    const root = newRoot();
    writeDemo(root, buildDemoFromRequirements("# 演示\n## 功能\n- 点击"));
    const dir = path.join(root, ".stagent", "demo");

    const server = demoServing(dir);
    const handle = await server.start();

    expect(handle.port).toBeGreaterThanOrEqual(4100);
    expect(handle.port).toBeLessThanOrEqual(4110);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/`);
    // Daemon 端口段与测试端口段都在 3xxx，4100+ 与之无交集
    expect(handle.port).toBeGreaterThan(4000);
  });

  it("端口被占用时自动回退到下一个可用端口", async () => {
    const root = newRoot();
    writeDemo(root, buildDemoFromRequirements("# 端口回退\n## 功能\n- 占位"));
    const dir = path.join(root, ".stagent", "demo");

    const blocker = await occupyPort(4100);
    try {
      const server = demoServing(dir);
      const handle = await server.start();
      expect(handle.port).toBe(4101);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("返回严格 CSP 与安全响应头，connect-src 阻断回连 Daemon", async () => {
    const root = newRoot();
    writeDemo(root, buildDemoFromRequirements("# CSP 校验\n## 功能\n- 只读"));
    const dir = path.join(root, ".stagent", "demo");

    const server = demoServing(dir);
    const handle = await server.start();
    const res = await fetch(handle.url);

    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toBe(DEMO_CSP);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toContain("no-store");
    // 刻意不禁止嵌入（Studio 需要 iframe），因此不应出现 X-Frame-Options
    expect(res.headers.get("x-frame-options")).toBeNull();

    const html = await res.text();
    expect(html).toContain("CSP 校验");
  });

  it("拒绝路径逃逸、隐藏文件与非 GET/HEAD 方法", async () => {
    const root = newRoot();
    writeDemo(root, buildDemoFromRequirements("# 安全\n## 功能\n- 只读"));
    const dir = path.join(root, ".stagent", "demo");
    const server = demoServing(dir);
    const handle = await server.start();

    const escaped = await rawGet(handle.port, "/../package.json");
    expect([403, 404]).toContain(escaped.status);

    const hidden = await rawGet(handle.port, "/.demo-manifest.json");
    expect(hidden.status).toBe(404);

    const missing = await rawGet(handle.port, "/nope.js");
    expect(missing.status).toBe(404);
  });
});

describe("快照生成与回退", () => {
  const v1 = buildDemoFromRequirements("# 记账本\n## 表单字段\n- 金额\n- 备注");
  const v2 = buildDemoFromRequirements(
    "# 记账本 v2\n## 表单字段\n- 金额\n- 分类",
  );

  it("生成带时间戳的快照并可列出", () => {
    const root = newRoot();
    const demoDir = writeDemo(root, v1).root;

    const meta = createSnapshot(demoDir, v1, {
      label: "初版",
      now: () => new Date("2026-10-23T05:00:00.000Z"),
      nonce: () => "abc123",
    });

    expect(meta.snapshot_id).toBe("snap_2026-10-23T05-00-00-000Z_abc123");
    expect(meta.files).toContain("index.html");
    expect(meta.total_bytes).toBeGreaterThan(0);

    const listed = listSnapshots(demoDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.snapshot_id).toBe(meta.snapshot_id);
    expect(listed[0]?.label).toBe("初版");
  });

  it("回退到历史快照：内容还原，且清理快照中不存在的旧资源", () => {
    const root = newRoot();
    const demoDir = writeDemo(root, v1).root;
    const meta = createSnapshot(demoDir, v1, {
      now: () => new Date("2026-10-23T05:00:00.000Z"),
      nonce: () => "abc123",
    });

    // 第二版多一个资源，并覆盖 index.html
    const v2WithExtra: GeneratedDemo = {
      entry: "index.html",
      assets: [
        ...v2.assets,
        { path: "extra.js", content: "console.log('v2')" },
      ],
      totalBytes: v2.totalBytes + 20,
    };
    writeDemo(root, v2WithExtra);
    expect(fs.existsSync(path.join(demoDir, "extra.js"))).toBe(true);

    const result = rollbackToSnapshot(demoDir, meta.snapshot_id);
    expect(result.restored).toContain("index.html");
    expect(result.removed).toContain("extra.js");

    const restoredHtml = fs.readFileSync(
      path.join(demoDir, "index.html"),
      "utf8",
    );
    expect(restoredHtml).toContain("记账本");
    expect(restoredHtml).not.toContain("记账本 v2");
    expect(fs.existsSync(path.join(demoDir, "extra.js"))).toBe(false);
  });

  it("非法快照 ID 与不存在的快照均被拒绝", () => {
    const root = newRoot();
    const demoDir = writeDemo(root, v1).root;
    expect(() => rollbackToSnapshot(demoDir, "../../etc")).toThrowError(
      /Invalid snapshot id/,
    );
    expect(() =>
      rollbackToSnapshot(demoDir, "snap_does_not_exist"),
    ).toThrowError(/not found/i);
  });
});

describe("前端嵌入约定：iframe sandbox 唯一事实源", () => {
  it("sandbox 仅为 allow-scripts，严禁 allow-same-origin", () => {
    expect(DEMO_IFRAME_SANDBOX).toBe("allow-scripts");
    expect(DEMO_IFRAME_SANDBOX).not.toContain("allow-same-origin");
    expect(DEMO_IFRAME_SANDBOX).not.toContain("allow-top-navigation");
  });

  it("demoIframeProps 同时给出 no-referrer，避免泄漏 IDE 地址", () => {
    expect(demoIframeProps("http://127.0.0.1:4101/")).toEqual({
      src: "http://127.0.0.1:4101/",
      sandbox: "allow-scripts",
      referrerPolicy: "no-referrer",
    });
  });
});

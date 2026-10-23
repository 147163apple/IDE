import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {
  buildConsoleIndexHtml,
  discoverConsoleAssets,
  resolvePublicFile,
  tryServeConsoleStatic,
  canHostConsoleLocally,
} from "../../daemon/console/static-host";

describe("console static-host（TASK-D.1b）", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-static-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("discoverConsoleAssets 需要 index-*.js", () => {
    const publicDir = path.join(tmp, "public");
    const assets = path.join(publicDir, "assets");
    fs.mkdirSync(assets, { recursive: true });
    expect(discoverConsoleAssets(publicDir)).toBeNull();
    fs.writeFileSync(path.join(assets, "index-abc.js"), "1");
    fs.writeFileSync(path.join(assets, "styles-xyz.css"), "body{}");
    expect(discoverConsoleAssets(publicDir)).toEqual({
      js: "index-abc.js",
      css: "styles-xyz.css",
      routesJs: null,
    });
  });

  it("buildConsoleIndexHtml 引用 hashed 资源且无内联脚本密钥", () => {
    const html = buildConsoleIndexHtml({
      js: "index-abc.js",
      css: "styles-xyz.css",
      routesJs: null,
    });
    expect(html).toContain('src="/assets/index-abc.js"');
    expect(html).toContain('href="/assets/styles-xyz.css"');
    expect(html).not.toMatch(/token=/i);
  });

  it("resolvePublicFile 拒绝路径穿越", () => {
    const publicDir = path.join(tmp, "public");
    fs.mkdirSync(publicDir, { recursive: true });
    expect(resolvePublicFile(publicDir, "/../../etc/passwd")).toBeNull();
    const ok = resolvePublicFile(publicDir, "/assets/x.js");
    expect(ok).toBe(path.resolve(publicDir, "assets/x.js"));
  });

  it("canHostConsoleLocally 检测 packageRoot/dist/public", () => {
    expect(canHostConsoleLocally(tmp)).toBe(false);
    const assets = path.join(tmp, "dist", "public", "assets");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, "index-h.js"), "1");
    expect(canHostConsoleLocally(tmp)).toBe(true);
  });

  it("tryServeConsoleStatic 提供 SPA 回退与 assets", async () => {
    const publicDir = path.join(tmp, "public");
    const assets = path.join(publicDir, "assets");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, "index-h.js"), "console.log(1)");
    fs.writeFileSync(path.join(assets, "styles-h.css"), "body{}");

    const server = http.createServer((req, res) => {
      const result = tryServeConsoleStatic(req, res, publicDir);
      if (!result.served) {
        res.writeHead(404);
        res.end("no");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const base = `http://127.0.0.1:${addr.port}`;

    const indexRes = await fetch(`${base}/`);
    expect(indexRes.status).toBe(200);
    const indexHtml = await indexRes.text();
    expect(indexHtml).toContain("/assets/index-h.js");

    const assetRes = await fetch(`${base}/assets/index-h.js`);
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toBe("console.log(1)");

    const apiRes = await fetch(`${base}/api/status`);
    expect(apiRes.status).toBe(404);
    expect(await apiRes.text()).toBe("no");

    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {
  buildConsoleIndexHtml,
  discoverConsoleAssets,
  resolvePublicFile,
  tryServeConsoleStatic,
  canHostConsoleLocally,
  isHydratableConsoleShell,
  readConsoleIndexHtml,
} from "../../daemon/console/static-host";

/** 最小可 hydrate 壳（对齐 TanStack Start SPA $_TSR 标记） */
function fixtureHydratableShell(js = "index-abc.js"): string {
  return `<!DOCTYPE html><html lang="zh" class="dark"><head>
<link rel="modulepreload" href="/assets/${js}"/>
<title>Stagent</title></head><body>
<script>self.$_TSR={h(){},e(){},c(){},p(){},buffer:[]};$_TSR.e();</script>
<script type="module" async src="/assets/${js}"></script>
</body></html>`;
}

describe("console static-host（TASK-D.1b / D.1d）", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-static-"));
  });

  afterEach(() => {
    safeRmSync(tmp);
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

  it("isHydratableConsoleShell 拒绝空白壳、接受 $_TSR 壳", () => {
    const blank = buildConsoleIndexHtml({
      js: "index-abc.js",
      css: "styles-xyz.css",
      routesJs: null,
    });
    expect(isHydratableConsoleShell(blank)).toBe(false);
    expect(isHydratableConsoleShell(fixtureHydratableShell())).toBe(true);
  });

  it("buildConsoleIndexHtml 引用 hashed 资源且无内联脚本密钥（对照空白壳）", () => {
    const html = buildConsoleIndexHtml({
      js: "index-abc.js",
      css: "styles-xyz.css",
      routesJs: null,
    });
    expect(html).toContain('src="/assets/index-abc.js"');
    expect(html).toContain('href="/assets/styles-xyz.css"');
    expect(html).not.toMatch(/token=/i);
    expect(isHydratableConsoleShell(html)).toBe(false);
  });

  it("resolvePublicFile 拒绝路径穿越", () => {
    const publicDir = path.join(tmp, "public");
    fs.mkdirSync(publicDir, { recursive: true });
    expect(resolvePublicFile(publicDir, "/../../etc/passwd")).toBeNull();
    const ok = resolvePublicFile(publicDir, "/assets/x.js");
    expect(ok).toBe(path.resolve(publicDir, "assets/x.js"));
  });

  it("canHostConsoleLocally 需要可 hydrate 壳 + assets", () => {
    expect(canHostConsoleLocally(tmp)).toBe(false);
    const publicDir = path.join(tmp, "dist", "public");
    const assets = path.join(publicDir, "assets");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, "index-h.js"), "1");
    // 仅有 assets、无 $_TSR 壳 → 不可托管（D.1d）
    expect(canHostConsoleLocally(tmp)).toBe(false);
    fs.writeFileSync(
      path.join(publicDir, "_shell.html"),
      fixtureHydratableShell("index-h.js"),
    );
    expect(canHostConsoleLocally(tmp)).toBe(true);
    expect(readConsoleIndexHtml(publicDir)?.toString("utf8")).toContain(
      "$_TSR",
    );
  });

  it("tryServeConsoleStatic 提供 SPA 回退与 assets，且入口为可 hydrate 壳", async () => {
    const publicDir = path.join(tmp, "public");
    const assets = path.join(publicDir, "assets");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, "index-h.js"), "console.log(1)");
    fs.writeFileSync(path.join(assets, "styles-h.css"), "body{}");
    fs.writeFileSync(
      path.join(publicDir, "_shell.html"),
      fixtureHydratableShell("index-h.js"),
    );

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
    expect(indexHtml).toContain("$_TSR");
    expect(indexHtml).toContain("/assets/index-h.js");
    // 禁止再把空白壳当入口
    expect(indexHtml).not.toMatch(
      /^<!DOCTYPE html>\s*<html[^>]*>\s*<head>[\s\S]*<\/head>\s*<body>\s*<script type="module"/,
    );

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

  it("空白壳存在时 tryServeConsoleStatic 不把入口标为已服务成功", async () => {
    const publicDir = path.join(tmp, "public");
    const assets = path.join(publicDir, "assets");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, "index-h.js"), "1");
    fs.writeFileSync(
      path.join(publicDir, "index.html"),
      buildConsoleIndexHtml({
        js: "index-h.js",
        css: null,
        routesJs: null,
      }),
    );

    const server = http.createServer((req, res) => {
      const result = tryServeConsoleStatic(req, res, publicDir);
      if (!result.served) {
        res.writeHead(404);
        res.end("no-shell");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const res = await fetch(`http://127.0.0.1:${addr.port}/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("no-shell");
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});

/**
 * TASK-D.1d：dist 静态 SPA 可用性回归。
 * - 若本机已有 build 产物，断言入口为可 hydrate 壳（禁止空白壳 PASS）
 * - 同时用 fixture 覆盖 package 提升逻辑的判定口径
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isHydratableConsoleShell,
  canHostConsoleLocally,
  readConsoleIndexHtml,
  buildConsoleIndexHtml,
} from "../../daemon/console/static-host";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("dist 静态 SPA 壳回归（TASK-D.1d）", () => {
  it("空白壳不得被判定为可 hydrate", () => {
    const blank = buildConsoleIndexHtml({
      js: "index-Le0O1Uye.js",
      css: "styles-D4avrMHW.css",
      routesJs: "routes-Cn2UhrkR.js",
    });
    expect(isHydratableConsoleShell(blank)).toBe(false);
  });

  it("若 dist/public 存在，则同源入口必须可 hydrate（build 后回归）", () => {
    const publicDir = path.join(repoRoot, "dist", "public");
    const assetsDir = path.join(publicDir, "assets");
    if (!fs.existsSync(assetsDir)) {
      // 未 build 时跳过产物断言（CI 四件套含 build 后会覆盖）
      expect(true).toBe(true);
      return;
    }
    const indexPath = path.join(publicDir, "index.html");
    const shellPath = path.join(publicDir, "_shell.html");
    expect(
      fs.existsSync(indexPath) || fs.existsSync(shellPath),
      "build 后应有 index.html 或 _shell.html",
    ).toBe(true);

    const html = readConsoleIndexHtml(publicDir);
    expect(html, "入口必须可被 readConsoleIndexHtml 读取").not.toBeNull();
    expect(isHydratableConsoleShell(html!)).toBe(true);
    expect(canHostConsoleLocally(repoRoot)).toBe(true);

    // 明确禁止 D.1b 空白壳形态被当成 PASS
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath);
      expect(isHydratableConsoleShell(raw)).toBe(true);
      const text = raw.toString("utf8");
      expect(text).toContain("$_TSR");
      expect(text).not.toMatch(
        /<body>\s*<script type="module" src="\/assets\/index-[^"]+\.js"><\/script>\s*<\/body>/,
      );
    }
  });
});

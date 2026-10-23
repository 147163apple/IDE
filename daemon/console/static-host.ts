/**
 * TASK-D.1b：Daemon 同源托管控制台静态资源（dist/public）。
 *
 * 与 Demo（4100~4110）严格分离：这里只服务 Stagent 安装包内的控制台构建产物，
 * 绝不与 Demo 预览共用 Origin；Demo iframe 仍受 connect-src 'none' 与
 * isDemoPreviewOrigin 403 约束。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type http from "node:http";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Stagent 安装包根（含 package.json / dist/） */
export function resolvePackageRoot(fromUrl: string = import.meta.url): string {
  // daemon/console/static-host.ts → ../..
  return path.resolve(path.dirname(fileURLToPath(fromUrl)), "../..");
}

export interface ConsoleAssets {
  readonly js: string;
  readonly css: string | null;
  readonly routesJs: string | null;
}

/**
 * 解析控制台静态根目录。
 * 要求 `dist/public/assets` 存在且至少有一个 `index-*.js` 入口。
 */
export function resolveConsolePublicDir(
  packageRoot: string = resolvePackageRoot(),
): string | null {
  const publicDir = path.join(packageRoot, "dist", "public");
  const assetsDir = path.join(publicDir, "assets");
  if (!fs.existsSync(assetsDir)) return null;
  const assets = discoverConsoleAssets(publicDir);
  return assets ? publicDir : null;
}

export function discoverConsoleAssets(publicDir: string): ConsoleAssets | null {
  const assetsDir = path.join(publicDir, "assets");
  if (!fs.existsSync(assetsDir)) return null;
  let files: string[];
  try {
    files = fs.readdirSync(assetsDir);
  } catch {
    return null;
  }
  const js = files.find((f) => /^index-.*\.js$/.test(f));
  if (!js) return null;
  const css = files.find((f) => /^styles-.*\.css$/.test(f)) ?? null;
  const routesJs = files.find((f) => /^routes-.*\.js$/.test(f)) ?? null;
  return { js, css, routesJs };
}

/** 生成可被客户端 bundle hydrate 的最小 HTML 壳 */
export function buildConsoleIndexHtml(assets: ConsoleAssets): string {
  const cssLink = assets.css
    ? `  <link rel="stylesheet" href="/assets/${assets.css}" />\n`
    : "";
  return `<!DOCTYPE html>
<html lang="zh" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stagent</title>
${cssLink}</head>
<body>
  <script type="module" src="/assets/${assets.js}"></script>
</body>
</html>
`;
}

function contentTypeFor(filePath: string): string {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

/**
 * 把 URL 路径安全落到 publicDir 内；越界 / 不存在返回 null。
 */
export function resolvePublicFile(
  publicDir: string,
  pathname: string,
): string | null {
  const decoded = decodeURIComponent(pathname.split("?")[0] ?? "/");
  const relative =
    decoded === "/" || decoded === ""
      ? "index.html"
      : decoded.replace(/^\/+/, "");
  const abs = path.resolve(publicDir, relative);
  const root = path.resolve(publicDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return null;
  }
  return abs;
}

export interface StaticServeResult {
  readonly served: boolean;
  readonly status?: number;
}

/**
 * 尝试以静态方式响应控制台请求。
 * - 有实体文件 → 原样返回
 * - 无文件但属 SPA 导航（无扩展名或 .html）→ 回退 index.html 壳
 * - 其它 → served:false，交给调用方 404
 */
export function tryServeConsoleStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  publicDir: string | null,
): StaticServeResult {
  if (!publicDir) return { served: false };
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return { served: false };

  const rawUrl = req.url ?? "/";
  const pathname = rawUrl.split("?")[0] ?? "/";
  // API / 健康检查 / WS 升级路径不走静态
  if (
    pathname.startsWith("/api/") ||
    pathname === "/health" ||
    pathname === "/api/status"
  ) {
    return { served: false };
  }

  const target = resolvePublicFile(publicDir, pathname);
  if (!target) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return { served: true, status: 403 };
  }

  const assets = discoverConsoleAssets(publicDir);
  const sendIndex = (): StaticServeResult => {
    if (!assets) return { served: false };
    const html = buildConsoleIndexHtml(assets);
    const headers: Record<string, string> = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
    } else {
      res.writeHead(200, headers);
      res.end(html);
    }
    return { served: true, status: 200 };
  };

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    // 构建产物里可能没有预写 index.html：命中 index.html 时改用生成壳
    if (path.basename(target) === "index.html") {
      return sendIndex();
    }
    const body = fs.readFileSync(target);
    const headers: Record<string, string> = {
      "Content-Type": contentTypeFor(target),
      "Cache-Control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (method === "HEAD") {
      res.writeHead(200, { ...headers, "Content-Length": String(body.length) });
      res.end();
    } else {
      res.writeHead(200, headers);
      res.end(body);
    }
    return { served: true, status: 200 };
  }

  // 仅对控制台入口做壳回退；其它未知路径交给调用方 404（避免掩盖缺资源）
  if (pathname === "/" || pathname === "/index.html") {
    return sendIndex();
  }

  return { served: false };
}

/** 是否具备同源托管条件（供 CLI 决策 uiUrl） */
export function canHostConsoleLocally(
  packageRoot: string = resolvePackageRoot(),
): boolean {
  return resolveConsolePublicDir(packageRoot) !== null;
}

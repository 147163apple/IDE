import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { findAvailablePort } from "../../core/port-finder";
import {
  DEMO_ENTRY,
  DEMO_PREVIEW_PORT_RANGE,
  MAX_DEMO_FILE_BYTES,
  type DemoPreviewHandle,
} from "./types";

/**
 * TASK-S.4 / 架构 §4.4（P-16）：Demo 独立 Origin 预览服务。
 *
 * 与 Daemon 的关系：**没有任何关系**。这里是一个只读静态文件服务器，
 * 运行在 127.0.0.1 的 4100~4110，与 Daemon 的端口段互不重叠；
 * 它不代理 RPC、不转发 Cookie、不读取 `.stagent/session-token`。
 *
 * 安全边界（四条，逐条可测）：
 * 1. 只绑 127.0.0.1，不监听 0.0.0.0；
 * 2. CSP `connect-src 'none'`：页面内的 fetch/XHR/WebSocket 一律被浏览器拦截，
 *    因此不可能向 Daemon 端口发出未鉴权 RPC；
 * 3. 路径只能落在 Demo 根目录内，`..` / 绝对路径 / 空字节一律拒绝；
 * 4. 只允许 GET/HEAD，其余方法 405；响应带 `nosniff` 与 `no-store`。
 */

/** 原型页面的 CSP：不连任何外部域，也不连本机 Daemon */
export const DEMO_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

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
};

export interface DemoPreviewServerOptions {
  /** 原型资源所在目录（绝对路径） */
  readonly rootDir: string;
  readonly host?: string;
  readonly startPort?: number;
  readonly endPort?: number;
}

export interface DemoPreviewServer {
  start(): Promise<DemoPreviewHandle>;
  stop(): Promise<void>;
  /** 已启动时返回访问地址，未启动返回 null */
  readonly handle: DemoPreviewHandle | null;
}

function contentTypeFor(filePath: string): string {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

function applySecurityHeaders(res: http.ServerResponse): void {
  res.setHeader("Content-Security-Policy", DEMO_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  // 刻意不设置 X-Frame-Options / frame-ancestors：Studio 需要通过 iframe 嵌入预览。
  // 隔离性由 iframe sandbox="allow-scripts"（无 allow-same-origin）保证，而非拒绝嵌入。
}

function resolveRequestPath(
  rootDir: string,
  requestUrl: string,
): { ok: true; filePath: string } | { ok: false; status: number } {
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(requestUrl, "http://localhost").pathname,
    );
  } catch {
    return { ok: false, status: 400 };
  }

  if (pathname.includes("\0")) return { ok: false, status: 400 };
  if (pathname === "/" || pathname === "") pathname = `/${DEMO_ENTRY}`;

  const relative = pathname.replace(/^\/+/, "");
  const filePath = path.resolve(rootDir, relative);
  const root = path.resolve(rootDir);

  // 包含性判断必须在 resolve 之后做：`a/../../etc/passwd` 只有解析后才暴露
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return { ok: false, status: 403 };
  }
  // 拒绝隐藏文件（.stagent 的元数据、编辑器临时文件等）
  if (path.basename(filePath).startsWith("."))
    return { ok: false, status: 404 };

  return { ok: true, filePath };
}

export function createDemoPreviewServer(
  options: DemoPreviewServerOptions,
): DemoPreviewServer {
  const rootDir = path.resolve(options.rootDir);
  const host = options.host ?? "127.0.0.1";
  const startPort = options.startPort ?? DEMO_PREVIEW_PORT_RANGE.start;
  const endPort = options.endPort ?? DEMO_PREVIEW_PORT_RANGE.end;

  let server: http.Server | null = null;
  let current: DemoPreviewHandle | null = null;

  const handler = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void => {
    applySecurityHeaders(res);

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    const resolved = resolveRequestPath(rootDir, req.url ?? "/");
    if (!resolved.ok) {
      res.statusCode = resolved.status;
      res.end(
        resolved.status === 403
          ? "Forbidden"
          : resolved.status === 404
            ? "Not Found"
            : "Bad Request",
      );
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved.filePath);
    } catch {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    if (!stat.isFile()) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    // 兜底闸门：即使有文件绕过生成器直接落进目录，预览也不放大它
    if (stat.size > MAX_DEMO_FILE_BYTES) {
      res.statusCode = 413;
      res.end("Demo asset exceeds the 2MB limit");
      return;
    }

    res.setHeader("Content-Type", contentTypeFor(resolved.filePath));
    res.setHeader("Content-Length", String(stat.size));
    res.statusCode = 200;

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(resolved.filePath);
    stream.on("error", () => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
    stream.pipe(res);
  };

  const listenOnce = (port: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const candidate = http.createServer(handler);
      const onError = (err: Error): void => {
        candidate.off("listening", onListening);
        candidate.close(() => undefined);
        reject(err);
      };
      const onListening = (): void => {
        candidate.off("error", onError);
        server = candidate;
        resolve();
      };
      candidate.once("error", onError);
      candidate.once("listening", onListening);
      candidate.listen({ port, host });
    });

  return {
    get handle() {
      return current;
    },

    async start(): Promise<DemoPreviewHandle> {
      if (current && server) return current;

      let lastError: unknown = null;

      // 端口冲突时逐个回退：findAvailablePort 与真正 listen 之间存在竞态
      // （探针关闭后可能被别的进程抢走），所以必须对 listen 本身也做重试。
      for (let port = startPort; port <= endPort; port++) {
        let chosen: number;
        try {
          chosen = await findAvailablePort({
            startPort: port,
            endPort,
            host,
          });
        } catch {
          break; // 区间已耗尽
        }

        try {
          await listenOnce(chosen);
          current = {
            port: chosen,
            url: `http://${host}:${chosen}/`,
            origin: `http://${host}:${chosen}`,
          };
          return current;
        } catch (err) {
          lastError = err;
          // 抢占失败则从下一个端口继续，而不是把错误直接抛给调用方
          port = Math.max(port, chosen);
        }
      }

      throw new Error(
        `[E_DEMO_PREVIEW_UNAVAILABLE] no available port in ${startPort}-${endPort}: ` +
          `${lastError instanceof Error ? lastError.message : "range exhausted"}`,
      );
    },

    async stop(): Promise<void> {
      const active = server;
      server = null;
      current = null;
      if (!active) return;
      await new Promise<void>((resolve) => active.close(() => resolve()));
    },
  };
}

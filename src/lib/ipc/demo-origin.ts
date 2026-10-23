/**
 * Demo 预览 Origin 防线（架构 §4.4 P-16 / TASK-S.4）。
 *
 * 为什么需要单独一条判定：Daemon 现有的 `isLocalOrigin` 只检查主机名是否为
 * 回环地址（127.0.0.1 / localhost / ::1），**不看端口**。而 Demo 预览服务恰好
 * 也跑在 127.0.0.1 上，于是 `http://127.0.0.1:4100` 会被误判为"本地合法来源"，
 * 进而拿到 CORS 通行证——这正是模型生成的页面借 iframe 直连控制面的路径。
 *
 * 本模块把"这是 Demo 预览端口"这一事实独立成可测函数，Daemon 在 HTTP 与 WS
 * 入口统一调用，避免两处各写一份端口区间而漂移。
 */

/** 与 `daemon/supervisor/demo/types.ts` 的区间保持一致（此处独立定义以免跨层依赖） */
export const DEMO_PREVIEW_PORT_START = 4100;
export const DEMO_PREVIEW_PORT_END = 4110;

/** 命中时返回给调用方的稳定标识，便于日志与前端提示 */
export const DEMO_ORIGIN_FORBIDDEN = "E_DEMO_ORIGIN_FORBIDDEN";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * 判断某个 Origin 是否来自 Demo 预览服务（或等价的"沙箱不透明源"）。
 *
 * 命中条件：
 * 1. `Origin: null` —— `sandbox="allow-scripts"` 且无 `allow-same-origin` 的 iframe
 *    处于不透明源，浏览器发出的请求 Origin 就是字符串 `null`。这不是"缺少 Origin"，
 *    而是"一个无法追溯身份的源"，必须与 Demo 端口同等对待；
 * 2. `http(s)://<回环主机>:4100~4110` —— Demo 预览服务的实际监听区间。
 *
 * 注意与「没有 Origin」区分：普通 curl、服务端到服务端调用不带该头，应继续放行，
 * 否则会误伤 CLI 与内部调用。因此缺省返回 `false`。
 */
export function isDemoPreviewOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return false;
  if (origin === "null") return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return false;

  const port =
    url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  return (
    Number.isInteger(port) &&
    port >= DEMO_PREVIEW_PORT_START &&
    port <= DEMO_PREVIEW_PORT_END
  );
}

/**
 * Demo iframe 沙箱属性（架构 §4.4 / TASK-S.4 / TASK-C.2）。
 *
 * 与 `daemon/supervisor/demo/types.ts` 的 `DEMO_IFRAME_SANDBOX` 保持一致，
 * 前端独立一份以免跨层依赖。**禁止**追加 `allow-same-origin`。
 */
export const DEMO_IFRAME_SANDBOX = "allow-scripts" as const;

/** 供 `<iframe {...demoIframeProps(url)} />` 直接展开；不得手写 sandbox 字面量。 */
export function demoIframeProps(url: string): {
  src: string;
  sandbox: typeof DEMO_IFRAME_SANDBOX;
  referrerPolicy: "no-referrer";
  title: string;
} {
  return {
    src: url,
    sandbox: DEMO_IFRAME_SANDBOX,
    referrerPolicy: "no-referrer",
    title: "Demo 原型预览",
  };
}

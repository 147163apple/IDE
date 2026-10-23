/**
 * 真机预览 Origin 防线（TASK-S.6b / 架构 §2.4 PreviewServiceRegistry）。
 *
 * 与 Demo（4100–4110）错开：真机预览占用 4200–4210，避免 iframe 借回环
 * Origin 直连 Daemon。判定逻辑与 demo-origin 对称，独立模块以免跨层依赖。
 */

export const REAL_PREVIEW_PORT_START = 4200;
export const REAL_PREVIEW_PORT_END = 4210;

export const REAL_ORIGIN_FORBIDDEN = "E_REAL_PREVIEW_ORIGIN_FORBIDDEN";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * 判断 Origin 是否来自真机预览端口（或沙箱不透明源 `null`）。
 * 缺省 Origin（curl / 服务端调用）返回 false，不误伤 CLI。
 */
export function isRealPreviewOrigin(origin: string | undefined): boolean {
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
    port >= REAL_PREVIEW_PORT_START &&
    port <= REAL_PREVIEW_PORT_END
  );
}

/**
 * 真机预览 iframe：用户自己的工程，允许 same-origin + forms，
 * 与 Demo（仅 allow-scripts）不同——真机要能点真实交互。
 */
export const REAL_PLAYTEST_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups" as const;

export function realPlaytestIframeProps(url: string): {
  src: string;
  sandbox: typeof REAL_PLAYTEST_IFRAME_SANDBOX;
  referrerPolicy: "no-referrer";
  title: string;
} {
  return {
    src: url,
    sandbox: REAL_PLAYTEST_IFRAME_SANDBOX,
    referrerPolicy: "no-referrer",
    title: "真机预览",
  };
}

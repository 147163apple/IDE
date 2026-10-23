/**
 * TASK-S.4 Demo 静态原型与 Mock 预览服务 —— 共享类型与硬约束。
 *
 * 三条不可协商的边界：
 * 1. **单文件 ≤ 2MB**：落盘前以 UTF-8 字节数判定，超限抛
 *    `E_DEMO_PAYLOAD_TOO_LARGE`，绝不"先写后删"或按字符数糊弄；
 * 2. **只能写进受控目录**：资源路径必须是相对路径、不得含 `..`、
 *    不得以 `/` 开头，解析后必须仍在 Demo 根目录之内；
 * 3. **预览服务必须是独立 Origin**：只绑 127.0.0.1 的 4100~4110，
 *    严禁与 Daemon 端口复用（同 Origin 会让 iframe 直连控制面）。
 */

/** 单文件落盘硬上限：2MB（规范 §4.4 / 卡片「单文件落盘上限 ≤ 2MB」） */
export const MAX_DEMO_FILE_BYTES = 2 * 1024 * 1024;

/** 预览服务端口区间：与 Daemon（3001~3010）和测试端口段（35xx~37xx）均不重叠 */
export const DEMO_PREVIEW_PORT_RANGE = { start: 4100, end: 4110 } as const;

/** Demo 默认落地目录（相对仓库根） */
export const DEMO_ROOT = ".stagent/demo" as const;

/** 快照子目录（相对 Demo 根） */
export const DEMO_SNAPSHOTS_DIR = "snapshots" as const;

/** 单页原型的入口文件名 */
export const DEMO_ENTRY = "index.html" as const;

/**
 * 当前生效资源的清单文件（隐藏文件，预览服务拒绝下发）。
 * 回退时据此删除"快照里没有、但现在还在"的旧资源，避免残留文件继续被访问。
 */
export const DEMO_MANIFEST = ".demo-manifest.json" as const;

/** 一个待落盘的原型资源 */
export interface DemoAsset {
  /** 相对 Demo 根的资源路径，例如 "index.html" / "app.js" */
  readonly path: string;
  /** 文本内容（原型只允许纯静态文本资源） */
  readonly content: string;
}

/** 生成结果：入口 + 全部资源 */
export interface GeneratedDemo {
  readonly entry: string;
  readonly assets: readonly DemoAsset[];
  /** 全部资源的 UTF-8 字节总数，便于审计与日志 */
  readonly totalBytes: number;
}

/** 快照元数据，落在 `<snapshot>/meta.json` */
export interface DemoSnapshotMeta {
  readonly snapshot_id: string;
  readonly created_at: string;
  /** 生成该快照时的需求摘要，便于用户识别回退点 */
  readonly label?: string;
  readonly entry: string;
  readonly files: readonly string[];
  readonly total_bytes: number;
}

/** 预览服务句柄 */
export interface DemoPreviewHandle {
  readonly url: string;
  readonly port: number;
  readonly origin: string;
}

/**
 * 前端嵌入原型时必须使用的 sandbox 值（架构 §4.4 P-16）。
 *
 * 只给 `allow-scripts`：页面能跑原型脚本，但**没有** `allow-same-origin`，
 * 因此处于不透明源，读不到 IDE 的 Cookie / localStorage / session-token，
 * 也无法把同源请求伪装成"自己人"。这个常量是唯一事实源，UI 侧不得手写字面量。
 */
export const DEMO_IFRAME_SANDBOX = "allow-scripts" as const;

/** 供前端直接展开到 <iframe {...demoIframeProps(url)} /> 的属性集合 */
export function demoIframeProps(url: string): {
  src: string;
  sandbox: typeof DEMO_IFRAME_SANDBOX;
  referrerPolicy: "no-referrer";
} {
  return {
    src: url,
    sandbox: DEMO_IFRAME_SANDBOX,
    referrerPolicy: "no-referrer",
  };
}

export class DemoSecurityError extends Error {
  readonly code: "E_DEMO_UNSAFE_PATH";

  constructor(message: string) {
    super(message);
    this.name = "DemoSecurityError";
    this.code = "E_DEMO_UNSAFE_PATH";
  }
}

/**
 * 校验资源路径并归一化。
 *
 * 拒绝：绝对路径、`..` 段、Windows 盘符、反斜杠、空路径、隐藏的父级逃逸。
 * 不依赖 `path.resolve` 做安全判断（先拼接再比较容易漏掉大小写/符号链接情形），
 * 而是先做语法级拒绝，再由调用方断言解析结果仍在根目录内。
 */
export function normalizeDemoAssetPath(rawPath: string): string {
  const candidate = rawPath.trim();
  if (candidate.length === 0) {
    throw new DemoSecurityError("Demo asset path must not be empty");
  }
  if (candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate)) {
    throw new DemoSecurityError(`Demo asset path must be relative: ${rawPath}`);
  }
  if (candidate.includes("\\")) {
    throw new DemoSecurityError(
      `Demo asset path must use POSIX separators: ${rawPath}`,
    );
  }
  const segments = candidate.split("/");
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    throw new DemoSecurityError(
      `Demo asset path must not contain traversal segments: ${rawPath}`,
    );
  }
  if (segments.some((segment) => segment.length === 0)) {
    throw new DemoSecurityError(
      `Demo asset path must not contain empty segments: ${rawPath}`,
    );
  }
  return segments.join("/");
}

/** 以 UTF-8 字节数判断资源是否超过单文件硬上限 */
export function byteLengthOf(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

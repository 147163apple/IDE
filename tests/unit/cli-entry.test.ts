import { describe, it, expect, afterEach } from "vitest";
import {
  assertLoopbackUiUrl,
  buildUiLaunchUrl,
  parseArgs,
  resolveBrowserOpener,
  DEFAULT_UI_URL,
} from "../../bin/stagent";

/**
 * TASK-D.1 CLI 引导入口单元测试。
 * 覆盖参数解析、浏览器唤起地址构造（Token 仅走 fragment）、
 * 平台 opener 选择（结构化 argv，无 shell）。
 */

describe("stagent CLI 参数解析", () => {
  it("默认：start 命令、cwd 仓库、默认 UI 地址、唤起浏览器", () => {
    const opts = parseArgs(["start"]);
    expect(opts.command).toBe("start");
    expect(opts.repo).toBe(process.cwd());
    expect(opts.uiUrl).toBe(DEFAULT_UI_URL);
    expect(opts.noBrowser).toBe(false);
    expect(opts.port).toBeUndefined();
  });

  it("解析 --repo / --port / --ui-url / --no-browser", () => {
    const opts = parseArgs([
      "start",
      "--repo",
      ".",
      "--port",
      "3005",
      "--ui-url",
      "http://localhost:5173/app",
      "--no-browser",
    ]);
    expect(opts.command).toBe("start");
    expect(opts.port).toBe(3005);
    expect(opts.uiUrl).toBe("http://localhost:5173/app");
    expect(opts.noBrowser).toBe(true);
  });

  it("未知命令回退 help", () => {
    expect(parseArgs(["bogus"]).command).toBe("help");
  });
});

describe("浏览器唤起地址构造（Token 仅走 fragment）", () => {
  it("Token 出现在 fragment，绝不出现在 query", () => {
    const url = buildUiLaunchUrl("http://localhost:5173/", "secret-token-64");
    expect(url).toContain("#token=secret-token-64");
    expect(url).not.toContain("?token=");
    expect(new URL(url).searchParams.get("token")).toBeNull();
  });

  it("剔除目标 URL 上残留的旧 ?token= query", () => {
    const url = buildUiLaunchUrl(
      "http://localhost:5173/?token=stale&x=1",
      "fresh-token",
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("token")).toBeNull();
    expect(parsed.searchParams.get("x")).toBe("1");
    expect(parsed.hash).toBe("#token=fresh-token");
  });
});

describe("URL 安全守卫（--ui-url / STAGENT_UI_URL 仅允许本地回环）", () => {
  afterEach(() => {
    delete process.env["STAGENT_UI_URL"];
  });

  it("放行 http://localhost:* 与 http://127.0.0.1:*（任意端口、路径）", () => {
    expect(() => assertLoopbackUiUrl("http://localhost:5173")).not.toThrow();
    expect(() =>
      assertLoopbackUiUrl("http://localhost:5173/app"),
    ).not.toThrow();
    expect(() => assertLoopbackUiUrl("http://127.0.0.1:3000")).not.toThrow();
    expect(assertLoopbackUiUrl(DEFAULT_UI_URL).hostname).toBe("localhost");
  });

  it.each([
    ["https://evil.example.com", "外网 https"],
    ["http://evil.example.com", "外网 http 域名"],
    ["http://192.168.1.10:5173", "局域网 IP（非回环）"],
    ["https://localhost:5173", "https 协议（即使回环也拒绝）"],
    ["http://localhost.evil.example.com", "域名前缀伪装"],
    ["http://localhost@evil.example.com", "userinfo 伪装主机"],
    ["http://evil.example.com@localhost:5173", "userinfo 伪装回环"],
    ["http://[::1]:5173", "IPv6 回环不在白名单（严格限定两主机名）"],
    ["not-a-url", "非法 URL"],
    ["", "空串"],
  ])("拒绝：%s（%s）", (bad) => {
    expect(() => assertLoopbackUiUrl(bad)).toThrow(/拒绝启动/);
  });

  it("buildUiLaunchUrl 对外部地址抛错：Token 绝不随链接外发", () => {
    expect(() =>
      buildUiLaunchUrl("https://evil.example.com/", "secret-token"),
    ).toThrow(/拒绝启动/);
  });

  it("STAGENT_UI_URL 环境变量与 --ui-url 同源受守卫约束", () => {
    process.env["STAGENT_UI_URL"] = "https://evil.example.com";
    const opts = parseArgs(["start"]);
    // parseArgs 只负责取值；守卫在 start 流程副作用前强制拦截
    expect(opts.uiUrl).toBe("https://evil.example.com");
    expect(() => assertLoopbackUiUrl(opts.uiUrl)).toThrow(/拒绝启动/);
  });
});

describe("平台浏览器 opener（结构化 argv，无 shell）", () => {
  it("macOS 使用 open", () => {
    expect(
      resolveBrowserOpener("http://localhost:5173/#token=t", "darwin"),
    ).toEqual(["open", ["http://localhost:5173/#token=t"]]);
  });

  it("Linux 使用 xdg-open", () => {
    expect(
      resolveBrowserOpener("http://localhost:5173/#token=t", "linux"),
    ).toEqual(["xdg-open", ["http://localhost:5173/#token=t"]]);
  });

  it("Windows 使用 rundll32（start 是 cmd 内建命令，不经 shell 不可直接 execFile）", () => {
    expect(
      resolveBrowserOpener("http://localhost:5173/#token=t", "win32"),
    ).toEqual([
      "rundll32",
      ["url.dll,FileProtocolHandler", "http://localhost:5173/#token=t"],
    ]);
  });
});

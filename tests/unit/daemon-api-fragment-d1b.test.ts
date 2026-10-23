/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseFragmentBootstrap,
  inferSameOriginDaemonBase,
  normalizeBaseUrl,
  loadConnection,
  TOKEN_STORAGE_KEY,
  DEFAULT_DAEMON_URL,
} from "../../src/lib/daemon-api";

describe("fragment / 同源引导（TASK-D.1b）", () => {
  it("parseFragmentBootstrap 解析 token 与 base", () => {
    const a = parseFragmentBootstrap("#token=deadbeef");
    expect(a.token).toBe("deadbeef");
    expect(a.baseUrl).toBeNull();

    const b = parseFragmentBootstrap(
      `#token=abc&base=${encodeURIComponent("http://127.0.0.1:3007")}`,
    );
    expect(b.token).toBe("abc");
    expect(b.baseUrl).toBe("http://127.0.0.1:3007");
  });

  it("parseFragmentBootstrap 剥掉 token 里的换行", () => {
    const r = parseFragmentBootstrap("#token=ab%0Ac");
    expect(r.token).toBe("abc");
  });

  it("inferSameOriginDaemonBase 仅接受 3001~3010 回环", () => {
    expect(
      inferSameOriginDaemonBase({
        hostname: "127.0.0.1",
        port: "3005",
        origin: "http://127.0.0.1:3005",
      }),
    ).toBe("http://127.0.0.1:3005");
    expect(
      inferSameOriginDaemonBase({
        hostname: "localhost",
        port: "5173",
        origin: "http://localhost:5173",
      }),
    ).toBeNull();
    expect(
      inferSameOriginDaemonBase({
        hostname: "example.com",
        port: "3001",
        origin: "http://example.com:3001",
      }),
    ).toBeNull();
  });

  it("normalizeBaseUrl 去尾斜杠", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:3002/")).toBe(
      "http://127.0.0.1:3002",
    );
    expect(normalizeBaseUrl("")).toBe(DEFAULT_DAEMON_URL);
  });
});

describe("loadConnection 集成（jsdom）", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("读取 #token= 与 base= 后抹除 hash，并写入 sessionStorage", () => {
    window.history.replaceState(
      null,
      "",
      `/#token=caffee01&base=${encodeURIComponent("http://127.0.0.1:3008")}`,
    );
    const conn = loadConnection();
    expect(conn.token).toBe("caffee01");
    expect(conn.baseUrl).toBe("http://127.0.0.1:3008");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe("caffee01");
    expect(window.location.hash).toBe("");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertHeaderValueSafe,
  authorizationHeaderValue,
  DEFAULT_DAEMON_URL,
  listContracts,
  loadConnection,
  normalizeBaseUrl,
  normalizeSessionToken,
  saveConnection,
  TOKEN_STORAGE_KEY,
} from "../lib/daemon-api";

/**
 * TASK-D.1 Token 引导通道（浏览器侧）：
 * - FAIL 项：URL query（?token=）绝不被读取
 * - fragment（#token=）读取后立即从地址栏抹除（history.replaceState）
 * - 默认 Daemon 地址与规范端口范围（3001~3010）一致
 */

function setLocation(url: string): void {
  window.history.replaceState(null, "", url);
}

describe("loadConnection：Token 引导通道", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setLocation("http://localhost:3000/");
  });

  it("URL query 中的 token 被忽略（规范 FAIL 项）", () => {
    setLocation("http://localhost:3000/?token=query-token-should-ignore");
    const conn = loadConnection();
    expect(conn.token).toBe("");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("fragment 中的 token 被接收，且地址栏被抹除", () => {
    setLocation("http://localhost:3000/#token=fragment-token-ok");
    const conn = loadConnection();
    expect(conn.token).toBe("fragment-token-ok");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe("fragment-token-ok");
    // 抹除后地址栏不再携带 token（不进历史、不被后续脚本读取）
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("fragment-token-ok");
  });

  it("无引导参数时沿用 sessionStorage 中的既有连接", () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, "stored-token");
    sessionStorage.setItem("stagent.baseUrl", "http://127.0.0.1:3007");
    setLocation("http://localhost:3000/");
    const conn = loadConnection();
    expect(conn.token).toBe("stored-token");
    expect(conn.baseUrl).toBe("http://127.0.0.1:3007");
  });

  it("默认 Daemon 地址落在规范端口范围 3001~3010 的起点", () => {
    expect(DEFAULT_DAEMON_URL).toBe("http://127.0.0.1:3001");
    setLocation("http://localhost:3000/");
    const conn = loadConnection();
    expect(conn.baseUrl).toBe(DEFAULT_DAEMON_URL);
  });

  it("无 fragment 且 sessionStorage 为空时，退回 localStorage 作一次性引导源（自动化回放只能预置 localStorage）", () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "localstorage-seed-token");
    localStorage.setItem("stagent.baseUrl", "https://proxy.example.com");
    setLocation("http://localhost:3000/");
    const conn = loadConnection();
    expect(conn.token).toBe("localstorage-seed-token");
    expect(conn.baseUrl).toBe("https://proxy.example.com");
    // 落回 sessionStorage，后续逻辑（如 saveConnection）走原有同一条路径
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe(
      "localstorage-seed-token",
    );
  });

  it("fragment 引导存在时忽略 localStorage（fragment 优先级更高）", () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "localstorage-seed-token");
    setLocation("http://localhost:3000/#token=fragment-token-ok");
    const conn = loadConnection();
    expect(conn.token).toBe("fragment-token-ok");
  });
});

/**
 * 真实线上故障回归（2026-10-22）：
 *
 *   Failed to execute 'fetch' on 'Window': Failed to read the 'headers' property
 *   from 'RequestInit': String contains non ISO-8859-1 code point.
 *
 * 成因：粘贴 Token 时混进换行/全角空格/中文，`authorization` 头里出现
 * 码点 > 255 的字符，浏览器在 fetch 入口直接抛错（请求根本没发出去），
 * 而错误文案完全指不到"Token 脏了"。
 *
 * 防线分三层，这里逐层钉住：
 * 1. 写入/读取边界归一（全角→半角、去零宽、去换行、trim）；
 * 2. 组装 Authorization 前把非 ASCII 变成一句能照着操作的白话错误；
 * 3. 任何 header 值越界都在发请求前报错，并点名是哪个 header。
 */
describe("Token / header 的非 ASCII 防线", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setLocation("http://localhost:3000/");
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("normalizeSessionToken：去掉换行、全角空格、零宽字符与两端空白", () => {
    // 模拟「cat .stagent/session-token | pbcopy」后粘贴的结果
    const dirty = "\n\uFEFF　a1b2c3d4\u200B\n";
    expect(normalizeSessionToken(dirty)).toBe("a1b2c3d4");
  });

  it("normalizeSessionToken：全角字母数字归一为半角（NFKC）", () => {
    expect(normalizeSessionToken("ＡＢＣ１２３")).toBe("ABC123");
  });

  it("normalizeSessionToken：误把「Bearer xxx」整段粘进来时剥掉前缀", () => {
    expect(normalizeSessionToken("Bearer  abc123")).toBe("abc123");
    expect(normalizeSessionToken("bearer abc123")).toBe("abc123");
  });

  it("saveConnection 落盘前归一，sessionStorage 里不留换行", () => {
    saveConnection({ baseUrl: "http://127.0.0.1:3001/", token: " tok\n" });
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe("tok");
    // 尾部斜杠一并去掉，否则 `${baseUrl}/api/...` 会拼出 //api 导致全体 404
    expect(sessionStorage.getItem("stagent.baseUrl")).toBe(
      "http://127.0.0.1:3001",
    );
  });

  it("loadConnection 会把历史遗留的脏 Token 洗干净", () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, "　deadbeef\n\u200B");
    setLocation("http://localhost:3000/");
    expect(loadConnection().token).toBe("deadbeef");
  });

  it("normalizeBaseUrl：空串回落到默认地址，尾斜杠被去掉", () => {
    expect(normalizeBaseUrl("   ")).toBe(DEFAULT_DAEMON_URL);
    expect(normalizeBaseUrl("http://127.0.0.1:3007///")).toBe(
      "http://127.0.0.1:3007",
    );
  });

  it("Authorization 里只剩 ASCII：脏 Token 会被归一后才交给 fetch", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit): Promise<unknown> => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ contracts: [] }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listContracts({
      baseUrl: "http://127.0.0.1:3001",
      token: "\n abc123 \u200B",
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer abc123");
    // 逐字节确认：没有一个码点越界，浏览器不会再抛 ISO-8859-1 错误
    for (const value of Object.values(headers)) {
      expect(value).toMatch(/^[\x20-\xFF]*$/);
    }
  });

  it("Token 里混入中文：发请求前就抛白话错误，fetch 一次都不调", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listContracts({ baseUrl: "http://127.0.0.1:3001", token: "abc中文" }),
    ).rejects.toThrow(/非 ASCII 字符/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authorizationHeaderValue：正常 Token 原样拼 Bearer，空 Token 不报错", () => {
    expect(authorizationHeaderValue("deadbeef")).toBe("Bearer deadbeef");
    expect(authorizationHeaderValue("  ")).toBe("Bearer ");
  });

  it("assertHeaderValueSafe：拦住任何被误塞进 header 的中文（title/intent 之类）", () => {
    expect(() => assertHeaderValueSafe("x-title", "把按钮换成圆角")).toThrow(
      /x-title/,
    );
    expect(() =>
      assertHeaderValueSafe("x-title", "plain ascii ok"),
    ).not.toThrow();
  });
});

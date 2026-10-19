// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DAEMON_URL,
  loadConnection,
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
  });

  afterEach(() => {
    sessionStorage.clear();
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
});

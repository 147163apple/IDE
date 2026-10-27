import { describe, it, expect } from "vitest";
import { deriveWsUrl } from "@/lib/ipc/client";

describe("deriveWsUrl", () => {
  it("无 baseUrl 时回退 host/port（本机同端口开发场景）", () => {
    expect(deriveWsUrl({ port: 3001, token: "t" })).toBe(
      "ws://127.0.0.1:3001/ws",
    );
    expect(deriveWsUrl({ port: 3007, token: "t", host: "localhost" })).toBe(
      "ws://localhost:3007/ws",
    );
  });

  it("baseUrl 为 http 时推导 ws，保留端口", () => {
    expect(
      deriveWsUrl({ port: 3001, token: "t", baseUrl: "http://127.0.0.1:3001" }),
    ).toBe("ws://127.0.0.1:3001/ws");
  });

  it("baseUrl 为 https 时推导 wss，省略默认端口——反向代理场景不得固定回环地址", () => {
    expect(
      deriveWsUrl({
        port: 3001,
        token: "t",
        baseUrl: "https://8787-sandbox123.example.com",
      }),
    ).toBe("wss://8787-sandbox123.example.com/ws");
  });

  it("baseUrl 畸形时回退 host/port", () => {
    expect(deriveWsUrl({ port: 3001, token: "t", baseUrl: "not a url" })).toBe(
      "ws://127.0.0.1:3001/ws",
    );
  });
});

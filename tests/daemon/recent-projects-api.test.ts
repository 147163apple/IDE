import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createDaemon, type StagentDaemon } from "../../daemon/server";

function requestJson<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: T;
          try {
            body = raw ? (JSON.parse(raw) as T) : ({} as T);
          } catch {
            body = raw as unknown as T;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

describe("TASK-D.1c recent-projects API", () => {
  let repo: string;
  let home: string;
  let daemon: StagentDaemon | null = null;
  let prevHome: string | undefined;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1c-api-repo-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1c-api-home-"));
    prevHome = process.env["STAGENT_HOME"];
    process.env["STAGENT_HOME"] = home;
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    if (prevHome === undefined) delete process.env["STAGENT_HOME"];
    else process.env["STAGENT_HOME"] = prevHome;
    safeRmSync(repo);
    safeRmSync(home);
  });

  it("无 Token 拒绝 GET/POST", async () => {
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3601,
      endPort: 3610,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    const base = `http://127.0.0.1:${info.port}`;
    const get = await requestJson(`${base}/api/recent-projects`);
    expect(get.status).toBe(401);
    const post = await requestJson(`${base}/api/recent-projects/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: repo }),
    });
    expect(post.status).toBe(401);
  });

  it("GET 列表可见；POST 当前路径返回带 #token= 的 launchUrl", async () => {
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3611,
      endPort: 3620,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken();
    expect(token).toBeTruthy();
    const base = `http://127.0.0.1:${info.port}`;
    const auth = { authorization: `Bearer ${token}` };

    const listed = await requestJson<{ items: Array<{ path: string }> }>(
      `${base}/api/recent-projects`,
      { headers: auth },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.items.some((i) => i.path === path.resolve(repo))).toBe(
      true,
    );

    const opened = await requestJson<{
      launchUrl: string;
      path: string;
      reused: boolean;
    }>(`${base}/api/recent-projects/open`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path: repo }),
    });
    expect(opened.status).toBe(200);
    expect(opened.body.path).toBe(path.resolve(repo));
    expect(opened.body.reused).toBe(true);
    expect(opened.body.launchUrl).toContain("#token=");
    expect(opened.body.launchUrl).not.toContain("?token=");
    // 响应可含 token，但不得出现在错误对象外的明文日志约定由实现保证；此处断言形态
    expect(opened.body.launchUrl).toContain(token!);
  });

  it("C.8c：粘贴已存在目录可打开；不存在则 E_PATH_NOT_FOUND；锁冲突白话 409", async () => {
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3621,
      endPort: 3630,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken()!;
    const base = `http://127.0.0.1:${info.port}`;
    const auth = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const missing = path.join(os.tmpdir(), `stagent-missing-${Date.now()}`);
    const denied = await requestJson<{ error: string; code?: string }>(
      `${base}/api/recent-projects/open`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ path: missing }),
      },
    );
    expect(denied.status).toBe(400);
    expect(denied.body.code).toBe("E_PATH_NOT_FOUND");

    const other = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1c-other-"));
    try {
      // 制造「进程在跑但不健康」的锁 → 409（无需先入最近列表；C.8c 允许粘贴）
      const stagentDir = path.join(other, ".stagent");
      fs.mkdirSync(stagentDir, { recursive: true });
      fs.writeFileSync(
        path.join(stagentDir, "stagent.pid"),
        JSON.stringify({
          pid: process.pid, // 当前测试进程「活着」
          port: 65533,
          repoRoot: other,
          startedAt: new Date().toISOString(),
          version: "0.1.0",
        }),
      );
      // 无 session-token → tryReuse 失败；进程仍活 → PidLockError
      const locked = await requestJson<{ error: string; code?: string }>(
        `${base}/api/recent-projects/open`,
        {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ path: other }),
        },
      );
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe("E_WORKSPACE_LOCKED");
      expect(locked.body.error).toMatch(
        /已经在跑|不要重复启动|E_WORKSPACE_LOCKED/,
      );
    } finally {
      safeRmSync(other);
    }
  });

  it("C.8c：无钥匙可 POST /api/session/relaunch 拿到 launchUrl", async () => {
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3631,
      endPort: 3640,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken()!;
    const base = `http://127.0.0.1:${info.port}`;

    const relaunch = await requestJson<{
      launchUrl: string;
      path: string;
      reused: boolean;
    }>(`${base}/api/session/relaunch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(relaunch.status).toBe(200);
    expect(relaunch.body.path).toBe(path.resolve(repo));
    expect(relaunch.body.reused).toBe(true);
    expect(relaunch.body.launchUrl).toContain("#token=");
    expect(relaunch.body.launchUrl).not.toContain("?token=");
    expect(relaunch.body.launchUrl).toContain(token);
  });
});

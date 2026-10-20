import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createDaemon, type StagentDaemon } from "../../daemon/server";

/**
 * C.5 安全修复回归：/diff 与 /diff-files 的合同 ID 必须是白名单字符，
 * 且解析后的路径必须落在 .stagent/worktrees 内；否则 400，绝不返回任何内容。
 */

function getJson<T>(
  url: string,
  token: string,
): Promise<{ statusCode: number; body: T }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      { headers: { authorization: `Bearer ${token}` } },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: unknown = {};
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          resolve({ statusCode: res.statusCode ?? 0, body: body as T });
        });
      },
    );
    req.on("error", reject);
  });
}

describe("C.5 Diff 端点：合同 ID 与路径包含性", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let baseUrl = "";
  let token = "";

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-diff-api-"));
    daemon = createDaemon({ repoRoot: repo, startPort: 3555, endPort: 3565 });
    const info = await daemon.start();
    baseUrl = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    try {
      fs.rmSync(repo, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  });

  it("穿越型合同 ID 一律被拦（400 或路由归一化后的 404），绝不 200", async () => {
    const attacks = [
      "/api/contracts/..%2F..%2F..%2Fetc/diff",
      "/api/contracts/..%2F..%2F..%2Fetc/diff-files",
      "/api/contracts/%2E%2E%2F%2E%2E/diff-files",
      "/api/contracts/a%2Fb/diff",
      "/api/contracts/%2E%2E/diff",
    ];
    for (const attack of attacks) {
      const res = await getJson<{ error?: string }>(
        `${baseUrl}${attack}`,
        token,
      );
      expect([400, 404], attack).toContain(res.statusCode);
      const body = JSON.stringify(res.body);
      expect(body, attack).not.toContain("/.stagent/worktrees");
      expect(body, attack).not.toContain("diff --git");
    }
  });

  it("非法百分号编码返回 400，而不是 500", async () => {
    const res = await getJson<{ error?: string }>(
      `${baseUrl}/api/contracts/%E0%A4%A/diff`,
      token,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Invalid URL encoding");
  });

  it("合法但不存在的合同返回 404，不泄露任何路径内容", async () => {
    for (const endpoint of ["diff", "diff-files"]) {
      const res = await getJson<{ error?: string }>(
        `${baseUrl}/api/contracts/not_existing_contract/${endpoint}`,
        token,
      );
      expect(res.statusCode).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("/.stagent/worktrees");
    }
  });
});

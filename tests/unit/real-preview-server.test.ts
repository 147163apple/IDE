import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRealPreviewServer,
  writeRealPlaytestStub,
  type RealPreviewServer,
} from "../../daemon/supervisor/preview/real-preview-server";

const tmpRoots: string[] = [];
const servers: RealPreviewServer[] = [];

function newRoot(): string {
  const base = path.join(process.cwd(), ".tmp", "unit-real-preview");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "case-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    if (s) await s.stop();
  }
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("real-preview-server（TASK-S.6b）", () => {
  it("stub 页在 4200–4210 可访问，status RUNNING", async () => {
    const root = newRoot();
    writeRealPlaytestStub(root, "通宵试玩桩");
    const statuses: string[] = [];
    const server = createRealPreviewServer({
      contractId: "ctr-stub",
      rootDir: root,
      onStatusChange: (p) => statuses.push(p.status),
    });
    servers.push(server);
    const handle = await server.start();
    expect(handle.owned).toBe(true);
    expect(handle.port).toBeGreaterThanOrEqual(4200);
    expect(handle.port).toBeLessThanOrEqual(4210);
    expect(statuses).toContain("RUNNING");

    const html = await new Promise<string>((resolve, reject) => {
      http
        .get(handle.url, (res) => {
          expect(res.statusCode).toBe(200);
          expect(
            String(res.headers["content-security-policy"] ?? ""),
          ).toContain("connect-src 'self'");
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        })
        .on("error", reject);
    });
    expect(html).toContain("真机预览");
    expect(html).toContain("通宵试玩桩");

    await server.stop();
    expect(statuses.at(-1)).toBe("STOPPED");
  });

  it("attachUrl 外链挂载不启自建进程", async () => {
    const server = createRealPreviewServer({
      contractId: "ctr-attach",
      attachUrl: "http://127.0.0.1:4207/app/",
    });
    servers.push(server);
    const handle = await server.start();
    expect(handle.owned).toBe(false);
    expect(handle.url).toContain("127.0.0.1:4207");
    expect(handle.port).toBe(4207);
  });
});

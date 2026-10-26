import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { isDaemonCodeStale } from "../../daemon/core/open-workspace";

describe("isDaemonCodeStale (C.10h 热修 · 源码新于 Daemon 启动)", () => {
  it("探针 mtime 晚于 startedAt → 过期；早于则不过期", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-skew-"));
    try {
      const server = path.join(tmp, "daemon", "server.ts");
      fs.mkdirSync(path.dirname(server), { recursive: true });
      fs.writeFileSync(server, "// probe\n");
      const mtimeMs = Date.now() - 60_000;
      fs.utimesSync(server, mtimeMs / 1000, mtimeMs / 1000);

      // 启动时间比文件新 → 代码未变新
      expect(
        isDaemonCodeStale({
          packageRoot: tmp,
          startedAt: new Date(mtimeMs + 30_000).toISOString(),
        }),
      ).toBe(false);

      // 启动时间比文件旧 → 启动后源码改过，需退役
      expect(
        isDaemonCodeStale({
          packageRoot: tmp,
          startedAt: new Date(mtimeMs - 30_000).toISOString(),
        }),
      ).toBe(true);
    } finally {
      safeRmSync(tmp);
    }
  });

  it("无探针文件 → 不误判过期", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-skew-empty-"));
    try {
      expect(
        isDaemonCodeStale({
          packageRoot: tmp,
          startedAt: "2000-01-01T00:00:00.000Z",
        }),
      ).toBe(false);
    } finally {
      safeRmSync(tmp);
    }
  });

  it("非法 startedAt → 不误判过期", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-skew-bad-"));
    try {
      const server = path.join(tmp, "daemon", "server.ts");
      fs.mkdirSync(path.dirname(server), { recursive: true });
      fs.writeFileSync(server, "x\n");
      expect(
        isDaemonCodeStale({
          packageRoot: tmp,
          startedAt: "not-a-date",
        }),
      ).toBe(false);
    } finally {
      safeRmSync(tmp);
    }
  });
});

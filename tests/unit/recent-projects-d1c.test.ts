import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearRecentProjects,
  isRecentProjectPath,
  readRecentProjects,
  recentProjectsPath,
  recordRecentProject,
  resolveStagentHome,
} from "../../daemon/core/recent-projects";

describe("TASK-D.1c 最近项目落盘（本机配置，非业务仓）", () => {
  let home: string;

  afterEach(() => {
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("STAGENT_HOME 优先于 ~./stagent", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-home-"));
    const resolved = resolveStagentHome({ STAGENT_HOME: home }, () => "/nope");
    expect(resolved).toBe(path.resolve(home));
  });

  it("record 去重置顶并截断；文件 mode 尽量 0600", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-recent-"));
    const a = path.join(home, "proj-a");
    const b = path.join(home, "proj-b");
    fs.mkdirSync(a);
    fs.mkdirSync(b);

    recordRecentProject(a, {
      homeDir: home,
      now: () => new Date("2026-10-24T01:00:00.000Z"),
    });
    recordRecentProject(b, {
      homeDir: home,
      now: () => new Date("2026-10-24T02:00:00.000Z"),
    });
    // 再次打开 a → a 置顶
    recordRecentProject(a, {
      homeDir: home,
      now: () => new Date("2026-10-24T03:00:00.000Z"),
    });

    const items = readRecentProjects({ homeDir: home });
    expect(items.map((i) => i.path)).toEqual([a, b]);
    expect(items[0]?.name).toBe("proj-a");
    expect(isRecentProjectPath(a, { homeDir: home })).toBe(true);
    expect(
      isRecentProjectPath(path.join(home, "other"), { homeDir: home }),
    ).toBe(false);

    const filePath = recentProjectsPath(home);
    expect(fs.existsSync(filePath)).toBe(true);
    // 不落在业务仓 .stagent/session-token 旁冒充保护区配置
    expect(
      filePath.includes(`${path.sep}.stagent${path.sep}session-token`),
    ).toBe(false);
    if (process.platform !== "win32") {
      const mode = fs.statSync(filePath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("maxItems 截断", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-recent-max-"));
    for (let i = 0; i < 5; i += 1) {
      const p = path.join(home, `p${i}`);
      fs.mkdirSync(p);
      recordRecentProject(p, {
        homeDir: home,
        maxItems: 3,
        now: () => new Date(Date.UTC(2026, 9, 24, 0, i)),
      });
    }
    const items = readRecentProjects({ homeDir: home });
    expect(items).toHaveLength(3);
    expect(items[0]?.name).toBe("p4");
  });

  it("clear 后为空", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-recent-clear-"));
    const p = path.join(home, "x");
    fs.mkdirSync(p);
    recordRecentProject(p, { homeDir: home });
    clearRecentProjects({ homeDir: home });
    expect(readRecentProjects({ homeDir: home })).toEqual([]);
  });
});

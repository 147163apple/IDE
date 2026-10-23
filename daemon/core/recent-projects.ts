/**
 * TASK-D.1c：最近工作区列表（本机用户级配置，非业务仓保护区）。
 *
 * 落盘：`$STAGENT_HOME/recent-projects.json`，缺省 `~/.stagent/recent-projects.json`。
 * 不写业务仓 `.stagent/`（该目录有会话密钥 / PID / 受保护边界，Worker 不可当配置仓用）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RECENT_PROJECTS_FILENAME = "recent-projects.json";
export const DEFAULT_MAX_RECENT = 12;
export const RECENT_PROJECTS_VERSION = 1 as const;

export interface RecentProjectEntry {
  /** 绝对路径（已 resolve） */
  path: string;
  /** 展示名：目录 basename */
  name: string;
  /** ISO 时间：最近一次成功打开 */
  lastOpenedAt: string;
}

export interface RecentProjectsFile {
  version: typeof RECENT_PROJECTS_VERSION;
  items: RecentProjectEntry[];
}

export interface RecentProjectsOptions {
  /** 覆盖本机配置根；测试注入用 */
  homeDir?: string;
  maxItems?: number;
  now?: () => Date;
}

/** 本机 Stagent 用户配置根（非业务仓） */
export function resolveStagentHome(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => os.homedir(),
): string {
  const override = env["STAGENT_HOME"]?.trim();
  if (override) return path.resolve(override);
  return path.join(homedir(), ".stagent");
}

export function recentProjectsPath(homeDir?: string): string {
  return path.join(homeDir ?? resolveStagentHome(), RECENT_PROJECTS_FILENAME);
}

function emptyFile(): RecentProjectsFile {
  return { version: RECENT_PROJECTS_VERSION, items: [] };
}

function normalizeEntryPath(repoPath: string): string {
  return path.resolve(repoPath);
}

function entryName(repoPath: string): string {
  const base = path.basename(repoPath);
  return base.length > 0 ? base : repoPath;
}

export function readRecentProjects(
  options: RecentProjectsOptions = {},
): RecentProjectEntry[] {
  const filePath = recentProjectsPath(options.homeDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RecentProjectsFile>;
    if (!parsed || !Array.isArray(parsed.items)) return [];
    const items: RecentProjectEntry[] = [];
    for (const item of parsed.items) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as RecentProjectEntry).path === "string" &&
        (item as RecentProjectEntry).path.trim().length > 0
      ) {
        const p = normalizeEntryPath((item as RecentProjectEntry).path);
        items.push({
          path: p,
          name:
            typeof (item as RecentProjectEntry).name === "string" &&
            (item as RecentProjectEntry).name.trim().length > 0
              ? (item as RecentProjectEntry).name
              : entryName(p),
          lastOpenedAt:
            typeof (item as RecentProjectEntry).lastOpenedAt === "string"
              ? (item as RecentProjectEntry).lastOpenedAt
              : new Date(0).toISOString(),
        });
      }
    }
    // 最新在前
    items.sort((a, b) => (a.lastOpenedAt < b.lastOpenedAt ? 1 : -1));
    return items;
  } catch {
    return [];
  }
}

function writeRecentProjectsFile(
  items: RecentProjectEntry[],
  homeDir?: string,
): void {
  const home = homeDir ?? resolveStagentHome();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(home, 0o700);
  } catch {
    // Windows 等无 Unix 权限位
  }
  const filePath = recentProjectsPath(home);
  const payload: RecentProjectsFile = {
    version: RECENT_PROJECTS_VERSION,
    items,
  };
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // ignore
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore
  }
}

/**
 * 成功打开工作区后写入最近列表：去重、置顶、截断。
 */
export function recordRecentProject(
  repoPath: string,
  options: RecentProjectsOptions = {},
): RecentProjectEntry[] {
  const resolved = normalizeEntryPath(repoPath);
  const maxItems = options.maxItems ?? DEFAULT_MAX_RECENT;
  const now = (options.now ?? (() => new Date()))().toISOString();
  const existing = readRecentProjects(options).filter(
    (item) => item.path !== resolved,
  );
  const next: RecentProjectEntry[] = [
    { path: resolved, name: entryName(resolved), lastOpenedAt: now },
    ...existing,
  ].slice(0, maxItems);
  writeRecentProjectsFile(next, options.homeDir);
  return next;
}

/** 规范化后是否在最近列表中（一点重开只允许列表内路径） */
export function isRecentProjectPath(
  repoPath: string,
  options: RecentProjectsOptions = {},
): boolean {
  const resolved = normalizeEntryPath(repoPath);
  return readRecentProjects(options).some((item) => item.path === resolved);
}

/** 测试辅助：清空最近列表文件 */
export function clearRecentProjects(options: RecentProjectsOptions = {}): void {
  writeRecentProjectsFile(emptyFile().items, options.homeDir);
}

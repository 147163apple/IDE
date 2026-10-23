import fs from "node:fs";
import path from "node:path";
import { StagentRuntimeError } from "../../../src/lib/error-codes";
import {
  DEMO_MANIFEST,
  DEMO_SNAPSHOTS_DIR,
  MAX_DEMO_FILE_BYTES,
  byteLengthOf,
  normalizeDemoAssetPath,
  type DemoSnapshotMeta,
  type GeneratedDemo,
} from "./types";

/**
 * TASK-S.4 / 卡片「增量原型演进与历史快照回退」。
 *
 * 每次需求变更生成一份带时间戳与随机后缀的快照，历史落入
 * `<demoRoot>/snapshots/<snapshot_id>/`；回退时把该快照的资源写回生效目录，
 * 并按清单删除"快照里没有"的旧资源，保证回退后不会残留上一版页面。
 *
 * 快照 ID 同时充当目录名，因此必须做严格白名单校验——否则一个伪造的
 * `../../` 就能把回退变成任意目录覆盖。
 */

const SNAPSHOT_ID_PATTERN = /^snap_[0-9A-Za-z_-]{6,64}$/;

export interface CreateSnapshotOptions {
  readonly label?: string;
  /** 注入时钟与随机源，便于测试得到确定性 ID */
  readonly now?: () => Date;
  readonly nonce?: () => string;
}

export class DemoSecurityViolation extends Error {
  readonly code = "E_DEMO_UNSAFE_PATH" as const;
}

function defaultNonce(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function makeSnapshotId(
  now: () => Date = () => new Date(),
  nonce: () => string = defaultNonce,
): string {
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  return `snap_${stamp}_${nonce()}`;
}

export function assertSnapshotId(snapshotId: string): string {
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) {
    throw new DemoSecurityViolation(
      `Invalid snapshot id: ${snapshotId} (expected /^snap_[0-9A-Za-z_-]{6,64}$/)`,
    );
  }
  return snapshotId;
}

function snapshotDir(demoRoot: string, snapshotId: string): string {
  return path.join(demoRoot, DEMO_SNAPSHOTS_DIR, assertSnapshotId(snapshotId));
}

/**
 * 把当前原型固化为一份快照。
 *
 * 写盘前重新校验尺寸与路径：快照是"另一份落盘"，不能假设调用方已经检查过。
 */
export function createSnapshot(
  demoRoot: string,
  demo: GeneratedDemo,
  options: CreateSnapshotOptions = {},
): DemoSnapshotMeta {
  const snapshotId = makeSnapshotId(options.now, options.nonce);
  const dir = snapshotDir(demoRoot, snapshotId);
  fs.mkdirSync(dir, { recursive: true });

  const files: string[] = [];
  let totalBytes = 0;

  for (const asset of demo.assets) {
    const relative = normalizeDemoAssetPath(asset.path);
    const bytes = byteLengthOf(asset.content);
    if (bytes > MAX_DEMO_FILE_BYTES) {
      throw new StagentRuntimeError(
        "E_DEMO_PAYLOAD_TOO_LARGE",
        `Demo snapshot asset ${asset.path} is ${bytes} bytes, exceeds ${MAX_DEMO_FILE_BYTES} (TASK-S.4)`,
      );
    }

    const absPath = path.resolve(dir, relative);
    if (!absPath.startsWith(dir + path.sep)) {
      throw new DemoSecurityViolation(
        `Snapshot asset escapes snapshot dir: ${asset.path}`,
      );
    }

    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, asset.content, "utf8");
    files.push(relative);
    totalBytes += bytes;
  }

  const meta: DemoSnapshotMeta = {
    snapshot_id: snapshotId,
    created_at: (options.now?.() ?? new Date()).toISOString(),
    ...(options.label === undefined ? {} : { label: options.label }),
    entry: demo.entry,
    files,
    total_bytes: totalBytes,
  };

  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8",
  );

  return meta;
}

/** 读取全部快照元数据，按时间倒序（最新的在前）；坏快照跳过而不阻断列表 */
export function listSnapshots(demoRoot: string): DemoSnapshotMeta[] {
  const root = path.join(demoRoot, DEMO_SNAPSHOTS_DIR);
  if (!fs.existsSync(root)) return [];

  const metas: DemoSnapshotMeta[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(root, entry.name, "meta.json");
    try {
      const parsed = JSON.parse(
        fs.readFileSync(metaPath, "utf8"),
      ) as DemoSnapshotMeta;
      if (parsed && parsed.snapshot_id === entry.name) metas.push(parsed);
    } catch {
      // 损坏的快照不参与回退候选，但不影响其它快照
    }
  }

  return metas.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export interface RollbackResult {
  readonly meta: DemoSnapshotMeta;
  /** 写回生效目录的资源（相对路径） */
  readonly restored: readonly string[];
  /** 被清理掉的旧资源（相对路径） */
  readonly removed: readonly string[];
}

/**
 * 回退到指定快照。
 *
 * 顺序：读 meta → 校验 ID → 复制快照资源 → 按清单删除多余旧资源 → 重写清单。
 * 删除只针对"清单里记录过、且不在目标快照内"的文件，不做目录级递归删除。
 */
export function rollbackToSnapshot(
  demoRoot: string,
  snapshotId: string,
): RollbackResult {
  const dir = snapshotDir(demoRoot, snapshotId);
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const meta = JSON.parse(
    fs.readFileSync(metaPath, "utf8"),
  ) as DemoSnapshotMeta;
  if (meta.snapshot_id !== snapshotId) {
    throw new DemoSecurityViolation(
      `Snapshot metadata mismatch: expected ${snapshotId}, got ${meta.snapshot_id}`,
    );
  }

  const target = new Set(
    meta.files.map((file) => normalizeDemoAssetPath(file)),
  );
  const previous = readManifest(demoRoot);

  const restored: string[] = [];
  for (const relative of target) {
    const source = path.resolve(dir, relative);
    const destination = path.resolve(demoRoot, relative);
    if (
      !source.startsWith(dir + path.sep) ||
      !destination.startsWith(path.resolve(demoRoot) + path.sep)
    ) {
      throw new DemoSecurityViolation(`Unsafe snapshot path: ${relative}`);
    }
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > MAX_DEMO_FILE_BYTES) {
      throw new StagentRuntimeError(
        "E_DEMO_PAYLOAD_TOO_LARGE",
        `Snapshot asset ${relative} is invalid or exceeds ${MAX_DEMO_FILE_BYTES} bytes`,
      );
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    restored.push(relative);
  }

  const removed: string[] = [];
  for (const relative of previous) {
    if (target.has(relative)) continue;
    const stale = path.resolve(demoRoot, relative);
    if (!stale.startsWith(path.resolve(demoRoot) + path.sep)) continue;
    if (fs.existsSync(stale)) {
      fs.rmSync(stale, { force: true });
      removed.push(relative);
    }
  }

  writeManifest(demoRoot, [...target]);
  return { meta, restored, removed };
}

function readManifest(demoRoot: string): string[] {
  const manifestPath = path.join(demoRoot, DEMO_MANIFEST);
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      files?: unknown;
    };
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files.filter(
      (item): item is string => typeof item === "string",
    );
  } catch {
    return [];
  }
}

function writeManifest(demoRoot: string, files: readonly string[]): void {
  fs.mkdirSync(demoRoot, { recursive: true });
  fs.writeFileSync(
    path.join(demoRoot, DEMO_MANIFEST),
    JSON.stringify({ files, updated_at: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

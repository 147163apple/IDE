/**
 * TASK-H.8：`.stagent/records/` 一键脱敏 zip 导出 + 单项目彻底清理（EO-03/EO-05）。
 * 不上云；清理不得触碰源码工作树业务文件。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { redactDeep } from "../../src/lib/ipc/redaction";
import { RECORDS_ROOT } from "../guard/audit-manifest";

export const E_RECORDS_EXPORT = "E_RECORDS_EXPORT" as const;
export const E_RECORDS_CLEANUP = "E_RECORDS_CLEANUP" as const;

export interface RecordsExportResult {
  ok: boolean;
  zip_path: string;
  entries: string[];
  redacted_files: number;
  error?: string;
  code?: string;
}

export interface RecordsCleanupResult {
  ok: boolean;
  removed: boolean;
  records_dir: string;
  /** 二次清理仍 ok */
  idempotent: true;
  error?: string;
  code?: string;
}

function recordsRootAbs(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), RECORDS_ROOT);
}

function walkFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

/** 对 JSON 内容做 redactDeep 后写到 staging；其它文件原样拷贝（仍避免 .env 名） */
function stageRedactedRecords(
  srcRoot: string,
  staging: string,
): {
  entries: string[];
  redacted_files: number;
} {
  fs.mkdirSync(staging, { recursive: true });
  const entries = walkFiles(srcRoot);
  let redacted_files = 0;
  for (const rel of entries) {
    const src = path.join(srcRoot, rel);
    const dest = path.join(staging, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const base = path.basename(rel).toLowerCase();
    if (base.endsWith(".json")) {
      try {
        const raw = JSON.parse(fs.readFileSync(src, "utf8")) as unknown;
        const safe = redactDeep(raw).value;
        fs.writeFileSync(dest, JSON.stringify(safe, null, 2), "utf8");
        redacted_files += 1;
        continue;
      } catch {
        // fall through copy
      }
    }
    // 疑似密钥文件名：写入占位，不拷贝明文
    if (
      /\.env/i.test(base) ||
      /secret|credential|token|\.pem$|\.key$/i.test(base)
    ) {
      fs.writeFileSync(
        dest,
        JSON.stringify(
          { note: "[REDACTED]", original_name: rel, placeholder: true },
          null,
          2,
        ),
        "utf8",
      );
      redacted_files += 1;
      continue;
    }
    fs.copyFileSync(src, dest);
  }
  return { entries, redacted_files };
}

/**
 * 导出脱敏 zip。默认写到 os.tmpdir()/stagent-records-export-*.zip
 * 依赖系统 `zip`（macOS/Linux 常见）；失败返回 ok:false。
 */
export function exportRedactedRecordsZip(input: {
  repoRoot: string;
  /** 输出 zip 绝对路径；省略则写临时目录 */
  outPath?: string;
  now?: () => Date;
}): RecordsExportResult {
  const src = recordsRootAbs(input.repoRoot);
  const stamp = (input.now?.() ?? new Date())
    .toISOString()
    .replace(/[:.]/g, "-");
  const outPath =
    input.outPath ?? path.join(os.tmpdir(), `stagent-records-${stamp}.zip`);

  if (!fs.existsSync(src)) {
    return {
      ok: false,
      zip_path: outPath,
      entries: [],
      redacted_files: 0,
      error: "尚无 .stagent/records/ 可导出",
      code: E_RECORDS_EXPORT,
    };
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-rec-stage-"));
  try {
    const { entries, redacted_files } = stageRedactedRecords(src, staging);
    if (entries.length === 0) {
      return {
        ok: false,
        zip_path: outPath,
        entries: [],
        redacted_files: 0,
        error: "records 目录为空",
        code: E_RECORDS_EXPORT,
      };
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (fs.existsSync(outPath)) fs.rmSync(outPath, { force: true });
    const zip = spawnSync("zip", ["-r", "-q", outPath, "."], {
      cwd: staging,
      encoding: "utf8",
    });
    if (zip.status !== 0) {
      return {
        ok: false,
        zip_path: outPath,
        entries,
        redacted_files,
        error: zip.stderr || zip.stdout || "zip 命令失败",
        code: E_RECORDS_EXPORT,
      };
    }
    return { ok: true, zip_path: outPath, entries, redacted_files };
  } catch (err) {
    return {
      ok: false,
      zip_path: outPath,
      entries: [],
      redacted_files: 0,
      error: err instanceof Error ? err.message : String(err),
      code: E_RECORDS_EXPORT,
    };
  } finally {
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * 单项目彻底清理 `.stagent/records/`（含 baseline 等 records 子树）。
 * 不触碰源码；幂等：目录已不存在仍 ok。
 */
export function cleanupProjectRecords(repoRoot: string): RecordsCleanupResult {
  const records_dir = recordsRootAbs(repoRoot);
  const root = path.resolve(repoRoot);
  // 安全：必须落在 repo/.stagent/records
  const expected = path.join(root, ".stagent", "records");
  if (path.resolve(records_dir) !== path.resolve(expected)) {
    return {
      ok: false,
      removed: false,
      records_dir,
      idempotent: true,
      error: "拒绝清理：路径未落在 .stagent/records",
      code: E_RECORDS_CLEANUP,
    };
  }
  try {
    if (!fs.existsSync(records_dir)) {
      return { ok: true, removed: false, records_dir, idempotent: true };
    }
    fs.rmSync(records_dir, { recursive: true, force: true });
    return { ok: true, removed: true, records_dir, idempotent: true };
  } catch (err) {
    return {
      ok: false,
      removed: false,
      records_dir,
      idempotent: true,
      error: err instanceof Error ? err.message : String(err),
      code: E_RECORDS_CLEANUP,
    };
  }
}

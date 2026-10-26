/**
 * TASK-C.14b：基线档案落盘 `.stagent/records/baseline/`（禁止 contract_000）。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { redactDeep } from "../../src/lib/ipc/redaction";
import {
  BASELINE_RECORDS_ROOT,
  type BaselineArchive,
  type BaselineReviewStatus,
} from "./types";

export const ARCHIVE_FILENAME = "archive.json" as const;
export const LATEST_POINTER = "latest.json" as const;

export function baselineRoot(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), BASELINE_RECORDS_ROOT);
}

export function baselineScanDir(repoRoot: string, scanId: string): string {
  const safe = sanitizeScanId(scanId);
  return path.join(baselineRoot(repoRoot), safe);
}

function sanitizeScanId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  if (!cleaned || /^contract_?0+$/i.test(cleaned) || cleaned === "contract_000") {
    return `baseline-${randomUUID().slice(0, 8)}`;
  }
  return cleaned;
}

export function newBaselineScanId(now = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, "-");
  return `baseline-${ts}-${randomUUID().slice(0, 8)}`;
}

export function writeBaselineArchive(
  repoRoot: string,
  archive: BaselineArchive,
): { dir: string; file: string } {
  if (archive.kind !== "project_baseline_archive") {
    throw new Error("invalid baseline kind");
  }
  if (/contract_000/i.test(archive.scan_id)) {
    throw new Error("禁止使用 contract_000 作为基线 scan_id");
  }
  const safe = redactDeep(archive).value as BaselineArchive;
  // 强制：确认永不授予施工写权
  safe.grants_construction = false;

  const dir = baselineScanDir(repoRoot, safe.scan_id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ARCHIVE_FILENAME);
  fs.writeFileSync(file, JSON.stringify(safe, null, 2), "utf8");

  const pointer = path.join(baselineRoot(repoRoot), LATEST_POINTER);
  fs.writeFileSync(
    pointer,
    JSON.stringify(
      {
        scan_id: safe.scan_id,
        relative_dir: path.posix.join(
          BASELINE_RECORDS_ROOT,
          path.basename(dir),
        ),
        updated_at: safe.scanned_at,
      },
      null,
      2,
    ),
    "utf8",
  );
  return { dir, file };
}

export function readBaselineArchive(
  repoRoot: string,
  scanId?: string,
): BaselineArchive | null {
  try {
    let id = scanId;
    if (!id) {
      const pointer = path.join(baselineRoot(repoRoot), LATEST_POINTER);
      if (!fs.existsSync(pointer)) return null;
      const raw = JSON.parse(fs.readFileSync(pointer, "utf8")) as {
        scan_id?: string;
      };
      id = raw.scan_id;
    }
    if (!id) return null;
    const file = path.join(baselineScanDir(repoRoot, id), ARCHIVE_FILENAME);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as BaselineArchive;
    if (parsed.kind !== "project_baseline_archive") return null;
    if (/contract_000/i.test(parsed.scan_id)) return null;
    parsed.grants_construction = false;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 认可此基线作为后续参考 —— 不签发 exec_token、不改 Delivery。
 */
export function acceptBaselineAsReference(
  repoRoot: string,
  scanId?: string,
  now = () => new Date(),
): BaselineArchive {
  const current = readBaselineArchive(repoRoot, scanId);
  if (!current) {
    throw new Error("没有可确认的基线档案");
  }
  const next: BaselineArchive = {
    ...current,
    review_status: "accepted" satisfies BaselineReviewStatus,
    accepted_at: now().toISOString(),
    grants_construction: false,
    notes: [
      ...current.notes.filter((n) => !n.startsWith("accepted:")),
      "accepted:用户已审阅并同意作为后续需求讨论参考；不代表质量验收或施工授权",
    ],
  };
  writeBaselineArchive(repoRoot, next);
  return next;
}

export function assertBaselineDoesNotGrantConstruction(
  archive: BaselineArchive,
): void {
  if (archive.grants_construction !== false) {
    throw new Error("基线档案不得授予施工写权");
  }
}

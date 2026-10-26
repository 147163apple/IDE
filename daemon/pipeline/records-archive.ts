/**
 * TASK-C.12d：MERGED 后向 `.stagent/records/{contract_id}/` 轻量无依赖拷贝。
 * 失败不得标 DELIVERED（由调用方根据 ok=false 阻断）。
 */
import fs from "node:fs";
import path from "node:path";
import {
  RECORDS_ROOT,
  recordsDir,
  writeAuditManifest,
  type AuditManifest,
} from "../guard/audit-manifest";
import { prototypeRelativeRoot, readDemoConfirm } from "../supervisor/demo/prototypes";

export interface RecordsArchiveResult {
  ok: boolean;
  records_dir: string;
  copied: string[];
  error?: string;
  manifest?: AuditManifest;
}

function copyFileSafe(src: string, dest: string): boolean {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

/**
 * 轻量拷贝：Demo 快照（若有）+ 简易元数据；并写 audit-manifest。
 * 不依赖 Git remote。
 */
export function archiveContractRecords(input: {
  repoRoot: string;
  contract_id: string;
  prototype_id?: string | null;
  snapshot?: unknown;
  assertion_ids?: readonly string[];
  commit_sha?: string | null;
  events?: unknown[];
}): RecordsArchiveResult {
  const dir = recordsDir(input.repoRoot, input.contract_id);
  const copied: string[] = [];

  try {
    fs.mkdirSync(dir, { recursive: true });

    // Demo 确认元数据
    const confirm = readDemoConfirm(
      input.repoRoot,
      input.prototype_id ?? undefined,
    );
    if (confirm) {
      const dest = path.join(dir, "demo-confirm.json");
      fs.writeFileSync(dest, JSON.stringify(confirm, null, 2), "utf8");
      copied.push("demo-confirm.json");
    }

    // prototypes 入口快照（若存在）
    const protoId = input.prototype_id ?? confirm?.prototype_id;
    if (protoId) {
      const rel = prototypeRelativeRoot(protoId);
      const srcHtml = path.join(input.repoRoot, rel, "index.html");
      const srcMeta = path.join(input.repoRoot, rel, "meta.json");
      if (fs.existsSync(srcHtml)) {
        if (copyFileSafe(srcHtml, path.join(dir, "demo-index.html"))) {
          copied.push("demo-index.html");
        }
      }
      if (fs.existsSync(srcMeta)) {
        if (copyFileSafe(srcMeta, path.join(dir, "demo-meta.json"))) {
          copied.push("demo-meta.json");
        }
      }
    }

    // 合同侧车摘要
    const summaryPath = path.join(dir, "delivery-summary.json");
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          contract_id: input.contract_id,
          archived_at: new Date().toISOString(),
          records_root: RECORDS_ROOT,
          commit_sha: input.commit_sha ?? null,
        },
        null,
        2,
      ),
      "utf8",
    );
    copied.push("delivery-summary.json");

    const manifest = writeAuditManifest(input.repoRoot, {
      contract_id: input.contract_id,
      snapshot: input.snapshot ?? {
        contract_id: input.contract_id,
        copied,
      },
      events: input.events ?? [{ type: "RECORDS_ARCHIVED", copied }],
      assertion_ids: input.assertion_ids,
      commit_sha: input.commit_sha,
    });
    copied.push("audit-manifest.json");

    return { ok: true, records_dir: dir, copied, manifest };
  } catch (err) {
    return {
      ok: false,
      records_dir: dir,
      copied,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * DELIVERED 门禁：records 归档失败则不得标 DELIVERED。
 */
export function assertRecordsReadyForDelivered(
  repoRoot: string,
  contractId: string,
): void {
  const dir = recordsDir(repoRoot, contractId);
  const manifest = path.join(dir, "audit-manifest.json");
  if (!fs.existsSync(manifest)) {
    const err = new Error(
      `records 归档未完成（缺少 audit-manifest），禁止标 DELIVERED`,
    ) as Error & { code: string };
    err.code = "E_RECORDS_ARCHIVE_REQUIRED";
    throw err;
  }
}

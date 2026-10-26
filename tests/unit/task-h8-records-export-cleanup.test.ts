/**
 * TASK-H.8：脱敏 zip 无明文密钥；清理幂等且不删源码。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupProjectRecords,
  exportRedactedRecordsZip,
} from "../../daemon/pipeline/records-export-cleanup";
import { RECORDS_ROOT } from "../../daemon/guard/audit-manifest";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-h8-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("TASK-H.8 records export + cleanup", () => {
  it("导出 zip 可解开且抽样无未脱敏密钥样式字段", () => {
    const root = tmp();
    const records = path.join(root, RECORDS_ROOT, "contracts");
    fs.mkdirSync(records, { recursive: true });
    fs.writeFileSync(
      path.join(records, "manifest.json"),
      JSON.stringify({
        api_key: "sk-secret-should-redact",
        token: "Bearer abc.def",
        title: "合同归档",
      }),
      "utf8",
    );
    fs.writeFileSync(path.join(root, "README.md"), "# keep me\n", "utf8");

    const outZip = path.join(root, "out-redacted.zip");
    const result = exportRedactedRecordsZip({
      repoRoot: root,
      outPath: outZip,
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(outZip)).toBe(true);
    expect(result.entries.some((e) => e.includes("manifest.json"))).toBe(true);

    const unzipDir = path.join(root, "unzipped");
    fs.mkdirSync(unzipDir);
    const uz = spawnSync("unzip", ["-q", outZip, "-d", unzipDir], {
      encoding: "utf8",
    });
    expect(uz.status).toBe(0);
    const exported = fs.readFileSync(
      path.join(unzipDir, "contracts", "manifest.json"),
      "utf8",
    );
    expect(exported).not.toContain("sk-secret-should-redact");
    expect(exported).not.toContain("Bearer abc.def");
    expect(exported).toContain("合同归档");
    // 源码未动
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toContain(
      "keep me",
    );
  });

  it("清理后 records 不存在且二次清理幂等；源码保留", () => {
    const root = tmp();
    const records = path.join(root, RECORDS_ROOT);
    fs.mkdirSync(path.join(records, "x"), { recursive: true });
    fs.writeFileSync(path.join(records, "x", "a.json"), '{"a":1}', "utf8");
    fs.writeFileSync(path.join(root, "src.ts"), "export {}\n", "utf8");

    const first = cleanupProjectRecords(root);
    expect(first.ok).toBe(true);
    expect(first.removed).toBe(true);
    expect(fs.existsSync(records)).toBe(false);
    expect(fs.existsSync(path.join(root, "src.ts"))).toBe(true);

    const second = cleanupProjectRecords(root);
    expect(second.ok).toBe(true);
    expect(second.removed).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(fs.existsSync(path.join(root, "src.ts"))).toBe(true);
  });
});

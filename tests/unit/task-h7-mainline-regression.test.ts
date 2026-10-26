/**
 * TASK-H.7：主链路回归套件锁死。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dirtyReportFromPorcelain } from "../../daemon/baseline/dirty-check";
import {
  MAINLINE_NODES,
  REGRESSION_FINGERPRINT,
} from "../../daemon/pipeline/mainline-regression";

describe("TASK-H.7 mainline regression", () => {
  it("回归入口覆盖打开→…→MERGED 关键节点清单", () => {
    expect([...MAINLINE_NODES]).toEqual([
      "open",
      "baseline_dirty",
      "draft_demo",
      "sign",
      "execute",
      "verify",
      "merged",
      "dispute_gray",
      "rework_limit",
      "porcelain_trim",
    ]);
    for (const rel of REGRESSION_FINGERPRINT) {
      expect(fs.existsSync(path.join(process.cwd(), rel)), rel).toBe(true);
    }
  });

  it("porcelain trim 健康：` M styles.css` 计入 styles.css", () => {
    const report = dirtyReportFromPorcelain(" M styles.css\n");
    expect(report.uncommitted).toEqual(["styles.css"]);
    expect(report.uncommitted).not.toContain("tyles.css");
  });

  it("故意破坏 trim 行为时，回归检测失败", () => {
    const badParse = (line: string): string | null => {
      const t = line.trim();
      if (t.length < 4) return null;
      return t.slice(3);
    };
    expect(badParse(" M styles.css")).toBe("tyles.css");
    const good = dirtyReportFromPorcelain(" M styles.css\n").uncommitted[0];
    expect(good).toBe("styles.css");
    expect(good).not.toBe(badParse(" M styles.css"));
  });
});

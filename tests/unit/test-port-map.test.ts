import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 端口登记表守卫：所有测试套件声明的监听端口区间必须两两互斥。
 *
 * 为什么需要这道闸：daemon 的端口是「区间内找第一个空闲口」，两个套件声明了
 * 重叠区间时，并发下谁都能起来，但客户端可能连上「另一个套件」的实例——
 * 表现为断言莫名其妙地失败（首帧收到 ERROR、AUTH 回放拿到 false、快照 409 等），
 * 而不是干脆的 EADDRINUSE。R-10、ipc-stream、presentation-state-wiring 都栽过这个坑。
 *
 * 契约：
 * 1. 任意两个区间不得重叠（**含同一文件内**——同文件虽然串行，但区间重复会让
 *    「这一段归谁」在排障时失去意义，也让新增用例容易越界）；
 * 2. 凡是构造 daemon 的测试文件都必须显式声明区间——`createDaemon` 的默认段是
 *    3001–3010，不声明就等于所有未声明的套件共享同一段，是最隐蔽的撞车源；
 * 3. 本文件的判定逻辑要对「重叠」有牙：合成一组重叠区间必须被检出。
 */

const TESTS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 豁免：port-finder 单测在测「找端口」这个函数本身，需要可预期的区间且不起服务；
 *  本文件是登记表自身。 */
const EXEMPT = new Set([
  "daemon/port-finder.test.ts",
  "unit/test-port-map.test.ts",
]);

interface PortRange {
  file: string;
  line: number;
  start: number;
  end: number;
}

function listTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      listTestFiles(abs, acc);
    } else if (/\.(test|spec)\.tsx?$/.test(entry.name)) {
      acc.push(abs);
    }
  }
  return acc;
}

function rel(abs: string): string {
  return path.relative(TESTS_DIR, abs).split(path.sep).join("/");
}

/** 同一次调用里命中多处时，按出现顺序给出每处的行号 */
function collectRanges(): PortRange[] {
  const ranges: PortRange[] = [];
  for (const abs of listTestFiles(TESTS_DIR)) {
    const file = rel(abs);
    if (EXEMPT.has(file)) continue;
    const source = fs.readFileSync(abs, "utf8");
    // 允许 startPort / endPort 之间跨行（多行对象字面量是主流写法）
    const pattern = /startPort:\s*(\d+)\s*,\s*endPort:\s*(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const line = source.slice(0, match.index).split("\n").length;
      ranges.push({
        file,
        line,
        start: Number(match[1]),
        end: Number(match[2]),
      });
    }
  }
  return ranges.sort(
    (a, b) => a.start - b.start || a.file.localeCompare(b.file),
  );
}

function findOverlaps(ranges: PortRange[]): string[] {
  const issues: string[] = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]!;
      const b = ranges[j]!;
      // 已按起点排序：b 的起点越过 a 的终点就无需再往后比
      if (b.start > a.end) break;
      if (a.start <= b.end && b.start <= a.end) {
        issues.push(
          `${a.file}:${a.line} [${a.start}–${a.end}] ↔ ` +
            `${b.file}:${b.line} [${b.start}–${b.end}]`,
        );
      }
    }
  }
  return issues;
}

function formatMap(ranges: PortRange[]): string {
  return ranges
    .map(
      (r) =>
        `  ${String(r.start).padStart(5)}–${String(r.end).padEnd(5)} ${r.file}:${r.line}`,
    )
    .join("\n");
}

describe("测试套件端口登记表", () => {
  const ranges = collectRanges();

  it("声明了足够多的区间（防止正则失配后静默通过）", () => {
    expect(ranges.length).toBeGreaterThanOrEqual(20);
    for (const r of ranges) {
      expect(r.end, `${r.file}:${r.line} 的区间反向`).toBeGreaterThanOrEqual(
        r.start,
      );
    }
  });

  it("任意两个区间不重叠", () => {
    const overlaps = findOverlaps(ranges);
    expect(
      overlaps,
      `以下端口区间重叠，并发时会把两套 daemon 混在一起：\n${overlaps.join("\n")}\n\n` +
        `当前登记表：\n${formatMap(ranges)}`,
    ).toEqual([]);
  });

  it("构造 daemon 的文件都显式声明了区间（默认段 3001–3010 是隐形撞车源）", () => {
    const offenders: string[] = [];
    for (const abs of listTestFiles(TESTS_DIR)) {
      const file = rel(abs);
      if (EXEMPT.has(file)) continue;
      const source = fs.readFileSync(abs, "utf8");
      if (!/\bcreateDaemon\s*\(/.test(source)) continue;
      if (!/startPort:/.test(source)) offenders.push(file);
    }
    expect(
      offenders,
      `这些文件用默认端口段起 daemon，彼此会在 3001–3010 上撞车：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("判定逻辑有牙：合成重叠区间必须被检出", () => {
    const synthetic: PortRange[] = [
      { file: "a.test.ts", line: 1, start: 4000, end: 4009 },
      { file: "b.test.ts", line: 1, start: 4009, end: 4019 }, // 端点相接也算撞
      { file: "c.test.ts", line: 1, start: 4020, end: 4029 }, // 相邻不撞
    ];
    const issues = findOverlaps(synthetic);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("a.test.ts");
    expect(issues[0]).toContain("b.test.ts");
  });
});

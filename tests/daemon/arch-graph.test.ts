import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildDependencyGraph, DependencyGraph } from "../../daemon/arch/graph";
import {
  loadPathAliases,
  parseSource,
  resolveSpecifier,
} from "../../daemon/arch/parser";

describe("M6 / TASK-B.1 AST 增量依赖图", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-arch-"));
    fs.mkdirSync(path.join(root, "src", "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );
    fs.writeFileSync(
      path.join(root, "src", "a.ts"),
      `import { b } from "./b";\nimport type { C } from "./c";\nexport const a = b;\nexport type A = C;\n`,
    );
    fs.writeFileSync(
      path.join(root, "src", "b.ts"),
      `import { c } from "./c";\nexport const b = c;\n`,
    );
    fs.writeFileSync(
      path.join(root, "src", "c.ts"),
      `import { a } from "./a";\nexport const c = 1;\nexport type C = typeof a;\n`,
    );
    fs.writeFileSync(
      path.join(root, "src", "lib", "x.ts"),
      `export const x = 42;\n`,
    );
    fs.writeFileSync(
      path.join(root, "src", "alias.ts"),
      `import { x } from "@/lib/x";\nexport const y = x;\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("解析 tsconfig paths 别名", () => {
    const aliases = loadPathAliases(root);
    const resolved = resolveSpecifier(
      path.join(root, "src", "alias.ts"),
      "@/lib/x",
      aliases,
    );
    expect(resolved).toBe(path.join(root, "src", "lib", "x.ts"));
  });

  it("识别 import type 与值导入", () => {
    const aliases = loadPathAliases(root);
    const parsed = parseSource(
      path.join(root, "src", "a.ts"),
      fs.readFileSync(path.join(root, "src", "a.ts"), "utf-8"),
      aliases,
    );
    const typeImport = parsed.imports.find((i) => i.specifier === "./c");
    const valueImport = parsed.imports.find((i) => i.specifier === "./b");
    expect(typeImport?.typeOnly).toBe(true);
    expect(valueImport?.typeOnly).toBe(false);
    expect(parsed.exports).toContain("a");
  });

  it("Tarjan 检出跨文件循环依赖", () => {
    const { graph } = buildDependencyGraph({ root });
    const cycles = graph.detectCycles();
    expect(cycles).toHaveLength(1);
    const names = (cycles[0] ?? []).map((p) => path.basename(p)).sort();
    expect(names).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("拓扑排序标记存在环", () => {
    const { graph } = buildDependencyGraph({ root });
    const { order, hasCycle } = graph.topologicalSort();
    expect(hasCycle).toBe(true);
    expect(order.length).toBeGreaterThan(0);
  });

  it("无环图可完成拓扑排序", () => {
    const aliases = loadPathAliases(root);
    const graph = new DependencyGraph();
    const files = [
      ["src/lib/x.ts", "export const x = 1;"],
      ["src/alias.ts", 'import { x } from "@/lib/x"; export const y = x;'],
    ] as const;
    for (const [rel, content] of files) {
      graph.addModule(parseSource(path.join(root, rel), content, aliases));
    }
    const { order, hasCycle } = graph.topologicalSort();
    expect(hasCycle).toBe(false);
    expect(order).toHaveLength(2);
    expect(order[0]?.endsWith("x.ts")).toBe(true);
  });

  it("1000 模块冷启动 ≤1.5s；单文件增量更新 ≤20ms", () => {
    const aliases = loadPathAliases(root);
    const graph = new DependencyGraph();

    const start = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      const file = path.join(root, "src", `gen${i}.ts`);
      const content = `import { x } from "./lib/x";\nexport const v${i} = x + ${i};\n`;
      graph.addModule(parseSource(file, content, aliases));
    }
    const coldMs = performance.now() - start;
    expect(coldMs).toBeLessThan(1500);

    // 预热一次，避免 JIT 抖动影响基线
    graph.updateFile(
      path.join(root, "src", "gen0.ts"),
      "export const v0 = 1;\n",
      aliases,
    );
    const incrementalMs = graph.updateFile(
      path.join(root, "src", "gen0.ts"),
      "export const v0 = 2;\n",
      aliases,
    );
    expect(incrementalMs).toBeLessThan(20);
  });
});

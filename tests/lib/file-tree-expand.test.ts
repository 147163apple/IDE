import { describe, expect, it } from "vitest";
import {
  initialExpandedDirPaths,
  toggleExpandedPath,
} from "../../src/lib/file-tree-expand";
import type { FileNode } from "../../src/components/workspace-types";

const sample: FileNode[] = [
  { name: "README.md", path: "README.md" },
  {
    name: "src",
    path: "src",
    children: [
      { name: "a.ts", path: "src/a.ts" },
      {
        name: "b",
        path: "src/b",
        children: [{ name: "c.ts", path: "src/b/c.ts" }],
      },
    ],
  },
];

describe("file-tree-expand (TASK-C.10g)", () => {
  it("默认只展开根下第一层目录", () => {
    const s = initialExpandedDirPaths(sample);
    expect([...s]).toEqual(["src"]);
    expect(s.has("src/b")).toBe(false);
  });

  it("toggle 可收起再展开", () => {
    const a = toggleExpandedPath(new Set(["src"]), "src");
    expect(a.has("src")).toBe(false);
    const b = toggleExpandedPath(a, "src");
    expect(b.has("src")).toBe(true);
  });
});

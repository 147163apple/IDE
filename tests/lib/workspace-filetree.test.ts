import { describe, expect, it } from "vitest";
import { buildFileTree } from "../../src/components/workspace-adapters";

describe("buildFileTree", () => {
  it("相对路径组树", () => {
    const t = buildFileTree(["src/a.ts", "src/b/c.ts", "README.md"]);
    expect(t.map((n) => n.name)).toEqual(["README.md", "src"]);
    expect(t[1]?.children?.[1]?.children?.[0]?.path).toBe("src/b/c.ts");
  });
});

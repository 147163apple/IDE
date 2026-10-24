import { describe, expect, it } from "vitest";
import {
  absoluteRepoPath,
  createParentRel,
  revealMenuLabel,
  siblingRenamePath,
} from "../../src/lib/file-tree-ops";
import { collapseAllDirPaths } from "../../src/lib/file-tree-expand";

describe("file-tree-ops (C.10i)", () => {
  it("absoluteRepoPath / siblingRename / createParentRel", () => {
    expect(absoluteRepoPath("/tmp/demo", "src/a.ts")).toBe(
      "/tmp/demo/src/a.ts",
    );
    expect(absoluteRepoPath("/tmp/demo/", ".")).toBe("/tmp/demo");
    expect(siblingRenamePath("src/a.ts", "b.ts")).toBe("src/b.ts");
    expect(
      createParentRel({ selectedPath: "src/a.ts", selectedKind: "file" }),
    ).toBe("src");
    expect(createParentRel({ selectedPath: "src", selectedKind: "dir" })).toBe(
      "src",
    );
    expect(createParentRel({ selectedPath: null, selectedKind: null })).toBe(
      "",
    );
  });

  it("reveal 文案与折叠全集", () => {
    expect(revealMenuLabel("MacIntel")).toMatch(/Finder/);
    expect(revealMenuLabel("Win32")).toMatch(/文件管理器/);
    expect(collapseAllDirPaths().size).toBe(0);
  });
});

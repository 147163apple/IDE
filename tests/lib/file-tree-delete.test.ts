import { describe, expect, it } from "vitest";
import { deleteMenuLabel } from "../../src/lib/file-tree-delete";

describe("deleteMenuLabel (C.10h)", () => {
  it("Mac → 废纸篓；其它 → 删除", () => {
    expect(deleteMenuLabel("MacIntel")).toMatch(/废纸篓/);
    expect(deleteMenuLabel("Win32")).toMatch(/删除/);
  });
});

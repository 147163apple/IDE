// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileTree } from "../../src/components/FileTree";
import type { FileNode } from "../../src/components/workspace-types";

const nodes: FileNode[] = [
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

describe("FileTree expand/collapse (TASK-C.10g)", () => {
  it("默认展开第一层：可见 src/a.ts，不可见更深 c.ts", () => {
    render(<FileTree nodes={nodes} rootLabel="/tmp/demo" onOpen={() => {}} />);
    expect(screen.getByTestId("file-tree-dir-src")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("file-tree-file-src/a.ts")).toBeInTheDocument();
    expect(screen.getByTestId("file-tree-dir-src/b")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByTestId("file-tree-file-src/b/c.ts")).toBeNull();
  });

  it("点文件夹可展开/折叠；点文件仍打开", () => {
    const onOpen = vi.fn();
    render(<FileTree nodes={nodes} rootLabel="/tmp/demo" onOpen={onOpen} />);

    fireEvent.click(screen.getByTestId("file-tree-dir-src/b"));
    expect(screen.getByTestId("file-tree-dir-src/b")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("file-tree-file-src/b/c.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("file-tree-dir-src"));
    expect(screen.getByTestId("file-tree-dir-src")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByTestId("file-tree-file-src/a.ts")).toBeNull();

    fireEvent.click(screen.getByTestId("file-tree-file-README.md"));
    expect(onOpen).toHaveBeenCalledWith("README.md");
  });
});

// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileTree } from "../../src/components/FileTree";
import type { FileNode } from "../../src/components/workspace-types";

beforeAll(() => {
  if (typeof globalThis.DOMRect === "undefined") {
    class DOMRectPolyfill {
      x: number;
      y: number;
      width: number;
      height: number;
      top: number;
      left: number;
      bottom: number;
      right: number;
      constructor(x = 0, y = 0, width = 0, height = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.top = y;
        this.left = x;
        this.bottom = y + height;
        this.right = x + width;
      }
      static fromRect(other?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }) {
        return new DOMRectPolyfill(
          other?.x ?? 0,
          other?.y ?? 0,
          other?.width ?? 0,
          other?.height ?? 0,
        );
      }
      toJSON() {
        return {
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height,
          top: this.top,
          left: this.left,
          bottom: this.bottom,
          right: this.right,
        };
      }
    }
    // @ts-expect-error jsdom polyfill
    globalThis.DOMRect = DOMRectPolyfill;
  }
  Element.prototype.getBoundingClientRect = () =>
    new DOMRect(0, 0, 100, 20) as DOMRect;
});

const nodes: FileNode[] = [
  { name: "README.md", path: "README.md" },
  {
    name: "src",
    path: "src",
    children: [{ name: "a.ts", path: "src/a.ts" }],
  },
];

describe("FileTree ops (TASK-C.10i)", () => {
  it("点顶栏路径折叠整树", () => {
    render(<FileTree nodes={nodes} rootLabel="/tmp/demo" onOpen={() => {}} />);
    expect(screen.getByTestId("file-tree-file-src/a.ts")).toBeTruthy();
    fireEvent.click(screen.getByTestId("file-tree-root"));
    expect(screen.queryByTestId("file-tree-file-src/a.ts")).toBeNull();
  });

  it("新建文件按钮打开命名框并回调 onCreate", async () => {
    const onCreate = vi.fn().mockResolvedValue("untitled.txt");
    render(
      <FileTree
        nodes={nodes}
        rootLabel="/tmp/demo"
        onOpen={() => {}}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByTestId("file-tree-new-file"));
    expect(await screen.findByTestId("file-tree-name-dialog")).toBeTruthy();
    const input = screen.getByTestId(
      "file-tree-name-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello.md" } });
    fireEvent.click(screen.getByTestId("file-tree-name-confirm"));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        parent: "",
        name: "hello.md",
        kind: "file",
      });
    });
  });

  it("右键含复制路径 / 重命名 / 删除", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <FileTree
        nodes={nodes}
        rootLabel="/tmp/demo"
        onOpen={() => {}}
        onRename={onRename}
        onDelete={onDelete}
        onReveal={async () => {}}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("file-tree-file-README.md"));
    expect(await screen.findByTestId("file-tree-copy-README.md")).toBeTruthy();
    expect(screen.getByTestId("file-tree-rename-README.md")).toBeTruthy();
    expect(screen.getByTestId("file-tree-delete-README.md")).toBeTruthy();
    expect(screen.getByTestId("file-tree-reveal-README.md")).toBeTruthy();

    fireEvent.click(screen.getByTestId("file-tree-copy-README.md"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("/tmp/demo/README.md");
    });
  });
});

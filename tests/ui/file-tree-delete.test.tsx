// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileTree } from "../../src/components/FileTree";
import type { FileNode } from "../../src/components/workspace-types";

/** jsdom 无 DOMRect.fromRect；Radix ContextMenu 定位需要它 */
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

describe("FileTree delete (TASK-C.10h)", () => {
  it("右键菜单 → 确认后调用 onDelete；取消不调用", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <FileTree
        nodes={nodes}
        rootLabel="/tmp/demo"
        onOpen={() => {}}
        onDelete={onDelete}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("file-tree-file-README.md"));
    const item = await screen.findByTestId("file-tree-delete-README.md");
    fireEvent.click(item);

    expect(await screen.findByTestId("file-tree-delete-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("file-tree-delete-cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("file-tree-delete-confirm")).toBeNull();
    });
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByTestId("file-tree-file-README.md"));
    fireEvent.click(await screen.findByTestId("file-tree-delete-README.md"));
    fireEvent.click(await screen.findByTestId("file-tree-delete-confirm-btn"));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith("README.md");
    });
  });

  it("删除失败展示白话错误，不关闭确认框", async () => {
    const onDelete = vi
      .fn()
      .mockRejectedValue(new Error("「登录」在保护清单里"));
    render(
      <FileTree
        nodes={nodes}
        rootLabel="/tmp/demo"
        onOpen={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("file-tree-file-src/a.ts"));
    fireEvent.click(await screen.findByTestId("file-tree-delete-src/a.ts"));
    fireEvent.click(await screen.findByTestId("file-tree-delete-confirm-btn"));
    expect(
      await screen.findByTestId("file-tree-delete-error"),
    ).toHaveTextContent(/保护清单/);
    expect(screen.getByTestId("file-tree-delete-confirm")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@monaco-editor/react", () => ({
  default: (p: {
    value: string;
    onChange: (v: string) => void;
    options: { readOnly: boolean };
  }) => (
    <textarea
      data-testid="monaco"
      value={p.value}
      readOnly={p.options.readOnly}
      onChange={(e) => p.onChange(e.target.value)}
    />
  ),
}));

const { MonacoEditorPane } =
  await import("../../src/components/MonacoEditorPane");

const SAMPLE = `# 标题一

> 这是引用

\`\`\`ts
const x = 1;
\`\`\`

普通段落。
`;

const io = (
  writable: boolean,
  content = SAMPLE,
  save = vi.fn(async () => {}),
) => ({
  read: vi.fn(async () => ({ content, writable })),
  save,
});

describe("TASK-C.10j Markdown 预览阅读", () => {
  it(".md 默认进入预览：可见标题/引用，不挂 Monaco", async () => {
    render(<MonacoEditorPane path="docs/readme.md" io={io(true)} />);
    const preview = await screen.findByTestId("markdown-preview");
    expect(preview).toBeTruthy();
    expect(preview.querySelector("h1")?.textContent).toBe("标题一");
    expect(preview.querySelector("blockquote")?.textContent).toMatch(/引用/);
    expect(screen.queryByTestId("monaco")).toBeNull();
    expect(screen.getByTestId("monaco-pane")).toHaveAttribute(
      "data-view-mode",
      "preview",
    );
    expect(screen.getByTestId("markdown-view-preview")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("切换到源码后出现 Monaco，可再切回预览", async () => {
    render(<MonacoEditorPane path="docs/readme.md" io={io(true)} />);
    await screen.findByTestId("markdown-preview");
    fireEvent.click(screen.getByTestId("markdown-view-source"));
    expect(await screen.findByTestId("monaco")).toBeTruthy();
    expect(screen.queryByTestId("markdown-preview")).toBeNull();
    expect(screen.getByTestId("monaco-pane")).toHaveAttribute(
      "data-view-mode",
      "source",
    );

    fireEvent.click(screen.getByTestId("markdown-view-preview"));
    await waitFor(() =>
      expect(screen.getByTestId("markdown-preview")).toBeTruthy(),
    );
    expect(screen.queryByTestId("monaco")).toBeNull();
  });

  it("非 Markdown 文件不出现预览切换", async () => {
    render(<MonacoEditorPane path="src/a.ts" io={io(true, "const x = 1")} />);
    expect(await screen.findByTestId("monaco")).toBeTruthy();
    expect(screen.queryByTestId("markdown-view-toggle")).toBeNull();
    expect(screen.queryByTestId("markdown-preview")).toBeNull();
  });

  it("预览模式下保存按钮禁用（改内容请先切源码）", async () => {
    render(<MonacoEditorPane path="docs/x.md" io={io(true)} />);
    await screen.findByTestId("markdown-preview");
    expect(screen.getByText("保存")).toBeDisabled();
  });
});

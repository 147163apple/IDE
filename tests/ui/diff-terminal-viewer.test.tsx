// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DiffViewer } from "../../src/components/diff/DiffViewer";
import { StructuredTerminal } from "../../src/components/StructuredTerminal";
import { parseAnsi, truncateHeadTail } from "../../src/lib/terminal";
import type { DiffFilePairView } from "../../src/lib/daemon-api";

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: {
    original: string;
    modified: string;
    language: string;
  }) => (
    <div
      data-testid="monaco-diff"
      data-original={props.original}
      data-modified={props.modified}
      data-language={props.language}
    />
  ),
  Editor: () => null,
}));

const files: DiffFilePairView[] = [
  {
    path: "src/a.ts",
    status: "modified",
    before: "export const a = 1;\n",
    after: "export const a = 2;\n",
    binary: false,
    truncated: false,
  },
  {
    path: "src/b.ts",
    status: "added",
    before: "",
    after: "export const b = 3;\n",
    binary: false,
    truncated: false,
  },
  {
    path: "logo.bin",
    status: "modified",
    before: "",
    after: "",
    binary: true,
    truncated: false,
  },
];

const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-export const a = 1;",
  "+export const a = 2;",
].join("\n");

describe("TASK-C.5 双栏 Diff 审阅器", () => {
  it("默认双栏：左侧基线、右侧当前，可切换文件与内联视图", () => {
    render(<DiffViewer patch={patch} files={files} />);

    expect(screen.getByTestId("diff-file-list")).toBeInTheDocument();
    const editor = screen.getByTestId("monaco-diff");
    expect(editor).toHaveAttribute("data-original", "export const a = 1;\n");
    expect(editor).toHaveAttribute("data-modified", "export const a = 2;\n");
    expect(editor).toHaveAttribute("data-language", "typescript");

    fireEvent.click(screen.getByTestId("diff-file-src/b.ts"));
    expect(screen.getByTestId("monaco-diff")).toHaveAttribute(
      "data-modified",
      "export const b = 3;\n",
    );

    fireEvent.click(screen.getByTestId("diff-mode-inline"));
    expect(screen.queryByTestId("monaco-diff")).toBeNull();
    expect(screen.getByTestId("diff-viewer")).toHaveTextContent(
      "+export const a = 2;",
    );
  });

  it("二进制文件只提示、不渲染文本对照", () => {
    render(<DiffViewer patch={patch} files={files} />);
    fireEvent.click(screen.getByTestId("diff-file-logo.bin"));
    expect(screen.getByTestId("diff-binary")).toHaveTextContent("二进制文件");
    expect(screen.queryByTestId("monaco-diff")).toBeNull();
  });
});

describe("TASK-C.5 结构化终端回放", () => {
  const makeLines = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      stream: "stdout" as const,
      line: `line ${i}`,
    }));

  it("头尾各保留 200 行，中间折叠并标注省略数量", () => {
    const view = truncateHeadTail(makeLines(600));
    expect(view.head).toHaveLength(200);
    expect(view.tail).toHaveLength(200);
    expect(view.omitted).toBe(200);
    expect(truncateHeadTail(makeLines(400)).omitted).toBe(0);
  });

  it("渲染 ANSI 颜色与 stderr 高亮，超大输出不崩溃", () => {
    render(
      <StructuredTerminal
        lines={[
          { stream: "stdout", line: "\u001b[31m错误\u001b[0m 正常" },
          { stream: "stderr", line: "boom" },
          ...makeLines(600),
        ]}
      />,
    );
    const terminal = screen.getByTestId("structured-terminal");
    expect(terminal).toBeInTheDocument();
    expect(terminal).toHaveTextContent("错误 正常");
    expect(terminal.querySelector(".text-red-500")).toHaveTextContent("错误");
    expect(screen.getByTestId("terminal-omitted")).toHaveTextContent(
      "中间省略 202 行",
    );
    // 头尾都在：第一行与最后一行可见，中间被折叠
    expect(terminal).toHaveTextContent("line 0");
    expect(terminal).toHaveTextContent("line 599");
  });

  it("parseAnsi 丢弃非颜色控制序列，仅保留文本与样式", () => {
    const segs = parseAnsi("\u001b[2K\u001b[32mok\u001b[0m");
    expect(segs.map((s) => s.text).join("")).toBe("ok");
    expect(segs[0]?.className).toContain("text-emerald-500");
  });
});

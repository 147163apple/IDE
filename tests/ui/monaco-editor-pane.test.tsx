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

const io = (
  writable: boolean,
  content = "a",
  save = vi.fn(async () => {}),
) => ({
  read: vi.fn(async () => ({ content, writable })),
  save,
});

describe("TASK-C.3 MonacoEditorPane", () => {
  it("可写文件：绿色可写标记，编辑后保存走 io.save", async () => {
    const f = io(true);
    render(<MonacoEditorPane path="src/a.ts" io={f} />);
    const ed = await screen.findByTestId("monaco");
    expect(screen.getByTestId("file-access")).toHaveAttribute(
      "data-writable",
      "true",
    );
    fireEvent.change(ed, { target: { value: "b" } });
    expect(screen.getByText("● 未保存")).toBeInTheDocument();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(f.save).toHaveBeenCalledWith("src/a.ts", "b"));
    await waitFor(() => expect(screen.queryByText("● 未保存")).toBeNull());
  });
  it("只读文件：只读标记，编辑器 readOnly，保存按钮禁用", async () => {
    render(<MonacoEditorPane path="docs/x.md" io={io(false)} />);
    expect(await screen.findByTestId("monaco")).toHaveAttribute("readonly");
    expect(screen.getByTestId("file-access")).toHaveTextContent("只读");
    expect(screen.getByText("保存")).toBeDisabled();
  });
  it("服务端拒绝保存（403）时显示错误", async () => {
    const f = io(
      true,
      "a",
      vi.fn(async () => {
        throw new Error("GATEWAY_VIOLATION");
      }),
    );
    render(<MonacoEditorPane path="src/a.ts" io={f} />);
    fireEvent.change(await screen.findByTestId("monaco"), {
      target: { value: "z" },
    });
    fireEvent.click(screen.getByText("保存"));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存被拒绝");
  });
  it("reloadKey 变化时重新读取（Agent 改文件后实时刷新）", async () => {
    const f = io(true, "v1");
    const { rerender } = render(
      <MonacoEditorPane path="a.ts" io={f} reloadKey={0} />,
    );
    await screen.findByTestId("monaco");
    f.read.mockResolvedValueOnce({ content: "v2", writable: true });
    rerender(<MonacoEditorPane path="a.ts" io={f} reloadKey={1} />);
    await waitFor(() => expect(screen.getByTestId("monaco")).toHaveValue("v2"));
    expect(f.read).toHaveBeenCalledTimes(2);
  });
});

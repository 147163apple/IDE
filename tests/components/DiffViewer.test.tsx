import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffViewer } from "../../src/components/diff/DiffViewer";

describe("M7 / TASK-C.3 DiffViewer", () => {
  it("空 patch 展示明确提示", () => {
    render(<DiffViewer patch="" />);
    expect(screen.getByTestId("diff-empty")).toHaveTextContent("无代码变更");
  });

  it("增删行按类型着色渲染", () => {
    const patch = [
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-export const a = 1;",
      "+export const a = 2;",
      " context line",
    ].join("\n");
    const { container } = render(
      <DiffViewer patch={patch} filePath="src/a.ts" />,
    );
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(container.textContent).toContain("-export const a = 1;");
    expect(container.textContent).toContain("+export const a = 2;");
    const addLine = [...container.querySelectorAll("div")].find((el) =>
      el.textContent?.startsWith("+export const a = 2;"),
    );
    expect(addLine?.className).toContain("text-emerald-600");
  });
});

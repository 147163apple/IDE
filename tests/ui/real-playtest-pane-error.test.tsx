import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RealPlaytestPane } from "@/components/studio/RealPlaytestPane";

describe("RealPlaytestPane error surfacing", () => {
  it("shows errorMessage even when status is not ERROR (no silent fail)", () => {
    render(
      <RealPlaytestPane
        errorMessage="请先在左侧选一份合同，再启动真机预览。"
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByTestId("real-playtest-error")).toHaveTextContent(
      "请先在左侧选一份合同",
    );
  });

  it("start button remains clickable in empty state", () => {
    const onStart = vi.fn();
    render(<RealPlaytestPane onStart={onStart} />);
    screen.getByTestId("real-playtest-start").click();
    screen.getByTestId("real-playtest-start-empty").click();
    expect(onStart).toHaveBeenCalledTimes(2);
  });
});

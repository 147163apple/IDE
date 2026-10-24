/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OpenProjectEntry } from "../../src/components/layout/OpenProjectEntry";

const fetchMock = vi.fn();

describe("TASK-C.9c OpenProjectEntry 生命周期", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.clear();
    sessionStorage.setItem("stagent.sessionToken", "a".repeat(64));
    sessionStorage.setItem("stagent.baseUrl", "http://127.0.0.1:3005");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("默认收起：不渲染面板", () => {
    render(
      <OpenProjectEntry
        repoName="1020"
        repoPath="/Users/tina/Desktop/1020"
        defaultExpanded={false}
      />,
    );
    expect(screen.queryByTestId("open-project-panel")).toBeNull();
    expect(screen.getByTestId("open-project")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("已连接入口文案降级为切换项目", () => {
    render(
      <OpenProjectEntry repoName="1020" repoPath="/Users/tina/Desktop/1020" />,
    );
    const btn = screen.getByTestId("open-project");
    expect(btn).toHaveAttribute("data-entry-mode", "switch");
    expect(btn).toHaveTextContent("切换项目");
  });

  it("未连接入口仍为打开项目", () => {
    sessionStorage.removeItem("stagent.sessionToken");
    render(<OpenProjectEntry repoName="x" repoPath="/tmp/x" />);
    const btn = screen.getByTestId("open-project");
    expect(btn).toHaveAttribute("data-entry-mode", "open");
    expect(btn).toHaveTextContent("打开项目");
  });

  it("打开成功后关闭面板", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                path: "/tmp/demo",
                name: "demo",
                lastOpenedAt: "2026-10-24T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            path: "/tmp/demo",
            port: 3008,
            reused: true,
            sameOrigin: true,
            uiUrl: "http://127.0.0.1:3008",
            launchUrl: "http://127.0.0.1:3008/#token=deadbeef",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    render(<OpenProjectEntry repoName="x" repoPath="/tmp/x" />);
    fireEvent.click(screen.getByTestId("open-project"));
    expect(screen.getByTestId("open-project-panel")).toBeInTheDocument();
    await waitFor(() => screen.getByTestId("recent-project-item"));
    fireEvent.click(screen.getByTestId("recent-project-item"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("open-project-panel")).toBeNull();
    expect(screen.getByTestId("open-project")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("不含系统选夹", () => {
    render(<OpenProjectEntry repoName="x" repoPath="/tmp/x" />);
    fireEvent.click(screen.getByTestId("open-project"));
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(
      document.querySelector("input[webkitdirectory], input[directory]"),
    ).toBeNull();
  });
});

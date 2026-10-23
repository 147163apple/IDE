/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OpenProjectEntry } from "../../src/components/layout/OpenProjectEntry";

const fetchMock = vi.fn();

describe("TASK-D.1c OpenProjectEntry 最近项目", () => {
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

  it("展开后展示最近列表；无任意路径选择器", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              path: "/Users/tina/Desktop/1020",
              name: "1020",
              lastOpenedAt: "2026-10-24T00:00:00.000Z",
            },
            {
              path: "/tmp/demo",
              name: "demo",
              lastOpenedAt: "2026-10-23T00:00:00.000Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <OpenProjectEntry repoName="1020" repoPath="/Users/tina/Desktop/1020" />,
    );
    fireEvent.click(screen.getByTestId("open-project"));
    expect(screen.getByTestId("open-project-panel")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("recent-projects-list")).toBeInTheDocument();
    });
    const items = screen.getAllByTestId("recent-project-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-path", "/Users/tina/Desktop/1020");
    expect(items[0]).toHaveAttribute("data-current", "true");

    // 负例：本卡不出现任意路径系统选择器
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(
      document.querySelector("input[webkitdirectory], input[directory]"),
    ).toBeNull();
  });

  it("空列表白话提示首次 stagent open", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<OpenProjectEntry repoName="x" repoPath="/tmp/x" />);
    fireEvent.click(screen.getByTestId("open-project"));
    await waitFor(() => {
      expect(screen.getByTestId("recent-projects-empty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("recent-projects-empty")).toHaveTextContent(
      "stagent open",
    );
  });

  it("点击一项请求 open 并用 launchUrl 跳转（带 token）", async () => {
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
    vi.stubGlobal("location", {
      ...window.location,
      assign,
    });

    render(<OpenProjectEntry repoName="x" repoPath="/tmp/x" />);
    fireEvent.click(screen.getByTestId("open-project"));
    await waitFor(() => screen.getByTestId("recent-project-item"));
    fireEvent.click(screen.getByTestId("recent-project-item"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(
        "http://127.0.0.1:3008/#token=deadbeef",
      );
    });

    const openCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/recent-projects/open"),
    );
    expect(openCall).toBeTruthy();
    expect(String(openCall?.[1]?.body)).toContain("/tmp/demo");
  });
});

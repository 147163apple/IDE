// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

const contract = softwareContractSchema.parse({
  ...createContractDraft({
    title: "主页面接线测试",
    description: "验证旧功能仍在",
    acceptanceCriteria: ["npm test 通过"],
    writablePaths: ["src/**"],
  }),
  lifecycle_state: "EXECUTING",
  approval: {
    status: "APPROVED",
    approved_by: "local-user",
    approved_at: "2026-10-20T00:00:00.000Z",
    approved_revision: 1,
  },
});

vi.mock("@/lib/daemon-api", async (orig) => {
  const real = await orig<typeof import("@/lib/daemon-api")>();
  return {
    ...real,
    fetchHealth: vi.fn(async () => ({
      status: "ok",
      port: 0,
      repoRoot: "/Users/tina/Desktop/1020",
    })),
    listContracts: vi.fn(async () => [contract]),
    fetchArchGraph: vi.fn(async () => {
      throw new Error("no graph in test");
    }),
    fetchSettings: vi.fn(async () => ({ configured: false })),
  };
});
vi.mock("@/hooks/use-daemon-stream", () => ({
  useDaemonStream: () => ({
    status: "closed",
    logs: [],
    alerts: [],
    dismissAlert: () => {},
    clearLogs: () => {},
  }),
}));

const { Route } = await import("../../src/routes/index");
const Console = Route.options.component as React.ComponentType;

describe("TASK-C.1 主页面接入三栏工作台", () => {
  it("首页渲染 WorkspaceLayout，并保留旧控制台功能", async () => {
    render(<Console />);
    expect(screen.getByTestId("workspace-layout")).toBeInTheDocument();
    expect(screen.getByTestId("run-mode")).toHaveAttribute("data-mode", "VIBE");
    // Studio 默认打开，旧的合同详情区在其中
    expect(
      screen.getByRole("tab", { name: "Supervisor Studio" }),
    ).toBeInTheDocument();
    // 旧 Header 按钮仍在
    expect(screen.getByText("模型 Key")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /新建合同/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("stream-status")).toBeInTheDocument();
    // 真实数据：仓库名来自 Daemon health
    await waitFor(() =>
      expect(screen.getByTestId("repo-name")).toHaveTextContent("1020"),
    );
    // 合同列表与合同详情 / 操作按钮
    fireEvent.click(await screen.findByText("主页面接线测试"));
    expect(screen.getByText("运行 Worker")).toBeInTheDocument();
    expect(screen.getByText("执行验证")).toBeInTheDocument();
    expect(screen.getByText(/查看 Diff/)).toBeInTheDocument();
    // 执行中合同 → 分支与 Worktree 绑定
    expect(screen.getByTestId("current-branch")).toHaveTextContent(
      `task/${contract.contract_id}`,
    );
    expect(screen.getByTestId("workspace-binding")).toHaveAttribute(
      "data-bound",
      "worktree",
    );
    expect(screen.getByText("架构雷达", { exact: false })).toBeInTheDocument();
  });
});

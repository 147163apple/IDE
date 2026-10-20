// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { fetchProtection } from "../../src/lib/daemon-api";

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
      currentBranch: "main",
    })),
    fetchProtection: vi.fn(async () => ({
      mode: "VIBE",
      entries: [],
      corrupt: null,
      round: {
        roundId: "round-test",
        startedAt: "2026-10-21T00:00:00.000Z",
        pending: [],
        approvedFiles: [],
      },
      checkpoint: null,
    })),
    fetchProtectionRecommendations: vi.fn(async () => []),
    listContracts: vi.fn(async () => [contract]),
    fetchArchGraph: vi.fn(async () => {
      throw new Error("no graph in test");
    }),
    fetchSettings: vi.fn(async () => ({ configured: false })),
    readWorktreeFile: vi.fn(async (_c: unknown, p: string) => ({
      path: p,
      root: "/r",
      content: `内容 of ${p}`,
      writable: true,
    })),
  };
});
let streamOpts: Record<string, (p: unknown) => void> = {};
vi.mock("@monaco-editor/react", () => ({
  default: (p: { value: string }) => (
    <textarea data-testid="monaco" value={p.value} readOnly />
  ),
}));
vi.mock("@/hooks/use-daemon-stream", () => ({
  useDaemonStream: (o: Record<string, (p: unknown) => void>) => {
    streamOpts = o;
    return {
      status: "closed",
      logs: [],
      alerts: [],
      dismissAlert: () => {},
      clearLogs: () => {},
    };
  },
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
    // P.1 顺手修：顶栏分支改为显示主工作区真实分支（不再按合同拼 task/xxx）；
    // 合同与 Worktree 绑定仍由 contract-info / workspace-binding 体现
    expect(screen.getByTestId("current-branch")).toHaveTextContent("main");
    expect(screen.getByTestId("workspace-binding")).toHaveAttribute(
      "data-bound",
      "worktree",
    );
    expect(screen.getByText("架构雷达", { exact: false })).toBeInTheDocument();
  });
  it("保护清单损坏：显示白话警告，顶栏不再假装自由模式", async () => {
    vi.mocked(fetchProtection).mockResolvedValueOnce({
      mode: "CORRUPT",
      entries: [],
      corrupt: "保护清单已损坏（结构不合法）",
      round: {
        roundId: "round-corrupt",
        startedAt: "2026-10-21T00:00:00.000Z",
        pending: [],
        approvedFiles: [],
      },
      checkpoint: null,
    });
    render(<Console />);

    expect(
      await screen.findByTestId("protection-corrupt-banner"),
    ).toHaveTextContent("保护清单损坏，AI 所有改动暂时被拦");
    await waitFor(() =>
      expect(screen.getByTestId("run-mode")).toHaveAttribute(
        "data-mode",
        "PROTECTED",
      ),
    );
  });

  it("Sprint 1 门禁（假数据）：Agent 改文件 → 中栏自动打开 Monaco；Evidence STALE → 横幅", async () => {
    render(<Console />);
    fireEvent.click(await screen.findByText("主页面接线测试"));
    const base = { session_id: "s", turn_id: "t", at: "" };
    act(() => {
      streamOpts.onChatEvent?.({
        ...base,
        seq: 1,
        kind: "tool_call",
        tool_id: "e1",
        name: "Edit",
        input: { file_path: "/Users/tina/Desktop/1020/src/a.ts" },
      });
      streamOpts.onChatEvent?.({
        ...base,
        seq: 2,
        kind: "tool_result",
        tool_id: "e1",
        output: "ok",
        is_error: false,
      });
    });
    expect(await screen.findByRole("tab", { name: "a.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() =>
      expect(screen.getByTestId("monaco")).toHaveValue("内容 of src/a.ts"),
    );
    expect(screen.queryByTestId("evidence-stale-banner")).toBeNull();
    act(() => {
      streamOpts.onEvidenceStatus?.({
        contract_id: contract.contract_id,
        evidence_id: "ev",
        status: "STALE",
      });
    });
    expect(screen.getByTestId("evidence-stale-banner")).toHaveTextContent(
      "STALE",
    );
  });
});

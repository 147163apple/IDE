// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskGraphPanel } from "../../src/components/graph/TaskGraphPanel";
import {
  computeProgress,
  type TaskGraph,
  type TaskGraphIssue,
  type TaskNode,
  type TaskNodeState,
} from "../../src/lib/graph/task-graph";

/**
 * TASK-C.7 门禁：双视图 + 点亮动效。
 *
 * 这里验证的是"用户看到的东西与权威快照一致"：
 * - 业务功能树把下层节点汇总成功能状态，不另算一套；
 * - 执行 DAG 的七态色与文案一一对应；
 * - 新点亮节点带 100ms 翠绿过渡，100ms 后自动收束；
 * - 空验证集的 FAILED 呈现为警告灰（不是红闪），且永不显示"已点亮"；
 * - STALE_REVERIFY 由绿转灰并带 ↻。
 *
 * jsdom 不跑真实排版，颜色通过 data-tone 与 class 断言，不依赖计算样式。
 */

const TREE = [
  { id: "auth", title: "用户登录", parent_id: null },
  { id: "profile", title: "个人资料", parent_id: "auth" },
];

function baseNodes(): TaskNode[] {
  return [
    {
      node_id: "n1",
      title: "数据表迁移",
      kind: "CODE_MODIFICATION",
      depends_on: [],
      functional_area: "auth",
      target_files: ["src/auth/migration.ts"],
      verification_mode: "COMMAND",
      verification_commands: ["test"],
      state: "PENDING",
      executed_at: null,
      commit_sha: null,
    },
    {
      node_id: "n2",
      title: "后端认证接口",
      kind: "CODE_MODIFICATION",
      depends_on: ["n1"],
      functional_area: "auth",
      target_files: ["src/auth/login.ts"],
      verification_mode: "COMMAND",
      verification_commands: ["test"],
      state: "PENDING",
      executed_at: null,
      commit_sha: null,
    },
    {
      node_id: "n3",
      title: "资料页面",
      kind: "CODE_MODIFICATION",
      depends_on: ["n2"],
      functional_area: "profile",
      target_files: ["src/profile/page.tsx"],
      verification_mode: "COMMAND",
      verification_commands: ["test"],
      state: "PENDING",
      executed_at: null,
      commit_sha: null,
    },
  ];
}

function makeGraph(
  options: {
    states?: Record<string, TaskNodeState>;
    issues?: TaskGraphIssue[];
    revision?: number;
  } = {},
): TaskGraph {
  const nodes = baseNodes().map((node) => ({
    ...node,
    state: options.states?.[node.node_id] ?? node.state,
  }));
  return {
    schema_version: "1.0",
    graph_id: "graph_ui_1",
    contract_id: "contract_ui_1",
    generated_at: "2026-10-23T06:00:00.000Z",
    updated_at: "2026-10-23T06:01:00.000Z",
    revision: options.revision ?? 1,
    functional_tree: TREE.map((area) => ({ ...area })),
    nodes,
    fingerprints: [],
    issues: options.issues ?? [],
    progress: computeProgress(nodes),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Task Graph 双视图", () => {
  it("没有快照时显示空态，不伪造节点", () => {
    render(<TaskGraphPanel graph={null} />);
    expect(screen.getByTestId("graph-empty")).toBeInTheDocument();
    expect(screen.getByText("当前合同还没有图")).toBeInTheDocument();
    expect(screen.queryByTestId("execution-dag")).toBeNull();
    expect(screen.queryByTestId("functional-tree")).toBeNull();
  });

  it("C.10n：无图时禁用视图切换，刷新显示 loading", () => {
    const onRefresh = vi.fn();
    render(<TaskGraphPanel graph={null} loading onRefresh={onRefresh} />);
    const functional = screen.getByTestId("graph-view-functional");
    const dag = screen.getByTestId("graph-view-dag");
    expect(functional).toBeDisabled();
    expect(dag).toBeDisabled();
    fireEvent.click(functional);
    fireEvent.click(dag);
    expect(screen.getByTestId("graph-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("functional-tree")).toBeNull();
    expect(screen.queryByTestId("execution-dag")).toBeNull();

    const refresh = screen.getByTestId("graph-refresh");
    expect(refresh).toHaveAttribute("data-loading", "true");
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveTextContent("刷新中…");
    fireEvent.click(refresh);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("C.10n：无图空态提供确认原型建图 CTA", () => {
    const onConfirm = vi.fn();
    render(<TaskGraphPanel graph={null} onConfirmPrototype={onConfirm} />);
    expect(screen.getByTestId("graph-empty-view-hint")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("graph-empty-confirm-cta"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("C.10n 热修：建图失败/未选合同时错误出现在图谱顶栏", () => {
    render(
      <TaskGraphPanel
        graph={null}
        error="请先在左侧点一份合同（或先出草案并落盘），再确认原型开工。"
        onConfirmPrototype={() => {}}
      />,
    );
    expect(screen.getByTestId("graph-error")).toHaveTextContent(
      "请先在左侧点一份合同",
    );
    expect(screen.getByTestId("graph-empty-confirm-cta")).toBeInTheDocument();
  });

  it("C.10n：无开工回调时仍显示只读提示；选中节点高亮并出详情", () => {
    render(<TaskGraphPanel graph={makeGraph()} />);
    expect(screen.getByTestId("graph-action-hint")).toHaveTextContent(
      "不会开工",
    );
    fireEvent.click(screen.getByTestId("graph-view-dag"));
    fireEvent.click(screen.getByTestId("dag-node-n1"));
    expect(screen.getByTestId("dag-node-n1")).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(screen.getByTestId("graph-node-detail")).toHaveTextContent(
      "数据表迁移",
    );
  });

  it("C.10o：有图时可开工下一节点，并回调 node_id", () => {
    const onStart = vi.fn();
    const onVerify = vi.fn();
    render(
      <TaskGraphPanel
        graph={makeGraph()}
        onStartNode={onStart}
        onVerifyNode={onVerify}
      />,
    );
    expect(screen.getByTestId("graph-action-hint")).toHaveTextContent(
      "开工下一节点",
    );
    const startBtn = screen.getByTestId("graph-start-next");
    expect(startBtn).not.toBeDisabled();
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledWith("n1");
    // 全 PENDING 时没有可核销节点
    expect(screen.getByTestId("graph-verify-current")).toBeDisabled();
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("C.10o：RUNNING 时可核销；详情里也能开工/核销", () => {
    const onStart = vi.fn();
    const onVerify = vi.fn();
    const { unmount } = render(
      <TaskGraphPanel
        graph={makeGraph({
          states: { n1: "RUNNING", n2: "PENDING", n3: "PENDING" },
        })}
        onStartNode={onStart}
        onVerifyNode={onVerify}
      />,
    );
    // n1 RUNNING → 下一可开工被挡住（n2 等 n1 点亮）
    expect(screen.getByTestId("graph-start-next")).toBeDisabled();
    const verifyBtn = screen.getByTestId("graph-verify-current");
    expect(verifyBtn).not.toBeDisabled();
    fireEvent.click(verifyBtn);
    expect(onVerify).toHaveBeenCalledWith("n1");

    fireEvent.click(screen.getByTestId("graph-view-dag"));
    fireEvent.click(screen.getByTestId("dag-node-n1"));
    fireEvent.click(screen.getByTestId("graph-node-verify"));
    expect(onVerify).toHaveBeenCalledTimes(2);
    unmount();

    // 前置点亮后详情可开工下游
    render(
      <TaskGraphPanel
        graph={makeGraph({
          states: { n1: "ILLUMINATED", n2: "PENDING", n3: "PENDING" },
        })}
        onStartNode={onStart}
        onVerifyNode={onVerify}
      />,
    );
    fireEvent.click(screen.getByTestId("graph-view-dag"));
    fireEvent.click(screen.getByTestId("dag-node-n2"));
    fireEvent.click(screen.getByTestId("graph-node-start"));
    expect(onStart).toHaveBeenCalledWith("n2");
  });

  it("C.10o：失败黄条仍走 graph-error", () => {
    render(
      <TaskGraphPanel
        graph={makeGraph({ states: { n1: "RUNNING" } })}
        error="E_FILES_NOT_WRITTEN · 目标文件尚未写入"
        onStartNode={() => {}}
        onVerifyNode={() => {}}
      />,
    );
    expect(screen.getByTestId("graph-error")).toHaveTextContent(
      "E_FILES_NOT_WRITTEN",
    );
  });

  it("业务功能导图汇总下层节点真实状态（不另算一套）", () => {
    render(
      <TaskGraphPanel
        graph={makeGraph({
          states: { n1: "ILLUMINATED", n2: "RUNNING", n3: "PENDING" },
        })}
      />,
    );

    const auth = screen.getByTestId("functional-node-auth");
    // auth 下 n1 已亮、n2 施工中 → 汇总为 RUNNING
    expect(auth).toHaveAttribute("data-state", "RUNNING");
    expect(auth).toHaveTextContent("正在施工");
    // 父功能汇总子功能：auth（n1、n2）+ profile（n3）共 3 个节点
    expect(auth).toHaveTextContent("1/3");

    const profile = screen.getByTestId("functional-node-profile");
    expect(profile).toHaveAttribute("data-state", "PENDING");
    expect(screen.getByTestId("graph-progress")).toHaveAttribute(
      "aria-valuenow",
      "33",
    );
  });

  it("执行拓扑渲染节点、依赖边与七态图例", () => {
    render(<TaskGraphPanel graph={makeGraph()} />);
    fireEvent.click(screen.getByTestId("graph-view-dag"));

    expect(screen.getByTestId("execution-dag")).toBeInTheDocument();
    expect(screen.getByTestId("dag-node-n1")).toHaveAttribute(
      "data-state",
      "PENDING",
    );
    expect(screen.getByTestId("dag-edge-n1-n2")).toBeInTheDocument();
    expect(screen.getByTestId("dag-edge-n2-n3")).toBeInTheDocument();

    const legend = screen.getByTestId("dag-legend");
    for (const label of [
      "排队中",
      "正在施工",
      "返工中",
      "已点亮",
      "验证失败",
      "被上游阻断",
      "证据过期，待重验",
    ]) {
      expect(legend).toHaveTextContent(label);
    }
  });
});

describe("≤100ms 平滑翠绿点亮动效", () => {
  it("新点亮节点带 dag-illuminate 与 100ms 过渡，之后自动收束", () => {
    vi.useFakeTimers();
    const before = makeGraph({
      states: { n1: "RUNNING", n2: "PENDING", n3: "PENDING" },
      revision: 1,
    });
    const after = makeGraph({
      states: { n1: "ILLUMINATED", n2: "PENDING", n3: "PENDING" },
      revision: 2,
    });

    const view = render(<TaskGraphPanel graph={before} />);
    fireEvent.click(screen.getByTestId("graph-view-dag"));

    const idle = screen.getByTestId("dag-node-n1");
    expect(idle).toHaveAttribute("data-tone", "running");
    expect(idle).toHaveAttribute("data-illuminating", "false");

    view.rerender(<TaskGraphPanel graph={after} />);

    const lit = screen.getByTestId("dag-node-n1");
    expect(lit).toHaveAttribute("data-state", "ILLUMINATED");
    expect(lit).toHaveAttribute("data-tone", "illuminated");
    expect(lit).toHaveAttribute("data-illuminating", "true");
    expect(lit.className).toContain("dag-illuminate");
    expect(lit.getAttribute("style")).toContain("100ms");
    // 规范口径：过渡时长 ≤100ms
    expect(screen.getByTestId("execution-dag")).toHaveAttribute(
      "data-transition-ms",
      "100",
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId("dag-node-n1")).toHaveAttribute(
      "data-illuminating",
      "false",
    );
  });
});

describe("空验证集与证据过期：绝不假绿", () => {
  const emptyIssue: TaskGraphIssue = {
    node_id: "n1",
    code: "E_EMPTY_VERIFICATION_BLOCKED",
    message: "验证命令集为空：COMMAND 节点严禁无证据点亮",
    severity: "WARNING",
    recorded_at: "2026-10-23T06:02:00.000Z",
  };

  it("空验证集的节点显示警告灰，不显示已点亮", () => {
    const graph = makeGraph({
      states: { n1: "FAILED" },
      issues: [emptyIssue],
    });
    // 这条节点就是"命令集为空"的规格错误现场
    graph.nodes[0] = { ...graph.nodes[0]!, verification_commands: [] };
    graph.progress = computeProgress(graph.nodes);

    render(<TaskGraphPanel graph={graph} />);
    fireEvent.click(screen.getByTestId("graph-view-dag"));

    const node = screen.getByTestId("dag-node-n1");
    expect(node).toHaveAttribute("data-state", "FAILED");
    expect(node).toHaveAttribute("data-tone", "warning");
    expect(node.className).toContain("bg-stone-100");
    expect(node).not.toHaveTextContent("已点亮");
    expect(node).toHaveTextContent("验证集为空");

    // 进度里不能把它算成已点亮
    expect(screen.getByTestId("graph-progress")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    fireEvent.click(node);
    const detail = screen.getByTestId("graph-node-detail");
    expect(detail).toHaveTextContent("E_EMPTY_VERIFICATION_BLOCKED");
    expect(detail).toHaveTextContent("（空：COMMAND 节点禁止点亮）");
  });

  it("STALE_REVERIFY 由绿转灰并带刷新标记", () => {
    render(
      <TaskGraphPanel
        graph={makeGraph({
          states: { n1: "STALE_REVERIFY" },
          issues: [
            {
              node_id: "n1",
              code: "E_EVIDENCE_STALE",
              message: "检测到外部文件改动，证据已过期",
              severity: "WARNING",
              recorded_at: "2026-10-23T06:03:00.000Z",
            },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("graph-view-dag"));

    const node = screen.getByTestId("dag-node-n1");
    expect(node).toHaveAttribute("data-state", "STALE_REVERIFY");
    expect(node).toHaveAttribute("data-tone", "stale");
    expect(node).toHaveTextContent("证据过期");
    expect(node).toHaveTextContent("↻");
    expect(node.className).toContain("bg-stone-100");
  });

  it("七态之外的色块不存在：每种状态都有独立 tone", () => {
    const states: TaskNodeState[] = [
      "PENDING",
      "RUNNING",
      "REPAIRING",
      "ILLUMINATED",
      "FAILED",
      "BLOCKED",
      "STALE_REVERIFY",
    ];
    // 同层七个节点，逐一核对 tone 与状态一一对应
    const nodes = states.map<TaskNode>((state, index) => ({
      node_id: `s${index}`,
      title: `节点 ${state}`,
      kind: "CODE_MODIFICATION",
      depends_on: [],
      functional_area: "auth",
      target_files: [`src/${index}.ts`],
      verification_mode: "COMMAND",
      verification_commands: ["test"],
      state,
      executed_at: null,
      commit_sha: null,
    }));
    const graph: TaskGraph = {
      ...makeGraph(),
      nodes,
      progress: computeProgress(nodes),
    };

    render(<TaskGraphPanel graph={graph} />);
    fireEvent.click(screen.getByTestId("graph-view-dag"));

    const expected: Record<TaskNodeState, string> = {
      PENDING: "pending",
      RUNNING: "running",
      REPAIRING: "repairing",
      ILLUMINATED: "illuminated",
      FAILED: "failed",
      BLOCKED: "blocked",
      STALE_REVERIFY: "stale",
    };
    states.forEach((state, index) => {
      expect(screen.getByTestId(`dag-node-s${index}`)).toHaveAttribute(
        "data-tone",
        expected[state],
      );
    });
  });
});

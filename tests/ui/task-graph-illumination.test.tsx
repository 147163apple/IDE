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
    expect(screen.queryByTestId("execution-dag")).toBeNull();
    expect(screen.queryByTestId("functional-tree")).toBeNull();
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

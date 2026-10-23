/**
 * Task Graph 共享契约（Daemon 与浏览器共用）。
 *
 * 事实源：《Stagent 系统架构设计规范 v1.6.1》
 *  - §3.2.1 节点生命周期七态表
 *  - §3.2.2 渐进点亮充要条件（物理证据驱动）
 *  - §3.3 持久化与状态单向广播（Daemon 独占、UI 零逻辑消费）
 *
 * 三条设计红线：
 * 1. **本文件零 Node 依赖**：它会被打包进浏览器。磁盘读写、Git、指纹计算
 *    一律留在 `daemon/graph/`，前端只认类型与纯函数。
 * 2. **运行态只允许三个字段**：`state` / `executed_at` / `commit_sha`。
 *    `TaskNode` 因此只比提案多这三个键，`SupervisorProposalV1` 用
 *    `Omit<TaskNode, "state" | "executed_at" | "commit_sha">` 就能在**类型层**
 *    彻底剥离运行态，而不是靠"提案时顺手删一下"的运行时约定。
 *    指纹与问题记录放在图级别（`fingerprints` / `issues`），避免它们混进
 *    节点类型后把 Omit 的语义稀释成"少剥一点也看不出来"。
 * 3. **状态词汇表唯一**：七态就是七态。展示层可以给 FAILED 配不同视觉
 *    （例如空验证集用警告灰），但不得新增第八个节点状态。
 */

/** §3.2.1 节点七态（顺序与规范表格一致，便于逐行比对） */
export const TASK_NODE_STATES = [
  "PENDING",
  "RUNNING",
  "REPAIRING",
  "ILLUMINATED",
  "FAILED",
  "BLOCKED",
  "STALE_REVERIFY",
] as const;

export type TaskNodeState = (typeof TASK_NODE_STATES)[number];

/** 面向用户的白话标签（UI 与日志共用，避免两处措辞漂移） */
export const TASK_NODE_STATE_LABEL: Record<TaskNodeState, string> = {
  PENDING: "排队中",
  RUNNING: "正在施工",
  REPAIRING: "返工中",
  ILLUMINATED: "已点亮",
  FAILED: "验证失败",
  BLOCKED: "被上游阻断",
  STALE_REVERIFY: "证据过期，待重验",
};

/**
 * 七态合法流转边（§3.2.1 语义 + §3.4 重验闭环）。
 *
 * 刻意不允许 `ILLUMINATED -> FAILED`：绿灯节点只能先经
 * `STALE_REVERIFY` 降级，再重新验证。否则"绿过又直接变红"会绕过
 * 证据失效通知，前端动效与合同降级都来不及反应。
 */
export const TASK_NODE_TRANSITIONS: Record<
  TaskNodeState,
  readonly TaskNodeState[]
> = {
  PENDING: ["RUNNING", "BLOCKED"],
  RUNNING: ["ILLUMINATED", "FAILED", "REPAIRING", "BLOCKED"],
  REPAIRING: ["RUNNING", "ILLUMINATED", "FAILED"],
  ILLUMINATED: ["STALE_REVERIFY"],
  FAILED: ["RUNNING", "BLOCKED"],
  // 上游恢复后允许重新排队，也允许直接开工（依赖已满足时的快路径）
  BLOCKED: ["PENDING", "RUNNING"],
  STALE_REVERIFY: ["RUNNING", "ILLUMINATED", "FAILED"],
};

export const TASK_NODE_KINDS = [
  "CODE_MODIFICATION",
  "COMMAND_EXECUTION",
  "MANUAL_REVIEW",
  "FAST_PATH",
] as const;

export type TaskNodeKind = (typeof TASK_NODE_KINDS)[number];

/**
 * 验证模式（§3.2.2 三类节点 + Fast Path）。
 * - `COMMAND`：必须绑定非空验证命令集，且每条退出码为 0（C-04 空集红线）
 * - `IMPLICIT_SIDE_EFFECT`：无独立后验命令时，执行退出码 0 且物理副作用变化
 * - `MANUAL`：用户在【确认此项】显式批准
 * - `SYNTAX_CHECK`：Fast Path 单文件语法/类型检查
 */
export const VERIFICATION_MODES = [
  "COMMAND",
  "IMPLICIT_SIDE_EFFECT",
  "MANUAL",
  "SYNTAX_CHECK",
] as const;

export type VerificationMode = (typeof VERIFICATION_MODES)[number];

/**
 * DAG 节点。
 *
 * 静态字段（提案可携带）在前，运行态三个字段在后——这个分界线就是
 * `SupervisorProposalNode` 的 Omit 边界。
 */
export interface TaskNode {
  node_id: string;
  title: string;
  kind: TaskNodeKind;
  depends_on: string[];
  /** 映射到业务功能树的节点 id（一对多：多个工程节点服务同一个功能） */
  functional_area: string;
  /** 节点目标文件（相对 Worktree 根） */
  target_files: string[];
  verification_mode: VerificationMode;
  /** 声明的验证命令（别名或结构化命令的可读标签）；COMMAND 模式禁止为空 */
  verification_commands: string[];
  // ---- 以下三个字段即全部运行态 ----
  state: TaskNodeState;
  executed_at: string | null;
  commit_sha: string | null;
}

/**
 * Supervisor 提案中的节点：类型层即不含任何运行态。
 *
 * 这不是"建议"，是编译期约束：给提案节点写 `state` 会直接类型报错。
 * Daemon 侧仍会在运行期做一次白名单拷贝（防御 JSON 里夹带脏字段）。
 */
export type SupervisorProposalNode = Omit<
  TaskNode,
  "state" | "executed_at" | "commit_sha"
>;

/** 业务功能树节点（上层：面向非技术用户的思维导图） */
export interface FunctionalTreeNode {
  id: string;
  title: string;
  parent_id: string | null;
  description?: string;
}

/**
 * Supervisor 提案 V1（§3.1 一对多拆解映射）。
 * 只含静态规格：功能树 + 工程节点拓扑；运行态由 Daemon 独占派生。
 */
export interface SupervisorProposalV1 {
  schema_version: "1.0";
  proposal_id: string;
  contract_id: string;
  generated_at?: string;
  functional_tree: FunctionalTreeNode[];
  nodes: SupervisorProposalNode[];
}

/** 节点产物指纹（§3.2.2：SHA-256 持久化至 task_graph.json 与 Evidence） */
export interface TaskGraphFingerprint {
  node_id: string;
  path: string;
  sha256: string;
  recorded_at: string;
  commit_sha: string;
}

export const GRAPH_ISSUE_SEVERITIES = ["WARNING", "ERROR"] as const;
export type GraphIssueSeverity = (typeof GRAPH_ISSUE_SEVERITIES)[number];

/**
 * 图级问题记录。空验证集拦截等"拒绝点亮"的原因记在这里，
 * 而不是塞进节点：节点状态仍是规范七态之一，问题码是旁证。
 */
export interface TaskGraphIssue {
  node_id: string;
  code: string;
  message: string;
  severity: GraphIssueSeverity;
  recorded_at: string;
}

export interface TaskGraphProgress {
  total: number;
  illuminated: number;
  /** 0–100 的整数百分比（点亮节点 / 全部节点） */
  percent: number;
  by_state: Record<TaskNodeState, number>;
}

/** 权威图状态：Daemon 内存唯一一份，原子落盘 `.stagent/specs/task_graph.json` */
export interface TaskGraph {
  schema_version: "1.0";
  graph_id: string;
  contract_id: string;
  generated_at: string;
  updated_at: string;
  /** 每次落盘递增，供前端丢弃乱序帧 */
  revision: number;
  functional_tree: FunctionalTreeNode[];
  nodes: TaskNode[];
  fingerprints: TaskGraphFingerprint[];
  issues: TaskGraphIssue[];
  progress: TaskGraphProgress;
}

/** `TASK_GRAPH_UPDATED` 帧载荷（§3.3：全量状态 + 变更指纹 + 进度百分比） */
export interface TaskGraphUpdatedPayload {
  contract_id: string;
  graph: TaskGraph;
  /** 本帧相对上一帧发生变化的节点（供前端只对这些节点播放点亮动效） */
  changed_node_ids: string[];
  progress_percent: number;
  revision: number;
  updated_at: string;
}

/** 规范指定的唯一持久化相对路径（§3.3） */
export const TASK_GRAPH_RELATIVE_PATH = ".stagent/specs/task_graph.json";

export type GraphInvariantCode =
  | "E_GRAPH_DUPLICATE_NODE"
  | "E_GRAPH_MISSING_DEPENDENCY"
  | "E_GRAPH_CYCLE"
  | "E_GRAPH_UNKNOWN_NODE"
  | "E_ILLEGAL_NODE_TRANSITION"
  | "E_GRAPH_UNKNOWN_AREA"
  | "E_GRAPH_NOT_FOUND"
  | "E_UPSTREAM_NOT_ILLUMINATED"
  | "E_TASK_GRAPH_CORRUPT"
  | "E_PROPOSAL_INVALID";

export class GraphInvariantError extends Error {
  readonly code: GraphInvariantCode;

  constructor(code: GraphInvariantCode, message: string) {
    super(message);
    this.name = "GraphInvariantError";
    this.code = code;
  }
}

/** 进度纯函数：同一节点集合恒得同一结果（不含时间、随机数） */
export function computeProgress(nodes: readonly TaskNode[]): TaskGraphProgress {
  const by_state = Object.fromEntries(
    TASK_NODE_STATES.map((state) => [state, 0]),
  ) as Record<TaskNodeState, number>;

  for (const node of nodes) {
    by_state[node.state] += 1;
  }

  const total = nodes.length;
  const illuminated = by_state.ILLUMINATED;
  return {
    total,
    illuminated,
    percent: total === 0 ? 0 : Math.round((illuminated / total) * 100),
    by_state,
  };
}

/**
 * Kahn 拓扑排序。DAG 的"串行执行纪律"（§3.1 并发度 = 1）依赖这个顺序。
 * 重复 id、悬空依赖、环一律抛错——静默按输入顺序执行会把错误拓扑当真。
 */
export function topologicalOrder(
  nodes: readonly Pick<TaskNode, "node_id" | "depends_on">[],
): string[] {
  const byId = new Map<string, Pick<TaskNode, "node_id" | "depends_on">>();
  for (const node of nodes) {
    if (byId.has(node.node_id)) {
      throw new GraphInvariantError(
        "E_GRAPH_DUPLICATE_NODE",
        `重复的节点 id: ${node.node_id}`,
      );
    }
    byId.set(node.node_id, node);
  }

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.node_id, 0);
  }
  for (const node of nodes) {
    for (const dep of node.depends_on) {
      if (!byId.has(dep)) {
        throw new GraphInvariantError(
          "E_GRAPH_MISSING_DEPENDENCY",
          `节点 ${node.node_id} 依赖不存在的节点 ${dep}`,
        );
      }
      indegree.set(node.node_id, (indegree.get(node.node_id) ?? 0) + 1);
      const list = dependents.get(dep) ?? [];
      list.push(node.node_id);
      dependents.set(dep, list);
    }
  }

  // 稳定顺序：同层按输入顺序，保证同一份提案每次布局一致
  const order: string[] = [];
  const ready = nodes
    .map((node) => node.node_id)
    .filter((id) => (indegree.get(id) ?? 0) === 0);

  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    order.push(id);
    for (const next of dependents.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  if (order.length !== nodes.length) {
    const stuck = nodes
      .map((node) => node.node_id)
      .filter((id) => !order.includes(id));
    throw new GraphInvariantError(
      "E_GRAPH_CYCLE",
      `任务拓扑存在环，涉及节点: ${stuck.join(", ")}`,
    );
  }
  return order;
}

/** 收集某个功能区域及其所有后代区域的 id */
export function collectAreaIds(
  tree: readonly FunctionalTreeNode[],
  areaId: string,
): string[] {
  const ids = [areaId];
  let cursor = 0;
  while (cursor < ids.length) {
    const current = ids[cursor];
    cursor += 1;
    for (const node of tree) {
      if (node.parent_id === current && !ids.includes(node.id)) {
        ids.push(node.id);
      }
    }
  }
  return ids;
}

/**
 * 业务功能区域的状态派生（上层视图用）。
 *
 * 这是"一对多"的聚合：一个功能下可能挂着多个工程节点。聚合规则按
 * "最需要用户注意"优先，而不是简单取第一个：
 * 全部点亮 → ILLUMINATED；否则失败 > 过期 > 返工 > 施工 > 阻断 > 排队。
 */
export function deriveFunctionalState(
  graph: Pick<TaskGraph, "functional_tree" | "nodes">,
  areaId: string,
): TaskNodeState {
  if (!graph.functional_tree.some((node) => node.id === areaId)) {
    throw new GraphInvariantError(
      "E_GRAPH_UNKNOWN_AREA",
      `功能树中不存在区域 ${areaId}`,
    );
  }

  const areaIds = new Set(collectAreaIds(graph.functional_tree, areaId));
  const nodes = graph.nodes.filter((node) => areaIds.has(node.functional_area));

  if (nodes.length === 0) return "PENDING";
  if (nodes.every((node) => node.state === "ILLUMINATED")) {
    return "ILLUMINATED";
  }

  const priority: readonly TaskNodeState[] = [
    "FAILED",
    "STALE_REVERIFY",
    "REPAIRING",
    "RUNNING",
    "BLOCKED",
    "PENDING",
  ];
  for (const state of priority) {
    if (nodes.some((node) => node.state === state)) return state;
  }
  return "PENDING";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isState(value: unknown): value is TaskNodeState {
  return (
    typeof value === "string" &&
    (TASK_NODE_STATES as readonly string[]).includes(value)
  );
}

/**
 * 持久化文件的反序列化守卫。
 *
 * 为什么不用 `as TaskGraph`：`.stagent/specs/task_graph.json` 是用户磁盘上的
 * 普通文件，可能被外部编辑器改坏。读进来直接断言类型，等于让一份坏 JSON
 * 决定前端渲染。这里逐字段校验，失败返回可读原因，由调用方决定重建还是报错。
 */
export function validateTaskGraph(
  value: unknown,
): { ok: true; graph: TaskGraph } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "根节点不是对象" };
  if (value["schema_version"] !== "1.0") {
    return { ok: false, message: "schema_version 不是 1.0" };
  }
  for (const key of [
    "graph_id",
    "contract_id",
    "generated_at",
    "updated_at",
  ] as const) {
    if (typeof value[key] !== "string") {
      return { ok: false, message: `${key} 缺失或不是字符串` };
    }
  }
  if (typeof value["revision"] !== "number") {
    return { ok: false, message: "revision 缺失或不是数字" };
  }

  const tree = value["functional_tree"];
  if (!Array.isArray(tree)) {
    return { ok: false, message: "functional_tree 不是数组" };
  }
  for (const area of tree) {
    if (
      !isRecord(area) ||
      typeof area["id"] !== "string" ||
      typeof area["title"] !== "string" ||
      !(area["parent_id"] === null || typeof area["parent_id"] === "string")
    ) {
      return { ok: false, message: "functional_tree 存在非法节点" };
    }
  }

  const nodes = value["nodes"];
  if (!Array.isArray(nodes)) return { ok: false, message: "nodes 不是数组" };
  for (const node of nodes) {
    if (!isRecord(node)) return { ok: false, message: "nodes 存在非对象项" };
    if (
      typeof node["node_id"] !== "string" ||
      typeof node["title"] !== "string"
    ) {
      return { ok: false, message: "节点缺少 node_id/title" };
    }
    if (!isState(node["state"])) {
      return { ok: false, message: `节点 ${node["node_id"]} 状态非法` };
    }
    if (
      typeof node["kind"] !== "string" ||
      !(TASK_NODE_KINDS as readonly string[]).includes(node["kind"])
    ) {
      return { ok: false, message: `节点 ${node["node_id"]} kind 非法` };
    }
    if (!isStringArray(node["depends_on"])) {
      return { ok: false, message: `节点 ${node["node_id"]} depends_on 非法` };
    }
    if (!isStringArray(node["target_files"])) {
      return {
        ok: false,
        message: `节点 ${node["node_id"]} target_files 非法`,
      };
    }
    if (!isStringArray(node["verification_commands"])) {
      return {
        ok: false,
        message: `节点 ${node["node_id"]} verification_commands 非法`,
      };
    }
    if (
      typeof node["verification_mode"] !== "string" ||
      !(VERIFICATION_MODES as readonly string[]).includes(
        node["verification_mode"],
      )
    ) {
      return { ok: false, message: `节点 ${node["node_id"]} 验证模式非法` };
    }
    if (!(
      node["executed_at"] === null || typeof node["executed_at"] === "string"
    )) {
      return { ok: false, message: `节点 ${node["node_id"]} executed_at 非法` };
    }
    if (!(
      node["commit_sha"] === null || typeof node["commit_sha"] === "string"
    )) {
      return { ok: false, message: `节点 ${node["node_id"]} commit_sha 非法` };
    }
  }

  if (!Array.isArray(value["fingerprints"])) {
    return { ok: false, message: "fingerprints 不是数组" };
  }
  if (!Array.isArray(value["issues"])) {
    return { ok: false, message: "issues 不是数组" };
  }
  if (!isRecord(value["progress"])) {
    return { ok: false, message: "progress 缺失" };
  }

  return { ok: true, graph: value as unknown as TaskGraph };
}

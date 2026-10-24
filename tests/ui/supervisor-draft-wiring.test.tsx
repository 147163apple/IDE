// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { generateContractDraft } from "../../daemon/supervisor/draft-generator";
import type { SupervisorMessage } from "../../daemon/supervisor/types";
import type {
  SupervisorDraftResponse,
  SupervisorDraftResult,
} from "../../src/lib/daemon-api";

/**
 * 前端接线验收：新建需求 → `POST /api/supervisor/draft` → 真实草案装载。
 *
 * 断言口径（对应任务卡第 3 节）：
 * - 提意图后确实调用了草案端点（参数是那句白话 + 圈选范围）；
 * - Supervisor Tab 的「白话理由」不再是「（无）」，未决问题逐条列出；
 * - 「涉及范围」呈现的是 L0 推导出的 `plan.writable_paths`；
 * - Studio 侧读同一份 `supervisor_metadata`，同样不再为空。
 *
 * 草案夹具用**真实 L0 生成器**产出（纯规则、零模型调用），而不是手写假对象：
 * 只有真草案才能证明"适配器没偷偷加工字段"。
 */

const tmpDirs: string[] = [];

function newRepo(): string {
  const root = path.join(process.cwd(), ".tmp", "ui-supervisor-draft");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "repo-"));
  tmpDirs.push(dir);
  return dir;
}

let draftResponse: SupervisorDraftResponse;

const generateSupervisorDraft = vi.fn(
  async (
    _conn: unknown,
    _input: { intent: string; context_paths?: string[]; enrich?: boolean },
  ): Promise<SupervisorDraftResponse> => draftResponse,
);

vi.mock("@/lib/daemon-api", async (orig) => {
  const real = await orig<typeof import("@/lib/daemon-api")>();
  const draftBridge = (...args: unknown[]): unknown =>
    (generateSupervisorDraft as unknown as (...a: unknown[]) => unknown)(
      ...args,
    );
  return {
    ...real,
    generateSupervisorDraft: draftBridge,
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
    // 初始没有任何已落盘合同：界面上的东西必须全部来自这份草案
    listContracts: vi.fn(async () => []),
    fetchPresentationSnapshot: vi.fn(async () => ({
      version: 1,
      updated_at: null,
      contracts: {},
    })),
    fetchArchGraph: vi.fn(async () => {
      throw new Error("no graph in test");
    }),
    fetchSettings: vi.fn(async () => ({
      configured: false,
      model: "",
      source: "none",
    })),
  };
});

vi.mock("@monaco-editor/react", () => ({
  default: (p: { value: string }) => (
    <textarea data-testid="monaco" value={p.value} readOnly />
  ),
}));

vi.mock("@/hooks/use-daemon-stream", () => ({
  useDaemonStream: () => ({
    status: "closed",
    logs: [],
    alerts: [],
    terminal: [],
    dismissAlert: () => {},
    clearLogs: () => {},
    clearTerminal: () => {},
  }),
}));

const { Route } = await import("../../src/routes/index");
const Console = Route.options.component as React.ComponentType;

beforeAll(async () => {
  const repoRoot = newRepo();
  const message: SupervisorMessage = {
    message_id: "msg-ui-1",
    role: "user",
    text: "把界面的按钮换成圆角",
    created_at: "2026-10-21T00:00:00.000Z",
    source: "ui",
  };
  const outcome = await generateContractDraft({
    repoRoot,
    messages: [message],
    trigger: "USER_REQUEST",
    now: () => new Date("2026-10-21T00:00:00.000Z"),
  });
  if (!outcome.generated) throw new Error("L0 应当总能生成草案");
  const plan = outcome.plan;
  const draft: SupervisorDraftResult = {
    contract: outcome.contract,
    plan: {
      writable_paths: plan.writable_paths,
      readonly_paths: plan.readonly_paths,
      strictly_forbidden_paths: plan.strictly_forbidden_paths,
      commands: plan.commands.map((c) => ({
        alias: c.alias,
        executable: c.executable,
        args: c.args,
        expected_exit_code: c.expected_exit_code,
        timeout_seconds: c.timeout_seconds,
      })),
      budget: { ...plan.budget },
      protected_files: plan.protected_files,
      protected_entry_names: plan.protected_entry_names,
      needs_protection_approval: plan.needs_protection_approval,
    },
    rationale: outcome.rationale,
    unresolved_questions: outcome.unresolved_questions,
    model_calls: outcome.model_calls,
    usage: null,
  };
  draftResponse = {
    draft,
    budget: {
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_minor_units: 0,
      currency: "CNY",
      tripped: false,
      max_total_tokens: 200_000,
      max_cost_minor_units: 5_000,
      remaining_tokens: 200_000,
    },
  };
});

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  generateSupervisorDraft.mockClear();
});

async function openForm(): Promise<void> {
  render(<Console />);
  // 等首屏 refresh 落定再动手，避免把挂载期的异步状态更新算到断言头上
  await waitFor(() =>
    expect(screen.getByTestId("repo-name")).toHaveTextContent("1020"),
  );
  fireEvent.click(screen.getByTestId("new-requirement"));
}

function submitIntent(text: string): void {
  fireEvent.change(screen.getByTestId("intent-input"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByTestId("request-draft"));
}

describe("新建需求 → 草案端点 → Supervisor Tab / Studio 装载", () => {
  it("提意图后调用草案端点，表单被 L0 的真实推导结果预填", async () => {
    await openForm();
    submitIntent("把界面的按钮换成圆角");

    expect(await screen.findByTestId("draft-ready")).toHaveTextContent(
      "白话理由",
    );
    // 端点参数：白话意图 + 圈选范围（此处没有圈选，故 context_paths 省略）
    await waitFor(() => expect(generateSupervisorDraft).toHaveBeenCalled());
    const lastCall = generateSupervisorDraft.mock.calls.at(-1);
    expect(lastCall?.[1].intent).toBe("把界面的按钮换成圆角");

    // 表单预填来自草案，不是硬编码默认值
    expect(screen.getByTestId("intent-title")).toHaveValue(
      draftResponse.draft.contract.intent.title,
    );
    expect(screen.getByTestId("intent-paths")).toHaveValue(
      draftResponse.draft.plan.writable_paths.join(", "),
    );
  });

  it("Supervisor Tab：白话理由与未决问题不再显示「（无）」", async () => {
    await openForm();
    submitIntent("把界面的按钮换成圆角");
    await screen.findByTestId("draft-ready");

    fireEvent.click(screen.getByTestId("activity-supervisor"));

    const rationale = await screen.findByTestId("supervisor-rationale");
    const items = screen.getAllByTestId("supervisor-rationale-item");
    expect(items.length).toBe(draftResponse.draft.rationale.length);
    expect(items.length).toBeGreaterThan(0);
    expect(rationale).toHaveTextContent(
      draftResponse.draft.rationale[0] as string,
    );
    expect(rationale).not.toHaveTextContent("（无）");

    // 未决问题：逐条渲染，条数与真实草案一致（G-11 不在前端被去重/截断）
    const unresolved = screen.getByTestId("supervisor-unresolved");
    expect(unresolved).toHaveTextContent(
      `未决问题 · ${draftResponse.draft.unresolved_questions.length} 条`,
    );
    expect(screen.queryAllByTestId("supervisor-unresolved-item").length).toBe(
      draftResponse.draft.unresolved_questions.length,
    );

    // 草案尚未落盘：界面必须说清楚，不能假装仓库里已经有这份合同
    expect(screen.getByTestId("supervisor-draft-badge")).toBeInTheDocument();
  });

  it("涉及范围呈现 L0 推导的 writable_paths，且禁区不是空的摆设", async () => {
    await openForm();
    submitIntent("把界面的按钮换成圆角");
    await screen.findByTestId("draft-ready");
    fireEvent.click(screen.getByTestId("activity-supervisor"));

    const scope = await screen.findByTestId("supervisor-scope");
    for (const p of draftResponse.draft.plan.writable_paths) {
      expect(scope).toHaveTextContent(p);
    }
    expect(scope).toHaveTextContent(".env*");
    expect(draftResponse.draft.plan.writable_paths).toContain(
      "src/components/**",
    );
  });

  it("Studio 读同一份 supervisor_metadata：白话理由与未决问题都不为空", async () => {
    await openForm();
    submitIntent("把界面的按钮换成圆角");
    await screen.findByTestId("draft-ready");

    // 新建需求时 Studio 就是当前 Tab
    expect(screen.getByRole("tab", { name: "合同操作台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByTestId("rationale-item").length).toBe(
      draftResponse.draft.rationale.length,
    );
    expect(screen.getByTestId("studio-unresolved-summary")).toHaveTextContent(
      `共 ${draftResponse.draft.unresolved_questions.length} 条`,
    );
    expect(screen.getByTestId("studio-writable-paths")).toHaveTextContent(
      "src/components/**",
    );
  });

  it("未提意图时不出草案：按钮禁用，界面不会假装有理由", async () => {
    await openForm();
    expect(screen.getByTestId("request-draft")).toBeDisabled();
    expect(screen.queryByTestId("draft-ready")).toBeNull();
    expect(generateSupervisorDraft).not.toHaveBeenCalled();
  });
});

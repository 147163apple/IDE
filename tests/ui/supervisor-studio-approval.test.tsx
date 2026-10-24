// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import type { AdmissionView } from "../../src/lib/daemon-api";
import { ProtectionConfirmCard } from "../../src/components/ProtectionConfirmCard";
import { SupervisorStudioPane } from "../../src/components/SupervisorStudioPane";
import {
  confirmSentence,
  shouldConfirmAdmission,
  toStudioDraft,
} from "../../src/components/supervisor-view-model";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";
import type { ActiveContract } from "../../src/components/workspace-types";

/**
 * TASK-C.2 验收：Supervisor Studio 中栏审阅 + 白话确认卡与 `/admit` 联动。
 *
 * 三条主断言（对应用户验收条款）：
 * 1. 无交集 → 静默流转，页面上**一个**确认弹窗都没有；
 * 2. 触碰保护清单 → **仅 1 张**白话卡，且未点「同意」前**绝不**发审批请求；
 * 3. 未决问题勾选单 **100%** 呈现（不去重、不截断）。
 */

const baseContract = softwareContractSchema.parse({
  ...createContractDraft({
    title: "给登录页加记住我",
    description: "只改登录相关组件",
    acceptanceCriteria: ["npm test 通过"],
    writablePaths: ["src/pages/**"],
    readonlyPaths: ["src/lib/**"],
    commands: [
      { alias: "typecheck", executable: "npm", args: ["run", "typecheck"] },
      { alias: "test", executable: "npx", args: ["vitest", "run"] },
    ],
  }),
  lifecycle_state: "PENDING_APPROVAL",
  approval: { status: "PENDING_REVIEW" },
});

const autoApproved: AdmissionView = {
  decision: "AUTO_APPROVED",
  contract: baseContract,
  reason: "合同范围未触碰保护清单，自动批准",
  protectedFiles: [],
  entryNames: [],
};

const needsApproval: AdmissionView = {
  decision: "NEEDS_APPROVAL",
  contract: baseContract,
  reason: "命中受保护条目",
  protectedFiles: ["src/pages/login.tsx", "src/pages/login.css"],
  entryNames: ["登录"],
  cardId: "card-1",
};

const layoutBase = {
  repoName: "1020",
  repoPath: "/Users/tina/Desktop/1020",
  baseBranch: "main",
  runMode: "PROTECTED" as const,
  workerControl: "GATEWAY_ENFORCED" as const,
  files: [{ name: "src", path: "src" }],
};

function renderLayout(opts: {
  admission: AdmissionView | null;
  contract: ActiveContract;
  onApprove?: (a: AdmissionView) => void;
  onDeny?: (a: AdmissionView) => void;
}) {
  return render(
    <WorkspaceLayout
      {...layoutBase}
      contract={opts.contract}
      defaultOpenStudio
      protectedCount={1}
      confirmSlot={
        <ProtectionConfirmCard
          admission={opts.admission}
          onApprove={opts.onApprove ?? (() => {})}
          onDeny={opts.onDeny ?? (() => {})}
        />
      }
      studioContent={
        <SupervisorStudioPane
          runMode="PROTECTED"
          draft={toStudioDraft(baseContract)}
          execution={{
            contractId: baseContract.contract_id,
            status: "EXECUTING",
          }}
        />
      }
    />,
  );
}

const executing: ActiveContract = {
  contractId: baseContract.contract_id,
  worktreePath: "/tmp/wt",
  approved: true,
  status: "EXECUTING",
};

describe("TASK-C.2 无交集：静默自动批准，0 弹窗", () => {
  it("AUTO_APPROVED 不进状态，渲染层完全没有确认卡", () => {
    renderLayout({ admission: null, contract: executing });
    expect(screen.queryByTestId("protection-confirm-card")).toBeNull();
    // 不是"隐藏"，而是根本没渲染：alertdialog 也不存在
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText(/同意吗/)).toBeNull();
  });

  it("AUTO_APPROVED 的裁决本身也不该触发确认（纯函数判据）", () => {
    expect(shouldConfirmAdmission(autoApproved)).toBe(false);
    expect(shouldConfirmAdmission(null)).toBe(false);
    expect(shouldConfirmAdmission(needsApproval)).toBe(true);
  });

  it("自动批准后直接显示执行中状态，无需任何点击", () => {
    renderLayout({ admission: null, contract: executing });
    expect(screen.getByTestId("studio-execution")).toHaveAttribute(
      "data-status",
      "EXECUTING",
    );
    expect(screen.getByTestId("studio-execution")).toHaveTextContent("执行中");
  });
});

describe("TASK-C.2 有交集：至多一张白话卡，未点同意不发请求", () => {
  it("整页只有 1 张确认卡，文案是白话问句", () => {
    renderLayout({ admission: needsApproval, contract: executing });
    const cards = screen.getAllByTestId("protection-confirm-card");
    expect(cards).toHaveLength(1);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByTestId("protection-confirm-question")).toHaveTextContent(
      "AI 想修改被保护的【登录】代码，同意吗？",
    );
    // 命中的文件逐条列出，不做折叠
    const files = screen.getByTestId("protection-confirm-files");
    expect(files).toHaveTextContent("src/pages/login.tsx");
    expect(files).toHaveTextContent("src/pages/login.css");
  });

  it("未点击「同意」前，绝不发送审批请求", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    renderLayout({
      admission: needsApproval,
      contract: executing,
      onApprove,
      onDeny,
    });
    // 渲染、等待、甚至点别的区域，都不该产生请求
    fireEvent.click(screen.getByTestId("studio-title"));
    fireEvent.mouseOver(screen.getByTestId("protection-confirm-card"));
    expect(onApprove).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("点「同意」才发一次审批请求", () => {
    const onApprove = vi.fn();
    renderLayout({
      admission: needsApproval,
      contract: executing,
      onApprove,
    });
    fireEvent.click(screen.getByTestId("protection-confirm-approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: expect.anything(),
        cardId: "card-1",
      }),
    );
  });

  it("点「不同意」走坚决取消（onDeny 一次，onApprove 零次）", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    renderLayout({
      admission: needsApproval,
      contract: executing,
      onApprove,
      onDeny,
    });
    fireEvent.click(screen.getByTestId("protection-confirm-deny"));
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("白话问句在多条目/空条目下都不出现 glob 术语", () => {
    expect(confirmSentence(["登录", "支付"])).toBe(
      "AI 想修改被保护的【登录、支付】代码，同意吗？",
    );
    expect(confirmSentence([])).toBe("AI 想修改被保护的代码，同意吗？");
    expect(confirmSentence(["登录"])).not.toMatch(/\*\*|glob/i);
  });
});

describe("TASK-C.2 未决问题勾选单：100% 呈现", () => {
  const questions = [
    "「记住我」是保持 7 天还是 30 天？",
    "要不要同时改注册页的同类勾选框？",
    "token 存在 localStorage 还是 httpOnly cookie？",
    "失败时是否要给用户提示文案？",
    "是否需要在 E2E 里补一条记住我的用例？",
    // 故意重复一条：数据层不去重，UI 也不许悄悄吞掉
    "「记住我」是保持 7 天还是 30 天？",
  ];

  const draftWithQuestions = {
    ...toStudioDraft(baseContract),
    unresolved_questions: questions,
  };

  it("逐条渲染，条数完全一致（含重复项）", () => {
    render(<SupervisorStudioPane runMode="VIBE" draft={draftWithQuestions} />);
    const items = screen.getAllByTestId("unresolved-question");
    expect(items).toHaveLength(questions.length);
    questions.forEach((question, index) => {
      expect(items[index]).toHaveTextContent(question);
    });
    expect(screen.getByTestId("studio-unresolved-summary")).toHaveTextContent(
      `共 ${questions.length} 条`,
    );
  });

  it("勾选只作记录，不阻断也不删数据", () => {
    render(<SupervisorStudioPane runMode="VIBE" draft={draftWithQuestions} />);
    const box = screen.getByTestId("unresolved-check-0");
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
    // 勾选后条目数量不变（不是"勾掉就消失"）
    expect(screen.getAllByTestId("unresolved-question")).toHaveLength(
      questions.length,
    );
    expect(screen.getByTestId("studio-unresolved-summary")).toHaveTextContent(
      "已核对 1 条",
    );
  });

  it("合同里没有未决问题时给白话空态，而不是空白", () => {
    render(
      <SupervisorStudioPane
        runMode="VIBE"
        draft={toStudioDraft(baseContract)}
      />,
    );
    expect(screen.getByTestId("studio-unresolved")).toHaveTextContent(
      "没有未决问题",
    );
  });
});

describe("TASK-C.2 结构化审阅与执行期控制", () => {
  it("可写/只读/禁区/命令/Token 预算都在面板上", () => {
    render(
      <SupervisorStudioPane
        runMode="VIBE"
        draft={toStudioDraft(baseContract)}
      />,
    );
    expect(screen.getByTestId("studio-writable-paths")).toHaveTextContent(
      "src/pages/**",
    );
    expect(screen.getByTestId("studio-readonly-paths")).toHaveTextContent(
      "src/lib/**",
    );
    expect(screen.getByTestId("studio-commands")).toHaveTextContent(
      "npm run typecheck",
    );
    expect(screen.getByTestId("studio-commands")).toHaveTextContent(
      "npx vitest run",
    );
    expect(screen.getByTestId("studio-budget-tokens")).toHaveTextContent(
      "Token 上限",
    );
  });

  it("理由（rationale）逐条呈现", () => {
    const draft = {
      ...toStudioDraft(baseContract),
      rationale: [
        "可写范围按会话中提到/推断出的路径圈定。",
        "验证命令采用 npm。",
      ],
    };
    render(<SupervisorStudioPane runMode="VIBE" draft={draft} />);
    expect(screen.getAllByTestId("rationale-item")).toHaveLength(2);
  });

  it("执行中才有紧急暂停，且必须点两次才真的中止", () => {
    const onPause = vi.fn();
    const { rerender } = render(
      <SupervisorStudioPane
        runMode="VIBE"
        draft={toStudioDraft(baseContract)}
        execution={{ status: "EXECUTING" }}
        onEmergencyPause={onPause}
      />,
    );
    const btn = screen.getByTestId("studio-emergency-pause");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onPause).not.toHaveBeenCalled();
    expect(btn).toHaveTextContent("确认中止？");
    fireEvent.click(btn);
    expect(onPause).toHaveBeenCalledTimes(1);

    rerender(
      <SupervisorStudioPane
        runMode="VIBE"
        draft={toStudioDraft(baseContract)}
        execution={{ status: "DONE" }}
        onEmergencyPause={onPause}
      />,
    );
    expect(screen.getByTestId("studio-emergency-pause")).toBeDisabled();
  });

  it("顶栏模式胶囊：VIBE 无锁，PROTECTED 带锁数并可点开 Studio", () => {
    render(<WorkspaceLayout {...layoutBase} protectedCount={3} />);
    const mode = screen.getByTestId("run-mode");
    // 顶栏收口：徽标压成紧凑胶囊，锁数只进 data 属性与 title
    expect(mode).toHaveTextContent("保护中");
    expect(mode).toHaveAttribute("data-mode", "PROTECTED");
    expect(mode).not.toHaveTextContent("已锁 3 处");
    expect(mode).toHaveAttribute("data-locked-count", "3");
    expect(mode).toHaveAttribute("title", expect.stringContaining("已锁 3 处"));
    fireEvent.click(mode);
    expect(
      screen.getByRole("tab", { name: "Supervisor Studio" }),
    ).toHaveAttribute("aria-selected", "true");

    render(<WorkspaceLayout {...layoutBase} runMode="VIBE" />);
    const vibe = screen.getAllByTestId("run-mode")[1]!;
    expect(vibe).toHaveTextContent("自由");
    expect(vibe).toHaveAttribute("data-mode", "VIBE");
    expect(vibe).toHaveAttribute("data-locked-count", "0");
  });
});

describe("TASK-C.2 v1.3.3 剔除项反证（v0.2+ 才做）", () => {
  it("不渲染成熟度徽章 / 风险气泡 / Snooze 按钮", () => {
    render(
      <WorkspaceLayout
        {...layoutBase}
        defaultOpenStudio
        contract={executing}
        studioContent={
          <SupervisorStudioPane
            runMode="PROTECTED"
            draft={toStudioDraft(baseContract)}
            execution={{ status: "EXECUTING", progress: "正在跑第 1/2 条命令" }}
          />
        }
      />,
    );
    expect(screen.queryByTestId("maturity-badge")).toBeNull();
    expect(screen.queryByTestId("risk-bubble")).toBeNull();
    expect(screen.queryByText(/成熟度/)).toBeNull();
    expect(screen.queryByText(/snooze/i)).toBeNull();
    // 也不许出现任何"分数"口径
    expect(screen.queryByText(/\d+\s*分/)).toBeNull();
  });
});

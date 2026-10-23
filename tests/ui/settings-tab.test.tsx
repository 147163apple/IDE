// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsTab } from "../../src/components/settings/SettingsTab";
import type { DaemonConnection } from "../../src/lib/daemon-api";

/**
 * 设置页验收。
 *
 * 这一页存在的理由是把「控制项」从顶栏挪走，所以这里重点验证两件事：
 * 1. 搬运后**语义没丢**——原来顶栏的受控徽标三态（受控/非受控/断线未知）
 *    在这里一模一样，断线不再假装受控；
 * 2. 连接表单真的能改并回传（不是只画了两个输入框）。
 */

const conn: DaemonConnection = {
  baseUrl: "http://127.0.0.1:3001",
  token: "t-0",
};

function renderSettings(over: Partial<Parameters<typeof SettingsTab>[0]> = {}) {
  const onConnChange = vi.fn();
  render(
    <SettingsTab
      conn={conn}
      onConnChange={onConnChange}
      connected
      daemonPort={3001}
      repoPath="/Users/tina/Desktop/1018"
      baseBranch="main"
      runMode="VIBE"
      protectedCount={0}
      workerControl="GATEWAY_ENFORCED"
      streamStatus="connected"
      {...over}
    />,
  );
  return { onConnChange };
}

describe("设置页：受控状态搬运后语义不变", () => {
  it("GATEWAY_ENFORCED 显示受控且为绿色", () => {
    renderSettings();
    const b = screen.getByTestId("worker-control");
    expect(b).toHaveTextContent("GATEWAY_ENFORCED");
    expect(b.className).toMatch(/green/);
  });

  it("UNCONTROLLED_EXTERNAL 变黄，不说成受控", () => {
    renderSettings({ workerControl: "UNCONTROLLED_EXTERNAL" });
    const b = screen.getByTestId("worker-control");
    expect(b).toHaveTextContent("UNCONTROLLED_EXTERNAL");
    expect(b.className).toMatch(/yellow/);
  });

  it("断开后台时受控状态标为未知并变暗（P.1 顺手修）", () => {
    renderSettings({ connected: false, daemonPort: null });
    const b = screen.getByTestId("worker-control");
    expect(b).toHaveTextContent("未连上后台");
    expect(b).toHaveAttribute("data-control", "OFFLINE");
    expect(b.className).toMatch(/opacity-60/);
    expect(screen.getByTestId("daemon-connection-state")).toHaveTextContent(
      "未连接",
    );
  });

  it("实时流诊断三种状态读得出", () => {
    const { rerender } = render(
      <SettingsTab
        conn={conn}
        onConnChange={() => {}}
        connected
        daemonPort={3001}
        repoPath="/r"
        baseBranch="main"
        runMode="VIBE"
        protectedCount={0}
        workerControl="GATEWAY_ENFORCED"
        streamStatus="reconnecting"
      />,
    );
    expect(screen.getByTestId("stream-status")).toHaveTextContent("重连中");
    rerender(
      <SettingsTab
        conn={conn}
        onConnChange={() => {}}
        connected
        daemonPort={3001}
        repoPath="/r"
        baseBranch="main"
        runMode="VIBE"
        protectedCount={0}
        workerControl="GATEWAY_ENFORCED"
        streamStatus="closed"
      />,
    );
    expect(screen.getByTestId("stream-status")).toHaveTextContent("未开");
  });
});

describe("设置页：连接与工作区", () => {
  it("改完地址后「应用」才可点，并把草稿回传", () => {
    const { onConnChange } = renderSettings();
    const apply = screen.getByTestId("apply-connection");
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByTestId("daemon-url"), {
      target: { value: "http://127.0.0.1:3999" },
    });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onConnChange).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:3999",
      token: "t-0",
    });
  });

  it("Worktree 绝对路径只在有合同时显示（顶栏已不展示）", () => {
    renderSettings({
      worktreePath: "/Users/tina/Desktop/1018/.stagent/worktrees/task-c-1",
      executionStatus: "执行中",
    });
    expect(screen.getByTestId("contract-info")).toHaveTextContent(
      "/Users/tina/Desktop/1018/.stagent/worktrees/task-c-1",
    );
    expect(screen.getByTestId("contract-info")).toHaveTextContent("执行中");
  });

  it("没有本轮快照就不给「撤销本轮」（不画点了没反应的按钮）", () => {
    renderSettings({ checkpoint: null });
    expect(screen.queryByTestId("undo-round")).toBeNull();
  });

  it("有快照才出现「撤销本轮」，点击走真实回调", () => {
    const onUndoRound = vi.fn();
    renderSettings({ checkpoint: "round-1", onUndoRound });
    fireEvent.click(screen.getByTestId("undo-round"));
    expect(onUndoRound).toHaveBeenCalledTimes(1);
  });
});

describe("设置页：Token 粘贴的脏字符防线", () => {
  it("粘进来的换行/零宽字符在输入框里就被洗掉，回传的是干净 Token", () => {
    const { onConnChange } = renderSettings();
    fireEvent.change(screen.getByTestId("session-token"), {
      target: { value: "\n deadbeef\u200B\n" },
    });
    expect(screen.getByTestId("session-token")).toHaveValue("deadbeef");
    fireEvent.click(screen.getByTestId("apply-connection"));
    expect(onConnChange).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:3001",
      token: "deadbeef",
    });
  });

  it("含中文时当场红字告警（而不是等 fetch 抛 non ISO-8859-1）", () => {
    renderSettings();
    expect(screen.queryByTestId("token-non-ascii-warning")).toBeNull();
    fireEvent.change(screen.getByTestId("session-token"), {
      target: { value: "deadbeef 中文说明" },
    });
    expect(screen.getByTestId("token-non-ascii-warning")).toHaveTextContent(
      "浏览器不允许写进请求头",
    );
  });

  it("全角字符按 NFKC 归一半角后不触发告警（粘贴全角字母也能用）", () => {
    renderSettings();
    fireEvent.change(screen.getByTestId("session-token"), {
      target: { value: "ａｂｃ１２３" },
    });
    expect(screen.getByTestId("session-token")).toHaveValue("abc123");
    expect(screen.queryByTestId("token-non-ascii-warning")).toBeNull();
  });
});

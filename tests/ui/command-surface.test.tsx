// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";
import { resolveCommandSurface } from "../../src/lib/command-surface";
import { AgentChatPane } from "../../src/components/AgentChatPane";

const base = {
  repoName: "1020",
  repoPath: "/Users/tina/Desktop/1020",
  baseBranch: "main",
  runMode: "PROTECTED" as const,
  files: [{ name: "src", path: "src", children: [] }],
  onNewRequirement: () => {},
};

describe("TASK-C.9a 三态单一主 CTA（UI）", () => {
  it("无钥匙态：欢迎区不抢「打开文件/说需求」，指挥面指向一键重开", () => {
    const surface = resolveCommandSurface({
      hasSession: false,
      keyReady: false,
      inProgress: false,
    });
    render(
      <WorkspaceLayout
        {...base}
        commandSurface={surface}
        rightPanel={
          <AgentChatPane
            transport={null}
            commandPhase={surface.phase}
            primaryCtaTestId={surface.primaryCtaTestId}
          />
        }
      />,
    );

    expect(screen.getByTestId("command-surface")).toHaveAttribute(
      "data-phase",
      "no_key",
    );
    expect(screen.getByTestId("command-surface")).toHaveAttribute(
      "data-primary-cta",
      "chat-relaunch-with-token",
    );
    expect(screen.getByTestId("welcome-pane")).toHaveAttribute(
      "data-welcome-variant",
      "connect",
    );
    expect(screen.queryByText("打开文件")).toBeNull();
    expect(screen.queryByText("或者直接说需求")).toBeNull();
    expect(screen.getByTestId("chat-relaunch-with-token")).toHaveAttribute(
      "data-primary-cta",
      "true",
    );
    // C.10e：欢迎页承载开项目，page 变体面板展开（sidebar 默认收起仍归 C.9c）
    expect(screen.getByTestId("open-project-panel")).toBeInTheDocument();
    expect(screen.getByTestId("open-project")).toHaveAttribute(
      "data-variant",
      "page",
    );
    // 顶栏不再用工程师暗号抢指挥
    expect(screen.getByTestId("run-mode")).toHaveTextContent("保护中");
    expect(screen.getByTestId("run-mode")).not.toHaveTextContent("PROTECTED");
  });

  it("有钥匙空闲态：主指挥是右侧说需求；欢迎只点右侧", () => {
    const surface = resolveCommandSurface({
      hasSession: true,
      keyReady: true,
      inProgress: false,
    });
    const transport = {
      listAdapters: async () => [
        {
          id: "claude-code",
          label: "Claude Code",
          control_mode: "UNCONTROLLED_EXTERNAL" as const,
          verified_on: "",
          tool_mode: "read_only" as const,
          available: true,
        },
      ],
      listSessions: async () => [],
      createSession: async () => ({
        id: "s1",
        adapter_id: "claude-code",
        title: "新",
        created_at: "",
        updated_at: "",
        native_session_id: null,
        busy: false,
        events: [],
      }),
      getSession: async () => ({
        id: "s1",
        adapter_id: "claude-code",
        title: "新",
        created_at: "",
        updated_at: "",
        native_session_id: null,
        busy: false,
        events: [],
      }),
      send: async () => "started" as const,
      interrupt: async () => true,
      subscribe: () => () => {},
    };
    render(
      <WorkspaceLayout
        {...base}
        runMode="VIBE"
        commandSurface={surface}
        rightPanel={
          <AgentChatPane
            transport={transport}
            commandPhase={surface.phase}
            primaryCtaTestId={surface.primaryCtaTestId}
            keyConfigured
          />
        }
      />,
    );

    expect(screen.getByTestId("command-surface")).toHaveAttribute(
      "data-phase",
      "idle",
    );
    expect(screen.getByTestId("welcome-pane")).toHaveAttribute(
      "data-welcome-variant",
      "speak_right",
    );
    expect(screen.getByTestId("welcome-command")).toHaveTextContent(
      "在右侧说出你的需求",
    );
    expect(screen.queryByText("打开文件")).toBeNull();
    expect(screen.getByTestId("open-project-panel")).toBeInTheDocument();
    expect(screen.getByTestId("open-project")).toHaveAttribute(
      "data-command-role",
      "secondary",
    );
    expect(screen.getByTestId("open-project")).toHaveAttribute(
      "data-variant",
      "page",
    );
  });

  it("进行中态：指挥面指向进行中 CTA；纯 journey-active 不空让路壳（C.10a）", () => {
    const surface = resolveCommandSurface({
      hasSession: true,
      keyReady: true,
      inProgress: true,
      inProgressCta: "journey-active",
    });
    render(
      <WorkspaceLayout
        {...base}
        commandSurface={surface}
        rightPanel={
          <div data-testid="stub-right">
            <div data-testid="journey-active" data-primary-cta="true">
              进行中占位
            </div>
          </div>
        }
      />,
    );

    expect(screen.getByTestId("command-surface")).toHaveAttribute(
      "data-phase",
      "in_progress",
    );
    // C.10a：无三步台/确认时不渲染空 middle-yield
    expect(screen.queryByTestId("middle-yield")).toBeNull();
    expect(screen.getByTestId("command-surface")).toHaveAttribute(
      "data-primary-cta",
      "journey-active",
    );
    expect(screen.getByTestId("journey-active")).toHaveAttribute(
      "data-primary-cta",
      "true",
    );
  });
});

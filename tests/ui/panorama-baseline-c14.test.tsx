// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanoramaPane } from "../../src/components/studio/PanoramaPane";
import type { BaselineArchivePayload } from "../../src/lib/daemon-api";

function makeBaseline(
  overrides: Partial<BaselineArchivePayload["archive"]> = {},
): BaselineArchivePayload {
  return {
    archive: {
      schema_version: "1.0.0",
      kind: "project_baseline_archive",
      scan_id: "baseline-test-1",
      scanned_at: "2026-10-26T00:00:00.000Z",
      tool_version: "0.1.0",
      review_status: "pending_review",
      accepted_at: null,
      grants_construction: false,
      phase: "done",
      progress_copy: "现状整理完成（观察结果，未经运行验证）",
      p0: {
        package_name: "demo",
        package_version: "1.0.0",
        top_level_entries: ["src/", "package.json"],
        route_clues: ["/checkout"],
        module_entry_clues: ["src/index.ts"],
        scanned_paths_note: ["package.json"],
        duration_ms: 12,
        timed_out: false,
        network_denied: true,
        dynamic_exec_denied: true,
      },
      deep: {
        structure_nodes: [
          {
            id: "struct:src/a.ts",
            title: "src/a.ts",
            kind: "structure",
            provenance_plain: "来源线索：代码文件 src/a.ts",
            status_plain: "已识别模块结构，但未经自动化测试验证",
            confidence_label: "代码中直接发现",
          },
        ],
        capability_nodes: [
          {
            id: "cap:/checkout",
            title: "页面 /checkout",
            kind: "capability",
            provenance_plain: "来源线索：src/pages/checkout.tsx",
            status_plain: "已识别模块结构，但未经自动化测试验证",
            confidence_label: "根据代码线索归纳",
          },
        ],
        test_file_count: 1,
        test_stat_note: "静态发现 1 个测试文件声明（不代表测试通过或覆盖良好）",
        import_edge_count: 2,
        duration_ms: 20,
        timed_out: false,
        incomplete: false,
      },
      dirty: {
        clean: false,
        uncommitted: [],
        untracked: [".env.local"],
        steward_message:
          "发现您本地有 1 个未保存的临时文件。请放心，系统已自动把它们加入保护白名单，后续施工绝不触碰或覆盖它们。",
        protect_paths: [".env.local"],
        dirty_exclusions: [".env.local"],
      },
      ignore_rules: [],
      incomplete: false,
      notes: [],
      ...overrides,
    },
    scanning: false,
    accept_label: "认可此基线作为后续参考",
    grants_construction: false,
  };
}

describe("PanoramaPane baseline (TASK-C.14b/c)", () => {
  it("展示进度文案、脏区管家黄标、两行白话与确认按钮", () => {
    const onAccept = vi.fn();
    render(
      <PanoramaPane baseline={makeBaseline()} onAcceptBaseline={onAccept} />,
    );
    expect(screen.getByTestId("panorama-baseline")).toHaveAttribute(
      "data-grants-construction",
      "false",
    );
    expect(screen.getByTestId("panorama-baseline-progress").textContent).toMatch(
      /现状整理完成|安全探查/,
    );
    expect(screen.getByTestId("panorama-baseline-dirty").textContent).toContain(
      "保护白名单",
    );
    expect(screen.getByTestId("panorama-baseline-dirty").textContent).not.toMatch(
      /损坏|中毒/,
    );
    const node = screen.getAllByTestId("panorama-baseline-node")[0]!;
    expect(node.textContent).toMatch(/来源线索：/);
    expect(node.textContent).toMatch(/未经自动化测试验证/);
    fireEvent.click(screen.getByTestId("panorama-baseline-accept"));
    expect(onAccept).toHaveBeenCalled();
    expect(screen.getByTestId("panorama-baseline-accept").textContent).toBe(
      "认可此基线作为后续参考",
    );
  });

  it("扫描中显示安全探查文案", () => {
    const payload = makeBaseline({ phase: "p0", p0: null });
    payload.scanning = true;
    payload.archive!.progress_copy =
      "正在为您安全探查项目结构（纯本地只读分析，不触碰线上业务）";
    render(<PanoramaPane baseline={payload} />);
    expect(screen.getByTestId("panorama-baseline-progress").textContent).toContain(
      "安全探查",
    );
  });

  it("scanning 占位且不露出合同空态", () => {
    render(
      <PanoramaPane
        baseline={{
          archive: null,
          scanning: true,
          accept_label: "认可此基线作为后续参考",
          grants_construction: false,
        }}
      />,
    );
    expect(screen.getByTestId("panorama-baseline")).toBeTruthy();
    expect(screen.getByTestId("panorama-baseline-progress").textContent).toMatch(
      /安全探查|整理现状/,
    );
    expect(screen.queryByTestId("panorama-empty")).toBeNull();
    expect(screen.getByTestId("panorama-v02-placeholders")).toBeTruthy();
  });
});

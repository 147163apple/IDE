import { useMemo, useState } from "react";
import {
  EXECUTION_STATUS_LABEL,
  RUN_MODE_LABEL,
  type RunMode,
} from "./workspace-types";
import { WORKBENCH_LABEL } from "../lib/workbench-labels";
import type {
  StudioDraftView,
  StudioExecutionView,
  StudioProtectedEntryView,
} from "./supervisor-view-model";

/**
 * TASK-C.2 中栏合同审阅视口（C.10c 用户可见名：合同操作台）。
 *
 * 四视口切换与状态自适应由 `studio/StudioViewportShell` 承担；本组件只负责合同
 * 结构化审阅，作为外壳的 `contract` 插槽挂载（切换走 hidden，勾选状态不丢）。
 *
 * 设计基线（v1.3.3 §3.5 / D2·D4 减负决议）：
 * - 以**中栏 Tab** 呈现，不再是遮挡代码的阻断式 Modal——用户始终能一边看代码一边审阅；
 * - 呈现 S.2 产出的白话理由（`rationale`）与未决问题（`unresolved_questions`）勾选单；
 * - 结构化合同审阅：可写 Scope / 只读路径 / 禁区 / 验证命令 / Token 预算；
 * - 执行期显示实时状态与**紧急暂停**按钮；
 * - Header 模式指示（自由/保护）与保护清单逐条解锁维持零弹窗/单卡标准。
 *
 * 视图类型与"合同 → 视图"适配器在 `supervisor-view-model.ts`（纯函数、可单测）。
 *
 * v1.3.3 坚决不做（推迟 v0.2+，本组件刻意不实现，测试有反证断言）：
 * - 成熟度徽章 `MaturityBadge`、HUD 风险气泡、Snooze 按钮；
 * - 任何基于分数的门禁、任何"成熟度 %"数字。
 */

export interface SupervisorStudioPaneProps {
  runMode: RunMode;
  /** 已锁定的保护条目；`length` 即顶栏「已锁 N 处」的 N */
  protectedEntries?: StudioProtectedEntryView[] | undefined;
  draft?: StudioDraftView | null | undefined;
  execution?: StudioExecutionView | null | undefined;
  /** 紧急暂停：执行期由控制面中止在途进程 */
  onEmergencyPause?: (() => void) | undefined;
  /** 逐条解锁保护条目（模式切换的真实粒度，避免"一键全解"误操作） */
  onUnlockEntry?: ((id: string) => void) | undefined;
  busy?: boolean | undefined;
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-border p-3">
      <h3 className="mb-1.5 text-xs font-semibold text-foreground">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function PathList(props: { paths: string[]; testId: string; empty?: string }) {
  if (props.paths.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {props.empty ?? "（无）"}
      </div>
    );
  }
  return (
    <ul data-testid={props.testId} className="space-y-0.5 text-xs">
      {props.paths.map((path) => (
        <li key={path} className="font-mono">
          · {path}
        </li>
      ))}
    </ul>
  );
}

export function SupervisorStudioPane(props: SupervisorStudioPaneProps) {
  const { draft, execution, runMode } = props;
  const entries = props.protectedEntries ?? [];
  // 本地勾选只表示"我读过了"，不构成任何门禁——未勾选也允许继续
  const [acknowledged, setAcknowledged] = useState<number[]>([]);
  // 紧急暂停是破坏性动作（Daemon 侧只有"中止"能真正停住），故需要二次确认
  const [confirmingStop, setConfirmingStop] = useState(false);

  const unresolved = useMemo(
    () => draft?.unresolved_questions ?? [],
    [draft?.unresolved_questions],
  );

  const toggle = (index: number) =>
    setAcknowledged((list) =>
      list.includes(index) ? list.filter((i) => i !== index) : [...list, index],
    );

  const canPause = execution?.status === "EXECUTING";

  return (
    <div data-testid="supervisor-studio" className="space-y-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 data-testid="studio-title" className="text-sm font-semibold">
          {WORKBENCH_LABEL.studio}
        </h2>
        <span
          data-testid="studio-mode"
          data-mode={runMode}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
        >
          {RUN_MODE_LABEL[runMode]}
        </span>
        {runMode === "PROTECTED" && (
          <span
            data-testid="studio-locked-count"
            className="text-xs text-muted-foreground"
          >
            已锁 {entries.length} 处
          </span>
        )}
      </div>

      {execution && (
        <Section title="执行状态">
          <div
            data-testid="studio-execution"
            data-status={execution.status}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <span className="rounded bg-muted px-2 py-0.5">
              {EXECUTION_STATUS_LABEL[execution.status]}
            </span>
            {execution.workerControl && (
              <span className="text-muted-foreground">
                {execution.workerControl}
              </span>
            )}
            {execution.progress && (
              <span
                data-testid="studio-progress"
                className="text-muted-foreground"
              >
                {execution.progress}
              </span>
            )}
            <button
              type="button"
              data-testid="studio-emergency-pause"
              data-confirming={confirmingStop ? "true" : "false"}
              disabled={!canPause || props.busy === true}
              onClick={() => {
                if (!confirmingStop) {
                  setConfirmingStop(true);
                  return;
                }
                setConfirmingStop(false);
                props.onEmergencyPause?.();
              }}
              className="ml-auto rounded border border-destructive/60 px-2 py-0.5 text-xs text-destructive disabled:opacity-40"
            >
              {confirmingStop ? "确认中止？" : "紧急暂停"}
            </button>
          </div>
          {!canPause && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              未在执行时按钮不可用（执行中才允许紧急暂停）。
            </div>
          )}
          {canPause && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              紧急暂停会立即中止在途进程并丢弃本轮未合并的改动（已合并的不受影响），所以要点两次。
            </div>
          )}
        </Section>
      )}

      {!draft ? (
        <div
          data-testid="studio-empty"
          className="text-xs text-muted-foreground"
        >
          还没有草案。给 AI 描述一下要改什么，Supervisor
          会在你请求时生成一份可供审阅的合同草案（不会在后台偷偷调用模型）。
        </div>
      ) : (
        <>
          <Section title="为什么这样圈范围（白话理由）">
            <ul data-testid="studio-rationale" className="space-y-1 text-xs">
              {draft.rationale.length === 0 ? (
                <li className="text-muted-foreground">（无）</li>
              ) : (
                draft.rationale.map((line, index) => (
                  <li key={`${index}-${line}`} data-testid="rationale-item">
                    · {line}
                  </li>
                ))
              )}
            </ul>
          </Section>

          <Section title="还没说清的地方（未决问题）">
            <div
              data-testid="studio-unresolved-summary"
              className="mb-1 text-[11px] text-muted-foreground"
            >
              共 {unresolved.length} 条，已核对 {acknowledged.length}{" "}
              条（勾选只作记录，不阻断）
            </div>
            <ul data-testid="studio-unresolved" className="space-y-1 text-xs">
              {unresolved.length === 0 ? (
                <li className="text-muted-foreground">
                  （没有未决问题，可以直接进入审阅）
                </li>
              ) : (
                unresolved.map((question, index) => (
                  <li key={`${index}-${question}`}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        data-testid={`unresolved-check-${index}`}
                        checked={acknowledged.includes(index)}
                        onChange={() => toggle(index)}
                      />
                      <span data-testid="unresolved-question">{question}</span>
                    </label>
                  </li>
                ))
              )}
            </ul>
          </Section>

          <div className="grid gap-3 md:grid-cols-2">
            <Section title="AI 可以改的地方">
              <PathList
                paths={draft.writable_paths}
                testId="studio-writable-paths"
              />
            </Section>
            <Section title="只读（能看不能改）">
              <PathList
                paths={draft.readonly_paths}
                testId="studio-readonly-paths"
              />
            </Section>
          </div>

          {draft.strictly_forbidden_paths.length > 0 && (
            <Section title="绝对不许碰">
              <PathList
                paths={draft.strictly_forbidden_paths}
                testId="studio-forbidden-paths"
              />
            </Section>
          )}

          <Section title="怎么算做完了（验证命令）">
            <ul data-testid="studio-commands" className="space-y-0.5 text-xs">
              {draft.commands.map((command, index) => (
                <li
                  key={`${index}-${command.executable}`}
                  className="font-mono"
                >
                  · {command.executable} {command.args.join(" ")}
                  {command.timeout_seconds !== undefined && (
                    <span className="text-muted-foreground">
                      {" "}
                      （上限 {command.timeout_seconds}s）
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="用量上限">
            <ul data-testid="studio-budget" className="space-y-0.5 text-xs">
              <li>
                · 最多改 {draft.budget.max_file_modifications ?? "不限"} 个文件
                / {draft.budget.max_total_diff_lines ?? "不限"} 行
              </li>
              <li>
                · 最多跑 {draft.budget.max_command_executions ?? "不限"} 次命令
              </li>
              <li data-testid="studio-budget-tokens">
                · Token 上限：
                {draft.budget.max_input_tokens ?? "不限"} 输入 /{" "}
                {draft.budget.max_output_tokens ?? "不限"} 输出
              </li>
              <li>
                · 金额上限：
                {draft.budget.max_cost_minor_units === undefined
                  ? "不限"
                  : `${(draft.budget.max_cost_minor_units / 100).toFixed(2)} ${draft.budget.currency ?? ""}`}
              </li>
            </ul>
          </Section>
        </>
      )}

      {runMode === "PROTECTED" && entries.length > 0 && (
        <Section title="已锁住的重要部分">
          <ul
            data-testid="studio-protected-entries"
            className="space-y-1 text-xs"
          >
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2">
                <span>
                  {entry.name}（{entry.patterns.join("、")}）
                </span>
                {props.onUnlockEntry && (
                  <button
                    type="button"
                    data-testid={`unlock-${entry.id}`}
                    disabled={props.busy === true}
                    onClick={() => props.onUnlockEntry?.(entry.id)}
                    className="rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    解锁
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[11px] text-muted-foreground">
            这里逐条解锁，不提供"一键全解"——保护清单是安全网，误点一次不该全丢。
          </div>
        </Section>
      )}
    </div>
  );
}

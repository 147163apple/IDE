import type { SoftwareContract } from "@/lib/contract.schema";
import type { AdmissionView } from "@/lib/daemon-api";
import type { ExecutionStatus, WorkerControl } from "./workspace-types";

/**
 * TASK-C.2 Supervisor Studio 的**纯视图模型**（无 React，便于单测与复用）。
 *
 * 放在独立模块而不是组件文件里有两个原因：
 * 1. react-refresh 只允许组件文件导出组件，helper 混在一起会产生告警；
 * 2. 「是否该弹确认卡」「合同 → 审阅视图」这两件事是可独立验证的纯逻辑，
 *    不该被 JSX 绑架。
 */

/** 验证命令的可读视图（argv 已分离，不拼 shell 字符串） */
export interface StudioCommandView {
  alias?: string;
  executable: string;
  args: string[];
  timeout_seconds?: number;
}

export interface StudioBudgetView {
  max_file_modifications?: number | undefined;
  max_total_diff_lines?: number | undefined;
  max_command_executions?: number | undefined;
  max_duration_seconds?: number | undefined;
  max_input_tokens?: number | undefined;
  max_output_tokens?: number | undefined;
  max_cost_minor_units?: number | undefined;
  currency?: string | undefined;
}

/** 草案审阅视图：全部来自 Daemon 事实（合同 + `supervisor_metadata`），前端不加工内容 */
export interface StudioDraftView {
  rationale: string[];
  unresolved_questions: string[];
  writable_paths: string[];
  readonly_paths: string[];
  strictly_forbidden_paths: string[];
  commands: StudioCommandView[];
  budget: StudioBudgetView;
}

export interface StudioExecutionView {
  contractId?: string | undefined;
  status: ExecutionStatus;
  workerControl?: WorkerControl | undefined;
  /** 实时进度白话（例如「正在执行第 2/3 条验证命令」），由控制面推送 */
  progress?: string | undefined;
}

export interface StudioProtectedEntryView {
  id: string;
  name: string;
  patterns: string[];
}

/**
 * 合同 → 审阅视图的纯适配器。
 * 关键约束：`unresolved_questions` **原样透传、不去重、不截断**（G-11 零丢失在前端也成立）。
 */
export function toStudioDraft(contract: SoftwareContract): StudioDraftView {
  const scope = contract.authorization.file_system_scope;
  const assessment = contract.supervisor_metadata?.maturity_assessment;
  const budgetLimits = contract.authorization.budget_limits;
  const costLimits = contract.authorization.cost_limits;
  return {
    rationale: [...(assessment?.rationale ?? [])],
    unresolved_questions: [...(assessment?.unresolved_questions ?? [])],
    writable_paths: [...scope.writable_paths],
    readonly_paths: [...(scope.readonly_paths ?? [])],
    strictly_forbidden_paths: [...(scope.strictly_forbidden_paths ?? [])],
    commands: contract.verification_spec.commands.map((command) => ({
      alias: command.alias,
      executable: command.executable,
      args: [...command.args],
      timeout_seconds: command.timeout_seconds,
    })),
    budget: {
      max_file_modifications: budgetLimits.max_file_modifications,
      max_total_diff_lines: budgetLimits.max_total_diff_lines,
      max_command_executions: budgetLimits.max_command_executions,
      max_duration_seconds: budgetLimits.max_duration_seconds,
      max_input_tokens: costLimits.max_input_tokens,
      max_output_tokens: costLimits.max_output_tokens,
      max_cost_minor_units: costLimits.max_cost_minor_units,
      currency: costLimits.currency,
    },
  };
}

/** 是否需要弹确认卡：只有"需要人工审批且确实命中了受保护内容"才算 */
export function shouldConfirmAdmission(
  admission: AdmissionView | null | undefined,
): boolean {
  if (!admission) return false;
  if (admission.decision !== "NEEDS_APPROVAL") return false;
  return admission.protectedFiles.length > 0 || admission.entryNames.length > 0;
}

/** 白话提问句：AI 想修改被保护的【登录】代码，同意吗？ */
export function confirmSentence(entryNames: string[]): string {
  if (entryNames.length === 0) {
    return "AI 想修改被保护的代码，同意吗？";
  }
  return `AI 想修改被保护的【${entryNames.join("、")}】代码，同意吗？`;
}

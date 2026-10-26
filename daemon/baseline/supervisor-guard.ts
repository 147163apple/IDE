/**
 * TASK-C.14c：P0 解锁后 Supervisor 防抢跑。
 * 深度未完时返回等待/保守降级，不得抛未处理异常或空白。
 */
import type { BaselineArchive } from "./types";
import { SCAN_PROGRESS_COPY } from "./types";

export interface SupervisorBaselineGuardResult {
  /** true = 可按完整上下文推进；false = 应降级/等待 */
  allow_full_impact: boolean;
  mode: "full" | "wait_deep" | "conservative_p0";
  plain_message: string;
  baseline_phase: BaselineArchive["phase"] | "none";
}

/**
 * Clarification / Impact 调用前挂接：深度未完则降级。
 */
export function guardSupervisorAgainstBaselineRace(
  archive: BaselineArchive | null | undefined,
): SupervisorBaselineGuardResult {
  if (!archive) {
    return {
      allow_full_impact: false,
      mode: "conservative_p0",
      plain_message:
        "正在整理项目现状。我可以先按粗粒度跟你澄清需求；深度结构分析稍后补上。",
      baseline_phase: "none",
    };
  }

  if (
    archive.phase === "p0" ||
    archive.phase === "p1" ||
    archive.phase === "p2" ||
    archive.phase === "idle"
  ) {
    return {
      allow_full_impact: false,
      mode: "wait_deep",
      plain_message: SCAN_PROGRESS_COPY.deep,
      baseline_phase: archive.phase,
    };
  }

  if (archive.incomplete && !archive.deep) {
    return {
      allow_full_impact: false,
      mode: "conservative_p0",
      plain_message:
        "深度分析尚未完成。我先按已看到的目录与路由线索做保守澄清，不会假装已经画全影响面。",
      baseline_phase: archive.phase,
    };
  }

  return {
    allow_full_impact: true,
    mode: "full",
    plain_message: "",
    baseline_phase: archive.phase,
  };
}

/**
 * 把防抢跑提示并入旅程 plain_summary（不抛异常）。
 */
export function prependBaselineGuardNotice(
  summary: string,
  guard: SupervisorBaselineGuardResult,
): string {
  if (guard.allow_full_impact || !guard.plain_message) return summary;
  return `${guard.plain_message}\n\n${summary}`.trim();
}

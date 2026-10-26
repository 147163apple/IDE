/**
 * TASK-C.14：项目现状基线档案类型（独立 Baseline 轨，不并入 Delivery/Task）。
 * 产品主名：项目现状基线档案；落盘 `.stagent/records/baseline/`；禁止 contract_000。
 */

export const BASELINE_RECORDS_ROOT = ".stagent/records/baseline" as const;

/** 基线确认轨（与 DeliveryState 隔离） */
export type BaselineReviewStatus = "pending_review" | "accepted" | "incomplete";

export type BaselineScanPhase = "idle" | "p0" | "p1" | "p2" | "done" | "failed";

export type BaselineProvenance =
  | "static_code"
  | "config"
  | "test_declaration"
  | "git_metadata"
  | "inferred"
  | "user_confirmed";

export interface BaselineSourceRef {
  path: string;
  note?: string;
}

export interface BaselineGraphNode {
  id: string;
  title: string;
  kind: "structure" | "capability" | "route" | "module" | "test_stat";
  provenance: BaselineProvenance;
  source_refs: BaselineSourceRef[];
  /** 白话：来源线索 */
  provenance_plain: string;
  /** 白话：状态说明（观察 ≠ 质量结论） */
  status_plain: string;
  verification_status: "static_only" | "inferred_unverified" | "incomplete";
  confidence_label:
    | "代码中直接发现"
    | "根据代码线索归纳"
    | "尚未运行验证"
    | "外部服务线索"
    | "扫描不完整";
}

export interface WorkspaceDirtyReport {
  clean: boolean;
  uncommitted: string[];
  untracked: string[];
  /** 管家话术（非报错恐吓） */
  steward_message: string | null;
  /** 首张微合同默认排除路径 */
  protect_paths: string[];
}

export interface BaselineP0Skeleton {
  package_name: string | null;
  package_version: string | null;
  top_level_entries: string[];
  route_clues: string[];
  module_entry_clues: string[];
  scanned_paths_note: string[];
  duration_ms: number;
  timed_out: boolean;
  network_denied: true;
  dynamic_exec_denied: true;
}

export interface BaselineDeepPartial {
  structure_nodes: BaselineGraphNode[];
  capability_nodes: BaselineGraphNode[];
  test_file_count: number;
  test_stat_note: string;
  import_edge_count: number;
  duration_ms: number;
  timed_out: boolean;
  incomplete: boolean;
}

export interface BaselineArchive {
  schema_version: "1.0.0";
  /** 产品主名字段；永不使用 contract_000 */
  kind: "project_baseline_archive";
  scan_id: string;
  scanned_at: string;
  tool_version: string;
  review_status: BaselineReviewStatus;
  accepted_at: string | null;
  /** 确认 ≠ 授权：本字段永不签发 exec_token */
  grants_construction: false;
  phase: BaselineScanPhase;
  progress_copy: string;
  p0: BaselineP0Skeleton | null;
  deep: BaselineDeepPartial | null;
  dirty: WorkspaceDirtyReport;
  ignore_rules: string[];
  incomplete: boolean;
  notes: string[];
}

export const SCAN_PROGRESS_COPY = {
  scanning:
    "正在为您安全探查项目结构（纯本地只读分析，不触碰线上业务）",
  organizing: "正在整理现状",
  deep: "正在结合深度分析评估影响面…",
  done: "现状整理完成（观察结果，未经运行验证）",
  failed: "探查未完整完成，已保留部分结果",
} as const;

export function buildStewardDirtyMessage(n: number): string {
  if (n <= 0) return "";
  return `发现您本地有 ${n} 个未保存的临时文件。请放心，系统已自动把它们加入保护白名单，后续施工绝不触碰或覆盖它们。`;
}

import type { SoftwareContract } from "../../../src/lib/contract.schema";

/**
 * 质疑自查领域类型（TASK-S.5 / 架构 §5.7、§6.5）。
 *
 * 三方事实 = Prompt（会话）/ Spec（需求快照）/ Diff（真实代码）。
 * 归因结论只有三类；置信度 < 0.7 一律降级为 UNATTRIBUTED，由用户白话裁决。
 */

/** 60 秒硬超时（架构 D-3：60s 质询看门狗） */
export const DISPUTE_TIMEOUT_MS = 60_000;

/** 置信度门槛（架构 §5.7：confidence < 0.7 自动降级呈递事实） */
export const DISPUTE_CONFIDENCE_THRESHOLD = 0.7;

export const E_DISPUTE_TIMEOUT = "E_DISPUTE_TIMEOUT";

export type DisputeClassification =
  "IMPLEMENTATION_BUG" | "REQUIREMENT_DRIFT" | "UNATTRIBUTED";

export type DisputeActionKind =
  "REWORK" | "REQUIREMENT_CHANGE" | "MANUAL_ARBITRATION";

export interface PromptFactMessage {
  message_id: string;
  role: "user" | "supervisor" | "system";
  text: string;
  created_at: string;
}

export interface PromptFact {
  session_id: string | null;
  source: "SESSION" | "CHALLENGE_ONLY";
  /** 会话中最早的原始需求陈述（没有会话时为 null） */
  original_request: string | null;
  /** 用户显式确认/批准过的意图记录 */
  confirmations: PromptFactMessage[];
  /** 与本次质询关键词命中的会话消息 */
  matched_messages: PromptFactMessage[];
}

export interface SpecFact {
  snapshot_id: string;
  version: number;
  sha256: string;
  content: string;
  /** 命中质询关键词的规范条目（不含标题与空行） */
  matched_entries: string[];
}

export interface DiffFact {
  worktree_path: string;
  available: boolean;
  changed_files: string[];
  diff_stat: string;
  diff_excerpt: string;
  commit_sha: string | null;
  /** 真实终端输出（来自 Evidence 的 stdout/stderr tail） */
  terminal_lines: string[];
  verification_results: Array<{
    alias: string;
    exit_code: number;
    passed: boolean;
  }>;
  evidence_id: string | null;
  /** 测试文件是否被改动：影响归因可信度 */
  tests_modified: boolean;
}

export interface TriadFacts {
  challenge: string;
  keywords: string[];
  prompt: PromptFact;
  spec: SpecFact | null;
  code: DiffFact;
}

export interface ReworkProposal {
  proposal_id: string;
  contract_id: string;
  change_request_id: string;
  /** 返工目标：严格等于「已变更文件 ∩ 合同 writable_paths」 */
  target_files: string[];
  /** 被拒绝的越界候选（只记录，绝不扩权） */
  rejected_paths: string[];
  /** 存在越界候选时为 true：必须先走合同升版审批，不能自动返工 */
  requires_scope_expansion: boolean;
  scope_subset_valid: true;
  instructions: string;
}

export interface RequirementChangeProposal {
  proposal_id: string;
  contract_id: string;
  change_request_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  source_snapshot_id: string;
  /** 未落盘的新合同草案，必须重新走审批 */
  draft_contract: SoftwareContract;
}

export interface DisputeNextAction {
  kind: DisputeActionKind;
  rework?: ReworkProposal | undefined;
  change_request?: RequirementChangeProposal | undefined;
  message?: string | undefined;
}

export interface DisputeReport {
  report_id: string;
  contract_id: string;
  change_request_id: string;
  challenge: string;
  classification: DisputeClassification;
  /** 降级前的算法建议（仅 UNATTRIBUTED 且有建议时出现） */
  suggested_classification?: DisputeClassification | undefined;
  confidence: number;
  degraded: boolean;
  reason_code?: string | undefined;
  rationale: string[];
  plain_summary: string;
  facts: TriadFacts;
  next_action: DisputeNextAction;
  generated_at: string;
}

export class DisputeTimeoutError extends Error {
  readonly code = E_DISPUTE_TIMEOUT;

  constructor(timeoutMs: number) {
    super(
      `[${E_DISPUTE_TIMEOUT}] 质疑自查在 ${timeoutMs}ms 内未完成，已安全中止`,
    );
    this.name = "DisputeTimeoutError";
  }
}

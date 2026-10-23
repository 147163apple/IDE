import { randomUUID } from "node:crypto";
import type { SoftwareContract } from "../../../src/lib/contract.schema";
import {
  buildRequirementChangeProposal,
  buildReworkProposal,
  classifyDispute,
} from "./classification";
import { collectTriadFacts, type DisputeFactDeps } from "./evidence-triad";
import {
  DISPUTE_TIMEOUT_MS,
  DisputeTimeoutError,
  E_DISPUTE_TIMEOUT,
  type DisputeNextAction,
  type DisputeReport,
  type SpecFact,
  type TriadFacts,
} from "./types";

/**
 * 质疑自查引擎（TASK-S.5）。
 *
 * 流程固定为四步，任何一步都不允许"模型先下结论再补证据"：
 * 1. 抓三方事实（会话 / 需求快照 / 真实 Diff+退出码）；
 * 2. 规则归因 + 置信度；
 * 3. 按结论生成受限动作（返工提案 / 新合同草案 / 人工裁决）；
 * 4. 输出白话报告。
 *
 * 看门狗只包住"抓事实"阶段：归因是纯同步计算，不会挂死。
 */

export interface DisputeSelfCheckInput {
  contract: SoftwareContract;
  challenge: string;
  repoRoot: string;
  sessionId?: string | undefined;
  timeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
}

/**
 * 60 秒硬超时兜底。
 *
 * 注意：超时只能拒绝调用方，无法强杀底层 I/O（Node 无协程取消）。
 * 因此这里保证的是"调用方 60s 内一定拿到结果或错误"，而不是"底层立刻停止"。
 */
export async function withDisputeWatchdog<T>(
  work: Promise<T>,
  timeoutMs: number = DISPUTE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new DisputeTimeoutError(timeoutMs));
        }, timeoutMs);
        // 不因看门狗定时器把进程吊住（CLI/测试退出时尤其重要）
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function changeRequestId(now: Date): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `cr_${day}_${randomUUID().slice(0, 8)}`;
}

function plainSummary(
  classification: DisputeReport["classification"],
  confidence: number,
  next: DisputeNextAction,
): string {
  switch (classification) {
    case "IMPLEMENTATION_BUG":
      return (
        `这次更像「实现偏差」：规范里写了相关要求，但代码或验证没有做到` +
        `（置信度 ${confidence.toFixed(2)}）。已生成返工提案，` +
        `只允许改动原合同授权范围内的文件` +
        (next.rework && next.rework.target_files.length > 0
          ? `：${next.rework.target_files.slice(0, 3).join("、")}`
          : "") +
        "。"
      );
    case "REQUIREMENT_DRIFT":
      return (
        `这次更像「需求遗漏或理解差异」：您最初提过该诉求，但已批准的需求规范` +
        `没有覆盖（置信度 ${confidence.toFixed(2)}）。已生成新的合同草案，` +
        "需要您重新审批后才会执行，不会直接改代码。"
      );
    default:
      return (
        `自动归因的可信度不足（置信度 ${confidence.toFixed(2)}，门槛 0.70）。` +
        "三方事实已原样列出：请您选择「按 Bug 修复」或「按新需求演进」。"
      );
  }
}

/** 执行一次完整的质疑自查（不含 HTTP/广播） */
export async function runDisputeSelfCheck(
  input: DisputeSelfCheckInput,
  deps: DisputeFactDeps = {},
): Promise<DisputeReport> {
  const now = input.now ?? (() => new Date());
  const timeoutMs = input.timeoutMs ?? DISPUTE_TIMEOUT_MS;
  const at = now();

  const facts = await withDisputeWatchdog(
    collectTriadFacts(
      {
        contract: input.contract,
        challenge: input.challenge,
        repoRoot: input.repoRoot,
        ...(input.sessionId === undefined
          ? {}
          : { sessionId: input.sessionId }),
      },
      deps,
    ),
    timeoutMs,
  );

  const outcome = classifyDispute(facts, input.contract);
  const crId = changeRequestId(at);

  let nextAction: DisputeNextAction;
  if (outcome.classification === "IMPLEMENTATION_BUG") {
    nextAction = {
      kind: "REWORK",
      rework: buildReworkProposal(input.contract, facts, crId),
    };
  } else if (outcome.classification === "REQUIREMENT_DRIFT") {
    nextAction = {
      kind: "REQUIREMENT_CHANGE",
      change_request: buildRequirementChangeProposal(
        input.contract,
        facts,
        crId,
        at,
      ),
    };
  } else {
    nextAction = {
      kind: "MANUAL_ARBITRATION",
      message:
        "自动归因证据不足，请依据下方三方事实选择「按 Bug 修复」或「按新需求演进」。",
    };
  }

  return {
    report_id: `dispute_${randomUUID().slice(0, 8)}`,
    contract_id: input.contract.contract_id,
    change_request_id: crId,
    challenge: input.challenge,
    classification: outcome.classification,
    ...(outcome.suggested !== outcome.classification
      ? { suggested_classification: outcome.suggested }
      : {}),
    confidence: outcome.confidence,
    degraded: outcome.classification === "UNATTRIBUTED",
    rationale: outcome.rationale,
    plain_summary: plainSummary(
      outcome.classification,
      outcome.confidence,
      nextAction,
    ),
    facts,
    next_action: nextAction,
    generated_at: at.toISOString(),
  };
}

/**
 * 超时降级报告（架构 D-3）：60s 内没算完时，不让用户干等，
 * 把已抓到的规范与质询原样呈递，明确标注 `E_DISPUTE_TIMEOUT`。
 */
export function buildTimeoutFallbackReport(params: {
  contract: SoftwareContract;
  challenge: string;
  timeoutMs?: number | undefined;
  spec?: SpecFact | null | undefined;
  now?: (() => Date) | undefined;
}): DisputeReport {
  const now = params.now ?? (() => new Date());
  const at = now();
  const crId = changeRequestId(at);
  const timeoutMs = params.timeoutMs ?? DISPUTE_TIMEOUT_MS;

  const facts: TriadFacts = {
    challenge: params.challenge,
    keywords: [],
    prompt: {
      session_id: null,
      source: "CHALLENGE_ONLY",
      original_request: null,
      confirmations: [],
      matched_messages: [],
    },
    spec: params.spec ?? null,
    code: {
      worktree_path: "",
      available: false,
      changed_files: [],
      diff_stat: "",
      diff_excerpt: "",
      commit_sha: null,
      terminal_lines: [],
      verification_results: [],
      evidence_id: null,
      tests_modified: false,
    },
  };

  return {
    report_id: `dispute_${randomUUID().slice(0, 8)}`,
    contract_id: params.contract.contract_id,
    change_request_id: crId,
    challenge: params.challenge,
    classification: "UNATTRIBUTED",
    confidence: 0,
    degraded: true,
    reason_code: E_DISPUTE_TIMEOUT,
    rationale: [`质疑自查在 ${timeoutMs}ms 内未完成，已按 D-3 降级为人工裁决`],
    plain_summary:
      `自查超时（${timeoutMs}ms），系统没有足够时间完成三方比对。` +
      "下方只展示已抓取的事实；请稍后重试，或直接依据现有事实选择处理方式。",
    facts,
    next_action: {
      kind: "MANUAL_ARBITRATION",
      message: "自查超时，请人工裁决或稍后重试。",
    },
    generated_at: at.toISOString(),
  };
}

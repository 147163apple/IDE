/**
 * 旅程编排入口（TASK-S.6）：右侧一句话 → 分流 → 复用既有引擎。
 *
 * 不重砌 S.2 / S.5 / C.7：只做粘合。
 * - DISPUTE → runDisputeSelfCheck
 * - MAJOR_DRAFT / FAST_PATH → generateContractDraft（Fast Path 标 LOW + skip_demo）
 * - CHAT → 透传提示，由前端交给 Worker
 */

import {
  classifyJourneyIntent,
  type JourneyIntentKind,
  type JourneyIntentResult,
} from "../../../src/lib/journey/intent-router";
import type { SoftwareContract } from "../../../src/lib/contract.schema";
import {
  generateContractDraft,
  type ContractDraftGenerated,
  type DraftEnrichment,
} from "../draft-generator";
import { runDisputeSelfCheck } from "../dispute/index";
import type { DisputeReport } from "../dispute/types";
import type { RequirementsStore } from "../specs/requirements-store";
import type { SupervisorBudgetLedger } from "../budget";
import type { SupervisorMessage } from "../types";

export interface JourneyOrchestrateInput {
  message: string;
  repoRoot: string;
  /** 当前选中合同；质疑路径必需 */
  contract?: SoftwareContract | undefined;
  sessionId?: string | undefined;
  requirementsStore?: RequirementsStore | undefined;
  budgetLedger?: SupervisorBudgetLedger | undefined;
  enrich?:
    | ((prompt: string) => Promise<DraftEnrichment> | DraftEnrichment)
    | undefined;
  /** 注入时钟（测试） */
  now?: (() => Date) | undefined;
  /** 测试替身：覆盖 dispute 执行。生产不传。 */
  runDispute?: typeof runDisputeSelfCheck | undefined;
  /** 测试替身：覆盖草案生成。生产不传。 */
  runDraft?:
    | ((
        intent: string,
        risk: "LOW" | "MEDIUM",
      ) => Promise<ContractDraftGenerated>)
    | undefined;
}

export interface JourneyOrchestrateResult {
  intent: JourneyIntentResult;
  route: JourneyIntentKind;
  plain_summary: string;
  dispute_report?: DisputeReport | undefined;
  draft?: ContractDraftGenerated | undefined;
  requirements_updated?: boolean | undefined;
  requirements_hint?: string | undefined;
  skip_demo?: boolean | undefined;
  suggest_viewport?: "dispute" | "demo" | "graph" | "contract" | undefined;
  code?: string | undefined;
}

function formatLocalTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export async function orchestrateJourney(
  input: JourneyOrchestrateInput,
): Promise<JourneyOrchestrateResult> {
  const intent = classifyJourneyIntent(input.message);
  const now = input.now?.() ?? new Date();

  if (intent.kind === "CHAT") {
    return {
      intent,
      route: "CHAT",
      plain_summary: intent.reasons.join(" "),
    };
  }

  if (intent.kind === "DISPUTE") {
    if (!input.contract) {
      return {
        intent,
        route: "DISPUTE",
        plain_summary:
          "我听出你在质疑「这里做错了」。请先在左侧点一份合同（或先让我出草案），我才能对照蓝图帮你查。",
        code: "CONTRACT_REQUIRED",
        suggest_viewport: "contract",
      };
    }

    if (input.requirementsStore) {
      input.requirementsStore.ensureBaseline(input.contract);
    }

    const run = input.runDispute ?? runDisputeSelfCheck;
    const report = await run({
      contract: input.contract,
      challenge: input.message.trim(),
      repoRoot: input.repoRoot,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    });

    return {
      intent,
      route: "DISPUTE",
      plain_summary: report.plain_summary,
      dispute_report: report,
      suggest_viewport: "dispute",
      requirements_updated: true,
      requirements_hint: `需求基准已对齐 · ${formatLocalTime(now)}`,
    };
  }

  // MAJOR_DRAFT / FAST_PATH → 出草案
  const risk: "LOW" | "MEDIUM" = intent.kind === "FAST_PATH" ? "LOW" : "MEDIUM";

  let draft: ContractDraftGenerated;
  if (input.runDraft) {
    draft = await input.runDraft(input.message.trim(), risk);
  } else {
    const message: SupervisorMessage = {
      message_id: `msg_journey_${now.getTime()}`,
      role: "user",
      text: input.message.trim(),
      created_at: now.toISOString(),
      source: "ui",
    };
    const generated = await generateContractDraft({
      repoRoot: input.repoRoot,
      messages: [message],
      trigger: "USER_REQUEST",
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.budgetLedger === undefined
        ? {}
        : { budgetLedger: input.budgetLedger }),
      ...(input.enrich === undefined ? {} : { enrich: input.enrich }),
      now: () => now,
    });
    if (!generated.generated) {
      return {
        intent,
        route: intent.kind,
        plain_summary:
          "这次没有生成草案（触发条件不满足）。请换一句更具体的需求再试。",
        code: "DRAFT_SKIPPED",
        skip_demo: intent.skip_demo,
      };
    }
    // Fast Path：强制 LOW 风险，便于后续 system:fast-path 准入
    if (
      intent.kind === "FAST_PATH" &&
      generated.contract.intent.risk_level !== "LOW"
    ) {
      generated.contract = {
        ...generated.contract,
        intent: { ...generated.contract.intent, risk_level: "LOW" },
      };
    }
    draft = generated;
  }

  let requirementsUpdated = false;
  let requirementsHint: string | undefined;
  if (input.requirementsStore) {
    input.requirementsStore.ensureBaseline(draft.contract);
    requirementsUpdated = true;
    requirementsHint = `需求说明已更新 · ${formatLocalTime(now)}`;
  }

  const plain =
    intent.kind === "FAST_PATH"
      ? [
          "这是小事，走快速通道——不必再强制整套 Demo。",
          ...intent.reasons,
          `已为你备好低风险草案「${draft.contract.intent.title}」。确认范围后可直接小修；越权会自动停住并升成标准审批。`,
        ].join(" ")
      : [
          "我按大事帮你出了草案。",
          ...intent.reasons,
          `标题：${draft.contract.intent.title}。左侧需求说明已刷新，你可以先看再决定是否开工。`,
        ].join(" ");

  return {
    intent,
    route: intent.kind,
    plain_summary: plain,
    draft,
    requirements_updated: requirementsUpdated,
    ...(requirementsHint === undefined
      ? {}
      : { requirements_hint: requirementsHint }),
    skip_demo: intent.skip_demo,
    suggest_viewport: intent.kind === "FAST_PATH" ? "contract" : "demo",
  };
}

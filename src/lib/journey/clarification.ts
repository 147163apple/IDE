/**
 * TASK-C.11a：白话推荐选择题 · 澄清轮次硬顶 ≤2（Top7#4）。
 *
 * 纯规则 + fixture，零模型：便于 UI 演示与单测。
 * 第 3 轮主动澄清一律收束为安全默认，写入后续合同草案字段。
 */

export const CLARIFICATION_MAX_ROUNDS = 2 as const;

export interface ClarificationOption {
  id: string;
  label: string;
  /** 唯一推荐项 */
  recommended: boolean;
  reason?: string;
}

export interface ClarificationQuestion {
  id: string;
  prompt: string;
  options: ClarificationOption[];
  /** 选中后写入合同草案的字段键 */
  draft_field: string;
}

export interface ClarificationRound {
  round_index: number; // 0-based；有效 0..1
  questions: ClarificationQuestion[];
  /** 本轮结束后若仍有未决且未达硬顶，是否建议再开一轮 */
  may_follow_up: boolean;
}

export interface ClarificationAnswer {
  question_id: string;
  option_id: string;
  label: string;
  draft_field: string;
  via: "user" | "default";
}

export interface ClarificationSessionState {
  intent_text: string;
  round_index: number;
  answers: ClarificationAnswer[];
  status: "idle" | "asking" | "completed" | "capped";
}

export class ClarificationRoundCapError extends Error {
  readonly code = "E_CLARIFICATION_ROUND_CAP" as const;
  constructor(message = "主动澄清已达 2 轮上限，未决项将写入安全默认") {
    super(message);
    this.name = "ClarificationRoundCapError";
  }
}

/** 断言下一轮主动澄清是否允许；第 3 轮（round_index>=2）抛错 */
export function assertClarificationRoundAllowed(nextRoundIndex: number): void {
  if (nextRoundIndex >= CLARIFICATION_MAX_ROUNDS) {
    throw new ClarificationRoundCapError();
  }
}

/**
 * 按意图生成某一轮 fixture 选择题。
 * 每题恰好一个 recommended=true。
 */
export function buildClarificationRound(
  intentText: string,
  roundIndex: number,
): ClarificationRound {
  assertClarificationRoundAllowed(roundIndex);
  const text = intentText.trim() || "新功能";
  const short = text.length > 24 ? `${text.slice(0, 24)}…` : text;

  if (roundIndex === 0) {
    return {
      round_index: 0,
      may_follow_up: true,
      questions: [
        {
          id: "q_audience",
          prompt: `关于「${short}」，主要给谁用？`,
          draft_field: "audience",
          options: [
            {
              id: "opt_end_user",
              label: "最终用户（客户/员工自己点）",
              recommended: true,
              reason: "多数功能先服务真实使用者，范围更清晰",
            },
            {
              id: "opt_admin",
              label: "后台管理员",
              recommended: false,
            },
            {
              id: "opt_both",
              label: "两边都要",
              recommended: false,
            },
          ],
        },
        {
          id: "q_priority",
          prompt: "这一版最要紧的是哪件事？",
          draft_field: "priority",
          options: [
            {
              id: "opt_happy_path",
              label: "先跑通主流程，细枝末节以后再说",
              recommended: true,
              reason: "v0.1 先能验收主路径，避免一次做太大",
            },
            {
              id: "opt_polish",
              label: "界面和文案也要一次到位",
              recommended: false,
            },
            {
              id: "opt_integration",
              label: "必须先接上现有系统/数据",
              recommended: false,
            },
          ],
        },
      ],
    };
  }

  // round 1（第 2 轮）
  return {
    round_index: 1,
    may_follow_up: false,
    questions: [
      {
        id: "q_data",
        prompt: "演示和验收时，数据怎么处理？",
        draft_field: "data_mode",
        options: [
          {
            id: "opt_mock",
            label: "先用假数据演示，不碰真实业务库",
            recommended: true,
            reason: "隔离 Demo 更安全，也符合「先玩玩具再写真码」",
          },
          {
            id: "opt_read_only",
            label: "可以只读连一点真实数据",
            recommended: false,
          },
          {
            id: "opt_write",
            label: "允许写入真实环境（需另签合同）",
            recommended: false,
          },
        ],
      },
    ],
  };
}

/** 取某题的唯一推荐项；缺推荐时回退第一项（防坏 fixture） */
export function pickRecommendedOption(
  question: ClarificationQuestion,
): ClarificationOption {
  const hit = question.options.find((o) => o.recommended);
  return hit ?? question.options[0]!;
}

/** 把未答题目收束为推荐默认 */
export function applySafeDefaults(
  questions: ClarificationQuestion[],
  existing: ClarificationAnswer[],
): ClarificationAnswer[] {
  const answered = new Set(existing.map((a) => a.question_id));
  const extras: ClarificationAnswer[] = [];
  for (const q of questions) {
    if (answered.has(q.id)) continue;
    const opt = pickRecommendedOption(q);
    extras.push({
      question_id: q.id,
      option_id: opt.id,
      label: opt.label,
      draft_field: q.draft_field,
      via: "default",
    });
  }
  return [...existing, ...extras];
}

export function recordClarificationAnswer(
  state: ClarificationSessionState,
  question: ClarificationQuestion,
  optionId: string,
): ClarificationSessionState {
  const opt = question.options.find((o) => o.id === optionId);
  if (!opt) {
    throw new Error(`unknown clarification option: ${optionId}`);
  }
  const without = state.answers.filter((a) => a.question_id !== question.id);
  return {
    ...state,
    answers: [
      ...without,
      {
        question_id: question.id,
        option_id: opt.id,
        label: opt.label,
        draft_field: question.draft_field,
        via: "user",
      },
    ],
    status: "asking",
  };
}

export function isRoundComplete(
  round: ClarificationRound,
  answers: ClarificationAnswer[],
): boolean {
  const ids = new Set(answers.map((a) => a.question_id));
  return round.questions.every((q) => ids.has(q.id));
}

/**
 * 尝试进入下一轮；若已达硬顶则用默认收束并标记 capped/completed。
 */
export function advanceClarificationSession(
  state: ClarificationSessionState,
  currentRound: ClarificationRound,
): {
  state: ClarificationSessionState;
  nextRound: ClarificationRound | null;
  defaultsApplied: ClarificationAnswer[];
} {
  let answers = state.answers;
  if (!isRoundComplete(currentRound, answers)) {
    answers = applySafeDefaults(currentRound.questions, answers);
  }

  const nextIndex = currentRound.round_index + 1;
  if (!currentRound.may_follow_up || nextIndex >= CLARIFICATION_MAX_ROUNDS) {
    return {
      state: {
        ...state,
        answers,
        round_index: currentRound.round_index,
        status: nextIndex >= CLARIFICATION_MAX_ROUNDS ? "capped" : "completed",
      },
      nextRound: null,
      defaultsApplied: answers.filter((a) => a.via === "default"),
    };
  }

  try {
    const nextRound = buildClarificationRound(state.intent_text, nextIndex);
    return {
      state: {
        ...state,
        answers,
        round_index: nextIndex,
        status: "asking",
      },
      nextRound,
      defaultsApplied: answers.filter((a) => a.via === "default"),
    };
  } catch (err) {
    if (err instanceof ClarificationRoundCapError) {
      return {
        state: {
          ...state,
          answers,
          status: "capped",
        },
        nextRound: null,
        defaultsApplied: answers.filter((a) => a.via === "default"),
      };
    }
    throw err;
  }
}

export function startClarificationSession(intentText: string): {
  state: ClarificationSessionState;
  round: ClarificationRound;
} {
  const round = buildClarificationRound(intentText, 0);
  return {
    state: {
      intent_text: intentText.trim(),
      round_index: 0,
      answers: [],
      status: "asking",
    },
    round,
  };
}

/** 把澄清答案编成可附在旅程消息后的白话摘要（给草案/合同默认项） */
export function formatClarificationDefaultsSummary(
  answers: ClarificationAnswer[],
): string {
  if (answers.length === 0) return "";
  return answers
    .map(
      (a) =>
        `${a.draft_field}=${a.label}${a.via === "default" ? "（默认）" : ""}`,
    )
    .join("；");
}

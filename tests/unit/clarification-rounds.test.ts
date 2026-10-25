/**
 * TASK-C.11a：澄清轮次硬顶 ≤2 + 推荐项唯一
 */
import { describe, expect, it } from "vitest";
import {
  CLARIFICATION_MAX_ROUNDS,
  ClarificationRoundCapError,
  advanceClarificationSession,
  assertClarificationRoundAllowed,
  buildClarificationRound,
  formatClarificationDefaultsSummary,
  isRoundComplete,
  pickRecommendedOption,
  recordClarificationAnswer,
  startClarificationSession,
} from "../../src/lib/journey/clarification";

describe("TASK-C.11a clarification rounds", () => {
  it("caps active clarification at 2 rounds", () => {
    expect(CLARIFICATION_MAX_ROUNDS).toBe(2);
    expect(() => assertClarificationRoundAllowed(0)).not.toThrow();
    expect(() => assertClarificationRoundAllowed(1)).not.toThrow();
    expect(() => assertClarificationRoundAllowed(2)).toThrow(
      ClarificationRoundCapError,
    );
  });

  it("each question has exactly one recommended option", () => {
    for (const roundIndex of [0, 1] as const) {
      const round = buildClarificationRound("加会员等级", roundIndex);
      for (const q of round.questions) {
        const rec = q.options.filter((o) => o.recommended);
        expect(rec).toHaveLength(1);
        expect(pickRecommendedOption(q).id).toBe(rec[0]!.id);
      }
    }
  });

  it("advances round 0 → 1 then completes without round 2", () => {
    const { state, round } = startClarificationSession("加会员等级");
    expect(state.status).toBe("asking");
    expect(round.round_index).toBe(0);

    let cur = state;
    for (const q of round.questions) {
      const opt = pickRecommendedOption(q);
      cur = recordClarificationAnswer(cur, q, opt.id);
    }
    expect(isRoundComplete(round, cur.answers)).toBe(true);

    const mid = advanceClarificationSession(cur, round);
    expect(mid.nextRound?.round_index).toBe(1);
    expect(mid.state.status).toBe("asking");

    let cur2 = mid.state;
    for (const q of mid.nextRound!.questions) {
      const opt = pickRecommendedOption(q);
      cur2 = recordClarificationAnswer(cur2, q, opt.id);
    }
    const done = advanceClarificationSession(cur2, mid.nextRound!);
    expect(done.nextRound).toBeNull();
    expect(["completed", "capped"]).toContain(done.state.status);
    expect(formatClarificationDefaultsSummary(done.state.answers).length).toBeGreaterThan(0);
  });
});

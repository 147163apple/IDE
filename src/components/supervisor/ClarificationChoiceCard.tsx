import type { ClarificationQuestion } from "@/lib/journey/clarification";

/**
 * TASK-C.11a：右栏白话推荐选择题卡。
 * 每题唯一「推荐」徽标；点击选项即回填，不算开放式技术填空。
 */
export interface ClarificationChoiceCardProps {
  question: ClarificationQuestion;
  roundIndex: number;
  selectedOptionId?: string | null | undefined;
  disabled?: boolean | undefined;
  onSelect: (questionId: string, optionId: string) => void;
}

export function ClarificationChoiceCard(props: ClarificationChoiceCardProps) {
  const { question, roundIndex, selectedOptionId, disabled, onSelect } = props;
  return (
    <section
      data-testid="clarification-choice-card"
      data-question-id={question.id}
      data-round={roundIndex}
      className="rounded border border-violet-600/40 bg-violet-500/10 p-2 text-[11px] leading-relaxed"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-violet-900/80">
        <span>澄清 · 第 {roundIndex + 1} 轮</span>
        <span className="font-normal normal-case tracking-normal text-muted-foreground">
          点选即可，不必填技术细节
        </span>
      </div>
      <div
        data-testid="clarification-prompt"
        className="mb-2 text-[12px] font-medium text-foreground"
      >
        {question.prompt}
      </div>
      <ul className="space-y-1.5">
        {question.options.map((opt) => {
          const selected = selectedOptionId === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                data-testid="clarification-option"
                data-option-id={opt.id}
                data-recommended={opt.recommended ? "true" : "false"}
                data-selected={selected ? "true" : "false"}
                disabled={disabled === true}
                onClick={() => onSelect(question.id, opt.id)}
                className={
                  selected
                    ? "flex w-full flex-col items-start gap-0.5 rounded border border-violet-600 bg-violet-500/20 px-2 py-1.5 text-left disabled:opacity-50"
                    : "flex w-full flex-col items-start gap-0.5 rounded border border-border bg-background/80 px-2 py-1.5 text-left hover:border-violet-500/60 disabled:opacity-50"
                }
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] text-foreground">{opt.label}</span>
                  {opt.recommended ? (
                    <span
                      data-testid="clarification-recommended-badge"
                      className="rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950"
                    >
                      推荐
                    </span>
                  ) : null}
                </span>
                {opt.recommended && opt.reason ? (
                  <span className="text-[10px] text-muted-foreground">
                    {opt.reason}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

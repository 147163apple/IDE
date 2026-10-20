import { useState } from "react";
import type {
  ProtectionCardView,
  ProtectionRecommendationView,
} from "../lib/daemon-api";

/**
 * TASK-P.1 保护清单的两张白话卡片（P1 设计稿场景 A / 场景 C）：
 * - 推荐卡（首次导入）：规则扫描后建议锁定「登录」「支付」等；
 * - 同意卡（命中保护）：一张卡列出本轮全部受保护文件，同意仅放行卡上清单。
 * 文案一律白话，不出现 glob / Git 术语。
 */

export interface ProtectionApprovalCardProps {
  card: ProtectionCardView;
  busy?: boolean;
  onDecide: (cardId: string, decision: "approve" | "deny") => void;
}

export function ProtectionApprovalCard({
  card,
  busy,
  onDecide,
}: ProtectionApprovalCardProps) {
  return (
    <section
      data-testid="protection-approval-card"
      role="alertdialog"
      aria-label="AI 想修改被保护的代码"
      className="border-b border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <div className="font-semibold">
        AI 想修改被保护的代码（{card.entryNames.join("、")}），同意吗？
      </div>
      <div className="mt-1 text-xs text-muted-foreground">这轮要改：</div>
      <ul
        data-testid="protection-card-files"
        className="mt-1 space-y-0.5 text-xs"
      >
        {card.files.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      <div className="mt-1 text-xs">
        同意：本轮只放行上面这几个文件，清单外的受保护文件仍会再问。不同意：这里一点不动，AI
        换别的办法。
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          data-testid="protection-approve"
          disabled={busy}
          onClick={() => onDecide(card.id, "approve")}
          className="rounded border border-emerald-600 px-3 py-1 text-xs text-emerald-700 disabled:opacity-50"
        >
          同意
        </button>
        <button
          type="button"
          data-testid="protection-deny"
          disabled={busy}
          onClick={() => onDecide(card.id, "deny")}
          className="rounded border px-3 py-1 text-xs disabled:opacity-50"
        >
          不同意
        </button>
      </div>
    </section>
  );
}

export interface ProtectionRecommendationCardProps {
  recommendations: ProtectionRecommendationView[];
  busy?: boolean;
  onApply: (names: string[]) => void;
  onDismiss: () => void;
}

export function ProtectionRecommendationCard({
  recommendations,
  busy,
  onApply,
  onDismiss,
}: ProtectionRecommendationCardProps) {
  const [selected, setSelected] = useState<string[]>(
    recommendations.map((r) => r.name),
  );
  if (recommendations.length === 0) return null;
  const toggle = (name: string) =>
    setSelected((s) =>
      s.includes(name) ? s.filter((x) => x !== name) : [...s, name],
    );
  return (
    <section
      data-testid="protection-recommend-card"
      role="dialog"
      aria-label="建议锁住这些重要部分"
      className="border-b border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm"
    >
      <div className="font-semibold">
        建议锁住这些重要部分（AI 改别处不用管）
      </div>
      <ul className="mt-1 space-y-1 text-xs">
        {recommendations.map((r) => (
          <li key={r.name}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid={`protection-rec-${r.name}`}
                checked={selected.includes(r.name)}
                onChange={() => toggle(r.name)}
              />
              <span>
                {r.name}（{r.patterns.join("、")}）
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          data-testid="protection-rec-apply"
          disabled={busy || selected.length === 0}
          onClick={() => onApply(selected)}
          className="rounded border border-sky-600 px-3 py-1 text-xs text-sky-700 disabled:opacity-50"
        >
          锁定选中的部分
        </button>
        <button
          type="button"
          data-testid="protection-rec-dismiss"
          disabled={busy}
          onClick={onDismiss}
          className="rounded border px-3 py-1 text-xs disabled:opacity-50"
        >
          以后再说
        </button>
      </div>
    </section>
  );
}

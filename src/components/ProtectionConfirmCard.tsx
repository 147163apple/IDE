import type { AdmissionView } from "../lib/daemon-api";
import {
  confirmSentence,
  shouldConfirmAdmission,
} from "./supervisor-view-model";

/**
 * TASK-C.2 白话确认卡（`/api/contracts/:id/admit` 联动）。
 *
 * 交互不变式（§0.2 授权口径）：
 * - **无交集**：Daemon 已自动批准并推进到执行，本组件必须 **render null**——
 *   前端 0 弹窗、0 点击，用户在没有任何打断的情况下直接看到"执行中"；
 * - **有交集**：至多**一个**白话是/否卡（不是 Modal，不遮挡代码）；
 * - 点「同意」才发请求；点「不同意」按"坚决取消"处理（先记拒绝，再中止合同）。
 *
 * v1.3.3 坚决不做：成熟度徽章、风险气泡、Snooze 按钮。
 * 判定逻辑见 `supervisor-view-model.ts`（纯函数，便于单测）。
 */

export interface ProtectionConfirmCardProps {
  admission: AdmissionView | null | undefined;
  busy?: boolean | undefined;
  /** 点「同意」：先记本轮放行，再请求推进合同（由调用方发请求） */
  onApprove: (admission: AdmissionView) => void;
  /** 点「不同意」：坚决取消这次任务 */
  onDeny: (admission: AdmissionView) => void;
}

export function ProtectionConfirmCard(props: ProtectionConfirmCardProps) {
  const { admission } = props;
  // 结构性的"无交集零弹窗"：不靠样式隐藏、不靠上层条件，直接不渲染
  if (!admission || !shouldConfirmAdmission(admission)) return null;

  const files = admission.protectedFiles;
  return (
    <section
      data-testid="protection-confirm-card"
      role="alertdialog"
      aria-label="AI 想修改被保护的代码"
      className="border-b border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <div
        data-testid="protection-confirm-question"
        className="font-semibold text-foreground"
      >
        {confirmSentence(admission.entryNames)}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        这次只会动下面这些文件：
      </div>
      <ul
        data-testid="protection-confirm-files"
        className="mt-1 space-y-0.5 font-mono text-xs"
      >
        {files.map((file) => (
          <li key={file}>· {file}</li>
        ))}
      </ul>
      <div className="mt-1 text-xs text-muted-foreground">
        同意：本轮只放行上面这几个文件，清单外的受保护文件仍会再问。不同意：这次任务直接取消，一个文件都不动。
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          data-testid="protection-confirm-approve"
          disabled={props.busy === true}
          onClick={() => props.onApprove(admission)}
          className="rounded border border-emerald-600 px-3 py-1 text-xs text-emerald-700 disabled:opacity-50"
        >
          同意
        </button>
        <button
          type="button"
          data-testid="protection-confirm-deny"
          disabled={props.busy === true}
          onClick={() => props.onDeny(admission)}
          className="rounded border border-border px-3 py-1 text-xs disabled:opacity-50"
        >
          不同意
        </button>
      </div>
    </section>
  );
}

import type { EvidenceBundle } from "@/lib/evidence.schema";

export interface EvidenceChecklistProps {
  evidence: EvidenceBundle;
  onMerge?: () => void;
  busy?: boolean;
}

/**
 * D.2 Evidence 终审清单：退出码、耗时、Scope 审计、Git 指纹与可合并状态。
 * 仅当 PASSED + can_merge 时启用「核准并合并」。
 */
export function EvidenceChecklist({
  evidence,
  onMerge,
  busy = false,
}: EvidenceChecklistProps) {
  const mergeable =
    evidence.verdict.status === "PASSED" && evidence.verdict.can_merge;
  const stale = evidence.verdict.status === "STALE";

  return (
    <section
      className="space-y-3 rounded border border-border bg-card p-3"
      data-testid="evidence-checklist"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Evidence 终审</h3>
        <span
          className={`rounded border px-2 py-0.5 text-[10px] ${
            mergeable
              ? "border-emerald-500/50 text-emerald-600"
              : "border-destructive/50 text-destructive"
          }`}
        >
          {evidence.verdict.status}
          {stale ? "（需重新验证）" : ""}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {evidence.evidence_id}
        </span>
      </header>

      {evidence.tests_modified === true && (
        <div
          className="rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600"
          data-testid="tests-modified-warning"
        >
          ⚠ 测试完整性预警：本任务修改过测试文件（tests_modified=true）。
          验证退出码可能由 Agent 自证，请人工核对测试改动后再核销合并。
        </div>
      )}

      <div className="grid gap-2 text-[11px] md:grid-cols-2">
        <div>
          <div className="text-muted-foreground">Scope 审计</div>
          <div
            className={
              evidence.scope_audit.passed
                ? "text-emerald-600"
                : "text-destructive"
            }
          >
            {evidence.scope_audit.passed ? "通过" : "存在越权"} ·{" "}
            {evidence.scope_audit.files_changed.length} 个文件
          </div>
          {evidence.scope_audit.forbidden_violations.length > 0 && (
            <div className="text-destructive">
              严禁路径：{evidence.scope_audit.forbidden_violations.join(", ")}
            </div>
          )}
        </div>
        <div>
          <div className="text-muted-foreground">Git 指纹</div>
          <div className="truncate">
            task: {evidence.git_info.task_commit_sha.slice(0, 12)} · base:{" "}
            {evidence.git_info.base_commit_sha.slice(0, 12)}
          </div>
          <div className="truncate text-muted-foreground">
            patch: {evidence.git_info.patch_fingerprint.slice(0, 16)}…
          </div>
        </div>
      </div>

      <div>
        <div className="text-[11px] text-muted-foreground">验证命令</div>
        <ul className="mt-1 space-y-0.5 text-[11px]">
          {evidence.verification_results.map((result) => (
            <li key={result.command_alias} className="flex items-center gap-2">
              <span className="font-mono">{result.command_alias}</span>
              <span
                className={
                  result.passed ? "text-emerald-600" : "text-destructive"
                }
              >
                exit={result.exit_code}
              </span>
              <span className="text-muted-foreground">
                {result.duration_ms}ms
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 pt-2">
        <button
          type="button"
          disabled={!mergeable || busy}
          onClick={() => onMerge?.()}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40"
        >
          {busy ? "合并中…" : "核准并合并至主分支"}
        </button>
        <span className="text-[10px] text-muted-foreground">
          {mergeable
            ? "将执行 git merge --squash 并写入 Stagent Git Trailer"
            : "当前证据不可合并"}
        </span>
      </div>
    </section>
  );
}

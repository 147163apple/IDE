<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- The IDE workbench is a single three-column layout (explorer / editor / assistant) in src/routes/index.tsx; the right pane lives in src/components/ContractPanel.tsx; split into components as panes gain logic. Why: keep the skeleton easy to evolve.
- Contract workflow: AI calls (Tech Lead analysis, Worker edits) run in server functions in src/lib/contract.functions.ts; worker output is evaluated by src/lib/pipeline.ts (scope, syntax, tests) against a staged copy in the browser, and any breaker or abort discards the whole change set so nothing partial is written. Why: evidence must come from real diffs and test runs, and the workspace must never hold partial changes.
- Run history (src/lib/history.ts) stores before/after snapshots per run for restore; reports are built in src/lib/report.ts. Why: every run must be auditable and reversible.
- Workspace files live in browser localStorage for now. Why: no backend storage yet.

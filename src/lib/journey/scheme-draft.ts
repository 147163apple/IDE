/**
 * TASK-C.18：方案草案（中间「方案审阅」单页的数据模型）。
 *
 * 薄切片：规则/启发式从对话与意图拼出模块图与决策；不求完美 LLM 画图。
 * completeness≥60 才允许「生成 Demo」；确认方案后 frozen。
 */

export interface SchemeDecision {
  id: string;
  label: string;
  recommended: string;
  alternatives: string[];
  /** 用户是否已确认（含采纳推荐） */
  confirmed: boolean;
  source: "ai_default" | "user";
}

export interface SchemeConflict {
  id: string;
  question: string;
  options: { id: string; label: string }[];
  chosenId: string | null;
}

export interface SchemeDraft {
  title: string;
  summary: string;
  modules: string[];
  mermaidArchitecture: string;
  mermaidFlow: string;
  mermaidMindmap: string;
  decisions: SchemeDecision[];
  conflicts: SchemeConflict[];
  /** 0–100 */
  completeness: number;
  demoReady: boolean;
  frozen: boolean;
  /** 用户手改备注 */
  notes: string;
  updatedAt: string;
}

const MODULE_HINTS: { re: RegExp; label: string }[] = [
  { re: /进度|工期|里程碑|管控/, label: "工程进度管控" },
  { re: /财务|预算|费用|成本|对账|匹配/, label: "财务数据与预算" },
  { re: /预警|告警|提醒/, label: "预警中心" },
  { re: /报表|月度|报告/, label: "月度报表" },
  { re: /登录|账号|权限|用户/, label: "账号与权限" },
  { re: /看板|仪表|dashboard/i, label: "总览看板" },
];

export function emptySchemeDraft(partial?: Partial<SchemeDraft>): SchemeDraft {
  const now = new Date().toISOString();
  return {
    title: "",
    summary: "",
    modules: [],
    mermaidArchitecture: "",
    mermaidFlow: "",
    mermaidMindmap: "",
    decisions: [],
    conflicts: [],
    completeness: 0,
    demoReady: false,
    frozen: false,
    notes: "",
    updatedAt: now,
    ...partial,
  };
}

function extractModules(text: string): string[] {
  const found: string[] = [];
  for (const h of MODULE_HINTS) {
    if (h.re.test(text) && !found.includes(h.label)) found.push(h.label);
  }
  if (found.length === 0 && text.trim().length >= 8) {
    found.push("核心业务模块");
  }
  if (found.length > 0 && !found.includes("桌面端壳")) {
    found.push("桌面端壳");
  }
  return found.slice(0, 8);
}

function buildMermaidArchitecture(title: string, modules: string[]): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_").slice(0, 24);
  const lines = ["flowchart TB", `  UI["${safe(title || "应用")}"]`];
  modules.forEach((m, i) => {
    lines.push(`  M${i}["${safe(m)}"]`);
    lines.push(`  UI --> M${i}`);
  });
  return lines.join("\n");
}

function buildMermaidFlow(modules: string[]): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_").slice(0, 20);
  if (modules.length === 0) {
    return ["flowchart LR", "  A[说出需求] --> B[方案审阅]", "  B --> C[确认方案]", "  C --> D[写代码]"].join(
      "\n",
    );
  }
  const lines = ["flowchart LR"];
  modules.forEach((m, i) => {
    lines.push(`  S${i}["${safe(m)}"]`);
    if (i > 0) lines.push(`  S${i - 1} --> S${i}`);
  });
  return lines.join("\n");
}

function buildMermaidMindmap(title: string, modules: string[]): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fff ]+/g, "").slice(0, 24);
  const lines = ["mindmap", `  root((${safe(title || "方案")}))`];
  for (const m of modules) {
    lines.push(`    ${safe(m)}`);
  }
  return lines.join("\n");
}

function defaultDecisions(modules: string[]): SchemeDecision[] {
  const decisions: SchemeDecision[] = [
    {
      id: "dec_audience",
      label: "主要给谁用",
      recommended: "最终用户（自己点）",
      alternatives: ["后台管理员", "两边都要"],
      confirmed: false,
      source: "ai_default",
    },
    {
      id: "dec_data",
      label: "演示数据",
      recommended: "先用假数据，不碰真实业务库",
      alternatives: ["只读连一点真实数据", "允许写入真实环境"],
      confirmed: false,
      source: "ai_default",
    },
  ];
  if (modules.some((m) => /预警/.test(m))) {
    decisions.push({
      id: "dec_alert",
      label: "预警方式",
      recommended: "页面内醒目提示即可",
      alternatives: ["还要邮件/消息推送", "先不做预警"],
      confirmed: false,
      source: "ai_default",
    });
  }
  return decisions;
}

function detectConflicts(corpus: string, modules: string[]): SchemeConflict[] {
  const conflicts: SchemeConflict[] = [];
  const wantsPolish = /界面|文案|一次到位|好看|精致/.test(corpus);
  const wantsFast = /先跑通|主流程|MVP|尽快|先演示/.test(corpus);
  if (wantsPolish && wantsFast) {
    conflicts.push({
      id: "cf_scope_depth",
      question: "对话里既想「先跑通」又想「界面一次到位」——这一版以哪个为准？",
      options: [
        { id: "fast", label: "先跑通主流程，界面以后再说" },
        { id: "polish", label: "界面和文案也要一次到位" },
      ],
      chosenId: null,
    });
  }
  if (modules.length >= 4 && !/分阶段|先做|第一期|MVP/.test(corpus)) {
    conflicts.push({
      id: "cf_phase",
      question: "模块偏多。第一版是否先做其中一部分？",
      options: [
        { id: "all", label: "这一版尽量都做（假数据演示）" },
        { id: "core", label: "先做进度+预警，财务与报表下一期" },
      ],
      chosenId: null,
    });
  }
  return conflicts;
}

export function scoreCompleteness(draft: SchemeDraft): number {
  let score = 0;
  if (draft.title.trim().length >= 4) score += 15;
  if (draft.summary.trim().length >= 12) score += 15;
  if (draft.modules.length >= 2) score += 20;
  if (draft.modules.length >= 4) score += 10;
  if (draft.decisions.length > 0) score += 10;
  const confirmed = draft.decisions.filter((d) => d.confirmed).length;
  if (confirmed > 0) score += Math.min(15, confirmed * 5);
  const openConflicts = draft.conflicts.filter((c) => !c.chosenId).length;
  if (draft.conflicts.length > 0 && openConflicts === 0) score += 15;
  else if (draft.conflicts.length === 0 && draft.modules.length >= 2) score += 10;
  if (draft.notes.trim().length >= 8) score += 5;
  return Math.min(100, score);
}

/**
 * 用整段对话语料刷新方案（不冻结时）。保留已确认决策与已抉择冲突。
 */
export function rebuildSchemeFromCorpus(
  previous: SchemeDraft | null,
  corpus: string,
  opts?: { titleHint?: string },
): SchemeDraft {
  const text = corpus.trim();
  const title =
    opts?.titleHint?.trim() ||
    previous?.title ||
    (text.length > 40 ? `${text.slice(0, 40)}…` : text) ||
    "未命名方案";
  const modules = extractModules(text);
  const baseDecisions = defaultDecisions(modules);
  const prevDec = new Map((previous?.decisions ?? []).map((d) => [d.id, d]));
  const decisions = baseDecisions.map((d) => {
    const old = prevDec.get(d.id);
    if (!old) return d;
    return {
      ...d,
      confirmed: old.confirmed,
      source: old.source,
      recommended: old.source === "user" ? old.recommended : d.recommended,
    };
  });
  const freshConflicts = detectConflicts(text, modules);
  const prevCf = new Map((previous?.conflicts ?? []).map((c) => [c.id, c]));
  const conflicts = freshConflicts.map((c) => {
    const old = prevCf.get(c.id);
    return old?.chosenId ? { ...c, chosenId: old.chosenId } : c;
  });

  const next = emptySchemeDraft({
    title,
    summary: text.length > 280 ? `${text.slice(0, 280)}…` : text,
    modules,
    mermaidArchitecture: buildMermaidArchitecture(title, modules),
    mermaidFlow: buildMermaidFlow(modules),
    mermaidMindmap: buildMermaidMindmap(title, modules),
    decisions,
    conflicts,
    frozen: previous?.frozen === true,
    notes: previous?.notes ?? "",
    updatedAt: new Date().toISOString(),
  });
  if (next.frozen) {
    return { ...previous!, frozen: true };
  }
  const completeness = scoreCompleteness(next);
  return {
    ...next,
    completeness,
    demoReady: completeness >= 60 && conflicts.every((c) => c.chosenId !== null),
  };
}

export function confirmSchemeDecision(
  draft: SchemeDraft,
  decisionId: string,
  value?: string,
): SchemeDraft {
  if (draft.frozen) return draft;
  const decisions = draft.decisions.map((d) => {
    if (d.id !== decisionId) return d;
    return {
      ...d,
      confirmed: true,
      source: value && value !== d.recommended ? ("user" as const) : d.source,
      recommended: value ?? d.recommended,
    };
  });
  const next = { ...draft, decisions, updatedAt: new Date().toISOString() };
  const completeness = scoreCompleteness(next);
  return {
    ...next,
    completeness,
    demoReady:
      completeness >= 60 && next.conflicts.every((c) => c.chosenId !== null),
  };
}

export function resolveSchemeConflict(
  draft: SchemeDraft,
  conflictId: string,
  optionId: string,
): SchemeDraft {
  if (draft.frozen) return draft;
  const conflicts = draft.conflicts.map((c) =>
    c.id === conflictId ? { ...c, chosenId: optionId } : c,
  );
  const next = { ...draft, conflicts, updatedAt: new Date().toISOString() };
  const completeness = scoreCompleteness(next);
  return {
    ...next,
    completeness,
    demoReady:
      completeness >= 60 && conflicts.every((c) => c.chosenId !== null),
  };
}

export function updateSchemeNotes(draft: SchemeDraft, notes: string): SchemeDraft {
  if (draft.frozen) return draft;
  const next = { ...draft, notes, updatedAt: new Date().toISOString() };
  const completeness = scoreCompleteness(next);
  return {
    ...next,
    completeness,
    demoReady:
      completeness >= 60 && next.conflicts.every((c) => c.chosenId !== null),
  };
}

export function freezeScheme(draft: SchemeDraft): SchemeDraft {
  return { ...draft, frozen: true, updatedAt: new Date().toISOString() };
}

/** 拼成提交给旅程/合同的白话意图 */
export function formatSchemeAsIntent(draft: SchemeDraft): string {
  const lines = [
    draft.title,
    draft.summary,
    draft.modules.length ? `模块：${draft.modules.join("、")}` : "",
    ...draft.decisions
      .filter((d) => d.confirmed || d.source === "ai_default")
      .map((d) => `${d.label}=${d.recommended}${d.confirmed ? "" : "（推荐待确认）"}`),
    ...draft.conflicts
      .filter((c) => c.chosenId)
      .map((c) => {
        const opt = c.options.find((o) => o.id === c.chosenId);
        return `抉择：${c.question} → ${opt?.label ?? c.chosenId}`;
      }),
    draft.notes.trim() ? `手改备注：${draft.notes.trim()}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

import { describe, expect, it } from "vitest";
import {
  rebuildSchemeFromCorpus,
  confirmSchemeDecision,
  resolveSchemeConflict,
  freezeScheme,
  formatSchemeAsIntent,
  emptySchemeDraft,
} from "../../src/lib/journey/scheme-draft";

describe("TASK-C.18 scheme-draft", () => {
  it("从工程管理类意图抽出模块并给出图表源码", () => {
    const corpus =
      "开发一下小软件，在电脑上使用，包含工程进度管控，财务数据匹配，进度预警，财务预算预警，月度报表。";
    const s = rebuildSchemeFromCorpus(null, corpus);
    expect(s.modules.length).toBeGreaterThanOrEqual(3);
    expect(s.modules.some((m) => /进度/.test(m))).toBe(true);
    expect(s.mermaidArchitecture).toContain("flowchart");
    expect(s.mermaidMindmap).toContain("mindmap");
    expect(s.frozen).toBe(false);
  });

  it("完整度够且无未决冲突时 demoReady", () => {
    let s = rebuildSchemeFromCorpus(
      null,
      "工程进度管控 财务预算 预警 月度报表 桌面端，先跑通主流程，界面也要好看一次到位",
    );
    // 可能有冲突；先抉择
    for (const c of s.conflicts) {
      s = resolveSchemeConflict(s, c.id, c.options[0]!.id);
    }
    for (const d of s.decisions) {
      s = confirmSchemeDecision(s, d.id);
    }
    expect(s.completeness).toBeGreaterThanOrEqual(60);
    expect(s.demoReady).toBe(true);
  });

  it("freeze 后不再被语料改写", () => {
    let s = rebuildSchemeFromCorpus(null, "进度管控与财务预警");
    s = freezeScheme(s);
    const again = rebuildSchemeFromCorpus(s, "完全不同的需求：电商下单");
    expect(again.frozen).toBe(true);
    expect(again.title).toBe(s.title);
  });

  it("formatSchemeAsIntent 含模块与决策", () => {
    let s = rebuildSchemeFromCorpus(null, "进度管控 财务匹配 预警");
    s = confirmSchemeDecision(s, "dec_audience");
    const text = formatSchemeAsIntent(s);
    expect(text).toContain("模块");
    expect(text).toContain("主要给谁用");
  });

  it("emptySchemeDraft 可合并 partial", () => {
    const s = emptySchemeDraft({ title: "x", completeness: 10 });
    expect(s.title).toBe("x");
    expect(s.completeness).toBe(10);
    expect(s.demoReady).toBe(false);
  });
});
